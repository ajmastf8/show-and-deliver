/* ==========================================================================
   Show & Deliver — Portfolio admin
   The Portfolio tab. Categories and galleries are folders under
   site-data/portfolio/, so everything here is a thin editor over what the
   server scanned: each action writes to disk and re-renders from the reply.
   Shared helpers (api, toast, dialogs, chunked upload, frame capture) come
   from admin.js through window.SDAdmin.
   ========================================================================== */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = () => window.SDAdmin;
  const esc = (s) => window.SDAdmin.escapeHtml(String(s ?? ''));

  const state = {
    tree: null,
    categoryId: null,   // rail selection; null means every category
    galleryId: null,    // open gallery editor
    gallery: null,      // its payload
    design: false,      // the Site design panel
    pagesView: false,   // the Pages panel
    readinessView: false, // the Readiness panel
    readiness: null,    // its payload
    duplicatesView: false, // the Duplicates panel
    duplicates: null,   // its payload
    trashView: false,   // the Trash panel
    trash: null,        // its payload
    item: null,         // the open item's metadata view
    selectMode: false,  // multi-select in the open gallery's item grid
    selected: new Set(), // selected file names, while selectMode is on
    railOpen: (() => { try { return new Set(JSON.parse(localStorage.getItem('pfa-rail-open') || '[]')); } catch (_) { return new Set(); } })(),
    settingsOpen: (() => { try { const v = localStorage.getItem('pfa-settings-open'); return v == null ? null : v === '1'; } catch (_) { return null; } })(),
    pages: [],
    pageId: null,
    migration: null,    // reels galleries still waiting to move into folders
    header: null,       // header.json, while that panel is open
    theme: null,
    loading: false,
    processing: { running: false, remaining: 0, needsPoster: [] },
    uploads: new Map(), // name -> percent, while a drop is in flight
  };

  // Each layout is shown as the shape it makes, which reads faster than four
  // names in a dropdown.
  const LAYOUTS = [
    ['justified', 'Justified rows', '<rect x="1" y="2" width="16" height="10"/><rect x="19" y="2" width="24" height="10"/><rect x="1" y="14" width="26" height="10"/><rect x="29" y="14" width="14" height="10"/>'],
    ['masonry', 'Masonry', '<rect x="1" y="2" width="12" height="14"/><rect x="15" y="2" width="12" height="9"/><rect x="29" y="2" width="12" height="18"/><rect x="1" y="18" width="12" height="6"/><rect x="15" y="13" width="12" height="11"/><rect x="29" y="22" width="12" height="2"/>'],
    ['grid', 'Grid', '<rect x="1" y="2" width="12" height="10"/><rect x="15" y="2" width="12" height="10"/><rect x="29" y="2" width="12" height="10"/><rect x="1" y="14" width="12" height="10"/><rect x="15" y="14" width="12" height="10"/><rect x="29" y="14" width="12" height="10"/>'],
    ['slideshow', 'Slideshow', '<rect x="7" y="2" width="30" height="22"/><rect x="1" y="10" width="4" height="6"/><rect x="39" y="10" width="4" height="6"/>'],
    ['horizontal', 'Horizontal row', '<rect x="1" y="4" width="14" height="18"/><rect x="17" y="4" width="20" height="18"/><rect x="39" y="4" width="10" height="18"/>'],
    ['fullscreen', 'Full screen', '<rect x="4" y="2" width="36" height="22"/>'],
    ['featured', 'Featured tiles', '<rect x="1" y="2" width="20" height="14"/><rect x="23" y="2" width="9" height="6"/><rect x="34" y="2" width="9" height="6"/><rect x="23" y="10" width="20" height="6"/><rect x="1" y="18" width="9" height="6"/><rect x="12" y="18" width="9" height="6"/>'],
  ];

  // Presentation options, in the words the admin shows.
  const OPTION_SETS = [
    ['gap', 'Spacing', [['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide']]],
    ['density', 'Image size', [['compact', 'Smaller'], ['normal', 'Normal'], ['roomy', 'Larger']]],
    ['titles', 'Titles', [['none', 'Hidden'], ['hover', 'On hover'], ['under', 'Always']]],
    ['crop', 'Thumbnails', [['fit', 'Whole frame'], ['fill', 'Cropped']]],
    ['watermark', 'Watermark', [['inherit', 'Inherit'], ['off', 'Off']]],
  ];

  const TILE_SIZES = [['normal', 'Normal'], ['wide', 'Wide'], ['tall', 'Tall'], ['big', 'Big']];

  function optionControls(o) {
    return OPTION_SETS.map(([key, label, choices]) => `
      <div class="pfa-field">
        <span>${label}</span>
        <div class="pfa-seg">
          ${choices.map(([v, l]) => `<button type="button" class="${(o[key] || '') === v ? 'active' : ''}" data-opt="${key}" data-val="${v}">${l}</button>`).join('')}
        </div>
      </div>`).join('');
  }

  function layoutPicker(current) {
    return `<div class="pfa-layouts">${LAYOUTS.map(([v, label, shape]) => `
      <button type="button" class="pfa-layout-opt ${current === v ? 'active' : ''}" data-layout="${v}" title="${label}">
        <svg viewBox="0 0 44 26" aria-hidden="true">${shape}</svg>
        <span>${label}</span>
      </button>`).join('')}</div>`;
  }

  // ---------- Server ----------

  async function req(url, opts = {}) {
    const res = await S().api(url, {
      ...opts,
      headers: opts.body instanceof FormData ? opts.headers : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  const send = (url, method, body) => req(url, { method, body: JSON.stringify(body || {}) });

  async function loadTree() {
    state.tree = await req('/api/admin/portfolio');
    state.migration = await req('/api/admin/portfolio/migrate').catch(() => null);
    // The readiness summary rides along once, so the browse can show the gate
    // without opening the panel; the panel refreshes it on demand.
    if (!state.readiness) state.readiness = await req('/api/admin/portfolio/readiness').catch(() => null);
    if (state.categoryId && !state.tree.categories.some(c => c.id === state.categoryId)) state.categoryId = null;
  }

  async function loadGallery(gid) {
    const data = await req('/api/admin/portfolio/galleries/' + encodeURIComponent(gid));
    state.gallery = data.gallery;
    state.galleryId = gid;
  }

  // Wraps an action: run it, refresh, re-render, and surface any error.
  async function act(fn) {
    if (state.loading) return;
    state.loading = true;
    try {
      await fn();
      await loadTree();
      if (state.galleryId) await loadGallery(state.galleryId).catch(() => { state.galleryId = null; state.gallery = null; });
      render();
      scheduleProcessing();
    } catch (err) {
      S().toast(err.message || 'Something went wrong');
    } finally {
      state.loading = false;
    }
  }

  // ---------- Derivatives ----------

  // Thumbnails and proxies are built server-side in short slices, and video
  // posters in the browser (the host has no ffmpeg). Both run only while this
  // tab is open, so the work follows the person who added the files.
  function scheduleProcessing() {
    const pending = (state.tree?.categories || []).some(c =>
      c.galleries.some(g => g.processing > 0 || g.needsPoster > 0));
    if (pending && !state.processing.running) processingLoop();
  }

  async function processingLoop() {
    state.processing.running = true;
    try {
      for (let pass = 0; pass < 200; pass++) {
        if ($('screen-portfolio').hidden) break;
        const r = await send('/api/admin/portfolio/process', 'POST', { galleryId: state.galleryId || null });
        state.processing.remaining = r.remaining || 0;
        state.processing.needsPoster = r.needsPoster || [];
        renderProgress();
        if (r.busy) { await sleep(3000); continue; }

        let captured = 0;
        for (const item of state.processing.needsPoster.slice(0, 4)) {
          if (await capturePoster(item)) captured++;
        }
        if (r.processed || captured) {
          await loadTree();
          if (state.galleryId) await loadGallery(state.galleryId).catch(() => {});
          render();
        }
        if (!r.processed && !captured) break;
        await sleep(300);
      }
    } catch (_) {
      // A failed slice just means the pill stays; the next action retries.
    } finally {
      state.processing.running = false;
      renderProgress();
    }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Grabs a frame from a video that has no poster file and sends it up, along
  // with the real pixel size, which the server can't read for every format.
  async function capturePoster(item) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.src = item.src;
    const waitFor = (ev, ms) => new Promise((res, rej) => {
      let done = false;
      v.addEventListener(ev, () => { if (!done) { done = true; res(); } }, { once: true });
      v.addEventListener('error', () => { if (!done) { done = true; rej(new Error(ev)); } }, { once: true });
      setTimeout(() => { if (!done) { done = true; rej(new Error('timeout')); } }, ms);
    });
    try {
      await waitFor('loadedmetadata', 30000);
      const dur = v.duration || 0;
      const upper = Math.min(10, isFinite(dur) && dur > 0 ? dur : 10);
      const lo = Math.min(0.3, upper);
      v.currentTime = lo + Math.random() * Math.max(0, upper - lo);
      await waitFor('seeked', 15000);
      const blob = await S().captureFrameAsJpegBlob(v);
      const url = `/api/admin/portfolio/galleries/${encodeURIComponent(item.galleryId)}/items/${encodeURIComponent(item.file)}/poster`
        + `?w=${v.videoWidth}&h=${v.videoHeight}`;
      await S().api(url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      return true;
    } catch (_) {
      return false;
    } finally {
      v.removeAttribute('src');
      v.load();
    }
  }

  // ---------- Render ----------

  function render() {
    renderRail();
    if (state.pagesView) renderPages();
    else if (state.design) renderDesign();
    else if (state.item) renderItem();
    else if (state.readinessView) renderReadiness();
    else if (state.duplicatesView) renderDuplicates();
    else if (state.trashView) renderTrash();
    else if (state.galleryId && state.gallery) renderGalleryEditor();
    else renderBrowse();
  }

  function renderProgress() {
    const pill = $('pfa-progress');
    if (!pill) return;
    const busy = state.processing.running && (state.processing.remaining > 0 || state.processing.needsPoster.length > 0);
    pill.hidden = !busy;
    pill.textContent = state.processing.remaining > 0
      ? `Processing ${state.processing.remaining} file${state.processing.remaining === 1 ? '' : 's'}…`
      : 'Making video posters…';
  }

  const RAIL_ICON_COLLECTION = '<svg class="rail-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.3 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>';
  const RAIL_ICON_GALLERY = '<svg class="rail-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1"/><circle cx="6" cy="6.8" r="1"/><path d="M3 12l3.4-3 2.4 2 2-1.6L13 12"/></svg>';

  function saveRailOpen() {
    try { localStorage.setItem('pfa-rail-open', JSON.stringify([...state.railOpen])); } catch (_) {}
  }

  // Open the collections above a gallery so the left rail shows where it is.
  function revealInRail(gid) {
    const walk = (nodes, trail) => {
      for (const n of nodes) {
        if (n.id === gid) return trail;
        const r = walk(n.children || [], [...trail, n.id]);
        if (r) return r;
      }
      return null;
    };
    for (const c of state.tree?.categories || []) {
      const r = walk(c.kind === 'gallery' ? [c.self || {}] : c.galleries, [c.id]);
      if (r) { r.forEach(id => state.railOpen.add(id)); saveRailOpen(); return; }
    }
  }

  function renderRail() {
    const cats = state.tree?.categories || [];
    const rail = $('pfa-rail');
    const home = state.tree?.home;
    const checkIssues = (state.readiness && (state.readiness.summary.warn + state.readiness.summary.fail)) || 0;
    rail.innerHTML = `
      <div class="rail-section-label">Site</div>
      <div class="rail-row ${state.galleryId && home && state.galleryId === home.id ? 'active' : ''}" id="pfa-home-row">
        <span class="rail-name">${home ? 'Home page' : '+ Set up home page'}</span>
        ${home ? `<span class="rail-count">${home.publicCount}</span>` : ''}
      </div>
      <div class="rail-row ${state.pagesView ? 'active' : ''}" id="pfa-pages-row">
        <span class="rail-name">Pages</span>
      </div>
      <div class="rail-row ${state.design ? 'active' : ''}" id="pfa-design-row">
        <span class="rail-name">Site design</span>
      </div>
      <div class="rail-row ${state.trashView ? 'active' : ''}" id="pfa-trash-row">
        <span class="rail-name">Trash</span>
      </div>
      <details class="rail-group" id="pfa-checks" ${state.readinessView || state.duplicatesView || state.checksOpen ? 'open' : ''}>
        <summary class="rail-row">
          <span class="rail-name">Checks</span>
          ${checkIssues ? `<span class="rail-count">${checkIssues}</span>` : ''}
        </summary>
        <div class="rail-row sub ${state.readinessView ? 'active' : ''}" id="pfa-readiness-row">
          <span class="rail-name">Readiness</span>
          ${checkIssues ? `<span class="rail-count">${checkIssues}</span>` : ''}
        </div>
        <div class="rail-row sub ${state.duplicatesView ? 'active' : ''}" id="pfa-duplicates-row">
          <span class="rail-name">Duplicates</span>
        </div>
      </details>
      <div class="rail-section-label">Image Library</div>
      <div class="rail-row ${state.categoryId ? '' : 'active'}" data-cat="">
        <span class="rail-name">Everything</span>
        <span class="rail-count">${cats.reduce((n, c) => n + c.galleries.length, 0)}</span>
      </div>
      <div id="pfa-cat-list">
        <div class="rail-sublabel">Public</div>
        ${cats.filter(c => c.visible).map(catRow).join('') || '<div class="rail-empty-row">Nothing public yet</div>'}
        <div class="rail-sublabel">Private</div>
        ${cats.filter(c => !c.visible).map(catRow).join('') || '<div class="rail-empty-row">Nothing private</div>'}
      </div>
      <div class="rail-row new-collection" id="pfa-new-cat"><span class="rail-name">+ New collection</span></div>
    `;
    // Collections and galleries read differently at a glance: a folder icon
    // for a collection, a picture icon for a gallery. A collection with
    // galleries inside opens in place, and what it holds is indented under it.
    function railEntry(e) {
      const kids = e.kids || [];
      const open = kids.length > 0 && state.railOpen.has(e.id);
      const pad = (e.active ? 24 : 26) + (e.depth || 0) * 16;
      return `
        <div class="rail-node" ${e.nodeAttr || ''}>
          <div class="rail-row ${e.active ? 'active' : ''} ${e.inactive ? 'inactive' : ''}" ${e.attr} style="padding-left:${pad}px">
            ${kids.length
              ? `<button type="button" class="rail-twist ${open ? 'open' : ''}" data-twist="${esc(e.id)}" aria-label="${open ? 'Collapse' : 'Expand'}" aria-expanded="${open}"></button>`
              : '<span class="rail-twist-space"></span>'}
            ${e.coll ? RAIL_ICON_COLLECTION : RAIL_ICON_GALLERY}
            <span class="rail-name">${esc(e.title)}</span>
            <span class="rail-count">${e.count}</span>
            <a class="rail-open" href="${esc(e.url)}" target="_blank" rel="noopener" title="Open in a new window" aria-label="Open in a new window">↗</a>
          </div>
          ${open ? `<div class="rail-children">${kids.map(k => galNode(k, (e.depth || 0) + 1)).join('')}</div>` : ''}
        </div>`;
    }
    function galNode(g, depth) {
      const coll = g.kind === 'collection' || !!(g.children && g.children.length);
      return railEntry({
        id: g.id, title: g.title, url: g.url, coll, depth,
        count: coll ? (g.childCount || (g.children || []).length) : g.itemCount,
        kids: coll ? (g.children || []) : [],
        attr: `data-gid="${esc(g.id)}"`,
        active: state.galleryId === g.id,
        inactive: g.visible === false || (g.access && g.access !== 'public'),
      });
    }
    function catRow(c) {
      if (c.kind === 'gallery') {
        const g = c.self || {};
        const coll = g.kind === 'collection' || !!(g.children && g.children.length);
        return railEntry({
          id: c.id, title: c.title, url: c.url, coll, depth: 0,
          count: coll ? (g.childCount || (g.children || []).length) : (g.itemCount || 0),
          kids: coll ? (g.children || []) : [],
          attr: `data-topgid="${esc(c.id)}"`,
          active: state.galleryId === c.id,
          inactive: !c.visible,
        });
      }
      return railEntry({
        id: c.id, title: c.title, url: c.url, coll: true, depth: 0,
        count: c.galleries.length, kids: c.galleries,
        attr: `data-cat="${esc(c.id)}"`,
        nodeAttr: `data-cat-node="${esc(c.id)}"`,
        active: state.categoryId === c.id && !state.galleryId,
        inactive: !c.visible,
      });
    }
    rail.querySelectorAll('[data-cat]').forEach(row => {
      row.addEventListener('click', () => {
        if (row.dataset.cat) { state.railOpen.add(row.dataset.cat); saveRailOpen(); }
        state.categoryId = row.dataset.cat || null;
        state.galleryId = null;
        state.gallery = null;
        state.design = false;
        state.pagesView = false;
        state.readinessView = false;
        state.duplicatesView = false;
        state.trashView = false;
        render();
      });
    });
    $('pfa-checks').addEventListener('toggle', e => { state.checksOpen = e.target.open; });
    rail.querySelectorAll('[data-topgid]').forEach(row => {
      row.addEventListener('click', () => openGallery(row.dataset.topgid));
    });
    rail.querySelectorAll('[data-gid]').forEach(row => {
      row.addEventListener('click', () => openGallery(row.dataset.gid));
    });
    rail.querySelectorAll('[data-twist]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.twist;
        if (state.railOpen.has(id)) state.railOpen.delete(id); else state.railOpen.add(id);
        saveRailOpen();
        renderRail();
      });
    });
    rail.querySelectorAll('.rail-open').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
    $('pfa-new-cat').addEventListener('click', newCategory);
    $('pfa-home-row').addEventListener('click', openHome);
    $('pfa-design-row').addEventListener('click', openDesign);
    $('pfa-pages-row').addEventListener('click', openPages);
    $('pfa-readiness-row').addEventListener('click', openReadiness);
    $('pfa-duplicates-row').addEventListener('click', openDuplicates);
    $('pfa-trash-row').addEventListener('click', openTrash);

    // Drag to reorder categories; the order is what the public nav follows.
    const list = $('pfa-cat-list');
    if (list && cats.length > 1) {
      Sortable.create(list, {
        animation: 140,
        draggable: '.rail-node[data-cat-node]',
        filter: '.rail-sublabel, .rail-empty-row',
        onEnd: () => {
          const ids = [...list.querySelectorAll('[data-cat-node]')].map(n => n.dataset.catNode);
          act(() => send('/api/admin/portfolio/order', 'PUT', { categories: ids }));
        },
      });
    }
  }

  galleriesInScope.all = function () {
    const cats = state.tree?.categories || [];
    const home = state.tree?.home;
    const all = cats.flatMap(c => (c.kind === 'gallery' && c.self) ? [{ ...c.self, category: c }] : c.galleries.map(g => ({ ...g, category: c })));
    return home ? [...all, { id: home.id, title: 'Home page', category: null }] : all;
  };

  function galleriesInScope() {
    const cats = state.tree?.categories || [];
    const scoped = state.categoryId ? cats.filter(c => c.id === state.categoryId) : cats;
    return scoped.flatMap(c => {
      if (c.kind === 'gallery' && c.self) return [{ ...c.self, category: c }];
      return c.galleries.map(g => ({ ...g, category: c }));
    });
  }

  // The readiness gate, condensed for the browse header; opens the full panel.
  function readinessChip() {
    const s = state.readiness && state.readiness.summary;
    if (!s) return 'Readiness';
    if (s.fail) return `Readiness · ${s.fail} to fix`;
    if (s.warn) return `Readiness · ${s.warn} to review`;
    return 'Readiness · all set';
  }

  // The settings rail beside a page's content: shared by galleries and by
  // top-level collections.
  function railMarkup(inner) {
    return `
      <aside class="pfa-rail" id="pfa-settings-rail" aria-label="Settings">
        <div class="pfa-rail-head">
          <span>Settings</span>
          <button type="button" class="pfa-rail-close" id="pfa-rail-close" aria-label="Close settings">&times;</button>
        </div>
        <div class="pfa-rail-body" id="pfa-rail-body">${inner}</div>
      </aside>`;
  }

  function wireRail() {
    const setRail = (on) => {
      state.settingsOpen = on;
      try { localStorage.setItem('pfa-settings-open', on ? '1' : '0'); } catch (_) {}
      $('pfa-editor').classList.toggle('with-rail', on);
      $('pfa-settings-toggle').classList.toggle('active', on);
      $('pfa-settings-toggle').setAttribute('aria-pressed', String(on));
    };
    $('pfa-settings-toggle').addEventListener('click', () => setRail(!$('pfa-editor').classList.contains('with-rail')));
    $('pfa-rail-close').addEventListener('click', () => setRail(false));
  }

  // How pictures (or a collection's galleries) are ordered. Custom is the
  // drag-and-drop order; the rest are worked out on the fly and leave it alone.
  const ITEM_SORTS = [['custom', 'Custom — drag to arrange'], ['name', 'Name'], ['captured', 'Date captured'], ['added', 'Date added']];
  const NODE_SORTS = [['custom', 'Custom — drag to arrange'], ['name', 'Name'], ['shoot', 'Shoot date'], ['created', 'Date created']];

  function sortGroup(sort, choices) {
    const by = (sort && sort.by) || 'custom';
    const dir = (sort && sort.dir) === 'desc' ? 'desc' : 'asc';
    const dirs = by === 'name' ? [['asc', 'A to Z'], ['desc', 'Z to A']] : [['asc', 'Oldest first'], ['desc', 'Newest first']];
    return `
      <section class="pfa-group">
        <h3>Order</h3>
        <div class="pfa-group-body stack">
          <select class="setting-input" data-sort-by>
            ${choices.map(([v, l]) => `<option value="${v}" ${by === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${by === 'custom' ? '' : `
          <div class="pfa-seg">
            ${dirs.map(([v, l]) => `<button type="button" class="${dir === v ? 'active' : ''}" data-sort-dir="${v}">${l}</button>`).join('')}
          </div>
          <button type="button" class="ctrl" data-sort-keep>Keep this order as custom</button>`}
          <span class="pfa-hint">${by === 'custom'
            ? 'The order you drag things into.'
            : 'New arrivals slot in by themselves. Dragging is off while a sort is on; your custom order is kept underneath.'}</span>
        </div>
      </section>`;
  }

  // Wires a sortGroup: `save` sends a partial sort, `keep` bakes the order shown
  // into the custom one.
  function wireSort(root, save, keep) {
    const by = root.querySelector('[data-sort-by]');
    if (by) by.addEventListener('change', e => save({ by: e.target.value }));
    root.querySelectorAll('[data-sort-dir]').forEach(b => b.addEventListener('click', () => save({ dir: b.dataset.sortDir })));
    const k = root.querySelector('[data-sort-keep]');
    if (k) k.addEventListener('click', async () => { await keep(); await save({ by: 'custom' }); });
  }

  // Cover cards or one page: how a visitor meets a collection.
  const VIEW_HINTS = {
    cards: 'Visitors see one cover per gallery and choose where to go.',
    page: 'Every gallery is shown on one page, a section for each, in its own layout.',
  };

  function viewGroup(current, attr) {
    const view = current === 'page' ? 'page' : 'cards';
    return `
      <section class="pfa-group">
        <h3>How visitors see it</h3>
        <div class="pfa-group-body stack">
          <div class="pfa-seg">
            ${[['cards', 'Cover cards'], ['page', 'One page']].map(([v, l]) =>
              `<button type="button" class="${view === v ? 'active' : ''}" ${attr} data-val="${v}">${l}</button>`).join('')}
          </div>
          <span class="pfa-hint">${VIEW_HINTS[view]}</span>
        </div>
      </section>`;
  }

  function renderBrowse() {
    const cats = state.tree?.categories || [];
    const cat = cats.find(c => c.id === state.categoryId) || null;
    const galleries = galleriesInScope();
    const warnings = (state.tree?.warnings || []).concat(cat ? cat.warnings : cats.flatMap(c => c.warnings));
    const open = !!cat && !!state.settingsOpen;
    const keepRailScroll = ($('pfa-rail-body') || {}).scrollTop || 0;

    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <h1>${esc(cat ? cat.title : 'Image Library')}</h1>
          <p class="centre-sub">
            ${galleries.length} ${galleries.length === 1 ? 'gallery' : 'galleries'}
            ${cat ? `· ${urlRow(cat.url)}` : ''}
            ${cat && !cat.visible ? '· <span class="pfa-badge">Private</span>' : ''}
          </p>
        </div>
        <div class="centre-controls">
          <span class="pfa-pill" id="pfa-progress" hidden></span>
          <button class="ctrl" id="pfa-readiness-btn">${readinessChip()}</button>
          <button class="ctrl" id="pfa-rescan">Rescan folders</button>
          ${cat ? '<button class="ctrl" id="pfa-cat-rename">Rename</button>' : ''}
          ${cat ? '<button class="ctrl" id="pfa-cat-delete">Delete</button>' : ''}
          ${cat ? `<button class="ctrl pfa-settings-toggle ${open ? 'active' : ''}" id="pfa-settings-toggle" aria-pressed="${open}">Settings</button>` : ''}
          ${cat
            ? '<button class="btn-primary small" id="pfa-new-gallery">New gallery</button>'
            : '<button class="ctrl" id="pfa-new-coll">New collection</button><button class="btn-primary small" id="pfa-new-topgallery">New gallery</button>'}
        </div>
      </div>
      <div class="pfa-editor ${open ? 'with-rail' : ''}" id="pfa-editor">
      <div class="pfa-scroll">
        ${migrationBanner()}
        ${warnings.length ? `<div class="pfa-warnings">${warnings.map(w => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
        ${galleries.length ? `<div class="pfa-cards" id="pfa-cards">${galleries.map(galleryCard).join('')}</div>`
          : `<div class="pfa-empty">
               <p>No galleries here yet.</p>
               <p class="pfa-hint">Create one, or drop a folder of photos into
                 <code>site-data/portfolio/${esc(cat ? cat.folder : '&lt;Category&gt;')}/</code> over FTP — it shows up on its own.</p>
             </div>`}
      </div>
      ${cat ? railMarkup(`
        <div class="pfa-settings">
          ${viewGroup(cat.view, 'data-cat-view')}
          ${sortGroup(cat.sort, NODE_SORTS)}
          <section class="pfa-group">
            <h3>Access</h3>
            <div class="pfa-group-body stack">
              <div class="pfa-seg">
                <button type="button" class="${cat.visible ? 'active' : ''}" data-cat-access="1">Public</button>
                <button type="button" class="${cat.visible ? '' : 'active'}" data-cat-access="0">Private</button>
              </div>
              <span class="pfa-hint">${cat.visible ? 'Listed in the menu and on the index.' : 'Private. Not served at all, like a draft.'}</span>
            </div>
          </section>
          <section class="pfa-group">
            <h3>Address</h3>
            <div class="pfa-group-body">
              <label class="pfa-field">
                <span>Web address</span>
                <input class="setting-input" id="pfa-cat-slug" value="${esc(cat.slug)}">
              </label>
            </div>
          </section>
          <section class="pfa-group">
            <h3>Description</h3>
            <div class="pfa-group-body stack">
              <textarea class="setting-input" id="pfa-cat-desc" rows="3" maxlength="2000">${esc(cat.description || '')}</textarea>
            </div>
          </section>
        </div>`) : ''}
      </div>
    `;
    const railBody = $('pfa-rail-body');
    if (railBody) railBody.scrollTop = keepRailScroll;
    renderProgress();

    $('pfa-rescan').addEventListener('click', () => act(async () => { S().toast('Rescanned'); }));
    $('pfa-readiness-btn').addEventListener('click', openReadiness);
    const migrateBtn = $('pfa-migrate');
    if (migrateBtn) migrateBtn.addEventListener('click', runMigration);
    if ($('pfa-new-gallery')) $('pfa-new-gallery').addEventListener('click', newGallery);
    if ($('pfa-new-coll')) $('pfa-new-coll').addEventListener('click', newCategory);
    if ($('pfa-new-topgallery')) $('pfa-new-topgallery').addEventListener('click', newTopGallery);
    if (cat) {
      $('pfa-cat-rename').addEventListener('click', () => renameCategory(cat));
      wireRail();
      const putCat = body => act(() => send('/api/admin/portfolio/categories/' + encodeURIComponent(cat.id), 'PUT', body));
      $('pfa-centre').querySelectorAll('[data-cat-view]').forEach(b => b.addEventListener('click', () => putCat({ view: b.dataset.val })));
      $('pfa-centre').querySelectorAll('[data-cat-access]').forEach(b => b.addEventListener('click', () => putCat({ visible: b.dataset.catAccess === '1' })));
      wireSort($('pfa-settings-rail'), body => putCat({ sort: body }),
        () => send(`/api/admin/portfolio/categories/${encodeURIComponent(cat.id)}/order`, 'PUT', { galleries: cat.galleries.map(g => g.id) }));
      $('pfa-cat-slug').addEventListener('change', e => putCat({ slug: e.target.value }));
      $('pfa-cat-desc').addEventListener('change', e => putCat({ description: e.target.value }));
      $('pfa-cat-delete').addEventListener('click', () => deleteCategory(cat));
    }
    document.querySelectorAll('#pfa-cards .pfa-card').forEach(card => {
      card.addEventListener('click', () => openGallery(card.dataset.gid));
      const open = card.querySelector('[data-open]');
      if (open) open.addEventListener('click', e => e.stopPropagation());
    });

    // Reordering galleries only makes sense inside one category.
    const cards = $('pfa-cards');
    if (cards && cat && galleries.length > 1) {
      Sortable.create(cards, {
        animation: 140,
        disabled: ((cat.sort || {}).by || 'custom') !== 'custom',
        onEnd: () => {
          const ids = [...cards.querySelectorAll('.pfa-card')].map(c => c.dataset.gid);
          act(() => send(`/api/admin/portfolio/categories/${encodeURIComponent(cat.id)}/order`, 'PUT', { galleries: ids }));
        },
      });
    }
  }

  // Installs that predate folders still have their portfolio in reels
  // galleries. This offers to move it, once, deliberately.
  function migrationBanner() {
    const m = state.migration;
    if (!m || !m.pending || !m.pending.length) return '';
    const names = m.pending.map(p => p.name).join(', ');
    if (m.blockers && m.blockers.length) {
      return `<div class="pfa-warnings">
        <div><strong>${m.pending.length} portfolio ${m.pending.length === 1 ? 'gallery' : 'galleries'} can move into folders</strong>, but a live delivery still points at them:</div>
        ${m.blockers.map(b => `<div>${esc(b)}</div>`).join('')}
        <div>Deliveries expire after seven days; this can run once they have.</div>
      </div>`;
    }
    return `<div class="pfa-migrate">
      <div>
        <strong>Move your old portfolio into folders</strong>
        <p class="pfa-hint">${esc(names)} — ${m.items} file${m.items === 1 ? '' : 's'}.
          Each gallery becomes a folder under its collection's name, keeping titles, captions,
          caption boxes and order. Your files are copied to a backup first, and the old
          galleries are archived rather than deleted, so old links still work.</p>
      </div>
      <button class="btn-primary small" id="pfa-migrate">Move ${m.pending.length} ${m.pending.length === 1 ? 'gallery' : 'galleries'}</button>
    </div>`;
  }

  async function runMigration() {
    const btn = $('pfa-migrate');
    btn.disabled = true;
    try {
      for (let i = 0; i < 200; i++) {
        btn.textContent = 'Moving…';
        const r = await send('/api/admin/portfolio/migrate', 'POST', {});
        if (r.done) break;
        if (r.result) S().toast(`${r.result.name}: ${r.result.moved} file${r.result.moved === 1 ? '' : 's'} into ${r.result.category}`);
        if (!r.remaining) break;
      }
      S().toast('Moved. Your portfolio is folders now.');
    } catch (err) {
      S().toast(err.message || 'Migration failed');
    }
    await act(async () => {});
  }

  function galleryCard(g) {
    const flags = [
      { public: '', unlisted: '<span class="pfa-badge">Private</span>',
        password: '<span class="pfa-badge">Private · password</span>', hidden: '<span class="pfa-badge">Private</span>' }[g.access] ?? '',
      g.processing ? `<span class="pfa-badge work">${g.processing} processing</span>` : '',
      g.needsPoster ? `<span class="pfa-badge work">${g.needsPoster} need posters</span>` : '',
      g.pending.length ? `<span class="pfa-badge work">${g.pending.length} arriving</span>` : '',
      g.failed ? `<span class="pfa-badge bad">${g.failed} unreadable</span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="pfa-card" data-gid="${esc(g.id)}">
        <div class="pfa-card-frame">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : '<span class="pfa-card-empty"></span>'}<a class="pfa-open" href="${esc(g.url)}" target="_blank" rel="noopener" title="Open in a new window" aria-label="Open in a new window" data-open>↗</a></div>
        <div class="pfa-card-body">
          <div class="pfa-card-title">${esc(g.title)}</div>
          <div class="pfa-card-meta">${g.childCount ? `${g.childCount} ${g.childCount === 1 ? 'gallery' : 'galleries'}` : `${g.publicCount} of ${g.itemCount} live`}${state.categoryId || !g.category ? '' : ' · ' + esc(g.category.title)}</div>
          <div class="pfa-flags">${flags}</div>
        </div>
      </div>`;
  }

  // Where a gallery sits: the top level of any category, or inside any gallery
  // (which turns that gallery into a collection). A node can't move into itself.
  function locationOptions(g, cats) {
    const ban = new Set([g.id]);
    const banWalk = ns => (ns || []).forEach(n => { ban.add(n.id); banWalk(n.children); });
    banWalk(g.children);
    const here = g.parentId ? 'gal:' + g.parentId : 'cat:' + g.categoryId;
    const roots = cats.map(c => {
      const v = 'cat:' + c.id;
      return `<option value="${esc(v)}" ${v === here ? 'selected' : ''}>▣ ${esc(c.title)} — top level</option>`;
    }).join('');
    const rows = [];
    const walk = (ns, depth) => (ns || []).forEach(n => {
      if (ban.has(n.id)) return;
      const v = 'gal:' + n.id;
      rows.push(`<option value="${esc(v)}" ${v === here ? 'selected' : ''}>${'&nbsp;&nbsp;&nbsp;'.repeat(depth)}↳ ${esc(n.title)}</option>`);
      walk(n.children, depth + 1);
    });
    cats.forEach(c => walk(c.galleries, 0));
    return roots + (rows.length ? `<optgroup label="Inside a gallery">${rows.join('')}</optgroup>` : '');
  }

  // Editorial nudges for the open gallery — the readiness advice, in place.
  // A public URL as a clickable link, a Copy button and an explicit "open in
  // a new window" arrow — used anywhere a gallery/collection/category shows
  // its address, so the one is never just plain-looking coloured text.
  function urlRow(url) {
    return `<span class="pfa-url-row">
      <a class="pfa-url-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
      <button type="button" class="pfa-url-copy" data-copy-url="${esc(url)}" title="Copy link">Copy</button>
      <a class="pfa-url-open" href="${esc(url)}" target="_blank" rel="noopener" title="Open in a new window" aria-label="Open in a new window">↗</a>
    </span>`;
  }

  // The selectable keys in a gallery: real files only — section headers and
  // broken/missing refs don't carry a bulk-actionable file.
  function selectableKeys(g) {
    return g.items.filter(i => i.type !== 'header' && i.type !== 'broken').map(i => i.file);
  }

  function selectionBar(g) {
    const keys = selectableKeys(g);
    const n = state.selected.size;
    return `<div class="pfa-select-bar">
      <span>${n ? `${n} selected` : 'Click pictures to select them'}</span>
      <span class="pfa-select-bar-actions">
        <button type="button" id="pfa-select-all">${n === keys.length ? 'Clear' : 'Select all'}</button>
        <button type="button" id="pfa-select-hide" ${n ? '' : 'disabled'}>Hide</button>
        <button type="button" id="pfa-select-show" ${n ? '' : 'disabled'}>Show</button>
        <button type="button" class="danger" id="pfa-select-delete" ${n ? '' : 'disabled'}>Delete</button>
      </span>
    </div>`;
  }

  // A "pick" borrowed from another gallery whose source file (or whole
  // source gallery) is gone shows as a broken tile — one click clears all of
  // them at once instead of hunting down each tile's own Remove button.
  function brokenBar(g) {
    const broken = g.items.filter(i => i.type === 'broken');
    if (!broken.length) return '';
    return `<div class="pfa-warnings pfa-broken-bar">
      <div>${broken.length} picture${broken.length === 1 ? '' : 's'} this gallery links to from another gallery ${broken.length === 1 ? 'no longer exists' : 'no longer exist'}.
        <button type="button" class="linkish" id="pfa-remove-broken">Remove ${broken.length === 1 ? 'it' : 'them'}</button>
      </div>
    </div>`;
  }

  async function removeBrokenRefs(gid) {
    const broken = state.gallery.items.filter(i => i.type === 'broken');
    if (!broken.length) return;
    const ok = await S().confirm({
      title: `Remove ${broken.length} broken pick${broken.length === 1 ? '' : 's'}?`,
      message: 'These only point at pictures that no longer exist elsewhere — removing them clears the broken reference. Nothing else is deleted.',
      okText: 'Remove', danger: true,
    });
    if (!ok) return;
    const base = `/api/admin/portfolio/galleries/${encodeURIComponent(gid)}`;
    await act(async () => {
      for (const item of broken) await req(`${base}/refs/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    });
    S().toast(`Removed ${broken.length} broken pick${broken.length === 1 ? '' : 's'}`);
  }

  function toggleSelect(key, fig) {
    if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
    const on = state.selected.has(key);
    fig.classList.toggle('selected', on);
    const cb = fig.querySelector('.pfa-item-check');
    if (cb) cb.checked = on;
    const bar = document.querySelector('.pfa-select-bar');
    if (!bar) return;
    const keys = selectableKeys(state.gallery);
    const n = state.selected.size;
    bar.querySelector('span').textContent = n ? `${n} selected` : 'Click pictures to select them';
    const allBtn = $('pfa-select-all'); if (allBtn) allBtn.textContent = n && n === keys.length ? 'Clear' : 'Select all';
    ['pfa-select-hide', 'pfa-select-show', 'pfa-select-delete'].forEach(id => { const b = $(id); if (b) b.disabled = !n; });
  }

  // The endpoint for a file depends on whether it's a pick borrowed from
  // another gallery (refs) or one of the gallery's own items.
  function itemBase(gid, item) {
    const base = `/api/admin/portfolio/galleries/${encodeURIComponent(gid)}`;
    return item.ref ? `${base}/refs/${encodeURIComponent(item.file)}` : `${base}/items/${encodeURIComponent(item.file)}`;
  }

  async function bulkVisible(gid, visible) {
    const g = state.gallery;
    const keys = [...state.selected];
    if (!keys.length) return;
    state.selected = new Set();
    await act(async () => {
      for (const file of keys) {
        const item = g.items.find(i => i.file === file);
        if (item) await send(itemBase(gid, item), 'PUT', { visible });
      }
    });
    S().toast(`${visible ? 'Shown' : 'Hidden'}: ${keys.length}`);
  }

  async function bulkDelete(gid) {
    const keys = [...state.selected];
    if (!keys.length) return;
    const ok = await S().confirm({
      title: `Delete ${keys.length} file${keys.length === 1 ? '' : 's'}?`,
      message: 'They move to site-data/portfolio-trash/, where you can still recover them.',
      okText: 'Delete', danger: true,
    });
    if (!ok) return;
    const g = state.gallery;
    state.selected = new Set();
    await act(async () => {
      for (const file of keys) {
        const item = g.items.find(i => i.file === file);
        if (item) await req(itemBase(gid, item), { method: 'DELETE' });
      }
    });
    S().toast(`Deleted ${keys.length} file${keys.length === 1 ? '' : 's'}`);
  }

  function galleryNudges(g) {
    const out = [];
    if (g.itemCount > 40) out.push(`${g.itemCount} pictures — the edit reads best at ~20–40.`);
    if (g.itemCount && !(g.description || '').trim()) out.push('No description yet.');
    if (g.itemCount && !g.cover) out.push('No cover chosen.');
    return out.length ? `<p class="pfa-hint pfa-nudges">${out.map(esc).join(' · ')}</p>` : '';
  }

  // A child gallery inside the open gallery: same card, but the node arrives as
  // an admin node (no `category`), so it carries its own meta.
  function subGalleryCard(g) {
    const flags = [
      g.access && g.access !== 'public' ? `<span class="pfa-badge">${esc(g.access)}</span>` : '',
      g.processing ? `<span class="pfa-badge work">${g.processing} processing</span>` : '',
      g.failed ? `<span class="pfa-badge bad">${g.failed} unreadable</span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="pfa-card" data-gid="${esc(g.id)}">
        <div class="pfa-card-frame">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : '<span class="pfa-card-empty"></span>'}</div>
        <div class="pfa-card-body">
          <div class="pfa-card-title">${esc(g.title)}</div>
          <div class="pfa-card-meta">${g.childCount ? `${g.childCount} ${g.childCount === 1 ? 'gallery' : 'galleries'}` : `${g.publicCount} of ${g.itemCount} live`}</div>
          <div class="pfa-flags">${flags}</div>
        </div>
      </div>`;
  }

  // ---------- Gallery editor ----------

  async function openGallery(gid) {
    try {
      state.design = false;
      state.pagesView = false;
      state.readinessView = false;
      state.duplicatesView = false;
      state.trashView = false;
      state.item = null;
      state.selectMode = false;
      state.selected = new Set();
      await loadGallery(gid);
      state.categoryId = state.gallery.categoryId;
      revealInRail(gid);
      render();
      scheduleProcessing();
    } catch (err) {
      S().toast(err.message || 'Could not open that gallery');
    }
  }

  function renderGalleryEditor() {
    const g = state.gallery;
    const cats = state.tree?.categories || [];
    // The home page is a gallery in a reserved folder: same contents and
    // layout, but it has no category, no name and no address to change.
    const isHome = !!(state.tree?.home && state.tree.home.id === g.id);
    // Strict kinds: a collection holds galleries, a gallery holds media.
    const isCollection = !!(g.children && g.children.length);
    // Open by default while a gallery is empty (that is when you set it up),
    // then it remembers your choice.
    const open = state.settingsOpen == null ? !g.items.length && !isCollection : state.settingsOpen;
    const keepRailScroll = ($('pfa-rail-body') || {}).scrollTop || 0;

    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <button class="back-link" id="pfa-back">&larr; ${esc(isHome ? 'All galleries' : g.category.title)}</button>
          <h1>${esc(isHome ? 'Home page' : g.title)}</h1>
          <p class="centre-sub">
            ${urlRow(g.url)}
            ${isHome ? '· what visitors see first' : ''}
            ${isHome || g.visible ? '' : '· <span class="pfa-badge">Private</span>'}
          </p>
          ${isHome ? '' : galleryNudges(g)}
        </div>
        <div class="centre-controls">
          <span class="pfa-pill" id="pfa-progress" hidden></span>
          <details class="pfa-menu" id="pfa-more">
            <summary class="ctrl" aria-label="More actions">More &#9662;</summary>
            <div class="pfa-menu-list">
              ${isCollection ? '' : '<button type="button" id="pfa-add-section">Add section</button>'}
              ${isCollection ? '' : '<button type="button" id="pfa-add-picks">Add from the library</button>'}
              ${isHome || isCollection || g.itemCount ? '' : '<button type="button" id="pfa-new-subgallery">New gallery (make it a collection)</button>'}
              ${isHome || isCollection ? '' : '<button type="button" id="pfa-g-photoshelter-sync">Sync from migration file</button>'}
              ${isHome ? '' : '<button type="button" id="pfa-g-rename">Rename</button>'}
              ${isHome ? '' : `<button type="button" class="danger" id="pfa-g-delete">${isCollection ? 'Delete collection' : 'Delete gallery'}</button>`}
            </div>
          </details>
          <button class="ctrl pfa-settings-toggle ${open ? 'active' : ''}" id="pfa-settings-toggle" aria-pressed="${open}" title="${esc(settingsSummary(g, isHome))}">Settings</button>
          ${isCollection || !g.items.length ? '' : `<button class="ctrl ${state.selectMode ? 'active' : ''}" id="pfa-select-toggle" aria-pressed="${!!state.selectMode}">${state.selectMode ? 'Done' : 'Select'}</button>`}
          ${isCollection ? '' : '<button class="btn-primary small" id="pfa-add-files">Add media</button>'}
        </div>
      </div>
      <div class="pfa-editor ${open ? 'with-rail' : ''}" id="pfa-editor">
      <div class="pfa-scroll">
        ${isHome ? '' : (isCollection ? `
        <div class="pfa-section">
          <div class="pfa-section-text">Galleries in this collection</div>
        </div>
        <div class="pfa-cards" id="pfa-subcards">${g.children.map(subGalleryCard).join('')}</div>`
        : `<p class="pfa-hint">This is a gallery — it holds media. Collections hold galleries. Use Location to move it, or add a gallery to turn it into a collection.</p>`)}

        <div class="pfa-drop ${g.items.length ? 'compact' : ''}" id="pfa-drop" title="Copied into ${esc(g.folder)}. Files dropped into that folder over FTP appear here too.">
          <p>Drop photos and videos here, or <button class="linkish" id="pfa-browse">choose files</button>.</p>
          ${g.items.length ? '' : `<p class="pfa-hint">They are copied into <code>${esc(g.folder)}</code>. Files dropped into that folder over FTP appear here too.</p>`}
          <input type="file" id="pfa-file-input" multiple accept="image/*,video/*,application/json,.json" hidden>
          <div id="pfa-upload-status"></div>
        </div>

        ${g.warnings.length || g.pending.length ? `
          <div class="pfa-warnings">
            ${g.pending.map(p => `<div>${esc(p)} is still uploading — it will appear once it settles.</div>`).join('')}
            ${g.warnings.map(w => `<div>${esc(w)}</div>`).join('')}
          </div>` : ''}

        ${brokenBar(g)}

        ${state.selectMode ? selectionBar(g) : ''}

        ${g.items.length ? `<div class="pfa-items ${(g.sort || {}).by && g.sort.by !== 'custom' ? 'pfa-sorted' : ''} ${state.selectMode ? 'pfa-select-mode' : ''}" id="pfa-items">${g.items.map(itemTile).join('')}</div>`
          : '<div class="pfa-empty"><p>This gallery is empty.</p></div>'}
      </div>
      ${railMarkup(`
        <div class="pfa-settings">
          ${isCollection ? viewGroup((g.options || {}).view, 'data-opt="view"') : `
          <section class="pfa-group">
            <h3>Layout</h3>
            <div class="pfa-group-body">${layoutPicker(g.layout)}</div>
          </section>

          <section class="pfa-group">
            <h3>Display</h3>
            <div class="pfa-group-body">
              ${optionControls(g.options || {})}
              ${['slideshow', 'fullscreen'].includes(g.layout) ? `
                <label class="pfa-field">
                  <span>Seconds per slide</span>
                  <input class="setting-input narrow" id="pfa-interval" type="number" min="2" max="30" value="${Number((g.options || {}).interval) || 5}">
                </label>
                <label class="pfa-check"><input type="checkbox" id="pfa-autoplay" ${(g.options || {}).autoplay ? 'checked' : ''}> Play automatically</label>` : ''}
            </div>
          </section>
          `}

          ${sortGroup(g.sort, isCollection ? NODE_SORTS : ITEM_SORTS)}

          ${isHome ? `
          <section class="pfa-group">
            <h3>Opening cover</h3>
            <div class="pfa-group-body stack">
              <select class="setting-input" id="pfa-hero-file">
                <option value="">No cover — start with the gallery</option>
                ${g.items.filter(i => i.type === 'photo' || i.type === 'video').map(i =>
                  `<option value="${esc(i.file)}" ${(g.hero || {}).file === i.file ? 'selected' : ''}>${esc(i.title || (i.source ? i.source.file : i.file))}</option>`).join('')}
              </select>
              <div class="pfa-row">
                <input class="setting-input" id="pfa-hero-title" placeholder="Your name" value="${esc((g.hero || {}).title || '')}">
                <input class="setting-input" id="pfa-hero-sub" placeholder="What you do, where" value="${esc((g.hero || {}).subtitle || '')}">
              </div>
              <div class="pfa-row center">
                <div class="pfa-seg">
                  ${[['full', 'Full screen'], ['large', 'Tall band']].map(([v, l]) =>
                    `<button type="button" class="${((g.hero || {}).height || 'full') === v ? 'active' : ''}" data-hero-height="${v}">${l}</button>`).join('')}
                </div>
                <label class="pfa-check"><input type="checkbox" id="pfa-hero-only" ${(g.hero || {}).only ? 'checked' : ''}> Cover only — nothing below it</label>
              </div>
            </div>
          </section>` : `
          <section class="pfa-group">
            <h3>Access</h3>
            <div class="pfa-group-body stack">
              <div class="pfa-seg">
                <button type="button" class="${g.access === 'public' ? 'active' : ''}" data-access="public">Public</button>
                <button type="button" class="${g.access === 'public' ? '' : 'active'}" data-access="${g.access === 'public' ? 'unlisted' : g.access}">Private</button>
              </div>
              ${g.access === 'public' ? '' : `
              <div class="pfa-seg">
                ${[['unlisted', 'Link only'], ['password', 'Password'], ['hidden', 'Not served']].map(([v, l]) =>
                  `<button type="button" class="${g.access === v ? 'active' : ''}" data-access="${v}">${l}</button>`).join('')}
              </div>`}
              <span class="pfa-hint">${{
                public: 'Listed in the menu and on the index.',
                unlisted: 'Private. Off the menus; only people with the link can see it.',
                password: 'Private. The link works once the visitor types the password.',
                hidden: 'Private. Not served at all, like a draft.',
              }[g.access] || ''}</span>
              ${g.access === 'password' || g.hasPassword ? `
                <label class="pfa-field">
                  <span>Password${g.hasPassword ? ' (set)' : ''}</span>
                  <input class="setting-input narrow" id="pfa-password" type="text" placeholder="${g.hasPassword ? 'Type to replace' : 'Choose a password'}">
                </label>` : ''}
            </div>
          </section>

          <section class="pfa-group">
            <h3>Address</h3>
            <div class="pfa-group-body">
              <label class="pfa-field">
                <span>Location</span>
                <select class="setting-input" id="pfa-move">
                  ${locationOptions(g, cats)}
                </select>
              </label>
              <label class="pfa-field">
                <span>Web address</span>
                <input class="setting-input" id="pfa-slug" value="${esc(g.slug)}">
              </label>
            </div>
          </section>`}

          <section class="pfa-group">
            <h3>${isHome ? 'Intro text' : 'Description'}</h3>
            <div class="pfa-group-body stack">
              <textarea class="setting-input" id="pfa-desc" rows="2" maxlength="2000">${esc(g.description)}</textarea>
            </div>
          </section>
        </div>
`)}
      </div>
    `;
    const railBody = $('pfa-rail-body');
    if (railBody) railBody.scrollTop = keepRailScroll;
    renderProgress();
    wireGalleryEditor(g);
  }

  const ACCESS_LABELS = { public: 'Public', unlisted: 'Private', password: 'Private · password', hidden: 'Private' };

  function settingsSummary(g, isHome) {
    const layout = (LAYOUTS.find(l => l[0] === g.layout) || [])[1] || g.layout;
    return isHome ? layout : [layout, ACCESS_LABELS[g.access] || g.access, '/' + g.slug].join(' \u00b7 ');
  }

  function itemTile(item) {
    if (item.type === 'header') {
      return `<div class="pfa-section" data-key="${esc(item.id)}">
          <span class="pfa-drag" title="Drag to reorder">⠿</span>
          <span class="pfa-section-text">${esc(item.text)}</span>
          <span class="pfa-item-actions">
            <button data-act="section-edit" data-id="${esc(item.id)}">Edit</button>
            <button data-act="section-delete" data-id="${esc(item.id)}">Remove</button>
          </span>
        </div>`;
    }
    if (item.type === 'broken') {
      return `<figure class="pfa-item dim" data-key="${esc(item.id)}">
          <div class="pfa-item-frame"><span class="pfa-item-empty"></span></div>
          <figcaption>
            <div class="pfa-item-name">${esc(item.source?.file || 'Missing file')}</div>
            <div class="pfa-flags"><span class="pfa-badge bad">Gone</span></div>
            <div class="pfa-item-actions"><button data-act="ref-remove" data-file="${esc(item.id)}">Remove</button></div>
          </figcaption>
        </figure>`;
    }
    const g = state.gallery;
    const flags = [
      item.ref ? `<span class="pfa-badge">from ${esc(item.source?.gallery || 'another gallery')}</span>` : '',
      item.visible ? '' : '<span class="pfa-badge">Hidden</span>',
      item.needsPoster ? '<span class="pfa-badge work">No poster</span>' : '',
      item.processing ? '<span class="pfa-badge work">Processing</span>' : '',
      item.failed ? '<span class="pfa-badge bad">Unreadable</span>' : '',
      g.cover === item.file ? '<span class="pfa-badge good">Cover</span>' : '',
    ].filter(Boolean).join('');
    const selected = state.selectMode && state.selected.has(item.file);
    return `
      <figure class="pfa-item ${item.visible ? '' : 'dim'} ${selected ? 'selected' : ''}" data-key="${esc(item.file)}">
        <div class="pfa-item-frame">
          ${item.thumb ? `<img src="${esc(item.thumb)}" alt="" loading="lazy">` : '<span class="pfa-item-empty"></span>'}
          ${item.type === 'video' ? '<span class="pfa-video-mark">▶</span>' : ''}
          ${item.visible ? '' : '<span class="pfa-item-hidden-mark" title="Hidden from visitors">Hidden</span>'}
          ${state.selectMode ? `<input type="checkbox" class="pfa-item-check" ${selected ? 'checked' : ''} tabindex="-1">` : ''}
        </div>
        <figcaption>
          <div class="pfa-item-name" title="${esc(item.source ? item.source.file : item.file)}">${esc(item.title || (item.source ? item.source.file : item.file))}</div>
          <div class="pfa-flags">${flags}</div>
          <div class="pfa-item-actions">
            <button data-act="${item.ref ? 'ref-edit' : 'edit'}" data-file="${esc(item.file)}">Edit</button>
            ${item.ref ? '' : `<button data-act="details" data-file="${esc(item.file)}">Details</button>`}
            <button data-act="cover" data-file="${esc(item.file)}">Cover</button>
            ${g.layout === 'featured' ? `<button data-act="tile" data-file="${esc(item.file)}">Size: ${esc(TILE_SIZES.find(s => s[0] === (item.tile || 'normal'))[1])}</button>` : ''}
            <button data-act="${item.ref ? 'ref-visible' : 'visible'}" data-file="${esc(item.file)}">${item.visible ? 'Hide' : 'Show'}</button>
            ${item.type === 'video' && !item.ref ? `<button data-act="captions" data-file="${esc(item.file)}">Captions${item.captions.length ? ` (${item.captions.length})` : ''}</button>` : ''}
            <button data-act="${item.ref ? 'ref-remove' : 'delete'}" data-file="${esc(item.file)}">${item.ref ? 'Remove' : 'Delete'}</button>
          </div>
        </figcaption>
      </figure>`;
  }

  let moreMenuWired = false;

  function wireGalleryEditor(g) {
    const gid = g.id;
    const put = (body) => act(() => send('/api/admin/portfolio/galleries/' + encodeURIComponent(gid), 'PUT', body));

    const isHome = !!(state.tree?.home && state.tree.home.id === gid);
    $('pfa-back').addEventListener('click', () => { state.galleryId = null; state.gallery = null; render(); });
    if ($('pfa-new-subgallery')) $('pfa-new-subgallery').addEventListener('click', () => newSubGallery(gid));
    document.querySelectorAll('#pfa-subcards .pfa-card').forEach(card => {
      card.addEventListener('click', () => openGallery(card.dataset.gid));
    });
    $('pfa-centre').querySelectorAll('[data-layout]').forEach(btn => {
      btn.addEventListener('click', () => put({ layout: btn.dataset.layout }));
    });
    $('pfa-desc').addEventListener('change', e => put({ description: e.target.value }));
    if ($('pfa-add-picks')) $('pfa-add-picks').addEventListener('click', () => openPicker(gid));
    $('pfa-centre').querySelectorAll('[data-opt]').forEach(btn => {
      btn.addEventListener('click', () => put({ options: { [btn.dataset.opt]: btn.dataset.val } }));
    });
    // Each control sends only its own field; the server merges.
    if ($('pfa-hero-file')) {
      $('pfa-hero-file').addEventListener('change', e => put({ hero: { file: e.target.value } }));
      $('pfa-hero-title').addEventListener('change', e => put({ hero: { title: e.target.value } }));
      $('pfa-hero-sub').addEventListener('change', e => put({ hero: { subtitle: e.target.value } }));
      $('pfa-hero-only').addEventListener('change', e => put({ hero: { only: e.target.checked } }));
      $('pfa-centre').querySelectorAll('[data-hero-height]').forEach(b =>
        b.addEventListener('click', () => put({ hero: { height: b.dataset.heroHeight } })));
    }
    const autoplay = $('pfa-autoplay');
    if (autoplay) autoplay.addEventListener('change', e => put({ options: { autoplay: e.target.checked } }));
    const interval = $('pfa-interval');
    if (interval) interval.addEventListener('change', e => put({ options: { interval: Number(e.target.value) || 5 } }));
    if (!isHome) {
      $('pfa-move').addEventListener('change', e => {
        const v = e.target.value;
        // Top level of a category, or inside another gallery (a collection).
        if (v.startsWith('cat:')) put({ parentId: '', categoryId: v.slice(4) });
        else put({ parentId: v.slice(4) });
      });
      $('pfa-centre').querySelectorAll('[data-access]').forEach(b =>
        b.addEventListener('click', () => put({ access: b.dataset.access })));
      const pw = $('pfa-password');
      if (pw) pw.addEventListener('change', e => put({ password: e.target.value, access: 'password' }));
      $('pfa-slug').addEventListener('change', e => put({ slug: e.target.value }));
      $('pfa-g-rename').addEventListener('click', () => renameGallery(g));
      $('pfa-g-delete').addEventListener('click', () => deleteGallery(g));
      if ($('pfa-g-photoshelter-sync')) $('pfa-g-photoshelter-sync').addEventListener('click', () => photoshelterSync(g));
    }
    wireRail();
    const more = $('pfa-more');
    more.addEventListener('click', e => { if (e.target.closest('.pfa-menu-list button')) more.open = false; });
    if (!moreMenuWired) {
      moreMenuWired = true;
      document.addEventListener('click', e => {
        const m = $('pfa-more');
        if (m && m.open && !m.contains(e.target)) m.open = false;
      });
    }
    if ($('pfa-add-section')) $('pfa-add-section').addEventListener('click', async () => {
      const text = await S().prompt({ title: 'Add section', okText: 'Add', field: { label: 'Section heading', type: 'text' } });
      if (text && text.trim()) act(() => send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/headers`, 'POST', { text }));
    });

    // Uploads
    const input = $('pfa-file-input');
    if ($('pfa-add-files')) $('pfa-add-files').addEventListener('click', () => input.click());
    $('pfa-browse').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { uploadFiles([...input.files], gid); input.value = ''; });
    const drop = $('pfa-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => uploadFiles([...(e.dataTransfer?.files || [])], gid));

    // Item and section actions
    $('pfa-centre').querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        itemAction(btn.dataset.act, btn.dataset.file, btn.dataset.id, gid);
      });
    });

    if ($('pfa-remove-broken')) $('pfa-remove-broken').addEventListener('click', () => removeBrokenRefs(gid));

    // Multi-select: pick several pictures, then hide/show/delete them in one
    // go. A click toggles the tile without a full re-render — selecting
    // through a gallery of dozens of pictures should never jump the scroll
    // position or refetch thumbnails.
    if ($('pfa-select-toggle')) $('pfa-select-toggle').addEventListener('click', () => {
      state.selectMode = !state.selectMode;
      state.selected = new Set();
      render();
    });
    if (state.selectMode) {
      const itemsEl = $('pfa-items');
      if (itemsEl) itemsEl.addEventListener('click', e => {
        const fig = e.target.closest('.pfa-item');
        if (!fig || !fig.dataset.key || e.target.closest('[data-act]')) return;
        toggleSelect(fig.dataset.key, fig);
      });
      if ($('pfa-select-all')) $('pfa-select-all').addEventListener('click', () => {
        const keys = selectableKeys(g);
        state.selected = state.selected.size === keys.length ? new Set() : new Set(keys);
        render();
      });
      if ($('pfa-select-hide')) $('pfa-select-hide').addEventListener('click', () => bulkVisible(gid, false));
      if ($('pfa-select-show')) $('pfa-select-show').addEventListener('click', () => bulkVisible(gid, true));
      if ($('pfa-select-delete')) $('pfa-select-delete').addEventListener('click', () => bulkDelete(gid));
    }

    // Sorting: the rail's Order group. Keeping a sort writes the order shown
    // into the custom one first, so nothing is lost by switching back.
    const isColl = !!(g.children && g.children.length);
    wireSort($('pfa-settings-rail'), body => put({ sort: body }), () => isColl
      ? send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/children/order`, 'PUT', { children: g.children.map(c => c.id) })
      : send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/order`, 'PUT', {
          order: g.items.map(i => (i.type === 'header' || i.type === 'broken') ? i.id : i.file),
        }));
    const subcards = $('pfa-subcards');
    if (subcards && g.children.length > 1) {
      Sortable.create(subcards, {
        animation: 140,
        disabled: ((g.sort || {}).by || 'custom') !== 'custom',
        onEnd: () => {
          const ids = [...subcards.querySelectorAll('.pfa-card')].map(c => c.dataset.gid);
          act(() => send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/children/order`, 'PUT', { children: ids }));
        },
      });
    }

    const items = $('pfa-items');
    if (items && g.items.length > 1) {
      Sortable.create(items, {
        animation: 140,
        disabled: state.selectMode || ((g.sort || {}).by || 'custom') !== 'custom',
        draggable: '.pfa-item, .pfa-section',
        onEnd: () => {
          const order = [...items.querySelectorAll('[data-key]')].map(n => n.dataset.key);
          act(() => send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/order`, 'PUT', { order }));
        },
      });
    }
  }

  async function itemAction(action, file, id, gid) {
    const g = state.gallery;
    const base = `/api/admin/portfolio/galleries/${encodeURIComponent(gid)}`;
    const item = g.items.find(i => i.file === file);

    if (action === 'details') return openItem(gid, file);
    if (action === 'cover') return act(() => send(base, 'PUT', { cover: file }));
    if (action === 'ref-remove') return act(() => req(`${base}/refs/${encodeURIComponent(file)}`, { method: 'DELETE' }));
    if (action === 'ref-visible') return act(() => send(`${base}/refs/${encodeURIComponent(file)}`, 'PUT', { visible: !item.visible }));
    if (action === 'ref-edit') {
      // A pick can carry its own title and caption without touching the
      // original, which other galleries keep showing unchanged.
      const title = await S().prompt({ title: 'Title here', okText: 'Next', field: { label: 'Shown in this gallery only', type: 'text', value: item.title || '' } });
      if (title === null) return;
      const description = await S().prompt({
        title: 'Caption box here', okText: 'Save',
        field: { label: 'Shown in this gallery only', type: 'textarea', rows: 5, maxLength: 2000, value: item.description || '' },
      });
      if (description === null) return;
      return act(() => send(`${base}/refs/${encodeURIComponent(file)}`, 'PUT', { title, description }));
    }
    if (action === 'visible') return act(() => send(`${base}/items/${encodeURIComponent(file)}`, 'PUT', { visible: !item.visible }));
    if (action === 'delete') {
      const ok = await S().confirm({
        title: 'Delete this file?',
        message: `"${file}" moves to site-data/portfolio-trash/, where you can still recover it.`,
        okText: 'Delete', danger: true,
      });
      if (ok) act(() => req(`${base}/items/${encodeURIComponent(file)}`, { method: 'DELETE' }));
      return;
    }
    if (action === 'tile') {
      // Cycles through the sizes rather than opening a dialog: it is a
      // four-way toggle you want to try against the grid.
      const order = TILE_SIZES.map(s => s[0]);
      const next = order[(order.indexOf(item.tile || 'normal') + 1) % order.length];
      const target = item.ref ? `${base}/refs/${encodeURIComponent(file)}` : `${base}/items/${encodeURIComponent(file)}`;
      return act(() => send(target, 'PUT', { tile: next }));
    }
    if (action === 'edit') return editItem(item, gid);
    if (action === 'captions') return editCaptions(item, gid);
    if (action === 'section-edit') {
      const header = g.items.find(i => i.id === id);
      const text = await S().prompt({ title: 'Edit section', okText: 'Save', field: { label: 'Section heading', type: 'text', value: header?.text || '' } });
      if (text && text.trim()) act(() => send(`${base}/headers/${encodeURIComponent(id)}`, 'PUT', { text }));
      return;
    }
    if (action === 'section-delete') {
      act(() => req(`${base}/headers/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    }
  }

  // Title, caption box and file name in one pass.
  async function editItem(item, gid) {
    const base = `/api/admin/portfolio/galleries/${encodeURIComponent(gid)}`;
    const title = await S().prompt({ title: 'Title', okText: 'Next', field: { label: 'Shown under the picture (optional)', type: 'text', value: item.title || '' } });
    if (title === null) return;
    const description = await S().prompt({
      title: 'Caption box', okText: 'Next',
      field: { label: 'Shown beside the picture in the lightbox', type: 'textarea', rows: 5, maxLength: 2000, value: item.description || '' },
    });
    if (description === null) return;
    const rename = await S().prompt({ title: 'File name', okText: 'Save', field: { label: 'Renames the file on disk', type: 'text', value: item.file } });
    if (rename === null) return;
    const body = { title, description };
    if (rename.trim() && rename !== item.file) body.rename = rename.trim();
    act(() => send(`${base}/items/${encodeURIComponent(item.file)}`, 'PUT', body));
  }

  async function editCaptions(item, gid) {
    const base = `/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/items/${encodeURIComponent(item.file)}/captions`;
    if (item.captions.length) {
      const choice = await S().prompt({
        title: 'Caption tracks', okText: 'Go',
        field: {
          label: `${item.captions.map(c => c.label).join(', ')} — what next?`,
          type: 'select',
          options: [{ value: 'add', label: 'Add a track' }, ...item.captions.map(c => ({ value: 'del:' + c.lang, label: 'Remove ' + c.label }))],
        },
      });
      if (!choice) return;
      if (choice.startsWith('del:')) {
        return act(() => req(`${base}/${encodeURIComponent(choice.slice(4))}`, { method: 'DELETE' }));
      }
    }
    const lang = await S().prompt({ title: 'Add captions', okText: 'Choose file', field: { label: 'Language code, e.g. en or pt-br', type: 'text', value: 'en' } });
    if (!lang) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.vtt,text/vtt';
    picker.addEventListener('change', () => {
      if (!picker.files.length) return;
      const fd = new FormData();
      fd.append('file', picker.files[0]);
      fd.append('lang', lang);
      act(() => req(base, { method: 'POST', body: fd }));
    });
    picker.click();
  }

  // ---------- Site design ----------

  const PRESETS = [
    ['light', 'Light', '#ffffff', '#111111'],
    ['dark', 'Dark', '#101010', '#f2f2f2'],
    ['warm', 'Warm', '#f7f3ee', '#241f1b'],
  ];

  // Kept here rather than read from header.js, which the admin page doesn't
  // load. Must match the networks index.php accepts.
  const NETWORKS = [
    ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['x', 'X'], ['youtube', 'YouTube'],
    ['vimeo', 'Vimeo'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'],
    ['behance', 'Behance'], ['flickr', 'Flickr'], ['threads', 'Threads'], ['bluesky', 'Bluesky'],
    ['website', 'Website'], ['email', 'Email'],
  ];

  const HEADER_LAYOUTS = [
    ['bar', 'Bar', '<rect x="1" y="2" width="12" height="7"/><rect x="17" y="4" width="7" height="3"/><rect x="27" y="4" width="7" height="3"/><rect x="37" y="4" width="6" height="3"/>'],
    ['stacked', 'Centered', '<rect x="14" y="2" width="16" height="6"/><rect x="9" y="11" width="8" height="3"/><rect x="20" y="11" width="8" height="3"/><rect x="31" y="11" width="5" height="3"/>'],
    ['sidebar', 'Sidebar', '<rect x="1" y="2" width="12" height="6"/><rect x="1" y="11" width="9" height="3"/><rect x="1" y="16" width="9" height="3"/><rect x="1" y="21" width="9" height="3"/><rect x="17" y="2" width="26" height="22" opacity="0.35"/>'],
  ];

  const INDEX_LAYOUTS = [
    ['grid', 'Grid', '<rect x="1" y="2" width="13" height="10"/><rect x="16" y="2" width="13" height="10"/><rect x="31" y="2" width="12" height="10"/><rect x="1" y="14" width="13" height="10"/><rect x="16" y="14" width="13" height="10"/><rect x="31" y="14" width="12" height="10"/>'],
    ['fullwidth', 'Full width', '<rect x="1" y="2" width="42" height="9"/><rect x="1" y="13" width="42" height="9"/>'],
    ['columns', 'One column', '<rect x="9" y="2" width="26" height="9"/><rect x="9" y="13" width="26" height="9"/>'],
    ['fullscreen', 'One per screen', '<rect x="1" y="2" width="42" height="22"/>'],
  ];

  async function openDesign() {
    state.design = true;
    state.pagesView = false;
    state.readinessView = false;
    state.duplicatesView = false;
    state.trashView = false;
    state.galleryId = null;
    state.gallery = null;
    try {
      state.header = await req('/api/header');
      state.theme = state.header.theme;
      render();
    } catch (err) {
      S().toast(err.message || 'Could not load the site settings');
    }
  }

  function renderDesign() {
    const h = state.header || {};
    const t = state.theme || {};
    const logo = h.logo || {};
    const social = h.social || [];
    const networks = NETWORKS;

    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <h1>Site design</h1>
          <p class="centre-sub">Colours, header and links for every public page</p>
        </div>
        <div class="centre-controls">
          <button class="ctrl" id="pfa-design-links">Edit menu links</button>
          <a class="ctrl" href="/" target="_blank" rel="noopener">View site</a>
        </div>
      </div>
      <div class="pfa-scroll pfa-design">
        <section>
          <h4>Colour</h4>
          <div class="pfa-presets">
            ${PRESETS.map(([v, label, bg, fg]) => `
              <button type="button" class="pfa-preset ${t.preset === v ? 'active' : ''}" data-preset="${v}">
                <span class="pfa-preset-swatch" style="background:${bg};color:${fg}">Aa</span>
                <span>${label}</span>
              </button>`).join('')}
          </div>
          <label class="pfa-field">
            <span>Accent (links, hovers, buttons)</span>
            <span class="pfa-accent">
              <input type="color" id="pfa-accent" value="${esc(t.accent || '#0019ff')}">
              <input type="text" class="setting-input" id="pfa-accent-hex" value="${esc(t.accent || '#0019ff')}" maxlength="7">
            </span>
          </label>
        </section>

        <section>
          <h4>Header</h4>
          <div class="pfa-layouts">
            ${HEADER_LAYOUTS.map(([v, label, shape]) => `
              <button type="button" class="pfa-layout-opt ${t.headerLayout === v ? 'active' : ''}" data-header-layout="${v}" title="${label}">
                <svg viewBox="0 0 44 26" aria-hidden="true">${shape}</svg>
                <span>${label}</span>
              </button>`).join('')}
          </div>
          <label class="pfa-check"><input type="checkbox" id="pfa-contact-show" ${(t.contact || {}).show !== false ? 'checked' : ''}> Show a contact line</label>
          <label class="pfa-field wide">
            <span>Contact line</span>
            <input class="setting-input" id="pfa-contact-text" value="${esc((t.contact || {}).text || '')}" placeholder="e.g. Contact me — hello@studio.com">
            <span class="pfa-hint">Leave empty to show the email, phone and tagline from Settings.</span>
          </label>
        </section>

        <section>
          <h4>Gallery listings</h4>
          <p class="pfa-hint">How covers are listed on /portfolio and on a category page.</p>
          <div class="pfa-layouts">
            ${INDEX_LAYOUTS.map(([v, label, shape]) => `
              <button type="button" class="pfa-layout-opt ${(t.index || {}).layout === v ? 'active' : ''}" data-index-layout="${v}" title="${label}">
                <svg viewBox="0 0 44 26" aria-hidden="true">${shape}</svg>
                <span>${label}</span>
              </button>`).join('')}
          </div>
          <label class="pfa-check"><input type="checkbox" id="pfa-index-filters" ${(t.index || {}).filters ? 'checked' : ''}> Show every gallery on one page, with category filter buttons</label>
          <div class="pfa-field">
            <span>Category sidebar</span>
            <div class="pfa-seg">
              ${[['off', 'Off'], ['left', 'Left'], ['right', 'Right']].map(([v, l]) =>
                `<button type="button" class="${((t.index || {}).sidebar || 'off') === v ? 'active' : ''}" data-index-sidebar="${v}">${l}</button>`).join('')}
            </div>
          </div>
        </section>

        <section>
          <h4>Wordmark or logo</h4>
          <div class="pfa-brand">
            <label class="pfa-field">
              <span>Wordmark text</span>
              <input class="setting-input" id="pfa-logo-text" value="${esc(logo.text || '')}" placeholder="e.g. AJ MAST">
            </label>
            <label class="pfa-field">
              <span>Logo height (px)</span>
              <input class="setting-input" id="pfa-logo-height" type="number" min="24" max="200" value="${Number(logo.height) || 74}">
            </label>
            <div class="pfa-field">
              <span>Logo image</span>
              <div class="pfa-logo-row">
                ${logo.src ? `<img src="${esc(logo.src)}" alt="" class="pfa-logo-preview">` : '<span class="pfa-hint">No image — the wordmark is used</span>'}
                <button class="ctrl" id="pfa-logo-upload">${logo.src ? 'Replace' : 'Upload'}</button>
                ${logo.src ? '<button class="ctrl" id="pfa-logo-remove">Remove</button>' : ''}
                <input type="file" id="pfa-logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h4>Social links</h4>
          <div id="pfa-social-list">
            ${social.map((item, i) => `
              <div class="pfa-social-row" data-i="${i}">
                <select class="setting-input" data-social-network>
                  ${networks.map(([v, label]) => `<option value="${v}" ${item.network === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                </select>
                <input class="setting-input" data-social-url value="${esc(item.url || '')}" placeholder="https://instagram.com/you">
                <button class="ctrl" data-social-remove>Remove</button>
              </div>`).join('')}
          </div>
          <button class="ctrl" id="pfa-social-add">+ Add a link</button>
        </section>

        <section>
          <h4>Watermark</h4>
          <div class="pfa-field">
            <label class="pfa-check"><input type="checkbox" id="pfa-wm-enabled" ${(t.watermark || {}).enabled ? 'checked' : ''}> Stamp a watermark on portfolio pictures</label>
          </div>
          <div class="pfa-field">
            <span>Position</span>
            <div class="pfa-seg">
              ${[['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right'], ['center', 'Center']].map(([v, l]) =>
                `<button type="button" class="${((t.watermark || {}).position || 'br') === v ? 'active' : ''}" data-wm-pos="${v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="pfa-field">
            <span>Image</span>
            <div class="pfa-logo-row">
              ${(t.watermark || {}).src ? `<img src="${esc(t.watermark.src)}" alt="" class="pfa-logo-preview">` : '<span class="pfa-hint">No watermark — upload a transparent PNG</span>'}
              <button class="ctrl" id="pfa-wm-upload">${(t.watermark || {}).src ? 'Replace' : 'Upload'}</button>
              <input type="file" id="pfa-wm-file" accept="image/png" hidden>
            </div>
            <span class="pfa-hint">Applies across the portfolio; turn it off for a collection or gallery.</span>
          </div>
        </section>
      </div>
    `;
    wireDesign();
  }

  function wireDesign() {
    const saveTheme = (patch) => act(async () => {
      const r = await send('/api/settings/theme', 'PUT', { ...state.theme, ...patch });
      state.theme = r.theme;
      state.design = true;
    });
    const saveHeader = (patch) => act(async () => {
      await send('/api/settings/header', 'PUT', patch);
      state.header = await req('/api/header');
      state.theme = state.header.theme;
      state.design = true;
    });

    $('pfa-centre').querySelectorAll('[data-preset]').forEach(b =>
      b.addEventListener('click', () => saveTheme({ preset: b.dataset.preset })));
    $('pfa-centre').querySelectorAll('[data-header-layout]').forEach(b =>
      b.addEventListener('click', () => saveTheme({ headerLayout: b.dataset.headerLayout })));
    const index = (patch) => saveTheme({ index: { ...(state.theme.index || {}), ...patch } });
    const wm = (patch) => saveTheme({ watermark: { ...((state.theme && state.theme.watermark) || {}), ...patch } });
    if ($('pfa-wm-enabled')) $('pfa-wm-enabled').addEventListener('change', e => wm({ enabled: e.target.checked }));
    $('pfa-centre').querySelectorAll('[data-wm-pos]').forEach(b =>
      b.addEventListener('click', () => wm({ position: b.dataset.wmPos })));
    if ($('pfa-wm-upload')) $('pfa-wm-upload').addEventListener('click', () => $('pfa-wm-file').click());
    if ($('pfa-wm-file')) $('pfa-wm-file').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('watermark', file);
      await act(async () => {
        await fetch('/api/settings/watermark', { method: 'POST', body: fd });
        state.header = await req('/api/header');
        state.theme = state.header.theme;
        state.design = true;
      });
    });
    $('pfa-centre').querySelectorAll('[data-index-layout]').forEach(b =>
      b.addEventListener('click', () => index({ layout: b.dataset.indexLayout })));
    $('pfa-centre').querySelectorAll('[data-index-sidebar]').forEach(b =>
      b.addEventListener('click', () => index({ sidebar: b.dataset.indexSidebar })));
    $('pfa-index-filters').addEventListener('change', e => index({ filters: e.target.checked }));
    $('pfa-accent').addEventListener('change', e => saveTheme({ accent: e.target.value }));
    $('pfa-accent-hex').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) saveTheme({ accent: v });
      else S().toast('Use a colour like #1a2b3c');
    });
    const contact = () => ({ show: $('pfa-contact-show').checked, text: $('pfa-contact-text').value });
    $('pfa-contact-show').addEventListener('change', () => saveTheme({ contact: contact() }));
    $('pfa-contact-text').addEventListener('change', () => saveTheme({ contact: contact() }));

    $('pfa-logo-text').addEventListener('change', e => saveHeader({ logo: { text: e.target.value } }));
    $('pfa-logo-height').addEventListener('change', e => saveHeader({ logo: { height: Number(e.target.value) || 74 } }));
    const file = $('pfa-logo-file');
    $('pfa-logo-upload').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (!file.files.length) return;
      const fd = new FormData();
      fd.append('logo', file.files[0]);
      act(async () => {
        await req('/api/settings/header/logo', { method: 'POST', body: fd });
        state.header = await req('/api/header');
        state.design = true;
      });
    });
    const remove = $('pfa-logo-remove');
    if (remove) remove.addEventListener('click', () => saveHeader({ logo: { src: '' } }));

    const list = $('pfa-social-list');
    const collect = () => [...list.querySelectorAll('.pfa-social-row')].map(row => ({
      network: row.querySelector('[data-social-network]').value,
      url: row.querySelector('[data-social-url]').value,
    })).filter(s => s.url.trim());
    list.querySelectorAll('[data-social-network], [data-social-url]').forEach(inp =>
      inp.addEventListener('change', () => saveHeader({ social: collect() })));
    list.querySelectorAll('[data-social-remove]').forEach(btn =>
      btn.addEventListener('click', () => {
        btn.closest('.pfa-social-row').remove();
        saveHeader({ social: collect() });
      }));
    $('pfa-social-add').addEventListener('click', () => {
      const networks = NETWORKS;
      const row = document.createElement('div');
      row.className = 'pfa-social-row';
      row.innerHTML = `
        <select class="setting-input" data-social-network>
          ${networks.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('')}
        </select>
        <input class="setting-input" data-social-url placeholder="https://instagram.com/you">
        <button class="ctrl" data-social-remove>Remove</button>`;
      list.appendChild(row);
      row.querySelector('[data-social-url]').focus();
      row.querySelectorAll('[data-social-network], [data-social-url]').forEach(inp =>
        inp.addEventListener('change', () => saveHeader({ social: collect() })));
      row.querySelector('[data-social-remove]').addEventListener('click', () => {
        row.remove();
        saveHeader({ social: collect() });
      });
    });

    // The menu links editor already exists in Settings; don't build it twice.
    $('pfa-design-links').addEventListener('click', () => {
      S().setScreen('settings');
      const tab = document.querySelector('[data-settings-tab="header"]');
      if (tab) tab.click();
    });
  }

  // ---------- Pages ----------

  async function openPages() {
    state.pagesView = true;
    state.design = false;
    state.readinessView = false;
    state.duplicatesView = false;
    state.trashView = false;
    state.galleryId = null;
    state.gallery = null;
    try {
      state.pages = (await req('/api/admin/pages')).pages;
      render();
    } catch (err) {
      S().toast(err.message || 'Could not load the pages');
    }
  }

  // ---------- Readiness ----------

  async function openReadiness() {
    state.readinessView = true;
    state.design = false;
    state.pagesView = false;
    state.duplicatesView = false;
    state.trashView = false;
    state.galleryId = null;
    state.gallery = null;
    try {
      state.readiness = await req('/api/admin/portfolio/readiness');
      render();
    } catch (err) {
      S().toast(err.message || 'Could not load readiness');
    }
  }

  // The pre-launch checklist (docs/portfolio/). Reports only; it never blocks
  // publishing. Each check carries a status: pass, warn or fail.
  function renderReadiness() {
    const r = state.readiness || { checks: [], summary: { pass: 0, warn: 0, fail: 0 } };
    const groups = [...new Set(r.checks.map(c => c.group))];
    const cls = s => (s === 'pass' ? 'good' : s === 'fail' ? 'bad' : 'work');
    const word = s => (s === 'pass' ? 'Ready' : s === 'fail' ? 'Fix' : 'Review');
    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <h1>Readiness</h1>
          <p class="centre-sub">A pre-launch pass over the portfolio. Advisory — it never blocks publishing.</p>
        </div>
        <div class="pfa-flags">
          <span class="pfa-badge good">${r.summary.pass} ready</span>
          <span class="pfa-badge work">${r.summary.warn} review</span>
          <span class="pfa-badge bad">${r.summary.fail} fix</span>
        </div>
      </div>
      ${groups.map(g => `
        <div class="pfa-section">
          <div class="pfa-section-text">${esc(g)}</div>
        </div>
        <div class="pfa-page-list" style="max-width:100%">
          ${r.checks.filter(c => c.group === g).map(c => `
            <div class="pfa-page-row pfa-check-row">
              <div>
                <div class="pfa-page-title">${esc(c.label)}</div>
                <div class="pfa-page-meta">${esc(c.detail || '')}</div>
              </div>
              <span class="pfa-badge ${cls(c.status)}">${word(c.status)}</span>
            </div>`).join('')}
        </div>`).join('')}
    `;
  }

  // ---------- Duplicates ----------

  async function openDuplicates() {
    state.duplicatesView = true;
    state.design = false;
    state.pagesView = false;
    state.readinessView = false;
    state.trashView = false;
    state.galleryId = null;
    state.gallery = null;
    try {
      state.duplicates = await req('/api/admin/portfolio/duplicates');
      render();
    } catch (err) {
      S().toast(err.message || 'Could not scan for duplicates');
    }
  }

  function bytes(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
    return n + ' B';
  }

  async function openTrash() {
    state.trashView = true;
    state.design = false;
    state.pagesView = false;
    state.readinessView = false;
    state.duplicatesView = false;
    state.galleryId = null;
    state.gallery = null;
    try {
      state.trash = await req('/api/admin/portfolio/trash');
      render();
    } catch (err) {
      S().toast(err.message || 'Could not load the trash');
    }
  }

  // Deleted galleries and files land here instead of being unlinked — this
  // is the only place that actually reclaims the space.
  function renderTrash() {
    const entries = (state.trash && state.trash.entries) || [];
    const totalSize = (state.trash && state.trash.totalSize) || 0;
    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <h1>Trash</h1>
          <p class="centre-sub">${entries.length ? `${entries.length} item${entries.length === 1 ? '' : 's'} · ${bytes(totalSize)}` : 'Deleted galleries and files land here — nothing is ever unlinked outright.'}</p>
        </div>
        <div class="centre-controls">
          ${entries.length ? '<button class="ctrl danger" id="pfa-trash-empty">Empty trash</button>' : ''}
        </div>
      </div>
      <div class="pfa-scroll">
        ${entries.length ? `<div class="pfa-trash-list">${entries.map(trashRow).join('')}</div>`
          : '<div class="pfa-empty"><p>Trash is empty.</p></div>'}
      </div>`;
    if ($('pfa-trash-empty')) $('pfa-trash-empty').addEventListener('click', emptyTrash);
    $('pfa-centre').querySelectorAll('[data-trash-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteTrashEntry(btn.dataset.trashDelete));
    });
  }

  function trashRow(e) {
    const when = e.deletedAt ? new Date(e.deletedAt * 1000).toLocaleString() : '';
    return `<div class="pfa-trash-row">
      <div class="pfa-trash-name" title="${esc(e.name)}">${esc(e.name)}${e.isDir ? '/' : ''}</div>
      <div class="pfa-trash-meta">${bytes(e.size)} · ${esc(when)}</div>
      <button type="button" class="danger" data-trash-delete="${esc(e.name)}">Delete</button>
    </div>`;
  }

  async function deleteTrashEntry(name) {
    const ok = await S().confirm({
      title: 'Delete permanently?',
      message: `"${name}" is removed for good — there's no further undo.`,
      okText: 'Delete', danger: true,
    });
    if (!ok) return;
    await act(async () => { await req(`/api/admin/portfolio/trash/${encodeURIComponent(name)}`, { method: 'DELETE' }); });
    await openTrash();
  }

  async function emptyTrash() {
    const entries = (state.trash && state.trash.entries) || [];
    if (!entries.length) return;
    const ok = await S().confirm({
      title: 'Empty trash?',
      message: `Permanently deletes all ${entries.length} item${entries.length === 1 ? '' : 's'} (${bytes(state.trash.totalSize)}) — there's no further undo.`,
      okText: 'Empty trash', danger: true,
    });
    if (!ok) return;
    await act(async () => {
      const r = await send('/api/admin/portfolio/trash/empty', 'POST', {});
      S().toast(`Removed ${r.removed} item${r.removed === 1 ? '' : 's'}`);
    });
    await openTrash();
  }

  // Files with identical bytes, grouped. Keep one; the rest become picks of it.
  function renderDuplicates() {
    const groups = (state.duplicates && state.duplicates.groups) || [];
    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <h1>Duplicates</h1>
          <p class="centre-sub">Identical files across galleries. Keep one and link the rest, so the picture lives in one place but shows in every gallery.</p>
        </div>
        <div class="centre-controls">
          <button class="ctrl" id="pfa-dup-rescan">Rescan</button>
        </div>
      </div>
      <div class="pfa-scroll">
        ${groups.length ? groups.map((g, i) => dupGroup(g, i)).join('')
          : `<div class="pfa-empty"><p>No duplicate files found.</p>
             <p class="pfa-hint">Files with identical content in more than one gallery are grouped here.</p></div>`}
      </div>`;
    $('pfa-dup-rescan').addEventListener('click', openDuplicates);
    $('pfa-centre').querySelectorAll('[data-keep]').forEach(btn => {
      btn.addEventListener('click', () => linkDuplicates(+btn.dataset.group, btn.dataset.gid, btn.dataset.file));
    });
  }

  function dupGroup(g, gi) {
    const rows = g.files.map(f => `
      <div class="pfa-dup-file">
        <div class="pfa-dup-frame">${f.itemId ? `<img src="/thumbnails/${esc(f.itemId)}.jpg" alt="" loading="lazy">` : ''}</div>
        <div class="pfa-dup-meta">
          <div class="pfa-card-title">${esc(f.title || f.file)}</div>
          <div class="pfa-page-meta">${esc(f.galleryTitle)} · <code>${esc(f.file)}</code></div>
        </div>
        <button class="ctrl" data-keep="1" data-group="${gi}" data-gid="${esc(f.galleryId)}" data-file="${esc(f.file)}">Keep this</button>
      </div>`).join('');
    return `
      <div class="pfa-section"><div class="pfa-section-text">${g.files.length} identical · ${Math.round(g.size / 1024)} KB</div></div>
      <div class="pfa-dup-group">${rows}</div>`;
  }

  async function linkDuplicates(groupIndex, galleryId, file) {
    const g = state.duplicates && state.duplicates.groups[groupIndex];
    if (!g) return;
    const link = g.files.filter(f => !(f.galleryId === galleryId && f.file === file))
      .map(f => ({ galleryId: f.galleryId, file: f.file }));
    if (!link.length) return;
    const ok = await S().confirm({
      title: 'Link duplicates?',
      message: `Keep "${file}" and replace ${link.length} other cop${link.length === 1 ? 'y' : 'ies'} with links to it. The copies move to site-data/portfolio-trash/ — nothing is deleted.`,
      okText: 'Link', danger: true,
    });
    if (!ok) return;
    await act(async () => {
      const r = await send('/api/admin/portfolio/duplicates/link', 'POST', { keep: { galleryId, file }, link });
      S().toast(`Linked ${r.linked} file${r.linked === 1 ? '' : 's'}`);
    });
    await openDuplicates();
  }

  // ---------- Item ----------

  async function openItem(gid, file) {
    try {
      const meta = await req(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/items/${encodeURIComponent(file)}`);
      state.item = { gid, file, meta };
      render();
    } catch (err) {
      S().toast(err.message || 'Could not open that item');
    }
  }

  function metaRows(obj) {
    const rows = Object.entries(obj).map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      if (val.trim() === '') return '';
      return `<div class="pfa-metarow"><span>${esc(k)}</span><span>${esc(val)}</span></div>`;
    }).filter(Boolean).join('');
    return `<div class="pfa-metalist">${rows}</div>`;
  }

  function renderItem() {
    const { gid, file, meta } = state.item;
    const f = meta.facts || {};
    const bytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
    const isoDay = s => s ? String(s).slice(0, 10) : '';
    const unixDay = ts => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <button class="back-link" id="pfa-item-back">&larr; ${esc(meta.gallery ? meta.gallery.title : 'Gallery')}</button>
          <h1>${esc(f.file || file)}</h1>
          <p class="centre-sub">
            ${esc(f.type || '')} · ${f.width}×${f.height}${f.duration ? ` · ${Math.round(f.duration)}s` : ''} · ${bytes(f.bytes || 0)}
            ${f.cover ? ' · <span class="pfa-badge good">Cover</span>' : ''}${f.visible ? '' : ' · <span class="pfa-badge">Hidden</span>'}
          </p>
        </div>
        <div class="centre-controls">
          <button class="ctrl" id="pfa-item-visible">${f.visible ? 'Hide' : 'Show'}</button>
          <button class="ctrl" id="pfa-item-cover">Set as cover</button>
          <button class="ctrl" id="pfa-item-rename">Rename</button>
          <button class="ctrl danger" id="pfa-item-delete">Delete</button>
        </div>
      </div>
      <div class="pfa-scroll pfa-item-view">
        <div class="pfa-item-preview">${meta.proxy || meta.thumb ? `<img src="${esc(meta.proxy || meta.thumb)}" alt="">` : ''}</div>
        <div class="pfa-item-meta">
          <div class="pfa-section"><div class="pfa-section-text">File</div></div>
          ${metaRows({ File: f.file, Type: f.type, Size: bytes(f.bytes || 0), Dimensions: `${f.width}×${f.height}`, Added: isoDay(f.addedAt), Modified: unixDay(f.mtime) })}
          ${Object.keys(meta.exif || {}).length ? `<div class="pfa-section"><div class="pfa-section-text">EXIF</div></div>${metaRows(meta.exif)}` : ''}
          ${Object.keys(meta.xmp || {}).length ? `<div class="pfa-section"><div class="pfa-section-text">XMP</div></div>${metaRows(meta.xmp)}` : ''}
        </div>
      </div>`;
    const base = `/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/items/${encodeURIComponent(file)}`;
    $('pfa-item-back').addEventListener('click', () => { state.item = null; render(); });
    $('pfa-item-visible').addEventListener('click', () => send(base, 'PUT', { visible: !f.visible }).then(() => openItem(gid, file)));
    $('pfa-item-cover').addEventListener('click', () => send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}`, 'PUT', { cover: file }).then(() => openItem(gid, file)));
    $('pfa-item-rename').addEventListener('click', async () => {
      const name = await S().prompt({ title: 'Rename file', okText: 'Rename', field: { label: 'New file name (extension kept)', type: 'text', value: file } });
      if (!name || !name.trim() || name === file) return;
      await send(base, 'PUT', { rename: name });
      state.item = null;
      await openGallery(gid);
    });
    $('pfa-item-delete').addEventListener('click', async () => {
      const ok = await S().confirm({ title: 'Delete this file?', message: `"${file}" moves to site-data/portfolio-trash/.`, okText: 'Delete', danger: true });
      if (!ok) return;
      await req(base, { method: 'DELETE' });
      state.item = null;
      await openGallery(gid);
    });
  }

  function renderPages() {
    const page = state.pages.find(p => p.id === state.pageId) || null;
    $('pfa-centre').innerHTML = `
      <div class="centre-header">
        <div>
          <h1>${page ? esc(page.title) : 'Pages'}</h1>
          <p class="centre-sub">${page
            ? `<a href="${esc(page.url)}" target="_blank" rel="noopener">${esc(page.url)}</a>${page.type === 'contact' ? ' · contact form' : ''}`
            : 'About, contact and anything else that isn\'t a gallery'}</p>
        </div>
        <div class="centre-controls">
          ${page ? '<button class="ctrl" id="pfa-page-back">&larr; All pages</button>' : ''}
          ${page ? '<button class="ctrl" id="pfa-page-delete">Delete</button>' : ''}
          ${page ? '' : '<button class="ctrl" id="pfa-new-contact">New contact page</button>'}
          ${page ? '' : '<button class="btn-primary small" id="pfa-new-page">New page</button>'}
        </div>
      </div>
      <div class="pfa-scroll">
        ${page ? pageEditor(page) : (state.pages.length ? `
          <div class="pfa-page-list">
            ${state.pages.map(p => `
              <div class="pfa-page-row" data-page="${esc(p.id)}">
                <span class="pfa-page-title">${esc(p.title)}</span>
                <span class="pfa-page-meta">${esc(p.url)}${p.type === 'contact' ? ' · form' : ''}${p.visible ? '' : ' · hidden'}</span>
                <a class="rail-open" href="${esc(p.url)}" target="_blank" rel="noopener" title="Open in a new window" aria-label="Open in a new window" data-open>↗</a>
              </div>`).join('')}
          </div>`
          : `<div class="pfa-empty"><p>No pages yet.</p>
               <p class="pfa-hint">An About page and a Contact page with a form are the usual pair.
               Add them to the menu in Settings &rarr; Header once they exist.</p></div>`)}
      </div>`;

    if (!page) {
      $('pfa-new-page').addEventListener('click', () => newPage('text'));
      $('pfa-new-contact').addEventListener('click', () => newPage('contact'));
      $('pfa-centre').querySelectorAll('[data-page]').forEach(row => {
        row.addEventListener('click', () => { state.pageId = row.dataset.page; render(); });
        const open = row.querySelector('[data-open]');
        if (open) open.addEventListener('click', e => e.stopPropagation());
      });
      return;
    }
    wirePageEditor(page);
  }

  function pageEditor(page) {
    return `
      <div class="pfa-settings">
        <label class="pfa-field"><span>Title</span><input class="setting-input" id="pfa-page-title" value="${esc(page.title)}"></label>
        <label class="pfa-field"><span>Web address</span><input class="setting-input" id="pfa-page-slug" value="${esc(page.slug)}"></label>
        <label class="pfa-check"><input type="checkbox" id="pfa-page-visible" ${page.visible ? 'checked' : ''}> Visible on the site</label>
        <div class="pfa-field">
          <span>Picture</span>
          <div class="pfa-logo-row">
            ${page.image ? `<img src="${esc(page.image)}" alt="" class="pfa-logo-preview">` : '<span class="pfa-hint">None</span>'}
            <button class="ctrl" id="pfa-page-image-btn">${page.image ? 'Replace' : 'Add'}</button>
            ${page.image ? '<button class="ctrl" id="pfa-page-image-remove">Remove</button>' : ''}
            <input type="file" id="pfa-page-image-file" accept="image/*" hidden>
          </div>
        </div>
      </div>
      <label class="pfa-field wide">
        <span>Text — blank lines start a new paragraph, and links are detected</span>
        <textarea class="setting-input pfa-page-body" id="pfa-page-body" rows="16" maxlength="20000">${esc(page.body)}</textarea>
      </label>
      ${page.type === 'contact' ? '<p class="pfa-hint">The form appears under this text and emails the address in Settings &rarr; Email.</p>' : ''}`;
  }

  function wirePageEditor(page) {
    const save = (patch) => act(async () => {
      await send('/api/admin/pages/' + encodeURIComponent(page.id), 'PUT', patch);
      state.pages = (await req('/api/admin/pages')).pages;
      state.pagesView = true;
    });
    $('pfa-page-back').addEventListener('click', () => { state.pageId = null; render(); });
    $('pfa-page-title').addEventListener('change', e => save({ title: e.target.value }));
    $('pfa-page-slug').addEventListener('change', e => save({ slug: e.target.value }));
    $('pfa-page-visible').addEventListener('change', e => save({ visible: e.target.checked }));
    $('pfa-page-body').addEventListener('change', e => save({ body: e.target.value }));
    const file = $('pfa-page-image-file');
    $('pfa-page-image-btn').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (!file.files.length) return;
      const fd = new FormData();
      fd.append('file', file.files[0]);
      act(async () => {
        await req(`/api/admin/pages/${encodeURIComponent(page.id)}/image`, { method: 'POST', body: fd });
        state.pages = (await req('/api/admin/pages')).pages;
        state.pagesView = true;
      });
    });
    const rm = $('pfa-page-image-remove');
    if (rm) rm.addEventListener('click', () => save({ image: '' }));
    $('pfa-page-delete').addEventListener('click', async () => {
      const ok = await S().confirm({ title: 'Delete this page?', message: `"${page.title}" and its text are removed.`, okText: 'Delete', danger: true });
      if (!ok) return;
      await act(() => req('/api/admin/pages/' + encodeURIComponent(page.id), { method: 'DELETE' }));
      state.pageId = null;
      state.pages = (await req('/api/admin/pages')).pages;
      state.pagesView = true;
      render();
    });
  }

  async function newPage(type) {
    const title = await S().prompt({
      title: type === 'contact' ? 'New contact page' : 'New page', okText: 'Create',
      field: { label: 'Page title', type: 'text', value: type === 'contact' ? 'Contact' : '' },
    });
    if (!title || !title.trim()) return;
    await act(async () => {
      const r = await send('/api/admin/pages', 'POST', { title, type });
      state.pages = (await req('/api/admin/pages')).pages;
      state.pageId = r.page.id;
      state.pagesView = true;
    });
  }

  // ---------- Borrowing pictures from another gallery ----------

  // Adds picks: the file stays where it is and is shown here too, so a shot
  // can lead the home page while living in the gallery it belongs to.
  async function openPicker(gid) {
    const galleries = galleriesInScope.all().filter(g => g.id !== gid);
    if (!galleries.length) {
      S().toast('There is nothing to borrow from yet');
      return;
    }
    const chosen = new Set();
    const wrap = document.createElement('div');
    wrap.className = 'pfa-modal';
    wrap.innerHTML = `
      <div class="pfa-modal-backdrop"></div>
      <div class="pfa-modal-card">
        <h3>Add from the library</h3>
        <p class="pfa-hint">The file stays where it is. Edits to the original show up everywhere it appears.</p>
        <select class="setting-input" id="pfa-pick-gallery">
          ${galleries.map(g => `<option value="${esc(g.id)}">${esc(g.category ? g.category.title + ' — ' : '')}${esc(g.title)}</option>`).join('')}
        </select>
        <div class="pfa-picker" id="pfa-picker"></div>
        <div class="pfa-modal-actions">
          <button class="ctrl" id="pfa-pick-cancel">Cancel</button>
          <button class="btn-primary small" id="pfa-pick-add">Add <span id="pfa-pick-count">0</span></button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('.pfa-modal-backdrop').addEventListener('click', close);
    $('pfa-pick-cancel').addEventListener('click', close);

    async function showGallery(sourceId) {
      const grid = $('pfa-picker');
      grid.innerHTML = '<p class="pfa-hint">Loading…</p>';
      const { gallery } = await req('/api/admin/portfolio/galleries/' + encodeURIComponent(sourceId));
      const files = gallery.items.filter(i => i.type !== 'header' && i.type !== 'broken' && !i.ref);
      grid.innerHTML = files.length
        ? files.map(i => `
            <button type="button" class="pfa-pick" data-gallery="${esc(sourceId)}" data-file="${esc(i.file)}">
              ${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy">` : '<span class="pfa-item-empty"></span>'}
            </button>`).join('')
        : '<p class="pfa-hint">That gallery has no files of its own.</p>';
      grid.querySelectorAll('.pfa-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.gallery + '\u0000' + btn.dataset.file;
          if (chosen.has(key)) chosen.delete(key); else chosen.add(key);
          btn.classList.toggle('chosen', chosen.has(key));
          $('pfa-pick-count').textContent = String(chosen.size);
        });
      });
    }

    $('pfa-pick-gallery').addEventListener('change', e => showGallery(e.target.value));
    await showGallery(galleries[0].id);

    $('pfa-pick-add').addEventListener('click', () => {
      if (!chosen.size) return close();
      const items = [...chosen].map(k => {
        const [galleryId, file] = k.split('\u0000');
        return { galleryId, file };
      });
      close();
      act(() => send(`/api/admin/portfolio/galleries/${encodeURIComponent(gid)}/refs`, 'POST', { items }));
    });
  }

  async function openHome() {
    if (state.tree?.home) return openGallery(state.tree.home.id);
    await act(async () => {
      const r = await send('/api/admin/portfolio/home', 'POST', {});
      if (r.gallery) { state.galleryId = r.gallery.id; state.gallery = r.gallery; }
    });
  }

  // ---------- Uploads ----------

  async function uploadFiles(files, gid) {
    if (!files.length) return;
    const status = $('pfa-upload-status');
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'pfa-upload-row';
      row.textContent = `${file.name} — 0%`;
      status.appendChild(row);
      try {
        const r = await S().uploadToPortfolio(file, gid, pct => { row.textContent = `${file.name} — ${pct}%`; });
        row.textContent = r.photoshelter
          ? `${file.name} — matched ${r.photoshelter.matched} of ${r.photoshelter.total} file${r.photoshelter.total === 1 ? '' : 's'}`
          : `${file.name} — done`;
        setTimeout(() => row.remove(), r.photoshelter ? 6000 : 2000);
      } catch (err) {
        row.textContent = `${file.name} — ${err.message || 'failed'}`;
        row.classList.add('bad');
      }
    }
    await act(async () => {});
  }

  // ---------- Categories and galleries ----------

  async function newCategory() {
    const name = await S().prompt({
      title: 'New collection', okText: 'Create',
      field: { label: 'Folder name, e.g. Weddings', type: 'text', placeholder: 'Weddings' },
    });
    if (name && name.trim()) act(() => send('/api/admin/portfolio/categories', 'POST', { name }));
  }

  async function renameCategory(cat) {
    const name = await S().prompt({
      title: 'Rename category', okText: 'Save',
      field: { label: 'Renames the folder on disk; the web address stays the same', type: 'text', value: cat.folder },
    });
    if (name && name.trim() && name !== cat.folder) {
      act(() => send('/api/admin/portfolio/categories/' + encodeURIComponent(cat.id), 'PUT', { folder: name }));
    }
  }

  async function deleteCategory(cat) {
    const count = cat.galleries.length;
    const ok = await S().confirm({
      title: 'Delete this collection?',
      message: count
        ? `"${cat.folder}" and its ${count} ${count === 1 ? 'gallery' : 'galleries'} move to site-data/portfolio-trash/, where you can still recover them.`
        : `"${cat.folder}" moves to site-data/portfolio-trash/.`,
      okText: 'Delete', danger: true,
    });
    if (!ok) return;
    await act(() => req('/api/admin/portfolio/categories/' + encodeURIComponent(cat.id), { method: 'DELETE' }));
    state.categoryId = null;
    render();
  }

  async function newGallery() {
    const cats = state.tree?.categories || [];
    if (!cats.length) {
      S().toast('Create a category first');
      return;
    }
    const categoryId = state.categoryId || (await S().prompt({
      title: 'New gallery', okText: 'Next',
      field: { label: 'Category', type: 'select', options: cats.map(c => ({ value: c.id, label: c.title })) },
    }));
    if (!categoryId) return;
    const name = await S().prompt({
      title: 'New gallery', okText: 'Create',
      field: { label: 'Folder name, e.g. Smith & Jones 2026', type: 'text' },
    });
    if (!name || !name.trim()) return;
    await act(async () => {
      const r = await send('/api/admin/portfolio/galleries', 'POST', { categoryId, name });
      if (r.gallery) { state.galleryId = r.gallery.id; state.gallery = r.gallery; }
    });
  }

  // Create a gallery at the top level of the Image Library (a sibling of the
  // collections, not inside one).
  async function newTopGallery() {
    const name = await S().prompt({ title: 'New gallery', okText: 'Create', field: { label: 'Folder name', type: 'text' } });
    if (!name || !name.trim()) return;
    await act(async () => {
      const r = await send('/api/admin/portfolio/galleries', 'POST', { name });
      if (r.gallery) { state.galleryId = r.gallery.id; state.gallery = r.gallery; }
    });
  }

  // Create a gallery inside the open gallery, turning it into a collection.
  async function newSubGallery(parentId) {
    const name = await S().prompt({
      title: 'New sub-gallery', okText: 'Create',
      field: { label: 'Folder name, e.g. IU Sports', type: 'text' },
    });
    if (!name || !name.trim()) return;
    await act(() => send('/api/admin/portfolio/galleries', 'POST', { parentId, name }));
    await openGallery(parentId);
  }

  async function renameGallery(g) {
    const name = await S().prompt({
      title: 'Rename gallery', okText: 'Save',
      field: { label: 'Renames the folder on disk; the web address stays the same', type: 'text', value: g.folder },
    });
    if (name && name.trim() && name !== g.folder) {
      act(() => send('/api/admin/portfolio/galleries/' + encodeURIComponent(g.id), 'PUT', { folder: name }));
    }
  }

  async function photoshelterSync(g) {
    const ok = await S().confirm({
      title: 'Sync from migration file?',
      message: `Reads _photoshelter.json in "${g.folder}" and applies its hidden/shown state and display order to every file it mentions — including ones already imported. Anything you've changed by hand on those files since is overwritten.`,
      okText: 'Sync', danger: true,
    });
    if (!ok) return;
    await act(async () => {
      const r = await send('/api/admin/portfolio/galleries/' + encodeURIComponent(g.id) + '/photoshelter-sync', 'POST', {});
      S().toast(`Matched ${r.matched} of ${r.total} file${r.total === 1 ? '' : 's'} in _photoshelter.json`);
    });
  }

  async function deleteGallery(g) {
    const n = g.items.filter(i => i.type !== 'header').length;
    const kids = (g.children || []).length;
    const ok = await S().confirm({
      title: kids ? 'Delete this collection?' : 'Delete this gallery?',
      message: kids
        ? `"${g.folder}" and its ${kids} ${kids === 1 ? 'gallery' : 'galleries'} move to site-data/portfolio-trash/, where you can still recover them.`
        : `"${g.folder}" and its ${n} file${n === 1 ? '' : 's'} move to site-data/portfolio-trash/, where you can still recover them.`,
      okText: 'Delete', danger: true,
    });
    if (!ok) return;
    await act(() => req('/api/admin/portfolio/galleries/' + encodeURIComponent(g.id), { method: 'DELETE' }));
    state.galleryId = null;
    state.gallery = null;
    render();
  }

  // ---------- Entry point ----------

  let urlRowWired = false;
  function wireUrlRows() {
    if (urlRowWired) return;
    urlRowWired = true;
    // Delegated once: pfa-centre's own innerHTML is replaced on every
    // render, but the element itself never is.
    $('pfa-centre').addEventListener('click', e => {
      const btn = e.target.closest('.pfa-url-copy');
      if (!btn) return;
      const url = btn.dataset.copyUrl;
      S().copy(location.origin + url, 'Link copied');
    });
  }

  window.SDPortfolio = {
    async open() {
      try {
        wireUrlRows();
        await loadTree();
        if (state.galleryId) await loadGallery(state.galleryId).catch(() => { state.galleryId = null; });
        render();
        scheduleProcessing();
      } catch (err) {
        $('pfa-centre').innerHTML = `<div class="pfa-empty"><p>Could not load the portfolio.</p><p class="pfa-hint">${esc(err.message || '')}</p></div>`;
      }
    },
  };
})();
