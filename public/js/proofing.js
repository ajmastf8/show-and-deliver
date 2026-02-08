document.addEventListener('DOMContentLoaded', () => {
  const token = window.location.pathname.split('/').pop();

  const loadingView = document.getElementById('loading-view');
  const errorView = document.getElementById('error-view');
  const galleryView = document.getElementById('gallery-view');
  const galleryName = document.getElementById('gallery-name');
  const videoListEl = document.getElementById('video-list');
  const downloadAllBtn = document.getElementById('download-all-btn');
  // Lightbox send review
  const lightboxSendReview = document.getElementById('lightbox-send-review');
  const lightboxSendBtn = document.getElementById('lightbox-send-btn');
  const lightboxSendStatus = document.getElementById('lightbox-send-status');
  // Name modal
  const nameModal = document.getElementById('name-modal');
  const nameForm = document.getElementById('name-form');
  const viewerNameInput = document.getElementById('viewer-name');
  const viewerDisplayName = document.getElementById('viewer-display-name');

  let viewerName = localStorage.getItem('proofing-name') || '';

  // Lightbox
  const lightbox = document.getElementById('lightbox');
  const lightboxVideo = document.getElementById('lightbox-video');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxDownloadBtn = document.getElementById('lightbox-download-btn');
  const lightboxComments = document.getElementById('lightbox-comments');
  const commentForm = document.getElementById('comment-form');
  const commentText = document.getElementById('comment-text');
  const commentTimeDisplay = document.getElementById('comment-time-display');

  // Password
  const passwordView = document.getElementById('password-view');
  const passwordForm = document.getElementById('password-form');
  const passwordError = document.getElementById('password-error');
  const passwordGalleryName = document.getElementById('password-gallery-name');

  let galleryData = null;
  let currentVideoId = null;
  let allComments = [];

  // Name modal: show if no saved name, otherwise set display name
  if (viewerName) {
    viewerDisplayName.textContent = viewerName;
  }

  function showNameModal() {
    viewerNameInput.value = viewerName;
    nameModal.style.display = 'flex';
    setTimeout(() => viewerNameInput.focus(), 50);
  }

  nameForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = viewerNameInput.value.trim();
    if (!name) return;
    viewerName = name;
    localStorage.setItem('proofing-name', name);
    viewerDisplayName.textContent = name;
    nameModal.style.display = 'none';
  });

  // Click name badge to change name
  viewerDisplayName.addEventListener('click', showNameModal);

  // ============ Load Gallery ============

  async function loadGallery() {
    try {
      const res = await fetch(`/api/proofing/${token}`);
      if (res.status === 404) {
        showError('Gallery Not Found', 'This gallery may have been removed or the link is incorrect.');
        return;
      }
      if (res.status === 410) {
        showError('Gallery Expired', 'This gallery is no longer available. Please contact the photographer for access.');
        return;
      }
      if (!res.ok) {
        showError('Error', 'Something went wrong loading this gallery.');
        return;
      }

      const data = await res.json();

      // Password protected?
      if (data.passwordRequired) {
        loadingView.style.display = 'none';
        passwordView.style.display = 'flex';
        passwordGalleryName.textContent = data.galleryName;
        document.title = data.galleryName + ' — AJ Mast';
        return;
      }

      galleryData = data;
      allComments = galleryData.comments || [];
      renderGallery();
    } catch (err) {
      showError('Error', 'Could not connect to the server.');
    }
  }

  // ============ Password Unlock ============

  passwordForm.addEventListener('submit', async e => {
    e.preventDefault();
    passwordError.textContent = '';
    const password = document.getElementById('gallery-password').value;

    const res = await fetch(`/api/proofing/${token}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (res.status === 401) {
      passwordError.textContent = 'Incorrect password';
      return;
    }

    if (!res.ok) {
      passwordError.textContent = 'Something went wrong';
      return;
    }

    galleryData = await res.json();
    allComments = galleryData.comments || [];
    passwordView.style.display = 'none';
    renderGallery();
  });

  function showError(title, message) {
    loadingView.style.display = 'none';
    errorView.style.display = 'flex';
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
  }

  function renderGallery() {
    loadingView.style.display = 'none';
    galleryView.style.display = '';

    galleryName.textContent = galleryData.gallery.name;
    document.title = galleryData.gallery.name + ' — AJ Mast';

    if (galleryData.gallery.downloadsEnabled) {
      downloadAllBtn.style.display = '';
    }

    renderVideoList();

    // Show name modal if no saved name
    if (!viewerName) {
      showNameModal();
    }
  }

  function renderVideoList() {
    videoListEl.innerHTML = '';
    const videos = galleryData.videos;

    videos.forEach(item => {
      if (item.type === 'header') {
        const h = document.createElement('h2');
        h.className = 'proofing-section-header';
        h.textContent = item.text;
        videoListEl.appendChild(h);
        return;
      }

      const commentCount = allComments.filter(c => c.videoId === item.id).length;

      const card = document.createElement('div');
      card.className = 'proofing-video-card';
      card.dataset.id = item.id;

      const thumbSrc = item.thumbnail
        ? '/thumbnails/' + encodeURIComponent(item.thumbnail)
        : '';

      const commentLabel = commentCount > 0
        ? `<span class="proofing-card-comments">${commentCount} comment${commentCount !== 1 ? 's' : ''}</span>`
        : '';

      card.innerHTML = `
        <div class="proofing-thumb-wrapper">
          ${thumbSrc
            ? `<img src="${thumbSrc}" alt="${escapeHtml(item.title)}" loading="lazy">`
            : `<video src="/uploads/${encodeURIComponent(item.filename)}" muted preload="metadata"></video>`
          }
        </div>
        <div class="proofing-card-info">
          <span class="proofing-card-title">${escapeHtml(item.title)}</span>
          ${commentLabel}
        </div>
      `;

      card.addEventListener('click', () => openLightbox(item.id));
      videoListEl.appendChild(card);
    });
  }

  // ============ Lightbox ============

  function openLightbox(videoId) {
    const video = galleryData.videos.find(v => v.id === videoId);
    if (!video) return;

    currentVideoId = videoId;
    lightboxVideo.src = '/uploads/' + encodeURIComponent(video.filename);
    lightboxTitle.textContent = video.title;
    lightbox.style.display = '';
    document.body.style.overflow = 'hidden';

    if (galleryData.gallery.downloadsEnabled) {
      lightboxDownloadBtn.style.display = '';
      lightboxDownloadBtn.onclick = () => {
        window.location.href = `/api/proofing/${token}/download/${videoId}`;
      };
    } else {
      lightboxDownloadBtn.style.display = 'none';
    }

    // Reset send status
    lightboxSendStatus.textContent = '';
    lightboxSendStatus.className = 'lightbox-send-status';

    renderLightboxComments();
  }

  function closeLightbox() {
    lightbox.style.display = 'none';
    lightboxVideo.pause();
    lightboxVideo.src = '';
    currentVideoId = null;
    document.body.style.overflow = '';
  }

  document.querySelector('.lightbox-close-btn').addEventListener('click', closeLightbox);
  document.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lightbox.style.display !== 'none') {
      closeLightbox();
    }
  });

  function renderLightboxComments() {
    const videoComments = allComments
      .filter(c => c.videoId === currentVideoId)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!videoComments.length) {
      lightboxComments.innerHTML = '<div class="lb-no-comments">No comments yet. Be the first!</div>';
      lightboxSendReview.style.display = 'none';
      return;
    }

    lightboxComments.innerHTML = videoComments.map(c => `
      <div class="lb-comment">
        <div class="lb-comment-header">
          <span class="lb-comment-name">${escapeHtml(c.name)}</span>
          <span class="lb-comment-time" data-time="${c.timestamp}">@ ${formatTime(c.timestamp)}</span>
        </div>
        <div class="lb-comment-text">${escapeHtml(c.text)}</div>
        <div class="lb-comment-date">${new Date(c.createdAt).toLocaleString()}</div>
      </div>
    `).join('');

    // Scroll to bottom
    lightboxComments.scrollTop = lightboxComments.scrollHeight;

    // Show send button if the current viewer has comments on this video
    const viewerHasComments = viewerName && videoComments.some(c => c.name === viewerName);
    lightboxSendReview.style.display = viewerHasComments ? 'flex' : 'none';
  }

  // Click on timestamp to seek
  lightboxComments.addEventListener('click', e => {
    const timeEl = e.target.closest('.lb-comment-time');
    if (!timeEl) return;
    const time = parseFloat(timeEl.dataset.time);
    if (!isNaN(time)) {
      lightboxVideo.currentTime = time;
      lightboxVideo.play();
    }
  });

  // Update comment timestamp display
  lightboxVideo.addEventListener('timeupdate', () => {
    commentTimeDisplay.textContent = formatTime(lightboxVideo.currentTime);
  });

  // ============ Post Comment ============

  commentForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!viewerName) {
      showNameModal();
      return;
    }
    const name = viewerName;

    const text = commentText.value.trim();
    if (!text) return;

    const timestamp = lightboxVideo.currentTime || 0;

    const res = await fetch(`/api/proofing/${token}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: currentVideoId,
        name,
        text,
        timestamp
      })
    });

    if (res.ok) {
      const comment = await res.json();
      allComments.push(comment);
      commentText.value = '';
      renderLightboxComments();
      renderVideoList(); // Update comment counts
    } else {
      alert('Failed to post comment.');
    }
  });

  // ============ Finish Review & Send Comments ============

  async function sendReview(btn, statusEl, originalText) {
    if (!viewerName) {
      showNameModal();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    statusEl.textContent = '';
    statusEl.className = statusEl.className.replace(/ (success|error)/g, '');

    try {
      const res = await fetch(`/api/proofing/${token}/send-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerName: viewerName, videoId: currentVideoId })
      });

      if (res.ok) {
        statusEl.textContent = 'Comments sent! Thank you.';
        statusEl.className += ' success';
      } else {
        const data = await res.json().catch(() => ({}));
        statusEl.textContent = data.error || 'Failed to send.';
        statusEl.className += ' error';
      }
    } catch (err) {
      statusEl.textContent = 'Network error. Try again.';
      statusEl.className += ' error';
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // Lightbox send button (per-video comment panel)
  lightboxSendBtn.addEventListener('click', () => {
    sendReview(lightboxSendBtn, lightboxSendStatus, 'Finish & Send Comments');
  });

  // ============ Download All ============

  downloadAllBtn.addEventListener('click', () => {
    window.location.href = `/api/proofing/${token}/download-all`;
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
  loadGallery();
});
