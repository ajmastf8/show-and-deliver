(function() {
  // Expose site name globally for page titles
  window.__siteConfig = { siteName: '' };

  // Social icons. Simple single-path marks so they inherit colour and stay
  // legible at 19px; "link" is the fallback for anything not listed.
  const SOCIAL = {
    instagram: ['Instagram', 'M12 2.2c3.2 0 3.6 0 4.9.07 1.2.06 1.8.25 2.2.42.6.22 1 .48 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zm6.9-11.1a1.55 1.55 0 1 1-1.55-1.55A1.55 1.55 0 0 1 18.9 5.2z'],
    facebook: ['Facebook', 'M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v7h3v-7h3l1-3h-4v-2a1 1 0 0 1 1-1z'],
    x: ['X', 'M17.5 3h3l-6.6 7.5L22 21h-6l-4.7-6-5.4 6H2.9l7-8L2 3h6.2l4.2 5.6zM16.3 19.2h1.7L7.8 4.7H6z'],
    youtube: ['YouTube', 'M22 12s0-3.2-.4-4.7a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.5A2.5 2.5 0 0 0 2.4 7.3C2 8.8 2 12 2 12s0 3.2.4 4.7a2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.5a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12zM10 15.2V8.8L15.5 12z'],
    vimeo: ['Vimeo', 'M22 7.4c-.1 2.1-1.6 5-4.4 8.7C14.7 20 12.3 22 10.4 22c-1.2 0-2.2-1.1-3-3.3l-1.6-6C5.2 10.5 4.6 9.4 4 9.4c-.1 0-.6.3-1.4.9L2 9.1c.9-.8 1.8-1.6 2.7-2.4 1.2-1.1 2.1-1.6 2.7-1.7 1.5-.1 2.4.9 2.7 3 .4 2.3.7 3.8.8 4.3.4 2 .9 3 1.4 3 .4 0 1-.6 1.7-1.8.8-1.2 1.2-2.1 1.2-2.7.1-1-.3-1.5-1.2-1.5-.4 0-.9.1-1.3.3.9-2.9 2.6-4.3 5.1-4.2 1.8.05 2.7 1.3 2.6 3.7z'],
    linkedin: ['LinkedIn', 'M6.9 21H3.6V8.9h3.3zM5.2 7.4a1.9 1.9 0 1 1 1.9-1.9 1.9 1.9 0 0 1-1.9 1.9zM21 21h-3.3v-6c0-1.5-.5-2.5-1.8-2.5a1.9 1.9 0 0 0-1.8 1.3 2.5 2.5 0 0 0-.1.9V21H10.7s0-10.4 0-11.5H14v1.6a3.3 3.3 0 0 1 3-1.6c2.2 0 3.9 1.4 3.9 4.5z'],
    tiktok: ['TikTok', 'M16.5 2h-3v13.3a2.6 2.6 0 1 1-2.2-2.6v-3a5.6 5.6 0 1 0 5.2 5.6V9a7 7 0 0 0 4 1.3v-3a4.2 4.2 0 0 1-4-4.2z'],
    pinterest: ['Pinterest', 'M12 2a10 10 0 0 0-3.6 19.3 9.6 9.6 0 0 1 .2-2.9l1.2-5a3.6 3.6 0 0 1-.3-1.5c0-1.4.8-2.5 1.9-2.5a1.3 1.3 0 0 1 1.3 1.5c0 .9-.6 2.2-.9 3.5a1.5 1.5 0 0 0 1.6 1.9c1.8 0 3.2-1.9 3.2-4.7a4 4 0 0 0-4.3-4.2 4.5 4.5 0 0 0-4.6 4.5 4 4 0 0 0 .8 2.4.3.3 0 0 1 .1.3l-.3 1.1c0 .2-.2.3-.4.2-1.3-.6-2.1-2.5-2.1-4A6.2 6.2 0 0 1 12.4 6c3.5 0 6.2 2.5 6.2 5.8 0 3.5-2.2 6.2-5.2 6.2a2.7 2.7 0 0 1-2.3-1.2l-.6 2.4a11 11 0 0 1-1.2 2.6A10 10 0 1 0 12 2z'],
    behance: ['Behance', 'M9.3 6.2c1.9 0 3.3.9 3.3 2.8a2.3 2.3 0 0 1-1.5 2.3 2.6 2.6 0 0 1 2 2.7c0 2.3-1.8 3.3-4 3.3H2V6.2zM4.8 10.6h3.6c.9 0 1.4-.4 1.4-1.2S9.3 8.3 8.4 8.3H4.8zm0 4.9h3.8c1 0 1.6-.5 1.6-1.4s-.6-1.4-1.6-1.4H4.8zM15.2 7.1H21v1.5h-5.8zM22 14.3c0-2.7-1.6-4.6-4.1-4.6S13.7 11.6 13.7 14s1.7 4.2 4.3 4.2c2 0 3.4-.9 3.9-2.6h-2.2a1.7 1.7 0 0 1-1.7 1 2 2 0 0 1-2.1-1.8H22zm-6.1-1.2a1.9 1.9 0 0 1 2-1.7 1.8 1.8 0 0 1 1.9 1.7z'],
    flickr: ['Flickr', 'M7 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4zm10 0a4 4 0 1 0 4 4 4 4 0 0 0-4-4z'],
    threads: ['Threads', 'M12.2 22c-2.9 0-5.2-1-6.8-2.9C3.9 17.3 3 14.9 3 12s.9-5.3 2.4-7.1C7 3 9.3 2 12.2 2c3.9 0 6.8 1.7 8.1 4.7l-2.1.9c-1-2.2-3-3.4-6-3.4-2.2 0-3.9.7-5 2.1C6 7.7 5.3 9.6 5.3 12s.7 4.3 1.9 5.7c1.1 1.4 2.8 2.1 5 2.1 2 0 3.5-.5 4.4-1.4a3.4 3.4 0 0 0 1.1-2.4 2.7 2.7 0 0 0-1.3-2.3 5 5 0 0 0-1-.5 5.4 5.4 0 0 1-1.1 2.7 3.9 3.9 0 0 1-3.1 1.3 3.7 3.7 0 0 1-2.6-.9 3 3 0 0 1-1-2.3c0-2 1.6-3.4 4.2-3.4a10 10 0 0 1 2.1.2v-.4c0-1.4-.8-2.2-2.2-2.2a3 3 0 0 0-2.5 1.2l-1.6-1.3a5 5 0 0 1 4.1-1.9c2.7 0 4.4 1.6 4.4 4.3v.7a5 5 0 0 1 2 1.2 4.6 4.6 0 0 1 1.4 3.4 5.4 5.4 0 0 1-1.8 4c-1.4 1.3-3.4 2-6 2zm-.4-8.5c-1.4 0-2.2.6-2.2 1.4s.6 1.2 1.5 1.2c1.3 0 2.1-.9 2.3-2.4a7 7 0 0 0-1.6-.2z'],
    bluesky: ['Bluesky', 'M12 10.8C10.9 8.6 7.9 4.6 5.1 2.6 2.4.7 1.4 1 .7 1.3 0 1.7 0 3 0 3.8s.4 6.4.7 7.4c.9 3.2 4.3 4.3 7.4 4-4.5.7-8.5 2.3-3.3 8.1 5.8 5.9 7.9-2.5 9-6.8 1.1 4.3 2.4 12.4 9 6.8 4.9-5.8 1.3-7.4-3.2-8.1 3.1.3 6.5-.8 7.4-4 .3-1 .7-6.6.7-7.4s0-2.1-.7-2.5C26.6 1 25.6.7 22.9 2.6c-2.8 2-5.8 6-6.9 8.2z'],
    website: ['Website', 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm6.9 6h-2.9a15 15 0 0 0-1.3-3.6A8 8 0 0 1 18.9 8zM12 4.2A13 13 0 0 1 13.8 8h-3.6A13 13 0 0 1 12 4.2zM4.3 14a7.9 7.9 0 0 1 0-4h3.3a17 17 0 0 0 0 4zm.8 2h2.9a15 15 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16zm2.9-8H5.1a8 8 0 0 1 4.2-3.6A15 15 0 0 0 8 8zM12 19.8A13 13 0 0 1 10.2 16h3.6A13 13 0 0 1 12 19.8zM14.2 14H9.8a15 15 0 0 1 0-4h4.4a15 15 0 0 1 0 4zm.5 5.6A15 15 0 0 0 16 16h2.9a8 8 0 0 1-4.2 3.6zm1.7-5.6a17 17 0 0 0 0-4h3.3a7.9 7.9 0 0 1 0 4z'],
    email: ['Email', 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.2-8 5-8-5V6l8 5 8-5z'],
  };
  window.__socialNetworks = Object.keys(SOCIAL).map(k => [k, SOCIAL[k][0]]);

  async function loadHeader() {
    let config;
    try {
      const res = await fetch('/api/header');
      config = await res.json();
    } catch (e) { return; }

    // Repaint with the saved theme as soon as it arrives (theme.js has already
    // applied whatever was cached from last time).
    if (window.applySiteTheme) window.applySiteTheme(config.theme);
    const theme = config.theme || {};

    const logo = config.logo || {};
    const nav = config.nav || [];
    const social = Array.isArray(config.social) ? config.social : [];
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

    // Contact bar. A line typed in Site design replaces the email/phone/tagline
    // trio; turning it off hides the lot.
    let contactParts = [];
    const contactCfg = theme.contact || {};
    if (contactCfg.show === false) {
      contactParts = [];
    } else if ((contactCfg.text || '').trim()) {
      contactParts.push(`<span>${esc(contactCfg.text)}</span>`);
    } else {
      if (email) contactParts.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
      if (phone) contactParts.push(`<span>${esc(phone)}</span>`);
      if (tagline) contactParts.push(`<span>${esc(tagline)}</span>`);
    }
    const contactHtml = contactParts.join('<span class="contact-sep">//</span>');
    const mobileContactHtml = contactParts.map(p => p.replace('contact-sep', '')).join('');

    // Social links
    const socialHtml = social.filter(s => s && s.url).map(s => {
      const icon = SOCIAL[s.network] || SOCIAL.website;
      return `<a href="${esc(s.url)}" target="_blank" rel="noopener" aria-label="${esc(icon[0])}" title="${esc(icon[0])}">`
        + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon[1]}"/></svg></a>`;
    }).join('');

    // Logo or text header
    const logoLink = logo.link || '/';
    const logoHeight = logo.height || 74;
    let brandHtml = '';
    if (logo.src || logo.srcDark) {
      // A light-background logo and a dark-background one; CSS swaps them by
      // the theme. If only one exists it is shown on every background.
      const both = logo.src && logo.srcDark;
      const alt = esc(logo.alt || '');
      const style = `height:${logoHeight}px;`;
      const imgs = [];
      if (logo.src) imgs.push(`<img src="${esc(logo.src)}" alt="${alt}" class="logo-img${both ? ' logo-img-light' : ''}" style="${style}">`);
      if (logo.srcDark) imgs.push(`<img src="${esc(logo.srcDark)}" alt="${alt}" class="logo-img${both ? ' logo-img-dark' : ''}" style="${style}">`);
      brandHtml = `<a href="${esc(logoLink)}" class="logo">${imgs.join('')}</a>`;
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
        ${socialHtml ? `<div class="header-social">${socialHtml}</div>` : ''}
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

      // In sidebar mode the column scrolls its own overflow (long nav
      // lists), which per the CSS overflow spec clips the other axis too —
      // so a dropdown flyout positioned with plain CSS gets clipped away
      // the moment it extends past the column's right edge. Escaping that
      // needs position:fixed, which can't be pre-computed in CSS since each
      // dropdown sits at a different row; set it from the real layout right
      // as each one opens.
      header.querySelectorAll('.nav-dropdown').forEach(dd => {
        const menu = dd.querySelector('.nav-dropdown-menu');
        if (!menu) return;
        dd.addEventListener('mouseenter', () => {
          if (document.documentElement.getAttribute('data-header') !== 'sidebar') return;
          const ddRect = dd.getBoundingClientRect();
          const sidebarRect = document.querySelector('.site-header').getBoundingClientRect();
          menu.style.position = 'fixed';
          menu.style.top = ddRect.top + 'px';
          menu.style.left = sidebarRect.right + 'px';
        });
      });
    }

    // Inject mobile nav
    const mobileNav = document.querySelector('#mobile-nav .mobile-nav-links');
    if (mobileNav) {
      mobileNav.innerHTML = `
        ${mobileNavHtml}
        <div class="mobile-nav-contact">${mobileContactHtml}</div>
        ${socialHtml ? `<div class="mobile-nav-social">${socialHtml}</div>` : ''}
      `;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHeader);
  } else {
    loadHeader();
  }
})();
