# Changelog

## 1.4.0 — 2026-08-06
- Redesigned the admin dashboard UI: state-driven library/upload/settings screens, list and grid views, bulk actions
- Collections can now be edited after creation — password, downloads, commenting, expiry, and gallery membership, plus copy/regenerate share link and delete — via "Collection settings" wherever collections appear. Previously that button only filtered the list, and settings were fixed at creation time.

## 1.3.6 — 2026-07-10
- Clarified that From Address, Notification Email, and Site Base URL apply to Resend as well as SMTP — these were grouped under the SMTP section, making them look SMTP-only

## 1.3.5 — 2026-06-26
- Fixed a 500 error downloading large proofing videos by streaming the download in chunks instead of loading the whole file into memory

## 1.3.4 — 2026-06-24
- Fixed "Install Video Tools" failing with "No writable home directory" on LiteSpeed/cPanel hosts where PHP has no usable home directory. The static ffmpeg build now installs into the app's `site-data/` directory (always writable, and persists across deploys), and ffmpeg lookup searches there as well as the home directory.

## 1.3.3 — 2026-06-24
- Fixed the duplicate caption properly: with the controls-below-frame layout the browser's native caption renders below the picture, so the player keeps its own styled caption over the video and now hides the native one using the standard `::cue` method (works in Firefox, Safari and Chrome — the previous attempt was Chrome-only). Reverts the 1.3.2 approach, which left only the mispositioned native caption.

## 1.3.2 — 2026-06-24
- Fixed captions appearing twice (once over the video, once lower down). Now that the caption MIME type and the timecode offset are fixed, the browser renders caption cues correctly over the video on its own, so the custom caption overlay added in 1.2.4 was a duplicate — removed it and reverted to native caption rendering in both the client and portfolio players

## 1.3.1 — 2026-06-24
- Admin Settings → Update now has a "Video Tools" section that installs a self-contained static ffmpeg build into the server's home directory, enabling automatic extraction of captions embedded in uploaded MP4s on hosts (like cPanel) without a system ffmpeg. Shows current ffmpeg status and installs on one click.

## 1.3.0 — 2026-06-24
- Caption files whose cues all fall past the end of the video (an editor timeline that starts at 01:00:00 exports captions an hour ahead, so they never display) are now auto-shifted back into the timeline on upload — the upload response notes when this happened
- Videos uploaded with captions baked into the MP4 (an in-container subtitle track, which browsers can't display) now have those captions auto-extracted to a WebVTT sidecar so they show in the player (requires ffmpeg on the server)
- Video duration is now read on upload even without ffmpeg, via a built-in MP4 parser — this is what lets the caption auto-shift work on hosts that don't have ffprobe

## 1.2.4 — 2026-06-23
- Captions now display reliably in Firefox (and other browsers): with controls sitting below the video frame, the browser parked native caption cues in the control strip out of sight. Captions are now rendered in a custom overlay pinned over the picture, and the browser's own (duplicate) cue painting is suppressed in the windowed player; fullscreen still uses native cues

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
