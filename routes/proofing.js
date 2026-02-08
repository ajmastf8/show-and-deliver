const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { findGalleryByToken, readGalleryVideos, readGalleryComments, writeGalleryComments, UPLOADS_DIR } = require('../lib/dataHelpers');
const { generateId } = require('../lib/tokens');

// Middleware: check gallery access + expiration
function checkAccess(req, res, next) {
  const gallery = findGalleryByToken(req.params.token);
  if (!gallery || !gallery.active) return res.status(404).json({ error: 'Not found' });

  if (gallery.expiresAt && new Date(gallery.expiresAt) < new Date()) {
    return res.status(410).json({ error: 'Gallery expired' });
  }

  req.gallery = gallery;
  next();
}

// Helper: return gallery payload
function galleryPayload(gallery) {
  const videos = readGalleryVideos(gallery.id).filter(v => v.type === 'header' || v.visible !== false);
  const comments = readGalleryComments(gallery.id);
  return {
    gallery: {
      name: gallery.name,
      downloadsEnabled: gallery.downloadsEnabled
    },
    videos,
    comments
  };
}

// GET gallery data
router.get('/:token', checkAccess, (req, res) => {
  const gallery = req.gallery;

  // If password-protected, require unlock first
  if (gallery.password) {
    return res.json({ passwordRequired: true, galleryName: gallery.name });
  }

  res.json(galleryPayload(gallery));
});

// POST unlock password-protected gallery
router.post('/:token/unlock', checkAccess, (req, res) => {
  const gallery = req.gallery;
  if (!gallery.password) {
    return res.json(galleryPayload(gallery));
  }

  const { password } = req.body;
  if (!password || password !== gallery.password) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  res.json(galleryPayload(gallery));
});

// POST comment
router.post('/:token/comments', checkAccess, (req, res) => {
  const { videoId, name, text, timestamp } = req.body;
  if (!videoId || !name || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const gallery = req.gallery;
  const videos = readGalleryVideos(gallery.id);
  const video = videos.find(v => v.id === videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const comment = {
    id: generateId('c_'),
    videoId,
    name: name.trim(),
    text: text.trim(),
    timestamp: parseFloat(timestamp) || 0,
    createdAt: new Date().toISOString()
  };

  const comments = readGalleryComments(gallery.id);
  comments.push(comment);
  writeGalleryComments(gallery.id, comments);

  res.json(comment);
});

// GET download single video
router.get('/:token/download/:videoId', checkAccess, (req, res) => {
  if (!req.gallery.downloadsEnabled) return res.status(403).json({ error: 'Downloads disabled' });

  const videos = readGalleryVideos(req.gallery.id);
  const video = videos.find(v => v.id === req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(UPLOADS_DIR, video.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const ext = path.extname(video.filename);
  const downloadName = video.title.replace(/[^a-zA-Z0-9 .-]/g, '') + ext;
  res.download(filePath, downloadName);
});

// GET download all as zip
router.get('/:token/download-all', checkAccess, async (req, res) => {
  if (!req.gallery.downloadsEnabled) return res.status(403).json({ error: 'Downloads disabled' });

  const archiver = require('archiver');
  const videos = readGalleryVideos(req.gallery.id).filter(v => v.type === 'video');

  const safeName = req.gallery.name.replace(/[^a-zA-Z0-9 .-]/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', err => { console.error('Archive error:', err); res.status(500).end(); });
  archive.pipe(res);

  for (const video of videos) {
    const filePath = path.join(UPLOADS_DIR, video.filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(video.filename);
      const name = video.title.replace(/[^a-zA-Z0-9 .-]/g, '') + ext;
      archive.file(filePath, { name });
    }
  }

  await archive.finalize();
});

module.exports = router;
