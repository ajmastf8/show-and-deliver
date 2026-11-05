<?php
/**
 * Show & Deliver release upload endpoint.
 *
 * Put this file in the directory that serves the update artifacts, e.g.
 *   https://hashmy.ajmast.com/port-update/upload.php
 *
 * It writes uploaded files into its own directory. Set the shared secret with
 * `php mkkey.php` (which writes a sibling `key.php`), or by hand in ONE of:
 *   - the UPDATE_UPLOAD_KEY environment variable,
 *   - a sibling `key.php` holding `<?php return 'secret';` (safe over HTTP), or
 *   - a sibling `update-key.txt` (only safe if the dir is not web-served).
 *
 * Upload a release zip:
 *   curl -fsS -X POST "https://hashmy.ajmast.com/port-update/upload.php?name=show-and-deliver-v2.5.1-20261026-0842.zip" \
 *     -H "X-Update-Key: $UPDATE_UPLOAD_KEY" \
 *     -H "Content-Type: application/octet-stream" \
 *     --data-binary @builds/show-and-deliver-v2.5.1-20261026-0842.zip
 *
 * Upload the manifest (overwrites the existing manifest.json):
 *   curl -fsS -X POST "https://hashmy.ajmast.com/port-update/upload.php?name=manifest.json" \
 *     -H "X-Update-Key: $UPDATE_UPLOAD_KEY" \
 *     -H "Content-Type: application/json" \
 *     --data-binary @builds/manifest.json
 *
 * Multipart also works: -F "file=@builds/manifest.json".
 *
 * The key may instead be sent as a form/query field `key`, but a header is
 * preferred so it does not land in access logs or shell history.
 */

declare(strict_types=1);

// Hard ceiling enforced while streaming. The effective limit is also whatever
// php.ini allows: raise upload_max_filesize and post_max_size for big archives.
const MAX_BYTES   = 512 * 1024 * 1024;
const ALLOWED_EXT = ['zip', 'json'];

function out(int $code, array $body): never {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    exit;
}

function load_key(): string {
    $k = getenv('UPDATE_UPLOAD_KEY');
    if ($k !== false && trim($k) !== '') {
        return trim($k);
    }
    // key.php holds `<?php return '...';`. A bare top-level return prints
    // nothing, so requesting the file over HTTP does not disclose the secret.
    // This is the preferred store (see mkkey.php).
    $guard = __DIR__ . '/key.php';
    if (is_file($guard)) {
        $v = require $guard;
        if (is_string($v) && trim($v) !== '') {
            return trim($v);
        }
    }
    // Plain-text fallback: only safe if this directory is not web-served, or
    // the file is denied by the server. Prefer key.php.
    $f = __DIR__ . '/update-key.txt';
    if (is_file($f)) {
        return trim((string) @file_get_contents($f));
    }
    return '';
}

$KEY = load_key();
if ($KEY === '') {
    out(500, ['ok' => false, 'error' => 'Not configured: run mkkey.php (or set UPDATE_UPLOAD_KEY)']);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    out(200, ['ok' => true, 'service' => 'show-and-deliver-update-upload', 'accepts' => 'POST']);
}
if ($method !== 'POST') {
    header('Allow: GET, POST');
    out(405, ['ok' => false, 'error' => 'Method not allowed']);
}

// ---- auth (constant-time) ----
$provided = $_SERVER['HTTP_X_UPDATE_KEY'] ?? ($_POST['key'] ?? ($_GET['key'] ?? ''));
if (!is_string($provided) || $provided === '' || !hash_equals($KEY, $provided)) {
    usleep(250000); // cheap slowdown against guessing
    out(401, ['ok' => false, 'error' => 'Unauthorized']);
}

// ---- destination name: basename only, safe charset, allowed extension ----
$name = $_GET['name'] ?? ($_POST['name'] ?? '');
if ($name === '' && isset($_FILES['file']['name'])) {
    $name = $_FILES['file']['name'];
}
$name = basename((string) $name);
if ($name === '' || !preg_match('/^[A-Za-z0-9._-]{1,200}$/', $name)) {
    out(400, ['ok' => false, 'error' => 'Bad or missing "name"']);
}
$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
if (!in_array($ext, ALLOWED_EXT, true)) {
    out(400, ['ok' => false, 'error' => 'Only .zip and .json are accepted']);
}

$declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($declared > MAX_BYTES) {
    out(413, ['ok' => false, 'error' => 'Too large']);
}

// ---- stream to a temp file, hashing as we go ----
if (isset($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
    $src = $_FILES['file']['tmp_name'];
} else {
    $src = 'php://input';
}

$tmp = __DIR__ . '/.upload-' . bin2hex(random_bytes(8)) . '.part';
$in  = @fopen($src, 'rb');
$outf = @fopen($tmp, 'wb');
if (!$in || !$outf) {
    if ($in) { fclose($in); }
    if ($outf) { fclose($outf); }
    @unlink($tmp);
    out(500, ['ok' => false, 'error' => 'Cannot open upload stream']);
}

$hash  = hash_init('sha256');
$bytes = 0;
$ok    = true;
while (!feof($in)) {
    $chunk = fread($in, 1 << 20);
    if ($chunk === false) { $ok = false; break; }
    if ($chunk === '') { continue; }
    $bytes += strlen($chunk);
    if ($bytes > MAX_BYTES) { $ok = false; break; }
    hash_update($hash, $chunk);
    if (fwrite($outf, $chunk) === false) { $ok = false; break; }
}
fclose($in);
fclose($outf);

if (!$ok) {
    @unlink($tmp);
    out($bytes > MAX_BYTES ? 413 : 500, ['ok' => false, 'error' => $bytes > MAX_BYTES ? 'Too large' : 'Upload failed']);
}
if ($bytes === 0) {
    @unlink($tmp);
    out(400, ['ok' => false, 'error' => 'Empty upload']);
}

$dest = __DIR__ . '/' . $name;
if (!@rename($tmp, $dest)) {
    @unlink($tmp);
    out(500, ['ok' => false, 'error' => 'Cannot write destination']);
}
@chmod($dest, 0644);

out(200, [
    'ok'     => true,
    'name'   => $name,
    'bytes'  => $bytes,
    'sha256' => hash_final($hash),
]);
