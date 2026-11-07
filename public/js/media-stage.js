// Shared video stage: a <video> with the controls in a strip below the picture,
// captions painted over the picture, and the caption box underneath. Used by the
// portfolio lightbox and by the reels page (public.js). Client proofing has its
// own player and doesn't use this.
//
// window.createVideoStage(item, options) -> { el, video, layout, pause, destroy }
//   item.src          video URL
//   item.poster       poster image URL (optional)
//   item.captions     [{ src | filename, lang, label }]
//   item.description  caption box text (optional)
//   options.width()   available width in px  (default: the element's own width)
//   options.height()  available height in px (default: 90% of the viewport)
//   options.autoplay  start playing once buffered (default true)
//
// The element carries .lightbox-content so it picks up the existing lightbox CSS
// in style.css, including the ::cue rules that hide the browser's own captions.
(function () {
  const CONTROL_BAR = 40;

  window.createVideoStage = function createVideoStage(item, options = {}) {
    const el = document.createElement('div');
    el.className = 'lightbox-content video-stage';
    el.innerHTML = `
      <video controls playsinline preload="auto"></video>
      <div class="lightbox-spinner active"></div>
      <div class="lightbox-description" hidden></div>
    `;

    const video = el.querySelector('video');
    const spinner = el.querySelector('.lightbox-spinner');
    const descEl = el.querySelector('.lightbox-description');
    video.src = item.src;
    if (item.poster) video.poster = item.poster;
    const hasDescription = window.renderCaptionBox
      ? window.renderCaptionBox(descEl, item.description)
      : false;

    const isFullscreen = () =>
      (document.fullscreenElement || document.webkitFullscreenElement) === video;

    // Native controls and native caption cues both anchor to the bottom of the
    // <video> box. layout() makes that box taller than the picture so the controls
    // sit in a strip below it — which also drops the native cues into that strip,
    // out of sight, and browsers honor manual cue repositioning too inconsistently
    // to rely on. So we render captions ourselves into an overlay pinned over the
    // picture, and leave the native cues hidden in the strip.
    const captionOverlay = document.createElement('div');
    captionOverlay.className = 'lightbox-caption-overlay';
    el.appendChild(captionOverlay);

    const layoutCaptionOverlay = () => {
      if (isFullscreen()) { captionOverlay.style.display = 'none'; return; }
      captionOverlay.style.display = '';
      const v = video.getBoundingClientRect();
      const w = el.getBoundingClientRect();
      captionOverlay.style.left = (v.left - w.left) + 'px';
      captionOverlay.style.top = (v.top - w.top) + 'px';
      captionOverlay.style.width = v.width + 'px';
      captionOverlay.style.height = Math.max(0, v.height - CONTROL_BAR) + 'px';
    };

    // Mirror the active cues of whichever track the viewer enabled into the overlay.
    // In fullscreen the native cues land correctly at the screen bottom, so we keep
    // our overlay empty there.
    const renderCaptions = () => {
      if (isFullscreen()) { captionOverlay.replaceChildren(); return; }
      const frag = document.createDocumentFragment();
      for (const tt of video.textTracks) {
        if (tt.mode !== 'showing' || !tt.activeCues) continue;
        for (const cue of tt.activeCues) {
          const line = document.createElement('div');
          line.className = 'lightbox-caption-line';
          line.appendChild(cue.getCueAsHTML());
          frag.appendChild(line);
        }
      }
      captionOverlay.replaceChildren(frag);
    };

    // Caption tracks (off by default; viewer toggles via the player's CC menu).
    // Portfolio items carry a ready-made src, reels items a captions/ filename.
    (item.captions || []).forEach(c => {
      const src = c.src || (c.filename ? '/captions/' + encodeURIComponent(c.filename) : '');
      if (!src) return;
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.src = src;
      track.srclang = c.lang || '';
      track.label = c.label || (c.lang || '').toUpperCase();
      video.appendChild(track);
    });
    video.textTracks.addEventListener('addtrack', e => {
      e.track.addEventListener('cuechange', renderCaptions);
    });
    video.textTracks.addEventListener('change', renderCaptions);
    video.addEventListener('timeupdate', renderCaptions);

    video.addEventListener('waiting', () => spinner.classList.add('active'));
    video.addEventListener('playing', () => spinner.classList.remove('active'));
    video.addEventListener('canplay', function onCanPlay() {
      video.removeEventListener('canplay', onCanPlay);
      spinner.classList.remove('active');
      if (options.autoplay !== false) video.play().catch(() => {});
    });

    // Native controls paint at the bottom of the element box. Size the element to
    // the picture height plus a strip for the control bar (picture pinned to the
    // top via object-position) so the controls sit directly under the video
    // instead of covering the bottom of the picture.
    const layout = () => {
      if (isFullscreen()) return;
      const vw = video.videoWidth || item.width || 16;
      const vh = video.videoHeight || item.height || 9;
      const availW = options.width ? options.width() : el.clientWidth;
      // The caption box renders below the control strip, so its height comes out
      // of the budget the picture is scaled against — otherwise a long caption
      // pushes the controls off the bottom of the viewport.
      const descH = hasDescription ? descEl.offsetHeight : 0;
      const availH = (options.height ? options.height() : window.innerHeight * 0.9) - descH;
      if (!availW || availH <= CONTROL_BAR) return;
      const scale = Math.min(availW / vw, (availH - CONTROL_BAR) / vh);
      video.style.width = (vw * scale) + 'px';
      video.style.height = (vh * scale + CONTROL_BAR) + 'px';
      // Match the box to the picture width so the two read as one unit.
      if (hasDescription) descEl.style.width = (vw * scale) + 'px';
      layoutCaptionOverlay();
    };

    const onFullscreen = () => {
      if (isFullscreen()) {
        video.style.width = '';
        video.style.height = '';
      } else {
        layout();
      }
      layoutCaptionOverlay();
      renderCaptions();
    };

    video.addEventListener('loadedmetadata', layout);
    window.addEventListener('resize', layout);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    video.load();
    layout();

    return {
      el,
      video,
      layout,
      pause: () => video.pause(),
      destroy() {
        video.pause();
        window.removeEventListener('resize', layout);
        document.removeEventListener('fullscreenchange', onFullscreen);
        document.removeEventListener('webkitfullscreenchange', onFullscreen);
        video.removeAttribute('src');
        video.load();
        el.remove();
      },
    };
  };
})();
