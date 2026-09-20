# Show & Deliver

Self-hosted portfolio and client-proofing site for photographers and
videographers. Distributed publicly, so keep install-specific branding and
credentials out of the code — per-site identity comes from Settings > Header.

## Stack

- **Backend:** PHP (`index.php`) — single-file API handling all routes
- **Frontend:** Vanilla HTML/CSS/JS in `public/`
- **Server:** Apache/LiteSpeed on cPanel with `.htaccess` rewrite rules
- **No Node.js** — previously had an Express backend but fully migrated to PHP

## Project Structure

```
index.php              # All API routes (auth, galleries, uploads, proofing, collections, settings, header)
.htaccess              # Apache rewrites: /api/* -> index.php, static files from site-data/
public/
  index.html           # Public portfolio page
  admin.html           # Admin dashboard (galleries, settings, header config)
  proofing.html        # Client proofing gallery (token-based access)
  collection.html      # Collection landing page (groups of galleries)
  download.html        # Client delivery download page (/d/{token})
  portfolio.html       # Folder-backed portfolio pages (/portfolio/...)
  css/                 # Stylesheets (style.css, proofing.css, collection.css, download.css, portfolio.css)
  vendor/              # Vendored MIT libraries, no build step (PhotoSwipe 5)
  js/
    admin.js           # Admin UI logic
    public.js          # Public portfolio page logic
    proofing.js        # Client proofing page logic
    collection.js      # Collection page logic
    download.js        # Delivery download page logic
    portfolio.js       # Portfolio page logic (routing, tiles, PhotoSwipe)
    layouts.js         # Gallery layouts: justified, masonry, grid, slideshow
    media-stage.js     # Shared video player (controls strip, caption overlay, caption box)
    header.js          # Dynamic header rendering from /api/header config
    portfolio-admin.js # Admin Portfolio tab (categories, galleries, items)
tools/
  dev-router.php       # php -S router replaying .htaccess (local only; denied on the web)
site-data/             # Runtime data (gitignored)
  data/                # JSON data files (galleries, collections, settings, header, admin config, crc.json)
  uploads/             # Original uploaded files (photos + videos)
  thumbnails/          # 640px thumbnails (auto-generated)
  proxies/             # 2048px web-optimized images for lightbox (auto-generated)
  logo/                # Site logo image
  imports/             # FTP import staging directory
  packages/            # Delivery plans (manifest.json only — zips are streamed, never stored)
  portfolio/           # <Category>/<Gallery>/<files> — the portfolio itself (served at /media/)
  portfolio-trash/     # Portfolio folders and files deleted from the admin
```

## Key Concepts

- **Galleries** have a type: `reels` (portfolio) or `proofing` (client review)
- **Collections** have the same two types and group galleries of their own type
  under one shareable link. `proofing` collections are gated (password, expiry,
  commenting, inherited by member galleries); `reels` collections are public.
  Collections without a `type` are treated as `proofing`.
- **Delivery packages** hand a gallery or collection to a client as one link
  (`/d/{token}`, expires after 7 days). Creating one writes only a *plan* to
  `site-data/packages/{id}/manifest.json` — no zip is ever built on disk. The
  archive is streamed as the client downloads, STOREd (never deflated), which
  keeps the total size predictable enough to send a real `Content-Length`.
  **Every entry's CRC32 comes from the cache in `site-data/data/crc.json`,
  written at upload time.** This is the single most important thing about
  delivery performance: hashing bytes in PHP is CPU-bound, and CloudLinux caps
  CPU per account, so computing CRCs during a download collapsed throughput to
  12 MB/s on a live host while the same bytes without hashing moved at 102 MB/s
  (locally, removing the hash made the copy loop 47x faster). With CRCs known up
  front, local headers carry them, no data descriptors are needed, and entry
  bodies go disk-to-socket via `stream_copy_to_stream()` with no PHP loop.
  Never reintroduce per-byte work into that path. Files predating the cache are
  hashed by `POST /api/admin/crc-warm` with a `packageId`, which the delivery
  modal drives in the background — scoped to the delivery, never the library.
  Always Zip64, so there is one code path exercised by every download rather
  than a 64-bit path that only runs on rare large transfers.
  **The size limit that matters is LiteSpeed's `Max Dynamic Response Body Size`
  (1 GiB by default), not the zip format's.** Exceed it and LiteSpeed truncates
  the response and appends an HTML error, producing a zip with no
  end-of-central-directory that no unarchiver will open — and PHP cannot detect
  this mid-stream. Hence `PACKAGE_PART_MB` defaults to 900. Files that exist on
  disk go through `sendStaticFile()`. **Keep `SENDFILE=off`.** Both handoffs were
  measured on a live cPanel/LiteSpeed host on 2026-08-15 and neither is usable
  there: `X-LiteSpeed-Send-File` is ignored outright (0-byte downloads, and it
  discloses the server's absolute path), and `X-LiteSpeed-Location` delivers the
  bytes but drops `Content-Disposition`, so downloads open inline under the
  stored filename. Streaming measures ~102 MB/s on that host anyway. The working fast path is the file's
  ordinary static URL (`staticUploadUrl()`, exposed as `staticUrl` in the package
  payload and used by download.js): `/uploads/` is served straight off disk and
  measured ~100 MB/s on the same host where PHP streaming crawls. See the block comment above `PACKAGES_DIR` in
  `index.php` before changing any of this. The per-entry byte arithmetic lives
  in `zipEntryOverhead()`, used by both `zipStreamedSize()` and the part
  planner so they cannot drift; if it stops matching what the streaming route
  emits, `Content-Length` lies and every download truncates.
- **Portfolio** is folder-backed: `site-data/portfolio/<Category>/<Gallery>/`
  on disk is the source of truth, so a folder dropped in by FTP appears with no
  import. Metadata lives in dot-named sidecars (`.portfolio.json`,
  `.category.json`, `.gallery.json`) that the dotfile rule keeps off the web;
  they move with their folder, so an FTP rename keeps the slug and metadata.
  `portfolioTree()` reconciles disk with sidecars on every read; GD work never
  happens there. Thumbnails and proxies are built by `portfolioProcess()` in ~8s
  slices under a non-blocking lock (admin-driven via
  `POST /api/admin/portfolio/process`, or `php index.php portfolio:process` from
  cron), and a photo stays out of public payloads until it has a thumbnail.
  Files younger than `PORTFOLIO_SETTLE_SECONDS` are treated as still uploading.
  `<video>.poster.jpg` and `<video>.<lang>.vtt` beside a video are its poster
  and captions. Each gallery picks one of four layouts (`justified`, `masonry`,
  `grid`, `slideshow`) rendered by `layouts.js`; photos open in PhotoSwipe and
  videos in the shared `media-stage.js` player, which `public.js` uses too, so
  the caption overlay and caption box behave the same everywhere. A
  `{type:'portfolio'}` header nav entry is expanded server-side into the current
  categories, so the menu follows the folders. The admin splits into a
  **Portfolio** tab (`portfolio-admin.js`, folders and their contents) and a
  **Client delivery** tab (the existing library screen); the two share helpers
  through the `window.SDAdmin` bridge that `admin.js` exposes. Deleting anything
  in the portfolio moves it to `site-data/portfolio-trash/` — never `unlink`,
  since these are the owner's master files. Video posters are captured in the
  browser while the Portfolio tab is open, the same trick delivery uploads use.
- **The home page** is its own gallery in the reserved folder
  `site-data/portfolio/_home/`: it picks a layout like any gallery but has no
  category, no URL of its own and never appears in listings or the menu. `/`
  renders it, falling back to the reels grid (`renderReelsGrid()` in
  `public.js`) while it is empty, so an install that hasn't migrated keeps its
  old homepage.
- **Picks** let one file appear in several galleries: a gallery's sidecar
  `refs` map points at `{gallery, file}` elsewhere, and `portfolioResolveKey()`
  resolves each order entry to a header, a file of its own, or a pick. There is
  one file on disk and one thumbnail, so edits to the original show everywhere,
  while each pick keeps its own position, visibility and optional title and
  caption. A pick whose file is gone is flagged in the admin and skipped
  publicly. Video size and duration come from the MP4 header in pure PHP
  (`mp4VideoDimensions()`, `mp4DurationSeconds()`). The portfolio folders only
  serve media and `.vtt` — `.htaccess` refuses everything else there, since
  anything can arrive over FTP. Being replaced by this: `reels` galleries.
- **Items** in galleries can be videos or photos, plus section headers. A
  portfolio item may carry a `description` — the caption box rendered under the
  player by `caption-box.js`. It is a portfolio-only feature: the admin exposes
  the editor on `reels` galleries only, and the shared gallery page checks
  `gallery.type` before rendering it, so client proofing galleries are
  unaffected. Not to be confused with **captions**, which everywhere else in
  this codebase means WebVTT subtitle tracks in `site-data/captions/`.
- **Proxy images** (2048px JPEG) are generated alongside thumbnails for fast lightbox loading
- **Header config** is stored in `site-data/data/header.json` (logo, nav, contact
  fields, social links) and rendered by `header.js`. `PUT /api/settings/header`
  **merges**, because two panels write it: Settings > Header and the Portfolio
  tab's Site design.
- **Site design** (`site-data/data/theme.json`, returned inside `/api/header`)
  holds a colour preset (light/dark/warm), one accent, the header arrangement
  (bar/stacked/sidebar) and the contact line. `theme.js` loads in `<head>` on
  every public page and paints the saved palette before the first frame by
  setting the `--color-*` custom properties inline on `<html>`, so the whole
  site — portfolio, proofing, collection and download — follows one theme.
  `--color-white` is the surface role and themes repaint it; text on an accent
  button uses `--color-on-accent`, which never changes.
- **Admin credentials** are set via first-run setup wizard, stored in `site-data/data/admin.json`
- **SESSION_SECRET** is auto-generated on first run if not in `.env`

## API Routes

All routes are in `index.php`. Key patterns:
- `GET /api/header` — public header config
- `GET /api/videos` — public portfolio videos (reels gallery)
- `GET /api/portfolio`, `/api/portfolio/featured`, `/api/portfolio/c/{cat}`, `/api/portfolio/g/{cat}/{gal}` — folder-backed portfolio
- `GET /api/proofing/{token}` — client gallery data
- `GET /api/collections/{token}` — collection data
- `/api/admin/*` — authenticated admin endpoints (CRUD for galleries, videos, uploads)
- `/api/admin/portfolio/*` — portfolio folders: categories, galleries, items,
  posters, captions, headers, picks (`refs`), the home gallery, ordering, and
  `process` (derivative slices)
- `/api/auth/*` — login, logout, setup, check
- `/api/settings/*` — email, deploy config

## Development

No build step. Edit files directly. The site runs on cPanel with PHP — no local dev server needed unless testing locally with
`php -S localhost:8080 tools/dev-router.php`. The router replays `.htaccess`, which
`php -S` ignores; **keep the two in sync** when changing either.

Deploy via admin Settings > Update tab. Two auto-detected modes (`deployMode()` in
`index.php`): git installs fetch + hard-reset from GitHub; zip installs (no `.git`
dir or no shell access) download the latest GitHub Release zipball and overlay it —
no git binary or credentials required, but the repo must be public and versions
must be published as GitHub Releases (tag `vX.Y.Z`, matching the `VERSION` file).
