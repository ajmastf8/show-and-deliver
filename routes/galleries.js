const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { readGalleries, writeGalleries, readGalleryVideos, ensureGalleryDir, galleryDir } = require('../lib/dataHelpers');
const { generateToken, generateId } = require('../lib/tokens');

// GET all galleries
router.get('/', requireAuth, (req, res) => {
  const galleries = readGalleries().map(g => ({
    ...g,
    videoCount: readGalleryVideos(g.id).filter(v => v.type !== 'header').length,
    commentCount: 0 // filled below if proofing
  }));

  // Add comment counts for proofing galleries
  const { readGalleryComments } = require('../lib/dataHelpers');
  galleries.forEach(g => {
    if (g.type === 'proofing') {
      g.commentCount = readGalleryComments(g.id).length;
    }
  });

  res.json(galleries);
});

// POST create gallery
router.post('/', requireAuth, (req, res) => {
  const galleries = readGalleries();
  const id = generateId('g_');
  const type = req.body.type || 'proofing';

  const gallery = {
    id,
    name: req.body.name || 'New Gallery',
    type,
    token: type === 'proofing' ? generateToken() : null,
    password: req.body.password || null,
    downloadsEnabled: !!req.body.downloadsEnabled,
    expiresAt: req.body.expiresAt || null,
    active: true,
    createdAt: new Date().toISOString()
  };

  const dir = ensureGalleryDir(id);
  fs.writeFileSync(path.join(dir, 'videos.json'), '[]');
  fs.writeFileSync(path.join(dir, 'comments.json'), '[]');

  galleries.push(gallery);
  writeGalleries(galleries);
  res.json(gallery);
});

// PUT update gallery
router.put('/:id', requireAuth, (req, res) => {
  const galleries = readGalleries();
  const gallery = galleries.find(g => g.id === req.params.id);
  if (!gallery) return res.status(404).json({ error: 'Not found' });

  if (req.body.name !== undefined) gallery.name = req.body.name;
  if (req.body.password !== undefined) gallery.password = req.body.password || null;
  if (req.body.downloadsEnabled !== undefined) gallery.downloadsEnabled = req.body.downloadsEnabled;
  if (req.body.expiresAt !== undefined) gallery.expiresAt = req.body.expiresAt;
  if (req.body.active !== undefined) gallery.active = req.body.active;

  if (req.body.regenerateToken && gallery.type === 'proofing') {
    gallery.token = generateToken();
  }

  writeGalleries(galleries);
  res.json(gallery);
});

// DELETE gallery
router.delete('/:id', requireAuth, (req, res) => {
  const galleries = readGalleries();
  const index = galleries.findIndex(g => g.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });

  const gallery = galleries[index];
  if (gallery.type === 'reels' && galleries.filter(g => g.type === 'reels').length <= 1) {
    return res.status(400).json({ error: 'Cannot delete the only reels gallery' });
  }

  const dir = galleryDir(gallery.id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }

  galleries.splice(index, 1);
  writeGalleries(galleries);
  res.json({ ok: true });
});

module.exports = router;
