try { require('dotenv').config(); } catch (e) { /* dotenv not needed when env vars set via cPanel */ }
const express = require('express');
const session = require('express-session');
const path = require('path');

const { migrateIfNeeded } = require('./lib/migrate');
const { UPLOADS_DIR, THUMBS_DIR } = require('./lib/dataHelpers');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/thumbnails', express.static(THUMBS_DIR));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/public'));
app.use('/api/galleries', require('./routes/galleries'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/proofing', require('./routes/proofing'));

// Serve proofing.html for /gallery/:token
app.get('/gallery/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proofing.html'));
});

// Migration + Start
migrateIfNeeded();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Video Reel Site running at http://localhost:${PORT}`);
  });
}

module.exports = app;
