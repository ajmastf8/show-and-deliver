# Show & Deliver API

Everything the admin does is available over HTTP, so a script, a CLI or an app
can create galleries, set their options and upload photos or multi-GB videos.

There are **two separate systems** behind one API, and every route says which
it belongs to:

| | **Portfolio** | **Client delivery** |
|---|---|---|
| Purpose | Your public work | Private galleries and collections for clients |
| Public URL | `/portfolio/...` | `/gallery/{token}`, `/collection/{token}`, `/d/{token}` |
| Storage | Folders on disk (`site-data/portfolio/`) with `.gallery.json` sidecars | JSON records (`galleries.json`, `collections.json`) plus `site-data/uploads/` |
| IDs | `pc_…` (category), `pg_…` (gallery) | `g_…` (gallery), `col_…` (collection), `p_…`/`v_…` (item) |
| Shape | Category, then gallery or collection, nested to any depth | A gallery, optionally inside a collection |
| Admin routes | `/api/admin/portfolio/...` | `/api/admin/client/...` |
| Public routes | `/api/portfolio/...` | `/api/client/...` |

Everything else (auth, uploads, settings, pages, import/export) is shared and
lives directly under `/api/`.

## Authentication

There are two ways to set a token:

**Preferred — the admin UI.** Open `Settings → API`, click **Generate
Token**. The token is shown once; copy it and save it somewhere safe. The
token is stored at `site-data/data/.api-token` (mode 0600) and can be
rotated or revoked from the same panel. Nothing is written to `.env`.

**Alternative — `.env`.** For installs managed via config files:

```bash
# Generate a 64-character random token
php -r 'echo bin2hex(random_bytes(32));'

# Paste it into .env
API_TOKEN=<the generated hex string>
```

If both are set, `.env` wins. If you're using `.env`, the admin UI panel
will show "Set via .env" and disable the buttons.

Every admin request includes the token as a Bearer header:

```
Authorization: Bearer <API_TOKEN>
```

Requests without a valid token get `401 Unauthorized`. With no token set
anywhere, the Bearer path is disabled entirely.

Rate limit: 60 authenticated requests per minute per client IP. Beyond that you
get `429 Too many attempts`.

Public routes (`/api/portfolio/...`, `/api/client/...`, `/api/header`,
`/api/pages/...`, `/api/contact`) need no token. Client routes are gated by the
gallery, collection or package token in the URL, and by its password when set.

## Common envelope

All JSON bodies use `Content-Type: application/json`. Successful responses
return the created or updated record. Errors return:

```json
{ "error": "Human-readable message", "detail": "optional extra info" }
```

with an appropriate 4xx / 5xx status.

## Same verbs on both sides

Items, headers, ordering and uploads are named the same way in both systems, so
one client can drive either. Only the prefix and the id of the thing you address
change.

| Operation | Client delivery | Portfolio |
|---|---|---|
| Add a file (multipart field `file`) | `POST /api/admin/client/galleries/{gid}/items` | `POST /api/admin/portfolio/galleries/{gid}/items` |
| Update an item | `PUT …/galleries/{gid}/items/{iid}` | `PUT …/galleries/{gid}/items/{file}` |
| Delete an item | `DELETE …/galleries/{gid}/items/{iid}` | `DELETE …/galleries/{gid}/items/{file}` |
| Set a video's poster image (raw JPEG/PNG body) | `PUT …/items/{iid}/poster` | `PUT …/items/{file}/poster` |
| Add a caption track (WebVTT) | `POST …/items/{iid}/captions` | `POST …/items/{file}/captions` |
| Delete a caption track | `DELETE …/items/{iid}/captions/{lang}` | `DELETE …/items/{file}/captions/{lang}` |
| Add / rename / delete a section header | `POST`, `PUT`, `DELETE …/galleries/{gid}/headers[/{hid}]` | same |
| Reorder | `PUT …/galleries/{gid}/order` with `{"order": [...]}` | same |
| Gallery record includes | `items` | `items` |

An item is addressed by its `id` on the client side and by its file name on the
portfolio side, because a portfolio gallery is a folder and the file *is* the
identity.

## Uploads

Both systems share one upload flow so multi-GB videos can pass `post_max_size`.
Small files can skip it and POST multipart straight to `…/items` (above).

```
POST   /api/admin/uploads                       # start a session
PUT    /api/admin/uploads/{uploadId}/chunk      # send one slice
POST   /api/admin/uploads/{uploadId}/finalize   # attach it to a gallery
DELETE /api/admin/uploads/{uploadId}            # cancel
```

**1. Start.**

```bash
curl -X POST https://your.host/api/admin/uploads \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"filename":"main_keynote.mp4","totalSize":2147483648,"contentType":"video/mp4"}'
```

```json
{ "uploadId": "a1b2c3...", "chunkMaxBytes": 52428800, "totalSize": 2147483648 }
```

`chunkMaxBytes` (currently 50 MB) is the per-chunk cap you must respect.

**2. Send each chunk.** Raw `PUT` of bytes `start..end` (inclusive) with
`Content-Range: bytes start-end/total`. Chunks must arrive in order; if you
crash, start a new session.

```bash
dd if=main_keynote.mp4 bs=1048576 count=50 skip=0 | \
  curl -X PUT "https://your.host/api/admin/uploads/$UPLOAD_ID/chunk" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Range: bytes 0-52428799/2147483648" --data-binary @-
```

```json
{ "received": 52428800, "totalSize": 2147483648, "complete": false }
```

**3. Finalize with a `target`.** `target` says which system the file goes to and
is required; `galleryId` is that system's gallery id.

```bash
# Client delivery gallery
curl -X POST https://your.host/api/admin/uploads/$UPLOAD_ID/finalize \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"target":"client","galleryId":"g_xxx","title":"Main Keynote"}'

# Portfolio gallery
curl -X POST https://your.host/api/admin/uploads/$UPLOAD_ID/finalize \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"target":"portfolio","galleryId":"pg_xxx"}'
```

- `target: "client"` returns the new item record. `title` is optional — omit it
  and the server derives one from the uploaded file's name (extension and any
  timestamp prefix stripped, `_`/`-` turned into spaces: `IMG_4821.jpg` →
  `IMG 4821`) instead of naming the item "Untitled".
- `target: "portfolio"` files the upload into the gallery's folder under its own
  name and returns `{ ok, file, photoshelter, gallery }`. Thumbnails and
  proxies are made by the background processor (`POST /api/admin/portfolio/process`).
- A missing or unknown `target` is a `400`.

Abandoned sessions are cleaned up automatically after 24 hours.

---

# Client delivery

Private galleries and collections for clients, shared by link.

## Collections

```
GET    /api/admin/client/collections            # list
POST   /api/admin/client/collections            # create
PUT    /api/admin/client/collections/{id}       # update
DELETE /api/admin/client/collections/{id}       # delete
```

```bash
curl -X POST https://your.host/api/admin/client/collections \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Kelley Dec 2026"}'
```

The response includes the server-assigned `id`, `token`, `createdAt`, `active`
and defaults for settings. Any of these can be updated:

```json
{
  "name": "string",
  "galleryIds": ["g_...", "g_..."],
  "password": "plaintext (will be bcrypted) or null to clear",
  "downloadsEnabled": true,
  "commentingEnabled": false,
  "expiresAt": "2026-12-31T23:59:59Z",
  "active": true,
  "sortOrder": "custom | newest | oldest | alpha",
  "token": "my-own-link",
  "regenerateToken": true
}
```

`galleryIds` is replace-style, not additive: pass the full list you want.
Password, expiry, downloads and commenting are inherited by member galleries
unless a gallery overrides them (`overrideCollectionSettings`).

`token` sets the share link by hand (6–64 characters of letters, numbers, `_`
and `-`; a token already used by another collection is refused). It exists so a
link regenerated by accident can be put back.

## Galleries

```
GET    /api/admin/client/galleries              # list
POST   /api/admin/client/galleries              # create
PUT    /api/admin/client/galleries/{id}         # update
DELETE /api/admin/client/galleries/{id}         # delete
```

```bash
curl -X POST https://your.host/api/admin/client/galleries \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"20260418_KIMWA","downloadsEnabled":true,"commentingEnabled":false}'
```

A client gallery is always type `proofing`; sending any other `type` is a
`400`. Portfolio galleries are created with `POST /api/admin/portfolio/galleries`.

Attach a gallery to a collection with the collection's `galleryIds` (above).

### Gallery options

These belong to the gallery itself and are never inherited from a collection.
Send any of them to `POST` or `PUT` a gallery:

| Field | Values | Meaning |
|---|---|---|
| `sort` | `{"by": "custom\|name\|captured\|added", "dir": "asc\|desc"}` | How clients (and the admin list) see the items. `custom` is your drag order; `name` is the uploaded file name in natural order (`IMG_2` before `IMG_10`); `captured` is the EXIF date, or a video's recorded date, falling back to when it was added; `added` is upload time. Section headers keep their place and items sort within each section. |
| `downloadMode` | `original` (default), `web`, `both` | What a client downloads. `web` is the 2048px JPEG of each photo; videos are always the original. With `both` the client picks, and the page asks. |
| `selection` | `{"enabled": true, "limit": 0}` | Lets clients mark favorites and send them to you. `limit` caps how many (0 means no cap). |
| `watermark` | `true` / `false` | Stamp the site watermark (Portfolio > Site design) on the thumbnails and the viewer. Downloads are not marked. |
| `showTitles` | `true` (default) / `false` | `false` blanks titles and file names on the client page. |
| `coverId` | an item id, or `""` to clear | The item whose thumbnail represents the gallery in lists and collections. Default is the first item in the gallery's sort order. |

Capture times are recorded as each file is uploaded. Galleries that predate
this get them filled in the first time something asks (the first
`sort: captured` request, or opening the gallery in the admin), without
changing the gallery's version marker.

```
GET    /api/admin/client/galleries/{gid}/activity           # views, downloads, recent downloads, favorites sent
GET    /api/admin/client/galleries/{gid}/selections          # what each visitor picked, with file names
DELETE /api/admin/client/galleries/{gid}/selections/{clientId}
```

## Items

```
GET    /api/admin/client/galleries/{gid}/items                       # items + stats
POST   /api/admin/client/galleries/{gid}/items                       # add a file (multipart, field "file")
PUT    /api/admin/client/galleries/{gid}/items/{iid}                 # update title, visible
PUT    /api/admin/client/galleries/{gid}/items/{iid}/replace         # replace the file (multipart)
PUT    /api/admin/client/galleries/{gid}/items/{iid}/poster          # video poster (raw JPEG/PNG, max 10 MB)
POST   /api/admin/client/galleries/{gid}/items/{iid}/captions        # WebVTT track
DELETE /api/admin/client/galleries/{gid}/items/{iid}/captions/{lang}
DELETE /api/admin/client/galleries/{gid}/items/{iid}
POST   /api/admin/client/galleries/{gid}/headers                     # section header
PUT    /api/admin/client/galleries/{gid}/headers/{hid}
DELETE /api/admin/client/galleries/{gid}/headers/{hid}
PUT    /api/admin/client/galleries/{gid}/order                       # {"order": ["id", ...]}
GET    /api/admin/client/galleries/{gid}/comments
POST   /api/admin/client/galleries/{gid}/stats/reset
POST   /api/admin/client/galleries/{gid}/import                      # from the FTP staging folder
POST   /api/admin/client/galleries/{gid}/import-sync                 # pull in the gallery's FTP watch folder now
POST   /api/admin/client/galleries/{gid}/probe                       # re-read metadata
GET    /api/admin/client/import/files                                # what's waiting in staging
```

### Add a small file

```bash
curl -X POST https://your.host/api/admin/client/galleries/$GALLERY_ID/items \
  -H "Authorization: Bearer $API_TOKEN" \
  -F file=@/path/to/photo.jpg -F title="Opening bell"
```

Returns the created item including `id`, `type` (`photo` or `video`),
`filename`, and metadata (`width`, `height`, `duration` for videos, plus
`thumbnail` and `proxy` for photos). For larger files use the chunked
[Uploads](#uploads) flow with `"target": "client"`.

`title` is optional here too — omit it and the server derives one from the
uploaded file's name rather than naming the item "Untitled".

### Poster

Videos are uploaded without a poster; the admin can capture one, or a script can
PUT a raw JPEG or PNG. Photos get theirs automatically.

```bash
curl -X PUT "https://your.host/api/admin/client/galleries/$GALLERY_ID/items/$ITEM_ID/poster" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/thumb.jpg
```

## View and download stats

Client galleries and collections track engagement automatically.

- A **view** is counted when a client opens the gallery or collection page (or
  unlocks a password-protected one). `total` counts every load; `unique` counts
  distinct visitors, identified by a long-lived `vrs_vid` cookie with a
  salted-IP same-day dedup fallback.
- A **download** is counted per file each time it's fetched, individually or as
  part of a "Download All" zip. The gallery also counts how many times "Download
  All" was run.

`GET /api/admin/client/galleries` and `…/collections` include `viewCount`,
`uniqueVisitors` and `lastViewedAt` on each record.
`GET /api/admin/client/galleries/{gid}/items` returns:

```json
{
  "items": [ /* item records */ ],
  "stats": {
    "views":     { "total": 12, "unique": 3, "lastViewedAt": "ISO8601 | null" },
    "downloads": { "downloadAll": 2, "items": { "p_xxx": 5, "v_yyy": 1 } }
  }
}
```

## Public client routes (what a client's browser calls)

No token is needed; the gallery, collection or package token in the URL is the
credential, and a password (when set) is checked through `unlock`.

```
GET  /api/client/galleries/{token}                     # gallery + items + comments
POST /api/client/galleries/{token}/sync                # report the version marker (+ live flag); imports from the FTP watch folder
POST /api/client/galleries/{token}/unlock              # {"password": "..."}
POST /api/client/galleries/{token}/comments
POST /api/client/galleries/{token}/send-review         # email the comments to you
GET  /api/client/galleries/{token}/download/{itemId}   # one file; add ?size=web for the 2048px version
GET  /api/client/galleries/{token}/zip                 # the zip plan (parts + URLs); add ?size=web for web-size photos
GET  /api/client/galleries/{token}/zip/{index}         # one zip part, streamed
POST /api/client/galleries/{token}/events/download-all # count a Download All
GET  /api/client/galleries/{token}/preview/{itemId}/{thumb|proxy}   # watermarked preview of a photo
GET  /api/client/galleries/{token}/selection?clientId=  # this visitor's favorites (when enabled)
PUT  /api/client/galleries/{token}/selection            # {"clientId": "...", "ids": [...]}; 409 past the limit
POST /api/client/galleries/{token}/selection/submit     # {"clientId", "name", "note"}; emails you the list

GET  /api/client/collections/{token}                   # collection + member galleries
POST /api/client/collections/{token}/unlock

GET  /api/client/packages/{token}                      # delivery package metadata
GET  /api/client/packages/{token}/part/{index}         # download a zip
GET  /api/client/packages/{token}/file/{fileIndex}     # download one original file
```

### Viewer sort, and knowing a gallery changed

`GET /api/client/galleries/{token}` takes two optional query params, `sort` and
`dir`, that order the returned items without changing the gallery's saved
setting — this backs the client page's own sort control. `sort` is one of
`name`, `added` (date added) or `captured` (EXIF / recorded date, falling back to
date added); `dir` is `asc` or `desc`. Anything else, or no params, follows the
gallery's saved `sort`. The gallery block echoes the order actually applied as
`sortBy` and `sortDir`, so a caller can show which is in effect. The client page
itself opens on `added`/`desc` (arrival, newest first); that is the page's send,
not a server default.

`gallery.sortBy`, `gallery.sortDir`, `gallery.live` and `gallery.version` are
also part of the payload:

- `live` is `true` while the gallery may still take in files — it has an FTP
  watch folder, or it changed within the last 30 minutes (an admin or API
  upload). The client page polls this to offer a refresh.
- `version` is a cheap `<count>-<mtime>` marker. `POST …/sync` returns
  `{ "version", "live" }`: it imports any FTP arrivals and reports whether the
  gallery is still live, so a page can stop polling a quiet gallery.

## Delivery packages

Hands a whole gallery (or collection) to a client as one download link, the
WeTransfer-style handoff. Page: `/d/{token}`.

```
GET    /api/admin/client/packages[?sourceId=]       # list (newest first)
POST   /api/admin/client/packages                   # create a link (and optionally send it)
PUT    /api/admin/client/packages/{id}              # update the message
POST   /api/admin/client/packages/{id}/email        # re-send an existing link
DELETE /api/admin/client/packages/{id}              # revoke
POST   /api/admin/client/crc-warm                   # hash a delivery's files ahead of time
GET    /api/admin/client/sendfile-test              # check a host's file-handoff support
```

### Nothing is zipped ahead of time

Creating a package writes a **plan**: which files are included, in what order.
It is a few `stat()` calls, so a 200 GB delivery is created as fast as a 200 MB
one, and the link and its email go out at once. The zip is generated while the
client downloads it and never touches the server's disk. Entries are STOREd,
never deflated (media is already compressed), and every archive is Zip64, so one
code path serves every size.

Every entry's CRC32 comes from a cache (`site-data/data/crc.json`) written at
upload time, so downloads do no per-byte work in PHP. Total size is therefore
predictable and downloads send a real `Content-Length`. Files that predate the
cache are hashed on demand; opening the delivery dialog warms that package's
files in the background:

```bash
curl -X POST https://your.host/api/admin/client/crc-warm \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"packageId": "pkg_xxx"}'
# {"hashed": 3, "remaining": 0, "total": 3, "done": true}
```

Each call works for a few seconds; loop until `done`. Omit `packageId` to hash
the whole library (rarely what you want). Nothing depends on this finishing: an
unhashed file is hashed on its first download instead.

### Part size and the web server limit

The binding limit is the web server's, not the zip format's. LiteSpeed caps any
dynamically generated response at `Max Dynamic Response Body Size`, **1 GiB by
default**. Go past it and the response is truncated and an HTML error is
appended, leaving a zip with no end-of-central-directory that no unarchiver will
open. PHP cannot detect this mid-stream, so the defence is to stay underneath it.

`PACKAGE_PART_MB` therefore defaults to **900**, and a larger delivery is split
into numbered parts, each a self-contained zip. A file larger than one whole
part is handed over as the original file (`"kind": "file"`) rather than a
multi-volume archive. To send one file of any size, raise the server limit
first, then set `PACKAGE_PART_MB=0`, and confirm it by downloading something over
the old limit.

Files that exist on disk are served through their ordinary static URL
(`/uploads/...`), which is the fast path on a live LiteSpeed host. Keep
`SENDFILE=off`; both of LiteSpeed's handoff headers were measured on a real
cPanel host and neither is usable there (one returns 0-byte downloads and
discloses the server path, the other drops `Content-Disposition`).

Packages expire 7 days after creation and are swept on the next list or create.

### Create and send

`to` is optional. Include it and the link is emailed in the same call; omit it
and you just get the link back. `to` accepts a comma/space-separated string or an
array, and every address is validated before anything is sent. Sending requires
email to be configured (Settings → Email, or `RESEND_API_KEY` / `SMTP_*` in
`.env`).

```bash
curl -X POST https://your.host/api/admin/client/packages \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"sourceType":"gallery","sourceId":"g_xxx","to":"client@example.com","message":"Final files from Saturday."}'
```

`sourceType` is `gallery` or `collection`; a collection puts each gallery in its
own folder in the archive. Errors: `400` if the source has no downloadable files
or email isn't configured; `502` if the mail provider rejected the send (the
package is not created).

### Package record

```json
{
  "id": "pkg_xxx",
  "name": "Gallery or collection name",
  "status": "ready",
  "totalBytes": 12884901888,
  "fileCount": 214,
  "shareUrl": "https://your.host/d/{token}",
  "message": "Final files from Saturday.",
  "parts": [
    {
      "index": 1,
      "kind": "zip | file",
      "label": "Part 1",
      "size": 12884903422,
      "fileCount": 214,
      "url": "https://your.host/api/client/packages/{token}/part/1",
      "files": [
        { "index": 0, "name": "Opening Shot.mp4", "size": 734003200,
          "url": "https://your.host/api/client/packages/{token}/file/0" }
      ]
    }
  ],
  "createdAt": "ISO8601",
  "expiresAt": "ISO8601",
  "lastEmailedAt": "ISO8601 | null",
  "lastEmailedTo": ["client@example.com"]
}
```

`status` is always `ready` (there is no build state to poll). `shareUrl` and
every download URL are built from the Site Base URL in Settings → Email
(`BASE_URL`), so set that correctly or shared links point at the wrong host.
The `part` and `file` routes also answer `HEAD` with the correct
`Content-Length`. Downloads are not resumable; the per-file links keep a restart
cheap.

### Re-sending

```bash
curl -X POST "https://your.host/api/admin/client/packages/$PKG/email" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"client@example.com","message":"Resending — link expires Friday."}'
```

Omit `message` to reuse the one stored on the package.

---

# Portfolio

Your public work, stored as folders. The folder tree *is* the site: a **category**
holds galleries and collections, a **collection** holds galleries, and a
**gallery** holds media. Addresses follow the folders:
`/portfolio/{category}/{gallery}/...`.

Rules the API enforces:

- A **gallery** holds media; a **collection** (a gallery that has galleries
  inside it) holds galleries. Never both.
- A gallery at the very top of the Image Library (no category) is its own page
  at `/portfolio/{slug}` and **cannot hold other galleries**; creating or moving
  one inside it is a `400`. Make a collection or category instead.

## Tree and categories

```
GET    /api/admin/portfolio                          # the whole tree (categories, galleries, home)
POST   /api/admin/portfolio/categories               # {"name": "..."}
PUT    /api/admin/portfolio/categories/{cid}         # title, description, slug, folder
DELETE /api/admin/portfolio/categories/{cid}
PUT    /api/admin/portfolio/order                    # {"order": ["pc_...", ...]}
PUT    /api/admin/portfolio/categories/{cid}/order   # {"order": ["pg_...", ...]}
POST   /api/admin/portfolio/home                     # create the home page gallery
```

## Galleries and collections

```
GET    /api/admin/portfolio/galleries/{gid}          # one gallery with its items and children
POST   /api/admin/portfolio/galleries                # create
PUT    /api/admin/portfolio/galleries/{gid}          # update, rename, move
DELETE /api/admin/portfolio/galleries/{gid}          # to the trash
PUT    /api/admin/portfolio/galleries/{gid}/children/order   # {"children": ["pg_...", ...]}
```

### Create

Give the gallery a place with exactly one of:

- `categoryId`: at the top level of a category
- `parentId`: inside another gallery (which makes it a collection)
- neither: its own page at the top level of the Image Library

```bash
curl -X POST https://your.host/api/admin/portfolio/galleries \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Street","categoryId":"pc_xxx"}'
```

Returns `{ ok, gallery }`.

### Update

Any of: `title`, `subtitle`, `description`, `slug`, `folder` (renames the
directory), `visible`, `access`, `password`, `layout`, `options`, `sort`, `cover`,
`hero`, and a move via `parentId` (into a gallery, or `""` back to a category)
and/or `categoryId`.

`access` is one of:

| Value | Meaning |
|---|---|
| `public` | Listed and open |
| `unlisted` | Open by link, not listed |
| `password` | Needs `password` (stored as a hash) |
| `hidden` | Not served at all, like a draft |

## Items

```
POST   /api/admin/portfolio/galleries/{gid}/items                  # add a file (multipart, field "file")
GET    /api/admin/portfolio/galleries/{gid}/items/{file}
PUT    /api/admin/portfolio/galleries/{gid}/items/{file}           # title, description, visible, tile
DELETE /api/admin/portfolio/galleries/{gid}/items/{file}           # to the trash
PUT    /api/admin/portfolio/galleries/{gid}/items/{file}/poster    # raw JPEG/PNG body; ?w= and ?h= carry the video's size
POST   /api/admin/portfolio/galleries/{gid}/items/{file}/captions  # WebVTT track
DELETE /api/admin/portfolio/galleries/{gid}/items/{file}/captions/{lang}
POST   /api/admin/portfolio/galleries/{gid}/headers                # section header
PUT    /api/admin/portfolio/galleries/{gid}/headers/{hid}
DELETE /api/admin/portfolio/galleries/{gid}/headers/{hid}
PUT    /api/admin/portfolio/galleries/{gid}/order                  # {"order": ["file-or-id", ...]}
```

`POST …/items` takes one multipart `file`. Collections refuse it
(`400`: add it to a gallery instead). For large files, use the chunked
[Uploads](#uploads) flow with `"target": "portfolio"`.

### Picks (the same picture in several galleries)

A **pick** shows a file from another gallery without copying it.

```
POST   /api/admin/portfolio/galleries/{gid}/refs          # {"items": [{"galleryId": "pg_...", "file": "a.jpg"}]}
PUT    /api/admin/portfolio/galleries/{gid}/refs/{key}
DELETE /api/admin/portfolio/galleries/{gid}/refs/{key}
POST   /api/admin/portfolio/duplicates/link               # turn byte-identical copies into picks
```

## Housekeeping

```
POST /api/admin/portfolio/process               # one slice of thumbnail/proxy work; call again while `remaining` > 0
GET  /api/admin/portfolio/readiness             # pre-launch checklist
GET  /api/admin/portfolio/stats                 # counts and sizes
GET  /api/admin/portfolio/duplicates            # byte-identical files
GET  /api/admin/portfolio/trash                 # deleted items (kept until emptied)
DELETE /api/admin/portfolio/trash/{name}
POST /api/admin/portfolio/trash/empty
POST /api/admin/portfolio/galleries/{gid}/photoshelter-sync   # apply a PhotoShelter sidecar
GET  /api/admin/portfolio/migrate               # legacy reels still waiting to move into folders
POST /api/admin/portfolio/migrate               # move them
```

`php index.php portfolio:process` does the same processing from the command line
(suitable for cron).

## Public portfolio routes

```
GET  /api/portfolio                                  # categories with their public galleries
GET  /api/portfolio/home                             # the home page gallery, or null
GET  /api/portfolio/c/{cat}                          # one category
GET  /api/portfolio/g/{cat}/{slug}/{slug}...         # a gallery or collection at any depth
POST /api/portfolio/g/{cat}/{slug}.../unlock         # {"password": "..."}
```

A password-protected gallery answers `{ "locked": true, "title": "..." }` until
unlocked for the session.

---

# Shared

## Auth

```
GET  /api/auth/check              # {authenticated, setupRequired}
POST /api/auth/setup              # first run: {email, password}
POST /api/auth/login              # {username, password}; the email is case-insensitive
POST /api/auth/logout
POST /api/auth/change-password    # {currentPassword, newPassword}; signs out other sessions
POST /api/auth/forgot             # {email}; emails a one-hour reset link
POST /api/auth/reset              # {token, password}
```

Bearer-token requests don't use these; they're for the browser admin.

## Site, pages and settings

```
GET  /api/header                              # public header/nav config
GET  /api/admin/header
PUT  /api/settings/header                     # header config
POST /api/settings/header/logo
PUT  /api/settings/theme
POST /api/settings/watermark
GET  /api/pages                               # public
GET  /api/pages/{slug}                        # public
POST /api/contact                             # public contact form
GET  /api/admin/pages
POST /api/admin/pages
PUT  /api/admin/pages/{id}
DELETE /api/admin/pages/{id}
POST /api/admin/pages/{id}/image
GET  /api/settings/email
PUT  /api/settings/email
POST /api/settings/email/test
GET  /api/settings/update
GET  /api/settings/deploy
POST /api/settings/deploy
GET  /api/settings/api-token
POST /api/settings/api-token
DELETE /api/settings/api-token
GET  /api/admin/video-tools/status
POST /api/admin/video-tools/install
```

## Export and import

```
GET  /api/admin/export/galleries                # list of galleries available to export
GET  /api/admin/export/gallery/{gid}/download   # one gallery as a zip
GET  /api/admin/export/settings                 # sitewide config, pages, logo, watermark
GET  /api/admin/export/settings/download
POST /api/admin/import/gallery                  # multipart zip
POST /api/admin/import/settings                 # multipart zip
```

---

## End-to-end example

Create a client collection and gallery, attach it, then upload a photo and a
large video. (For the portfolio, swap in the `/api/admin/portfolio/...` routes
and `"target":"portfolio"`.)

```bash
API_TOKEN=... # from .env or Settings → API
HOST=https://your.host
AUTH=(-H "Authorization: Bearer $API_TOKEN")
JSON=(-H "Content-Type: application/json")

# 1. Collection
CID=$(curl -s -X POST "$HOST/api/admin/client/collections" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"name":"Kelley Dec 2026","downloadsEnabled":true}' | jq -r .id)

# 2. Gallery
GID=$(curl -s -X POST "$HOST/api/admin/client/galleries" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"name":"20260418_KIMWA","downloadsEnabled":true}' | jq -r .id)

# 3. Attach
curl -s -X PUT "$HOST/api/admin/client/collections/$CID" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"galleryIds\":[\"$GID\"]}" >/dev/null

# 4. Upload a photo (small, multipart)
curl -s -X POST "$HOST/api/admin/client/galleries/$GID/items" "${AUTH[@]}" \
  -F file=@photo.jpg -F title="Opening bell" >/dev/null

# 5. Upload a 2 GB video via chunks
SIZE=$(stat -f%z big.mp4)
UPLOAD_ID=$(curl -s -X POST "$HOST/api/admin/uploads" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"filename\":\"big.mp4\",\"totalSize\":$SIZE,\"contentType\":\"video/mp4\"}" | jq -r .uploadId)

CHUNK=$((50 * 1024 * 1024)); OFFSET=0
while [ $OFFSET -lt $SIZE ]; do
  END=$((OFFSET + CHUNK - 1)); [ $END -ge $SIZE ] && END=$((SIZE - 1))
  dd if=big.mp4 bs=1 skip=$OFFSET count=$((END - OFFSET + 1)) 2>/dev/null | \
    curl -s -X PUT "$HOST/api/admin/uploads/$UPLOAD_ID/chunk" "${AUTH[@]}" \
      -H "Content-Range: bytes $OFFSET-$END/$SIZE" --data-binary @- >/dev/null
  OFFSET=$((END + 1))
done

# 6. Finalize
curl -s -X POST "$HOST/api/admin/uploads/$UPLOAD_ID/finalize" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"target\":\"client\",\"galleryId\":\"$GID\",\"title\":\"Main Keynote\"}"
```

## Data shapes

### Client gallery

```json
{
  "id": "g_xxx",
  "name": "string",
  "type": "proofing",
  "token": "string",
  "password": "bcrypt hash | null",
  "downloadsEnabled": true,
  "commentingEnabled": false,
  "expiresAt": "ISO8601 | null",
  "active": true,
  "overrideCollectionSettings": false,
  "createdAt": "ISO8601"
}
```

### Client collection

```json
{
  "id": "col_xxx",
  "name": "string",
  "type": "proofing",
  "token": "string",
  "galleryIds": ["g_xxx"],
  "password": "bcrypt hash | null",
  "downloadsEnabled": true,
  "commentingEnabled": false,
  "expiresAt": "ISO8601 | null",
  "active": true,
  "sortOrder": "custom | newest | oldest | alpha",
  "createdAt": "ISO8601"
}
```

### Client item

```json
{
  "id": "p_xxx | v_xxx",
  "type": "photo | video",
  "title": "string",
  "filename": "string",
  "visible": true,
  "createdAt": "ISO8601",
  "width": 8640,
  "height": 5760,
  "duration": 62.5,
  "thumbnail": "filename.jpg | null",
  "proxy": "filename.jpg | null"
}
```

## What changed in 2.3.0 (old paths deprecated, not yet removed)

Routes were renamed so the two systems can't be confused. **The old client
delivery paths still work for now as deprecated aliases**: they are translated to
the new ones, and every aliased response carries an
`X-API-Deprecated: <old path> is now <new path>` header. A finalize call with no
`target` is treated as `client` (or `portfolio` when it sends
`portfolioGalleryId`), and an aliased response also repeats `items` as `videos`.
Move your tool to the new names; the aliases will be removed in a later release.
`GET /api/videos` (the old public portfolio feed) has no alias and is gone.

| Old | New |
|---|---|
| `/api/galleries[/{id}]` | `/api/admin/client/galleries[/{id}]` |
| `/api/collections[/{id}]` | `/api/admin/client/collections[/{id}]` |
| `/api/admin/galleries/{gid}/videos[/{vid}]` | `/api/admin/client/galleries/{gid}/items[/{iid}]` |
| `…/videos/{vid}/thumbnail` | `…/items/{iid}/poster` |
| `/api/admin/galleries/{gid}/reorder` | `/api/admin/client/galleries/{gid}/order` |
| `/api/admin/galleries/{gid}/…` (headers, comments, stats, import, probe) | `/api/admin/client/galleries/{gid}/…` |
| `/api/admin/packages…`, `crc-warm`, `sendfile-test`, `import/files` | `/api/admin/client/…` |
| `/api/proofing/{token}…` | `/api/client/galleries/{token}…` (`/event/download-all` is now `/events/download-all`) |
| `/api/collections/public/{token}…` | `/api/client/collections/{token}…` |
| `/api/packages/{token}…` | `/api/client/packages/{token}…` |
| `/api/admin/portfolio/galleries/{gid}/files` | `/api/admin/portfolio/galleries/{gid}/items` |
| multipart field `video` | `file` |
| `videos` in gallery and item-list responses | `items` |
| finalize `{galleryId}` / `{portfolioGalleryId}` | `{target, galleryId}` |
| `GET /api/videos` and the `reels` gallery type | removed |
