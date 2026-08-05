/* ==========================================================================
   app.js — reads content.json and draws the page.

   SAFETY RULE, and the most important line in this whole project:
   all of your content is placed with textContent / createElement, never with
   innerHTML. That means nothing written in content.json can ever run as code.
   It is what keeps a saved GitHub token out of reach of the page's content.
   If you extend this file, keep that rule.
   ========================================================================== */

(function () {
  'use strict';

  var CONTENT_FILE = 'content.json';

  var State = {
    content: null,   // the live content object (the editor mutates this)
    editing: false   // true only when the editor is loaded AND in edit mode
  };

  /* ---------------------------------------------------------------- utils */

  // Create an element. `text` is always set via textContent — never parsed.
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else node.setAttribute(k, v);
      }
    }
    if (text !== null && text !== undefined && text !== '') {
      node.textContent = String(text);
    }
    return node;
  }

  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var child = arguments[i];
      if (child) parent.appendChild(child);
    }
    return parent;
  }

  // "sections.0.items.2.bullets.1" -> walk the object
  function getPath(obj, path) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, value) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] === null || cur[parts[i]] === undefined) {
        cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // Only allow protocols that cannot execute script. Anything else is dropped.
  function safeUrl(url) {
    if (!url) return '';
    var trimmed = String(url).trim();
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
    // Bare relative paths (our own uploads) are fine, but never protocol-ish.
    if (/^[\w./-]+$/.test(trimmed) && trimmed.indexOf(':') === -1) return trimmed;
    return '';
  }

  function formatBytes(bytes) {
    var n = Number(bytes);
    if (!n || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function extOf(path) {
    var m = String(path || '').match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return m ? m[1].toUpperCase() : 'FILE';
  }

  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Non-empty check that treats whitespace-only strings as empty.
  function has(v) {
    return v !== null && v !== undefined && String(v).trim() !== '';
  }

  /* ------------------------------------------------------- editable marks */

  // Tag an element as an editable field. Inert for visitors; the editor
  // looks for [data-path] to know what to wire up.
  function editable(node, path, placeholder) {
    node.setAttribute('data-path', path);
    if (placeholder) node.setAttribute('data-placeholder', placeholder);
    return node;
  }

  function listOf(node, path, kind) {
    node.setAttribute('data-list', path);
    node.setAttribute('data-list-kind', kind);
    return node;
  }

  /* --------------------------------------------------------- colour maths */

  // Parse "#rgb", "#rrggbb" or "rgb(r, g, b)" into [r, g, b].
  function parseColor(input) {
    var s = String(input || '').trim();
    var m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      return m[1].split('').map(function (c) { return parseInt(c + c, 16); });
    }
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      return [
        parseInt(m[1].slice(0, 2), 16),
        parseInt(m[1].slice(2, 4), 16),
        parseInt(m[1].slice(4, 6), 16)
      ];
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  }

  function relativeLuminance(rgb) {
    var a = rgb.map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrastRatio(c1, c2) {
    var a = parseColor(c1), b = parseColor(c2);
    if (!a || !b) return null;
    var l1 = relativeLuminance(a), l2 = relativeLuminance(b);
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // 3:1 is the WCAG minimum for large text and interface elements, which is
  // what the accent colour is used for (headings, links, tags).
  var MIN_CONTRAST = 3;

  /* -------------------------------------------------------------- head/og */

  function applyMeta(content) {
    var meta = content.meta || {};
    var profile = content.profile || {};
    var title = has(meta.siteTitle) ? meta.siteTitle
              : (has(profile.name) ? profile.name + (has(profile.headline) ? ' — ' + profile.headline : '') : 'Portfolio');
    var desc = has(meta.description) ? meta.description : (profile.summary || '');

    document.title = title;
    setMetaTag('name', 'description', desc);
    setMetaTag('property', 'og:title', title);
    setMetaTag('property', 'og:description', desc);
    setMetaTag('property', 'og:type', 'profile');

    var theme = meta.theme || 'classic';
    document.documentElement.setAttribute('data-theme', theme);
    applyPalette(meta.palette);
    applyBackground(meta.background);
    applyAccent(meta.accentColor);
  }

  // Whole-page background: a colour, a gradient, or a photograph.
  //
  // Painted onto a fixed, full-viewport layer behind everything (see
  // body::before in styles.css) rather than with background-attachment:
  // fixed, which iOS Safari handles badly and which janks on long pages.
  function applyBackground(bg) {
    var root = document.documentElement;
    ['--page-bg-layer', '--page-bg-focal'].forEach(function (p) { root.style.removeProperty(p); });
    root.removeAttribute('data-bg');

    bg = bg || {};
    var style = bg.style || 'none';
    if (style === 'none') return;

    if (style === 'color' && has(bg.color)) {
      root.style.setProperty('--page-bg-layer', bg.color);
    } else if (style === 'gradient') {
      var a = bg.color || '#ffffff';
      var b = bg.color2 || a;
      var angle = Number(bg.angle);
      if (!isFinite(angle)) angle = 160;
      root.style.setProperty('--page-bg-layer', 'linear-gradient(' + angle + 'deg, ' + a + ', ' + b + ')');
    } else if (style === 'photo') {
      var img = safeUrl(bg.image);
      if (!img) return;
      root.style.setProperty('--page-bg-layer', 'url("' + img.replace(/"/g, '%22') + '")');
      root.style.setProperty('--page-bg-focal', bg.focal || 'center');
    }

    // Drives the readability veil behind the text column.
    root.setAttribute('data-bg', style);
  }

  // Your own colours, layered over whichever theme is active. Each is
  // optional — blank means "leave the theme alone".
  //
  // The fiddly part is the DERIVED shades. Overriding --text alone would
  // leave --text-muted and --text-faint at the theme's values, which may no
  // longer suit; same for the card and tile surfaces under a custom
  // background. So when a colour is set, its relatives are mixed from it.
  function applyPalette(palette) {
    var root = document.documentElement;
    var derived = [
      '--text-muted', '--text-faint', '--heading',
      '--bg-sunken', '--bg-raised', '--border'
    ];
    ['--bg', '--text'].concat(derived).forEach(function (prop) {
      root.style.removeProperty(prop);
    });

    palette = palette || {};

    if (has(palette.pageBg)) {
      root.style.setProperty('--bg', palette.pageBg);
      root.style.setProperty('--bg-sunken', 'color-mix(in srgb, ' + palette.pageBg + ' 94%, ' + contrastPole(palette.pageBg) + ')');
      root.style.setProperty('--bg-raised', 'color-mix(in srgb, ' + palette.pageBg + ' 97%, ' + oppositePole(palette.pageBg) + ')');
      root.style.setProperty('--border', 'color-mix(in srgb, ' + palette.pageBg + ' 82%, ' + contrastPole(palette.pageBg) + ')');
    }

    if (has(palette.pageText)) {
      root.style.setProperty('--text', palette.pageText);
      root.style.setProperty('--text-muted', 'color-mix(in srgb, ' + palette.pageText + ' 78%, transparent)');
      root.style.setProperty('--text-faint', 'color-mix(in srgb, ' + palette.pageText + ' 58%, transparent)');
    }

    // Headings default to the body text colour, so this only needs setting
    // when it is deliberately different.
    if (has(palette.heading)) root.style.setProperty('--heading', palette.heading);
  }

  // Which way to nudge a colour to create a neighbouring surface: dark
  // backgrounds get lighter surfaces, light backgrounds get darker ones.
  function contrastPole(colour) {
    var rgb = parseColor(colour);
    if (!rgb) return '#000000';
    return relativeLuminance(rgb) > 0.45 ? '#000000' : '#ffffff';
  }

  function oppositePole(colour) {
    return contrastPole(colour) === '#000000' ? '#ffffff' : '#000000';
  }

  // Apply the owner's accent colour — but only if it is actually readable on
  // this theme's background. A navy tuned for the light themes is close to
  // invisible on the dark one, so in that case we keep the theme's own accent
  // rather than publish something nobody can read.
  function applyAccent(colour) {
    var root = document.documentElement;
    root.style.removeProperty('--accent');
    if (!has(colour)) return { applied: false, reason: 'none' };

    var styles = getComputedStyle(root);
    var bg = styles.getPropertyValue('--bg').trim();
    var themeAccent = styles.getPropertyValue('--accent').trim();

    var ratio = contrastRatio(colour, bg);
    if (ratio !== null && ratio < MIN_CONTRAST) {
      return { applied: false, reason: 'contrast', ratio: ratio, fallback: themeAccent };
    }

    root.style.setProperty('--accent', colour);
    return { applied: true, ratio: ratio };
  }

  function setMetaTag(attr, key, value) {
    var tag = document.head.querySelector('meta[' + attr + '="' + key + '"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute(attr, key);
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', value || '');
  }

  /* -------------------------------------------------------------- profile */

  /* --------------------------------------------------------------- banner */

  var BANNER_HEIGHTS = { short: '11rem', medium: '17rem', tall: '25rem' };

  // Paint the banner background and decide what colour its text should be.
  function decorateBanner(head, banner) {
    var style = banner.style;
    var solid = banner.color || '#1f4d6b';

    head.style.setProperty('--banner-min-h', BANNER_HEIGHTS[banner.height] || BANNER_HEIGHTS.medium);
    head.style.setProperty('--banner-solid', solid);

    if (style === 'solid') {
      head.style.setProperty('--banner-bg', solid);
    } else if (style === 'gradient') {
      var c2 = banner.color2 || solid;
      var angle = Number(banner.angle);
      if (!isFinite(angle)) angle = 160;
      head.style.setProperty('--banner-bg', 'linear-gradient(' + angle + 'deg, ' + solid + ', ' + c2 + ')');
    } else if (style === 'photo') {
      var img = safeUrl(banner.image);
      if (img) {
        // The photo goes on its own layer so the scrim can sit above it.
        head.style.setProperty('--banner-image', 'url("' + img.replace(/"/g, '%22') + '")');
        head.style.setProperty('--banner-focal', banner.focal || 'center');
      }
      head.style.setProperty('--banner-bg', solid);
    }

    // Text colour: explicit, else derived from how light the background is.
    // A photo always carries the scrim, so light text is always correct there.
    var text = has(banner.textColor) ? banner.textColor : autoTextOn(style === 'photo' ? '#222222' : solid);
    head.style.setProperty('--banner-text', text);
    head.style.setProperty('--banner-text-soft', 'color-mix(in srgb, ' + text + ' 78%, transparent)');
  }

  // Black or white, whichever is more readable on the given background.
  function autoTextOn(bg) {
    var rgb = parseColor(bg);
    if (!rgb) return '#ffffff';
    return relativeLuminance(rgb) > 0.45 ? '#16181a' : '#ffffff';
  }

  function renderMasthead(content) {
    var p = content.profile || {};
    var banner = (content.meta && content.meta.banner) || {};
    var style = banner.style || 'none';

    // The masthead is full-bleed so a banner background can run edge to edge;
    // an inner wrapper reproduces the page's width and padding so the text
    // still lines up with the content below. With no banner the background is
    // transparent and this renders exactly as the plain masthead did.
    var head = el('header', {
      class: 'masthead' + (style !== 'none' ? ' masthead--banner masthead--' + style : ''),
      'data-banner': style
    });

    if (style !== 'none') decorateBanner(head, banner);

    var inner = el('div', { class: 'masthead__inner' + (banner.align === 'center' ? ' masthead__inner--center' : '') });
    head.appendChild(inner);

    // Photo, or initials if none set.
    var photo = safeUrl(p.photo);
    var avatar;
    if (photo) {
      avatar = el('div', { class: 'avatar', 'data-avatar': '1' });
      avatar.appendChild(el('img', {
        src: photo,
        alt: has(p.photoAlt) ? p.photoAlt : (has(p.name) ? 'Photograph of ' + p.name : 'Profile photograph'),
        width: '104', height: '104', loading: 'eager'
      }));
    } else {
      avatar = el('div', { class: 'avatar avatar--initials', 'data-avatar': '1', 'aria-hidden': 'true' }, initialsOf(p.name));
    }
    inner.appendChild(avatar);

    var body = el('div', { class: 'masthead__body' });

    body.appendChild(editable(el('h1', { class: 'masthead__name' }, p.name), 'profile.name', 'Your name'));

    if (has(p.headline) || State.editing) {
      body.appendChild(editable(el('p', { class: 'masthead__headline' }, p.headline), 'profile.headline', 'Your job title'));
    }
    if (has(p.location) || State.editing) {
      body.appendChild(editable(el('p', { class: 'masthead__location' }, p.location), 'profile.location', 'City, Country'));
    }

    // Contact row
    var contact = el('div', { class: 'contact' });
    if (has(p.email) || State.editing) {
      contact.appendChild(editable(
        el('a', { href: 'mailto:' + String(p.email || '').trim(), 'data-href-prefix': 'mailto:' }, p.email),
        'profile.email', 'you@example.com'));
    }
    if (has(p.phone) || State.editing) {
      contact.appendChild(editable(
        el('a', { href: 'tel:' + String(p.phone || '').replace(/[^\d+]/g, ''), 'data-href-prefix': 'tel:' }, p.phone),
        'profile.phone', 'Phone number'));
    }

    var links = Array.isArray(p.links) ? p.links : [];
    links.forEach(function (link, i) {
      var url = safeUrl(link && link.url);
      var a = el('a', {
        href: url || null,
        target: /^https?:/i.test(url) ? '_blank' : null,
        rel: /^https?:/i.test(url) ? 'noopener noreferrer' : null,
        'data-item': 'profile.links.' + i
      }, (link && link.label) || '');
      editable(a, 'profile.links.' + i + '.label', 'Link name');
      contact.appendChild(a);
    });
    listOf(contact, 'profile.links', 'link');
    body.appendChild(contact);

    if (has(p.summary) || State.editing) {
      body.appendChild(editable(el('p', { class: 'masthead__summary' }, p.summary), 'profile.summary', 'A short summary about you'));
    }

    inner.appendChild(body);
    return head;
  }

  /* ------------------------------------------------------- section pieces */

  function renderAttachments(list, basePath) {
    if (!Array.isArray(list) || (!list.length && !State.editing)) return null;
    var wrap = el('div', { class: 'attachments' });
    list.forEach(function (f, i) {
      wrap.appendChild(renderFile(f, basePath + '.' + i));
    });
    return listOf(wrap, basePath, 'attachment');
  }

  function renderFile(f, path) {
    f = f || {};
    var url = safeUrl(f.path);
    var a = el('a', {
      class: 'file',
      href: url || null,
      download: url ? '' : null,
      'data-item': path
    });
    a.appendChild(el('span', { class: 'file__icon', 'aria-hidden': 'true' }, extOf(f.path)));

    var body = el('span', { class: 'file__body' });
    body.appendChild(editable(el('span', { class: 'file__label' }, f.label || f.path || 'Untitled file'), path + '.label', 'File name'));

    var metaBits = [];
    if (has(f.description)) metaBits.push(f.description);
    if (f.size) metaBits.push(formatBytes(f.size));
    if (metaBits.length) body.appendChild(el('span', { class: 'file__meta' }, metaBits.join(' · ')));

    a.appendChild(body);
    return a;
  }

  function renderTimeline(section, sIndex) {
    var wrap = el('div', { class: 'entries' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      var base = 'sections.' + sIndex + '.items.' + i;
      var entry = el('article', { class: 'entry', 'data-item': base });

      var head = el('div', { class: 'entry__head' });
      var headtext = el('div', { class: 'entry__headtext' });
      headtext.appendChild(editable(el('h3', { class: 'entry__role' }, item.role), base + '.role', 'Job title'));
      if (has(item.org) || State.editing) {
        headtext.appendChild(editable(el('p', { class: 'entry__org' }, item.org), base + '.org', 'Company'));
      }
      head.appendChild(headtext);

      var metaParts = [];
      if (has(item.start) || has(item.end)) {
        metaParts.push([item.start, item.end].filter(has).join(' – '));
      }
      if (has(item.location)) metaParts.push(item.location);
      if (metaParts.length || State.editing) {
        var meta = el('div', { class: 'entry__meta' });
        meta.appendChild(editable(el('span', {}, item.start), base + '.start', 'From'));
        meta.appendChild(el('span', {}, ' – '));
        meta.appendChild(editable(el('span', {}, item.end), base + '.end', 'To'));
        if (has(item.location) || State.editing) {
          meta.appendChild(el('br'));
          meta.appendChild(editable(el('span', {}, item.location), base + '.location', 'Location'));
        }
        head.appendChild(meta);
      }
      entry.appendChild(head);

      var bullets = Array.isArray(item.bullets) ? item.bullets : [];
      if (bullets.length || State.editing) {
        var ul = el('ul', { class: 'entry__bullets' });
        bullets.forEach(function (b, bi) {
          var li = el('li', { 'data-item': base + '.bullets.' + bi }, b);
          editable(li, base + '.bullets.' + bi, 'What you did');
          ul.appendChild(li);
        });
        listOf(ul, base + '.bullets', 'bullet');
        entry.appendChild(ul);
      }

      var att = renderAttachments(item.attachments, base + '.attachments');
      if (att) entry.appendChild(att);

      wrap.appendChild(entry);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'timeline');
  }

  function renderCards(section, sIndex) {
    var wrap = el('div', { class: 'cards' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      var base = 'sections.' + sIndex + '.items.' + i;
      var card = el('article', { class: 'card', 'data-item': base });

      var img = safeUrl(item.image);
      if (img) {
        card.appendChild(el('img', {
          class: 'card__image',
          src: img,
          alt: item.imageAlt || '',
          loading: 'lazy',
          width: '640', height: '360'
        }));
      }

      card.appendChild(editable(el('h3', { class: 'card__title' }, item.name), base + '.name', 'Project name'));

      if (has(item.description) || State.editing) {
        card.appendChild(editable(el('p', { class: 'card__desc' }, item.description), base + '.description', 'What it was and what changed'));
      }

      var tags = Array.isArray(item.tags) ? item.tags : [];
      if (tags.length || State.editing) {
        var tagWrap = el('div', { class: 'tags' });
        tags.forEach(function (t, ti) {
          var tag = el('span', { class: 'tag', 'data-item': base + '.tags.' + ti }, t);
          editable(tag, base + '.tags.' + ti, 'Tag');
          tagWrap.appendChild(tag);
        });
        listOf(tagWrap, base + '.tags', 'tag');
        card.appendChild(tagWrap);
      }

      var url = safeUrl(item.url);
      if (url) {
        card.appendChild(el('a', {
          class: 'card__link',
          href: url,
          target: '_blank',
          rel: 'noopener noreferrer'
        }, 'View project →'));
      }

      var att = renderAttachments(item.attachments, base + '.attachments');
      if (att) card.appendChild(att);

      wrap.appendChild(card);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'card');
  }

  function renderGroups(section, sIndex) {
    var wrap = el('div', { class: 'groups' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      var base = 'sections.' + sIndex + '.items.' + i;
      var group = el('div', { class: 'group', 'data-item': base });
      group.appendChild(editable(el('h3', { class: 'group__name' }, item.group), base + '.group', 'Group name'));

      var skills = Array.isArray(item.skills) ? item.skills : [];
      var list = el('div', { class: 'group__skills' });
      skills.forEach(function (s, si) {
        var tag = el('span', { class: 'tag', 'data-item': base + '.skills.' + si }, s);
        editable(tag, base + '.skills.' + si, 'Skill');
        list.appendChild(tag);
      });
      listOf(list, base + '.skills', 'skill');
      group.appendChild(list);
      wrap.appendChild(group);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'group');
  }

  function renderText(section, sIndex) {
    var wrap = el('div', { class: 'prose' });
    var items = Array.isArray(section.items) ? section.items : [];
    items.forEach(function (para, i) {
      var base = 'sections.' + sIndex + '.items.' + i;
      var p = el('p', { 'data-item': base }, para);
      editable(p, base, 'Write a paragraph');
      wrap.appendChild(p);
    });
    return listOf(wrap, 'sections.' + sIndex + '.items', 'paragraph');
  }

  function renderGallery(section, sIndex) {
    var wrap = el('div', { class: 'gallery' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      var base = 'sections.' + sIndex + '.items.' + i;
      var fig = el('figure', { 'data-item': base });
      var src = safeUrl(item.image);
      if (src) {
        var img = el('img', {
          src: src,
          alt: item.imageAlt || item.caption || '',
          loading: 'lazy',
          width: '400', height: '300'
        });
        img.addEventListener('click', function () { openLightbox(src, item.caption); });
        fig.appendChild(img);
      }
      if (has(item.caption) || State.editing) {
        fig.appendChild(editable(el('figcaption', {}, item.caption), base + '.caption', 'Caption'));
      }
      wrap.appendChild(fig);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'photo');
  }

  function renderFiles(section, sIndex) {
    var wrap = el('div', { class: 'files' });
    var items = Array.isArray(section.items) ? section.items : [];
    items.forEach(function (item, i) {
      wrap.appendChild(renderFile(item, 'sections.' + sIndex + '.items.' + i));
    });
    return listOf(wrap, 'sections.' + sIndex + '.items', 'file');
  }

  /* ---------------------------------------------------------------- tools */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Build an <svg> from vetted local path data. createElement() would produce
  // a dead element in the wrong namespace, so createElementNS is required.
  function svgIcon(icon, label) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', icon.path);
    svg.appendChild(path);
    return svg;
  }

  // Which colour a tile blooms to on hover. Falls back to the theme accent
  // when a brand colour would be invisible against the current background —
  // Synology's official grey on white being the obvious case.
  function brandColour(item, icon) {
    var styles = getComputedStyle(document.documentElement);
    var accent = styles.getPropertyValue('--accent').trim() || '#333';
    var bg = styles.getPropertyValue('--bg').trim();

    var candidate = has(item.color) ? item.color : (icon ? icon.hex : '');
    if (!candidate) return accent;

    var ratio = contrastRatio(candidate, bg);
    if (ratio !== null && ratio < MIN_CONTRAST) return accent;
    return candidate;
  }

  // Lettermark for a tool with no logo. Two characters, because a lone
  // letter reads as sparse beside the icons: "Visual Studio" -> VS,
  // "JotForm" -> JO.
  function toolMark(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function renderTools(section, sIndex) {
    var wrap = el('div', { class: 'tools' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      item = item || {};
      var base = 'sections.' + sIndex + '.items.' + i;
      var name = has(item.name) ? item.name : 'Tool';

      // Slug is only ever a key lookup — path data never comes from content.
      var icon = (window.ToolIcons && item.icon) ? window.ToolIcons[item.icon] : null;
      var url = safeUrl(item.url);

      var tile = el(url ? 'a' : 'div', {
        class: 'tool',
        'data-item': base,
        href: url || null,
        target: /^https?:/i.test(url) ? '_blank' : null,
        rel: /^https?:/i.test(url) ? 'noopener noreferrer' : null
      });
      tile.style.setProperty('--brand', brandColour(item, icon));

      var art = el('span', { class: 'tool__art' });
      var logo = safeUrl(item.logo);

      if (logo) {
        art.appendChild(el('img', {
          src: logo, alt: name, loading: 'lazy', width: '48', height: '48'
        }));
        art.className += ' tool__art--photo';
      } else if (icon) {
        art.appendChild(svgIcon(icon, name));
      } else {
        // Unknown slug, or a brand the icon set doesn't carry. A lettermark
        // in the same tile geometry reads as part of the set, not a gap.
        art.appendChild(el('span', { class: 'tool__mark', 'aria-hidden': 'true' }, toolMark(name)));
        art.className += ' tool__art--mark';
      }
      tile.appendChild(art);

      tile.appendChild(editable(el('span', { class: 'tool__name' }, item.name), base + '.name', 'Tool name'));
      wrap.appendChild(tile);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'tool');
  }

  /* ------------------------------------------------------- labelled list */

  // "Systems & Automation — Workflow automation (Zapier), process design…"
  // A bold label, an em-dash, then the description flowing on the same line.
  function renderList(section, sIndex) {
    var wrap = el('ul', { class: 'deflist' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      item = item || {};
      var base = 'sections.' + sIndex + '.items.' + i;
      var li = el('li', { class: 'deflist__item', 'data-item': base });

      li.appendChild(editable(el('span', { class: 'deflist__label' }, item.label),
        base + '.label', 'Label'));

      // A plain text node, not an editable field: the separator belongs to
      // the design, so it can't be typed over or deleted by accident.
      li.appendChild(document.createTextNode(' — '));

      li.appendChild(editable(el('span', { class: 'deflist__text' }, item.text),
        base + '.text', 'Description'));

      wrap.appendChild(li);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'listitem');
  }

  /* ---------------------------------------------------------------- video */

  // Pull a video ID out of whatever YouTube or Vimeo URL was pasted, then
  // build the embed against a fixed host from that ID.
  //
  // Content therefore never supplies an iframe address — it supplies an ID we
  // have validated. That keeps the rule that nothing in content.json can aim
  // the page at arbitrary code.
  function parseVideoUrl(url) {
    var u = String(url || '').trim();
    if (!u) return null;

    var m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i);
    if (m) {
      return {
        provider: 'YouTube',
        // nocookie + no related videos from other channels
        src: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0'
      };
    }

    m = u.match(/vimeo\.com\/(?:video\/|channels\/[\w]+\/|groups\/[\w]+\/videos\/)?(\d{6,12})/i);
    if (m) {
      return { provider: 'Vimeo', src: 'https://player.vimeo.com/video/' + m[1] + '?dnt=1' };
    }

    return null;
  }

  function renderVideo(section, sIndex) {
    var wrap = el('div', { class: 'videos' });
    var items = Array.isArray(section.items) ? section.items : [];

    items.forEach(function (item, i) {
      item = item || {};
      var base = 'sections.' + sIndex + '.items.' + i;
      var block = el('figure', { class: 'video', 'data-item': base });
      var frame = el('div', { class: 'video__frame' });

      var file = safeUrl(item.file);
      var embed = item.source === 'link' ? parseVideoUrl(item.url) : null;

      if (item.source !== 'link' && file) {
        var v = el('video', {
          controls: '',
          // Without this a phone downloads the whole file just for landing
          // on the page.
          preload: 'metadata',
          playsinline: '',
          poster: safeUrl(item.poster) || null
        });
        v.appendChild(el('source', { src: file }));
        v.appendChild(document.createTextNode('Your browser cannot play this video.'));
        frame.appendChild(v);
      } else if (embed) {
        frame.appendChild(el('iframe', {
          src: embed.src,
          title: has(item.caption) ? item.caption : (embed.provider + ' video'),
          loading: 'lazy',
          allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: '',
          referrerpolicy: 'strict-origin-when-cross-origin'
        }));
        block.setAttribute('data-video-url', item.url || '');
      } else if (State.editing) {
        frame.appendChild(el('div', { class: 'video__empty' }, 'No video yet — use ⚙ Details to add one.'));
      } else {
        return;   // nothing playable; show nothing at all
      }

      block.appendChild(frame);
      if (has(item.caption) || State.editing) {
        block.appendChild(editable(el('figcaption', { class: 'video__caption' }, item.caption),
          base + '.caption', 'Caption (optional)'));
      }
      wrap.appendChild(block);
    });

    return listOf(wrap, 'sections.' + sIndex + '.items', 'video');
  }

  // A video section with nothing playable in it shows nothing at all to a
  // visitor — no heading, no empty frame. It stays visible while editing so
  // it can be filled in.
  function sectionIsEmpty(section) {
    if (!section || section.type !== 'video') return false;
    var items = Array.isArray(section.items) ? section.items : [];
    return !items.some(function (it) {
      if (!it) return false;
      return it.source === 'link' ? !!parseVideoUrl(it.url) : has(it.file);
    });
  }

  var RENDERERS = {
    timeline: renderTimeline,
    cards: renderCards,
    groups: renderGroups,
    text: renderText,
    gallery: renderGallery,
    files: renderFiles,
    tools: renderTools,
    video: renderVideo,
    list: renderList
  };

  function renderSection(section, index) {
    var type = section && section.type;
    var fn = RENDERERS[type];
    var wrap = el('section', {
      class: 'section',
      id: section.id || ('section-' + index),
      'data-item': 'sections.' + index,
      'data-section-type': type || 'unknown'
    });

    wrap.appendChild(editable(el('h2', { class: 'section__title' }, section.title), 'sections.' + index + '.title', 'Section heading'));

    if (!fn) {
      wrap.appendChild(el('p', { class: 'file__meta' }, 'Unknown section type "' + type + '" — nothing to show.'));
      return wrap;
    }
    wrap.appendChild(fn(section, index));
    return wrap;
  }

  /* --------------------------------------------------------------- render */

  function render() {
    var content = State.content;
    var root = document.getElementById('app');
    if (!root) return;

    applyMeta(content);

    root.textContent = '';   // clear without innerHTML

    // The masthead sits outside .page so a banner can run edge to edge.
    root.appendChild(renderMasthead(content));

    var page = el('div', { class: 'page' });

    var sections = Array.isArray(content.sections) ? content.sections : [];
    var hasRail = sections.some(function (s) { return s && s.type === 'tools'; });

    // The rail is a grid child of .page, and must sit before <main> in the
    // DOM: that ordering is what puts it beside the content on a wide screen
    // and directly under the intro on a phone, from one set of markup.
    var rail = null;
    // The width class goes on #app as well, so the banner (which now sits
    // outside .page) widens in step with the content and stays aligned.
    root.classList.toggle('has-rail', hasRail);
    if (hasRail) {
      page.classList.add('page--has-rail');
      rail = el('aside', { class: 'toolrail', 'aria-label': 'Tools' });
      page.appendChild(rail);
    }

    var main = el('main', { id: 'main' });
    sections.forEach(function (s, i) {
      if (!s) return;
      if (!State.editing && sectionIsEmpty(s)) return;   // empty video section
      var node = renderSection(s, i);
      // Read only by print.css, so the screen layout is untouched.
      node.style.setProperty('--print-order', i * 10);
      if (s.type === 'tools' && rail) rail.appendChild(node);
      else main.appendChild(node);
    });
    page.appendChild(main);

    // On paper the Tools rail belongs immediately after the skills section,
    // not floating at the end. Screen layout is unaffected: the rail keeps
    // its own column, and this property is never read outside print.css.
    if (rail) {
      var skillsAt = -1;
      sections.forEach(function (s, i) { if (s && s.type === 'groups') skillsAt = i; });
      rail.style.setProperty('--print-order',
        skillsAt >= 0 ? (skillsAt * 10 + 5) : (sections.length * 10 + 5));
    }

    // The section list is anchored on .page, not <main>, so that a tools
    // section living in the rail is still found by the editor's controls.
    listOf(page, 'sections', 'section');

    var footer = el('footer', { class: 'page-footer' });
    footer.appendChild(el('p', {}, '© ' + new Date().getFullYear() + ' ' + ((content.profile && content.profile.name) || '')));
    page.appendChild(footer);

    root.appendChild(page);

    setupReveal(page);
    setupCondense(root);

    // Let the editor re-attach its controls after every re-render.
    document.dispatchEvent(new CustomEvent('portfolio:rendered'));
  }

  /* ------------------------------------------------------ pin and condense */

  // The masthead pins to the top on a wide screen and shrinks to a slim bar
  // once you scroll past it.
  //
  // FAILS OPEN, deliberately: the class that enables pinning is added only
  // after the observer has been constructed successfully. If
  // IntersectionObserver is unavailable, nothing pins and the page scrolls
  // normally — the failure mode must never be a tall banner welded to the
  // top of the screen with no way to shrink it.
  // The slim bar that slides in once the banner has scrolled away. It is a
  // visual duplicate of the name and title, so it is hidden from screen
  // readers — the real masthead above is what they read.
  function buildMiniBar(root) {
    var p = State.content.profile || {};
    var old = root.querySelector('.minibar');
    if (old) old.remove();

    var bar = el('div', { class: 'minibar', 'aria-hidden': 'true' });
    var inner = el('div', { class: 'minibar__inner' });

    var photo = safeUrl(p.photo);
    if (photo) {
      var wrap = el('span', { class: 'minibar__avatar' });
      wrap.appendChild(el('img', { src: photo, alt: '', width: '36', height: '36' }));
      inner.appendChild(wrap);
    } else {
      inner.appendChild(el('span', { class: 'minibar__avatar minibar__avatar--initials' }, initialsOf(p.name)));
    }

    inner.appendChild(el('span', { class: 'minibar__name' }, p.name));
    if (has(p.headline)) inner.appendChild(el('span', { class: 'minibar__headline' }, p.headline));

    bar.appendChild(inner);
    root.appendChild(bar);
    return bar;
  }

  var condenseState = { onScroll: null, onResize: null };

  function setupCondense(root) {
    root.classList.remove('has-sticky-head', 'is-condensed');

    if (condenseState.onScroll) { window.removeEventListener('scroll', condenseState.onScroll); condenseState.onScroll = null; }
    if (condenseState.onResize) { window.removeEventListener('resize', condenseState.onResize); condenseState.onResize = null; }

    if (State.editing) return;               // a shrinking header can't be edited

    var head = root.querySelector('.masthead');
    if (!head) return;

    // A separate slim bar, fixed and therefore OUT OF THE FLOW, rather than
    // shrinking the banner itself.
    //
    // Shrinking a sticky header is what caused the scroll glitch: a sticky
    // element still occupies its full box in the flow, so collapsing it from
    // ~500px to ~72px removes 400-odd pixels of document in a single frame
    // and everything below jumps. Near the trigger point the browser can then
    // clamp the scroll position back across the threshold and the two states
    // fight each other. A fixed overlay changes no layout at all, and it
    // animates on transform alone, so there is nothing to reflow.
    var mini = buildMiniBar(root);

    // A passive, frame-throttled scroll listener rather than an
    // IntersectionObserver on a sentinel.
    //
    // The sentinel approach is tidier in principle but has a trap: a sticky
    // element still occupies its box in normal flow, so the moment the header
    // condenses, that box shrinks and drags any following sentinel up onto
    // the trigger line — after which it can never expand again. Anchoring the
    // sentinel elsewhere fixes that, but the observer still only recomputes
    // during a rendering pass, which made the behaviour hard to pin down.
    // Reading scrollY directly is a handful of lines, fires reliably, and is
    // straightforward to verify.
    var threshold = 120;

    function measureThreshold() {
      // The banner's height is now constant — it is never resized — so this
      // can be measured at any time without the old "don't measure while
      // condensed" trap.
      threshold = Math.max(80, head.offsetHeight - 96);
    }
    measureThreshold();

    // Deliberately NOT throttled through a requestAnimationFrame "ticking"
    // flag. That pattern deadlocks if a single frame callback is ever
    // dropped — the flag stays raised and the handler goes permanently deaf.
    // Reading scrollY is cheap and forces no layout, and the class is only
    // touched when the state actually changes, so there is nothing to gain
    // by deferring this.
    var condensed = false;

    function update() {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      // A dead band, so a scroll resting exactly on the boundary cannot
      // flicker between the two states.
      var next = condensed ? (y >= threshold - 40) : (y > threshold);
      if (next === condensed) return;
      condensed = next;
      root.classList.toggle('is-condensed', condensed);
    }

    condenseState.onScroll = update;

    var timer = null;
    condenseState.onResize = function () {
      clearTimeout(timer);
      timer = setTimeout(measureThreshold, 200);
    };

    window.addEventListener('scroll', condenseState.onScroll, { passive: true });
    window.addEventListener('resize', condenseState.onResize, { passive: true });

    update();                                // reflect the position we loaded at
    root.classList.add('has-sticky-head');
  }

  /* -------------------------------------------------------- scroll reveal */

  // Fade sections up as they scroll into view. Everything here is additive:
  // the .reveal class (which hides an element) is only ever applied when we
  // are certain we can also remove it. If anything is unsupported, or the
  // visitor prefers reduced motion, or the owner is editing, the page just
  // renders normally.
  function setupReveal(page) {
    if (State.editing) return;
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var targets = page.querySelectorAll('.section');
    if (!targets.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.02 });

    targets.forEach(function (node) {
      node.classList.add('reveal');
      observer.observe(node);
    });

    // Safety net: if for any reason the observer never fires (an odd
    // browser, a restored scroll position, a background tab), reveal
    // everything anyway rather than leaving the page blank.
    setTimeout(function () {
      targets.forEach(function (node) { node.classList.add('is-visible'); });
    }, 1600);
  }

  /* ------------------------------------------------------------ lightbox */

  function openLightbox(src, caption) {
    var box = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': caption || 'Photo' });
    var close = el('button', { class: 'lightbox__close', type: 'button', 'aria-label': 'Close photo' }, '×');
    var inner = el('div', {});
    inner.appendChild(el('img', { src: src, alt: caption || '' }));
    if (has(caption)) inner.appendChild(el('p', { class: 'lightbox__caption' }, caption));
    box.appendChild(close);
    box.appendChild(inner);

    function dismiss() {
      box.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }

    box.addEventListener('click', function (e) { if (e.target === box || e.target === inner) dismiss(); });
    close.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey);

    document.body.appendChild(box);
    close.focus();
  }

  /* --------------------------------------------------------------- errors */

  function showError(title, detail, hint) {
    var root = document.getElementById('app');
    if (!root) return;
    root.textContent = '';
    var box = el('div', { class: 'error-box' });
    box.appendChild(el('h2', {}, title));
    if (detail) box.appendChild(el('p', {}, detail));
    if (hint) {
      var p = el('p', {});
      p.appendChild(el('strong', {}, 'What to do: '));
      p.appendChild(document.createTextNode(hint));
      box.appendChild(p);
    }
    root.appendChild(box);
  }

  /* ------------------------------------------------------------ bootstrap */

  function isEditMode() {
    var params = new URLSearchParams(window.location.search);
    return params.has('edit');
  }

  function loadEditor() {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'assets/editor.css';
    document.head.appendChild(css);

    var script = document.createElement('script');
    script.src = 'assets/editor.js';
    script.onerror = function () {
      console.error('Editor failed to load.');
    };
    document.body.appendChild(script);
  }

  function start() {
    fetch(CONTENT_FILE + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          showError(
            'Your content file has a typo in it',
            'The file content.json could not be read. This is almost always a missing comma, or a quote mark that was opened but not closed. The exact complaint was: ' + parseErr.message,
            'Open content.json on GitHub and look at the line number mentioned above. If you get stuck, GitHub keeps every previous version of the file — you can restore the last working one from the file’s History.'
          );
          throw parseErr;
        }
        State.content = data;
        render();
        if (isEditMode()) loadEditor();
      })
      .catch(function (err) {
        if (err instanceof SyntaxError) return;   // already reported above
        if (window.location.protocol === 'file:') {
          showError(
            'Open this through the preview script, not by double-clicking',
            'Browsers block pages opened directly from a folder (file://) from reading data files, which is why nothing loaded.',
            'Close this tab and double-click preview.bat in your Portfolio folder instead. It starts a small local server and opens the site correctly.'
          );
          return;
        }
        showError(
          'Could not load the portfolio content',
          'The file content.json could not be fetched (' + err.message + ').',
          'Check that content.json sits next to index.html in your repository, and that GitHub Pages has finished publishing — that can take a minute after a change.'
        );
      });
  }

  /* Public surface used by the editor. */
  window.Portfolio = {
    state: State,
    render: render,
    el: el,
    append: append,
    getPath: getPath,
    setPath: setPath,
    safeUrl: safeUrl,
    formatBytes: formatBytes,
    has: has,
    applyMeta: applyMeta,
    applyAccent: applyAccent,
    contrastRatio: contrastRatio,
    svgIcon: svgIcon,
    initialsOf: initialsOf,
    parseVideoUrl: parseVideoUrl,
    applyBackground: applyBackground
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
