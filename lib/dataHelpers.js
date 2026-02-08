const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const THUMBS_DIR = path.join(__dirname, '..', 'thumbnails');

// Ensure base directories exist
[DATA_DIR, UPLOADS_DIR, THUMBS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function readJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// --- Galleries ---

function readGalleries() {
  return readJSON(path.join(DATA_DIR, 'galleries.json')) || [];
}

function writeGalleries(galleries) {
  writeJSON(path.join(DATA_DIR, 'galleries.json'), galleries);
}

function findReelsGallery() {
  return readGalleries().find(g => g.type === 'reels' && g.active);
}

function findGalleryByToken(token) {
  return readGalleries().find(g => g.token === token && g.type === 'proofing');
}

// --- Gallery Videos ---

function galleryDir(galleryId) {
  return path.join(DATA_DIR, 'gallery-' + galleryId);
}

function ensureGalleryDir(galleryId) {
  const dir = galleryDir(galleryId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readGalleryVideos(galleryId) {
  return readJSON(path.join(galleryDir(galleryId), 'videos.json')) || [];
}

function writeGalleryVideos(galleryId, videos) {
  ensureGalleryDir(galleryId);
  writeJSON(path.join(galleryDir(galleryId), 'videos.json'), videos);
}

// --- Gallery Comments ---

function readGalleryComments(galleryId) {
  return readJSON(path.join(galleryDir(galleryId), 'comments.json')) || [];
}

function writeGalleryComments(galleryId, comments) {
  ensureGalleryDir(galleryId);
  writeJSON(path.join(galleryDir(galleryId), 'comments.json'), comments);
}

// --- Site Settings ---

function readSettings() {
  return readJSON(path.join(DATA_DIR, 'settings.json')) || {};
}

function writeSettings(settings) {
  writeJSON(path.join(DATA_DIR, 'settings.json'), settings);
}

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  THUMBS_DIR,
  readJSON,
  writeJSON,
  readGalleries,
  writeGalleries,
  findReelsGallery,
  findGalleryByToken,
  galleryDir,
  ensureGalleryDir,
  readGalleryVideos,
  writeGalleryVideos,
  readGalleryComments,
  writeGalleryComments,
  readSettings,
  writeSettings
};
