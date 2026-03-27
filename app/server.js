try { require('dotenv').config(); } catch (e) { /* dotenv not needed when env vars set via cPanel */ }
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const path = require('path');

const { migrateIfNeeded } = require('./lib/migrate');
const { UPLOADS_DIR, THUMBS_DIR, PROXY_DIR } = require('./lib/dataHelpers');

// --- Startup validation: require critical env vars ---
const requiredEnvVars = ['SESSION_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  console.error('Set these in your .env file or cPanel environment before starting.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: false // allow inline styles/scripts used by the admin UI
}));

// Middleware
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/thumbnails', express.static(THUMBS_DIR));
app.use('/proxies', express.static(PROXY_DIR));
app.use(session({
  store: new FileStore({
    path: path.join(__dirname, '..', 'site-data', 'data', 'sessions'),
    ttl: 7 * 24 * 60 * 60, // 7 days (seconds)
    retries: 0,
    logFn: () => {}  // suppress noisy logs
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/public'));
app.use('/api/galleries', require('./routes/galleries'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/proofing', require('./routes/proofing'));
app.use('/api/collections', require('./routes/collections'));

// Serve admin.html for /admin (no .html needed)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve collection.html for /collection/:token
app.get('/collection/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'collection.html'));
});

// Serve proofing.html for /gallery/:token
app.get('/gallery/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proofing.html'));
});

// Migration + Start
migrateIfNeeded();

// Backfill proxy images for existing photos (runs in background)
(async () => {
  try {
    const sharp = require('sharp');
    const fs = require('fs');
    const { readGalleries, readGalleryVideos, writeGalleryVideos, UPLOADS_DIR, PROXY_DIR } = require('./lib/dataHelpers');
    const galleries = readGalleries();
    let generated = 0;

    for (const gallery of galleries) {
      const videos = readGalleryVideos(gallery.id);
      let changed = false;

      for (const item of videos) {
        if (item.type !== 'photo' || item.proxy) continue;
        const proxyFilename = item.id + '_proxy.jpg';
        const proxyPath = path.join(PROXY_DIR, proxyFilename);
        if (fs.existsSync(proxyPath)) { item.proxy = proxyFilename; changed = true; continue; }

        const srcPath = path.join(UPLOADS_DIR, item.filename);
        if (!fs.existsSync(srcPath)) continue;

        try {
          await sharp(srcPath)
            .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toFile(proxyPath);
          item.proxy = proxyFilename;
          changed = true;
          generated++;
        } catch (e) {
          console.error(`Proxy backfill error for ${item.filename}:`, e.message);
        }
      }

      if (changed) writeGalleryVideos(gallery.id, videos);
    }

    if (generated > 0) console.log(`Proxy backfill: generated ${generated} proxy image(s)`);
  } catch (e) {
    console.error('Proxy backfill failed:', e.message);
  }
})();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Video Reel Site running at http://localhost:${PORT}`);
  });
}

module.exports = app;
