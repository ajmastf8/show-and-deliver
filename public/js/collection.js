document.addEventListener('DOMContentLoaded', async () => {
  const loadingView = document.getElementById('loading-view');
  const errorView = document.getElementById('error-view');
  const passwordView = document.getElementById('password-view');
  const collectionView = document.getElementById('collection-view');
  const collectionName = document.getElementById('collection-name');
  const galleryGrid = document.getElementById('gallery-grid');

  // Extract token from URL path: /collection/:token
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1];

  if (!token) {
    showError('Collection Not Found', 'This collection may have been removed or the link is incorrect.');
    return;
  }

  try {
    const res = await fetch(`/api/collections/public/${token}`);

    if (res.status === 410) {
      showError('Collection Expired', 'This collection has expired and is no longer available.');
      return;
    }

    if (!res.ok) {
      showError('Collection Not Found', 'This collection may have been removed or the link is incorrect.');
      return;
    }

    const data = await res.json();

    if (data.passwordRequired) {
      showPasswordForm(data.collectionName);
      return;
    }

    renderCollection(data);
  } catch (err) {
    showError('Collection Not Found', 'This collection may have been removed or the link is incorrect.');
  }

  function showError(title, message) {
    loadingView.style.display = 'none';
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    errorView.style.display = '';
  }

  function showPasswordForm(name) {
    loadingView.style.display = 'none';
    document.getElementById('password-collection-name').textContent = name;
    passwordView.style.display = '';

    document.getElementById('password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('password-input').value;
      const errEl = document.getElementById('password-error');
      errEl.textContent = '';

      try {
        const res = await fetch(`/api/collections/public/${token}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });

        if (!res.ok) {
          errEl.textContent = 'Incorrect password';
          return;
        }

        const data = await res.json();
        passwordView.style.display = 'none';
        renderCollection(data);
      } catch (err) {
        errEl.textContent = 'Something went wrong. Please try again.';
      }
    });
  }

  function renderCollection(data) {
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
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
