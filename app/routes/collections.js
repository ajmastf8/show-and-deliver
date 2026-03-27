const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { readCollections, writeCollections, findCollectionByToken, readGalleries, readGalleryVideos } = require('../lib/dataHelpers');
const { generateToken, generateId } = require('../lib/tokens');

// GET all collections (admin)
router.get('/', requireAuth, (req, res) => {
  const collections = readCollections();
  const galleries = readGalleries();

  // Enrich each collection with gallery summary data
  const enriched = collections.map(col => {
    const colGalleries = col.galleryIds
      .map(gid => galleries.find(g => g.id === gid))
      .filter(Boolean)
      .map(g => ({
        id: g.id,
        name: g.name,
        type: g.type,
        active: g.active,
        token: g.token
      }));
    return { ...col, galleries: colGalleries };
  });

  res.json(enriched);
});

// POST create collection
router.post('/', requireAuth, (req, res) => {
  const collections = readCollections();

  const collection = {
    id: generateId('col_'),
    name: req.body.name || 'New Collection',
    token: generateToken(),
    galleryIds: req.body.galleryIds || [],
    createdAt: new Date().toISOString()
  };

  collections.push(collection);
  writeCollections(collections);
  res.json(collection);
});

// PUT update collection
router.put('/:id', requireAuth, (req, res) => {
  const collections = readCollections();
  const col = collections.find(c => c.id === req.params.id);
  if (!col) return res.status(404).json({ error: 'Not found' });

  if (req.body.name !== undefined) col.name = req.body.name;
  if (req.body.galleryIds !== undefined) col.galleryIds = req.body.galleryIds;
  if (req.body.regenerateToken) col.token = generateToken();

  writeCollections(collections);
  res.json(col);
});

// DELETE collection (galleries are preserved)
router.delete('/:id', requireAuth, (req, res) => {
  const collections = readCollections();
  const index = collections.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });

  collections.splice(index, 1);
  writeCollections(collections);
  res.json({ ok: true });
});

// GET public collection by token (no auth)
router.get('/public/:token', (req, res) => {
  const col = findCollectionByToken(req.params.token);
  if (!col) return res.status(404).json({ error: 'Collection not found' });

  const galleries = readGalleries();
  const publicGalleries = col.galleryIds
    .map(gid => galleries.find(g => g.id === gid))
    .filter(g => g && g.active && g.type === 'proofing')
    .map(g => {
      // Get first video thumbnail for the gallery card
      const videos = readGalleryVideos(g.id).filter(v => v.type !== 'header');
      const thumb = videos.length > 0 ? videos[0].thumbnail : null;
      return {
        name: g.name,
        token: g.token,
        thumbnail: thumb,
        videoCount: videos.length
      };
    });

  res.json({
    name: col.name,
    galleries: publicGalleries
  });
});

module.exports = router;
