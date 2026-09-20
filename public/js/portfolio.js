// Folder-backed portfolio pages:
//   /portfolio                 every category and its galleries
//   /portfolio/<cat>           one category's galleries
//   /portfolio/<cat>/<gallery> one gallery, in its chosen layout
//
// Layout maths live in layouts.js and the video player in media-stage.js. The
// lightbox is PhotoSwipe (public/vendor/photoswipe), with video slides handled
// here. A gallery set to the slideshow layout plays in place and has no lightbox.
import PhotoSwipeLightbox from '/vendor/photoswipe/photoswipe-lightbox.esm.min.js';
import { LAYOUTS } from '/js/layouts.js';

const root = document.getElementById('portfolio');

const load = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  return res.json();
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const formatDuration = s => {
  if (!s) return '';
  return Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
};

// --- Cards (categories and galleries) ---

function coverCard(href, cover, title, subtitle) {
  const a = el('a', 'pf-card');
  a.href = href;
  const frame = el('div', 'pf-card-frame');
  if (cover) {
    const img = el('img');
    img.src = cover;
    img.alt = '';
    img.loading = 'lazy';
    frame.appendChild(img);
  }
  a.append(frame, el('h3', 'pf-card-title', title));
  if (subtitle) a.appendChild(el('p', 'pf-card-meta', subtitle));
  return a;
}

function renderGalleryCards(container, galleries) {
  const grid = el('div', 'pf-card-grid');
  galleries.forEach(g => {
    grid.appendChild(coverCard(g.url, g.cover, g.title, g.count === 1 ? '1 item' : `${g.count} items`));
  });
  container.appendChild(grid);
}

// --- Gallery ---

// Splits the items on section headers: each header starts a run that is laid
// out on its own.
function sections(items) {
  const out = [{ title: null, items: [] }];
  items.forEach(item => {
    if (item.type === 'header') out.push({ title: item.text, items: [] });
    else out[out.length - 1].items.push(item);
  });
  return out.filter(s => s.items.length);
}

function renderGallery(gallery) {
  document.title = gallery.title;
  const head = el('header', 'pf-head');
  const crumbs = el('nav', 'pf-crumbs');
  const catLink = el('a', null, gallery.category.title);
  catLink.href = gallery.category.url;
  crumbs.appendChild(catLink);
  head.append(crumbs, el('h1', 'pf-title', gallery.title));
  if (gallery.description) head.appendChild(el('p', 'pf-description', gallery.description));
  root.appendChild(head);

  const layoutName = LAYOUTS[gallery.layout] ? gallery.layout : 'justified';
  const media = gallery.items.filter(i => i.type !== 'header');
  const lightbox = layoutName === 'slideshow' ? null : createLightbox(media);
  const tiles = new Map();
  const instances = [];

  const tile = item => {
    const index = media.indexOf(item);
    const node = el('button', 'pf-tile');
    node.type = 'button';
    if (item.thumb) {
      const img = el('img');
      img.src = item.thumb;
      img.alt = item.title || '';
      img.loading = 'lazy';
      node.appendChild(img);
    } else {
      // A video whose poster the admin hasn't captured yet.
      node.appendChild(el('div', 'pf-tile-placeholder'));
    }
    if (item.type === 'video') node.appendChild(el('span', 'pf-badge', formatDuration(item.duration) || '▶'));
    if (item.title) node.appendChild(el('span', 'pf-tile-title', item.title));
    if (lightbox) node.addEventListener('click', () => lightbox.loadAndOpen(index));
    tiles.set(index, node);
    return node;
  };

  sections(gallery.items).forEach(section => {
    if (section.title) root.appendChild(el('h2', 'pf-section', section.title));
    const container = el('div', 'pf-layout pf-' + layoutName);
    root.appendChild(container);
    instances.push(LAYOUTS[layoutName](container, section.items, tile));
  });

  // Opening and closing animates from the thumbnail the viewer clicked.
  if (lightbox) lightbox.addFilter('thumbEl', (node, data, index) => tiles.get(index) || node);

  new ResizeObserver(() => instances.forEach(i => i.relayout())).observe(root);
}

// --- Lightbox ---

function createLightbox(media) {
  const lightbox = new PhotoSwipeLightbox({
    dataSource: media.map(item => (item.type === 'video'
      ? { type: 'video', item, width: item.width || 1920, height: item.height || 1080 }
      : {
        src: item.proxy || item.src,
        msrc: item.thumb || undefined,
        width: item.width || 1600,
        height: item.height || 1200,
        alt: item.title || '',
        description: item.description,
      })),
    bgOpacity: 0.95,
    pswpModule: () => import('/vendor/photoswipe/photoswipe.esm.min.js'),
  });

  // Video slides get the shared player instead of an <img>.
  const stages = new Map();
  lightbox.on('contentLoad', e => {
    const { content } = e;
    if (content.type !== 'video') return;
    e.preventDefault();
    // A slide is built before the lightbox has measured itself, so fall back to
    // the window until it has a viewport to give us.
    const viewport = () => (lightbox.pswp && lightbox.pswp.viewportSize)
      || { x: window.innerWidth, y: window.innerHeight };
    const stage = window.createVideoStage(content.data.item, {
      autoplay: false,
      width: () => viewport().x * 0.94,
      height: () => viewport().y * 0.94,
    });
    // The control strip sits at the bottom of the player: without this, dragging
    // the scrubber reads as a swipe and flicks to the next slide.
    stage.el.addEventListener('pointerdown', ev => ev.stopPropagation());
    const wrap = document.createElement('div');
    wrap.className = 'pswp-video';
    wrap.appendChild(stage.el);
    content.element = wrap;
    stages.set(content, stage);
    requestAnimationFrame(() => stage.layout());
  });
  lightbox.on('contentActivate', e => {
    const stage = stages.get(e.content);
    if (stage) { stage.layout(); stage.video.play().catch(() => {}); }
  });
  lightbox.on('contentDeactivate', e => {
    const stage = stages.get(e.content);
    if (stage) stage.pause();
  });
  lightbox.on('contentDestroy', e => {
    const stage = stages.get(e.content);
    if (stage) { stage.destroy(); stages.delete(e.content); }
  });
  lightbox.addFilter('isContentZoomable', (zoomable, content) =>
    (content.type === 'video' ? false : zoomable));

  // The caption box under a photo. A video draws its own inside the player,
  // where the sizing maths can allow for its height.
  lightbox.on('uiRegister', () => {
    lightbox.pswp.ui.registerElement({
      name: 'pf-caption',
      order: 9,
      appendTo: 'root',
      onInit: (node, pswp) => {
        node.className = 'lightbox-description pswp-caption';
        const update = () => {
          const data = pswp.currSlide && pswp.currSlide.data;
          const shown = data && data.type !== 'video'
            && window.renderCaptionBox(node, data.description);
          node.hidden = !shown;
        };
        pswp.on('change', update);
        update();
      },
    });
  });

  lightbox.init();
  return lightbox;
}

// --- Routing ---

document.addEventListener('DOMContentLoaded', async () => {
  const parts = location.pathname.replace(/^\/portfolio\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts.length >= 2) {
      const { gallery } = await load(`/api/portfolio/g/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`);
      renderGallery(gallery);
    } else if (parts.length === 1) {
      const { category } = await load(`/api/portfolio/c/${encodeURIComponent(parts[0])}`);
      document.title = category.title;
      const head = el('header', 'pf-head');
      head.appendChild(el('h1', 'pf-title', category.title));
      if (category.description) head.appendChild(el('p', 'pf-description', category.description));
      root.appendChild(head);
      renderGalleryCards(root, category.galleries);
    } else {
      const { categories } = await load('/api/portfolio');
      if (!categories.length) {
        root.appendChild(el('div', 'empty-state', 'Nothing here yet.'));
        return;
      }
      categories.forEach(c => {
        const h = el('h2', 'pf-section');
        const a = el('a', null, c.title);
        a.href = c.url;
        h.appendChild(a);
        root.appendChild(h);
        renderGalleryCards(root, c.galleries);
      });
    }
  } catch (err) {
    root.replaceChildren(el('div', 'empty-state', 'Not found.'));
  }
});
