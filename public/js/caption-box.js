// Renders a portfolio item's caption box.
//
// Shared by the homepage lightbox (public.js) and the portfolio gallery page
// (proofing.js) so the link handling below lives in exactly one place. The text
// is author-entered plain text: it is written with createTextNode, never
// innerHTML, so nothing in it can become markup. Line breaks survive via
// `white-space: pre-wrap` on the container rather than <br> injection.
(function () {
  // Bare http(s):// and www. runs. Deliberately narrow — anything else stays
  // literal text. Trailing sentence punctuation is trimmed back off the match
  // so "see https://example.com." does not link the full stop.
  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const TRAILING = /[.,;:!?)\]]+$/;

  function linkFor(match) {
    const a = document.createElement('a');
    a.href = /^www\./i.test(match) ? 'https://' + match : match;
    a.textContent = match;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // Fills `el` with `text`, hiding it when there is nothing to show. Returns
  // whether anything was rendered, so callers can lay out around it.
  window.renderCaptionBox = function renderCaptionBox(el, text) {
    if (!el) return false;
    const body = (text || '').trim();
    if (!body) {
      el.replaceChildren();
      el.hidden = true;
      return false;
    }

    const frag = document.createDocumentFragment();
    let last = 0;
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(body)) !== null) {
      let url = m[0];
      const trimmed = url.replace(TRAILING, '');
      // Give the trimmed punctuation back to the following text run.
      const end = m.index + trimmed.length;
      if (m.index > last) frag.appendChild(document.createTextNode(body.slice(last, m.index)));
      frag.appendChild(linkFor(trimmed));
      last = end;
      URL_RE.lastIndex = end;
    }
    if (last < body.length) frag.appendChild(document.createTextNode(body.slice(last)));

    el.replaceChildren(frag);
    el.hidden = false;
    return true;
  };
})();
