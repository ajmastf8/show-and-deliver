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
  css/                 # Stylesheets (style.css, proofing.css, collection.css, download.css)
  js/
    admin.js           # Admin UI logic
    public.js          # Public portfolio page logic
    proofing.js        # Client proofing page logic
    collection.js      # Collection page logic
    download.js        # Delivery download page logic
    header.js          # Dynamic header rendering from /api/header config
site-data/             # Runtime data (gitignored)
  data/                # JSON data files (galleries, collections, settings, header, admin config, crc.json)
  uploads/             # Original uploaded files (photos + videos)
  thumbnails/          # 640px thumbnails (auto-generated)
  proxies/             # 2048px web-optimized images for lightbox (auto-generated)
  logo/                # Site logo image
  imports/             # FTP import staging directory
  packages/            # Delivery plans (manifest.json only — zips are streamed, never stored)
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
  disk go through `sendStaticFile()`. **Do not enable the
  `X-LiteSpeed-Send-File` handoff by default** (`SENDFILE`): it is not active on
  every host, and when it isn't, the header is passed through to the client, PHP
  exits without a body, and every download silently arrives as 0 bytes — plus the
  server's absolute path is disclosed in a response header. Verified broken on a
  live cPanel/LiteSpeed host, 2026-08-15. The working fast path is the file's
  ordinary static URL (`staticUploadUrl()`, exposed as `staticUrl` in the package
  payload and used by download.js): `/uploads/` is served straight off disk and
  measured ~100 MB/s on the same host where PHP streaming crawls. See the block comment above `PACKAGES_DIR` in
  `index.php` before changing any of this. The per-entry byte arithmetic lives
  in `zipEntryOverhead()`, used by both `zipStreamedSize()` and the part
  planner so they cannot drift; if it stops matching what the streaming route
  emits, `Content-Length` lies and every download truncates.
- **Items** in galleries can be videos or photos, plus section headers
- **Proxy images** (2048px JPEG) are generated alongside thumbnails for fast lightbox loading
- **Header config** is stored in `site-data/data/header.json` and rendered by `header.js`
- **Admin credentials** are set via first-run setup wizard, stored in `site-data/data/admin.json`
- **SESSION_SECRET** is auto-generated on first run if not in `.env`

## API Routes

All routes are in `index.php`. Key patterns:
- `GET /api/header` — public header config
- `GET /api/videos` — public portfolio videos
- `GET /api/proofing/{token}` — client gallery data
- `GET /api/collections/{token}` — collection data
- `/api/admin/*` — authenticated admin endpoints (CRUD for galleries, videos, uploads)
- `/api/auth/*` — login, logout, setup, check
- `/api/settings/*` — email, deploy config

## Development

No build step. Edit files directly. The site runs on cPanel with PHP — no local dev server needed unless testing locally with `php -S`.

Deploy via admin Settings > Update tab. Two auto-detected modes (`deployMode()` in
`index.php`): git installs fetch + hard-reset from GitHub; zip installs (no `.git`
dir or no shell access) download the latest GitHub Release zipball and overlay it —
no git binary or credentials required, but the repo must be public and versions
must be published as GitHub Releases (tag `vX.Y.Z`, matching the `VERSION` file).
