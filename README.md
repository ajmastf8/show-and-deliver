# VideoReelSite

Self-hosted portfolio and client-proofing site for photographers and videographers.
A single-file PHP backend, no database, no build step — designed to run on ordinary
shared hosting (cPanel, Apache/LiteSpeed) with one-click in-app updates.

## Features

- **Portfolio reels** — a public page showcasing your video work
- **Client proofing galleries** — share a private, token-based link per client;
  optional password protection and expiry dates
- **Collections** — group multiple galleries under one shareable link, with
  collection-level password, download, commenting, and expiry settings that
  galleries inherit
- **Photos and videos** in the same gallery, with section headers, auto-generated
  thumbnails, and 2048px proxy images for a fast lightbox
- **Client comments** with email notifications (Resend or SMTP)
- **Downloads** — per-file or whole-gallery zip, with download tracking and view counts
- **Captions** — multi-language WebVTT support; captions embedded in MP4s are
  extracted automatically (one-click static ffmpeg installer for hosts without it)
- **Import from server** — stage large files over FTP/SFTP and import them,
  bypassing web upload limits
- **Upload API** — token-authenticated endpoint for third-party tools, with
  chunked resumable uploads (see [docs/API.md](docs/API.md))
- **In-app updates** — an Update button in the admin checks GitHub for new
  releases and installs them; no shell access needed

## Requirements

- PHP 8.0+ with the `zip` extension (`curl` recommended)
- Apache or LiteSpeed with `.htaccess` support (`mod_rewrite`)
- No database, no Node.js, no composer — runtime data is stored as JSON files

## Install

### From a release (recommended)

1. Download the source zip of the [latest release](https://github.com/ajmastf8/VideoReelSite/releases/latest).
2. Extract it into the document root of your domain or subdomain.
3. Visit `https://your-domain.com/admin` and follow the first-run setup wizard
   to create your admin account.

That's it. The `site-data/` directory (galleries, uploads, settings) is created
automatically on first run.

### From git

```bash
git clone https://github.com/ajmastf8/VideoReelSite.git
```

Point your document root at the checkout and visit `/admin` as above. Git
installs update via `git fetch` + hard reset instead of release zips (the mode
is auto-detected).

## Updating

Admin → Settings → Update shows the installed and latest versions with release
notes. One click updates in place. Updates never touch `site-data/` or `.env`,
so your galleries, uploads, and settings are safe. To update by hand, extract a
newer release zip over the install directory.

## Configuration

Everything is configurable from the admin UI (email notifications, site header,
API token, deploy settings). A `.env` file is optional — copy
[.env.example](.env.example) for the available overrides.

## Data and backups

All runtime state lives in `site-data/`:

```
site-data/
  data/         # gallery, collection, and settings JSON
  uploads/      # original photos and videos
  thumbnails/   # auto-generated 640px thumbnails
  proxies/      # auto-generated 2048px lightbox images
  captions/     # WebVTT caption files
```

Back up `site-data/` (plus `.env` if you created one) and you have everything.

## Local development

The app expects Apache/LiteSpeed rewrites from [.htaccess](.htaccess) (`/api/*`
routed to `index.php`, static files served from `public/` and `site-data/`).
There is no bundled dev server; for local testing, run it under any web server
that honors `.htaccess`, or write a small router script for `php -S` that
mimics those rewrites.

## License

[MIT](LICENSE)
