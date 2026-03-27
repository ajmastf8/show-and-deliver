const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, execSync } = require('child_process');
const sharp = require('sharp');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { readGalleryVideos, writeGalleryVideos, readGalleryComments, UPLOADS_DIR, THUMBS_DIR, PROXY_DIR } = require('../lib/dataHelpers');
const { generateId } = require('../lib/tokens');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Find ffmpeg/ffprobe: check system PATH first, then home directory static build
let FFMPEG_PATH = 'ffmpeg';
let FFPROBE_PATH = 'ffprobe';
try {
  execSync('which ffmpeg', { stdio: 'ignore' });
} catch {
  // Not in PATH — look for static build in home directory
  const homeDir = require('os').homedir();
  const dirs = fs.readdirSync(homeDir).filter(d => d.startsWith('ffmpeg-') && d.endsWith('-static'));
  if (dirs.length > 0) {
    const candidate = path.join(homeDir, dirs[0], 'ffmpeg');
    if (fs.existsSync(candidate)) FFMPEG_PATH = candidate;
    const probeCandidate = path.join(homeDir, dirs[0], 'ffprobe');
    if (fs.existsSync(probeCandidate)) FFPROBE_PATH = probeCandidate;
  }
}
console.log('ffmpeg path:', FFMPEG_PATH);
console.log('ffprobe path:', FFPROBE_PATH);

// Probe video metadata (duration, width, height)
function probeVideo(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];
    execFile(FFPROBE_PATH, args, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.error('ffprobe error:', err.message);
        return resolve(null);
      }
      try {
        const info = JSON.parse(stdout);
        const videoStream = (info.streams || []).find(s => s.codec_type === 'video');
        const duration = parseFloat(info.format?.duration) || 0;
        const width = videoStream ? parseInt(videoStream.width) || 0 : 0;
        const height = videoStream ? parseInt(videoStream.height) || 0 : 0;
        resolve({ duration, width, height });
      } catch (e) {
        console.error('ffprobe parse error:', e.message);
        resolve(null);
      }
    });
  });
}

// Probe image metadata (width, height) using sharp
async function probeImage(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width || 0, height: meta.height || 0 };
  } catch (e) {
    console.error('sharp probe error:', e.message);
    return null;
  }
}

// Generate a resized JPEG thumbnail for a photo
async function generatePhotoThumbnail(filePath, thumbPath) {
  try {
    await sharp(filePath)
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
  } catch (e) {
    console.error('sharp thumbnail error:', e.message);
  }
}

// Generate a web-optimized proxy for lightbox viewing (2048px max)
async function generatePhotoProxy(filePath, proxyPath) {
  try {
    await sharp(filePath)
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(proxyPath);
  } catch (e) {
    console.error('sharp proxy error:', e.message);
  }
}

function isImageFile(filename) {
  return IMAGE_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

// Multer config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/x-quicktime', 'video/mov',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.mp4', '.webm', '.mov', '.m4v', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
    // Require BOTH valid MIME type AND valid extension
    cb(null, allowed.includes(file.mimetype) && allowedExts.includes(ext));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

// --- Videos ---

router.get('/galleries/:gid/videos', requireAuth, (req, res) => {
  res.json(readGalleryVideos(req.params.gid));
});

router.post('/galleries/:gid/videos', requireAuth, (req, res) => {
  console.log('Upload request received for gallery:', req.params.gid, 'content-length:', req.headers['content-length']);
  upload.single('video')(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err.message, err.code || '', err.stack || '');
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 500 MB)' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      console.error('Upload rejected: no file in request. Content-Type:', req.headers['content-type']);
      return res.status(400).json({ error: 'No file — file may have been rejected (allowed: .mp4, .webm, .mov, .m4v, .jpg, .jpeg, .png, .webp, .gif)' });
    }

    console.log('Upload OK:', req.file.originalname, '->', req.file.filename, '(' + req.file.size + ' bytes, ' + req.file.mimetype + ')');

    const isPhoto = isImageFile(req.file.filename);
    const videos = readGalleryVideos(req.params.gid);
    const item = {
      id: generateId(isPhoto ? 'p_' : 'v_'),
      type: isPhoto ? 'photo' : 'video',
      title: req.body.title || 'Untitled',
      filename: req.file.filename,
      visible: true,
      createdAt: new Date().toISOString()
    };

    if (isPhoto) {
      const meta = await probeImage(path.join(UPLOADS_DIR, req.file.filename));
      if (meta) { item.width = meta.width; item.height = meta.height; }
      const thumbFilename = item.id + '.jpg';
      const proxyFilename = item.id + '_proxy.jpg';
      await Promise.all([
        generatePhotoThumbnail(path.join(UPLOADS_DIR, req.file.filename), path.join(THUMBS_DIR, thumbFilename)),
        generatePhotoProxy(path.join(UPLOADS_DIR, req.file.filename), path.join(PROXY_DIR, proxyFilename))
      ]);
      item.thumbnail = thumbFilename;
      item.proxy = proxyFilename;
    } else {
      const meta = await probeVideo(path.join(UPLOADS_DIR, req.file.filename));
      if (meta) {
        item.duration = meta.duration;
        item.width = meta.width;
        item.height = meta.height;
      }
    }

    videos.push(item);
    writeGalleryVideos(req.params.gid, videos);
    res.json(item);
  });
});

router.put('/galleries/:gid/videos/:vid', requireAuth, (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  const video = videos.find(v => v.id === req.params.vid);
  if (!video) return res.status(404).json({ error: 'Not found' });

  if (req.body.title !== undefined) video.title = req.body.title;
  if (req.body.visible !== undefined) video.visible = req.body.visible;

  writeGalleryVideos(req.params.gid, videos);
  res.json(video);
});

router.put('/galleries/:gid/videos/:vid/thumbnail', requireAuth, (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  const video = videos.find(v => v.id === req.params.vid);
  if (!video) return res.status(404).json({ error: 'Not found' });

  if (video.type === 'photo') {
    return res.status(400).json({ error: 'Photo thumbnails are generated automatically' });
  }

  const { timestamp } = req.body;
  if (timestamp === undefined || timestamp === null) {
    return res.status(400).json({ error: 'No timestamp provided' });
  }

  const videoPath = path.join(UPLOADS_DIR, video.filename);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found on disk' });
  }

  const thumbFilename = video.id + '.jpg';
  const thumbPath = path.join(THUMBS_DIR, thumbFilename);
  const seekTime = Math.max(0, parseFloat(timestamp) || 0).toString();

  // Use ffmpeg to extract a single frame at the given timestamp
  // -ss before -i = fast seek, -frames:v 1 = grab one frame
  // -pix_fmt yuvj420p is the native JPEG pixel format (full-range 8-bit)
  // -threads 1 avoids thread_encoder_init failures on shared hosting
  const args = [
    '-ss', seekTime,
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'scale=320:180',
    '-pix_fmt', 'yuvj420p',
    '-threads', '1',
    '-strict', 'unofficial',
    '-q:v', '2',
    '-y',
    thumbPath
  ];

  execFile(FFMPEG_PATH, args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    // ffmpeg writes info to stderr even on success, so check if the output file exists
    const thumbExists = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size >= 100;

    if (!thumbExists) {
      const lastStderr = stderr ? stderr.slice(-800) : 'no stderr';
      console.error('ffmpeg thumbnail failed:', err ? err.message : 'unknown');
      console.error('ffmpeg stderr:', lastStderr);
      return res.status(500).json({
        error: 'Failed to extract thumbnail',
        detail: lastStderr.split('\n').filter(l => l.includes('Error') || l.includes('failed') || l.includes('Conversion')).join('; ') || 'Check server logs'
      });
    }

    video.thumbnail = thumbFilename;
    writeGalleryVideos(req.params.gid, videos);
    res.json(video);
  });
});

// Replace video file (keep metadata, comments, position)
router.put('/galleries/:gid/videos/:vid/replace', requireAuth, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      console.error('Replace upload error:', err.message, err.code || '');
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 500 MB)' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const videos = readGalleryVideos(req.params.gid);
    const video = videos.find(v => v.id === req.params.vid);
    if (!video) return res.status(404).json({ error: 'Not found' });

    // Delete old file
    const oldPath = path.join(UPLOADS_DIR, video.filename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

    // Delete old thumbnail
    if (video.thumbnail) {
      const thumbPath = path.join(THUMBS_DIR, video.thumbnail);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      video.thumbnail = null;
    }

    // Delete old proxy
    if (video.proxy) {
      const proxyPath = path.join(PROXY_DIR, video.proxy);
      if (fs.existsSync(proxyPath)) fs.unlinkSync(proxyPath);
      video.proxy = null;
    }

    // Update to new file and detect type
    const isPhoto = isImageFile(req.file.filename);
    video.filename = req.file.filename;
    video.type = isPhoto ? 'photo' : 'video';
    video.replacedAt = new Date().toISOString();

    // Clear old metadata
    delete video.duration;
    delete video.width;
    delete video.height;

    if (isPhoto) {
      const meta = await probeImage(path.join(UPLOADS_DIR, req.file.filename));
      if (meta) { video.width = meta.width; video.height = meta.height; }
      const thumbFilename = video.id + '.jpg';
      const proxyFilename = video.id + '_proxy.jpg';
      await Promise.all([
        generatePhotoThumbnail(path.join(UPLOADS_DIR, req.file.filename), path.join(THUMBS_DIR, thumbFilename)),
        generatePhotoProxy(path.join(UPLOADS_DIR, req.file.filename), path.join(PROXY_DIR, proxyFilename))
      ]);
      video.thumbnail = thumbFilename;
      video.proxy = proxyFilename;
    }

    writeGalleryVideos(req.params.gid, videos);
    res.json(video);
  });
});

router.delete('/galleries/:gid/videos/:vid', requireAuth, (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  const index = videos.findIndex(v => v.id === req.params.vid);
  if (index === -1) return res.status(404).json({ error: 'Not found' });

  const [removed] = videos.splice(index, 1);

  // Delete video file
  const filePath = path.join(UPLOADS_DIR, removed.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // Delete thumbnail
  if (removed.thumbnail) {
    const thumbPath = path.join(THUMBS_DIR, removed.thumbnail);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }

  // Delete proxy
  if (removed.proxy) {
    const proxyPath = path.join(PROXY_DIR, removed.proxy);
    if (fs.existsSync(proxyPath)) fs.unlinkSync(proxyPath);
  }

  writeGalleryVideos(req.params.gid, videos);
  res.json({ ok: true });
});

// --- Import from Server ---

const IMPORT_DIR = path.join(__dirname, '..', '..', 'site-data', 'imports');
if (!fs.existsSync(IMPORT_DIR)) fs.mkdirSync(IMPORT_DIR, { recursive: true });

const MEDIA_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.jpg', '.jpeg', '.png', '.webp', '.gif'];

// List files available for import
router.get('/import/files', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(IMPORT_DIR)
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return MEDIA_EXTENSIONS.includes(ext);
      })
      .map(f => {
        const stat = fs.statSync(path.join(IMPORT_DIR, f));
        return {
          name: f,
          size: stat.size,
          modified: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ path: IMPORT_DIR, files });
  } catch (err) {
    console.error('Import scan error:', err);
    res.status(500).json({ error: 'Failed to scan import folder' });
  }
});

// Import selected files into a gallery
router.post('/galleries/:gid/import', requireAuth, async (req, res) => {
  const { filenames } = req.body;
  if (!filenames || !filenames.length) {
    return res.status(400).json({ error: 'No files selected' });
  }

  const videos = readGalleryVideos(req.params.gid);
  const imported = [];
  const errors = [];

  for (const originalName of filenames) {
    // Safety: prevent path traversal
    const safeName = path.basename(originalName);
    const srcPath = path.join(IMPORT_DIR, safeName);

    if (!fs.existsSync(srcPath)) {
      errors.push({ name: safeName, error: 'File not found' });
      continue;
    }

    const ext = path.extname(safeName).toLowerCase();
    if (!MEDIA_EXTENSIONS.includes(ext)) {
      errors.push({ name: safeName, error: 'Not a supported media format' });
      continue;
    }

    try {
      // Create unique filename and move to uploads
      const destName = Date.now() + '-' + safeName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const destPath = path.join(UPLOADS_DIR, destName);
      fs.renameSync(srcPath, destPath);

      // Create title from filename
      const title = safeName
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Untitled';

      const isPhoto = isImageFile(destName);
      const itemId = generateId(isPhoto ? 'p_' : 'v_');
      const item = {
        id: itemId,
        type: isPhoto ? 'photo' : 'video',
        title,
        filename: destName,
        visible: true,
        createdAt: new Date().toISOString()
      };

      if (isPhoto) {
        const meta = await probeImage(destPath);
        if (meta) { item.width = meta.width; item.height = meta.height; }
        const thumbFilename = itemId + '.jpg';
        const proxyFilename = itemId + '_proxy.jpg';
        await Promise.all([
          generatePhotoThumbnail(destPath, path.join(THUMBS_DIR, thumbFilename)),
          generatePhotoProxy(destPath, path.join(PROXY_DIR, proxyFilename))
        ]);
        item.thumbnail = thumbFilename;
        item.proxy = proxyFilename;
      } else {
        const meta = await probeVideo(destPath);
        if (meta) {
          item.duration = meta.duration;
          item.width = meta.width;
          item.height = meta.height;
        }

        // Generate video thumbnail in background
        const thumbFilename = itemId + '.jpg';
        const thumbPath = path.join(THUMBS_DIR, thumbFilename);
        const args = [
          '-ss', '1',
          '-i', destPath,
          '-frames:v', '1',
          '-vf', 'scale=320:180',
          '-pix_fmt', 'yuvj420p',
          '-threads', '1',
          '-strict', 'unofficial',
          '-q:v', '2',
          '-y',
          thumbPath
        ];
        execFile(FFMPEG_PATH, args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err) => {
          if (!err && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size >= 100) {
            const vids = readGalleryVideos(req.params.gid);
            const v = vids.find(v => v.id === itemId);
            if (v) {
              v.thumbnail = thumbFilename;
              writeGalleryVideos(req.params.gid, vids);
            }
          }
        });
      }

      videos.push(item);
      imported.push(item);
    } catch (err) {
      console.error('Import error for', safeName, ':', err.message);
      errors.push({ name: safeName, error: err.message });
    }
  }

  writeGalleryVideos(req.params.gid, videos);
  res.json({ imported, errors });
});

// --- Backfill metadata for existing videos ---

router.post('/galleries/:gid/probe', requireAuth, async (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  let updated = 0;
  for (const item of videos) {
    const filePath = path.join(UPLOADS_DIR, item.filename);
    if (!fs.existsSync(filePath)) continue;

    if (item.type === 'video' && !item.duration) {
      const meta = await probeVideo(filePath);
      if (meta) {
        item.duration = meta.duration;
        item.width = meta.width;
        item.height = meta.height;
        updated++;
      }
    } else if (item.type === 'photo' && !item.width) {
      const meta = await probeImage(filePath);
      if (meta) {
        item.width = meta.width;
        item.height = meta.height;
        updated++;
      }
      if (!item.thumbnail) {
        const thumbFilename = item.id + '.jpg';
        await generatePhotoThumbnail(filePath, path.join(THUMBS_DIR, thumbFilename));
        item.thumbnail = thumbFilename;
      }
    }
  }
  writeGalleryVideos(req.params.gid, videos);
  res.json({ ok: true, updated });
});

// --- Headers ---

router.post('/galleries/:gid/headers', requireAuth, (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  const header = {
    id: generateId('h_'),
    type: 'header',
    text: req.body.text || 'Section',
    createdAt: new Date().toISOString()
  };
  videos.push(header);
  writeGalleryVideos(req.params.gid, videos);
  res.json(header);
});

router.put('/galleries/:gid/headers/:hid', requireAuth, (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  const header = videos.find(v => v.id === req.params.hid && v.type === 'header');
  if (!header) return res.status(404).json({ error: 'Not found' });

  if (req.body.text !== undefined) header.text = req.body.text;

  writeGalleryVideos(req.params.gid, videos);
  res.json(header);
});

router.delete('/galleries/:gid/headers/:hid', requireAuth, (req, res) => {
  const videos = readGalleryVideos(req.params.gid);
  const index = videos.findIndex(v => v.id === req.params.hid && v.type === 'header');
  if (index === -1) return res.status(404).json({ error: 'Not found' });

  videos.splice(index, 1);
  writeGalleryVideos(req.params.gid, videos);
  res.json({ ok: true });
});

// --- Reorder ---

router.put('/galleries/:gid/reorder', requireAuth, (req, res) => {
  const { order } = req.body;
  const videos = readGalleryVideos(req.params.gid);
  const videoMap = new Map(videos.map(v => [v.id, v]));
  const reordered = order.map(id => videoMap.get(id)).filter(Boolean);

  videos.forEach(v => {
    if (!order.includes(v.id)) reordered.push(v);
  });

  writeGalleryVideos(req.params.gid, reordered);
  res.json({ ok: true });
});

// --- Comments (admin view) ---

router.get('/galleries/:gid/comments', requireAuth, (req, res) => {
  const comments = readGalleryComments(req.params.gid);
  const videos = readGalleryVideos(req.params.gid);

  const enriched = comments.map(c => ({
    ...c,
    videoTitle: videos.find(v => v.id === c.videoId)?.title || 'Unknown'
  }));

  res.json(enriched);
});

module.exports = router;
