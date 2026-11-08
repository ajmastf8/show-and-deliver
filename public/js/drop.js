// Drop page: a shared gallery visitors can add to.
//
// One URL, one shared password, and a visitor's email captured at unlock (used
// only to credit what they upload). The page shows the current grid and an
// uploader; uploads ride the same chunked contract the admin uses, so a big
// video isn't capped by the host's post_max_size.
document.addEventListener('DOMContentLoaded', () => {
  const token = window.location.pathname.split('/').pop();

  const loadingView = document.getElementById('loading-view');
  const errorView = document.getElementById('error-view');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');
  const passwordView = document.getElementById('password-view');
  const passwordForm = document.getElementById('password-form');
  const passwordDropName = document.getElementById('password-drop-name');
  const emailInput = document.getElementById('drop-email');
  const passwordInput = document.getElementById('drop-password');
  const passwordError = document.getElementById('password-error');
  const dropView = document.getElementById('drop-view');
  const dropName = document.getElementById('drop-name');
  const dropSub = document.getElementById('drop-sub');
  const dropWhoEmail = document.getElementById('drop-who-email');
  const dropZone = document.getElementById('drop-zone');
  const dropFile = document.getElementById('drop-file');
  const dzHint = document.getElementById('dz-hint');
  const queueEl = document.getElementById('drop-queue');
  const gridEl = document.getElementById('drop-grid');
  const emptyEl = document.getElementById('drop-empty');
  const countEl = document.getElementById('drop-count');
  const refreshBtn = document.getElementById('drop-refresh');

  const lightbox = document.getElementById('lightbox');
  const lbVideo = document.getElementById('lightbox-video');
  const lbPhoto = document.getElementById('lightbox-photo');
  const lbTitle = document.getElementById('lightbox-title');
  const lbUploader = document.getElementById('lightbox-uploader');
  const lbSpinner = document.getElementById('lightbox-spinner');
  const lbPrev = document.querySelector('.lightbox-prev');
  const lbNext = document.querySelector('.lightbox-next');
  const lbClose = document.querySelector('.lightbox-close-btn');
  const PREFERRED_CHUNK_BYTES = 8 * 1024 * 1024;

  let data = null;      // the last payload from GET /api/drop/{token}
  let version = null;   // the server's version marker, to know when to refresh
  let lbIndex = -1;     // which item the lightbox is showing

  const photoMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function showError(title, msg) {
    loadingView.style.display = 'none';
    passwordView.style.display = 'none';
    dropView.style.display = 'none';
    errorTitle.textContent = title;
    errorMessage.textContent = msg;
    errorView.style.display = 'flex';
  }

  function previewUrl(item, kind) {
    return kind === 'thumb'
      ? '/thumbnails/' + encodeURIComponent(item.thumbnail)
      : '/proxies/' + encodeURIComponent(item.proxy);
  }

  // --- Loading and unlocking ------------------------------------------------

  async function load() {
    let res, body;
    try {
      res = await fetch(`/api/drop/${encodeURIComponent(token)}`);
      body = await res.json().catch(() => ({}));
    } catch (_) {
      showError('Drop unavailable', 'Could not reach the server. Check your connection and try again.');
      return;
    }
    if (!res.ok) {
      showError('Drop Not Found', body.error || 'This drop may have been closed or the link is incorrect.');
      return;
    }
    if (body.locked) {
      showPassword(body.galleryName);
      return;
    }
    render(body);
  }

  function showPassword(name) {
    loadingView.style.display = 'none';
    errorView.style.display = 'none';
    dropView.style.display = 'none';
    passwordDropName.textContent = name || '';
    passwordView.style.display = 'flex';
    // Remember the last email used on this browser so returning is one field less.
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
      if (!res.ok) { passwordError.textContent = body.error || 'Could not unlock the drop'; return; }
      localStorage.setItem('drop-email:' + token, email);
      passwordView.style.display = 'none';
      render(body);
    } catch (_) {
      passwordError.textContent = 'Connection problem. Try again.';
    } finally {
      btn.disabled = false;
    }
  });

  // --- Rendering the grid ---------------------------------------------------

  function render(body) {
    data = body;
    version = body.gallery.version;
    loadingView.style.display = 'none';
    passwordView.style.display = 'none';
    errorView.style.display = 'none';
    dropView.style.display = 'block';

    dropName.textContent = body.gallery.name;
    dropWhoEmail.textContent = body.email || '';
    document.title = body.gallery.name || 'Drop';

    // Tell the visitor what they may add, and keep the file input honest.
    const accepts = [];
    if (body.gallery.allowPhotos) accepts.push(...photoMimes, '.jpg', '.jpeg', '.png', '.webp', '.gif');
    if (body.gallery.allowVideos) accepts.push('video/mp4', 'video/webm', 'video/quicktime', '.mp4', '.webm', '.mov', '.m4v');
    dropFile.setAttribute('accept', accepts.join(','));
    const parts = [];
    if (body.gallery.allowPhotos) parts.push('photos');
    if (body.gallery.allowVideos) parts.push('videos');
    dzHint.textContent = parts.length
      ? `Add ${parts.join(' or ')} · up to ${body.gallery.maxFileMb} MB each · large files upload in chunks`
      : 'This drop is not accepting uploads right now.';

    renderGrid();
  }

  function renderGrid() {
    const items = data.items || [];
    countEl.textContent = items.length === 1 ? '1 item' : `${items.length} items`;
    emptyEl.hidden = items.length > 0;
    gridEl.replaceChildren();

    items.forEach((item, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'drop-tile';
      tile.addEventListener('click', () => openLightbox(i));

      if (item.type === 'photo' && item.thumbnail) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = previewUrl(item, 'thumb');
        img.alt = item.title || '';
        tile.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'drop-tile-video';
        ph.innerHTML = '<span class="drop-play">&#9658;</span>';
        if (item.type === 'video' && item.thumbnail) {
          ph.style.backgroundImage = `url("${previewUrl(item, 'thumb')}")`;
        }
        tile.appendChild(ph);
      }
      if (item.uploader) {
        const who = document.createElement('span');
        who.className = 'drop-tile-who';
        who.textContent = item.uploader;
        tile.appendChild(who);
      }
      gridEl.appendChild(tile);
    });
  }

  // --- Lightbox -------------------------------------------------------------

  function openLightbox(i) {
    const items = data.items || [];
    if (i < 0 || i >= items.length) return;
    lbIndex = i;
    const item = items[i];
    lbTitle.textContent = item.title || '';
    lbUploader.textContent = item.uploader ? 'Added by ' + item.uploader : '';
    lbVideo.pause();
    lbVideo.style.display = 'none';
    lbPhoto.style.display = 'none';
    lbSpinner.style.display = 'block';

    if (item.type === 'video') {
      lbVideo.src = '/uploads/' + encodeURIComponent(item.filename || '');
      lbVideo.poster = item.thumbnail ? previewUrl(item, 'thumb') : '';
      lbVideo.style.display = 'block';
      lbVideo.load();
      lbVideo.play().catch(() => {});
      lbSpinner.style.display = 'none';
    } else if (item.proxy) {
      lbPhoto.src = '/proxies/' + encodeURIComponent(item.proxy);
      lbPhoto.style.display = 'block';
      lbPhoto.onload = () => { lbSpinner.style.display = 'none'; };
    } else if (item.thumbnail) {
      lbPhoto.src = '/thumbnails/' + encodeURIComponent(item.thumbnail);
      lbPhoto.style.display = 'block';
      lbPhoto.onload = () => { lbSpinner.style.display = 'none'; };
    }
    lightbox.style.display = 'flex';
    refreshBtn.hidden = true;
  }

  function closeLightbox() {
    lightbox.style.display = 'none';
    lbVideo.pause();
    lbVideo.removeAttribute('src');
    lbVideo.load();
    lbIndex = -1;
  }

  function step(delta) {
    const items = data.items || [];
    if (!items.length) return;
    openLightbox((lbIndex + delta + items.length) % items.length);
  }

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

  // --- Uploading ------------------------------------------------------------

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
    const allowedList = (data && data.gallery) || {};
    if (file.type.startsWith('image/') && !allowedList.allowPhotos) return false;
    if (file.type.startsWith('video/') && !allowedList.allowVideos) return false;
    return true;
  }

  function enqueue(files) {
    if (!data) return;
    const usable = files.filter(f => f && f.size > 0);
    if (!usable.length) return;
    for (const file of usable) {
      if (!allowed(file)) {
        toast('That file type is not allowed in this drop.');
        continue;
      }
      if (file.size > data.gallery.maxFileMb * 1024 * 1024) {
        toast(`"${file.name}" is over the ${data.gallery.maxFileMb} MB limit.`);
        continue;
      }
      const job = { file, name: file.name, size: file.size, status: 'queued', pct: 0, sent: 0, uploadId: null };
      job.row = queueRow(job);
      queueEl.appendChild(job.row.el);
      pump(job);
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

  function pump(job) {
    if (job.status === 'done' || job.status === 'uploading') return;
    job.status = 'uploading';
    job.error = '';
    updateRow(job);
    startUpload(job);
  }

  // Chunked upload, same contract as the admin: initiate, PUT contiguous
  // chunks, finalize. A dropped connection leaves `sent` where the server last
  // acknowledged, so Retry resumes rather than restarting.
  async function startUpload(job) {
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
        const chunk = job.file.slice(start, end + 1);
        const ack = await sendChunk(job, start, end, chunk);
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

  // Slot a finished upload into the grid without a full refetch, and mark the
  // page as having something new so the poll doesn't double-insert it.
  function onUploaded(res) {
    if (res && res.item) {
      data.items = data.items || [];
      data.items.push(res.item);
      version = res.version || version;
      renderGrid();
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

  // --- Live refresh ---------------------------------------------------------
  //
  // Someone else's upload should appear here too. Poll the cheap version
  // endpoint every 20s while the tab is visible and offer a refresh when it
  // changes — the same pattern the proofing page uses.

  async function poll() {
    if (!data || document.hidden) return;
    try {
      const res = await fetch(`/api/drop/${encodeURIComponent(token)}/version`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.version && version && body.version !== version) refreshBtn.hidden = false;
    } catch (_) { /* a poll failure is not worth surfacing */ }
  }
  setInterval(poll, 20000);

  refreshBtn.addEventListener('click', async () => {
    const res = await fetch(`/api/drop/${encodeURIComponent(token)}`);
    if (res.ok) {
      const body = await res.json();
      if (!body.locked) { render(body); refreshBtn.hidden = true; }
    }
  });

  load();
});
