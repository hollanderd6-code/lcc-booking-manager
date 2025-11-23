// services/email.js
const nodemailer = require('nodemailer');

if (!process.env.EMAIL_HOST) {
  console.warn('[email] EMAIL_HOST non défini, l’envoi d’e-mails sera désactivé.');
}

const transporter = process.env.EMAIL_HOST
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === 'true', // true = port 465 TLS
      auth: process.env.EMAIL_USER
        ? {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          }
        : undefined,
    })
  : null;

/**
 * Envoie un e-mail simple
 * @param {Object} options
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.text
 * @param {string} [options.html]
 */
async function sendEmail({ to, subject, text, html }) {
  if (!transporter) {
    console.warn('[email] Pas de transporter configuré, email non envoyé:', {
      to,
      subject,
    });
    return;
  }

  const from =
    process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html: html || text,
  });
}

module.exports = {
  sendEmail,
};
