// Folder-backed portfolio pages:
//   /portfolio                 every category and its galleries
//   /portfolio/<cat>           one category's galleries
//   /portfolio/<cat>/<gallery> one gallery
// A plain grid for now; the gallery layouts and lightbox come in a later release.
document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('portfolio');
  const parts = location.pathname.replace(/^\/portfolio\/?/, '').split('/').filter(Boolean);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  };
  const heading = text => {
    const h = document.createElement('h2');
    h.className = 'section-header';
    h.textContent = text;
    root.appendChild(h);
  };
  const card = (href, img, title) => {
    const a = document.createElement('a');
    a.className = 'video-card';
    a.href = href;
    a.innerHTML = `<div class="video-wrapper">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}</div>
      <p class="video-title">${esc(title)}</p>`;
    root.appendChild(a);
  };
  const galleries = list => list.forEach(g => card(g.url, g.cover, g.title));

  try {
    if (parts.length >= 2) {
      const { gallery } = await load(`/api/portfolio/g/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`);
      document.title = gallery.title;
      heading(gallery.title);
      gallery.items.forEach(item => {
        if (item.type === 'header') return heading(item.text);
        card(item.type === 'photo' ? (item.proxy || item.src) : item.src, item.thumb, item.title);
      });
    } else if (parts.length === 1) {
      const { category } = await load(`/api/portfolio/c/${encodeURIComponent(parts[0])}`);
      document.title = category.title;
      heading(category.title);
      galleries(category.galleries);
    } else {
      const { categories } = await load('/api/portfolio');
      if (!categories.length) root.innerHTML = '<div class="empty-state">Nothing here yet.</div>';
      categories.forEach(c => { heading(c.title); galleries(c.galleries); });
    }
  } catch (err) {
    root.innerHTML = '<div class="empty-state">Not found.</div>';
  }
});
