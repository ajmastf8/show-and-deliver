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
define('CRC_CACHE_PATH', DATA_DIR . '/crc.json');

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
foreach ([DATA_DIR, UPLOADS_DIR, THUMBS_DIR, PROXY_DIR, CAPTIONS_DIR, IMPORT_DIR, DATA_DIR . '/sessions', DATA_DIR . '/ratelimit'] as $dir) {
    if (!is_dir($dir)) mkdir($dir, 0755, true);
}

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

// Session
ini_set('session.save_path', DATA_DIR . '/sessions');
ini_set('session.gc_maxlifetime', 7 * 24 * 3600);
session_set_cookie_params([
    'lifetime' => 7 * 24 * 3600,
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
]);
session_start();

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

function requireAuth() {
    // Browser path: session cookie set by /api/auth/login. Release the session
    // lock once auth is confirmed (we don't write to it here) so concurrent
    // requests sharing the same cookie aren't serialized by PHP's file lock.
    if (!empty($_SESSION['authenticated'])) { session_write_close(); return; }

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
    imagedestroy($src);
    imagedestroy($dst);
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
    imagedestroy($src);
    imagedestroy($dst);
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

function findGalleryByToken($token) {
    foreach (readGalleries() as $g) {
        if ($g['token'] === $token && $g['type'] === 'proofing') return $g;
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

function sendEmail($to, $subject, $textBody, $htmlBody) {
    $config = getEmailConfig();

    if ($config['resendApiKey']) {
        // Use Resend API
        $ch = curl_init('https://api.resend.com/emails');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $config['resendApiKey'],
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode([
                'from' => $config['from'],
                'to' => [$to],
                'subject' => $subject,
                'text' => $textBody,
                'html' => $htmlBody,
            ]),
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
        return;
    }

    // Fallback: PHP mail()
    $headers = "From: {$config['from']}\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    if (!mail($to, $subject, $htmlBody, $headers)) {
        throw new Exception('Failed to send email via mail()');
    }
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

    $reelsId = generateId('g_');
    $gallery = [
        'id' => $reelsId,
        'name' => 'Video Reels',
        'type' => 'reels',
        'token' => null,
        'password' => null,
        'downloadsEnabled' => false,
        'commentingEnabled' => false,
        'expiresAt' => null,
        'active' => true,
        'createdAt' => date('c'),
    ];
    ensureGalleryDir($reelsId);
    writeGalleryVideos($reelsId, []);
    writeGalleryComments($reelsId, []);
    writeGalleries([$gallery]);
}
migrateIfNeeded();

// ============================================================
// ROUTER
// ============================================================

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
        'authenticated' => !empty($_SESSION['authenticated']),
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
        respond(['ok' => true]);
    } else {
        respondError('Invalid credentials', 401);
    }
}

if ($method === 'POST' && $uri === '/api/auth/logout') {
    session_destroy();
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

    if ($gallery['type'] === 'reels' && count(array_filter($galleries, fn($g) => $g['type'] === 'reels')) <= 1) {
        respondError('Cannot delete the only reels gallery', 400);
    }

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
    if (!in_array($ext, MEDIA_EXTS)) respondError('Unsupported file type', 400);

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
    $title = trim((string)($input['title'] ?? 'Untitled'));
    if ($gid === '') respondError('galleryId is required', 400);

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
    $type = ($input['type'] ?? 'proofing') === 'reels' ? 'reels' : 'proofing';
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

    if (!empty($input['regenerateToken'])) $col['token'] = generateToken();
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

function ensurePackagesDir() {
    if (!is_dir(PACKAGES_DIR)) @mkdir(PACKAGES_DIR, 0755, true);
    // Manifests carry the share token, and everything else under site-data/ is
    // served straight off disk. Deny direct access here as well as in the root
    // .htaccess, in case a host ignores one of them.
    $guard = PACKAGES_DIR . '/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents($guard, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
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
    $config = getEmailConfig();
    if (!$config['resendApiKey'] && !$config['host']) respondError('No email configured', 400);
    if (!$config['adminEmail']) respondError('Admin email address is required', 400);

    try {
        sendEmail(
            $config['adminEmail'],
            emailSubject('Test email'),
            "This is a test email from " . siteName() . ". Email notifications are working correctly.",
            emailShell([
                'title' => 'Email is working',
                'lead'  => 'This is a test message from your ' . escHtml(siteName()) . ' site.',
                'body'  => '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
                    . '<tr><td style="background:#eaf7ee;border:1px solid #c6e6d1;border-radius:6px;padding:11px 14px;'
                    . 'color:#1f7a3d;font-size:13.5px;font-weight:600;">'
                    . 'Notifications are configured correctly.</td></tr></table>',
                'note'  => 'Client comment alerts and download links will be delivered this way.',
            ])
        );
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

// Latest published GitHub Release: tag, bare version, notes, zipball URL.
function latestRelease() {
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
    ];
}

// GET header config (public — used by all pages)
if ($method === 'GET' && $uri === '/api/header') {
    respond(readHeaderConfig());
}

// PUT header config (admin)
if ($method === 'PUT' && $uri === '/api/settings/header') {
    requireAuth();
    $input = getInput();
    jsonWrite(HEADER_CONFIG_PATH, $input);
    respond(['ok' => true]);
}

// POST upload logo (admin)
if ($method === 'POST' && $uri === '/api/settings/header/logo') {
    requireAuth();
    if (empty($_FILES['logo'])) respondError('No file uploaded', 400);

    $file = $_FILES['logo'];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'])) {
        respondError('Unsupported image type. Use PNG, JPG, SVG, WebP, or GIF.', 400);
    }

    // Remove old logos
    foreach (glob(LOGO_DIR . '/logo.*') as $old) unlink($old);

    $filename = 'logo.' . $ext;
    move_uploaded_file($file['tmp_name'], LOGO_DIR . '/' . $filename);

    // Update header config with new logo path
    $config = readHeaderConfig();
    $config['logo']['src'] = '/logo/' . $filename;
    jsonWrite(HEADER_CONFIG_PATH, $config);

    respond(['ok' => true, 'src' => '/logo/' . $filename]);
}

// ============================================================
// 404 — No route matched
// ============================================================

respondError('Not found', 404);
