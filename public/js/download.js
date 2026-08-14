document.addEventListener('DOMContentLoaded', async () => {
  const loadingView = document.getElementById('loading-view');
  const errorView = document.getElementById('error-view');
  const downloadView = document.getElementById('download-view');

  // /d/:token
  const parts = window.location.pathname.split('/').filter(Boolean);
  const token = parts[parts.length - 1];

  if (!token || token === 'd') {
    showError('Download Not Found', 'This link may have expired or been removed.');
    return;
  }

  try {
    const res = await fetch(`/api/packages/${encodeURIComponent(token)}`);
    if (res.status === 410) {
      showError('Link Expired', 'This download link has expired. Ask for a fresh one and it will be ready straight away.');
      return;
    }
    if (!res.ok) {
      showError('Download Not Found', 'This link may have expired or been removed.');
      return;
    }
    render(await res.json());
  } catch (err) {
    showError('Download Not Found', 'This link may have expired or been removed.');
  }

  function showError(title, message) {
    loadingView.style.display = 'none';
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    errorView.style.display = '';
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function render(pkg) {
    document.title = pkg.name ? `${pkg.name} — Download` : 'Download';
    document.getElementById('dl-title').textContent = pkg.name;

    const fileWord = pkg.fileCount === 1 ? 'file' : 'files';
    document.getElementById('dl-summary').textContent =
      `${pkg.fileCount} ${fileWord} · ${formatBytes(pkg.totalBytes)}`;

    if (pkg.message) {
      const el = document.getElementById('dl-message');
      el.textContent = pkg.message;
      el.hidden = false;
    }

    // One part is the normal case; several only when the sender opted into
    // splitting. Either way each row is a single click.
    const partsEl = document.getElementById('dl-parts');
    const multi = pkg.parts.length > 1;
    partsEl.innerHTML = pkg.parts.map((p) => {
      const name = multi || p.kind === 'file' ? p.label : 'Download everything';
      const meta = `${formatBytes(p.size)} · ${p.fileCount} ${p.fileCount === 1 ? 'file' : 'files'}`
        + (p.kind === 'file' ? '' : ' · zip');
      return `<div class="dl-part">
        <div class="dl-part-info">
          <div class="dl-part-name">${escapeHtml(name)}</div>
          <div class="dl-part-meta">${escapeHtml(meta)}</div>
        </div>
        <a class="dl-btn" href="${escapeHtml(p.url)}">Download</a>
      </div>`;
    }).join('');

    // Individual files — the "I only need one clip" path, and a way to retry a
    // single file without re-downloading the whole archive.
    const files = pkg.parts.flatMap(p => p.files || []);
    const listEl = document.getElementById('dl-file-list');
    const toggle = document.getElementById('dl-toggle');
    if (!files.length) {
      document.querySelector('.dl-individual').hidden = true;
    } else {
      document.getElementById('dl-toggle-label').textContent =
        `Or download files individually (${files.length})`;
      listEl.innerHTML = files.map(f => `<div class="dl-file">
        <span class="dl-file-name">${escapeHtml(f.name)}</span>
        <span class="dl-file-size">${formatBytes(f.size)}</span>
        <a class="dl-file-link" href="${f.url}">Download</a>
      </div>`).join('');
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        listEl.hidden = open;
      });
    }

    document.getElementById('dl-expiry').textContent =
      `This link expires on ${formatDate(pkg.expiresAt)}.`;

    loadingView.style.display = 'none';
    downloadView.style.display = '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
});
