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
  const lightboxPhoto = document.getElementById('lightbox-photo');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxDownloadBtn = document.getElementById('lightbox-download-btn');
  const lightboxTranscriptsBtn = document.getElementById('lightbox-transcripts-btn');
  const lightboxDescription = document.getElementById('lightbox-description');
  const lightboxComments = document.getElementById('lightbox-comments');
  const commentForm = document.getElementById('comment-form');
  const commentText = document.getElementById('comment-text');
  const commentTimeDisplay = document.getElementById('comment-time-display');
  const commentTimestampRow = document.querySelector('.comment-timestamp-display');
  const lightboxPrev = document.querySelector('.lightbox-prev');
  const lightboxNext = document.querySelector('.lightbox-next');

  // Password
  const passwordView = document.getElementById('password-view');
  const passwordForm = document.getElementById('password-form');
  const passwordError = document.getElementById('password-error');
  const passwordGalleryName = document.getElementById('password-gallery-name');

  let galleryData = null;
  let currentVideoId = null;
  let allComments = [];

  // Favorites
  const favCounter = document.getElementById('fav-counter');
  const favSendBtn = document.getElementById('fav-send-btn');
  const lightboxFavBtn = document.getElementById('lightbox-fav-btn');
  const lightboxDownloadWebBtn = document.getElementById('lightbox-download-web-btn');
  const favModal = document.getElementById('fav-modal');
  const favForm = document.getElementById('fav-form');
  const favNameInput = document.getElementById('fav-name');
  const favNoteInput = document.getElementById('fav-note');
  const favError = document.getElementById('fav-error');
  const favSubmit = document.getElementById('fav-submit');
  let favs = [];            // ids this browser has picked, in the order picked
  let favSubmitted = null;  // ids as last sent, or null if never sent
  let favSaving = Promise.resolve();

  // A random id this browser keeps, so picks survive a reload without an account.
  function favClientId() {
    const key = 'proofing-client-' + token;
    let id = localStorage.getItem(key);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(18);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      id = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
      localStorage.setItem(key, id);
    }
    return id;
  }
  const clientId = favClientId();
  const favsOn = () => !!(galleryData && galleryData.gallery.selection && galleryData.gallery.selection.enabled);
  const favLimit = () => (galleryData && galleryData.gallery.selection && galleryData.gallery.selection.limit) || 0;

  // With a watermark on, photo previews come from a route that stamps them.
  function previewUrl(item, kind) {
    if (galleryData.gallery.watermark && item.type === 'photo') {
      return `/api/client/galleries/${token}/preview/${encodeURIComponent(item.id)}/${kind}`;
    }
    return kind === 'thumb'
      ? '/thumbnails/' + encodeURIComponent(item.thumbnail)
      : '/proxies/' + encodeURIComponent(item.proxy);
  }

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
      const res = await fetch(`/api/client/galleries/${token}`);
      // An old portfolio link whose gallery moved into the folders.
      const peek = res.clone();
      try {
        const early = await peek.json();
        if (early && early.redirect) { location.replace(early.redirect); return; }
      } catch (_) {}
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
        document.title = data.galleryName + ' — ' + (window.__siteConfig?.siteName || 'Gallery');
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

    const res = await fetch(`/api/client/galleries/${token}/unlock`, {
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
    document.title = galleryData.gallery.name + ' — ' + (window.__siteConfig?.siteName || 'Gallery');

    if (galleryData.gallery.downloadsEnabled) {
      downloadAllBtn.style.display = '';
    }

    // Hide the whole comments column if commenting is disabled. Hiding just the
    // form left an empty panel inviting comments nobody can post — which is how
    // every portfolio gallery renders, since those never enable commenting.
    if (!galleryData.gallery.commentingEnabled) {
      commentForm.style.display = 'none';
      document.querySelector('.lightbox-comments-side').style.display = 'none';
    }

    renderVideoList();
    initFavorites();

    // Deep link: open specific video if hash is #video-{id}
    const hashMatch = window.location.hash.match(/^#video-(.+)$/);
    if (hashMatch) {
      const vid = galleryData.items.find(v => v.id === hashMatch[1]);
      if (vid) openLightbox(vid.id);
    }

    // Show name modal if commenting is enabled and no saved name
    if (galleryData.gallery.commentingEnabled && !viewerName) {
      showNameModal();
    }

    startLiveSync();
  }

  // ============ Live Updates (FTP watch folder) ============
  //
  // A gallery with a watch folder takes in whatever the photographer uploads by
  // FTP. The import only runs while someone is asking for it, so an open page
  // asks: once on load (which also catches anything that arrived while nobody was
  // looking), then every 30 seconds while the tab is visible. The server answers
  // with a version marker; when it changes we offer a refresh instead of
  // re-rendering under someone who may be mid-lightbox.

  let liveTimer = null;
  let liveVersion = null;
  let liveBusy = false;
  const LIVE_INTERVAL_MS = 30000;

  function startLiveSync() {
    if (liveTimer || !galleryData || !galleryData.gallery.live) return;
    liveVersion = galleryData.gallery.version;
    pollLiveSync();
    liveTimer = setInterval(() => { if (!document.hidden) pollLiveSync(); }, LIVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLiveSync(); });
  }

  async function pollLiveSync() {
    if (liveBusy) return;
    liveBusy = true;
    try {
      const res = await fetch(`/api/client/galleries/${token}/sync`, { method: 'POST' });
      if (!res.ok) return;
      const { version } = await res.json();
      if (version && version !== liveVersion) {
        liveVersion = version;
        showUpdateBanner();
      }
    } catch (_) {
      // Offline or a blip; the next tick tries again.
    } finally {
      liveBusy = false;
    }
  }

  function showUpdateBanner() {
    let banner = document.getElementById('live-update-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'live-update-banner';
      banner.className = 'live-update-banner';
      banner.innerHTML = '<span>Gallery updated</span><button type="button" class="live-update-btn">Refresh</button>';
      banner.querySelector('button').addEventListener('click', async () => {
        const res = await fetch(`/api/client/galleries/${token}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.passwordRequired) return;
        galleryData = data;
        allComments = data.comments || [];
        liveVersion = data.gallery.version;
        renderVideoList();
        banner.remove();
      });
      document.body.appendChild(banner);
    }
  }

  function renderVideoList() {
    videoListEl.innerHTML = '';
    const videos = galleryData.items;

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

      const isPhoto = item.type === 'photo';
      const thumbSrc = item.thumbnail ? previewUrl(item, 'thumb') : '';

      const commentLabel = commentCount > 0
        ? `<span class="proofing-card-comments">${commentCount} comment${commentCount !== 1 ? 's' : ''}</span>`
        : '';

      // Format duration (videos only)
      let durationLabel = '';
      if (!isPhoto && item.duration) {
        const mins = Math.floor(item.duration / 60);
        const secs = Math.floor(item.duration % 60).toString().padStart(2, '0');
        durationLabel = `<span class="proofing-card-duration">${mins}:${secs}</span>`;
      }

      // Format resolution
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
          ${favsOn() ? `<button type="button" class="fav-heart${favs.includes(item.id) ? ' on' : ''}" data-fav="${escapeHtml(item.id)}" aria-label="Favorite" aria-pressed="${favs.includes(item.id)}">${favs.includes(item.id) ? '&#9829;' : '&#9825;'}</button>` : ''}
          ${durationLabel ? `<span class="proofing-thumb-duration">${Math.floor(item.duration / 60)}:${Math.floor(item.duration % 60).toString().padStart(2, '0')}</span>` : ''}
        </div>
        ${item.title || resLabel || commentLabel ? `<div class="proofing-card-info">
          <span class="proofing-card-title">${escapeHtml(item.title)}</span>
          <div class="proofing-card-meta">${resLabel}${commentLabel}</div>
        </div>` : ''}
      `;

      const heart = card.querySelector('.fav-heart');
      if (heart) heart.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(item.id); });
      card.addEventListener('click', () => openLightbox(item.id));
      videoListEl.appendChild(card);
    });
  }

  // ============ Lightbox ============

  const lightboxSpinner = document.getElementById('lightbox-spinner');

  function showSpinner() { lightboxSpinner.classList.add('active'); }
  function hideSpinner() { lightboxSpinner.classList.remove('active'); }

  // Rebuild the <track> children for the lightbox video. Captions are
  // off by default — the browser's CC menu lets the viewer pick a language.
  function setCaptionTracks(video, captions) {
    video.querySelectorAll('track').forEach(t => t.remove());
    captionOverlay.replaceChildren();
    (captions || []).forEach(c => {
      if (!c.filename) return;
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.src = '/captions/' + encodeURIComponent(c.filename);
      track.srclang = c.lang || '';
      track.label = c.label || (c.lang || '').toUpperCase();
      video.appendChild(track);
    });
  }

  // Show spinner while browser is buffering mid-playback
  lightboxVideo.addEventListener('waiting', showSpinner);
  lightboxVideo.addEventListener('playing', hideSpinner);
  lightboxVideo.addEventListener('canplay', hideSpinner);

  // Native controls and native caption cues both anchor to the bottom of the
  // <video> box. layoutLightboxVideo makes that box taller than the picture so
  // the controls sit in a strip below it — which also drops the native cues into
  // that strip, out of sight, and browsers honor manual cue repositioning too
  // inconsistently to rely on. So we render captions ourselves into an overlay
  // pinned over the picture, and leave the native cues hidden in the strip.
  const VIDEO_CONTROL_BAR = 40;
  const captionOverlay = document.createElement('div');
  captionOverlay.className = 'lightbox-caption-overlay';
  lightboxVideo.parentElement.appendChild(captionOverlay);

  function isLightboxFullscreen() {
    return (document.fullscreenElement || document.webkitFullscreenElement) === lightboxVideo;
  }

  // Pin the overlay over the picture area (the element box minus the control
  // strip), matching the centered video's current on-screen rect.
  function layoutCaptionOverlay() {
    if (isLightboxFullscreen()) { captionOverlay.style.display = 'none'; return; }
    captionOverlay.style.display = '';
    const wrap = lightboxVideo.parentElement;
    const v = lightboxVideo.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    captionOverlay.style.left = (v.left - w.left) + 'px';
    captionOverlay.style.top = (v.top - w.top) + 'px';
    captionOverlay.style.width = v.width + 'px';
    captionOverlay.style.height = Math.max(0, v.height - VIDEO_CONTROL_BAR) + 'px';
  }

  // Mirror the active cues of whichever track the viewer enabled into the overlay.
  // In fullscreen the browser sizes the element itself and the native cues land
  // correctly at the screen bottom, so we keep our overlay empty there.
  function renderCaptions() {
    if (isLightboxFullscreen()) { captionOverlay.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    for (const tt of lightboxVideo.textTracks) {
      if (tt.mode !== 'showing' || !tt.activeCues) continue;
      for (const cue of tt.activeCues) {
        const line = document.createElement('div');
        line.className = 'lightbox-caption-line';
        line.appendChild(cue.getCueAsHTML());
        frag.appendChild(line);
      }
    }
    captionOverlay.replaceChildren(frag);
  }

  // Native video controls paint at the bottom of the element box. Size the
  // element to the picture height plus a strip for the control bar (with the
  // picture pinned to the top via object-position), so the controls sit
  // directly under the video instead of covering the bottom of the picture.
  function layoutLightboxVideo() {
    if (currentItemIsPhoto || !lightboxVideo.videoWidth) return;
    if (isLightboxFullscreen()) return;
    const wrap = lightboxVideo.parentElement;
    const scale = Math.min(
      wrap.clientWidth / lightboxVideo.videoWidth,
      (wrap.clientHeight - VIDEO_CONTROL_BAR) / lightboxVideo.videoHeight
    );
    lightboxVideo.style.width = (lightboxVideo.videoWidth * scale) + 'px';
    lightboxVideo.style.height = (lightboxVideo.videoHeight * scale + VIDEO_CONTROL_BAR) + 'px';
    layoutCaptionOverlay();
  }
  lightboxVideo.addEventListener('loadedmetadata', layoutLightboxVideo);
  window.addEventListener('resize', layoutLightboxVideo);
  lightboxVideo.addEventListener('timeupdate', renderCaptions);
  // Re-render when captions change or the viewer toggles a track on/off.
  lightboxVideo.textTracks.addEventListener('addtrack', e => {
    e.track.addEventListener('cuechange', renderCaptions);
  });
  lightboxVideo.textTracks.addEventListener('change', renderCaptions);
  // Clear the fixed size in fullscreen (the browser sizes the element itself),
  // then recompute when returning to the windowed lightbox.
  function onLightboxFullscreenChange() {
    if (isLightboxFullscreen()) {
      lightboxVideo.style.width = '';
      lightboxVideo.style.height = '';
    } else {
      layoutLightboxVideo();
    }
    layoutCaptionOverlay();
    renderCaptions();
  }
  document.addEventListener('fullscreenchange', onLightboxFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onLightboxFullscreenChange);

  // Build navigable items list (exclude headers and hidden)
  function getNavigableItems() {
    if (!galleryData) return [];
    return galleryData.items.filter(v => v.type === 'video' || v.type === 'photo');
  }

  function getCurrentItemIndex() {
    return getNavigableItems().findIndex(v => v.id === currentVideoId);
  }

  function navigateLightbox(direction) {
    const items = getNavigableItems();
    const idx = items.findIndex(v => v.id === currentVideoId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < items.length) {
      openLightbox(items[newIdx].id);
    }
  }

  function updateNavButtons() {
    const items = getNavigableItems();
    const idx = items.findIndex(v => v.id === currentVideoId);
    lightboxPrev.style.display = idx > 0 ? '' : 'none';
    lightboxNext.style.display = idx < items.length - 1 ? '' : 'none';
  }

  let currentItemIsPhoto = false;

  function openLightbox(videoId) {
    const item = galleryData.items.find(v => v.id === videoId);
    if (!item) return;

    currentVideoId = videoId;
    currentItemIsPhoto = item.type === 'photo';
    lightboxTitle.textContent = item.title;
    lightbox.style.display = '';
    document.body.style.overflow = 'hidden';

    if (currentItemIsPhoto) {
      // Show photo, hide video
      lightboxVideo.pause();
      lightboxVideo.src = '';
      lightboxVideo.style.display = 'none';
      lightboxPhoto.src = item.proxy
        ? previewUrl(item, 'proxy')
        : '/uploads/' + encodeURIComponent(item.filename || '');
      lightboxPhoto.style.display = '';
      hideSpinner();
      // Hide timestamp UI
      if (commentTimestampRow) commentTimestampRow.style.display = 'none';
    } else {
      // Show video, hide photo
      lightboxPhoto.style.display = 'none';
      lightboxPhoto.src = '';
      lightboxVideo.style.display = '';
      showSpinner();
      lightboxVideo.src = '/uploads/' + encodeURIComponent(item.filename || '');
      setCaptionTracks(lightboxVideo, item.captions);
      lightboxVideo.load();
      // Show timestamp UI
      if (commentTimestampRow) commentTimestampRow.style.display = '';
      // Play once enough data is buffered
      lightboxVideo.addEventListener('canplay', function onCanPlay() {
        lightboxVideo.removeEventListener('canplay', onCanPlay);
        lightboxVideo.play().catch(() => {});
      });
    }

    if (galleryData.gallery.downloadsEnabled) {
      // "Client chooses" offers both sizes for a photo; otherwise one button
      // and the server applies the gallery's setting.
      const both = galleryData.gallery.downloadMode === 'both' && currentItemIsPhoto && item.proxy;
      lightboxDownloadBtn.style.display = '';
      lightboxDownloadBtn.textContent = both ? 'Download original' : 'Download';
      lightboxDownloadBtn.onclick = () => {
        window.location.href = `/api/client/galleries/${token}/download/${videoId}`;
      };
      lightboxDownloadWebBtn.style.display = both ? '' : 'none';
      lightboxDownloadWebBtn.onclick = () => {
        window.location.href = `/api/client/galleries/${token}/download/${videoId}?size=web`;
      };
    } else {
      lightboxDownloadBtn.style.display = 'none';
      lightboxDownloadWebBtn.style.display = 'none';
    }
    updateLightboxFav();

    // Transcripts button: only for videos that actually have caption tracks,
    // and only when downloads are enabled for the gallery.
    if (galleryData.gallery.downloadsEnabled && !currentItemIsPhoto && item.captions && item.captions.length) {
      lightboxTranscriptsBtn.style.display = '';
      lightboxTranscriptsBtn.onclick = () => downloadTranscripts(item);
    } else {
      lightboxTranscriptsBtn.style.display = 'none';
    }

    // Caption box: portfolio galleries only. A client proofing gallery keeps the
    // lightbox it has always had, so the box stays hidden there even if an item
    // somehow carries a description.
    renderCaptionBox(
      lightboxDescription,
      galleryData.gallery.type === 'reels' ? item.description : ''
    );

    // Reset send status
    lightboxSendStatus.textContent = '';
    lightboxSendStatus.className = 'lightbox-send-status';

    updateNavButtons();
    renderLightboxComments();
  }

  function closeLightbox() {
    lightbox.style.display = 'none';
    lightboxVideo.pause();
    lightboxVideo.src = '';
    lightboxPhoto.src = '';
    lightboxPhoto.style.display = 'none';
    lightboxVideo.style.display = '';
    currentVideoId = null;
    currentItemIsPhoto = false;
    document.body.style.overflow = '';
  }

  document.querySelector('.lightbox-close-btn').addEventListener('click', closeLightbox);
  document.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);

  document.addEventListener('keydown', e => {
    if (lightbox.style.display === 'none') return;
    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      navigateLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      navigateLightbox(1);
    }
  });

  // Nav button clicks
  lightboxPrev.addEventListener('click', e => { e.stopPropagation(); navigateLightbox(-1); });
  lightboxNext.addEventListener('click', e => { e.stopPropagation(); navigateLightbox(1); });

  // Touch swipe support
  let touchStartX = 0;
  let touchStartY = 0;
  const lightboxContainer = document.querySelector('.lightbox-container');

  lightboxContainer.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  lightboxContainer.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Only count horizontal swipes (dx > dy and minimum distance)
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) navigateLightbox(-1); // swipe right = prev
      else navigateLightbox(1); // swipe left = next
    }
  }, { passive: true });

  function renderLightboxComments() {
    const videoComments = allComments
      .filter(c => c.videoId === currentVideoId)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!videoComments.length) {
      lightboxComments.innerHTML = '<div class="lb-no-comments">No comments yet. Be the first!</div>';
      lightboxSendReview.style.display = 'none';
      return;
    }

    lightboxComments.innerHTML = videoComments.map(c => {
      const showTimestamp = !currentItemIsPhoto && c.timestamp > 0;
      return `
        <div class="lb-comment">
          <div class="lb-comment-header">
            <span class="lb-comment-name">${escapeHtml(c.name)}</span>
            ${showTimestamp ? `<span class="lb-comment-time" data-time="${c.timestamp}">@ ${formatTime(c.timestamp)}</span>` : ''}
          </div>
          <div class="lb-comment-text">${escapeHtml(c.text)}</div>
          <div class="lb-comment-date">${new Date(c.createdAt).toLocaleString()}</div>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    lightboxComments.scrollTop = lightboxComments.scrollHeight;

    // Show send button if the current viewer has comments on this video
    const viewerHasComments = viewerName && videoComments.some(c => c.name === viewerName);
    lightboxSendReview.style.display = viewerHasComments ? 'flex' : 'none';
  }

  // Click on timestamp to seek (videos only)
  lightboxComments.addEventListener('click', e => {
    if (currentItemIsPhoto) return;
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

  // Enter key submits comment, Shift+Enter for newline
  commentText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commentForm.requestSubmit();
    }
  });

  commentForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!viewerName) {
      showNameModal();
      return;
    }
    const name = viewerName;

    const text = commentText.value.trim();
    if (!text) return;

    const timestamp = currentItemIsPhoto ? 0 : (lightboxVideo.currentTime || 0);

    const res = await fetch(`/api/client/galleries/${token}/comments`, {
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
      const res = await fetch(`/api/client/galleries/${token}/send-review`, {
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

  const downloadModal = document.getElementById('download-modal');
  const downloadModalTitle = document.getElementById('download-modal-title');
  const downloadModalMsg = document.getElementById('download-modal-msg');
  const downloadModalDetail = document.getElementById('download-modal-detail');
  const downloadProgressBar = document.getElementById('download-progress-bar');
  const downloadCancelBtn = document.getElementById('download-cancel-btn');

  let downloadAbort = null;
  let downloadActive = false;

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function openDownloadModal(title, msg) {
    downloadProgressBar.parentElement.style.display = '';
    downloadModalTitle.textContent = title;
    downloadModalMsg.textContent = msg;
    downloadModalDetail.textContent = '';
    downloadProgressBar.classList.remove('indeterminate');
    downloadProgressBar.style.width = '0%';
    downloadCancelBtn.style.display = '';
    downloadCancelBtn.disabled = false;
    downloadCancelBtn.textContent = 'Cancel';
    downloadModal.style.display = '';
  }

  // Per-file counters + the live stream of bytes. onBytes fires for every
  // chunk the reader hands us, so the byte total and progress-bar fill
  // advance smoothly even inside a single large video.
  let progressState = { done: 0, total: 0, bytes: 0 };
  function setProgressTotals(total) {
    progressState = { done: 0, total, bytes: 0 };
    renderProgress();
  }
  function onFileDone(done, total, bytes) {
    progressState.done = done;
    progressState.total = total;
    progressState.bytes = bytes;
    renderProgress();
  }
  function onChunkBytes(delta) {
    progressState.bytes += delta;
    renderProgress();
  }
  function renderProgress() {
    const { done, total, bytes } = progressState;
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    downloadProgressBar.style.width = pct.toFixed(1) + '%';
    downloadModalDetail.textContent =
      `${done} of ${total} files\u2002\u00b7\u2002${formatBytes(bytes)} downloaded`;
  }

  function hideDownloadModal() {
    downloadModal.style.display = 'none';
    downloadProgressBar.classList.remove('indeterminate');
    downloadProgressBar.style.width = '0%';
    downloadAbort = null;
    setDownloadActive(false);
  }

  // Block accidental tab-closes / navigation while a zip is in flight.
  function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
  function setDownloadActive(active) {
    downloadActive = active;
    downloadAllBtn.disabled = active;
    if (active) {
      window.addEventListener('beforeunload', onBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
  }

  downloadCancelBtn.addEventListener('click', () => {
    if (downloadAbort) downloadAbort.abort();
    hideDownloadModal();
  });

  function sanitizeName(s, fallback) {
    const cleaned = (s || '').replace(/[^a-zA-Z0-9 .\-()]/g, '').trim();
    return cleaned || fallback;
  }

  function dedupeName(name, used) {
    if (!used.has(name)) { used.add(name); return name; }
    const dot = name.lastIndexOf('.');
    const base = dot >= 0 ? name.slice(0, dot) : name;
    const ext = dot >= 0 ? name.slice(dot) : '';
    let n = 2;
    while (used.has(base + ' (' + n + ')' + ext)) n++;
    const picked = base + ' (' + n + ')' + ext;
    used.add(picked);
    return picked;
  }

  // Download every caption (.vtt) track for one video, as-is, bundled into a zip.
  async function downloadTranscripts(item) {
    const captions = (item.captions || []).filter(c => c.filename);
    if (!captions.length) return;

    const titleBase = sanitizeName(item.title, sanitizeName((item.filename || '').replace(/\.[^.]+$/, ''), 'transcript'));

    const used = new Set();
    const entries = captions.map(c => ({
      name: dedupeName(`${titleBase}.${c.lang}.vtt`, used),
      url: '/captions/' + encodeURIComponent(c.filename),
      mtime: Date.now(),
    }));

    lightboxTranscriptsBtn.disabled = true;
    try {
      const chunks = [];
      await ZipWriter.zipToWriter({
        entries,
        write: async (buf) => { chunks.push(buf); },
        concurrency: 4,
      });
      const blob = new Blob(chunks, { type: 'application/zip' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${titleBase} transcripts.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (e) {
      alert('Transcript download failed: ' + (e.message || e));
    } finally {
      lightboxTranscriptsBtn.disabled = false;
    }
  }

  // "Download all" hands the work to the server, the same way a delivery link
  // does: the zip is streamed with checksums from the server's cache and the
  // bytes copied straight from disk. Assembling it in the browser meant the
  // client's CPU checksummed every byte, and on Safari, Firefox and
  // Chrome-on-macOS the whole archive was held in memory before saving — which
  // fell over on large galleries.
  //
  // The server caps how large a generated response can be, so a big gallery
  // arrives as numbered parts. One part is a plain download; several get a small
  // chooser so it's clear what to click.
  downloadAllBtn.addEventListener('click', () => {
    if (downloadActive) return;
    if (!galleryData || !galleryData.items) return;

    const mediaItems = galleryData.items.filter(v => v.type === 'photo' || v.type === 'video');
    if (mediaItems.length === 0) return;

    // "Client chooses": ask which size before preparing anything. Videos are
    // always originals, so a gallery of only videos has nothing to choose.
    if (galleryData.gallery.downloadMode === 'both' && mediaItems.some(v => v.type === 'photo' && v.proxy)) {
      setDownloadActive(true);
      openDownloadModal('Choose a size', 'Originals are the full-resolution files. Web size is a 2048px JPEG of each photo, much smaller; videos are always the original.');
      downloadProgressBar.parentElement.style.display = 'none';
      downloadModalDetail.innerHTML =
        '<button class="dl-part-btn" data-dl-size="original">Original files</button>' +
        '<button class="dl-part-btn" data-dl-size="web">Web size photos</button>';
      downloadModalDetail.querySelectorAll('[data-dl-size]').forEach(btn => {
        btn.addEventListener('click', () => runDownloadAll(btn.getAttribute('data-dl-size')));
      });
      return;
    }
    setDownloadActive(true);
    runDownloadAll('');
  });

  async function runDownloadAll(size) {
    const qs = size === 'web' ? '?size=web' : '';
    // Fire-and-forget: record that a "Download All" run started.
    fetch(`/api/client/galleries/${token}/events/download-all${qs}`, { method: 'POST', keepalive: true })
      .catch(() => {});

    openDownloadModal('Preparing your download', 'Getting your files ready…');
    downloadProgressBar.classList.add('indeterminate');
    downloadCancelBtn.style.display = 'none';

    let plan;
    try {
      const res = await fetch(`/api/client/galleries/${token}/zip${qs}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      plan = await res.json();
    } catch (e) {
      hideDownloadModal();
      alert('Could not prepare the download: ' + (e.message || e));
      return;
    }

    const parts = plan.parts || [];
    if (!parts.length) {
      hideDownloadModal();
      alert('There are no files to download.');
      return;
    }

    if (parts.length === 1) {
      startPartDownload(parts[0].url);
      downloadModalTitle.textContent = 'Download started';
      downloadModalMsg.textContent =
        `${formatBytes(parts[0].size)} — your browser is saving it now.`;
      downloadProgressBar.classList.remove('indeterminate');
      downloadProgressBar.style.width = '100%';
      setTimeout(hideDownloadModal, 3000);
      return;
    }

    // Several parts: let the client take them one at a time rather than firing
    // concurrent multi-GB downloads at their connection.
    downloadProgressBar.classList.remove('indeterminate');
    downloadProgressBar.style.width = '100%';
    downloadModalTitle.textContent = `Your download is in ${parts.length} parts`;
    downloadModalMsg.textContent =
      'The gallery is too large for a single file. Save each part — they unzip independently.';
    downloadModalDetail.innerHTML = parts.map(p => (
      `<button class="dl-part-btn" data-dl-url="${escapeHtml(p.url)}">` +
      `${escapeHtml(p.label)} · ${formatBytes(p.size)}</button>`
    )).join('');
    downloadModalDetail.querySelectorAll('[data-dl-url]').forEach(btn => {
      btn.addEventListener('click', () => {
        startPartDownload(btn.getAttribute('data-dl-url'));
        btn.classList.add('started');
        btn.textContent = btn.textContent + ' ✓';
      });
    });
    downloadCancelBtn.style.display = '';
    downloadCancelBtn.textContent = 'Done';
    downloadCancelBtn.disabled = false;
  }

  // Navigating an iframe rather than the tab keeps the page (and its download
  // buttons) alive while the browser saves the file.
  function startPartDownload(url) {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = url;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 120000);
  }


  // ============ Favorites ============

  async function initFavorites() {
    if (!favsOn()) { favCounter.hidden = true; favSendBtn.hidden = true; return; }
    try {
      const res = await fetch(`/api/client/galleries/${token}/selection?clientId=${encodeURIComponent(clientId)}`);
      if (res.ok) {
        const data = await res.json();
        favs = data.ids || [];
        favSubmitted = data.submittedAt ? (data.submittedIds || []) : null;
        if (data.name && !viewerName) favNameInput.value = data.name;
      }
    } catch (_) { /* start empty; picks still save as they are made */ }
    renderVideoList();
    updateFavUI();
  }

  function updateFavUI() {
    if (!favsOn()) return;
    const limit = favLimit();
    favCounter.hidden = false;
    favCounter.textContent = limit ? `${favs.length} of ${limit} picked` : `${favs.length} picked`;
    favSendBtn.hidden = false;
    const same = favSubmitted && favSubmitted.length === favs.length && favs.every(id => favSubmitted.includes(id));
    favSendBtn.disabled = favs.length === 0;
    favSendBtn.textContent = same ? 'Picks sent' : favSubmitted ? 'Send updated picks' : 'Send my picks';
    document.querySelectorAll('.fav-heart').forEach(h => {
      const on = favs.includes(h.dataset.fav);
      h.classList.toggle('on', on);
      h.innerHTML = on ? '&#9829;' : '&#9825;';
      h.setAttribute('aria-pressed', on);
    });
    updateLightboxFav();
  }

  function updateLightboxFav() {
    if (!favsOn() || !currentVideoId) { lightboxFavBtn.hidden = true; return; }
    const on = favs.includes(currentVideoId);
    lightboxFavBtn.hidden = false;
    lightboxFavBtn.classList.toggle('on', on);
    lightboxFavBtn.innerHTML = on ? '&#9829; Favorited' : '&#9825; Favorite';
  }
  lightboxFavBtn.addEventListener('click', () => { if (currentVideoId) toggleFav(currentVideoId); });

  function toggleFav(id) {
    const before = favs.slice();
    const limit = favLimit();
    if (favs.includes(id)) {
      favs = favs.filter(x => x !== id);
    } else {
      if (limit && favs.length >= limit) {
        alert(`You can pick up to ${limit}. Remove one to choose another.`);
        return;
      }
      favs = favs.concat(id);
    }
    updateFavUI();
    saveFavs(before);
  }

  // Saves run one after another so a quick double-tap can't land out of order.
  function saveFavs(rollbackTo) {
    const ids = favs.slice();
    favSaving = favSaving.then(async () => {
      try {
        const res = await fetch(`/api/client/galleries/${token}/selection`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, ids }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          favs = rollbackTo;
          updateFavUI();
          alert(err.error || 'Could not save that pick. Please try again.');
        }
      } catch (_) {
        favs = rollbackTo;
        updateFavUI();
        alert('Could not save that pick. Check your connection and try again.');
      }
    });
  }

  favSendBtn.addEventListener('click', () => {
    favNameInput.value = viewerName || favNameInput.value || '';
    document.getElementById('fav-modal-summary').textContent =
      `You picked ${favs.length} ${favs.length === 1 ? 'photo' : 'photos'}. We'll let the photographer know.`;
    favError.textContent = '';
    favSubmit.disabled = false;
    favModal.style.display = 'flex';
    setTimeout(() => favNameInput.focus(), 50);
  });
  document.getElementById('fav-cancel').addEventListener('click', () => { favModal.style.display = 'none'; });
  favForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = favNameInput.value.trim();
    if (!name) return;
    favSubmit.disabled = true;
    favError.textContent = '';
    try {
      await favSaving;
      const res = await fetch(`/api/client/galleries/${token}/selection/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, name, note: favNoteInput.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { favError.textContent = data.error || 'Could not send. Please try again.'; favSubmit.disabled = false; return; }
      favSubmitted = favs.slice();
      if (!viewerName) { viewerName = name; localStorage.setItem('proofing-name', name); viewerDisplayName.textContent = name; }
      favModal.style.display = 'none';
      updateFavUI();
      alert(data.emailed === false
        ? 'Your picks are saved. We could not send the notification email, so please let the photographer know.'
        : 'Thank you. Your picks have been sent.');
    } catch (_) {
      favError.textContent = 'Could not connect. Please try again.';
      favSubmit.disabled = false;
    }
  });

  // ============ Helpers ============

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    // Quotes too: the result is also used inside value="…" / alt="…" attributes.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return mins + ':' + secs;
  }

  // Init
  loadGallery();
});
