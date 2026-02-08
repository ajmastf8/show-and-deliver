const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const requireAuth = require('../middleware/auth');
const { readSettings, writeSettings } = require('../lib/dataHelpers');
const { sendTestEmail, getEmailConfig } = require('../lib/email');

// Get current email settings (mask password)
router.get('/email', requireAuth, (req, res) => {
  const config = getEmailConfig();
  res.json({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    pass: config.pass ? '••••••••' : '',
    from: config.from,
    adminEmail: config.adminEmail,
    baseUrl: config.baseUrl,
    hasPassword: !!config.pass
  });
});

// Save email settings
router.put('/email', requireAuth, (req, res) => {
  const settings = readSettings();
  const smtp = settings.smtp || {};

  if (req.body.host !== undefined) smtp.host = req.body.host.trim();
  if (req.body.port !== undefined) smtp.port = parseInt(req.body.port) || 587;
  if (req.body.secure !== undefined) smtp.secure = !!req.body.secure;
  if (req.body.user !== undefined) smtp.user = req.body.user.trim();
  // Only update password if a real value was sent (not the masked placeholder)
  if (req.body.pass !== undefined && req.body.pass !== '••••••••') {
    smtp.pass = req.body.pass;
  }
  if (req.body.from !== undefined) smtp.from = req.body.from.trim();
  if (req.body.adminEmail !== undefined) smtp.adminEmail = req.body.adminEmail.trim();
  if (req.body.baseUrl !== undefined) smtp.baseUrl = req.body.baseUrl.trim();

  settings.smtp = smtp;
  writeSettings(settings);

  res.json({ ok: true });
});

// Send test email
router.post('/email/test', requireAuth, async (req, res) => {
  try {
    await sendTestEmail();
    res.json({ ok: true, message: 'Test email sent successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Deploy: git pull from GitHub
router.post('/deploy', requireAuth, (req, res) => {
  const appDir = path.join(__dirname, '..');
  exec('git pull origin main', { cwd: appDir, timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.json({ ok: true, output: stdout.trim(), stderr: stderr.trim() });
  });
});

module.exports = router;
