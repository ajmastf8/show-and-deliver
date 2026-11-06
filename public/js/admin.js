/* ==========================================================================
   Show & Deliver — Admin
   State-driven, one render function per region. Vanilla JS, no build step.
   Backend /api/* is unchanged; the proven upload/thumbnail/content/comments
   engines are ported from the previous admin and re-pointed at new DOM.
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  // ---------- State ----------
  const state = {
    galleries: [],
    collections: [],
    screen: 'library',                 // library | upload | settings
    view: 'list',                      // list | grid
    groupBy: 'collection',             // collection | none
    sort: { key: 'name', dir: 'asc' }, // key: name|items|views|access|expires
    filter: { type: 'all', hasPassword: false, expiringDays: 0 },
    search: '',
    rail: 'all',                       // all | portfolio | client | ungrouped | archive | <collectionId>
    collapsed: new Set(),              // collapsed collection ids
    selection: new Set(),              // selected gallery ids
    drawer: { galleryId: null, tab: 'settings', draft: null, dirty: false },
    centreGalleryId: null,             // when set, the centre pane shows this gallery's content
    upload: { destination: { collectionId: '', galleryId: '' }, queue: [] },
    _rowOrder: [],                     // flattened gallery ids in display order (for shift-select)
    _lastClicked: null,
  };

  // ---------- localStorage persistence ----------
  const LS = 'admin2:prefs';
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(LS) || '{}');
      if (p.view) state.view = p.view;
      if (p.groupBy) state.groupBy = p.groupBy;
      if (p.sort) state.sort = p.sort;
      if (Array.isArray(p.collapsed)) state.collapsed = new Set(p.collapsed);
      if (p.destination) state.upload.destination = p.destination;
    } catch (_) {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(LS, JSON.stringify({
        view: state.view, groupBy: state.groupBy, sort: state.sort,
        collapsed: [...state.collapsed], destination: state.upload.destination,
      }));
    } catch (_) {}
  }

  // ---------- Theme ----------
  const THEME_KEY = 'admin2:theme';
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    const btn = $('account-theme');
    if (btn) btn.textContent = theme === 'light' ? 'Dark theme' : 'Light theme';
  }
  function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
  function toggleTheme() {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    applyTheme(next);
  }

  // ---------- Helpers ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    // Quotes too: the result is also used inside value="…" / alt="…" attributes.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function shortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n >= 1024 * 1024 * 1024) return (n / (1024 ** 3)).toFixed(1) + ' GB';
    if (n >= 1024 * 1024) return (n / (1024 ** 2)).toFixed(0) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function titleCase(s) {
    return String(s || '');
  }
  const TICK = '<svg viewBox="0 0 10 10"><path d="M1 5l2.5 3L9 1.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function parentCollection(g) {
    return g.collectionId ? state.collections.find(c => c.id === g.collectionId) : null;
  }
  function isInherited(g) {
    return g.type === 'proofing' && g.collectionId && !g.overrideCollectionSettings;
  }
  function effective(g) {
    if (isInherited(g)) {
      const c = parentCollection(g) || {};
      return {
        hasPassword: !!c.hasPassword,
        downloadsEnabled: !!c.downloadsEnabled,
        commentingEnabled: !!c.commentingEnabled,
        expiresAt: c.expiresAt || null,
        active: c.active !== false && g.active !== false,
      };
    }
    return {
      hasPassword: !!g.hasPassword,
      downloadsEnabled: !!g.downloadsEnabled,
      commentingEnabled: !!g.commentingEnabled,
      expiresAt: g.expiresAt || null,
      active: g.active !== false,
    };
  }
  function accessLabel(g) {
    if (g.type === 'reels') return 'Public';
    if (isInherited(g)) return 'Inherited';
    if (g.hasPassword) return 'Password';
    return 'Open link';
  }
  function collectionHasShared(c) {
    return !!(c.hasPassword || c.downloadsEnabled || c.commentingEnabled || c.expiresAt);
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  // Clipboard write with a fallback for browsers/contexts where the async
  // Clipboard API is unavailable or rejects (non-secure origin, permission).
  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg || 'Link copied');
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? (msg || 'Link copied') : 'Copy failed — select the link and copy manually');
      return ok;
    }
  }
  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) { checkAuth(); throw new Error('unauthorized'); }
    return res;
  }

  // ==========================================================================
  // Auth
  // ==========================================================================
  async function checkAuth() {
    let data;
    try { data = await (await fetch('/api/auth/check')).json(); }
    catch (_) { return; }
    if (data.setupRequired) {
      showAuth('auth-setup');
      return;
    }
    if (data.authenticated) {
      showAuth(null); show($('app'));
      await Promise.all([loadData(), loadHeaderConfig()]);
      renderAll();
      // Come back to whichever side of the app you were last working on.
      if (lastTab() === 'portfolio') setScreen('portfolio');
    } else if (resetToken()) {
      showAuth('auth-reset');
    } else {
      showAuth('auth-login');
    }
  }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  // One signed-out screen at a time (or none, once the app itself is showing).
  function showAuth(id) {
    ['auth-setup', 'auth-login', 'auth-forgot', 'auth-reset'].forEach(n => { $(n).hidden = n !== id; });
    $('app').hidden = true;
  }
  function resetToken() { return new URLSearchParams(location.search).get('reset') || ''; }

  $('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('setup-error').textContent = '';
    if (f.password.value !== f.confirmPassword.value) { $('setup-error').textContent = 'Passwords do not match'; return; }
    const res = await fetch('/api/auth/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: f.email.value.trim(), password: f.password.value }),
    });
    if (res.ok) checkAuth();
    else { const d = await res.json().catch(() => ({})); $('setup-error').textContent = d.error || 'Setup failed'; }
  });

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').textContent = '';
    const f = e.target;
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.username.value, password: f.password.value }),
    });
    if (res.ok) checkAuth();
    else {
      // Show the server's reason (e.g. the too-many-attempts lockout) rather than
      // calling every failure a bad password.
      const d = await res.json().catch(() => ({}));
      $('login-error').textContent = res.status === 401 ? 'Invalid credentials' : (d.error || 'Login failed');
    }
  });

  // Password recovery: the emailed link lands here as /admin?reset=<token>.
  $('forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('forgot-msg').textContent = ''; $('forgot-msg').classList.remove('ok');
    showAuth('auth-forgot');
  });
  document.querySelectorAll('.back-to-login').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    if (resetToken()) history.replaceState(null, '', location.pathname);
    showAuth('auth-login');
  }));

  $('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('forgot-msg');
    msg.classList.remove('ok'); msg.textContent = '';
    const res = await fetch('/api/auth/forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e.target.email.value.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { msg.textContent = d.error || 'Something went wrong. Try again.'; return; }
    msg.classList.add('ok');
    msg.textContent = d.emailConfigured
      ? 'If that address is an admin address for this site, a reset link is on its way. It works for one hour. Check spam too.'
      : 'This site can\'t send email yet. Ask whoever hosts it to run "php index.php admin:reset-password", or set up email under Settings once you\'re in.';
  });

  $('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('reset-error');
    err.textContent = '';
    if (f.password.value !== f.confirmPassword.value) { err.textContent = 'Passwords do not match'; return; }
    const res = await fetch('/api/auth/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken(), password: f.password.value }),
    });
    if (res.ok) {
      history.replaceState(null, '', location.pathname);
      f.reset();
      showAuth('auth-login');
      $('login-error').textContent = 'Password updated. Log in with the new one.';
    } else {
      const d = await res.json().catch(() => ({}));
      err.textContent = d.error || 'Could not reset the password';
    }
  });

  // Change password (signed in).
  function closePasswordModal() { $('password-modal').hidden = true; }
  $('account-password').addEventListener('click', () => {
    $('password-form').reset();
    $('password-msg').textContent = '';
    $('password-modal').hidden = false;
    $('password-form').currentPassword.focus();
  });
  $('password-cancel').addEventListener('click', closePasswordModal);
  $('password-modal').querySelector('.modal-backdrop').addEventListener('click', closePasswordModal);
  $('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, msg = $('password-msg');
    msg.textContent = '';
    if (f.newPassword.value !== f.confirmPassword.value) { msg.textContent = 'New passwords do not match'; return; }
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: f.currentPassword.value, newPassword: f.newPassword.value }),
    });
    if (res.ok) { closePasswordModal(); toast('Password changed'); }
    else { const d = await res.json().catch(() => ({})); msg.textContent = d.error || 'Could not change the password'; }
  });

  // ==========================================================================
  // Data load
  // ==========================================================================
  async function loadData() {
    let gRes, cRes;
    try {
      [gRes, cRes] = await Promise.all([fetch('/api/admin/client/galleries'), fetch('/api/admin/client/collections')]);
    } catch (err) {
      toast('Could not reach the server — check your connection and reload.');
      return;
    }
    if (!gRes.ok) {
      if (gRes.status === 401) { checkAuth(); return; }
      toast(`Failed to load galleries (HTTP ${gRes.status}). Reload to try again.`);
      return;
    }
    state.galleries = await gRes.json();
    state.collections = cRes.ok ? await cRes.json() : [];
  }

  // Hash the files in one delivery so its zip downloads at full speed.
  //
  // Scoped to the package being sent rather than the whole library: hashing is
  // CPU-capped on shared hosting, and there's no reason to grind through
  // thousands of files to send three. New uploads are hashed as they arrive, so
  // this only has real work to do for galleries that predate the CRC cache.
  //
  // Nothing waits on it. The link works immediately either way; an unhashed
  // file is hashed on its first download instead, which is just slower.
  let crcWarming = false;
  async function warmPackageCrc(packageId, onProgress) {
    if (crcWarming || !packageId) return;
    crcWarming = true;
    try {
      for (;;) {
        const res = await fetch('/api/admin/client/crc-warm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId }),
        });
        if (!res.ok) break;
        const d = await res.json();
        if (onProgress) onProgress(d);
        if (d.done || !d.hashed) break;
        // Yield between slices so this never competes with the admin's own
        // requests, or with a client downloading right now.
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (_) { /* best effort — the download hashes anything left over */ }
    crcWarming = false;
  }

  // ==========================================================================
  // Screen switching
  // ==========================================================================
  function setScreen(screen) {
    state.screen = screen;
    setRailOpen(false);
    $('screen-library').hidden = screen !== 'library';
    $('screen-upload').hidden = screen !== 'upload';
    $('screen-portfolio').hidden = screen !== 'portfolio';
    $('tab-portfolio').classList.toggle('active', screen === 'portfolio');
    $('tab-delivery').classList.toggle('active', screen === 'library' || screen === 'upload');
    if (screen === 'upload') renderUpload();
    if (screen === 'portfolio' && window.SDPortfolio) window.SDPortfolio.open();
  }
  $('tab-portfolio').addEventListener('click', () => { rememberTab('portfolio'); setScreen('portfolio'); });
  $('tab-delivery').addEventListener('click', () => { rememberTab('delivery'); setScreen('library'); });
  function rememberTab(which) {
    try { localStorage.setItem('admin2:tab', which); } catch (_) {}
  }
  function lastTab() {
    try { return localStorage.getItem('admin2:tab') || 'delivery'; } catch (_) { return 'delivery'; }
  }
  function renderAll() {
    updateUploadsCount();
    renderRail();
    renderCentre();
    renderDrawer();
    if (state.screen === 'upload') renderUpload();
  }

  // ==========================================================================
  // Top bar
  // ==========================================================================
  $('brand-home').addEventListener('click', () => { state.rail = 'all'; state.centreGalleryId = null; contentGid = null; closeDrawerForce(); setScreen('library'); renderAll(); });
  $('nav-uploads').addEventListener('click', () => setScreen('upload'));
  $('account-theme').addEventListener('click', () => toggleTheme());
  $('account-logout').addEventListener('click', () => logout());

  function setupMenu(btnId, menuId, onPick, pickAttr) {
    const btn = $(btnId), menu = $(menuId);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !menu.hidden;
      closeAllMenus();
      if (!open) menu.hidden = false;
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      menu.hidden = true;
      onPick(b.getAttribute(pickAttr));
    });
  }
  function closeAllMenus() {
    $('new-menu').hidden = true;
    document.querySelectorAll('.filter-pop').forEach(p => p.remove());
  }
  document.addEventListener('click', closeAllMenus);

  $('upload-back').addEventListener('click', () => setScreen('library'));

  setupMenu('new-btn', 'new-menu', async (v) => {
    // When you are looking at one collection, a gallery made from here belongs
    // to it. state.rail is a collection id only in that scope — "all",
    // "portfolio", "client", "ungrouped" and "archive" are not collections.
    if (v === 'gallery') openNewGallery(state.collections.some(c => c.id === state.rail) ? state.rail : '');
    else if (v === 'collection') openCollectionModal();
    else if (v === 'upload') setScreen('upload');
    else if (v === 'pf-gallery' || v === 'pf-collection') {
      // Not scoped to whichever tab is open — switch to Portfolio and wait
      // for its tree to load before creating, so the prompt that follows
      // isn't racing the initial fetch.
      setScreen('portfolio');
      await window.SDPortfolio?.open();
      if (v === 'pf-gallery') window.SDPortfolio?.newTopGallery();
      else window.SDPortfolio?.newCategory();
    }
  }, 'data-new');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    checkAuth();
  }

  function updateUploadsCount() {
    const active = state.upload.queue.filter(i => i.status === 'uploading' || i.status === 'waiting').length;
    $('uploads-count').textContent = active;
    // Only worth a place in the bar while there is something to watch;
    // New > Upload files opens the screen otherwise.
    $('nav-uploads').hidden = !state.upload.queue.length;
  }

  // Global search
  $('global-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    $('global-search-clear').hidden = !e.target.value;
    if (state.centreGalleryId) { state.centreGalleryId = null; contentGid = null; closeDrawerForce(); }
    if (state.screen !== 'library') setScreen('library');
    renderCentre();
  });
  $('global-search-clear').addEventListener('click', () => {
    $('global-search').value = '';
    $('global-search').dispatchEvent(new Event('input'));
    $('global-search').focus();
  });

  // ==========================================================================
  // Data pipeline (filter / group / sort)
  // ==========================================================================
  // Rail scopes that aren't a collection id.
  const RAIL_SCOPES = ['all', 'archive', 'portfolio', 'client', 'ungrouped'];
  // Scopes that span more than one collection, so "Group: Collection" has
  // something to group by.
  const GROUPABLE_SCOPES = ['all', 'portfolio', 'client'];
  function railGalleries() {
    let list = state.galleries.slice();
    if (state.rail === 'archive') {
      list = list.filter(g => g.active === false);
    } else {
      list = list.filter(g => g.active !== false);
      if (state.rail === 'portfolio') list = list.filter(g => g.type === 'reels');
      else if (state.rail === 'client') list = list.filter(g => g.type === 'proofing');
      // "Ungrouped" lives under Client delivery, so it means client galleries
      // that aren't in a collection — not every gallery without one.
      else if (state.rail === 'ungrouped') list = list.filter(g => g.type === 'proofing' && !g.collectionId);
      else if (state.rail !== 'all') list = list.filter(g => g.collectionId === state.rail);
    }
    // filter facet
    if (state.filter.type === 'client') list = list.filter(g => g.type === 'proofing');
    else if (state.filter.type === 'portfolio') list = list.filter(g => g.type === 'reels');
    if (state.filter.hasPassword) list = list.filter(g => effective(g).hasPassword);
    if (state.filter.expiringDays) {
      const cutoff = Date.now() + state.filter.expiringDays * 86400000;
      list = list.filter(g => { const e = effective(g).expiresAt; return e && new Date(e).getTime() <= cutoff; });
    }
    if (state.search) list = list.filter(g => g.name.toLowerCase().includes(state.search));
    return list;
  }
  function sortGalleries(list) {
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    const val = (g) => {
      switch (key) {
        case 'items': return g.videoCount || 0;
        case 'views': return g.viewCount || 0;
        case 'access': return accessLabel(g);
        case 'expires': { const e = effective(g).expiresAt; return e ? new Date(e).getTime() : Infinity; }
        default: return g.name.toLowerCase();
      }
    };
    return list.slice().sort((a, b) => {
      const fa = a.favorite ? 1 : 0, fb = b.favorite ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  }
  function sortByFavorite(list) {
    return list.slice().sort((a, b) => {
      const aInactive = a.active === false ? 1 : 0, bInactive = b.active === false ? 1 : 0;
      if (aInactive !== bInactive) return aInactive - bInactive;
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    });
  }
  function starBtn(item, kind) {
    const fav = !!item.favorite;
    return `<button class="fav-star${fav ? ' is-fav' : ''}" data-fav="${item.id}" data-fav-kind="${kind}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}">${fav ? '&#9733;' : '&#9734;'}</button>`;
  }
  function wireFavButtons(scope) {
    scope.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.getAttribute('data-fav'), btn.getAttribute('data-fav-kind'));
      });
    });
  }
  async function toggleFavorite(id, kind) {
    const list = kind === 'collection' ? state.collections : state.galleries;
    const item = list.find(x => x.id === id);
    if (!item) return;
    const next = !item.favorite;
    item.favorite = next;
    renderAll();
    const url = kind === 'collection' ? `/api/admin/client/collections/${id}` : `/api/admin/client/galleries/${id}`;
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: next }) });
    if (!res.ok) { item.favorite = !next; renderAll(); toast('Failed to update favorite'); }
  }

  // ==========================================================================
  // Rail
  // ==========================================================================
  // The rail is split by audience: portfolio work (public) and client delivery
  // (token links), each with its own galleries and collections, plus a Library
  // section for the cross-type views.
  function renderRail() {
    const rail = $('rail');
    const all = state.galleries.filter(g => g.active !== false);
    const client = all.filter(g => g.type === 'proofing');
    const ungrouped = client.filter(g => !g.collectionId).length;
    const archived = state.galleries.filter(g => g.active === false).length;

    const railRow = (id, label, count) =>
      `<div class="rail-row${state.rail === id ? ' active' : ''}" data-rail="${id}">
        <span class="rail-name">${escapeHtml(label)}</span>
        ${count != null ? `<span class="rail-count">${count}</span>` : ''}
      </div>`;
    const collectionRows = (type) => sortByFavorite(state.collections.filter(c => (c.type || 'proofing') === type))
      .map(c => {
        const count = all.filter(g => g.collectionId === c.id).length;
        return `<div class="rail-row compact${state.rail === c.id ? ' active' : ''}${c.active === false ? ' inactive' : ''}" data-rail="${c.id}" title="${c.active === false ? 'Inactive' : ''}">
          <span class="rail-name">${escapeHtml(titleCase(c.name))}</span>
          <span class="rail-count">${count}</span>
          ${starBtn(c, 'collection')}
        </div>`;
      }).join('');

    // Recent: client delivery collections and galleries created in the last
    // few days, surfaced at the top so a just-made delivery is one click away
    // instead of buried in its collection. Collections first, then the
    // galleries inside them (and ungrouped ones), newest first within each.
    const RECENT_DAYS = 5;
    const recentCutoff = Date.now() - RECENT_DAYS * 86400000;
    const createdSince = (item) => {
      const t = Date.parse(item.createdAt || '');
      return Number.isFinite(t) && t >= recentCutoff;
    };
    const recentCollections = sortByFavorite(state.collections.filter(c => (c.type || 'proofing') === 'proofing' && createdSince(c)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const recentGalleries = state.galleries
      .filter(g => g.active !== false && g.type === 'proofing' && createdSince(g))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    let html = '';
    if (recentCollections.length || recentGalleries.length) {
      html += `<div class="rail-section-label">Recent</div>`;
      html += `<div class="rail-section-hint">New in the last ${RECENT_DAYS} days</div>`;
      html += recentCollections.map(c => {
        const count = all.filter(g => g.collectionId === c.id).length;
        return `<div class="rail-row compact recent" data-recent-collection="${c.id}" title="Collection">
          <span class="rail-name">${escapeHtml(titleCase(c.name))}</span>
          <span class="rail-count">${count}</span>
        </div>`;
      }).join('');
      html += recentGalleries.map(g => `<div class="rail-row compact recent" data-recent-gallery="${g.id}" title="Gallery">
          <span class="rail-name">${escapeHtml(g.name)}</span>
          <span class="rail-count">${g.videoCount || 0}</span>
        </div>`).join('');
    }

    html += `<div class="rail-section-label">Library</div>`;
    html += railRow('all', 'Everything', all.length);
    html += railRow('archive', 'Archive', archived);

    html += `<div class="rail-section-label">Client delivery</div>`;
    html += railRow('client', 'All client galleries', client.length);
    html += railRow('ungrouped', 'Ungrouped', ungrouped);
    html += collectionRows('proofing');
    html += `<div class="rail-row compact new-collection" data-new-collection="proofing">+ New collection</div>`;

    rail.innerHTML = html;

    wireFavButtons(rail);
    rail.querySelectorAll('[data-rail]').forEach(el => {
      el.addEventListener('click', () => {
        state.rail = el.getAttribute('data-rail');
        state.centreGalleryId = null; contentGid = null; closeDrawerForce();
        setScreen('library');
        clearSelection();
        renderRail(); renderCentre();
        setRailOpen(false);
      });
    });
    rail.querySelectorAll('[data-new-collection]').forEach(el => {
      el.addEventListener('click', () => openCollectionModal(null, el.getAttribute('data-new-collection')));
    });

    // Recent rows: a collection scopes the rail to it; a gallery opens it.
    rail.querySelectorAll('[data-recent-collection]').forEach(el => {
      el.addEventListener('click', () => {
        state.rail = el.getAttribute('data-recent-collection');
        state.centreGalleryId = null; contentGid = null; closeDrawerForce();
        setScreen('library');
        clearSelection();
        renderRail(); renderCentre();
        setRailOpen(false);
      });
    });
    rail.querySelectorAll('[data-recent-gallery]').forEach(el => {
      el.addEventListener('click', () => {
        openGallery(el.getAttribute('data-recent-gallery'));
        renderRail();
        setRailOpen(false);
      });
    });
  }

  // ==========================================================================
  // Centre (header + table/grid + bulk bar)
  // ==========================================================================
  function centreTitle() {
    if (state.rail === 'all') return 'EVERYTHING';
    if (state.rail === 'portfolio') return 'ALL PORTFOLIO';
    if (state.rail === 'client') return 'ALL CLIENT GALLERIES';
    if (state.rail === 'ungrouped') return 'UNGROUPED';
    if (state.rail === 'archive') return 'ARCHIVE';
    const c = state.collections.find(x => x.id === state.rail);
    return c ? c.name.toUpperCase() : 'GALLERIES';
  }
  function currentRailCollection() {
    if (RAIL_SCOPES.includes(state.rail)) return null;
    return state.collections.find(c => c.id === state.rail) || null;
  }
  function renderCentre() {
    const header = document.querySelector('.centre-header');
    if (state.centreGalleryId) {
      header.style.display = 'none';
      $('bulk-bar').hidden = true;
      $('bulk-bar').classList.remove('show');
      renderGalleryView();
      return;
    }
    header.style.display = '';
    const list = railGalleries();
    $('centre-title').textContent = centreTitle();
    $('centre-subtitle').textContent =
      `${list.length} galler${list.length === 1 ? 'y' : 'ies'} · ${state.collections.length} collection${state.collections.length === 1 ? '' : 's'}`;
    $('ctrl-group').textContent = 'Group: ' + (state.groupBy === 'collection' ? 'Collection' : 'None');
    $('ctrl-list').classList.toggle('active', state.view === 'list');
    $('ctrl-grid').classList.toggle('active', state.view === 'grid');

    const railCol = currentRailCollection();
    $('ctrl-col-copy').hidden = !railCol;
    $('ctrl-col-visit').hidden = !railCol;
    $('ctrl-col-settings').hidden = !railCol;
    $('ctrl-col-deliver').hidden = !railCol;
    if (railCol) {
      $('ctrl-col-copy').onclick = () => copyCollectionLink(railCol.id);
      $('ctrl-col-visit').onclick = () => openCollectionLink(railCol.id);
      $('ctrl-col-settings').onclick = () => openCollectionModal(railCol.id);
      $('ctrl-col-deliver').onclick = () => openPackageModal('collection', railCol.id, railCol.name);
    }

    if (state.view === 'grid') renderGrid(list);
    else renderTable(list);
    renderBulkBar();
  }

  // ---------- Grouping ----------
  // In a multi-collection scope with Group: Collection we render per-collection
  // groups plus an Ungrouped group. Any other rail scope is a single flat list.
  function buildGroups(list) {
    const grouped = GROUPABLE_SCOPES.includes(state.rail) && state.groupBy === 'collection';
    if (!grouped) return [{ col: null, galleries: sortGalleries(list) }];
    const groups = [];
    sortByFavorite(state.collections).forEach(c => {
      const members = list.filter(g => g.collectionId === c.id);
      if (members.length) groups.push({ col: c, galleries: sortGalleries(members) });
    });
    const ungrouped = list.filter(g => !g.collectionId);
    if (ungrouped.length) groups.push({ col: { id: '__ungrouped__', name: 'Ungrouped' }, galleries: sortGalleries(ungrouped) });
    return groups;
  }

  // ---------- Table ----------
  const COLS = [
    { key: 'name', label: 'Name' },
    { key: 'items', label: 'Items' },
    { key: 'views', label: 'Views' },
    { key: 'access', label: 'Access' },
    { key: 'expires', label: 'Expires' },
  ];
  function renderTable(list) {
    const scroll = $('table-scroll');
    state._rowOrder = [];
    const arrow = state.sort.dir === 'asc' ? ' ↑' : ' ↓';
    let html = `<div class="col-head">` + COLS.map(c =>
      `<button class="ch${state.sort.key === c.key ? ' sorted' : ''}" data-sort="${c.key}">${c.label}${state.sort.key === c.key ? arrow : ''}</button>`
    ).join('') + `</div>`;

    const groups = buildGroups(list);
    if (!groups.length || groups.every(g => !g.galleries.length)) {
      html += emptyNoteHtml();
      scroll.innerHTML = html;
      wireTableHeader();
      wireEmptyNote(scroll);
      return;
    }

    groups.forEach(grp => {
      const showHead = !!grp.col && grp.col.id !== null;
      const groupedScope = GROUPABLE_SCOPES.includes(state.rail) && state.groupBy === 'collection';
      if (groupedScope && grp.col) {
        const collapsed = state.collapsed.has(grp.col.id);
        const isCol = grp.col.id !== '__ungrouped__';
        const shared = isCol && collectionHasShared(grp.col) ? `<span class="g-shared">· shared settings</span>` : '';
        const inactiveTag = isCol && grp.col.active === false ? `<span class="g-tag">Inactive</span>` : '';
        const actions = isCol ? `<span class="gb-actions">
            <button class="link-btn" data-col-copy="${escapeHtml(grp.col.id)}">Copy link</button>
            <button class="link-btn" data-col-visit="${escapeHtml(grp.col.id)}">Open</button>
            <button class="link-btn" data-col-open="${escapeHtml(grp.col.id)}">Collection settings</button>
          </span>` : '';
        html += `<div class="group${collapsed ? ' collapsed' : ''}" data-group="${escapeHtml(grp.col.id)}">
          <div class="group-head" data-toggle="${escapeHtml(grp.col.id)}">
            <span class="g-caret">▼</span>
            <span class="g-name">${escapeHtml(grp.col.name)}</span>
            <span class="g-count">${grp.galleries.length}</span>
            ${isCol ? starBtn(grp.col, 'collection') : ''}
            ${inactiveTag}
            ${shared}
            ${actions}
          </div>` + grp.galleries.map(rowHtml).join('') + `</div>`;
      } else {
        html += grp.galleries.map(rowHtml).join('');
      }
      grp.galleries.forEach(g => state._rowOrder.push(g.id));
    });

    scroll.innerHTML = html;
    wireTableHeader();
    wireRows(scroll);
    wireFavButtons(scroll);
  }

  function emptyNoteHtml() {
    if (state.search) {
      return `<div class="empty-note">No galleries match "${escapeHtml(state.search)}". <button class="link-btn accent" data-clear-search>Clear search</button></div>`;
    }
    return `<div class="empty-note">No galleries here yet.</div>`;
  }
  function wireEmptyNote(scope) {
    const btn = scope.querySelector('[data-clear-search]');
    if (btn) btn.addEventListener('click', () => $('global-search-clear').click());
  }
  function thumbHtml(g, cls) {
    const tag = cls === 'gc-cover' ? 'div' : 'span';
    if (g.thumbnail) return `<img class="${cls}" src="/thumbnails/${encodeURIComponent(g.thumbnail)}" alt="" loading="lazy">`;
    return `<${tag} class="${cls}"></${tag}>`;
  }
  // Portfolio galleries are linkable too now — a portfolio collection links to
  // its members by token exactly the way a client collection does.
  function galleryPublicUrl(g) {
    return g.token ? window.location.origin + '/gallery/' + g.token : null;
  }
  function openLinkBtnHtml(g) {
    return galleryPublicUrl(g) ? `<button class="row-open" data-open-link="${g.id}" title="Open public link">&#8599;</button>` : '';
  }
  function rowHtml(g) {
    const eff = effective(g);
    const selected = state.selection.has(g.id);
    const open = state.drawer.galleryId === g.id;
    const tag = g.type === 'reels' ? `<span class="g-tag">Portfolio</span>` : '';
    return `<div class="gallery-row${selected ? ' selected' : ''}${open ? ' open' : ''}" data-id="${g.id}" role="row">
      <div class="g-name-cell">
        <button class="row-check" data-check="${g.id}" title="Select">${TICK}</button>
        ${thumbHtml(g, 'g-thumb')}
        <span class="g-name">${escapeHtml(g.name)}</span>${tag}
        ${openLinkBtnHtml(g)}
        ${starBtn(g, 'gallery')}
      </div>
      <div class="cell">${g.videoCount || 0}</div>
      <div class="cell views">${g.viewCount || 0}</div>
      <div class="cell">${accessLabel(g)}</div>
      <div class="cell">${formatDate(eff.expiresAt)}</div>
    </div>`;
  }

  function wireTableHeader() {
    $('table-scroll').querySelectorAll('.col-head .ch').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sort');
        if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        else state.sort = { key, dir: key === 'name' ? 'asc' : 'desc' };
        savePrefs();
        renderCentre();
      });
    });
    $('table-scroll').querySelectorAll('[data-col-copy]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); copyCollectionLink(el.getAttribute('data-col-copy')); }));
    $('table-scroll').querySelectorAll('[data-col-visit]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); openCollectionLink(el.getAttribute('data-col-visit')); }));
    $('table-scroll').querySelectorAll('[data-col-open]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); openCollectionModal(el.getAttribute('data-col-open')); }));
    $('table-scroll').querySelectorAll('.group-head[data-toggle]').forEach(h => {
      h.addEventListener('click', () => {
        const id = h.getAttribute('data-toggle');
        if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
        savePrefs();
        renderCentre();
      });
    });
  }

  function wireRows(scope) {
    scope.querySelectorAll('.gallery-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-check]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelect(id, e);
      });
      const openLinkBtn = row.querySelector('[data-open-link]');
      if (openLinkBtn) openLinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const g = state.galleries.find(x => x.id === id);
        const url = g && galleryPublicUrl(g);
        if (url) window.open(url, '_blank');
      });
      row.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey) { toggleSelect(id, e); return; }
        if (e.shiftKey) { rangeSelect(id); return; }
        openGallery(id);
      });
    });
  }

  // ---------- Grid ----------
  function renderGrid(list) {
    const scroll = $('table-scroll');
    state._rowOrder = [];
    const groups = buildGroups(list);
    if (!groups.length || groups.every(g => !g.galleries.length)) {
      scroll.innerHTML = emptyNoteHtml();
      wireEmptyNote(scroll);
      return;
    }
    let html = `<div class="grid-wrap">`;
    const groupedScope = GROUPABLE_SCOPES.includes(state.rail) && state.groupBy === 'collection';
    groups.forEach(grp => {
      if (groupedScope && grp.col) {
        const isCol = grp.col.id !== '__ungrouped__';
        html += `<div class="grid-block"><div class="grid-block-head">
          <span class="gb-name">${escapeHtml(grp.col.name)}</span>
          <span class="gb-count">${grp.galleries.length}</span>
          ${isCol ? starBtn(grp.col, 'collection') : ''}
          ${isCol && grp.col.active === false ? `<span class="g-tag">Inactive</span>` : ''}
          ${isCol ? `<span class="gb-actions">
            <button class="link-btn" data-col-copy="${escapeHtml(grp.col.id)}">Copy link</button>
            <button class="link-btn" data-col-visit="${escapeHtml(grp.col.id)}">Open</button>
            <button class="link-btn" data-col-open="${escapeHtml(grp.col.id)}">Collection settings</button>
          </span>` : ''}
        </div><div class="grid-cards">`;
        html += grp.galleries.map(cardHtml).join('');
        html += `<div class="grid-add" data-add-gallery="${isCol ? escapeHtml(grp.col.id) : ''}">+ Gallery</div>`;
        html += `</div></div>`;
      } else {
        html += `<div class="grid-block"><div class="grid-cards">` + grp.galleries.map(cardHtml).join('') + `</div></div>`;
      }
      grp.galleries.forEach(g => state._rowOrder.push(g.id));
    });
    html += `</div>`;
    scroll.innerHTML = html;

    scroll.querySelectorAll('.grid-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('.gc-check').addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(id, e); });
      const openLinkBtn = card.querySelector('[data-open-link]');
      if (openLinkBtn) openLinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const g = state.galleries.find(x => x.id === id);
        const url = g && galleryPublicUrl(g);
        if (url) window.open(url, '_blank');
      });
      card.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey) { toggleSelect(id, e); return; }
        if (e.shiftKey) { rangeSelect(id); return; }
        openGallery(id);
      });
    });
    wireFavButtons(scroll);
    scroll.querySelectorAll('[data-add-gallery]').forEach(el =>
      el.addEventListener('click', () => openNewGallery(el.getAttribute('data-add-gallery') || '')));
    scroll.querySelectorAll('[data-col-copy]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); copyCollectionLink(el.getAttribute('data-col-copy')); }));
    scroll.querySelectorAll('[data-col-visit]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); openCollectionLink(el.getAttribute('data-col-visit')); }));
    scroll.querySelectorAll('[data-col-open]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); openCollectionModal(el.getAttribute('data-col-open')); }));
  }
  function cardHtml(g) {
    const eff = effective(g);
    const selected = state.selection.has(g.id);
    const meta = `${g.videoCount || 0} items · ${g.viewCount || 0} views`;
    const stateLine = g.type === 'reels' ? 'Public' : `${accessLabel(g)} · ${formatDate(eff.expiresAt)}`;
    return `<div class="grid-card${selected ? ' selected' : ''}" data-id="${g.id}">
      ${thumbHtml(g, 'gc-cover')}
      <button class="gc-check">${TICK}</button>
      ${openLinkBtnHtml(g)}
      ${starBtn(g, 'gallery')}
      <div class="gc-name">${escapeHtml(g.name)}</div>
      <div class="gc-meta">${meta}</div>
      <div class="gc-state">${stateLine}</div>
    </div>`;
  }

  // ---------- Centre controls ----------
  $('ctrl-list').addEventListener('click', () => { state.view = 'list'; savePrefs(); renderCentre(); });
  $('ctrl-grid').addEventListener('click', () => { state.view = 'grid'; savePrefs(); renderCentre(); });
  $('ctrl-group').addEventListener('click', () => {
    state.groupBy = state.groupBy === 'collection' ? 'none' : 'collection';
    savePrefs(); renderCentre();
  });
  $('ctrl-filter').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllMenus();
    openFilterPop(e.currentTarget);
  });
  function openFilterPop(anchor) {
    const pop = document.createElement('div');
    pop.className = 'menu filter-pop';
    pop.style.position = 'fixed';
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = Math.max(12, r.right - 220) + 'px';
    const opt = (v, label, on) => `<button data-f="${v}">${on ? '● ' : '○ '}${label}</button>`;
    pop.innerHTML =
      opt('type:all', 'All types', state.filter.type === 'all') +
      opt('type:client', 'Client galleries', state.filter.type === 'client') +
      opt('type:portfolio', 'Portfolio', state.filter.type === 'portfolio') +
      opt('pw', 'Has password', state.filter.hasPassword) +
      opt('exp', 'Expiring ≤ 30 days', state.filter.expiringDays === 30);
    pop.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      ev.stopPropagation();
      const f = b.getAttribute('data-f');
      if (f.startsWith('type:')) state.filter.type = f.split(':')[1];
      else if (f === 'pw') state.filter.hasPassword = !state.filter.hasPassword;
      else if (f === 'exp') state.filter.expiringDays = state.filter.expiringDays === 30 ? 0 : 30;
      openFilterPop(anchor);
      renderCentre();
    });
    document.querySelectorAll('.filter-pop').forEach(p => p.remove());
    document.body.appendChild(pop);
  }

  // ==========================================================================
  // Selection + bulk bar
  // ==========================================================================
  function toggleSelect(id) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
    state._lastClicked = id;
    renderCentre();
  }
  function rangeSelect(id) {
    const order = state._rowOrder;
    const from = order.indexOf(state._lastClicked);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) { toggleSelect(id); return; }
    const [a, b] = from < to ? [from, to] : [to, from];
    for (let i = a; i <= b; i++) state.selection.add(order[i]);
    renderCentre();
  }
  function clearSelection() {
    if (state.selection.size) { state.selection.clear(); renderCentre(); }
  }
  function renderBulkBar() {
    const bar = $('bulk-bar');
    const n = state.selection.size;
    if (!n) { bar.classList.remove('show'); bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML =
      `<span class="bulk-count">${n} selected</span>
       <span class="bulk-divider"></span>
       <button data-bulk="collection">Add to collection</button>
       <button data-bulk="expiration">Expiration</button>
       <button data-bulk="password">Password</button>
       <button data-bulk="downloads">Downloads</button>
       <button data-bulk="archive">Archive</button>
       <button data-bulk="delete" class="danger">Delete</button>`;
    bar.querySelectorAll('[data-bulk]').forEach(b =>
      b.addEventListener('click', () => bulkAction(b.getAttribute('data-bulk'))));
    requestAnimationFrame(() => bar.classList.add('show'));
  }

  async function runBulk(fn) {
    const ids = [...state.selection];
    let done = 0;
    for (const id of ids) {
      try { await fn(id); } catch (_) {}
      done++;
      toast(`Working… ${done}/${ids.length}`);
    }
    state.selection.clear();
    await loadData();
    renderAll();
    toast(`Done — ${ids.length} galler${ids.length === 1 ? 'y' : 'ies'} updated`);
  }

  async function bulkAction(kind) {
    const ids = [...state.selection];
    if (!ids.length) return;
    if (kind === 'collection') {
      if (!state.collections.length) { toast('No collections yet — create one first'); return; }
      const colId = await promptModal({
        title: 'Add to collection', okText: 'Add',
        field: { type: 'select', label: 'Collection', options: state.collections.map(c => ({ value: c.id, label: c.name })) },
      });
      if (!colId) return;
      const col = state.collections.find(c => c.id === colId);
      const merged = [...new Set([...(col.galleryIds || []), ...ids])];
      await fetch(`/api/admin/client/collections/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: merged }) });
      state.selection.clear();
      await loadData(); renderAll();
      toast(`Added ${ids.length} to ${col.name}`);
    } else if (kind === 'expiration') {
      const date = await promptModal({ title: 'Set expiration', okText: 'Set', field: { type: 'date', label: 'Expiration date (leave blank to clear)' } });
      if (date === null) return;
      const expiresAt = date ? new Date(date + 'T23:59:59').toISOString() : null;
      runBulk(id => fetch(`/api/admin/client/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresAt }) }));
    } else if (kind === 'password') {
      const pw = await promptModal({ title: 'Set / clear password', okText: 'Apply', sub: 'Leave blank to remove the password.', field: { type: 'text', label: 'Password' } });
      if (pw === null) return;
      runBulk(id => fetch(`/api/admin/client/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }));
    } else if (kind === 'downloads') {
      const val = await promptModal({ title: 'Downloads', okText: 'Apply', field: { type: 'select', label: 'Allow client downloads', options: [{ value: '1', label: 'On' }, { value: '0', label: 'Off' }] } });
      if (val === null) return;
      runBulk(id => fetch(`/api/admin/client/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloadsEnabled: val === '1' }) }));
    } else if (kind === 'archive') {
      if (!await confirmModal({ title: 'Archive galleries', message: `Archive ${ids.length} galler${ids.length === 1 ? 'y' : 'ies'}? They become inactive and move to Archive.` })) return;
      runBulk(id => fetch(`/api/admin/client/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) }));
    } else if (kind === 'delete') {
      if (!await confirmModal({ title: 'Delete galleries', message: `Permanently delete ${ids.length} galler${ids.length === 1 ? 'y' : 'ies'}? This cannot be undone.`, okText: 'Delete', danger: true })) return;
      runBulk(id => fetch(`/api/admin/client/galleries/${id}`, { method: 'DELETE' }));
    }
  }

  // ==========================================================================
  // Gallery content view (centre pane)
  // ==========================================================================
  function renderGalleryView() {
    const g = state.galleries.find(x => x.id === state.centreGalleryId);
    if (!g) { backToLibrary(); return; }
    contentGid = g.id;
    selectedItemId = null;
    const isProofing = g.type === 'proofing';
    const badge = isProofing ? 'Client gallery' : 'Portfolio';
    const link = galleryPublicUrl(g) || '';
    const meta = [`${g.videoCount || 0} items`, `${g.viewCount || 0} views`];
    if (g.lastViewedAt) meta.push('last viewed ' + shortDate(g.lastViewedAt));

    const scroll = $('table-scroll');
    scroll.innerHTML = `
      <div class="gallery-view">
        <div class="gallery-view-head">
          <button class="back-link" id="gv-back">&larr; ${escapeHtml(centreTitle())}</button>
          <div class="gv-title-row">
            <h1 class="gv-title">${escapeHtml(g.name)}</h1>
            <span class="gv-badge">${badge}</span>
            <div class="gv-actions">
              <button class="link-btn accent" data-gv="settings">Settings</button>
              ${isProofing ? `<button class="link-btn accent" data-gv="comments">Comments</button>` : ''}
              ${isProofing ? `<button class="link-btn accent" data-gv="deliver">Deliver</button>` : ''}
            </div>
          </div>
          <div class="gv-sub">
            <span class="gv-meta">${meta.join(' · ')}</span>
            ${link ? `<span class="gv-sep">·</span>
            <a class="gv-link" href="${escapeHtml(link)}" target="_blank" rel="noopener" title="${escapeHtml(link)}">${escapeHtml(link)}</a>
            <span class="gv-link-actions">
              <button class="gv-link-btn" data-gv="copy" title="Copy link">Copy</button>
              <button class="gv-link-btn" data-gv="open" title="Open in a new tab">Open</button>
            </span>` : ''}
          </div>
          <div class="gv-add">
            <div class="gv-drop" id="gv-drop">
              <span>Drop files here or</span>
              <label class="btn-primary small">Add files<input type="file" id="gv-file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v,image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" multiple hidden></label>
              <button class="link-btn accent" data-gv="header">Add section header</button>
              <button class="link-btn accent" data-gv="import">Import from server</button>
              <button class="link-btn muted" data-gv="refresh">Refresh metadata</button>
            </div>
          </div>
          <div id="gv-queue"></div>
        </div>
        <div class="item-list" id="content-list"><div class="drawer-empty">Loading…</div></div>
      </div>`;

    $('gv-back').addEventListener('click', backToLibrary);
    scroll.querySelectorAll('[data-gv]').forEach(b => b.addEventListener('click', () => gvAction(g, b.getAttribute('data-gv'))));
    const dz = $('gv-drop');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag-over'); const files = filterMediaFiles(e.dataTransfer.files); if (files.length) enqueueFiles(files, g.id); });
    $('gv-file').addEventListener('change', (e) => { const files = Array.from(e.target.files); if (files.length) enqueueFiles(files, g.id); e.target.value = ''; });
    loadContent();
    renderInlineQueue();
  }

  async function gvAction(g, act) {
    if (act === 'settings') openDrawer('settings');
    else if (act === 'comments') openDrawer('comments');
    else if (act === 'deliver') openPackageModal('gallery', g.id, g.name);
    else if (act === 'import') { contentGid = g.id; openImportModal(); }
    else if (act === 'copy') { copyText(window.location.origin + '/gallery/' + g.token); }
    else if (act === 'open') { window.open(window.location.origin + '/gallery/' + g.token, '_blank', 'noopener'); }
    else if (act === 'refresh') {
      const res = await fetch(`/api/admin/client/galleries/${g.id}/probe`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      toast(data.updated > 0 ? `Updated ${data.updated} item${data.updated !== 1 ? 's' : ''}` : 'All up to date');
      if (data.updated > 0) loadContent();
    } else if (act === 'header') {
      const text = await promptModal({ title: 'Section header', okText: 'Add', field: { type: 'text', label: 'Header text' } });
      if (!text) return;
      await fetch(`/api/admin/client/galleries/${g.id}/headers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      loadContent();
    }
  }

  // ==========================================================================
  // Drawer
  // ==========================================================================
  // Clicking a gallery enters its content view in the centre pane. The drawer
  // (Settings / Comments) is opened on demand from that view, not automatically.
  function openGallery(id) {
    state.selection.clear();
    state.centreGalleryId = id;
    contentGid = id;
    closeDrawerForce();
    setScreen('library');
    renderCentre();
    watchImportFolder();
  }

  // A gallery with an FTP watch folder only imports when something asks, so the
  // open gallery asks: once on entry, then every 30s while it stays open.
  let importWatchTimer = null;
  async function syncImportOnce(gid) {
    try {
      const res = await fetch(`/api/admin/client/galleries/${gid}/import-sync`, { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.imported && state.centreGalleryId === gid) {
        await loadContent();
        refreshCountsSoon();
        toast(`Imported ${data.imported} from FTP folder`);
      }
    } catch (_) { /* next tick retries */ }
  }
  function watchImportFolder() {
    clearInterval(importWatchTimer);
    importWatchTimer = null;
    const gid = state.centreGalleryId;
    const g = gid && state.galleries.find(x => x.id === gid);
    if (!g || !g.importFolder) return;
    syncImportOnce(gid);
    importWatchTimer = setInterval(() => { if (!document.hidden) syncImportOnce(gid); }, 30000);
  }
  function backToLibrary() {
    if (state.drawer.galleryId && state.drawer.dirty && !confirm('Discard unsaved changes?')) return;
    state.centreGalleryId = null;
    contentGid = null;
    clearInterval(importWatchTimer);
    importWatchTimer = null;
    closeDrawerForce();
    renderCentre();
  }
  function openDrawer(tab) {
    const id = state.centreGalleryId;
    if (!id) return;
    if (state.drawer.galleryId === id && !$('drawer').hidden && (!tab || state.drawer.tab === tab)) { closeDrawer(); return; }
    state.drawer.galleryId = id;
    state.drawer.tab = tab || 'settings';
    state.drawer.dirty = false;
    initDraft();
    $('library-layout').classList.add('drawer-open');
    ensureScrim();
    renderDrawer();
  }
  function closeDrawer() {
    if (state.drawer.dirty && !confirm('Discard unsaved changes?')) return;
    state.drawer.galleryId = null;
    state.drawer.draft = null;
    $('library-layout').classList.remove('drawer-open');
    $('drawer').hidden = true;
    removeScrim();
  }
  function ensureScrim() {
    if (window.innerWidth >= 1280) return;
    if ($('drawer-scrim')) return;
    const s = document.createElement('div');
    s.id = 'drawer-scrim';
    s.className = 'drawer-scrim';
    s.addEventListener('click', closeDrawer);
    document.body.appendChild(s);
  }
  function removeScrim() { const s = $('drawer-scrim'); if (s) s.remove(); }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // The preview player owns Escape while it's open, and Escape inside an item
    // title just leaves the field — neither should also back out of the view.
    if (previewIsOpen()) return;
    if (e.target.closest && e.target.closest('.admin-video-item .title-input')) return;
    if (!$('drawer').hidden && state.drawer.galleryId) closeDrawer();
    else if (state.centreGalleryId) backToLibrary();
    else if (state.selection.size) clearSelection();
  });

  function currentDrawerGallery() { return state.galleries.find(g => g.id === state.drawer.galleryId); }
  function initDraft() {
    const g = currentDrawerGallery();
    if (!g) return;
    const eff = effective(g);
    state.drawer.draft = {
      name: g.name,
      active: g.active !== false,
      override: !!g.overrideCollectionSettings,
      password: '',            // only sent if typed
      downloadsEnabled: eff.downloadsEnabled,
      commentingEnabled: eff.commentingEnabled,
      expiresAt: eff.expiresAt ? eff.expiresAt.split('T')[0] : '',
      importFolder: g.importFolder || '',
      // Per-gallery options (never inherited from a collection)
      sortBy: (g.sort && g.sort.by) || 'custom',
      sortDir: (g.sort && g.sort.dir) || 'asc',
      downloadMode: g.downloadMode || 'original',
      selEnabled: !!(g.selection && g.selection.enabled),
      selLimit: (g.selection && g.selection.limit) || 0,
      watermark: !!g.watermark,
      showTitles: g.showTitles !== false,
      coverId: g.coverId || '',
    };
  }

  function renderDrawer() {
    const drawer = $('drawer');
    const g = currentDrawerGallery();
    if (!g) { drawer.hidden = true; return; }
    drawer.hidden = false;
    const col = parentCollection(g);
    const d = state.drawer.draft;
    const isProofing = g.type === 'proofing';

    // Header
    let parentLine;
    if (col) parentLine = `<span class="drawer-parent" data-open-col="${escapeHtml(col.id)}">${escapeHtml(col.name.toUpperCase())}</span>`;
    else if (isProofing) parentLine = `<span class="drawer-parent ungrouped">UNGROUPED <span class="add-to-col" data-add-to-col>Add to collection…</span></span>`;
    else parentLine = `<span class="drawer-parent ungrouped">PORTFOLIO</span>`;

    const meta = [`${g.videoCount || 0} items`, `${g.viewCount || 0} views`];
    if (g.lastViewedAt) meta.push('last viewed ' + shortDate(g.lastViewedAt));

    let html = `<div class="drawer-header">
      ${parentLine}
      <h2 class="drawer-title">${escapeHtml(g.name)}</h2>
      <div class="drawer-meta">${meta.join(' · ')}</div>
    </div>
    <div class="drawer-tabs">
      <button class="drawer-tab${state.drawer.tab === 'settings' ? ' active' : ''}" data-tab="settings">Settings</button>
      ${isProofing ? `<button class="drawer-tab${state.drawer.tab === 'comments' ? ' active' : ''}" data-tab="comments">Comments</button>` : ''}
      ${isProofing && g.selection && g.selection.enabled ? `<button class="drawer-tab${state.drawer.tab === 'selections' ? ' active' : ''}" data-tab="selections">Favorites</button>` : ''}
    </div>
    <div class="drawer-body" id="drawer-body"></div>`;
    drawer.innerHTML = html;

    drawer.querySelectorAll('.drawer-tab').forEach(t =>
      t.addEventListener('click', () => { state.drawer.tab = t.getAttribute('data-tab'); renderDrawer(); }));
    const openColEl = drawer.querySelector('[data-open-col]');
    if (openColEl) openColEl.addEventListener('click', () => { closeDrawerForce(); state.centreGalleryId = null; contentGid = null; state.rail = openColEl.getAttribute('data-open-col'); renderRail(); renderCentre(); });
    const addToColEl = drawer.querySelector('[data-add-to-col]');
    if (addToColEl) addToColEl.addEventListener('click', addCurrentToCollection);

    if (state.drawer.tab === 'comments') renderDrawerComments(g);
    else if (state.drawer.tab === 'selections' && isProofing) renderDrawerSelections(g);
    else renderDrawerSettings(g, col, d, isProofing);
  }
  function closeDrawerForce() {
    state.drawer.galleryId = null; state.drawer.draft = null;
    $('library-layout').classList.remove('drawer-open'); $('drawer').hidden = true; removeScrim();
  }

  function renderDrawerSettings(g, col, d, isProofing) {
    const body = $('drawer-body');
    const baseUrl = window.location.origin;
    let html = '';

    // Value is assigned in wireDrawerSettings, not inlined: escapeHtml() leaves
    // double quotes alone, which would break out of the attribute.
    html += `<div class="drawer-block">
      <div class="editable-row"><span class="er-key">Name</span><span class="er-ctl"><input type="text" class="d-input" data-field="name" maxlength="120"></span></div>
    </div>`;

    if (isProofing && g.token) {
      html += `<div class="drawer-block">
        <div class="d-label">Link</div>
        <div class="d-link-url">${escapeHtml(baseUrl + '/gallery/' + g.token)}</div>
        <div class="d-link-actions">
          <button class="link-btn accent" data-link="copy">Copy</button>
          <button class="link-btn accent" data-link="open">Open</button>
          <button class="link-btn accent" data-link="email">Email</button>
          <button class="link-btn muted" data-link="edit">Edit</button>
          <button class="link-btn muted" data-link="regen">Regenerate</button>
        </div>
      </div>`;
    }

    if (isProofing && col) {
      const useCollection = !d.override;
      html += `<div class="drawer-block">
        <div class="switch-row">
          <div><div class="sr-text">Use collection settings</div><div class="sr-sub">Password, downloads, expiry</div></div>
          <button class="switch${useCollection ? ' on' : ''}" data-switch="useCollection"></button>
        </div>
        ${useCollection ? inheritedReadOnly(g) : editableSettings(d)}
      </div>`;
    } else if (isProofing) {
      html += `<div class="drawer-block">${editableSettings(d)}</div>`;
    }

    if (isProofing) html += galleryOptionsHtml(g, col, d);

    html += `<div class="drawer-block">
      <div class="editable-row"><span class="er-key">FTP folder</span><span class="er-ctl"><input type="text" class="d-input" data-field="importFolder" maxlength="64" placeholder="None" autocomplete="off" spellcheck="false"></span></div>
      <div class="sr-sub" style="margin-top:6px;">Files FTP’d into this folder are added automatically.</div>
    </div>`;

    html += `<div class="drawer-block">
      <div class="switch-row"><div class="sr-text">Active</div><button class="switch${d.active ? ' on' : ''}" data-switch="active"></button></div>
    </div>`;

    html += `<div class="drawer-footer">
      <button class="btn-primary" data-act="save">Save</button>
      <button class="link-btn" data-act="move">Move…</button>
      <button class="link-btn" data-act="duplicate">Duplicate</button>
      <span class="spacer"></span>
      <button class="link-btn danger muted" data-act="delete">Delete</button>
    </div>`;
    body.innerHTML = html;
    wireDrawerSettings(g, col);
  }

  // Options that belong to this gallery alone: how it is ordered, what clients
  // may download, favorites, watermarked previews, and whether file names show.
  function galleryOptionsHtml(g, col, d) {
    const opt = (v, label, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`;
    const dlOn = (col && !d.override) ? effective(g).downloadsEnabled : d.downloadsEnabled;
    const dirLabels = d.sortBy === 'name' ? ['A to Z', 'Z to A'] : ['Oldest first', 'Newest first'];
    let html = `<div class="drawer-block">
      <div class="d-label">Gallery options</div>
      <div class="inherit-list">
        <div class="editable-row"><span class="er-key">Order</span><span class="er-ctl er-pair">
          <select class="d-input" data-field="sortBy">
            ${opt('custom', 'My order (drag)', d.sortBy)}${opt('name', 'File name', d.sortBy)}${opt('captured', 'Capture time', d.sortBy)}${opt('added', 'Date added', d.sortBy)}
          </select>
          ${d.sortBy === 'custom' ? '' : `<select class="d-input" data-field="sortDir">${opt('asc', dirLabels[0], d.sortDir)}${opt('desc', dirLabels[1], d.sortDir)}</select>`}
        </span></div>
        ${d.sortBy === 'captured' ? `<div class="sr-sub">From the photo's EXIF date (or a video's recorded date). Files that don't say fall back to when they were added.</div>` : ''}`;
    if (dlOn) {
      html += `<div class="editable-row"><span class="er-key">Download as</span><span class="er-ctl">
          <select class="d-input" data-field="downloadMode">
            ${opt('original', 'Originals', d.downloadMode)}${opt('web', 'Web size (2048px)', d.downloadMode)}${opt('both', 'Client chooses', d.downloadMode)}
          </select></span></div>
        <div class="sr-sub">Web size applies to photos; videos always download as the original.</div>`;
    }
    html += `<div class="switch-row"><div><div class="sr-text">Favorites</div><div class="sr-sub">Clients pick photos and send you the list</div></div><button class="switch${d.selEnabled ? ' on' : ''}" data-switch="selEnabled"></button></div>`;
    if (d.selEnabled) {
      html += `<div class="editable-row"><span class="er-key">Pick limit</span><span class="er-ctl"><input type="number" class="d-input" data-field="selLimit" min="0" max="100000" step="1" value="${Number(d.selLimit) || 0}" style="max-width:110px;"></span></div>
        <div class="sr-sub">0 means no limit. Clients can change their picks and send them again.</div>`;
    }
    html += `<div class="switch-row"><div><div class="sr-text">Watermark previews</div><div class="sr-sub" id="d-wm-sub">Stamps the site watermark on thumbnails and the viewer. Downloads stay clean.</div></div><button class="switch${d.watermark ? ' on' : ''}" data-switch="watermark"></button></div>
      <div class="switch-row"><div><div class="sr-text">Show file names</div><div class="sr-sub">Off hides titles and IMG numbers from the client page</div></div><button class="switch${d.showTitles ? ' on' : ''}" data-switch="showTitles"></button></div>
      <div class="editable-row"><span class="er-key">Cover</span><span class="er-ctl er-pair">
        ${g.thumbnail ? `<img class="d-cover" src="/thumbnails/${encodeURIComponent(g.thumbnail)}" alt="">` : '<span class="sr-sub">None yet</span>'}
        ${d.coverId ? `<button class="link-btn muted" data-act="clear-cover">Use first item</button>` : ''}
      </span></div>
      <div class="sr-sub">${d.coverId ? 'Chosen cover.' : 'The first item.'} Use ★ next to any item in the gallery to choose one.</div>
      </div>
      <div class="d-label" style="margin-top:22px;">Activity</div>
      <div id="d-activity" class="d-activity"><div class="sr-sub">Loading…</div></div>
    </div>`;
    return html;
  }

  async function loadDrawerActivity(g) {
    const box = $('d-activity');
    if (!box) return;
    try {
      const res = await fetch(`/api/admin/client/galleries/${g.id}/activity`);
      if (!res.ok) { box.innerHTML = ''; return; }
      const a = await res.json();
      const wmSub = $('d-wm-sub');
      if (wmSub && a.watermarkAvailable === false) wmSub.textContent = 'No site watermark yet. Upload one under Portfolio > Site design and it applies here.';
      const st = a.stats || {};
      const row = (k, v) => `<div class="inherit-row"><span class="ir-key">${k}</span><span class="ir-val">${v}</span></div>`;
      const dl = st.downloads || {};
      const when = (t) => t ? shortDate(t) : 'never';
      let html = row('Views', `${(st.views || {}).total || 0} (${(st.views || {}).unique || 0} unique)`)
        + row('Last viewed', when((st.views || {}).lastViewedAt))
        + row('Whole-gallery downloads', dl.downloadAll || 0)
        + row('Single downloads', dl.itemTotal || 0)
        + row('Last download', when(dl.lastAt));
      if (g.selection && g.selection.enabled) {
        const sel = a.selections || {};
        html += row('Favorites sent', `${sel.submitted || 0} of ${sel.total || 0} visitors`);
      }
      if ((a.recent || []).length) {
        html += `<div class="d-recent">` + a.recent.map(e =>
          `<div class="d-recent-row"><span>${escapeHtml(e.name)}${e.size === 'web' ? ' · web size' : ''}</span><span>${escapeHtml(shortDate(e.at))}</span></div>`).join('') + `</div>`;
      }
      box.innerHTML = html;
    } catch (_) { box.innerHTML = ''; }
  }

  async function renderDrawerSelections(g) {
    const body = $('drawer-body');
    body.innerHTML = `<div class="drawer-empty">Loading…</div>`;
    const res = await fetch(`/api/admin/client/galleries/${g.id}/selections`);
    if (!res.ok) { if (res.status === 401) checkAuth(); return; }
    const { selections } = await res.json();
    if (!selections.length) { body.innerHTML = `<div class="drawer-empty">Nobody has picked favorites yet.</div>`; return; }
    body.innerHTML = selections.map(s => `
      <div class="comments-video-group sel-group" data-cid="${escapeHtml(s.clientId)}">
        <div class="comments-video-header">
          <span class="comments-video-toggle">▼</span>
          <span class="comments-video-name">${escapeHtml(s.name || 'Not sent yet')}</span>
          <span class="comments-video-count">${s.count}</span>
        </div>
        <div class="comments-video-body">
          <div class="sr-sub" style="margin-bottom:8px;">${s.submittedAt ? 'Sent ' + escapeHtml(shortDate(s.submittedAt)) : 'Still choosing (not sent)'}</div>
          ${s.note ? `<div class="sel-note">${escapeHtml(s.note)}</div>` : ''}
          <div class="sel-actions">
            <button class="link-btn accent" data-sel="copy">Copy file names</button>
            <button class="link-btn muted" data-sel="clear">Clear</button>
          </div>
          <div class="sel-list">${s.items.map(i => `<div class="sel-row">${i.thumbnail ? `<img src="/thumbnails/${encodeURIComponent(i.thumbnail)}" alt="">` : '<span></span>'}<span>${escapeHtml(i.name || i.title)}</span></div>`).join('')}</div>
        </div>
      </div>`).join('');
    body.querySelectorAll('.comments-video-header').forEach(h =>
      h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
    body.querySelectorAll('.sel-group').forEach(grp => {
      const s = selections.find(x => x.clientId === grp.dataset.cid);
      grp.querySelector('[data-sel="copy"]').addEventListener('click', () => { copyText(s.items.map(i => i.name || i.title).join('\n')); });
      grp.querySelector('[data-sel="clear"]').addEventListener('click', async () => {
        if (!await confirmModal({ title: 'Clear favorites', message: `Remove ${s.name ? s.name + '’s' : 'these'} picks? They can pick again.`, okText: 'Clear', danger: true })) return;
        const r = await fetch(`/api/admin/client/galleries/${g.id}/selections/${encodeURIComponent(s.clientId)}`, { method: 'DELETE' });
        if (r.ok) renderDrawerSelections(g); else toast('Could not clear');
      });
    });
  }

  function inheritedReadOnly(g) {
    const eff = effective(g);
    const row = (k, v) => `<div class="inherit-row"><span class="ir-key">${k}</span><span class="ir-val">${v}</span></div>`;
    return `<div class="inherit-list locked">
      ${row('Password', eff.hasPassword ? 'Set' : 'None')}
      ${row('Downloads', eff.downloadsEnabled ? 'On' : 'Off')}
      ${row('Comments', eff.commentingEnabled ? 'On' : 'Off')}
      ${row('Expires', formatDate(eff.expiresAt))}
    </div>`;
  }
  function editableSettings(d) {
    return `<div class="inherit-list">
      <div class="editable-row"><span class="er-key">Password</span><span class="er-ctl"><input type="text" class="d-input" data-field="password" placeholder="${d.hasPasswordExisting ? '(set — type to change)' : 'No password'}" value=""></span></div>
      <div class="switch-row"><div class="sr-text">Downloads</div><button class="switch${d.downloadsEnabled ? ' on' : ''}" data-switch="downloadsEnabled"></button></div>
      <div class="switch-row"><div class="sr-text">Comments</div><button class="switch${d.commentingEnabled ? ' on' : ''}" data-switch="commentingEnabled"></button></div>
      <div class="editable-row"><span class="er-key">Expires</span><span class="er-ctl"><input type="date" class="d-input" data-field="expiresAt" value="${d.expiresAt || ''}" style="max-width:180px;"></span></div>
    </div>`;
  }

  function wireDrawerSettings(g, col) {
    const body = $('drawer-body');
    const d = state.drawer.draft;
    const nameInput = body.querySelector('[data-field="name"]');
    if (nameInput) nameInput.value = d.name || '';
    const folderInput = body.querySelector('[data-field="importFolder"]');
    if (folderInput) folderInput.value = d.importFolder || '';
    body.querySelectorAll('[data-switch]').forEach(sw => sw.addEventListener('click', () => {
      const key = sw.getAttribute('data-switch');
      if (key === 'useCollection') { d.override = !d.override; state.drawer.dirty = true; renderDrawer(); return; }
      d[key] = !sw.classList.contains('on');
      sw.classList.toggle('on');
      state.drawer.dirty = true;
      if (key === 'selEnabled') renderDrawer();
    }));
    body.querySelectorAll('[data-field="sortBy"]').forEach(sel => sel.addEventListener('change', () => renderDrawer()));
    if (g.type === 'proofing') {
      loadDrawerActivity(g);
    }
    body.querySelectorAll('[data-field]').forEach(inp => inp.addEventListener('input', () => {
      d[inp.getAttribute('data-field')] = inp.value;
      state.drawer.dirty = true;
    }));
    body.querySelectorAll('[data-act="clear-cover"]').forEach(b => b.addEventListener('click', () => {
      d.coverId = ''; state.drawer.dirty = true; renderDrawer();
    }));
    body.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => linkAction(g, b.getAttribute('data-link'))));
    body.querySelectorAll('[data-act]').forEach(b => {
      if (b.getAttribute('data-act') === 'clear-cover') return;
      b.addEventListener('click', () => drawerAction(g, col, b.getAttribute('data-act')));
    });
  }

  async function linkAction(g, act) {
    const baseUrl = window.location.origin;
    const url = baseUrl + '/gallery/' + g.token;
    if (act === 'copy') { copyText(url); }
    else if (act === 'open') { window.open(url, '_blank'); }
    else if (act === 'email') { openMailto(buildGalleryMailto(g)); }
    else if (act === 'edit') {
      const saved = await linkModal({
        title: 'Edit gallery link',
        warning: 'Anyone holding the current link will get "not found" the moment you save. Change this only to put back a link you have already sent out.',
        prefix: baseUrl + '/gallery/',
        value: g.token,
        onSubmit: (token) => saveShareToken('galleries', g.id, token),
      });
      if (saved) { await loadData(); renderAll(); toast('Link updated'); }
    }
    else if (act === 'regen') {
      if (!await confirmModal({ title: 'Regenerate link', message: 'This replaces the link with a new one, and anyone you have already sent the current link to will get "not found". Write the current link down first — Edit can put it back.', okText: 'Regenerate', danger: true })) return;
      const res = await fetch(`/api/admin/client/galleries/${g.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateToken: true }) });
      if (res.ok) { await loadData(); renderAll(); toast('Link regenerated'); }
    }
  }

  async function drawerAction(g, col, act) {
    const d = state.drawer.draft;
    if (act === 'save') {
      const name = (d.name || '').trim();
      if (!name) { toast('Name cannot be empty'); return; }
      const body = { name, active: d.active, importFolder: (d.importFolder || '').trim() };
      if (g.type === 'proofing') {
        body.sort = { by: d.sortBy, dir: d.sortDir };
        body.downloadMode = d.downloadMode;
        body.selection = { enabled: !!d.selEnabled, limit: Math.max(0, parseInt(d.selLimit, 10) || 0) };
        body.watermark = !!d.watermark;
        body.showTitles = !!d.showTitles;
        body.coverId = d.coverId || '';
        if (col) {
          body.overrideCollectionSettings = d.override;
          if (d.override) {
            if (d.password) body.password = d.password;
            body.downloadsEnabled = d.downloadsEnabled;
            body.commentingEnabled = d.commentingEnabled;
            body.expiresAt = d.expiresAt ? new Date(d.expiresAt + 'T23:59:59').toISOString() : null;
          }
        } else {
          if (d.password) body.password = d.password;
          body.downloadsEnabled = d.downloadsEnabled;
          body.commentingEnabled = d.commentingEnabled;
          body.expiresAt = d.expiresAt ? new Date(d.expiresAt + 'T23:59:59').toISOString() : null;
        }
      }
      const res = await fetch(`/api/admin/client/galleries/${g.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        state.drawer.dirty = false;
        await loadData(); initDraft(); renderAll(); renderDrawer();
        toast('Saved');
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Save failed');
      }
    } else if (act === 'delete') {
      // Losing your last portfolio gallery empties the public portfolio page, so
      // say so up front rather than refusing the delete — it is recoverable with
      // New > Portfolio, and a gallery created by accident has to be removable.
      const lastPortfolio = g.type === 'reels' && state.galleries.filter(x => x.type === 'reels').length <= 1;
      const message = lastPortfolio
        ? `Delete "${g.name}"? This cannot be undone. It is your only portfolio gallery, so your public portfolio page will have nothing to show until you create another.`
        : `Delete "${g.name}"? This cannot be undone.`;
      if (!await confirmModal({ title: 'Delete gallery', message, okText: 'Delete', danger: true })) return;
      const res = await fetch(`/api/admin/client/galleries/${g.id}`, { method: 'DELETE' });
      if (!res.ok) {
        // Silence here is how a refused delete used to look like a dead button.
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Delete failed');
        return;
      }
      closeDrawerForce(); state.centreGalleryId = null; contentGid = null; await loadData(); renderAll(); toast('Gallery deleted');
    } else if (act === 'duplicate') {
      toast('Creating copy…');
      // Always a client gallery: the server refuses any other type, and a copy of
      // a leftover portfolio gallery would have nowhere to live here.
      const res = await fetch('/api/admin/client/galleries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: g.name + ' (copy)', type: 'proofing' }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || `Duplicate failed (HTTP ${res.status})`);
        return;
      }
      if (col && (col.type || 'proofing') === 'proofing') {
        const ng = await res.json();
        const merged = [...(col.galleryIds || []), ng.id];
        await fetch(`/api/admin/client/collections/${col.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: merged }) });
      }
      await loadData(); renderAll(); toast('Duplicated (metadata only — items not copied)');
    } else if (act === 'move') {
      addCurrentToCollection();
    }
  }

  async function addCurrentToCollection() {
    const g = currentDrawerGallery();
    if (!g) return;
    const options = [{ value: '', label: '— None (ungrouped) —' }, ...state.collections.map(c => ({ value: c.id, label: c.name }))];
    const colId = await promptModal({ title: 'Move to collection', okText: 'Move', field: { type: 'select', label: 'Collection', options } });
    if (colId === null) return;
    // remove from any current collection, add to the chosen one
    for (const c of state.collections) {
      const has = (c.galleryIds || []).includes(g.id);
      if (has && c.id !== colId) {
        await fetch(`/api/admin/client/collections/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: c.galleryIds.filter(x => x !== g.id) }) });
      }
    }
    if (colId) {
      const target = state.collections.find(c => c.id === colId);
      if (target && !(target.galleryIds || []).includes(g.id)) {
        await fetch(`/api/admin/client/collections/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: [...(target.galleryIds || []), g.id] }) });
      }
    }
    await loadData(); initDraft(); renderAll(); renderDrawer();
    toast('Moved');
  }

  // Sign client emails with whatever this site is branded as in Settings >
  // Header, so an unconfigured install doesn't sign with someone else's name.
  function signOff() {
    const name = siteNameForEmail();
    return name ? `\nThanks,\n${name}` : `\nThanks`;
  }
  function siteNameForEmail() {
    return (headerConfig && (headerConfig.siteName || (headerConfig.logo || {}).text)) || '';
  }
  // Matches the server's emailSubject(): "<Site> — <what this is>: <which one>",
  // so every message from this install reads the same way in an inbox.
  function mailSubject(kind, detail) {
    const site = siteNameForEmail();
    const head = site ? `${site} — ${kind}` : kind;
    return detail ? `${head}: ${detail}` : head;
  }

  function buildGalleryMailto(g) {
    if (!g || !g.token) return null;
    const url = window.location.origin + '/gallery/' + g.token;
    const subject = mailSubject('Gallery link', g.name);
    const pwLine = effective(g).hasPassword ? `\nPassword: [enter the gallery password here]\n` : '';
    const body = `Hello,\n\nYour gallery is ready.\n\n${url}\n${pwLine}${signOff()}`;
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  function openMailto(mailto) {
    if (!mailto) return;
    const a = document.createElement('a');
    a.href = mailto; a.target = '_blank'; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // ==========================================================================
  // Drawer: Content tab (ported item engine)
  // ==========================================================================
  let contentGid = null;
  let contentItems = [];
  let contentSortable = null;
  let contentSort = { by: 'custom', dir: 'asc' };
  let contentCoverId = null;
  const SORT_NAMES = { name: 'file name', captured: 'capture time', added: 'date added' };

  async function loadContent() {
    if (!contentGid) return;
    const res = await fetch(`/api/admin/client/galleries/${contentGid}/items`);
    if (!res.ok) { if (res.status === 401) checkAuth(); return; }
    const data = await res.json();
    contentItems = Array.isArray(data) ? data : (data.items || []);
    contentSort = (data && data.sort) || { by: 'custom', dir: 'asc' };
    contentCoverId = (data && data.coverId) || null;
    const stats = (data && data.stats) || {};
    renderContentItems(contentItems, stats);
  }

  function renderContentItems(items, stats) {
    const list = $('content-list');
    if (!list) return;
    const dlItems = (stats && stats.downloads && stats.downloads.items) || {};
    const isPortfolio = (state.galleries.find(g => g.id === contentGid) || {}).type === 'reels';
    if (!items.length) { list.innerHTML = `<div class="drawer-empty">No items yet. Use “Add files”.</div>`; return; }
    const sorted = contentSort.by !== 'custom' && !isPortfolio;
    list.classList.toggle('is-sorted', sorted);
    const sortNote = sorted
      ? `<div class="sort-note">Shown by ${SORT_NAMES[contentSort.by]} (${contentSort.dir === 'desc' ? 'descending' : 'ascending'}). Set the order back to “My order” in Settings to drag items.</div>`
      : '';
    list.innerHTML = sortNote + items.map(entry => {
      if (entry.type === 'header') {
        return `<div class="admin-header-item" data-id="${entry.id}" data-type="header">
          <span class="drag-handle">≡</span>
          <input type="text" class="title-input header-text-input" value="${escapeHtml(entry.text)}">
          <button class="btn-icon delete-btn" title="Delete header">×</button>
        </div>`;
      }
      const isPhoto = entry.type === 'photo';
      const thumbSrc = entry.thumbnail ? '/thumbnails/' + encodeURIComponent(entry.thumbnail) + '?t=' + Date.now() : '';
      let media;
      if (thumbSrc) media = `<img src="${thumbSrc}" class="admin-thumb">`;
      else if (isPhoto) media = `<img src="/uploads/${encodeURIComponent(entry.filename)}" class="admin-thumb">`;
      else media = `<video src="/uploads/${encodeURIComponent(entry.filename)}" muted preload="metadata" class="admin-thumb"></video>`;
      const dlCount = dlItems[entry.id] || 0;
      return `<div class="admin-video-item${entry.id === selectedItemId ? ' selected' : ''}" data-id="${entry.id}">
        <span class="drag-handle">≡</span>
        <button class="thumb-play" title="Preview">${media}<span class="thumb-play-icon">${isPhoto ? '⤢' : '▶'}</span></button>
        <input type="text" class="title-input" value="${escapeHtml(entry.title)}">
        <span class="video-dl-count" title="${dlCount} downloads">↓ ${dlCount}</span>
        ${isPortfolio || entry.type !== 'photo' && entry.type !== 'video' ? '' : `<button class="btn-icon cover-btn${entry.id === contentCoverId ? ' is-cover' : ''}" title="${entry.id === contentCoverId ? 'This is the cover' : 'Use as gallery cover'}">★</button>`}
        <button class="btn-icon replace-btn" title="Replace file">↻</button>
        ${isPortfolio ? `<button class="btn-icon desc-btn${entry.description ? ' has-description' : ''}" title="Caption box">&para;</button>` : ''}
        ${isPhoto ? '' : `<button class="btn-icon cc-btn${(entry.captions && entry.captions.length) ? ' has-captions' : ''}" title="Captions">CC</button>`}
        ${isPhoto ? '' : `<button class="btn-icon thumb-btn" title="Set thumbnail">▦</button>`}
        <button class="btn-icon toggle-vis ${entry.visible ? '' : 'hidden-video'}" title="${entry.visible ? 'Visible' : 'Hidden'}">${entry.visible ? '◉' : '○'}</button>
        <button class="btn-icon delete-btn" title="Delete">×</button>
      </div>`;
    }).join('');
    if (contentSortable) { try { contentSortable.destroy(); } catch (_) {} }
    contentSortable = Sortable.create(list, {
      handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
      disabled: sorted,
      onEnd: async () => {
        const order = Array.from(list.querySelectorAll('.admin-video-item, .admin-header-item')).map(i => i.dataset.id);
        await fetch(`/api/admin/client/galleries/${contentGid}/order`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
      },
    });
  }

  // ==========================================================================
  // Item preview player
  //
  // Click a thumbnail to play it, or select a row and press Space. Once open,
  // ← / → step through the gallery so a whole shoot can be reviewed without
  // going back to the list.
  // ==========================================================================
  let selectedItemId = null;
  let previewId = null;
  const previewModal = $('preview-modal');
  const previewVideo = $('preview-video');
  const previewPhoto = $('preview-photo');

  function playableItems() { return contentItems.filter(i => i.type !== 'header'); }
  function previewIsOpen() { return !previewModal.hidden; }

  function selectItem(id, scroll) {
    selectedItemId = id;
    document.querySelectorAll('.admin-video-item').forEach(el =>
      el.classList.toggle('selected', el.dataset.id === id));
    if (scroll) {
      const el = document.querySelector(`.admin-video-item[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function moveSelection(delta) {
    const items = playableItems();
    if (!items.length) return;
    const cur = items.findIndex(i => i.id === selectedItemId);
    const next = cur < 0 ? (delta > 0 ? 0 : items.length - 1)
      : Math.min(items.length - 1, Math.max(0, cur + delta));
    selectItem(items[next].id, true);
  }

  function openPreview(id) {
    const item = contentItems.find(i => i.id === id);
    if (!item || item.type === 'header') return;
    previewId = id;
    selectItem(id, true);
    const items = playableItems();
    const idx = items.findIndex(i => i.id === id);
    $('preview-title').textContent = item.title || item.filename || '';
    $('preview-pos').textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
    $('preview-prev').hidden = items.length < 2;
    $('preview-next').hidden = items.length < 2;

    const src = '/uploads/' + encodeURIComponent(item.filename);
    if (item.type === 'photo') {
      previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo.load();
      previewVideo.hidden = true;
      previewPhoto.src = item.proxy ? '/proxies/' + encodeURIComponent(item.proxy) : src;
      previewPhoto.hidden = false;
    } else {
      previewPhoto.hidden = true; previewPhoto.removeAttribute('src');
      previewVideo.hidden = false;
      previewVideo.src = src;
      previewVideo.play().catch(() => {});
    }
    $('preview-hint').textContent = [
      item.type === 'photo' ? null : 'Space play/pause',
      items.length > 1 ? '← → previous/next' : null,
      'Esc close',
    ].filter(Boolean).join(' · ');
    previewModal.hidden = false;
  }

  function closePreview() {
    previewModal.hidden = true;
    previewVideo.pause();
    previewVideo.removeAttribute('src'); previewVideo.load();
    previewPhoto.removeAttribute('src');
    previewId = null;
  }

  function stepPreview(delta) {
    const items = playableItems();
    if (items.length < 2) return;
    const cur = items.findIndex(i => i.id === previewId);
    if (cur < 0) return;
    openPreview(items[(cur + delta + items.length) % items.length].id);
  }

  // The title field fills most of a row, so clicking it is the usual way a row
  // gets "picked" — keep selection in step with it.
  document.addEventListener('focusin', (e) => {
    const row = e.target.closest && e.target.closest('.admin-video-item');
    if (row) selectItem(row.dataset.id);
  });

  $('preview-close').addEventListener('click', closePreview);
  previewModal.querySelector('.preview-backdrop').addEventListener('click', closePreview);
  $('preview-prev').addEventListener('click', () => stepPreview(-1));
  $('preview-next').addEventListener('click', () => stepPreview(1));

  const isSpace = (e) => e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space';

  document.addEventListener('keydown', (e) => {
    if (!e.target || typeof e.target.closest !== 'function') return;
    if (previewIsOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); closePreview(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepPreview(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepPreview(1); }
      else if (isSpace(e)) {
        // The <video> handles Space itself once focused; only take over when
        // focus is elsewhere, so we never toggle play twice per press.
        if (document.activeElement === previewVideo) return;
        e.preventDefault();
        if (!previewVideo.hidden) { previewVideo.paused ? previewVideo.play().catch(() => {}) : previewVideo.pause(); }
      }
      return;
    }
    // Escape out of a title field so the row it belongs to can be played
    // straight away with Space.
    if (e.key === 'Escape' && e.target.closest('.admin-video-item .title-input')) { e.target.blur(); return; }
    // List-level shortcuts — never while typing in a field or in another modal.
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal:not([hidden])')) return;
    if (thumbPicker.classList.contains('open')) return;
    if (!document.getElementById('content-list')) return;
    if (isSpace(e)) {
      if (!selectedItemId) return;
      e.preventDefault();
      openPreview(selectedItemId);
    } else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter' && selectedItemId) { e.preventDefault(); openPreview(selectedItemId); }
  });

  // Delegated content interactions (survive drawer re-renders)
  document.addEventListener('change', async (e) => {
    if (!e.target.classList || !e.target.classList.contains('title-input')) return;
    const container = e.target.closest('.admin-video-item, .admin-header-item');
    if (!container || !contentGid) return;
    const id = container.dataset.id;
    if (container.dataset.type === 'header') {
      await fetch(`/api/admin/client/galleries/${contentGid}/headers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: e.target.value }) });
    } else {
      await fetch(`/api/admin/client/galleries/${contentGid}/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: e.target.value }) });
    }
  });
  document.addEventListener('click', async (e) => {
    const play = e.target.closest('.thumb-play');
    if (play) { e.preventDefault(); openPreview(play.closest('.admin-video-item').dataset.id); return; }
    const row = e.target.closest('.admin-video-item');
    if (row && !e.target.closest('button, input, .drag-handle')) selectItem(row.dataset.id);

    const vis = e.target.closest('.toggle-vis');
    if (vis && contentGid) {
      const item = vis.closest('.admin-video-item'); const id = item.dataset.id;
      const newVisible = vis.classList.contains('hidden-video');
      const res = await fetch(`/api/admin/client/galleries/${contentGid}/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: newVisible }) });
      if (res.ok) { vis.classList.toggle('hidden-video', !newVisible); vis.textContent = newVisible ? '◉' : '○'; vis.title = newVisible ? 'Visible' : 'Hidden'; }
      return;
    }
    const del = e.target.closest('.admin-video-item .delete-btn, .admin-header-item .delete-btn');
    if (del && contentGid) {
      const item = del.closest('.admin-video-item, .admin-header-item'); const id = item.dataset.id;
      const isHeader = item.dataset.type === 'header';
      if (!await confirmModal({ title: isHeader ? 'Delete header' : 'Delete item', message: isHeader ? 'Delete this section header?' : 'Delete this item? This cannot be undone.', okText: 'Delete', danger: true })) return;
      const url = isHeader ? `/api/admin/client/galleries/${contentGid}/headers/${id}` : `/api/admin/client/galleries/${contentGid}/items/${id}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) item.remove();
      return;
    }
    const cov = e.target.closest('.cover-btn');
    if (cov && contentGid) {
      const id = cov.closest('.admin-video-item').dataset.id;
      const makeCover = id !== contentCoverId;
      const res = await fetch(`/api/admin/client/galleries/${contentGid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coverId: makeCover ? id : '' }) });
      if (res.ok) {
        contentCoverId = makeCover ? id : null;
        document.querySelectorAll('.cover-btn').forEach(b => b.classList.toggle('is-cover', b.closest('.admin-video-item').dataset.id === contentCoverId));
        toast(makeCover ? 'Cover set' : 'Cover cleared');
        loadData().then(() => {
          if (!state.drawer.galleryId) return;
          if (state.drawer.draft) state.drawer.draft.coverId = contentCoverId || '';
          renderDrawer();
        });
      } else toast('Could not set the cover');
      return;
    }
    const rep = e.target.closest('.replace-btn');
    if (rep && contentGid) {
      replaceVideoId = rep.closest('.admin-video-item').dataset.id;
      $('replace-file-input').click();
      return;
    }
    const desc = e.target.closest('.desc-btn');
    if (desc && contentGid) { editDescription(desc.closest('.admin-video-item').dataset.id); return; }

    const cc = e.target.closest('.cc-btn');
    if (cc && contentGid) { openCaptionsModal(cc.closest('.admin-video-item').dataset.id); return; }
    const th = e.target.closest('.thumb-btn');
    if (th && contentGid) { openThumbForItem(th.closest('.admin-video-item').dataset.id); return; }
  });

  // Replace file
  let replaceVideoId = null;
  $('replace-file-input').addEventListener('change', () => {
    const file = $('replace-file-input').files[0];
    if (!file || !replaceVideoId) return;
    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('load', () => { if (xhr.status >= 200 && xhr.status < 300) loadContent(); else toast('Replace failed'); replaceVideoId = null; $('replace-file-input').value = ''; });
    xhr.addEventListener('error', () => { toast('Replace failed'); replaceVideoId = null; $('replace-file-input').value = ''; });
    xhr.open('PUT', `/api/admin/client/galleries/${contentGid}/items/${replaceVideoId}/replace`);
    xhr.send(fd);
  });

  // ==========================================================================
  // Drawer: Comments tab (ported)
  // ==========================================================================
  async function renderDrawerComments(g) {
    const body = $('drawer-body');
    body.innerHTML = `<div class="drawer-empty">Loading…</div>`;
    const res = await fetch(`/api/admin/client/galleries/${g.id}/comments`);
    if (!res.ok) { if (res.status === 401) checkAuth(); return; }
    const comments = await res.json();
    if (!comments.length) { body.innerHTML = `<div class="drawer-empty">No comments yet.</div>`; return; }
    const grouped = {}; const order = [];
    comments.forEach(c => {
      const key = c.videoId || c.videoTitle || 'Unknown';
      if (!grouped[key]) { grouped[key] = { title: c.videoTitle || 'Unknown Video', comments: [] }; order.push(key); }
      grouped[key].comments.push(c);
    });
    body.innerHTML = order.map(key => {
      const grp = grouped[key];
      return `<div class="comments-video-group">
        <div class="comments-video-header">
          <span class="comments-video-toggle">▼</span>
          <span class="comments-video-name">${escapeHtml(grp.title)}</span>
          <span class="comments-video-count">${grp.comments.length}</span>
        </div>
        <div class="comments-video-body">${grp.comments.map(c => `
          <div class="comment-item">
            <div class="comment-header"><strong>${escapeHtml(c.name)}</strong><span class="comment-timestamp">@ ${formatTime(c.timestamp)}</span></div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
            <div class="comment-date">${new Date(c.createdAt).toLocaleString()}</div>
          </div>`).join('')}</div>
      </div>`;
    }).join('');
    body.querySelectorAll('.comments-video-header').forEach(h =>
      h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
  }
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }

  // ==========================================================================
  // Upload screen + module-level queue engine
  // ==========================================================================
  const CONCURRENCY = 3;
  const MAX_RETRIES = 3;
  // Files at or under this go up as one multipart POST (one round trip, no
  // session bookkeeping). Anything bigger uses the resumable chunked API so a
  // multi-GB video never has to survive a single request under the host's
  // post_max_size / timeout limits.
  const CHUNK_THRESHOLD_BYTES = 64 * 1024 * 1024;
  const PREFERRED_CHUNK_BYTES = 16 * 1024 * 1024;

  function setUploadDestinationForGallery(g) {
    state.upload.destination = { collectionId: g.collectionId || '', galleryId: g.id };
    savePrefs();
  }
  function renderUpload() {
    // Destination selectors
    const colSel = $('dest-collection'), galSel = $('dest-gallery');
    const dest = state.upload.destination;
    colSel.innerHTML = `<option value="">Ungrouped</option>` +
      state.collections.map(c => `<option value="${c.id}"${dest.collectionId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    populateDestGalleries();
    renderQueues();
  }
  function populateDestGalleries() {
    const galSel = $('dest-gallery');
    const dest = state.upload.destination;
    const inCol = state.galleries.filter(g => g.active !== false && (dest.collectionId ? g.collectionId === dest.collectionId : !g.collectionId));
    if (!inCol.length) { galSel.innerHTML = `<option value="">— no galleries —</option>`; state.upload.destination.galleryId = ''; return; }
    if (!inCol.find(g => g.id === dest.galleryId)) state.upload.destination.galleryId = inCol[0].id;
    galSel.innerHTML = inCol.map(g => `<option value="${g.id}"${state.upload.destination.galleryId === g.id ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
  }
  $('dest-collection').addEventListener('change', (e) => { state.upload.destination.collectionId = e.target.value; state.upload.destination.galleryId = ''; populateDestGalleries(); savePrefs(); });
  $('dest-gallery').addEventListener('change', (e) => { state.upload.destination.galleryId = e.target.value; savePrefs(); });
  $('dest-new-gallery').addEventListener('click', async () => {
    const name = await promptModal({ title: 'New gallery', okText: 'Create', field: { type: 'text', label: 'Gallery name', value: 'Client Gallery' } });
    if (!name) return;
    const res = await fetch('/api/admin/client/galleries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type: 'proofing' }) });
    if (!res.ok) { toast('Create failed'); return; }
    const g = await res.json();
    if (state.upload.destination.collectionId) {
      const col = state.collections.find(c => c.id === state.upload.destination.collectionId);
      if (col) await fetch(`/api/admin/client/collections/${col.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: [...(col.galleryIds || []), g.id] }) });
    }
    await loadData();
    state.upload.destination.galleryId = g.id;
    renderUpload(); renderRail();
    toast('Gallery created');
  });
  $('dest-import').addEventListener('click', () => { contentGid = state.upload.destination.galleryId; if (!contentGid) { toast('Pick a destination gallery first'); return; } openImportModal(); });

  // Drag & drop
  const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ALLOWED_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
  function filterMediaFiles(fileList) {
    return Array.from(fileList).filter(f => ALLOWED_TYPES.includes(f.type) || ALLOWED_EXTS.includes((f.name.toLowerCase().match(/\.[^.]+$/) || [''])[0]));
  }
  const dropZone = $('drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const files = filterMediaFiles(e.dataTransfer.files);
    if (files.length) enqueueFiles(files);
  });
  $('file-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length) enqueueFiles(files);
    e.target.value = '';
  });

  function titleFromFilename(fn) {
    return fn.replace(/\.[^.]+$/, '').replace(/^\d{10,}-/, '').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
  }
  function enqueueFiles(files, gid) {
    gid = gid || state.upload.destination.galleryId;
    if (!gid) { toast('Pick a destination gallery first'); return; }
    files.forEach(file => {
      state.upload.queue.push({
        id: 'u' + Date.now() + Math.random().toString(36).slice(2, 6),
        file, name: file.name, size: file.size, title: titleFromFilename(file.name),
        galleryId: gid, pct: 0, status: 'waiting', error: '', retries: 0, xhr: null, uploaded: null,
        // Chunked-upload bookkeeping; unused for small multipart uploads.
        uploadId: null, sent: 0, chunkBytes: PREFERRED_CHUNK_BYTES,
      });
    });
    renderQueues(); pumpQueue();
  }

  function pumpQueue() {
    const active = state.upload.queue.filter(i => i.status === 'uploading').length;
    let slots = CONCURRENCY - active;
    for (const item of state.upload.queue) {
      if (slots <= 0) break;
      if (item.status === 'waiting') { startUpload(item); slots--; }
    }
    updateUploadsCount();
  }
  function startUpload(item) {
    if (item.size > CHUNK_THRESHOLD_BYTES) { startChunkedUpload(item); return; }
    startMultipartUpload(item);
  }

  // Promise wrapper around XHR so the chunked loop below reads sequentially.
  // Keeps `item.xhr` pointed at the in-flight request so Pause/Cancel can abort
  // it, and distinguishes an abort (user action) from a real failure.
  function xhrSend({ method, url, body, headers, item, onProgress }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (item) item.xhr = xhr;
      xhr.open(method, url);
      Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      if (onProgress) xhr.upload.addEventListener('progress', onProgress);
      const done = () => { if (item) item.xhr = null; };
      xhr.addEventListener('load', () => {
        done();
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) { resolve(data); return; }
        const err = new Error((data && data.error) || `HTTP ${xhr.status}`);
        err.status = xhr.status;
        reject(err);
      });
      xhr.addEventListener('error', () => { done(); reject(new Error('Connection dropped')); });
      xhr.addEventListener('abort', () => { done(); const e = new Error('Aborted'); e.aborted = true; reject(e); });
      xhr.send(body);
    });
  }

  // Resumable upload: initiate a session, PUT contiguous chunks, then finalize.
  // A dropped connection leaves `item.sent` at the last byte the server
  // acknowledged, so a retry picks up from there instead of restarting.
  async function startChunkedUpload(item) {
    item.status = 'uploading'; item.error = '';
    renderQueues();
    try {
      if (!item.uploadId) {
        const init = await xhrSend({
          method: 'POST', url: '/api/admin/uploads', item,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: item.name, totalSize: item.size, contentType: item.file.type || '' }),
        });
        item.uploadId = init.uploadId;
        item.chunkBytes = Math.min(init.chunkMaxBytes || PREFERRED_CHUNK_BYTES, PREFERRED_CHUNK_BYTES);
        item.sent = 0;
      }

      while (item.sent < item.size) {
        // Pause/cancel between chunks: bail without touching the session so a
        // later Retry resumes from the same byte offset.
        if (item.status !== 'uploading') return;
        const start = item.sent;
        const end = Math.min(start + item.chunkBytes, item.size) - 1;
        const ack = await xhrSend({
          method: 'PUT', url: `/api/admin/uploads/${item.uploadId}/chunk`, item,
          headers: { 'Content-Range': `bytes ${start}-${end}/${item.size}`, 'Content-Type': 'application/octet-stream' },
          body: item.file.slice(start, end + 1),
          onProgress: (e) => {
            if (!e.lengthComputable) return;
            item.pct = Math.round((start + e.loaded) / item.size * 100);
            updateQueueProgress(item);
          },
        });
        item.sent = typeof ack.received === 'number' ? ack.received : end + 1;
        item.pct = Math.round(item.sent / item.size * 100);
        updateQueueProgress(item);
        // Real progress was made, so a later stall gets a fresh retry budget
        // rather than burning through it over a multi-hour transfer.
        item.retries = 0;
      }

      const uploaded = await xhrSend({
        method: 'POST', url: `/api/admin/uploads/${item.uploadId}/finalize`, item,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.portfolioGalleryId
          ? { target: 'portfolio', galleryId: item.portfolioGalleryId }
          : { target: 'client', galleryId: item.galleryId, title: item.title }),
      });
      item.uploadId = null;
      item.pct = 100; item.status = 'done'; item.uploaded = uploaded;
      renderQueues();
      if (uploaded && uploaded.type === 'video' && !uploaded.thumbnail) autoGenerateVideoThumbnail(uploaded, item.galleryId).catch(() => {});
      refreshCountsSoon();
    } catch (err) {
      if (err.aborted) return;
      // Session swept by the server's 24 h cleanup (or never created) — start over.
      if (err.status === 404) { item.uploadId = null; item.sent = 0; item.pct = 0; }
      failItem(item, err.message || 'Upload failed');
    } finally {
      pumpQueue();
    }
  }

  function startMultipartUpload(item) {
    item.status = 'uploading'; item.error = '';
    const fd = new FormData(); fd.append('file', item.file); fd.append('title', item.title);
    const xhr = new XMLHttpRequest(); item.xhr = xhr;
    xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) { item.pct = Math.round(e.loaded / e.total * 100); updateQueueProgress(item); } });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        item.pct = 100; item.status = 'done';
        try { item.uploaded = JSON.parse(xhr.responseText); } catch (_) {}
        renderQueues();
        if (item.uploaded && item.uploaded.type === 'video' && !item.uploaded.thumbnail) autoGenerateVideoThumbnail(item.uploaded, item.galleryId).catch(() => {});
        refreshCountsSoon();
      } else {
        let detail = `HTTP ${xhr.status}`;
        try { const d = JSON.parse(xhr.responseText); if (d.error) detail = d.error; } catch (_) {}
        failItem(item, detail);
      }
      item.xhr = null; pumpQueue();
    });
    xhr.addEventListener('error', () => { failItem(item, 'Connection dropped at ' + item.pct + '%'); item.xhr = null; pumpQueue(); });
    xhr.open('POST', `/api/admin/client/galleries/${item.galleryId}/items`);
    xhr.send(fd);
    renderQueues();
  }
  function failItem(item, detail) {
    if (item.retries < MAX_RETRIES) {
      item.retries++; item.status = 'waiting'; item.error = 'Retrying… (' + item.retries + ')';
      renderQueues();
      setTimeout(pumpQueue, 800 * item.retries);
    } else { item.status = 'failed'; item.error = detail; renderQueues(); }
  }
  let _refreshTimer = null;
  function refreshCountsSoon() { clearTimeout(_refreshTimer); _refreshTimer = setTimeout(async () => { await loadData(); renderRail(); if (state.screen === 'library' && !state.centreGalleryId) renderCentre(); if (contentGid) loadContent(); }, 1200); }

  $('queue-pause-all').addEventListener('click', () => { state.upload.queue.forEach(i => { if (i.status === 'uploading' || i.status === 'waiting') { if (i.xhr) i.xhr.abort(); i.status = 'paused'; } }); renderQueues(); });
  $('queue-cancel-all').addEventListener('click', () => {
    state.upload.queue.forEach(i => {
      if (i.xhr) i.xhr.abort();
      // Don't leave half-written .part files sitting on the host until the
      // server's 24 h sweep picks them up.
      if (i.uploadId) fetch(`/api/admin/uploads/${i.uploadId}`, { method: 'DELETE' }).catch(() => {});
    });
    state.upload.queue = [];
    renderQueues();
  });

  // The queue is module-level state; it renders into the Upload screen and,
  // when a gallery is open, into that gallery view's inline queue too.
  function renderQueues() { renderUploadScreenQueue(); renderInlineQueue(); updateUploadsCount(); }

  function renderUploadScreenQueue() {
    const head = $('queue-head'), list = $('queue-list');
    if (!head || !list) return;
    const q = state.upload.queue;
    if (!q.length) { head.hidden = true; list.innerHTML = ''; return; }
    head.hidden = false;
    const total = q.length;
    const done = q.filter(i => i.status === 'done').length;
    const remainBytes = q.filter(i => i.status !== 'done').reduce((s, i) => s + (i.size || 0), 0);
    $('queue-stats').textContent = `${done} of ${total}${remainBytes ? ' · ' + fmtBytes(remainBytes) + ' left' : ''}`;
    list.innerHTML = q.map(queueRowHtml).join('');
    wireQueueRows(list, q);
  }

  function renderInlineQueue() {
    const el = $('gv-queue');
    if (!el) return;
    const items = state.upload.queue.filter(i => i.galleryId === state.centreGalleryId && i.status !== 'done');
    el.innerHTML = items.map(queueRowHtml).join('');
    wireQueueRows(el, items);
  }

  function wireQueueRows(scope, items) {
    items.forEach(item => {
      const row = scope.querySelector(`[data-q="${item.id}"]`); if (!row) return;
      const act = row.querySelector('.qr-action button');
      if (act) act.addEventListener('click', () => queueRowAction(item, act.getAttribute('data-qa')));
    });
  }

  function updateQueueProgress(item) {
    document.querySelectorAll(`[data-q="${item.id}"]`).forEach(row => {
      const fill = row.querySelector('.qr-fill'); if (fill) fill.style.width = item.pct + '%';
    });
  }
  function queueRowHtml(item) {
    const statusText = { waiting: 'Waiting', uploading: 'Uploading', done: 'Done', failed: 'Failed', paused: 'Paused' }[item.status];
    const sub = item.status === 'failed' ? `<div class="qr-sub err">${escapeHtml(item.error || 'Failed')}</div>`
      : item.error && item.status === 'waiting' ? `<div class="qr-sub err">${escapeHtml(item.error)}</div>`
      : item.uploadId && item.status !== 'done' ? `<div class="qr-sub">${fmtBytes(item.sent)} of ${fmtBytes(item.size)} · resumable</div>`
      : `<div class="qr-sub">${fmtBytes(item.size)}</div>`;
    let action = '';
    if (item.status === 'uploading') action = `<button data-qa="pause">Pause</button>`;
    else if (item.status === 'failed' || item.status === 'paused') action = `<button data-qa="retry">Retry</button>`;
    else if (item.status === 'done' && item.uploaded && item.uploaded.type === 'video') action = `<button data-qa="frame">Frame</button>`;
    return `<div class="queue-row" data-q="${item.id}">
      <span class="qr-thumb"></span>
      <div class="qr-file"><div class="qr-name">${escapeHtml(item.name)}</div>${sub}</div>
      <div class="qr-track"><div class="qr-fill" style="width:${item.pct}%"></div></div>
      <div class="qr-status ${item.status}">${statusText}</div>
      <div class="qr-action">${action}</div>
    </div>`;
  }
  function queueRowAction(item, act) {
    if (act === 'pause') { if (item.xhr) item.xhr.abort(); item.status = 'paused'; renderQueues(); }
    else if (act === 'retry') {
      item.retries = 0;
      // A chunked upload resumes from the last acknowledged byte, so keep the
      // bar where it was instead of snapping back to zero.
      item.pct = item.uploadId && item.size ? Math.round(item.sent / item.size * 100) : 0;
      item.status = 'waiting'; item.error = '';
      renderQueues(); pumpQueue();
    }
    else if (act === 'frame') { openThumbForUploaded(item); }
  }

  // ==========================================================================
  // Thumbnail picker (ported)
  // ==========================================================================
  const thumbPicker = $('thumb-picker');
  const thumbVideo = $('thumb-video');
  const thumbScrubber = $('thumb-scrubber');
  const thumbTime = $('thumb-time');
  const thumbCanvas = $('thumb-canvas');
  const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
  let thumbGid = null, thumbVideoId = null, thumbSaveFn = null;

  function openThumbForItem(videoId) {
    thumbGid = contentGid; thumbVideoId = videoId; thumbSaveFn = null;
    const item = contentItems.find(v => v.id === videoId);
    if (item && item.filename) openThumbPicker('/uploads/' + encodeURIComponent(item.filename));
  }
  function openThumbForUploaded(queueItem) {
    thumbGid = queueItem.galleryId; thumbVideoId = queueItem.uploaded.id; thumbSaveFn = null;
    openThumbPicker('/uploads/' + encodeURIComponent(queueItem.uploaded.filename));
  }
  // The portfolio screen (a separate file, no gallery/video ids of its own)
  // reaches this same scrubber through the bridge, with its own save step —
  // everything up to "here's a JPEG blob" is identical either way.
  function openThumbPickerFor(src, saveFn, opts = {}) {
    thumbGid = null; thumbVideoId = null; thumbSaveFn = saveFn;
    thumbPicker.querySelector('h3').textContent = opts.title || 'Choose thumbnail frame';
    $('thumb-capture-btn').textContent = opts.buttonLabel || 'Set Thumbnail';
    openThumbPicker(src);
  }
  function openThumbPicker(src) {
    thumbVideo.src = src;
    thumbPicker.classList.add('open');
    thumbScrubber.value = 0; thumbTime.textContent = '0:00';
    thumbVideo.addEventListener('loadedmetadata', function onMeta() {
      thumbScrubber.max = thumbVideo.duration; thumbVideo.currentTime = 0.1;
      thumbVideo.removeEventListener('loadedmetadata', onMeta);
    });
  }
  thumbScrubber.addEventListener('input', () => { thumbVideo.currentTime = parseFloat(thumbScrubber.value); });
  thumbVideo.addEventListener('seeked', () => {
    drawThumbFrame();
    const t = thumbVideo.currentTime;
    thumbTime.textContent = Math.floor(t / 60) + ':' + Math.floor(t % 60).toString().padStart(2, '0');
  });
  function drawThumbFrame() {
    const vw = thumbVideo.videoWidth || 16, vh = thumbVideo.videoHeight || 9;
    const cA = thumbCanvas.width / thumbCanvas.height, vA = vw / vh;
    let dw, dh, dx, dy;
    if (vA > cA) { dw = thumbCanvas.width; dh = dw / vA; dx = 0; dy = (thumbCanvas.height - dh) / 2; }
    else { dh = thumbCanvas.height; dw = dh * vA; dx = (thumbCanvas.width - dw) / 2; dy = 0; }
    thumbCtx.fillStyle = '#000'; thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
    thumbCtx.imageSmoothingQuality = 'high';
    thumbCtx.drawImage(thumbVideo, dx, dy, dw, dh);
  }
  async function captureFrameAsJpegBlob(videoEl) {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) throw new Error('Video not ready');
    const w = Math.min(vw, 640), h = Math.round(w * vh / vw);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(videoEl, 0, 0, w, h);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('export failed')), 'image/jpeg', 0.88));
  }
  async function uploadThumbnailBlob(gid, videoId, blob) {
    const res = await fetch(`/api/admin/client/galleries/${gid}/items/${videoId}/poster`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to save thumbnail'); }
  }
  $('thumb-capture-btn').addEventListener('click', async () => {
    const btn = $('thumb-capture-btn'); const savedLabel = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const blob = await captureFrameAsJpegBlob(thumbVideo);
      const isPortfolio = !!thumbSaveFn;
      if (isPortfolio) {
        await thumbSaveFn(blob);
      } else {
        await uploadThumbnailBlob(thumbGid, thumbVideoId, blob);
        if (contentGid === thumbGid) loadContent();
      }
      closeThumbPicker();
      toast(isPortfolio ? 'Poster set' : 'Thumbnail set');
    }
    catch (err) { toast(err.message || 'Failed'); }
    finally { btn.disabled = false; btn.textContent = savedLabel; }
  });
  async function autoGenerateVideoThumbnail(video, gid) {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true;
    v.src = '/uploads/' + encodeURIComponent(video.filename);
    const waitFor = (ev, ms) => new Promise((res, rej) => {
      let done = false; const ok = () => { if (done) return; done = true; res(); }; const er = () => { if (done) return; done = true; rej(new Error(ev)); };
      v.addEventListener(ev, ok, { once: true }); v.addEventListener('error', er, { once: true });
      setTimeout(() => { if (!done) { done = true; rej(new Error('timeout')); } }, ms);
    });
    try {
      await waitFor('loadedmetadata', 30000);
      const dur = v.duration || 0; const upper = Math.min(10, isFinite(dur) && dur > 0 ? dur : 10);
      const lo = Math.min(0.3, upper); v.currentTime = lo + Math.random() * Math.max(0, upper - lo);
      await waitFor('seeked', 15000);
      const blob = await captureFrameAsJpegBlob(v); await uploadThumbnailBlob(gid, video.id, blob);
      if (contentGid === gid) loadContent();
    } finally { v.removeAttribute('src'); v.load(); }
  }
  $('thumb-cancel-btn').addEventListener('click', closeThumbPicker);
  thumbPicker.addEventListener('click', (e) => { if (e.target === thumbPicker) closeThumbPicker(); });
  function closeThumbPicker() { thumbPicker.classList.remove('open'); thumbVideo.pause(); thumbVideo.src = ''; thumbVideoId = null; thumbSaveFn = null; }

  // ==========================================================================
  // Captions modal (ported)
  // ==========================================================================
  const CAPTION_LANGUAGES = [
    { code: 'en', label: 'English' }, { code: 'es', label: 'Español' }, { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' }, { code: 'it', label: 'Italiano' }, { code: 'pt', label: 'Português' },
    { code: 'pt-br', label: 'Português (Brasil)' }, { code: 'nl', label: 'Nederlands' }, { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' }, { code: 'ko', label: '한국어' }, { code: 'ar', label: 'العربية' },
    { code: 'hi', label: 'हिन्दी' }, { code: 'ru', label: 'Русский' },
  ];
  let captionsVideoId = null, captionsCtx = null;
  const captionLangSelect = $('caption-lang');
  captionLangSelect.innerHTML = CAPTION_LANGUAGES.map(l => `<option value="${l.code}">${escapeHtml(l.label)} (${l.code})</option>`).join('') + '<option value="__custom__">Other…</option>';
  captionLangSelect.addEventListener('change', () => { $('caption-custom-lang-label').style.display = captionLangSelect.value === '__custom__' ? '' : 'none'; });

  // Caption box text for one portfolio item. Saving an empty box clears it,
  // which is why this checks for null (cancelled) rather than falsiness.
  async function editDescription(itemId) {
    const item = contentItems.find(i => i.id === itemId);
    if (!item) return;
    const text = await promptModal({
      title: 'Caption box',
      sub: 'Shown under the player on the portfolio. Leave blank for none; links become clickable.',
      okText: 'Save',
      field: { type: 'textarea', label: item.title || item.filename || '', rows: 6, maxLength: 2000, value: item.description || '' },
    });
    if (text === null) return;
    const res = await fetch(`/api/admin/client/galleries/${contentGid}/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: text }),
    });
    if (!res.ok) { toast('Could not save caption'); return; }
    await loadContent();
    toast(text.trim() ? 'Caption saved' : 'Caption cleared');
  }

  function openCaptionsModal(videoId) {
    captionsVideoId = videoId; captionsCtx = null;
    $('caption-upload-status').textContent = ''; $('caption-file-input').value = '';
    captionLangSelect.value = CAPTION_LANGUAGES[0].code; $('caption-custom-lang-label').style.display = 'none';
    $('caption-custom-code').value = ''; $('caption-custom-label').value = '';
    const item = contentItems.find(v => v.id === videoId);
    $('captions-modal-title').textContent = item ? '— ' + item.title : '';
    renderCaptionsList();
    $('captions-modal').hidden = false;
  }
  // The portfolio screen reaches this same modal through the bridge: its
  // videos aren't in contentItems and its caption routes take a filename
  // instead of a video id, so the gallery-specific bits — which item to
  // show, where to POST/DELETE, what field name the upload goes under, how
  // to refresh afterward — all come from `ctx` instead of being assumed.
  function openCaptionsModalFor(ctx) {
    captionsVideoId = null; captionsCtx = ctx;
    $('caption-upload-status').textContent = ''; $('caption-file-input').value = '';
    captionLangSelect.value = CAPTION_LANGUAGES[0].code; $('caption-custom-lang-label').style.display = 'none';
    $('caption-custom-code').value = ''; $('caption-custom-label').value = '';
    $('captions-modal-title').textContent = ctx.title || '';
    renderCaptionsList();
    $('captions-modal').hidden = false;
  }
  function renderCaptionsList() {
    const item = captionsCtx ? captionsCtx.getItem() : contentItems.find(v => v.id === captionsVideoId);
    const captions = (item && item.captions) || [];
    const el = $('captions-list');
    if (!captions.length) { el.innerHTML = `<p class="setting-hint">No captions yet.</p>`; return; }
    el.innerHTML = captions.map(c => `<div class="editable-row"><span class="er-key">${escapeHtml(c.label || c.lang)} <span style="color:var(--text-5);">(${escapeHtml(c.lang)})</span></span><button class="btn-icon caption-track-remove" data-lang="${escapeHtml(c.lang)}">×</button></div>`).join('');
  }
  $('captions-close-btn').addEventListener('click', () => { $('captions-modal').hidden = true; captionsVideoId = null; captionsCtx = null; });
  $('captions-modal').querySelector('.modal-backdrop').addEventListener('click', () => { $('captions-modal').hidden = true; captionsVideoId = null; captionsCtx = null; });
  $('captions-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.caption-track-remove'); if (!btn || (!captionsVideoId && !captionsCtx)) return;
    const lang = btn.dataset.lang;
    if (!await confirmModal({ title: 'Remove caption', message: `Remove the "${lang}" caption track?`, okText: 'Remove', danger: true })) return;
    const url = captionsCtx ? `${captionsCtx.deleteBase}/${encodeURIComponent(lang)}` : `/api/admin/client/galleries/${contentGid}/items/${captionsVideoId}/captions/${encodeURIComponent(lang)}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) { if (captionsCtx) await captionsCtx.onChange(); else await loadContent(); renderCaptionsList(); }
    else $('caption-upload-status').textContent = 'Could not remove caption.';
  });
  const captionDrop = $('caption-drop');
  captionDrop.addEventListener('dragover', (e) => { e.preventDefault(); captionDrop.classList.add('drag-over'); });
  captionDrop.addEventListener('dragleave', () => captionDrop.classList.remove('drag-over'));
  captionDrop.addEventListener('drop', (e) => {
    e.preventDefault(); captionDrop.classList.remove('drag-over');
    const file = Array.from(e.dataTransfer.files).find(f => /\.(vtt|srt)$/i.test(f.name));
    if (!file) { $('caption-upload-status').textContent = 'Only .vtt or .srt files are supported.'; return; }
    const dt = new DataTransfer(); dt.items.add(file);
    $('caption-file-input').files = dt.files;
    $('caption-upload-status').textContent = file.name + ' ready — choose a language and click Add Caption.';
  });
  $('caption-upload-btn').addEventListener('click', async () => {
    if (!captionsVideoId && !captionsCtx) return;
    const file = $('caption-file-input').files[0];
    if (!file) { $('caption-upload-status').textContent = 'Choose a .vtt or .srt file first.'; return; }
    let lang, label;
    if (captionLangSelect.value === '__custom__') {
      lang = $('caption-custom-code').value.trim().toLowerCase(); label = $('caption-custom-label').value.trim();
      if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(lang)) { $('caption-upload-status').textContent = 'Enter a valid code (e.g. en or pt-br).'; return; }
    } else { lang = captionLangSelect.value; const k = CAPTION_LANGUAGES.find(l => l.code === lang); label = k ? k.label : lang.toUpperCase(); }
    const fd = new FormData(); fd.append(captionsCtx ? captionsCtx.fileField : 'caption', file); fd.append('lang', lang); fd.append('label', label);
    $('caption-upload-status').textContent = 'Uploading…';
    const url = captionsCtx ? captionsCtx.uploadUrl : `/api/admin/client/galleries/${contentGid}/items/${captionsVideoId}/captions`;
    const res = await fetch(url, { method: 'POST', body: fd });
    if (res.ok) {
      $('caption-file-input').value = ''; $('caption-upload-status').textContent = 'Caption added.';
      if (captionsCtx) await captionsCtx.onChange(); else await loadContent();
      renderCaptionsList();
    } else { const e = await res.json().catch(() => ({})); $('caption-upload-status').textContent = e.error || 'Upload failed.'; }
  });

  // ==========================================================================
  // Import from server modal (ported)
  // ==========================================================================
  const importModal = $('import-modal');
  $('import-cancel-btn').addEventListener('click', () => importModal.hidden = true);
  importModal.querySelector('.modal-backdrop').addEventListener('click', () => importModal.hidden = true);
  async function openImportModal() {
    if (!contentGid) contentGid = state.upload.destination.galleryId;
    if (!contentGid) { toast('Pick a destination gallery first'); return; }
    importModal.hidden = false;
    const listEl = $('import-file-list');
    listEl.innerHTML = '<p class="import-loading">Scanning…</p>';
    $('import-select-all').checked = false; $('import-confirm-btn').disabled = true;
    try {
      const res = await fetch('/api/admin/client/import/files');
      if (!res.ok) throw new Error('scan failed');
      const data = await res.json();
      $('import-path').textContent = data.path;
      if (!data.files.length) { listEl.innerHTML = '<p class="import-empty">No media files found. Upload via FTP to the path above.</p>'; return; }
      listEl.innerHTML = data.files.map(f => `<label class="import-file-row"><input type="checkbox" class="import-file-check" value="${escapeHtml(f.name)}"><span class="import-file-name">${escapeHtml(f.name)}</span><span class="import-file-size">${(f.size / (1024 * 1024)).toFixed(1)} MB</span></label>`).join('');
      updateImportBtn();
    } catch (_) { listEl.innerHTML = '<p class="import-empty">Error scanning import folder.</p>'; }
  }
  $('import-select-all').addEventListener('change', (e) => { $('import-file-list').querySelectorAll('.import-file-check').forEach(c => c.checked = e.target.checked); updateImportBtn(); });
  $('import-file-list').addEventListener('change', (e) => { if (e.target.classList.contains('import-file-check')) updateImportBtn(); });
  function updateImportBtn() {
    const n = $('import-file-list').querySelectorAll('.import-file-check:checked').length;
    $('import-confirm-btn').disabled = n === 0;
    $('import-confirm-btn').textContent = n ? `Import ${n} File${n !== 1 ? 's' : ''}` : 'Import Selected';
  }
  $('import-confirm-btn').addEventListener('click', async () => {
    const filenames = Array.from($('import-file-list').querySelectorAll('.import-file-check:checked')).map(c => c.value);
    if (!filenames.length) return;
    $('import-confirm-btn').disabled = true; $('import-confirm-btn').textContent = 'Importing…';
    try {
      const res = await fetch(`/api/admin/client/galleries/${contentGid}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filenames }) });
      const data = await res.json();
      if (data.imported && data.imported.length) { importModal.hidden = true; if (contentGid === state.drawer.galleryId) loadContent(); refreshCountsSoon(); toast(`Imported ${data.imported.length}`); }
      if (data.errors && data.errors.length) toast('Some files failed to import');
    } catch (err) { toast('Import failed'); }
    finally { $('import-confirm-btn').disabled = false; $('import-confirm-btn').textContent = 'Import Selected'; }
  });

  // ==========================================================================
  // New gallery / new collection modals
  // ==========================================================================
  let ngState = { downloads: false, commenting: false, useCollection: true };
  function ngInheritedPreviewHtml(col) {
    const row = (k, v) => `<div class="inherit-row"><span class="ir-key">${k}</span><span class="ir-val">${v}</span></div>`;
    return `<div class="inherit-list locked">
      ${row('Password', col.hasPassword ? 'Set' : 'None')}
      ${row('Downloads', col.downloadsEnabled ? 'On' : 'Off')}
      ${row('Comments', col.commentingEnabled ? 'On' : 'Off')}
      ${row('Expires', formatDate(col.expiresAt))}
    </div>`;
  }
  // Only collections of the same type can hold this gallery, so the dropdown
  // is rebuilt whenever the type radio changes.
  function populateNgCollections(type, preselect) {
    const colSel = $('ng-collection');
    const opts = state.collections.filter(c => (c.type || 'proofing') === type);
    colSel.innerHTML = `<option value="">— None —</option>` + opts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (preselect && opts.some(c => c.id === preselect)) colSel.value = preselect;
  }
  function updateNgSettingsUI() {
    const type = document.querySelector('input[name="ng-type"]:checked').value;
    $('ng-settings-block').hidden = type !== 'proofing';
    if (type !== 'proofing') return;
    const colId = $('ng-collection').value;
    const col = colId ? state.collections.find(c => c.id === colId) : null;
    $('ng-use-collection-row').hidden = !col;
    $('ng-use-collection').classList.toggle('on', ngState.useCollection);
    if (col && ngState.useCollection) {
      $('ng-inherited-preview').innerHTML = ngInheritedPreviewHtml(col);
      $('ng-inherited-preview').hidden = false;
      $('ng-editable-fields').hidden = true;
    } else {
      $('ng-inherited-preview').hidden = true;
      $('ng-editable-fields').hidden = false;
    }
  }
  function openNewGallery(collectionId) {
    const modal = $('new-gallery-modal');
    $('ng-name').value = 'Client Gallery';
    // This dialog only makes client galleries. A portfolio collection left over
    // from before the portfolio moved to folders can't hold one, and offering it
    // would leave no type selected, so it is ignored rather than preselected.
    const preCol = collectionId ? state.collections.find(c => c.id === collectionId) : null;
    const initialType = 'proofing';
    if (preCol && (preCol.type || 'proofing') !== 'proofing') collectionId = '';
    modal.querySelectorAll('input[name="ng-type"]').forEach(r => r.checked = r.value === initialType);
    populateNgCollections(initialType, collectionId);
    ngState = { downloads: false, commenting: false, useCollection: true };
    $('ng-password').value = ''; $('ng-password').placeholder = 'No password';
    $('ng-folder').value = '';
    $('ng-expires').value = '';
    $('ng-downloads').classList.remove('on'); $('ng-commenting').classList.remove('on');
    updateNgSettingsUI();
    modal.hidden = false;
    $('ng-name').focus(); $('ng-name').select();
  }
  $('ng-cancel').addEventListener('click', () => $('new-gallery-modal').hidden = true);
  $('new-gallery-modal').querySelector('.modal-backdrop').addEventListener('click', () => $('new-gallery-modal').hidden = true);
  document.querySelectorAll('input[name="ng-type"]').forEach(r => r.addEventListener('change', () => {
    populateNgCollections(r.value);
    updateNgSettingsUI();
  }));
  $('ng-collection').addEventListener('change', () => {
    // Picking a collection normally means "inherit its settings". But if the
    // toggles were already switched on, that was a deliberate choice — keep it
    // by overriding instead of hiding the fields and silently dropping it.
    ngState.useCollection = !(ngState.downloads || ngState.commenting);
    updateNgSettingsUI();
  });
  $('ng-use-collection').addEventListener('click', () => { ngState.useCollection = !ngState.useCollection; updateNgSettingsUI(); });
  $('ng-downloads').addEventListener('click', () => { ngState.downloads = !ngState.downloads; $('ng-downloads').classList.toggle('on'); });
  $('ng-commenting').addEventListener('click', () => { ngState.commenting = !ngState.commenting; $('ng-commenting').classList.toggle('on'); });
  $('ng-create').addEventListener('click', async () => {
    const name = $('ng-name').value.trim(); if (!name) { $('ng-name').focus(); return; }
    const type = 'proofing';
    const colId = $('ng-collection').value;
    const body = { name, type };
    const folder = $('ng-folder').value.trim();
    if (folder) body.importFolder = folder;
    if (type === 'proofing' && (!colId || !ngState.useCollection)) {
      body.overrideCollectionSettings = !!colId;
      const pw = $('ng-password').value.trim();
      if (pw) body.password = pw;
      body.downloadsEnabled = ngState.downloads;
      body.commentingEnabled = ngState.commenting;
      body.expiresAt = $('ng-expires').value ? new Date($('ng-expires').value + 'T23:59:59').toISOString() : null;
    }
    const res = await fetch('/api/admin/client/galleries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      // Keep the modal open so a bad folder name can be fixed without retyping the rest.
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { checkAuth(); return; }
      toast(data.error || `Create failed (HTTP ${res.status})`);
      return;
    }
    $('new-gallery-modal').hidden = true;
    const g = await res.json();
    let filed = true;
    if (colId) {
      const col = state.collections.find(c => c.id === colId);
      if (col) {
        const put = await fetch(`/api/admin/client/collections/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: [...(col.galleryIds || []), g.id] }) });
        filed = put.ok;
      }
    }
    await loadData(); renderAll(); openGallery(g.id);
    if (!filed) { toast('Gallery created, but it could not be added to the collection'); return; }
    toast('Gallery created');
  });

  const ncModal = $('new-collection-modal');
  let ncState = { downloads: false, commenting: false, active: true };
  let ncEditingId = null;
  let ncClearPassword = false;

  function ncType() {
    return document.querySelector('input[name="nc-type"]:checked').value;
  }
  // Portfolio collections are public, so the client-gating fields don't apply;
  // the gallery picker also has to switch between reels and proofing galleries.
  function updateNcTypeUI() {
    const portfolio = ncType() === 'reels';
    $('nc-type-hint').textContent = portfolio
      ? 'Groups portfolio galleries under one public link — no password or expiry.'
      : 'Groups client galleries behind one shareable link.';
    $('nc-inherit-hint').textContent = portfolio
      ? 'Inherited settings — galleries in this collection follow these unless they override.'
      : 'Inherited settings — galleries in this collection follow these unless they override.';
    $('nc-password-group').hidden = portfolio;
    $('nc-commenting-row').hidden = portfolio;
    $('nc-expires-group').hidden = portfolio;
    $('nc-galleries-label').textContent = portfolio ? 'Add Portfolio Galleries' : 'Add Galleries';
    renderNcGalleryPicker();
  }
  function renderNcGalleryPicker() {
    const gl = $('nc-galleries');
    const wantType = ncType();
    const col = ncEditingId ? state.collections.find(c => c.id === ncEditingId) : null;
    const avail = state.galleries.filter(g => g.type === wantType && g.active !== false);
    const memberIds = new Set(col ? (col.galleryIds || []) : []);
    gl.innerHTML = avail.length
      ? avail.map(g => `<label class="gal-check-row"><input type="checkbox" value="${g.id}"${memberIds.has(g.id) ? ' checked' : ''}><span>${escapeHtml(g.name)}</span></label>`).join('')
      : `<p class="setting-hint" style="padding:8px;">No ${wantType === 'reels' ? 'portfolio' : 'client'} galleries yet.</p>`;
  }

  function openCollectionModal(id, presetType) {
    closeAllMenus();
    ncEditingId = id || null;
    ncClearPassword = false;
    const col = ncEditingId ? state.collections.find(c => c.id === ncEditingId) : null;

    $('nc-title').textContent = col ? 'Edit collection' : 'New collection';
    $('nc-sub').textContent = col ? 'Update sharing settings for this collection.' : 'Group galleries under one shareable link.';
    $('nc-create').textContent = col ? 'Save Changes' : 'Create Collection';
    $('nc-delete').hidden = !col;
    $('nc-link-group').hidden = !col;

    const type = col ? (col.type || 'proofing') : (presetType === 'reels' ? 'reels' : 'proofing');
    ncModal.querySelectorAll('input[name="nc-type"]').forEach(r => r.checked = r.value === type);

    $('nc-name').value = col ? col.name : '';
    $('nc-link').value = col ? window.location.origin + '/collection/' + col.token : '';
    $('nc-link-hint').textContent = col ? 'Share this link with your client.' : 'The link is created when you save the collection.';
    $('nc-password').value = '';
    $('nc-password').placeholder = col && col.hasPassword ? '(set — type to change)' : 'No password';
    $('nc-password-clear').hidden = !(col && col.hasPassword);
    $('nc-expires').value = col && col.expiresAt ? col.expiresAt.split('T')[0] : '';

    ncState = {
      downloads: col ? !!col.downloadsEnabled : false,
      commenting: col ? !!col.commentingEnabled : false,
      active: col ? col.active !== false : true,
    };
    $('nc-downloads').classList.toggle('on', ncState.downloads);
    $('nc-commenting').classList.toggle('on', ncState.commenting);
    $('nc-active').classList.toggle('on', ncState.active);

    updateNcTypeUI();

    ncModal.hidden = false;
    $('nc-name').focus();
  }
  ncModal.querySelectorAll('input[name="nc-type"]').forEach(r => r.addEventListener('change', updateNcTypeUI));
  $('nc-downloads').addEventListener('click', () => { ncState.downloads = !ncState.downloads; $('nc-downloads').classList.toggle('on'); });
  $('nc-commenting').addEventListener('click', () => { ncState.commenting = !ncState.commenting; $('nc-commenting').classList.toggle('on'); });
  $('nc-active').addEventListener('click', () => { ncState.active = !ncState.active; $('nc-active').classList.toggle('on'); });
  $('nc-cancel').addEventListener('click', () => ncModal.hidden = true);
  ncModal.querySelector('.modal-backdrop').addEventListener('click', () => ncModal.hidden = true);
  $('nc-password').addEventListener('input', () => { ncClearPassword = false; });
  $('nc-password-clear').addEventListener('click', () => {
    ncClearPassword = true;
    $('nc-password').value = '';
    $('nc-password').placeholder = 'No password';
    $('nc-password-clear').hidden = true;
  });
  $('nc-copy').addEventListener('click', () => { if (ncEditingId) copyCollectionLink(ncEditingId); });
  $('nc-open').addEventListener('click', () => { if (ncEditingId) openCollectionLink(ncEditingId); });
  $('nc-email').addEventListener('click', () => {
    const col = state.collections.find(c => c.id === ncEditingId);
    if (col) openMailto(buildCollectionMailto(col));
  });
  $('nc-edit').addEventListener('click', async () => {
    if (!ncEditingId) return;
    const col = state.collections.find(c => c.id === ncEditingId);
    if (!col) return;
    const saved = await linkModal({
      title: 'Edit collection link',
      warning: 'Anyone holding the current link will get "not found" the moment you save. Change this only to put back a link you have already sent out.',
      prefix: window.location.origin + '/collection/',
      value: col.token,
      onSubmit: (token) => saveShareToken('collections', ncEditingId, token),
    });
    if (!saved) return;
    await loadData();
    const updated = state.collections.find(c => c.id === ncEditingId);
    if (updated) $('nc-link').value = window.location.origin + '/collection/' + updated.token;
    renderAll();
    toast('Link updated');
  });
  $('nc-regen').addEventListener('click', async () => {
    if (!ncEditingId) return;
    if (!await confirmModal({ title: 'Regenerate link', message: 'This replaces the link with a new one, and anyone you have already sent the current link to will get "not found". Write the current link down first — Edit can put it back.', okText: 'Regenerate', danger: true })) return;
    const res = await fetch(`/api/admin/client/collections/${ncEditingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateToken: true }) });
    if (!res.ok) { toast('Regenerate failed'); return; }
    await loadData();
    const col = state.collections.find(c => c.id === ncEditingId);
    if (col) $('nc-link').value = window.location.origin + '/collection/' + col.token;
    renderAll();
    toast('Link regenerated');
  });
  $('nc-delete').addEventListener('click', async () => {
    if (!ncEditingId) return;
    const col = state.collections.find(c => c.id === ncEditingId);
    if (!await confirmModal({ title: 'Delete collection', message: `Delete "${col ? col.name : 'this collection'}"? Galleries inside it are kept, just ungrouped.`, okText: 'Delete', danger: true })) return;
    const res = await fetch(`/api/admin/client/collections/${ncEditingId}`, { method: 'DELETE' });
    if (!res.ok) { toast('Delete failed'); return; }
    ncModal.hidden = true;
    if (state.rail === ncEditingId) state.rail = 'all';
    await loadData();
    renderRail(); renderCentre();
    toast('Collection deleted');
  });
  $('nc-create').addEventListener('click', async () => {
    const name = $('nc-name').value.trim(); if (!name) { $('nc-name').focus(); return; }
    const galleryIds = Array.from($('nc-galleries').querySelectorAll('input:checked')).map(c => c.value);
    const type = ncType();
    const body = { name, type, galleryIds, downloadsEnabled: ncState.downloads, active: ncState.active };
    // The server ignores these on a portfolio collection anyway; not sending
    // them keeps an accidental password out of the request entirely.
    if (type !== 'reels') {
      body.commentingEnabled = ncState.commenting;
      body.expiresAt = $('nc-expires').value ? new Date($('nc-expires').value + 'T23:59:59').toISOString() : null;
      const pw = $('nc-password').value.trim();
      if (pw) body.password = pw;
      else if (ncEditingId && ncClearPassword) body.password = '';
    }

    const url = ncEditingId ? `/api/admin/client/collections/${ncEditingId}` : '/api/admin/client/collections';
    const method = ncEditingId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { toast(ncEditingId ? 'Save failed' : 'Create failed'); return; }
    const col = await res.json();
    ncModal.hidden = true;
    await loadData();
    state.rail = col.id;
    renderRail(); renderCentre();
    toast(ncEditingId ? 'Collection saved' : 'Collection created');
  });

  // ==========================================================================
  // Delivery — send a gallery or collection to a client
  // ==========================================================================
  // There is no build step: the server writes a plan and zips on the fly as the
  // client downloads. Creating a link takes milliseconds, so the modal makes one
  // as soon as it opens — you can check the page your client will see before
  // deciding who to send it to.
  const pkgModal = $('package-modal');
  let pkgSource = null;         // { type, id, name }
  let pkgCurrent = null;        // the package this modal is working on
  let pkgEmailConfigured = false;

  async function openPackageModal(sourceType, sourceId, name) {
    closeAllMenus();
    pkgSource = { type: sourceType, id: sourceId, name };
    pkgCurrent = null;

    $('pk-title').textContent = 'Send ' + name;
    $('pk-sub').textContent = sourceType === 'collection'
      ? 'Shares every gallery in this collection as one download, a folder per gallery.'
      : 'Shares this whole gallery as one download.';
    $('pk-to').value = '';
    $('pk-message').value = '';
    $('pk-link').value = '';
    $('pk-link-hint').textContent = 'Preparing…';
    $('pk-delete').hidden = true;
    $('pk-send').disabled = true;
    pkgModal.hidden = false;

    try {
      const [packages, email] = await Promise.all([
        fetch('/api/admin/client/packages?sourceId=' + encodeURIComponent(sourceId)).then(r => r.ok ? r.json() : []),
        fetch('/api/settings/email').then(r => r.ok ? r.json() : {}),
      ]);
      pkgEmailConfigured = !!email.configured;

      // Reuse the link if this gallery already has one — making a second link
      // wouldn't revoke the first, and the client may already have it.
      pkgCurrent = packages[0] || await createPackage();
      if (!pkgCurrent) return;

      $('pk-message').value = pkgCurrent.message || '';
      renderPackageLink();
      $('pk-to').focus();

      // Hash this delivery's files while you fill the form in. Usually there is
      // nothing to do — uploads are hashed as they arrive — so this is silent
      // unless the gallery predates the CRC cache.
      warmPackageCrc(pkgCurrent.id, (p) => {
        if (!pkgCurrent || p.done) { renderPackageLink(); return; }
        const hint = $('pk-link-hint');
        if (hint) hint.textContent =
          `Preparing ${p.remaining} file${p.remaining === 1 ? '' : 's'} for full-speed download — the link already works.`;
      });
    } catch (_) {
      $('pk-link-hint').textContent = 'Could not prepare a link. Close and try again.';
    }
  }

  async function createPackage() {
    const res = await fetch('/api/admin/client/packages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: pkgSource.type, sourceId: pkgSource.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $('pk-link-hint').textContent = data.error || 'Could not prepare a link.';
      return null;
    }
    return data;
  }

  function renderPackageLink() {
    const p = pkgCurrent;
    $('pk-link').value = p.shareUrl;
    const sent = p.lastEmailedAt
      ? ` · sent ${formatDate(p.lastEmailedAt)}${p.lastEmailedTo && p.lastEmailedTo.length ? ' to ' + p.lastEmailedTo.join(', ') : ''}`
      : '';
    $('pk-link-hint').textContent =
      `${p.fileCount} file${p.fileCount === 1 ? '' : 's'} · ${fmtBytes(p.totalBytes)} · expires ${formatDate(p.expiresAt)}${sent}`;
    $('pk-delete').hidden = false;
    $('pk-send').disabled = false;
    applyEmailAvailability();
  }

  function applyEmailAvailability() {
    $('pk-to').disabled = !pkgEmailConfigured;
    $('pk-to-hint').textContent = pkgEmailConfigured
      ? 'Separate several addresses with commas.'
      : 'Set up Settings › Email to send from here. The link above works either way — copy it and send it yourself.';
    updateSendLabel();
  }

  function updateSendLabel() {
    const hasRecipients = pkgEmailConfigured && $('pk-to').value.trim() !== '';
    $('pk-send').textContent = hasRecipients ? 'Send Link' : 'Save Message';
  }

  $('pk-to').addEventListener('input', updateSendLabel);

  $('pk-send').addEventListener('click', async () => {
    if (!pkgCurrent) return;
    const to = pkgEmailConfigured ? $('pk-to').value.trim() : '';
    const message = $('pk-message').value.trim();
    const btn = $('pk-send');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = to ? 'Sending…' : 'Saving…';

    // With no recipients this just stores the note for the download page.
    const res = to
      ? await fetch(`/api/admin/client/packages/${pkgCurrent.id}/email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, message }),
        })
      : await fetch(`/api/admin/client/packages/${pkgCurrent.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });

    const data = await res.json().catch(() => ({}));
    btn.disabled = false;
    btn.textContent = label;
    if (!res.ok) { toast(data.error || 'Could not send'); return; }

    if (to) {
      pkgCurrent.lastEmailedAt = new Date().toISOString();
      pkgCurrent.lastEmailedTo = data.sent || [];
      pkgCurrent.message = message;
      renderPackageLink();
      toast('Sent to ' + (data.sent || []).join(', '));
      pkgModal.hidden = true;
    } else {
      pkgCurrent = data;
      renderPackageLink();
      toast('Message saved');
    }
  });

  $('pk-copy').addEventListener('click', () => copyText($('pk-link').value, 'Download link copied'));
  $('pk-open').addEventListener('click', () => {
    if ($('pk-link').value) window.open($('pk-link').value, '_blank', 'noopener');
  });
  $('pk-close').addEventListener('click', () => pkgModal.hidden = true);
  pkgModal.querySelector('.modal-backdrop').addEventListener('click', () => pkgModal.hidden = true);

  $('pk-delete').addEventListener('click', async () => {
    if (!pkgCurrent) return;
    if (!await confirmModal({
      title: 'Revoke link',
      message: 'The link stops working immediately. Your files are not touched.',
      okText: 'Revoke', danger: true,
    })) return;
    await fetch(`/api/admin/client/packages/${pkgCurrent.id}`, { method: 'DELETE' });
    pkgCurrent = null;
    pkgModal.hidden = true;
    toast('Link revoked');
  });

  function copyCollectionLink(colId) {
    const col = state.collections.find(c => c.id === colId);
    if (!col) return;
    navigator.clipboard.writeText(window.location.origin + '/collection/' + col.token);
    toast('Collection link copied');
  }
  function openCollectionLink(colId) {
    const col = state.collections.find(c => c.id === colId);
    if (!col) return;
    window.open(window.location.origin + '/collection/' + col.token, '_blank');
  }
  function buildCollectionMailto(col) {
    if (!col || !col.token) return null;
    const url = window.location.origin + '/collection/' + col.token;
    const subject = mailSubject('Gallery link', col.name);
    const pwLine = col.hasPassword ? `\nPassword: [enter the collection password here]\n` : '';
    const body = `Hello,\n\nYour galleries are ready.\n\n${url}\n${pwLine}${signOff()}`;
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // ==========================================================================
  // Generic prompt / confirm modals
  // ==========================================================================
  function promptModal(cfg) {
    const modal = $('prompt-modal');
    $('prompt-title').textContent = cfg.title || 'Enter value';
    const sub = $('prompt-sub'); if (cfg.sub) { sub.textContent = cfg.sub; sub.hidden = false; } else sub.hidden = true;
    $('prompt-ok').textContent = cfg.okText || 'OK';
    const f = cfg.field || { type: 'text' };
    const field = $('prompt-field');
    if (f.type === 'select') {
      field.innerHTML = `<div class="setting-group"><label>${escapeHtml(f.label || '')}</label><select class="setting-input" id="prompt-input">${f.options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}</select></div>`;
    } else if (f.type === 'textarea') {
      field.innerHTML = `<div class="setting-group"><label>${escapeHtml(f.label || '')}</label><textarea class="setting-input" id="prompt-input" rows="${f.rows || 5}" maxlength="${f.maxLength || 2000}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(f.value || '')}</textarea></div>`;
    } else {
      field.innerHTML = `<div class="setting-group"><label>${escapeHtml(f.label || '')}</label><input type="${f.type}" class="setting-input" id="prompt-input" placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(f.value || '')}"></div>`;
    }
    modal.hidden = false;
    const input = $('prompt-input'); input.focus(); if (f.type !== 'textarea' && input.select) input.select();
    return new Promise((resolve) => {
      function cleanup() { modal.hidden = true; $('prompt-ok').removeEventListener('click', ok); $('prompt-cancel').removeEventListener('click', cancel); modal.querySelector('.modal-backdrop').removeEventListener('click', cancel); document.removeEventListener('keydown', key); }
      function ok() { const v = input.value; cleanup(); resolve(v); }
      function cancel() { cleanup(); resolve(null); }
      function key(e) { if (e.key === 'Enter' && f.type !== 'textarea') { e.preventDefault(); ok(); } if (e.key === 'Escape') cancel(); }
      $('prompt-ok').addEventListener('click', ok); $('prompt-cancel').addEventListener('click', cancel);
      modal.querySelector('.modal-backdrop').addEventListener('click', cancel); document.addEventListener('keydown', key);
    });
  }
  function confirmModal(cfg) {
    const modal = $('confirm-modal');
    $('confirm-title').textContent = cfg.title || 'Confirm';
    $('confirm-message').textContent = cfg.message || '';
    const okBtn = $('confirm-ok'); okBtn.textContent = cfg.okText || 'Confirm';
    okBtn.className = cfg.danger ? 'btn-primary' : 'btn-primary';
    modal.hidden = false;
    return new Promise((resolve) => {
      function cleanup() { modal.hidden = true; okBtn.removeEventListener('click', ok); $('confirm-cancel').removeEventListener('click', cancel); modal.querySelector('.modal-backdrop').removeEventListener('click', cancel); document.removeEventListener('keydown', key); }
      function ok() { cleanup(); resolve(true); }
      function cancel() { cleanup(); resolve(false); }
      function key(e) { if (e.key === 'Escape') cancel(); if (e.key === 'Enter') ok(); }
      okBtn.addEventListener('click', ok); $('confirm-cancel').addEventListener('click', cancel);
      modal.querySelector('.modal-backdrop').addEventListener('click', cancel); document.addEventListener('keydown', key);
    });
  }

  // A share link is only as private as its token, but it is also the thing the
  // client has already pasted into their calendar — so it has to be editable by
  // hand, not just regenerable. The modal stays open when the server rejects a
  // token (bad characters, too short, already taken) so the typo can be fixed in
  // place. cfg.onSubmit resolves to null on success, or a message to display.
  function linkModal(cfg) {
    const modal = $('link-modal');
    const input = $('link-modal-input');
    const err = $('link-modal-error');
    const okBtn = $('link-modal-ok');
    $('link-modal-title').textContent = cfg.title || 'Edit link';
    $('link-modal-warning').textContent = cfg.warning || '';
    $('link-modal-prefix').textContent = cfg.prefix || '';
    input.value = cfg.value || '';
    err.textContent = '';
    okBtn.disabled = false;
    modal.hidden = false;
    input.focus(); input.select();
    return new Promise((resolve) => {
      function cleanup() {
        modal.hidden = true;
        okBtn.disabled = false;
        okBtn.removeEventListener('click', ok);
        $('link-modal-cancel').removeEventListener('click', cancel);
        modal.querySelector('.modal-backdrop').removeEventListener('click', cancel);
        document.removeEventListener('keydown', key);
      }
      async function ok() {
        const value = input.value.trim();
        if (!value) { err.textContent = 'Enter a link.'; input.focus(); return; }
        if (value === cfg.value) { cleanup(); resolve(false); return; }
        okBtn.disabled = true;
        err.textContent = '';
        const message = await cfg.onSubmit(value);
        if (message) { err.textContent = message; okBtn.disabled = false; input.focus(); return; }
        cleanup(); resolve(true);
      }
      function cancel() { cleanup(); resolve(false); }
      function key(e) {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter' && !okBtn.disabled) ok();
      }
      okBtn.addEventListener('click', ok);
      $('link-modal-cancel').addEventListener('click', cancel);
      modal.querySelector('.modal-backdrop').addEventListener('click', cancel);
      document.addEventListener('keydown', key);
    });
  }

  // Returns null when saved, or the server's complaint to show in the modal.
  async function saveShareToken(kind, id, token) {
    let res;
    try {
      res = await fetch(`/api/admin/client/${kind}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch (e) {
      return 'Could not reach the server.';
    }
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error || 'Could not save that link.';
  }

  // ==========================================================================
  // Modals shared by the Portfolio screen's Email and API pages. The actual
  // field editing for Email/Update/API lives there now (its own rail rows,
  // same as Site design) — these two stay here only because the modals
  // themselves are global DOM, outside any one screen.
  // ==========================================================================
  function showEmailTestResult(type, title, msg) {
    $('email-result-title').textContent = title;
    $('email-result-title').style.color = type === 'error' ? 'var(--danger)' : '#4caf50';
    $('email-result-text').textContent = msg;
    $('email-result-copy-btn').style.display = type === 'error' ? '' : 'none';
    $('email-result-modal').hidden = false;
  }
  $('email-result-close-btn').addEventListener('click', () => $('email-result-modal').hidden = true);
  $('email-result-modal').querySelector('.modal-backdrop').addEventListener('click', () => $('email-result-modal').hidden = true);
  $('email-result-copy-btn').addEventListener('click', () => { navigator.clipboard.writeText($('email-result-text').textContent); $('email-result-copy-btn').textContent = 'Copied!'; setTimeout(() => $('email-result-copy-btn').textContent = 'Copy Error', 1800); });

  function showApiTokenModal(token) {
    // The address the API answers on, which is where this admin is open.
    $('api-url-reveal-input').value = location.origin;
    $('api-token-reveal-input').value = token;
    $('api-token-modal').hidden = false;
    $('api-token-reveal-input').focus();
    $('api-token-reveal-input').select();
  }
  $('api-url-copy-btn').addEventListener('click', () => { navigator.clipboard.writeText($('api-url-reveal-input').value); $('api-url-copy-btn').textContent = 'Copied!'; setTimeout(() => $('api-url-copy-btn').textContent = 'Copy', 1500); });
  $('api-token-copy-btn').addEventListener('click', () => { navigator.clipboard.writeText($('api-token-reveal-input').value); $('api-token-copy-btn').textContent = 'Copied!'; setTimeout(() => $('api-token-copy-btn').textContent = 'Copy', 1500); });
  $('api-token-modal-done-btn').addEventListener('click', () => { $('api-token-modal').hidden = true; $('api-token-reveal-input').value = ''; });

  // --- Header config ---
  // Full editing (logo, contact info, nav links) lives in the Portfolio
  // screen's Site design panel now; this just keeps the top-left brand
  // wordmark and the document title in sync with it.
  async function loadHeaderConfig() {
    try {
      const headerConfig = await (await fetch('/api/header')).json();
      const logo = headerConfig.logo || {};
      const brandEl = $('brand-mast');
      brandEl.classList.toggle('is-link', !logo.text);
      if (logo.text) {
        brandEl.textContent = logo.text;
        brandEl.onclick = null;
      } else {
        brandEl.textContent = 'Set in Site design';
        brandEl.onclick = (e) => { e.stopPropagation(); setScreen('portfolio'); window.SDPortfolio?.openDesign(); };
      }
      document.title = (headerConfig.siteName || logo.text || 'Show & Deliver') + ' — Admin';
    } catch (e) { /* the top-left brand just keeps its default until the next load */ }
  }

  // ==========================================================================
  // Narrow-screen rail toggle
  // ==========================================================================
  // The rail of whichever tab is showing slides over the content below 1100px,
  // with a scrim behind it that closes it again.
  function activeRail() { return state.screen === 'portfolio' ? $('pfa-rail') : $('rail'); }
  function setRailOpen(open) {
    const narrow = window.innerWidth < 1100;
    ['rail', 'pfa-rail'].forEach(id => $(id).classList.toggle('open', narrow && open && $(id) === activeRail()));
    let scrim = $('rail-scrim');
    if (narrow && open) {
      if (!scrim) {
        scrim = document.createElement('div');
        scrim.id = 'rail-scrim';
        scrim.className = 'rail-scrim';
        scrim.addEventListener('click', () => setRailOpen(false));
        document.body.appendChild(scrim);
      }
    } else if (scrim) scrim.remove();
  }
  // Account links collapse into a ⋯ menu on phones. The items just press the
  // real buttons, so their handlers (and labels, like the theme toggle) stay put.
  const MORE_ITEMS = ['nav-uploads', 'account-theme', 'account-password', 'account-logout'];
  function ensureMoreMenu() {
    if ($('more-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'more-wrap'; wrap.className = 'menu-wrap';
    wrap.innerHTML = '<button type="button" class="account-btn" id="more-btn" aria-label="More" aria-haspopup="true" style="width:38px;height:38px;">&#8943;</button><div class="menu" id="more-menu" hidden></div>';
    const menu = wrap.querySelector('#more-menu');
    wrap.querySelector('#more-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.innerHTML = '';
      MORE_ITEMS.forEach(id => {
        const src = $(id);
        if (!src || src.hidden) return;
        const b = document.createElement('button');
        b.textContent = src.textContent.trim();
        b.addEventListener('click', () => { menu.hidden = true; src.click(); });
        menu.appendChild(b);
      });
      menu.hidden = false;
    });
    document.addEventListener('click', () => { menu.hidden = true; });
    const right = document.querySelector('.topbar-right');
    right.insertBefore(wrap, right.querySelector('.menu-wrap'));
  }
  function ensureRailToggle() {
    if ($('rail-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'rail-toggle'; btn.className = 'account-btn'; btn.textContent = '☰';
    btn.setAttribute('aria-label', 'Menu');
    btn.style.marginRight = '4px';
    btn.addEventListener('click', (e) => { e.stopPropagation(); setRailOpen(!activeRail().classList.contains('open')); });
    document.querySelector('.topbar').insertBefore(btn, document.querySelector('.brand'));
    // Picking something in the portfolio rail closes it (the library's rail does
    // so in its own handlers); expanding a group or opening a link does not.
    $('pfa-rail').addEventListener('click', (e) => {
      if (window.innerWidth < 1100 && e.target.closest('.rail-row') && !e.target.closest('summary, .rail-twist, .rail-open')) setRailOpen(false);
    });
  }
  function syncRailToggle() {
    const t = $('rail-toggle');
    ensureMoreMenu();
    if (window.innerWidth < 1100) { ensureRailToggle(); if ($('rail-toggle')) $('rail-toggle').style.display = ''; }
    else { if (t) t.style.display = 'none'; setRailOpen(false); }
  }
  window.addEventListener('resize', syncRailToggle);

  // ==========================================================================
  // Bridge for portfolio-admin.js
  // ==========================================================================
  // Everything in this file lives in one DOMContentLoaded closure, so the
  // portfolio screen (a separate file) reaches the shared helpers through here.
  window.SDAdmin = {
    api,
    toast,
    copy: copyText,
    prompt: promptModal,
    confirm: confirmModal,
    escapeHtml,
    setScreen,
    captureFrameAsJpegBlob,
    openThumbPickerFor,
    openCaptionsModalFor,
    showEmailTestResult,
    showApiTokenModal,
    // One file straight into a portfolio folder, chunked like the upload queue
    // but without the queue's screen: the portfolio editor has its own drop
    // zone and shows progress per file.
    async uploadToPortfolio(file, galleryId, onProgress) {
      const init = await xhrSend({
        method: 'POST', url: '/api/admin/uploads',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, totalSize: file.size, contentType: file.type || '' }),
      });
      const chunkBytes = Math.min(init.chunkMaxBytes || PREFERRED_CHUNK_BYTES, PREFERRED_CHUNK_BYTES);
      let sent = 0;
      while (sent < file.size) {
        const start = sent;
        const end = Math.min(start + chunkBytes, file.size) - 1;
        const ack = await xhrSend({
          method: 'PUT', url: `/api/admin/uploads/${init.uploadId}/chunk`,
          headers: { 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Type': 'application/octet-stream' },
          body: file.slice(start, end + 1),
          onProgress: (e) => {
            if (e.lengthComputable && onProgress) onProgress(Math.round((start + e.loaded) / file.size * 100));
          },
        });
        sent = typeof ack.received === 'number' ? ack.received : end + 1;
        if (onProgress) onProgress(Math.round(sent / file.size * 100));
      }
      return await xhrSend({
        method: 'POST', url: `/api/admin/uploads/${init.uploadId}/finalize`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'portfolio', galleryId }),
      });
    },
  };

  // ==========================================================================
  // Init
  // ==========================================================================
  loadPrefs();
  let storedTheme = 'dark';
  try { storedTheme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) {}
  applyTheme(storedTheme);
  syncRailToggle();
  checkAuth();
});
