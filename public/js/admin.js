/* ==========================================================================
   AJ Mast Delivery — Admin (redesign)
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
    rail: 'all',                       // all | ungrouped | archive | <collectionId>
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
    return div.innerHTML;
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
      show($('auth-setup')); hide($('auth-login')); hide($('app'));
      return;
    }
    if (data.authenticated) {
      hide($('auth-setup')); hide($('auth-login')); show($('app'));
      await loadData();
      renderAll();
    } else {
      hide($('auth-setup')); show($('auth-login')); hide($('app'));
    }
  }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

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
    else $('login-error').textContent = 'Invalid credentials';
  });

  // ==========================================================================
  // Data load
  // ==========================================================================
  async function loadData() {
    let gRes, cRes;
    try {
      [gRes, cRes] = await Promise.all([fetch('/api/galleries'), fetch('/api/collections')]);
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

  // ==========================================================================
  // Screen switching
  // ==========================================================================
  function setScreen(screen) {
    state.screen = screen;
    $('screen-library').hidden = screen !== 'library';
    $('screen-upload').hidden = screen !== 'upload';
    $('screen-settings').hidden = screen !== 'settings';
    if (screen === 'upload') renderUpload();
    if (screen === 'settings') openSettings();
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
    $('account-menu').hidden = true;
    $('new-menu').hidden = true;
    document.querySelectorAll('.filter-pop').forEach(p => p.remove());
  }
  document.addEventListener('click', closeAllMenus);

  setupMenu('account-btn', 'account-menu', (v) => {
    if (v === 'settings') setScreen('settings');
    else if (v === 'theme') toggleTheme();
    else if (v === 'logout') logout();
  }, 'data-account');

  $('upload-back').addEventListener('click', () => setScreen('library'));
  $('settings-back').addEventListener('click', () => setScreen('library'));

  setupMenu('new-btn', 'new-menu', (v) => {
    if (v === 'gallery') openNewGallery();
    else if (v === 'collection') openCollectionModal();
    else if (v === 'upload') setScreen('upload');
  }, 'data-new');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    checkAuth();
  }

  function updateUploadsCount() {
    const active = state.upload.queue.filter(i => i.status === 'uploading' || i.status === 'waiting').length;
    $('uploads-count').textContent = active;
  }

  // Global search
  $('global-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    if (state.centreGalleryId) { state.centreGalleryId = null; contentGid = null; closeDrawerForce(); }
    if (state.screen !== 'library') setScreen('library');
    renderCentre();
  });

  // ==========================================================================
  // Data pipeline (filter / group / sort)
  // ==========================================================================
  function railGalleries() {
    let list = state.galleries.slice();
    if (state.rail === 'archive') {
      list = list.filter(g => g.active === false);
    } else {
      list = list.filter(g => g.active !== false);
      if (state.rail === 'ungrouped') list = list.filter(g => !g.collectionId);
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
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  }

  // ==========================================================================
  // Rail
  // ==========================================================================
  function renderRail() {
    const rail = $('rail');
    const all = state.galleries.filter(g => g.active !== false);
    const ungrouped = all.filter(g => !g.collectionId).length;
    const archived = state.galleries.filter(g => g.active === false).length;

    const railRow = (id, label, count) =>
      `<div class="rail-row${state.rail === id ? ' active' : ''}" data-rail="${id}">
        <span class="rail-name">${escapeHtml(label)}</span>
        ${count != null ? `<span class="rail-count">${count}</span>` : ''}
      </div>`;

    let html = `<div class="rail-section-label">Library</div>`;
    html += railRow('all', 'All galleries', all.length);
    html += railRow('ungrouped', 'Ungrouped', ungrouped);
    html += railRow('archive', 'Archive', archived);

    html += `<div class="rail-section-label">Collections</div>`;
    state.collections.forEach(c => {
      const count = all.filter(g => g.collectionId === c.id).length;
      html += `<div class="rail-row compact${state.rail === c.id ? ' active' : ''}" data-rail="${c.id}">
        <span class="rail-name">${escapeHtml(titleCase(c.name))}</span>
        <span class="rail-count">${count}</span>
      </div>`;
    });
    html += `<div class="rail-row compact new-collection" data-new-collection>+ New collection</div>`;
    rail.innerHTML = html;

    rail.querySelectorAll('[data-rail]').forEach(el => {
      el.addEventListener('click', () => {
        state.rail = el.getAttribute('data-rail');
        state.centreGalleryId = null; contentGid = null; closeDrawerForce();
        setScreen('library');
        clearSelection();
        renderRail(); renderCentre();
        if (window.innerWidth < 1100) rail.classList.remove('open');
      });
    });
    rail.querySelector('[data-new-collection]').addEventListener('click', () => openCollectionModal());
  }

  // ==========================================================================
  // Centre (header + table/grid + bulk bar)
  // ==========================================================================
  function centreTitle() {
    if (state.rail === 'all') return 'ALL GALLERIES';
    if (state.rail === 'ungrouped') return 'UNGROUPED';
    if (state.rail === 'archive') return 'ARCHIVE';
    const c = state.collections.find(x => x.id === state.rail);
    return c ? c.name.toUpperCase() : 'GALLERIES';
  }
  function currentRailCollection() {
    if (['all', 'ungrouped', 'archive'].includes(state.rail)) return null;
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
    $('ctrl-col-settings').hidden = !railCol;
    if (railCol) {
      $('ctrl-col-copy').onclick = () => copyCollectionLink(railCol.id);
      $('ctrl-col-settings').onclick = () => openCollectionModal(railCol.id);
    }

    if (state.view === 'grid') renderGrid(list);
    else renderTable(list);
    renderBulkBar();
  }

  // ---------- Grouping ----------
  // For the "all" scope with Group: Collection we render per-collection groups
  // plus an Ungrouped group. Any other rail scope is a single flat list.
  function buildGroups(list) {
    const grouped = state.rail === 'all' && state.groupBy === 'collection';
    if (!grouped) return [{ col: null, galleries: sortGalleries(list) }];
    const groups = [];
    state.collections.forEach(c => {
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
      html += `<div class="empty-note">No galleries here yet.</div>`;
      scroll.innerHTML = html;
      wireTableHeader();
      return;
    }

    groups.forEach(grp => {
      const showHead = !!grp.col && grp.col.id !== null;
      const groupedScope = state.rail === 'all' && state.groupBy === 'collection';
      if (groupedScope && grp.col) {
        const collapsed = state.collapsed.has(grp.col.id);
        const isCol = grp.col.id !== '__ungrouped__';
        const shared = isCol && collectionHasShared(grp.col) ? `<span class="g-shared">· shared settings</span>` : '';
        const actions = isCol ? `<span class="gb-actions">
            <button class="link-btn muted" data-col-copy="${escapeHtml(grp.col.id)}">Copy link</button>
            <button class="link-btn muted" data-col-open="${escapeHtml(grp.col.id)}">Collection settings</button>
          </span>` : '';
        html += `<div class="group${collapsed ? ' collapsed' : ''}" data-group="${escapeHtml(grp.col.id)}">
          <div class="group-head" data-toggle="${escapeHtml(grp.col.id)}">
            <span class="g-caret">▼</span>
            <span class="g-name">${escapeHtml(grp.col.name)}</span>
            <span class="g-count">${grp.galleries.length}</span>
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
  }

  function rowHtml(g) {
    const eff = effective(g);
    const selected = state.selection.has(g.id);
    const open = state.drawer.galleryId === g.id;
    const tag = g.type === 'reels' ? `<span class="g-tag">Portfolio</span>` : '';
    return `<div class="gallery-row${selected ? ' selected' : ''}${open ? ' open' : ''}" data-id="${g.id}" role="row">
      <div class="g-name-cell">
        <button class="row-check" data-check="${g.id}" title="Select">${TICK}</button>
        <span class="g-thumb"></span>
        <span class="g-name">${escapeHtml(g.name)}</span>${tag}
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
    let html = `<div class="grid-wrap">`;
    const groupedScope = state.rail === 'all' && state.groupBy === 'collection';
    groups.forEach(grp => {
      if (groupedScope && grp.col) {
        const isCol = grp.col.id !== '__ungrouped__';
        html += `<div class="grid-block"><div class="grid-block-head">
          <span class="gb-name">${escapeHtml(grp.col.name)}</span>
          <span class="gb-count">${grp.galleries.length}</span>
          ${isCol ? `<span class="gb-actions">
            <button class="link-btn muted" data-col-copy="${escapeHtml(grp.col.id)}">Copy link</button>
            <button class="link-btn muted" data-col-open="${escapeHtml(grp.col.id)}">Collection settings</button>
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
      card.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey) { toggleSelect(id, e); return; }
        if (e.shiftKey) { rangeSelect(id); return; }
        openGallery(id);
      });
    });
    scroll.querySelectorAll('[data-add-gallery]').forEach(el =>
      el.addEventListener('click', () => openNewGallery(el.getAttribute('data-add-gallery') || '')));
    scroll.querySelectorAll('[data-col-copy]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); copyCollectionLink(el.getAttribute('data-col-copy')); }));
    scroll.querySelectorAll('[data-col-open]').forEach(el =>
      el.addEventListener('click', (e) => { e.stopPropagation(); openCollectionModal(el.getAttribute('data-col-open')); }));
  }
  function cardHtml(g) {
    const eff = effective(g);
    const selected = state.selection.has(g.id);
    const meta = `${g.videoCount || 0} items · ${g.viewCount || 0} views`;
    const stateLine = g.type === 'reels' ? 'Public' : `${accessLabel(g)} · ${formatDate(eff.expiresAt)}`;
    return `<div class="grid-card${selected ? ' selected' : ''}" data-id="${g.id}">
      <div class="gc-cover"></div>
      <button class="gc-check">${TICK}</button>
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
      await fetch(`/api/collections/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: merged }) });
      state.selection.clear();
      await loadData(); renderAll();
      toast(`Added ${ids.length} to ${col.name}`);
    } else if (kind === 'expiration') {
      const date = await promptModal({ title: 'Set expiration', okText: 'Set', field: { type: 'date', label: 'Expiration date (leave blank to clear)' } });
      if (date === null) return;
      const expiresAt = date ? new Date(date + 'T23:59:59').toISOString() : null;
      runBulk(id => fetch(`/api/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresAt }) }));
    } else if (kind === 'password') {
      const pw = await promptModal({ title: 'Set / clear password', okText: 'Apply', sub: 'Leave blank to remove the password.', field: { type: 'text', label: 'Password' } });
      if (pw === null) return;
      runBulk(id => fetch(`/api/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }));
    } else if (kind === 'downloads') {
      const val = await promptModal({ title: 'Downloads', okText: 'Apply', field: { type: 'select', label: 'Allow client downloads', options: [{ value: '1', label: 'On' }, { value: '0', label: 'Off' }] } });
      if (val === null) return;
      runBulk(id => fetch(`/api/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloadsEnabled: val === '1' }) }));
    } else if (kind === 'archive') {
      if (!await confirmModal({ title: 'Archive galleries', message: `Archive ${ids.length} galler${ids.length === 1 ? 'y' : 'ies'}? They become inactive and move to Archive.` })) return;
      runBulk(id => fetch(`/api/galleries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) }));
    } else if (kind === 'delete') {
      if (!await confirmModal({ title: 'Delete galleries', message: `Permanently delete ${ids.length} galler${ids.length === 1 ? 'y' : 'ies'}? This cannot be undone.`, okText: 'Delete', danger: true })) return;
      runBulk(id => fetch(`/api/galleries/${id}`, { method: 'DELETE' }));
    }
  }

  // ==========================================================================
  // Gallery content view (centre pane)
  // ==========================================================================
  function renderGalleryView() {
    const g = state.galleries.find(x => x.id === state.centreGalleryId);
    if (!g) { backToLibrary(); return; }
    contentGid = g.id;
    const isProofing = g.type === 'proofing';
    const badge = isProofing ? 'Client gallery' : 'Portfolio';
    const link = isProofing && g.token ? window.location.origin + '/gallery/' + g.token : '';
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
            </div>
          </div>
          <div class="gv-sub">${meta.join(' · ')}${link ? ` · <span class="gv-link">${escapeHtml(link)}</span>` : ''}</div>
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
    else if (act === 'import') { contentGid = g.id; openImportModal(); }
    else if (act === 'refresh') {
      const res = await fetch(`/api/admin/galleries/${g.id}/probe`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      toast(data.updated > 0 ? `Updated ${data.updated} item${data.updated !== 1 ? 's' : ''}` : 'All up to date');
      if (data.updated > 0) loadContent();
    } else if (act === 'header') {
      const text = await promptModal({ title: 'Section header', okText: 'Add', field: { type: 'text', label: 'Header text' } });
      if (!text) return;
      await fetch(`/api/admin/galleries/${g.id}/headers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
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
  }
  function backToLibrary() {
    if (state.drawer.galleryId && state.drawer.dirty && !confirm('Discard unsaved changes?')) return;
    state.centreGalleryId = null;
    contentGid = null;
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
    if (e.key === 'Escape') {
      if (!$('drawer').hidden && state.drawer.galleryId) closeDrawer();
      else if (state.centreGalleryId) backToLibrary();
      else if (state.selection.size) clearSelection();
    }
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

    if (isProofing && g.token) {
      html += `<div class="drawer-block">
        <div class="d-label">Link</div>
        <div class="d-link-url">${escapeHtml(baseUrl + '/gallery/' + g.token)}</div>
        <div class="d-link-actions">
          <button class="link-btn accent" data-link="copy">Copy</button>
          <button class="link-btn accent" data-link="open">Open</button>
          <button class="link-btn accent" data-link="email">Email</button>
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
    body.querySelectorAll('[data-switch]').forEach(sw => sw.addEventListener('click', () => {
      const key = sw.getAttribute('data-switch');
      if (key === 'useCollection') { d.override = !d.override; state.drawer.dirty = true; renderDrawer(); return; }
      d[key] = !sw.classList.contains('on');
      sw.classList.toggle('on');
      state.drawer.dirty = true;
    }));
    body.querySelectorAll('[data-field]').forEach(inp => inp.addEventListener('input', () => {
      d[inp.getAttribute('data-field')] = inp.value;
      state.drawer.dirty = true;
    }));
    body.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => linkAction(g, b.getAttribute('data-link'))));
    body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => drawerAction(g, col, b.getAttribute('data-act'))));
  }

  async function linkAction(g, act) {
    const url = window.location.origin + '/gallery/' + g.token;
    if (act === 'copy') { navigator.clipboard.writeText(url); toast('Link copied'); }
    else if (act === 'open') { window.open(url, '_blank'); }
    else if (act === 'email') { openMailto(buildGalleryMailto(g)); }
    else if (act === 'regen') {
      if (!await confirmModal({ title: 'Regenerate link', message: 'The old link will stop working.' })) return;
      const res = await fetch(`/api/galleries/${g.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateToken: true }) });
      if (res.ok) { await loadData(); renderAll(); toast('Link regenerated'); }
    }
  }

  async function drawerAction(g, col, act) {
    const d = state.drawer.draft;
    if (act === 'save') {
      const body = { name: d.name, active: d.active };
      if (g.type === 'proofing') {
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
      const res = await fetch(`/api/galleries/${g.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        state.drawer.dirty = false;
        await loadData(); initDraft(); renderAll(); renderDrawer();
        toast('Saved');
      } else toast('Save failed');
    } else if (act === 'delete') {
      if (!await confirmModal({ title: 'Delete gallery', message: `Delete "${g.name}"? This cannot be undone.`, okText: 'Delete', danger: true })) return;
      const res = await fetch(`/api/galleries/${g.id}`, { method: 'DELETE' });
      if (res.ok) { closeDrawerForce(); state.centreGalleryId = null; contentGid = null; await loadData(); renderAll(); toast('Gallery deleted'); }
    } else if (act === 'duplicate') {
      toast('Creating copy…');
      const res = await fetch('/api/galleries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: g.name + ' (copy)', type: g.type }) });
      if (res.ok && col) {
        const ng = await res.json();
        const merged = [...(col.galleryIds || []), ng.id];
        await fetch(`/api/collections/${col.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: merged }) });
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
        await fetch(`/api/collections/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: c.galleryIds.filter(x => x !== g.id) }) });
      }
    }
    if (colId) {
      const target = state.collections.find(c => c.id === colId);
      if (target && !(target.galleryIds || []).includes(g.id)) {
        await fetch(`/api/collections/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: [...(target.galleryIds || []), g.id] }) });
      }
    }
    await loadData(); initDraft(); renderAll(); renderDrawer();
    toast('Moved');
  }

  function buildGalleryMailto(g) {
    if (!g || !g.token) return null;
    const url = window.location.origin + '/gallery/' + g.token;
    const subject = `Your gallery is ready — ${g.name}`;
    const pwLine = effective(g).hasPassword ? `\nPassword: [enter the gallery password here]\n` : '';
    const body = `Hello,\n\nYour gallery is ready.\n\n${url}\n${pwLine}\nThanks,\nAJ Mast`;
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

  async function loadContent() {
    if (!contentGid) return;
    const res = await fetch(`/api/admin/galleries/${contentGid}/videos`);
    if (!res.ok) { if (res.status === 401) checkAuth(); return; }
    const data = await res.json();
    contentItems = Array.isArray(data) ? data : (data.videos || []);
    const stats = (data && data.stats) || {};
    renderContentItems(contentItems, stats);
  }

  function renderContentItems(items, stats) {
    const list = $('content-list');
    if (!list) return;
    const dlItems = (stats && stats.downloads && stats.downloads.items) || {};
    if (!items.length) { list.innerHTML = `<div class="drawer-empty">No items yet. Use “Add files”.</div>`; return; }
    list.innerHTML = items.map(entry => {
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
      return `<div class="admin-video-item" data-id="${entry.id}">
        <span class="drag-handle">≡</span>
        ${media}
        <input type="text" class="title-input" value="${escapeHtml(entry.title)}">
        <span class="video-dl-count" title="${dlCount} downloads">↓ ${dlCount}</span>
        <button class="btn-icon replace-btn" title="Replace file">↻</button>
        ${isPhoto ? '' : `<button class="btn-icon cc-btn${(entry.captions && entry.captions.length) ? ' has-captions' : ''}" title="Captions">CC</button>`}
        ${isPhoto ? '' : `<button class="btn-icon thumb-btn" title="Set thumbnail">▦</button>`}
        <button class="btn-icon toggle-vis ${entry.visible ? '' : 'hidden-video'}" title="${entry.visible ? 'Visible' : 'Hidden'}">${entry.visible ? '◉' : '○'}</button>
        <button class="btn-icon delete-btn" title="Delete">×</button>
      </div>`;
    }).join('');
    if (contentSortable) { try { contentSortable.destroy(); } catch (_) {} }
    contentSortable = Sortable.create(list, {
      handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
      onEnd: async () => {
        const order = Array.from(list.querySelectorAll('.admin-video-item, .admin-header-item')).map(i => i.dataset.id);
        await fetch(`/api/admin/galleries/${contentGid}/reorder`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
      },
    });
  }

  // Delegated content interactions (survive drawer re-renders)
  document.addEventListener('change', async (e) => {
    if (!e.target.classList || !e.target.classList.contains('title-input')) return;
    const container = e.target.closest('.admin-video-item, .admin-header-item');
    if (!container || !contentGid) return;
    const id = container.dataset.id;
    if (container.dataset.type === 'header') {
      await fetch(`/api/admin/galleries/${contentGid}/headers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: e.target.value }) });
    } else {
      await fetch(`/api/admin/galleries/${contentGid}/videos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: e.target.value }) });
    }
  });
  document.addEventListener('click', async (e) => {
    const vis = e.target.closest('.toggle-vis');
    if (vis && contentGid) {
      const item = vis.closest('.admin-video-item'); const id = item.dataset.id;
      const newVisible = vis.classList.contains('hidden-video');
      const res = await fetch(`/api/admin/galleries/${contentGid}/videos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: newVisible }) });
      if (res.ok) { vis.classList.toggle('hidden-video', !newVisible); vis.textContent = newVisible ? '◉' : '○'; vis.title = newVisible ? 'Visible' : 'Hidden'; }
      return;
    }
    const del = e.target.closest('.admin-video-item .delete-btn, .admin-header-item .delete-btn');
    if (del && contentGid) {
      const item = del.closest('.admin-video-item, .admin-header-item'); const id = item.dataset.id;
      const isHeader = item.dataset.type === 'header';
      if (!await confirmModal({ title: isHeader ? 'Delete header' : 'Delete item', message: isHeader ? 'Delete this section header?' : 'Delete this item? This cannot be undone.', okText: 'Delete', danger: true })) return;
      const url = isHeader ? `/api/admin/galleries/${contentGid}/headers/${id}` : `/api/admin/galleries/${contentGid}/videos/${id}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) item.remove();
      return;
    }
    const rep = e.target.closest('.replace-btn');
    if (rep && contentGid) {
      replaceVideoId = rep.closest('.admin-video-item').dataset.id;
      $('replace-file-input').click();
      return;
    }
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
    const fd = new FormData(); fd.append('video', file);
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('load', () => { if (xhr.status >= 200 && xhr.status < 300) loadContent(); else toast('Replace failed'); replaceVideoId = null; $('replace-file-input').value = ''; });
    xhr.addEventListener('error', () => { toast('Replace failed'); replaceVideoId = null; $('replace-file-input').value = ''; });
    xhr.open('PUT', `/api/admin/galleries/${contentGid}/videos/${replaceVideoId}/replace`);
    xhr.send(fd);
  });

  // ==========================================================================
  // Drawer: Comments tab (ported)
  // ==========================================================================
  async function renderDrawerComments(g) {
    const body = $('drawer-body');
    body.innerHTML = `<div class="drawer-empty">Loading…</div>`;
    const res = await fetch(`/api/admin/galleries/${g.id}/comments`);
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
    const res = await fetch('/api/galleries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type: 'proofing' }) });
    if (!res.ok) { toast('Create failed'); return; }
    const g = await res.json();
    if (state.upload.destination.collectionId) {
      const col = state.collections.find(c => c.id === state.upload.destination.collectionId);
      if (col) await fetch(`/api/collections/${col.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: [...(col.galleryIds || []), g.id] }) });
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
    item.status = 'uploading'; item.error = '';
    const fd = new FormData(); fd.append('video', item.file); fd.append('title', item.title);
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
    xhr.open('POST', `/api/admin/galleries/${item.galleryId}/videos`);
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
  $('queue-cancel-all').addEventListener('click', () => { state.upload.queue.forEach(i => { if (i.xhr) i.xhr.abort(); }); state.upload.queue = []; renderQueues(); });

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
    else if (act === 'retry') { item.retries = 0; item.pct = 0; item.status = 'waiting'; item.error = ''; renderQueues(); pumpQueue(); }
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
  let thumbGid = null, thumbVideoId = null;

  function openThumbForItem(videoId) {
    thumbGid = contentGid; thumbVideoId = videoId;
    const item = contentItems.find(v => v.id === videoId);
    if (item && item.filename) openThumbPicker('/uploads/' + encodeURIComponent(item.filename));
  }
  function openThumbForUploaded(queueItem) {
    thumbGid = queueItem.galleryId; thumbVideoId = queueItem.uploaded.id;
    openThumbPicker('/uploads/' + encodeURIComponent(queueItem.uploaded.filename));
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
    const res = await fetch(`/api/admin/galleries/${gid}/videos/${videoId}/thumbnail`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to save thumbnail'); }
  }
  $('thumb-capture-btn').addEventListener('click', async () => {
    const btn = $('thumb-capture-btn'); btn.disabled = true; btn.textContent = 'Saving…';
    try { const blob = await captureFrameAsJpegBlob(thumbVideo); await uploadThumbnailBlob(thumbGid, thumbVideoId, blob); closeThumbPicker(); if (contentGid === thumbGid) loadContent(); toast('Thumbnail set'); }
    catch (err) { toast(err.message || 'Failed'); }
    finally { btn.disabled = false; btn.textContent = 'Set Thumbnail'; }
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
  function closeThumbPicker() { thumbPicker.classList.remove('open'); thumbVideo.pause(); thumbVideo.src = ''; thumbVideoId = null; }

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
  let captionsVideoId = null;
  const captionLangSelect = $('caption-lang');
  captionLangSelect.innerHTML = CAPTION_LANGUAGES.map(l => `<option value="${l.code}">${escapeHtml(l.label)} (${l.code})</option>`).join('') + '<option value="__custom__">Other…</option>';
  captionLangSelect.addEventListener('change', () => { $('caption-custom-lang-label').style.display = captionLangSelect.value === '__custom__' ? '' : 'none'; });

  function openCaptionsModal(videoId) {
    captionsVideoId = videoId;
    $('caption-upload-status').textContent = ''; $('caption-file-input').value = '';
    captionLangSelect.value = CAPTION_LANGUAGES[0].code; $('caption-custom-lang-label').style.display = 'none';
    $('caption-custom-code').value = ''; $('caption-custom-label').value = '';
    const item = contentItems.find(v => v.id === videoId);
    $('captions-modal-title').textContent = item ? '— ' + item.title : '';
    renderCaptionsList();
    $('captions-modal').hidden = false;
  }
  function renderCaptionsList() {
    const item = contentItems.find(v => v.id === captionsVideoId);
    const captions = (item && item.captions) || [];
    const el = $('captions-list');
    if (!captions.length) { el.innerHTML = `<p class="setting-hint">No captions yet.</p>`; return; }
    el.innerHTML = captions.map(c => `<div class="editable-row"><span class="er-key">${escapeHtml(c.label || c.lang)} <span style="color:var(--text-5);">(${escapeHtml(c.lang)})</span></span><button class="btn-icon caption-track-remove" data-lang="${escapeHtml(c.lang)}">×</button></div>`).join('');
  }
  $('captions-close-btn').addEventListener('click', () => { $('captions-modal').hidden = true; captionsVideoId = null; });
  $('captions-modal').querySelector('.modal-backdrop').addEventListener('click', () => { $('captions-modal').hidden = true; });
  $('captions-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.caption-track-remove'); if (!btn || !captionsVideoId) return;
    const lang = btn.dataset.lang;
    if (!await confirmModal({ title: 'Remove caption', message: `Remove the "${lang}" caption track?`, okText: 'Remove', danger: true })) return;
    const res = await fetch(`/api/admin/galleries/${contentGid}/videos/${captionsVideoId}/captions/${encodeURIComponent(lang)}`, { method: 'DELETE' });
    if (res.ok) { await loadContent(); renderCaptionsList(); } else $('caption-upload-status').textContent = 'Could not remove caption.';
  });
  $('caption-upload-btn').addEventListener('click', async () => {
    if (!captionsVideoId) return;
    const file = $('caption-file-input').files[0];
    if (!file) { $('caption-upload-status').textContent = 'Choose a .vtt file first.'; return; }
    let lang, label;
    if (captionLangSelect.value === '__custom__') {
      lang = $('caption-custom-code').value.trim().toLowerCase(); label = $('caption-custom-label').value.trim();
      if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(lang)) { $('caption-upload-status').textContent = 'Enter a valid code (e.g. en or pt-br).'; return; }
    } else { lang = captionLangSelect.value; const k = CAPTION_LANGUAGES.find(l => l.code === lang); label = k ? k.label : lang.toUpperCase(); }
    const fd = new FormData(); fd.append('caption', file); fd.append('lang', lang); fd.append('label', label);
    $('caption-upload-status').textContent = 'Uploading…';
    const res = await fetch(`/api/admin/galleries/${contentGid}/videos/${captionsVideoId}/captions`, { method: 'POST', body: fd });
    if (res.ok) { $('caption-file-input').value = ''; $('caption-upload-status').textContent = 'Caption added.'; await loadContent(); renderCaptionsList(); }
    else { const e = await res.json().catch(() => ({})); $('caption-upload-status').textContent = e.error || 'Upload failed.'; }
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
      const res = await fetch('/api/admin/import/files');
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
      const res = await fetch(`/api/admin/galleries/${contentGid}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filenames }) });
      const data = await res.json();
      if (data.imported && data.imported.length) { importModal.hidden = true; if (contentGid === state.drawer.galleryId) loadContent(); refreshCountsSoon(); toast(`Imported ${data.imported.length}`); }
      if (data.errors && data.errors.length) toast('Some files failed to import');
    } catch (err) { toast('Import failed'); }
    finally { $('import-confirm-btn').disabled = false; $('import-confirm-btn').textContent = 'Import Selected'; }
  });

  // ==========================================================================
  // New gallery / new collection modals
  // ==========================================================================
  function openNewGallery(collectionId) {
    const modal = $('new-gallery-modal');
    $('ng-name').value = 'Client Gallery';
    modal.querySelectorAll('input[name="ng-type"]').forEach(r => r.checked = r.value === 'proofing');
    const colSel = $('ng-collection');
    colSel.innerHTML = `<option value="">— None —</option>` + state.collections.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (collectionId) colSel.value = collectionId;
    modal.hidden = false;
    $('ng-name').focus(); $('ng-name').select();
  }
  $('ng-cancel').addEventListener('click', () => $('new-gallery-modal').hidden = true);
  $('new-gallery-modal').querySelector('.modal-backdrop').addEventListener('click', () => $('new-gallery-modal').hidden = true);
  document.querySelectorAll('input[name="ng-type"]').forEach(r => r.addEventListener('change', () => {
    $('ng-collection-group').style.display = r.value === 'reels' ? 'none' : '';
  }));
  $('ng-create').addEventListener('click', async () => {
    const name = $('ng-name').value.trim(); if (!name) { $('ng-name').focus(); return; }
    const type = document.querySelector('input[name="ng-type"]:checked').value;
    const colId = type === 'proofing' ? $('ng-collection').value : '';
    $('new-gallery-modal').hidden = true;
    const res = await fetch('/api/galleries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type }) });
    if (!res.ok) { toast('Create failed'); return; }
    const g = await res.json();
    if (colId) {
      const col = state.collections.find(c => c.id === colId);
      if (col) await fetch(`/api/collections/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ galleryIds: [...(col.galleryIds || []), g.id] }) });
    }
    await loadData(); renderAll(); openGallery(g.id);
    toast('Gallery created');
  });

  const ncModal = $('new-collection-modal');
  let ncState = { downloads: false, commenting: false };
  let ncEditingId = null;
  let ncClearPassword = false;

  function openCollectionModal(id) {
    closeAllMenus();
    ncEditingId = id || null;
    ncClearPassword = false;
    const col = ncEditingId ? state.collections.find(c => c.id === ncEditingId) : null;

    $('nc-title').textContent = col ? 'Edit collection' : 'New collection';
    $('nc-sub').textContent = col ? 'Update sharing settings for this collection.' : 'Group client galleries under one shareable link.';
    $('nc-create').textContent = col ? 'Save Changes' : 'Create Collection';
    $('nc-delete').hidden = !col;
    $('nc-link-group').hidden = !col;

    $('nc-name').value = col ? col.name : '';
    $('nc-link').value = col ? window.location.origin + '/collection/' + col.token : '';
    $('nc-link-hint').textContent = col ? 'Share this link with your client.' : 'The link is created when you save the collection.';
    $('nc-password').value = '';
    $('nc-password').placeholder = col && col.hasPassword ? '(set — type to change)' : 'No password';
    $('nc-password-clear').hidden = !(col && col.hasPassword);
    $('nc-expires').value = col && col.expiresAt ? col.expiresAt.split('T')[0] : '';

    ncState = { downloads: col ? !!col.downloadsEnabled : false, commenting: col ? !!col.commentingEnabled : false };
    $('nc-downloads').classList.toggle('on', ncState.downloads);
    $('nc-commenting').classList.toggle('on', ncState.commenting);

    const gl = $('nc-galleries');
    const avail = state.galleries.filter(g => g.type === 'proofing' && g.active !== false);
    const memberIds = new Set(col ? (col.galleryIds || []) : []);
    gl.innerHTML = avail.length
      ? avail.map(g => `<label class="gal-check-row"><input type="checkbox" value="${g.id}"${memberIds.has(g.id) ? ' checked' : ''}><span>${escapeHtml(g.name)}</span></label>`).join('')
      : `<p class="setting-hint" style="padding:8px;">No client galleries yet.</p>`;

    ncModal.hidden = false;
    $('nc-name').focus();
  }
  $('nc-downloads').addEventListener('click', () => { ncState.downloads = !ncState.downloads; $('nc-downloads').classList.toggle('on'); });
  $('nc-commenting').addEventListener('click', () => { ncState.commenting = !ncState.commenting; $('nc-commenting').classList.toggle('on'); });
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
  $('nc-regen').addEventListener('click', async () => {
    if (!ncEditingId) return;
    if (!await confirmModal({ title: 'Regenerate link', message: 'The old link will stop working.' })) return;
    const res = await fetch(`/api/collections/${ncEditingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateToken: true }) });
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
    const res = await fetch(`/api/collections/${ncEditingId}`, { method: 'DELETE' });
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
    const body = {
      name, galleryIds,
      downloadsEnabled: ncState.downloads, commentingEnabled: ncState.commenting,
      expiresAt: $('nc-expires').value ? new Date($('nc-expires').value + 'T23:59:59').toISOString() : null,
    };
    const pw = $('nc-password').value.trim();
    if (pw) body.password = pw;
    else if (ncEditingId && ncClearPassword) body.password = '';

    const url = ncEditingId ? `/api/collections/${ncEditingId}` : '/api/collections';
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

  function copyCollectionLink(colId) {
    const col = state.collections.find(c => c.id === colId);
    if (!col) return;
    navigator.clipboard.writeText(window.location.origin + '/collection/' + col.token);
    toast('Collection link copied');
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
    } else {
      field.innerHTML = `<div class="setting-group"><label>${escapeHtml(f.label || '')}</label><input type="${f.type}" class="setting-input" id="prompt-input" placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(f.value || '')}"></div>`;
    }
    modal.hidden = false;
    const input = $('prompt-input'); input.focus(); if (input.select) input.select();
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

  // ==========================================================================
  // Settings screen (ported panels)
  // ==========================================================================
  let settingsLoaded = { email: false, header: false };
  function openSettings() {
    switchSettingsTab('email');
  }
  document.querySelectorAll('.settings-tab').forEach(tab => tab.addEventListener('click', () => switchSettingsTab(tab.dataset.settingsTab)));
  function switchSettingsTab(name) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.settingsTab === name));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.hidden = c.id !== 'settings-tab-' + name);
    if (name === 'email' && !settingsLoaded.email) { loadEmailSettings(); settingsLoaded.email = true; }
    if (name === 'update') { checkForUpdates(); loadVideoToolsStatus(); }
    if (name === 'header' && !settingsLoaded.header) { loadHeaderConfig(); settingsLoaded.header = true; }
    if (name === 'api') loadApiTokenState();
  }

  // --- Email ---
  async function loadEmailSettings() {
    const res = await fetch('/api/settings/email'); if (!res.ok) return;
    const c = await res.json();
    $('resend-api-key').value = c.resendApiKey || ''; $('smtp-host').value = c.host || '';
    $('smtp-port').value = c.port || 587; $('smtp-secure').checked = !!c.secure;
    $('smtp-user').value = c.user || ''; $('smtp-pass').value = c.pass || '';
    $('smtp-from').value = c.from || ''; $('smtp-admin-email').value = c.adminEmail || ''; $('smtp-base-url').value = c.baseUrl || '';
  }
  $('save-email-btn').addEventListener('click', async () => {
    const body = { resendApiKey: $('resend-api-key').value, host: $('smtp-host').value, port: $('smtp-port').value, secure: $('smtp-secure').checked, user: $('smtp-user').value, pass: $('smtp-pass').value, from: $('smtp-from').value, adminEmail: $('smtp-admin-email').value, baseUrl: $('smtp-base-url').value };
    const res = await fetch('/api/settings/email', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const s = $('email-status');
    if (res.ok) { s.textContent = 'Settings saved.'; s.className = 'email-status success'; } else { s.textContent = 'Failed to save.'; s.className = 'email-status error'; }
    setTimeout(() => { s.textContent = ''; s.className = 'email-status'; }, 4000);
  });
  $('test-email-btn').addEventListener('click', async () => {
    const s = $('email-status'); s.textContent = 'Sending test email…';
    const res = await fetch('/api/settings/email/test', { method: 'POST' }); s.textContent = '';
    if (res.ok) showEmailResult('success', 'Email Test Succeeded', 'Test email sent! Check your inbox.');
    else { const d = await res.json().catch(() => ({})); showEmailResult('error', 'Email Test Failed', d.error || 'Failed to send test email.'); }
  });
  function showEmailResult(type, title, msg) {
    $('email-result-title').textContent = title;
    $('email-result-title').style.color = type === 'error' ? 'var(--danger)' : '#4caf50';
    $('email-result-text').textContent = msg;
    $('email-result-copy-btn').style.display = type === 'error' ? '' : 'none';
    $('email-result-modal').hidden = false;
  }
  $('email-result-close-btn').addEventListener('click', () => $('email-result-modal').hidden = true);
  $('email-result-modal').querySelector('.modal-backdrop').addEventListener('click', () => $('email-result-modal').hidden = true);
  $('email-result-copy-btn').addEventListener('click', () => { navigator.clipboard.writeText($('email-result-text').textContent); $('email-result-copy-btn').textContent = 'Copied!'; setTimeout(() => $('email-result-copy-btn').textContent = 'Copy Error', 1800); });

  // --- Update ---
  let updateChecked = false;
  async function checkForUpdates() {
    if (updateChecked) return;
    const loading = $('update-loading'), info = $('update-info');
    loading.style.display = ''; info.hidden = true;
    try {
      const data = await (await fetch('/api/settings/update')).json();
      $('update-local-version').textContent = data.localVersion || 'unknown';
      $('update-local-commit').textContent = data.localCommit ? `(${data.localCommit})` : '';
      if (data.updateAvailable) {
        $('update-available-section').hidden = false; $('update-current-section').hidden = true;
        $('update-remote-version').textContent = data.remoteVersion || '';
        $('update-remote-commit').textContent = data.remoteCommit ? `(${data.remoteCommit})` : '';
        if (data.commitLog) { $('update-commit-log').hidden = false; $('update-commits').textContent = data.commitLog; }
        if (data.changelog) { $('update-changelog-section').hidden = false; $('update-changelog').textContent = data.changelog; }
      } else { $('update-available-section').hidden = true; $('update-current-section').hidden = false; }
      if (!data.enabled) $('deploy-btn').style.display = 'none';
    } catch (_) { loading.textContent = 'Failed to check for updates.'; return; }
    loading.style.display = 'none'; info.hidden = false; updateChecked = true;
  }
  $('deploy-btn').addEventListener('click', async () => {
    if (!await confirmModal({ title: 'Update', message: 'Update to the latest version?' })) return;
    const btn = $('deploy-btn'); btn.disabled = true; btn.textContent = 'Updating…';
    const s = $('deploy-status'); s.textContent = '';
    try {
      const res = await fetch('/api/settings/deploy', { method: 'POST' }); const d = await res.json();
      if (res.ok) { s.textContent = d.message || 'Update successful!'; s.style.color = '#4caf50'; setTimeout(() => location.reload(), 1500); }
      else { s.textContent = d.error || 'Update failed.'; s.style.color = 'var(--danger)'; btn.disabled = false; btn.textContent = 'Update to Latest Version'; }
    } catch (e) { s.textContent = 'Network error.'; s.style.color = 'var(--danger)'; btn.disabled = false; btn.textContent = 'Update to Latest Version'; }
  });
  async function loadVideoToolsStatus() {
    const statusEl = $('video-tools-status'), btn = $('install-ffmpeg-btn');
    statusEl.textContent = 'Checking…';
    try {
      const data = await (await fetch('/api/admin/video-tools/status')).json();
      if (data.ffmpeg && data.ffprobe) { statusEl.textContent = '✅ Installed' + (data.version ? ' (ffmpeg ' + data.version + ')' : '') + ' — embedded captions are extracted automatically.'; btn.textContent = 'Reinstall Video Tools'; }
      else { statusEl.textContent = '⚠️ Not installed — captions baked into MP4s won’t be extracted until installed.'; btn.textContent = 'Install Video Tools'; }
      btn.disabled = false;
    } catch (e) { statusEl.textContent = 'Could not check status.'; btn.disabled = false; }
  }
  $('install-ffmpeg-btn').addEventListener('click', async () => {
    if (!await confirmModal({ title: 'Install video tools', message: 'Download and install a static ffmpeg build on the server? This can take a minute.' })) return;
    const btn = $('install-ffmpeg-btn'), resultEl = $('video-tools-result'); btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Installing…'; resultEl.textContent = '';
    try {
      const res = await fetch('/api/admin/video-tools/install', { method: 'POST' }); const d = await res.json();
      if (res.ok && d.ok) { resultEl.textContent = '✅ Installed' + (d.status && d.status.version ? ' ffmpeg ' + d.status.version : '') + '.'; resultEl.style.color = '#4caf50'; }
      else { resultEl.textContent = (d && d.error) || 'Install failed.'; resultEl.style.color = 'var(--danger)'; }
    } catch (e) { resultEl.textContent = 'Network error.'; resultEl.style.color = 'var(--danger)'; }
    btn.textContent = orig; loadVideoToolsStatus();
  });

  // --- Header config ---
  let headerConfig = null;
  async function loadHeaderConfig() {
    try { headerConfig = await (await fetch('/api/header')).json(); populateHeaderForm(); }
    catch (e) { $('header-status').textContent = 'Failed to load header config.'; }
  }
  function populateHeaderForm() {
    if (!headerConfig) return;
    const logo = headerConfig.logo || {};
    $('header-site-name').value = headerConfig.siteName || '';
    $('header-logo-text').value = logo.text || '';
    if (logo.src) { const p = $('header-logo-preview'); p.src = logo.src; p.style.display = ''; $('header-logo-none').style.display = 'none'; $('header-logo-remove').style.display = ''; }
    $('header-logo-alt').value = logo.alt || ''; $('header-logo-link').value = logo.link || '';
    $('header-email').value = headerConfig.email || ''; $('header-phone').value = headerConfig.phone || ''; $('header-tagline').value = headerConfig.tagline || '';
    renderNavItems(headerConfig.nav || []);
  }
  function renderNavItems(nav) {
    const list = $('header-nav-list'); list.innerHTML = '';
    nav.forEach((item) => {
      const el = document.createElement('div'); el.className = 'header-nav-item';
      if (item.type === 'link') {
        el.innerHTML = `<div class="header-nav-item-row">
          <span class="drag-handle">≡</span>
          <input type="text" class="setting-input nav-label" value="${escapeHtml(item.label || '')}" placeholder="Label" style="width:150px;">
          <input type="text" class="setting-input nav-url" value="${escapeHtml(item.url || '')}" placeholder="URL" style="flex:1;">
          <label class="toggle-label" style="font-size:12px;white-space:nowrap;"><input type="checkbox" class="nav-external" ${item.external ? 'checked' : ''}> New tab</label>
          <button class="btn-icon nav-delete">×</button></div>`;
      } else {
        const children = (item.children || []).map(ch => `<div class="header-nav-child-row"><span style="width:24px;"></span><input type="text" class="setting-input child-label" value="${escapeHtml(ch.label || '')}" placeholder="Label" style="width:150px;"><input type="text" class="setting-input child-url" value="${escapeHtml(ch.url || '')}" placeholder="URL" style="flex:1;"><button class="btn-icon child-delete">×</button></div>`).join('');
        el.innerHTML = `<div class="header-nav-item-row">
          <span class="drag-handle">≡</span>
          <input type="text" class="setting-input nav-label" value="${escapeHtml(item.label || '')}" placeholder="Dropdown label" style="width:150px;">
          <span class="setting-hint" style="flex:1;">Dropdown menu</span>
          <button class="btn-icon nav-add-child">+</button>
          <button class="btn-icon nav-delete">×</button></div>
          <div class="header-nav-children">${children}</div>`;
      }
      list.appendChild(el);
    });
  }
  function collectNav() {
    const items = [];
    document.querySelectorAll('.header-nav-item').forEach(el => {
      const label = el.querySelector('.nav-label').value.trim();
      const urlInput = el.querySelector('.nav-url');
      if (urlInput) items.push({ type: 'link', label, url: urlInput.value.trim(), external: el.querySelector('.nav-external')?.checked || false });
      else {
        const children = [];
        el.querySelectorAll('.header-nav-child-row').forEach(r => { const cl = r.querySelector('.child-label').value.trim(); const cu = r.querySelector('.child-url').value.trim(); if (cl || cu) children.push({ label: cl, url: cu }); });
        items.push({ type: 'dropdown', label, children });
      }
    });
    return items;
  }
  $('header-add-link').addEventListener('click', () => { const nav = collectNav(); nav.push({ type: 'link', label: '', url: '', external: false }); renderNavItems(nav); });
  $('header-add-dropdown').addEventListener('click', () => { const nav = collectNav(); nav.push({ type: 'dropdown', label: '', children: [{ label: '', url: '' }] }); renderNavItems(nav); });
  $('header-nav-list').addEventListener('click', (e) => {
    if (e.target.closest('.nav-delete')) e.target.closest('.header-nav-item').remove();
    else if (e.target.closest('.child-delete')) e.target.closest('.header-nav-child-row').remove();
    else if (e.target.closest('.nav-add-child')) {
      const c = e.target.closest('.header-nav-item').querySelector('.header-nav-children');
      const row = document.createElement('div'); row.className = 'header-nav-child-row';
      row.innerHTML = `<span style="width:24px;"></span><input type="text" class="setting-input child-label" placeholder="Label" style="width:150px;"><input type="text" class="setting-input child-url" placeholder="URL" style="flex:1;"><button class="btn-icon child-delete">×</button>`;
      c.appendChild(row);
    }
  });
  $('header-logo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('logo', file);
    $('header-status').textContent = 'Uploading logo…';
    const res = await fetch('/api/settings/header/logo', { method: 'POST', body: fd }); const d = await res.json();
    if (res.ok) { const p = $('header-logo-preview'); p.src = d.src + '?t=' + Date.now(); p.style.display = ''; $('header-logo-none').style.display = 'none'; $('header-logo-remove').style.display = ''; $('header-status').textContent = 'Logo uploaded.'; }
    else $('header-status').textContent = d.error || 'Upload failed.';
  });
  $('header-logo-remove').addEventListener('click', () => { $('header-logo-preview').src = ''; $('header-logo-preview').style.display = 'none'; $('header-logo-none').style.display = ''; $('header-logo-remove').style.display = 'none'; $('header-logo-file').value = ''; });
  $('save-header-btn').addEventListener('click', async () => {
    const preview = $('header-logo-preview');
    const logoSrc = (preview.style.display !== 'none' && preview.getAttribute('src')) ? preview.getAttribute('src') : '';
    const config = { siteName: $('header-site-name').value.trim(), logo: { src: logoSrc, text: $('header-logo-text').value.trim(), alt: $('header-logo-alt').value.trim(), link: $('header-logo-link').value.trim(), height: 74 }, email: $('header-email').value.trim(), phone: $('header-phone').value.trim(), tagline: $('header-tagline').value.trim(), nav: collectNav() };
    $('header-status').textContent = 'Saving…';
    const res = await fetch('/api/settings/header', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    if (res.ok) { $('header-status').textContent = 'Header saved.'; $('header-status').style.color = '#4caf50'; }
    else { const d = await res.json().catch(() => ({})); $('header-status').textContent = d.error || 'Save failed.'; $('header-status').style.color = 'var(--danger)'; }
  });

  // --- API token ---
  async function loadApiTokenState() {
    $('api-token-loading').style.display = ''; $('api-token-env-state').hidden = true; $('api-token-state').hidden = true; $('api-token-status').textContent = '';
    try {
      const info = await (await fetch('/api/settings/api-token')).json();
      $('api-token-loading').style.display = 'none';
      if (info.envManaged) { $('api-token-env-state').hidden = false; return; }
      $('api-token-state').hidden = false;
      if (info.hasToken) { $('api-token-status-text').textContent = 'An API token is active.'; $('api-token-generate-btn').style.display = 'none'; $('api-token-regenerate-btn').style.display = ''; $('api-token-revoke-btn').style.display = ''; }
      else { $('api-token-status-text').textContent = 'No API token is set.'; $('api-token-generate-btn').style.display = ''; $('api-token-regenerate-btn').style.display = 'none'; $('api-token-revoke-btn').style.display = 'none'; }
    } catch (e) { $('api-token-loading').textContent = 'Could not load API token state.'; }
  }
  async function generateApiToken(rotate) {
    if (rotate && !await confirmModal({ title: 'Rotate token', message: 'Any client using the old token will get 401 errors.' })) return;
    $('api-token-status').textContent = 'Generating…';
    try {
      const res = await fetch('/api/settings/api-token', { method: 'POST' }); const d = await res.json();
      if (!res.ok) { $('api-token-status').textContent = d.error || 'Error'; return; }
      $('api-token-status').textContent = '';
      $('api-token-reveal-input').value = d.token; $('api-token-modal').hidden = false;
      $('api-token-reveal-input').focus(); $('api-token-reveal-input').select();
      loadApiTokenState();
    } catch (e) { $('api-token-status').textContent = 'Network error.'; }
  }
  $('api-token-generate-btn').addEventListener('click', () => generateApiToken(false));
  $('api-token-regenerate-btn').addEventListener('click', () => generateApiToken(true));
  $('api-token-revoke-btn').addEventListener('click', async () => {
    if (!await confirmModal({ title: 'Revoke token', message: 'Any client using it will immediately get 401 errors.', okText: 'Revoke', danger: true })) return;
    const res = await fetch('/api/settings/api-token', { method: 'DELETE' });
    if (res.ok) { $('api-token-status').textContent = 'Token revoked.'; loadApiTokenState(); }
  });
  $('api-token-copy-btn').addEventListener('click', () => { navigator.clipboard.writeText($('api-token-reveal-input').value); $('api-token-copy-btn').textContent = 'Copied!'; setTimeout(() => $('api-token-copy-btn').textContent = 'Copy', 1500); });
  $('api-token-modal-done-btn').addEventListener('click', () => { $('api-token-modal').hidden = true; $('api-token-reveal-input').value = ''; });

  // ==========================================================================
  // Narrow-screen rail toggle
  // ==========================================================================
  function ensureRailToggle() {
    if ($('rail-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'rail-toggle'; btn.className = 'account-btn'; btn.textContent = '☰';
    btn.style.marginRight = '4px';
    btn.addEventListener('click', (e) => { e.stopPropagation(); $('rail').classList.toggle('open'); });
    document.querySelector('.topbar').insertBefore(btn, document.querySelector('.brand'));
  }
  function syncRailToggle() {
    const t = $('rail-toggle');
    if (window.innerWidth < 1100) { ensureRailToggle(); if ($('rail-toggle')) $('rail-toggle').style.display = ''; }
    else if (t) t.style.display = 'none';
  }
  window.addEventListener('resize', syncRailToggle);

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
