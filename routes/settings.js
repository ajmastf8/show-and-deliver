const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const requireAuth = require('../middleware/auth');
const { readSettings, writeSettings } = require('../lib/dataHelpers');
const { sendTestEmail, getEmailConfig } = require('../lib/email');

// Get current email settings (mask password and API key)
router.get('/email', requireAuth, (req, res) => {
  const config = getEmailConfig();
  res.json({
    resendApiKey: config.resendApiKey ? '••••••••' : '',
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

  // Only update API key if a real value was sent (not the masked placeholder)
  if (req.body.resendApiKey !== undefined && req.body.resendApiKey !== '••••••••') {
    smtp.resendApiKey = req.body.resendApiKey.trim();
  }
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

// Deploy config endpoint — tells admin UI whether deploy is enabled and which branch
router.get('/deploy', requireAuth, (req, res) => {
  res.json({
    enabled: process.env.DEPLOY_ENABLED !== 'false',
    branch: process.env.DEPLOY_BRANCH || 'main'
  });
});

// Deploy: git pull + npm install + restart from GitHub
// Controlled by .env: DEPLOY_ENABLED, DEPLOY_BRANCH, GIT_PAT, GIT_USERNAME, GIT_REPO
router.post('/deploy', requireAuth, (req, res) => {
  if (process.env.DEPLOY_ENABLED === 'false') {
    return res.status(403).json({ error: 'Deploy is disabled. Set DEPLOY_ENABLED=true in .env to enable.' });
  }

  const appDir = path.join(__dirname, '..');
  const branch = (process.env.DEPLOY_BRANCH || 'main').replace(/[^a-zA-Z0-9\/_-]/g, '');
  const pat = process.env.GIT_PAT || '';
  const username = process.env.GIT_USERNAME || '';
  const repo = process.env.GIT_REPO || '';

  // If PAT is configured, set the remote URL with auth so git can pull without cPanel's git
  let setRemote = '';
  if (pat && username && repo) {
    setRemote = `git remote set-url origin https://${username}:${pat}@github.com/${repo}.git && `;
  }

  // After pull + install, touch tmp/restart.txt to trigger Passenger restart (cPanel/LiteSpeed)
  const cmd = `${setRemote}git fetch origin && git checkout ${branch} && git pull origin ${branch} && npm install --production && mkdir -p tmp && touch tmp/restart.txt`;
  exec(cmd, { cwd: appDir, timeout: 120000 }, (err, stdout, stderr) => {
    // Log detailed output server-side only
    if (stdout) console.log('Deploy stdout:', stdout.trim());
    if (stderr) console.log('Deploy stderr:', stderr.trim());

    if (err) {
      console.error('Deploy failed:', err.message);
      return res.status(500).json({ error: 'Deploy failed. Check server logs for details.' });
    }
    res.json({ ok: true, message: `Deploy successful (branch: ${branch}). App restart triggered.` });
  });
});

module.exports = router;
