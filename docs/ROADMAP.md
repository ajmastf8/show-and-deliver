# Roadmap

Backlog for the folder-backed portfolio rewrite (`agent/portfolio-backend`).
Not ordered by priority — pick off whatever's next.

## Passkeys (WebAuthn) — sign in without a password

Requested: sign in with Face ID / Touch ID / Windows Hello / a security key,
in addition to (not instead of) the email + password login. **Optional,
self-enrolled** — off by default, turned on per-device from Settings, with the
password kept as a fallback so a lost device can never lock you out.

**No database needed.** Credentials live in a flat
`site-data/data/passkeys.json`, the same shape as the other sidecars:
`{id, publicKey, signCount, label, createdAt}`.

The storage is the easy part; **the work is verifying the signature on the
server.** PHP has no built-in WebAuthn support. The usual answer is a Composer
library (`web-auth/webauthn-lib`), but that drags in Composer and dozens of
files — against this project's "single-file PHP, no build step, simple hosting"
grain. So this needs a **minimal relying-party verifier in pure PHP**:

- decode the CBOR attestation object and the COSE public key,
- convert the COSE EC2/RSA key to a PEM public key,
- `openssl_verify` the assertion for **ES256** (Face ID / Touch ID / Windows
  Hello all use it) and **RS256**,
- check `rpIdHash`, `origin`, `challenge`, and the user-present/user-verified
  flags, and track the signature counter.

Roughly 300–400 lines of careful, security-sensitive crypto.

Endpoints: registration + login (begin/finish), plus a Settings > "Sign-in
passkeys" section to enroll, label, list and remove devices.

**Caveats:**

- **HTTPS required** (port.ajmast.com has it).
- The domain is the `rpId`, so credentials are bound to `port.ajmast.com` and
  would need re-enrolling on a different domain later.
- **Cannot be verified automatically** — WebAuthn needs a real authenticator
  and a secure context, which the automated browser can't provide. The
  challenge/registration plumbing can be linted and unit-checked, but the
  actual "register and sign in with a thumb" step has to be tested on a real
  device. Plan for that, not a green test run.

Scope: one build.

## Admin search across filenames and metadata

Gallery search (the topbar search) currently only matches a gallery's display
name, client-side, against the already-loaded list. It doesn't see file names or
per-item metadata (titles, descriptions) at all, and can't — that data isn't
loaded until a gallery is opened.

To search file names/metadata, this needs a real server-side search endpoint
that greps across every gallery's `.gallery.json` (titles, descriptions, item
file names), not a client-side filter. Worth deciding how deep it should go
(top-level galleries only vs. nested collections, portfolio vs. client
delivery) before building it.

---

## Shipped (kept for reference)

- **Drop galleries** — a client gallery can be turned into a *drop*: one URL, one
  shared password, and an invite list. The owner invites people by email from the
  gallery's **Create drop link** button; each invited address is the credential
  that person signs in with, and their uploads are credited to them (by name if
  one was given). Removing an invite closes that person's access immediately.
  The page is a client gallery with an upload zone at the top. Shipped in 2.7.0 —
  see `docs/API.md` and the drop notes in `CLAUDE.md`.
- **Email: Reply-To** — contact-form notifications now set `Reply-To` to the
  visitor, on both the Resend and `mail()` paths.
- **Email settings page** — reordered (Sender & delivery first), SMTP collapses
  when a Resend key is set, separate **Test Resend** / **Test SMTP connection**
  buttons, and the field spacing fixed (`.pfa-field.wide`'s row-layout flex-basis
  was stretching each field vertically).
- **Stats page** — Portfolio and Client delivery counts (galleries, collections,
  photos, videos) plus disk use.
- **Hidden-items divider** — hidden items sit under a "Hidden" band in the
  gallery editor; unhiding moves them back up.
- **Add a picture to other galleries** — a picture's Details screen lists where
  it appears and can add it to other galleries (the reverse of the library
  picker).
- **Captions** — rendered as a box **under** the picture (never overlaid), with
  a **None** option (None / Lightbox only / Always show).
- **XMP captions** — blank captions auto-backfill from the file's XMP
  `dc:description` on rescan.
- **Hiding a gallery** — already works via each gallery's Access setting
  (public / unlisted / password / hidden); nothing to build, just surfacing it.
