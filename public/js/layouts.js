// Portfolio gallery layouts. Each takes a container, the section's items and a
// tile factory, fills the container, and returns { relayout, destroy }.
//
// Items carry width/height from the sidecar. A video whose size we don't know
// yet (no poster, no readable header) reports 0 and is treated as 16:9, which is
// what the page shows until the admin captures a poster frame.

// A gallery's options arrive as words; these turn them into numbers. Keeping
// the stored value abstract means one setting reads sensibly on a phone and on
// a 5K display, and we can retune the numbers without touching saved galleries.
export const GAPS = { tight: 3, normal: 10, wide: 26 };
export const ROW_HEIGHTS = { compact: 210, normal: 290, roomy: 400 };
export const COLUMN_WIDTHS = { compact: 240, normal: 330, roomy: 460 };

const gapOf = o => GAPS[o?.gap] ?? GAPS.normal;

const ratio = item => {
  const w = item.width > 0 ? item.width : 16;
  const h = item.height > 0 ? item.height : 9;
  return w / h;
};

// Rows of equal height that keep each picture's aspect ratio, scaled to fill the
// width — the usual photographer's grid. The last row is left unstretched so a
// single leftover frame isn't blown up across the page.
export function justified(root, items, tile, opts = {}) {
  const gap = gapOf(opts);
  const target = ROW_HEIGHTS[opts.density] ?? ROW_HEIGHTS.normal;
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
  const gap = gapOf(opts);
  const min = COLUMN_WIDTHS[opts.density] ?? COLUMN_WIDTHS.normal;
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
  root.style.gap = gapOf(opts) + 'px';
  root.style.setProperty('--pf-col', (COLUMN_WIDTHS[opts.density] ?? COLUMN_WIDTHS.normal) + 'px');
  // "Fit" keeps each frame whole, so a tile takes the picture's own shape
  // rather than a square crop.
  const tiles = items.map((item, i) => {
    const node = tile(item);
    if (opts.crop !== 'fill') node.style.aspectRatio = ratio(items[i]);
    return node;
  });
  root.append(...tiles);
  return { relayout() {}, destroy() { root.replaceChildren(); } };
}

// Masonry where a picture can claim two columns, two rows, or both. CSS grid
// with dense packing fills the gaps that leaves behind.
export function featured(root, items, tile, opts = {}) {
  const gap = gapOf(opts);
  const col = COLUMN_WIDTHS[opts.density] ?? COLUMN_WIDTHS.normal;
  root.style.gap = gap + 'px';
  root.style.setProperty('--pf-col', col + 'px');
  root.style.setProperty('--pf-row', Math.round(col * 0.62) + 'px');
  root.append(...items.map((item, i) => {
    const node = tile(item);
    node.classList.add('pf-size-' + (item.tile || 'normal'));
    return node;
  }));
  return { relayout() {}, destroy() { root.replaceChildren(); } };
}

// One tall row you scroll sideways: pictures keep their shape at a fixed
// height, and the wheel scrolls the strip rather than the page.
export function horizontal(root, items, tile, opts = {}) {
  const gap = gapOf(opts);
  const strip = document.createElement('div');
  strip.className = 'pf-strip';
  strip.style.gap = gap + 'px';
  const height = { compact: 52, normal: 66, roomy: 80 }[opts.density] ?? 66;
  strip.style.setProperty('--pf-strip-h', height + 'vh');
  items.forEach((item, i) => {
    const node = tile(item);
    node.style.height = '100%';
    node.style.width = Math.round((window.innerHeight * height / 100) * ratio(item)) + 'px';
    strip.appendChild(node);
  });
  root.replaceChildren(strip);

  const onWheel = e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    strip.scrollLeft += e.deltaY;
    // Let the page scroll again once the strip has run out.
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    if (!(e.deltaY > 0 ? atEnd : strip.scrollLeft <= 0)) e.preventDefault();
  };
  strip.addEventListener('wheel', onWheel, { passive: false });

  const relayout = () => {
    const h = strip.clientHeight;
    [...strip.children].forEach((node, i) => { node.style.width = Math.round(h * ratio(items[i])) + 'px'; });
  };
  relayout();
  return {
    relayout,
    destroy() { strip.removeEventListener('wheel', onWheel); root.replaceChildren(); },
  };
}

// One picture per screen, scrolled through. Scroll-snap does the work, so it
// keeps the browser's own momentum and keyboard scrolling.
export function fullscreen(root, items, tile, opts = {}) {
  root.style.gap = gapOf(opts) + 'px';
  root.append(...items.map(item => {
    const frame = document.createElement('div');
    frame.className = 'pf-screen';
    frame.appendChild(tile(item));
    return frame;
  }));
  return { relayout() {}, destroy() { root.replaceChildren(); } };
}

// One item at a time, filling the page: arrows, keyboard, swipe and a counter.
// Videos play in place here rather than opening the lightbox.
export function slideshow(root, items, tile, opts = {}) {
  let index = 0;
  let stage = null;
  let timer = null;

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
    // Autoplay pauses on a video, which has its own running time.
    clearInterval(timer);
    if (opts.autoplay && items.length > 1 && items[index].type !== 'video') {
      timer = setInterval(() => show(index + 1), Math.max(2, opts.interval || 5) * 1000);
    }
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
      clearInterval(timer);
      if (stage) stage.destroy();
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.replaceChildren();
    },
  };
}

export const LAYOUTS = { justified, masonry, grid, slideshow, horizontal, fullscreen, featured };
