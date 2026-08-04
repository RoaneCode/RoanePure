/* ==========================================================================
   editor.js — owner-only editing. Loaded ONLY when ?edit=1 is present.

   How the security works, in one paragraph: this file contains no secret.
   It asks you for a GitHub token, which is stored only in your own browser
   and sent only to api.github.com. Anyone can open ?edit=1 and see this
   interface, but without a token that GitHub accepts, every save is rejected
   by GitHub itself. The protection is GitHub's permission system — not the
   fact that the button is hidden.
   ========================================================================== */

(function () {
  'use strict';

  var P = window.Portfolio;
  if (!P) { console.error('app.js must load before editor.js'); return; }

  var el = P.el, getPath = P.getPath, setPath = P.setPath, has = P.has;

  /* --------------------------------------------------------------- config */

  var LS_TOKEN = 'portfolio.token';
  var LS_REPO  = 'portfolio.repo';
  var LS_DRAFT = 'portfolio.draft';
  var LS_MODE  = 'portfolio.viewmode';

  var CONTENT_PATH = 'content.json';
  var UPLOAD_DIR = 'uploads';

  var THEMES = [
    { id: 'classic',   name: 'Classic professional' },
    { id: 'editorial', name: 'Editorial (artistic)' },
    { id: 'minimal',   name: 'Clean & minimal' },
    { id: 'bold',      name: 'Bold & modern' },
    { id: 'dark',      name: 'Dark & technical' }
  ];

  var SECTION_TYPES = [
    { id: 'timeline', name: 'Timeline (jobs, education)' },
    { id: 'cards',    name: 'Cards (projects)' },
    { id: 'groups',   name: 'Skill groups' },
    { id: 'text',     name: 'Paragraphs of text' },
    { id: 'gallery',  name: 'Photo gallery' },
    { id: 'files',    name: 'Files to download' },
    { id: 'tools',    name: 'Tools & logos (side rail)' }
  ];

  // Uploads are restricted to formats that cannot carry executable code.
  // .html, .svg and .js are deliberately absent: served from your own domain
  // they would run with your site's privileges, which would put the saved
  // token within reach. See README.
  var ALLOWED = {
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
    pdf: 'doc', doc: 'doc', docx: 'doc', xls: 'doc', xlsx: 'doc',
    ppt: 'doc', pptx: 'doc', txt: 'doc', csv: 'doc', rtf: 'doc', odt: 'doc'
  };
  var BLOCKED_MSG = {
    svg: 'SVG files can contain code, so they are blocked. Save it as a PNG and upload that instead.',
    html: 'HTML files can contain code, so they are blocked.',
    htm: 'HTML files can contain code, so they are blocked.',
    js: 'JavaScript files are blocked.',
    xml: 'XML files can contain code, so they are blocked.'
  };

  var MAX_DOC = 20 * 1024 * 1024;   // hard stop
  var WARN_DOC = 5 * 1024 * 1024;   // just a warning

  /* ---------------------------------------------------------------- state */

  var Ed = {
    token: localStorage.getItem(LS_TOKEN) || '',
    owner: '', repo: '', branch: 'main',
    sha: null,           // sha of content.json as we last saw it
    dirty: false,
    preview: localStorage.getItem(LS_MODE) === 'preview',
    ready: false
  };

  /* -------------------------------------------------------------- helpers */

  function toBase64(str) {
    var bytes = new TextEncoder().encode(str);
    return bytesToBase64(bytes);
  }

  function bytesToBase64(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function slugify(name) {
    var dot = name.lastIndexOf('.');
    var stem = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    stem = stem.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'file';
    var suffix = Math.random().toString(36).slice(2, 6);
    return stem + '-' + suffix + (ext ? '.' + ext : '');
  }

  function extOf(name) {
    var m = String(name).match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function toast(msg, kind, ms) {
    var old = document.querySelector('.editor-toast');
    if (old) old.remove();
    var t = el('div', { class: 'editor-toast' + (kind ? ' editor-toast--' + kind : ''), role: 'status' }, msg);
    document.body.appendChild(t);
    if (ms !== 0) setTimeout(function () { if (t.parentNode) t.remove(); }, ms || 4200);
    return t;
  }

  function markDirty() {
    Ed.dirty = true;
    var dot = document.querySelector('.editor-bar__dot');
    if (dot) dot.setAttribute('data-dirty', '1');
    saveDraft();
  }

  function markClean() {
    Ed.dirty = false;
    var dot = document.querySelector('.editor-bar__dot');
    if (dot) dot.setAttribute('data-dirty', '0');
    localStorage.removeItem(LS_DRAFT);
  }

  var draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try {
        localStorage.setItem(LS_DRAFT, JSON.stringify({
          at: Date.now(),
          content: P.state.content
        }));
      } catch (e) { /* storage full — not fatal, the page still works */ }
    }, 600);
  }

  /* ------------------------------------------------------ repo detection */

  function detectRepo() {
    var saved = localStorage.getItem(LS_REPO);
    if (saved) {
      try {
        var o = JSON.parse(saved);
        if (o.owner && o.repo) {
          Ed.owner = o.owner; Ed.repo = o.repo; Ed.branch = o.branch || 'main';
          return true;
        }
      } catch (e) { /* fall through to auto-detection */ }
    }

    var host = window.location.hostname;
    var m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (m) {
      Ed.owner = m[1];
      var seg = window.location.pathname.split('/').filter(Boolean);
      // A repo named <user>.github.io is served at the root; anything else
      // is a project site served from /<repo>/.
      Ed.repo = seg.length ? seg[0] : host;
      return true;
    }
    return false;   // custom domain or localhost — we'll ask
  }

  function rememberRepo() {
    localStorage.setItem(LS_REPO, JSON.stringify({
      owner: Ed.owner, repo: Ed.repo, branch: Ed.branch
    }));
  }

  /* ----------------------------------------------------------- GitHub API */

  function api(path, options) {
    options = options || {};
    var url = 'https://api.github.com/repos/' + Ed.owner + '/' + Ed.repo + path;
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (Ed.token) headers.Authorization = 'Bearer ' + Ed.token;
    if (options.body) headers['Content-Type'] = 'application/json';

    return fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && data.message) || ('GitHub returned ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function explainApiError(err) {
    if (err.status === 401) {
      return 'GitHub rejected your access token. It may have expired or been revoked — create a new one and paste it in again.';
    }
    if (err.status === 403) {
      return 'GitHub refused the request. The most likely cause is that your token does not have "Contents: Read and write" permission on this repository.';
    }
    if (err.status === 404) {
      return 'GitHub could not find ' + Ed.owner + '/' + Ed.repo + '. Either the repository name is wrong, or your token was not given access to this specific repository.';
    }
    if (err.status === 409 || err.status === 422) {
      return 'GitHub could not apply the change — the file was modified somewhere else at the same time. Reload the page and try again.';
    }
    if (!navigator.onLine) {
      return 'You appear to be offline. Your work is saved in this browser, so reconnect and press Save again.';
    }
    return err.message || 'Something went wrong talking to GitHub.';
  }

  function getFileMeta(path) {
    return api('/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(Ed.branch));
  }

  function putFile(path, base64, message, sha) {
    var body = { message: message, content: base64, branch: Ed.branch };
    if (sha) body.sha = sha;
    return api('/contents/' + encodeURI(path), { method: 'PUT', body: body });
  }

  function deleteFile(path, sha, message) {
    return api('/contents/' + encodeURI(path), {
      method: 'DELETE',
      body: { message: message, sha: sha, branch: Ed.branch }
    });
  }

  /* --------------------------------------------------------------- panels */

  function panel(build) {
    var scrim = el('div', { class: 'editor-scrim' });
    var box = el('div', { class: 'editor-panel', role: 'dialog', 'aria-modal': 'true' });
    scrim.appendChild(box);

    function close() {
      scrim.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
    document.addEventListener('keydown', onKey);

    build(box, close);
    document.body.appendChild(scrim);

    var focusable = box.querySelector('input, select, textarea, button');
    if (focusable) focusable.focus();
    return close;
  }

  function field(box, labelText, value, opts) {
    opts = opts || {};
    var id = 'f' + Math.random().toString(36).slice(2, 8);
    box.appendChild(el('label', { for: id }, labelText));
    var input;
    if (opts.type === 'textarea') {
      input = el('textarea', { id: id, rows: '3' });
      input.value = value || '';
    } else if (opts.type === 'select') {
      input = el('select', { id: id });
      (opts.options || []).forEach(function (o) {
        var opt = el('option', { value: o.id }, o.name);
        if (o.id === value) opt.selected = true;
        input.appendChild(opt);
      });
    } else {
      input = el('input', { type: opts.type || 'text', id: id, placeholder: opts.placeholder || '' });
      input.value = value || '';
    }
    box.appendChild(input);
    return input;
  }

  function actions(box, buttons) {
    var row = el('div', { class: 'editor-panel__actions' });
    buttons.forEach(function (b) {
      var btn = el('button', { class: 'ed-btn' + (b.primary ? ' ed-btn--primary' : ''), type: 'button' }, b.label);
      btn.addEventListener('click', b.onClick);
      row.appendChild(btn);
    });
    box.appendChild(row);
    return row;
  }

  /* --------------------------------------------------------- unlock flow */

  function openUnlock() {
    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Unlock editing'));
      box.appendChild(el('p', {}, 'To save changes, this page needs a GitHub access token. It is stored only in this browser and sent only to GitHub. Nobody visiting your site can see it.'));

      box.appendChild(el('h3', {}, 'Creating a token (first time only)'));
      var ol = el('ol', {});
      [
        'On GitHub, go to Settings → Developer settings → Personal access tokens → Fine-grained tokens.',
        'Click "Generate new token". Give it a name like "portfolio editing" and an expiry date.',
        'Under Repository access choose "Only select repositories", and pick just this portfolio repository.',
        'Under Permissions → Repository permissions, set "Contents" to "Read and write". Leave everything else alone.',
        'Generate the token, copy it, and paste it below.'
      ].forEach(function (step) { ol.appendChild(el('li', {}, step)); });
      box.appendChild(ol);

      var tokenInput = field(box, 'Access token', '', { type: 'password', placeholder: 'github_pat_...' });

      box.appendChild(el('h3', {}, 'Repository'));
      var ownerInput = field(box, 'GitHub username', Ed.owner, { placeholder: 'your-username' });
      var repoInput = field(box, 'Repository name', Ed.repo, { placeholder: 'your-username.github.io' });
      var branchInput = field(box, 'Branch', Ed.branch || 'main');

      var status = el('div', {});
      box.appendChild(status);

      actions(box, [
        {
          label: 'Unlock', primary: true, onClick: function () {
            var token = tokenInput.value.trim();
            if (!token) { status.textContent = ''; status.appendChild(el('div', { class: 'editor-panel__note editor-panel__note--bad' }, 'Paste your token first.')); return; }
            Ed.token = token;
            Ed.owner = ownerInput.value.trim();
            Ed.repo = repoInput.value.trim();
            Ed.branch = branchInput.value.trim() || 'main';

            status.textContent = '';
            status.appendChild(el('div', { class: 'editor-panel__note' }, 'Checking with GitHub…'));

            getFileMeta(CONTENT_PATH).then(function (meta) {
              Ed.sha = meta.sha;
              Ed.ready = true;
              localStorage.setItem(LS_TOKEN, token);
              rememberRepo();
              close();
              buildBar();
              toast('Unlocked. You can edit and save now.', 'ok');
            }).catch(function (err) {
              Ed.token = '';
              status.textContent = '';
              status.appendChild(el('div', { class: 'editor-panel__note editor-panel__note--bad' }, explainApiError(err)));
            });
          }
        },
        { label: 'Cancel', onClick: close }
      ]);

      box.appendChild(el('p', { style: 'font-size:.8rem;margin-top:.75rem' },
        'On a computer that is not yours, use "Sign out" in the toolbar when you finish — it wipes the token from this browser.'));
    });
  }

  function signOut() {
    if (Ed.dirty && !window.confirm('You have unsaved changes. Sign out anyway and lose them?')) return;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_DRAFT);
    // Also forget the remembered repository. If it was renamed, the stale
    // name would otherwise stick around and every save would fail with a
    // confusing "not found".
    localStorage.removeItem(LS_REPO);
    Ed.token = '';
    Ed.ready = false;
    location.reload();
  }

  /* ------------------------------------------------------------- toolbar */

  function buildBar() {
    var existing = document.querySelector('.editor-bar');
    if (existing) existing.remove();
    var existingSave = document.querySelector('.editor-savebar');
    if (existingSave) existingSave.remove();

    var bar = el('div', { class: 'editor-bar' });

    var brand = el('div', { class: 'editor-bar__brand' });
    brand.appendChild(el('span', { class: 'editor-bar__dot', 'data-dirty': Ed.dirty ? '1' : '0' }));
    brand.appendChild(el('span', {}, 'Editing'));
    bar.appendChild(brand);

    // Theme picker
    var themeSel = el('select', { class: 'ed-select', 'aria-label': 'Page design' });
    THEMES.forEach(function (t) {
      var o = el('option', { value: t.id }, t.name);
      if ((P.state.content.meta && P.state.content.meta.theme) === t.id) o.selected = true;
      themeSel.appendChild(o);
    });
    themeSel.addEventListener('change', function () {
      if (!P.state.content.meta) P.state.content.meta = {};
      P.state.content.meta.theme = themeSel.value;
      P.applyMeta(P.state.content);
      warnIfUnreadable(P.state.content.meta.accentColor);
      markDirty();
    });
    bar.appendChild(themeSel);

    // Accent colour
    var colour = el('input', {
      type: 'color', class: 'ed-color', 'aria-label': 'Accent colour',
      value: (P.state.content.meta && P.state.content.meta.accentColor) || '#1f4d6b'
    });
    colour.addEventListener('input', function () {
      if (!P.state.content.meta) P.state.content.meta = {};
      P.state.content.meta.accentColor = colour.value;
      P.applyAccent(colour.value);
      markDirty();
    });
    colour.addEventListener('change', function () {
      warnIfUnreadable(colour.value);
      markDirty();
    });
    bar.appendChild(colour);

    bar.appendChild(button('Site details', openSiteDetails));
    bar.appendChild(button('Add section', function () { addSection(); }));
    bar.appendChild(button('Print / PDF', function () { window.print(); }));
    bar.appendChild(button('View as visitor', function () { setPreview(true); }));

    bar.appendChild(el('div', { class: 'editor-bar__spacer' }));

    if (Ed.ready) {
      var save = button('Save & Publish', doSave, 'primary');
      save.className += ' editor-bar__save';
      bar.appendChild(save);
      bar.appendChild(button('Discard', discardChanges));
      bar.appendChild(button('Sign out', signOut));
    } else {
      bar.appendChild(button('Unlock to save', openUnlock, 'primary'));
    }

    // First child, not appended: on narrow screens the bar is position:static
    // so that it can wrap onto several rows, and it must sit above the page.
    document.body.insertBefore(bar, document.body.firstChild);

    // Mobile: the primary action lives in a thumb-reachable bottom bar.
    if (Ed.ready) {
      var savebar = el('div', { class: 'editor-savebar' });
      savebar.appendChild(button('Save & Publish', doSave, 'primary'));
      savebar.appendChild(button('Preview', function () { setPreview(true); }));
      document.body.appendChild(savebar);
    }
  }

  // Tell the owner when their accent colour is being ignored, rather than
  // letting them wonder why the page didn't change.
  function warnIfUnreadable(colour) {
    if (!colour) return;
    var result = P.applyAccent(colour);
    if (result && result.reason === 'contrast') {
      toast('That accent colour is too low-contrast to read on this design, so the design’s own colour is being used instead. Pick a lighter or darker shade.', 'bad', 8000);
    }
  }

  function button(label, onClick, variant) {
    var b = el('button', { class: 'ed-btn' + (variant ? ' ed-btn--' + variant : ''), type: 'button' }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  /* -------------------------------------------------------- visitor view */

  function setPreview(on) {
    Ed.preview = on;
    localStorage.setItem(LS_MODE, on ? 'preview' : 'edit');
    P.state.editing = !on;
    applyMode();
    P.render();
  }

  function applyMode() {
    document.body.classList.toggle('ed-on', !Ed.preview);
    document.body.classList.toggle('ed-preview', Ed.preview);

    var banner = document.querySelector('.editor-banner');
    if (Ed.preview) {
      if (!banner) {
        banner = el('div', { class: 'editor-banner' });
        banner.appendChild(el('span', {}, 'Viewing as a visitor — your edits are not published yet'));
        banner.appendChild(button('Back to editing', function () { setPreview(false); }));
        var live = el('a', { class: 'ed-btn', href: window.location.pathname, target: '_blank', rel: 'noopener' }, 'See the live site');
        banner.appendChild(live);
        document.body.appendChild(banner);
      }
    } else if (banner) {
      banner.remove();
    }
  }

  /* ------------------------------------------------------ inline editing */

  function attachEditing() {
    if (Ed.preview) return;
    var app = document.getElementById('app');
    if (!app) return;

    app.querySelectorAll('[data-path]').forEach(function (node) {
      node.setAttribute('contenteditable', 'true');
      node.setAttribute('spellcheck', 'true');
      refreshEmpty(node);
    });

    buildAvatarControls(app);
    buildListControls(app);
  }

  // The profile photo isn't part of a list, so it gets its own controls.
  function buildAvatarControls(app) {
    var avatar = app.querySelector('[data-avatar]');
    if (!avatar) return;

    var row = el('div', { class: 'ed-controls' });

    var change = el('button', { class: 'ed-chip', type: 'button' }, '📷 ' + (P.state.content.profile.photo ? 'Change photo' : 'Add photo'));
    change.addEventListener('click', function () { pickImageFor('profile'); });
    row.appendChild(change);

    if (P.state.content.profile.photo) {
      var remove = el('button', { class: 'ed-chip ed-chip--danger', type: 'button' }, 'Remove photo');
      remove.addEventListener('click', function () {
        if (!window.confirm('Remove your profile photo? Your initials will be shown instead.')) return;
        P.state.content.profile.photo = '';
        markDirty();
        P.render();
      });
      row.appendChild(remove);
    }

    // Wrap the photo and its buttons together, so on a wide screen the
    // buttons sit under the photo instead of becoming a third column
    // squeezed between the photo and the name.
    var holder = el('div', { class: 'ed-avatar-holder' });
    avatar.parentNode.insertBefore(holder, avatar);
    holder.appendChild(avatar);
    holder.appendChild(row);
  }

  function refreshEmpty(node) {
    node.setAttribute('data-empty', node.textContent.trim() === '' ? '1' : '0');
  }

  function wireDelegates() {
    var app = document.getElementById('app');

    app.addEventListener('input', function (e) {
      var node = e.target.closest && e.target.closest('[data-path]');
      if (!node || Ed.preview) return;
      var path = node.getAttribute('data-path');
      var value = node.textContent;
      setPath(P.state.content, path, value);
      refreshEmpty(node);

      // Keep mailto:/tel: hrefs in step with the text being typed.
      var prefix = node.getAttribute('data-href-prefix');
      if (prefix && node.tagName === 'A') {
        node.setAttribute('href', prefix + (prefix === 'tel:' ? value.replace(/[^\d+]/g, '') : value.trim()));
      }
      markDirty();
    });

    // Force plain text on paste — stops Word/Docs formatting coming along.
    app.addEventListener('paste', function (e) {
      var node = e.target.closest && e.target.closest('[data-path]');
      if (!node || Ed.preview) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      text = text.replace(/\s*\n+\s*/g, ' ').trim();
      insertPlainText(text);
    });

    // Enter would create stray markup. Fields are single-paragraph by design;
    // to add another paragraph or bullet, use the + button.
    app.addEventListener('keydown', function (e) {
      var node = e.target.closest && e.target.closest('[data-path]');
      if (!node || Ed.preview) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        node.blur();
      }
    });

    // Don't follow links while editing their text.
    app.addEventListener('click', function (e) {
      if (Ed.preview) return;
      var a = e.target.closest && e.target.closest('a');
      if (a && a.hasAttribute('data-path')) e.preventDefault();
    });

    // Keep the field above the on-screen keyboard on phones.
    app.addEventListener('focusin', function (e) {
      var node = e.target.closest && e.target.closest('[data-path]');
      if (!node || Ed.preview) return;
      if (window.matchMedia('(max-width: 47.99em)').matches) {
        setTimeout(function () {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 250);
      }
    });
  }

  function insertPlainText(text) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var tn = document.createTextNode(text);
    range.insertNode(tn);
    range.setStartAfter(tn);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    // Fire input so the model updates through the normal path.
    var node = tn.parentElement && tn.parentElement.closest('[data-path]');
    if (node) node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ------------------------------------------------- add / delete / move */

  var INLINE_KINDS = { tag: 1, skill: 1, link: 1 };
  var UPLOAD_KINDS = { photo: 1, file: 1, attachment: 1 };

  var ADD_LABEL = {
    section: 'Add section', timeline: 'Add entry', card: 'Add project',
    group: 'Add skill group', bullet: 'Add bullet point', tag: 'Add tag',
    skill: 'Add skill', paragraph: 'Add paragraph', link: 'Add link',
    photo: 'Add photo', file: 'Add file', attachment: 'Attach a file',
    tool: 'Add tool'
  };

  function blankItem(kind) {
    switch (kind) {
      case 'timeline': return { role: 'New role', org: '', location: '', start: '', end: '', bullets: [''], attachments: [] };
      case 'card': return { name: 'New project', description: '', tags: [], url: '', image: '', imageAlt: '', attachments: [] };
      case 'group': return { group: 'New group', skills: [''] };
      case 'link': return { label: 'New link', url: '' };
      case 'bullet': case 'tag': case 'skill': case 'paragraph': return '';
      default: return {};
    }
  }

  function buildListControls(app) {
    app.querySelectorAll('[data-list]').forEach(function (listEl) {
      var listPath = listEl.getAttribute('data-list');
      var kind = listEl.getAttribute('data-list-kind');
      var pattern = new RegExp('^' + listPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\d+$');

      var items = Array.prototype.filter.call(
        listEl.querySelectorAll('[data-item]'),
        function (n) { return pattern.test(n.getAttribute('data-item')); }
      );

      items.forEach(function (node, index) {
        if (INLINE_KINDS[kind]) {
          // Tags, skills and links are inline elements — putting a block of
          // controls inside them would wreck the line. They sit alongside.
          node.parentNode.insertBefore(inlineControls(listPath, kind, index), node.nextSibling);
        } else {
          node.appendChild(itemControls(listPath, kind, index, items.length));
        }
      });

      // Sections are added from the toolbar. The list container for sections
      // is .page itself, so an inline button here would land outside the
      // page rather than at the end of the content.
      if (kind === 'section') return;

      var addBtn = el('button', { class: INLINE_KINDS[kind] ? 'ed-chip' : 'ed-add', type: 'button' },
        '+ ' + (ADD_LABEL[kind] || 'Add item'));
      addBtn.addEventListener('click', function () { addItem(listPath, kind); });

      if (INLINE_KINDS[kind]) {
        listEl.appendChild(addBtn);
      } else {
        listEl.parentNode.insertBefore(addBtn, listEl.nextSibling);
      }
    });
  }

  function inlineControls(listPath, kind, index) {
    var wrap = el('span', { class: 'ed-inline-controls' });

    if (kind === 'link') {
      var cog = el('button', { class: 'ed-chip', type: 'button', title: 'Edit link', 'aria-label': 'Edit link details' }, '⚙');
      cog.addEventListener('click', function () { openDetails(listPath + '.' + index, kind); });
      wrap.appendChild(cog);
    }

    var del = el('button', {
      class: 'ed-chip ed-chip--danger', type: 'button',
      title: 'Delete', 'aria-label': 'Delete this ' + kind
    }, '✕');
    del.addEventListener('click', function () { deleteItem(listPath, kind, index); });
    wrap.appendChild(del);

    return wrap;
  }

  function itemControls(listPath, kind, index, total) {
    var wrap = el('div', { class: 'ed-controls' });

    if (!INLINE_KINDS[kind]) {
      var up = el('button', { class: 'ed-chip', type: 'button', title: 'Move up', 'aria-label': 'Move up' }, '↑');
      up.disabled = index === 0;
      up.addEventListener('click', function () { moveItem(listPath, index, -1); });
      wrap.appendChild(up);

      var down = el('button', { class: 'ed-chip', type: 'button', title: 'Move down', 'aria-label': 'Move down' }, '↓');
      down.disabled = index === total - 1;
      down.addEventListener('click', function () { moveItem(listPath, index, 1); });
      wrap.appendChild(down);
    }

    if (kind === 'card' || kind === 'section' || kind === 'link' || kind === 'photo' || kind === 'file' || kind === 'attachment' || kind === 'timeline' || kind === 'tool') {
      var cog = el('button', { class: 'ed-chip', type: 'button' }, '⚙ Details');
      cog.addEventListener('click', function () { openDetails(listPath + '.' + index, kind); });
      wrap.appendChild(cog);
    }

    if (kind === 'card') {
      var img = el('button', { class: 'ed-chip', type: 'button' }, '🖼 Cover image');
      img.addEventListener('click', function () { pickImageFor(listPath + '.' + index); });
      wrap.appendChild(img);
    }

    if (kind === 'timeline' || kind === 'card') {
      var attach = el('button', { class: 'ed-chip', type: 'button' }, '📎 Attach file');
      attach.addEventListener('click', function () { addItem(listPath + '.' + index + '.attachments', 'attachment'); });
      wrap.appendChild(attach);
    }

    var del = el('button', { class: 'ed-chip ed-chip--danger', type: 'button' }, '🗑 Delete');
    del.addEventListener('click', function () { deleteItem(listPath, kind, index); });
    wrap.appendChild(del);

    return wrap;
  }

  function listAt(path) {
    var list = getPath(P.state.content, path);
    if (!Array.isArray(list)) {
      setPath(P.state.content, path, []);
      list = getPath(P.state.content, path);
    }
    return list;
  }

  /* ---------------------------------------------------------- tool picker */

  // Pick a logo from the built-in set, or upload your own. Content only ever
  // stores the slug — never the artwork — so the drawing always comes from
  // vetted local code.
  function openToolPicker(listPath) {
    var icons = window.ToolIcons || {};
    var slugs = Object.keys(icons);

    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Add a tool'));
      box.appendChild(el('p', {}, 'Pick a logo, or upload your own image for anything not listed.'));

      var search = field(box, 'Search', '', { placeholder: 'e.g. slack' });

      var grid = el('div', { class: 'ed-toolgrid' });
      box.appendChild(grid);

      function paint(filter) {
        grid.textContent = '';
        var q = filter.trim().toLowerCase();
        var shown = slugs.filter(function (s) {
          return !q || icons[s].title.toLowerCase().indexOf(q) > -1 || s.indexOf(q) > -1;
        });
        if (!shown.length) {
          grid.appendChild(el('p', {}, 'No logo matches that. Use "Upload my own logo" below.'));
          return;
        }
        shown.forEach(function (slug) {
          var ic = icons[slug];
          var b = el('button', { class: 'ed-toolopt', type: 'button', title: ic.title });
          var art = el('span', { class: 'ed-toolopt__art' });
          art.style.color = ic.hex;
          art.appendChild(P.svgIcon(ic, ic.title));
          b.appendChild(art);
          b.appendChild(el('span', { class: 'ed-toolopt__name' }, ic.title));
          b.addEventListener('click', function () {
            listAt(listPath).push({ name: ic.title, icon: slug, logo: '', color: '', url: '' });
            markDirty();
            close();
            P.render();
          });
          grid.appendChild(b);
        });
      }

      search.addEventListener('input', function () { paint(search.value); });
      paint('');

      actions(box, [
        {
          label: 'Upload my own logo', onClick: function () {
            close();
            uploadToolLogo(listPath);
          }
        },
        {
          label: 'Add without a logo', onClick: function () {
            listAt(listPath).push({ name: 'New tool', icon: '', logo: '', color: '', url: '' });
            markDirty();
            close();
            P.render();
          }
        },
        { label: 'Cancel', onClick: close }
      ]);
    });
  }

  function uploadToolLogo(listPath, itemIndex) {
    if (!Ed.ready) { toast('Unlock editing first — uploads are saved straight to GitHub.', 'bad'); openUnlock(); return; }
    fileInput('image/png,image/jpeg,image/webp,image/gif', false, function (files) {
      runUploads(files, 256, function (results) {
        if (!results.length) return;
        var list = listAt(listPath);
        if (itemIndex === undefined) {
          list.push({ name: results[0].original || 'New tool', icon: '', logo: results[0].path, color: '', url: '' });
        } else {
          list[itemIndex].logo = results[0].path;
        }
        markDirty();
        P.render();
      });
    });
  }

  function addItem(listPath, kind) {
    if (kind === 'tool') { openToolPicker(listPath); return; }
    if (UPLOAD_KINDS[kind]) { openUpload(listPath, kind); return; }
    listAt(listPath).push(blankItem(kind));
    markDirty();
    P.render();
  }

  function deleteItem(listPath, kind, index) {
    var list = listAt(listPath);
    var item = list[index];

    var name = '';
    if (item && typeof item === 'object') name = item.name || item.role || item.title || item.group || item.label || '';
    else if (typeof item === 'string') name = item.slice(0, 60);

    var what = name ? '“' + name + '”' : 'this item';
    if (!window.confirm('Delete ' + what + '? This cannot be undone from here (though GitHub keeps every previous version of your content).')) return;

    // Offer to remove the underlying file from the repository too.
    var filePath = item && (item.path || item.image);
    list.splice(index, 1);
    markDirty();
    P.render();

    if (filePath && Ed.ready && filePath.indexOf(UPLOAD_DIR + '/') === 0) {
      if (window.confirm('Also delete the uploaded file "' + filePath + '" from your repository? Choose Cancel to keep the file but remove it from the page.')) {
        getFileMeta(filePath).then(function (meta) {
          return deleteFile(filePath, meta.sha, 'Delete unused upload ' + filePath);
        }).then(function () {
          toast('File deleted from the repository.', 'ok');
        }).catch(function (err) {
          toast('Could not delete the file: ' + explainApiError(err), 'bad', 7000);
        });
      }
    }
  }

  function moveItem(listPath, index, delta) {
    var list = listAt(listPath);
    var target = index + delta;
    if (target < 0 || target >= list.length) return;
    var tmp = list[index];
    list[index] = list[target];
    list[target] = tmp;
    markDirty();
    P.render();
  }

  function addSection() {
    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Add a section'));
      var title = field(box, 'Section heading', '', { placeholder: 'e.g. Volunteering' });
      var type = field(box, 'What goes in it?', 'timeline', { type: 'select', options: SECTION_TYPES });
      actions(box, [
        {
          label: 'Add section', primary: true, onClick: function () {
            var t = title.value.trim() || 'New section';
            var kind = type.value;
            var section = {
              id: t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('section-' + Date.now()),
              title: t,
              type: kind,
              items: []
            };
            // Start with one empty item so the section isn't a blank box.
            var seedKind = { timeline: 'timeline', cards: 'card', groups: 'group', text: 'paragraph' }[kind];
            if (seedKind) section.items.push(blankItem(seedKind));
            listAt('sections').push(section);
            markDirty();
            close();
            P.render();
          }
        },
        { label: 'Cancel', onClick: close }
      ]);
    });
  }

  /* ------------------------------------------------------- details panel */

  var DETAIL_FIELDS = {
    section: [
      { key: 'title', label: 'Section heading' },
      { key: 'type', label: 'Section type', type: 'select', options: SECTION_TYPES },
      { key: 'id', label: 'Anchor id (used in links)' }
    ],
    timeline: [
      { key: 'role', label: 'Job title' },
      { key: 'org', label: 'Company or school' },
      { key: 'location', label: 'Location' },
      { key: 'start', label: 'From' },
      { key: 'end', label: 'To' }
    ],
    card: [
      { key: 'name', label: 'Project name' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'url', label: 'Link (optional)', placeholder: 'https://…' },
      { key: 'imageAlt', label: 'Cover image description (for screen readers)' }
    ],
    link: [
      { key: 'label', label: 'Link text' },
      { key: 'url', label: 'Address', placeholder: 'https://…' }
    ],
    photo: [
      { key: 'caption', label: 'Caption' },
      { key: 'imageAlt', label: 'Photo description (for screen readers)' }
    ],
    file: [
      { key: 'label', label: 'File name shown on the page' },
      { key: 'description', label: 'Short description' }
    ],
    attachment: [
      { key: 'label', label: 'File name shown on the page' },
      { key: 'description', label: 'Short description' }
    ],
    tool: [
      { key: 'name', label: 'Tool name' },
      { key: 'icon', label: 'Logo', type: 'select', options: [] },   // filled below
      { key: 'url', label: 'Link (optional)', placeholder: 'https://…' },
      { key: 'color', label: 'Hover colour (optional)', placeholder: '#FF4F00' }
    ]
  };

  // The logo dropdown is built from whatever icons.js actually ships.
  function toolIconOptions() {
    var icons = window.ToolIcons || {};
    var list = [{ id: '', name: '— letters only —' }];
    Object.keys(icons)
      .sort(function (a, b) { return icons[a].title.localeCompare(icons[b].title); })
      .forEach(function (s) { list.push({ id: s, name: icons[s].title }); });
    return list;
  }

  // Page-wide settings that aren't visible anywhere on the page itself:
  // the browser tab title and the blurb search engines and chat apps show.
  function openSiteDetails() {
    if (!P.state.content.meta) P.state.content.meta = {};
    var meta = P.state.content.meta;
    var profile = P.state.content.profile || {};
    var autoTitle = (profile.name || 'Portfolio') + (profile.headline ? ' — ' + profile.headline : '');

    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Site details'));
      box.appendChild(el('p', {}, 'These don’t appear on the page. They control what people see in the browser tab, in search results, and when your link is shared.'));

      var title = field(box, 'Browser tab title', meta.siteTitle, { placeholder: autoTitle });
      box.appendChild(el('p', { style: 'margin-top:-.5rem;font-size:.82rem' },
        'Leave empty to use your name and job title automatically: “' + autoTitle + '”'));

      var desc = field(box, 'Short description', meta.description, {
        type: 'textarea',
        placeholder: 'One or two sentences about you'
      });
      box.appendChild(el('p', { style: 'margin-top:-.5rem;font-size:.82rem' },
        'Shown under your link in Google, and in the preview card when you paste the link into LinkedIn, WhatsApp or Slack. Around 150 characters works best.'));

      actions(box, [
        {
          label: 'Save', primary: true, onClick: function () {
            meta.siteTitle = title.value.trim();
            meta.description = desc.value.trim();
            P.applyMeta(P.state.content);
            markDirty();
            close();
            toast('Updated. Press Save & Publish to make it live.');
          }
        },
        { label: 'Cancel', onClick: close }
      ]);
    });
  }

  function openDetails(itemPath, kind) {
    var fields = DETAIL_FIELDS[kind];
    if (!fields) return;
    var item = getPath(P.state.content, itemPath) || {};

    if (kind === 'tool') {
      fields = fields.map(function (f) {
        return f.key === 'icon' ? { key: 'icon', label: 'Logo', type: 'select', options: toolIconOptions() } : f;
      });
    }

    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Details'));
      var inputs = {};
      fields.forEach(function (f) {
        inputs[f.key] = field(box, f.label, item[f.key], f);
      });

      var buttons = [
        {
          label: 'Save', primary: true, onClick: function () {
            fields.forEach(function (f) {
              var v = inputs[f.key].value;
              if (f.key === 'url' && v && !P.safeUrl(v)) {
                v = 'https://' + v.replace(/^\/+/, '');
              }
              item[f.key] = v;
            });
            markDirty();
            close();
            P.render();
          }
        },
        { label: 'Cancel', onClick: close }
      ];

      if (kind === 'card' && item.image) {
        buttons.splice(1, 0, {
          label: 'Remove cover image', onClick: function () {
            item.image = ''; item.imageAlt = '';
            markDirty(); close(); P.render();
          }
        });
      }

      if (kind === 'tool') {
        var listPath = itemPath.replace(/\.(\d+)$/, '');
        var idx = parseInt(itemPath.match(/\.(\d+)$/)[1], 10);
        buttons.splice(1, 0, {
          label: item.logo ? 'Replace uploaded logo' : 'Upload a logo image',
          onClick: function () { close(); uploadToolLogo(listPath, idx); }
        });
        if (item.logo) {
          buttons.splice(2, 0, {
            label: 'Remove uploaded logo', onClick: function () {
              item.logo = '';
              markDirty(); close(); P.render();
            }
          });
        }
      }

      actions(box, buttons);
    });
  }

  /* -------------------------------------------------------------- uploads */

  function fileInput(accept, multiple, onPick) {
    var input = el('input', { type: 'file', accept: accept, style: 'display:none' });
    if (multiple) input.multiple = true;
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.remove();
      if (files.length) onPick(files);
    });
    input.click();
  }

  function validate(file) {
    var ext = extOf(file.name);
    if (BLOCKED_MSG[ext]) return BLOCKED_MSG[ext];
    if (!ALLOWED[ext]) {
      return '“' + file.name + '” is a .' + (ext || '?') + ' file, which is not one of the allowed types (images, PDF, Office documents, text).';
    }
    if (ALLOWED[ext] === 'doc' && file.size > MAX_DOC) {
      return '“' + file.name + '” is ' + P.formatBytes(file.size) + '. The limit is 20 MB — consider linking to it instead.';
    }
    return null;
  }

  // Resize + re-encode. This also strips EXIF metadata (including GPS
  // location) as a side effect, because the canvas only copies pixels.
  function processImage(file, maxEdge) {
    return loadBitmap(file).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);

      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0, cw, ch);
      if (bmp.close) bmp.close();

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          resolve({ blob: blob, ext: 'jpg' });
        }, 'image/jpeg', 0.82);
      });
    });
  }

  function loadBitmap(file) {
    // imageOrientation:'from-image' applies the EXIF rotation, so portrait
    // photos from a phone don't end up on their side.
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return loadViaImg(file);
      });
    }
    return loadViaImg(file);
  }

  function loadViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  }

  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      return bytesToBase64(new Uint8Array(buf));
    });
  }

  // Upload one file, returning { path, size }.
  function uploadOne(file, maxEdge) {
    var ext = extOf(file.name);
    var isImage = ALLOWED[ext] === 'image';
    var prep = isImage
      ? processImage(file, maxEdge || 1600).then(function (r) {
          return { blob: r.blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
        })
      : Promise.resolve({ blob: file, name: file.name });

    return prep.then(function (r) {
      var target = UPLOAD_DIR + '/' + slugify(r.name);
      return blobToBase64(r.blob).then(function (b64) {
        return putFile(target, b64, 'Upload ' + target).then(function () {
          return { path: target, size: r.blob.size };
        });
      });
    });
  }

  function openUpload(listPath, kind) {
    if (!Ed.ready) { toast('Unlock editing first — uploads are saved straight to GitHub.', 'bad'); openUnlock(); return; }

    var accept = kind === 'photo'
      ? 'image/jpeg,image/png,image/gif,image/webp'
      : 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt';

    fileInput(accept, true, function (files) {
      runUploads(files, kind === 'photo' ? 1600 : 1600, function (results) {
        var list = listAt(listPath);
        results.forEach(function (r) {
          if (kind === 'photo') {
            list.push({ image: r.path, caption: '', imageAlt: '' });
          } else {
            list.push({ path: r.path, label: r.original, size: r.size, description: '' });
          }
        });
        markDirty();
        P.render();
      });
    });
  }

  function pickImageFor(itemPath) {
    if (!Ed.ready) { toast('Unlock editing first — uploads are saved straight to GitHub.', 'bad'); openUnlock(); return; }
    fileInput('image/jpeg,image/png,image/gif,image/webp', false, function (files) {
      runUploads(files, 1600, function (results) {
        if (!results.length) return;
        var item = getPath(P.state.content, itemPath);
        if (itemPath === 'profile') {
          P.state.content.profile.photo = results[0].path;
        } else {
          item.image = results[0].path;
        }
        markDirty();
        P.render();
      });
    });
  }

  function runUploads(files, maxEdge, done) {
    var results = [];
    var rejected = [];

    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Uploading'));
      var bar = el('div', { class: 'ed-progress' });
      var fill = el('div', { class: 'ed-progress__fill' });
      bar.appendChild(fill);
      box.appendChild(bar);

      var list = el('div', { class: 'ed-filelist' });
      box.appendChild(list);

      var rows = files.map(function (f) {
        var row = el('div', { class: 'ed-filelist__row' });
        row.appendChild(el('span', { class: 'ed-filelist__name' }, f.name));
        var status = el('span', { class: 'ed-filelist__status' }, 'waiting');
        row.appendChild(status);
        list.appendChild(row);
        return status;
      });

      var closeBtn = el('div', {});
      box.appendChild(closeBtn);

      var i = 0;
      function next() {
        if (i >= files.length) {
          fill.style.width = '100%';
          if (rejected.length) {
            var note = el('div', { class: 'editor-panel__note editor-panel__note--bad' });
            rejected.forEach(function (msg) { note.appendChild(el('div', {}, msg)); });
            closeBtn.appendChild(note);
          }
          actions(closeBtn, [{
            label: results.length ? 'Done' : 'Close', primary: true, onClick: function () {
              close();
              if (results.length) done(results);
            }
          }]);
          return;
        }

        var file = files[i];
        var status = rows[i];
        var problem = validate(file);

        if (problem) {
          status.textContent = 'blocked';
          status.className = 'ed-filelist__status ed-filelist__status--bad';
          rejected.push(problem);
          i++; fill.style.width = (i / files.length * 100) + '%';
          next();
          return;
        }

        if (ALLOWED[extOf(file.name)] === 'doc' && file.size > WARN_DOC) {
          toast('“' + file.name + '” is ' + P.formatBytes(file.size) + ' — large files make your page slow to open on mobile data.', null, 6000);
        }

        status.textContent = 'uploading…';
        uploadOne(file, maxEdge).then(function (r) {
          r.original = file.name.replace(/\.[^.]+$/, '');
          results.push(r);
          status.textContent = P.formatBytes(r.size);
          status.className = 'ed-filelist__status ed-filelist__status--ok';
        }).catch(function (err) {
          status.textContent = 'failed';
          status.className = 'ed-filelist__status ed-filelist__status--bad';
          rejected.push(file.name + ': ' + explainApiError(err));
        }).then(function () {
          i++; fill.style.width = (i / files.length * 100) + '%';
          next();
        });
      }
      next();
    });
  }

  /* ----------------------------------------------------------------- save */

  function doSave() {
    if (!Ed.ready) { openUnlock(); return; }
    if (!Ed.dirty) { toast('Nothing to save — no changes yet.'); return; }

    var busy = toast('Saving…', null, 0);

    var json = JSON.stringify(P.state.content, null, 2) + '\n';

    getFileMeta(CONTENT_PATH).then(function (meta) {
      if (Ed.sha && meta.sha !== Ed.sha) {
        if (!window.confirm(
          'Your content file was changed somewhere else since you opened this page — perhaps on github.com, or in another tab.\n\n' +
          'Press OK to overwrite it with what you see here, or Cancel to stop and reload the page first.'
        )) {
          busy.remove();
          throw new Error('__cancelled__');
        }
      }
      return putFile(CONTENT_PATH, toBase64(json), 'Update portfolio content', meta.sha);
    }).then(function (res) {
      Ed.sha = res.content.sha;
      markClean();
      busy.remove();
      toast('Saved. Your public site will show the change in about a minute.', 'ok', 6000);
    }).catch(function (err) {
      busy.remove();
      if (err.message === '__cancelled__') return;
      toast('Not saved. ' + explainApiError(err), 'bad', 9000);
    });
  }

  function discardChanges() {
    if (!window.confirm('Throw away every change since your last save and reload the published version?')) return;
    localStorage.removeItem(LS_DRAFT);
    Ed.dirty = false;
    location.reload();
  }

  /* ------------------------------------------------------ draft recovery */

  function offerDraft() {
    var raw = localStorage.getItem(LS_DRAFT);
    if (!raw) return;
    var draft;
    try { draft = JSON.parse(raw); } catch (e) { localStorage.removeItem(LS_DRAFT); return; }
    if (!draft || !draft.content) return;

    if (JSON.stringify(draft.content) === JSON.stringify(P.state.content)) {
      localStorage.removeItem(LS_DRAFT);
      return;
    }

    var when = new Date(draft.at);
    panel(function (box, close) {
      box.appendChild(el('h2', {}, 'Unsaved changes found'));
      box.appendChild(el('p', {}, 'This browser has edits from ' + when.toLocaleString() + ' that were never published. Would you like to carry on with them?'));
      actions(box, [
        {
          label: 'Restore my edits', primary: true, onClick: function () {
            P.state.content = draft.content;
            markDirty();
            close();
            P.render();
            buildBar();
          }
        },
        {
          label: 'Discard them', onClick: function () {
            localStorage.removeItem(LS_DRAFT);
            close();
          }
        }
      ]);
    });
  }

  /* ------------------------------------------------------------- bootstrap */

  function init() {
    detectRepo();
    P.state.editing = !Ed.preview;

    applyMode();
    wireDelegates();

    // Re-attach controls after every re-render.
    document.addEventListener('portfolio:rendered', attachEditing);

    // If a token is already stored, confirm it still works before promising
    // the owner they can save.
    if (Ed.token && Ed.owner && Ed.repo) {
      getFileMeta(CONTENT_PATH).then(function (meta) {
        Ed.sha = meta.sha;
        Ed.ready = true;
        buildBar();
      }).catch(function (err) {
        Ed.ready = false;
        buildBar();
        toast(explainApiError(err), 'bad', 9000);
      });
    }

    buildBar();
    P.render();          // re-render so editing affordances appear
    offerDraft();

    window.addEventListener('beforeunload', function (e) {
      if (!Ed.dirty) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
  }

  init();
})();
