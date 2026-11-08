// Drop page: a client gallery visitors can add to.
//
// Deliberately the same shell as the client gallery (proofing.css and the same
// .proofing-* markup), with one addition at the top: an upload zone. One URL, one
// shared password, and each contributor's email captured at unlock (used only to
// credit what they upload).
document.addEventListener('DOMContentLoaded', () => {
  const token = window.location.pathname.split('/').pop();

  const loadingView = document.getElementById('loading-view');
  const errorView = document.getElementById('error-view');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');
  const passwordView = document.getElementById('password-view');
  const passwordForm = document.getElementById('password-form');
  const passwordGalleryName = document.getElementById('password-gallery-name');
  const emailInput = document.getElementById('drop-email');
  const passwordInput = document.getElementById('gallery-password');
  const passwordError = document.getElementById('password-error');
  const galleryView = document.getElementById('gallery-view');
  const galleryName = document.getElementById('gallery-name');
  const viewerDisplayName = document.getElementById('viewer-display-name');
  const videoListEl = document.getElementById('video-list');

  const dropZone = document.getElementById('drop-zone');
  const dropFile = document.getElementById('drop-file');
  const dzHint = document.getElementById('dz-hint');
  const queueEl = document.getElementById('drop-queue');

  const lightbox = document.getElementById('lightbox');
  const lightboxVideo = document.getElementById('lightbox-video');
  const lightboxPhoto = document.getElementById('lightbox-photo');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxSpinner = document.getElementById('lightbox-spinner');
  const lbPrev = document.querySelector('.lightbox-prev');
  const lbNext = document.querySelector('.lightbox-next');
  const lbClose = document.querySelector('.lightbox-close-btn');
  const PREFERRED_CHUNK_BYTES = 8 * 1024 * 1024;
  const VIDEO_CONTROL_BAR = 40;

  let galleryData = null;   // the last payload from GET /api/drop/{token}
  let version = null;       // the server's version marker, for the live poll
  let currentIndex = -1;    // which item the lightbox is showing

  const photoMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function showError(title, msg) {
    loadingView.style.display = 'none';
    passwordView.style.display = 'none';
    galleryView.style.display = 'none';
    errorTitle.textContent = title;
    errorMessage.textContent = msg;
    errorView.style.display = 'flex';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Thumbnails and proxies are served straight off disk (the password gates the
  // page, not the files), so a plain URL is all a preview needs.
  function previewUrl(item, kind) {
    return kind === 'thumb'
      ? '/thumbnails/' + encodeURIComponent(item.thumbnail)
      : '/proxies/' + encodeURIComponent(item.proxy);
  }

  // ---- Loading and unlocking ##

  async function load() {
    let res, body;
    try {
      res = await fetch(`/api/drop/${encodeURIComponent(token)}`);
      body = await res.json().catch(() => ({}));
    } catch (_) {
      showError('Gallery unavailable', 'Could not reach the server. Check your connection and try again.');
      return;
    }
    if (!res.ok) {
      showError('Gallery Not Found', body.error || 'This gallery may have been removed or the link is incorrect.');
      return;
    }
    if (body.locked) { showPassword(body.galleryName); return; }
    render(body);
  }

  function showPassword(name) {
    loadingView.style.display = 'none';
    errorView.style.display = 'none';
    galleryView.style.display = 'none';
    passwordGalleryName.textContent = name || '';
    passwordView.style.display = 'flex';
    const saved = localStorage.getItem('drop-email:' + token);
    if (saved) emailInput.value = saved;
    (emailInput.value ? passwordInput : emailInput).focus();
  }

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    passwordError.textContent = '';
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const btn = passwordForm.querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/drop/${encodeURIComponent(token)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { passwordError.textContent = body.error || 'Could not unlock the gallery'; return; }
      localStorage.setItem('drop-email:' + token, email);
      passwordView.style.display = 'none';
      render(body);
    } catch (_) {
      passwordError.textContent = 'Connection problem. Try again.';
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Rendering the gallery ##

  function render(body) {
    galleryData = body;
    version = body.gallery.version;
    loadingView.style.display = 'none';
    passwordView.style.display = 'none';
    errorView.style.display = 'none';
    galleryView.style.display = 'block';

    galleryName.textContent = body.gallery.name;
    viewerDisplayName.textContent = body.email || '';
    document.title = body.gallery.name || 'Gallery';

    const accepts = [];
    if (body.gallery.allowPhotos) accepts.push(...photoMimes, '.jpg', '.jpeg', '.png', '.webp', '.gif');
    if (body.gallery.allowVideos) accepts.push('video/mp4', 'video/webm', 'video/quicktime', '.mp4', '.webm', '.mov', '.m4v');
    dropFile.setAttribute('accept', accepts.join(','));

    const parts = [];
    if (body.gallery.allowPhotos) parts.push('photos');
    if (body.gallery.allowVideos) parts.push('videos');
    dzHint.textContent = parts.length
      ? `Add ${parts.join(' or ')} · up to ${body.gallery.maxFileMb} MB each · large files upload in chunks`
      : 'This gallery is not accepting uploads right now.';

    renderVideoList();
  }

  // Same card markup as the client gallery, with the uploader standing in for
  // the comment count in the meta line.
  function renderVideoList() {
    videoListEl.innerHTML = '';
    const items = galleryData.items || [];

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'proofing-video-card';
      card.dataset.id = item.id;

      const isPhoto = item.type === 'photo';
      const thumbSrc = item.thumbnail ? previewUrl(item, 'thumb') : '';

      let durationLabel = '';
      if (!isPhoto && item.duration) {
        const mins = Math.floor(item.duration / 60);
        const secs = Math.floor(item.duration % 60).toString().padStart(2, '0');
        durationLabel = `<span class="proofing-thumb-duration">${mins}:${secs}</span>`;
      }

      let resLabel = '';
      if (item.width && item.height) {
        if (isPhoto) {
          resLabel = `<span class="proofing-card-res">${item.width}&times;${item.height}</span>`;
        } else {
          const h = Math.max(item.width, item.height);
          const v = Math.min(item.width, item.height);
          if (h >= 3840) resLabel = '4K';
          else if (h >= 2560) resLabel = '1440p';
          else if (v >= 1080 || h >= 1920) resLabel = '1080p';
          else if (v >= 720 || h >= 1280) resLabel = '720p';
          else resLabel = v + 'p';
          resLabel = `<span class="proofing-card-res">${resLabel}</span>`;
        }
      }

      const whoLabel = item.uploader
        ? `<span class="proofing-card-comments">${escapeHtml(item.uploader)}</span>`
        : '';

      let thumbContent;
      if (thumbSrc) {
        thumbContent = `<img src="${thumbSrc}" alt="${escapeHtml(item.title)}" loading="lazy">`;
      } else if (isPhoto) {
        thumbContent = `<img src="/uploads/${encodeURIComponent(item.filename || '')}" alt="${escapeHtml(item.title)}" loading="lazy">`;
      } else {
        thumbContent = `<video src="/uploads/${encodeURIComponent(item.filename || '')}" muted preload="metadata"></video>`;
      }

      card.innerHTML = `
        <div class="proofing-thumb-wrapper">
          ${thumbContent}
          ${durationLabel}
        </div>
        ${item.title || resLabel || whoLabel ? `<div class="proofing-card-info">
          <span class="proofing-card-title">${escapeHtml(item.title)}</span>
          <div class="proofing-card-meta">${resLabel}${whoLabel}</div>
        </div>` : ''}
      `;

      card.addEventListener('click', () => openLightbox(item.id));
      videoListEl.appendChild(card);
    });
  }

  // ---- Lightbox ##

  function openLightbox(itemId) {
    const items = galleryData.items || [];
    const idx = items.findIndex(v => v.id === itemId);
    if (idx < 0) return;
    currentIndex = idx;
    const item = items[idx];

    lightboxTitle.textContent = item.title || (item.uploader ? 'Added by ' + item.uploader : '');
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const isPhoto = item.type === 'photo';
    if (isPhoto) {
      lightboxVideo.pause();
      lightboxVideo.src = '';
      lightboxVideo.style.display = 'none';
      lightboxSpinner.classList.remove('active');
      lightboxPhoto.src = item.proxy
        ? previewUrl(item, 'proxy')
        : '/uploads/' + encodeURIComponent(item.filename || '');
      lightboxPhoto.style.display = '';
    } else {
      lightboxPhoto.style.display = 'none';
      lightboxPhoto.src = '';
      lightboxVideo.style.display = '';
      lightboxSpinner.classList.add('active');
      lightboxVideo.src = '/uploads/' + encodeURIComponent(item.filename || '');
      if (item.thumbnail) lightboxVideo.poster = previewUrl(item, 'thumb');
      lightboxVideo.load();
      lightboxVideo.addEventListener('canplay', function onCanPlay() {
        lightboxVideo.removeEventListener('canplay', onCanPlay);
        lightboxVideo.play().catch(() => {});
      });
    }
    layoutLightboxVideo();
  }

  function closeLightbox() {
    lightbox.style.display = 'none';
    lightboxVideo.pause();
    lightboxVideo.src = '';
    lightboxPhoto.src = '';
    lightboxPhoto.style.display = 'none';
    currentIndex = -1;
    document.body.style.overflow = '';
  }

  function step(delta) {
    const items = galleryData.items || [];
    if (!items.length) return;
    openLightbox(items[(currentIndex + delta + items.length) % items.length].id);
  }

  // Size the <video> element to the picture height plus a strip for the native
  // controls, so the controls sit below the picture rather than over it — the
  // same trick proofing.js uses.
  function layoutLightboxVideo() {
    if (lightboxVideo.style.display === 'none') return;
    const wrapper = lightboxVideo.parentElement;
    const availW = wrapper.clientWidth;
    const availH = wrapper.clientHeight;
    const w = lightboxVideo.videoWidth || 16;
    const h = lightboxVideo.videoHeight || 9;
    if (!w || !h) return;
    let dispW = Math.min(availW, availH * (w / h));
    let dispH = dispW * (h / w);
    if (dispH + VIDEO_CONTROL_BAR > availH) {
      dispH = Math.max(0, availH - VIDEO_CONTROL_BAR);
      dispW = dispH * (w / h);
    }
    lightboxVideo.style.width = dispW + 'px';
    lightboxVideo.style.height = (dispH + VIDEO_CONTROL_BAR) + 'px';
  }

  lightboxVideo.addEventListener('loadedmetadata', layoutLightboxVideo);
  lightboxVideo.addEventListener('waiting', () => lightboxSpinner.classList.add('active'));
  lightboxVideo.addEventListener('playing', () => lightboxSpinner.classList.remove('active'));
  lightboxVideo.addEventListener('canplay', () => lightboxSpinner.classList.remove('active'));
  window.addEventListener('resize', layoutLightboxVideo);

  lbClose.addEventListener('click', closeLightbox);
  lightbox.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', () => step(-1));
  lbNext.addEventListener('click', () => step(1));
  document.addEventListener('keydown', (e) => {
    if (lightbox.style.display === 'none') return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  // ---- Uploading ##

  queueEl.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-retry]');
    if (retry) startUpload(retry._job);
  });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    enqueue(Array.from(e.dataTransfer.files || []));
  });
  dropFile.addEventListener('change', (e) => {
    enqueue(Array.from(e.target.files || []));
    e.target.value = '';
  });

  function allowed(file) {
    const g = (galleryData && galleryData.gallery) || {};
    if (file.type.startsWith('image/') && !g.allowPhotos) return false;
    if (file.type.startsWith('video/') && !g.allowVideos) return false;
    return true;
  }

  function enqueue(files) {
    if (!galleryData) return;
    const usable = files.filter(f => f && f.size > 0);
    if (!usable.length) return;
    for (const file of usable) {
      if (!allowed(file)) { toast('That file type is not allowed in this gallery.'); continue; }
      if (file.size > galleryData.gallery.maxFileMb * 1024 * 1024) {
        toast(`"${file.name}" is over the ${galleryData.gallery.maxFileMb} MB limit.`);
        continue;
      }
      const job = { file, name: file.name, size: file.size, status: 'queued', pct: 0, sent: 0, uploadId: null };
      job.row = queueRow(job);
      queueEl.appendChild(job.row.el);
      startUpload(job);
    }
  }

  function queueRow(job) {
    const el = document.createElement('div');
    el.className = 'drop-qrow';
    el.innerHTML = `<div class="drop-qmain">
        <span class="drop-qname"></span>
        <span class="drop-qstatus">Waiting&hellip;</span>
      </div>
      <div class="drop-qbar"><div class="drop-qbar-fill"></div></div>
      <button class="link-btn drop-qretry" data-retry hidden>Retry</button>`;
    el.querySelector('.drop-qname').textContent = job.name;
    return { el, status: el.querySelector('.drop-qstatus'), fill: el.querySelector('.drop-qbar-fill'), retry: el.querySelector('.drop-qretry') };
  }

  function updateRow(job) {
    if (!job.row) return;
    job.row.fill.style.width = job.pct + '%';
    job.row.el.classList.toggle('done', job.status === 'done');
    job.row.el.classList.toggle('error', job.status === 'error');
    if (job.status === 'uploading') job.row.status.textContent = job.pct + '%';
    else if (job.status === 'done') job.row.status.textContent = 'Added';
    else if (job.status === 'error') job.row.status.textContent = job.error || 'Failed';
    else job.row.status.textContent = 'Waiting…';
    job.row.retry.hidden = job.status !== 'error';
    job.row.retry._job = job;
  }

  // Chunked upload, same contract as the admin: initiate, PUT contiguous
  // chunks, finalize. A dropped connection leaves `sent` where the server last
  // acknowledged, so Retry resumes rather than restarting.
  async function startUpload(job) {
    if (job.status === 'done' || job.status === 'uploading') return;
    job.status = 'uploading';
    job.error = '';
    updateRow(job);
    try {
      if (!job.uploadId) {
        const init = await sendJson(`/api/drop/${encodeURIComponent(token)}/uploads`, {
          filename: job.name, totalSize: job.size, contentType: job.file.type || '',
        });
        job.uploadId = init.uploadId;
        job.chunkBytes = Math.min(init.chunkMaxBytes || PREFERRED_CHUNK_BYTES, PREFERRED_CHUNK_BYTES);
        job.sent = 0;
      }

      while (job.sent < job.size) {
        const start = job.sent;
        const end = Math.min(start + job.chunkBytes, job.size) - 1;
        const ack = await sendChunk(job, start, end, job.file.slice(start, end + 1));
        job.sent = typeof ack.received === 'number' ? ack.received : end + 1;
        job.pct = Math.round(job.sent / job.size * 100);
        updateRow(job);
      }

      const done = await sendJson(`/api/drop/${encodeURIComponent(token)}/uploads/${job.uploadId}/finalize`, {});
      job.uploadId = null;
      job.status = 'done';
      job.pct = 100;
      updateRow(job);
      onUploaded(done);
    } catch (err) {
      if (err.status === 404) { job.uploadId = null; job.sent = 0; job.pct = 0; }
      job.status = 'error';
      job.error = err.message || 'Upload failed';
      updateRow(job);
    }
  }

  function sendJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(parseResponse);
  }

  function sendChunk(job, start, end, blob) {
    return fetch(`/api/drop/${encodeURIComponent(token)}/uploads/${job.uploadId}/chunk`, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${start}-${end}/${job.size}`,
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    }).then(parseResponse);
  }

  async function parseResponse(res) {
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  function onUploaded(res) {
    if (res && res.item) {
      galleryData.items = galleryData.items || [];
      galleryData.items.push(res.item);
      version = res.version || version;
      renderVideoList();
      toast('Added');
    }
  }

  function toast(msg) {
    let el = document.getElementById('drop-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drop-toast';
      el.className = 'drop-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---- Live poll ##
  //
  // Someone else's upload should appear here too. Poll the cheap version
  // endpoint while the tab is visible and pull the full list when it changes.

  async function poll() {
    if (!galleryData || document.hidden || lightbox.style.display !== 'none') return;
    try {
      const res = await fetch(`/api/drop/${encodeURIComponent(token)}/version`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.version && version && body.version !== version) {
        const full = await fetch(`/api/drop/${encodeURIComponent(token)}`);
        if (full.ok) {
          const data = await full.json();
          if (!data.locked) {
            const scrollY = window.scrollY;
            render(data);
            window.scrollTo(0, scrollY);
          }
        }
      }
    } catch (_) { /* a poll failure is not worth surfacing */ }
  }
  setInterval(poll, 20000);

  load();
});
