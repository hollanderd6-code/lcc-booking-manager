const nodemailer = require('nodemailer');
const axios = require('axios');
const moment = require('moment-timezone');

const timezone = process.env.TIMEZONE || 'Europe/Paris';

// Configuration du transporteur email
let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
}

/**
 * Envoie une notification pour les nouvelles réservations
 */
async function sendNewBookingNotifications(reservations) {
  const promises = [];
  
  for (const reservation of reservations) {
    // Email
    if (transporter) {
      promises.push(sendEmailNotification(reservation));
    }
    
    // Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      promises.push(sendSlackNotification(reservation));
    }
    
    // Discord
    if (process.env.DISCORD_WEBHOOK_URL) {
      promises.push(sendDiscordNotification(reservation));
    }
  }
  
  try {
    await Promise.all(promises);
    console.log(`✅ ${reservations.length} notification(s) envoyée(s)`);
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi des notifications:', error.message);
  }
}

/**
 * Envoie une notification email
 */
async function sendEmailNotification(reservation) {
  if (!transporter) return;
  
  const recipients = process.env.NOTIFICATION_EMAIL.split(',').map(e => e.trim());
  
  const startDate = moment(reservation.start).tz(timezone).format('DD/MM/YYYY à HH:mm');
  const endDate = moment(reservation.end).tz(timezone).format('DD/MM/YYYY à HH:mm');
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, ${reservation.propertyColor || '#E67E50'} 0%, ${adjustColor(reservation.propertyColor || '#E67E50', -20)} 100%);
          color: white;
          padding: 30px;
          border-radius: 10px 10px 0 0;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 600;
        }
        .content {
          background: #f9f9f9;
          padding: 30px;
          border-radius: 0 0 10px 10px;
        }
        .info-box {
          background: white;
          padding: 20px;
          margin: 15px 0;
          border-radius: 8px;
          border-left: 4px solid ${reservation.propertyColor || '#E67E50'};
        }
        .info-row {
          display: flex;
          margin: 10px 0;
          padding: 8px 0;
          border-bottom: 1px solid #eee;
        }
        .info-row:last-child {
          border-bottom: none;
        }
        .info-label {
          font-weight: 600;
          color: #666;
          min-width: 140px;
        }
        .info-value {
          color: #333;
          flex: 1;
        }
        .property-badge {
          display: inline-block;
          background: ${reservation.propertyColor || '#E67E50'};
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          margin: 10px 0;
        }
        .source-badge {
          display: inline-block;
          background: #4CAF50;
          color: white;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }
        .footer {
          text-align: center;
          padding: 20px;
          color: #666;
          font-size: 12px;
        }
        .emoji {
          font-size: 24px;
          margin-right: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1><span class="emoji">🏠</span> Nouvelle Réservation</h1>
        <div class="property-badge">${reservation.propertyName}</div>
      </div>
      
      <div class="content">
        <div class="info-box">
          <div class="info-row">
            <div class="info-label">👤 Voyageur</div>
            <div class="info-value">${reservation.guestName || 'Non spécifié'}</div>
          </div>
          
          ${reservation.guestEmail ? `
          <div class="info-row">
            <div class="info-label">📧 Email</div>
            <div class="info-value"><a href="mailto:${reservation.guestEmail}">${reservation.guestEmail}</a></div>
          </div>
          ` : ''}
          
          ${reservation.guestPhone ? `
          <div class="info-row">
            <div class="info-label">📱 Téléphone</div>
            <div class="info-value"><a href="tel:${reservation.guestPhone}">${reservation.guestPhone}</a></div>
          </div>
          ` : ''}
          
          <div class="info-row">
            <div class="info-label">📅 Arrivée</div>
            <div class="info-value"><strong>${startDate}</strong></div>
          </div>
          
          <div class="info-row">
            <div class="info-label">📅 Départ</div>
            <div class="info-value"><strong>${endDate}</strong></div>
          </div>
          
          <div class="info-row">
            <div class="info-label">🌙 Nuits</div>
            <div class="info-value"><strong>${reservation.nights} nuit${reservation.nights > 1 ? 's' : ''}</strong></div>
          </div>
          
          <div class="info-row">
            <div class="info-label">🌐 Plateforme</div>
            <div class="info-value"><span class="source-badge">${reservation.source}</span></div>
          </div>
          
          ${reservation.bookingId ? `
          <div class="info-row">
            <div class="info-label">🔖 ID Réservation</div>
            <div class="info-value"><code>${reservation.bookingId}</code></div>
          </div>
          ` : ''}
        </div>
        
        ${reservation.description ? `
        <div class="info-box">
          <div class="info-label" style="margin-bottom: 10px;">📝 Notes</div>
          <div class="info-value" style="white-space: pre-wrap;">${reservation.description}</div>
        </div>
        ` : ''}
      </div>
      
      <div class="footer">
        <p>LCC Booking Manager - La Conciergerie de Charles</p>
        <p style="color: #999;">Cette notification a été générée automatiquement</p>
      </div>
    </body>
    </html>
  `;
  
  try {
    await transporter.sendMail({
      from: `"LCC Booking Manager" <${process.env.EMAIL_USER}>`,
      to: recipients.join(','),
      subject: `🏠 Nouvelle réservation - ${reservation.propertyName}`,
      html: htmlContent
    });
    
    console.log(`✅ Email envoyé pour ${reservation.propertyName}`);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error.message);
  }
}

/**
 * Envoie une notification Slack
 */
async function sendSlackNotification(reservation) {
  const startDate = moment(reservation.start).tz(timezone).format('DD/MM/YYYY à HH:mm');
  const endDate = moment(reservation.end).tz(timezone).format('DD/MM/YYYY à HH:mm');
  
  const payload = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🏠 Nouvelle Réservation',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Logement:*\n${reservation.propertyName}`
          },
          {
            type: 'mrkdwn',
            text: `*Plateforme:*\n${reservation.source}`
          },
          {
            type: 'mrkdwn',
            text: `*Voyageur:*\n${reservation.guestName || 'Non spécifié'}`
          },
          {
            type: 'mrkdwn',
            text: `*Nuits:*\n${reservation.nights}`
          },
          {
            type: 'mrkdwn',
            text: `*Arrivée:*\n${startDate}`
          },
          {
            type: 'mrkdwn',
            text: `*Départ:*\n${endDate}`
          }
        ]
      }
    ]
  };
  
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, payload);
    console.log('✅ Notification Slack envoyée');
  } catch (error) {
    console.error('❌ Erreur notification Slack:', error.message);
  }
}

/**
 * Envoie une notification Discord
 */
async function sendDiscordNotification(reservation) {
  const startDate = moment(reservation.start).tz(timezone).format('DD/MM/YYYY à HH:mm');
  const endDate = moment(reservation.end).tz(timezone).format('DD/MM/YYYY à HH:mm');
  
  const payload = {
    embeds: [{
      title: '🏠 Nouvelle Réservation',
      color: parseInt(reservation.propertyColor.replace('#', ''), 16),
      fields: [
        {
          name: '🏡 Logement',
          value: reservation.propertyName,
          inline: true
        },
        {
          name: '🌐 Plateforme',
          value: reservation.source,
          inline: true
        },
        {
          name: '👤 Voyageur',
          value: reservation.guestName || 'Non spécifié',
          inline: false
        },
        {
          name: '📅 Arrivée',
          value: startDate,
          inline: true
        },
        {
          name: '📅 Départ',
          value: endDate,
          inline: true
        },
        {
          name: '🌙 Nuits',
          value: reservation.nights.toString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'LCC Booking Manager'
      }
    }]
  };
  
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, payload);
    console.log('✅ Notification Discord envoyée');
  } catch (error) {
    console.error('❌ Erreur notification Discord:', error.message);
  }
}

/**
 * Envoie une notification de test
 */
async function sendTestNotification() {
  const testReservation = {
    propertyName: 'Test Property',
    propertyColor: '#E67E50',
    guestName: 'Jean Dupont',
    guestEmail: 'test@example.com',
    guestPhone: '+33 6 12 34 56 78',
    start: moment().add(7, 'days').toISOString(),
    end: moment().add(10, 'days').toISOString(),
    nights: 3,
    source: 'Test',
    bookingId: 'TEST123456',
    description: 'Ceci est une réservation de test'
  };
  
  await sendNewBookingNotifications([testReservation]);
}

/**
 * Ajuste la luminosité d'une couleur
 */
function adjustColor(color, amount) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

module.exports = {
  sendNewBookingNotifications,
  sendTestNotification
};
