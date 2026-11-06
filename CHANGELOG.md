# Changelog

## 2.5.11 — 2026-11-06
- **A client gallery now updates itself as files arrive — no clicking required.** The live refresh added in 2.5.7 only offered a "Gallery updated — Refresh" notice; it did not actually bring the new files in. An open gallery now re-renders the new items the moment they land. If the viewer is busy — in the lightbox, or part-way through a comment — it holds off and shows the refresh notice instead, so the page is never rearranged under them. Either way the notice sits at the top of the page now, not the bottom.
- **Delete many items at once in a client gallery.** The gallery screen in the admin has a **Select** button. Turn it on and each row shows a checkbox: click rows (shift-click for a run), use **Select all**, then **Delete** to remove the batch in one go, with a single confirmation. Press **Esc** or **Done** to leave. Deleting many photos no longer means clicking × on each one in turn.

## 2.5.10 — 2026-11-06
- **Page assets now version themselves, so a shipped change can't hide behind a browser cache again.** Every page loaded its CSS and JS with a hand-typed number (`proofing.js?v=14` and the like) that had to be bumped by hand whenever the file changed; miss it and a browser keeps running the old script even though the new one is on the server — which is exactly what made 2.5.7's live refresh and sort bar look dead on 2.5.9. The pages are now rendered by the server, which stamps each asset's real last-modified time onto its URL, so the number changes the moment the file does. Nothing to remember, nothing to drift. This is the last release that needed a manual asset bump.

## 2.5.9 — 2026-11-06
- **Fixed: the client-page live refresh and sort control could appear not to work.** Both live in `proofing.js` and `proofing.css`, which the gallery page loads with a cache-busting `?v=` number. 2.5.7 and 2.5.8 changed those files without moving the number, so a browser that had already visited a gallery kept serving the old script from its cache — the update was on the server, but the page still ran the previous version, with no live refresh and no sort bar. The version numbers are bumped (`proofing.js?v=15`, `proofing.css?v=14`), so every visitor gets the new code. If a gallery still looks stale after updating, one hard refresh (or a private window) clears any copy cached from before.

## 2.5.8 — 2026-11-06
- **Client galleries open newest-first by default.** The viewer sort control added in 2.5.7 started on your saved "Gallery order"; it now starts on Arrival, newest first, so a client opening a delivery sees the most recently added files at the top straight away. Their choice is still only theirs — the gallery's saved order is untouched — and "Gallery order" brings it back and sticks for that visit, even across a reload. Switching to Name starts A–Z; the date fields start newest-first.

## 2.5.7 — 2026-11-06
- **A client gallery that's being added to now updates itself, without a reload.** Previously only FTP watch folders could tell an open gallery page that new files had arrived; an upload through the admin or the API was invisible until the client refreshed by hand. Any gallery changed in the last half hour now counts as live, so an open page offers the "Gallery updated — Refresh" banner within 30 seconds of a new arrival. It also re-checks whenever the tab regains focus, so a client who was sitting on a quiet gallery and comes back after you uploaded sees it straight away. Once a gallery goes quiet the polling stops on its own, so a delivered gallery isn't asking forever.
- **Clients can sort a gallery for themselves — Name, Arrival or Creation, each direction.** A sort bar above the grid lets the viewer reorder by file name (A–Z / Z–A), date added (Arrival), or capture time from EXIF / recorded date (Creation), and reverse it. Their choice is their own for the visit — it never changes the order you saved in the gallery settings, and "Gallery order" puts it back. Section headers stay put; items sort within them. Capture time falls back to date added for files that don't carry a date.

## 2.5.6 — 2026-11-06
- **Fixed: API uploads showed as "Untitled" instead of the file's name.** The upload API only used a title a client sent explicitly, so any client that omitted it — skipping `-F title=...` on the multipart item upload, or the `"title"` field on the chunked-upload finalize call — left every photo and video named "Untitled" in the gallery. When no title is sent, the server now derives one from the uploaded file's name, the same way the admin uploader and the import folder already do: extension and timestamp prefix stripped, underscores and dashes turned into spaces (`IMG_4821.jpg` → `IMG 4821`). A title you do send is still used exactly as sent.

## 2.5.5 — 2026-11-06
- **Fixed: the Recent rail now sorts strictly newest first, mixing collections and galleries.** It previously listed every recent collection above every recent gallery, so a gallery made an hour ago could sit below a collection from last week. The one list is now ordered by creation date alone, newest at the top.

## 2.5.4 — 2026-11-06
- **New: a Recent section at the top of the Client delivery rail.** Collections and galleries created in the last five days are listed above the Library and Client delivery sections, newest first, collections before galleries. A just-made delivery is one click away — pick a recent collection to open its list, or a recent gallery to open it straight away. The section stays out of the way when nothing is new.

## 2.5.3 — 2026-11-06
- **Fixed: the logo showed twice in the header on collection and delivery pages.** When two logos are set — one for light backgrounds and one for dark — both were drawn stacked instead of one being swapped by the theme, because the rule that hides the unused one was only in a stylesheet those two pages don't load. The swap rule now lives in the shared theme stylesheet, so the header shows a single logo everywhere.
- **Fixed: a replaced logo could stay invisible for up to a week.** Logo images are cached in the browser for seven days, and a fresh upload kept the same URL, so the old image kept showing until the cache expired. Logo URLs now carry a version taken from the file's timestamp, so a replacement appears immediately.

## 2.5.2 — 2026-11-04
- **Fixed: a gallery created from inside a collection wasn't added to it.** Making a gallery from the New menu while looking at a collection left "Add to Collection" on "— None —", so the gallery landed ungrouped. That scope now preselects the collection you are in, and you can still change or clear it.
- **Fixed: the Downloads and Commenting switches were ignored when you picked a collection.** Choosing a collection made the new gallery inherit the collection's settings, which hid those switches and quietly discarded any you had already turned on. If you set either one, the gallery now keeps your choice instead of falling back to the collection's.

## 2.5.1 — 2026-10-26
- **Fixed: the per-item Download button was missing in the client gallery viewer on Android Chrome.** The full-screen viewer was sized with `100vh`, which on mobile is the *large* viewport — the height with the browser's toolbars retracted — so while the address bar was showing the viewer extended below the screen and its bottom title bar (where Download sits) was cut off. It now uses `100dvh`, which tracks the visible viewport. "Download All" in the gallery header was never affected, which is why only the in-viewer button appeared to be gone.

## 2.5.0 — 2026-10-26
Client delivery galleries get a block of per-gallery options in Settings (not inherited from collections).
- **Order.** Show items in your own drag order, or sorted by file name (natural order, so `IMG_2` comes before `IMG_10`), capture time (from the photo's EXIF, or a video's recorded date; ascending or descending) or date added. Section headers keep their place. The client page, Download All and delivery zips follow it, and the admin item list shows the order with dragging turned off while a sort is active. Capture times are recorded at upload; older galleries get theirs filled in the first time they are needed.
- **Favorites.** Clients heart photos, up to an optional limit, and press Send my picks. You get an email with the file names and any note, and a new Favorites tab in the gallery drawer lists each visitor's picks with Copy file names (paste into Lightroom's filter) and Clear. Picks are private to the visitor's browser until sent, can be changed and re-sent, and need no account.
- **Download as.** Originals, web size (the 2048px JPEG of each photo, far smaller), or let the client choose, for single downloads and Download All. Videos are always the original.
- **Watermark previews.** Stamps the site watermark on thumbnails and the viewer, generated once per photo and kept. Downloads stay clean. It deters casual saving; it does not make previews un-fetchable.
- **Show file names.** Turn off to hide titles and camera file names from the client page.
- **Cover.** Choose a gallery's cover with the star next to any item; it shows in the library and in collections.
- **Activity.** The drawer shows views, whole-gallery and single downloads, the last download, and the most recent downloads with file names and size, plus how many visitors sent favorites.

## 2.4.1 — 2026-10-25
- **The admin now works on a phone.** Below 1100px the library list was a blank screen (its sidebar left the layout but the list was still placed in a zero-width column), and the Portfolio tab had no way to open its sidebar at all. Both are fixed: the ☰ button opens whichever tab's sidebar as a slide-over with a scrim, and picking something closes it. On phones the top bar becomes two rows with the account links (Uploads, theme, password, logout) in a ⋯ menu; the gallery list shows name, items and access; row checkboxes, favorite stars and open links are always visible on touch screens instead of appearing on hover; the bulk bar fits the width and scrolls sideways; dialogs open as bottom sheets with link/copy button rows wrapping under their fields; the upload queue, drawer, preview player and portfolio grids reflow; and form fields are 16px so iOS no longer zooms in when you tap one.

## 2.4.0 — 2026-10-23
- **Galleries can watch an FTP folder and fill themselves.** Give a client gallery an FTP import folder (when you create it, or later in its settings) and anything uploaded to that folder under `site-data/imports/` is moved into the gallery automatically — photos and videos alike, with thumbnails, proxies and delivery checksums made as usual. It runs while someone has the gallery open (the client's page, or the gallery in admin), so there is nothing to set up on the server; reopening a gallery later picks up whatever arrived in the meantime. Files still being uploaded are left alone until they stop growing, and unreadable images are set aside in a `_failed` folder. A client with the gallery open sees a "Gallery updated" banner with a Refresh button when new items land.
- Importing from the server by hand now registers files the same way as every other upload, so manually imported files get their delivery checksums up front too.

## 2.3.7 — 2026-10-22
- **Captions can now be uploaded as SRT as well as WebVTT, and the Captions dialog has a drop area.** An `.srt` file is converted to WebVTT on upload (no ffmpeg needed), so the player and delivery packages still only ever see `.vtt`. Drop a `.vtt` or `.srt` onto the dialog, or choose one, then pick a language and click Add Caption.

## 2.3.6 — 2026-10-18
- **Removed the scrollbar under the horizontal-scroll layout.** It showed as a bright bar in dark mode. The strip still scrolls by wheel, drag, swipe and arrow keys.

## 2.3.5 — 2026-10-18
- **Fixed: the home page could sit blank for seconds, or tens of seconds, on a busy host.** `/api/header`, `/api/portfolio` and `/api/portfolio/home` rescanned the portfolio folders on every request, which is slow when the host caps CPU, and the page drew nothing until they answered. Their JSON is now cached for 60 seconds (cleared immediately by any change made through the API; folders dropped in over FTP appear within the minute), and one request rebuilds an expired copy while everyone else keeps getting the old one. The browser also paints the header and home page from the copy it saved on the last visit and swaps in the server's only if it changed, and a first-ever visit shows a placeholder instead of a blank page.
- **Slow requests can now be traced.** Every API response carries a `Server-Timing` header (boot, cache or build, total; `X-Api-Cache` says hit, miss or stale), and any request over 500 ms is appended to `site-data/data/slow-requests.log` (capped at 256 KB).

## 2.3.4 — 2026-10-17
- **Creating a client gallery now says why it failed, and two ways of creating one no longer fail on sites that still have old portfolio data.** The New gallery dialog used to show only "Create failed" whatever the server answered; it now shows the server's own message (or the HTTP status), signs you back in if the session had expired, and warns if the gallery was made but couldn't be added to the chosen collection. Pressing **+ Gallery** under a leftover portfolio collection (one from before the portfolio moved to folders) used to do nothing at all, and **Duplicate** on a leftover portfolio gallery was refused with no message; the first now opens the dialog with no collection preselected and the second makes a client gallery copy and reports any refusal.

## 2.3.3 — 2026-10-17
- **Faster first paint, most noticeably in Safari.** Pictures now decode off the main thread (`decoding="async"`) so large images no longer stall painting and scrolling, and the first few pictures on a page load eagerly with the first at high priority instead of waiting for the lazy loader (the rest stay lazy). The page also starts fetching what it needs sooner: the script imports and the header and home-page data are requested from the page head, so they download while the main script is still loading instead of after it.

## 2.3.2 — 2026-10-16
- **The old client-delivery API paths work again, as deprecated aliases.** 2.3.0 renamed them with no fallback, which broke Deadline Editor (its Test Connection answered "404 Not found") and would break any cached page. The old paths (`/api/galleries`, `/api/collections`, `/api/admin/galleries/{id}/videos`, `/api/proofing/…`, `/api/packages/…`, and the rest) are now translated to the new ones, the old multipart field `video` and the `videos` response key still work, and a finalize with no `target` is accepted. Every aliased response carries an `X-API-Deprecated` header naming the new path. They will be removed once the app has moved; `GET /api/videos` stays gone.

## 2.3.1 — 2026-10-16
- **Generating an API token now tells you where to use it.** The Settings → API panel has a **Site URL** (with a Copy button) at the top, and the one-time "Your new API token" dialog shows it above the token. It is just the site's address, with no `/api` or path, because tools add the paths themselves and one that was given `…/api/admin/portfolio` answered 404.

## 2.3.0 — 2026-10-16
- **The API now says which system a route belongs to, and treats both the same way. This is a breaking change: the old paths return 404 and there are no aliases.** Client delivery lives under `/api/admin/client/…` (admin) and `/api/client/…` (what a client's browser calls); the portfolio stays under `/api/admin/portfolio/…` and `/api/portfolio/…`. Items, captions, posters, headers and ordering are named the same on both sides (`…/items/{id}`, `…/items/{id}/poster`, `…/order`), the multipart upload field is `file` on both, and gallery responses carry `items` instead of `videos`. Chunked uploads finalize with `{"target": "client" | "portfolio", "galleryId": "…"}` instead of picking a system by which field you sent. `docs/API.md` is rewritten to cover both, with a table of every renamed route.
- **Removed the legacy public portfolio feed.** `GET /api/videos`, the `reels` gallery type for new galleries, and the old homepage fallback grid are gone. An install that never migrated its reels galleries into folders shows an empty home page until it does (Portfolio tab, migration).

## 2.2.13 — 2026-10-16
- **Fixed: galleries filed under a top-level gallery vanished into a dead end.** A gallery sitting at the top of the Image Library holds pictures only, but nothing stopped you creating or moving a gallery *inside* one. The folder was made, then couldn't be found again, so opening, saving or changing its access all answered "Gallery not found". The server now refuses it with an explanation (use New collection and add galleries to that), the Location picker no longer offers top-level galleries as a destination, and an empty top-level gallery no longer offers "make it a collection". Galleries in collections and categories behave as before.

## 2.2.12 — 2026-10-16
- **Private galleries in a collection get their own section.** Open a collection in the admin and its public galleries are listed first, followed by a **Private** divider (with a count) and the private galleries underneath, the same way hidden pictures sit under **Hidden** in a gallery. It's a display grouping only: the stored order and what visitors see are unchanged, and making a gallery public moves it back up. Drag-to-reorder applies to the public galleries; private ones keep their place.

## 2.2.11 — 2026-10-16
- **Fixed: the From address (and anything else with quotes in it) looked blank after saving.** A value like `"AJ Mast" <aj@ajmast.com>` was saved correctly but the settings form drew it as an empty field, so it appeared not to save, and the next Save Email Settings would have erased it. The shared HTML-escape helper now escapes quotes as well, in the admin, header, collection, proofing and public pages, which also protects titles and alt text containing quotes from breaking their attributes.

## 2.2.10 — 2026-10-16
- **Login is more forgiving and more honest.** The email is no longer case-sensitive and ignores stray spaces, so `Name@Site.com` signs in as `name@site.com`. The login page now shows the real reason when it isn't a wrong password (for example the five-tries-a-minute lockout, which used to read "Invalid credentials").
- **`admin:reset-password` now proves it worked.** After saving, it reads the account back the same way the login page does and prints the file's path, owner and permissions, and says so if the web server might not be able to read it.

## 2.2.9 — 2026-10-16
- **Fixed: the password reset email could silently never arrive.** A reset link was only sent when you typed the exact admin login address, with no hint if you used a different one, and a mail-server failure was swallowed while the page still said the link was on its way. Either admin address now works (the login email, or the notification address from Settings > Email, which the contact form uses), the link goes to the one you typed, and a send failure is logged and shown on the page with the mail server's reason.

## 2.2.8 — 2026-10-15
- **You can now recover and change the admin password.** The login page has a **Forgot password?** link that emails a one-hour, single-use reset link to the admin address (it needs email set up under Settings, with a real Base URL). A **Password** link in the top bar changes it from inside the app. Either way, every other signed-in browser is signed out, so resetting a password you suspect is compromised actually locks the other party out.
- For sites that can't send email, `php index.php admin:reset-password [new-password]` resets it from the command line (it prints a random one if you don't give one). Run it as the same user the web server runs as, so the account file stays writable.
- Installs still using `ADMIN_PASSWORD` in `.env` move to the in-app account the first time the password changes.

## 2.2.7 — 2026-10-15
- **Faster first load.** The public site no longer starts a PHP session for every visitor and bot. Sessions begin only when you log in or unlock a protected gallery (or already carry a session cookie), and read-only requests release the session lock immediately, so the header and portfolio data load in parallel instead of queuing. Old session files are pruned automatically (at most once a day) when someone logs in or unlocks a gallery.
- The Google Fonts stylesheet no longer blocks the first paint; the page shows in the fallback font until Open Sans arrives.

## 2.2.0 — 2026-10-09
- **Duplicate files can be linked instead of copied.** A new **Duplicates** panel in the Portfolio tab finds files that exist byte-for-byte more than once across the portfolio, nested collections included, and lets you keep one and turn the rest into **picks** of it — the picture shows in every gallery while the bytes live in one place. Files are grouped on size first, so only genuine candidates are hashed; nothing is deleted (copies move to `site-data/portfolio-trash/`) and any title or caption on a copy carries onto the link. This is the app-level answer to "one picture, many galleries" — picks rather than symlinks, so identity and metadata stay shared and nothing breaks across FTP, backups or zips.

## 2.1.0 — 2026-10-09
- **Galleries can be viewed two ways, switched in place.** Any gallery with pictures now carries a Grid / Fullscreen toggle above it: the visitor flips between a scanning grid and an immersive strip without a page reload. The choice rides in the URL (`?view=`) so a shared link opens the way it was sent, and is remembered per visitor. Both views are one of the gallery's existing layouts, so nothing about how layouts are stored changed.
- **Credits show in the immersive layouts.** The caption box that already rendered in the slideshow and the lightbox now appears in the fullscreen and horizontal (filmstrip) views as a small credit over the picture, matching the ajmast.com reference. The scanning views still leave credits to the lightbox.
- **Search on the all-work index.** A search box narrows the gallery covers by title and category, and composes with the category filter bar rather than replacing it; a category heading hides when nothing under it matches and an empty result says so.
- **Galleries can contain other galleries.** A folder inside a gallery makes it a collection: it lists its child galleries as cover cards and can still hold its own pictures. Nesting is recursive, URLs follow the path (`/portfolio/weddings/smith-jones/set-a`), and the public page shows a breadcrumb. Existing flat installs are unchanged. In the admin a collection gains a Sub-galleries section (open, create, reorder), and a gallery's Location control moves it to the top level of any category or inside another gallery — a gallery can never be moved into itself.
- **A readiness gate in the Portfolio tab.** A pre-launch checklist (structure, presentation, editorial, performance) is summarised in the browse header and the rail, with the detail in a Readiness panel, and the gallery editor shows the same advice in place. Advisory only — it reports, it never blocks publishing.
## 1.6.8 — 2026-09-22
- **Fixed: Delete did nothing on a portfolio gallery, with no explanation.** The server refused to delete your last portfolio gallery, but the admin ignored the refusal entirely — no message, no error, the gallery just stayed put, so Delete looked like a dead button. A delete that the server turns down now tells you why.
- **You can delete your last portfolio gallery.** The old rule was protecting nothing: the public portfolio page already copes with having no portfolio gallery (it just shows nothing), and you could reach the same state anyway by switching your only portfolio gallery inactive. A gallery you created by accident has to be removable. Deleting the last one now warns that the public portfolio page will be empty until you make another, rather than refusing — and New > Portfolio makes another whenever you want.

## 1.6.7 — 2026-09-22
- **Share links can be set by hand.** Galleries and collections now have an Edit button next to Regenerate, so a link that was regenerated by accident can be typed straight back to the one your client already has — no more dead link once it's gone out. It also means you can choose a readable link like `/gallery/smith-wedding` instead of the generated one. Links must be 6-64 characters of letters, numbers, dashes and underscores, and two galleries (or two collections) can't share the same one.
- Regenerating a link now warns properly before it happens: it says the current link will stop working for anyone you've already sent it to, and points out that Edit can put it back if you note it down first.

## 1.6.6 — 2026-09-22
- **Galleries can be renamed.** Settings for a gallery now has a Name field, so a gallery created as "Client Gallery" during an upload doesn't have to keep that name forever. Renaming changes nothing else — the share link, the files and the client's view all stay exactly as they were. Works on portfolio galleries as well as client ones.

## 1.6.5 — 2026-09-15
- **Security fix: private site data could be downloaded directly.** On Apache and LiteSpeed any file that exists on disk is served as-is, and only delivery packages were blocked. Anyone who knew the paths could fetch `site-data/data/` — the admin password hash, login sessions, the session secret, the API token, and the gallery and collection files with their share links and password hashes — along with FTP imports in `site-data/imports/`, your `.env`, and `.git/` on git installs. On hosts with directory listings turned on, `/uploads/` also listed every client's files. All of these now return 403. **Update now, then rotate the API token in Settings and change the password on any gallery or collection where it matters** — there's no way to tell from the app whether these files were ever downloaded. Where a share link itself is sensitive, regenerate it too.
- `site-data/` is now an allowlist: only uploads, thumbnails, proxies, captions and the logo are public, and directory listings are refused anywhere under it. Dotfiles and root-level docs are denied too. As a second line of defence for hosts that ignore the root `.htaccess`, `data/` and `imports/` get their own deny-all guard file automatically, the way `packages/` already did.

## 1.6.4 — 2026-08-15
- **"Download all" in a client gallery now works the same way a delivery link does** — the server streams the zip instead of the browser building it. Previously your client's own computer had to checksum every byte, and on Safari, Firefox and Chrome-on-macOS the entire archive was held in memory before saving, which fell over on large galleries. Caption files still travel with their videos. Large galleries arrive as numbered parts, each a self-contained zip, for the same server response limit that applies to deliveries.
- Added an optional `X-LiteSpeed-Location` handoff (`SENDFILE=location`), which lets the web server deliver files directly and frees the PHP process immediately — useful against the concurrent-connection limits on shared hosting. Off by default, and there's now `/api/admin/sendfile-test` to check whether your host supports it before switching it on, since the failure mode is a silent empty download.
- Fixed `PACKAGE_PART_MB` in `.env` being ignored — the setting was read before the `.env` file was loaded, so it always used the default of 900 MB.

## 1.6.3 — 2026-08-15
- Files are now prepared for full-speed download when you actually send them, rather than by grinding through your whole library in the background. Opening the delivery modal hashes just that delivery's files while you fill in the form — usually instant, since anything uploaded recently was hashed on arrival. On a library of a few thousand files the old behaviour could run for hours to send three of them.

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
