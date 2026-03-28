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
define('IMPORT_DIR', SITE_DATA . '/imports');

// Ensure directories exist
foreach ([DATA_DIR, UPLOADS_DIR, THUMBS_DIR, PROXY_DIR, IMPORT_DIR, DATA_DIR . '/sessions', DATA_DIR . '/ratelimit'] as $dir) {
    if (!is_dir($dir)) mkdir($dir, 0755, true);
}

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
    if (empty($_SESSION['authenticated'])) {
        respondError('Unauthorized', 401);
    }
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

// Find ffmpeg/ffprobe
function findBinary($name) {
    $which = trim(shell_exec("which $name 2>/dev/null") ?? '');
    if ($which) return $which;
    $home = getenv('HOME') ?: ($_SERVER['HOME'] ?? '');
    if ($home) {
        $dirs = glob("$home/ffmpeg-*-static");
        if ($dirs) {
            $candidate = $dirs[0] . "/$name";
            if (file_exists($candidate)) return $candidate;
        }
    }
    return $name; // fallback to PATH
}

$FFMPEG = findBinary('ffmpeg');
$FFPROBE = findBinary('ffprobe');

// Image extensions
define('IMAGE_EXTS', ['jpg', 'jpeg', 'png', 'webp', 'gif']);
define('VIDEO_EXTS', ['mp4', 'webm', 'mov', 'm4v']);
define('MEDIA_EXTS', array_merge(VIDEO_EXTS, IMAGE_EXTS));

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

function probeImage($filePath) {
    $info = @getimagesize($filePath);
    if (!$info) return null;
    return ['width' => $info[0], 'height' => $info[1]];
}

function generatePhotoThumbnail($srcPath, $thumbPath) {
    $info = @getimagesize($srcPath);
    if (!$info) return false;
    [$origW, $origH, $type] = $info;

    $maxDim = 640;
    $ratio = min($maxDim / max($origW, 1), $maxDim / max($origH, 1), 1);
    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    switch ($type) {
        case IMAGETYPE_JPEG: $src = imagecreatefromjpeg($srcPath); break;
        case IMAGETYPE_PNG: $src = imagecreatefrompng($srcPath); break;
        case IMAGETYPE_WEBP: $src = imagecreatefromwebp($srcPath); break;
        case IMAGETYPE_GIF: $src = imagecreatefromgif($srcPath); break;
        default: return false;
    }
    if (!$src) return false;

    $dst = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagejpeg($dst, $thumbPath, 80);
    imagedestroy($src);
    imagedestroy($dst);
    return true;
}

function generatePhotoProxy($srcPath, $proxyPath) {
    $info = @getimagesize($srcPath);
    if (!$info) return false;
    [$origW, $origH, $type] = $info;

    $maxDim = 2048;
    $ratio = min($maxDim / max($origW, 1), $maxDim / max($origH, 1), 1);
    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    switch ($type) {
        case IMAGETYPE_JPEG: $src = imagecreatefromjpeg($srcPath); break;
        case IMAGETYPE_PNG: $src = imagecreatefrompng($srcPath); break;
        case IMAGETYPE_WEBP: $src = imagecreatefromwebp($srcPath); break;
        case IMAGETYPE_GIF: $src = imagecreatefromgif($srcPath); break;
        default: return false;
    }
    if (!$src) return false;

    $dst = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagejpeg($dst, $proxyPath, 82);
    imagedestroy($src);
    imagedestroy($dst);
    return true;
}

function generateVideoThumbnail($videoPath, $thumbPath, $seekTime = '1') {
    global $FFMPEG;
    $cmd = escapeshellcmd($FFMPEG) . ' -ss ' . escapeshellarg($seekTime)
        . ' -i ' . escapeshellarg($videoPath)
        . ' -frames:v 1 -vf scale=320:180 -pix_fmt yuvj420p -threads 1 -strict unofficial -q:v 2 -y '
        . escapeshellarg($thumbPath) . ' 2>&1';
    exec($cmd, $output, $ret);
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
        $s['videoCount'] = count(array_filter(readGalleryVideos($g['id']), fn($v) => ($v['type'] ?? '') !== 'header'));
        $s['commentCount'] = $g['type'] === 'proofing' ? count(readGalleryComments($g['id'])) : 0;
        $s['collectionId'] = $galColMap[$g['id']]['id'] ?? null;
        $s['collectionName'] = $galColMap[$g['id']]['name'] ?? null;
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
        'overrideCollectionSettings' => false,
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
    respond(readGalleryVideos($params['gid']));
}

// Upload
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

    $isPhoto = isImageFile($destName);
    $item = [
        'id' => generateId($isPhoto ? 'p_' : 'v_'),
        'type' => $isPhoto ? 'photo' : 'video',
        'title' => $_POST['title'] ?? 'Untitled',
        'filename' => $destName,
        'visible' => true,
        'createdAt' => date('c'),
    ];

    if ($isPhoto) {
        $meta = probeImage($destPath);
        if ($meta) { $item['width'] = $meta['width']; $item['height'] = $meta['height']; }
        $thumbFilename = $item['id'] . '.jpg';
        $proxyFilename = $item['id'] . '_proxy.jpg';
        generatePhotoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename);
        generatePhotoProxy($destPath, PROXY_DIR . '/' . $proxyFilename);
        $item['thumbnail'] = $thumbFilename;
        $item['proxy'] = $proxyFilename;
    } else {
        $meta = probeVideo($destPath);
        if ($meta) {
            $item['duration'] = $meta['duration'];
            $item['width'] = $meta['width'];
            $item['height'] = $meta['height'];
        }
    }

    $videos = readGalleryVideos($params['gid']);
    $videos[] = $item;
    writeGalleryVideos($params['gid'], $videos);
    respond($item);
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

// Generate thumbnail (video only)
if ($method === 'PUT' && matchRoute('/api/admin/galleries/{gid}/videos/{vid}/thumbnail', $uri, $params)) {
    requireAuth();
    $input = getInput();
    $videos = readGalleryVideos($params['gid']);
    $video = null;
    foreach ($videos as &$v) {
        if ($v['id'] === $params['vid']) { $video = &$v; break; }
    }
    unset($v);
    if (!$video) respondError('Not found', 404);
    if (($video['type'] ?? '') === 'photo') respondError('Photo thumbnails are generated automatically', 400);
    if (!isset($input['timestamp'])) respondError('No timestamp provided', 400);

    $videoPath = UPLOADS_DIR . '/' . $video['filename'];
    if (!file_exists($videoPath)) respondError('Video file not found on disk', 404);

    $thumbFilename = $video['id'] . '.jpg';
    $thumbPath = THUMBS_DIR . '/' . $thumbFilename;
    $seekTime = max(0, (float)($input['timestamp'] ?? 0));

    if (!generateVideoThumbnail($videoPath, $thumbPath, (string)$seekTime)) {
        respondError('Failed to extract thumbnail', 500);
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
    unset($video['duration'], $video['width'], $video['height']);

    if ($isPhoto) {
        $meta = probeImage($destPath);
        if ($meta) { $video['width'] = $meta['width']; $video['height'] = $meta['height']; }
        $thumbFilename = $video['id'] . '.jpg';
        $proxyFilename = $video['id'] . '_proxy.jpg';
        generatePhotoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename);
        generatePhotoProxy($destPath, PROXY_DIR . '/' . $proxyFilename);
        $video['thumbnail'] = $thumbFilename;
        $video['proxy'] = $proxyFilename;
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
            generatePhotoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename);
            generatePhotoProxy($destPath, PROXY_DIR . '/' . $proxyFilename);
            $item['thumbnail'] = $thumbFilename;
            $item['proxy'] = $proxyFilename;
        } else {
            $meta = probeVideo($destPath);
            if ($meta) {
                $item['duration'] = $meta['duration'];
                $item['width'] = $meta['width'];
                $item['height'] = $meta['height'];
            }
            // Generate video thumbnail
            $thumbFilename = $itemId . '.jpg';
            if (generateVideoThumbnail($destPath, THUMBS_DIR . '/' . $thumbFilename)) {
                $item['thumbnail'] = $thumbFilename;
            }
        }

        $videos[] = $item;
        $imported[] = $item;
    }

    writeGalleryVideos($params['gid'], $videos);
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
            return $gallery;
        }
    }
    return $gallery;
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
    if (!empty($gallery['password'])) {
        respond(['passwordRequired' => true, 'galleryName' => $gallery['name']]);
    }
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

    $ext = pathinfo($video['filename'], PATHINFO_EXTENSION);
    $downloadName = preg_replace('/[^a-zA-Z0-9 .\-]/', '', $video['title']) . '.' . $ext;

    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    header('Content-Length: ' . filesize($filePath));
    readfile($filePath);
    exit;
}

// Download all as ZIP
// Download info — returns file count, total size, and chunk breakdown
define('CHUNK_MAX_BYTES', 2 * 1024 * 1024 * 1024); // 2GB per chunk

if ($method === 'GET' && matchRoute('/api/proofing/{token}/download-info', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);

    $items = array_values(array_filter(readGalleryVideos($gallery['id']), fn($v) => in_array($v['type'] ?? '', ['video', 'photo'])));
    $totalSize = 0;
    $files = [];
    foreach ($items as $v) {
        $filePath = UPLOADS_DIR . '/' . $v['filename'];
        $size = file_exists($filePath) ? filesize($filePath) : 0;
        $files[] = ['title' => $v['title'], 'size' => $size];
        $totalSize += $size;
    }

    // Calculate chunks
    $chunks = [];
    $chunkSize = 0;
    $chunkFiles = 0;
    $chunkNum = 1;
    foreach ($files as $f) {
        if ($chunkSize + $f['size'] > CHUNK_MAX_BYTES && $chunkFiles > 0) {
            $chunks[] = ['part' => $chunkNum, 'size' => $chunkSize, 'fileCount' => $chunkFiles];
            $chunkNum++;
            $chunkSize = 0;
            $chunkFiles = 0;
        }
        $chunkSize += $f['size'];
        $chunkFiles++;
    }
    if ($chunkFiles > 0) {
        $chunks[] = ['part' => $chunkNum, 'size' => $chunkSize, 'fileCount' => $chunkFiles];
    }

    respond([
        'fileCount' => count($files),
        'totalSize' => $totalSize,
        'chunks' => $chunks,
    ]);
}

// Download all as ZIP (supports ?part=N for chunked downloads)
if ($method === 'GET' && matchRoute('/api/proofing/{token}/download-all', $uri, $params)) {
    $gallery = getProofingGallery($params['token']);
    if (!$gallery['downloadsEnabled']) respondError('Downloads disabled', 403);

    $items = array_values(array_filter(readGalleryVideos($gallery['id']), fn($v) => in_array($v['type'] ?? '', ['video', 'photo'])));
    $requestedPart = isset($_GET['part']) ? (int)$_GET['part'] : 0;

    // If part requested, calculate which files belong to this chunk
    if ($requestedPart > 0) {
        $chunkFiles = [];
        $chunkSize = 0;
        $chunkNum = 1;
        $currentChunk = [];
        foreach ($items as $v) {
            $filePath = UPLOADS_DIR . '/' . $v['filename'];
            $size = file_exists($filePath) ? filesize($filePath) : 0;
            if ($chunkSize + $size > CHUNK_MAX_BYTES && count($currentChunk) > 0) {
                if ($chunkNum === $requestedPart) { $chunkFiles = $currentChunk; break; }
                $chunkNum++;
                $chunkSize = 0;
                $currentChunk = [];
            }
            $chunkSize += $size;
            $currentChunk[] = $v;
        }
        if (empty($chunkFiles) && $chunkNum === $requestedPart) {
            $chunkFiles = $currentChunk;
        }
        if (empty($chunkFiles)) respondError('Invalid part number', 400);
        $items = $chunkFiles;
    }

    $safeName = preg_replace('/[^a-zA-Z0-9 .\-]/', '', $gallery['name']);
    $zipName = $requestedPart > 0 ? "$safeName - Part $requestedPart.zip" : "$safeName.zip";
    $tmpFile = tempnam(sys_get_temp_dir(), 'zip');

    $zip = new ZipArchive();
    $zip->open($tmpFile, ZipArchive::OVERWRITE);
    foreach ($items as $v) {
        $filePath = UPLOADS_DIR . '/' . $v['filename'];
        if (file_exists($filePath)) {
            $ext = pathinfo($v['filename'], PATHINFO_EXTENSION);
            $name = preg_replace('/[^a-zA-Z0-9 .\-]/', '', $v['title']) . '.' . $ext;
            $zip->addFile($filePath, $name);
        }
    }
    $zip->close();

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $zipName . '"');
    header('Content-Length: ' . filesize($tmpFile));
    readfile($tmpFile);
    unlink($tmpFile);
    exit;
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
        $col['hasPassword'] = !empty($col['password']);
        unset($col['password']);
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
        'active' => true,
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
    if (!empty($col['password'])) {
        respond(['passwordRequired' => true, 'collectionName' => $col['name']]);
    }
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

// Update check — compare local vs remote version
if ($method === 'GET' && $uri === '/api/settings/update') {
    requireAuth();
    $dir = __DIR__;
    $branch = preg_replace('/[^a-zA-Z0-9\/_-]/', '', env('DEPLOY_BRANCH', 'main'));
    $enabled = env('DEPLOY_ENABLED') !== 'false';

    // Current local version
    $versionFile = $dir . '/VERSION';
    $localVersion = file_exists($versionFile) ? trim(file_get_contents($versionFile)) : 'unknown';

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
        'branch' => env('DEPLOY_BRANCH', 'main'),
    ]);
}

if ($method === 'POST' && $uri === '/api/settings/deploy') {
    requireAuth();
    if (env('DEPLOY_ENABLED') === 'false') respondError('Deploy is disabled. Set DEPLOY_ENABLED=true in .env to enable.', 403);

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

    $cmd = "{$setRemote}git fetch origin && git checkout $branch && git pull origin $branch 2>&1";
    $output = shell_exec($cmd);
    $exitCode = ($output === null) ? -1 : 0;

    // Check for failure indicators in output
    $failed = ($output === null) || preg_match('/fatal:|error:|CONFLICT/i', $output);

    // Write log
    $logEntry = "[$timestamp] Branch: $branch\n"
        . "Command: git fetch origin && git checkout $branch && git pull origin $branch\n"
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
