// Site theme: a colour preset, one accent, and how the header is arranged.
// Loaded in <head> on every public page so the saved look is painted before
// the first frame — the config itself only arrives later, with /api/header.
(function () {
  const PRESETS = {
    light: { '--color-white': '#ffffff', '--color-black': '#000000', '--color-body-text': '#5f5f5f',
             '--color-gray-light': '#f5f5f5', '--color-gray-mid': '#e0e0e0', '--color-gray-text': '#8e8e8e' },
    dark:  { '--color-white': '#1c1c1c', '--color-black': '#ededed', '--color-body-text': '#c4c4c4',
             '--color-gray-light': '#262626', '--color-gray-mid': '#343434', '--color-gray-text': '#9c9c9c' },
    warm:  { '--color-white': '#f7f3ee', '--color-black': '#241f1b', '--color-body-text': '#5b524a',
             '--color-gray-light': '#efe8e0', '--color-gray-mid': '#ddd2c6', '--color-gray-text': '#8c8075' },
  };

  // A darker accent for hovers and pressed states.
  function shade(hex, amount) {
    const n = parseInt((hex || '').replace('#', ''), 16);
    if (!isFinite(n)) return hex;
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map(v => Math.max(0, Math.min(255, Math.round(v * (1 - amount)))));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  window.applySiteTheme = function applySiteTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const vars = PRESETS[theme.preset] || PRESETS.light;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    if (theme.accent) {
      root.style.setProperty('--color-primary', theme.accent);
      root.style.setProperty('--color-primary-dark', shade(theme.accent, 0.18));
    }
    root.dataset.theme = theme.preset || 'light';
    root.dataset.header = theme.headerLayout || 'bar';
    try { localStorage.setItem('sd:theme', JSON.stringify(theme)); } catch (_) {}
  };

  // Last known theme, so a reload doesn't flash the default palette first.
  try {
    const cached = JSON.parse(localStorage.getItem('sd:theme') || 'null');
    if (cached) window.applySiteTheme(cached);
  } catch (_) {}
})();
