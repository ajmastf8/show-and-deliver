// Plain pages at /p/<slug>: a title, a picture, some text, and — on a contact
// page — a form that emails the address in Update / Config > Email.
document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('page');
  const slug = decodeURIComponent(location.pathname.replace(/^\/p\/?/, '').split('/')[0] || '');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let page;
  try {
    const res = await fetch('/api/pages/' + encodeURIComponent(slug));
    if (!res.ok) throw new Error(res.status);
    page = (await res.json()).page;
  } catch (_) {
    root.appendChild(el('div', 'empty-state', 'Page not found.'));
    return;
  }

  document.title = page.title;
  const head = el('header', 'pf-head');
  head.appendChild(el('h1', 'pf-title', page.title));
  root.appendChild(head);

  const body = el('div', 'pf-page' + (page.image ? ' pf-page-with-image' : ''));
  if (page.image) {
    const fig = el('figure', 'pf-page-image');
    const img = el('img');
    img.src = page.image;
    img.alt = '';
    fig.appendChild(img);
    body.appendChild(fig);
  }

  const text = el('div', 'pf-page-text');
  // A page saved with the rich editor carries real HTML (sanitized
  // server-side on save); one saved before that editor existed is still
  // plain text with blank lines between paragraphs, which this renders the
  // same way it always has — auto-linked by caption-box.js's rules.
  if (/<[a-z][\s\S]*>/i.test(page.body)) {
    text.innerHTML = page.body;
  } else {
    page.body.split(/\n{2,}/).forEach(para => {
      const p = el('p');
      if (window.renderCaptionBox) window.renderCaptionBox(p, para);
      else p.textContent = para;
      text.appendChild(p);
    });
  }
  body.appendChild(text);
  root.appendChild(body);

  if (page.type !== 'contact') return;

  const form = el('form', 'pf-contact-form');
  form.innerHTML = `
    <label>Your name<input name="name" required autocomplete="name"></label>
    <label>Your email<input name="email" type="email" required autocomplete="email"></label>
    <label>Message<textarea name="message" rows="6" required></textarea></label>
    <label class="pf-hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
    <button type="submit">Send</button>
    <p class="pf-form-status" role="status"></p>`;
  text.appendChild(form);

  const status = form.querySelector('.pf-form-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Sending…';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Could not send');
      form.reset();
      status.textContent = 'Thank you — your message is on its way.';
    } catch (err) {
      status.textContent = err.message || 'Could not send the message.';
    } finally {
      button.disabled = false;
    }
  });
});
