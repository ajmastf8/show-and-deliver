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

      const card = document.createElement('div');
      card.className = 'video-card';
      card.dataset.filename = item.filename;

      const thumbSrc = item.thumbnail
        ? '/thumbnails/' + encodeURIComponent(item.thumbnail)
        : '/uploads/' + encodeURIComponent(item.filename) + '#t=0.1';

      if (item.thumbnail) {
        card.innerHTML = `
          <div class="video-wrapper">
            <img src="${thumbSrc}" alt="${escapeHtml(item.title)}" loading="lazy">
          </div>
          <p class="video-title">${escapeHtml(item.title)}</p>
        `;
      } else {
        card.innerHTML = `
          <div class="video-wrapper">
            <video src="${'/uploads/' + encodeURIComponent(item.filename)}" muted preload="metadata"></video>
          </div>
          <p class="video-title">${escapeHtml(item.title)}</p>
        `;
      }
      grid.appendChild(card);
    });

    // Lightbox click handler
    grid.addEventListener('click', e => {
      const card = e.target.closest('.video-card');
      if (!card) return;
      const filename = card.dataset.filename;
      openLightbox('/uploads/' + encodeURIComponent(filename));
    });

  } catch (err) {
    grid.innerHTML = '<div class="empty-state">Failed to load videos.</div>';
  }
});

// --- Lightbox ---

function openLightbox(videoSrc) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <div class="lightbox-content">
      <button class="lightbox-close">&times;</button>
      <video src="${videoSrc}" controls autoplay playsinline></video>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

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

function closeLightbox(overlay) {
  const video = overlay.querySelector('video');
  if (video) video.pause();
  overlay.remove();
  document.body.style.overflow = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
