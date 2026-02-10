try { require('dotenv').config(); } catch (e) { /* dotenv not needed when env vars set via cPanel */ }
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const path = require('path');

const { migrateIfNeeded } = require('./lib/migrate');
const { UPLOADS_DIR, THUMBS_DIR } = require('./lib/dataHelpers');

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
app.use(session({
  store: new FileStore({
    path: path.join(__dirname, 'data', 'sessions'),
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Video Reel Site running at http://localhost:${PORT}`);
  });
}

module.exports = app;
