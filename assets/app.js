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
    applyAccent(meta.accentColor);
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

  function renderMasthead(content) {
    var p = content.profile || {};
    var head = el('header', { class: 'masthead' });

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
    head.appendChild(avatar);

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

    head.appendChild(body);
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

  var RENDERERS = {
    timeline: renderTimeline,
    cards: renderCards,
    groups: renderGroups,
    text: renderText,
    gallery: renderGallery,
    files: renderFiles
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

    var page = el('div', { class: 'page' });
    page.appendChild(renderMasthead(content));

    var main = el('main', { id: 'main' });
    var sections = Array.isArray(content.sections) ? content.sections : [];
    sections.forEach(function (s, i) {
      if (s) main.appendChild(renderSection(s, i));
    });
    listOf(main, 'sections', 'section');
    page.appendChild(main);

    var footer = el('footer', { class: 'page-footer' });
    footer.appendChild(el('p', {}, '© ' + new Date().getFullYear() + ' ' + ((content.profile && content.profile.name) || '')));
    page.appendChild(footer);

    root.appendChild(page);

    // Let the editor re-attach its controls after every re-render.
    document.dispatchEvent(new CustomEvent('portfolio:rendered'));
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
    contrastRatio: contrastRatio
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
