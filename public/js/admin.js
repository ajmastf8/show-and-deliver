document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
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
  let currentCollectionId = null;

  // ============ Auth ============

  async function checkAuth() {
    const res = await fetch('/api/auth/check');
    const { authenticated } = await res.json();
    loginSection.style.display = authenticated ? 'none' : 'flex';
    dashboardSection.style.display = authenticated ? '' : 'none';
    if (authenticated) {
      await loadGalleries();
      handleHash();
    }
  }

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

  function renderGalleryList() {
    galleryListEl.innerHTML = '';

    // Build set of gallery IDs that belong to a collection
    const groupedIds = new Set();
    collections.forEach(col => {
      (col.galleryIds || []).forEach(gid => groupedIds.add(gid));
    });

    // Render collections as groups
    collections.forEach(col => {
      const group = document.createElement('div');
      group.className = 'collection-group';
      group.dataset.colId = col.id;

      const colGalleries = (col.galleryIds || [])
        .map(gid => galleries.find(g => g.id === gid))
        .filter(Boolean);

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
          // Toggle collapse
          group.classList.toggle('collapsed');
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
      ? `<span class="gallery-badge proofing">Proofing</span>`
      : `<span class="gallery-badge reels">Reels</span>`;

    const count = g.type === 'proofing'
      ? `${g.videoCount} video${g.videoCount !== 1 ? 's' : ''} &middot; ${g.commentCount} comment${g.commentCount !== 1 ? 's' : ''}`
      : `${g.videoCount} video${g.videoCount !== 1 ? 's' : ''}`;

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
    window.location.hash = 'email-settings';
  });

  // ============ Deploy from GitHub ============

  document.getElementById('deploy-btn').addEventListener('click', async () => {
    const btn = document.getElementById('deploy-btn');
    if (!confirm('Pull latest code from GitHub and deploy?')) return;

    btn.disabled = true;
    btn.textContent = 'Deploying...';

    try {
      const res = await fetch('/api/settings/deploy', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        const msg = data.message || 'Deploy successful';
        alert(msg + '\n\nPage will reload.');
        window.location.reload();
      } else {
        alert('Deploy failed:\n\n' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Deploy error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Deploy from GitHub';
    }
  });

  // ============ Hash Routing ============

  function handleHash() {
    const hash = window.location.hash.replace('#', '');
    const galleryMatch = hash.match(/^gallery\/([^/]+)\/(videos|settings|comments)$/);
    const galleryShort = hash.match(/^gallery\/([^/]+)$/);
    const collectionMatch = hash.match(/^collection\/([^/]+)\/settings$/);

    if (hash === 'email-settings') {
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
    currentCollectionId = null;
    noGallery.style.display = 'none';
    videosPanel.style.display = '';
    emailSettingsPanel.style.display = 'none';
    collectionPanel.style.display = 'none';
    galleryTitle.textContent = gallery.name;

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
    else if (tab === 'settings') loadSettings();
    else if (tab === 'comments') loadComments();
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

    document.getElementById('collection-title').textContent = col.name;
    document.getElementById('col-setting-name').value = col.name;
    document.getElementById('col-setting-link').value = window.location.origin + '/collection/' + col.token;

    // Gallery picker
    const picker = document.getElementById('col-gallery-picker');
    picker.innerHTML = '';
    galleries.forEach(g => {
      const row = document.createElement('label');
      row.className = 'col-gallery-picker-row';
      const checked = (col.galleryIds || []).includes(g.id) ? 'checked' : '';
      const badgeClass = g.type === 'proofing' ? 'proofing' : 'reels';
      const badgeText = g.type === 'proofing' ? 'Proofing' : 'Reels';
      row.innerHTML = `
        <input type="checkbox" value="${g.id}" ${checked}>
        <span class="col-gallery-picker-name">${escapeHtml(g.name)}</span>
        <span class="col-gallery-picker-badge ${badgeClass}">${badgeText}</span>
      `;
      picker.appendChild(row);
    });

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

  document.getElementById('col-save-btn').addEventListener('click', async () => {
    if (!currentCollectionId) return;
    const picker = document.getElementById('col-gallery-picker');
    const checked = picker.querySelectorAll('input[type="checkbox"]:checked');
    const galleryIds = Array.from(checked).map(c => c.value);

    const res = await fetch(`/api/collections/${currentCollectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('col-setting-name').value,
        galleryIds
      })
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

  document.getElementById('new-reels-btn').addEventListener('click', async () => {
    const name = prompt('Reels gallery name:', 'Video Reels');
    if (!name) return;
    await fetch('/api/galleries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'reels' })
    });
    await loadGalleries();
  });

  document.getElementById('new-proofing-btn').addEventListener('click', async () => {
    const name = prompt('Proofing gallery name:', 'Client Proofing');
    if (!name) return;
    const res = await fetch('/api/galleries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'proofing' })
    });
    const gallery = await res.json();

    // If collections exist, prompt to add to one
    if (collections.length > 0) {
      const options = collections.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      const choice = prompt(`Add to a collection?\n\n${options}\n\nEnter number (or leave empty to skip):`);
      if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < collections.length) {
          const col = collections[idx];
          const updatedIds = [...(col.galleryIds || []), gallery.id];
          await fetch(`/api/collections/${col.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ galleryIds: updatedIds })
          });
        }
      }
    }

    await loadGalleries();
    window.location.hash = `gallery/${gallery.id}/videos`;
  });

  // ============ Gallery Settings ============

  function loadSettings() {
    if (!currentGallery) return;
    document.getElementById('setting-name').value = currentGallery.name;
    document.getElementById('setting-type').textContent = currentGallery.type === 'proofing' ? 'Client Proofing' : 'Video Reels';
    document.getElementById('setting-active').checked = currentGallery.active;

    if (currentGallery.type === 'proofing') {
      const baseUrl = window.location.origin;
      document.getElementById('setting-link').value = baseUrl + '/gallery/' + currentGallery.token;
      // Password field: show placeholder if password is set, empty if not
      const pwInput = document.getElementById('setting-password');
      pwInput.value = '';
      pwInput.placeholder = currentGallery.hasPassword ? '(password set — enter new to change)' : 'No password';
      document.getElementById('setting-downloads').checked = currentGallery.downloadsEnabled;
      document.getElementById('setting-expires').value = currentGallery.expiresAt ? currentGallery.expiresAt.split('T')[0] : '';
    }
  }

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('setting-name').value,
      active: document.getElementById('setting-active').checked
    };

    if (currentGallery.type === 'proofing') {
      // Only send password if user typed something new
      const pwVal = document.getElementById('setting-password').value.trim();
      if (pwVal) body.password = pwVal;
      body.downloadsEnabled = document.getElementById('setting-downloads').checked;
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
      galleryTitle.textContent = updated.name;
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

    const subject = `${name} — Videos for Review`;

    const passwordLine = currentGallery.hasPassword
      ? `\nPassword: [enter the gallery password here]\n`
      : '';

    const body = `Hello,

I'd like to share some videos with you for review.

${galleryUrl}
${passwordLine}
HOW TO LEAVE COMMENTS
1. Open the link above and enter your name when prompted.
2. Click on any video to open it.
3. Play the video to the moment you'd like to comment on, then pause it.
4. Type your comment in the box on the right — the timestamp is captured automatically when you start typing.
5. Press Enter to post your comment (Shift+Enter for a new line).
6. When you're finished with a video, click "Finish & Send Comments" to send your feedback.

Your comments are time-stamped to the exact moment in the video, so I can find exactly what you're referring to.

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
    const items = await res.json();
    renderVideos(items);
  }

  function renderVideos(items) {
    videoList.innerHTML = '';
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

      const thumbSrc = entry.thumbnail
        ? '/thumbnails/' + encodeURIComponent(entry.thumbnail) + '?t=' + Date.now()
        : '';

      item.innerHTML = `
        <span class="drag-handle">&#9776;</span>
        ${thumbSrc
          ? `<img src="${thumbSrc}" class="admin-thumb">`
          : `<video src="/uploads/${encodeURIComponent(entry.filename)}" muted preload="metadata" class="admin-thumb"></video>`
        }
        <input type="text" class="title-input" value="${escapeHtml(entry.title)}">
        <button class="btn btn-icon replace-btn" title="Replace video">&#8635;</button>
        <button class="btn btn-icon thumb-btn" title="Set thumbnail">&#127910;</button>
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

    const msg = isHeader ? 'Delete this section header?' : 'Delete this video? This cannot be undone.';
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

  const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/x-quicktime', 'video/mov'];

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
    const ALLOWED_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];
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
      const ok = await uploadFile(item.file, item.title, item.rowId);
      if (ok) loadVideos();
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
          resolve(true);
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
          resolve(false);
        }
      });

      xhr.addEventListener('error', () => {
        fill.style.background = '#e00';
        status.textContent = 'Failed';
        addErrorDetail(row, 'Network error — the server may have rejected the request before it reached the app. Check that the file is under 500 MB.');
        addDismissBtn(row);
        resolve(false);
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
        importFileList.innerHTML = '<p class="import-empty">No video files found. Upload .mp4, .webm, .mov, or .m4v files via FTP to the path above.</p>';
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
      fetch(`/api/admin/galleries/${currentGalleryId}/videos`).then(r => r.json()).then(videos => {
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
    thumbVideo.crossOrigin = 'anonymous';
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
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = 'high';
    thumbCtx.drawImage(thumbVideo, 0, 0, thumbCanvas.width, thumbCanvas.height);
  }

  thumbCaptureBtn.addEventListener('click', async () => {
    const timestamp = thumbVideo.currentTime;

    // Disable button while processing
    thumbCaptureBtn.disabled = true;
    thumbCaptureBtn.textContent = 'Generating...';

    try {
      const res = await fetch(`/api/admin/galleries/${currentGalleryId}/videos/${thumbVideoId}/thumbnail`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp })
      });

      if (res.ok) {
        closeThumbPicker();
        loadVideos();
      } else {
        const err = await res.json().catch(() => ({}));
        alert((err.error || 'Failed to save thumbnail.') + (err.detail ? '\n\n' + err.detail : ''));
      }
    } catch (err) {
      alert('Network error saving thumbnail.');
    } finally {
      thumbCaptureBtn.disabled = false;
      thumbCaptureBtn.textContent = 'Use This Frame';
    }
  });

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
