document.addEventListener('DOMContentLoaded', async () => {
  const loadingView = document.getElementById('loading-view');
  const errorView = document.getElementById('error-view');
  const collectionView = document.getElementById('collection-view');
  const collectionName = document.getElementById('collection-name');
  const galleryGrid = document.getElementById('gallery-grid');

  // Extract token from URL path: /collection/:token
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1];

  if (!token) {
    loadingView.style.display = 'none';
    errorView.style.display = '';
    return;
  }

  try {
    const res = await fetch(`/api/collections/public/${token}`);

    if (!res.ok) {
      loadingView.style.display = 'none';
      errorView.style.display = '';
      return;
    }

    const data = await res.json();

    document.title = data.name + ' — ' + (window.__siteConfig?.siteName || 'Gallery');
    collectionName.textContent = data.name;

    if (!data.galleries.length) {
      galleryGrid.innerHTML = '<p class="collection-empty">No galleries in this collection yet.</p>';
    } else {
      data.galleries.forEach(g => {
        const card = document.createElement('a');
        card.className = 'collection-gallery-card';
        card.href = '/gallery/' + g.token;

        const thumbHtml = g.thumbnail
          ? `<img src="/thumbnails/${encodeURIComponent(g.thumbnail)}" alt="${escapeHtml(g.name)}">`
          : `<div class="collection-thumb-placeholder"></div>`;

        card.innerHTML = `
          <div class="collection-thumb-wrapper">
            ${thumbHtml}
          </div>
          <div class="collection-card-info">
            <span class="collection-card-name">${escapeHtml(g.name)}</span>
            <span class="collection-card-count">${g.videoCount} item${g.videoCount !== 1 ? 's' : ''}</span>
          </div>
        `;

        galleryGrid.appendChild(card);
      });
    }

    loadingView.style.display = 'none';
    collectionView.style.display = '';
  } catch (err) {
    loadingView.style.display = 'none';
    errorView.style.display = '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
