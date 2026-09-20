<?php
/**
 * Local development router:
 *
 *   php -S localhost:8080 tools/dev-router.php
 *
 * `php -S` ignores .htaccess, where all of production's routing lives. This
 * replays the root .htaccess rules in the same order — page rewrites, then the
 * denials, then the site-data media mappings, then /api/, then public/ — so
 * local testing sees the same URLs and the same 403s. Keep it in sync with
 * .htaccess. It only emulates: check the real rules once on a live host.
 */

// Ships with the site, so a live web server can reach it too. It serves files,
// so it must do nothing there.
if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$rel = ltrim($path, '/');

function devDeny() {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "Forbidden\n";
    return true;
}

// The .htaccess denials, applied to a docroot-relative path. Run once on the
// requested path and again after a media rewrite, as Apache re-enters rules.
function devDenied($root, $rel) {
    if (preg_match('#(^|/)\.(?!well-known(/|$))#', $rel)) return true;
    if (preg_match('#^[^/]+\.md$#', $rel)) return true;
    if (strpos($rel, 'tools/') === 0) return true;
    if (preg_match('#^site-data/(?!(uploads|thumbnails|proxies|captions|logo|portfolio)/)#', $rel)) return true;
    if (preg_match('#^site-data/portfolio/(?!.*\.(jpe?g|png|webp|gif|mp4|webm|mov|m4v|vtt)$)#i', $rel)) return true;
    if (preg_match('#^site-data/portfolio/.*\.(php\d?|phtml|phar|cgi|pl|py)(\.|$)#i', $rel)) return true;
    if (strpos($rel, 'site-data/') === 0 && is_dir("$root/$rel")) return true;
    return false;
}

// Serves a file with Range support, which video seeking needs.
function devServe($file) {
    $types = [
        'html' => 'text/html; charset=utf-8', 'css' => 'text/css', 'js' => 'text/javascript',
        'mjs' => 'text/javascript', 'json' => 'application/json', 'svg' => 'image/svg+xml',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
        'gif' => 'image/gif', 'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'mov' => 'video/quicktime',
        'webm' => 'video/webm', 'vtt' => 'text/vtt', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2',
    ];
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $size = filesize($file);
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('Accept-Ranges: bytes');
    $start = 0;
    $end = $size - 1;
    if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'] ?? '', $m)) {
        if ($m[1] === '') { $start = max(0, $size - (int)$m[2]); }
        else { $start = (int)$m[1]; if ($m[2] !== '') $end = min((int)$m[2], $size - 1); }
        if ($start > $end) { http_response_code(416); header("Content-Range: bytes */$size"); return true; }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') return true;
    // Flush every chunk. Without this the built-in server holds a large
    // response until the script ends, so a browser's <video> sits at
    // readyState 0 for the whole download and never shows a first frame.
    @set_time_limit(0);
    while (ob_get_level() > 0) ob_end_flush();
    $fh = fopen($file, 'rb');
    fseek($fh, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($fh)) {
        $chunk = fread($fh, min(1 << 20, $left));
        echo $chunk;
        flush();
        $left -= strlen($chunk);
    }
    fclose($fh);
    return true;
}

$pages = [
    '#^admin/?$#' => 'public/admin.html',
    '#^gallery/.+$#' => 'public/proofing.html',
    '#^collection/.+$#' => 'public/collection.html',
    '#^d/.+$#' => 'public/download.html',
    '#^portfolio(/.*)?$#' => 'public/portfolio.html',
];
foreach ($pages as $re => $target) {
    if (preg_match($re, $rel)) return devServe("$root/$target");
}

if (devDenied($root, $rel)) return devDeny();

foreach (['uploads', 'thumbnails', 'proxies', 'captions', 'logo'] as $d) {
    if (strpos($rel, "$d/") === 0) { $rel = "site-data/$rel"; break; }
}
if (strpos($rel, 'media/') === 0) $rel = 'site-data/portfolio/' . substr($rel, 6);
if (devDenied($root, $rel)) return devDeny();

if (strpos($rel, 'api/') === 0 && !is_file("$root/$rel")) {
    require "$root/index.php";
    return true;
}

if ($rel === '') return devServe("$root/public/index.html");
if (is_file("$root/$rel")) return devServe("$root/$rel");
if (is_file("$root/public/$rel")) return devServe("$root/public/$rel");
http_response_code(404);
echo "Not found\n";
return true;
