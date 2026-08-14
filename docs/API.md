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

Hands a whole gallery (or collection) to a client as one download link — the
WeTransfer-style handoff. The client-side "Download All" button on the proofing
page is unaffected; this is the server-side alternative for handing over a
finished job.

```
GET    /api/admin/packages[?sourceId=]     # list (newest first)
POST   /api/admin/packages                 # create a link (and optionally send it)
POST   /api/admin/packages/{id}/email      # re-send an existing link
DELETE /api/admin/packages/{id}            # revoke

GET    /api/packages/{token}               # public: package metadata
GET    /api/packages/{token}/part/{index}  # public: download a zip
GET    /api/packages/{token}/file/{index}  # public: download one original file
```

### Nothing is zipped ahead of time

Creating a package writes a **plan** — which files are included, in what order —
and returns immediately. It is a few stat() calls, so a 200 GB delivery is
created as fast as a 200 MB one, and the link and its email go out at once.

The zip is generated while the client downloads it and never touches the
server's disk. That makes serving cost one read of each file. (Building the
archive up front would cost three — a CRC pass, a copy pass, and the zip
write — plus a fourth to serve it, plus the disk to hold it, which is what
makes pre-built archives crawl on I/O-throttled shared hosting.)

Entries are STOREd, never deflated: media is already compressed, so deflate
burns CPU for nothing. That's also what makes the total size predictable, so
these downloads send a real `Content-Length` and clients get an accurate
progress bar. CRCs aren't known until the bytes have been read, so each entry
carries a trailing data descriptor; every standard extractor reads the central
directory at the end, where the real values live.

### One link, any size

Archives past the 4 GB zip32 ceiling switch to **Zip64** automatically, so a
delivery of any size stays a single download. Smaller archives stay plain zip32,
byte-for-byte as before, for the widest compatibility.

Splitting into numbered parts is opt-in: set `PACKAGE_PART_MB` in `.env`
(`0`, the default, never splits). When splitting is on, a file larger than one
whole part is handed over as the original file rather than a multi-volume
archive most clients can't open — that part reports `"kind": "file"`.

Packages expire 7 days after creation and are swept on the next list/create.
Expiring one deletes a plan, not gigabytes of archive.

### Create and send

`to` is optional. Include it and the link is emailed in the same call; omit it
and you just get the link back to share yourself. `to` accepts a comma/space
separated string or an array, and every address is validated before anything is
sent. Sending requires email to be configured (Settings → Email, or
`RESEND_API_KEY` / `SMTP_*` in `.env`).

```bash
curl -X POST https://your.host/api/admin/packages \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{
        "sourceType": "gallery",
        "sourceId": "g_xxx",
        "to": "client@example.com",
        "message": "Final files from Saturday."
      }'
```

`sourceType` is `gallery` or `collection`. A collection package puts each
gallery in its own folder inside the archive. `message` is shown on the download
page as well as in the email.

Errors: `400` if the source has no downloadable files or email isn't configured,
`502` if the mail provider rejected the send (the package is not created).

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
      "url": "https://your.host/api/packages/{token}/part/1",
      "files": [
        {
          "index": 0,
          "name": "Opening Shot.mp4",
          "size": 734003200,
          "url": "https://your.host/api/packages/{token}/file/0"
        }
      ]
    }
  ],
  "createdAt": "ISO8601",
  "expiresAt": "ISO8601",
  "lastEmailedAt": "ISO8601 | null",
  "lastEmailedTo": ["client@example.com"]
}
```

`status` is always `ready` and exists only so older clients don't break — there
is no build state to poll.

`shareUrl` and every download URL are built from the Site Base URL in
Settings → Email (`BASE_URL`), so set that correctly or shared links will point
at the wrong host.

### The download page

`shareUrl` (`/d/{token}`) is a real page, and it's what the email links to. It
shows the sender's message, one button for the whole transfer, and the full file
list so a client who only wants one clip can take it on its own — no zip
involved. The `part` and `file` endpoints are also usable directly, and both
answer `HEAD` with the correct `Content-Length` for download managers.

Note that downloads are not resumable: a client whose connection drops restarts
that download. The per-file links keep that cheap.

### Re-sending

```bash
curl -X POST "https://your.host/api/admin/packages/$PKG/email" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"client@example.com","message":"Resending — link expires Friday."}'
```

Omit `message` to reuse the one stored on the package.

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
