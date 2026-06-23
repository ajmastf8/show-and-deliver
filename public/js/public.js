document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('video-grid');

  try {
    const res = await fetch('/api/videos');
    const videos = await res.json();

    if (videos.length === 0) {
      grid.innerHTML = '<div class="empty-state">No reels yet.</div>';
      return;
    }

    videos.forEach(item => {
      if (item.type === 'header') {
        const h = document.createElement('h2');
        h.className = 'section-header';
        h.textContent = item.text;
        grid.appendChild(h);
        return;
      }

      const isPhoto = item.type === 'photo';
      const card = document.createElement('div');
      card.className = 'video-card';
      card.dataset.filename = item.filename;
      card.dataset.type = item.type || 'video';
      if (item.proxy) card.dataset.proxy = item.proxy;
      if (item.captions && item.captions.length) card.dataset.captions = JSON.stringify(item.captions);

      let thumbContent;
      if (item.thumbnail) {
        thumbContent = `<img src="/thumbnails/${encodeURIComponent(item.thumbnail)}" alt="${escapeHtml(item.title)}" loading="lazy">`;
      } else if (isPhoto) {
        thumbContent = `<img src="/uploads/${encodeURIComponent(item.filename)}" alt="${escapeHtml(item.title)}" loading="lazy">`;
      } else {
        thumbContent = `<video src="/uploads/${encodeURIComponent(item.filename)}" muted preload="metadata"></video>`;
      }

      card.innerHTML = `
        <div class="video-wrapper">
          ${thumbContent}
        </div>
        <p class="video-title">${escapeHtml(item.title)}</p>
      `;
      grid.appendChild(card);
    });

    // Lightbox click handler
    grid.addEventListener('click', e => {
      const card = e.target.closest('.video-card');
      if (!card) return;
      const filename = card.dataset.filename;
      const proxy = card.dataset.proxy;
      const src = '/uploads/' + encodeURIComponent(filename);
      if (card.dataset.type === 'photo') {
        const photoSrc = proxy
          ? '/proxies/' + encodeURIComponent(proxy)
          : src;
        openPhotoLightbox(photoSrc);
      } else {
        let captions = [];
        if (card.dataset.captions) {
          try { captions = JSON.parse(card.dataset.captions); } catch (e) {}
        }
        openLightbox(src, captions);
      }
    });

  } catch (err) {
    grid.innerHTML = '<div class="empty-state">Failed to load videos.</div>';
  }
});

// --- Lightbox ---

function openLightbox(videoSrc, captions) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <div class="lightbox-content">
      <button class="lightbox-close">&times;</button>
      <video src="${videoSrc}" controls playsinline preload="auto"></video>
      <div class="lightbox-spinner active"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const video = overlay.querySelector('video');
  const spinner = overlay.querySelector('.lightbox-spinner');

  const CONTROL_BAR = 40;
  const isFullscreen = () =>
    (document.fullscreenElement || document.webkitFullscreenElement) === video;

  // Native controls and native caption cues both anchor to the bottom of the
  // <video> box. layout() makes that box taller than the picture so the controls
  // sit in a strip below it — which also drops the native cues into that strip,
  // out of sight, and browsers honor manual cue repositioning too inconsistently
  // to rely on. So we render captions ourselves into an overlay pinned over the
  // picture, and leave the native cues hidden in the strip.
  const captionOverlay = document.createElement('div');
  captionOverlay.className = 'lightbox-caption-overlay';
  video.parentElement.appendChild(captionOverlay);

  const layoutCaptionOverlay = () => {
    if (isFullscreen()) { captionOverlay.style.display = 'none'; return; }
    captionOverlay.style.display = '';
    const wrap = video.parentElement;
    const v = video.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    captionOverlay.style.left = (v.left - w.left) + 'px';
    captionOverlay.style.top = (v.top - w.top) + 'px';
    captionOverlay.style.width = v.width + 'px';
    captionOverlay.style.height = Math.max(0, v.height - CONTROL_BAR) + 'px';
  };

  // Mirror the active cues of whichever track the viewer enabled into the overlay.
  // In fullscreen the native cues land correctly at the screen bottom, so we keep
  // our overlay empty there.
  const renderCaptions = () => {
    if (isFullscreen()) { captionOverlay.replaceChildren(); return; }
    const frag = document.createDocumentFragment();
    for (const tt of video.textTracks) {
      if (tt.mode !== 'showing' || !tt.activeCues) continue;
      for (const cue of tt.activeCues) {
        const line = document.createElement('div');
        line.className = 'lightbox-caption-line';
        line.appendChild(cue.getCueAsHTML());
        frag.appendChild(line);
      }
    }
    captionOverlay.replaceChildren(frag);
  };

  // Caption tracks (off by default; viewer toggles via the player's CC menu)
  (captions || []).forEach(c => {
    if (!c.filename) return;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.src = '/captions/' + encodeURIComponent(c.filename);
    track.srclang = c.lang || '';
    track.label = c.label || (c.lang || '').toUpperCase();
    video.appendChild(track);
  });
  // Re-render when captions change or the viewer toggles a track on/off.
  video.textTracks.addEventListener('addtrack', e => {
    e.track.addEventListener('cuechange', renderCaptions);
  });
  video.textTracks.addEventListener('change', renderCaptions);
  video.addEventListener('timeupdate', renderCaptions);

  video.addEventListener('waiting', () => spinner.classList.add('active'));
  video.addEventListener('playing', () => spinner.classList.remove('active'));
  video.addEventListener('canplay', function onCanPlay() {
    video.removeEventListener('canplay', onCanPlay);
    spinner.classList.remove('active');
    video.play().catch(() => {});
  });

  // Native controls paint at the bottom of the element box. Size the element to
  // the picture height plus a strip for the control bar (picture pinned to the
  // top via object-position) so the controls sit directly under the video
  // instead of covering the bottom of the picture.
  const layout = () => {
    if (!video.videoWidth) return;
    if (isFullscreen()) return;
    const availW = video.parentElement.clientWidth;
    const availH = window.innerHeight * 0.8;
    const scale = Math.min(availW / video.videoWidth, (availH - CONTROL_BAR) / video.videoHeight);
    video.style.width = (video.videoWidth * scale) + 'px';
    video.style.height = (video.videoHeight * scale + CONTROL_BAR) + 'px';
    layoutCaptionOverlay();
  };
  const onFullscreen = () => {
    if (isFullscreen()) {
      video.style.width = '';
      video.style.height = '';
    } else {
      layout();
    }
    layoutCaptionOverlay();
    renderCaptions();
  };
  video.addEventListener('loadedmetadata', layout);
  window.addEventListener('resize', layout);
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);
  overlay._cleanup = () => {
    window.removeEventListener('resize', layout);
    document.removeEventListener('fullscreenchange', onFullscreen);
    document.removeEventListener('webkitfullscreenchange', onFullscreen);
  };

  video.load();

  // Close on overlay click (not video)
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.classList.contains('lightbox-close')) {
      closeLightbox(overlay);
    }
  });

  // Close on Escape
  const handleKey = e => {
    if (e.key === 'Escape') {
      closeLightbox(overlay);
      document.removeEventListener('keydown', handleKey);
    }
  };
  document.addEventListener('keydown', handleKey);
}

function openPhotoLightbox(imgSrc) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <div class="lightbox-content lightbox-photo-content">
      <button class="lightbox-close">&times;</button>
      <img src="${imgSrc}" alt="" style="max-width:100%; max-height:90vh; object-fit:contain;">
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.classList.contains('lightbox-close')) {
      closeLightbox(overlay);
    }
  });

  const handleKey = e => {
    if (e.key === 'Escape') {
      closeLightbox(overlay);
      document.removeEventListener('keydown', handleKey);
    }
  };
  document.addEventListener('keydown', handleKey);
}

function closeLightbox(overlay) {
  const video = overlay.querySelector('video');
  if (video) video.pause();
  if (overlay._cleanup) overlay._cleanup();
  overlay.remove();
  document.body.style.overflow = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
