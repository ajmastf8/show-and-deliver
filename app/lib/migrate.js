const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeGalleries, writeGalleryVideos, writeGalleryComments, ensureGalleryDir } = require('./dataHelpers');
const { generateId } = require('./tokens');

function migrateIfNeeded() {
  const galleriesPath = path.join(DATA_DIR, 'galleries.json');

  // Already migrated
  if (fs.existsSync(galleriesPath)) return;

  console.log('Migrating to multi-gallery structure...');

  const reelsId = generateId('g_');

  const gallery = {
    id: reelsId,
    name: 'Video Reels',
    type: 'reels',
    token: null,
    downloadsEnabled: false,
    expiresAt: null,
    active: true,
    createdAt: new Date().toISOString()
  };

  ensureGalleryDir(reelsId);

  // Migrate existing videos.json if it exists
  const oldVideosPath = path.join(DATA_DIR, 'videos.json');
  if (fs.existsSync(oldVideosPath)) {
    const oldVideos = JSON.parse(fs.readFileSync(oldVideosPath, 'utf8'));
    writeGalleryVideos(reelsId, oldVideos);
    fs.renameSync(oldVideosPath, oldVideosPath + '.backup');
    console.log('Existing videos migrated. Backup saved as videos.json.backup');
  } else {
    writeGalleryVideos(reelsId, []);
  }

  writeGalleryComments(reelsId, []);
  writeGalleries([gallery]);

  console.log('Migration complete.');
}

module.exports = { migrateIfNeeded };
