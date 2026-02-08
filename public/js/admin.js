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

  // State
  let galleries = [];
  let currentGalleryId = null;
  let currentGallery = null;

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
    const res = await fetch('/api/galleries');
    if (!res.ok) {
      if (res.status === 401) checkAuth();
      return;
    }
    galleries = await res.json();
    renderGalleryList();
  }

  function renderGalleryList() {
    galleryListEl.innerHTML = '';
    galleries.forEach(g => {
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

      galleryListEl.appendChild(item);
    });
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
        const msg = data.output || 'Up to date';
        alert('Deploy successful:\n\n' + msg + '\n\nPage will reload.');
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
    const match = hash.match(/^gallery\/([^/]+)\/(videos|settings|comments)$/);

    if (hash === 'email-settings') {
      showEmailSettings();
    } else if (match) {
      const gid = match[1];
      const tab = match[2];
      selectGallery(gid, tab);
    } else if (hash.match(/^gallery\/([^/]+)$/)) {
      const gid = hash.match(/^gallery\/([^/]+)$/)[1];
      selectGallery(gid, 'videos');
    } else {
      showNoGallery();
    }
  }

  window.addEventListener('hashchange', handleHash);

  function showNoGallery() {
    currentGalleryId = null;
    currentGallery = null;
    noGallery.style.display = '';
    videosPanel.style.display = 'none';
    emailSettingsPanel.style.display = 'none';
    renderGalleryList();
  }

  function selectGallery(gid, tab) {
    const gallery = galleries.find(g => g.id === gid);
    if (!gallery) { showNoGallery(); return; }

    currentGalleryId = gid;
    currentGallery = gallery;
    noGallery.style.display = 'none';
    videosPanel.style.display = '';
    emailSettingsPanel.style.display = 'none';
    galleryTitle.textContent = gallery.name;

    // Show/hide proofing-only elements
    const isProofing = gallery.type === 'proofing';
    document.querySelectorAll('.setting-proofing-only').forEach(el => {
      el.style.display = isProofing ? '' : 'none';
    });
    document.querySelector('.tab-comments').style.display = isProofing ? '' : 'none';

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
      document.getElementById('setting-password').value = currentGallery.password || '';
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
      body.password = document.getElementById('setting-password').value.trim();
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

  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const input = document.getElementById('setting-link');
    navigator.clipboard.writeText(input.value);
    alert('Link copied!');
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
          addDismissBtn(row);
          resolve(false);
        }
      });

      xhr.addEventListener('error', () => {
        fill.style.background = '#e00';
        status.textContent = 'Error';
        addDismissBtn(row);
        resolve(false);
      });

      xhr.open('POST', `/api/admin/galleries/${currentGalleryId}/videos`);
      xhr.send(formData);
    });
  }

  function addDismissBtn(row) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-icon upload-dismiss';
    btn.title = 'Dismiss';
    btn.textContent = '\u2715';
    btn.addEventListener('click', () => row.remove());
    row.appendChild(btn);
  }

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
    listEl.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div class="comment-header">
          <strong>${escapeHtml(c.name)}</strong>
          <span class="comment-video-title">on ${escapeHtml(c.videoTitle)}</span>
          <span class="comment-timestamp">@ ${formatTime(c.timestamp)}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
        <div class="comment-date">${new Date(c.createdAt).toLocaleString()}</div>
      </div>
    `).join('');
  }

  // ============ Email Settings ============

  async function showEmailSettings() {
    currentGalleryId = null;
    currentGallery = null;
    noGallery.style.display = 'none';
    videosPanel.style.display = 'none';
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
