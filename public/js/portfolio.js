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

// How gallery covers are listed: an even grid, full-width bands, one big
// column, or one cover per screen. The shape is CSS; this only tags it.
function renderGalleryCards(container, galleries, index = {}) {
  const layout = ['grid', 'fullwidth', 'columns', 'fullscreen'].includes(index.layout) ? index.layout : 'grid';
  const grid = el('div', 'pf-card-grid pf-index-' + layout);
  galleries.forEach(g => {
    const card = coverCard(g.url, g.cover, g.title, g.count === 1 ? '1 item' : `${g.count} items`);
    if (g.categorySlug) card.dataset.category = g.categorySlug;
    grid.appendChild(card);
  });
  container.appendChild(grid);
  return grid;
}

// A category list beside the covers, as an alternative to the top menu.
function renderSidebar(categories, active, side) {
  const nav = el('nav', 'pf-catnav pf-catnav-' + side);
  const all = el('a', 'pf-catnav-link' + (active ? '' : ' active'), 'All work');
  all.href = '/portfolio';
  nav.appendChild(all);
  categories.forEach(c => {
    const a = el('a', 'pf-catnav-link' + (c.slug === active ? ' active' : ''), c.title);
    a.href = c.url;
    nav.appendChild(a);
  });
  return nav;
}

// Category buttons that filter the covers in place, for sites that would
// rather show everything on one page than make people navigate.
function renderFilters(grid, categories) {
  const bar = el('div', 'pf-filters');
  const make = (label, slug) => {
    const b = el('button', 'pf-filter' + (slug === null ? ' active' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => {
      bar.querySelectorAll('.pf-filter').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      grid.querySelectorAll('.pf-card').forEach(card => {
        card.hidden = slug !== null && card.dataset.category !== slug;
      });
    });
    return b;
  };
  bar.appendChild(make('All', null));
  categories.forEach(c => bar.appendChild(make(c.title, c.slug)));
  return bar;
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

// The home page's opening screen: a full-bleed picture or a muted looping
// video, with the site's name over it and the gallery below the fold.
function renderHero(hero) {
  const section = el('section', 'pf-hero pf-hero-' + hero.height + (hero.only ? ' pf-hero-alone' : ''));
  // A full-height cover should fill what's left under the header, not overflow
  // it. The sidebar arrangement runs down the side, so it takes nothing off.
  const measure = () => {
    const header = document.querySelector('.site-header');
    const sidebar = document.documentElement.dataset.header === 'sidebar';
    const h = !header || sidebar ? 0 : Math.round(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--pf-header-h', h + 'px');
  };
  measure();
  window.addEventListener('resize', measure);
  if (hero.type === 'video') {
    const v = document.createElement('video');
    v.src = hero.src;
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    if (hero.poster) v.poster = hero.poster;
    v.play().catch(() => {});
    section.appendChild(v);
  } else {
    const img = el('img');
    img.src = hero.src;
    img.alt = '';
    section.appendChild(img);
  }
  if (hero.title || hero.subtitle) {
    const words = el('div', 'pf-hero-words');
    if (hero.title) words.appendChild(el('h1', 'pf-hero-title', hero.title));
    if (hero.subtitle) words.appendChild(el('p', 'pf-hero-sub', hero.subtitle));
    section.appendChild(words);
  }
  return section;
}

function renderGallery(gallery, opts = {}) {
  if (opts.home && gallery.hero) {
    root.appendChild(renderHero(gallery.hero));
    // The cover is the whole page; the pictures under it are only there to
    // give the cover something to point at.
    if (gallery.hero.only) return;
  }
  // The home page is a gallery too, but it reads as a landing page: no
  // breadcrumb, no title above the pictures.
  if (!opts.home) {
    document.title = gallery.title;
    const head = el('header', 'pf-head');
    const crumbs = el('nav', 'pf-crumbs');
    const catLink = el('a', null, gallery.category.title);
    catLink.href = gallery.category.url;
    crumbs.appendChild(catLink);
    head.append(crumbs, el('h1', 'pf-title', gallery.title));
    if (gallery.description) head.appendChild(el('p', 'pf-description', gallery.description));
    root.appendChild(head);
  } else if (gallery.description) {
    const head = el('header', 'pf-head');
    head.appendChild(el('p', 'pf-description', gallery.description));
    root.appendChild(head);
  }

  const layoutName = LAYOUTS[gallery.layout] ? gallery.layout : 'justified';
  const options = gallery.options || {};
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
    if (item.title && options.titles !== 'none') node.appendChild(el('span', 'pf-tile-title', item.title));
    if (lightbox) node.addEventListener('click', () => lightbox.loadAndOpen(index));
    tiles.set(index, node);
    return node;
  };

  sections(gallery.items).forEach(section => {
    if (section.title) root.appendChild(el('h2', 'pf-section', section.title));
    const container = el('div', `pf-layout pf-${layoutName} pf-titles-${options.titles || 'hover'} pf-crop-${options.crop || 'fit'}`);
    root.appendChild(container);
    instances.push(LAYOUTS[layoutName](container, section.items, tile, options));
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

// Wraps the page in a sidebar layout when one is switched on, and returns the
// element the page content goes into.
function withSidebar(categories, activeSlug, index) {
  const side = index.sidebar;
  if (side !== 'left' && side !== 'right') return root;
  const wrap = el('div', 'pf-with-nav pf-with-nav-' + side);
  const body = el('div', 'pf-with-nav-body');
  const nav = renderSidebar(categories, activeSlug, side);
  wrap.append(side === 'left' ? nav : body, side === 'left' ? body : nav);
  root.appendChild(wrap);
  return body;
}

// A password-protected gallery: the link works, the pictures wait.
function renderLocked(catSlug, galSlug, title) {
  document.title = title || 'Private gallery';
  const box = el('div', 'pf-locked');
  box.appendChild(el('h1', 'pf-title', title || 'Private gallery'));
  box.appendChild(el('p', 'pf-description', 'This gallery is private. Enter the password to view it.'));

  const form = el('form', 'pf-contact-form');
  form.innerHTML = `
    <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
    <button type="submit">View gallery</button>
    <p class="pf-form-status" role="status"></p>`;
  box.appendChild(form);
  root.appendChild(box);
  form.querySelector('input').focus();

  const status = form.querySelector('.pf-form-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.textContent = '';
    try {
      const res = await fetch(`/api/portfolio/g/${encodeURIComponent(catSlug)}/${encodeURIComponent(galSlug)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.password.value }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'That password does not match');
      root.replaceChildren();
      renderGallery(out.gallery);
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

// --- Routing ---

document.addEventListener('DOMContentLoaded', async () => {
  // The homepage shell and the portfolio pages share this script.
  if (!location.pathname.startsWith('/portfolio')) {
    try {
      const { gallery } = await load('/api/portfolio/home');
      if (gallery) {
        root.classList.add('pf-home');
        renderGallery(gallery, { home: true });
        return;
      }
    } catch (_) {}
    // Nothing on the home page yet: show what this install showed before.
    const grid = document.getElementById('video-grid');
    if (grid && window.renderReelsGrid) {
      grid.hidden = false;
      window.renderReelsGrid(grid);
    }
    return;
  }

  const parts = location.pathname.replace(/^\/portfolio\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts.length >= 2) {
      const data = await load(`/api/portfolio/g/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`);
      if (data.locked) return renderLocked(parts[0], parts[1], data.title);
      renderGallery(data.gallery);
    } else if (parts.length === 1) {
      const { category, index, categories } = await load(`/api/portfolio/c/${encodeURIComponent(parts[0])}`);
      document.title = category.title;
      const body = withSidebar(categories || [], category.slug, index || {});
      const head = el('header', 'pf-head');
      head.appendChild(el('h1', 'pf-title', category.title));
      if (category.description) head.appendChild(el('p', 'pf-description', category.description));
      body.appendChild(head);
      renderGalleryCards(body, category.galleries, index);
    } else {
      const { categories, index = {} } = await load('/api/portfolio');
      if (!categories.length) {
        root.appendChild(el('div', 'empty-state', 'Nothing here yet.'));
        return;
      }
      const body = withSidebar(categories, null, index);
      if (index.filters) {
        // One page, every gallery, filtered in place.
        const all = categories.flatMap(c => c.galleries.map(g => ({ ...g, categorySlug: c.slug })));
        const grid = renderGalleryCards(body, all, index);
        body.insertBefore(renderFilters(grid, categories), grid);
      } else {
        categories.forEach(c => {
          const h = el('h2', 'pf-section');
          const a = el('a', null, c.title);
          a.href = c.url;
          h.appendChild(a);
          body.appendChild(h);
          renderGalleryCards(body, c.galleries, index);
        });
      }
    }
  } catch (err) {
    root.replaceChildren(el('div', 'empty-state', 'Not found.'));
  }
});
