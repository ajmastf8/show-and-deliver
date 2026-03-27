const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { readGalleries, writeGalleries, readGalleryVideos, ensureGalleryDir, galleryDir, readCollections, writeCollections } = require('../lib/dataHelpers');
const { generateToken, generateId } = require('../lib/tokens');

const BCRYPT_ROUNDS = 10;

// Strip password hash from gallery objects sent to client
function sanitizeGallery(gallery) {
  const { password, ...rest } = gallery;
  return { ...rest, hasPassword: !!password };
}

// GET all galleries
router.get('/', requireAuth, (req, res) => {
  const { readGalleryComments } = require('../lib/dataHelpers');
  const galleries = readGalleries().map(g => {
    const sanitized = sanitizeGallery(g);
    sanitized.videoCount = readGalleryVideos(g.id).filter(v => v.type !== 'header').length;
    sanitized.commentCount = g.type === 'proofing' ? readGalleryComments(g.id).length : 0;
    return sanitized;
  });

  res.json(galleries);
});

// POST create gallery
router.post('/', requireAuth, async (req, res) => {
  const galleries = readGalleries();
  const id = generateId('g_');
  const type = req.body.type || 'proofing';

  // Hash password if provided
  let hashedPassword = null;
  if (req.body.password) {
    hashedPassword = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
  }

  const gallery = {
    id,
    name: req.body.name || 'New Gallery',
    type,
    token: type === 'proofing' ? generateToken() : null,
    password: hashedPassword,
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
  res.json(sanitizeGallery(gallery));
});

// PUT update gallery
router.put('/:id', requireAuth, async (req, res) => {
  const galleries = readGalleries();
  const gallery = galleries.find(g => g.id === req.params.id);
  if (!gallery) return res.status(404).json({ error: 'Not found' });

  if (req.body.name !== undefined) gallery.name = req.body.name;
  if (req.body.password !== undefined) {
    // Hash new password, or clear if empty
    gallery.password = req.body.password
      ? await bcrypt.hash(req.body.password, BCRYPT_ROUNDS)
      : null;
  }
  if (req.body.downloadsEnabled !== undefined) gallery.downloadsEnabled = req.body.downloadsEnabled;
  if (req.body.expiresAt !== undefined) gallery.expiresAt = req.body.expiresAt;
  if (req.body.active !== undefined) gallery.active = req.body.active;

  if (req.body.regenerateToken && gallery.type === 'proofing') {
    gallery.token = generateToken();
  }

  writeGalleries(galleries);
  res.json(sanitizeGallery(gallery));
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

  // Remove deleted gallery from any collections
  const collections = readCollections();
  let collectionsChanged = false;
  collections.forEach(col => {
    const idx = col.galleryIds.indexOf(gallery.id);
    if (idx !== -1) {
      col.galleryIds.splice(idx, 1);
      collectionsChanged = true;
    }
  });
  if (collectionsChanged) writeCollections(collections);

  res.json({ ok: true });
});

module.exports = router;
