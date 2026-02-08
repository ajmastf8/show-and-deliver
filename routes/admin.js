const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, execSync } = require('child_process');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { readGalleryVideos, writeGalleryVideos, readGalleryComments, UPLOADS_DIR, THUMBS_DIR } = require('../lib/dataHelpers');
const { generateId } = require('../lib/tokens');

// Find ffmpeg: check system PATH first, then home directory static build
let FFMPEG_PATH = 'ffmpeg';
try {
  execSync('which ffmpeg', { stdio: 'ignore' });
} catch {
  // Not in PATH — look for static build in home directory
  const homeDir = require('os').homedir();
  const dirs = fs.readdirSync(homeDir).filter(d => d.startsWith('ffmpeg-') && d.endsWith('-static'));
  if (dirs.length > 0) {
    const candidate = path.join(homeDir, dirs[0], 'ffmpeg');
    if (fs.existsSync(candidate)) FFMPEG_PATH = candidate;
  }
}
console.log('ffmpeg path:', FFMPEG_PATH);

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
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/x-quicktime', 'video/mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.mp4', '.webm', '.mov', '.m4v'];
    cb(null, allowed.includes(file.mimetype) || allowedExts.includes(ext));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

// --- Videos ---

router.get('/galleries/:gid/videos', requireAuth, (req, res) => {
  res.json(readGalleryVideos(req.params.gid));
});

router.post('/galleries/:gid/videos', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file' });

  const videos = readGalleryVideos(req.params.gid);
  const video = {
    id: generateId('v_'),
    type: 'video',
    title: req.body.title || 'Untitled',
    filename: req.file.filename,
    visible: true,
    createdAt: new Date().toISOString()
  };
  videos.push(video);
  writeGalleryVideos(req.params.gid, videos);
  res.json(video);
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
  // -ss before -i = fast seek, -frames:v 1 = grab one frame, -vf scale = resize to 320x180
  const args = [
    '-ss', seekTime,
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
    '-q:v', '2',
    '-y',
    thumbPath
  ];

  execFile(FFMPEG_PATH, args, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('ffmpeg thumbnail error:', err.message, stderr);
      return res.status(500).json({ error: 'Failed to extract thumbnail: ' + err.message });
    }

    // Verify the file was actually created
    if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size < 100) {
      return res.status(500).json({ error: 'ffmpeg produced an empty or missing thumbnail' });
    }

    video.thumbnail = thumbFilename;
    writeGalleryVideos(req.params.gid, videos);
    res.json(video);
  });
});

// Replace video file (keep metadata, comments, position)
router.put('/galleries/:gid/videos/:vid/replace', requireAuth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file' });

  const videos = readGalleryVideos(req.params.gid);
  const video = videos.find(v => v.id === req.params.vid);
  if (!video) return res.status(404).json({ error: 'Not found' });

  // Delete old video file
  const oldPath = path.join(UPLOADS_DIR, video.filename);
  if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

  // Delete old thumbnail (new video needs a fresh one)
  if (video.thumbnail) {
    const thumbPath = path.join(THUMBS_DIR, video.thumbnail);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    video.thumbnail = null;
  }

  // Update to new file
  video.filename = req.file.filename;
  video.replacedAt = new Date().toISOString();

  writeGalleryVideos(req.params.gid, videos);
  res.json(video);
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

  writeGalleryVideos(req.params.gid, videos);
  res.json({ ok: true });
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
