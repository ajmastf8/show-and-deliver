const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { findGalleryByToken, readGalleryVideos, readGalleryComments, writeGalleryComments, UPLOADS_DIR } = require('../lib/dataHelpers');
const { sendReviewSummary } = require('../lib/email');
const { generateId } = require('../lib/tokens');

// Rate limit gallery password unlock: 5 per minute per IP
const unlockLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many unlock attempts. Please try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limit comment posting: 10 per minute per IP
const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many comments. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

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
router.post('/:token/unlock', unlockLimiter, checkAccess, async (req, res) => {
  const gallery = req.gallery;
  if (!gallery.password) {
    return res.json(galleryPayload(gallery));
  }

  const { password } = req.body;
  if (!password) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Support both bcrypt hashes and legacy plaintext passwords
  let match = false;
  if (gallery.password.startsWith('$2b$') || gallery.password.startsWith('$2a$')) {
    const bcrypt = require('bcryptjs');
    match = await bcrypt.compare(password, gallery.password);
  } else {
    // Legacy plaintext comparison (will be replaced once password is re-saved)
    match = password === gallery.password;
  }

  if (!match) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  res.json(galleryPayload(gallery));
});

// POST comment
router.post('/:token/comments', commentLimiter, checkAccess, (req, res) => {
  const { videoId, name, text, timestamp } = req.body;
  if (!videoId || !name || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Name is too long (max 100 characters)' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'Comment is too long (max 5000 characters)' });
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

// POST send review summary email
router.post('/:token/send-review', checkAccess, async (req, res) => {
  const { reviewerName, videoId } = req.body;
  if (!reviewerName) {
    return res.status(400).json({ error: 'Reviewer name is required' });
  }

  const gallery = req.gallery;
  const videos = readGalleryVideos(gallery.id);
  const comments = readGalleryComments(gallery.id);

  // Filter to this reviewer's comments, scoped to the current video if provided
  let reviewerComments = comments.filter(c => c.name === reviewerName);
  if (videoId) {
    reviewerComments = reviewerComments.filter(c => c.videoId === videoId);
  }

  if (!reviewerComments.length) {
    return res.status(400).json({ error: 'No comments found for this reviewer' });
  }

  // Find the video title for the subject line
  const video = videoId ? videos.find(v => v.id === videoId) : null;
  const videoTitle = video ? video.title : null;

  try {
    await sendReviewSummary({ gallery, videos, comments: reviewerComments, reviewerName, videoTitle, videoId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to send review email' });
  }
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

  // Uploaded media (mp4/webm/jpg/png) is already compressed; deflate wastes CPU for
  // ~0 size savings and throttles throughput. Disable socket timeouts so large
  // archives aren't killed mid-stream by proxy/Node defaults.
  req.setTimeout(0);
  res.setTimeout(0);

  const safeName = req.gallery.name.replace(/[^a-zA-Z0-9 .-]/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

  const archive = archiver('zip', { store: true });
  archive.on('error', err => { console.error('Archive error:', err); res.status(500).end(); });
  archive.on('warning', err => { if (err.code !== 'ENOENT') console.error('Archive warning:', err); });
  req.on('close', () => { archive.abort(); });
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
