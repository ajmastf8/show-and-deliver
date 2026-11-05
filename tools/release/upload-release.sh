#!/usr/bin/env bash
#
# Push a built release to the update host — the companion to upload.php.
#
# Uploads the zip first, then manifest.json, so a client that reads the
# manifest never points at a zip that is not there yet. Each upload's local
# SHA-256 is compared with the server's reply, so a truncated transfer fails
# loudly instead of shipping.
#
#   ./upload-release.sh                       # newest .zip in this dir + manifest.json
#   ./upload-release.sh path/to/art.zip       # an explicit zip + manifest.json beside it
#   ./upload-release.sh art.zip manifest.json # both explicit
#
# Configuration (env vars):
#   UPDATE_UPLOAD_KEY  the shared secret. If unset, read from
#                      $BUILDS_DIR/update-key.txt or ~/.show-and-deliver-update-key
#   BUILDS_DIR         default <repo>/builds (gitignored)
#   UPDATE_UPLOAD_URL  default https://hashmy.ajmast.com/port-update/upload.php
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Where zips, manifest.json and update-key.txt live. Gitignored builds/ at the repo
# root by default; set BUILDS_DIR to use another checkout's builds folder.
BUILDS_DIR="${BUILDS_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)/builds}"
[ -d "$BUILDS_DIR" ] || { printf 'error: builds dir not found: %s (set BUILDS_DIR)\n' "$BUILDS_DIR" >&2; exit 1; }

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
note() { printf '==> %s\n' "$*" >&2; }

command -v curl >/dev/null 2>&1 || die "curl is required"

ENDPOINT="${UPDATE_UPLOAD_URL:-https://hashmy.ajmast.com/port-update/upload.php}"

# ---- key ----
KEY="${UPDATE_UPLOAD_KEY:-}"
if [ -z "$KEY" ] && [ -f "$BUILDS_DIR/update-key.txt" ]; then
  KEY="$(tr -d '[:space:]' < "$BUILDS_DIR/update-key.txt")"
fi
if [ -z "$KEY" ] && [ -f "$HOME/.show-and-deliver-update-key" ]; then
  KEY="$(tr -d '[:space:]' < "$HOME/.show-and-deliver-update-key")"
fi
[ -n "$KEY" ] || die "no key: set UPDATE_UPLOAD_KEY, or create $BUILDS_DIR/update-key.txt or ~/.show-and-deliver-update-key"

# ---- files ----
ZIP="${1:-}"
MANIFEST="${2:-}"
if [ -z "$ZIP" ]; then
  ZIP="$(ls -1t "$BUILDS_DIR"/show-and-deliver-*.zip 2>/dev/null | head -1 || true)"
  [ -n "$ZIP" ] || die "no show-and-deliver-*.zip in $BUILDS_DIR; pass a path"
fi
[ -f "$ZIP" ] || die "zip not found: $ZIP"
if [ -z "$MANIFEST" ]; then
  if [ -f "$(dirname "$ZIP")/manifest.json" ]; then
    MANIFEST="$(dirname "$ZIP")/manifest.json"
  else
    MANIFEST="$BUILDS_DIR/manifest.json"
  fi
fi
[ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

json_field() { # json_field <json> <key>
  printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/'
}

push() { # push <file> <content-type>
  local file="$1" ctype="$2" name localhash body code serverhash
  name="$(basename "$file")"
  localhash="$(sha256 "$file")"

  note "uploading $name ($(du -h "$file" | awk '{print $1}'))"
  body="$(curl -sS -X POST "$ENDPOINT?name=$name" \
    -H "X-Update-Key: $KEY" \
    -H "Content-Type: $ctype" \
    --data-binary @"$file" \
    -w $'\n%{http_code}')" || die "curl failed for $name"

  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  [ "$code" = "200" ] || die "$name: server returned HTTP $code — $body"

  serverhash="$(json_field "$body" sha256)"
  [ -n "$serverhash" ] || die "$name: no sha256 in reply — $body"
  [ "$serverhash" = "$localhash" ] || die "$name: checksum mismatch (local $localhash, server $serverhash)"
  note "$name ok (sha256 $localhash)"
}

push "$ZIP" "application/octet-stream"
push "$MANIFEST" "application/json"

note "done: $(basename "$ZIP") + $(basename "$MANIFEST") uploaded to $ENDPOINT"
