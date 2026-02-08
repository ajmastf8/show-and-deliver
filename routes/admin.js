const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { readGalleryVideos, writeGalleryVideos, readGalleryComments, UPLOADS_DIR, THUMBS_DIR } = require('../lib/dataHelpers');
const { generateId } = require('../lib/tokens');

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

  const { dataUrl } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'No image data' });

  // Strip data URL prefix — support any image MIME type (jpeg, jpg, png, webp, etc.)
  const base64Data = dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '');

  // Validate: ensure prefix was actually stripped
  if (base64Data === dataUrl) {
    return res.status(400).json({ error: 'Invalid data URL format' });
  }
  // Validate: a real 320x180 JPEG is several KB; anything tiny means capture failed
  if (base64Data.length < 100) {
    return res.status(400).json({ error: 'Thumbnail data is too small — capture may have failed' });
  }

  const thumbFilename = video.id + '.jpg';
  fs.writeFileSync(path.join(THUMBS_DIR, thumbFilename), base64Data, 'base64');

  video.thumbnail = thumbFilename;
  writeGalleryVideos(req.params.gid, videos);
  res.json(video);
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
