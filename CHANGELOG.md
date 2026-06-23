# Changelog

## 1.2.3 — 2026-06-22
- Fix closed captions not appearing in the video player: the 1.2.2 controls-below-the-frame change pushed caption cues into the control strip; cues are now pinned over the picture (and restored to default placement in fullscreen), in both the client gallery and portfolio lightboxes
- Label the Chinese caption language option as "中文 (Mandarin)" so it's recognizable in the caption manager dropdown

## 1.2.2 — 2026-06-14
- Video player controls now sit directly under the video frame instead of overlapping the bottom of the picture, in both the client gallery and portfolio lightboxes

## 1.2.1 — 2026-06-06
- Tighten the client gallery video player: controls and captions now hug the video frame instead of spreading into the surrounding black space

## 1.2.0 — 2026-06-06
- Multi-language closed captions / subtitles for videos (WebVTT)
- Admin: per-video caption manager — upload, replace, and remove tracks in 14 common languages plus custom codes
- Captions play in both the client gallery and portfolio lightboxes, toggled via the player's CC button
- Download All now bundles each video's matching .vtt files into the zip
- New per-video "Download Transcripts" button — zips all of that video's caption tracks

## 1.1.0 — 2026-05-14
- Gallery view counts and per-file download tracking for client galleries and collections
- Reset stats action in gallery settings, behind a confirmation modal
- Third-party upload API — Bearer auth with chunked, resumable uploads
- Browser-based video thumbnail generation (drops the ffmpeg dependency)
- Download All rewritten: client-side parallel fetch and zip assembly with a real progress bar
- Collections collapsed by default in the admin sidebar
- Galleries active by default on creation
- Hardened git deploy to hard-reset against origin

## 1.0.0 — 2026-03-27
- Rewrite backend from Node.js to single PHP file
- Add photo support (jpg, jpeg, png, webp, gif) alongside videos
- Mixed media galleries — photos and videos in the same gallery
- Lightbox navigation with arrow keys and swipe gestures
- Square thumbnail containers without cropping
- Commenting toggle per gallery (default off)
- Renamed Reels Gallery to Portfolio Gallery
- Renamed Proofing Gallery to Client Gallery
- Tabbed Settings panel (Email, Update, Header)
- Git-based deploy from admin panel with logging
- URL-safe token generation (no slashes)
- All user data consolidated under site-data/ directory
