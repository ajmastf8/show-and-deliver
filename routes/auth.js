const express = require('express');
const crypto = require('crypto');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USERNAME || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'changeme';

  const userMatch = username.length === validUser.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(validUser));
  const passMatch = password.length === validPass.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(validPass));

  if (userMatch && passMatch) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

module.exports = router;
