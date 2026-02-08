const crypto = require('crypto');

function generateToken(length = 12) {
  return crypto.randomBytes(Math.ceil(length * 0.75))
    .toString('base64url')
    .slice(0, length);
}

function generateId(prefix = '') {
  return prefix + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
}

module.exports = { generateToken, generateId };
