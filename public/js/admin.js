document.addEventListener('DOMContentLoaded', () => {
  const setupSection = document.getElementById('setup-section');
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const setupForm = document.getElementById('setup-form');
  const setupError = document.getElementById('setup-error');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  // Panels
  const noGallery = document.getElementById('no-gallery');
  const videosPanel = document.getElementById('videos-panel');
  const galleryTitle = document.getElementById('gallery-title');
  const galleryListEl = document.getElementById('gallery-list');
  const videoList = document.getElementById('admin-video-list');

  // Upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const uploadQueue = document.getElementById('upload-queue');

  // Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Thumbnail picker
  const thumbPicker = document.getElementById('thumb-picker');
  const thumbVideo = document.getElementById('thumb-video');
  const thumbScrubber = document.getElementById('thumb-scrubber');
  const thumbTime = document.getElementById('thumb-time');
  const thumbCanvas = document.getElementById('thumb-canvas');
  const thumbCaptureBtn = document.getElementById('thumb-capture-btn');
  const thumbCancelBtn = document.getElementById('thumb-cancel-btn');
  const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
  let thumbVideoId = null;

  // Collection panel
  const collectionPanel = document.getElementById('collection-panel');

  // State
  let galleries = [];
  let collections = [];
  let currentGalleryId = null;
  let currentGallery = null;
  let currentGalleryItems = [];
  let currentCollectionId = null;

  // ============ Auth ============

  async function checkAuth() {
    const res = await fetch('/api/auth/check');
    const data = await res.json();

    // First-run setup needed
    if (data.setupRequired) {
      setupSection.style.display = 'flex';
      loginSection.style.display = 'none';
      dashboardSection.style.display = 'none';
      return;
    }

    setupSection.style.display = 'none';
    loginSection.style.display = data.authenticated ? 'none' : 'flex';
    dashboardSection.style.display = data.authenticated ? '' : 'none';
    if (data.authenticated) {
      await loadGalleries();
      handleHash();
    }
  }

  // First-run setup form
  setupForm.addEventListener('submit', async e => {
    e.preventDefault();
    setupError.textContent = '';
    const email = setupForm.email.value.trim();
    const password = setupForm.password.value;
    const confirm = setupForm.confirmPassword.value;

    if (password !== confirm) {
      setupError.textContent = 'Passwords do not match';
      return;
    }

    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (res.ok) {
      checkAuth();
    } else {
      const data = await res.json().catch(() => ({}));
      setupError.textContent = data.error || 'Setup failed';
    }
  });

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginError.textContent = '';
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: loginForm.username.value,
        password: loginForm.password.value
      })
    });
    if (res.ok) {
      checkAuth();
    } else {
      loginError.textContent = 'Invalid credentials';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    checkAuth();
  });

  // ============ Gallery List (Sidebar) ============

  async function loadGalleries() {
    const [gRes, cRes] = await Promise.all([
      fetch('/api/galleries'),
      fetch('/api/collections')
    ]);
    if (!gRes.ok) {
      if (gRes.status === 401) checkAuth();
      return;
    }
    galleries = await gRes.json();
    collections = cRes.ok ? await cRes.json() : [];
    renderGalleryList();
  }

  const EXPANDED_COLLECTIONS_KEY = 'admin-expanded-collections';

  function getExpandedCollections() {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_COLLECTIONS_KEY) || '[]'));
    } catch (_) { return new Set(); }
  }

  function setCollectionExpanded(colId, expanded) {
    const ids = getExpandedCollections();
    if (expanded) ids.add(colId); else ids.delete(colId);
    try { localStorage.setItem(EXPANDED_COLLECTIONS_KEY, JSON.stringify([...ids])); }
    catch (_) { /* storage full / disabled */ }
  }

  function renderGalleryList() {
    galleryListEl.innerHTML = '';

    // Build set of gallery IDs that belong to a collection
    const groupedIds = new Set();
    collections.forEach(col => {
      (col.galleryIds || []).forEach(gid => groupedIds.add(gid));
    });

    // Render collections as groups. Default to collapsed — expand only if
    // the user is currently viewing a gallery inside this collection, or if
    // they've manually expanded it earlier in this browser (remembered in
    // localStorage so clicks survive page reloads).
    const expandedIds = getExpandedCollections();
    collections.forEach(col => {
      const group = document.createElement('div');
      group.className = 'collection-group';
      group.dataset.colId = col.id;

      const colGalleries = (col.galleryIds || [])
        .map(gid => galleries.find(g => g.id === gid))
        .filter(Boolean);

      const containsCurrentGallery = currentGalleryId && colGalleries.some(g => g.id === currentGalleryId);
      const shouldExpand = containsCurrentGallery || expandedIds.has(col.id);
      if (!shouldExpand) group.classList.add('collapsed');

      const header = document.createElement('div');
      header.className = 'collection-group-header' + (col.id === currentCollectionId ? ' active' : '');
      header.innerHTML = `
        <span class="collection-group-toggle">&#9660;</span>
        <span class="collection-group-name">${escapeHtml(col.name)}</span>
        <span class="collection-group-count">${colGalleries.length}</span>
      `;

      // Click header to open collection settings
      header.addEventListener('click', (e) => {
        if (e.target.closest('.collection-group-toggle')) {
          // Toggle collapse and persist the new state
          group.classList.toggle('collapsed');
          setCollectionExpanded(col.id, !group.classList.contains('collapsed'));
          e.stopPropagation();
          return;
        }
        window.location.hash = `collection/${col.id}/settings`;
      });

      group.appendChild(header);

      const galleriesContainer = document.createElement('div');
      galleriesContainer.className = 'collection-group-galleries';

      colGalleries.forEach(g => {
        galleriesContainer.appendChild(createGalleryItem(g));
      });

      group.appendChild(galleriesContainer);
      galleryListEl.appendChild(group);
    });

    // Ungrouped galleries
    const ungrouped = galleries.filter(g => !groupedIds.has(g.id));
    if (ungrouped.length && collections.length) {
      const label = document.createElement('div');
      label.className = 'sidebar-ungrouped-label';
      label.textContent = 'Ungrouped';
      galleryListEl.appendChild(label);
    }

    ungrouped.forEach(g => {
      galleryListEl.appendChild(createGalleryItem(g));
    });
  }

  function createGalleryItem(g) {
    const item = document.createElement('div');
    item.className = 'gallery-item' + (g.id === currentGalleryId ? ' active' : '');
    if (g.type === 'proofing') item.classList.add('proofing');
    item.dataset.id = g.id;

    const badge = g.type === 'proofing'
      ? `<span class="gallery-badge proofing">Client</span>`
      : `<span class="gallery-badge reels">Portfolio</span>`;

    const count = g.type === 'proofing'
      ? `${g.videoCount} item${g.videoCount !== 1 ? 's' : ''} &middot; ${g.commentCount} comment${g.commentCount !== 1 ? 's' : ''} &middot; ${g.viewCount || 0} view${(g.viewCount || 0) !== 1 ? 's' : ''}`
      : `${g.videoCount} item${g.videoCount !== 1 ? 's' : ''}`;

    item.innerHTML = `
      <div class="gallery-item-name">${escapeHtml(g.name)}</div>
      <div class="gallery-item-meta">${badge} ${count}</div>
    `;

    item.addEventListener('click', () => {
      window.location.hash = `gallery/${g.id}/videos`;
    });

    return item;
  }

  // Email settings panel
  const emailSettingsPanel = document.getElementById('email-settings-panel');

  document.getElementById('site-settings-btn').addEventListener('click', () => {
    window.location.hash = 'settings';
  });

  // ============ Settings Tabs ============

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      document.getElementById('settings-tab-' + tab.dataset.settingsTab).style.display = '';
      // Check for updates when Update tab is first opened
      if (tab.dataset.settingsTab === 'update' && !updateChecked) {
        checkForUpdates();
      }
      // Load header config when Header tab is first opened
      if (tab.dataset.settingsTab === 'header' && !headerLoaded) {
        loadHeaderConfig();
      }
      // Refresh API token state whenever the API tab is opened, so it
      // reflects a token generated/revoked in another tab.
      if (tab.dataset.settingsTab === 'api') {
        loadApiTokenState();
      }
    });
  });

  // ============ API Token Management ============

  const apiTokenLoadingEl = document.getElementById('api-token-loading');
  const apiTokenEnvEl = document.getElementById('api-token-env-state');
  const apiTokenStateEl = document.getElementById('api-token-state');
  const apiTokenStatusText = document.getElementById('api-token-status-text');
  const apiTokenStatus = document.getElementById('api-token-status');
  const apiTokenGenerateBtn = document.getElementById('api-token-generate-btn');
  const apiTokenRegenerateBtn = document.getElementById('api-token-regenerate-btn');
  const apiTokenRevokeBtn = document.getElementById('api-token-revoke-btn');
  const apiTokenModal = document.getElementById('api-token-modal');
  const apiTokenRevealInput = document.getElementById('api-token-reveal-input');
  const apiTokenCopyBtn = document.getElementById('api-token-copy-btn');
  const apiTokenModalDoneBtn = document.getElementById('api-token-modal-done-btn');

  async function loadApiTokenState() {
    apiTokenLoadingEl.style.display = '';
    apiTokenEnvEl.style.display = 'none';
    apiTokenStateEl.style.display = 'none';
    apiTokenStatus.textContent = '';
    try {
      const res = await fetch('/api/settings/api-token');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const info = await res.json();
      apiTokenLoadingEl.style.display = 'none';
      if (info.envManaged) {
        apiTokenEnvEl.style.display = '';
        return;
      }
      apiTokenStateEl.style.display = '';
      if (info.hasToken) {
        apiTokenStatusText.textContent = 'An API token is active.';
        apiTokenGenerateBtn.style.display = 'none';
        apiTokenRegenerateBtn.style.display = '';
        apiTokenRevokeBtn.style.display = '';
      } else {
        apiTokenStatusText.textContent = 'No API token is set.';
        apiTokenGenerateBtn.style.display = '';
        apiTokenRegenerateBtn.style.display = 'none';
        apiTokenRevokeBtn.style.display = 'none';
      }
    } catch (err) {
      apiTokenLoadingEl.textContent = 'Could not load API token state: ' + err.message;
    }
  }

  async function generateApiToken(isRotate) {
    if (isRotate && !confirm('Rotate the API token? Any client using the old token will start getting 401 errors.')) return;
    apiTokenStatus.textContent = 'Generating\u2026';
    try {
      const res = await fetch('/api/settings/api-token', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        apiTokenStatus.textContent = data.error || ('HTTP ' + res.status);
        return;
      }
      apiTokenStatus.textContent = '';
      apiTokenRevealInput.value = data.token;
      apiTokenModal.style.display = 'flex';
      apiTokenRevealInput.focus();
      apiTokenRevealInput.select();
      loadApiTokenState();
    } catch (err) {
      apiTokenStatus.textContent = 'Network error: ' + err.message;
    }
  }

  apiTokenGenerateBtn.addEventListener('click', () => generateApiToken(false));
  apiTokenRegenerateBtn.addEventListener('click', () => generateApiToken(true));

  apiTokenRevokeBtn.addEventListener('click', async () => {
    if (!confirm('Revoke the current API token? Any client using it will immediately start getting 401 errors.')) return;
    apiTokenStatus.textContent = 'Revoking\u2026';
    try {
      const res = await fetch('/api/settings/api-token', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        apiTokenStatus.textContent = data.error || ('HTTP ' + res.status);
        return;
      }
      apiTokenStatus.textContent = 'Token revoked.';
      loadApiTokenState();
    } catch (err) {
      apiTokenStatus.textContent = 'Network error: ' + err.message;
    }
  });

  apiTokenCopyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(apiTokenRevealInput.value);
      apiTokenCopyBtn.textContent = 'Copied!';
      setTimeout(() => { apiTokenCopyBtn.textContent = 'Copy'; }, 1500);
    } catch (_) {
      apiTokenRevealInput.select();
      document.execCommand('copy');
    }
  });

  apiTokenModalDoneBtn.addEventListener('click', () => {
    apiTokenModal.style.display = 'none';
    apiTokenRevealInput.value = '';
  });

  // ============ Deploy from GitHub ============

  // ============ Update Check ============

  let updateChecked = false;

  async function checkForUpdates() {
    const loading = document.getElementById('update-loading');
    const info = document.getElementById('update-info');
    loading.style.display = '';
    info.style.display = 'none';

    try {
      const res = await fetch('/api/settings/update');
      const data = await res.json();

      document.getElementById('update-local-version').textContent = data.localVersion || 'unknown';
      document.getElementById('update-local-commit').textContent = data.localCommit ? `(${data.localCommit})` : '';

      if (data.updateAvailable) {
        document.getElementById('update-available-section').style.display = '';
        document.getElementById('update-current-section').style.display = 'none';
        document.getElementById('update-remote-version').textContent = data.remoteVersion || '';
        document.getElementById('update-remote-commit').textContent = data.remoteCommit ? `(${data.remoteCommit})` : '';

        if (data.commitLog) {
          document.getElementById('update-commit-log').style.display = '';
          document.getElementById('update-commits').textContent = data.commitLog;
        }
        if (data.changelog) {
          document.getElementById('update-changelog-section').style.display = '';
          document.getElementById('update-changelog').textContent = data.changelog;
        }
      } else {
        document.getElementById('update-available-section').style.display = 'none';
        document.getElementById('update-current-section').style.display = '';
      }

      if (!data.enabled) {
        const deployBtn = document.getElementById('deploy-btn');
        if (deployBtn) deployBtn.style.display = 'none';
      }
    } catch (e) {
      loading.textContent = 'Failed to check for updates.';
      return;
    }

    loading.style.display = 'none';
    info.style.display = '';
    updateChecked = true;
  }

  // Deploy / Update button
  document.getElementById('deploy-btn').addEventListener('click', async () => {
    const btn = document.getElementById('deploy-btn');
    if (!confirm('Update to the latest version?')) return;

    btn.disabled = true;
    btn.textContent = 'Updating...';
    const statusEl = document.getElementById('deploy-status');
    statusEl.textContent = '';

    try {
      const res = await fetch('/api/settings/deploy', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        statusEl.textContent = data.message || 'Update successful!';
        statusEl.style.color = '#4caf50';
        setTimeout(() => window.location.reload(), 1500);
      } else {
        statusEl.textContent = data.error || 'Update failed.';
        statusEl.style.color = '#e00';
        btn.disabled = false;
        btn.textContent = 'Update to Latest Version';
      }
    } catch (err) {
      statusEl.textContent = 'Network error: ' + err.message;
      statusEl.style.color = '#e00';
      btn.disabled = false;
      btn.textContent = 'Update to Latest Version';
    }
  });

  // ============ Header Settings ============

  let headerConfig = null;
  let headerLoaded = false;

  async function loadHeaderConfig() {
    try {
      const res = await fetch('/api/header');
      headerConfig = await res.json();
      populateHeaderForm();
    } catch (e) {
      document.getElementById('header-status').textContent = 'Failed to load header config.';
    }
    headerLoaded = true;
  }

  function populateHeaderForm() {
    if (!headerConfig) return;
    const logo = headerConfig.logo || {};
    document.getElementById('header-site-name').value = headerConfig.siteName || '';
    document.getElementById('header-logo-text').value = logo.text || '';
    if (logo.src) {
      const preview = document.getElementById('header-logo-preview');
      preview.src = logo.src;
      preview.style.display = '';
      document.getElementById('header-logo-none').style.display = 'none';
      const removeBtn = document.getElementById('header-logo-remove');
      if (removeBtn) removeBtn.style.display = '';
    }
    document.getElementById('header-logo-alt').value = logo.alt || '';
    document.getElementById('header-logo-link').value = logo.link || '';
    document.getElementById('header-email').value = headerConfig.email || '';
    document.getElementById('header-phone').value = headerConfig.phone || '';
    document.getElementById('header-tagline').value = headerConfig.tagline || '';
    renderNavItems(headerConfig.nav || []);
  }

  function renderNavItems(nav) {
    const list = document.getElementById('header-nav-list');
    list.innerHTML = '';
    nav.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'header-nav-item';
      el.dataset.index = i;

      if (item.type === 'link') {
        el.innerHTML = `
          <div class="header-nav-item-row">
            <span class="drag-handle" style="cursor:grab;">&#9776;</span>
            <input type="text" class="setting-input nav-label" value="${escapeHtml(item.label || '')}" placeholder="Label" style="width:150px;">
            <input type="text" class="setting-input nav-url" value="${escapeHtml(item.url || '')}" placeholder="URL" style="flex:1;">
            <label class="toggle-label" style="font-size:12px;white-space:nowrap;"><input type="checkbox" class="nav-external" ${item.external ? 'checked' : ''}> New tab</label>
            <button class="btn btn-icon nav-delete" title="Remove">&times;</button>
          </div>
        `;
      } else if (item.type === 'dropdown') {
        let childrenHtml = (item.children || []).map((child, ci) => `
          <div class="header-nav-child-row" data-child-index="${ci}">
            <span style="width:24px;display:inline-block;"></span>
            <input type="text" class="setting-input child-label" value="${escapeHtml(child.label || '')}" placeholder="Label" style="width:150px;">
            <input type="text" class="setting-input child-url" value="${escapeHtml(child.url || '')}" placeholder="URL" style="flex:1;">
            <button class="btn btn-icon child-delete" title="Remove">&times;</button>
          </div>
        `).join('');

        el.innerHTML = `
          <div class="header-nav-item-row">
            <span class="drag-handle" style="cursor:grab;">&#9776;</span>
            <input type="text" class="setting-input nav-label" value="${escapeHtml(item.label || '')}" placeholder="Dropdown label" style="width:150px;">
            <span class="setting-hint" style="flex:1;">Dropdown menu</span>
            <button class="btn btn-icon btn-sm nav-add-child" title="Add link">+</button>
            <button class="btn btn-icon nav-delete" title="Remove">&times;</button>
          </div>
          <div class="header-nav-children">${childrenHtml}</div>
        `;
      }
      list.appendChild(el);
    });
  }

  function collectNavFromForm() {
    const items = [];
    document.querySelectorAll('.header-nav-item').forEach(el => {
      const labelInput = el.querySelector('.nav-label');
      const urlInput = el.querySelector('.nav-url');
      const externalInput = el.querySelector('.nav-external');
      const childRows = el.querySelectorAll('.header-nav-child-row');

      if (urlInput) {
        // It's a link
        items.push({
          type: 'link',
          label: labelInput.value.trim(),
          url: urlInput.value.trim(),
          external: externalInput ? externalInput.checked : false,
        });
      } else {
        // It's a dropdown
        const children = [];
        childRows.forEach(row => {
          const cl = row.querySelector('.child-label');
          const cu = row.querySelector('.child-url');
          if (cl && cu && (cl.value.trim() || cu.value.trim())) {
            children.push({ label: cl.value.trim(), url: cu.value.trim() });
          }
        });
        items.push({
          type: 'dropdown',
          label: labelInput.value.trim(),
          children,
        });
      }
    });
    return items;
  }

  // Add link
  document.getElementById('header-add-link').addEventListener('click', () => {
    const nav = collectNavFromForm();
    nav.push({ type: 'link', label: '', url: '', external: false });
    renderNavItems(nav);
  });

  // Add dropdown
  document.getElementById('header-add-dropdown').addEventListener('click', () => {
    const nav = collectNavFromForm();
    nav.push({ type: 'dropdown', label: '', children: [{ label: '', url: '' }] });
    renderNavItems(nav);
  });

  // Delete nav item or child, add child to dropdown
  document.getElementById('header-nav-list').addEventListener('click', e => {
    if (e.target.closest('.nav-delete')) {
      const item = e.target.closest('.header-nav-item');
      item.remove();
    } else if (e.target.closest('.child-delete')) {
      const row = e.target.closest('.header-nav-child-row');
      row.remove();
    } else if (e.target.closest('.nav-add-child')) {
      const childContainer = e.target.closest('.header-nav-item').querySelector('.header-nav-children');
      const ci = childContainer.children.length;
      const row = document.createElement('div');
      row.className = 'header-nav-child-row';
      row.dataset.childIndex = ci;
      row.innerHTML = `
        <span style="width:24px;display:inline-block;"></span>
        <input type="text" class="setting-input child-label" value="" placeholder="Label" style="width:150px;">
        <input type="text" class="setting-input child-url" value="" placeholder="URL" style="flex:1;">
        <button class="btn btn-icon child-delete" title="Remove">&times;</button>
      `;
      childContainer.appendChild(row);
    }
  });

  // Logo upload
  document.getElementById('header-logo-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('logo', file);
    const statusEl = document.getElementById('header-status');
    statusEl.textContent = 'Uploading logo...';

    try {
      const res = await fetch('/api/settings/header/logo', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        const preview = document.getElementById('header-logo-preview');
        preview.src = data.src + '?t=' + Date.now();
        preview.style.display = '';
        document.getElementById('header-logo-none').style.display = 'none';
        statusEl.textContent = 'Logo uploaded.';
      } else {
        statusEl.textContent = data.error || 'Upload failed.';
      }
    } catch (err) {
      statusEl.textContent = 'Upload error: ' + err.message;
    }
  });

  // Save header
  // Remove logo image button
  document.getElementById('header-logo-remove')?.addEventListener('click', () => {
    document.getElementById('header-logo-preview').src = '';
    document.getElementById('header-logo-preview').style.display = 'none';
    document.getElementById('header-logo-none').style.display = '';
    document.getElementById('header-logo-remove').style.display = 'none';
    document.getElementById('header-logo-file').value = '';
  });

  document.getElementById('save-header-btn').addEventListener('click', async () => {
    const previewEl = document.getElementById('header-logo-preview');
    const logoSrc = (previewEl.style.display !== 'none' && previewEl.getAttribute('src')) ? previewEl.getAttribute('src') : '';
    const config = {
      siteName: document.getElementById('header-site-name').value.trim(),
      logo: {
        src: logoSrc,
        text: document.getElementById('header-logo-text').value.trim(),
        alt: document.getElementById('header-logo-alt').value.trim(),
        link: document.getElementById('header-logo-link').value.trim(),
        height: 74,
      },
      email: document.getElementById('header-email').value.trim(),
      phone: document.getElementById('header-phone').value.trim(),
      tagline: document.getElementById('header-tagline').value.trim(),
      nav: collectNavFromForm(),
    };

    const statusEl = document.getElementById('header-status');
    statusEl.textContent = 'Saving...';

    try {
      const res = await fetch('/api/settings/header', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        statusEl.textContent = 'Header saved. Reloading...';
        statusEl.style.color = '#4caf50';
        setTimeout(() => window.location.reload(), 500);
      } else {
        const data = await res.json();
        statusEl.textContent = data.error || 'Save failed.';
        statusEl.style.color = '#e00';
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
      statusEl.style.color = '#e00';
    }
  });

  // ============ Hash Routing ============

  function handleHash() {
    const hash = window.location.hash.replace('#', '');
    const galleryMatch = hash.match(/^gallery\/([^/]+)\/(videos|settings|comments)$/);
    const galleryShort = hash.match(/^gallery\/([^/]+)$/);
    const collectionMatch = hash.match(/^collection\/([^/]+)\/settings$/);

    if (hash === 'settings' || hash === 'email-settings') {
      showEmailSettings();
    } else if (collectionMatch) {
      selectCollection(collectionMatch[1]);
    } else if (galleryMatch) {
      selectGallery(galleryMatch[1], galleryMatch[2]);
    } else if (galleryShort) {
      selectGallery(galleryShort[1], 'videos');
    } else {
      showNoGallery();
    }
  }

  window.addEventListener('hashchange', handleHash);

  function showNoGallery() {
    currentGalleryId = null;
    currentGallery = null;
    currentCollectionId = null;
    noGallery.style.display = '';
    videosPanel.style.display = 'none';
    emailSettingsPanel.style.display = 'none';
    collectionPanel.style.display = 'none';
    renderGalleryList();
  }

  function selectGallery(gid, tab) {
    const gallery = galleries.find(g => g.id === gid);
    if (!gallery) { showNoGallery(); return; }

    currentGalleryId = gid;
    currentGallery = gallery;
    currentGalleryItems = [];
    currentCollectionId = null;
    noGallery.style.display = 'none';
    videosPanel.style.display = '';
    emailSettingsPanel.style.display = 'none';
    collectionPanel.style.display = 'none';
    galleryTitle.textContent = 'Gallery: ' + gallery.name;

    // Show/hide proofing-only elements
    const isProofing = gallery.type === 'proofing';
    document.querySelectorAll('.setting-proofing-only').forEach(el => {
      el.style.display = isProofing ? '' : 'none';
    });
    document.querySelector('.tab-comments').style.display = isProofing ? '' : 'none';

    // Gallery link bar on videos tab
    const linkBar = document.getElementById('gallery-link-bar');
    if (isProofing && gallery.token) {
      const galleryUrl = window.location.origin + '/gallery/' + gallery.token;
      document.getElementById('gallery-link-display').value = galleryUrl;
      linkBar.style.display = 'flex';
    } else {
      linkBar.style.display = 'none';
    }

    // Activate tab
    switchTab(tab || 'videos');

    renderGalleryList();

    if (tab === 'videos') loadVideos();
    else if (tab === 'settings') { loadSettings(); if (isProofing) loadGalleryItemsForEmail(); }
    else if (tab === 'comments') loadComments();
  }

  async function loadGalleryItemsForEmail() {
    if (!currentGalleryId) return;
    const gid = currentGalleryId;
    try {
      const res = await fetch(`/api/admin/galleries/${gid}/videos`);
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.videos || []);
      if (currentGalleryId === gid) currentGalleryItems = items;
    } catch (e) {}
  }

  // ============ Tabs ============

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      window.location.hash = `gallery/${currentGalleryId}/${tab}`;
    });
  });

  function switchTab(tab) {
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    tabContents.forEach(tc => tc.classList.toggle('active', tc.id === 'tab-' + tab));
  }

  // ============ Collections ============

  function selectCollection(colId) {
    const col = collections.find(c => c.id === colId);
    if (!col) { showNoGallery(); return; }

    currentCollectionId = colId;
    currentGalleryId = null;
    currentGallery = null;
    noGallery.style.display = 'none';
    videosPanel.style.display = 'none';
    emailSettingsPanel.style.display = 'none';
    collectionPanel.style.display = '';

    document.getElementById('collection-title').textContent = 'Collection: ' + col.name;
    renderCollectionStats(col);
    document.getElementById('col-setting-name').value = col.name;
    document.getElementById('col-setting-link').value = window.location.origin + '/collection/' + col.token;

    // Sorted gallery list (included galleries, draggable)
    const sortedList = document.getElementById('col-gallery-sorted');
    sortedList.innerHTML = '';
    const galMap = {};
    galleries.forEach(g => galMap[g.id] = g);
    const includedIds = col.galleryIds || [];

    includedIds.forEach(gid => {
      const g = galMap[gid];
      if (!g) return;
      const row = document.createElement('div');
      row.className = 'col-gallery-sorted-row';
      row.dataset.id = g.id;
      const badgeClass = g.type === 'proofing' ? 'proofing' : 'reels';
      const badgeText = g.type === 'proofing' ? 'Client' : 'Portfolio';
      row.innerHTML = `
        <span class="drag-handle" style="cursor:grab;">&#9776;</span>
        <span class="col-gallery-picker-name">${escapeHtml(g.name)}</span>
        <span class="col-gallery-picker-badge ${badgeClass}">${badgeText}</span>
        <button class="btn btn-icon col-gallery-remove" title="Remove">&times;</button>
      `;
      row.querySelector('.col-gallery-remove').addEventListener('click', () => {
        row.remove();
        rebuildAddPicker();
      });
      sortedList.appendChild(row);
    });

    // Make the sorted list draggable
    if (window._colSortable) window._colSortable.destroy();
    window._colSortable = Sortable.create(sortedList, {
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      animation: 150,
    });

    // Add picker (unchecked galleries only)
    function rebuildAddPicker() {
      const picker = document.getElementById('col-gallery-picker');
      picker.innerHTML = '';
      const currentIds = Array.from(sortedList.querySelectorAll('.col-gallery-sorted-row')).map(r => r.dataset.id);
      const available = galleries.filter(g => !currentIds.includes(g.id));
      if (available.length === 0) {
        picker.innerHTML = '<p style="padding:8px 12px;font-size:12px;color:var(--color-gray-text);">All galleries are in this collection.</p>';
        return;
      }
      available.forEach(g => {
        const row = document.createElement('div');
        row.className = 'col-gallery-picker-row';
        row.style.cursor = 'pointer';
        const badgeClass = g.type === 'proofing' ? 'proofing' : 'reels';
        const badgeText = g.type === 'proofing' ? 'Client' : 'Portfolio';
        row.innerHTML = `
          <span style="color:var(--color-primary);font-weight:600;font-size:16px;">+</span>
          <span class="col-gallery-picker-name">${escapeHtml(g.name)}</span>
          <span class="col-gallery-picker-badge ${badgeClass}">${badgeText}</span>
        `;
        row.addEventListener('click', () => {
          // Add to sorted list
          const newRow = document.createElement('div');
          newRow.className = 'col-gallery-sorted-row';
          newRow.dataset.id = g.id;
          newRow.innerHTML = `
            <span class="drag-handle" style="cursor:grab;">&#9776;</span>
            <span class="col-gallery-picker-name">${escapeHtml(g.name)}</span>
            <span class="col-gallery-picker-badge ${badgeClass}">${badgeText}</span>
            <button class="btn btn-icon col-gallery-remove" title="Remove">&times;</button>
          `;
          newRow.querySelector('.col-gallery-remove').addEventListener('click', () => {
            newRow.remove();
            rebuildAddPicker();
          });
          sortedList.appendChild(newRow);
          rebuildAddPicker();
        });
        picker.appendChild(row);
      });
    }
    rebuildAddPicker();

    // Collection settings
    document.getElementById('col-setting-password').value = '';
    document.getElementById('col-setting-password').placeholder = col.hasPassword ? '(password set — enter new to change)' : 'No password';
    document.getElementById('col-setting-downloads').checked = col.downloadsEnabled || false;
    document.getElementById('col-setting-commenting').checked = col.commentingEnabled || false;
    document.getElementById('col-setting-expires').value = col.expiresAt ? col.expiresAt.split('T')[0] : '';
    document.getElementById('col-setting-active').checked = col.active !== false;

    const sortOrderSelect = document.getElementById('col-setting-sort-order');
    sortOrderSelect.value = col.sortOrder || 'custom';
    updateSortOrderUI(sortOrderSelect.value);

    renderGalleryList();
  }

  document.getElementById('new-collection-btn').addEventListener('click', async () => {
    const name = prompt('Collection name:');
    if (!name) return;
    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      const col = await res.json();
      await loadGalleries();
      window.location.hash = `collection/${col.id}/settings`;
    }
  });

  function updateSortOrderUI(value) {
    const isCustom = value === 'custom';
    document.getElementById('col-drag-hint').style.display = isCustom ? '' : 'none';
    document.querySelectorAll('#col-gallery-sorted .drag-handle').forEach(h => {
      h.style.visibility = isCustom ? '' : 'hidden';
    });
    if (window._colSortable) window._colSortable.option('disabled', !isCustom);
  }

  document.getElementById('col-setting-sort-order').addEventListener('change', (e) => {
    updateSortOrderUI(e.target.value);
  });

  document.getElementById('col-save-btn').addEventListener('click', async () => {
    if (!currentCollectionId) return;
    const sortedRows = document.getElementById('col-gallery-sorted').querySelectorAll('.col-gallery-sorted-row');
    const galleryIds = Array.from(sortedRows).map(r => r.dataset.id);

    const colBody = {
      name: document.getElementById('col-setting-name').value,
      galleryIds,
      downloadsEnabled: document.getElementById('col-setting-downloads').checked,
      commentingEnabled: document.getElementById('col-setting-commenting').checked,
      expiresAt: document.getElementById('col-setting-expires').value || null,
      active: document.getElementById('col-setting-active').checked,
      sortOrder: document.getElementById('col-setting-sort-order').value,
    };
    const colPw = document.getElementById('col-setting-password').value;
    if (colPw) colBody.password = colPw;

    const res = await fetch(`/api/collections/${currentCollectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(colBody)
    });

    if (res.ok) {
      await loadGalleries();
      selectCollection(currentCollectionId);
      alert('Collection saved.');
    }
  });

  document.getElementById('col-copy-link-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('col-setting-link').value);
    alert('Link copied!');
  });

  document.getElementById('col-open-link-btn').addEventListener('click', () => {
    const url = document.getElementById('col-setting-link').value;
    if (url) window.open(url, '_blank');
  });

  document.getElementById('col-remove-password-btn').addEventListener('click', async () => {
    if (!confirm('Remove collection password?')) return;
    const res = await fetch(`/api/collections/${currentCollectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '' })
    });
    if (res.ok) {
      await loadGalleries();
      selectCollection(currentCollectionId);
      alert('Password removed.');
    }
  });

  document.getElementById('col-regen-link-btn').addEventListener('click', async () => {
    if (!confirm('Regenerate link? The old link will stop working.')) return;
    const res = await fetch(`/api/collections/${currentCollectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerateToken: true })
    });
    if (res.ok) {
      await loadGalleries();
      selectCollection(currentCollectionId);
      alert('Link regenerated.');
    }
  });

  document.getElementById('col-delete-btn').addEventListener('click', async () => {
    const col = collections.find(c => c.id === currentCollectionId);
    if (!confirm(`Delete collection "${col ? col.name : ''}"? Galleries will be preserved.`)) return;
    const res = await fetch(`/api/collections/${currentCollectionId}`, { method: 'DELETE' });
    if (res.ok) {
      window.location.hash = '';
      await loadGalleries();
    }
  });

  // ============ Create Gallery ============

  // --- Generic confirmation modal ---
  function confirmModal({ title, message, confirmText = 'Confirm', danger = true }) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
    confirmBtn.textContent = confirmText;
    confirmBtn.className = 'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-primary');
    modal.style.display = '';

    return new Promise((resolve) => {
      function cleanup() {
        modal.style.display = 'none';
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        modal.querySelector('.import-modal-backdrop').removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKeydown);
      }
      function onConfirm() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onKeydown(e) { if (e.key === 'Escape') onCancel(); }
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      modal.querySelector('.import-modal-backdrop').addEventListener('click', onCancel);
      document.addEventListener('keydown', onKeydown);
    });
  }

  // --- New Gallery Modal logic ---
  function openNewGalleryModal(type) {
    const modal = document.getElementById('new-gallery-modal');
    const titleEl = document.getElementById('new-gallery-modal-title');
    const nameInput = document.getElementById('new-gallery-name');
    const colLabel = document.getElementById('new-gallery-collection-label');
    const colSelect = document.getElementById('new-gallery-collection');

    titleEl.textContent = type === 'reels' ? 'New Portfolio Gallery' : 'New Client Gallery';
    nameInput.value = type === 'reels' ? 'Portfolio' : 'Client Gallery';

    // Show collection dropdown only for proofing galleries when collections exist
    if (type === 'proofing' && collections.length > 0) {
      colSelect.innerHTML = '<option value="">— None —</option>' +
        collections.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      colLabel.style.display = '';
    } else {
      colLabel.style.display = 'none';
    }

    modal.style.display = '';
    nameInput.focus();
    nameInput.select();

    return new Promise((resolve) => {
      function cleanup() {
        modal.style.display = 'none';
        document.getElementById('new-gallery-create-btn').removeEventListener('click', onCreate);
        document.getElementById('new-gallery-cancel-btn').removeEventListener('click', onCancel);
        modal.querySelector('.import-modal-backdrop').removeEventListener('click', onCancel);
        nameInput.removeEventListener('keydown', onKeydown);
      }
      function onCreate() {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const collectionId = colLabel.style.display === 'none' ? '' : colSelect.value;
        cleanup();
        resolve({ name, collectionId });
      }
      function onCancel() { cleanup(); resolve(null); }
      function onKeydown(e) { if (e.key === 'Enter') onCreate(); if (e.key === 'Escape') onCancel(); }

      document.getElementById('new-gallery-create-btn').addEventListener('click', onCreate);
      document.getElementById('new-gallery-cancel-btn').addEventListener('click', onCancel);
      modal.querySelector('.import-modal-backdrop').addEventListener('click', onCancel);
      nameInput.addEventListener('keydown', onKeydown);
    });
  }

  document.getElementById('new-reels-btn').addEventListener('click', async () => {
    const result = await openNewGalleryModal('reels');
    if (!result) return;
    await fetch('/api/galleries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: result.name, type: 'reels' })
    });
    await loadGalleries();
  });

  document.getElementById('new-proofing-btn').addEventListener('click', async () => {
    const result = await openNewGalleryModal('proofing');
    if (!result) return;
    const res = await fetch('/api/galleries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: result.name, type: 'proofing' })
    });
    const gallery = await res.json();

    // Add to selected collection if one was chosen
    if (result.collectionId) {
      const col = collections.find(c => c.id === result.collectionId);
      if (col) {
        const updatedIds = [...(col.galleryIds || []), gallery.id];
        await fetch(`/api/collections/${col.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ galleryIds: updatedIds })
        });
      }
    }

    await loadGalleries();
    window.location.hash = `gallery/${gallery.id}/videos`;
  });

  // ============ Gallery Settings ============

  function loadSettings() {
    if (!currentGallery) return;
    document.getElementById('setting-name').value = currentGallery.name;
    document.getElementById('setting-type').textContent = currentGallery.type === 'proofing' ? 'Client Gallery' : 'Portfolio Gallery';
    document.getElementById('setting-active').checked = currentGallery.active;

    // Collection inheritance info
    const colInfo = document.getElementById('setting-collection-info');
    const overrideCheck = document.getElementById('setting-override');
    const inCollection = currentGallery.collectionId && currentGallery.type === 'proofing';

    if (inCollection) {
      colInfo.style.display = '';
      document.getElementById('setting-collection-name').textContent = currentGallery.collectionName || 'Unknown';
      overrideCheck.checked = currentGallery.overrideCollectionSettings || false;
      updateOverrideState();
    } else {
      colInfo.style.display = 'none';
    }

    if (currentGallery.type === 'proofing') {
      const baseUrl = window.location.origin;
      document.getElementById('setting-link').value = baseUrl + '/gallery/' + currentGallery.token;
      // Password field: show placeholder if password is set, empty if not
      const pwInput = document.getElementById('setting-password');
      pwInput.value = '';
      pwInput.placeholder = currentGallery.hasPassword ? '(password set — enter new to change)' : 'No password';
      document.getElementById('setting-downloads').checked = currentGallery.downloadsEnabled;
      document.getElementById('setting-commenting').checked = currentGallery.commentingEnabled || false;
      document.getElementById('setting-expires').value = currentGallery.expiresAt ? currentGallery.expiresAt.split('T')[0] : '';
    }
  }

  function updateOverrideState() {
    const inCollection = currentGallery && currentGallery.collectionId && currentGallery.type === 'proofing';
    if (!inCollection) return;
    const isOverriding = document.getElementById('setting-override').checked;
    // Disable/enable the proofing-only settings based on override state
    const fields = ['setting-password', 'setting-downloads', 'setting-commenting', 'setting-expires', 'setting-active'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isOverriding;
    });
    const removeBtn = document.getElementById('remove-password-btn');
    if (removeBtn) removeBtn.disabled = !isOverriding;
    // Visual dimming
    document.querySelectorAll('.setting-proofing-only').forEach(el => {
      el.style.opacity = isOverriding ? '' : '0.5';
    });
  }

  document.getElementById('setting-override').addEventListener('change', updateOverrideState);

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('setting-name').value,
      active: document.getElementById('setting-active').checked
    };

    if (currentGallery.type === 'proofing') {
      // Send override flag if gallery is in a collection
      if (currentGallery.collectionId) {
        body.overrideCollectionSettings = document.getElementById('setting-override').checked;
      }
      // Only send password if user typed something new
      const pwVal = document.getElementById('setting-password').value.trim();
      if (pwVal) body.password = pwVal;
      body.downloadsEnabled = document.getElementById('setting-downloads').checked;
      body.commentingEnabled = document.getElementById('setting-commenting').checked;
      const expiresVal = document.getElementById('setting-expires').value;
      body.expiresAt = expiresVal ? new Date(expiresVal + 'T23:59:59').toISOString() : null;
    }

    const res = await fetch(`/api/galleries/${currentGalleryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      const updated = await res.json();
      const idx = galleries.findIndex(g => g.id === currentGalleryId);
      if (idx !== -1) Object.assign(galleries[idx], updated);
      currentGallery = galleries[idx];
      galleryTitle.textContent = 'Gallery: ' + updated.name;
      renderGalleryList();
      alert('Settings saved.');
    }
  });

  document.getElementById('remove-password-btn').addEventListener('click', async () => {
    if (!currentGalleryId) return;
    if (!currentGallery.hasPassword) {
      alert('No password is currently set.');
      return;
    }
    if (!confirm('Remove the gallery password? Anyone with the link will be able to access it.')) return;

    const res = await fetch(`/api/galleries/${currentGalleryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '' })
    });
    if (res.ok) {
      const updated = await res.json();
      Object.assign(currentGallery, updated);
      const pwInput = document.getElementById('setting-password');
      pwInput.value = '';
      pwInput.placeholder = 'No password';
      renderGalleryList();
      alert('Password removed.');
    }
  });

  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const input = document.getElementById('setting-link');
    navigator.clipboard.writeText(input.value);
    alert('Link copied!');
  });

  document.getElementById('open-link-btn').addEventListener('click', () => {
    const url = document.getElementById('setting-link').value;
    if (url) window.open(url, '_blank');
  });

  // Gallery link bar (videos tab)
  document.getElementById('gallery-link-copy').addEventListener('click', () => {
    const input = document.getElementById('gallery-link-display');
    navigator.clipboard.writeText(input.value);
    alert('Link copied!');
  });

  document.getElementById('gallery-link-open').addEventListener('click', () => {
    const url = document.getElementById('gallery-link-display').value;
    if (url) window.open(url, '_blank');
  });

  function buildGalleryMailto() {
    if (!currentGallery || !currentGallery.token) return null;
    const galleryUrl = window.location.origin + '/gallery/' + currentGallery.token;
    const name = currentGallery.name;

    const hasVideos = currentGalleryItems.some(i => i.type === 'video');
    const mediaWord = hasVideos ? 'video' : 'photo';
    const commentingOn = !!currentGallery.commentingEnabled;

    const subject = `${name} — ${hasVideos ? 'Videos' : 'Photos'} ready for review`;

    const passwordLine = currentGallery.hasPassword
      ? `\nPassword: [enter the gallery password here]\n`
      : '';

    let commentsSection = '';
    if (commentingOn) {
      const instructions = hasVideos
        ? `1. Open the link and enter your name when prompted.
2. Click any video to open it.
3. Pause at the moment you'd like to comment on.
4. Type your note in the box on the right — the timestamp is captured automatically.
5. Press Enter to post (Shift+Enter for a new line).
6. When you're finished with a video, click "Finish & Send Comments" to share your feedback.

Each comment is tied to a specific moment in the video, so I can see exactly what you're referring to.`
        : `1. Open the link and enter your name when prompted.
2. Click any photo to open it.
3. Type your note in the box on the right.
4. Press Enter to post (Shift+Enter for a new line).
5. When you're finished with a photo, click "Finish & Send Comments" to share your feedback.`;
      commentsSection = `\nLeaving comments\n${instructions}\n`;
    }

    const body = `Hello,

Your ${mediaWord} gallery is ready for review.

${galleryUrl}
${passwordLine}${commentsSection}
Thanks,
AJ Mast`;

    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  document.getElementById('email-link-btn').addEventListener('click', () => {
    const mailto = buildGalleryMailto();
    if (mailto) window.location.href = mailto;
  });

  document.getElementById('gallery-link-email').addEventListener('click', () => {
    const mailto = buildGalleryMailto();
    if (mailto) window.location.href = mailto;
  });

  document.getElementById('regen-link-btn').addEventListener('click', async () => {
    if (!confirm('Regenerate access link? The old link will stop working.')) return;
    const res = await fetch(`/api/galleries/${currentGalleryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerateToken: true })
    });
    if (res.ok) {
      const updated = await res.json();
      const idx = galleries.findIndex(g => g.id === currentGalleryId);
      if (idx !== -1) Object.assign(galleries[idx], updated);
      currentGallery = galleries[idx];
      loadSettings();
      alert('Link regenerated.');
    }
  });

  document.getElementById('reset-stats-btn').addEventListener('click', async () => {
    if (!currentGalleryId) return;
    const ok = await confirmModal({
      title: 'Reset Statistics',
      message: `Reset view and download counts for "${currentGallery.name}"? This cannot be undone.`,
      confirmText: 'Reset Stats',
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/galleries/${currentGalleryId}/stats/reset`, { method: 'POST' });
    if (res.ok) {
      loadVideos();
      loadGalleries();
    } else {
      alert('Failed to reset statistics.');
    }
  });

  document.getElementById('delete-gallery-btn').addEventListener('click', async () => {
    if (!confirm(`Delete "${currentGallery.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/galleries/${currentGalleryId}`, { method: 'DELETE' });
    if (res.ok) {
      window.location.hash = '';
      await loadGalleries();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to delete gallery.');
    }
  });

  // ============ Videos (gallery-scoped) ============

  async function loadVideos() {
    if (!currentGalleryId) return;
    const res = await fetch(`/api/admin/galleries/${currentGalleryId}/videos`);
    if (!res.ok) {
      if (res.status === 401) checkAuth();
      return;
    }
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.videos || []);
    const stats = (data && data.stats) || {};
    currentGalleryItems = items;
    renderVideos(items, stats);
    renderGalleryStats(stats);
  }

  function renderGalleryStats(stats) {
    const bar = document.getElementById('gallery-stats-bar');
    if (!bar) return;
    if (!currentGallery || currentGallery.type !== 'proofing') {
      bar.style.display = 'none';
      return;
    }
    const views = (stats && stats.views) || {};
    const downloads = (stats && stats.downloads) || {};
    const total = views.total || 0;
    const unique = views.unique || 0;
    const parts = [];
    if (total === 0) {
      parts.push('Not viewed yet');
    } else {
      parts.push(`Viewed ${total} time${total !== 1 ? 's' : ''}`);
      parts.push(`${unique} unique visitor${unique !== 1 ? 's' : ''}`);
      if (views.lastViewedAt) {
        const d = new Date(views.lastViewedAt);
        parts.push(`last viewed ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
      }
    }
    if (downloads.downloadAll) {
      parts.push(`Download All run ${downloads.downloadAll}×`);
    }
    bar.textContent = parts.join('  ·  ');
    bar.style.display = '';
  }

  function renderCollectionStats(col) {
    const bar = document.getElementById('collection-stats-bar');
    if (!bar) return;
    const total = col.viewCount || 0;
    const unique = col.uniqueVisitors || 0;
    const parts = [];
    if (total === 0) {
      parts.push('Not viewed yet');
    } else {
      parts.push(`Viewed ${total} time${total !== 1 ? 's' : ''}`);
      parts.push(`${unique} unique visitor${unique !== 1 ? 's' : ''}`);
      if (col.lastViewedAt) {
        const d = new Date(col.lastViewedAt);
        parts.push(`last viewed ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
      }
    }
    bar.textContent = parts.join('  ·  ');
    bar.style.display = '';
  }

  function renderVideos(items, stats) {
    videoList.innerHTML = '';
    const dlItems = (stats && stats.downloads && stats.downloads.items) || {};
    items.forEach(entry => {
      if (entry.type === 'header') {
        const item = document.createElement('div');
        item.className = 'admin-header-item';
        item.dataset.id = entry.id;
        item.dataset.type = 'header';
        item.innerHTML = `
          <span class="drag-handle">&#9776;</span>
          <input type="text" class="title-input header-text-input" value="${escapeHtml(entry.text)}">
          <button class="btn btn-icon delete-btn" title="Delete header">&times;</button>
        `;
        videoList.appendChild(item);
        return;
      }

      const item = document.createElement('div');
      item.className = 'admin-video-item';
      item.dataset.id = entry.id;

      const isPhoto = entry.type === 'photo';
      const thumbSrc = entry.thumbnail
        ? '/thumbnails/' + encodeURIComponent(entry.thumbnail) + '?t=' + Date.now()
        : '';

      let mediaThumbnail;
      if (thumbSrc) {
        mediaThumbnail = `<img src="${thumbSrc}" class="admin-thumb">`;
      } else if (isPhoto) {
        mediaThumbnail = `<img src="/uploads/${encodeURIComponent(entry.filename)}" class="admin-thumb">`;
      } else {
        mediaThumbnail = `<video src="/uploads/${encodeURIComponent(entry.filename)}" muted preload="metadata" class="admin-thumb"></video>`;
      }

      const dlCount = dlItems[entry.id] || 0;
      const dlBadge = `<span class="video-dl-count" title="${dlCount} download${dlCount !== 1 ? 's' : ''}">&#8595; ${dlCount}</span>`;

      item.innerHTML = `
        <span class="drag-handle">&#9776;</span>
        ${mediaThumbnail}
        <input type="text" class="title-input" value="${escapeHtml(entry.title)}">
        ${dlBadge}
        <button class="btn btn-icon replace-btn" title="Replace file">&#8635;</button>
        ${isPhoto ? '' : '<button class="btn btn-icon thumb-btn" title="Set thumbnail">&#127910;</button>'}
        <button class="btn btn-icon toggle-vis ${entry.visible ? '' : 'hidden-video'}" title="${entry.visible ? 'Visible' : 'Hidden'}">
          ${entry.visible ? '&#128065;' : '&#128064;'}
        </button>
        <button class="btn btn-icon delete-btn" title="Delete">&times;</button>
      `;
      videoList.appendChild(item);
    });
    initSortable();
  }

  // ============ Inline Title Edit ============

  videoList.addEventListener('change', async e => {
    if (!e.target.classList.contains('title-input')) return;
    const container = e.target.closest('.admin-video-item, .admin-header-item');
    const id = container.dataset.id;

    if (container.dataset.type === 'header') {
      await fetch(`/api/admin/galleries/${currentGalleryId}/headers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: e.target.value })
      });
    } else {
      await fetch(`/api/admin/galleries/${currentGalleryId}/videos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: e.target.value })
      });
    }
  });

  // ============ Visibility Toggle ============

  videoList.addEventListener('click', async e => {
    const btn = e.target.closest('.toggle-vis');
    if (!btn) return;
    const item = btn.closest('.admin-video-item');
    const id = item.dataset.id;
    const isCurrentlyVisible = !btn.classList.contains('hidden-video');
    const newVisible = !isCurrentlyVisible;

    const res = await fetch(`/api/admin/galleries/${currentGalleryId}/videos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible: newVisible })
    });

    if (res.ok) {
      btn.classList.toggle('hidden-video', !newVisible);
      btn.innerHTML = newVisible ? '&#128065;' : '&#128064;';
      btn.title = newVisible ? 'Visible' : 'Hidden';
    }
  });

  // ============ Delete ============

  videoList.addEventListener('click', async e => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;

    const item = btn.closest('.admin-video-item, .admin-header-item');
    const id = item.dataset.id;
    const isHeader = item.dataset.type === 'header';

    const msg = isHeader ? 'Delete this section header?' : 'Delete this item? This cannot be undone.';
    if (!confirm(msg)) return;

    const url = isHeader
      ? `/api/admin/galleries/${currentGalleryId}/headers/${id}`
      : `/api/admin/galleries/${currentGalleryId}/videos/${id}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) item.remove();
  });

  // ============ Replace Video ============

  const replaceFileInput = document.getElementById('replace-file-input');
  let replaceVideoId = null;

  videoList.addEventListener('click', e => {
    const btn = e.target.closest('.replace-btn');
    if (!btn) return;
    const item = btn.closest('.admin-video-item');
    replaceVideoId = item.dataset.id;
    replaceFileInput.click();
  });

  replaceFileInput.addEventListener('change', () => {
    const file = replaceFileInput.files[0];
    if (!file || !replaceVideoId) return;

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        loadVideos();
      } else {
        alert('Replace failed.');
      }
      replaceVideoId = null;
      replaceFileInput.value = '';
    });
    xhr.addEventListener('error', () => {
      alert('Replace failed.');
      replaceVideoId = null;
      replaceFileInput.value = '';
    });
    xhr.open('PUT', `/api/admin/galleries/${currentGalleryId}/videos/${replaceVideoId}/replace`);
    xhr.send(formData);
  });

  // ============ Add Section Header ============

  document.getElementById('add-header-btn').addEventListener('click', async () => {
    const text = prompt('Section header text:');
    if (!text) return;
    await fetch(`/api/admin/galleries/${currentGalleryId}/headers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    loadVideos();
  });

  // ============ Refresh Metadata ============

  document.getElementById('refresh-metadata-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-metadata-btn');
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    try {
      const res = await fetch(`/api/admin/galleries/${currentGalleryId}/probe`, { method: 'POST' });
      const data = await res.json();
      btn.textContent = data.updated > 0 ? `Updated ${data.updated} video${data.updated !== 1 ? 's' : ''}` : 'All up to date';
      if (data.updated > 0) loadVideos();
    } catch (err) {
      btn.textContent = 'Error';
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Refresh Metadata';
    }, 2500);
  });

  // ============ Drag & Drop Upload ============

  const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/x-quicktime', 'video/mov', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const ALLOWED_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const files = Array.from(e.dataTransfer.files).filter(f => {
      if (ALLOWED_TYPES.includes(f.type)) return true;
      const ext = f.name.toLowerCase().match(/\.[^.]+$/);
      return ext && ALLOWED_EXTS.includes(ext[0]);
    });
    if (files.length) queueUploads(files);
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    if (files.length) queueUploads(files);
    fileInput.value = '';
  });

  function titleFromFilename(filename) {
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/^\d{10,}-/, '')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled';
  }

  function queueUploads(files) {
    const items = files.map(file => {
      const id = 'upload-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const title = titleFromFilename(file.name);

      const row = document.createElement('div');
      row.className = 'upload-queue-item';
      row.id = id;
      row.innerHTML = `
        <span class="upload-file-name">${escapeHtml(file.name)}</span>
        <div class="upload-progress-bar">
          <div class="upload-progress-fill"></div>
        </div>
        <span class="upload-status">Waiting...</span>
      `;
      uploadQueue.appendChild(row);

      return { file, title, rowId: id };
    });

    processUploadQueue(items);
  }

  async function processUploadQueue(items) {
    for (const item of items) {
      const uploaded = await uploadFile(item.file, item.title, item.rowId);
      if (uploaded) {
        loadVideos();
        // Newly uploaded videos get a browser-generated thumbnail from a
        // random frame in the first 10s. Non-blocking: upload queue moves
        // on while this runs in the background.
        if (uploaded.type === 'video' && !uploaded.thumbnail) {
          autoGenerateVideoThumbnail(uploaded).catch(() => { /* non-fatal */ });
        }
      }
    }
  }

  function uploadFile(file, title, rowId) {
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', title);

      const xhr = new XMLHttpRequest();
      const row = document.getElementById(rowId);
      const fill = row.querySelector('.upload-progress-fill');
      const status = row.querySelector('.upload-status');

      status.textContent = 'Uploading...';

      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round(e.loaded / e.total * 100);
          fill.style.width = pct + '%';
          status.textContent = pct + '%';
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          fill.style.width = '100%';
          fill.style.background = '#4caf50';
          status.textContent = 'Done';
          setTimeout(() => row.remove(), 2000);
          let uploaded = null;
          try { uploaded = JSON.parse(xhr.responseText); } catch (_) {}
          resolve(uploaded);
        } else {
          fill.style.background = '#e00';
          status.textContent = 'Failed';
          let detail = `HTTP ${xhr.status}`;
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.error) detail = data.error;
          } catch (e) {
            if (xhr.responseText) detail += ': ' + xhr.responseText.substring(0, 200);
          }
          addErrorDetail(row, detail);
          addDismissBtn(row);
          resolve(null);
        }
      });

      xhr.addEventListener('error', () => {
        fill.style.background = '#e00';
        status.textContent = 'Failed';
        addErrorDetail(row, 'Network error — the server may have rejected the request before it reached the app. Check that the file is under 500 MB.');
        addDismissBtn(row);
        resolve(null);
      });

      xhr.open('POST', `/api/admin/galleries/${currentGalleryId}/videos`);
      xhr.send(formData);
    });
  }

  function addErrorDetail(row, message) {
    const detail = document.createElement('div');
    detail.className = 'upload-error-detail';
    detail.textContent = message;
    row.appendChild(detail);
  }

  function addDismissBtn(row) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-icon upload-dismiss';
    btn.title = 'Dismiss';
    btn.textContent = '\u2715';
    btn.addEventListener('click', () => row.remove());
    row.appendChild(btn);
  }

  // ============ Import from Server ============

  const importModal = document.getElementById('import-modal');
  const importFileList = document.getElementById('import-file-list');
  const importPathEl = document.getElementById('import-path');
  const importSelectAll = document.getElementById('import-select-all');
  const importConfirmBtn = document.getElementById('import-confirm-btn');

  document.getElementById('import-server-btn').addEventListener('click', openImportModal);
  document.getElementById('import-cancel-btn').addEventListener('click', closeImportModal);
  document.querySelector('.import-modal-backdrop').addEventListener('click', closeImportModal);

  async function openImportModal() {
    importModal.style.display = 'flex';
    importFileList.innerHTML = '<p class="import-loading">Scanning...</p>';
    importSelectAll.checked = false;
    importConfirmBtn.disabled = true;

    try {
      const res = await fetch('/api/admin/import/files');
      if (!res.ok) throw new Error('Failed to scan');
      const data = await res.json();
      importPathEl.textContent = data.path;

      if (!data.files.length) {
        importFileList.innerHTML = '<p class="import-empty">No media files found. Upload .mp4, .webm, .mov, .m4v, .jpg, .png, .webp, or .gif files via FTP to the path above.</p>';
        return;
      }

      importFileList.innerHTML = '';
      data.files.forEach(f => {
        const row = document.createElement('label');
        row.className = 'import-file-row';
        const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
        row.innerHTML = `
          <input type="checkbox" class="import-file-check" value="${escapeHtml(f.name)}">
          <span class="import-file-name">${escapeHtml(f.name)}</span>
          <span class="import-file-size">${sizeMB} MB</span>
        `;
        importFileList.appendChild(row);
      });
      updateImportBtn();
    } catch (err) {
      importFileList.innerHTML = '<p class="import-empty">Error scanning import folder.</p>';
    }
  }

  function closeImportModal() {
    importModal.style.display = 'none';
  }

  importSelectAll.addEventListener('change', () => {
    const checks = importFileList.querySelectorAll('.import-file-check');
    checks.forEach(c => c.checked = importSelectAll.checked);
    updateImportBtn();
  });

  importFileList.addEventListener('change', (e) => {
    if (e.target.classList.contains('import-file-check')) {
      updateImportBtn();
    }
  });

  function updateImportBtn() {
    const checked = importFileList.querySelectorAll('.import-file-check:checked');
    importConfirmBtn.disabled = checked.length === 0;
    importConfirmBtn.textContent = checked.length > 0
      ? `Import ${checked.length} File${checked.length !== 1 ? 's' : ''}`
      : 'Import Selected';
  }

  importConfirmBtn.addEventListener('click', async () => {
    const checked = importFileList.querySelectorAll('.import-file-check:checked');
    const filenames = Array.from(checked).map(c => c.value);
    if (!filenames.length) return;

    importConfirmBtn.disabled = true;
    importConfirmBtn.textContent = 'Importing...';

    try {
      const res = await fetch(`/api/admin/galleries/${currentGalleryId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames })
      });
      const data = await res.json();

      if (data.imported && data.imported.length) {
        closeImportModal();
        loadVideos();
      }

      if (data.errors && data.errors.length) {
        alert('Some files failed to import:\n' + data.errors.map(e => e.name + ': ' + e.error).join('\n'));
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      importConfirmBtn.disabled = false;
      importConfirmBtn.textContent = 'Import Selected';
    }
  });

  // ============ Thumbnail Picker ============

  videoList.addEventListener('click', e => {
    const btn = e.target.closest('.thumb-btn');
    if (!btn) return;
    const item = btn.closest('.admin-video-item');
    thumbVideoId = item.dataset.id;

    const vidEl = item.querySelector('video.admin-thumb');
    const imgEl = item.querySelector('img.admin-thumb');
    let src;
    if (vidEl) {
      src = vidEl.src;
    } else if (imgEl) {
      src = null;
    }

    if (!src) {
      fetch(`/api/admin/galleries/${currentGalleryId}/videos`).then(r => r.json()).then(data => {
        const videos = Array.isArray(data) ? data : (data.videos || []);
        const video = videos.find(v => v.id === thumbVideoId);
        if (video) {
          openThumbPicker('/uploads/' + encodeURIComponent(video.filename));
        }
      });
    } else {
      openThumbPicker(src);
    }
  });

  function openThumbPicker(videoSrc) {
    // No crossOrigin: same-origin, and setting 'anonymous' can taint the
    // canvas when the static file handler doesn't echo CORS headers.
    thumbVideo.src = videoSrc;
    thumbPicker.classList.add('open');
    thumbScrubber.value = 0;
    thumbTime.textContent = '0:00';

    thumbVideo.addEventListener('loadedmetadata', function onMeta() {
      thumbScrubber.max = thumbVideo.duration;
      // Seek to 0.1s so a real frame is decoded (time 0 can be black)
      thumbVideo.currentTime = 0.1;
      // The 'seeked' event handler will call drawThumbFrame automatically
      thumbVideo.removeEventListener('loadedmetadata', onMeta);
    });
  }

  thumbScrubber.addEventListener('input', () => {
    thumbVideo.currentTime = parseFloat(thumbScrubber.value);
  });

  thumbVideo.addEventListener('seeked', () => {
    drawThumbFrame();
    const t = thumbVideo.currentTime;
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60).toString().padStart(2, '0');
    thumbTime.textContent = mins + ':' + secs;
  });

  function drawThumbFrame() {
    // Letterbox the frame into the preview canvas rather than distorting it
    // to fill the fixed 16:9 box. The uploaded thumbnail is generated from a
    // separate canvas that exactly matches the video's aspect ratio, so
    // preview ≈ stored result (minus letterboxing).
    const vw = thumbVideo.videoWidth || 16;
    const vh = thumbVideo.videoHeight || 9;
    const canvasAspect = thumbCanvas.width / thumbCanvas.height;
    const videoAspect = vw / vh;
    let dw, dh, dx, dy;
    if (videoAspect > canvasAspect) {
      dw = thumbCanvas.width;
      dh = dw / videoAspect;
      dx = 0;
      dy = (thumbCanvas.height - dh) / 2;
    } else {
      dh = thumbCanvas.height;
      dw = dh * videoAspect;
      dx = (thumbCanvas.width - dw) / 2;
      dy = 0;
    }
    thumbCtx.fillStyle = '#000';
    thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = 'high';
    thumbCtx.drawImage(thumbVideo, dx, dy, dw, dh);
  }

  // Render the current frame from a <video> element to a JPEG Blob at the
  // video's native aspect, capped at 640px wide. Used for both the manual
  // thumbnail picker and the post-upload auto-thumbnail.
  async function captureFrameAsJpegBlob(videoEl) {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) throw new Error('Video not ready');
    const maxW = 640;
    const w = Math.min(vw, maxW);
    const h = Math.round(w * vh / vw);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(videoEl, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Canvas export failed')),
        'image/jpeg',
        0.88
      );
    });
  }

  async function uploadThumbnailBlob(videoId, blob) {
    const res = await fetch(`/api/admin/galleries/${currentGalleryId}/videos/${videoId}/thumbnail`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err.error || 'Failed to save thumbnail') + (err.detail ? '\n\n' + err.detail : ''));
    }
  }

  thumbCaptureBtn.addEventListener('click', async () => {
    thumbCaptureBtn.disabled = true;
    thumbCaptureBtn.textContent = 'Saving\u2026';
    try {
      const blob = await captureFrameAsJpegBlob(thumbVideo);
      await uploadThumbnailBlob(thumbVideoId, blob);
      closeThumbPicker();
      loadVideos();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      thumbCaptureBtn.disabled = false;
      thumbCaptureBtn.textContent = 'Set Thumbnail';
    }
  });

  // Kick off a browser-side thumbnail generation for a newly uploaded video:
  // load the video, seek to a random spot in the first 10 seconds, capture
  // the frame, and upload the resulting JPEG as its thumbnail.
  async function autoGenerateVideoThumbnail(video) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = '/uploads/' + encodeURIComponent(video.filename);

    const waitFor = (eventName, timeoutMs) => new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        v.removeEventListener(eventName, onOk);
        v.removeEventListener('error', onErr);
      };
      const onOk = () => { if (done) return; done = true; cleanup(); resolve(); };
      const onErr = () => { if (done) return; done = true; cleanup(); reject(new Error(eventName + ' failed')); };
      v.addEventListener(eventName, onOk, { once: true });
      v.addEventListener('error', onErr, { once: true });
      setTimeout(() => { if (done) return; done = true; cleanup(); reject(new Error(eventName + ' timed out')); }, timeoutMs);
    });

    try {
      await waitFor('loadedmetadata', 30000);
      const duration = v.duration || 0;
      const upper = Math.min(10, isFinite(duration) && duration > 0 ? duration : 10);
      // Avoid the very first frame (often black) — pick between 0.3s and upper
      const lo = Math.min(0.3, upper);
      const seekTo = lo + Math.random() * Math.max(0, upper - lo);
      v.currentTime = seekTo;
      await waitFor('seeked', 15000);
      const blob = await captureFrameAsJpegBlob(v);
      await uploadThumbnailBlob(video.id, blob);
      loadVideos();
    } finally {
      v.removeAttribute('src');
      v.load();
    }
  }

  thumbCancelBtn.addEventListener('click', () => closeThumbPicker());

  function closeThumbPicker() {
    thumbPicker.classList.remove('open');
    thumbVideo.pause();
    thumbVideo.src = '';
    thumbVideoId = null;
  }

  thumbPicker.addEventListener('click', e => {
    if (e.target === thumbPicker) closeThumbPicker();
  });

  // ============ Drag & Drop Reorder ============

  function initSortable() {
    Sortable.create(videoList, {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: async () => {
        const items = videoList.querySelectorAll('.admin-video-item, .admin-header-item');
        const order = Array.from(items).map(item => item.dataset.id);
        await fetch(`/api/admin/galleries/${currentGalleryId}/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order })
        });
      }
    });
  }

  // ============ Comments (admin view) ============

  async function loadComments() {
    if (!currentGalleryId) return;
    const res = await fetch(`/api/admin/galleries/${currentGalleryId}/comments`);
    if (!res.ok) {
      if (res.status === 401) checkAuth();
      return;
    }
    const comments = await res.json();
    const listEl = document.getElementById('comments-list');
    const noEl = document.getElementById('no-comments');

    if (!comments.length) {
      listEl.innerHTML = '';
      noEl.style.display = '';
      return;
    }

    noEl.style.display = 'none';

    // Group comments by video
    const grouped = {};
    const videoOrder = [];
    comments.forEach(c => {
      const key = c.videoId || c.videoTitle || 'Unknown';
      if (!grouped[key]) {
        grouped[key] = { title: c.videoTitle || 'Unknown Video', comments: [] };
        videoOrder.push(key);
      }
      grouped[key].comments.push(c);
    });

    listEl.innerHTML = '';
    videoOrder.forEach(key => {
      const group = grouped[key];
      const section = document.createElement('div');
      section.className = 'comments-video-group';

      const header = document.createElement('div');
      header.className = 'comments-video-header';
      header.innerHTML = `
        <span class="comments-video-toggle">&#9660;</span>
        <span class="comments-video-name">${escapeHtml(group.title)}</span>
        <span class="comments-video-count">${group.comments.length} comment${group.comments.length !== 1 ? 's' : ''}</span>
      `;
      header.addEventListener('click', () => {
        section.classList.toggle('collapsed');
      });

      const body = document.createElement('div');
      body.className = 'comments-video-body';
      body.innerHTML = group.comments.map(c => `
        <div class="comment-item">
          <div class="comment-header">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="comment-timestamp">@ ${formatTime(c.timestamp)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
          <div class="comment-date">${new Date(c.createdAt).toLocaleString()}</div>
        </div>
      `).join('');

      section.appendChild(header);
      section.appendChild(body);
      listEl.appendChild(section);
    });
  }

  // ============ Email Settings ============

  async function showEmailSettings() {
    currentGalleryId = null;
    currentGallery = null;
    currentCollectionId = null;
    noGallery.style.display = 'none';
    videosPanel.style.display = 'none';
    collectionPanel.style.display = 'none';
    emailSettingsPanel.style.display = '';
    renderGalleryList();
    await loadEmailSettings();
  }

  async function loadEmailSettings() {
    const res = await fetch('/api/settings/email');
    if (!res.ok) {
      if (res.status === 401) checkAuth();
      return;
    }
    const config = await res.json();
    document.getElementById('resend-api-key').value = config.resendApiKey || '';
    document.getElementById('smtp-host').value = config.host || '';
    document.getElementById('smtp-port').value = config.port || 587;
    document.getElementById('smtp-secure').checked = !!config.secure;
    document.getElementById('smtp-user').value = config.user || '';
    document.getElementById('smtp-pass').value = config.pass || '';
    document.getElementById('smtp-from').value = config.from || '';
    document.getElementById('smtp-admin-email').value = config.adminEmail || '';
    document.getElementById('smtp-base-url').value = config.baseUrl || '';
  }

  document.getElementById('save-email-btn').addEventListener('click', async () => {
    const body = {
      resendApiKey: document.getElementById('resend-api-key').value,
      host: document.getElementById('smtp-host').value,
      port: document.getElementById('smtp-port').value,
      secure: document.getElementById('smtp-secure').checked,
      user: document.getElementById('smtp-user').value,
      pass: document.getElementById('smtp-pass').value,
      from: document.getElementById('smtp-from').value,
      adminEmail: document.getElementById('smtp-admin-email').value,
      baseUrl: document.getElementById('smtp-base-url').value
    };

    const res = await fetch('/api/settings/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const statusEl = document.getElementById('email-status');
    if (res.ok) {
      statusEl.textContent = 'Settings saved.';
      statusEl.className = 'email-status success';
    } else {
      statusEl.textContent = 'Failed to save settings.';
      statusEl.className = 'email-status error';
    }
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'email-status'; }, 4000);
  });

  // Email test result modal
  const emailResultModal = document.getElementById('email-result-modal');
  const emailResultTitle = document.getElementById('email-result-title');
  const emailResultText = document.getElementById('email-result-text');
  const emailResultCopyBtn = document.getElementById('email-result-copy-btn');
  const emailResultCloseBtn = document.getElementById('email-result-close-btn');

  function showEmailResultModal(type, title, message) {
    emailResultTitle.textContent = title;
    emailResultTitle.className = type;
    emailResultText.textContent = message;
    emailResultText.className = 'email-result-pre ' + type;
    emailResultCopyBtn.style.display = type === 'error' ? '' : 'none';
    emailResultCopyBtn.textContent = 'Copy Error';
    emailResultModal.style.display = 'flex';
  }

  function closeEmailResultModal() {
    emailResultModal.style.display = 'none';
  }

  emailResultCloseBtn.addEventListener('click', closeEmailResultModal);
  document.querySelector('.email-result-backdrop').addEventListener('click', closeEmailResultModal);
  emailResultCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(emailResultText.textContent).then(() => {
      emailResultCopyBtn.textContent = 'Copied!';
      setTimeout(() => { emailResultCopyBtn.textContent = 'Copy Error'; }, 2000);
    });
  });

  document.getElementById('test-email-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('email-status');
    statusEl.textContent = 'Sending test email...';
    statusEl.className = 'email-status';

    const res = await fetch('/api/settings/email/test', { method: 'POST' });
    statusEl.textContent = '';
    statusEl.className = 'email-status';

    if (res.ok) {
      showEmailResultModal('success', 'Email Test Succeeded', 'Test email sent successfully! Check your inbox.');
    } else {
      const data = await res.json().catch(() => ({}));
      showEmailResultModal('error', 'Email Test Failed', data.error || 'Failed to send test email.');
    }
  });

  // ============ Helpers ============

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return mins + ':' + secs;
  }

  // Init
  checkAuth();
});
