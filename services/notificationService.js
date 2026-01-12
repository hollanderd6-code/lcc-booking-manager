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
 * ❌ DÉSACTIVÉ : Envoie une notification pour les nouvelles réservations
 * Cette fonction est désactivée pour éviter les emails automatiques à 1h15 du matin
 */
async function sendNewBookingNotifications(reservations) {
  console.log('ℹ️ sendNewBookingNotifications appelée mais DÉSACTIVÉE');
  console.log(`ℹ️ ${reservations.length} réservation(s) ignorée(s) (emails désactivés)`);
  // Ne rien faire - emails désactivés
  return;
}

/**
 * ❌ DÉSACTIVÉ : Envoie une notification email
 */
async function sendEmailNotification(reservation) {
  console.log('ℹ️ sendEmailNotification appelée mais DÉSACTIVÉE');
  // Ne rien faire - emails désactivés
  return;
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
 * ❌ DÉSACTIVÉ : Envoie une notification de test
 */
async function sendTestNotification() {
  console.log('ℹ️ sendTestNotification appelée mais DÉSACTIVÉE');
  return;
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
  sendNewBookingNotifications,  // Désactivée
  sendTestNotification           // Désactivée
};
