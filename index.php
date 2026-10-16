<?php
/**
 * Show & Deliver — Single-file PHP API
 * Replaces the entire Express.js backend. All 30+ endpoints in one file.
 */

// ============================================================
// BOOTSTRAP: env, paths, sessions, security headers
// ============================================================

define('SITE_DATA', __DIR__ . '/site-data');
define('DATA_DIR', SITE_DATA . '/data');
define('UPLOADS_DIR', SITE_DATA . '/uploads');
define('THUMBS_DIR', SITE_DATA . '/thumbnails');
define('PROXY_DIR', SITE_DATA . '/proxies');
define('CAPTIONS_DIR', SITE_DATA . '/captions');
define('IMPORT_DIR', SITE_DATA . '/imports');
// Up here with the other paths, not next to the code that uses them: routes run
// inline as this file is read, so a define() further down does not exist yet by
// the time an earlier route calls a function that needs it. Emails read the site
// name for subject lines, and uploads hash into the CRC cache — both happen well
// before the sections those constants would otherwise live in.
define('HEADER_CONFIG_PATH', DATA_DIR . '/header.json');
// How the public pages look: a colour preset with one accent, how the header is
// arranged, the contact line, and how gallery listings are presented. Kept
// apart from header.json so saving the header's links and logo can't wipe it,
// and returned with the header config so every page still makes one request.
// Up here with the other paths: the portfolio index routes read it long before
// the theme section of this file is reached.
define('THEME_CONFIG_PATH', DATA_DIR . '/theme.json');
// Plain pages (about, contact), and the reserved portfolio folder their
// pictures live in so /media/ serves them with no new rewrite rules.
define('PAGES_PATH', DATA_DIR . '/pages.json');
// Progress of the reels-to-folders migration, so a timeout resumes.
define('MIGRATION_PATH', DATA_DIR . '/portfolio-migration.json');
define('PORTFOLIO_PAGES_FOLDER', '_pages');
define('CRC_CACHE_PATH', DATA_DIR . '/crc.json');

// Folder-backed portfolio: <Category>/<Gallery>/<files>, with dot-named JSON
// sidecars beside them. The folders are the source of truth — see the
// PORTFOLIO section. Deleted folders and files go to the trash, never unlink.
define('PORTFOLIO_DIR', SITE_DATA . '/portfolio');
define('PORTFOLIO_TRASH_DIR', SITE_DATA . '/portfolio-trash');
define('PORTFOLIO_PROCESS_SLICE_SECONDS', 8);
// A file younger than this may still be arriving over FTP. It is listed as
// pending and left alone, so no thumbnail is ever cut from a truncated upload.
define('PORTFOLIO_SETTLE_SECONDS', 60);
define('PORTFOLIO_LAYOUTS', ['justified', 'masonry', 'grid', 'slideshow', 'horizontal', 'fullscreen', 'featured']);
// A gallery folder migrated from PhotoShelter may carry this sidecar beside
// the media — see portfolioPhotoshelterMeta().
define('PORTFOLIO_PHOTOSHELTER_SIDECAR', '_photoshelter.json');
// Per-gallery presentation, kept as words rather than pixels so the same
// setting reads sensibly on a phone and on a 5K display.
define('PORTFOLIO_OPTION_VALUES', [
    'gap' => ['tight', 'normal', 'wide'],
    'density' => ['compact', 'normal', 'roomy'],
    'titles' => ['none', 'hover', 'under'],
    'crop' => ['fit', 'fill'],
    // Per-gallery watermark override: inherit the site setting, or off.
    'watermark' => ['off', 'inherit'],
    // How a collection shows its galleries: as cover cards, or all of them
    // on one page with a section per gallery. Only collections read it.
    'view' => ['page', 'cards'],
    // What the binary Grid toggle falls back to for a gallery whose own
    // Layout isn't already a plain grid (horizontal row, full screen,
    // slideshow, featured tiles) — see galleryViews() in portfolio.js.
    'gridStyle' => ['justified', 'masonry', 'grid'],
    // Justified/masonry/grid/featured show a picture's caption in the
    // lightbox only by default, same as its title does; this optionally
    // surfaces it inline too, the same credit overlay horizontal row, full
    // screen and slideshow already show unconditionally.
    'captions' => ['none', 'off', 'on'],
]);
// How much room a single picture takes in the "featured tiles" layout. Called
// `tile`, not `size`: an item's `size` is already its file size in bytes.
define('PORTFOLIO_TILE_SIZES', ['normal', 'wide', 'tall', 'big']);
// The home page is its own gallery in a reserved folder: it has no category,
// no public URL of its own, and never appears in listings or the menu.
define('PORTFOLIO_HOME_FOLDER', '_home');
// Who can reach a gallery:
//   public   listed everywhere, open to anyone
//   unlisted off the menus and listings, but the link works
//   password the link works once the visitor types the password
//   hidden   not served at all — a draft
define('PORTFOLIO_ACCESS', ['public', 'unlisted', 'password', 'hidden']);
// How a gallery's pictures, or a collection's galleries, are ordered. `custom`
// is the saved drag-and-drop order; anything else is worked out on read, so new
// arrivals slot in by themselves and the custom order is never overwritten.
define('PORTFOLIO_ITEM_SORTS', ['custom', 'name', 'captured', 'added']);
define('PORTFOLIO_NODE_SORTS', ['custom', 'name', 'shoot', 'created']);

// Cap for a portfolio item's caption box. Long enough for a paragraph of
// credits, short enough that the field can never bloat a gallery's videos.json.
define('DESCRIPTION_MAX_LEN', 2000);

// Delivery + ZIP constants. These live up here, not beside the delivery code,
// for the same reason as the paths above: routes execute inline as this file is
// read, so a define() further down does not exist yet when an earlier route
// calls a function that needs it. The client gallery's zip download is such a
// route. This has caused two production bugs already — leave them here.
define('PACKAGES_DIR', SITE_DATA . '/packages');
define('PACKAGE_TTL_SECONDS', 7 * 24 * 60 * 60);
define('PACKAGE_STREAM_CHUNK_BYTES', 4 * 1024 * 1024);
define('ZIP_LOCAL_HEADER_BYTES', 30);
define('ZIP_CENTRAL_ENTRY_BYTES', 46);
define('ZIP_EOCD_BYTES', 22);
define('ZIP64_LOCAL_EXTRA_BYTES', 20);
define('ZIP64_CENTRAL_EXTRA_BYTES', 28);
define('ZIP64_EOCD_BYTES', 56);
define('ZIP64_LOCATOR_BYTES', 20);
define('ZIP32_MAX', 0xFFFFFFFF);
define('CRC_WARM_SLICE_SECONDS', 10);

// Upstream repo for update checks and the optional first-run git init. Defined
// during bootstrap because both the setup handler and the updater read it, and
// handlers exit before later lines in this file would run.
define('GITHUB_REPO_DEFAULT', 'ajmastf8/show-and-deliver');

// Ensure directories exist
foreach ([DATA_DIR, UPLOADS_DIR, THUMBS_DIR, PROXY_DIR, CAPTIONS_DIR, IMPORT_DIR, PORTFOLIO_DIR, DATA_DIR . '/sessions', DATA_DIR . '/ratelimit'] as $dir) {
    if (!is_dir($dir)) mkdir($dir, 0755, true);
}

// Defence in depth: the root .htaccess already denies these, but a host that
// ignores root rules (or a stale .htaccess left by an old zip install) would
// otherwise serve the password hash, sessions, secrets and share tokens as
// plain files. A per-directory guard still applies there. Not on SITE_DATA
// itself — that would also deny the media directories the rewrites expose.
denyWebAccess(DATA_DIR);
denyWebAccess(IMPORT_DIR);
portfolioGuardDir();

// GD decodes the full bitmap into RAM, so a 24–50MP camera JPEG can need
// several hundred MB. The default 128M limit fatals mid-import on large photos.
@ini_set('memory_limit', '512M');

// Load .env
function loadEnv() {
    $envFile = __DIR__ . '/.env';
    if (!file_exists($envFile)) return;
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (strpos($line, '=') === false) continue;
        [$key, $val] = explode('=', $line, 2);
        $key = trim($key);
        $val = trim($val);
        // Strip surrounding quotes
        if ((strlen($val) >= 2) && ($val[0] === '"' || $val[0] === "'") && $val[0] === $val[strlen($val) - 1]) {
            $val = substr($val, 1, -1);
        }
        $_ENV[$key] = $val;
        putenv("$key=$val");
    }
}
loadEnv();

// Must come after loadEnv(): this is the one delivery constant that reads .env,
// and evaluating it earlier silently ignored PACKAGE_PART_MB and fell back to
// the default. The rest live at the top with the paths.
define('PACKAGE_PART_MAX_BYTES', max(0, (int)env('PACKAGE_PART_MB', 900)) * 1024 * 1024);

function env($key, $default = '') {
    return $_ENV[$key] ?? getenv($key) ?: $default;
}

// Auto-generate SESSION_SECRET if not set
if (!env('SESSION_SECRET')) {
    $secretPath = DATA_DIR . '/.session-secret';
    if (file_exists($secretPath)) {
        $_ENV['SESSION_SECRET'] = trim(file_get_contents($secretPath));
    } else {
        $generated = base64_encode(random_bytes(48));
        file_put_contents($secretPath, $generated);
        chmod($secretPath, 0600);
        $_ENV['SESSION_SECRET'] = $generated;
    }
}

// API_TOKEN can live in either .env (manual, server-admin managed) or
// site-data/data/.api-token (generated + rotated via the admin UI). If both
// are set, .env wins. The admin-UI path avoids touching .env at all.
define('API_TOKEN_PATH', DATA_DIR . '/.api-token');
if (!env('API_TOKEN') && file_exists(API_TOKEN_PATH)) {
    $_ENV['API_TOKEN'] = trim(file_get_contents(API_TOKEN_PATH));
}

// Admin credentials: check admin.json first, then .env fallback
define('ADMIN_CONFIG_PATH', DATA_DIR . '/admin.json');

function getAdminCredentials() {
    $config = jsonRead(ADMIN_CONFIG_PATH);
    if ($config && !empty($config['email']) && !empty($config['passwordHash'])) {
        return $config;
    }
    // Fallback to .env (legacy)
    $user = env('ADMIN_USERNAME');
    $pass = env('ADMIN_PASSWORD');
    if ($user && $pass && $user !== 'your-admin-username' && $pass !== 'your-strong-password') {
        return ['email' => $user, 'passwordHash' => null, 'plainPassword' => $pass];
    }
    return null; // No credentials set — needs first-run setup
}

function isSetupComplete() {
    return getAdminCredentials() !== null;
}

define('PASSWORD_RESET_PATH', DATA_DIR . '/password-reset.json');
define('PASSWORD_RESET_TTL', 3600);
define('PASSWORD_MIN_LEN', 8);

function adminPasswordMatches($creds, $password) {
    if (!empty($creds['passwordHash'])) return password_verify($password, $creds['passwordHash']);
    if (!empty($creds['plainPassword'])) return hash_equals($creds['plainPassword'], $password);
    return false;
}

// Writes the new hash to admin.json, which wins over the legacy .env pair, so
// an install still on ADMIN_PASSWORD moves off it the first time it changes.
// passwordChangedAt retires every session older than the change.
function saveAdminPassword($email, $password) {
    $config = jsonRead(ADMIN_CONFIG_PATH) ?: [];
    $config['email'] = $email;
    $config['passwordHash'] = password_hash($password, PASSWORD_BCRYPT);
    $config['passwordChangedAt'] = time();
    $config['createdAt'] = $config['createdAt'] ?? date('c');
    jsonWrite(ADMIN_CONFIG_PATH, $config);
    @unlink(PASSWORD_RESET_PATH);
}

// A logged-in session is only good if it was established after the last
// password change, so resetting a forgotten password also signs out whoever
// else was holding a session.
function isAdminSession() {
    if (empty($_SESSION['authenticated'])) return false;
    $config = jsonRead(ADMIN_CONFIG_PATH);
    $changed = (int)($config['passwordChangedAt'] ?? 0);
    return !$changed || (int)($_SESSION['authAt'] ?? 0) >= $changed;
}

// Reset links need a real public address: building one from the request's Host
// header would let anyone aim the emailed link at a site of their choosing.
function passwordResetBaseUrl() {
    $base = rtrim((string)(getEmailConfig()['baseUrl'] ?? ''), '/');
    if (!preg_match('#^https?://#i', $base)) return null;
    if (preg_match('#^https?://(localhost|127\.|\[::1\])#i', $base)) return null;
    return $base;
}

// Session
ini_set('session.save_path', DATA_DIR . '/sessions');
ini_set('session.gc_maxlifetime', 7 * 24 * 3600);
session_set_cookie_params([
    'lifetime' => 7 * 24 * 3600,
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
]);

// Only touch the session when there is one to read or one to create. Public
// pages used to call session_start() on every request, which minted a session
// file for every anonymous visitor and bot (7-day lifetime, never reclaimed on
// hosts where PHP's own gc is off) and made a visitor's parallel API calls
// queue behind PHP's session file lock.
$sessionPath = '/' . trim(preg_replace('#^.*?/api/#', '/api/', strtok($_SERVER['REQUEST_URI'] ?? '', '?')), '/');
$createsSession = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
    && ($sessionPath === '/api/auth/setup'
        || $sessionPath === '/api/auth/login'
        || $sessionPath === '/api/auth/change-password'
        || substr($sessionPath, -7) === '/unlock');
if (isset($_COOKIE[session_name()]) || $createsSession) {
    session_start();
    if ($createsSession) pruneStaleSessions();
    // Reads never write the session; release the lock so they run in parallel.
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') session_write_close();
}

// Delete session files past their lifetime, at most once a day. Bounded so a
// huge backlog is cleared over several runs instead of stalling one request.
function pruneStaleSessions() {
    $dir = DATA_DIR . '/sessions';
    $marker = $dir . '/.last-prune';
    if (is_file($marker) && filemtime($marker) > time() - 86400) return;
    @touch($marker);
    $cutoff = time() - 7 * 24 * 3600;
    $budget = 20000;
    foreach (new DirectoryIterator($dir) as $f) {
        if ($budget-- <= 0) break;
        if ($f->isFile() && strncmp($f->getFilename(), 'sess_', 5) === 0 && $f->getMTime() < $cutoff) {
            @unlink($f->getPathname());
        }
    }
}

// Security headers
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

// ============================================================
// HELPERS
// ============================================================

function respond($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function respondError($msg, $status = 400) {
    respond(['error' => $msg], $status);
}

function getInput() {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?: [];
}

function jsonRead($path) {
    if (!file_exists($path)) return null;
    $data = json_decode(file_get_contents($path), true);
    return $data;
}

function jsonWrite($path, $data) {
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

// Atomic read-modify-write for counter files. Holds an exclusive lock for the
// whole cycle so concurrent view/download hits can't clobber each other.
function jsonUpdate($path, callable $mutator) {
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $fp = fopen($path, 'c+');
    if (!$fp) return null;
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $data = ($raw !== '' && $raw !== false) ? json_decode($raw, true) : null;
    $data = $mutator(is_array($data) ? $data : []);
    rewind($fp);
    ftruncate($fp, 0);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $data;
}

function generateId($prefix = '') {
    // UUID v4
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $uuid = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    return $prefix . $uuid;
}

function generateToken($length = 12) {
    $raw = base64_encode(random_bytes((int)ceil($length * 0.75)));
    $safe = strtr($raw, '+/', '-_');
    return substr(rtrim($safe, '='), 0, $length);
}

// A share link's whole secrecy is its token, so a hand-picked one still has to
// be URL-safe (it is a path segment under /gallery/, /collection/ and /d/) and
// long enough not to be guessable in a few tries. Returns the trimmed token, or
// null if it isn't usable.
function normalizeShareToken($raw) {
    if (!is_string($raw)) return null;
    $t = trim($raw);
    $len = strlen($t);
    if ($len < 6 || $len > 64) return null;
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $t)) return null;
    return $t;
}

define('SHARE_TOKEN_RULES', 'Links must be 6-64 characters, using only letters, numbers, dashes and underscores.');

function requireAuth() {
    // Browser path: session cookie set by /api/auth/login. Release the session
    // lock once auth is confirmed (we don't write to it here) so concurrent
    // requests sharing the same cookie aren't serialized by PHP's file lock.
    if (isAdminSession()) { session_write_close(); return; }

    // Programmatic path: Authorization: Bearer <API_TOKEN>. Only active when
    // API_TOKEN is defined in .env (empty value disables the Bearer path).
    $configured = env('API_TOKEN', '');
    if ($configured !== '') {
        $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (stripos($hdr, 'Bearer ') === 0) {
            $presented = trim(substr($hdr, 7));
            if (hash_equals($configured, $presented)) {
                // Cheap-to-brute-force-from-LAN mitigations: one shared IP
                // burst per minute should not be able to spam the admin API.
                rateLimitCheck('api:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 60, 60);
                return;
            }
        }
    }

    respondError('Unauthorized', 401);
}

function rateLimitCheck($key, $max, $windowSec) {
    $dir = DATA_DIR . '/ratelimit';
    $file = $dir . '/' . md5($key) . '.json';
    $now = time();
    $attempts = [];
    if (file_exists($file)) {
        $attempts = json_decode(file_get_contents($file), true) ?: [];
        $attempts = array_filter($attempts, fn($t) => $t > $now - $windowSec);
    }
    if (count($attempts) >= $max) {
        respondError('Too many attempts. Please try again later.', 429);
    }
    $attempts[] = $now;
    file_put_contents($file, json_encode(array_values($attempts)));
}

function escHtml($str) {
    return htmlspecialchars($str ?? '', ENT_QUOTES, 'UTF-8');
}

// Where a self-installed static ffmpeg build lives. SITE_DATA is always writable
// (uploads/captions are written there) and survives git deploys; the home dir is
// a fallback but isn't writable under some LiteSpeed/cPanel setups.
function ffmpegSearchBases() {
    $home = getenv('HOME') ?: ($_SERVER['HOME'] ?? '');
    return array_values(array_filter([SITE_DATA, $home]));
}

// Find ffmpeg/ffprobe: system PATH first, then a static build we installed.
function findBinary($name) {
    $which = trim(shell_exec("which $name 2>/dev/null") ?? '');
    if ($which) return $which;
    foreach (ffmpegSearchBases() as $base) {
        foreach (glob("$base/ffmpeg-*-static") ?: [] as $dir) {
            $candidate = $dir . "/$name";
            if (is_file($candidate)) return $candidate;
        }
    }
    return $name; // fallback to PATH
}

$FFMPEG = findBinary('ffmpeg');
$FFPROBE = findBinary('ffprobe');

// Does a binary path actually run and report a version? findBinary() may hand
// back a bare 'ffmpeg' that isn't really on PATH, so confirm before trusting it.
function toolRuns($bin) {
    if (!$bin) return false;
    $out = shell_exec(escapeshellcmd($bin) . ' -version 2>/dev/null');
    return is_string($out) && stripos($out, 'version') !== false;
}

function videoToolsStatus() {
    global $FFMPEG, $FFPROBE;
    $ffmpegOk = toolRuns($FFMPEG);
    $version = '';
    if ($ffmpegOk && preg_match('/ffmpeg version (\S+)/', (string)shell_exec(escapeshellcmd($FFMPEG) . ' -version 2>/dev/null'), $m)) {
        $version = $m[1];
    }
    return [
        'ffmpeg'  => $ffmpegOk,
        'ffprobe' => toolRuns($FFPROBE),
        'version' => $version,
        'path'    => $ffmpegOk ? $FFMPEG : null,
    ];
}

// Download + unpack a static ffmpeg/ffprobe build into a writable base that
// findBinary() searches (site-data, or the home dir) — for cPanel/shared hosts
// with no system ffmpeg. This is what powers automatic embedded-caption extraction.
function installStaticFfmpeg() {
    // Prefer the home dir when it's actually writable; otherwise use site-data,
    // which the app always writes to. Some LiteSpeed/cPanel setups give PHP no
    // usable $HOME, so home-only would fail there.
    $home = getenv('HOME') ?: ($_SERVER['HOME'] ?? '');
    $base = ($home && is_dir($home) && is_writable($home)) ? $home : SITE_DATA;
    if (!is_dir($base) || !is_writable($base)) {
        return ['ok' => false, 'error' => 'No writable directory available to install into.'];
    }
    $arch = php_uname('m');
    $builds = ['x86_64' => 'amd64', 'amd64' => 'amd64', 'aarch64' => 'arm64', 'arm64' => 'arm64', 'armv7l' => 'armhf', 'i686' => 'i686'];
    if (!isset($builds[$arch])) return ['ok' => false, 'error' => "Unsupported CPU architecture: $arch"];
    $url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-' . $builds[$arch] . '-static.tar.xz';
    $tar = $base . '/.ffmpeg-static-download.tar.xz';
    @unlink($tar);

    // Download (curl, then wget fallback).
    shell_exec('curl -fsSL ' . escapeshellarg($url) . ' -o ' . escapeshellarg($tar) . ' 2>&1');
    if (!is_file($tar) || filesize($tar) < 1000000) {
        shell_exec('wget -q ' . escapeshellarg($url) . ' -O ' . escapeshellarg($tar) . ' 2>&1');
    }
    if (!is_file($tar) || filesize($tar) < 1000000) {
        @unlink($tar);
        return ['ok' => false, 'error' => 'Download failed — the server may block outbound HTTPS, or curl/wget is unavailable.'];
    }

    // Replace any prior install so versions don't accumulate, then extract.
    foreach (glob("$base/ffmpeg-*-static") ?: [] as $old) {
        shell_exec('rm -rf ' . escapeshellarg($old));
    }
    $extract = shell_exec('tar xf ' . escapeshellarg($tar) . ' -C ' . escapeshellarg($base) . ' 2>&1');
    @unlink($tar);
    if (!glob("$base/ffmpeg-*-static")) {
        return ['ok' => false, 'error' => 'Could not unpack the archive (xz/tar may be unavailable).', 'detail' => trim((string)$extract)];
    }

    // Re-resolve binaries now that the static build is in place, and verify.
    global $FFMPEG, $FFPROBE;
    $FFMPEG = findBinary('ffmpeg');
    $FFPROBE = findBinary('ffprobe');
    $status = videoToolsStatus();
    if (!$status['ffmpeg'] || !$status['ffprobe']) {
        return ['ok' => false, 'error' => 'Installed the files but they will not run on this server.', 'status' => $status];
    }
    return ['ok' => true, 'status' => $status];
}

// Image extensions
define('IMAGE_EXTS', ['jpg', 'jpeg', 'png', 'webp', 'gif']);
define('VIDEO_EXTS', ['mp4', 'webm', 'mov', 'm4v']);
define('MEDIA_EXTS', array_merge(VIDEO_EXTS, IMAGE_EXTS));
// Closed-caption / subtitle sidecar files. WebVTT only — it's the format
// browsers consume natively via <track>.
define('CAPTION_EXT', 'vtt');

function isImageFile($filename) {
    return in_array(strtolower(pathinfo($filename, PATHINFO_EXTENSION)), IMAGE_EXTS);
}

function probeVideo($filePath) {
    global $FFPROBE;
    $cmd = escapeshellcmd($FFPROBE) . ' -v quiet -print_format json -show_format -show_streams ' . escapeshellarg($filePath);
    $output = shell_exec($cmd);
    if (!$output) return null;
    $info = json_decode($output, true);
    if (!$info) return null;
    $videoStream = null;
    foreach (($info['streams'] ?? []) as $s) {
        if (($s['codec_type'] ?? '') === 'video') { $videoStream = $s; break; }
    }
    return [
        'duration' => (float)($info['format']['duration'] ?? 0),
        'width' => (int)($videoStream['width'] ?? 0),
        'height' => (int)($videoStream['height'] ?? 0),
    ];
}

// Duration (seconds) straight from the MP4/MOV `mvhd` box — no ffmpeg needed, so
// it works on hosts without ffprobe (where probeVideo() returns nothing). Seeks
// past `mdat`, so it's cheap even on multi-hundred-MB files. Returns 0 on failure.
function mp4DurationSeconds($path) {
    $fh = @fopen($path, 'rb');
    if (!$fh) return 0.0;
    try {
        return mp4FindMvhd($fh, @filesize($path) ?: 0, 0) ?: 0.0;
    } finally {
        fclose($fh);
    }
}
function mp4FindMvhd($fh, $end, $start) {
    $pos = $start;
    while ($pos + 8 <= $end) {
        fseek($fh, $pos);
        $hdr = fread($fh, 8);
        if (strlen($hdr) < 8) break;
        $size = unpack('N', substr($hdr, 0, 4))[1];
        $type = substr($hdr, 4, 4);
        $headerLen = 8;
        if ($size === 1) {                      // 64-bit largesize
            $p = unpack('Nhi/Nlo', fread($fh, 8));
            $size = $p['hi'] * 4294967296 + $p['lo'];
            $headerLen = 16;
        } elseif ($size === 0) {
            $size = $end - $pos;                 // box runs to end of file
        }
        if ($size < $headerLen) break;
        $contentStart = $pos + $headerLen;
        $contentEnd = $pos + $size;
        if ($type === 'moov' || $type === 'trak' || $type === 'mdia') {
            $d = mp4FindMvhd($fh, min($contentEnd, $end), $contentStart);
            if ($d) return $d;
        } elseif ($type === 'mvhd') {
            fseek($fh, $contentStart);
            $ver = ord(fread($fh, 1));
            fread($fh, 3);                       // flags
            if ($ver === 1) {
                fread($fh, 16);                  // creation + modification times
                $timescale = unpack('N', fread($fh, 4))[1];
                $p = unpack('Nhi/Nlo', fread($fh, 8));
                $duration = $p['hi'] * 4294967296 + $p['lo'];
            } else {
                fread($fh, 8);
                $timescale = unpack('N', fread($fh, 4))[1];
                $duration = unpack('N', fread($fh, 4))[1];
            }
            return $timescale > 0 ? $duration / $timescale : 0.0;
        }
        $pos = $contentEnd;
    }
    return 0.0;
}

// Best-available duration: a stored value, else ffprobe, else the pure-PHP MP4
// reader — so callers get a usable number whether or not ffmpeg is installed.
function resolveVideoDuration($path, $stored = 0) {
    $d = (float)$stored;
    if ($d > 0) return $d;
    $meta = probeVideo($path);
    if ($meta && ($meta['duration'] ?? 0) > 0) return (float)$meta['duration'];
    return mp4DurationSeconds($path);
}

// Display width/height of the first video track, read from its `tkhd` box — the
// pure-PHP counterpart of probeVideo()'s dimensions, which need ffprobe. A 90°
// rotation matrix (phone portrait video) swaps them, as a player would. Returns
// null when the file isn't MP4/MOV or has no visual track.
function mp4VideoDimensions($path) {
    $fh = @fopen($path, 'rb');
    if (!$fh) return null;
    try {
        return mp4FindTkhd($fh, @filesize($path) ?: 0, 0);
    } finally {
        fclose($fh);
    }
}
function mp4FindTkhd($fh, $end, $start) {
    $pos = $start;
    while ($pos + 8 <= $end) {
        fseek($fh, $pos);
        $hdr = fread($fh, 8);
        if (strlen($hdr) < 8) break;
        $size = unpack('N', substr($hdr, 0, 4))[1];
        $type = substr($hdr, 4, 4);
        $headerLen = 8;
        if ($size === 1) {
            $p = unpack('Nhi/Nlo', fread($fh, 8));
            $size = $p['hi'] * 4294967296 + $p['lo'];
            $headerLen = 16;
        } elseif ($size === 0) {
            $size = $end - $pos;
        }
        if ($size < $headerLen) break;
        $contentStart = $pos + $headerLen;
        $contentEnd = $pos + $size;
        if ($type === 'moov' || $type === 'trak') {
            $d = mp4FindTkhd($fh, min($contentEnd, $end), $contentStart);
            if ($d) return $d;
        } elseif ($type === 'tkhd') {
            fseek($fh, $contentStart);
            $ver = ord(fread($fh, 1));
            fread($fh, 3);
            // Times, track id, reserved, duration: 20 bytes in v0, 32 in v1.
            // Then reserved(8) layer(2) group(2) volume(2) reserved(2).
            fread($fh, ($ver === 1 ? 32 : 20) + 16);
            $m = unpack('N9', fread($fh, 36));
            $wh = unpack('Nw/Nh', fread($fh, 8));
            $w = (int)round($wh['w'] / 65536);
            $h = (int)round($wh['h'] / 65536);
            // Audio tracks carry 0×0; keep looking for the picture.
            if ($w > 0 && $h > 0) {
                // Matrix a=0 with b=±1 is a quarter turn.
                if ($m[1] === 0 && ($m[2] === 0x00010000 || $m[2] === 0xFFFF0000)) [$w, $h] = [$h, $w];
                return ['width' => $w, 'height' => $h];
            }
        }
        $pos = $contentEnd;
    }
    return null;
}

// ---- WebVTT timecode helpers -------------------------------------------------

function vttTsToSeconds($ts) {
    $p = explode(':', $ts);
    if (count($p) === 3) return $p[0] * 3600 + $p[1] * 60 + (float)$p[2];
    return $p[0] * 60 + (float)$p[1];
}

function secondsToVttTs($total) {
    if ($total < 0) $total = 0;
    $h = floor($total / 3600);
    $rem = $total - $h * 3600;
    $m = floor($rem / 60);
    $s = $rem - $m * 60;
    return sprintf('%02d:%02d:%06.3f', $h, $m, $s);
}

// Earliest start / latest end (seconds) across all cue timing lines, or null.
function vttTimeBounds($content) {
    $re = '/((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})/';
    if (!preg_match_all($re, $content, $rows, PREG_SET_ORDER)) return null;
    $min = INF; $max = -INF;
    foreach ($rows as $r) {
        $s = vttTsToSeconds($r[1]); $e = vttTsToSeconds($r[2]);
        if ($s < $min) $min = $s;
        if ($e > $max) $max = $e;
    }
    return [$min, $max];
}

// Editors whose timeline starts at a non-zero timecode base (commonly 01:00:00)
// export captions an hour-plus ahead of the footage, so every cue lands past the
// end of the clip and nothing ever displays. When the WHOLE track sits beyond the
// video's duration, shift every cue back by whole hours so it lands in range.
// Conservative by design: only fires when all cues are out of range, and only
// when the shift brings the first cue back inside [0, duration).
// Returns [content, shiftedHours]; shiftedHours 0 means untouched.
function vttAutoShift($content, $duration) {
    if ($duration <= 0) return [$content, 0];
    $bounds = vttTimeBounds($content);
    if (!$bounds) return [$content, 0];
    [$min, $max] = $bounds;
    if ($min < $duration) return [$content, 0];
    $hours = (int)floor($min / 3600);
    if ($hours < 1) return [$content, 0];
    $shift = $hours * 3600;
    if (($min - $shift) < 0 || ($min - $shift) >= $duration) return [$content, 0];
    $re = '/((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})(\s*-->\s*)((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})/';
    $out = preg_replace_callback($re, function ($m) use ($shift) {
        return secondsToVttTs(vttTsToSeconds($m[1]) - $shift) . $m[2]
             . secondsToVttTs(vttTsToSeconds($m[3]) - $shift);
    }, $content);
    return [$out, $hours];
}

// ---- Embedded subtitle extraction -------------------------------------------

// Common ISO 639-2/B (3-letter) -> BCP-47 (2-letter) so srclang is browser-friendly.
function normalizeCaptionLang($lang) {
    $lang = strtolower(trim($lang));
    $map = [
        'eng' => 'en', 'ita' => 'it', 'spa' => 'es', 'fra' => 'fr', 'fre' => 'fr',
        'deu' => 'de', 'ger' => 'de', 'por' => 'pt', 'nld' => 'nl', 'dut' => 'nl',
        'jpn' => 'ja', 'kor' => 'ko', 'zho' => 'zh', 'chi' => 'zh', 'ara' => 'ar',
        'hin' => 'hi', 'rus' => 'ru',
    ];
    if (isset($map[$lang])) return $map[$lang];
    if (preg_match('/^[a-z]{2,3}(-[a-z]{2,4})?$/', $lang)) return $lang;
    return '';
}

function captionLangLabel($lang) {
    $names = [
        'en' => 'English', 'it' => 'Italiano', 'es' => 'Español', 'fr' => 'Français',
        'de' => 'Deutsch', 'pt' => 'Português', 'nl' => 'Nederlands', 'ja' => '日本語',
        'ko' => '한국어', 'zh' => '中文 (Mandarin)', 'ar' => 'العربية', 'hi' => 'हिन्दी',
        'ru' => 'Русский',
    ];
    return $names[$lang] ?? strtoupper($lang);
}

// Text-based subtitle codecs that convert cleanly to WebVTT via ffmpeg.
function videoSubtitleStreams($filePath) {
    global $FFPROBE;
    $cmd = escapeshellcmd($FFPROBE) . ' -v quiet -print_format json -show_streams -select_streams s ' . escapeshellarg($filePath);
    $output = shell_exec($cmd);
    if (!$output) return [];
    $info = json_decode($output, true);
    if (!$info || empty($info['streams'])) return [];
    $streams = [];
    foreach ($info['streams'] as $s) {
        if (!in_array($s['codec_name'] ?? '', ['mov_text', 'subrip', 'srt', 'webvtt', 'text', 'ass', 'ssa'], true)) continue;
        $streams[] = ['index' => (int)($s['index'] ?? 0), 'lang' => strtolower($s['tags']['language'] ?? '')];
    }
    return $streams;
}

// Browsers ignore subtitle tracks muxed inside the MP4 — only external WebVTT
// loaded via <track> renders. Extract each embedded text subtitle stream to a
// .vtt sidecar (auto-shifted to the timeline) and return caption records to
// attach to the item. Best-effort: returns [] when ffmpeg/ffprobe are absent or
// the file has no convertible subtitle streams.
function extractEmbeddedCaptions($videoPath, $itemId, $duration) {
    $streams = videoSubtitleStreams($videoPath);
    if (!$streams) return [];
    global $FFMPEG;
    $captions = [];
    $usedLangs = [];
    foreach ($streams as $st) {
        $lang = normalizeCaptionLang($st['lang']);
        if ($lang === '') $lang = 'und';
        if (isset($usedLangs[$lang])) continue;        // one track per language
        $tmp = sys_get_temp_dir() . '/cap_' . $itemId . '_' . $st['index'] . '.vtt';
        $cmd = escapeshellcmd($FFMPEG) . ' -y -v quiet -i ' . escapeshellarg($videoPath)
             . ' -map 0:' . (int)$st['index'] . ' -c:s webvtt ' . escapeshellarg($tmp) . ' 2>/dev/null';
        shell_exec($cmd);
        $valid = is_file($tmp) && filesize($tmp) > 0
            && strncmp(ltrim((string)file_get_contents($tmp, false, null, 0, 16), "\xEF\xBB\xBF"), 'WEBVTT', 6) === 0;
        if (!$valid) { @unlink($tmp); continue; }
        $content = (string)file_get_contents($tmp);
        @unlink($tmp);
        [$content] = vttAutoShift($content, $duration);
        $destName = $itemId . '-' . $lang . '-' . time() . '-' . $st['index'] . '.vtt';
        if (file_put_contents(CAPTIONS_DIR . '/' . $destName, $content) === false) continue;
        $captions[] = ['lang' => $lang, 'label' => captionLangLabel($lang), 'filename' => $destName];
        $usedLangs[$lang] = true;
    }
    return $captions;
}

// EXIF orientation flag (1–8); 1 means no transform needed.
function imageOrientation($filePath) {
    if (!function_exists('exif_read_data')) return 1;
    $exif = @exif_read_data($filePath);
    $o = (int)($exif['Orientation'] ?? 1);
    return ($o >= 1 && $o <= 8) ? $o : 1;
}

// Bake an EXIF orientation flag into a GD image's pixels, returning the
// (possibly replaced) resource. GD strips EXIF on re-encode, so without this
// portrait photos from phones/cameras come out sideways in thumbs/proxies.
function applyExifOrientation($img, $orientation) {
    switch ($orientation) {
        case 2: imageflip($img, IMG_FLIP_HORIZONTAL); break;
        case 3: $img = imagerotate($img, 180, 0); break;
        case 4: imageflip($img, IMG_FLIP_VERTICAL); break;
        case 5: $img = imagerotate($img, -90, 0); imageflip($img, IMG_FLIP_HORIZONTAL); break;
        case 6: $img = imagerotate($img, -90, 0); break;
        case 7: $img = imagerotate($img, 90, 0); imageflip($img, IMG_FLIP_HORIZONTAL); break;
        case 8: $img = imagerotate($img, 90, 0); break;
    }
    return $img;
}

// Load an image into a GD resource with EXIF orientation already applied.
function loadOrientedImage($srcPath) {
    $info = @getimagesize($srcPath);
    if (!$info) return false;
    switch ($info[2]) {
        case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($srcPath); break;
        case IMAGETYPE_PNG:  $src = @imagecreatefrompng($srcPath); break;
        case IMAGETYPE_WEBP: $src = @imagecreatefromwebp($srcPath); break;
        case IMAGETYPE_GIF:  $src = @imagecreatefromgif($srcPath); break;
        default: return false;
    }
    if (!$src) return false;
    if ($info[2] === IMAGETYPE_JPEG) {
        $src = applyExifOrientation($src, imageOrientation($srcPath));
    }
    return $src;
}

function probeImage($filePath) {
    $info = @getimagesize($filePath);
    if (!$info) return null;
    $w = $info[0];
    $h = $info[1];
    // Orientations 5–8 are rotated 90°, so displayed dimensions are swapped.
    if ($info[2] === IMAGETYPE_JPEG && in_array(imageOrientation($filePath), [5, 6, 7, 8], true)) {
        [$w, $h] = [$h, $w];
    }
    return ['width' => $w, 'height' => $h];
}

// --- Item metadata (the admin's item page) ---

// Curated EXIF. exif_read_data covers JPEG/TIFF; other formats return little.
function portfolioItemExif($path) {
    if (!function_exists('exif_read_data')) return [];
    $e = @exif_read_data($path, null, true);
    if (!$e) return [];
    $flat = [];
    foreach ($e as $section => $values) {
        if (in_array($section, ['FILE', 'COMPUTED', 'THUMBNAIL'], true) || !is_array($values)) continue;
        foreach ($values as $k => $v) {
            if (!is_array($v) && $v !== '') $flat[$k] = (string)$v;
        }
    }
    $want = ['Make', 'Model', 'LensModel', 'Lens', 'FNumber', 'ExposureTime', 'ExposureProgram',
        'ISOSpeedRatings', 'FocalLength', 'FocalLengthIn35mmFilm', 'DateTimeOriginal', 'CreateDate',
        'Orientation', 'Software', 'Artist', 'Copyright', 'ImageDescription'];
    $out = [];
    foreach ($want as $k) if (isset($flat[$k])) $out[$k] = $flat[$k];
    return $out;
}

// The common XMP fields, pulled from the file's XML packet. Narrow on purpose:
// a miss just means the field isn't shown.
function portfolioItemXmp($path) {
    $fh = @fopen($path, 'rb');
    if (!$fh) return [];
    $head = (string)fread($fh, 262144);
    fclose($fh);
    if (strpos($head, 'xmpmeta') === false) return [];
    $out = [];
    foreach (['creator' => 'Creator', 'rights' => 'Rights', 'title' => 'Title', 'description' => 'Description'] as $tag => $label) {
        if (preg_match('#<dc:' . $tag . '>.*?<rdf:li[^>]*>(.*?)</rdf:li>#is', $head, $m)) {
            $v = trim(html_entity_decode($m[1], ENT_QUOTES, 'UTF-8'));
            if ($v !== '') $out[$label] = $v;
        }
    }
    if (preg_match('#<dc:subject>.*?</dc:subject>#is', $head, $m) && strpos($m[0], '<rdf:li') !== false) {
        preg_match_all('#<rdf:li[^>]*>(.*?)</rdf:li>#is', $m[0], $mm);
        $out['Keywords'] = array_map(fn($s) => trim(html_entity_decode($s, ENT_QUOTES, 'UTF-8')), $mm[1]);
    }
    if (preg_match('#xmp:Rating="(-?\d+)"#i', $head, $m)) $out['Rating'] = (int)$m[1];
    if (preg_match('#photoshop:Credit[>="]+([^<"]+)#i', $head, $m)) $out['Credit'] = trim($m[1]);
    return $out;
}

// Everything the admin item page shows for one file.
function portfolioItemMeta($gal, $file, array $it) {
    $path = $gal['dir'] . '/' . $file;
    $w = (int)($it['width'] ?? 0);
    $h = (int)($it['height'] ?? 0);
    if (($it['type'] ?? '') === 'photo') {
        $p = probeImage($path);
        if ($p) { $w = $p['width']; $h = $p['height']; }
    }
    $facts = [
        'file' => $file,
        'type' => $it['type'] ?? 'photo',
        'bytes' => (int)@filesize($path),
        'width' => $w,
        'height' => $h,
        'addedAt' => $it['addedAt'] ?? null,
        'mtime' => (int)@filemtime($path),
        'visible' => ($it['visible'] ?? true) !== false,
        'cover' => (($gal['sidecar']['cover'] ?? null) === $file),
    ];
    if (($it['type'] ?? '') === 'video' && function_exists('mp4DurationSeconds')) {
        $facts['duration'] = mp4DurationSeconds($path);
    }
    $meta = [
        'facts' => $facts,
        'exif' => portfolioItemExif($path),
        'xmp' => portfolioItemXmp($path),
        'gallery' => ['id' => $gal['id'], 'title' => portfolioTitle($gal)],
    ];
    if (!empty($it['id'])) {
        $meta['thumb'] = '/thumbnails/' . $it['id'] . '.jpg';
        $meta['proxy'] = '/proxies/' . $it['id'] . '_proxy.jpg';
    }
    return $meta;
}

function generatePhotoThumbnail($srcPath, $thumbPath) {
    $src = loadOrientedImage($srcPath);
    if (!$src) return false;
    $origW = imagesx($src);
    $origH = imagesy($src);

    $maxDim = 640;
    $ratio = min($maxDim / max($origW, 1), $maxDim / max($origH, 1), 1);
    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    $dst = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagejpeg($dst, $thumbPath, 80);
    // No imagedestroy(): GD images have been ordinary objects freed by the
    // garbage collector since PHP 8.0, and the call is deprecated in 8.5 —
    // where its notice lands in the middle of a JSON response.
    return true;
}

function generatePhotoProxy($srcPath, $proxyPath) {
    $src = loadOrientedImage($srcPath);
    if (!$src) return false;
    $origW = imagesx($src);
    $origH = imagesy($src);

    $maxDim = 2048;
    $ratio = min($maxDim / max($origW, 1), $maxDim / max($origH, 1), 1);
    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    $dst = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagejpeg($dst, $proxyPath, 82);
    // No imagedestroy(): GD images have been ordinary objects freed by the
    // garbage collector since PHP 8.0, and the call is deprecated in 8.5 —
    // where its notice lands in the middle of a JSON response.
    return true;
}

function generateVideoThumbnail($videoPath, $thumbPath, $seekTime = '1', &$errorOutput = null) {
    global $FFMPEG;
    // scale: fit within 640 wide, preserve aspect ratio; -2 snaps to even height
    $cmd = escapeshellcmd($FFMPEG) . ' -ss ' . escapeshellarg($seekTime)
        . ' -i ' . escapeshellarg($videoPath)
        . ' -frames:v 1 -vf "scale=\'min(640,iw)\':-2" -pix_fmt yuvj420p -threads 1 -q:v 2 -y '
        . escapeshellarg($thumbPath) . ' 2>&1';
    exec($cmd, $output, $ret);
    $errorOutput = implode("\n", $output);
    return file_exists($thumbPath) && filesize($thumbPath) >= 100;
}

function safeFilename($name) {
    return preg_replace('/[^a-zA-Z0-9._-]/', '_', $name);
}

function formatTimestamp($seconds) {
    $mins = floor($seconds / 60);
    $secs = str_pad(floor($seconds % 60), 2, '0', STR_PAD_LEFT);
    return "$mins:$secs";
}

// --- Data access ---

function readGalleries() { return jsonRead(DATA_DIR . '/galleries.json') ?: []; }
function writeGalleries($data) { jsonWrite(DATA_DIR . '/galleries.json', $data); }
function readCollections() { return jsonRead(DATA_DIR . '/collections.json') ?: []; }
function writeCollections($data) { jsonWrite(DATA_DIR . '/collections.json', $data); }
function readSettings() { return jsonRead(DATA_DIR . '/settings.json') ?: []; }
function writeSettings($data) { jsonWrite(DATA_DIR . '/settings.json', $data); }

// Collections carry the same type as the galleries they group: 'proofing'
// (client delivery, gated by password/expiry) or 'reels' (portfolio, public).
// Collections created before the type existed are proofing collections.
function collectionType($col) {
    return ($col['type'] ?? 'proofing') === 'reels' ? 'reels' : 'proofing';
}

// Reels galleries predating portfolio collections were created with a null
// token. Mint one so they can be linked from a portfolio collection page.
// Runs once from the admin gallery list; a no-op on every later call.
function backfillGalleryTokens() {
    $galleries = readGalleries();
    $changed = false;
    foreach ($galleries as &$g) {
        if (empty($g['token'])) { $g['token'] = generateToken(); $changed = true; }
    }
    unset($g);
    if ($changed) writeGalleries($galleries);
}

function galleryDir($gid) { return DATA_DIR . '/gallery-' . $gid; }
function ensureGalleryDir($gid) {
    $dir = galleryDir($gid);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return $dir;
}
function readGalleryVideos($gid) { return jsonRead(galleryDir($gid) . '/videos.json') ?: []; }
function writeGalleryVideos($gid, $data) { ensureGalleryDir($gid); jsonWrite(galleryDir($gid) . '/videos.json', $data); }
function readGalleryComments($gid) { return jsonRead(galleryDir($gid) . '/comments.json') ?: []; }
function writeGalleryComments($gid, $data) { ensureGalleryDir($gid); jsonWrite(galleryDir($gid) . '/comments.json', $data); }

// --- View / download stats ---

function galleryStatsPath($gid) { return galleryDir($gid) . '/stats.json'; }
function readGalleryStats($gid) { return jsonRead(galleryStatsPath($gid)) ?: []; }
function collectionDir($cid) { return DATA_DIR . '/collection-' . $cid; }
function collectionStatsPath($cid) { return collectionDir($cid) . '/stats.json'; }
function readCollectionStats($cid) { return jsonRead(collectionStatsPath($cid)) ?: []; }

// Stable per-browser visitor id, planted in a long-lived cookie. Primary
// signal for unique-visitor counts.
function visitorId() {
    $cookie = $_COOKIE['vrs_vid'] ?? '';
    if (preg_match('/^[a-f0-9]{32}$/', $cookie)) return $cookie;
    $id = bin2hex(random_bytes(16));
    setcookie('vrs_vid', $id, [
        'expires' => time() + 2 * 365 * 24 * 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    ]);
    $_COOKIE['vrs_vid'] = $id;
    return $id;
}

// Salted hash of the client IP — never stored raw. Used only as a same-day
// dedup guard for visitors who clear cookies between visits.
function visitorIpHash() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return substr(hash_hmac('sha256', $ip, env('SESSION_SECRET')), 0, 16);
}

// Record one view against a stats.json file. total bumps every load; unique
// counts distinct cookie ids, with the ip-hash+date map suppressing a recount
// when a returning visitor has cleared their cookie that same day.
function recordView($statsPath) {
    $vid = visitorId();
    $ipDay = visitorIpHash() . '|' . date('Y-m-d');
    jsonUpdate($statsPath, function($stats) use ($vid, $ipDay) {
        $views = $stats['views'] ?? [];
        $views['total'] = ($views['total'] ?? 0) + 1;
        $views['lastViewedAt'] = date('c');
        $seen = $views['seenVisitors'] ?? [];
        $ipDays = $views['seenIpDays'] ?? [];
        if (!in_array($vid, $seen, true) && !isset($ipDays[$ipDay])) {
            $seen[] = $vid;
        }
        if (!isset($ipDays[$ipDay])) $ipDays[$ipDay] = $vid;
        // Keep the ip-day map bounded — 30 days is plenty for dedup.
        $cutoff = date('Y-m-d', time() - 30 * 24 * 3600);
        foreach ($ipDays as $k => $v) {
            if (substr($k, strpos($k, '|') + 1) < $cutoff) unset($ipDays[$k]);
        }
        $views['seenVisitors'] = $seen;
        $views['seenIpDays'] = $ipDays;
        $views['unique'] = count($seen);
        $stats['views'] = $views;
        return $stats;
    });
}

function recordItemDownload($statsPath, $videoId) {
    jsonUpdate($statsPath, function($stats) use ($videoId) {
        $dl = $stats['downloads'] ?? [];
        $items = $dl['items'] ?? [];
        $items[$videoId] = ($items[$videoId] ?? 0) + 1;
        $dl['items'] = $items;
        $stats['downloads'] = $dl;
        return $stats;
    });
}

function recordDownloadAll($statsPath) {
    jsonUpdate($statsPath, function($stats) {
        $dl = $stats['downloads'] ?? [];
        $dl['downloadAll'] = ($dl['downloadAll'] ?? 0) + 1;
        $stats['downloads'] = $dl;
        return $stats;
    });
}

// Public-facing slice of a stats file — drops the internal dedup bookkeeping.
function publicStats($stats) {
    $views = $stats['views'] ?? [];
    $downloads = $stats['downloads'] ?? [];
    return [
        'views' => [
            'total' => $views['total'] ?? 0,
            'unique' => $views['unique'] ?? 0,
            'lastViewedAt' => $views['lastViewedAt'] ?? null,
        ],
        'downloads' => [
            'downloadAll' => $downloads['downloadAll'] ?? 0,
            'items' => $downloads['items'] ?? (object)[],
        ],
    ];
}

function findReelsGallery() {
    foreach (readGalleries() as $g) {
        if ($g['type'] === 'reels' && ($g['active'] ?? true) !== false) return $g;
    }
    return null;
}

// Both gallery types resolve here. /gallery/{token} is the only per-gallery
// page there is, and a portfolio collection links its member reels galleries
// to it (see backfillGalleryTokens above) — restricting this to proofing
// galleries made every card on a portfolio collection page 404.
function findGalleryByToken($token) {
    foreach (readGalleries() as $g) {
        if ($g['token'] === $token) return $g;
    }
    return null;
}

function findCollectionByToken($token) {
    foreach (readCollections() as $c) {
        if ($c['token'] === $token) return $c;
    }
    return null;
}

function sanitizeGallery($g) {
    $out = $g;
    $out['hasPassword'] = !empty($g['password']);
    unset($out['password']);
    return $out;
}

// --- Email ---

function getEmailConfig() {
    $settings = readSettings();
    $smtp = $settings['smtp'] ?? [];
    return [
        'host' => $smtp['host'] ?? env('SMTP_HOST'),
        'port' => (int)($smtp['port'] ?? env('SMTP_PORT', 587)),
        'secure' => $smtp['secure'] ?? (env('SMTP_SECURE') === 'true'),
        'user' => $smtp['user'] ?? env('SMTP_USER'),
        'pass' => $smtp['pass'] ?? env('SMTP_PASS'),
        'from' => $smtp['from'] ?? env('SMTP_FROM', ''),
        'adminEmail' => $smtp['adminEmail'] ?? env('ADMIN_EMAIL'),
        'baseUrl' => $smtp['baseUrl'] ?? env('BASE_URL', 'http://localhost'),
        'resendApiKey' => $smtp['resendApiKey'] ?? env('RESEND_API_KEY'),
    ];
}

// --- Email presentation ---

// Per-site identity for subject lines and the masthead. Comes from
// Settings > Header — this app ships to many installs, so it is never
// hardcoded.
function siteName() {
    $header = readHeaderConfig();
    foreach ([$header['siteName'] ?? '', $header['logo']['text'] ?? ''] as $candidate) {
        $candidate = trim((string)$candidate);
        if ($candidate !== '') return $candidate;
    }
    return 'Show & Deliver';
}

// Every subject reads "<Site> — <what this is>: <which one>", so someone
// scanning an inbox can tell a download link from a gallery link from a comment
// notification without opening anything.
function emailSubject($kind, $detail = '') {
    $subject = siteName() . ' — ' . $kind;
    $detail = trim((string)$detail);
    return $detail === '' ? $subject : $subject . ': ' . $detail;
}

// Shared shell so every email looks like it came from the same studio.
// Table-based and inline-styled on purpose: mail clients strip <style> blocks
// and ignore most modern layout.
//
//   title    headline inside the card
//   lead     one-line summary under the headline
//   body     optional HTML block (comment lists, file lists)
//   cta      ['label' => ..., 'url' => ...] for the primary button
//   note     small print under the button (expiry warnings, etc.)
function emailShell(array $o) {
    $site = siteName();
    $base = rtrim(getEmailConfig()['baseUrl'] ?: '', '/');
    $accent = '#0019ff';
    $ink = '#1a1a1a';
    $muted = '#8a8f98';

    $cta = '';
    if (!empty($o['cta']['url'])) {
        $cta = '<tr><td style="padding:4px 0 8px;">'
            . '<a href="' . escHtml($o['cta']['url']) . '" '
            . 'style="display:inline-block;background:' . $accent . ';color:#ffffff;font-size:15px;font-weight:700;'
            . 'text-decoration:none;padding:14px 30px;border-radius:6px;">'
            . escHtml($o['cta']['label']) . '</a></td></tr>';
    }

    $note = !empty($o['note'])
        ? '<tr><td style="padding:6px 0 0;color:' . $muted . ';font-size:12.5px;line-height:1.6;">' . $o['note'] . '</td></tr>'
        : '';

    $lead = !empty($o['lead'])
        ? '<tr><td style="padding:0 0 18px;color:#5f6570;font-size:15px;line-height:1.6;">' . $o['lead'] . '</td></tr>'
        : '';

    $body = !empty($o['body'])
        ? '<tr><td style="padding:0 0 22px;">' . $o['body'] . '</td></tr>'
        : '';

    return '<div style="margin:0;padding:0;background:#f4f5f7;">'
      . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;padding:28px 12px;">'
      . '<tr><td align="center">'
      . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
      . 'style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e6e8ec;border-radius:10px;overflow:hidden;'
      . 'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;">'

      // Masthead
      . '<tr><td style="background:' . $ink . ';padding:16px 32px;">'
      . '<span style="color:#ffffff;font-size:13px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;">'
      . escHtml($site) . '</span></td></tr>'

      // Content
      . '<tr><td style="padding:32px;">'
      . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
      . '<tr><td style="padding:0 0 10px;color:' . $ink . ';font-size:22px;font-weight:800;line-height:1.3;">'
      . escHtml($o['title']) . '</td></tr>'
      . $lead . $body . $cta . $note
      . '</table></td></tr>'

      // Footer
      . '<tr><td style="border-top:1px solid #eef0f3;padding:18px 32px;color:' . $muted . ';font-size:11.5px;line-height:1.6;">'
      . escHtml($site)
      . ($base ? ' · <a href="' . escHtml($base) . '" style="color:' . $muted . ';text-decoration:underline;">' . escHtml(preg_replace('#^https?://#', '', $base)) . '</a>' : '')
      . '</td></tr>'

      . '</table></td></tr></table></div>';
}

function sendEmail($to, $subject, $textBody, $htmlBody, $replyTo = null) {
    $config = getEmailConfig();

    if ($config['resendApiKey']) {
        // Use Resend API
        $payload = [
            'from' => $config['from'],
            'to' => [$to],
            'subject' => $subject,
            'text' => $textBody,
            'html' => $htmlBody,
        ];
        // Set on contact-form notifications so a reply reaches the visitor, not
        // the site's own From address. Must already be a validated address.
        if ($replyTo) $payload['reply_to'] = $replyTo;
        $ch = curl_init('https://api.resend.com/emails');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $config['resendApiKey'],
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        // No curl_close(): it has been a no-op since PHP 8.0 and is deprecated
        // in 8.5, where the notice gets printed into the JSON response body on
        // hosts that leave display_errors on.
        if ($httpCode >= 400) {
            $err = json_decode($response, true);
            throw new Exception($err['message'] ?? 'Resend API error');
        }
        return true;
    }

    // SMTP, when a host is configured (Resend above wins if both are set).
    if (!empty($config['host'])) {
        smtpSend($config, $to, $subject, $textBody, $htmlBody, $replyTo);
        return true;
    }

    // Fallback: PHP mail()
    $headers = "From: {$config['from']}\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    if ($replyTo) $headers .= "Reply-To: {$replyTo}\r\n";
    if (!mail($to, $subject, $htmlBody, $headers)) {
        throw new Exception('Failed to send email via mail()');
    }
    return true;
}

// Deliver one multipart (text + HTML) message over SMTP. Implicit TLS when
// "secure" is on (port 465), otherwise STARTTLS when the server offers it
// (port 587). Throws with the server's reply on any failure.
function smtpSend($config, $to, $subject, $textBody, $htmlBody, $replyTo = null) {
    // Header values come from settings and form input: never let a newline through.
    $clean = fn($v) => trim(preg_replace('/[\r\n]+/', ' ', (string)$v));
    $host = trim((string)$config['host']);
    $port = (int)($config['port'] ?? 587) ?: 587;
    $secure = !empty($config['secure']);
    $user = (string)($config['user'] ?? '');
    $from = $clean($config['from'] ?: $user);
    $to = $clean($to);
    $replyTo = $replyTo ? $clean($replyTo) : null;
    $addr = fn($v) => preg_match('/<([^>]+)>/', $v, $m) ? $m[1] : $v;
    $envelopeFrom = $addr($from);
    if ($envelopeFrom === '' || $to === '') throw new Exception('SMTP needs a From address and a recipient');

    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $conn = @stream_socket_client(($secure ? 'ssl' : 'tcp') . "://$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$conn) throw new Exception("Could not reach $host:$port" . ($errstr ? " ($errstr)" : ''));
    stream_set_timeout($conn, 20);

    $read = function () use ($conn) {
        $out = '';
        while (($line = fgets($conn, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') break;
        }
        return $out;
    };
    $expect = function ($reply, $codes, $step) use ($conn) {
        if (!in_array(substr($reply, 0, 3), (array)$codes, true)) {
            fclose($conn);
            throw new Exception("SMTP $step failed: " . trim($reply));
        }
    };
    $cmd = function ($line) use ($conn) { fwrite($conn, $line . "\r\n"); };

    $expect($read(), '220', 'greeting');
    $ehloHost = preg_replace('/[^A-Za-z0-9.\-]/', '', $_SERVER['SERVER_NAME'] ?? '') ?: 'localhost';
    $cmd("EHLO $ehloHost");
    $ehlo = $read();
    $expect($ehlo, '250', 'EHLO');
    if (!$secure && stripos($ehlo, 'STARTTLS') !== false) {
        $cmd('STARTTLS');
        $expect($read(), '220', 'STARTTLS');
        if (!@stream_socket_enable_crypto($conn, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($conn);
            throw new Exception("STARTTLS negotiation failed at $host:$port");
        }
        $cmd("EHLO $ehloHost");
        $expect($read(), '250', 'EHLO after STARTTLS');
    }
    if ($user !== '') {
        $cmd('AUTH LOGIN');
        $expect($read(), '334', 'AUTH');
        $cmd(base64_encode($user));
        $expect($read(), '334', 'AUTH');
        $cmd(base64_encode((string)($config['pass'] ?? '')));
        $expect($read(), '235', 'login (check the username and app password)');
    }
    $cmd("MAIL FROM:<$envelopeFrom>");
    $expect($read(), '250', 'MAIL FROM');
    $cmd('RCPT TO:<' . $addr($to) . '>');
    $expect($read(), ['250', '251'], 'RCPT TO');
    $cmd('DATA');
    $expect($read(), '354', 'DATA');

    $boundary = 'sd_' . bin2hex(random_bytes(12));
    $headers = [
        "From: $from",
        "To: $to",
        'Subject: ' . mb_encode_mimeheader($clean($subject), 'UTF-8', 'B', "\r\n"),
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $ehloHost . '>',
        'MIME-Version: 1.0',
        "Content-Type: multipart/alternative; boundary=\"$boundary\"",
    ];
    if ($replyTo) $headers[] = "Reply-To: $replyTo";
    $part = fn($type, $body) => "--$boundary\r\nContent-Type: $type; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($body), 76, "\r\n");
    $message = implode("\r\n", $headers) . "\r\n\r\n"
        . $part('text/plain', $textBody) . $part('text/html', $htmlBody) . "--$boundary--\r\n";
    // Base64 never produces a leading dot, so no dot-stuffing is needed.
    fwrite($conn, $message . ".\r\n");
    $expect($read(), '250', 'message delivery');
    $cmd('QUIT');
    fclose($conn);
}

// Probe an SMTP server: connect (TLS if configured), read the greeting, and try
// AUTH LOGIN when credentials are set. The Settings > Email "Test SMTP" runs
// this so "can we reach the mail server?" is answered separately from "did a
// message go out?" — two different failure modes worth telling apart.
function smtpProbe($config) {
    $host = trim((string)($config['host'] ?? ''));
    if ($host === '') return ['ok' => false, 'detail' => 'No SMTP host is set.'];
    $port = (int)($config['port'] ?? 587) ?: 587;
    $secure = !empty($config['secure']);
    $scheme = $secure ? 'ssl' : 'tcp';
    $ctx = stream_context_create(['ssl' => [
        'verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true,
    ]]);
    $errno = 0; $errstr = '';
    $conn = @stream_socket_client("$scheme://$host:$port", $errno, $errstr, 10, STREAM_CLIENT_CONNECT, $ctx);
    if (!$conn) {
        return ['ok' => false, 'detail' => "Could not reach $host:$port" . ($errstr ? " ($errstr)" : '') . '.'];
    }
    stream_set_timeout($conn, 10);
    $read = function () use ($conn) {
        $out = '';
        while (($line = fgets($conn, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') break;   // last line of a multi-line reply
        }
        return $out;
    };
    $greeting = $read();
    if ($greeting === '' || $greeting[0] !== '2') {
        fclose($conn);
        return ['ok' => false, 'detail' => "No SMTP greeting from $host:$port."];
    }
    $ehloHost = $_SERVER['SERVER_NAME'] ?? 'localhost';
    fwrite($conn, "EHLO $ehloHost\r\n");
    $ehlo = $read();
    if (!$secure && stripos($ehlo, 'STARTTLS') !== false) {
        fwrite($conn, "STARTTLS\r\n");
        $r = $read();
        if (strpos($r, '220') !== 0
            || !@stream_socket_enable_crypto($conn, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($conn);
            return ['ok' => false, 'detail' => "STARTTLS negotiation failed at $host:$port."];
        }
        fwrite($conn, "EHLO $ehloHost\r\n");
        $read();
    }
    $authOk = null;
    if (!empty($config['user'])) {
        fwrite($conn, "AUTH LOGIN\r\n");
        $read();
        fwrite($conn, base64_encode((string)$config['user']) . "\r\n");
        $read();
        fwrite($conn, base64_encode((string)($config['pass'] ?? '')) . "\r\n");
        $authOk = strpos($read(), '235') === 0;
    }
    fwrite($conn, "QUIT\r\n");
    fclose($conn);
    $detail = "Connected to $host:$port";
    if ($authOk === true) $detail .= ' and authenticated';
    elseif ($authOk === false) $detail .= ', but the username/password were rejected';
    return ['ok' => true, 'auth' => $authOk, 'detail' => $detail . '.'];
}

function sendReviewSummary($gallery, $videos, $comments, $reviewerName, $videoTitle = null, $videoId = null) {
    $config = getEmailConfig();
    if (!$config['adminEmail']) throw new Exception('Admin email address is required');

    // Group by video
    $byVideo = [];
    foreach ($comments as $c) {
        $byVideo[$c['videoId']][] = $c;
    }

    $subjectVideo = $videoTitle ?: $gallery['name'];
    $subject = emailSubject('Video comments', $subjectVideo);
    $count = count($comments);
    $countLabel = $count . ' comment' . ($count !== 1 ? 's' : '');

    $textParts = ["$reviewerName left $countLabel on \"{$gallery['name']}\":", ''];
    $htmlComments = '';

    foreach ($byVideo as $vid => $vidComments) {
        $video = null;
        foreach ($videos as $v) { if ($v['id'] === $vid) { $video = $v; break; } }
        $title = $video ? $video['title'] : 'Unknown';
        $isPhoto = $video && ($video['type'] ?? '') === 'photo';

        $textParts[] = "--- $title ---";
        $htmlComments .= '<div style="color:#1a1a1a;font-size:13px;font-weight:700;padding:16px 0 6px;">' . escHtml($title) . '</div>';

        usort($vidComments, fn($a, $b) => $a['timestamp'] <=> $b['timestamp']);
        foreach ($vidComments as $c) {
            if ($isPhoto || $c['timestamp'] == 0) {
                $textParts[] = "  {$c['text']}";
                $htmlComments .= '<div style="padding:9px 12px;background:#f7f8fa;border-radius:6px;margin-bottom:6px;color:#41464f;font-size:13.5px;line-height:1.55;">'
                    . escHtml($c['text']) . '</div>';
            } else {
                $time = formatTimestamp($c['timestamp']);
                $textParts[] = "  [$time] {$c['text']}";
                $htmlComments .= '<div style="padding:9px 12px;background:#f7f8fa;border-radius:6px;margin-bottom:6px;color:#41464f;font-size:13.5px;line-height:1.55;">'
                    . '<span style="display:inline-block;background:#0019ff;color:#ffffff;font-size:11.5px;font-weight:700;padding:2px 7px;border-radius:3px;margin-right:8px;">'
                    . $time . '</span>' . escHtml($c['text']) . '</div>';
            }
        }
        $textParts[] = '';
    }

    $adminLink = $config['baseUrl'] . '/admin#gallery/' . $gallery['id'] . '/comments';
    $videoLink = ($videoId && !empty($gallery['token']))
        ? $config['baseUrl'] . '/gallery/' . $gallery['token'] . '#video-' . $videoId
        : null;

    if ($videoLink) $textParts[] = "View video: $videoLink";
    $textParts[] = "View all comments: $adminLink";

    $html = emailShell([
        'title' => $countLabel . ' on ' . $subjectVideo,
        'lead'  => '<strong style="color:#1a1a1a;">' . escHtml($reviewerName) . '</strong> left ' . $countLabel
                 . ' on <strong style="color:#1a1a1a;">' . escHtml($gallery['name']) . '</strong>.',
        'body'  => $htmlComments,
        'cta'   => $videoLink
            ? ['label' => 'View in gallery', 'url' => $videoLink]
            : ['label' => 'View all comments', 'url' => $adminLink],
        'note'  => $videoLink
            ? '<a href="' . escHtml($adminLink) . '" style="color:#8a8f98;">View all comments in the admin</a>'
            : '',
    ]);

    sendEmail($config['adminEmail'], $subject, implode("\n", $textParts), $html);
}

// --- Migration (first run) ---

function migrateIfNeeded() {
    $galleriesPath = DATA_DIR . '/galleries.json';
    if (file_exists($galleriesPath)) return;

    // Nothing to create any more: the portfolio lives in folders (made during
    // bootstrap) and client galleries are made when someone makes one. This
    // used to seed a "Video Reels" gallery, which is now migrated away.
    writeGalleries([]);
}
migrateIfNeeded();

// ============================================================
// ROUTER
// ============================================================

// CLI: `php index.php portfolio:process` builds every missing portfolio
// thumbnail and proxy, for hosts where folders arrive by FTP and nobody opens
// the admin to drive processing. Suitable for cron. Shares the web route's
// lock, so the two never run GD at the same time.
if (PHP_SAPI === 'cli') {
    // `php index.php admin:reset-password [new-password]`: recovery for installs
    // that can't send email. Whoever can run it already controls the server.
    // Prints a generated password when none is given.
    if (($argv[1] ?? '') === 'admin:reset-password') {
        $creds = getAdminCredentials();
        if (!$creds) { fwrite(STDERR, "No admin account yet: open /admin in a browser to create one.\n"); exit(1); }
        $new = $argv[2] ?? substr(strtr(base64_encode(random_bytes(12)), '+/', 'xy'), 0, 16);
        if (strlen($new) < PASSWORD_MIN_LEN) { fwrite(STDERR, 'Password must be at least ' . PASSWORD_MIN_LEN . " characters.\n"); exit(1); }
        saveAdminPassword($creds['email'], $new);
        echo "Password for {$creds['email']} is now: $new\n";
        exit(0);
    }
    if (($argv[1] ?? '') !== 'portfolio:process') {
        fwrite(STDERR, "Usage: php index.php portfolio:process | admin:reset-password [new-password]\n");
        exit(1);
    }
    do {
        $r = portfolioProcess(null, PORTFOLIO_PROCESS_SLICE_SECONDS);
        if (!empty($r['busy'])) { fwrite(STDERR, "Another process run holds the lock.\n"); exit(1); }
        echo "processed {$r['processed']}, remaining {$r['remaining']}\n";
    } while ($r['processed'] > 0 && $r['remaining'] > 0);
    if ($r['needsPoster']) echo count($r['needsPoster']) . " video(s) need a poster: open the admin, or add <name>.poster.jpg beside them.\n";
    exit(0);
}

$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['REQUEST_URI'];
// Strip query string
$uri = strtok($uri, '?');
// Remove base path prefix if behind a subdirectory
$uri = preg_replace('#^.*?/api/#', '/api/', $uri);
// Normalize
$uri = '/' . trim($uri, '/');

// Route matching helper
function matchRoute($pattern, $uri, &$params) {
    $regex = preg_replace('/\{(\w+)\}/', '(?P<$1>[^/]+)', $pattern);
    $regex = '#^' . $regex . '$#';
    if (preg_match($regex, $uri, $m)) {
        $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
        return true;
    }
    return false;
}

$params = [];

// ============================================================
// AUTH ROUTES
// ============================================================

// Setup check — tells the admin UI if first-run setup is needed
if ($method === 'GET' && $uri === '/api/auth/check') {
    respond([
        'authenticated' => isAdminSession(),
        'setupRequired' => !isSetupComplete(),
    ]);
}

// First-run setup — create admin credentials
if ($method === 'POST' && $uri === '/api/auth/setup') {
    if (isSetupComplete()) respondError('Setup already completed', 400);

    $input = getInput();
    $email = trim($input['email'] ?? '');
    $password = $input['password'] ?? '';

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respondError('Please enter a valid email address', 400);
    }
    if (strlen($password) < 8) {
        respondError('Password must be at least 8 characters', 400);
    }

    $config = [
        'email' => $email,
        'passwordHash' => password_hash($password, PASSWORD_BCRYPT),
        'createdAt' => date('c'),
    ];
    jsonWrite(ADMIN_CONFIG_PATH, $config);

    // Initialize git repo on first setup if PAT is configured
    $gitPat = env('GIT_PAT');
    $gitUser = env('GIT_USERNAME', 'ajmastf8');
    $gitRepo = env('GIT_REPO', GITHUB_REPO_DEFAULT);
    $gitBranch = env('DEPLOY_BRANCH', 'main');
    $gitLog = [];
    if ($gitPat && !is_dir(__DIR__ . '/.git')) {
        $dir = __DIR__;
        $commands = [
            "cd $dir && git init 2>&1",
            "cd $dir && git remote add origin https://$gitUser:$gitPat@github.com/$gitRepo.git 2>&1",
            "cd $dir && git fetch origin $gitBranch 2>&1",
            "cd $dir && git checkout -f $gitBranch 2>&1",
        ];
        foreach ($commands as $cmd) {
            $gitLog[] = shell_exec($cmd);
        }
    }

    $_SESSION['authenticated'] = true;
    $_SESSION['authAt'] = time();
    respond(['ok' => true, 'gitInitialized' => !empty($gitLog)]);
}

if ($method === 'POST' && $uri === '/api/auth/login') {
    rateLimitCheck('login:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 5, 60);
    if (!isSetupComplete()) respondError('Setup required', 400);

    $input = getInput();
    $email = $input['username'] ?? $input['email'] ?? '';
    $password = $input['password'] ?? '';
    $creds = getAdminCredentials();

    $match = false;
    if (!empty($creds['passwordHash'])) {
        // admin.json credentials (bcrypt)
        $match = hash_equals($creds['email'], $email) && password_verify($password, $creds['passwordHash']);
    } elseif (!empty($creds['plainPassword'])) {
        // .env legacy credentials (plaintext)
        $match = hash_equals($creds['email'], $email) && hash_equals($creds['plainPassword'], $password);
    }

    if ($match) {
        $_SESSION['authenticated'] = true;
        $_SESSION['authAt'] = time();
        respond(['ok' => true]);
    } else {
        respondError('Invalid credentials', 401);
    }
}

// Change the password from inside the app. Needs the current one even with a
// valid session, so an unattended browser can't be used to lock the owner out.
if ($method === 'POST' && $uri === '/api/auth/change-password') {
    requireAuth();
    rateLimitCheck('chpw:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 5, 300);
    $input = getInput();
    $creds = getAdminCredentials();
    if (!$creds || !adminPasswordMatches($creds, (string)($input['currentPassword'] ?? ''))) {
        respondError('Current password is incorrect', 403);
    }
    $new = (string)($input['newPassword'] ?? '');
    if (strlen($new) < PASSWORD_MIN_LEN) respondError('New password must be at least ' . PASSWORD_MIN_LEN . ' characters', 400);
    saveAdminPassword($creds['email'], $new);
    // requireAuth released the session lock; reopen it to keep this browser signed in.
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    $_SESSION['authenticated'] = true;
    $_SESSION['authAt'] = time();
    respond(['ok' => true]);
}

// Forgot password: emails a one-hour link to the admin address. The answer is
// the same whether or not the address matched, so the form can't be used to
// probe for it. `emailConfigured` only says whether this install can send one
// at all, which lets the page point to the command-line reset when it can't.
if ($method === 'POST' && $uri === '/api/auth/forgot') {
    rateLimitCheck('forgot:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 5, 900);
    $input = getInput();
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $creds = getAdminCredentials();
    $base = passwordResetBaseUrl();
    $cfg = getEmailConfig();
    $canSend = $base && ($cfg['resendApiKey'] || $cfg['host'] || $cfg['from']);
    if ($canSend && $creds && $email !== '' && hash_equals(strtolower($creds['email']), $email)) {
        $token = bin2hex(random_bytes(32));
        jsonWrite(PASSWORD_RESET_PATH, [
            'hash' => hash('sha256', $token),
            'expires' => time() + PASSWORD_RESET_TTL,
        ]);
        $link = $base . '/admin?reset=' . $token;
        $site = siteName() ?: 'your site';
        try {
            sendEmail(
                $creds['email'],
                'Reset your admin password',
                "Someone asked to reset the admin password for $site.\n\nOpen this link within an hour to choose a new one:\n$link\n\nIf this wasn't you, ignore this email; your password is unchanged.",
                emailShell([
                    'title' => 'Reset your password',
                    'lead'  => 'Someone asked to reset the admin password for <strong style="color:#1a1a1a;">' . escHtml($site) . '</strong>.',
                    'cta'   => ['label' => 'Choose a new password', 'url' => $link],
                    'note'  => 'This link works for one hour. If this wasn\'t you, ignore this email; your password is unchanged.',
                ])
            );
        } catch (Exception $e) {
            @unlink(PASSWORD_RESET_PATH);
        }
    }
    respond(['ok' => true, 'emailConfigured' => (bool)$canSend]);
}

// Finish a reset with the emailed token. The token is single-use and only its
// hash is stored.
if ($method === 'POST' && $uri === '/api/auth/reset') {
    rateLimitCheck('reset:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 10, 900);
    $input = getInput();
    $token = (string)($input['token'] ?? '');
    $new = (string)($input['password'] ?? '');
    $stored = jsonRead(PASSWORD_RESET_PATH);
    if (!$stored || $token === '' || (int)($stored['expires'] ?? 0) < time()
        || !hash_equals((string)($stored['hash'] ?? ''), hash('sha256', $token))) {
        respondError('This reset link is invalid or has expired. Request a new one.', 400);
    }
    if (strlen($new) < PASSWORD_MIN_LEN) respondError('Password must be at least ' . PASSWORD_MIN_LEN . ' characters', 400);
    $creds = getAdminCredentials();
    if (!$creds) respondError('Setup required', 400);
    saveAdminPassword($creds['email'], $new);
    respond(['ok' => true]);
}

if ($method === 'POST' && $uri === '/api/auth/logout') {
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
    respond(['ok' => true]);
}

// ============================================================
// PUBLIC VIDEOS (REELS)
// ============================================================

if ($method === 'GET' && $uri === '/api/videos') {
    $reels = findReelsGallery();
    if (!$reels) respond([]);
    $items = array_values(array_filter(readGalleryVideos($reels['id']), function($v) {
        return ($v['type'] ?? '') === 'header' || ($v['visible'] ?? true) !== false;
    }));
    respond($items);
}

// ============================================================
// GALLERY CRUD (admin)
// ============================================================

if ($method === 'GET' && $uri === '/api/galleries') {
    requireAuth();
    backfillGalleryTokens();
    $collections = readCollections();
    // Build gallery-to-collection lookup
    $galColMap = [];
    foreach ($collections as $col) {
        foreach ($col['galleryIds'] ?? [] as $gid) {
            if (!isset($galColMap[$gid])) {
                $galColMap[$gid] = ['id' => $col['id'], 'name' => $col['name']];
            }
        }
    }
    $galleries = array_map(function($g) use ($galColMap) {
        $s = sanitizeGallery($g);
        $items = array_values(array_filter(readGalleryVideos($g['id']), fn($v) => ($v['type'] ?? '') !== 'header'));
        $s['videoCount'] = count($items);
        $s['thumbnail'] = $items[0]['thumbnail'] ?? null;
        $s['commentCount'] = $g['type'] === 'proofing' ? count(readGalleryComments($g['id'])) : 0;
        $s['collectionId'] = $galColMap[$g['id']]['id'] ?? null;
        $s['collectionName'] = $galColMap[$g['id']]['name'] ?? null;
        $views = readGalleryStats($g['id'])['views'] ?? [];
        $s['viewCount'] = $views['total'] ?? 0;
        $s['uniqueVisitors'] = $views['unique'] ?? 0;
        $s['lastViewedAt'] = $views['lastViewedAt'] ?? null;
        return $s;
    }, readGalleries());
    respond($galleries);
}

if ($method === 'POST' && $uri === '/api/galleries') {
    requireAuth();
    $input = getInput();
    $galleries = readGalleries();
    $id = generateId('g_');
    $type = $input['type'] ?? 'proofing';

    $hashedPassword = null;
    if (!empty($input['password'])) {
        $hashedPassword = password_hash($input['password'], PASSWORD_BCRYPT);
    }

    $gallery = [
        'id' => $id,
        'name' => $input['name'] ?? 'New Gallery',
        'type' => $type,
        // Reels galleries get a token too: portfolio collections link to their
        // member galleries by token, same as client collections do.
        'token' => generateToken(),
        'password' => $hashedPassword,
        'downloadsEnabled' => !empty($input['downloadsEnabled']),
        'commentingEnabled' => !empty($input['commentingEnabled']),
        'expiresAt' => $input['expiresAt'] ?? null,
        'active' => true,
        'overrideCollectionSettings' => !empty($input['overrideCollectionSettings']),
        'createdAt' => date('c'),
    ];

    $dir = ensureGalleryDir($id);
    jsonWrite("$dir/videos.json", []);
    jsonWrite("$dir/comments.json", []);
    $galleries[] = $gallery;
    writeGalleries($galleries);
    respond(sanitizeGallery($gallery));
}

if ($method === 'PUT' && matchRoute('/api/galleries/{id}', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $galleries = readGalleries();
    $gallery = null;
    $idx = null;
    foreach ($galleries as $i => &$g) {
        if ($g['id'] === $params['id']) { $gallery = &$g; $idx = $i; break; }
    }
    unset($g);
    if (!$gallery) respondError('Not found', 404);

    if (isset($input['name'])) $gallery['name'] = $input['name'];
    if (array_key_exists('password', $input)) {
        $gallery['password'] = $input['password'] ? password_hash($input['password'], PASSWORD_BCRYPT) : null;
    }
    if (isset($input['downloadsEnabled'])) $gallery['downloadsEnabled'] = $input['downloadsEnabled'];
    if (isset($input['commentingEnabled'])) $gallery['commentingEnabled'] = $input['commentingEnabled'];
    if (isset($input['expiresAt'])) $gallery['expiresAt'] = $input['expiresAt'];
    if (isset($input['active'])) $gallery['active'] = $input['active'];
    if (isset($input['favorite'])) $gallery['favorite'] = $input['favorite'];
    if (!empty($input['regenerateToken'])) {
        $gallery['token'] = generateToken();
    } elseif (array_key_exists('token', $input)) {
        // Setting the token by hand is how a link that was regenerated by
        // accident gets restored to the one already sent to a client.
        $wanted = normalizeShareToken($input['token']);
        if ($wanted === null) respondError(SHARE_TOKEN_RULES, 400);
        foreach ($galleries as $other) {
            if ($other['id'] !== $gallery['id'] && ($other['token'] ?? '') === $wanted) {
                respondError('Another gallery is already using that link.', 409);
            }
        }
        $gallery['token'] = $wanted;
    }

    // Handle override toggle: when switching to override, copy collection settings as starting values
    if (isset($input['overrideCollectionSettings'])) {
        $wasOverriding = $gallery['overrideCollectionSettings'] ?? false;
        $gallery['overrideCollectionSettings'] = $input['overrideCollectionSettings'];
        if ($input['overrideCollectionSettings'] && !$wasOverriding) {
            // Switching to override — copy collection settings into gallery
            foreach (readCollections() as $col) {
                if (in_array($gallery['id'], $col['galleryIds'] ?? [])) {
                    $gallery['password'] = $col['password'] ?? null;
                    $gallery['downloadsEnabled'] = $col['downloadsEnabled'] ?? false;
                    $gallery['commentingEnabled'] = $col['commentingEnabled'] ?? false;
                    $gallery['expiresAt'] = $col['expiresAt'] ?? null;
                    $gallery['active'] = $col['active'] ?? true;
                    break;
                }
            }
        }
    }

    writeGalleries($galleries);
    respond(sanitizeGallery($gallery));
}

if ($method === 'DELETE' && matchRoute('/api/galleries/{id}', $uri, $params)) {
    requireAuth();
    $galleries = readGalleries();
    $idx = null;
    $gallery = null;
    foreach ($galleries as $i => $g) {
        if ($g['id'] === $params['id']) { $gallery = $g; $idx = $i; break; }
    }
    if ($idx === null) respondError('Not found', 404);

    $dir = galleryDir($gallery['id']);
    if (is_dir($dir)) {
        $it = new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS);
        foreach (new RecursiveIteratorIterator($it, RecursiveIteratorIterator::CHILD_FIRST) as $f) {
            $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
        }
        rmdir($dir);
    }

    array_splice($galleries, $idx, 1);
    writeGalleries($galleries);

    // Remove from collections
    $collections = readCollections();
    $changed = false;
    foreach ($collections as &$col) {
        $colIdx = array_search($gallery['id'], $col['galleryIds']);
        if ($colIdx !== false) {
            array_splice($col['galleryIds'], $colIdx, 1);
            $changed = true;
        }
    }
    unset($col);
    if ($changed) writeCollections($collections);

    respond(['ok' => true]);
}

// ============================================================
// ADMIN: VIDEO/PHOTO MANAGEMENT
// ============================================================

if ($method === 'GET' && matchRoute('/api/admin/galleries/{gid}/videos', $uri, $params)) {
    requireAuth();
    respond([
        'videos' => readGalleryVideos($params['gid']),
        'stats' => publicStats(readGalleryStats($params['gid'])),
    ]);
}

if ($method === 'POST' && matchRoute('/api/admin/galleries/{gid}/stats/reset', $uri, $params)) {
    requireAuth();
    $statsFile = galleryStatsPath($params['gid']);
    if (file_exists($statsFile)) unlink($statsFile);
    respond(['ok' => true]);
}

// Shared item-creation helper. Given a file already saved under UPLOADS_DIR
// and its stored filename, probe metadata, generate thumbnail/proxy for
// photos, append to the gallery's videos.json, and return the created item.
// Used by both the multipart upload endpoint and the chunked-upload finalize.
function registerGalleryItem(string $gid, string $destName, string $title): array {
    $destPath = UPLOADS_DIR . '/' . $destName;
    $isPhoto = isImageFile($destName);
    // Hash now, while we're already touching this file, so a delivery never has
    // to pay for it later. See the CRC cache notes above CRC_CACHE_PATH.
    fileCrc32($destPath);
    $item = [
        'id' => generateId($isPhoto ? 'p_' : 'v_'),
        'type' => $isPhoto ? 'photo' : 'video',
        'title' => $title !== '' ? $title : 'Untitled',
        'filename' => $destName,
        'visible' => true,
        'createdAt' => date('c'),
    ];
    if ($isPhoto) {
        $meta = probeImage($destPath);
        if ($meta) { $item['width'] = $meta['width']; $item['height'] = $meta['height']; }
        $thumbFilename = $item['id'] . '.jpg';
        $proxyFilename = $item['id'] . '_proxy.jpg';
        if (generatePhotoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename)) $item['thumbnail'] = $thumbFilename;
        if (generatePhotoProxy($destPath, PROXY_DIR . '/' . $proxyFilename)) $item['proxy'] = $proxyFilename;
    } else {
        $meta = probeVideo($destPath);
        if ($meta) {
            $item['width'] = $meta['width'];
            $item['height'] = $meta['height'];
        }
        // Store duration even without ffmpeg (pure-PHP MP4 fallback), so the
        // caption auto-shift has a timeline to check against later.
        $duration = (float)($meta['duration'] ?? 0);
        if ($duration <= 0) $duration = mp4DurationSeconds($destPath);
        if ($duration > 0) $item['duration'] = $duration;
        // Pull any captions baked into the MP4 out into WebVTT sidecars so they
        // actually display (the browser player ignores in-container subtitles).
        $caps = extractEmbeddedCaptions($destPath, $item['id'], $duration);
        if ($caps) $item['captions'] = $caps;
    }
    // Atomic append: concurrent uploads to the same gallery must not clobber
    // each other's additions to videos.json.
    ensureGalleryDir($gid);
    jsonUpdate(galleryDir($gid) . '/videos.json', function ($videos) use ($item) {
        $videos[] = $item;
        return $videos;
    });
    return $item;
}

// Upload (multipart, single-request; used by the web admin for files that
// fit under post_max_size). The shared registerGalleryItem() helper does
// the heavy lifting so the chunked-upload path below stays consistent.
if ($method === 'POST' && matchRoute('/api/admin/galleries/{gid}/videos', $uri, $params)) {
    requireAuth();
    if (empty($_FILES['video'])) respondError('No file uploaded', 400);

    $file = $_FILES['video'];
    if ($file['error'] !== UPLOAD_ERR_OK) respondError('Upload error: ' . $file['error'], 400);

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, MEDIA_EXTS)) respondError('Unsupported file type', 400);

    $safeName = safeFilename($file['name']);
    $destName = time() . '-' . $safeName;
    $destPath = UPLOADS_DIR . '/' . $destName;
    move_uploaded_file($file['tmp_name'], $destPath);

    $item = registerGalleryItem($params['gid'], $destName, $_POST['title'] ?? 'Untitled');
    respond($item);
}

// ============================================================
// CHUNKED / RESUMABLE UPLOAD
// ============================================================
//
// Lets a CLI client push multi-GB files past the 500 MB post_max_size by
// streaming them in contiguous chunks. Flow:
//
//   POST /api/admin/uploads        -> { uploadId, chunkMaxBytes }
//   PUT  /api/admin/uploads/{id}/chunk   (Content-Range: bytes X-Y/TOTAL)
//   POST /api/admin/uploads/{id}/finalize  { galleryId, title } -> item
//   DELETE /api/admin/uploads/{id} (cancel)
//
// Temp files live under site-data/uploads/.tmp/{id}.part alongside a tiny
// {id}.json metadata record. Sessions older than 24 h are swept on the next
// initiate so interrupted uploads don't pile up on disk.

define('UPLOAD_TMP_DIR', UPLOADS_DIR . '/.tmp');
define('UPLOAD_TTL_SECONDS', 24 * 60 * 60);
define('UPLOAD_CHUNK_MAX_BYTES', 50 * 1024 * 1024);
if (!is_dir(UPLOAD_TMP_DIR)) @mkdir(UPLOAD_TMP_DIR, 0755, true);

function cleanupStaleUploads(): void {
    $cutoff = time() - UPLOAD_TTL_SECONDS;
    foreach (glob(UPLOAD_TMP_DIR . '/*.json') ?: [] as $metaFile) {
        if (@filemtime($metaFile) < $cutoff) {
            $base = substr($metaFile, 0, -5);
            @unlink($base . '.part');
            @unlink($metaFile);
        }
    }
}

function readUploadMeta(string $uploadId): ?array {
    if (!preg_match('/^[a-f0-9]{16,64}$/', $uploadId)) return null;
    $path = UPLOAD_TMP_DIR . '/' . $uploadId . '.json';
    if (!file_exists($path)) return null;
    $data = json_decode(@file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

function writeUploadMeta(string $uploadId, array $meta): void {
    @file_put_contents(UPLOAD_TMP_DIR . '/' . $uploadId . '.json', json_encode($meta));
}

// Initiate: server validates metadata, creates an empty .part file, returns
// an upload id. Client keeps this id for subsequent chunks + finalize.
if ($method === 'POST' && $uri === '/api/admin/uploads') {
    requireAuth();
    cleanupStaleUploads();
    $input = getInput();
    $filename = trim((string)($input['filename'] ?? ''));
    $totalSize = (int)($input['totalSize'] ?? 0);
    $contentType = (string)($input['contentType'] ?? '');

    if ($filename === '') respondError('filename is required', 400);
    if ($totalSize <= 0) respondError('totalSize must be a positive integer', 400);

    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    // A PhotoShelter migration sidecar isn't media, but it's a real upload
    // target — see portfolioAcceptUpload(), which is what actually handles
    // it once chunking finishes.
    if (!in_array($ext, MEDIA_EXTS) && strtolower($filename) !== PORTFOLIO_PHOTOSHELTER_SIDECAR) {
        respondError('Unsupported file type', 400);
    }

    $uploadId = bin2hex(random_bytes(16));
    $partPath = UPLOAD_TMP_DIR . '/' . $uploadId . '.part';
    $fh = fopen($partPath, 'wb');
    if (!$fh) respondError('Could not create upload session', 500);
    fclose($fh);

    writeUploadMeta($uploadId, [
        'filename'    => $filename,
        'totalSize'   => $totalSize,
        'contentType' => $contentType,
        'received'    => 0,
        'createdAt'   => date('c'),
    ]);

    respond([
        'uploadId'      => $uploadId,
        'chunkMaxBytes' => UPLOAD_CHUNK_MAX_BYTES,
        'totalSize'     => $totalSize,
    ]);
}

// Append one chunk. `Content-Range: bytes X-Y/TOTAL` — X must equal what
// we've received so far (contiguous); Y-X+1 must equal the body length.
if ($method === 'PUT' && matchRoute('/api/admin/uploads/{uploadId}/chunk', $uri, $params)) {
    requireAuth();
    $meta = readUploadMeta($params['uploadId']);
    if (!$meta) respondError('Upload session not found', 404);

    $range = $_SERVER['HTTP_CONTENT_RANGE'] ?? '';
    if (!preg_match('#^bytes\s+(\d+)-(\d+)/(\d+)$#', $range, $m)) {
        respondError('Content-Range header required (e.g. "bytes 0-1048575/5242880")', 400);
    }
    $start = (int)$m[1];
    $end   = (int)$m[2];
    $total = (int)$m[3];

    if ($total !== (int)$meta['totalSize']) respondError('Content-Range total does not match session totalSize', 400);
    if ($start !== (int)$meta['received']) respondError('Chunk out of order; expected start=' . $meta['received'], 409);
    if ($end < $start || $end >= $total) respondError('Invalid Content-Range', 400);

    $expectedLen = $end - $start + 1;
    if ($expectedLen > UPLOAD_CHUNK_MAX_BYTES) {
        respondError('Chunk exceeds chunkMaxBytes', 413);
    }

    $body = file_get_contents('php://input');
    if ($body === false) respondError('Could not read request body', 500);
    if (strlen($body) !== $expectedLen) {
        respondError('Chunk length ' . strlen($body) . ' does not match Content-Range ' . $expectedLen, 400);
    }

    $partPath = UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.part';
    $fh = fopen($partPath, 'ab');
    if (!$fh) respondError('Could not open upload file', 500);
    $written = fwrite($fh, $body);
    fclose($fh);
    if ($written !== $expectedLen) respondError('Short write appending chunk', 500);

    $meta['received'] = $end + 1;
    writeUploadMeta($params['uploadId'], $meta);

    respond([
        'received'  => $meta['received'],
        'totalSize' => (int)$meta['totalSize'],
        'complete'  => $meta['received'] >= (int)$meta['totalSize'],
    ]);
}

// Finalize: move the assembled .part file into uploads/ and attach it to a
// gallery using the shared registerGalleryItem() helper.
if ($method === 'POST' && matchRoute('/api/admin/uploads/{uploadId}/finalize', $uri, $params)) {
    requireAuth();
    $meta = readUploadMeta($params['uploadId']);
    if (!$meta) respondError('Upload session not found', 404);
    if ((int)$meta['received'] !== (int)$meta['totalSize']) {
        respondError('Upload incomplete: received ' . $meta['received'] . ' of ' . $meta['totalSize'] . ' bytes', 400);
    }

    $input = getInput();
    $gid = trim((string)($input['galleryId'] ?? ''));
    $pgid = trim((string)($input['portfolioGalleryId'] ?? ''));
    $title = trim((string)($input['title'] ?? 'Untitled'));
    if ($gid === '' && $pgid === '') respondError('galleryId is required', 400);

    // Portfolio galleries are folders on disk: the file keeps its own name and
    // is registered by scanning, not by an entry in a gallery's videos.json.
    if ($pgid !== '') {
        [, $pgal] = portfolioRequireGallery($pgid);
        $partPath = UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.part';
        if (!file_exists($partPath)) respondError('Upload payload missing on disk', 500);
        $result = portfolioAcceptUpload($pgal, $partPath, $meta['filename']);
        @unlink(UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.json');
        respond(['ok' => true, 'file' => $result['file'], 'photoshelter' => $result['photoshelter'], 'gallery' => portfolioGalleryResponse($pgid)]);
    }

    $galleries = readGalleries();
    $gallery = null;
    foreach ($galleries as $g) { if ($g['id'] === $gid) { $gallery = $g; break; } }
    if (!$gallery) respondError('Gallery not found', 404);

    $partPath = UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.part';
    if (!file_exists($partPath)) respondError('Upload payload missing on disk', 500);

    $safeName = safeFilename($meta['filename']);
    $destName = time() . '-' . $safeName;
    $destPath = UPLOADS_DIR . '/' . $destName;
    if (!rename($partPath, $destPath)) respondError('Could not move assembled file into uploads/', 500);
    @unlink(UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.json');

    $item = registerGalleryItem($gid, $destName, $title);
    respond($item);
}

// Cancel an in-progress upload.
if ($method === 'DELETE' && matchRoute('/api/admin/uploads/{uploadId}', $uri, $params)) {
    requireAuth();
    if (!preg_match('/^[a-f0-9]{16,64}$/', $params['uploadId'])) respondError('Invalid upload id', 400);
    @unlink(UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.part');
    @unlink(UPLOAD_TMP_DIR . '/' . $params['uploadId'] . '.json');
    respond(['ok' => true]);
}

// Update title/visibility
if ($method === 'PUT' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $videos = readGalleryVideos($params['gid']);
    $video = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['vid']) { $video = &$v; break; }
    }
    unset($v);
    if (!$video) respondError('Not found', 404);

    if (isset($input['title'])) $video['title'] = $input['title'];
    if (isset($input['visible'])) $video['visible'] = $input['visible'];
    // Portfolio caption box. Stored trimmed, and dropped entirely when blank so
    // the public payload carries no empty key for the player to test.
    if (array_key_exists('description', $input)) {
        $desc = trim((string)($input['description'] ?? ''));
        if ($desc === '') unset($video['description']);
        else $video['description'] = mb_substr($desc, 0, DESCRIPTION_MAX_LEN);
    }

    writeGalleryVideos($params['gid'], $videos);
    respond($video);
}

// Add / replace a caption track (video only). Multipart: `caption` file plus
// `lang` (BCP-47-ish, e.g. en / pt-br) and an optional display `label`.
// Uploading a second file for an existing lang replaces it.
if ($method === 'POST' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}/captions', $uri, $params)) {
    requireAuth();
    if (empty($_FILES['caption'])) respondError('No file uploaded', 400);

    $file = $_FILES['caption'];
    if ($file['error'] !== UPLOAD_ERR_OK) respondError('Upload error: ' . $file['error'], 400);

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if ($ext !== CAPTION_EXT) respondError('Captions must be a .vtt (WebVTT) file', 400);
    if ($file['size'] > 2 * 1024 * 1024) respondError('Caption file too large (>2MB)', 400);

    $lang = strtolower(trim($_POST['lang'] ?? ''));
    if (!preg_match('/^[a-z]{2,3}(-[a-z]{2,4})?$/', $lang)) {
        respondError('Invalid language code (use e.g. "en" or "pt-br")', 400);
    }
    $label = trim($_POST['label'] ?? '');
    if ($label === '') $label = strtoupper($lang);
    if (mb_strlen($label) > 60) $label = mb_substr($label, 0, 60);

    // Boundary validation: this file is served to browsers and parsed as
    // captions, so confirm it actually starts with the WEBVTT signature
    // (after an optional UTF-8 BOM) rather than trusting the extension.
    $head = (string)file_get_contents($file['tmp_name'], false, null, 0, 16);
    if (strncmp(ltrim($head, "\xEF\xBB\xBF"), 'WEBVTT', 6) !== 0) {
        respondError('File does not look like a valid WebVTT (.vtt) caption file', 400);
    }

    $videos = readGalleryVideos($params['gid']);
    $video = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['vid']) { $video = &$v; break; }
    }
    unset($v);
    if (!$video) respondError('Not found', 404);
    if (($video['type'] ?? '') === 'photo') respondError('Captions can only be added to videos', 400);

    // Drop any existing track for this language (file + record) before adding.
    $captions = $video['captions'] ?? [];
    foreach ($captions as $c) {
        if (($c['lang'] ?? '') === $lang && !empty($c['filename'])) {
            $old = CAPTIONS_DIR . '/' . $c['filename'];
            if (file_exists($old)) unlink($old);
        }
    }
    $captions = array_values(array_filter($captions, fn($c) => ($c['lang'] ?? '') !== $lang));

    // If the file's cues all sit past the end of the video (an editor timecode
    // base, e.g. captions starting at 01:00:00 on an 8-minute clip), shift them
    // back into the timeline so they actually display. No-op for normal files.
    $duration = resolveVideoDuration(UPLOADS_DIR . '/' . ($video['filename'] ?? ''), $video['duration'] ?? 0);
    if (!is_uploaded_file($file['tmp_name'])) respondError('Invalid upload', 400);
    $content = (string)file_get_contents($file['tmp_name']);
    [$content, $shiftedHours] = vttAutoShift($content, $duration);

    $destName = $video['id'] . '-' . $lang . '-' . time() . '.vtt';
    file_put_contents(CAPTIONS_DIR . '/' . $destName, $content);

    $captions[] = ['lang' => $lang, 'label' => $label, 'filename' => $destName];
    $video['captions'] = $captions;
    writeGalleryVideos($params['gid'], $videos);
    // Surface the shift so the admin UI can note it (transient; not persisted).
    respond($shiftedHours ? array_merge($video, ['captionShiftedHours' => $shiftedHours]) : $video);
}

// Remove a caption track by language code.
if ($method === 'DELETE' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}/captions/{lang}', $uri, $params)) {
    requireAuth();
    $videos = readGalleryVideos($params['gid']);
    $video = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['vid']) { $video = &$v; break; }
    }
    unset($v);
    if (!$video) respondError('Not found', 404);

    $lang = strtolower($params['lang']);
    $captions = $video['captions'] ?? [];
    foreach ($captions as $c) {
        if (($c['lang'] ?? '') === $lang && !empty($c['filename'])) {
            $p = CAPTIONS_DIR . '/' . $c['filename'];
            if (file_exists($p)) unlink($p);
        }
    }
    $video['captions'] = array_values(array_filter($captions, fn($c) => ($c['lang'] ?? '') !== $lang));
    writeGalleryVideos($params['gid'], $videos);
    respond($video);
}

// Generate thumbnail (video only)
if ($method === 'PUT' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}/thumbnail', $uri, $params)) {
    requireAuth();
    $videos = readGalleryVideos($params['gid']);
    $video = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['vid']) { $video = &$v; break; }
    }
    unset($v);
    if (!$video) respondError('Not found', 404);
    if (($video['type'] ?? '') === 'photo') respondError('Photo thumbnails are generated automatically', 400);

    // Client sends a raw JPEG (captured in the browser from a <canvas>) in
    // the request body. No ffmpeg needed — photographer's shared host often
    // doesn't have it. Expect image/jpeg or image/png.
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (strpos($contentType, 'image/') !== 0) {
        respondError('Expected an image in the request body (Content-Type: image/jpeg)', 400);
    }
    $body = file_get_contents('php://input');
    if (!$body) respondError('No image data received', 400);
    if (strlen($body) > 10 * 1024 * 1024) respondError('Thumbnail image too large (>10MB)', 400);

    $thumbFilename = $video['id'] . '.jpg';
    $thumbPath = THUMBS_DIR . '/' . $thumbFilename;
    if (file_put_contents($thumbPath, $body) === false) {
        respondError('Could not write thumbnail to disk', 500);
    }

    // Sanity check: did we actually get an image?
    if (@getimagesize($thumbPath) === false) {
        @unlink($thumbPath);
        respondError('Uploaded data is not a valid image', 400);
    }

    $video['thumbnail'] = $thumbFilename;
    writeGalleryVideos($params['gid'], $videos);
    respond($video);
}

// Replace file
if ($method === 'PUT' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}/replace', $uri, $params)) {
    requireAuth();
    if (empty($_FILES['video'])) respondError('No file', 400);

    $file = $_FILES['video'];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, MEDIA_EXTS)) respondError('Unsupported file type', 400);

    $videos = readGalleryVideos($params['gid']);
    $video = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['vid']) { $video = &$v; break; }
    }
    unset($v);
    if (!$video) respondError('Not found', 404);

    // Delete old file
    $oldPath = UPLOADS_DIR . '/' . $video['filename'];
    if (file_exists($oldPath)) unlink($oldPath);
    if (!empty($video['thumbnail'])) {
        $oldThumb = THUMBS_DIR . '/' . $video['thumbnail'];
        if (file_exists($oldThumb)) unlink($oldThumb);
    }
    if (!empty($video['proxy'])) {
        $oldProxy = PROXY_DIR . '/' . $video['proxy'];
        if (file_exists($oldProxy)) unlink($oldProxy);
    }
    // Captions describe the old clip — drop them so they don't carry over to a
    // different replacement file.
    foreach (($video['captions'] ?? []) as $c) {
        if (!empty($c['filename'])) {
            $oldCap = CAPTIONS_DIR . '/' . $c['filename'];
            if (file_exists($oldCap)) unlink($oldCap);
        }
    }

    $safeName = safeFilename($file['name']);
    $destName = time() . '-' . $safeName;
    $destPath = UPLOADS_DIR . '/' . $destName;
    move_uploaded_file($file['tmp_name'], $destPath);

    $isPhoto = isImageFile($destName);
    $video['filename'] = $destName;
    $video['type'] = $isPhoto ? 'photo' : 'video';
    $video['replacedAt'] = date('c');
    $video['thumbnail'] = null;
    $video['proxy'] = null;
    unset($video['duration'], $video['width'], $video['height'], $video['captions']);

    if ($isPhoto) {
        $meta = probeImage($destPath);
        if ($meta) { $video['width'] = $meta['width']; $video['height'] = $meta['height']; }
        $thumbFilename = $video['id'] . '.jpg';
        $proxyFilename = $video['id'] . '_proxy.jpg';
        generatePhotoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename);
        generatePhotoProxy($destPath, PROXY_DIR . '/' . $proxyFilename);
        $video['thumbnail'] = $thumbFilename;
        $video['proxy'] = $proxyFilename;
    } else {
        $meta = probeVideo($destPath);
        if ($meta) {
            $video['width'] = $meta['width'];
            $video['height'] = $meta['height'];
        }
        $duration = (float)($meta['duration'] ?? 0);
        if ($duration <= 0) $duration = mp4DurationSeconds($destPath);
        if ($duration > 0) $video['duration'] = $duration;
        $caps = extractEmbeddedCaptions($destPath, $video['id'], $duration);
        if ($caps) $video['captions'] = $caps;
    }

    writeGalleryVideos($params['gid'], $videos);
    respond($video);
}

// Delete video/photo
if ($method === 'DELETE' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}', $uri, $params)) {
    requireAuth();
    $videos = readGalleryVideos($params['gid']);
    $idx = null;
    $removed = null;
    foreach ($videos as $i => $v) {
        if ($v['id'] === $params['vid']) { $idx = $i; $removed = $v; break; }
    }
    if ($idx === null) respondError('Not found', 404);

    $filePath = UPLOADS_DIR . '/' . $removed['filename'];
    if (file_exists($filePath)) unlink($filePath);
    if (!empty($removed['thumbnail'])) {
        $thumbPath = THUMBS_DIR . '/' . $removed['thumbnail'];
        if (file_exists($thumbPath)) unlink($thumbPath);
    }
    if (!empty($removed['proxy'])) {
        $proxyPath = PROXY_DIR . '/' . $removed['proxy'];
        if (file_exists($proxyPath)) unlink($proxyPath);
    }
    foreach (($removed['captions'] ?? []) as $c) {
        if (!empty($c['filename'])) {
            $capPath = CAPTIONS_DIR . '/' . $c['filename'];
            if (file_exists($capPath)) unlink($capPath);
        }
    }

    array_splice($videos, $idx, 1);
    writeGalleryVideos($params['gid'], $videos);
    respond(['ok' => true]);
}

// Headers
if ($method === 'POST' && matchRoute('/api/admin/galleries/{gid}/headers', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $videos = readGalleryVideos($params['gid']);
    $header = [
        'id' => generateId('h_'),
        'type' => 'header',
        'text' => $input['text'] ?? 'Section',
        'createdAt' => date('c'),
    ];
    $videos[] = $header;
    writeGalleryVideos($params['gid'], $videos);
    respond($header);
}

if ($method === 'PUT' && matchRoute('/api/admin/galleries/{gid}/headers/{hid}', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $videos = readGalleryVideos($params['gid']);
    $header = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['hid'] && ($v['type'] ?? '') === 'header') { $header = &$v; break; }
    }
    unset($v);
    if (!$header) respondError('Not found', 404);
    if (isset($input['text'])) $header['text'] = $input['text'];
    writeGalleryVideos($params['gid'], $videos);
    respond($header);
}

if ($method === 'DELETE' && matchRoute('/api/admin/galleries/{gid}/headers/{hid}', $uri, $params)) {
    requireAuth();
    $videos = readGalleryVideos($params['gid']);
    $idx = null;
    foreach ($videos as $i => $v) {
        if ($v['id'] === $params['hid'] && ($v['type'] ?? '') === 'header') { $idx = $i; break; }
    }
    if ($idx === null) respondError('Not found', 404);
    array_splice($videos, $idx, 1);
    writeGalleryVideos($params['gid'], $videos);
    respond(['ok' => true]);
}

// Reorder
if ($method === 'PUT' && matchRoute('/api/admin/galleries/{gid}/reorder', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $order = $input['order'] ?? [];
    $videos = readGalleryVideos($params['gid']);
    $map = [];
    foreach ($videos as $v) $map[$v['id']] = $v;

    $reordered = [];
    foreach ($order as $id) {
        if (isset($map[$id])) $reordered[] = $map[$id];
    }
    // Append any items not in the order list
    foreach ($videos as $v) {
        if (!in_array($v['id'], $order)) $reordered[] = $v;
    }

    writeGalleryVideos($params['gid'], $reordered);
    respond(['ok' => true]);
}

// Admin comments view
if ($method === 'GET' && matchRoute('/api/admin/galleries/{gid}/comments', $uri, $params)) {
    requireAuth();
    $comments = readGalleryComments($params['gid']);
    $videos = readGalleryVideos($params['gid']);
    $videoMap = [];
    foreach ($videos as $v) $videoMap[$v['id']] = $v['title'] ?? 'Unknown';

    $enriched = array_map(function($c) use ($videoMap) {
        $c['videoTitle'] = $videoMap[$c['videoId']] ?? 'Unknown';
        return $c;
    }, $comments);
    respond($enriched);
}

// Import: list files
if ($method === 'GET' && $uri === '/api/admin/import/files') {
    requireAuth();
    $files = [];
    foreach (scandir(IMPORT_DIR) as $f) {
        if ($f === '.' || $f === '..') continue;
        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, MEDIA_EXTS)) continue;
        $stat = stat(IMPORT_DIR . '/' . $f);
        $files[] = ['name' => $f, 'size' => $stat['size'], 'modified' => date('c', $stat['mtime'])];
    }
    usort($files, fn($a, $b) => strcmp($a['name'], $b['name']));
    respond(['path' => IMPORT_DIR, 'files' => $files]);
}

// Import: import files
if ($method === 'POST' && matchRoute('/api/admin/galleries/{gid}/import', $uri, $params)) {
    requireAuth();
    // Resizing many large photos is slow; don't let the request time out partway.
    @set_time_limit(0);
    $input = getInput();
    $filenames = $input['filenames'] ?? [];
    if (!$filenames) respondError('No files selected', 400);

    $videos = readGalleryVideos($params['gid']);
    $imported = [];
    $errors = [];

    foreach ($filenames as $originalName) {
        $safeName = basename($originalName);
        $srcPath = IMPORT_DIR . '/' . $safeName;
        if (!file_exists($srcPath)) { $errors[] = ['name' => $safeName, 'error' => 'File not found']; continue; }

        $ext = strtolower(pathinfo($safeName, PATHINFO_EXTENSION));
        if (!in_array($ext, MEDIA_EXTS)) { $errors[] = ['name' => $safeName, 'error' => 'Not a supported media format']; continue; }

        $destName = time() . '-' . safeFilename($safeName);
        $destPath = UPLOADS_DIR . '/' . $destName;
        rename($srcPath, $destPath);

        $title = preg_replace('/\.[^.]+$/', '', $safeName);
        $title = str_replace(['_', '-'], ' ', $title);
        $title = trim(preg_replace('/\s+/', ' ', $title)) ?: 'Untitled';

        $isPhoto = isImageFile($destName);
        $itemId = generateId($isPhoto ? 'p_' : 'v_');
        $item = [
            'id' => $itemId,
            'type' => $isPhoto ? 'photo' : 'video',
            'title' => $title,
            'filename' => $destName,
            'visible' => true,
            'createdAt' => date('c'),
        ];

        if ($isPhoto) {
            $meta = probeImage($destPath);
            if ($meta) { $item['width'] = $meta['width']; $item['height'] = $meta['height']; }
            $thumbFilename = $itemId . '.jpg';
            $proxyFilename = $itemId . '_proxy.jpg';
            if (generatePhotoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename)) $item['thumbnail'] = $thumbFilename;
            if (generatePhotoProxy($destPath, PROXY_DIR . '/' . $proxyFilename)) $item['proxy'] = $proxyFilename;
        } else {
            $meta = probeVideo($destPath);
            if ($meta) {
                $item['width'] = $meta['width'];
                $item['height'] = $meta['height'];
            }
            $duration = (float)($meta['duration'] ?? 0);
            if ($duration <= 0) $duration = mp4DurationSeconds($destPath);
            if ($duration > 0) $item['duration'] = $duration;
            // Generate video thumbnail
            $thumbFilename = $itemId . '.jpg';
            if (generateVideoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename)) {
                $item['thumbnail'] = $thumbFilename;
            }
            $caps = extractEmbeddedCaptions($destPath, $itemId, $duration);
            if ($caps) $item['captions'] = $caps;
        }

        $videos[] = $item;
        $imported[] = $item;
        // Persist after each file so a fatal on a later (large) image doesn't
        // discard the ones already processed — their originals are already moved
        // out of the import folder by the rename above.
        writeGalleryVideos($params['gid'], $videos);
    }

    respond(['imported' => $imported, 'errors' => $errors]);
}

// Probe/backfill metadata
if ($method === 'POST' && matchRoute('/api/admin/galleries/{gid}/probe', $uri, $params)) {
    requireAuth();
    $videos = readGalleryVideos($params['gid']);
    $updated = 0;

    foreach ($videos as &$item) {
        $filePath = UPLOADS_DIR . '/' . $item['filename'];
        if (!file_exists($filePath)) continue;

        if (($item['type'] ?? '') === 'video' && empty($item['duration'])) {
            $meta = probeVideo($filePath);
            if ($meta) {
                $item['duration'] = $meta['duration'];
                $item['width'] = $meta['width'];
                $item['height'] = $meta['height'];
                $updated++;
            }
        } elseif (($item['type'] ?? '') === 'photo' && empty($item['width'])) {
            $meta = probeImage($filePath);
            if ($meta) {
                $item['width'] = $meta['width'];
                $item['height'] = $meta['height'];
                $updated++;
            }
            if (empty($item['thumbnail'])) {
                $thumbFilename = $item['id'] . '.jpg';
                generatePhotoThumbnail($filePath, THUMBS_DIR . '/' . $thumbFilename);
                $item['thumbnail'] = $thumbFilename;
            }
            if (empty($item['proxy'])) {
                $proxyFilename = $item['id'] . '_proxy.jpg';
                generatePhotoProxy($filePath, PROXY_DIR . '/' . $proxyFilename);
                $item['proxy'] = $proxyFilename;
                $updated++;
            }
        }
    }
    unset($item);

    writeGalleryVideos($params['gid'], $videos);
    respond(['ok' => true, 'updated' => $updated]);
}

// ============================================================
// PROOFING (public, token-based)
// ============================================================

function resolveEffectiveSettings($gallery) {
    if ($gallery['overrideCollectionSettings'] ?? false) return $gallery;
    foreach (readCollections() as $col) {
        if (in_array($gallery['id'], $col['galleryIds'] ?? [])) {
            $gallery['password'] = $col['password'] ?? null;
            $gallery['downloadsEnabled'] = $col['downloadsEnabled'] ?? false;
            $gallery['commentingEnabled'] = $col['commentingEnabled'] ?? false;
            $gallery['expiresAt'] = $col['expiresAt'] ?? null;
            $gallery['active'] = $col['active'] ?? true;
            $gallery['_inheritedCollectionId'] = $col['id'];
            return $gallery;
        }
    }
    return $gallery;
}

function isCollectionUnlocked($collectionId) {
    return !empty($_SESSION['unlocked_collections'])
        && in_array($collectionId, $_SESSION['unlocked_collections'], true);
}

function markCollectionUnlocked($collectionId) {
    if (!isset($_SESSION['unlocked_collections']) || !is_array($_SESSION['unlocked_collections'])) {
        $_SESSION['unlocked_collections'] = [];
    }
    if (!in_array($collectionId, $_SESSION['unlocked_collections'], true)) {
        $_SESSION['unlocked_collections'][] = $collectionId;
    }
}

function getProofingGallery($token) {
    $gallery = findGalleryByToken($token);
    if (!$gallery) respondError('Not found', 404);
    // A reels gallery that moved into the portfolio: send the visitor on
    // rather than showing them a dead link.
    if (!empty($gallery['migratedTo'])) {
        $url = migrationState()['tokens'][$token] ?? null;
        if ($url) respond(['redirect' => $url]);
    }
    $gallery = resolveEffectiveSettings($gallery);
    if (($gallery['active'] ?? true) === false) respondError('Not found', 404);
    if (!empty($gallery['expiresAt']) && strtotime($gallery['expiresAt']) < time()) {
        respondError('Gallery expired', 410);
    }
    return $gallery;
}

function galleryPayload($gallery) {
    $videos = array_values(array_filter(readGalleryVideos($gallery['id']), function($v) {
        return ($v['type'] ?? '') === 'header' || ($v['visible'] ?? true) !== false;
    }));
    $comments = readGalleryComments($gallery['id']);
    return [
        'gallery' => [
            'name' => $gallery['name'],
            'type' => $gallery['type'] ?? 'proofing',
            'downloadsEnabled' => $gallery['downloadsEnabled'],
            'commentingEnabled' => $gallery['commentingEnabled'] ?? false,
        ],
        'videos' => $videos,
        'comments' => $comments,
    ];
}

if ($method === 'GET' && matchRoute('/api/proofing/{token}', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    $colId = $gallery['_inheritedCollectionId'] ?? null;
    if (!empty($gallery['password']) && !($colId && isCollectionUnlocked($colId))) {
        respond(['passwordRequired' => true, 'galleryName' => $gallery['name']]);
    }
    recordView(galleryStatsPath($gallery['id']));
    respond(galleryPayload($gallery));
}

if ($method === 'POST' && matchRoute('/api/proofing/{token}/unlock', $uri, $params)) {
    rateLimitCheck('unlock:' . ($params['token']) . ':' . ($_SERVER['REMOTE_ADDR'] ?? ''), 5, 60);
    $gallery = getProofingGallery($params['token']);
    if (empty($gallery['password'])) respond(galleryPayload($gallery));

    $input = getInput();
    $password = $input['password'] ?? '';
    if (!$password) respondError('Incorrect password', 401);

    $match = false;
    if (str_starts_with($gallery['password'], '$2b$') || str_starts_with($gallery['password'], '$2a$') || str_starts_with($gallery['password'], '$2y$')) {
        $match = password_verify($password, $gallery['password']);
    } else {
        $match = ($password === $gallery['password']);
    }

    if (!$match) respondError('Incorrect password', 401);
    if (!empty($gallery['_inheritedCollectionId'])) {
        markCollectionUnlocked($gallery['_inheritedCollectionId']);
    }
    recordView(galleryStatsPath($gallery['id']));
    respond(galleryPayload($gallery));
}

if ($method === 'POST' && matchRoute('/api/proofing/{token}/comments', $uri, $params)) {
    rateLimitCheck('comment:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 10, 60);
    $gallery = getProofingGallery($params['token']);
    if (!($gallery['commentingEnabled'] ?? false)) respondError('Commenting is disabled', 403);
    $input = getInput();

    $videoId = $input['videoId'] ?? '';
    $name = $input['name'] ?? '';
    $text = $input['text'] ?? '';
    if (!$videoId || !$name || !$text) respondError('Missing required fields', 400);
    if (strlen($name) > 100) respondError('Name is too long (max 100 characters)', 400);
    if (strlen($text) > 5000) respondError('Comment is too long (max 5000 characters)', 400);

    $videos = readGalleryVideos($gallery['id']);
    $found = false;
    foreach ($videos as $v) { if ($v['id'] === $videoId) { $found = true; break; } }
    if (!$found) respondError('Not found', 404);

    $comment = [
        'id' => generateId('c_'),
        'videoId' => $videoId,
        'name' => trim($name),
        'text' => trim($text),
        'timestamp' => (float)($input['timestamp'] ?? 0),
        'createdAt' => date('c'),
    ];

    $comments = readGalleryComments($gallery['id']);
    $comments[] = $comment;
    writeGalleryComments($gallery['id'], $comments);
    respond($comment);
}

// Download single
if ($method === 'GET' && matchRoute('/api/proofing/{token}/download/{videoId}', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);

    $videos = readGalleryVideos($gallery['id']);
    $video = null;
    foreach ($videos as $v) { if ($v['id'] === $params['videoId']) { $video = $v; break; } }
    if (!$video) respondError('Not found', 404);

    $filePath = UPLOADS_DIR . '/' . $video['filename'];
    if (!file_exists($filePath)) respondError('File not found', 404);

    recordItemDownload(galleryStatsPath($gallery['id']), $video['id']);

    $ext = pathinfo($video['filename'], PATHINFO_EXTENSION);
    $downloadName = preg_replace('/[^a-zA-Z0-9 .\-]/', '', $video['title']) . '.' . $ext;

    // Streams without buffering so a big video isn't loaded into memory, and
    // hands files past the dynamic-response cap to the web server so they
    // aren't truncated mid-download.
    sendStaticFile($filePath, $downloadName, 'application/octet-stream', staticUploadUrl($video['filename']));
}

// Bulk "Download All" beacon — fired once by proofing.js when a zip run starts.
// Per-file counts are still captured via the single-download endpoint above.
if ($method === 'POST' && matchRoute('/api/proofing/{token}/event/download-all', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);
    recordDownloadAll(galleryStatsPath($gallery['id']));
    respond(['ok' => true]);
}

// A client gallery's downloadable contents: its media, plus each video's
// caption tracks as sibling .vtt files named to match so players pick them up
// automatically. The browser-side zip did this, so the server-side one must too.
function proofingZipEntries($gallery) {
    $used = [];
    $entries = packageGalleryFiles($gallery, '', $used);

    $byFile = [];
    foreach (readGalleryVideos($gallery['id']) as $v) {
        if (empty($v['filename']) || empty($v['captions'])) continue;
        $byFile[$v['filename']] = $v['captions'];
    }
    if (!$byFile) return $entries;

    $withCaptions = [];
    foreach ($entries as $e) {
        $withCaptions[] = $e;
        foreach ($byFile[$e['file']] ?? [] as $c) {
            if (empty($c['filename'])) continue;
            $path = CAPTIONS_DIR . '/' . basename($c['filename']);
            if (!is_file($path)) continue;
            $stem = preg_replace('/\.[^.]+$/', '', $e['name']);
            $lang = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($c['lang'] ?? 'en'));
            $withCaptions[] = [
                'name'  => $stem . '.' . $lang . '.vtt',
                'file'  => $c['filename'],
                'dir'   => 'captions',
                'size'  => (int)filesize($path),
                'mtime' => (int)@filemtime($path) ?: time(),
                'id'    => '',
            ];
        }
    }
    return $withCaptions;
}

// "Download all" for a client gallery, using the same machinery as a delivery
// link: the server streams the zip, checksums come from the CRC cache, and the
// bytes go disk-to-socket. Previously this was assembled in the browser, which
// dodged the response-size cap but cost the client's CPU to checksum every byte
// and held the whole archive in memory on Safari, Firefox, and Chrome-on-macOS.
//
// The cap still applies to what PHP generates, so the gallery is planned into
// parts exactly like a delivery is. `plan` describes them; the page renders one
// button per part.
if ($method === 'GET' && matchRoute('/api/proofing/{token}/zip', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);

    $parts = packagePlanParts(proofingZipEntries($gallery));
    $out = [];
    foreach ($parts as $p) {
        $out[] = [
            'index'     => $p['index'],
            'kind'      => $p['kind'],
            'label'     => $p['kind'] === 'file' ? basename($p['entries'][0]['name']) : sprintf('Part %d', $p['index']),
            'size'      => (int)$p['size'],
            'fileCount' => count($p['entries']),
            'url'       => '/api/proofing/' . rawurlencode($params['token']) . '/zip/' . $p['index'],
        ];
    }
    respond(['name' => $gallery['name'], 'parts' => $out]);
}

if (($method === 'GET' || $method === 'HEAD') && matchRoute('/api/proofing/{token}/zip/{index}', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);

    // Re-planned per request rather than stored: a client gallery is live, and
    // items can be added or hidden between the page loading and the click.
    $parts = packagePlanParts(proofingZipEntries($gallery));
    $part = null;
    foreach ($parts as $p) { if ((int)$p['index'] === (int)$params['index']) { $part = $p; break; } }
    if (!$part) respondError('Not found', 404);

    $label = packageFolderName($gallery['name']);

    if ($part['kind'] === 'file') {
        $entry = $part['entries'][0];
        $path = UPLOADS_DIR . '/' . basename($entry['file']);
        if (!is_file($path)) respondError('Not found', 404);
        recordItemDownload(galleryStatsPath($gallery['id']), $entry['id'] ?? '');
        sendStaticFile($path, basename($entry['name']), 'application/octet-stream', staticUploadUrl($entry['file']));
    }

    $partCount = count($parts);
    streamZipOfEntries($part['entries'], $partCount === 1
        ? "$label.zip"
        : sprintf('%s - part %d of %d.zip', $label, $part['index'], $partCount));
}

// Send review
if ($method === 'POST' && matchRoute('/api/proofing/{token}/send-review', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    $input = getInput();
    $reviewerName = $input['reviewerName'] ?? '';
    $videoId = $input['videoId'] ?? null;
    if (!$reviewerName) respondError('Reviewer name is required', 400);

    $videos = readGalleryVideos($gallery['id']);
    $comments = readGalleryComments($gallery['id']);

    $reviewerComments = array_filter($comments, fn($c) => $c['name'] === $reviewerName);
    if ($videoId) {
        $reviewerComments = array_filter($reviewerComments, fn($c) => $c['videoId'] === $videoId);
    }
    $reviewerComments = array_values($reviewerComments);

    if (!$reviewerComments) respondError('No comments found for this reviewer', 400);

    $video = null;
    if ($videoId) { foreach ($videos as $v) { if ($v['id'] === $videoId) { $video = $v; break; } } }
    $videoTitle = $video ? $video['title'] : null;

    try {
        sendReviewSummary($gallery, $videos, $reviewerComments, $reviewerName, $videoTitle, $videoId);
        respond(['ok' => true]);
    } catch (Exception $e) {
        respondError($e->getMessage(), 500);
    }
}

// ============================================================
// COLLECTIONS
// ============================================================

if ($method === 'GET' && $uri === '/api/collections') {
    requireAuth();
    $collections = readCollections();
    $galleries = readGalleries();
    $galMap = [];
    foreach ($galleries as $g) $galMap[$g['id']] = $g;

    $enriched = array_map(function($col) use ($galMap) {
        $colGalleries = [];
        foreach ($col['galleryIds'] as $gid) {
            if (isset($galMap[$gid])) {
                $g = $galMap[$gid];
                $colGalleries[] = ['id' => $g['id'], 'name' => $g['name'], 'type' => $g['type'], 'active' => $g['active'] ?? true, 'token' => $g['token']];
            }
        }
        $col['galleries'] = $colGalleries;
        $col['type'] = collectionType($col);
        $col['hasPassword'] = !empty($col['password']);
        unset($col['password']);
        $views = readCollectionStats($col['id'])['views'] ?? [];
        $col['viewCount'] = $views['total'] ?? 0;
        $col['uniqueVisitors'] = $views['unique'] ?? 0;
        $col['lastViewedAt'] = $views['lastViewedAt'] ?? null;
        return $col;
    }, $collections);
    respond($enriched);
}

if ($method === 'POST' && $uri === '/api/collections') {
    requireAuth();
    $input = getInput();
    $collections = readCollections();
    // Portfolio collections were the old grouping; categories replaced them.
    if (($input['type'] ?? '') === 'reels') respondError('Portfolio collections are now categories in the Portfolio tab', 400);
    $type = 'proofing';
    // Portfolio collections are public by definition: no password, no expiry,
    // no client commenting. Downloads stay a per-collection choice.
    $isPortfolio = $type === 'reels';
    $collection = [
        'id' => generateId('col_'),
        'name' => $input['name'] ?? 'New Collection',
        'type' => $type,
        'token' => generateToken(),
        'galleryIds' => $input['galleryIds'] ?? [],
        'password' => (!$isPortfolio && !empty($input['password'])) ? password_hash($input['password'], PASSWORD_BCRYPT) : null,
        'downloadsEnabled' => !empty($input['downloadsEnabled']),
        'commentingEnabled' => !$isPortfolio && !empty($input['commentingEnabled']),
        'expiresAt' => $isPortfolio ? null : ($input['expiresAt'] ?? null),
        'active' => !isset($input['active']) || !empty($input['active']),
        'sortOrder' => 'custom',
        'createdAt' => date('c'),
    ];
    $collections[] = $collection;
    writeCollections($collections);
    respond($collection);
}

if ($method === 'PUT' && matchRoute('/api/collections/{id}', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $collections = readCollections();
    $col = null;
    foreach ($collections as &$c) {
        if ($c['id'] === $params['id']) { $col = &$c; break; }
    }
    unset($c);
    if (!$col) respondError('Not found', 404);

    if (isset($input['name'])) $col['name'] = $input['name'];
    if (isset($input['type'])) {
        $col['type'] = $input['type'] === 'reels' ? 'reels' : 'proofing';
        // Switching a collection to portfolio drops the client-gating settings
        // rather than leaving a password silently attached to a public link.
        if ($col['type'] === 'reels') {
            $col['password'] = null;
            $col['expiresAt'] = null;
            $col['commentingEnabled'] = false;
        }
    }
    $isPortfolio = collectionType($col) === 'reels';

    // Handle gallery removal: copy collection settings into removed galleries that weren't overriding
    if (isset($input['galleryIds'])) {
        $oldIds = $col['galleryIds'] ?? [];
        $newIds = $input['galleryIds'];
        $removedIds = array_diff($oldIds, $newIds);
        if (!empty($removedIds)) {
            $galleries = readGalleries();
            $changed = false;
            foreach ($galleries as &$gal) {
                if (in_array($gal['id'], $removedIds) && !($gal['overrideCollectionSettings'] ?? false)) {
                    $gal['password'] = $col['password'] ?? null;
                    $gal['downloadsEnabled'] = $col['downloadsEnabled'] ?? false;
                    $gal['commentingEnabled'] = $col['commentingEnabled'] ?? false;
                    $gal['expiresAt'] = $col['expiresAt'] ?? null;
                    $gal['active'] = $col['active'] ?? true;
                    $gal['overrideCollectionSettings'] = true;
                    $changed = true;
                }
            }
            unset($gal);
            if ($changed) writeGalleries($galleries);
        }
        $col['galleryIds'] = $newIds;
    }

    if (!empty($input['regenerateToken'])) {
        $col['token'] = generateToken();
    } elseif (array_key_exists('token', $input)) {
        $wanted = normalizeShareToken($input['token']);
        if ($wanted === null) respondError(SHARE_TOKEN_RULES, 400);
        foreach ($collections as $other) {
            if ($other['id'] !== $col['id'] && ($other['token'] ?? '') === $wanted) {
                respondError('Another collection is already using that link.', 409);
            }
        }
        $col['token'] = $wanted;
    }
    if (array_key_exists('password', $input) && !$isPortfolio) {
        $col['password'] = $input['password'] ? password_hash($input['password'], PASSWORD_BCRYPT) : null;
    }
    if (isset($input['downloadsEnabled'])) $col['downloadsEnabled'] = $input['downloadsEnabled'];
    if (isset($input['commentingEnabled']) && !$isPortfolio) $col['commentingEnabled'] = $input['commentingEnabled'];
    if (isset($input['expiresAt']) && !$isPortfolio) $col['expiresAt'] = $input['expiresAt'];
    if (isset($input['active'])) $col['active'] = $input['active'];
    if (isset($input['sortOrder'])) $col['sortOrder'] = $input['sortOrder'];
    if (isset($input['favorite'])) $col['favorite'] = $input['favorite'];

    writeCollections($collections);
    $out = $col;
    $out['hasPassword'] = !empty($out['password']);
    unset($out['password']);
    respond($out);
}

if ($method === 'DELETE' && matchRoute('/api/collections/{id}', $uri, $params)) {
    requireAuth();
    $collections = readCollections();
    $idx = null;
    foreach ($collections as $i => $c) {
        if ($c['id'] === $params['id']) { $idx = $i; break; }
    }
    if ($idx === null) respondError('Not found', 404);
    $statsFile = collectionStatsPath($collections[$idx]['id']);
    if (file_exists($statsFile)) { unlink($statsFile); @rmdir(dirname($statsFile)); }
    array_splice($collections, $idx, 1);
    writeCollections($collections);
    respond(['ok' => true]);
}

function collectionPublicPayload($col) {
    $galleries = readGalleries();
    $galMap = [];
    foreach ($galleries as $g) $galMap[$g['id']] = $g;

    $type = collectionType($col);
    $publicGalleries = [];
    foreach ($col['galleryIds'] as $gid) {
        if (!isset($galMap[$gid])) continue;
        $g = $galMap[$gid];
        // A collection only ever shows galleries of its own type, and a
        // gallery with no token has no page to link to.
        if (($g['active'] ?? true) === false || $g['type'] !== $type || empty($g['token'])) continue;
        $videos = array_filter(readGalleryVideos($g['id']), fn($v) => ($v['type'] ?? '') !== 'header');
        $thumb = !empty($videos) ? (reset($videos)['thumbnail'] ?? null) : null;
        $publicGalleries[] = [
            'name' => $g['name'],
            'token' => $g['token'],
            'thumbnail' => $thumb,
            'videoCount' => count($videos),
            'createdAt' => $g['createdAt'] ?? '',
        ];
    }

    $sortOrder = $col['sortOrder'] ?? 'custom';
    if ($sortOrder === 'newest') {
        usort($publicGalleries, fn($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
    } elseif ($sortOrder === 'oldest') {
        usort($publicGalleries, fn($a, $b) => strcmp($a['createdAt'], $b['createdAt']));
    } elseif ($sortOrder === 'alpha') {
        usort($publicGalleries, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    }
    // 'custom' keeps galleryIds order as-is

    // Strip createdAt from public response
    $publicGalleries = array_map(fn($g) => array_diff_key($g, ['createdAt' => 1]), $publicGalleries);

    return ['name' => $col['name'], 'type' => $type, 'galleries' => $publicGalleries];
}

if ($method === 'GET' && matchRoute('/api/collections/public/{token}', $uri, $params)) {
    $col = findCollectionByToken($params['token']);
    if (!$col) respondError('Collection not found', 404);
    if (($col['active'] ?? true) === false) respondError('Collection not found', 404);
    // Portfolio collections are public work — no expiry, no password gate.
    $gated = collectionType($col) !== 'reels';
    if ($gated && !empty($col['expiresAt']) && strtotime($col['expiresAt']) < time()) {
        respondError('Collection expired', 410);
    }
    if ($gated && !empty($col['password']) && !isCollectionUnlocked($col['id'])) {
        respond(['passwordRequired' => true, 'collectionName' => $col['name']]);
    }
    recordView(collectionStatsPath($col['id']));
    respond(collectionPublicPayload($col));
}

if ($method === 'POST' && matchRoute('/api/collections/public/{token}/unlock', $uri, $params)) {
    rateLimitCheck('col-unlock:' . ($params['token']) . ':' . ($_SERVER['REMOTE_ADDR'] ?? ''), 5, 60);
    $col = findCollectionByToken($params['token']);
    if (!$col) respondError('Collection not found', 404);
    if (($col['active'] ?? true) === false) respondError('Collection not found', 404);
    if (!empty($col['expiresAt']) && strtotime($col['expiresAt']) < time()) {
        respondError('Collection expired', 410);
    }
    if (empty($col['password'])) respond(collectionPublicPayload($col));

    $input = getInput();
    $password = $input['password'] ?? '';
    if (!$password) respondError('Incorrect password', 401);

    $match = false;
    if (str_starts_with($col['password'], '$2b$') || str_starts_with($col['password'], '$2a$') || str_starts_with($col['password'], '$2y$')) {
        $match = password_verify($password, $col['password']);
    } else {
        $match = ($password === $col['password']);
    }

    if (!$match) respondError('Incorrect password', 401);
    markCollectionUnlocked($col['id']);
    recordView(collectionStatsPath($col['id']));
    respond(collectionPublicPayload($col));
}

// ============================================================
// DELIVERY PACKAGES
// ============================================================
//
// WeTransfer-style handoff: share one link, the client gets the whole gallery
// (or collection) as numbered zip downloads — or picks off individual files.
//
// Nothing is ever zipped on disk. Preparing a package only writes a plan: which
// files go in which part, and in what order. The zip is generated on the fly
// while the client downloads it, so:
//
//   * Preparing is instant — no build step, so the link and its email go out
//     the moment you hit send, however many terabytes are involved.
//   * Serving costs one read of each file. Pre-building cost three (CRC pass,
//     copy pass, zip write) plus a fourth to serve it, which is what made it
//     crawl on I/O-throttled shared hosting.
//   * Zero extra disk. No temp files, no quota, nothing to clean up.
//
// Entries are STOREd, never deflated: media is already compressed, so deflate
// would burn CPU to save nothing. Because STORE means the compressed size
// equals the file size, the exact byte length of the whole archive is known
// before a single byte is sent — so we send a real Content-Length and the
// client gets a true progress bar rather than an unbounded spinner.
//
// CRCs aren't known until the bytes have been read, so each entry uses a
// trailing data descriptor (general-purpose bit 3). Every standard extractor
// reads the central directory at the end, where the real values live.

// ---- CRC32 cache ----
//
// Every ZIP entry needs a CRC32 of its contents, which means hashing every byte
// in PHP. That is pure CPU work, and on shared hosting (CloudLinux caps CPU per
// account) it is *the* bottleneck in a delivery. Measured on a live cPanel host:
// streaming a zip ran at 12 MB/s while the same bytes served without hashing ran
// at 102 MB/s. Locally, removing the hash from the copy loop made it 47x faster.
// CRC isn't a cost, it's the only cost.
//
// So each file is hashed exactly once — at upload — and the result kept here,
// keyed by stored filename. Uploads are immutable, so a cached value stays
// valid; `size` is stored alongside as a sanity check in case a file is ever
// replaced on disk out of band.
//
// CRC_CACHE_PATH is defined with the other paths at the top of this file: the
// upload route runs long before this point, so a define() here would not exist
// yet when registerGalleryItem() hashes a new file.

function crcCacheAll(): array {
    $c = jsonRead(CRC_CACHE_PATH);
    return is_array($c) ? $c : [];
}

// Cached CRC32 for an upload, or null when it hasn't been hashed yet.
function crcCacheLookup(string $storedName, int $size): ?int {
    $entry = crcCacheAll()[$storedName] ?? null;
    if (!is_array($entry)) return null;
    if ((int)($entry['size'] ?? -1) !== $size) return null;
    return (int)$entry['crc'];
}

function crcCacheStore(string $storedName, int $crc, int $size): void {
    jsonUpdate(CRC_CACHE_PATH, function ($cache) use ($storedName, $crc, $size) {
        $cache[$storedName] = ['crc' => $crc, 'size' => $size];
        return $cache;
    });
}

// Cached CRC32, hashing the file if this is the first time we've seen it.
// Pass $compute = false to ask "is it warm yet?" without paying for the pass.
// Drops a cached checksum for a file that is no longer in uploads/, so the
// entry can't be matched against some later file of the same name and size.
function crcCacheForget(string $storedName): void {
    jsonUpdate(CRC_CACHE_PATH, function ($cache) use ($storedName) {
        unset($cache[$storedName]);
        return $cache;
    });
}

function fileCrc32(string $path, bool $compute = true): ?int {
    $storedName = basename($path);
    $size = (int)@filesize($path);
    $hit = crcCacheLookup($storedName, $size);
    if ($hit !== null) return $hit;
    if (!$compute) return null;

    $hex = @hash_file('crc32b', $path);
    if ($hex === false) return null;
    $crc = (int)hexdec($hex);
    crcCacheStore($storedName, $crc, $size);
    return $crc;
}

// !! The limit that actually governs this is the WEB SERVER's, not the zip
// format's. LiteSpeed caps any dynamically generated response at
// "Max Dynamic Response Body Size" — 1 GiB by default — and when a response
// runs past it, LiteSpeed truncates the stream and appends an HTML error. For
// a zip that means no end-of-central-directory, and the client gets a file
// their unarchiver refuses to open. There is no way to detect this from PHP
// mid-stream, so parts are kept safely underneath it instead.
//
// 900 MB leaves headroom under the 1 GiB default. Raise it (or set 0 for a
// single download of any size, which Zip64 supports) only if the host's limit
// has been raised to match — see docs/API.md.
//
// Static files sidestep the cap entirely via sendStaticFile() below, which is
// why individual-file downloads have no such ceiling.

// Fixed sizes of the ZIP structures we emit, used to compute Content-Length.
// A streamed Zip64 entry carries a 16-byte placeholder extra field in its local
// header, an 8-byte-per-size data descriptor, and a 24-byte extra field in its
// central directory record.

// Drops a deny-all .htaccess into $dir. Top-level, so PHP hoists it and the
// bootstrap can call it long before this point in the file.
function denyWebAccess($dir) {
    $guard = $dir . '/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents($guard, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
}

function ensurePackagesDir() {
    if (!is_dir(PACKAGES_DIR)) @mkdir(PACKAGES_DIR, 0755, true);
    // Manifests carry the share token. Deny direct access here as well as in the
    // root .htaccess, in case a host ignores one of them.
    denyWebAccess(PACKAGES_DIR);
    return PACKAGES_DIR;
}

function packageDir($id) { return PACKAGES_DIR . '/' . $id; }
function packageManifestPath($id) { return packageDir($id) . '/manifest.json'; }

function readPackage($id) {
    if (!preg_match('/^pkg_[a-f0-9-]{36}$/', (string)$id)) return null;
    $m = jsonRead(packageManifestPath($id));
    return is_array($m) ? $m : null;
}
function writePackage($m) {
    if (!is_dir(packageDir($m['id']))) mkdir(packageDir($m['id']), 0755, true);
    jsonWrite(packageManifestPath($m['id']), $m);
}
function deletePackageFiles($id) {
    $dir = packageDir($id);
    if (!is_dir($dir)) return;
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($dir);
}

// A package holds only a manifest, so expiring one is just deleting a plan —
// there are no gigabytes of zip to reclaim.
function cleanupExpiredPackages() {
    foreach (glob(PACKAGES_DIR . '/pkg_*', GLOB_ONLYDIR) ?: [] as $dir) {
        $m = jsonRead($dir . '/manifest.json');
        if (!is_array($m)) continue;
        if (!empty($m['expiresAt']) && strtotime($m['expiresAt']) < time()) {
            deletePackageFiles(basename($dir));
        }
    }
}

// --- ZIP structures (STORE, streamed) ---

function zipDosTime($ts) {
    if ((int)date('Y', $ts) < 1980) $ts = mktime(0, 0, 0, 1, 1, 1980);
    $time = ((int)date('H', $ts) << 11) | ((int)date('i', $ts) << 5) | ((int)date('s', $ts) >> 1);
    $date = (((int)date('Y', $ts) - 1980) << 9) | ((int)date('n', $ts) << 5) | (int)date('j', $ts);
    return [$time, $date];
}

// Every archive is Zip64, whatever its size. Emitting zip32 for small
// transfers and Zip64 only past 4 GB would mean the 64-bit path — the one
// carrying a client's largest, least-repeatable delivery — was the path that
// almost never ran, so a defect in it would first surface on a 40 GB handover.
// One path is exercised by every download instead. Zip64 has been standard
// since 2001 and costs ~56 bytes per file.
//
// CRCs come from the cache, so they're known before a byte is sent. That lets
// the local header carry the real CRC and sizes with no general-purpose flags
// set, which means no trailing data descriptor — and, more importantly, that
// the entry body can be copied straight from disk to the socket in C instead of
// being read through PHP a chunk at a time to be hashed on the way past.
function zipStreamLocalHeader($name, $mtime, $crc, $size) {
    [$t, $d] = zipDosTime($mtime);
    // 32-bit size fields are sentinels; the real 64-bit values are in the extra.
    $extra = pack('vv', 0x0001, 16) . pack('PP', $size, $size);
    return pack('VvvvvvVVVvv',
        0x04034b50, 45, 0x0000, 0, $t, $d,
        $crc, ZIP32_MAX, ZIP32_MAX, strlen($name), strlen($extra)
    ) . $name . $extra;
}

function zipCentralEntry($e) {
    [$t, $d] = zipDosTime($e['mtime']);
    // The 32-bit size and offset fields are sentinels; the real 64-bit values
    // live in the extra field.
    $extra = pack('vv', 0x0001, 24) . pack('PPP', $e['size'], $e['size'], $e['offset']);
    return pack('VvvvvvvVVVvvvvvVV',
        0x02014b50, 45, 45, 0x0000, 0, $t, $d,
        $e['crc'], ZIP32_MAX, ZIP32_MAX,
        strlen($e['name']), strlen($extra), 0, 0, 0, 0, ZIP32_MAX
    ) . $e['name'] . $extra;
}

function zipEndOfCentralDirectory($count, $cdSize, $cdOffset) {
    // Zip64 EOCD record, then its locator, then a classic EOCD full of
    // sentinels so zip32-only readers still find something well-formed.
    $eocd64 = pack('V', 0x06064b50) . pack('P', 44) . pack('vvVV', 45, 45, 0, 0)
        . pack('PPPP', $count, $count, $cdSize, $cdOffset);
    $locator = pack('VV', 0x07064b50, 0) . pack('P', $cdOffset + $cdSize) . pack('V', 1);
    $eocd = pack('VvvvvVVv', 0x06054b50, 0, 0, 0xFFFF, 0xFFFF, ZIP32_MAX, ZIP32_MAX, 0);
    return $eocd64 . $locator . $eocd;
}

// Exact byte length of the archive for a set of entries. Deterministic because
// STORE means compressed size == file size, which is what lets us send a real
// Content-Length on a zip that doesn't exist yet. Must stay in lockstep with
// what the streaming route emits, or downloads truncate.
// Everything one entry adds to the archive besides its own bytes: local header,
// its Zip64 extra, the central directory record, and that record's Zip64 extra.
// No data descriptor — CRCs are known up front, so they go in the header.
//
// Both the size calculation and the part planner go through here so they cannot
// drift apart. If they do, Content-Length stops matching the bytes actually sent
// and every download truncates.
function zipEntryOverhead(int $nameLen): int {
    return ZIP_LOCAL_HEADER_BYTES + $nameLen + ZIP64_LOCAL_EXTRA_BYTES
         + ZIP_CENTRAL_ENTRY_BYTES + $nameLen + ZIP64_CENTRAL_EXTRA_BYTES;
}

function zipArchiveOverhead(): int {
    return ZIP_EOCD_BYTES + ZIP64_EOCD_BYTES + ZIP64_LOCATOR_BYTES;
}

function zipStreamedSize(array $entries) {
    $total = zipArchiveOverhead();
    foreach ($entries as $e) {
        $total += zipEntryOverhead(strlen($e['name'])) + (int)$e['size'];
    }
    return $total;
}

// --- Planning ---

function packageEntryName($title, $filename, array &$used) {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $base = preg_replace('/[^A-Za-z0-9 ._-]/', '', (string)$title);
    $base = trim(preg_replace('/\s+/', ' ', $base));
    // A title of "beach.jpg" must not become "beach.jpg.jpg".
    if ($ext !== '' && strtolower(substr($base, -strlen($ext) - 1)) === '.' . $ext) {
        $base = substr($base, 0, -strlen($ext) - 1);
    }
    if ($base === '' || $base === '.' || $base === '..') $base = pathinfo($filename, PATHINFO_FILENAME);
    $base = substr($base, 0, 120);
    $name = $ext ? "$base.$ext" : $base;
    $n = 2;
    while (isset($used[strtolower($name)])) {
        $name = ($ext ? "$base ($n).$ext" : "$base ($n)");
        $n++;
    }
    $used[strtolower($name)] = true;
    return $name;
}

function packageFolderName($name) {
    $clean = trim(preg_replace('/\s+/', ' ', preg_replace('/[^A-Za-z0-9 ._-]/', '', (string)$name)));
    return $clean === '' ? 'Gallery' : substr($clean, 0, 80);
}

// Every downloadable item in a gallery, in gallery order. Section headers and
// hidden items are skipped, as are records whose file has gone missing.
// `file` is stored relative to UPLOADS_DIR so the manifest survives a move.
function packageGalleryFiles($gallery, $prefix, array &$used) {
    $out = [];
    foreach (readGalleryVideos($gallery['id']) as $v) {
        if (($v['type'] ?? '') === 'header') continue;
        if (($v['visible'] ?? true) === false) continue;
        if (empty($v['filename'])) continue;
        $path = UPLOADS_DIR . '/' . $v['filename'];
        if (!is_file($path)) continue;
        $name = packageEntryName($v['title'] ?? '', $v['filename'], $used);
        $out[] = [
            'name'  => $prefix === '' ? $name : ($prefix . '/' . $name),
            'file'  => $v['filename'],
            'size'  => (int)filesize($path),
            'mtime' => (int)@filemtime($path) ?: time(),
            // Kept so per-item download counts still work when a single
            // oversized file is served as its own part.
            'id'    => $v['id'] ?? '',
        ];
    }
    return $out;
}

// By default the whole transfer is a single download — Zip64 removes the 4 GB
// reason to split. Splitting only happens when PACKAGE_PART_MB is set.
function packagePlanParts(array $entries) {
    $parts = [];

    if (PACKAGE_PART_MAX_BYTES <= 0) {
        $parts[] = ['kind' => 'zip', 'entries' => $entries];
    } else {
        $current = [];
        $currentBytes = zipArchiveOverhead();

        $flush = function () use (&$parts, &$current, &$currentBytes) {
            if (!$current) return;
            $parts[] = ['kind' => 'zip', 'entries' => $current];
            $current = [];
            $currentBytes = zipArchiveOverhead();
        };

        foreach ($entries as $e) {
            $cost = zipEntryOverhead(strlen($e['name'])) + (int)$e['size'];

            // A file bigger than a whole part can't be split across parts
            // without a multi-volume archive most clients can't open. Hand it
            // over as the original file instead — zipping a single 6 GB video
            // buys nothing anyway.
            if ($cost + zipArchiveOverhead() > PACKAGE_PART_MAX_BYTES) {
                $flush();
                $parts[] = ['kind' => 'file', 'entries' => [$e]];
                continue;
            }
            if ($currentBytes + $cost > PACKAGE_PART_MAX_BYTES) $flush();
            $current[] = $e;
            $currentBytes += $cost;
        }
        $flush();
    }

    foreach ($parts as $i => &$p) {
        $p['index'] = $i + 1;
        $p['size'] = $p['kind'] === 'file' ? (int)$p['entries'][0]['size'] : zipStreamedSize($p['entries']);
    }
    unset($p);
    return $parts;
}

// --- Payloads ---

function packageBaseUrl() {
    return rtrim(getEmailConfig()['baseUrl'] ?: '', '/');
}

function packagePayload($m, $includeInternals = false) {
    $base = packageBaseUrl();
    $parts = [];
    $fileIndex = 0;
    foreach ($m['parts'] as $p) {
        $files = [];
        foreach ($p['entries'] as $e) {
            $files[] = [
                'index' => $fileIndex,
                'name'  => $e['name'],
                'size'  => (int)$e['size'],
                'url'   => "$base/api/packages/{$m['token']}/file/$fileIndex",
                // Same bytes, served by the web server instead of PHP. The
                // download page prefers this; the /file/ route above stays as
                // the API-friendly equivalent.
                'staticUrl' => $base . staticUploadUrl($e['file']),
            ];
            $fileIndex++;
        }
        $parts[] = [
            'index'     => $p['index'],
            'kind'      => $p['kind'],
            'label'     => $p['kind'] === 'file' ? basename($p['entries'][0]['name']) : sprintf('Part %d', $p['index']),
            'size'      => (int)$p['size'],
            'fileCount' => count($p['entries']),
            'url'       => "$base/api/packages/{$m['token']}/part/{$p['index']}",
            'files'     => $files,
        ];
    }
    $out = [
        'id'            => $m['id'],
        'name'          => $m['name'],
        // Kept for API compatibility: a package is ready the moment it exists.
        'status'        => 'ready',
        'totalBytes'    => (int)$m['totalBytes'],
        'fileCount'     => (int)$m['fileCount'],
        'parts'         => $parts,
        'shareUrl'      => "$base/d/{$m['token']}",
        'createdAt'     => $m['createdAt'],
        'expiresAt'     => $m['expiresAt'],
        'message'       => $m['message'] ?? '',
        'lastEmailedAt' => $m['lastEmailedAt'] ?? null,
        'lastEmailedTo' => $m['lastEmailedTo'] ?? [],
    ];
    if ($includeInternals) {
        $out['sourceType'] = $m['sourceType'];
        $out['sourceId']   = $m['sourceId'];
        $out['token']      = $m['token'];
    }
    return $out;
}

function findPackageByToken($token) {
    foreach (glob(PACKAGES_DIR . '/pkg_*', GLOB_ONLYDIR) ?: [] as $dir) {
        $m = jsonRead($dir . '/manifest.json');
        if (is_array($m) && ($m['token'] ?? '') === $token) return $m;
    }
    return null;
}

// Build the plan for a gallery or collection. Pure bookkeeping — no file reads
// beyond stat(), so this returns immediately whatever the size.
function buildPackagePlan($sourceType, $sourceId) {
    $used = [];
    $entries = [];
    $name = '';

    if ($sourceType === 'gallery') {
        $gallery = null;
        foreach (readGalleries() as $g) { if ($g['id'] === $sourceId) { $gallery = $g; break; } }
        if (!$gallery) respondError('Gallery not found', 404);
        $name = $gallery['name'];
        $entries = packageGalleryFiles($gallery, '', $used);
    } else {
        $col = null;
        foreach (readCollections() as $c) { if ($c['id'] === $sourceId) { $col = $c; break; } }
        if (!$col) respondError('Collection not found', 404);
        $name = $col['name'];
        $galMap = [];
        foreach (readGalleries() as $g) $galMap[$g['id']] = $g;
        // One folder per gallery so the extracted tree matches what the client
        // sees on the collection page. Names only need to be unique within a
        // folder, so each gallery gets its own dedupe scope.
        $usedFolders = [];
        foreach ($col['galleryIds'] ?? [] as $gid) {
            if (!isset($galMap[$gid])) continue;
            $folder = packageFolderName($galMap[$gid]['name']);
            $n = 2;
            while (isset($usedFolders[strtolower($folder)])) { $folder = packageFolderName($galMap[$gid]['name']) . " ($n)"; $n++; }
            $usedFolders[strtolower($folder)] = true;
            $folderUsed = [];
            $entries = array_merge($entries, packageGalleryFiles($galMap[$gid], $folder, $folderUsed));
        }
    }

    return [$name, $entries];
}

// --- Admin routes ---

// Does a sendfile handoff actually work on this host?
//
// Worth having as a route rather than a note in the docs, because the failure
// mode is silent: a host that ignores the header returns 200 with an empty body
// and every download breaks with no error anywhere. This serves one small real
// upload through the requested mode, so the answer is measured, not assumed.
//
//   GET /api/admin/sendfile-test              -> stream through PHP (control)
//   GET /api/admin/sendfile-test?mode=location
//   GET /api/admin/sendfile-test?mode=litespeed
//
// Compare byte counts against the control. A mode returning fewer bytes is not
// supported here; leave SENDFILE=off.
if ($method === 'GET' && $uri === '/api/admin/sendfile-test') {
    requireAuth();

    // Smallest upload available, so the test is quick on any connection.
    $best = null; $bestSize = PHP_INT_MAX;
    foreach (glob(UPLOADS_DIR . '/*') ?: [] as $f) {
        if (!is_file($f)) continue;
        $sz = (int)filesize($f);
        if ($sz > 0 && $sz < $bestSize) { $best = $f; $bestSize = $sz; }
    }
    if ($best === null) respondError('No uploads to test with', 404);

    $mode = strtolower((string)($_GET['mode'] ?? 'off'));
    $isLiteSpeed = stripos($_SERVER['SERVER_SOFTWARE'] ?? '', 'litespeed') !== false;

    header('X-Sendfile-Test-Mode: ' . $mode);
    header('X-Sendfile-Test-Expected-Bytes: ' . $bestSize);
    header('X-Sendfile-Test-Server: ' . ($isLiteSpeed ? 'litespeed' : 'other'));

    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { ob_end_clean(); }
    header('Content-Type: application/octet-stream');
    // Set deliberately: the question that decides whether a handoff is usable
    // is whether Content-Disposition survives it. Without it a download opens
    // inline in the browser under the wrong name.
    header('Content-Disposition: attachment; filename="sendfile-test.bin"');

    if ($mode === 'location' && $isLiteSpeed) {
        header('X-LiteSpeed-Location: ' . staticUploadUrl(basename($best)));
        exit;
    }
    if ($mode === 'litespeed' && $isLiteSpeed) {
        header('X-LiteSpeed-Send-File: ' . $best);
        exit;
    }
    header('Content-Length: ' . $bestSize);
    $fp = fopen($best, 'rb');
    if ($fp === false) respondError('Could not read test file', 500);
    fpassthru($fp);
    fclose($fp);
    exit;
}

// Warm the CRC cache for files uploaded before it existed.
//
// Scoped to one package by default, because that is proportional to what is
// actually being sent: a library-wide pass hashes thousands of files to deliver
// three of them, and hashing is the slow, CPU-capped part. Pass a packageId and
// only that delivery's files are hashed; omit it and the whole library is done,
// which is available but rarely what you want.
//
// Time-boxed either way, so the caller loops until `done`. Deliveries work
// throughout: an unwarmed file is hashed on its first download instead, which is
// merely the old speed rather than a failure.

if ($method === 'POST' && $uri === '/api/admin/crc-warm') {
    requireAuth();
    $deadline = microtime(true) + CRC_WARM_SLICE_SECONDS;
    $input = getInput();
    $packageId = trim((string)($input['packageId'] ?? ''));

    $wanted = [];
    if ($packageId !== '') {
        $m = readPackage($packageId);
        if (!$m) respondError('Package not found', 404);
        foreach ($m['parts'] as $p) {
            foreach ($p['entries'] as $e) {
                if (!empty($e['file'])) $wanted[$e['file']] = true;
            }
        }
    } else {
        // Newest galleries first, so recent work becomes deliverable soonest.
        foreach (array_reverse(readGalleries()) as $g) {
            foreach (readGalleryVideos($g['id']) as $v) {
                if (($v['type'] ?? '') === 'header' || empty($v['filename'])) continue;
                $wanted[$v['filename']] = true;
            }
        }
    }
    $wanted = array_keys($wanted);

    $cache = crcCacheAll();
    $todo = [];
    foreach ($wanted as $name) {
        $path = UPLOADS_DIR . '/' . basename($name);
        if (!is_file($path)) continue;
        $entry = $cache[$name] ?? null;
        if (is_array($entry) && (int)($entry['size'] ?? -1) === (int)filesize($path)) continue;
        $todo[] = $path;
    }

    $hashed = 0;
    foreach ($todo as $path) {
        if (microtime(true) >= $deadline) break;
        if (fileCrc32($path) !== null) $hashed++;
    }

    respond([
        'hashed'    => $hashed,
        'remaining' => max(0, count($todo) - $hashed),
        'total'     => count($wanted),
        'done'      => count($todo) - $hashed <= 0,
    ]);
}

if ($method === 'GET' && $uri === '/api/admin/packages') {
    requireAuth();
    ensurePackagesDir();
    cleanupExpiredPackages();
    $sourceId = $_GET['sourceId'] ?? '';
    $out = [];
    foreach (glob(PACKAGES_DIR . '/pkg_*', GLOB_ONLYDIR) ?: [] as $dir) {
        $m = jsonRead($dir . '/manifest.json');
        if (!is_array($m)) continue;
        if ($sourceId !== '' && ($m['sourceId'] ?? '') !== $sourceId) continue;
        $out[] = packagePayload($m, true);
    }
    usort($out, fn($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
    respond($out);
}

// Create a share link. Returns a ready package immediately; pass `to` to email
// it in the same call, which is the normal path from the admin.
if ($method === 'POST' && $uri === '/api/admin/packages') {
    requireAuth();
    ensurePackagesDir();
    cleanupExpiredPackages();
    $input = getInput();
    $sourceType = ($input['sourceType'] ?? '') === 'collection' ? 'collection' : 'gallery';
    $sourceId = trim((string)($input['sourceId'] ?? ''));
    if ($sourceId === '') respondError('sourceId is required', 400);

    [$name, $entries] = buildPackagePlan($sourceType, $sourceId);
    if (!$entries) respondError('Nothing to send — this ' . $sourceType . ' has no downloadable files', 400);

    $recipients = parseEmailRecipients($input['to'] ?? '');
    $note = trim((string)($input['message'] ?? ''));

    $parts = packagePlanParts($entries);
    $m = [
        'id'         => generateId('pkg_'),
        'token'      => generateToken(24),
        'sourceType' => $sourceType,
        'sourceId'   => $sourceId,
        'name'       => $name,
        'message'    => $note,
        'parts'      => $parts,
        'fileCount'  => count($entries),
        'totalBytes' => array_sum(array_column($entries, 'size')),
        'createdAt'  => date('c'),
        'expiresAt'  => date('c', time() + PACKAGE_TTL_SECONDS),
    ];

    if ($recipients) {
        requireEmailConfigured();
        // Send before persisting: a package whose email bounced shouldn't be
        // recorded as sent.
        foreach ($recipients as $addr) {
            try {
                sendPackageLinks($m, $addr, $note);
            } catch (Exception $e) {
                respondError($e->getMessage(), 502);
            }
        }
        $m['lastEmailedAt'] = date('c');
        $m['lastEmailedTo'] = $recipients;
    }

    writePackage($m);
    respond(packagePayload($m, true), 201);
}

// Update the note shown on the download page, without sending anything.
if ($method === 'PUT' && matchRoute('/api/admin/packages/{id}', $uri, $params)) {
    requireAuth();
    $m = readPackage($params['id']);
    if (!$m) respondError('Package not found', 404);
    $input = getInput();
    if (array_key_exists('message', $input)) $m['message'] = trim((string)$input['message']);
    writePackage($m);
    respond(packagePayload($m, true));
}

if ($method === 'DELETE' && matchRoute('/api/admin/packages/{id}', $uri, $params)) {
    requireAuth();
    $m = readPackage($params['id']);
    if (!$m) respondError('Package not found', 404);
    deletePackageFiles($m['id']);
    respond(['ok' => true]);
}

function formatByteSize($bytes) {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    $n = (float)$bytes;
    while ($n >= 1024 && $i < count($units) - 1) { $n /= 1024; $i++; }
    return ($i === 0 ? (int)$n : round($n, $n < 10 ? 1 : 0)) . ' ' . $units[$i];
}

function parseEmailRecipients($raw) {
    $list = is_array($raw) ? $raw : preg_split('/[,;\s]+/', (string)$raw);
    $out = [];
    foreach ($list as $addr) {
        $addr = trim((string)$addr);
        if ($addr === '') continue;
        if (!filter_var($addr, FILTER_VALIDATE_EMAIL)) respondError('Not a valid email address: ' . $addr, 400);
        $out[] = $addr;
    }
    return $out;
}

function requireEmailConfigured() {
    $cfg = getEmailConfig();
    if (!$cfg['resendApiKey'] && !$cfg['host'] && !$cfg['from']) {
        respondError('Email is not configured — set it up in Settings > Email first', 400);
    }
}

// One link to the download page, the way a transfer service does it. The page
// lists the parts and the individual files.
function sendPackageLinks($m, $to, $note) {
    $payload = packagePayload($m);
    $expires = date('F j, Y', strtotime($m['expiresAt']));
    $days = (int)round(PACKAGE_TTL_SECONDS / 86400);
    $dayLabel = $days . ' day' . ($days === 1 ? '' : 's');
    $subject = emailSubject('Download link', $m['name']);
    $count = $payload['fileCount'];
    $summary = $count . ' file' . ($count === 1 ? '' : 's') . ' · ' . formatByteSize($payload['totalBytes']);

    $text = ['Your files from "' . $m['name'] . '" are ready to download.', ''];
    if ($note !== '') { $text[] = $note; $text[] = ''; }
    $text[] = $summary;
    $text[] = '';
    $text[] = 'Download: ' . $payload['shareUrl'];
    $text[] = '';
    $text[] = "This link works for $dayLabel — it expires on $expires. Please save the files somewhere safe before then.";

    // The expiry is the one thing a client must not miss, so it gets its own
    // panel rather than a line of grey small print.
    $expiryPanel = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        . '<tr><td style="background:#fff8e6;border:1px solid #f2e1b6;border-radius:6px;padding:12px 14px;'
        . 'color:#7a5c12;font-size:13px;line-height:1.55;">'
        . '<strong>This link works for ' . escHtml($dayLabel) . '</strong>, until ' . escHtml($expires)
        . '. Please save your files somewhere safe before then.'
        . '</td></tr></table>';

    $body = ($note !== ''
            ? '<div style="color:#41464f;font-size:14.5px;line-height:1.6;white-space:pre-line;padding:0 0 18px;">'
              . escHtml($note) . '</div>'
            : '')
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="padding:0 0 4px;">'
        . '<tr><td style="background:#f4f5f7;border-radius:6px;padding:9px 14px;color:#41464f;font-size:13px;font-weight:600;">'
        . escHtml($summary) . '</td></tr></table>';

    $html = emailShell([
        'title' => 'Your files are ready',
        'lead'  => 'Here are your files from <strong style="color:#1a1a1a;">' . escHtml($m['name']) . '</strong>.',
        'body'  => $body,
        'cta'   => ['label' => 'Download your files', 'url' => $payload['shareUrl']],
        'note'  => $expiryPanel
                 . '<div style="padding:12px 0 0;">Or paste this into your browser:<br>'
                 . '<span style="color:#41464f;word-break:break-all;">' . escHtml($payload['shareUrl']) . '</span></div>',
    ]);

    sendEmail($to, $subject, implode("\n", $text), $html);
}

// Re-send an existing package.
if ($method === 'POST' && matchRoute('/api/admin/packages/{id}/email', $uri, $params)) {
    requireAuth();
    $m = readPackage($params['id']);
    if (!$m) respondError('Package not found', 404);

    $input = getInput();
    $note = trim((string)($input['message'] ?? $m['message'] ?? ''));
    $recipients = parseEmailRecipients($input['to'] ?? '');
    if (!$recipients) respondError('At least one recipient is required', 400);
    requireEmailConfigured();

    $sent = [];
    foreach ($recipients as $addr) {
        try {
            sendPackageLinks($m, $addr, $note);
            $sent[] = $addr;
        } catch (Exception $e) {
            respondError($e->getMessage() . ($sent ? ' (already sent to ' . implode(', ', $sent) . ')' : ''), 502);
        }
    }

    $m['message'] = $note;
    $m['lastEmailedAt'] = date('c');
    $m['lastEmailedTo'] = $recipients;
    writePackage($m);
    respond(['ok' => true, 'sent' => $sent]);
}

// --- Client routes (token, no login) ---

function getLivePackage($token) {
    $m = findPackageByToken($token);
    if (!$m) respondError('Download not found', 404);
    if (!empty($m['expiresAt']) && strtotime($m['expiresAt']) < time()) respondError('This download link has expired', 410);
    return $m;
}

if (($method === 'GET' || $method === 'HEAD') && matchRoute('/api/packages/{token}', $uri, $params)) {
    respond(packagePayload(getLivePackage($params['token'])));
}

// Serve a file that already exists on disk, and exit.
//
// Anything PHP echoes is a "dynamic response" and is subject to LiteSpeed's
// Max Dynamic Response Body Size (1 GiB by default), which truncates the stream
// mid-download. Files on disk should therefore be served by the web server, not
// pushed through PHP.
//
// There are two handoff headers and they are NOT interchangeable:
//
//   X-LiteSpeed-Location  — an internal redirect to a URI under the docroot.
//     Delivers the bytes and adds Accept-Ranges, but MEASURED ON A LIVE HOST
//     (2026-08-15) LiteSpeed rebuilds the response headers from the static file:
//     Content-Type survives, Content-Disposition and custom X- headers do not.
//     Without Content-Disposition a download opens inline under the stored
//     filename, so this is not usable for download routes as it stands.
//
//   X-LiteSpeed-Send-File — takes an absolute filesystem path. Same host, same
//     day: not honoured at all. The header is passed straight through to the
//     client, PHP exits with no body, and the download arrives as 0 bytes —
//     while publishing the server's absolute path to anyone who looks.
//
// So on that host neither is usable and streaming wins, which is why `off` is
// the default. Streaming measured ~102 MB/s there, essentially line speed, so
// there is no throughput being left on the table. Both stay available because
// other hosts configure this differently — run /api/admin/sendfile-test and
// check both the byte count AND that Content-Disposition survives before
// switching an install over.
//
// Both are opt-in, because a handoff the host ignores fails silently and
// totally. Default is to stream, which works everywhere. Verify with
// /api/admin/sendfile-test before switching an install over.
//
// SENDFILE=location  — X-LiteSpeed-Location (recommended where supported)
// SENDFILE=litespeed — X-LiteSpeed-Send-File (legacy, path based)
// SENDFILE=off       — stream through PHP (default)
function sendStaticFile($path, $downloadName, $contentType, $publicUri = null) {
    $size = filesize($path);
    $handoff = strtolower((string)env('SENDFILE', 'off'));
    $isLiteSpeed = stripos($_SERVER['SERVER_SOFTWARE'] ?? '', 'litespeed') !== false;

    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { ob_end_clean(); }

    header('Content-Type: ' . $contentType);
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $downloadName) . '"');

    if ($isLiteSpeed && $handoff === 'location' && $publicUri !== null) {
        header('X-LiteSpeed-Location: ' . $publicUri);
        exit;
    }
    if ($isLiteSpeed && $handoff === 'litespeed') {
        header('X-LiteSpeed-Send-File: ' . $path);
        exit;
    }

    header('Content-Length: ' . $size);
    header('Accept-Ranges: bytes');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;

    // fpassthru() copies in C rather than shuttling every chunk through a PHP
    // variable, with no per-chunk flush().
    $fp = fopen($path, 'rb');
    if ($fp === false) respondError('File not found', 404);
    fpassthru($fp);
    fclose($fp);
    exit;
}

// The plain static URL for an upload. .htaccess maps /uploads/ straight onto
// site-data/uploads/, so this is served by the web server with no PHP involved
// — the only route on this install measured at full line speed.
function staticUploadUrl($storedFilename) {
    return '/uploads/' . rawurlencode(basename($storedFilename));
}

// Prepare a response for streaming: no buffering, no compression, no time cap.
// Exits after the headers on a HEAD, which download managers send first to
// size up the transfer.
function beginBinaryResponse($filename, $contentType, $length) {
    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { ob_end_clean(); }
    header('Content-Type: ' . $contentType);
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $filename) . '"');
    if ($length !== null) header('Content-Length: ' . $length);
    // Proxies that buffer would defeat the point of streaming.
    header('X-Accel-Buffering: no');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;
}

// One original file, straight from uploads/. This is the "no zip at all" path.
if (($method === 'GET' || $method === 'HEAD') && matchRoute('/api/packages/{token}/file/{fileIndex}', $uri, $params)) {
    $m = getLivePackage($params['token']);
    $flat = [];
    foreach ($m['parts'] as $p) foreach ($p['entries'] as $e) $flat[] = $e;
    $entry = $flat[(int)$params['fileIndex']] ?? null;
    if (!$entry) respondError('File not found', 404);

    $path = UPLOADS_DIR . '/' . basename($entry['file']);
    if (!is_file($path)) respondError('File not found', 404);

    // Originals are static, so this has no size ceiling even on LiteSpeed.
    sendStaticFile($path, basename($entry['name']), 'application/octet-stream', staticUploadUrl($entry['file']));
}

// Stream a set of planned entries as one zip and exit. Shared by delivery
// packages and the client gallery's "Download all", so both produce byte-for-byte
// the same archive and both benefit from the CRC cache.
//
// Entries carry: name (path inside the zip), file (stored filename), size, mtime.
function streamZipOfEntries(array $planned, string $filename) {
    // Re-stat everything first. If the gallery changed since the plan was made,
    // the precomputed length would be a lie — so fall back to a chunked response
    // (no Content-Length) rather than truncating the client's file.
    $entries = [];
    $planIntact = true;
    foreach ($planned as $e) {
        // Allowlisted directories only — never an arbitrary path from a manifest.
        $base = ($e['dir'] ?? '') === 'captions' ? CAPTIONS_DIR : UPLOADS_DIR;
        $path = $base . '/' . basename($e['file']);
        if (!is_file($path)) { $planIntact = false; continue; }
        $size = (int)filesize($path);
        if ($size !== (int)$e['size']) { $planIntact = false; $e['size'] = $size; }
        $e['path'] = $path;
        // Cached from upload time. A file predating the cache is hashed here,
        // once, and every later download of it is fast.
        $e['crc'] = fileCrc32($path);
        if ($e['crc'] === null) { $planIntact = false; continue; }
        $entries[] = $e;
    }
    if (!$entries) respondError('Nothing to download', 404);

    beginBinaryResponse($filename, 'application/zip', $planIntact ? zipStreamedSize($entries) : null);

    // Abandon the stream if the client disconnects; there's nothing to clean up.
    ignore_user_abort(false);

    $offset = 0;
    $central = [];
    $out = fopen('php://output', 'wb');
    foreach ($entries as $e) {
        $header = zipStreamLocalHeader($e['name'], $e['mtime'], $e['crc'], $e['size']);
        echo $header;
        $entryOffset = $offset;
        $offset += strlen($header);

        $fp = fopen($e['path'], 'rb');
        if ($fp === false) continue;
        // The whole point of the CRC cache: the body goes disk -> socket in C,
        // with no PHP loop and nothing hashed on the way past.
        $written = stream_copy_to_stream($fp, $out, $e['size']);
        fclose($fp);
        $offset += $written;

        $central[] = ['name' => $e['name'], 'crc' => $e['crc'], 'size' => $written,
                      'offset' => $entryOffset, 'mtime' => $e['mtime']];
    }

    $cdOffset = $offset;
    $cd = '';
    foreach ($central as $e) $cd .= zipCentralEntry($e);
    echo $cd;
    echo zipEndOfCentralDirectory(count($central), strlen($cd), $cdOffset);
    fclose($out);
    flush();
    exit;
}

// One part, zipped as it goes out. Never touches disk.
if (($method === 'GET' || $method === 'HEAD') && matchRoute('/api/packages/{token}/part/{index}', $uri, $params)) {
    $m = getLivePackage($params['token']);
    $part = null;
    foreach ($m['parts'] as $p) { if ((int)$p['index'] === (int)$params['index']) { $part = $p; break; } }
    if (!$part) respondError('Part not found', 404);

    $label = packageFolderName($m['name']);

    // A single oversized file is handed over as-is rather than wrapped.
    if ($part['kind'] === 'file') {
        $entry = $part['entries'][0];
        $path = UPLOADS_DIR . '/' . basename($entry['file']);
        if (!is_file($path)) respondError('Part not found', 404);
        sendStaticFile($path, basename($entry['name']), 'application/octet-stream', staticUploadUrl($entry['file']));
    }

    $partCount = count($m['parts']);
    streamZipOfEntries($part['entries'], $partCount === 1
        ? "$label.zip"
        : sprintf('%s - part %d of %d.zip', $label, $part['index'], $partCount));
}


// ============================================================
// SETTINGS
// ============================================================

if ($method === 'GET' && $uri === '/api/settings/email') {
    requireAuth();
    $config = getEmailConfig();
    respond([
        'resendApiKey' => $config['resendApiKey'] ? '••••••••' : '',
        'host' => $config['host'],
        'port' => $config['port'],
        'secure' => $config['secure'],
        'user' => $config['user'],
        'pass' => $config['pass'] ? '••••••••' : '',
        'from' => $config['from'],
        'adminEmail' => $config['adminEmail'],
        'baseUrl' => $config['baseUrl'],
        'hasPassword' => !!$config['pass'],
        // Enough of a transport to actually send: lets the UI decide whether
        // to offer "email these links" without duplicating the rules.
        'configured' => (bool)($config['resendApiKey'] || $config['host'] || $config['from']),
    ]);
}

if ($method === 'PUT' && $uri === '/api/settings/email') {
    requireAuth();
    $input = getInput();
    $settings = readSettings();
    $smtp = $settings['smtp'] ?? [];

    if (isset($input['resendApiKey']) && $input['resendApiKey'] !== '••••••••') $smtp['resendApiKey'] = trim($input['resendApiKey']);
    if (isset($input['host'])) $smtp['host'] = trim($input['host']);
    if (isset($input['port'])) $smtp['port'] = (int)$input['port'] ?: 587;
    if (isset($input['secure'])) $smtp['secure'] = !!$input['secure'];
    if (isset($input['user'])) $smtp['user'] = trim($input['user']);
    if (isset($input['pass']) && $input['pass'] !== '••••••••') $smtp['pass'] = $input['pass'];
    if (isset($input['from'])) $smtp['from'] = trim($input['from']);
    if (isset($input['adminEmail'])) $smtp['adminEmail'] = trim($input['adminEmail']);
    if (isset($input['baseUrl'])) $smtp['baseUrl'] = trim($input['baseUrl']);

    $settings['smtp'] = $smtp;
    writeSettings($settings);
    respond(['ok' => true]);
}

if ($method === 'POST' && $uri === '/api/settings/email/test') {
    requireAuth();
    $input = getInput();
    $t = $input['transport'] ?? '';
    $transport = $t === 'smtp' ? 'smtp' : ($t === 'resend' ? 'resend' : 'auto');
    $config = getEmailConfig();
    if (!$config['adminEmail']) respondError('Notification email (to) is required', 400);

    $testText = "This is a test email from " . siteName() . ". Email notifications are working correctly.";
    $testHtml = emailShell([
        'title' => 'Email is working',
        'lead'  => 'This is a test message from your ' . escHtml(siteName()) . ' site.',
        'body'  => '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
            . '<tr><td style="background:#eaf7ee;border:1px solid #c6e6d1;border-radius:6px;padding:11px 14px;'
            . 'color:#1f7a3d;font-size:13.5px;font-weight:600;">'
            . 'Notifications are configured correctly.</td></tr></table>',
        'note'  => 'Client comment alerts and download links will be delivered this way.',
    ]);

    // SMTP: check the connection first, then send. Reported separately because
    // "server unreachable" and "message failed to send" are different problems.
    if ($transport === 'smtp') {
        if (!$config['host']) respondError('No SMTP host is set', 400);
        $probe = smtpProbe($config);
        if (!$probe['ok']) respondError($probe['detail'], 400);
        try {
            sendEmail($config['adminEmail'], emailSubject('Test email'), $testText, $testHtml);
        } catch (Exception $e) {
            respond([
                'ok' => false, 'connected' => true, 'auth' => $probe['auth'] ?? null,
                'detail' => $probe['detail'] . ' But sending the test message failed: ' . $e->getMessage(),
            ]);
        }
        respond([
            'ok' => true, 'connected' => true, 'auth' => $probe['auth'] ?? null,
            'detail' => $probe['detail'] . ' Test email sent.',
        ]);
    }

    if ($transport === 'resend' && !$config['resendApiKey']) respondError('No Resend API key is set', 400);
    if ($transport === 'auto' && !$config['resendApiKey'] && !$config['host']) respondError('No email configured', 400);

    try {
        sendEmail($config['adminEmail'], emailSubject('Test email'), $testText, $testHtml);
        respond(['ok' => true, 'message' => 'Test email sent successfully']);
    } catch (Exception $e) {
        respondError($e->getMessage(), 400);
    }
}

// ---- Updater ----------------------------------------------------------------
// Two deploy modes:
//   git     — this install is a clone; fetch + hard-reset to origin/$branch.
//   release — installed from a zip (no .git, or no shell access); check GitHub
//             Releases on the public repo and overlay the latest zipball.
// Release mode needs no git binary, no shell_exec, and no credentials, so a
// distributed copy updates itself without any secret. The repo must be public.

function githubRepo() {
    $repo = env('GIT_REPO', GITHUB_REPO_DEFAULT);
    return preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $repo) ? $repo : GITHUB_REPO_DEFAULT;
}

function shellExecAllowed() {
    if (!function_exists('shell_exec')) return false;
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    return !in_array('shell_exec', $disabled, true);
}

// DEPLOY_MODE=git|release in .env forces a mode (mainly for testing).
function deployMode() {
    $forced = env('DEPLOY_MODE');
    if ($forced === 'git' || $forced === 'release') return $forced;
    return (is_dir(__DIR__ . '/.git') && shellExecAllowed()) ? 'git' : 'release';
}

// GET a GitHub URL (API or zipball download). GitHub rejects requests without
// a User-Agent, and zipball URLs redirect to codeload.github.com.
function githubHttpGet($url, $toFile = null) {
    $headers = ['User-Agent: ShowAndDeliver-Updater', 'Accept: application/vnd.github+json'];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 300,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $out = null;
        if ($toFile) {
            $out = fopen($toFile, 'wb');
            if (!$out) return ['ok' => false, 'error' => 'Cannot write to temp file.'];
            curl_setopt($ch, CURLOPT_FILE, $out);
        } else {
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        }
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        unset($ch);
        if ($out) fclose($out);
        if ($body === false && !$toFile) return ['ok' => false, 'error' => "Request failed: $err"];
        if ($status < 200 || $status >= 300) return ['ok' => false, 'error' => "GitHub returned HTTP $status for $url"];
        return ['ok' => true, 'body' => $toFile ? '' : $body];
    }
    // Streams fallback (follows redirects by default).
    $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'timeout' => 300]]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) return ['ok' => false, 'error' => "Request failed (allow_url_fopen may be off): $url"];
    if ($toFile && file_put_contents($toFile, $body) === false) return ['ok' => false, 'error' => 'Cannot write to temp file.'];
    return ['ok' => true, 'body' => $toFile ? '' : $body];
}

// Latest release: tag, bare version, notes, zipball URL. Normally GitHub's
// Releases API; UPDATE_MANIFEST_URL in .env points this at a self-hosted
// manifest instead (same {tag_name, body, zipball_url} shape), for a track
// that isn't meant to go out through the public repo at all. Only ever reads
// from one or the other, never both, so an install is always on exactly one
// update channel.
function latestRelease() {
    $manifestUrl = env('UPDATE_MANIFEST_URL');
    if ($manifestUrl) {
        $res = githubHttpGet($manifestUrl);
        if (!$res['ok']) return ['error' => $res['error']];
        $rel = json_decode($res['body'], true);
        if (!is_array($rel) || empty($rel['tag_name']) || empty($rel['zipball_url'])) {
            return ['error' => 'Update manifest is missing tag_name or zipball_url.'];
        }
        return [
            'tag' => $rel['tag_name'],
            'version' => ltrim($rel['tag_name'], 'vV'),
            'notes' => trim($rel['body'] ?? ''),
            'zipUrl' => $rel['zipball_url'],
            'htmlUrl' => null,
        ];
    }
    $repo = githubRepo();
    $res = githubHttpGet("https://api.github.com/repos/$repo/releases/latest");
    if (!$res['ok']) return ['error' => $res['error']];
    $rel = json_decode($res['body'], true);
    if (!is_array($rel) || empty($rel['tag_name'])) {
        return ['error' => "No published releases found for $repo."];
    }
    return [
        'tag' => $rel['tag_name'],
        'version' => ltrim($rel['tag_name'], 'vV'),
        'notes' => trim($rel['body'] ?? ''),
        'zipUrl' => $rel['zipball_url'] ?? "https://api.github.com/repos/$repo/zipball/{$rel['tag_name']}",
        'htmlUrl' => $rel['html_url'] ?? "https://github.com/$repo/releases",
    ];
}

function localVersion() {
    $versionFile = __DIR__ . '/VERSION';
    return file_exists($versionFile) ? trim(file_get_contents($versionFile)) : 'unknown';
}

function releaseUpdateAvailable($local, $remote) {
    if ($local === 'unknown' || $remote === '') return $local !== $remote;
    // version_compare handles 1.4.0 vs 1.10.0 correctly where a string
    // comparison would not.
    return version_compare($remote, $local, '>');
}

function rrmdirTree($dir) {
    if (!is_dir($dir)) return;
    $it = new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS);
    foreach (new RecursiveIteratorIterator($it, RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
    }
    rmdir($dir);
}

// Download the latest release zipball and overlay it onto this install.
// Overlay only — files are added/replaced, never deleted, and runtime state
// (site-data/, .env, .git, logs) is never touched. Each file is written to a
// temp name and renamed into place so a half-written index.php can't be served.
function releaseDeploy() {
    if (!class_exists('ZipArchive')) {
        return ['ok' => false, 'error' => 'PHP zip extension is not available on this server.'];
    }
    $rel = latestRelease();
    if (isset($rel['error'])) return ['ok' => false, 'error' => $rel['error']];

    $tmpBase = SITE_DATA . '/tmp';
    if (!is_dir($tmpBase)) @mkdir($tmpBase, 0755, true);
    if (!is_dir($tmpBase) || !is_writable($tmpBase)) {
        return ['ok' => false, 'error' => 'site-data/tmp is not writable.'];
    }
    $zipPath = "$tmpBase/update-{$rel['version']}.zip";
    $extractDir = "$tmpBase/update-extract";
    rrmdirTree($extractDir);
    @unlink($zipPath);

    $dl = githubHttpGet($rel['zipUrl'], $zipPath);
    if (!$dl['ok']) return ['ok' => false, 'error' => 'Download failed: ' . $dl['error']];
    if (!is_file($zipPath) || filesize($zipPath) < 1000) {
        return ['ok' => false, 'error' => 'Downloaded archive is empty or truncated.'];
    }

    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        @unlink($zipPath);
        return ['ok' => false, 'error' => 'Could not open the downloaded archive.'];
    }
    @mkdir($extractDir, 0755, true);
    $ok = $zip->extractTo($extractDir);
    $zip->close();
    @unlink($zipPath);
    if (!$ok) {
        rrmdirTree($extractDir);
        return ['ok' => false, 'error' => 'Could not extract the downloaded archive.'];
    }

    // GitHub zipballs wrap everything in a single "owner-repo-sha/" directory.
    $roots = array_values(array_filter(glob("$extractDir/*") ?: [], 'is_dir'));
    if (count($roots) !== 1) {
        rrmdirTree($extractDir);
        return ['ok' => false, 'error' => 'Unexpected archive layout.'];
    }
    $srcRoot = $roots[0];

    $skip = ['site-data', '.env', '.git', 'deploy.log'];
    $copied = 0;
    $it = new RecursiveDirectoryIterator($srcRoot, RecursiveDirectoryIterator::SKIP_DOTS);
    foreach (new RecursiveIteratorIterator($it, RecursiveIteratorIterator::SELF_FIRST) as $f) {
        $rel_path = ltrim(substr($f->getPathname(), strlen($srcRoot)), '/');
        $top = explode('/', $rel_path)[0];
        if (in_array($top, $skip, true) || strpos($rel_path, '..') !== false) continue;
        $target = __DIR__ . '/' . $rel_path;
        if ($f->isDir()) {
            if (!is_dir($target)) @mkdir($target, 0755, true);
            continue;
        }
        $tmpTarget = $target . '.update-tmp';
        if (!@copy($f->getPathname(), $tmpTarget) || !@rename($tmpTarget, $target)) {
            @unlink($tmpTarget);
            rrmdirTree($extractDir);
            return ['ok' => false, 'error' => "Failed writing $rel_path — check file permissions.", 'copied' => $copied];
        }
        $copied++;
    }
    rrmdirTree($extractDir);

    return ['ok' => true, 'version' => $rel['version'], 'tag' => $rel['tag'], 'copied' => $copied];
}

// Update check — compare local vs remote version
// Report whether ffmpeg/ffprobe are available (drives the admin "Video Tools" UI).
if ($method === 'GET' && $uri === '/api/admin/video-tools/status') {
    requireAuth();
    respond(videoToolsStatus());
}

// Install a static ffmpeg build into the server's home directory.
if ($method === 'POST' && $uri === '/api/admin/video-tools/install') {
    requireAuth();
    @set_time_limit(300);
    $res = installStaticFfmpeg();
    respond($res, !empty($res['ok']) ? 200 : 500);
}

if ($method === 'GET' && $uri === '/api/settings/update') {
    requireAuth();
    $dir = __DIR__;
    $branch = preg_replace('/[^a-zA-Z0-9\/_-]/', '', env('DEPLOY_BRANCH', 'main'));
    $enabled = env('DEPLOY_ENABLED') !== 'false';
    $mode = deployMode();
    $localVersion = localVersion();

    if ($mode === 'release') {
        $remoteVersion = $localVersion;
        $changelog = '';
        $releaseUrl = '';
        $updateAvailable = false;
        $checkError = '';
        if ($enabled) {
            $rel = latestRelease();
            if (isset($rel['error'])) {
                $checkError = $rel['error'];
            } else {
                $remoteVersion = $rel['version'];
                $changelog = $rel['notes'];
                $releaseUrl = $rel['htmlUrl'];
                $updateAvailable = releaseUpdateAvailable($localVersion, $remoteVersion);
            }
        }
        respond([
            'enabled' => $enabled,
            'mode' => 'release',
            'branch' => $branch,
            'localVersion' => $localVersion,
            'localCommit' => '',
            'remoteVersion' => $remoteVersion,
            'remoteCommit' => '',
            'updateAvailable' => $updateAvailable,
            'commitLog' => '',
            'changelog' => $changelog,
            'releaseUrl' => $releaseUrl,
            'checkError' => $checkError,
        ]);
    }

    // Current local commit
    $localCommit = trim(shell_exec("cd $dir && git rev-parse --short HEAD 2>&1") ?? '');
    if (strpos($localCommit, 'fatal') !== false) $localCommit = '';

    $remoteVersion = $localVersion;
    $remoteCommit = $localCommit;
    $changelog = '';
    $updateAvailable = false;
    $commitLog = '';

    if ($enabled && $localCommit) {
        // Set remote URL with PAT if configured
        $pat = env('GIT_PAT');
        $username = env('GIT_USERNAME');
        $repo = env('GIT_REPO');
        if ($pat && $username && $repo) {
            shell_exec("cd $dir && git remote set-url origin https://$username:$pat@github.com/$repo.git 2>&1");
        }

        // Fetch latest from remote
        shell_exec("cd $dir && git fetch origin $branch 2>&1");

        // Remote commit
        $remoteCommit = trim(shell_exec("cd $dir && git rev-parse --short origin/$branch 2>&1") ?? '');
        if (strpos($remoteCommit, 'fatal') !== false) $remoteCommit = '';

        // Check if there are new commits
        if ($remoteCommit && $localCommit !== $remoteCommit) {
            $updateAvailable = true;

            // Get remote VERSION file
            $remoteVersionContent = trim(shell_exec("cd $dir && git show origin/$branch:VERSION 2>/dev/null") ?? '');
            if ($remoteVersionContent) $remoteVersion = $remoteVersionContent;

            // Get commit log between local and remote
            $commitLog = trim(shell_exec("cd $dir && git log --oneline HEAD..origin/$branch 2>&1") ?? '');

            // Get remote CHANGELOG.md
            $changelog = trim(shell_exec("cd $dir && git show origin/$branch:CHANGELOG.md 2>/dev/null") ?? '');
        }
    }

    respond([
        'enabled' => $enabled,
        'mode' => 'git',
        'branch' => $branch,
        'localVersion' => $localVersion,
        'localCommit' => $localCommit,
        'remoteVersion' => $remoteVersion,
        'remoteCommit' => $remoteCommit,
        'updateAvailable' => $updateAvailable,
        'commitLog' => $commitLog,
        'changelog' => $changelog,
    ]);
}

// Deploy
if ($method === 'GET' && $uri === '/api/settings/deploy') {
    requireAuth();
    respond([
        'enabled' => env('DEPLOY_ENABLED') !== 'false',
        'mode' => deployMode(),
        'branch' => env('DEPLOY_BRANCH', 'main'),
    ]);
}

if ($method === 'POST' && $uri === '/api/settings/deploy') {
    requireAuth();
    if (env('DEPLOY_ENABLED') === 'false') respondError('Deploy is disabled. Set DEPLOY_ENABLED=true in .env to enable.', 403);

    if (deployMode() === 'release') {
        @set_time_limit(300);
        $res = releaseDeploy();
        $logEntry = '[' . date('Y-m-d H:i:s') . "] Release deploy\n"
            . 'Result: ' . json_encode($res) . "\n"
            . str_repeat('-', 60) . "\n\n";
        @file_put_contents(__DIR__ . '/deploy.log', $logEntry, FILE_APPEND);
        if (empty($res['ok'])) respondError('Update failed. ' . ($res['error'] ?? ''), 500);
        respond(['ok' => true, 'message' => "Updated to version {$res['version']} ({$res['copied']} files)."]);
    }

    $branch = preg_replace('/[^a-zA-Z0-9\/_-]/', '', env('DEPLOY_BRANCH', 'main'));
    $pat = env('GIT_PAT');
    $username = env('GIT_USERNAME');
    $repo = env('GIT_REPO');

    $setRemote = '';
    if ($pat && $username && $repo) {
        $setRemote = "git remote set-url origin https://$username:$pat@github.com/$repo.git && ";
    }

    $logFile = __DIR__ . '/deploy.log';
    $timestamp = date('Y-m-d H:i:s');

    // Hard reset to origin/$branch rather than `git pull`. On shared hosting
    // the working tree occasionally ends up with local edits (cPanel file
    // manager, admin-level tweaks, line-ending changes), which would block a
    // normal merge. A hard reset makes the repo authoritative for every
    // tracked file. Runtime data lives under site-data/ which is gitignored,
    // so it's untouched.
    $gitCmd = "git fetch origin && git checkout $branch && git reset --hard origin/$branch";
    $cmd = "{$setRemote}$gitCmd 2>&1";
    $output = shell_exec($cmd);

    // Check for failure indicators in output
    $failed = ($output === null) || preg_match('/fatal:|error:|CONFLICT/i', $output);

    // Write log
    $logEntry = "[$timestamp] Branch: $branch\n"
        . "Command: $gitCmd\n"
        . "Output:\n$output\n"
        . "Status: " . ($failed ? 'FAILED' : 'SUCCESS') . "\n"
        . str_repeat('-', 60) . "\n\n";
    file_put_contents($logFile, $logEntry, FILE_APPEND);

    if ($failed) {
        respondError("Deploy failed. See deploy.log in parent directory.\n\n$output", 500);
    }

    respond(['ok' => true, 'message' => "Deploy successful (branch: $branch)."]);
}

// ============================================================
// API TOKEN MANAGEMENT
// ============================================================
//
// Token can live in one of two places:
//   (a) .env as API_TOKEN=...   — manual, edit-the-file management
//   (b) site-data/data/.api-token — generated + rotated by this UI
// If both are set, (a) wins (requireAuth reads env('API_TOKEN') first).
// This UI only manages (b) so we never touch the user's .env.

// Return "is a token currently active?" and where it's stored.
if ($method === 'GET' && $uri === '/api/settings/api-token') {
    requireAuth();
    // env() reflects the resolved value, which is .env first, then the
    // data-dir fallback populated at startup.
    $active = env('API_TOKEN', '') !== '';
    // Whether .env itself carries the token (determined by reading .env,
    // since $_ENV may have been overwritten by the data-file fallback —
    // but in our case the fallback only runs if .env is empty, so $_ENV
    // having a value + no data file means .env is the source).
    $hasDataToken = file_exists(API_TOKEN_PATH);
    $envHasToken = $active && !$hasDataToken;
    respond([
        'hasToken' => $active,
        'managedHere' => $hasDataToken || !$active,
        'envManaged' => $envHasToken,
    ]);
}

// Generate (or rotate) a token stored in site-data/data/.api-token.
// Returns the token in plaintext once — this is the only chance to see it.
if ($method === 'POST' && $uri === '/api/settings/api-token') {
    requireAuth();
    // If the user has API_TOKEN in .env, refuse rather than silently create
    // a data-file token that gets shadowed by .env.
    $envToken = '';
    $envFile = __DIR__ . '/.env';
    if (file_exists($envFile)) {
        foreach (file($envFile, FILE_IGNORE_NEW_LINES) as $line) {
            if (preg_match('/^\s*API_TOKEN\s*=\s*(.+)\s*$/', $line, $m)) {
                $val = trim($m[1]);
                if (strlen($val) >= 2 && in_array($val[0], ['"', "'"]) && $val[0] === substr($val, -1)) {
                    $val = substr($val, 1, -1);
                }
                if ($val !== '') { $envToken = $val; break; }
            }
        }
    }
    if ($envToken !== '') {
        respondError('An API token is already set in .env. Remove it from .env before managing tokens here.', 409);
    }

    $token = bin2hex(random_bytes(32));
    if (file_put_contents(API_TOKEN_PATH, $token) === false) {
        respondError('Could not write token to site-data/data/.api-token', 500);
    }
    @chmod(API_TOKEN_PATH, 0600);
    $_ENV['API_TOKEN'] = $token;
    respond(['token' => $token]);
}

// Revoke the data-file-managed token. Cannot revoke a token set in .env —
// the admin has to edit the file for that.
if ($method === 'DELETE' && $uri === '/api/settings/api-token') {
    requireAuth();
    if (!file_exists(API_TOKEN_PATH)) {
        // Either there's no token at all, or it's managed via .env.
        if (env('API_TOKEN', '') !== '') {
            respondError('The active token is set in .env and must be removed there.', 409);
        }
        respond(['ok' => true]);
    }
    if (!@unlink(API_TOKEN_PATH)) {
        respondError('Could not remove token file', 500);
    }
    unset($_ENV['API_TOKEN']);
    putenv('API_TOKEN');
    respond(['ok' => true]);
}

// ============================================================
// PORTFOLIO (folder-backed)
// ============================================================
//
// site-data/portfolio/<Category>/<Gallery>/ on disk IS the portfolio. A folder
// dropped in by FTP or File Manager appears with no import step, and the admin
// edits those same folders. What a file can't carry lives in dot-named sidecars,
// which the root .htaccess dotfile rule already refuses to serve:
//
//   .portfolio.json  {version, order:[category id]}
//   .category.json   {version, id, slug, title, description, visible, order:[gallery id]}
//   .gallery.json    {version, id, slug, title, description, layout, cover,
//                     visible, order:[filename | header id], headers, items}
//
// Sidecars travel with their folder, so renaming a folder by FTP keeps its URL
// (the slug is stored once, never re-derived) and all its metadata. Items are
// keyed by filename: a rename through the admin rewrites the key, and an FTP
// rename is matched up by size when exactly one file left and one arrived.
//
// Scanning is cheap and happens on every read (portfolioTree()). GD work never
// does: thumbnails and proxies are built by portfolioProcess() in short slices
// that the admin drives (or the CLI, for cron), and a photo stays out of public
// payloads until it has a thumbnail. Derivatives share thumbnails/ and proxies/
// with gallery items, keyed by item id, so the flat directories never collide.
//
// Videos: `<name>.poster.<jpg|png|webp>` beside a video is its poster, and
// `<name>.<lang>.vtt` a caption track. Without a poster file, the admin captures
// a frame in the browser (prod has no ffmpeg), as it already does for uploads.

// Allows media and captions only. Folders here are filled over FTP, so a .php
// or .html dropped in must never execute or be served as a page. The root
// .htaccess enforces the same allowlist; this covers hosts that ignore it.
function portfolioGuardDir() {
    if (!is_dir(PORTFOLIO_DIR)) return;
    $guard = PORTFOLIO_DIR . '/.htaccess';
    if (file_exists($guard)) return;
    @file_put_contents($guard, implode("\n", [
        '# Written by Show & Deliver. Media and captions only: nothing uploaded here',
        '# may run as code or be served as a page.',
        '<IfModule mod_authz_core.c>',
        '  Require all denied',
        '  <FilesMatch "(?i)\.(jpe?g|png|webp|gif|mp4|webm|mov|m4v|vtt)$">',
        '    Require all granted',
        '  </FilesMatch>',
        '  <FilesMatch "(?i)\.(php\d?|phtml|phar|cgi|pl|py|sh|s?html?|svg|js)(\.|$)">',
        '    Require all denied',
        '  </FilesMatch>',
        '</IfModule>',
        '',
    ]));
}

// Names the scanner never treats as content: dotfiles (sidecars, .DS_Store,
// macOS ._ AppleDouble files), Windows litter, and partial downloads/uploads.
function portfolioIgnoredName($name) {
    if ($name === '' || $name[0] === '.') return true;
    $lower = strtolower($name);
    if ($lower === 'thumbs.db' || $lower === 'desktop.ini' || $name === "Icon\r") return true;
    if ($lower === PORTFOLIO_PHOTOSHELTER_SIDECAR) return true;
    return (bool)preg_match('/\.(part|filepart|partial|tmp|crdownload)$/', $lower);
}

// Reads a gallery's PhotoShelter migration sidecar, if any: which images
// were hidden there, and what order they were shown in, keyed by file name.
// Harmless to leave the file in place after import — only a file's very
// first reconcile (when it becomes a "new" item) ever consults it, so later
// manual edits in this admin are never overwritten.
function portfolioPhotoshelterMeta($dir) {
    $data = jsonRead($dir . '/' . PORTFOLIO_PHOTOSHELTER_SIDECAR);
    $out = [];
    foreach ((is_array($data) ? ($data['images'] ?? []) : []) as $img) {
        $name = is_array($img) ? ($img['file_name'] ?? null) : null;
        if (!is_string($name) || $name === '') continue;
        // Keyed lowercase: a copy over FTP/rsync can normalize a file's
        // extension case (seen in practice — PhotoShelter's own JSON said
        // "_AA17098.JPG", the file arrived as "_AA17098.jpg"), and this
        // match has to survive that.
        $out[strtolower($name)] = [
            'visible' => !array_key_exists('visible', $img) || (bool)$img['visible'],
            'order' => isset($img['display_order']) && is_numeric($img['display_order']) ? (float)$img['display_order'] : null,
        ];
    }
    return $out;
}
function portfolioPhotoshelterMetaFor(array $psMeta, string $name) {
    return $psMeta[strtolower($name)] ?? null;
}
// Sorts file names by a migration sidecar's display_order (ascending). Names
// the sidecar doesn't cover sort after the ones it does, keeping their given
// relative order (usort is stable in PHP 8+).
function portfolioPhotoshelterSort(array $names, array $psMeta) {
    usort($names, function ($a, $b) use ($psMeta) {
        $oa = portfolioPhotoshelterMetaFor($psMeta, $a)['order'] ?? null;
        $ob = portfolioPhotoshelterMetaFor($psMeta, $b)['order'] ?? null;
        if ($oa === null && $ob === null) return 0;
        if ($oa === null) return 1;
        if ($ob === null) return -1;
        return $oa <=> $ob;
    });
    return $names;
}

// URL slug from a folder name. Accents fold to ASCII ("Été" → "ete"); a name
// with nothing foldable (e.g. "東京") comes back empty and the caller falls back
// to an id-based slug.
// Fills in whatever a gallery's options don't say, and drops anything invalid,
// so every reader downstream can assume a complete set.
function portfolioNormalizeOptions($o) {
    $o = is_array($o) ? $o : [];
    $out = [];
    foreach (PORTFOLIO_OPTION_VALUES as $key => $allowed) {
        $out[$key] = in_array($o[$key] ?? '', $allowed, true) ? $o[$key] : $allowed[1 % count($allowed)];
    }
    $out['gap'] = in_array($o['gap'] ?? '', ['tight', 'normal', 'wide'], true) ? $o['gap'] : 'normal';
    $out['crop'] = in_array($o['crop'] ?? '', ['fit', 'fill'], true) ? $o['crop'] : 'fit';
    $out['gridStyle'] = in_array($o['gridStyle'] ?? '', ['justified', 'masonry', 'grid'], true) ? $o['gridStyle'] : 'justified';
    $out['captions'] = in_array($o['captions'] ?? '', ['none', 'off', 'on'], true) ? $o['captions'] : 'off';
    $out['autoplay'] = !empty($o['autoplay']);
    $out['interval'] = min(30, max(2, (int)($o['interval'] ?? 5)));
    return $out;
}


function portfolioNormalizeSort($s, array $allowed) {
    $by = is_array($s) ? (string)($s['by'] ?? 'custom') : 'custom';
    if (!in_array($by, $allowed, true)) $by = 'custom';
    return ['by' => $by, 'dir' => (is_array($s) && ($s['dir'] ?? '') === 'desc') ? 'desc' : 'asc'];
}

// When a photo was taken, from its EXIF, as a unix time. 0 means the file
// does not say, and sorting falls back to the file's own date.
function portfolioItemCaptureTime($path) {
    if (!function_exists('exif_read_data') || !preg_match('/\.(jpe?g|tiff?)$/i', $path)) return 0;
    $e = @exif_read_data($path);
    if (!is_array($e)) return 0;
    foreach (['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'] as $k) {
        if (empty($e[$k])) continue;
        $d = DateTime::createFromFormat('Y:m:d H:i:s', trim((string)$e[$k]));
        if ($d) return $d->getTimestamp();
    }
    return 0;
}

// The order a gallery's keys are shown in: the saved order, or that order
// sorted. Section headers hold their place and pictures sort within a section.
function portfolioEffectiveOrder($gal) {
    $g = $gal['sidecar'];
    $order = array_map('strval', $g['order'] ?? []);
    $sort = portfolioNormalizeSort($g['sort'] ?? null, PORTFOLIO_ITEM_SORTS);
    if ($sort['by'] === 'custom') return $order;
    $headers = $g['headers'] ?? [];
    $value = function ($key) use ($gal, $sort) {
        $r = portfolioResolveKey($gal, $key);
        if (!$r || !in_array($r['kind'], ['item', 'ref'], true)) return null;
        $it = $r['item'];
        $mtime = (int)($it['mtime'] ?? 0);
        if ($sort['by'] === 'name') return strtolower((string)$r['file']);
        if ($sort['by'] === 'captured') return (int)($it['capturedAt'] ?? 0) ?: $mtime;
        return (int)strtotime((string)($it['addedAt'] ?? '')) ?: $mtime;
    };
    $sortSegment = function (array $seg) use ($value, $sort) {
        $rows = [];
        foreach ($seg as $i => $key) $rows[] = [$key, $value($key), $i];
        usort($rows, function ($a, $b) use ($sort) {
            // Files that can't be resolved sink to the end whatever the direction.
            if ($a[1] === null || $b[1] === null) return ($a[1] === null) <=> ($b[1] === null) ?: $a[2] <=> $b[2];
            $c = $sort['by'] === 'name' ? strnatcmp($a[1], $b[1]) : $a[1] <=> $b[1];
            if ($sort['dir'] === 'desc') $c = -$c;
            return $c ?: $a[2] <=> $b[2];
        });
        return array_column($rows, 0);
    };
    $out = [];
    $seg = [];
    foreach ($order as $key) {
        if (isset($headers[$key])) {
            $out = array_merge($out, $sortSegment($seg), [$key]);
            $seg = [];
        } else {
            $seg[] = $key;
        }
    }
    return array_merge($out, $sortSegment($seg));
}

// Child galleries of a collection (or galleries of a category), sorted by the
// collection's setting. Name, newest picture taken, or when it was created.
function portfolioNodeShootTime($node) {
    $latest = 0;
    foreach ($node['sidecar']['items'] ?? [] as $it) {
        $latest = max($latest, (int)($it['capturedAt'] ?? 0) ?: (int)($it['mtime'] ?? 0));
    }
    foreach ($node['children'] ?? [] as $ch) $latest = max($latest, portfolioNodeShootTime($ch));
    return $latest;
}

function portfolioSortNodes(array $nodes, $sortSetting) {
    $sort = portfolioNormalizeSort($sortSetting, PORTFOLIO_NODE_SORTS);
    if ($sort['by'] === 'custom' || count($nodes) < 2) return $nodes;
    $rows = [];
    foreach ($nodes as $i => $n) {
        if ($sort['by'] === 'name') $v = strtolower(portfolioTitle($n));
        elseif ($sort['by'] === 'created') $v = (int)strtotime((string)($n['sidecar']['createdAt'] ?? ''));
        else $v = portfolioNodeShootTime($n);
        $rows[] = [$n, $v, $i];
    }
    usort($rows, function ($a, $b) use ($sort) {
        $c = $sort['by'] === 'name' ? strnatcmp($a[1], $b[1]) : $a[1] <=> $b[1];
        if ($sort['dir'] === 'desc') $c = -$c;
        return $c ?: $a[2] <=> $b[2];
    });
    return array_column($rows, 0);
}

function portfolioSlugify($s) {
    if (class_exists('Normalizer')) $s = Normalizer::normalize($s, Normalizer::FORM_D);
    $s = preg_replace('/\p{Mn}+/u', '', $s);
    if (function_exists('iconv')) {
        $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        if ($t !== false) $s = $t;
    }
    $s = strtolower($s);
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return substr(trim($s, '-'), 0, 60);
}

function portfolioUniqueSlug($base, array $taken, $fallback) {
    $slug = $base !== '' ? $base : $fallback;
    $try = $slug;
    for ($n = 2; in_array($try, $taken, true); $n++) $try = $slug . '-' . $n;
    return $try;
}

// jsonUpdate(), except the file is only rewritten when the mutator changed
// something — reconciliation runs on every public read and must not turn each
// page view into a write. A sidecar that fails to parse is set aside rather
// than silently replaced, since it may hold hours of captions and ordering.
function portfolioSidecarUpdate($path, callable $mutator) {
    $fp = @fopen($path, 'c+');
    if (!$fp) {
        // Unwritable folder (e.g. uploaded by FTP as another user): work from
        // what's there without persisting.
        $d = jsonRead($path);
        return $mutator(is_array($d) ? $d : []);
    }
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $data = [];
    if ($raw !== '' && $raw !== false) {
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            @file_put_contents($path . '.corrupt-' . time(), $raw);
            $data = [];
        }
    }
    $after = $mutator($data);
    if ($after !== $data) {
        rewind($fp);
        ftruncate($fp, 0);
        fwrite($fp, json_encode($after, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $after;
}

// Subfolders of $dir that the scanner treats as categories or galleries, plus
// warnings for loose files that sit at a level where only folders belong.
function portfolioListDirs($dir, $where) {
    $dirs = [];
    $warnings = [];
    foreach (@scandir($dir) ?: [] as $n) {
        if (portfolioIgnoredName($n)) continue;
        if (is_dir("$dir/$n")) $dirs[] = $n;
        else $warnings[] = "\"$n\" is loose in $where and is ignored — files belong inside a gallery folder.";
    }
    usort($dirs, 'strnatcasecmp');
    return [$dirs, $warnings];
}

// Classifies one gallery folder's entries. $trusted names skip the settle wait:
// an admin upload has fully arrived even though its mtime is seconds old.
function portfolioScanGallery($dir, array $trusted = []) {
    $files = [];
    $videoBases = [];
    $children = [];
    $warnings = [];
    foreach (@scandir($dir) ?: [] as $n) {
        if (portfolioIgnoredName($n)) continue;
        if (is_dir("$dir/$n")) {
            // A gallery folder may hold child galleries: the node becomes a
            // collection. Nesting is recursive — see portfolioReconcileGallery().
            $children[] = $n;
            continue;
        }
        $files[] = $n;
        if (in_array(strtolower(pathinfo($n, PATHINFO_EXTENSION)), VIDEO_EXTS, true)) {
            $videoBases[strtolower(pathinfo($n, PATHINFO_FILENAME))] = $n;
        }
    }
    usort($children, 'strnatcasecmp');
    $media = [];
    $posters = [];
    $captions = [];
    $pending = [];
    $now = time();
    foreach ($files as $n) {
        $ext = strtolower(pathinfo($n, PATHINFO_EXTENSION));
        if (preg_match('/^(.+)\.poster\.(jpe?g|png|webp)$/i', $n, $m) && isset($videoBases[strtolower($m[1])])) {
            $posters[$videoBases[strtolower($m[1])]] = $n;
            continue;
        }
        if ($ext === CAPTION_EXT) {
            $lang = '';
            if (preg_match('/^(.+)\.([a-z]{2,3}(?:-[a-z]{2,4})?)\.vtt$/i', $n, $m) && isset($videoBases[strtolower($m[1])])) {
                $lang = normalizeCaptionLang($m[2]);
            }
            if ($lang !== '') $captions[$videoBases[strtolower($m[1])]][$lang] = $n;
            else $warnings[] = "Caption \"$n\" doesn't match a video — name it <video name>.<language>.vtt, e.g. clip.en.vtt.";
            continue;
        }
        if (!in_array($ext, MEDIA_EXTS, true)) {
            $warnings[] = "\"$n\" isn't a supported photo or video and is ignored.";
            continue;
        }
        $mtime = (int)@filemtime("$dir/$n");
        $settling = $now - $mtime < PORTFOLIO_SETTLE_SECONDS && !in_array($n, $trusted, true);
        if ($settling) $pending[] = $n;
        $media[$n] = [
            'size' => (int)@filesize("$dir/$n"),
            'mtime' => $mtime,
            'type' => in_array($ext, VIDEO_EXTS, true) ? 'video' : 'photo',
            'settling' => $settling,
        ];
    }
    uksort($media, 'strnatcasecmp');
    foreach ($captions as &$c) ksort($c);
    unset($c);
    return ['media' => $media, 'posters' => $posters, 'captions' => $captions, 'children' => $children, 'warnings' => $warnings, 'pending' => $pending];
}

// Merges a gallery folder's contents into its sidecar and returns the result.
// New files join the end of the order; vanished ones drop out, along with their
// thumbnail and proxy. A file still arriving (see PORTFOLIO_SETTLE_SECONDS) is
// not added yet, and a known file being replaced keeps its entry untouched.
function portfolioReconcileGallery($dir, $folder, array $takenSlugs, array $trusted = [], array $slugPrefix = []) {
    $scan = portfolioScanGallery($dir, $trusted);
    $removedIds = [];
    $psMeta = portfolioPhotoshelterMeta($dir);
    $g = portfolioSidecarUpdate("$dir/.gallery.json", function ($g) use ($scan, $folder, $takenSlugs, &$removedIds, $dir, $psMeta) {
        $g['version'] = 1;
        if (empty($g['id'])) $g['id'] = generateId('pg_');
        if (empty($g['slug']) || in_array($g['slug'], $takenSlugs, true)) {
            $g['slug'] = portfolioUniqueSlug(portfolioSlugify($folder), $takenSlugs, 'g-' . substr($g['id'], 3, 6));
        }
        $g += [
            'title' => null, 'description' => '', 'layout' => 'justified', 'cover' => null,
            'visible' => true, 'access' => null, 'createdAt' => date('c'), 'order' => [], 'headers' => [], 'items' => [],
            'options' => [],
            // Picks borrowed from other galleries: one file on disk, shown in
            // as many galleries as you like. See portfolioResolveKey().
            'refs' => [],
        ];
        if (!in_array($g['layout'], PORTFOLIO_LAYOUTS, true)) $g['layout'] = 'justified';
        // Galleries made before access levels existed carry only `visible`.
        if (!in_array($g['access'], PORTFOLIO_ACCESS, true)) {
            $g['access'] = ($g['visible'] ?? true) === false ? 'hidden' : 'public';
        }
        $g['visible'] = $g['access'] !== 'hidden';
        $g['options'] = portfolioNormalizeOptions($g['options']);
        $items = is_array($g['items']) ? $g['items'] : [];
        $headers = is_array($g['headers']) ? $g['headers'] : [];
        $refs = is_array($g['refs']) ? $g['refs'] : [];
        $order = is_array($g['order']) ? $g['order'] : [];

        $present = $scan['media'];
        $missing = array_diff_key($items, $present);
        $new = array_filter(array_diff_key($present, $items), fn($f) => !$f['settling']);

        // Renamed over FTP: one file gone, one arrived, same size and type.
        if (count($missing) === 1 && count($new) === 1) {
            $old = array_key_first($missing);
            $arrived = array_key_first($new);
            if ((int)($items[$old]['size'] ?? -1) === $new[$arrived]['size']
                && strcasecmp(pathinfo($old, PATHINFO_EXTENSION), pathinfo($arrived, PATHINFO_EXTENSION)) === 0) {
                $items[$arrived] = $items[$old];
                unset($items[$old]);
                $order = array_map(fn($o) => $o === $old ? $arrived : $o, $order);
                if ($g['cover'] === $old) $g['cover'] = $arrived;
                $missing = [];
                $new = [];
            }
        }
        foreach ($missing as $name => $it) {
            if (!empty($it['id'])) $removedIds[] = $it['id'];
            unset($items[$name]);
        }
        foreach ($new as $name => $f) {
            $items[$name] = [
                'id' => generateId($f['type'] === 'video' ? 'v_' : 'p_'),
                'title' => '', 'description' => '',
                'visible' => portfolioPhotoshelterMetaFor($psMeta, $name)['visible'] ?? true,
                'width' => 0, 'height' => 0, 'thumb' => 0, 'proxy' => 0,
                'addedAt' => date('c'),
            ];
        }
        foreach ($items as $name => &$it) {
            $f = $present[$name];
            $it['type'] = $f['type'];
            if (!$f['settling']) {
                $it['size'] = $f['size'];
                $it['mtime'] = $f['mtime'];
                // Read once: 0 records "no EXIF date", so it is not re-read.
                if (!array_key_exists('capturedAt', $it) && $f['type'] === 'photo') {
                    $it['capturedAt'] = portfolioItemCaptureTime($dir . '/' . $name);
                }
                // Every rescan, not just once: an empty caption box might mean
                // "never looked at this file" just as easily as "deliberately
                // cleared it", and there's no way to tell those apart. Filling
                // it back in from the file's own XMP whenever it's blank is the
                // simpler, more predictable rule of the two.
                if ($f['type'] === 'photo' && trim((string)($it['description'] ?? '')) === '') {
                    $xmp = portfolioItemXmp($dir . '/' . $name);
                    if (!empty($xmp['Description'])) $it['description'] = $xmp['Description'];
                }
            }
            if ($f['type'] === 'video') {
                $it['posterFile'] = $scan['posters'][$name] ?? null;
                $it['captions'] = $scan['captions'][$name] ?? [];
            }
        }
        unset($it);

        $kept = [];
        foreach ($order as $o) {
            if (is_string($o) && !isset($kept[$o]) && (isset($items[$o]) || isset($headers[$o]) || isset($refs[$o]))) $kept[$o] = true;
        }
        // Files not already in the saved order are new to this gallery. A
        // PhotoShelter migration sidecar (see portfolioPhotoshelterMeta()) can
        // say what order they were shown in there; honor it so a migrated
        // gallery arrives in its original sequence instead of alphabetical.
        // Items the sidecar doesn't mention keep their natural scan order and
        // sort after the ones it does.
        $newNames = portfolioPhotoshelterSort(array_values(array_filter(array_keys($items), fn($name) => !isset($kept[$name]))), $psMeta);
        foreach ($newNames as $name) { $kept[$name] = true; }
        $g['order'] = array_map('strval', array_keys($kept));
        $g['headers'] = array_intersect_key($headers, $kept);
        $g['refs'] = array_intersect_key($refs, $kept);
        $g['items'] = $items;
        if ($g['cover'] !== null && !isset($items[$g['cover']]) && !isset($refs[$g['cover']])) $g['cover'] = null;
        return $g;
    });
    foreach ($removedIds as $id) {
        @unlink(THUMBS_DIR . "/$id.jpg");
        @unlink(PROXY_DIR . "/{$id}_proxy.jpg");
    }
    // Strict kinds: a gallery holds media, a collection holds galleries. A
    // folder with both is a gallery — the nested folders are flagged, not shown,
    // so a gallery can never contain another gallery. A folder with subfolders
    // and no media is a collection, and its children are reconciled here.
    $hasItems = !empty($g['items']);
    $warnings = $scan['warnings'];
    if ($hasItems && !empty($scan['children'])) {
        foreach ($scan['children'] as $n) {
            $warnings[] = "A gallery can't hold other galleries — \"$n\" is ignored. Move it out, or move this folder's media into a gallery first.";
        }
        $children = [];
    } else {
        $children = portfolioReconcileChildren($dir, $scan['children'], $g['id'], array_merge($slugPrefix, [$g['slug']]));
    }
    $g['kind'] = $hasItems ? 'gallery' : (!empty($scan['children']) ? 'collection' : 'gallery');
    return ['sidecar' => $g, 'children' => $children, 'warnings' => $warnings, 'pending' => $scan['pending']];
}

// Reconciles a node's child galleries in their saved order (new ones after, by
// name), recursing through portfolioReconcileGallery(). Returns the child node
// arrays and records their order in the parent sidecar, exactly as a category
// orders its galleries.
function portfolioReconcileChildren($dir, array $names, $parentId, array $parentPath) {
    $existing = jsonRead("$dir/.gallery.json");
    $saved = is_array($existing['childOrder'] ?? null) ? $existing['childOrder'] : [];
    $byId = [];
    $rest = [];
    foreach ($names as $n) {
        $id = jsonRead("$dir/$n/.gallery.json")['id'] ?? null;
        if ($id && !isset($byId[$id])) $byId[$id] = $n;
        else $rest[] = $n;
    }
    $sequence = [];
    foreach ($saved as $id) {
        if (isset($byId[$id])) { $sequence[] = $byId[$id]; unset($byId[$id]); }
    }
    usort($rest, 'strnatcasecmp');
    $sequence = array_merge($sequence, array_values($byId), $rest);

    $children = [];
    $slugs = [];
    foreach ($sequence as $n) {
        $r = portfolioReconcileGallery("$dir/$n", $n, $slugs, [], $parentPath);
        $s = $r['sidecar'];
        $slugs[] = $s['slug'];
        $children[] = [
            'id' => $s['id'],
            'slug' => $s['slug'],
            'folder' => $n,
            'rel' => ltrim(substr("$dir/$n", strlen(PORTFOLIO_DIR)), '/'),
            'dir' => "$dir/$n",
            'parent' => $parentId,
            'slugPath' => array_merge($parentPath, [$s['slug']]),
            'children' => $r['children'],
            'sidecar' => $s,
            'warnings' => $r['warnings'],
            'pending' => $r['pending'],
        ];
    }
    portfolioSidecarUpdate("$dir/.gallery.json", function ($s) use ($children) {
        $s['childOrder'] = array_column($children, 'id');
        return $s;
    });
    return portfolioSortNodes($children, $existing['sort'] ?? null);
}

// Walks the category folder's galleries in their saved order (new ones after,
// by name), reconciling each so gallery slugs stay unique within the category.
function portfolioReconcileCategory($dir, $folder, array $takenSlugs) {
    $scan = portfolioScanGallery($dir);
    // A top-level folder with media and no subfolders is a gallery, not a
    // collection. This is what lets the Image Library mix collections and
    // galleries at its top level. An existing sidecar settles the question: a
    // `.category.json` means a collection, a `.gallery.json` means a gallery.
    $hasCatSidecar = is_file("$dir/.category.json");
    $hasGalSidecar = is_file("$dir/.gallery.json");
    $isGallery = !$hasCatSidecar && ($hasGalSidecar || (empty($scan['children']) && !empty($scan['media'])));
    if ($isGallery) {
        $r = portfolioReconcileGallery($dir, $folder, $takenSlugs);
        $r['sidecar']['kind'] = 'gallery';
        return [
            'kind' => 'gallery',
            'sidecar' => $r['sidecar'],
            'galleries' => [],
            'items' => $r['sidecar']['items'],
            'children' => $r['children'],
            'warnings' => array_merge($scan['warnings'], $r['warnings']),
            'pending' => $r['pending'],
        ];
    }

    $names = $scan['children'];
    $warnings = $scan['warnings'];
    if (!empty($scan['media'])) {
        $warnings[] = "A collection holds galleries, not media — move the loose files in \"$folder\" into a gallery.";
    }
    $existing = jsonRead("$dir/.category.json");
    $savedOrder = is_array($existing['order'] ?? null) ? $existing['order'] : [];
    $byId = [];
    $rest = [];
    foreach ($names as $n) {
        $id = jsonRead("$dir/$n/.gallery.json")['id'] ?? null;
        if ($id && !isset($byId[$id])) $byId[$id] = $n;
        else $rest[] = $n;
    }
    $sequence = [];
    foreach ($savedOrder as $id) {
        if (isset($byId[$id])) { $sequence[] = $byId[$id]; unset($byId[$id]); }
    }
    $rest = array_merge(array_values($byId), $rest);
    usort($rest, 'strnatcasecmp');
    $sequence = array_merge($sequence, $rest);

    $galleries = [];
    $slugs = [];
    foreach ($sequence as $n) {
        $r = portfolioReconcileGallery("$dir/$n", $n, $slugs);
        $s = $r['sidecar'];
        $slugs[] = $s['slug'];
        $galleries[] = [
            'id' => $s['id'],
            'slug' => $s['slug'],
            'folder' => $n,
            'rel' => "$folder/$n",
            'dir' => "$dir/$n",
            'parent' => null,
            'slugPath' => [$s['slug']],
            'children' => $r['children'],
            'sidecar' => $s,
            'warnings' => $r['warnings'],
            'pending' => $r['pending'],
        ];
    }
    $ids = array_column($galleries, 'id');
    $c = portfolioSidecarUpdate("$dir/.category.json", function ($c) use ($folder, $takenSlugs, $ids) {
        $c['version'] = 1;
        if (empty($c['id'])) $c['id'] = generateId('pc_');
        if (empty($c['slug']) || in_array($c['slug'], $takenSlugs, true)) {
            $c['slug'] = portfolioUniqueSlug(portfolioSlugify($folder), $takenSlugs, 'c-' . substr($c['id'], 3, 6));
        }
        $c += ['title' => null, 'description' => '', 'visible' => true, 'createdAt' => date('c')];
        $c['kind'] = 'collection';
        $c['order'] = $ids;
        return $c;
    });
    // The saved order above stays the custom one; a sort only changes what is shown.
    $galleries = portfolioSortNodes($galleries, $c['sort'] ?? null);
    return ['kind' => 'collection', 'sidecar' => $c, 'galleries' => $galleries, 'items' => [], 'children' => [], 'warnings' => $warnings];
}

// The whole portfolio, reconciled against disk. Memoised per request; pass
// $refresh after a write so later reads in the same request see it.
function portfolioTree($refresh = false) {
    static $tree = null;
    if ($tree !== null && !$refresh) return $tree;
    [$names, $warnings] = portfolioListDirs(PORTFOLIO_DIR, 'the portfolio folder');
    $reserved = [PORTFOLIO_HOME_FOLDER, PORTFOLIO_PAGES_FOLDER];
    $names = array_values(array_filter($names, fn($n) => !in_array($n, $reserved, true)));
    $root = jsonRead(PORTFOLIO_DIR . '/.portfolio.json');
    $savedOrder = is_array($root['order'] ?? null) ? $root['order'] : [];
    $byId = [];
    $rest = [];
    foreach ($names as $n) {
        $id = jsonRead(PORTFOLIO_DIR . "/$n/.category.json")['id'] ?? null;
        if ($id && !isset($byId[$id])) $byId[$id] = $n;
        else $rest[] = $n;
    }
    $sequence = [];
    foreach ($savedOrder as $id) {
        if (isset($byId[$id])) { $sequence[] = $byId[$id]; unset($byId[$id]); }
    }
    $rest = array_merge(array_values($byId), $rest);
    usort($rest, 'strnatcasecmp');
    $sequence = array_merge($sequence, $rest);

    $categories = [];
    $slugs = [];
    foreach ($sequence as $n) {
        $r = portfolioReconcileCategory(PORTFOLIO_DIR . "/$n", $n, $slugs);
        $slugs[] = $r['sidecar']['slug'];
        foreach ($r['galleries'] as &$gal) {
            $gal['category'] = $r['sidecar']['id'];
        }
        unset($gal);
        $entry = [
            'kind' => $r['kind'],
            'id' => $r['sidecar']['id'],
            'slug' => $r['sidecar']['slug'],
            'folder' => $n,
            'rel' => $n,
            'dir' => PORTFOLIO_DIR . "/$n",
            'sidecar' => $r['sidecar'],
            'galleries' => $r['galleries'],
            'warnings' => $r['warnings'],
        ];
        if ($r['kind'] === 'gallery') {
            // A top-level gallery is its own node: no category prefix, so its
            // slug path is empty and its URL is /portfolio/<slug>.
            $entry['items'] = $r['items'];
            $entry['children'] = $r['children'];
            $entry['slugPath'] = [];
            $entry['isTopGallery'] = true;
            $entry['parent'] = null;
            $entry['pending'] = $r['pending'] ?? [];
        }
        $categories[] = $entry;
    }
    $ids = array_column($categories, 'id');
    portfolioSidecarUpdate(PORTFOLIO_DIR . '/.portfolio.json', function ($p) use ($ids) {
        $p['version'] = 1;
        $p['order'] = $ids;
        return $p;
    });
    $tree = ['categories' => $categories, 'home' => portfolioScanHome(), 'warnings' => $warnings];
    return $tree;
}

// A new gallery's starting layout: whatever the home page is set to, so the
// site reads as one consistent design unless a gallery's own Layout picker
// overrides it. Falls back to justified before the home gallery exists.
function portfolioDefaultLayout() {
    $home = portfolioScanHome();
    $layout = $home['sidecar']['layout'] ?? null;
    return in_array($layout, PORTFOLIO_LAYOUTS, true) ? $layout : 'justified';
}

// The home gallery node, or null when the folder hasn't been created yet.
function portfolioScanHome() {
    $dir = PORTFOLIO_DIR . '/' . PORTFOLIO_HOME_FOLDER;
    if (!is_dir($dir)) return null;
    $r = portfolioReconcileGallery($dir, 'Home page', []);
    return [
        'id' => $r['sidecar']['id'],
        'slug' => 'home',
        'folder' => PORTFOLIO_HOME_FOLDER,
        'rel' => PORTFOLIO_HOME_FOLDER,
        'dir' => $dir,
        'home' => true,
        'sidecar' => $r['sidecar'],
        'warnings' => $r['warnings'],
        'pending' => $r['pending'],
    ];
}

// Stands in for a category where the payload builders expect one. The home
// gallery has no category, so this carries the title its editor shows.
function portfolioHomeCategory() {
    return [
        'id' => null, 'slug' => null, 'folder' => 'Home page', 'rel' => '',
        'sidecar' => ['title' => 'Home page', 'description' => '', 'visible' => true],
        'galleries' => [], 'warnings' => [],
    ];
}

function portfolioFindGallery($id) {
    $home = portfolioTree()['home'];
    if ($home && $home['id'] === $id) return [portfolioHomeCategory(), $home];
    foreach (portfolioTree()['categories'] as $cat) {
        if (!empty($cat['isTopGallery'])) {
            if ($cat['id'] === $id) return [$cat, $cat];
            continue;
        }
        $hit = portfolioFindNodeById($cat['galleries'], $id);
        if ($hit) return [$cat, $hit];
    }
    return null;
}

// Depth-first search for a node id, through collections of any depth.
function portfolioFindNodeById(array $nodes, $id) {
    foreach ($nodes as $n) {
        if ($n['id'] === $id) return $n;
        $hit = portfolioFindNodeById($n['children'] ?? [], $id);
        if ($hit) return $hit;
    }
    return null;
}

// Every gallery node with its category, nested collections included. A
// top-level gallery is its own node (its "category" is itself).
function portfolioAllNodes() {
    $out = [];
    $walk = function ($cat, $nodes) use (&$walk, &$out) {
        foreach ($nodes as $n) {
            $out[] = [$cat, $n];
            $walk($cat, $n['children'] ?? []);
        }
    };
    foreach (portfolioTree()['categories'] as $cat) {
        if (!empty($cat['isTopGallery'])) { $out[] = [$cat, $cat]; continue; }
        $walk($cat, $cat['galleries']);
    }
    return $out;
}

function portfolioFindCategoryBySlug($slug) {
    foreach (portfolioTree()['categories'] as $cat) {
        if ($cat['slug'] === $slug) return $cat;
    }
    return null;
}

// Resolves /portfolio/{cat}/{slug}/{slug}... to a node at any depth.
function portfolioFindByPath($catSlug, array $segments) {
    $cat = portfolioFindCategoryBySlug($catSlug);
    if (!$cat) return null;
    // A top-level gallery has no children: its URL is /portfolio/<slug>.
    if (!empty($cat['isTopGallery'])) return [$cat, $cat];
    $nodes = $cat['galleries'];
    $node = null;
    foreach ($segments as $seg) {
        $next = null;
        foreach ($nodes as $n) {
            if ($n['slug'] === $seg) { $next = $n; break; }
        }
        if (!$next) return null;
        $node = $next;
        $nodes = $next['children'] ?? [];
    }
    return $node ? [$cat, $node] : null;
}

function portfolioFindBySlug($catSlug, $galSlug) {
    return portfolioFindByPath($catSlug, [$galSlug]);
}

// --- Derivatives ---

// What an item still needs. 'work' is server-side (GD resize, or reading a
// video's duration and size from its header); 'capture' means a video has no
// poster file and the admin must grab a frame in the browser.
function portfolioItemTasks($dir, $name, array $it) {
    $t = ['work' => false, 'capture' => false];
    $mtime = (int)($it['mtime'] ?? 0);
    // Reconcile only records a file's mtime once it has settled, so a mismatch
    // means it's still arriving (or changed since this request's scan).
    if ($mtime === 0 || (int)@filemtime("$dir/$name") !== $mtime) return $t;
    if ((int)($it['error'] ?? 0) === $mtime) return $t;
    $id = $it['id'];
    $thumbOk = !empty($it['thumb']) && is_file(THUMBS_DIR . "/$id.jpg");
    if ($it['type'] === 'photo') {
        $t['work'] = !$thumbOk || !is_file(PROXY_DIR . "/{$id}_proxy.jpg")
            || (int)($it['thumb'] ?? 0) !== $mtime || (int)($it['proxy'] ?? 0) !== $mtime;
        return $t;
    }
    if ((int)($it['metaOf'] ?? 0) !== $mtime) $t['work'] = true;
    $source = $it['thumbSource'] ?? '';
    if (!empty($it['posterFile'])) {
        $pm = (int)@filemtime("$dir/{$it['posterFile']}");
        if (!$thumbOk || $source !== 'file' || (int)($it['thumbOf'] ?? 0) !== $pm) $t['work'] = true;
    } elseif (!$thumbOk || $source === 'file' || ($source === 'capture' && (int)($it['thumbOf'] ?? 0) !== $mtime)) {
        $t['capture'] = true;
    }
    return $t;
}

// Does one item's server-side work and returns the sidecar fields to patch.
function portfolioProcessItem($dir, $name, array $it) {
    $path = "$dir/$name";
    $id = $it['id'];
    $mtime = (int)$it['mtime'];
    if ($it['type'] === 'photo') {
        $dims = probeImage($path);
        $ok = $dims
            && generatePhotoThumbnail($path, THUMBS_DIR . "/$id.jpg")
            && generatePhotoProxy($path, PROXY_DIR . "/{$id}_proxy.jpg");
        if (!$ok) return ['error' => $mtime];
        return ['width' => $dims['width'], 'height' => $dims['height'], 'thumb' => $mtime, 'proxy' => $mtime, 'error' => null];
    }
    $patch = [];
    if ((int)($it['metaOf'] ?? 0) !== $mtime) {
        $patch['duration'] = round(mp4DurationSeconds($path), 3);
        $dims = mp4VideoDimensions($path);
        if ($dims) {
            $patch['width'] = $dims['width'];
            $patch['height'] = $dims['height'];
        }
        $patch['metaOf'] = $mtime;
    }
    if (!empty($it['posterFile'])) {
        $pp = "$dir/{$it['posterFile']}";
        if (generatePhotoThumbnail($pp, THUMBS_DIR . "/$id.jpg") && generatePhotoProxy($pp, PROXY_DIR . "/{$id}_proxy.jpg")) {
            $patch += ['thumb' => time(), 'thumbSource' => 'file', 'thumbOf' => (int)@filemtime($pp)];
            // No size from the video header (e.g. WebM): the poster's will do.
            if (empty($patch['width']) && empty($it['width']) && ($pd = probeImage($pp))) {
                $patch['width'] = $pd['width'];
                $patch['height'] = $pd['height'];
            }
        } else {
            $patch['error'] = $mtime;
        }
    }
    return $patch;
}

// Applies a patch to one item under the sidecar lock. A null value removes the
// field. Silently skips an item that vanished meanwhile.
function portfolioPatchItem($dir, $name, array $patch) {
    return portfolioSidecarUpdate("$dir/.gallery.json", function ($g) use ($name, $patch) {
        if (!isset($g['items'][$name])) return $g;
        foreach ($patch as $k => $v) {
            if ($v === null) unset($g['items'][$name][$k]);
            else $g['items'][$name][$k] = $v;
        }
        return $g;
    });
}

// Builds missing or stale derivatives for up to $sliceSeconds, starting with
// $galleryId when given. One run at a time across web and CLI (non-blocking
// lock), so a second admin tab or an overlapping cron never doubles CPU use
// under the host's per-account cap.
function portfolioProcess($galleryId, $sliceSeconds) {
    $lock = @fopen(DATA_DIR . '/portfolio-process.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        return ['busy' => true, 'processed' => 0, 'remaining' => 0, 'failed' => 0, 'needsPoster' => []];
    }
    @set_time_limit(max(60, $sliceSeconds * 4));
    $start = microtime(true);
    $galleries = [];
    $collect = function ($nodes) use (&$collect, &$galleries, $galleryId) {
        foreach ($nodes as $gal) {
            if ($gal['id'] === $galleryId) array_unshift($galleries, $gal);
            else $galleries[] = $gal;
            $collect($gal['children'] ?? []);
        }
    };
    $tree = portfolioTree(true);
    // The home gallery isn't a category and was missing from this sweep
    // entirely — its items never got processed no matter how long the
    // background loop ran, since nothing ever added them to $galleries.
    if ($tree['home']) {
        if ($tree['home']['id'] === $galleryId) array_unshift($galleries, $tree['home']);
        else $galleries[] = $tree['home'];
    }
    foreach ($tree['categories'] as $cat) {
        if (!empty($cat['isTopGallery'])) {
            if ($cat['id'] === $galleryId) array_unshift($galleries, $cat);
            else $galleries[] = $cat;
            continue;
        }
        $collect($cat['galleries']);
    }
    $processed = 0;
    $remaining = 0;
    $failed = 0;
    $needsPoster = [];
    foreach ($galleries as $gal) {
        foreach ($gal['sidecar']['items'] as $name => $it) {
            $name = (string)$name;
            $t = portfolioItemTasks($gal['dir'], $name, $it);
            if ($t['work']) {
                if (microtime(true) - $start >= $sliceSeconds) {
                    $remaining++;
                    continue;
                }
                $patch = portfolioProcessItem($gal['dir'], $name, $it);
                $g = portfolioPatchItem($gal['dir'], $name, $patch);
                $processed++;
                if (isset($patch['error'])) $failed++;
                $it = $g['items'][$name] ?? $it;
                $t = portfolioItemTasks($gal['dir'], $name, $it);
            }
            if ($t['capture']) {
                $needsPoster[] = [
                    'galleryId' => $gal['id'],
                    'file' => $name,
                    'src' => portfolioMediaUrl($gal['rel'], $name),
                ];
            }
        }
    }
    flock($lock, LOCK_UN);
    fclose($lock);
    return ['busy' => false, 'processed' => $processed, 'remaining' => $remaining, 'failed' => $failed, 'needsPoster' => $needsPoster];
}

// --- Payloads ---

// $rel is a gallery's path under site-data/portfolio/ ("Weddings/Smith & Jones"
// or "_home"), so this covers galleries in a category, the home gallery, and
// items a gallery borrows from another one.
function portfolioMediaUrl($rel, $file) {
    $parts = array_map('rawurlencode', explode('/', $rel));
    return '/media/' . implode('/', $parts) . '/' . rawurlencode($file);
}

function portfolioCategoryUrl($cat) {
    if (!empty($cat['isTopGallery'])) return '/portfolio/' . rawurlencode($cat['slug']);
    return '/portfolio/' . $cat['slug'];
}
function portfolioGalleryUrl($cat, $gal) {
    if (!empty($gal['home'])) return '/';
    if (!empty($gal['isTopGallery'])) return '/portfolio/' . rawurlencode($gal['slug']);
    $path = !empty($gal['slugPath']) ? $gal['slugPath'] : [$gal['slug']];
    return '/portfolio/' . rawurlencode($cat['slug']) . '/' . implode('/', array_map('rawurlencode', $path));
}
function portfolioTitle($node) {
    $t = trim((string)($node['sidecar']['title'] ?? ''));
    return $t !== '' ? $t : $node['folder'];
}

// Public visibility of one item: hidden items never show, and a photo waits
// for its thumbnail. Videos show without a poster (the page draws a placeholder)
// so a folder of fresh videos isn't invisible until someone opens the admin.
function portfolioItemIsPublic(array $it) {
    return ($it['visible'] ?? true) !== false && portfolioItemReady($it);
}

// Whether a visitor can be shown this file at all: a photo waits for its
// thumbnail, a video shows regardless (the page draws a placeholder), so a
// folder of fresh videos isn't invisible until someone opens the admin.
function portfolioItemReady(array $it) {
    if (($it['type'] ?? '') !== 'photo') return true;
    return !empty($it['thumb']) && is_file(THUMBS_DIR . "/{$it['id']}.jpg");
}

// Follows a pick to the file it points at, in whichever gallery holds it.
// Returns null when that gallery or file is gone, which the admin flags and
// public payloads skip.
function portfolioResolveRef($ref) {
    if (empty($ref['gallery']) || empty($ref['file'])) return null;
    $found = portfolioFindGallery($ref['gallery']);
    if (!$found) return null;
    [, $srcGal] = $found;
    $it = $srcGal['sidecar']['items'][$ref['file']] ?? null;
    return $it ? [$srcGal, (string)$ref['file'], $it] : null;
}

// One entry of a gallery's order: a section header, a file of its own, or a
// pick borrowed from elsewhere.
function portfolioResolveKey($gal, $key) {
    $g = $gal['sidecar'];
    if (isset($g['headers'][$key])) {
        return ['kind' => 'header', 'text' => (string)($g['headers'][$key]['text'] ?? '')];
    }
    if (isset($g['items'][$key])) {
        return ['kind' => 'item', 'gal' => $gal, 'file' => $key, 'item' => $g['items'][$key]];
    }
    $ref = $g['refs'][$key] ?? null;
    if (!$ref) return null;
    $r = portfolioResolveRef($ref);
    if (!$r) return ['kind' => 'broken', 'ref' => $ref];
    [$srcGal, $file, $item] = $r;
    return ['kind' => 'ref', 'gal' => $srcGal, 'file' => $file, 'item' => $item, 'ref' => $ref];
}

function portfolioItemPayload($gal, $name, array $it) {
    $id = $it['id'];
    $thumb = !empty($it['thumb']) && is_file(THUMBS_DIR . "/$id.jpg") ? "/thumbnails/$id.jpg?v={$it['thumb']}" : null;
    $proxy = null;
    $proxyV = $it['type'] === 'photo' ? ($it['proxy'] ?? 0) : ($it['thumb'] ?? 0);
    if ($proxyV && is_file(PROXY_DIR . "/{$id}_proxy.jpg")) $proxy = "/proxies/{$id}_proxy.jpg?v=$proxyV";
    $p = [
        'id' => $id,
        'type' => $it['type'],
        'title' => $it['title'] ?? '',
        'description' => $it['description'] ?? '',
        'src' => portfolioMediaUrl($gal['rel'], $name),
        'thumb' => $thumb,
        'width' => (int)($it['width'] ?? 0),
        'height' => (int)($it['height'] ?? 0),
        'tile' => in_array($it['tile'] ?? '', PORTFOLIO_TILE_SIZES, true) ? $it['tile'] : 'normal',
    ];
    if ($it['type'] === 'photo') {
        $p['proxy'] = $proxy;
    } else {
        $p['poster'] = $proxy ?: $thumb;
        $p['duration'] = (float)($it['duration'] ?? 0);
        $labels = is_array($it['captionLabels'] ?? null) ? $it['captionLabels'] : [];
        $p['captions'] = [];
        foreach (($it['captions'] ?? []) as $lang => $file) {
            $p['captions'][] = [
                'lang' => $lang,
                'label' => $labels[$lang] ?? captionLangLabel($lang),
                'src' => portfolioMediaUrl($gal['rel'], $file),
            ];
        }
    }
    return $p;
}

// Items in display order, headers included. Public payloads leave out hidden
// and unprocessed items, and any header left with nothing under it.
function portfolioGalleryItems($cat, $gal, $admin = false) {
    $g = $gal['sidecar'];
    $out = [];
    foreach (portfolioEffectiveOrder($gal) as $key) {
        $key = (string)$key;
        $r = portfolioResolveKey($gal, $key);
        if (!$r) continue;
        if ($r['kind'] === 'header') {
            $out[] = ['type' => 'header', 'id' => $key, 'text' => $r['text']];
            continue;
        }
        if ($r['kind'] === 'broken') {
            // The file a pick pointed at was deleted or moved away.
            if ($admin) $out[] = ['type' => 'broken', 'id' => $key, 'file' => $key, 'source' => $r['ref']];
            continue;
        }
        $it = $r['item'];
        $isRef = $r['kind'] === 'ref';
        // A pick carries its own visibility: a shot can be hidden in the
        // gallery it lives in and still lead the home page.
        $visible = $isRef ? (($r['ref']['visible'] ?? true) !== false) : (($it['visible'] ?? true) !== false);
        if (!$admin && (!$visible || !portfolioItemReady($it))) continue;
        $p = portfolioItemPayload($r['gal'], $r['file'], $it);
        if ($isRef) {
            foreach (['title', 'description'] as $k) {
                if (isset($r['ref'][$k]) && $r['ref'][$k] !== null && $r['ref'][$k] !== '') $p[$k] = (string)$r['ref'][$k];
            }
            $p['ref'] = true;
            if (in_array($r['ref']['tile'] ?? '', PORTFOLIO_TILE_SIZES, true)) $p['tile'] = $r['ref']['tile'];
            if ($admin) $p['source'] = ['galleryId' => $r['gal']['id'], 'gallery' => portfolioTitle($r['gal']), 'file' => $r['file']];
        }
        if ($admin) {
            $t = portfolioItemTasks($r['gal']['dir'], $r['file'], $it);
            $p['file'] = $key;
            $p['visible'] = $visible;
            $p['processing'] = $t['work'];
            $p['needsPoster'] = $t['capture'];
            $p['failed'] = !empty($it['error']);
        }
        $out[] = $p;
    }
    if ($admin) return $out;
    $clean = [];
    foreach ($out as $i => $p) {
        $next = $out[$i + 1] ?? null;
        if ($p['type'] === 'header' && (!$next || $next['type'] === 'header')) continue;
        $clean[] = $p;
    }
    return $clean;
}

function portfolioGalleryCover($cat, $gal) {
    $g = $gal['sidecar'];
    $candidates = $g['cover'] !== null ? array_merge([$g['cover']], portfolioEffectiveOrder($gal)) : portfolioEffectiveOrder($gal);
    foreach ($candidates as $key) {
        $r = portfolioResolveKey($gal, (string)$key);
        if (!$r || !in_array($r['kind'], ['item', 'ref'], true)) continue;
        $it = $r['item'];
        if (portfolioItemReady($it) && !empty($it['thumb']) && is_file(THUMBS_DIR . "/{$it['id']}.jpg")) {
            return "/thumbnails/{$it['id']}.jpg?v={$it['thumb']}";
        }
    }
    return null;
}

function portfolioPublicItemCount($gal) {
    $n = 0;
    foreach ($gal['sidecar']['order'] as $key) {
        $r = portfolioResolveKey($gal, (string)$key);
        if (!$r || !in_array($r['kind'], ['item', 'ref'], true)) continue;
        $visible = $r['kind'] === 'ref'
            ? (($r['ref']['visible'] ?? true) !== false)
            : (($r['item']['visible'] ?? true) !== false);
        if ($visible && portfolioItemReady($r['item'])) $n++;
    }
    return $n;
}

// A node's cover: its own first usable picture, or otherwise the first its
// children can offer — so a collection card is not blank.
function portfolioNodeCover($cat, $node) {
    $c = portfolioGalleryCover($cat, $node);
    if ($c) return $c;
    foreach ($node['children'] ?? [] as $ch) {
        $c = portfolioNodeCover($cat, $ch);
        if ($c) return $c;
    }
    return null;
}

// How many of a node's child galleries a visitor may see.
function portfolioPublicChildCount($cat, $node) {
    $n = 0;
    foreach ($node['children'] ?? [] as $ch) {
        if (portfolioGalleryIsPublic($cat, $ch)) $n++;
    }
    return $n;
}

function portfolioAccess($gal) {
    $a = $gal['sidecar']['access'] ?? 'public';
    return in_array($a, PORTFOLIO_ACCESS, true) ? $a : 'public';
}

// Whether a visitor who types the address can see the gallery at all. Only
// `hidden` is refused outright; `password` is answered with a prompt.
function portfolioGalleryIsReachable($cat, $gal) {
    return portfolioAccess($gal) !== 'hidden'
        && (portfolioPublicItemCount($gal) > 0 || portfolioPublicChildCount($cat, $gal) > 0);
}

// Whether it belongs in listings and menus.
function portfolioGalleryIsPublic($cat, $gal) {
    return ($cat['sidecar']['visible'] ?? true) !== false
        && portfolioAccess($gal) === 'public'
        && (portfolioPublicItemCount($gal) > 0 || portfolioPublicChildCount($cat, $gal) > 0);
}

// The admin sees every gallery, so a locked one can be checked without
// typing its password.
function portfolioIsUnlocked($galleryId) {
    return !empty($_SESSION['pfUnlocked'][$galleryId]) || isAdminSession();
}

function portfolioGallerySummary($cat, $gal) {
    return [
        'id' => $gal['id'],
        'slug' => $gal['slug'],
        'title' => portfolioTitle($gal),
        'url' => portfolioGalleryUrl($cat, $gal),
        'cover' => portfolioNodeCover($cat, $gal),
        'count' => portfolioPublicItemCount($gal),
        'childCount' => portfolioPublicChildCount($cat, $gal),
    ];
}

function portfolioCategoryPayload($cat) {
    $galleries = [];
    foreach ($cat['galleries'] as $gal) {
        if (portfolioGalleryIsPublic($cat, $gal)) $galleries[] = portfolioGallerySummary($cat, $gal);
    }
    return [
        'id' => $cat['id'],
        'slug' => $cat['slug'],
        'title' => portfolioTitle($cat),
        'description' => (string)($cat['sidecar']['description'] ?? ''),
        'url' => portfolioCategoryUrl($cat),
        'kind' => 'collection',
        'view' => ($cat['sidecar']['view'] ?? 'cards') === 'page' ? 'page' : 'cards',
        'galleries' => $galleries,
    ];
}

// The home page's opening screen, resolved to something the page can render.
// The picture is one of the home gallery's own entries, so it is managed like
// any other item rather than being a second kind of upload.
function portfolioHeroPayload($gal) {
    $hero = $gal['sidecar']['hero'] ?? null;
    if (!is_array($hero) || empty($hero['file'])) return null;
    $r = portfolioResolveKey($gal, (string)$hero['file']);
    if (!$r || !in_array($r['kind'], ['item', 'ref'], true)) return null;
    $p = portfolioItemPayload($r['gal'], $r['file'], $r['item']);
    return [
        'type' => $p['type'],
        'src' => $p['type'] === 'video' ? $p['src'] : ($p['proxy'] ?: $p['src']),
        'poster' => $p['poster'] ?? $p['thumb'],
        'title' => (string)($hero['title'] ?? ''),
        'subtitle' => (string)($hero['subtitle'] ?? ''),
        'height' => ($hero['height'] ?? 'full') === 'large' ? 'large' : 'full',
        // Cover on its own: the picture is the whole home page, with no
        // gallery under it.
        'only' => !empty($hero['only']),
        'file' => (string)$hero['file'],
    ];
}

// The chain of collections above a node, for the page breadcrumb.
function portfolioBreadcrumbs($cat, $node) {
    $crumbs = [['title' => portfolioTitle($cat), 'url' => portfolioCategoryUrl($cat)]];
    $path = $node['slugPath'] ?? [];
    $nodes = $cat['galleries'];
    for ($i = 0; $i < count($path) - 1; $i++) {
        foreach ($nodes as $n) {
            if ($n['slug'] !== $path[$i]) continue;
            $crumbs[] = ['title' => portfolioTitle($n), 'url' => portfolioGalleryUrl($cat, $n)];
            $nodes = $n['children'] ?? [];
            break;
        }
    }
    return $crumbs;
}

function portfolioGalleryPayload($cat, $gal) {
    $g = $gal['sidecar'];
    $children = [];
    foreach ($gal['children'] ?? [] as $ch) {
        if (portfolioGalleryIsPublic($cat, $ch)) $children[] = portfolioGallerySummary($cat, $ch);
    }
    return [
        'id' => $gal['id'],
        'slug' => $gal['slug'],
        'title' => portfolioTitle($gal),
        'description' => (string)($g['description'] ?? ''),
        'layout' => $g['layout'],
        'options' => portfolioNormalizeOptions($g['options'] ?? []),
        'sort' => portfolioNormalizeSort($g['sort'] ?? null, !empty($gal['children']) && empty($g['items']) ? PORTFOLIO_NODE_SORTS : PORTFOLIO_ITEM_SORTS),
        'watermark' => portfolioWatermarkFor($cat, $gal),
        'url' => portfolioGalleryUrl($cat, $gal),
        'category' => ['slug' => $cat['slug'], 'title' => portfolioTitle($cat), 'url' => portfolioCategoryUrl($cat)],
        'breadcrumbs' => portfolioBreadcrumbs($cat, $gal),
        'kind' => !empty($g['items']) ? 'gallery' : (!empty($gal['children']) ? 'collection' : 'gallery'),
        'children' => $children,
        'hero' => portfolioHeroPayload($gal),
        'items' => portfolioGalleryItems($cat, $gal),
    ];
}

// The watermark to stamp on a gallery's pictures: the site one, unless the
// gallery or its collection turns it off.
function portfolioWatermarkFor($cat, $gal) {
    $wm = readThemeConfig()['watermark'];
    if (!$wm['enabled'] || $wm['src'] === '') return null;
    $galOpt = $gal['sidecar']['options']['watermark'] ?? 'inherit';
    $catOpt = $cat['sidecar']['watermark'] ?? 'inherit';
    if ($galOpt === 'off' || $catOpt === 'off') return null;
    return [
        'src' => $wm['src'],
        'position' => $wm['position'],
        'scale' => $wm['scale'] ?? 18,
        'opacity' => $wm['opacity'] ?? 85,
    ];
}

// Public categories, each with its public galleries; empty ones are left out.
function portfolioPublicCategories() {
    $out = [];
    foreach (portfolioTree()['categories'] as $cat) {
        if (($cat['sidecar']['visible'] ?? true) === false) continue;
        if (!empty($cat['isTopGallery'])) {
            if (!portfolioGalleryIsPublic($cat, $cat)) continue;
            // A top-level gallery is itself a card in the index.
            $out[] = [
                'id' => $cat['id'],
                'slug' => $cat['slug'],
                'title' => portfolioTitle($cat),
                'url' => portfolioCategoryUrl($cat),
                'kind' => 'gallery',
                'galleries' => [portfolioGallerySummary($cat, $cat)],
            ];
            continue;
        }
        $p = portfolioCategoryPayload($cat);
        if ($p['galleries']) $out[] = $p;
    }
    return $out;
}

// The home page's own gallery, if it has anything to show.
function portfolioHome() {
    $home = portfolioTree()['home'];
    if (!$home || portfolioPublicItemCount($home) === 0) return null;
    return [portfolioHomeCategory(), $home];
}

// --- Public routes ---

if ($method === 'GET' && $uri === '/api/portfolio') {
    respond(['categories' => portfolioPublicCategories(), 'index' => readThemeConfig()['index']]);
}

// The home page. Null means nothing has been put there yet, and the page falls
// back to what it showed before the portfolio existed.
if ($method === 'GET' && $uri === '/api/portfolio/home') {
    $found = portfolioHome();
    respond(['gallery' => $found ? portfolioGalleryPayload(...$found) : null]);
}

if ($method === 'GET' && matchRoute('/api/portfolio/c/{cat}', $uri, $params)) {
    $cat = portfolioFindCategoryBySlug($params['cat']);
    if (!$cat || ($cat['sidecar']['visible'] ?? true) === false) respondError('Not found', 404);
    // A top-level gallery has no separate category page — the URL is the gallery.
    if (!empty($cat['isTopGallery'])) {
        if (!portfolioGalleryIsReachable($cat, $cat)) respondError('Not found', 404);
        if (portfolioAccess($cat) === 'password' && !portfolioIsUnlocked($cat['id'])) {
            respond(['locked' => true, 'title' => portfolioTitle($cat)]);
        }
        respond(['gallery' => portfolioGalleryPayload($cat, $cat)]);
    }
    respond([
        'category' => portfolioCategoryPayload($cat),
        'index' => readThemeConfig()['index'],
        // The sidebar and filter bar need every category, not just this one.
        'categories' => array_map(fn($c) => ['slug' => $c['slug'], 'title' => $c['title'], 'url' => $c['url']], portfolioPublicCategories()),
    ]);
}

// A gallery or collection at any depth: /api/portfolio/g/{cat}/{slug}/{slug}...
if ($method === 'GET' && preg_match('#^/api/portfolio/g/([^/]+)/(.+)$#', $uri, $m)) {
    $found = portfolioFindByPath(rawurldecode($m[1]), array_map('rawurldecode', explode('/', rtrim($m[2], '/'))));
    if (!$found || !portfolioGalleryIsReachable(...$found)) respondError('Not found', 404);
    [$cat, $gal] = $found;
    if (portfolioAccess($gal) === 'password' && !portfolioIsUnlocked($gal['id'])) {
        respond(['locked' => true, 'title' => portfolioTitle($gal)]);
    }
    respond(['gallery' => portfolioGalleryPayload($cat, $gal)]);
}

// Unlocking a password-protected gallery, remembered for the session.
if ($method === 'POST' && preg_match('#^/api/portfolio/g/([^/]+)/(.+)/unlock$#', $uri, $m)) {
    rateLimitCheck('pfunlock:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 12, 300);
    $found = portfolioFindByPath(rawurldecode($m[1]), array_map('rawurldecode', explode('/', rtrim($m[2], '/'))));
    if (!$found || !portfolioGalleryIsReachable(...$found)) respondError('Not found', 404);
    [$cat, $gal] = $found;
    $hash = $gal['sidecar']['passwordHash'] ?? '';
    if (portfolioAccess($gal) !== 'password' || $hash === '') respond(['ok' => true]);
    if (!password_verify((string)(getInput()['password'] ?? ''), $hash)) {
        respondError('That password does not match', 401);
    }
    $_SESSION['pfUnlocked'][$gal['id']] = true;
    respond(['ok' => true, 'gallery' => portfolioGalleryPayload($cat, $gal)]);
}

// --- Admin routes ---

// One gallery/collection as the admin sees it, recursing into child galleries
// so the Portfolio tab can browse a nested tree.
function portfolioAdminGalleryNode($cat, $gal) {
    $g = $gal['sidecar'];
    $work = 0;
    $capture = 0;
    $failed = 0;
    foreach ($g['items'] as $name => $it) {
        $t = portfolioItemTasks($gal['dir'], (string)$name, $it);
        if ($t['work']) $work++;
        if ($t['capture']) $capture++;
        if (!empty($it['error'])) $failed++;
    }
    return [
        'id' => $gal['id'],
        'slug' => $gal['slug'],
        'folder' => $gal['folder'],
        'title' => portfolioTitle($gal),
        'visible' => ($g['visible'] ?? true) !== false,
        'access' => portfolioAccess($gal),
        'layout' => $g['layout'],
        'url' => portfolioGalleryUrl($cat, $gal),
        'cover' => portfolioNodeCover($cat, $gal),
        'itemCount' => count($g['items']),
        'publicCount' => portfolioPublicItemCount($gal),
        'childCount' => count($gal['children'] ?? []),
        'kind' => !empty($g['items']) ? 'gallery' : (!empty($gal['children'] ?? []) ? 'collection' : 'gallery'),
        'processing' => $work,
        'needsPoster' => $capture,
        'failed' => $failed,
        'pending' => $gal['pending'],
        'warnings' => $gal['warnings'],
        'children' => array_map(fn($ch) => portfolioAdminGalleryNode($cat, $ch), $gal['children'] ?? []),
    ];
}

// The whole tree as the admin sees it: hidden and empty folders included, with
// scan warnings, files still arriving, and per-gallery processing counts.
if ($method === 'GET' && $uri === '/api/admin/portfolio') {
    requireAuth();
    $tree = portfolioTree();
    $categories = [];
    foreach ($tree['categories'] as $cat) {
        if (!empty($cat['isTopGallery'])) {
            $categories[] = [
                'id' => $cat['id'],
                'slug' => $cat['slug'],
                'folder' => $cat['folder'],
                'title' => portfolioTitle($cat),
                'visible' => ($cat['sidecar']['visible'] ?? true) !== false,
                'url' => portfolioCategoryUrl($cat),
                'kind' => 'gallery',
                'self' => portfolioAdminGalleryNode($cat, $cat),
                'galleries' => [],
                'warnings' => $cat['warnings'],
            ];
            continue;
        }
        $galleries = array_map(fn($gal) => portfolioAdminGalleryNode($cat, $gal), $cat['galleries']);
        $categories[] = [
            'id' => $cat['id'],
            'slug' => $cat['slug'],
            'folder' => $cat['folder'],
            'title' => portfolioTitle($cat),
            'visible' => ($cat['sidecar']['visible'] ?? true) !== false,
            'url' => portfolioCategoryUrl($cat),
            'kind' => 'collection',
            'description' => (string)($cat['sidecar']['description'] ?? ''),
            'view' => ($cat['sidecar']['view'] ?? 'cards') === 'page' ? 'page' : 'cards',
            'sort' => portfolioNormalizeSort($cat['sidecar']['sort'] ?? null, PORTFOLIO_NODE_SORTS),
            'galleries' => $galleries,
            'warnings' => $cat['warnings'],
        ];
    }
    $home = $tree['home'];
    $homeWork = 0;
    $homeCapture = 0;
    $homeFailed = 0;
    if ($home) {
        foreach ($home['sidecar']['items'] as $name => $it) {
            $t = portfolioItemTasks($home['dir'], (string)$name, $it);
            if ($t['work']) $homeWork++;
            if ($t['capture']) $homeCapture++;
            if (!empty($it['error'])) $homeFailed++;
        }
    }
    respond([
        'categories' => $categories,
        'home' => $home ? [
            'id' => $home['id'],
            'title' => 'Home page',
            'layout' => $home['sidecar']['layout'],
            'itemCount' => count($home['sidecar']['order']),
            'publicCount' => portfolioPublicItemCount($home),
            'cover' => portfolioGalleryCover(portfolioHomeCategory(), $home),
            'processing' => $homeWork,
            'needsPoster' => $homeCapture,
            'failed' => $homeFailed,
        ] : null,
        'warnings' => $tree['warnings'],
    ]);
}

// Portfolio readiness: the pre-launch checklist from docs/portfolio/. Advisory
// only — it reports what a visitor would find, and never blocks publishing.
if ($method === 'GET' && $uri === '/api/admin/portfolio/readiness') {
    requireAuth();
    $tree = portfolioTree();

    // Walks every node, nested collections included. A collection is judged by
    // its public children; an image gallery by its pictures.
    $acc = [
        'empty' => [], 'noCover' => [], 'undescribed' => [], 'oversize' => [],
        'emptyCollections' => [], 'pending' => 0, 'failed' => 0,
        'described' => 0, 'items' => 0, 'galleries' => 0, 'collections' => 0,
    ];
    $scanNode = function ($cat, $gal) use (&$scanNode, &$acc) {
        $g = $gal['sidecar'];
        if (($g['visible'] ?? true) === false) return;
        $children = $gal['children'] ?? [];
        if ($children) {
            $acc['collections']++;
            // A collection with its own pictures is not empty, even with no
            // public child galleries.
            if (portfolioPublicChildCount($cat, $gal) === 0 && portfolioPublicItemCount($gal) === 0) {
                $acc['emptyCollections'][] = portfolioTitle($gal);
            }
            foreach ($children as $ch) $scanNode($cat, $ch);
        }
        $acc['galleries']++;
        $n = portfolioPublicItemCount($gal);
        if ($n === 0) {
            if (!$children) $acc['empty'][] = portfolioTitle($gal);
            return;
        }
        if ($n > 40) $acc['oversize'][] = portfolioTitle($gal) . " ($n)";
        if (!portfolioNodeCover($cat, $gal)) $acc['noCover'][] = portfolioTitle($gal);
        $descs = 0;
        foreach ($g['items'] as $name => $it) {
            if (!portfolioItemIsPublic($it)) continue;
            $acc['items']++;
            if (!empty($it['description'])) { $descs++; $acc['described']++; }
            $t = portfolioItemTasks($gal['dir'], (string)$name, $it);
            if (!empty($t['work'])) $acc['pending']++;
            if (!empty($it['error'])) $acc['failed']++;
        }
        if ($descs === 0) $acc['undescribed'][] = portfolioTitle($gal);
    };
    foreach ($tree['categories'] as $cat) {
        if (($cat['sidecar']['visible'] ?? true) === false) continue;
        if (!empty($cat['isTopGallery'])) { $scanNode($cat, $cat); continue; }
        foreach ($cat['galleries'] as $gal) $scanNode($cat, $gal);
    }

    $hasContact = false;
    $hasAbout = false;
    foreach (readPages() as $p) {
        if (($p['visible'] ?? true) === false) continue;
        if (($p['type'] ?? 'text') === 'contact') $hasContact = true;
        elseif (in_array(strtolower((string)($p['slug'] ?? '')), ['about', 'services', 'work', 'info'], true)) $hasAbout = true;
    }

    $home = $tree['home'];
    $homeCount = $home ? portfolioPublicItemCount($home) : 0;

    $checks = [];
    $add = function ($id, $group, $label, $status, $detail = '') use (&$checks) {
        $checks[] = ['id' => $id, 'group' => $group, 'label' => $label, 'status' => $status, 'detail' => $detail];
    };
    $incl = fn(array $a) => implode(', ', array_slice($a, 0, 6)) . (count($a) > 6 ? ' +' . (count($a) - 6) . ' more' : '');

    // Structure
    $add('home', 'Structure', 'A home page gathers the best work',
        !$home ? 'fail' : ($homeCount > 0 ? 'pass' : 'warn'),
        !$home ? 'No home page yet — set one up to feature your strongest frames.'
               : $homeCount . ' item(s) on the home page.');
    $add('galleries', 'Structure', 'At least one visible gallery with published work',
        $acc['galleries'] > 0 ? 'pass' : 'fail',
        $acc['galleries'] . ' visible gallery(ies)' . ($acc['collections'] ? ' including ' . $acc['collections'] . ' collection(s)' : '') . '.');
    $add('gallery_items', 'Structure', 'Every image gallery has published pictures',
        $acc['empty'] ? 'warn' : 'pass',
        $acc['empty'] ? 'Empty: ' . $incl($acc['empty']) : 'All image galleries have public pictures.');
    if ($acc['collections']) {
        $add('collections', 'Structure', 'Every collection has a public gallery in it',
            $acc['emptyCollections'] ? 'warn' : 'pass',
            $acc['emptyCollections'] ? 'Empty: ' . $incl($acc['emptyCollections']) : 'All collections have public galleries.');
    }
    $add('covers', 'Structure', 'Every gallery has a cover image',
        $acc['noCover'] ? 'warn' : 'pass',
        $acc['noCover'] ? 'No cover: ' . $incl($acc['noCover']) : 'All galleries have covers.');

    // Presentation
    $add('captions', 'Presentation', 'Images carry credits/captions',
        ($acc['items'] === 0 || $acc['described'] === 0) ? 'warn' : 'pass',
        $acc['items'] === 0 ? 'No published images yet.'
            : $acc['described'] . ' of ' . $acc['items'] . ' image(s) have a caption box.');
    if ($acc['undescribed']) {
        $add('captions_gaps', 'Presentation', 'Galleries with no captions at all',
            'warn', $incl($acc['undescribed']));
    }
    $add('credit_immersive', 'Presentation', 'Credits show in the immersive views',
        'pass', 'The caption box renders in the slideshow, fullscreen and horizontal views.');

    // Editorial
    $add('tight_edit', 'Editorial', 'Front-end edit stays tight (~20–40 images)',
        $acc['oversize'] ? 'warn' : 'pass',
        $acc['oversize'] ? 'Large: ' . $incl($acc['oversize']) : 'No gallery exceeds 40 images.');
    $add('contact', 'Editorial', 'Somewhere to go next (contact / inquiry)',
        $hasContact ? 'pass' : 'warn',
        $hasContact ? 'A contact page exists.' : 'No contact page — add one so a visitor can start a job.');
    $add('about', 'Editorial', 'An About / Services page says what you shoot',
        $hasAbout ? 'pass' : 'warn',
        $hasAbout ? 'An about/services page exists.' : 'No about or services page found.');

    // Performance
    $add('processing', 'Performance', 'No files still processing',
        $acc['pending'] === 0 ? 'pass' : 'warn',
        $acc['pending'] === 0 ? 'Everything is processed.' : $acc['pending'] . ' file(s) still processing.');
    $add('failed', 'Performance', 'No failed imports',
        $acc['failed'] === 0 ? 'pass' : 'fail',
        $acc['failed'] === 0 ? 'No failures.' : $acc['failed'] . ' file(s) failed to import.');

    $summary = ['pass' => 0, 'warn' => 0, 'fail' => 0];
    foreach ($checks as $c) $summary[$c['status']]++;
    respond(['checks' => $checks, 'summary' => $summary]);
}

// Recursive size, for reporting what a trash entry costs before clearing it.
function pathSize($path) {
    if (is_file($path)) return filesize($path) ?: 0;
    if (!is_dir($path)) return 0;
    $total = 0;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, RecursiveDirectoryIterator::SKIP_DOTS));
    foreach ($it as $f) if ($f->isFile()) $total += $f->getSize();
    return $total;
}

// Deleted galleries and files land in site-data/portfolio-trash/ instead of
// being unlinked (see portfolioTrash()) — nothing the admin ever gets rid of
// is destroyed outright. This is the only way to actually reclaim that space.
if ($method === 'GET' && $uri === '/api/admin/portfolio/trash') {
    requireAuth();
    $out = [];
    foreach (@scandir(PORTFOLIO_TRASH_DIR) ?: [] as $name) {
        if (portfolioIgnoredName($name)) continue; // never list .htaccess, the dir's own web-access guard
        $path = PORTFOLIO_TRASH_DIR . '/' . $name;
        $out[] = ['name' => $name, 'isDir' => is_dir($path), 'size' => pathSize($path), 'deletedAt' => (int)@filemtime($path)];
    }
    usort($out, fn($a, $b) => $b['deletedAt'] <=> $a['deletedAt']);
    respond(['entries' => $out, 'totalSize' => array_sum(array_column($out, 'size'))]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/trash/{name}', $uri, $params)) {
    requireAuth();
    // basename() strips any path component a crafted {name} might carry, so
    // this can only ever touch a direct child of the trash folder — and
    // never its own .htaccess, which portfolioIgnoredName() also excludes.
    $name = basename(rawurldecode($params['name']));
    if (portfolioIgnoredName($name)) respondError('Not found', 404);
    $path = PORTFOLIO_TRASH_DIR . '/' . $name;
    if (!file_exists($path)) respondError('Not found', 404);
    is_dir($path) ? rrmdirTree($path) : @unlink($path);
    respond(['ok' => true]);
}

if ($method === 'POST' && $uri === '/api/admin/portfolio/trash/empty') {
    requireAuth();
    $count = 0;
    foreach (@scandir(PORTFOLIO_TRASH_DIR) ?: [] as $name) {
        if (portfolioIgnoredName($name)) continue; // never delete .htaccess
        $path = PORTFOLIO_TRASH_DIR . '/' . $name;
        is_dir($path) ? rrmdirTree($path) : @unlink($path);
        $count++;
    }
    respond(['ok' => true, 'removed' => $count]);
}

if ($method === 'GET' && $uri === '/api/admin/portfolio/stats') {
    requireAuth();
    $c = ['galleries' => 0, 'collections' => 0, 'photos' => 0, 'videos' => 0, 'hidden' => 0];
    $countNode = function ($node) use (&$countNode, &$c) {
        $kind = $node['kind'] ?? 'gallery';
        if ($kind === 'collection') $c['collections']++; else $c['galleries']++;
        foreach (($node['sidecar']['items'] ?? []) as $it) {
            if (!is_array($it)) continue;
            if (($it['type'] ?? 'photo') === 'video') $c['videos']++; else $c['photos']++;
            if (empty($it['visible'])) $c['hidden']++;
        }
        foreach (($node['galleries'] ?? $node['children'] ?? []) as $child) $countNode($child);
    };
    foreach (portfolioTree()['categories'] as $cat) $countNode($cat);

    $disk = [
        'portfolio' => pathSize(PORTFOLIO_DIR),
        'thumbnails' => pathSize(SITE_DATA . '/thumbnails'),
        'proxies' => pathSize(SITE_DATA . '/proxies'),
        'uploads' => pathSize(UPLOADS_DIR),
        'trash' => pathSize(SITE_DATA . '/portfolio-trash'),
    ];
    $disk['total'] = pathSize(SITE_DATA);

    // Client delivery (the older reels/proofing galleries) is a separate store:
    // records in galleries.json/collections.json, items in gallery-<id>/videos.json.
    $cg = 0; $cphotos = 0; $cvideos = 0; $chidden = 0;
    foreach (readGalleries() as $g) {
        $cg++;
        foreach (readGalleryVideos($g['id'] ?? '') as $it) {
            if (!is_array($it)) continue;
            if (($it['type'] ?? '') === 'video') $cvideos++; else $cphotos++;
            if (($it['visible'] ?? true) === false) $chidden++;
        }
    }
    $client = [
        'galleries' => $cg,
        'collections' => count(readCollections()),
        'photos' => $cphotos,
        'videos' => $cvideos,
        'hidden' => $chidden,
        'uploads' => $disk['uploads'],
    ];
    respond(['counts' => $c, 'disk' => $disk, 'client' => $client]);
}

// Files that exist more than once on disk (same bytes), so a copy can become a
// pick of one original. Size groups first — identical files share a size — so
// only genuine candidates are hashed.
if ($method === 'GET' && $uri === '/api/admin/portfolio/duplicates') {
    requireAuth();
    $bySize = [];
    foreach (portfolioAllNodes() as [$cat, $gal]) {
        foreach ($gal['sidecar']['items'] as $name => $it) {
            $path = $gal['dir'] . '/' . $name;
            if (!is_file($path)) continue;
            $bySize[(int)@filesize($path)][] = ['cat' => $cat, 'gal' => $gal, 'file' => (string)$name, 'it' => $it, 'path' => $path];
        }
    }
    $groups = [];
    foreach ($bySize as $size => $files) {
        if (count($files) < 2) continue;
        $byHash = [];
        foreach ($files as $f) {
            $h = @hash_file('sha256', $f['path']);
            if ($h !== false) $byHash[$h][] = $f;
        }
        foreach ($byHash as $h => $fs) {
            if (count($fs) < 2) continue;
            $groups[] = ['size' => $size, 'files' => array_map(fn($f) => [
                'galleryId' => $f['gal']['id'],
                'galleryTitle' => portfolioTitle($f['gal']),
                'file' => $f['file'],
                'itemId' => $f['it']['id'] ?? '',
                'title' => (string)($f['it']['title'] ?? ''),
                'url' => portfolioGalleryUrl($f['cat'], $f['gal']),
            ], $fs)];
        }
    }
    respond(['groups' => $groups]);
}

// Keep one file; turn each other copy into a pick of it and remove the bytes.
if ($method === 'POST' && $uri === '/api/admin/portfolio/duplicates/link') {
    requireAuth();
    $in = getInput();
    $keepG = (string)($in['keep']['galleryId'] ?? '');
    $keepF = (string)($in['keep']['file'] ?? '');
    [$kCat, $kGal] = portfolioRequireGallery($keepG);
    if (!isset($kGal['sidecar']['items'][$keepF]) || !is_file($kGal['dir'] . '/' . $keepF)) {
        respondError('The kept file is gone', 404);
    }
    $keepHash = @hash_file('sha256', $kGal['dir'] . '/' . $keepF);
    $linked = 0;
    foreach ((array)($in['link'] ?? []) as $l) {
        $gid = (string)($l['galleryId'] ?? '');
        $file = (string)($l['file'] ?? '');
        if (($gid === $keepG && $file === $keepF) || $gid === '' || $file === '') continue;
        [$cat, $gal] = portfolioRequireGallery($gid);
        $it = $gal['sidecar']['items'][$file] ?? null;
        if (!$it || !is_file($gal['dir'] . '/' . $file)) continue;
        // Only link files that really are the same bytes.
        if ($keepHash === false || @hash_file('sha256', $gal['dir'] . '/' . $file) !== $keepHash) continue;
        $refKey = generateId('r_');
        $ref = ['gallery' => $kGal['id'], 'file' => $keepF, 'visible' => ($it['visible'] ?? true) !== false];
        if (!empty($it['title'])) $ref['title'] = (string)$it['title'];
        if (!empty($it['description'])) $ref['description'] = (string)$it['description'];
        portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($file, $refKey, $ref) {
            $pos = array_search($file, $g['order'], true);
            unset($g['items'][$file]);
            $g['order'] = array_values(array_filter($g['order'], fn($o) => $o !== $file));
            if ($g['cover'] === $file) $g['cover'] = null;
            $g['refs'][$refKey] = $ref;
            $at = $pos === false ? count($g['order']) : min($pos, count($g['order']));
            array_splice($g['order'], $at, 0, [$refKey]);
            return $g;
        });
        if (!empty($it['id'])) portfolioDropDerivatives($it['id']);
        portfolioTrash($gal['dir'] . '/' . $file, $file);
        $linked++;
    }
    portfolioTree(true);
    respond(['ok' => true, 'linked' => $linked]);
}

if ($method === 'GET' && matchRoute('/api/admin/portfolio/galleries/{gid}', $uri, $params)) {
    requireAuth();
    $found = portfolioFindGallery($params['gid']);
    if (!$found) respondError('Gallery not found', 404);
    [$cat, $gal] = $found;
    $p = portfolioGalleryPayload($cat, $gal);
    $p['items'] = portfolioGalleryItems($cat, $gal, true);
    $p['folder'] = $gal['folder'];
    $p['visible'] = ($gal['sidecar']['visible'] ?? true) !== false;
    $p['access'] = portfolioAccess($gal);
    $p['hasPassword'] = !empty($gal['sidecar']['passwordHash']);
    $p['cover'] = $gal['sidecar']['cover'];
    $p['pending'] = $gal['pending'];
    $p['warnings'] = $gal['warnings'];
    // The admin sees every child (hidden and empty included), as admin nodes.
    $p['children'] = array_map(fn($ch) => portfolioAdminGalleryNode($cat, $ch), $gal['children'] ?? []);
    $p['childCount'] = count($gal['children'] ?? []);
    $p['parentId'] = $gal['parent'] ?? null;
    $p['categoryId'] = $cat['id'];
    respond(['gallery' => $p]);
}

// --- Admin mutations ---
//
// Every route resolves a gallery or category by id through portfolioTree(), so
// paths are built from what the scan found, never from request input. A file
// name from the client is only ever used to look up an existing item key, and a
// new name is put through portfolioSafeName() first.

// Strips what a folder or file name must not contain: path separators, the
// characters Windows and URLs choke on, control characters and leading dots
// (which would hide it from the scanner).
function portfolioSafeName($s) {
    $s = preg_replace('~[/\\\\:*?"<>|#%]+~u', ' ', (string)$s);
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', '', $s);
    $s = preg_replace('/\s+/u', ' ', $s);
    $s = trim(ltrim(trim($s), '.'));
    if (class_exists('Normalizer')) $s = Normalizer::normalize($s, Normalizer::FORM_C);
    return mb_substr($s, 0, 100);
}

// Keeps the extension intact while cleaning the stem.
function portfolioSafeFileName($name) {
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $stem = portfolioSafeName(pathinfo($name, PATHINFO_FILENAME));
    if ($stem === '') $stem = 'file';
    return $ext === '' ? $stem : "$stem.$ext";
}

// "name (2)" until nothing is in the way — the same shape Finder uses.
function portfolioUniqueChildName($dir, $name) {
    if (!file_exists("$dir/$name")) return $name;
    $ext = pathinfo($name, PATHINFO_EXTENSION);
    $stem = pathinfo($name, PATHINFO_FILENAME);
    $suffix = $ext === '' ? '' : ".$ext";
    for ($n = 2; ; $n++) {
        $try = "$stem ($n)$suffix";
        if (!file_exists("$dir/$try")) return $try;
    }
}

// Nothing the admin deletes is unlinked: these are the only copies of the
// owner's pictures, so they move to site-data/portfolio-trash/ instead.
function portfolioTrash($path, $label = '') {
    if (!file_exists($path)) return true;
    if (!is_dir(PORTFOLIO_TRASH_DIR)) @mkdir(PORTFOLIO_TRASH_DIR, 0755, true);
    denyWebAccess(PORTFOLIO_TRASH_DIR);
    $name = date('Ymd-His') . '-' . portfolioSafeName($label !== '' ? $label : basename($path));
    return @rename($path, PORTFOLIO_TRASH_DIR . '/' . portfolioUniqueChildName(PORTFOLIO_TRASH_DIR, $name));
}

function portfolioDropDerivatives($id) {
    @unlink(THUMBS_DIR . "/$id.jpg");
    @unlink(PROXY_DIR . "/{$id}_proxy.jpg");
}

// Resolves {gid} for a route, or answers 404.
function portfolioRequireGallery($gid) {
    $found = portfolioFindGallery($gid);
    if (!$found) respondError('Gallery not found', 404);
    return $found;
}

function portfolioRequireCategory($cid) {
    foreach (portfolioTree()['categories'] as $cat) {
        if ($cat['id'] === $cid) return $cat;
    }
    respondError('Category not found', 404);
}

// Resolves {file} for a route: it must name an item the scan already knows, so
// nothing built from input ever reaches the filesystem.
function portfolioRequireItem($gal, $file) {
    $name = rawurldecode((string)$file);
    $it = $gal['sidecar']['items'][$name] ?? null;
    if (!$it) respondError('Item not found', 404);
    return [$name, $it];
}

// Re-reads one gallery after a write and returns its admin payload, so the UI
// always renders what is now on disk rather than what it hoped for.
function portfolioGalleryResponse($gid) {
    [$cat, $gal] = portfolioRequireGallery($gid);
    $p = portfolioGalleryPayload($cat, $gal);
    $p['items'] = portfolioGalleryItems($cat, $gal, true);
    $p['folder'] = $gal['folder'];
    $p['categoryId'] = $cat['id'];
    $p['parentId'] = $gal['parent'] ?? null;
    $p['visible'] = ($gal['sidecar']['visible'] ?? true) !== false;
    $p['access'] = portfolioAccess($gal);
    $p['hasPassword'] = !empty($gal['sidecar']['passwordHash']);
    $p['cover'] = $gal['sidecar']['cover'];
    $p['pending'] = $gal['pending'];
    $p['warnings'] = $gal['warnings'];
    $p['children'] = array_map(fn($ch) => portfolioAdminGalleryNode($cat, $ch), $gal['children'] ?? []);
    $p['childCount'] = count($gal['children'] ?? []);
    return $p;
}

// Applies sidecar changes and re-reads the tree so the response is current.
function portfolioSidecarPatch($dir, $file, callable $mutator) {
    portfolioSidecarUpdate("$dir/$file", $mutator);
    portfolioTree(true);
}

// Renames an item's file along with its poster and caption tracks, keeping the
// sidecar key, the order and the cover pointing at it.
function portfolioRenameItem($gal, $old, $new) {
    $dir = $gal['dir'];
    $it = $gal['sidecar']['items'][$old];
    $oldExt = strtolower(pathinfo($old, PATHINFO_EXTENSION));
    $new = portfolioSafeFileName($new);
    if (strtolower(pathinfo($new, PATHINFO_EXTENSION)) !== $oldExt) {
        $new = pathinfo($new, PATHINFO_FILENAME) . '.' . $oldExt;
    }
    if ($new === $old) return $old;
    $new = portfolioUniqueChildName($dir, $new);
    if (!@rename("$dir/$old", "$dir/$new")) respondError('Could not rename the file', 500);

    $stem = pathinfo($new, PATHINFO_FILENAME);
    $renames = [];
    if (!empty($it['posterFile'])) {
        $pExt = pathinfo($it['posterFile'], PATHINFO_EXTENSION);
        $renames[$it['posterFile']] = "$stem.poster.$pExt";
    }
    foreach (($it['captions'] ?? []) as $lang => $vtt) {
        $renames[$vtt] = "$stem.$lang.vtt";
    }
    foreach ($renames as $from => $to) {
        if (file_exists("$dir/$from")) @rename("$dir/$from", "$dir/" . portfolioUniqueChildName($dir, $to));
    }

    portfolioSidecarPatch($dir, '.gallery.json', function ($g) use ($old, $new) {
        if (!isset($g['items'][$old])) return $g;
        // Rebuild the map in place so the item keeps its position in `items`.
        $items = [];
        foreach ($g['items'] as $k => $v) $items[$k === $old ? $new : $k] = $v;
        $g['items'] = $items;
        $g['order'] = array_map(fn($o) => $o === $old ? $new : $o, $g['order']);
        if (($g['cover'] ?? null) === $old) $g['cover'] = $new;
        return $g;
    });
    return $new;
}

// Takes an assembled upload into a gallery folder and processes it right away,
// so a file uploaded through the admin has its thumbnail before the response
// returns — the same contract as registerGalleryItem() for delivery galleries.
// Returns ['file' => name, 'photoshelter' => null] for an ordinary photo or
// video. A PhotoShelter migration sidecar uploaded alongside the pictures it
// describes (see portfolioApplyPhotoshelterSidecar()) isn't media — it's
// saved as-is and applied to whatever's already in the gallery, and the
// result rides back as ['photoshelter' => ['matched' => N, 'total' => M]]
// instead of being scanned as an item.
function portfolioAcceptUpload($gal, $sourcePath, $originalName) {
    if (strtolower($originalName) === PORTFOLIO_PHOTOSHELTER_SIDECAR) {
        if (!@rename($sourcePath, $gal['dir'] . '/' . PORTFOLIO_PHOTOSHELTER_SIDECAR)) {
            respondError('Could not save ' . PORTFOLIO_PHOTOSHELTER_SIDECAR, 500);
        }
        @chmod($gal['dir'] . '/' . PORTFOLIO_PHOTOSHELTER_SIDECAR, 0644);
        [, $fresh] = portfolioRequireGallery($gal['id']);
        $result = portfolioApplyPhotoshelterSidecar($fresh) ?? ['matched' => 0, 'total' => 0];
        portfolioTree(true);
        return ['file' => PORTFOLIO_PHOTOSHELTER_SIDECAR, 'photoshelter' => $result];
    }
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!in_array($ext, MEDIA_EXTS, true)) respondError('Unsupported file type: .' . $ext, 400);
    $name = portfolioUniqueChildName($gal['dir'], portfolioSafeFileName($originalName));
    if (!@rename($sourcePath, $gal['dir'] . '/' . $name)) respondError('Could not move the file into the gallery folder', 500);
    @chmod($gal['dir'] . '/' . $name, 0644);

    // The file is seconds old, so name it as trusted or the scan would hold it
    // back as "still arriving".
    portfolioReconcileGallery($gal['dir'], $gal['folder'], [], [$name]);
    portfolioTree(true);
    [, $fresh] = portfolioRequireGallery($gal['id']);
    $it = $fresh['sidecar']['items'][$name] ?? null;
    if ($it) {
        $patch = portfolioProcessItem($fresh['dir'], $name, $it);
        portfolioPatchItem($fresh['dir'], $name, $patch);
        portfolioTree(true);
    }
    return ['file' => $name, 'photoshelter' => null];
}

// Categories

if ($method === 'POST' && $uri === '/api/admin/portfolio/home') {
    requireAuth();
    $dir = PORTFOLIO_DIR . '/' . PORTFOLIO_HOME_FOLDER;
    if (!is_dir($dir) && !@mkdir($dir, 0755)) respondError('Could not create the home folder', 500);
    portfolioTree(true);
    $home = portfolioTree()['home'];
    respond(['ok' => true, 'gallery' => $home ? portfolioGalleryResponse($home['id']) : null]);
}

if ($method === 'POST' && $uri === '/api/admin/portfolio/categories') {
    requireAuth();
    $name = portfolioSafeName(getInput()['name'] ?? '');
    if ($name === '') respondError('Name is required', 400);
    $name = portfolioUniqueChildName(PORTFOLIO_DIR, $name);
    if (!@mkdir(PORTFOLIO_DIR . '/' . $name, 0755)) respondError('Could not create the folder', 500);
    portfolioTree(true);
    respond(['ok' => true, 'folder' => $name]);
}

if ($method === 'PUT' && matchRoute('/api/admin/portfolio/categories/{cid}', $uri, $params)) {
    requireAuth();
    $cat = portfolioRequireCategory($params['cid']);
    $input = getInput();
    $dir = $cat['dir'];

    if (isset($input['folder'])) {
        $folder = portfolioSafeName($input['folder']);
        if ($folder === '') respondError('Name is required', 400);
        if ($folder !== $cat['folder']) {
            $folder = portfolioUniqueChildName(PORTFOLIO_DIR, $folder);
            if (!@rename($dir, PORTFOLIO_DIR . '/' . $folder)) respondError('Could not rename the folder', 500);
            $dir = PORTFOLIO_DIR . '/' . $folder;
        }
    }
    $taken = [];
    foreach (portfolioTree()['categories'] as $c) {
        if ($c['id'] !== $cat['id']) $taken[] = $c['slug'];
    }
    portfolioSidecarPatch($dir, '.category.json', function ($c) use ($input, $taken) {
        foreach (['title', 'description'] as $k) {
            if (array_key_exists($k, $input)) $c[$k] = $input[$k] === null ? null : (string)$input[$k];
        }
        if (array_key_exists('visible', $input)) $c['visible'] = (bool)$input['visible'];
        if (array_key_exists('view', $input)) $c['view'] = $input['view'] === 'page' ? 'page' : 'cards';
        if (isset($input['sort']) && is_array($input['sort'])) {
            $c['sort'] = portfolioNormalizeSort(array_merge(is_array($c['sort'] ?? null) ? $c['sort'] : [], $input['sort']), PORTFOLIO_NODE_SORTS);
        }
        if (!empty($input['slug'])) {
            $c['slug'] = portfolioUniqueSlug(portfolioSlugify($input['slug']), $taken, 'c-' . substr($c['id'], 3, 6));
        }
        return $c;
    });
    respond(['ok' => true]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/categories/{cid}', $uri, $params)) {
    requireAuth();
    $cat = portfolioRequireCategory($params['cid']);
    if (!portfolioTrash($cat['dir'], $cat['folder'])) respondError('Could not move the folder to the trash', 500);
    portfolioTree(true);
    respond(['ok' => true]);
}

// Category order, and gallery order within a category.
if ($method === 'PUT' && $uri === '/api/admin/portfolio/order') {
    requireAuth();
    $ids = (array)(getInput()['categories'] ?? []);
    portfolioSidecarPatch(PORTFOLIO_DIR, '.portfolio.json', function ($p) use ($ids) {
        $p['order'] = array_values(array_unique(array_map('strval', $ids)));
        return $p;
    });
    respond(['ok' => true]);
}

if ($method === 'PUT' && matchRoute('/api/admin/portfolio/categories/{cid}/order', $uri, $params)) {
    requireAuth();
    $cat = portfolioRequireCategory($params['cid']);
    $ids = (array)(getInput()['galleries'] ?? []);
    portfolioSidecarPatch($cat['dir'], '.category.json', function ($c) use ($ids) {
        $c['order'] = array_values(array_unique(array_map('strval', $ids)));
        return $c;
    });
    respond(['ok' => true]);
}

// Galleries

if ($method === 'POST' && $uri === '/api/admin/portfolio/galleries') {
    requireAuth();
    $input = getInput();
    // A gallery is created inside a category, inside another gallery (a
    // collection), or at the top level of the Image Library as its own gallery.
    $parentId = (string)($input['parentId'] ?? '');
    $categoryId = (string)($input['categoryId'] ?? '');
    $isTopGallery = false;
    if ($parentId !== '') {
        [$cat, $parent] = portfolioRequireGallery($parentId);
        if (!empty($parent['sidecar']['items'])) {
            respondError("A gallery can't hold other galleries — move its media into a gallery first.", 400);
        }
        $targetDir = $parent['dir'];
    } elseif ($categoryId !== '') {
        $cat = portfolioRequireCategory($categoryId);
        $targetDir = $cat['dir'];
    } else {
        $isTopGallery = true;
        $targetDir = PORTFOLIO_DIR;
    }
    $name = portfolioSafeName($input['name'] ?? '');
    if ($name === '') respondError('Name is required', 400);
    $name = portfolioUniqueChildName($targetDir, $name);
    if (!@mkdir($targetDir . '/' . $name, 0755)) respondError('Could not create the folder', 500);
    // New galleries start on the home page's layout, and carry a sidecar
    // before anything scans the tree (an empty folder would reconcile as a
    // collection first and stick that way).
    @file_put_contents($targetDir . '/' . $name . '/.gallery.json', json_encode(['layout' => portfolioDefaultLayout()]));
    if ($isTopGallery) {
        $taken = array_map(fn($c) => $c['slug'], portfolioTree(true)['categories']);
        portfolioReconcileGallery($targetDir . '/' . $name, $name, $taken);
        portfolioTree(true);
        foreach (portfolioTree()['categories'] as $c) {
            if ($c['folder'] === $name) respond(['ok' => true, 'gallery' => portfolioGalleryResponse($c['id'])]);
        }
        respond(['ok' => true]);
    }
    portfolioTree(true);
    $cat = portfolioFindCategoryBySlug($cat['slug']);
    $nodes = $parentId !== '' ? (portfolioFindGallery($parentId)[1]['children'] ?? []) : $cat['galleries'];
    foreach ($nodes as $g) {
        if ($g['folder'] === $name) respond(['ok' => true, 'gallery' => portfolioGalleryResponse($g['id'])]);
    }
    respond(['ok' => true]);
}

// Reorder a collection's child galleries (its `childOrder`), as the category
// order route does one level up.
if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}/children/order', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    $ids = (array)(getInput()['children'] ?? []);
    $have = array_map(fn($c) => $c['id'], $gal['children'] ?? []);
    $order = array_values(array_filter($ids, fn($id) => in_array($id, $have, true)));
    foreach ($have as $id) {
        if (!in_array($id, $order, true)) $order[] = $id;
    }
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($order) {
        $g['childOrder'] = $order;
        return $g;
    });
    respond(['ok' => true]);
}

if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}', $uri, $params)) {
    requireAuth();
    [$cat, $gal] = portfolioRequireGallery($params['gid']);
    $input = getInput();
    $dir = $gal['dir'];
    // The home page lives in a reserved folder, so only its contents and
    // layout are editable.
    if (!empty($gal['home'])) {
        unset($input['categoryId'], $input['parentId'], $input['folder'], $input['slug'], $input['visible'], $input['access']);
    }

    // Reparenting: move the folder inside another gallery, or back to the
    // category root. The slug only has to be unique among its new siblings, and
    // a gallery can never be moved inside itself.
    if (array_key_exists('parentId', $input)) {
        $newParent = (string)$input['parentId'];
        if ($newParent !== '') {
            [, $parent] = portfolioRequireGallery($newParent);
            $descendant = [];
            $collect = function ($nodes) use (&$collect, &$descendant) {
                foreach ($nodes as $n) { $descendant[] = $n['id']; $collect($n['children'] ?? []); }
            };
            $collect($gal['children'] ?? []);
            if ($newParent === $gal['id'] || in_array($newParent, $descendant, true)) {
                respondError("A gallery can't be moved inside itself", 400);
            }
            $targetDir = $parent['dir'];
        } else {
            // Back to a category root — the current one unless another is named.
            if (!empty($input['categoryId']) && $input['categoryId'] !== $cat['id']) {
                $cat = portfolioRequireCategory((string)$input['categoryId']);
            }
            $targetDir = $cat['dir'];
        }
        if (rtrim(dirname($dir), '/') !== rtrim($targetDir, '/')) {
            $folder = portfolioUniqueChildName($targetDir, $gal['folder']);
            if (!@rename($dir, $targetDir . '/' . $folder)) respondError('Could not move the gallery', 500);
            $dir = $targetDir . '/' . $folder;
        }
    }

    // Moving to another category is a folder move; the slug only has to be
    // unique among its new siblings.
    if (!array_key_exists('parentId', $input) && !empty($input['categoryId']) && $input['categoryId'] !== $cat['id']) {
        $target = portfolioRequireCategory((string)$input['categoryId']);
        $folder = portfolioUniqueChildName($target['dir'], $gal['folder']);
        if (!@rename($dir, $target['dir'] . '/' . $folder)) respondError('Could not move the gallery', 500);
        $dir = $target['dir'] . '/' . $folder;
        $cat = $target;
    }
    if (isset($input['folder'])) {
        $folder = portfolioSafeName($input['folder']);
        if ($folder === '') respondError('Name is required', 400);
        if ($folder !== basename($dir)) {
            $folder = portfolioUniqueChildName($cat['dir'], $folder);
            if (!@rename($dir, $cat['dir'] . '/' . $folder)) respondError('Could not rename the folder', 500);
            $dir = $cat['dir'] . '/' . $folder;
        }
    }
    $taken = [];
    if (!empty($input['parentId'])) {
        [, $parent] = portfolioRequireGallery((string)$input['parentId']);
        foreach ($parent['children'] ?? [] as $c) {
            if ($c['id'] !== $gal['id']) $taken[] = $c['slug'];
        }
    } else {
        foreach ($cat['galleries'] as $g) {
            if ($g['id'] !== $gal['id']) $taken[] = $g['slug'];
        }
    }
    $keys = array_merge(array_keys($gal['sidecar']['items']), array_keys($gal['sidecar']['refs'] ?? []));
    portfolioSidecarPatch($dir, '.gallery.json', function ($g) use ($input, $taken, $keys) {
        foreach (['title', 'description'] as $k) {
            if (array_key_exists($k, $input)) $g[$k] = $input[$k] === null ? null : (string)$input[$k];
        }
        if (array_key_exists('visible', $input)) {
            $g['visible'] = (bool)$input['visible'];
            $g['access'] = $g['visible'] ? ($g['access'] === 'hidden' ? 'public' : $g['access']) : 'hidden';
        }
        if (in_array($input['access'] ?? '', PORTFOLIO_ACCESS, true)) {
            $g['access'] = $input['access'];
            $g['visible'] = $g['access'] !== 'hidden';
        }
        // An empty string clears the password; anything else replaces it.
        if (array_key_exists('password', $input)) {
            $pw = (string)$input['password'];
            $g['passwordHash'] = $pw === '' ? '' : password_hash($pw, PASSWORD_BCRYPT);
        }
        // Password protection with no password would just be unlisted.
        if ($g['access'] === 'password' && empty($g['passwordHash'])) $g['access'] = 'unlisted';
        if (!empty($input['layout']) && in_array($input['layout'], PORTFOLIO_LAYOUTS, true)) $g['layout'] = $input['layout'];
        // Merged, not replaced: the editor sends the field you changed, so a
        // tab left open with older values can't quietly undo the rest.
        if (array_key_exists('hero', $input)) {
            $h = is_array($input['hero']) ? $input['hero'] : [];
            $current = is_array($g['hero'] ?? null) ? $g['hero'] : [];
            if (array_key_exists('file', $h) && (string)$h['file'] === '') {
                $g['hero'] = null;
            } else {
                $next = array_merge(['file' => '', 'title' => '', 'subtitle' => '', 'height' => 'full', 'only' => false], $current);
                if (isset($h['file'])) $next['file'] = (string)$h['file'];
                if (isset($h['title'])) $next['title'] = mb_substr((string)$h['title'], 0, 160);
                if (isset($h['subtitle'])) $next['subtitle'] = mb_substr((string)$h['subtitle'], 0, 200);
                if (isset($h['height'])) $next['height'] = $h['height'] === 'large' ? 'large' : 'full';
                if (array_key_exists('only', $h)) $next['only'] = !empty($h['only']);
                $g['hero'] = $next['file'] === '' ? null : $next;
            }
        }
        if (isset($input['options']) && is_array($input['options'])) {
            $g['options'] = portfolioNormalizeOptions(array_merge($g['options'] ?? [], $input['options']));
        }
        if (isset($input['sort']) && is_array($input['sort'])) {
            $g['sort'] = portfolioNormalizeSort(array_merge(is_array($g['sort'] ?? null) ? $g['sort'] : [], $input['sort']), array_merge(PORTFOLIO_ITEM_SORTS, PORTFOLIO_NODE_SORTS));
        }
        if (array_key_exists('cover', $input)) {
            $cover = $input['cover'] === null ? null : (string)$input['cover'];
            $g['cover'] = ($cover !== null && in_array($cover, $keys, true)) ? $cover : null;
        }
        if (!empty($input['slug'])) {
            $g['slug'] = portfolioUniqueSlug(portfolioSlugify($input['slug']), $taken, 'g-' . substr($g['id'], 3, 6));
        }
        if (!empty($input['description']) && mb_strlen($g['description']) > DESCRIPTION_MAX_LEN) {
            $g['description'] = mb_substr($g['description'], 0, DESCRIPTION_MAX_LEN);
        }
        return $g;
    });
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/galleries/{gid}', $uri, $params)) {
    requireAuth();
    [$cat, $gal] = portfolioRequireGallery($params['gid']);
    if (!empty($gal['home'])) respondError('The home page can be emptied, but not deleted', 400);
    if (!portfolioTrash($gal['dir'], $cat['folder'] . ' - ' . $gal['folder'])) {
        respondError('Could not move the folder to the trash', 500);
    }
    foreach ($gal['sidecar']['items'] as $it) {
        if (!empty($it['id'])) portfolioDropDerivatives($it['id']);
    }
    portfolioTree(true);
    respond(['ok' => true]);
}

// Item order within a gallery, including section headers.
if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}/order', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    $order = array_map('strval', (array)(getInput()['order'] ?? []));
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($order) {
        $kept = [];
        foreach ($order as $key) {
            if (!isset($kept[$key]) && (isset($g['items'][$key]) || isset($g['headers'][$key]) || isset($g['refs'][$key]))) $kept[$key] = true;
        }
        // Anything the client didn't mention keeps its place at the end, so a
        // stale list can never make items disappear.
        foreach ($g['order'] as $key) {
            if (!isset($kept[$key])) $kept[$key] = true;
        }
        $g['order'] = array_keys($kept);
        return $g;
    });
    respond(['ok' => true]);
}

// Re-applies a gallery's _photoshelter.json to items already in the
// gallery — not just newly discovered ones. portfolioReconcileGallery()'s
// automatic pass only ever looks at a file the first time it's scanned, so
// if the sidecar lands after that (dropped in later, or — see
// portfolioAcceptUpload() — uploaded in the same batch as the pictures it
// describes, in whatever order the browser happened to send them), its
// visible/display_order never took effect on its own. This re-applies it to
// every item currently in the gallery that the sidecar mentions.
function portfolioApplyPhotoshelterSidecar($gal) {
    $psMeta = portfolioPhotoshelterMeta($gal['dir']);
    if (!$psMeta) return null;
    $matched = 0;
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($psMeta, &$matched) {
        foreach ($g['items'] as $name => &$it) {
            $meta = portfolioPhotoshelterMetaFor($psMeta, $name);
            if ($meta === null) continue;
            $matched++;
            $it['visible'] = $meta['visible'];
        }
        unset($it);
        $kept = [];
        foreach (portfolioPhotoshelterSort(array_keys($g['items']), $psMeta) as $name) { $kept[$name] = true; }
        // Section headers and picks aren't part of a PhotoShelter gallery;
        // keep them, placed after the sorted items, rather than drop them.
        foreach ($g['order'] as $key) {
            if (!isset($kept[$key]) && (isset($g['headers'][$key]) || isset($g['refs'][$key]))) $kept[$key] = true;
        }
        $g['order'] = array_keys($kept);
        return $g;
    });
    return ['matched' => $matched, 'total' => count($psMeta)];
}

if ($method === 'POST' && matchRoute('/api/admin/portfolio/galleries/{gid}/photoshelter-sync', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    $result = portfolioApplyPhotoshelterSidecar($gal);
    if ($result === null) respondError('No ' . PORTFOLIO_PHOTOSHELTER_SIDECAR . ' found in this gallery\'s folder.', 404);
    respond(['ok' => true, 'matched' => $result['matched'], 'total' => $result['total'], 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// Items

// Galleries a file also appears in — picks elsewhere that point at this
// gallery + file. Drives the "Appears in" list on the item's Details screen.
function portfolioItemAppearances($gid, $file) {
    $out = [];
    foreach (portfolioAllNodes() as [$cat, $node]) {
        if (($node['id'] ?? null) === $gid) continue;
        foreach (($node['sidecar']['refs'] ?? []) as $ref) {
            if (($ref['gallery'] ?? null) === $gid && ($ref['file'] ?? null) === $file) {
                $out[] = ['id' => $node['id'], 'title' => portfolioTitle($node)];
                break;
            }
        }
    }
    return $out;
}

if ($method === 'GET' && matchRoute('/api/admin/portfolio/galleries/{gid}/items/{file}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    $file = $params['file'];
    if (!isset($gal['sidecar']['items'][$file])) respondError('File not found', 404);
    $meta = portfolioItemMeta($gal, $file, $gal['sidecar']['items'][$file]);
    $meta['appearances'] = portfolioItemAppearances($gal['id'], $file);
    respond($meta);
}

if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}/items/{file}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    [$name] = portfolioRequireItem($gal, $params['file']);
    $input = getInput();

    if (!empty($input['rename'])) {
        $name = portfolioRenameItem($gal, $name, (string)$input['rename']);
        [, $gal] = portfolioRequireGallery($params['gid']);
    }
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($name, $input) {
        if (!isset($g['items'][$name])) return $g;
        $it = &$g['items'][$name];
        if (array_key_exists('title', $input)) $it['title'] = mb_substr((string)$input['title'], 0, 200);
        if (array_key_exists('description', $input)) $it['description'] = mb_substr((string)$input['description'], 0, DESCRIPTION_MAX_LEN);
        if (array_key_exists('visible', $input)) $it['visible'] = (bool)$input['visible'];
        if (in_array($input['tile'] ?? '', PORTFOLIO_TILE_SIZES, true)) $it['tile'] = $input['tile'];
        unset($it);
        return $g;
    });
    respond(['ok' => true, 'file' => $name, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/galleries/{gid}/items/{file}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    [$name, $it] = portfolioRequireItem($gal, $params['file']);
    $dir = $gal['dir'];
    portfolioTrash("$dir/$name", $gal['folder'] . ' - ' . $name);
    if (!empty($it['posterFile'])) portfolioTrash("$dir/{$it['posterFile']}", $it['posterFile']);
    foreach (($it['captions'] ?? []) as $vtt) portfolioTrash("$dir/$vtt", $vtt);
    if (!empty($it['id'])) portfolioDropDerivatives($it['id']);
    // The scan drops the entry now that the file is gone.
    portfolioReconcileGallery($dir, $gal['folder'], []);
    portfolioTree(true);
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// A poster frame captured in the browser, since prod has no ffmpeg. The body is
// the raw JPEG; ?w= and ?h= carry the video's real size, which nothing else on
// the server can tell us for formats the MP4 reader doesn't cover.
if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}/items/{file}/poster', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    [$name, $it] = portfolioRequireItem($gal, $params['file']);
    if (($it['type'] ?? '') !== 'video') respondError('Only videos take a poster', 400);

    $raw = file_get_contents('php://input');
    if (strlen($raw) < 100) respondError('Empty image', 400);
    $tmp = UPLOAD_TMP_DIR . '/poster-' . bin2hex(random_bytes(8)) . '.jpg';
    file_put_contents($tmp, $raw);
    $info = @getimagesize($tmp);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
        @unlink($tmp);
        respondError('Not a readable image', 400);
    }
    $id = $it['id'];
    $ok = generatePhotoThumbnail($tmp, THUMBS_DIR . "/$id.jpg") && generatePhotoProxy($tmp, PROXY_DIR . "/{$id}_proxy.jpg");
    @unlink($tmp);
    if (!$ok) respondError('Could not save the poster', 500);

    $w = (int)($_GET['w'] ?? 0);
    $h = (int)($_GET['h'] ?? 0);
    portfolioPatchItem($gal['dir'], $name, array_filter([
        'thumb' => time(),
        'thumbSource' => 'capture',
        'thumbOf' => (int)($it['mtime'] ?? 0),
        'width' => $w > 0 ? $w : ($it['width'] ?? 0),
        'height' => $h > 0 ? $h : ($it['height'] ?? 0),
        'error' => null,
    ], fn($v) => $v !== null));
    portfolioTree(true);
    respond(['ok' => true]);
}

// Caption tracks are stored beside the video as <name>.<lang>.vtt, the same
// convention an FTP upload uses.
if ($method === 'POST' && matchRoute('/api/admin/portfolio/galleries/{gid}/items/{file}/captions', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    [$name, $it] = portfolioRequireItem($gal, $params['file']);
    if (($it['type'] ?? '') !== 'video') respondError('Only videos take captions', 400);
    if (empty($_FILES['file'])) respondError('No file uploaded', 400);

    $lang = normalizeCaptionLang($_POST['lang'] ?? '');
    if ($lang === '') respondError('Pick a language for the caption track', 400);
    $content = file_get_contents($_FILES['file']['tmp_name']);
    if (strpos(ltrim($content, "\xEF\xBB\xBF"), 'WEBVTT') !== 0) respondError('That file is not WebVTT (it must start with WEBVTT)', 400);
    $content = vttAutoShift($content, (float)($it['duration'] ?? 0));

    $dir = $gal['dir'];
    $target = pathinfo($name, PATHINFO_FILENAME) . ".$lang.vtt";
    if (file_put_contents("$dir/$target", $content) === false) respondError('Could not save the caption file', 500);
    $label = trim((string)($_POST['label'] ?? ''));
    portfolioSidecarPatch($dir, '.gallery.json', function ($g) use ($name, $lang, $label) {
        if (!isset($g['items'][$name])) return $g;
        if ($label !== '') $g['items'][$name]['captionLabels'][$lang] = $label;
        return $g;
    });
    portfolioReconcileGallery($dir, $gal['folder'], []);
    portfolioTree(true);
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/galleries/{gid}/items/{file}/captions/{lang}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    [$name, $it] = portfolioRequireItem($gal, $params['file']);
    $lang = normalizeCaptionLang($params['lang']);
    $vtt = $it['captions'][$lang] ?? null;
    if (!$vtt) respondError('No caption track in that language', 404);
    portfolioTrash($gal['dir'] . "/$vtt", $vtt);
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($name, $lang) {
        unset($g['items'][$name]['captionLabels'][$lang]);
        return $g;
    });
    portfolioReconcileGallery($gal['dir'], $gal['folder'], []);
    portfolioTree(true);
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// Section headers live only in the sidecar: they have no file on disk.
if ($method === 'POST' && matchRoute('/api/admin/portfolio/galleries/{gid}/headers', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    $text = mb_substr(trim((string)(getInput()['text'] ?? '')), 0, 200);
    if ($text === '') respondError('Section text is required', 400);
    $hid = generateId('h_');
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($hid, $text) {
        $g['headers'][$hid] = ['text' => $text];
        array_unshift($g['order'], $hid);
        return $g;
    });
    respond(['ok' => true, 'id' => $hid, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}/headers/{hid}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    if (!isset($gal['sidecar']['headers'][$params['hid']])) respondError('Section not found', 404);
    $text = mb_substr(trim((string)(getInput()['text'] ?? '')), 0, 200);
    if ($text === '') respondError('Section text is required', 400);
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($params, $text) {
        $g['headers'][$params['hid']]['text'] = $text;
        return $g;
    });
    respond(['ok' => true]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/galleries/{gid}/headers/{hid}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($params) {
        unset($g['headers'][$params['hid']]);
        $g['order'] = array_values(array_filter($g['order'], fn($o) => $o !== $params['hid']));
        return $g;
    });
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// Add picks: files that live in another gallery and are shown here too. Only a
// real file can be picked, so a pick never points at another pick.
if ($method === 'POST' && matchRoute('/api/admin/portfolio/galleries/{gid}/refs', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    if (!empty($gal['children'])) respondError('Collections hold galleries, not media — add this to a gallery instead.', 400);
    $picks = (array)(getInput()['items'] ?? []);
    if (!$picks) respondError('Nothing to add', 400);
    $add = [];
    foreach ($picks as $p) {
        $sourceId = (string)($p['galleryId'] ?? '');
        $file = (string)($p['file'] ?? '');
        $found = portfolioFindGallery($sourceId);
        if (!$found) respondError('That gallery is gone', 404);
        [, $src] = $found;
        if (!isset($src['sidecar']['items'][$file])) respondError('That file is gone: ' . $file, 404);
        if ($src['id'] === $gal['id']) respondError('That file is already in this gallery', 400);
        $add[generateId('r_')] = ['gallery' => $src['id'], 'file' => $file, 'visible' => true];
    }
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($add) {
        foreach ($add as $key => $ref) {
            $g['refs'][$key] = $ref;
            $g['order'][] = $key;
        }
        return $g;
    });
    respond(['ok' => true, 'added' => count($add), 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// A pick's own title, caption box and visibility, which override the source's.
if ($method === 'PUT' && matchRoute('/api/admin/portfolio/galleries/{gid}/refs/{key}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    if (!isset($gal['sidecar']['refs'][$params['key']])) respondError('Pick not found', 404);
    $input = getInput();
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($params, $input) {
        $ref = &$g['refs'][$params['key']];
        if (array_key_exists('title', $input)) $ref['title'] = mb_substr((string)$input['title'], 0, 200);
        if (array_key_exists('description', $input)) $ref['description'] = mb_substr((string)$input['description'], 0, DESCRIPTION_MAX_LEN);
        if (array_key_exists('visible', $input)) $ref['visible'] = (bool)$input['visible'];
        if (in_array($input['tile'] ?? '', PORTFOLIO_TILE_SIZES, true)) $ref['tile'] = $input['tile'];
        unset($ref);
        return $g;
    });
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// Removing a pick leaves the file itself alone, wherever it lives.
if ($method === 'DELETE' && matchRoute('/api/admin/portfolio/galleries/{gid}/refs/{key}', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($params) {
        unset($g['refs'][$params['key']]);
        $g['order'] = array_values(array_filter($g['order'], fn($o) => $o !== $params['key']));
        return $g;
    });
    respond(['ok' => true, 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// Small uploads in one request; larger ones go through /api/admin/uploads and
// finalize with portfolioGalleryId.
if ($method === 'POST' && matchRoute('/api/admin/portfolio/galleries/{gid}/files', $uri, $params)) {
    requireAuth();
    [, $gal] = portfolioRequireGallery($params['gid']);
    if (!empty($gal['children'])) respondError('Collections hold galleries, not media — add this to a gallery instead.', 400);
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) respondError('No file uploaded', 400);
    $tmp = UPLOAD_TMP_DIR . '/' . bin2hex(random_bytes(8)) . '.part';
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $tmp)) respondError('Could not read the upload', 500);
    $result = portfolioAcceptUpload($gal, $tmp, $_FILES['file']['name']);
    respond(['ok' => true, 'file' => $result['file'], 'photoshelter' => $result['photoshelter'], 'gallery' => portfolioGalleryResponse($params['gid'])]);
}

// One slice of derivative work; the admin calls it again while `remaining` > 0.
if ($method === 'POST' && $uri === '/api/admin/portfolio/process') {
    requireAuth();
    $input = getInput();
    respond(portfolioProcess($input['galleryId'] ?? null, PORTFOLIO_PROCESS_SLICE_SECONDS));
}

// ============================================================
// PAGES (about, contact, and anything else that isn't a gallery)
// ============================================================
//
// Plain pages kept in site-data/data/pages.json: a title, some text, an
// optional picture, and a type. A "contact" page also renders a form that
// emails the address in Settings > Email. Pictures live in the reserved
// portfolio folder _pages, so they are served by the same /media/ rules as
// everything else and need no new .htaccess.

function readPages() { return jsonRead(PAGES_PATH) ?: []; }
function writePages($pages) { jsonWrite(PAGES_PATH, array_values($pages)); }

// A page's body comes from the admin's rich-text editor, not the public, but
// it is rendered straight into the public page — so this is an allowlist
// sanitizer, not a blocklist: only tags/attributes the editor can actually
// produce (bold/italic/underline, lists, links, tables) survive, every
// attribute value is the browser-decoded form (so entity-encoded payloads
// can't slip past it the way a regex on raw markup could), and href/src
// schemes are restricted to http(s)/mailto/relative.
function portfolioUrlSchemeSafe($url) {
    $url = trim((string)$url);
    if ($url === '' || $url[0] === '#' || $url[0] === '/' || $url[0] === '.') return true;
    if (preg_match('/^([a-z][a-z0-9+.\-]*):/i', $url, $m)) {
        return in_array(strtolower($m[1]), ['http', 'https', 'mailto'], true);
    }
    return true;
}

function sanitizePageBody($html) {
    $html = trim((string)$html);
    if ($html === '') return '';

    $allowedTags = [
        'p' => [], 'br' => [], 'b' => [], 'strong' => [], 'i' => [], 'em' => [],
        'u' => [], 's' => [], 'sub' => [], 'sup' => [], 'blockquote' => [], 'pre' => [],
        'code' => [], 'hr' => [], 'div' => [], 'span' => [],
        'h1' => [], 'h2' => [], 'h3' => [], 'h4' => [], 'h5' => [], 'h6' => [],
        'ul' => [], 'ol' => [], 'li' => [],
        'a' => ['href', 'target', 'rel'],
        'img' => ['src', 'alt', 'width', 'height'],
        'table' => [], 'thead' => [], 'tbody' => [], 'tr' => [],
        'td' => ['colspan', 'rowspan'], 'th' => ['colspan', 'rowspan'],
    ];
    $urlAttrs = ['href' => true, 'src' => true];

    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="utf-8"?><div id="pfa-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    $root = $doc->getElementById('pfa-root');
    if (!$root) return '';

    $strip = function (DOMNode $node) use (&$strip, $allowedTags, $urlAttrs, $doc) {
        $children = [];
        foreach ($node->childNodes as $child) $children[] = $child;
        foreach ($children as $child) {
            if ($child instanceof DOMComment || $child instanceof DOMProcessingInstruction) {
                $node->removeChild($child);
                continue;
            }
            if (!($child instanceof DOMElement)) continue;
            $tag = strtolower($child->tagName);
            if (!isset($allowedTags[$tag])) {
                // Unknown/dangerous tag (script, style, iframe, svg, event-bearing
                // custom elements, ...): drop it, keeping only its text content.
                while ($child->firstChild) $node->insertBefore($child->firstChild, $child);
                $node->removeChild($child);
                continue;
            }
            foreach (iterator_to_array($child->attributes) as $attr) {
                $name = strtolower($attr->name);
                if (!in_array($name, $allowedTags[$tag], true)) {
                    $child->removeAttribute($attr->name);
                } elseif (isset($urlAttrs[$name]) && !portfolioUrlSchemeSafe($attr->value)) {
                    $child->removeAttribute($attr->name);
                }
            }
            $strip($child);
        }
    };
    $strip($root);

    $out = '';
    foreach ($root->childNodes as $child) $out .= $doc->saveHTML($child);
    return trim($out);
}

function pagePayload($p, $admin = false) {
    $out = [
        'id' => $p['id'],
        'slug' => $p['slug'],
        'title' => $p['title'],
        'type' => $p['type'] ?? 'text',
        'body' => $p['body'] ?? '',
        'image' => $p['image'] ?? null,
        'url' => '/p/' . rawurlencode($p['slug']),
    ];
    if ($admin) $out['visible'] = ($p['visible'] ?? true) !== false;
    return $out;
}

function findPage($needle, $byId = false) {
    foreach (readPages() as $p) {
        if ($byId ? $p['id'] === $needle : $p['slug'] === $needle) return $p;
    }
    return null;
}

// Unique across pages, and never a slug the router already uses.
function pageUniqueSlug($title, $exceptId = null) {
    $taken = ['admin', 'gallery', 'collection', 'portfolio', 'media', 'api', 'p', 'd'];
    foreach (readPages() as $p) {
        if ($p['id'] !== $exceptId) $taken[] = $p['slug'];
    }
    return portfolioUniqueSlug(portfolioSlugify($title), $taken, 'page');
}

// --- Public ---

if ($method === 'GET' && $uri === '/api/pages') {
    $out = [];
    foreach (readPages() as $p) {
        if (($p['visible'] ?? true) !== false) $out[] = ['slug' => $p['slug'], 'title' => $p['title'], 'url' => '/p/' . rawurlencode($p['slug'])];
    }
    respond(['pages' => $out]);
}

if ($method === 'GET' && matchRoute('/api/pages/{slug}', $uri, $params)) {
    $p = findPage(rawurldecode($params['slug']));
    if (!$p || ($p['visible'] ?? true) === false) respondError('Not found', 404);
    respond(['page' => pagePayload($p)]);
}

// The contact form. Rate limited per address, with a honeypot field browsers
// leave empty and bots fill in.
if ($method === 'POST' && $uri === '/api/contact') {
    $input = getInput();
    if (!empty($input['website'])) respond(['ok' => true]);   // bot: accept and drop
    rateLimitCheck('contact:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 5, 3600);

    $name = trim(mb_substr((string)($input['name'] ?? ''), 0, 120));
    $from = trim(mb_substr((string)($input['email'] ?? ''), 0, 200));
    $message = trim(mb_substr((string)($input['message'] ?? ''), 0, 5000));
    if ($name === '' || $message === '') respondError('Please fill in your name and a message', 400);
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) respondError('Please enter a valid email address', 400);

    $config = getEmailConfig();
    $to = $config['adminEmail'] ?: $config['from'];
    if (!$to) respondError('This site has no contact address configured yet', 503);

    $subject = emailSubject('Message from the website', $name);
    $text = "From: $name <$from>\n\n$message";
    $html = emailShell([
        'title' => 'New message from your site',
        'lead' => escHtml($name) . ' &lt;' . escHtml($from) . '&gt;',
        'body' => '<p style="white-space:pre-wrap">' . escHtml($message) . '</p>',
    ]);
    try {
        sendEmail($to, $subject, $text, $html, $from);
    } catch (Exception $e) {
        error_log('Contact form email failed: ' . $e->getMessage());
        respondError('Could not send the message. Please email directly instead.', 502);
    }
    respond(['ok' => true]);
}

// --- Admin ---

if ($method === 'GET' && $uri === '/api/admin/pages') {
    requireAuth();
    respond(['pages' => array_map(fn($p) => pagePayload($p, true), readPages())]);
}

if ($method === 'POST' && $uri === '/api/admin/pages') {
    requireAuth();
    $input = getInput();
    $title = trim(mb_substr((string)($input['title'] ?? ''), 0, 120));
    if ($title === '') respondError('Give the page a title', 400);
    $page = [
        'id' => generateId('pp_'),
        'slug' => pageUniqueSlug($title),
        'title' => $title,
        'type' => ($input['type'] ?? '') === 'contact' ? 'contact' : 'text',
        'body' => '',
        'image' => null,
        'visible' => true,
        'updatedAt' => date('c'),
    ];
    $pages = readPages();
    $pages[] = $page;
    writePages($pages);
    respond(['ok' => true, 'page' => pagePayload($page, true)]);
}

if ($method === 'PUT' && matchRoute('/api/admin/pages/{id}', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $pages = readPages();
    $found = null;
    foreach ($pages as &$p) {
        if ($p['id'] !== $params['id']) continue;
        if (isset($input['title']) && trim($input['title']) !== '') $p['title'] = mb_substr(trim($input['title']), 0, 120);
        if (isset($input['body'])) $p['body'] = sanitizePageBody(mb_substr((string)$input['body'], 0, 50000));
        if (array_key_exists('image', $input)) $p['image'] = $input['image'] ?: null;
        if (array_key_exists('visible', $input)) $p['visible'] = (bool)$input['visible'];
        if (!empty($input['slug'])) $p['slug'] = pageUniqueSlug((string)$input['slug'], $p['id']);
        if (isset($input['type'])) $p['type'] = $input['type'] === 'contact' ? 'contact' : 'text';
        $p['updatedAt'] = date('c');
        $found = $p;
        break;
    }
    unset($p);
    if (!$found) respondError('Page not found', 404);
    writePages($pages);
    respond(['ok' => true, 'page' => pagePayload($found, true)]);
}

if ($method === 'DELETE' && matchRoute('/api/admin/pages/{id}', $uri, $params)) {
    requireAuth();
    $pages = array_values(array_filter(readPages(), fn($p) => $p['id'] !== $params['id']));
    writePages($pages);
    respond(['ok' => true]);
}

// A page's picture goes into the reserved _pages folder, so /media/ serves it
// like any other portfolio file.
if ($method === 'POST' && matchRoute('/api/admin/pages/{id}/image', $uri, $params)) {
    requireAuth();
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) respondError('No file uploaded', 400);
    if (!isImageFile($_FILES['file']['name'])) respondError('Pick an image file', 400);
    $dir = PORTFOLIO_DIR . '/' . PORTFOLIO_PAGES_FOLDER;
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) respondError('Could not create the folder', 500);
    $name = portfolioUniqueChildName($dir, portfolioSafeFileName($_FILES['file']['name']));
    if (!move_uploaded_file($_FILES['file']['tmp_name'], "$dir/$name")) respondError('Could not save the image', 500);
    @chmod("$dir/$name", 0644);
    $url = portfolioMediaUrl(PORTFOLIO_PAGES_FOLDER, $name);

    $pages = readPages();
    foreach ($pages as &$p) {
        if ($p['id'] === $params['id']) { $p['image'] = $url; $p['updatedAt'] = date('c'); }
    }
    unset($p);
    writePages($pages);
    respond(['ok' => true, 'image' => $url]);
}

// ============================================================
// MIGRATION: reels galleries -> portfolio folders
// ============================================================
//
// Reels galleries were the portfolio before folders existed. This moves each
// one into site-data/portfolio/<Category>/<Gallery>/ and leaves the old record
// behind, archived, so nothing is destroyed and old links keep working.
//
// It runs one gallery per request from the admin, recording progress in
// DATA_DIR/portfolio-migration.json so a timeout resumes instead of starting
// over, and it never runs on its own: moving a photographer's masters should be
// something someone chose to do.

function migrationState() {
    $s = jsonRead(MIGRATION_PATH) ?: [];
    return [
        'done' => is_array($s['done'] ?? null) ? $s['done'] : [],
        'map' => is_array($s['map'] ?? null) ? $s['map'] : [],
        'tokens' => is_array($s['tokens'] ?? null) ? $s['tokens'] : [],
        'startedAt' => $s['startedAt'] ?? null,
        'finishedAt' => $s['finishedAt'] ?? null,
        'backup' => $s['backup'] ?? null,
    ];
}

function writeMigrationState($s) { jsonWrite(MIGRATION_PATH, $s); }

// Reels galleries that still hold items. An archived one has already moved.
function migrationPending() {
    $out = [];
    $state = migrationState();
    foreach (readGalleries() as $g) {
        if (($g['type'] ?? '') !== 'reels' || !empty($g['archived'])) continue;
        if (in_array($g['id'], $state['done'], true)) continue;
        $out[] = $g;
    }
    return $out;
}

// A live delivery package pointing at a reels gallery would break the moment
// its files move, so migration waits for those to expire.
function migrationBlockers() {
    $blockers = [];
    $reels = [];
    foreach (readGalleries() as $g) {
        if (($g['type'] ?? '') === 'reels') $reels[$g['id']] = $g['name'];
    }
    foreach (glob(PACKAGES_DIR . '/*/manifest.json') ?: [] as $path) {
        $m = jsonRead($path);
        if (!$m || ($m['expiresAt'] ?? 0) < time()) continue;
        $source = $m['sourceId'] ?? '';
        if (isset($reels[$source])) $blockers[] = $reels[$source] . ' — delivery "' . ($m['name'] ?? $source) . '"';
    }
    return $blockers;
}

// Copies the files a migration could disturb, so a wrong turn is recoverable
// without touching a backup tape.
function migrationBackup() {
    $dir = DATA_DIR . '/backup-pre-portfolio-' . date('Ymd-His');
    if (!@mkdir($dir, 0755, true)) return null;
    foreach (['galleries.json', 'collections.json', 'header.json', 'settings.json'] as $f) {
        if (file_exists(DATA_DIR . '/' . $f)) @copy(DATA_DIR . '/' . $f, "$dir/$f");
    }
    foreach (readGalleries() as $g) {
        if (($g['type'] ?? '') !== 'reels') continue;
        $src = galleryDir($g['id']) . '/videos.json';
        if (file_exists($src)) @copy($src, $dir . '/videos-' . $g['id'] . '.json');
    }
    return basename($dir);
}

// Which category a reels gallery lands in: the reels collection it belongs to,
// or "Portfolio" for the ungrouped ones.
function migrationCategoryFor($gallery) {
    $name = 'Portfolio';
    foreach (readCollections() as $col) {
        if (collectionType($col) !== 'reels') continue;
        if (in_array($gallery['id'], $col['galleryIds'] ?? [], true)) { $name = $col['name']; break; }
    }
    $folder = portfolioSafeName($name) ?: 'Portfolio';
    foreach (portfolioTree()['categories'] as $cat) {
        if (strcasecmp($cat['folder'], $folder) === 0) return $cat;
    }
    @mkdir(PORTFOLIO_DIR . '/' . $folder, 0755, true);
    portfolioTree(true);
    foreach (portfolioTree()['categories'] as $cat) {
        if ($cat['folder'] === $folder) return $cat;
    }
    return null;
}

// Moves one gallery: its files, their derivatives, captions, titles, caption
// boxes, section headers and order.
function migrateOneGallery($gallery) {
    $cat = migrationCategoryFor($gallery);
    if (!$cat) return ['ok' => false, 'error' => 'Could not create the category folder'];

    $folder = portfolioUniqueChildName($cat['dir'], portfolioSafeName($gallery['name']) ?: 'Gallery');
    $dir = $cat['dir'] . '/' . $folder;
    if (!@mkdir($dir, 0755, true)) return ['ok' => false, 'error' => 'Could not create ' . $folder];

    $items = [];
    $order = [];
    $headers = [];
    $moved = 0;
    $captionsMoved = 0;

    foreach (readGalleryVideos($gallery['id']) as $v) {
        if (($v['type'] ?? '') === 'header') {
            $hid = $v['id'] ?: generateId('h_');
            $headers[$hid] = ['text' => (string)($v['text'] ?? '')];
            $order[] = $hid;
            continue;
        }
        $stored = (string)($v['filename'] ?? '');
        $src = UPLOADS_DIR . '/' . basename($stored);
        if ($stored === '' || !is_file($src)) continue;

        // The stored name carries an upload timestamp; the title is what the
        // owner actually called it.
        $ext = strtolower(pathinfo($stored, PATHINFO_EXTENSION));
        $base = portfolioSafeName((string)($v['title'] ?? '')) ?: portfolioSafeName(pathinfo($stored, PATHINFO_FILENAME));
        $name = portfolioUniqueChildName($dir, ($base ?: 'file') . ($ext ? ".$ext" : ''));
        if (!@rename($src, "$dir/$name")) continue;
        $moved++;

        $mtime = (int)@filemtime("$dir/$name");
        $isPhoto = isImageFile($name);
        $id = (string)($v['id'] ?? '') ?: generateId($isPhoto ? 'p_' : 'v_');
        $item = [
            'id' => $id,
            'type' => $isPhoto ? 'photo' : 'video',
            'title' => (string)($v['title'] ?? ''),
            'description' => (string)($v['description'] ?? ''),
            'visible' => ($v['visible'] ?? true) !== false,
            'width' => (int)($v['width'] ?? 0),
            'height' => (int)($v['height'] ?? 0),
            'size' => (int)@filesize("$dir/$name"),
            'mtime' => $mtime,
            'addedAt' => $v['createdAt'] ?? date('c'),
        ];

        // Thumbnails and proxies are named after the item id, which came with
        // it, so nothing has to be rebuilt.
        $hasThumb = !empty($v['thumbnail']) && is_file(THUMBS_DIR . '/' . basename($v['thumbnail']));
        if ($hasThumb && basename($v['thumbnail']) !== "$id.jpg") {
            @copy(THUMBS_DIR . '/' . basename($v['thumbnail']), THUMBS_DIR . "/$id.jpg");
        }
        if ($isPhoto) {
            $item['thumb'] = is_file(THUMBS_DIR . "/$id.jpg") ? $mtime : 0;
            $item['proxy'] = is_file(PROXY_DIR . "/{$id}_proxy.jpg") ? $mtime : 0;
        } else {
            $item['duration'] = (float)($v['duration'] ?? 0);
            $item['metaOf'] = $mtime;
            $item['thumb'] = is_file(THUMBS_DIR . "/$id.jpg") ? time() : 0;
            $item['thumbSource'] = 'capture';
            $item['thumbOf'] = $mtime;
            $item['captionLabels'] = [];
            foreach (($v['captions'] ?? []) as $c) {
                $lang = normalizeCaptionLang($c['lang'] ?? '');
                $from = CAPTIONS_DIR . '/' . basename($c['filename'] ?? '');
                if ($lang === '' || !is_file($from)) continue;
                $target = pathinfo($name, PATHINFO_FILENAME) . ".$lang.vtt";
                if (@rename($from, "$dir/$target")) {
                    $captionsMoved++;
                    if (!empty($c['label'])) $item['captionLabels'][$lang] = $c['label'];
                }
            }
        }
        $items[$name] = $item;
        $order[] = $name;
        // The file left uploads/, so its cached checksum is stale.
        crcCacheForget(basename($stored));
    }

    portfolioSidecarUpdate("$dir/.gallery.json", function ($g) use ($gallery, $items, $order, $headers) {
        $g['version'] = 1;
        $g['id'] = $g['id'] ?? generateId('pg_');
        $g['title'] = $gallery['name'];
        $g['description'] = '';
        $g['layout'] = 'justified';
        $g['cover'] = null;
        $g['visible'] = ($gallery['active'] ?? true) !== false;
        $g['access'] = ($gallery['active'] ?? true) !== false ? 'public' : 'hidden';
        $g['createdAt'] = $gallery['createdAt'] ?? date('c');
        $g['items'] = $items;
        $g['headers'] = $headers;
        $g['refs'] = [];
        $g['order'] = $order;
        $g['options'] = portfolioNormalizeOptions([]);
        return $g;
    });
    portfolioTree(true);

    // Leave the old record in place, archived, so nothing is lost and old
    // links can still be redirected.
    $newId = null;
    $newUrl = null;
    foreach (portfolioTree()['categories'] as $c) {
        foreach ($c['galleries'] as $g) {
            if ($g['dir'] !== $dir) continue;
            $newId = $g['id'];
            $newUrl = portfolioGalleryUrl($c, $g);
        }
    }
    $galleries = readGalleries();
    foreach ($galleries as &$g) {
        if ($g['id'] === $gallery['id']) {
            $g['archived'] = true;
            $g['active'] = false;
            $g['migratedTo'] = $newId;
        }
    }
    unset($g);
    writeGalleries($galleries);

    return [
        'ok' => true,
        'name' => $gallery['name'],
        'category' => $cat['folder'],
        'folder' => $folder,
        'moved' => $moved,
        'captions' => $captionsMoved,
        'galleryId' => $newId,
        'token' => $gallery['token'] ?? null,
        'url' => $newUrl,
    ];
}

// What the admin shows before anyone commits to it.
if ($method === 'GET' && $uri === '/api/admin/portfolio/migrate') {
    requireAuth();
    $pending = migrationPending();
    $state = migrationState();
    $items = 0;
    foreach ($pending as $g) {
        $items += count(array_filter(readGalleryVideos($g['id']), fn($v) => ($v['type'] ?? '') !== 'header'));
    }
    respond([
        'pending' => array_map(fn($g) => ['id' => $g['id'], 'name' => $g['name']], $pending),
        'items' => $items,
        'blockers' => migrationBlockers(),
        'done' => count($state['done']),
        'finishedAt' => $state['finishedAt'],
        'backup' => $state['backup'],
    ]);
}

// One gallery per call; the admin keeps calling while `remaining` is above zero.
if ($method === 'POST' && $uri === '/api/admin/portfolio/migrate') {
    requireAuth();
    $blockers = migrationBlockers();
    if ($blockers) respondError('Wait for these deliveries to expire first: ' . implode('; ', $blockers), 409);

    $state = migrationState();
    if (!$state['startedAt']) {
        $state['startedAt'] = date('c');
        $state['backup'] = migrationBackup();
    }
    $pending = migrationPending();
    if (!$pending) {
        $state['finishedAt'] = $state['finishedAt'] ?: date('c');
        writeMigrationState($state);
        respond(['done' => true, 'remaining' => 0, 'backup' => $state['backup']]);
    }

    @set_time_limit(300);
    $result = migrateOneGallery($pending[0]);
    if (empty($result['ok'])) respondError($result['error'] ?? 'Migration failed', 500);

    $state['done'][] = $pending[0]['id'];
    if ($result['galleryId']) $state['map'][$pending[0]['id']] = $result['galleryId'];
    if (!empty($result['token'])) $state['tokens'][$result['token']] = $result['url'];
    writeMigrationState($state);

    respond(['done' => false, 'remaining' => count($pending) - 1, 'result' => $result, 'backup' => $state['backup']]);
}

// ============================================================
// HEADER CONFIG
// ============================================================

define('LOGO_DIR', SITE_DATA . '/logo');
if (!is_dir(LOGO_DIR)) mkdir(LOGO_DIR, 0755, true);

function readHeaderConfig() {
    $config = jsonRead(HEADER_CONFIG_PATH);
    if ($config) return $config;

    // Default config for fresh installs
    return [
        'siteName' => '',
        'logo' => [
            'src' => '',
            'text' => '',
            'alt' => '',
            'link' => '/',
            'height' => 74,
        ],
        'email' => '',
        'phone' => '',
        'tagline' => '',
        'nav' => [],
        'social' => [],
    ];
}

// Social links, cleaned: a known network (or "website") and an http(s) or
// mailto URL. Stored with the rest of the header config.
function sanitizeSocial($list) {
    $known = ['instagram', 'facebook', 'x', 'youtube', 'vimeo', 'linkedin', 'tiktok',
              'pinterest', 'behance', 'flickr', 'threads', 'bluesky', 'website', 'email'];
    $out = [];
    foreach ((array)$list as $item) {
        $url = trim((string)($item['url'] ?? ''));
        if ($url === '') continue;
        if (!preg_match('#^(https?://|mailto:)#i', $url)) $url = 'https://' . ltrim($url, '/');
        $network = strtolower((string)($item['network'] ?? ''));
        $out[] = [
            'network' => in_array($network, $known, true) ? $network : 'website',
            'url' => mb_substr($url, 0, 300),
        ];
    }
    return array_slice($out, 0, 12);
}

// Expands a {type:'portfolio'} nav entry into the current categories, so the
// menu follows the folders instead of being re-typed in Settings whenever one
// is added. 'dropdown' nests them under one label; 'inline' lists them flat.
function expandPortfolioNav(array $config) {
    $nav = $config['nav'] ?? [];
    if (!is_array($nav)) return $config;
    $expanded = [];
    foreach ($nav as $entry) {
        $type = $entry['type'] ?? '';
        if ($type === 'collection') {
            $cat = null;
            foreach (portfolioTree()['categories'] as $c) {
                if ($c['id'] === ($entry['categoryId'] ?? '') && $c['kind'] !== 'gallery') { $cat = $c; break; }
            }
            // Deleted, renamed away from, or never picked — nothing to show
            // rather than a broken empty dropdown.
            if (!$cat || ($cat['sidecar']['visible'] ?? true) === false) continue;
            $payload = portfolioCategoryPayload($cat);
            if (!$payload['galleries']) continue;
            $expanded[] = [
                'type' => 'dropdown',
                'label' => $entry['label'] ?: $payload['title'],
                'children' => array_map(fn($g) => ['label' => $g['title'], 'url' => $g['url']], $payload['galleries']),
            ];
            continue;
        }
        if ($type !== 'portfolio') {
            $expanded[] = $entry;
            continue;
        }
        $children = [];
        foreach (portfolioPublicCategories() as $cat) {
            $children[] = ['label' => $cat['title'], 'url' => $cat['url']];
        }
        if (!$children) continue;
        if (($entry['mode'] ?? 'dropdown') === 'inline') {
            foreach ($children as $c) {
                $expanded[] = ['type' => 'link', 'label' => $c['label'], 'url' => $c['url'], 'external' => false];
            }
        } else {
            $expanded[] = [
                'type' => 'dropdown',
                'label' => $entry['label'] ?? 'Portfolio',
                'children' => $children,
            ];
        }
    }
    $config['nav'] = $expanded;
    return $config;
}

function readThemeConfig() {
    $t = jsonRead(THEME_CONFIG_PATH) ?: [];
    return [
        'preset' => in_array($t['preset'] ?? '', ['light', 'dark', 'warm'], true) ? $t['preset'] : 'light',
        'accent' => preg_match('/^#[0-9a-f]{6}$/i', $t['accent'] ?? '') ? strtolower($t['accent']) : '#0019ff',
        'headerLayout' => in_array($t['headerLayout'] ?? '', ['bar', 'stacked', 'sidebar'], true) ? $t['headerLayout'] : 'bar',
        'contact' => [
            'show' => ($t['contact']['show'] ?? true) !== false,
            'text' => mb_substr((string)($t['contact']['text'] ?? ''), 0, 200),
        ],
        // How the list of galleries is presented, on /portfolio and on a
        // category page.
        'index' => [
            'layout' => in_array($t['index']['layout'] ?? '', ['grid', 'fullwidth', 'columns', 'fullscreen'], true) ? $t['index']['layout'] : 'grid',
            'filters' => !empty($t['index']['filters']),
            'sidebar' => in_array($t['index']['sidebar'] ?? '', ['off', 'left', 'right'], true) ? $t['index']['sidebar'] : 'off',
        ],
        // A transparent PNG stamped over portfolio pictures, corner-positioned.
        // scale is the image's width as a percentage of the tile (CSS also
        // caps it between 54px and 160px either way); opacity is a percentage
        // of fully opaque. Defaults match what was hard-coded in CSS before
        // these existed, so an installation with neither set keeps looking
        // exactly as it did.
        'watermark' => [
            'enabled' => !empty($t['watermark']['enabled']),
            'position' => in_array($t['watermark']['position'] ?? '', ['tl', 'tr', 'bl', 'br', 'center'], true) ? $t['watermark']['position'] : 'br',
            'src' => (string)($t['watermark']['src'] ?? ''),
            'scale' => min(60, max(5, (int)($t['watermark']['scale'] ?? 18))),
            'opacity' => min(100, max(5, (int)($t['watermark']['opacity'] ?? 85))),
        ],
    ];
}

// GET header config (public — used by all pages)
if ($method === 'GET' && $uri === '/api/header') {
    $config = expandPortfolioNav(readHeaderConfig());
    $config['theme'] = readThemeConfig();
    respond($config);
}

// The admin's own copy of the header config — raw, not run through
// expandPortfolioNav(). The admin's nav editor needs the stored {type:
// 'portfolio'|'collection', ...} markers back, not the dropdown/link items
// they expand into for the public site: round-tripping the expanded form
// back through PUT /api/settings/header would bake that expansion in as
// plain nav entries, permanently losing the auto-sync the marker exists for.
if ($method === 'GET' && $uri === '/api/admin/header') {
    requireAuth();
    $config = readHeaderConfig();
    $config['theme'] = readThemeConfig();
    respond($config);
}

if ($method === 'PUT' && $uri === '/api/settings/theme') {
    requireAuth();
    $input = getInput();
    $current = readThemeConfig();
    $next = [
        'preset' => $input['preset'] ?? $current['preset'],
        'accent' => $input['accent'] ?? $current['accent'],
        'headerLayout' => $input['headerLayout'] ?? $current['headerLayout'],
        'contact' => [
            'show' => array_key_exists('contact', $input) ? (($input['contact']['show'] ?? true) !== false) : $current['contact']['show'],
            'text' => array_key_exists('contact', $input) ? (string)($input['contact']['text'] ?? '') : $current['contact']['text'],
        ],
        'index' => array_key_exists('index', $input) ? array_merge($current['index'], (array)$input['index']) : $current['index'],
        'watermark' => array_key_exists('watermark', $input) ? array_merge($current['watermark'], (array)$input['watermark']) : $current['watermark'],
    ];
    jsonWrite(THEME_CONFIG_PATH, $next);
    respond(['ok' => true, 'theme' => readThemeConfig()]);
}

// PUT header config (admin). Merged, not replaced: the Settings panel and the
// Portfolio tab's Site design panel each send the fields they own, and neither
// should wipe the other's.
if ($method === 'PUT' && $uri === '/api/settings/header') {
    requireAuth();
    $input = getInput();
    $config = array_merge(readHeaderConfig(), $input);
    if (isset($input['logo'])) $config['logo'] = array_merge(readHeaderConfig()['logo'] ?? [], (array)$input['logo']);
    $config['social'] = sanitizeSocial($config['social'] ?? []);
    jsonWrite(HEADER_CONFIG_PATH, $config);
    respond(['ok' => true]);
}

// POST upload logo (admin)
if ($method === 'POST' && $uri === '/api/settings/header/logo') {
    requireAuth();
    if (empty($_FILES['logo'])) respondError('No file uploaded', 400);

    // Two variants: the light-background logo (default) and the dark-background
    // one, swapped by the theme on the public pages.
    $variant = ($_POST['variant'] ?? 'light') === 'dark' ? 'dark' : 'light';
    $file = $_FILES['logo'];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'])) {
        respondError('Unsupported image type. Use PNG, JPG, SVG, WebP, or GIF.', 400);
    }

    foreach (glob(LOGO_DIR . "/logo-$variant.*") as $old) unlink($old);
    $filename = "logo-$variant." . $ext;
    move_uploaded_file($file['tmp_name'], LOGO_DIR . '/' . $filename);

    $config = readHeaderConfig();
    if ($variant === 'dark') $config['logo']['srcDark'] = '/logo/' . $filename;
    else $config['logo']['src'] = '/logo/' . $filename;
    jsonWrite(HEADER_CONFIG_PATH, $config);

    respond(['ok' => true, 'variant' => $variant, 'src' => '/logo/' . $filename]);
}

// Upload the watermark (a transparent PNG) and switch it on.
if ($method === 'POST' && $uri === '/api/settings/watermark') {
    requireAuth();
    if (empty($_FILES['watermark'])) respondError('No file uploaded', 400);
    $ext = strtolower(pathinfo($_FILES['watermark']['name'], PATHINFO_EXTENSION));
    if ($ext !== 'png') respondError('Upload a transparent PNG.', 400);
    foreach (glob(LOGO_DIR . '/watermark.*') as $old) unlink($old);
    if (!move_uploaded_file($_FILES['watermark']['tmp_name'], LOGO_DIR . '/watermark.png')) {
        respondError('Could not save the watermark', 500);
    }
    $t = jsonRead(THEME_CONFIG_PATH) ?: [];
    $t['watermark'] = array_merge(['position' => 'br'], (array)($t['watermark'] ?? []), ['src' => '/logo/watermark.png', 'enabled' => true]);
    jsonWrite(THEME_CONFIG_PATH, $t);
    respond(['ok' => true, 'src' => '/logo/watermark.png']);
}

// ============================================================
// BACKUP — one zip per gallery, plus a settings zip; an import for both
// ============================================================
// A single all-in-one export was the first approach here, but this
// install alone is already ~2.6 GB across 3,119 files — comfortably past
// LiteSpeed's 1 GiB dynamic-response cap (see PACKAGES_DIR above), and
// every real gallery on it is under 330 MB. So instead: one zip per
// gallery (its media, plus the same _photoshelter.json order/visibility
// sidecar the drag-a-folder import already understands, plus a settings
// file with everything else about it), and a separate small zip for
// sitewide settings. Each one stays safely under any size cap without
// needing the delivery system's part-splitting at all. Restoring is an
// import of each piece, not an unzip-over-the-checkout — see below.

// This is a deliberate, infrequent, admin-only action — not the hot
// client-download path the CRC cache above exists for — so each file's
// CRC32 is computed here directly rather than through fileCrc32(): that
// cache is keyed by basename() alone, which collides constantly across
// portfolio galleries (many "01.jpg"s), and reusing it here would corrupt
// it for the delivery path this whole cache exists to keep fast.
//
// Entries carry either 'path' (a file already on disk) or 'content' (a
// string generated for the zip, e.g. a settings JSON) — never both.
function streamZipFromEntries(array $entries, string $filename) {
    beginBinaryResponse($filename, 'application/zip', null);
    ignore_user_abort(false);

    $offset = 0;
    $central = [];
    $out = fopen('php://output', 'wb');
    foreach ($entries as $e) {
        if (isset($e['content'])) {
            $data = $e['content'];
            $size = strlen($data);
            $crc = crc32($data);
        } else {
            $crcHex = @hash_file('crc32b', $e['path']);
            if ($crcHex === false) continue;
            $crc = (int)hexdec($crcHex);
            $size = (int)filesize($e['path']);
        }
        $mtime = $e['mtime'] ?? time();

        $header = zipStreamLocalHeader($e['name'], $mtime, $crc, $size);
        echo $header;
        $entryOffset = $offset;
        $offset += strlen($header);

        if (isset($e['content'])) {
            echo $data;
            $written = $size;
        } else {
            $fp = fopen($e['path'], 'rb');
            if ($fp === false) continue;
            $written = stream_copy_to_stream($fp, $out, $size);
            fclose($fp);
        }
        $offset += $written;

        $central[] = ['name' => $e['name'], 'crc' => $crc, 'size' => $written,
                      'offset' => $entryOffset, 'mtime' => $mtime];
    }

    $cdOffset = $offset;
    $cd = '';
    foreach ($central as $e) $cd .= zipCentralEntry($e);
    echo $cd;
    echo zipEndOfCentralDirectory(count($central), strlen($cd), $cdOffset);
    fclose($out);
    flush();
    exit;
}

// Every gallery that actually holds media, flattened out of the tree with
// the path of folder names (category, then any nested collection-gallery)
// needed to recreate its location on import. Collections themselves —
// nodes with no media, just child galleries — aren't listed here; they
// come back via portfolio-structure.json in the settings zip instead, and
// a gallery zip's own categoryPath recreates one by name if it's missing.
function portfolioExportableGalleries() {
    $out = [];
    $walkChildren = function ($nodes, array $path) use (&$walkChildren, &$out) {
        foreach ($nodes as $n) {
            // Unlike portfolioTree()'s own top-level category entries, a
            // gallery nested inside one (or inside another gallery acting as
            // a collection) carries its kind in sidecar.kind, not its own.
            if (($n['sidecar']['kind'] ?? '') === 'gallery') {
                $out[] = ['node' => $n, 'categoryPath' => $path];
            }
            if (!empty($n['children'])) $walkChildren($n['children'], array_merge($path, [$n['folder']]));
        }
    };
    foreach (portfolioTree()['categories'] as $cat) {
        if ($cat['kind'] === 'gallery') {
            $out[] = ['node' => $cat, 'categoryPath' => []];
            if (!empty($cat['children'])) $walkChildren($cat['children'], [$cat['folder']]);
        } else {
            $walkChildren($cat['galleries'], [$cat['folder']]);
        }
    }
    $home = portfolioTree()['home'];
    if ($home) $out[] = ['node' => array_merge($home, ['kind' => 'gallery']), 'categoryPath' => [], 'isHome' => true];
    return $out;
}

function portfolioGallerySettingsJson($entry) {
    $s = $entry['node']['sidecar'];
    return json_encode([
        'version' => 1,
        'folder' => $entry['node']['folder'],
        'title' => $s['title'] ?? null,
        'description' => $s['description'] ?? '',
        'slug' => $s['slug'] ?? null,
        'visible' => $s['visible'] ?? true,
        'access' => $s['access'] ?? 'public',
        'layout' => $s['layout'] ?? 'justified',
        'options' => $s['options'] ?? [],
        'cover' => $s['cover'] ?? null,
        'categoryPath' => $entry['categoryPath'],
        'isHome' => !empty($entry['isHome']),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
}

// List every exportable gallery for the admin UI: enough to label and size
// a "Download" link each, without building any of the zips yet.
if ($method === 'GET' && $uri === '/api/admin/export/galleries') {
    requireAuth();
    $out = [];
    foreach (portfolioExportableGalleries() as $entry) {
        $items = $entry['node']['sidecar']['items'] ?? [];
        $size = 0;
        foreach ($items as $name => $it) {
            $path = $entry['node']['dir'] . '/' . $name;
            if (is_file($path)) $size += filesize($path);
        }
        $out[] = [
            'id' => $entry['node']['id'],
            'title' => $entry['node']['sidecar']['title'] ?? $entry['node']['folder'],
            'categoryPath' => $entry['categoryPath'],
            'isHome' => !empty($entry['isHome']),
            'fileCount' => count($items),
            'totalBytes' => $size,
        ];
    }
    respond(['galleries' => $out]);
}

// One gallery's zip: its media files, flat, plus _photoshelter.json (order
// and visibility — the same format the drag-a-folder import already reads)
// and _gallery-settings.json (everything else: layout, options, where it
// lives). Importing one needs nothing but this file.
if (($method === 'GET' || $method === 'HEAD') && matchRoute('/api/admin/export/gallery/{gid}/download', $uri, $params)) {
    requireAuth();
    $match = null;
    foreach (portfolioExportableGalleries() as $entry) {
        if ($entry['node']['id'] === $params['gid']) { $match = $entry; break; }
    }
    if (!$match) respondError('Gallery not found', 404);

    $dir = $match['node']['dir'];
    $items = $match['node']['sidecar']['items'] ?? [];
    $order = $match['node']['sidecar']['order'] ?? array_keys($items);
    $entries = [];
    foreach ($order as $name) {
        if (!isset($items[$name])) continue;
        $path = $dir . '/' . $name;
        if (!is_file($path)) continue;
        $entries[] = ['path' => $path, 'name' => $name, 'mtime' => (int)@filemtime($path)];
    }
    $psImages = [];
    foreach ($order as $name) {
        if (!isset($items[$name])) continue;
        $psImages[] = ['file_name' => $name, 'visible' => $items[$name]['visible'] ?? true, 'display_order' => count($psImages) + 1];
    }
    $entries[] = ['content' => json_encode(['images' => $psImages], JSON_PRETTY_PRINT), 'name' => PORTFOLIO_PHOTOSHELTER_SIDECAR, 'mtime' => time()];
    $entries[] = ['content' => portfolioGallerySettingsJson($match), 'name' => '_gallery-settings.json', 'mtime' => time()];

    $label = packageFolderName($match['node']['sidecar']['title'] ?? $match['node']['folder']);
    streamZipFromEntries($entries, "$label.zip");
}

// The settings zip: everything about the install that isn't a gallery's
// own media — sitewide config, pages, logo, watermark, legacy reels
// uploads, .env, and portfolio-structure.json so empty collections (and
// their own settings) come back even with no gallery inside to carry them.
function exportSettingsFileList() {
    $roots = [
        ['dir' => DATA_DIR, 'prefix' => 'site-data/data'],
        ['dir' => UPLOADS_DIR, 'prefix' => 'site-data/uploads', 'excludeDir' => UPLOAD_TMP_DIR],
        ['dir' => CAPTIONS_DIR, 'prefix' => 'site-data/captions'],
        ['dir' => LOGO_DIR, 'prefix' => 'site-data/logo'],
    ];
    $entries = [];
    foreach ($roots as $root) {
        if (!is_dir($root['dir'])) continue;
        $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root['dir'], FilesystemIterator::SKIP_DOTS));
        foreach ($iter as $fileInfo) {
            if (!$fileInfo->isFile()) continue;
            $full = $fileInfo->getPathname();
            if (isset($root['excludeDir']) && strpos($full, $root['excludeDir'] . DIRECTORY_SEPARATOR) === 0) continue;
            $rel = substr($full, strlen($root['dir']) + 1);
            $entries[] = ['path' => $full, 'name' => $root['prefix'] . '/' . str_replace(DIRECTORY_SEPARATOR, '/', $rel), 'mtime' => (int)$fileInfo->getMTime()];
        }
    }
    $envPath = __DIR__ . '/.env';
    if (is_file($envPath)) $entries[] = ['path' => $envPath, 'name' => '.env', 'mtime' => (int)filemtime($envPath)];

    $categories = [];
    foreach (portfolioTree()['categories'] as $cat) {
        if ($cat['kind'] === 'gallery') continue;
        $categories[] = [
            'folder' => $cat['folder'],
            'title' => $cat['sidecar']['title'] ?? $cat['folder'],
            'slug' => $cat['sidecar']['slug'] ?? null,
            'visible' => $cat['sidecar']['visible'] ?? true,
            'description' => $cat['sidecar']['description'] ?? '',
            'view' => $cat['sidecar']['view'] ?? 'cards',
        ];
    }
    $home = portfolioTree()['home'];
    $structure = [
        'version' => 1,
        'categories' => $categories,
        'home' => $home ? ['layout' => $home['sidecar']['layout'] ?? 'justified', 'options' => $home['sidecar']['options'] ?? []] : null,
    ];
    $entries[] = ['content' => json_encode($structure, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), 'name' => 'portfolio-structure.json', 'mtime' => time()];
    return $entries;
}

if ($method === 'GET' && $uri === '/api/admin/export/settings') {
    requireAuth();
    $entries = exportSettingsFileList();
    $total = 0;
    foreach ($entries as $e) $total += isset($e['content']) ? strlen($e['content']) : (is_file($e['path'] ?? '') ? filesize($e['path']) : 0);
    respond(['fileCount' => count($entries), 'totalBytes' => $total]);
}

if (($method === 'GET' || $method === 'HEAD') && $uri === '/api/admin/export/settings/download') {
    requireAuth();
    $entries = exportSettingsFileList();
    streamZipFromEntries($entries, 'site-settings-' . date('Y-m-d') . '.zip');
}

// --- Import ---

// One gallery zip back in: find-or-create its category (and any nested
// collection-gallery) by folder name, find-or-create the gallery itself,
// then run every file in the zip through portfolioAcceptUpload() in the
// same order a dragged folder would — media first, _photoshelter.json
// last, so order/visibility apply the instant every file has landed.
// _gallery-settings.json's other fields (layout, options, description,
// etc.) are patched on afterward.
if ($method === 'POST' && $uri === '/api/admin/import/gallery') {
    requireAuth();
    if (empty($_FILES['zip']) || $_FILES['zip']['error'] !== UPLOAD_ERR_OK) respondError('No zip uploaded', 400);

    $za = new ZipArchive();
    if ($za->open($_FILES['zip']['tmp_name']) !== true) respondError('Could not open that zip', 400);
    $settingsRaw = $za->getFromName('_gallery-settings.json');
    if ($settingsRaw === false) { $za->close(); respondError('Missing _gallery-settings.json — this doesn\'t look like a gallery export', 400); }
    $settings = json_decode($settingsRaw, true);
    if (!is_array($settings)) { $za->close(); respondError('_gallery-settings.json is not valid JSON', 400); }

    // Same filesystem as PORTFOLIO_DIR, not sys_get_temp_dir(): portfolioAcceptUpload()
    // moves each file into place with rename(), which fails across a mount
    // boundary — a real risk on hosts where /tmp is a separate device.
    $importTmpBase = SITE_DATA . '/tmp';
    if (!is_dir($importTmpBase)) @mkdir($importTmpBase, 0755, true);
    $tmpDir = $importTmpBase . '/import_' . bin2hex(random_bytes(8));
    if (!@mkdir($tmpDir, 0755, true)) { $za->close(); respondError('Could not create a staging folder', 500); }
    $za->extractTo($tmpDir);
    $za->close();

    // Walk categoryPath, creating each segment that doesn't already exist:
    // the first as a real category, any further ones as a nested gallery
    // acting as a collection (the same shape newSubGallery() already makes).
    $categoryId = null;
    $parentGalleryId = null;
    if (!empty($settings['isHome'])) {
        $dir = PORTFOLIO_DIR . '/' . PORTFOLIO_HOME_FOLDER;
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
    } else {
        foreach (($settings['categoryPath'] ?? []) as $i => $segFolder) {
            if ($i === 0) {
                $existing = null;
                foreach (portfolioTree()['categories'] as $cat) {
                    if ($cat['kind'] !== 'gallery' && strcasecmp($cat['folder'], $segFolder) === 0) { $existing = $cat; break; }
                }
                if ($existing) { $categoryId = $existing['id']; continue; }
                $name = portfolioUniqueChildName(PORTFOLIO_DIR, portfolioSafeName($segFolder));
                @mkdir(PORTFOLIO_DIR . '/' . $name, 0755);
                portfolioTree(true);
                foreach (portfolioTree()['categories'] as $cat) {
                    if ($cat['folder'] === $name) { $categoryId = $cat['id']; break; }
                }
            } else {
                // A nested collection-gallery under the category or the
                // previous segment. Not exercised by this install's own
                // data today (no gallery currently holds other galleries),
                // but kept for a site that does.
                $siblings = $parentGalleryId
                    ? (portfolioRequireGallery($parentGalleryId)[1]['children'] ?? [])
                    : (portfolioRequireCategory($categoryId)['galleries'] ?? []);
                $existing = null;
                foreach ($siblings as $g) { if (strcasecmp($g['folder'], $segFolder) === 0) { $existing = $g; break; } }
                if ($existing) { $parentGalleryId = $existing['id']; continue; }
                $name = portfolioSafeName($segFolder);
                $body = $parentGalleryId ? ['parentId' => $parentGalleryId, 'name' => $name] : ['categoryId' => $categoryId, 'name' => $name];
                // Mirrors POST /api/admin/portfolio/galleries directly —
                // not a self HTTP call, just the same few lines inline.
                $parentDir = $parentGalleryId ? portfolioRequireGallery($parentGalleryId)[1]['dir'] : portfolioRequireCategory($categoryId)['dir'];
                $uniqueName = portfolioUniqueChildName($parentDir, $name);
                @mkdir($parentDir . '/' . $uniqueName, 0755);
                portfolioTree(true);
                $siblings = $parentGalleryId
                    ? (portfolioRequireGallery($parentGalleryId)[1]['children'] ?? [])
                    : (portfolioRequireCategory($categoryId)['galleries'] ?? []);
                foreach ($siblings as $g) { if ($g['folder'] === $uniqueName) { $parentGalleryId = $g['id']; break; } }
            }
        }
    }

    // Find-or-create the gallery itself by folder name under wherever the
    // path above landed.
    $dir = null;
    if (!empty($settings['isHome'])) {
        $dir = PORTFOLIO_DIR . '/' . PORTFOLIO_HOME_FOLDER;
        [, $gal] = portfolioRequireGallery(portfolioTree()['home']['id']);
    } else {
        $siblings = $parentGalleryId
            ? (portfolioRequireGallery($parentGalleryId)[1]['children'] ?? [])
            : ($categoryId ? (portfolioRequireCategory($categoryId)['galleries'] ?? []) : array_filter(portfolioTree()['categories'], fn($c) => $c['kind'] === 'gallery'));
        $folderWanted = (string)($settings['folder'] ?? 'Imported Gallery');
        $existing = null;
        foreach ($siblings as $g) { if (strcasecmp($g['folder'] ?? $g['sidecar']['title'] ?? '', $folderWanted) === 0) { $existing = $g; break; } }
        if ($existing) {
            $gid = $existing['id'] ?? $existing['sidecar']['id'];
            [, $gal] = portfolioRequireGallery($gid);
        } else {
            $parentDirForNew = $parentGalleryId ? portfolioRequireGallery($parentGalleryId)[1]['dir'] : ($categoryId ? portfolioRequireCategory($categoryId)['dir'] : PORTFOLIO_DIR);
            $uniqueName = portfolioUniqueChildName($parentDirForNew, portfolioSafeName($folderWanted));
            @mkdir($parentDirForNew . '/' . $uniqueName, 0755);
            portfolioTree(true);
            // Read the id straight back off the sidecar portfolioTree() just
            // wrote, rather than searching the tree for it: a top-level-only
            // search here missed any gallery nested more than one level deep
            // (a category's direct galleries, but not a gallery-as-collection's
            // children), the exact case a gallery importing back under another
            // imported gallery hits.
            $gid = jsonRead($parentDirForNew . '/' . $uniqueName . '/.gallery.json')['id'] ?? null;
            if (!$gid) { rrmdirTree($tmpDir); respondError('Could not place the imported gallery', 500); }
            [, $gal] = portfolioRequireGallery($gid);
        }
    }

    // Media first, sidecar last — same order the drag-a-folder import uses,
    // so order/visibility apply once every file has actually landed.
    $files = array_diff(scandir($tmpDir), ['.', '..', '_gallery-settings.json']);
    $mediaFiles = array_values(array_filter($files, fn($f) => strtolower($f) !== PORTFOLIO_PHOTOSHELTER_SIDECAR));
    $sidecarFile = in_array(PORTFOLIO_PHOTOSHELTER_SIDECAR, $files, true) ? PORTFOLIO_PHOTOSHELTER_SIDECAR : null;
    $uploaded = 0;
    foreach ($mediaFiles as $f) {
        if (portfolioIgnoredName($f)) continue;
        portfolioAcceptUpload($gal, $tmpDir . '/' . $f, $f);
        $uploaded++;
    }
    if ($sidecarFile) portfolioAcceptUpload($gal, $tmpDir . '/' . $sidecarFile, $sidecarFile);

    // Everything _photoshelter.json doesn't cover: layout, options, text.
    portfolioSidecarPatch($gal['dir'], '.gallery.json', function ($g) use ($settings) {
        foreach (['title', 'description', 'slug', 'layout', 'cover'] as $k) {
            if (array_key_exists($k, $settings)) $g[$k] = $settings[$k];
        }
        if (array_key_exists('visible', $settings)) $g['access'] = $settings['visible'] ? 'public' : 'hidden';
        if (array_key_exists('options', $settings) && is_array($settings['options'])) {
            $g['options'] = portfolioNormalizeOptions(array_merge($g['options'] ?? [], $settings['options']));
        }
        return $g;
    });
    portfolioTree(true);
    rrmdirTree($tmpDir);
    respond(['ok' => true, 'uploaded' => $uploaded, 'gallery' => portfolioGalleryResponse($gal['id'])]);
}

// The settings zip back in: overwrites site-data/data, uploads, captions,
// logo and .env with whatever the zip holds, then applies
// portfolio-structure.json — creating any category that isn't already
// there (by folder name) with its own settings, and the home gallery's
// layout/options. Never touches a gallery's own media; that's each
// gallery zip's job.
if ($method === 'POST' && $uri === '/api/admin/import/settings') {
    requireAuth();
    if (empty($_FILES['zip']) || $_FILES['zip']['error'] !== UPLOAD_ERR_OK) respondError('No zip uploaded', 400);

    $za = new ZipArchive();
    if ($za->open($_FILES['zip']['tmp_name']) !== true) respondError('Could not open that zip', 400);

    $destRoots = [
        'site-data/data/' => DATA_DIR,
        'site-data/uploads/' => UPLOADS_DIR,
        'site-data/captions/' => CAPTIONS_DIR,
        'site-data/logo/' => LOGO_DIR,
    ];
    for ($i = 0; $i < $za->numFiles; $i++) {
        $name = $za->getNameIndex($i);
        if ($name === false || substr($name, -1) === '/') continue;
        if ($name === '.env') {
            $za->extractTo(__DIR__, $name);
            continue;
        }
        if ($name === 'portfolio-structure.json') continue;
        foreach ($destRoots as $prefix => $destDir) {
            if (strpos($name, $prefix) === 0) {
                $rel = str_replace('\\', '/', substr($name, strlen($prefix)));
                $parts = array_filter(explode('/', $rel), fn($p) => $p !== '' && $p !== '.');
                if ($rel === '' || in_array('..', $parts, true)) break;
                $dest = $destDir . '/' . implode('/', $parts);
                @mkdir(dirname($dest), 0755, true);
                $data = $za->getFromIndex($i);
                if ($data !== false) file_put_contents($dest, $data);
                break;
            }
        }
    }
    $structureRaw = $za->getFromName('portfolio-structure.json');
    $za->close();

    $structure = $structureRaw !== false ? json_decode($structureRaw, true) : null;
    if (is_array($structure)) {
        $existingFolders = array_column(portfolioTree()['categories'], 'folder');
        foreach (($structure['categories'] ?? []) as $cat) {
            $folder = (string)($cat['folder'] ?? '');
            if ($folder === '') continue;
            if (!in_array($folder, $existingFolders, true)) {
                $name = portfolioUniqueChildName(PORTFOLIO_DIR, portfolioSafeName($folder));
                @mkdir(PORTFOLIO_DIR . '/' . $name, 0755);
            } else {
                $name = $folder;
            }
            portfolioSidecarPatch(PORTFOLIO_DIR . '/' . $name, '.category.json', function ($c) use ($cat) {
                foreach (['title', 'slug', 'visible', 'description', 'view'] as $k) {
                    if (array_key_exists($k, $cat)) $c[$k] = $cat[$k];
                }
                return $c;
            });
        }
        if (!empty($structure['home']) && is_array($structure['home'])) {
            $dir = PORTFOLIO_DIR . '/' . PORTFOLIO_HOME_FOLDER;
            if (!is_dir($dir)) @mkdir($dir, 0755, true);
            portfolioSidecarPatch($dir, '.gallery.json', function ($g) use ($structure) {
                if (!empty($structure['home']['layout'])) $g['layout'] = $structure['home']['layout'];
                if (!empty($structure['home']['options'])) $g['options'] = portfolioNormalizeOptions(array_merge($g['options'] ?? [], $structure['home']['options']));
                return $g;
            });
        }
    }
    portfolioTree(true);
    respond(['ok' => true]);
}

// ============================================================
// 404 — No route matched
// ============================================================

respondError('Not found', 404);
