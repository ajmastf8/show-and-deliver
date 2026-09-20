// The pre-portfolio homepage: the reels gallery in a fixed grid. The homepage
// shell calls this only when nothing has been put on the portfolio home page
// yet, so an install that hasn't migrated still shows its reels.
window.renderReelsGrid = async function renderReelsGrid(grid) {
  {
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
      if (item.description) card.dataset.description = item.description;

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
      const description = card.dataset.description || '';
      const src = '/uploads/' + encodeURIComponent(filename);
      if (card.dataset.type === 'photo') {
        const photoSrc = proxy
          ? '/proxies/' + encodeURIComponent(proxy)
          : src;
        openPhotoLightbox(photoSrc, description);
      } else {
        let captions = [];
        if (card.dataset.captions) {
          try { captions = JSON.parse(card.dataset.captions); } catch (e) {}
        }
        openLightbox(src, captions, description);
      }
    });

    } catch (err) {
      grid.innerHTML = '<div class="empty-state">Failed to load videos.</div>';
    }
  }
};

// --- Lightbox ---

function openLightbox(videoSrc, captions, description) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const close = document.createElement('button');
  close.className = 'lightbox-close';
  close.innerHTML = '&times;';

  // The player, its caption overlay and the caption box all live in
  // media-stage.js, shared with the portfolio lightbox.
  const stage = createVideoStage({ src: videoSrc, captions, description });
  stage.el.appendChild(close);
  overlay.appendChild(stage.el);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  overlay._cleanup = () => stage.destroy();

  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target === close) closeLightbox(overlay);
  });

  const handleKey = e => {
    if (e.key === 'Escape') {
      closeLightbox(overlay);
      document.removeEventListener('keydown', handleKey);
    }
  };
  document.addEventListener('keydown', handleKey);
}

function openPhotoLightbox(imgSrc, description) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <div class="lightbox-content lightbox-photo-content">
      <button class="lightbox-close">&times;</button>
      <img src="${imgSrc}" alt="" style="max-width:100%; max-height:90vh; object-fit:contain;">
      <div class="lightbox-description" hidden></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const descEl = overlay.querySelector('.lightbox-description');
  const img = overlay.querySelector('img');
  if (renderCaptionBox(descEl, description)) {
    // Leave room for the box under a tall photo, and match its width to the
    // rendered picture once the browser knows how big that is.
    const fit = () => {
      img.style.maxHeight = Math.max(160, window.innerHeight * 0.9 - descEl.offsetHeight) + 'px';
      descEl.style.width = img.clientWidth ? img.clientWidth + 'px' : '';
    };
    if (img.complete) fit(); else img.addEventListener('load', fit);
    window.addEventListener('resize', fit);
    overlay._cleanup = () => window.removeEventListener('resize', fit);
  }

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
