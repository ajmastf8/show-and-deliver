# Admin Upload API

This API lets a third-party client (a Rust CLI, a Swift app, a shell
script — anything that can make HTTP requests) create collections, create
galleries, set their parameters, and upload photos or multi-GB video files.

All endpoints live on the same host as the admin site; they share the
existing admin routes under `/api/*` plus a chunked-upload namespace for
large files.

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

Every request includes the token as a Bearer header:

```
Authorization: Bearer <API_TOKEN>
```

Requests without a valid token get `401 Unauthorized`. With no token set
anywhere, the Bearer path is disabled entirely — existing installs are
unaffected.

Rate limit: 60 authenticated requests per minute per client IP. Beyond
that you get `429 Too many attempts`.

## Common envelope

All JSON bodies use `Content-Type: application/json`. Successful responses
return the created or updated record. Errors return:

```json
{ "error": "Human-readable message", "detail": "optional extra info" }
```

with an appropriate 4xx / 5xx status.

## Collections

```
GET    /api/collections                 # list
POST   /api/collections                 # create
PUT    /api/collections/{id}            # update
DELETE /api/collections/{id}            # delete
```

### Create

```bash
curl -X POST https://your.host/api/collections \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Kelley Dec 2026"}'
```

Response includes server-assigned `id`, `token`, `createdAt`, `active`,
and defaults for settings.

### Update

Any of these fields can be set:

```json
{
  "name": "string",
  "type": "proofing | reels",
  "galleryIds": ["g_...", "g_..."],
  "password": "plaintext (will be bcrypted) or null to clear",
  "downloadsEnabled": true,
  "commentingEnabled": false,
  "expiresAt": "2026-12-31T23:59:59Z",
  "active": true,
  "sortOrder": "custom | newest | oldest | alpha",
  "regenerateToken": true
}
```

### Collection type

A collection has the same `type` as the galleries it groups, and only ever
shows galleries of its own type:

- `proofing` (the default, and what pre-existing collections are treated as) —
  client delivery. Password, expiry, and commenting apply, and member galleries
  inherit them.
- `reels` — portfolio. The collection page is public: no password, no expiry,
  no commenting. Sending those fields on a portfolio collection is ignored, and
  switching an existing collection to `reels` clears them.

## Galleries

```
GET    /api/galleries                   # list
POST   /api/galleries                   # create
PUT    /api/galleries/{id}              # update
DELETE /api/galleries/{id}              # delete
```

### Create

```bash
curl -X POST https://your.host/api/galleries \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"20260418_KIMWA",
    "type":"proofing",
    "downloadsEnabled": true,
    "commentingEnabled": false
  }'
```

`type` is `"proofing"` for client galleries or `"reels"` for the public
portfolio.

### Attach to a collection

```bash
curl -X PUT https://your.host/api/collections/$COLLECTION_ID \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"galleryIds":["'$GALLERY_ID'"]}'
```

Pass the full list of gallery ids you want in the collection — updates
are replace-style, not additive.

## Items (photos + videos)

Items belong to a gallery. Two upload paths:

1. **Small files (≤ 500 MB)** — single multipart POST. Same endpoint the
   web admin uses.
2. **Large files** — chunked upload so you can push multi-GB videos past
   `post_max_size`.

### Small-file upload (multipart)

```bash
curl -X POST https://your.host/api/admin/galleries/$GALLERY_ID/videos \
  -H "Authorization: Bearer $API_TOKEN" \
  -F video=@/path/to/photo.jpg \
  -F title="Opening bell"
```

Returns the created item including `id`, `type` (`photo` or `video`),
`filename`, and metadata (`width`, `height`, `duration` for videos, plus
`thumbnail` and `proxy` for photos).

### Large-file upload (chunked)

Three-step flow. Chunks must be contiguous; `Content-Range` tells the
server where each one lands.

**1. Initiate.**

```bash
curl -X POST https://your.host/api/admin/uploads \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename":"main_keynote.mp4",
    "totalSize": 2147483648,
    "contentType":"video/mp4"
  }'
```

Response:

```json
{
  "uploadId": "a1b2c3...",
  "chunkMaxBytes": 52428800,
  "totalSize": 2147483648
}
```

`chunkMaxBytes` is the per-chunk cap you must respect (currently 50 MB).

**2. Upload each chunk.** Send bytes `[start..end]` inclusive via a raw
`PUT` with `Content-Range: bytes start-end/total`. Chunks must arrive in
order — if you crash, call initiate again with a new session.

```bash
# Pseudocode; see examples/chunked-upload.sh or write your own
dd if=main_keynote.mp4 bs=1048576 count=50 skip=0 | \
  curl -X PUT "https://your.host/api/admin/uploads/$UPLOAD_ID/chunk" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Range: bytes 0-52428799/2147483648" \
    --data-binary @-
```

Response after each chunk:

```json
{ "received": 52428800, "totalSize": 2147483648, "complete": false }
```

When `"complete": true`, move on to finalize.

**3. Finalize.** Attaches the assembled file to a gallery as an item:

```bash
curl -X POST https://your.host/api/admin/uploads/$UPLOAD_ID/finalize \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "galleryId":"'$GALLERY_ID'",
    "title":"Main Keynote"
  }'
```

Response is the fully-formed item record (same shape as the multipart
upload response).

**Cancel.** If you abandon an upload partway:

```bash
curl -X DELETE "https://your.host/api/admin/uploads/$UPLOAD_ID" \
  -H "Authorization: Bearer $API_TOKEN"
```

Abandoned sessions are also auto-cleaned after 24 hours on the next
initiate call.

### Set a custom thumbnail (optional)

Videos are uploaded without a thumbnail by default; the web admin can pick
one later, or the CLI can provide one directly. PUT a raw JPEG or PNG:

```bash
curl -X PUT "https://your.host/api/admin/galleries/$GALLERY_ID/videos/$ITEM_ID/thumbnail" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/thumb.jpg
```

Max 10 MB.

### Other item operations

```
PUT    /api/admin/galleries/{gid}/videos/{vid}          # update title, visible
PUT    /api/admin/galleries/{gid}/videos/{vid}/replace  # replace underlying file (multipart)
DELETE /api/admin/galleries/{gid}/videos/{vid}          # delete item + files
PUT    /api/admin/galleries/{gid}/reorder               # reorder items
POST   /api/admin/galleries/{gid}/headers               # add a section header
PUT    /api/admin/galleries/{gid}/headers/{hid}         # rename header
DELETE /api/admin/galleries/{gid}/headers/{hid}         # delete header
```

## Delivery packages

Zips a whole gallery (or a whole collection) into numbered parts the client
downloads from a token link — the WeTransfer-style handoff. The client-side
"Download All" button on the proofing page is unaffected; this is the
server-side alternative for handing over a finished job.

```
GET    /api/admin/packages[?sourceId=]     # list (newest first)
POST   /api/admin/packages                 # create a build job
POST   /api/admin/packages/{id}/build      # run one build slice
POST   /api/admin/packages/{id}/email      # email the links
DELETE /api/admin/packages/{id}            # delete package + parts

GET    /api/packages/{token}               # public: package metadata
GET    /api/packages/{token}/part/{index}  # public: download one part
```

### How the build works

Shared hosting has no background jobs and hard request timeouts, so building is
**driven by the caller**. `POST /api/admin/packages` returns immediately with
`status: "building"`; you then call `/build` repeatedly until `status` is
`ready` or `failed`. Each `/build` call does a short, time-boxed slice and
returns the current progress. Slices resume mid-file, so no single request ever
has to survive a multi-GB copy, and a concurrent second caller is locked out
and simply gets progress back.

```bash
PKG=$(curl -s -X POST https://your.host/api/admin/packages \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"sourceType":"gallery","sourceId":"g_xxx"}' | jq -r .id)

while :; do
  STATUS=$(curl -s -X POST "https://your.host/api/admin/packages/$PKG/build" \
    -H "Authorization: Bearer $API_TOKEN" | jq -r .status)
  echo "$STATUS"
  [ "$STATUS" = "building" ] || break
done
```

`sourceType` is `gallery` or `collection`. A collection package puts each
gallery in its own folder inside the archive.

### Parts

Files are stored (not compressed — media doesn't compress) and split into parts
of at most ~1.9 GB, overridable with `PACKAGE_PART_MB` in `.env`. A single file
larger than one whole part can't be split across parts without producing a
multi-volume archive most clients can't open, so it's offered as its own direct
download instead (`"kind": "file"` rather than `"kind": "zip"`).

Packages expire 7 days after creation and are swept on the next list/create.
Creating one is refused with `507` if the disk doesn't have room for a copy.

### Package record

```json
{
  "id": "pkg_xxx",
  "name": "Gallery or collection name",
  "status": "building | ready | failed",
  "error": "string | null",
  "totalBytes": 12884901888,
  "doneBytes": 4294967296,
  "fileCount": 214,
  "parts": [
    {
      "index": 1,
      "kind": "zip | file",
      "label": "Part 1",
      "size": 1992294400,
      "fileCount": 38,
      "url": "https://your.host/api/packages/{token}/part/1"
    }
  ],
  "createdAt": "ISO8601",
  "expiresAt": "ISO8601",
  "readyAt": "ISO8601 | null",
  "lastEmailedAt": "ISO8601 | null",
  "lastEmailedTo": ["client@example.com"]
}
```

Part URLs are built from the Site Base URL in Settings → Email (`BASE_URL`), so
set that correctly or the emailed links will point at the wrong host.

### Emailing the links

Requires email to be configured (Settings → Email, or `RESEND_API_KEY` /
`SMTP_*` in `.env`); returns `400` if it isn't and `409` if the package isn't
ready.

```bash
curl -X POST "https://your.host/api/admin/packages/$PKG/email" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"client@example.com, second@example.com","message":"Final files from Saturday."}'
```

`to` accepts a comma/space-separated string or an array. Every address is
validated before anything is sent.

## End-to-end example

Create a collection, create a gallery, attach it, upload a photo and a
large video:

```bash
API_TOKEN=... # from .env
HOST=https://your.host
AUTH=(-H "Authorization: Bearer $API_TOKEN")
JSON=(-H "Content-Type: application/json")

# 1. Collection
COL=$(curl -s -X POST "$HOST/api/collections" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"name":"Kelley Dec 2026","downloadsEnabled":true}')
CID=$(echo "$COL" | jq -r .id)

# 2. Gallery
G=$(curl -s -X POST "$HOST/api/galleries" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"name":"20260418_KIMWA","type":"proofing","downloadsEnabled":true}')
GID=$(echo "$G" | jq -r .id)

# 3. Attach
curl -s -X PUT "$HOST/api/collections/$CID" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"galleryIds\":[\"$GID\"]}" >/dev/null

# 4. Upload a photo (small, multipart)
curl -s -X POST "$HOST/api/admin/galleries/$GID/videos" "${AUTH[@]}" \
  -F video=@photo.jpg -F title="Opening bell" >/dev/null

# 5. Upload a 2 GB video via chunks
SIZE=$(stat -f%z big.mp4)
UPLOAD_ID=$(curl -s -X POST "$HOST/api/admin/uploads" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"filename\":\"big.mp4\",\"totalSize\":$SIZE,\"contentType\":\"video/mp4\"}" | jq -r .uploadId)

CHUNK=$((50 * 1024 * 1024))
OFFSET=0
while [ $OFFSET -lt $SIZE ]; do
  END=$((OFFSET + CHUNK - 1))
  [ $END -ge $SIZE ] && END=$((SIZE - 1))
  dd if=big.mp4 bs=1 skip=$OFFSET count=$((END - OFFSET + 1)) 2>/dev/null | \
    curl -s -X PUT "$HOST/api/admin/uploads/$UPLOAD_ID/chunk" "${AUTH[@]}" \
      -H "Content-Range: bytes $OFFSET-$END/$SIZE" \
      --data-binary @- >/dev/null
  OFFSET=$((END + 1))
done

# 6. Finalize
curl -s -X POST "$HOST/api/admin/uploads/$UPLOAD_ID/finalize" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"galleryId\":\"$GID\",\"title\":\"Main Keynote\"}"
```

## Data shapes reference

### Gallery record

```json
{
  "id": "g_xxx",
  "name": "string",
  "type": "proofing | reels",
  "token": "string | null",
  "password": "bcrypt hash | null",
  "downloadsEnabled": true,
  "commentingEnabled": false,
  "expiresAt": "ISO8601 | null",
  "active": true,
  "overrideCollectionSettings": false,
  "createdAt": "ISO8601"
}
```

### Collection record

```json
{
  "id": "col_xxx",
  "name": "string",
  "type": "proofing | reels",
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

### Item record

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

## View & download stats

Proofing galleries and collections track engagement automatically — no
configuration needed.

- A **view** is counted when a client opens the gallery/collection page
  (or unlocks a password-protected one). `total` counts every load;
  `unique` counts distinct visitors, identified by a long-lived
  `vrs_vid` cookie with a salted-IP same-day dedup fallback.
- A **download** is counted per file each time it's fetched — whether
  downloaded individually or as part of a "Download All" zip. The
  gallery also tracks how many times "Download All" was run.

`GET /api/galleries` and `GET /api/collections` include `viewCount`,
`uniqueVisitors`, and `lastViewedAt` (ISO8601 or `null`) on each record.

`GET /api/admin/galleries/{id}/videos` returns:

```json
{
  "videos": [ /* item records */ ],
  "stats": {
    "views":     { "total": 12, "unique": 3, "lastViewedAt": "ISO8601 | null" },
    "downloads": { "downloadAll": 2, "items": { "p_xxx": 5, "v_yyy": 1 } }
  }
}
```

`POST /api/admin/galleries/{id}/stats/reset` clears a gallery's view and
download counts.
