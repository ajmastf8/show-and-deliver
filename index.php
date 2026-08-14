<?php
/**
 * VideoReelSite — Single-file PHP API
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
        curl_close($ch);
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
    $subject = "$reviewerName commented on \"$subjectVideo\"";
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
        $htmlComments .= '<h3 style="color:#333;margin:20px 0 8px;font-size:15px;">' . escHtml($title) . '</h3>';

        usort($vidComments, fn($a, $b) => $a['timestamp'] <=> $b['timestamp']);
        foreach ($vidComments as $c) {
            if ($isPhoto || $c['timestamp'] == 0) {
                $textParts[] = "  {$c['text']}";
                $htmlComments .= '<div style="padding:8px 0;border-bottom:1px solid #f0f0f0;"><span style="color:#5f5f5f;font-size:13px;">' . escHtml($c['text']) . '</span></div>';
            } else {
                $time = formatTimestamp($c['timestamp']);
                $textParts[] = "  [$time] {$c['text']}";
                $htmlComments .= '<div style="padding:8px 0;border-bottom:1px solid #f0f0f0;"><span style="color:#0019ff;font-weight:600;font-size:13px;">' . $time . '</span><span style="color:#5f5f5f;font-size:13px;margin-left:8px;">' . escHtml($c['text']) . '</span></div>';
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

    $html = '<div style="font-family:sans-serif;max-width:600px;">'
        . '<h2 style="color:#0019ff;">Comments on ' . escHtml($subjectVideo) . '</h2>'
        . '<p><strong>' . escHtml($reviewerName) . "</strong> left $countLabel on <strong>" . escHtml($gallery['name']) . '</strong>.</p>'
        . $htmlComments
        . '<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;">'
        . ($videoLink ? '<p><a href="' . $videoLink . '" style="color:#0019ff;">View in gallery</a></p>' : '')
        . '<p><a href="' . $adminLink . '" style="color:#0019ff;">View all comments in admin</a></p>'
        . '<p style="color:#8e8e8e;font-size:12px;">Sent from ' . $config['baseUrl'] . '</p></div>';

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
    $gitRepo = env('GIT_REPO', 'ajmastf8/VideoReelSite');
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
        'token' => $type === 'proofing' ? generateToken() : null,
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
    if (!empty($input['regenerateToken']) && $gallery['type'] === 'proofing') {
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

    // Stream large files manually: kill any output buffering / compression so the
    // whole file isn't loaded into memory (which 500s on big videos under the
    // 512M memory_limit), and lift the execution-time cap for slow transfers.
    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { ob_end_clean(); }

    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    header('Content-Length: ' . filesize($filePath));

    $fp = fopen($filePath, 'rb');
    if ($fp === false) respondError('File not found', 404);
    while (!feof($fp)) {
        echo fread($fp, 8192);
        flush();
    }
    fclose($fp);
    exit;
}

// Bulk "Download All" beacon — fired once by proofing.js when a zip run starts.
// Per-file counts are still captured via the single-download endpoint above.
if ($method === 'POST' && matchRoute('/api/proofing/{token}/event/download-all', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);
    recordDownloadAll(galleryStatsPath($gallery['id']));
    respond(['ok' => true]);
}

// Bulk "Download All" is now done entirely client-side: the browser fetches
// each file via /api/proofing/{token}/download/{id} in parallel and assembles
// a ZIP in JS (see public/js/zip-writer.js). No server-side packaging step,
// no temp files, no LiteSpeed 1GB / 300s limits to worry about.

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
    $collection = [
        'id' => generateId('col_'),
        'name' => $input['name'] ?? 'New Collection',
        'token' => generateToken(),
        'galleryIds' => $input['galleryIds'] ?? [],
        'password' => !empty($input['password']) ? password_hash($input['password'], PASSWORD_BCRYPT) : null,
        'downloadsEnabled' => !empty($input['downloadsEnabled']),
        'commentingEnabled' => !empty($input['commentingEnabled']),
        'expiresAt' => $input['expiresAt'] ?? null,
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
    if (array_key_exists('password', $input)) {
        $col['password'] = $input['password'] ? password_hash($input['password'], PASSWORD_BCRYPT) : null;
    }
    if (isset($input['downloadsEnabled'])) $col['downloadsEnabled'] = $input['downloadsEnabled'];
    if (isset($input['commentingEnabled'])) $col['commentingEnabled'] = $input['commentingEnabled'];
    if (isset($input['expiresAt'])) $col['expiresAt'] = $input['expiresAt'];
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

    $publicGalleries = [];
    foreach ($col['galleryIds'] as $gid) {
        if (!isset($galMap[$gid])) continue;
        $g = $galMap[$gid];
        if (($g['active'] ?? true) === false || $g['type'] !== 'proofing') continue;
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

    return ['name' => $col['name'], 'galleries' => $publicGalleries];
}

if ($method === 'GET' && matchRoute('/api/collections/public/{token}', $uri, $params)) {
    $col = findCollectionByToken($params['token']);
    if (!$col) respondError('Collection not found', 404);
    if (($col['active'] ?? true) === false) respondError('Collection not found', 404);
    if (!empty($col['expiresAt']) && strtotime($col['expiresAt']) < time()) {
        respondError('Collection expired', 410);
    }
    if (!empty($col['password']) && !isCollectionUnlocked($col['id'])) {
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
            'Test Email — Video Proofing Notifications',
            'This is a test email. Email notifications are working correctly!',
            '<div style="font-family:sans-serif;max-width:600px;">'
            . '<h2 style="color:#0019ff;">Test Email</h2>'
            . '<p>This is a test email from your Video Proofing site.</p>'
            . '<p style="color:#4caf50;font-weight:600;">Email notifications are working correctly!</p>'
            . '<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;">'
            . '<p style="color:#8e8e8e;font-size:12px;">Sent from ' . $config['baseUrl'] . '</p></div>'
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

define('GITHUB_REPO_DEFAULT', 'ajmastf8/VideoReelSite');

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
    $headers = ['User-Agent: VideoReelSite-Updater', 'Accept: application/vnd.github+json'];
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

define('HEADER_CONFIG_PATH', DATA_DIR . '/header.json');
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
