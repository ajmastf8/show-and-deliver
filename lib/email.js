const nodemailer = require('nodemailer');
const { readSettings } = require('./dataHelpers');

let transporter = null;
let lastConfigHash = null;

function getEmailConfig() {
  const settings = readSettings();
  const smtp = settings.smtp || {};

  return {
    host: smtp.host || process.env.SMTP_HOST || '',
    port: parseInt(smtp.port || process.env.SMTP_PORT) || 587,
    secure: (smtp.secure !== undefined ? smtp.secure : process.env.SMTP_SECURE === 'true'),
    user: smtp.user || process.env.SMTP_USER || '',
    pass: smtp.pass || process.env.SMTP_PASS || '',
    from: smtp.from || process.env.SMTP_FROM || '"Video Proofing" <noreply@ajmast.com>',
    adminEmail: smtp.adminEmail || process.env.ADMIN_EMAIL || '',
    baseUrl: smtp.baseUrl || process.env.BASE_URL || 'http://localhost:3000'
  };
}

function configHash(config) {
  return [config.host, config.port, config.secure, config.user, config.pass].join('|');
}

function getTransporter() {
  const config = getEmailConfig();
  if (!config.host) return null;

  const hash = configHash(config);
  if (transporter && hash === lastConfigHash) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
  lastConfigHash = hash;
  return transporter;
}

function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return mins + ':' + secs;
}

async function sendCommentNotification({ gallery, video, comment }) {
  const t = getTransporter();
  if (!t) return;

  const config = getEmailConfig();
  if (!config.adminEmail) return;

  await t.sendMail({
    from: config.from,
    to: config.adminEmail,
    subject: `New comment on "${video.title}" in ${gallery.name}`,
    text: [
      `${comment.name} commented at ${formatTimestamp(comment.timestamp)}:`,
      '',
      `"${comment.text}"`,
      '',
      `View comments: ${config.baseUrl}/admin#gallery/${gallery.id}/comments`
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #0019ff;">New Comment</h2>
        <p><strong>${comment.name}</strong> commented on <strong>${video.title}</strong> at <span style="color: #0019ff;">${formatTimestamp(comment.timestamp)}</span></p>
        <blockquote style="border-left: 3px solid #0019ff; padding-left: 16px; margin: 16px 0; color: #5f5f5f;">${comment.text}</blockquote>
        <p><a href="${config.baseUrl}/admin#gallery/${gallery.id}/comments" style="color: #0019ff;">View all comments</a></p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
        <p style="color: #8e8e8e; font-size: 12px;">Gallery: ${gallery.name}</p>
      </div>
    `
  });
}

async function sendTestEmail() {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured — enter host, port, and credentials');

  const config = getEmailConfig();
  if (!config.adminEmail) throw new Error('Admin email address is required');

  await t.sendMail({
    from: config.from,
    to: config.adminEmail,
    subject: 'Test Email — Video Proofing Notifications',
    text: 'This is a test email from your Video Proofing site. Email notifications are working correctly!',
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #0019ff;">Test Email</h2>
        <p>This is a test email from your Video Proofing site.</p>
        <p style="color: #4caf50; font-weight: 600;">Email notifications are working correctly!</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
        <p style="color: #8e8e8e; font-size: 12px;">Sent from ${config.baseUrl}</p>
      </div>
    `
  });
}

module.exports = { sendCommentNotification, sendTestEmail, getEmailConfig };
