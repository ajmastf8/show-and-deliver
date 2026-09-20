// Portfolio gallery layouts. Each takes a container, the section's items and a
// tile factory, fills the container, and returns { relayout, destroy }.
//
// Items carry width/height from the sidecar. A video whose size we don't know
// yet (no poster, no readable header) reports 0 and is treated as 16:9, which is
// what the page shows until the admin captures a poster frame.

const ratio = item => {
  const w = item.width > 0 ? item.width : 16;
  const h = item.height > 0 ? item.height : 9;
  return w / h;
};

// Rows of equal height that keep each picture's aspect ratio, scaled to fill the
// width — the usual photographer's grid. The last row is left unstretched so a
// single leftover frame isn't blown up across the page.
export function justified(root, items, tile, opts = {}) {
  const gap = opts.gap ?? 8;
  const target = opts.rowHeight ?? 280;
  const tiles = items.map(tile);

  const relayout = () => {
    const width = root.clientWidth;
    if (!width) return;
    root.replaceChildren();
    let row = [];
    let sum = 0;
    const flush = (stretch) => {
      if (!row.length) return;
      const avail = width - gap * (row.length - 1);
      const h = stretch ? avail / sum : Math.min(target, avail / sum);
      const el = document.createElement('div');
      el.className = 'pf-row';
      el.style.gap = gap + 'px';
      row.forEach(({ node, r }) => {
        node.style.width = Math.floor(h * r) + 'px';
        node.style.height = Math.floor(h) + 'px';
        el.appendChild(node);
      });
      root.appendChild(el);
      row = [];
      sum = 0;
    };
    tiles.forEach((node, i) => {
      const r = ratio(items[i]);
      row.push({ node, r });
      sum += r;
      // Once the row would be shorter than the target height, it's full.
      if ((width - gap * (row.length - 1)) / sum < target) flush(true);
    });
    flush(false);
  };

  relayout();
  return { relayout, destroy() { root.replaceChildren(); } };
}

// Columns filled shortest-first. Items keep their order as they're placed, so
// reading down a column follows the gallery order closely; CSS columns would
// reorder them.
export function masonry(root, items, tile, opts = {}) {
  const gap = opts.gap ?? 8;
  const min = opts.columnWidth ?? 320;
  const tiles = items.map(tile);

  const relayout = () => {
    const width = root.clientWidth;
    if (!width) return;
    const count = Math.max(1, Math.min(tiles.length, Math.floor((width + gap) / (min + gap))));
    const colWidth = (width - gap * (count - 1)) / count;
    const cols = [];
    const heights = new Array(count).fill(0);
    root.replaceChildren();
    root.style.gap = gap + 'px';
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'pf-column';
      c.style.gap = gap + 'px';
      root.appendChild(c);
      cols.push(c);
    }
    tiles.forEach((node, i) => {
      const shortest = heights.indexOf(Math.min(...heights));
      node.style.width = '100%';
      node.style.height = Math.round(colWidth / ratio(items[i])) + 'px';
      cols[shortest].appendChild(node);
      heights[shortest] += colWidth / ratio(items[i]) + gap;
    });
  };

  relayout();
  return { relayout, destroy() { root.replaceChildren(); } };
}

// Even squares. The CSS does the work; nothing to recompute on resize.
export function grid(root, items, tile, opts = {}) {
  const gap = opts.gap ?? 8;
  root.style.gap = gap + 'px';
  root.append(...items.map(tile));
  return { relayout() {}, destroy() { root.replaceChildren(); } };
}

// One item at a time, filling the page: arrows, keyboard, swipe and a counter.
// Videos play in place here rather than opening the lightbox.
export function slideshow(root, items, tile, opts = {}) {
  let index = 0;
  let stage = null;

  const frame = document.createElement('div');
  frame.className = 'pf-slide-frame';
  const caption = document.createElement('div');
  caption.className = 'pf-slide-caption';
  const prev = document.createElement('button');
  prev.className = 'pf-slide-nav pf-slide-prev';
  prev.setAttribute('aria-label', 'Previous');
  prev.innerHTML = '&#10094;';
  const next = document.createElement('button');
  next.className = 'pf-slide-nav pf-slide-next';
  next.setAttribute('aria-label', 'Next');
  next.innerHTML = '&#10095;';
  const counter = document.createElement('div');
  counter.className = 'pf-slide-counter';
  root.replaceChildren(frame, prev, next, counter, caption);

  const show = i => {
    index = (i + items.length) % items.length;
    const item = items[index];
    if (stage) { stage.destroy(); stage = null; }
    if (item.type === 'video') {
      stage = window.createVideoStage(item, {
        autoplay: false,
        width: () => frame.clientWidth,
        height: () => frame.clientHeight,
      });
      frame.replaceChildren(stage.el);
      stage.layout();
    } else {
      const img = document.createElement('img');
      img.src = item.proxy || item.src;
      img.alt = item.title || '';
      frame.replaceChildren(img);
    }
    // A video's own stage already renders the caption box under the picture.
    caption.hidden = item.type === 'video'
      || !(window.renderCaptionBox && window.renderCaptionBox(caption, item.description));
    counter.textContent = `${index + 1} / ${items.length}`;
    prev.hidden = next.hidden = items.length < 2;
  };

  const onKey = e => {
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  };
  let touchX = null;
  const onTouchStart = e => { touchX = e.changedTouches[0].clientX; };
  const onTouchEnd = e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    touchX = null;
  };

  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  document.addEventListener('keydown', onKey);
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchend', onTouchEnd, { passive: true });
  show(opts.start ?? 0);

  return {
    relayout() { if (stage) stage.layout(); },
    destroy() {
      if (stage) stage.destroy();
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.replaceChildren();
    },
  };
}

export const LAYOUTS = { justified, masonry, grid, slideshow };
