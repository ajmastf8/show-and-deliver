# Changelog

## 1.6.2 — 2026-08-15
- **Zip downloads are much faster.** Every file in a ZIP needs a CRC32 checksum, and we were computing it during the download by hashing every byte in PHP. That is CPU work, and shared hosts cap CPU per account, so it throttled deliveries badly — measured on a live cPanel server, a zip crawled at 12 MB/s while the same files served without hashing moved at 102 MB/s. Each file is now hashed once when it's uploaded and the result cached, so downloads copy straight from disk with no per-byte work. Locally the same archive went from 304 MB/s to over 3,000 MB/s.
- Files uploaded before this release are hashed in the background while the admin is open, a few seconds at a time. Deliveries keep working throughout — a file that hasn't been hashed yet is simply hashed on its first download, which is the old speed rather than an error.
- Archives no longer carry per-entry data descriptors, since checksums are known before sending. Slightly smaller, and readable by a wider range of tools.

## 1.6.1 — 2026-08-15
- **Fixed: individual file downloads arrived as 0-byte files.** 1.6.0 handed uploads to the web server with an `X-LiteSpeed-Send-File` header, which is not enabled on every LiteSpeed host. Where it isn't, the header is passed through to the browser and the response body is empty, so every per-file download silently failed. The header also disclosed the server's absolute filesystem path. It is now off by default and opt-in via `SENDFILE=litespeed`, for hosts where it has actually been verified.
- Per-file downloads now link to the file's ordinary static URL instead, which the web server serves straight off disk — the same route that measures ~100 MB/s where streaming through PHP crawls. Saved filenames stay readable via the browser's download attribute.

## 1.6.0 — 2026-08-14
- **Send files to clients** — a WeTransfer-style handoff. "Deliver" on a client gallery or collection asks who you're sending to and what you want to say, then hands over a share link immediately and emails it. There is no packaging wait, however large the transfer: nothing is ever zipped onto the server's disk. The zip is generated on the fly while the client downloads it, so preparing a 200 GB delivery takes the same few milliseconds as a 200 MB one, uses no extra disk, and reads each file exactly once instead of four times.
- The share link is a real download page: one button per download, your message, and a list of the individual files so a client who only wants one clip doesn't have to pull down the whole archive.
- Emails are clearer and better designed. Every subject line now leads with your site name from Settings → Header and says what the message is — "Download link", "Gallery link", or "Video comments" — so a client can tell them apart at a glance. Download emails call out that the link expires in 7 days instead of burying it in small print.
- Deliveries larger than 900 MB are split into numbered parts, each a self-contained zip. This is a web-server limit, not a zip one: LiteSpeed truncates any generated response past its "Max Dynamic Response Body Size" (1 GiB by default) and appends an error to the body, which leaves the client with an archive that won't open. Raise that limit on your server and you can set `PACKAGE_PART_MB=0` for a single download of any size — every archive uses Zip64, so the 4 GB zip ceiling isn't a factor.
- Individual file downloads are served by the web server straight off disk rather than pushed through PHP, so they have no size ceiling and support resume. This fixes single-video downloads over 1 GB from client galleries, which were silently truncated before. (The first attempt at this used a header that isn't enabled on every host — see 1.6.1.)
- Every archive now uses Zip64 rather than switching formats at 4 GB, so the same code path runs on a 200 MB delivery and a 200 GB one — a bug can't hide in a branch that only large transfers take.
- Because zip entries are stored rather than compressed, the exact size of the archive is known before it's built — so downloads report a real Content-Length and clients get an accurate progress bar and ETA instead of an unbounded spinner.
- Large files dragged into the admin now upload in resumable chunks instead of one request, so multi-GB video no longer fails against `post_max_size` or a request timeout. A dropped connection resumes from the last acknowledged byte rather than restarting.
- **Collections can be portfolio collections.** A collection now has a type, the same as galleries do: client delivery (the default) or portfolio. Portfolio collections group portfolio galleries under one public link — no password, no expiry, no commenting. Portfolio galleries get a share token so a portfolio collection can link to them.
- The admin's left column is now grouped into Library, Client delivery, and Portfolio sections, each with its own galleries and collections. Previously portfolio and client work were mixed into one list.
- README now names the kind of hosting this runs on (Hosting.com, GoDaddy, Hostinger, Bluehost, SiteGround, and other cPanel plans) instead of only saying "shared hosting"
- Fixed email errors being reported as a generic failure on PHP 8.5 hosts with `display_errors` on — a deprecation notice was being printed into the JSON response body

## 1.5.0 — 2026-08-14
- Renamed the project to **Show & Deliver** — it both stands work up publicly (portfolio reels) and hands it off privately (client proofing), and the old name only described half of that
- Updates no longer require a GitHub token. Installs made from a release zip now check GitHub Releases and install the update in pure PHP, so no git binary, shell access, or credentials are needed. Clones keep updating via git; the mode is auto-detected and can be forced with `DEPLOY_MODE`.
- Client share emails now sign off with the site name from Settings → Header instead of a hardcoded name, and the admin tab title and topbar brand no longer fall back to one
- Added a README with install instructions and an MIT license, for running this on your own server

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
