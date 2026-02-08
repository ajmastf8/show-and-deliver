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
    },
    tls: {
      // Shared hosting (cPanel/A2) may proxy SMTP through their own
      // mail server, presenting a certificate that doesn't match the
      // configured hostname. Allow the connection anyway.
      rejectUnauthorized: false
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

async function sendReviewSummary({ gallery, videos, comments, reviewerName }) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP not configured');

  const config = getEmailConfig();
  if (!config.adminEmail) throw new Error('Admin email address is required');

  // Group comments by video
  const commentsByVideo = {};
  for (const c of comments) {
    if (!commentsByVideo[c.videoId]) commentsByVideo[c.videoId] = [];
    commentsByVideo[c.videoId].push(c);
  }

  // Build plain text
  const textParts = [
    `${reviewerName} has finished reviewing "${gallery.name}" and left ${comments.length} comment${comments.length !== 1 ? 's' : ''}:`,
    ''
  ];

  // Build HTML
  let htmlComments = '';

  for (const [videoId, videoComments] of Object.entries(commentsByVideo)) {
    const video = videos.find(v => v.id === videoId);
    const videoTitle = video ? video.title : 'Unknown Video';

    textParts.push(`--- ${videoTitle} ---`);
    htmlComments += `<h3 style="color: #333; margin: 20px 0 8px; font-size: 15px;">${videoTitle}</h3>`;

    videoComments.sort((a, b) => a.timestamp - b.timestamp);
    for (const c of videoComments) {
      const time = formatTimestamp(c.timestamp);
      textParts.push(`  [${time}] ${c.text}`);
      htmlComments += `
        <div style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
          <span style="color: #0019ff; font-weight: 600; font-size: 13px;">${time}</span>
          <span style="color: #5f5f5f; font-size: 13px; margin-left: 8px;">${c.text}</span>
        </div>`;
    }
    textParts.push('');
  }

  textParts.push(`View all comments: ${config.baseUrl}/admin#gallery/${gallery.id}/comments`);

  await t.sendMail({
    from: config.from,
    to: config.adminEmail,
    subject: `Review complete: ${reviewerName} commented on "${gallery.name}"`,
    text: textParts.join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #0019ff;">Review Complete</h2>
        <p><strong>${reviewerName}</strong> has finished reviewing <strong>${gallery.name}</strong> and left ${comments.length} comment${comments.length !== 1 ? 's' : ''}.</p>
        ${htmlComments}
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
        <p><a href="${config.baseUrl}/admin#gallery/${gallery.id}/comments" style="color: #0019ff;">View all comments in admin</a></p>
        <p style="color: #8e8e8e; font-size: 12px;">Sent from ${config.baseUrl}</p>
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

module.exports = { sendCommentNotification, sendReviewSummary, sendTestEmail, getEmailConfig };
