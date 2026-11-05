# Release publishing

AJ's installs read `https://hashmy.ajmast.com/port-update/manifest.json` (via
`UPDATE_MANIFEST_URL`), not GitHub Releases. Shipping means uploading a zip and a
manifest there.

- `upload.php` is the server side; deploy it to `public_html/hashmy.ajmast.com/port-update/`.
  The shared secret goes in a sibling `key.php` (`<?php return 'secret';`) on the server.
- `upload-release.sh` is the client. It uploads the zip, then the manifest, and checks each SHA-256.
  Put the secret in `builds/update-key.txt` (gitignored) or `UPDATE_UPLOAD_KEY`.

    BUILDS_DIR=/path/to/builds tools/release/upload-release.sh show-and-deliver-vX.Y.Z-*.zip manifest.json

Build the zip with `git archive --prefix=show-and-deliver-vX.Y.Z-YYYYMMDD-HHMM/`, and write
`manifest.json` as `{tag_name, body, zipball_url}`. Never commit a key.
