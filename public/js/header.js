(function() {
  // Expose site name globally for page titles
  window.__siteConfig = { siteName: '' };

  async function loadHeader() {
    let config;
    try {
      const res = await fetch('/api/header');
      config = await res.json();
    } catch (e) { return; }

    const logo = config.logo || {};
    const nav = config.nav || [];
    const email = config.email || '';
    const phone = config.phone || '';
    const tagline = config.tagline || '';
    const siteName = config.siteName || logo.alt || '';

    // Store site name globally for page titles
    window.__siteConfig.siteName = siteName;

    function esc(str) {
      const d = document.createElement('div');
      d.textContent = str || '';
      return d.innerHTML;
    }

    // Build nav HTML
    let navHtml = '';
    let mobileNavHtml = '';
    nav.forEach(item => {
      const ext = item.external ? ' target="_blank" rel="noopener"' : '';
      if (item.type === 'link') {
        const activeClass = (item.url === '/' || item.url === window.location.pathname) ? ' active' : '';
        navHtml += `<a href="${esc(item.url)}" class="nav-link${activeClass}"${ext}>${esc(item.label)}</a>`;
        mobileNavHtml += `<a href="${esc(item.url)}" class="mobile-nav-link${activeClass}"${ext}>${esc(item.label)}</a>`;
      } else if (item.type === 'dropdown') {
        let children = (item.children || []).map(c =>
          `<a href="${esc(c.url)}">${esc(c.label)}</a>`
        ).join('');
        navHtml += `<div class="nav-dropdown"><span class="nav-link">${esc(item.label)}</span><div class="nav-dropdown-menu">${children}</div></div>`;
        const mobileUrl = (item.children && item.children.length) ? item.children[0].url : '#';
        mobileNavHtml += `<a href="${esc(mobileUrl)}" class="mobile-nav-link">${esc(item.label)}</a>`;
      }
    });

    // Contact bar
    let contactParts = [];
    if (email) contactParts.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
    if (phone) contactParts.push(`<span>${esc(phone)}</span>`);
    if (tagline) contactParts.push(`<span>${esc(tagline)}</span>`);
    const contactHtml = contactParts.join('<span class="contact-sep">//</span>');
    const mobileContactHtml = contactParts.map(p => p.replace('contact-sep', '')).join('');

    // Logo or text header
    const logoLink = logo.link || '/';
    const logoHeight = logo.height || 74;
    let brandHtml = '';
    if (logo.src) {
      brandHtml = `<a href="${esc(logoLink)}" class="logo"><img src="${esc(logo.src)}" alt="${esc(logo.alt || '')}" class="logo-img" style="height:${logoHeight}px;"></a>`;
    } else if (logo.text) {
      brandHtml = `<a href="${esc(logoLink)}" class="logo logo-text">${esc(logo.text)}</a>`;
    } else if (logo.alt) {
      // Use alt text as text header if no image and no explicit text
      brandHtml = `<a href="${esc(logoLink)}" class="logo logo-text">${esc(logo.alt)}</a>`;
    }

    // Inject header
    const header = document.querySelector('.site-header .header-inner');
    if (header) {
      header.innerHTML = `
        ${brandHtml}
        <nav class="header-nav">${navHtml}</nav>
        ${contactHtml ? `<div class="header-contact">${contactHtml}</div>` : ''}
        <button class="mobile-menu-btn" aria-label="Menu">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      `;
      const menuBtn = header.querySelector('.mobile-menu-btn');
      if (menuBtn) {
        menuBtn.addEventListener('click', () => {
          document.getElementById('mobile-nav').classList.toggle('open');
        });
      }
    }

    // Inject mobile nav
    const mobileNav = document.querySelector('#mobile-nav .mobile-nav-links');
    if (mobileNav) {
      mobileNav.innerHTML = `
        ${mobileNavHtml}
        <div class="mobile-nav-contact">${mobileContactHtml}</div>
      `;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHeader);
  } else {
    loadHeader();
  }
})();
