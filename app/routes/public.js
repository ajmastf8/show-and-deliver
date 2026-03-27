const express = require('express');
const router = express.Router();
const { findReelsGallery, readGalleryVideos } = require('../lib/dataHelpers');

router.get('/videos', (req, res) => {
  const reels = findReelsGallery();
  if (!reels) return res.json([]);

  const items = readGalleryVideos(reels.id)
    .filter(v => v.type === 'header' || v.visible !== false);
  res.json(items);
});

module.exports = router;
