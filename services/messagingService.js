const nodemailer = require('nodemailer');
const axios = require('axios');
const moment = require('moment-timezone');
const bhEmailTemplate = require('./email/emailLayout');
const { escapeHtml, emailCard, emailBookingSummary } = require('./email/emailComponents');

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
 * Templates de messages par défaut
 */
const MESSAGE_TEMPLATES = {
  'welcome': {
    name: 'Message de bienvenue (J-7)',
    subject: 'Bienvenue ! Votre séjour approche 🏠',
    template: `Bonjour {guestName},

Nous sommes ravis de vous accueillir dans notre logement "{propertyName}" !

📅 Dates de votre séjour :
• Arrivée : {checkinDate} à partir de 15h
• Départ : {checkoutDate} avant 11h
• Durée : {nights} nuit(s)

Les instructions détaillées d'arrivée vous seront envoyées 48h avant votre check-in.

Au plaisir de vous accueillir,
La Conciergerie de Charles`
  },
  
  'checkin-instructions': {
    name: 'Instructions d\'arrivée (J-2)',
    subject: 'Instructions d\'arrivée - {propertyName}',
    template: `Bonjour {guestName},

Votre arrivée approche ! Voici les informations pratiques :

📍 Adresse :
{propertyAddress}

🔑 Code d'accès :
{accessCode}

⏰ Check-in : {checkinDate} à partir de 15h

📝 Instructions détaillées :
1. [Instructions spécifiques au logement]
2. Parking : [Informations parking]
3. Wi-Fi : [Nom du réseau] / Mot de passe : [XXX]

📞 En cas de besoin : [Votre numéro]

À très bientôt !
La Conciergerie de Charles`
  },
  
  'reminder-checkin': {
    name: 'Rappel arrivée (J-1)',
    subject: 'Rappel : Votre arrivée demain chez nous 🗓️',
    template: `Bonjour {guestName},

C'est demain ! Nous avons hâte de vous accueillir.

Petit rappel :
📅 Arrivée : {checkinDate} à partir de 15h
📍 Adresse : {propertyAddress}
🔑 Code : {accessCode}

Tout est prêt pour vous !

N'hésitez pas si vous avez des questions.

À demain,
La Conciergerie de Charles`
  },
  
  'during-stay': {
    name: 'Pendant le séjour',
    subject: 'Tout se passe bien ?',
    template: `Bonjour {guestName},

Nous espérons que vous passez un excellent séjour dans notre logement !

Si vous avez la moindre question ou besoin de quoi que ce soit, n'hésitez pas à nous contacter.

Profitez bien de votre séjour,
La Conciergerie de Charles`
  },
  
  'checkout-reminder': {
    name: 'Rappel départ (Jour J)',
    subject: 'Check-out aujourd\'hui - Merci pour votre séjour',
    template: `Bonjour {guestName},

Nous espérons que vous avez passé un excellent séjour !

Rappel pour aujourd'hui :
⏰ Départ avant 11h
🔑 Merci de bien fermer toutes les portes et fenêtres

📝 Instructions de départ :
• Poubelles : [Instructions]
• Clés : [Instructions]
• État des lieux : Laissez le logement propre

Merci et au plaisir de vous revoir !
La Conciergerie de Charles`
  },
  
  'post-stay': {
    name: 'Après le séjour (J+1)',
    subject: 'Merci pour votre séjour ! 🌟',
    template: `Bonjour {guestName},

Merci d'avoir choisi notre logement pour votre séjour !

Nous espérons que tout s'est bien passé et que vous avez passé un agréable moment.

Si vous avez un instant, nous serions ravis de recevoir votre avis sur votre expérience. Cela nous aide énormément à améliorer notre service.

Au plaisir de vous accueillir à nouveau,
La Conciergerie de Charles`
  }
};

/**
 * Récupère les arrivées dans X jours
 */
function getUpcomingCheckIns(allReservations, daysFromNow) {
  const targetDate = moment().add(daysFromNow, 'days').startOf('day');
  const targetDateEnd = moment().add(daysFromNow, 'days').endOf('day');
  
  return allReservations.filter(r => {
    const checkinDate = moment(r.start);
    return checkinDate.isBetween(targetDate, targetDateEnd, null, '[]');
  });
}

/**
 * Récupère les départs dans X jours
 */
function getUpcomingCheckOuts(allReservations, daysFromNow) {
  const targetDate = moment().add(daysFromNow, 'days').startOf('day');
  const targetDateEnd = moment().add(daysFromNow, 'days').endOf('day');
  
  return allReservations.filter(r => {
    const checkoutDate = moment(r.end);
    return checkoutDate.isBetween(targetDate, targetDateEnd, null, '[]');
  });
}

/**
 * Récupère les séjours en cours
 */
function getCurrentStays(allReservations) {
  const now = moment();
  
  return allReservations.filter(r => {
    const checkin = moment(r.start);
    const checkout = moment(r.end);
    return checkin.isSameOrBefore(now) && checkout.isSameOrAfter(now);
  });
}

/**
 * Remplace les variables dans un template
 */
function fillTemplate(template, reservation, customData = {}) {
  let filled = template;
  
  const replacements = {
    '{guestName}': reservation.guestName || 'Voyageur',
    '{propertyName}': reservation.propertyName || reservation.property?.name || 'le logement',
    '{checkinDate}': moment(reservation.start).format('DD/MM/YYYY'),
    '{checkinTime}': moment(reservation.start).format('HH:mm'),
    '{checkoutDate}': moment(reservation.end).format('DD/MM/YYYY'),
    '{checkoutTime}': moment(reservation.end).format('HH:mm'),
    '{nights}': reservation.nights || 0,
    '{bookingId}': reservation.bookingId || 'N/A',
    '{source}': reservation.source || 'Plateforme',
    '{propertyAddress}': customData.propertyAddress || '[Adresse du logement]',
    '{accessCode}': customData.accessCode || '[Code d\'accès]',
    ...customData
  };
  
  Object.entries(replacements).forEach(([key, value]) => {
    filled = filled.replace(new RegExp(key, 'g'), value);
  });
  
  return filled;
}

/**
 * Envoie un rappel email à l'équipe
 */
async function sendReminderToTeam(reservations, reminderType, daysFromNow) {
  if (!transporter || reservations.length === 0) return;
  
  const recipients = process.env.NOTIFICATION_EMAIL.split(',').map(e => e.trim());
  
  let subject = '';
  let title = '';
  
  switch(reminderType) {
    case 'checkin-7':
      subject = `📅 ${reservations.length} arrivée(s) dans 7 jours`;
      title = 'Arrivées dans 7 jours';
      break;
    case 'checkin-3':
      subject = `⏰ ${reservations.length} arrivée(s) dans 3 jours`;
      title = 'Arrivées dans 3 jours';
      break;
    case 'checkin-1':
      subject = `🚨 ${reservations.length} arrivée(s) DEMAIN`;
      title = 'Arrivées demain';
      break;
    case 'checkin-0':
      subject = `🏠 ${reservations.length} arrivée(s) AUJOURD\'HUI`;
      title = 'Arrivées aujourd\'hui';
      break;
    case 'checkout-0':
      subject = `👋 ${reservations.length} départ(s) aujourd\'hui`;
      title = 'Départs aujourd\'hui';
      break;
  }
  
  const htmlContent = bhEmailTemplate({
    title,
    tag: `${reservations.length} réservation${reservations.length > 1 ? 's' : ''}`,
    bodyHtml: reservations.map(r => emailCard('info',
      emailBookingSummary([
        { label: '🏠 Logement', value: r.propertyName || '' },
        { label: '👤 Voyageur', value: r.guestName || '' },
        { label: '📅 Arrivée', value: moment(r.start).format('DD/MM/YYYY à HH:mm') },
        { label: '📅 Départ', value: moment(r.end).format('DD/MM/YYYY à HH:mm') },
        { label: '🌙 Nuits', value: String(r.nights || '') },
        { label: '🌐 Plateforme', value: r.source || '' },
        ...(r.guestPhone ? [{ label: '📱 Téléphone', value: r.guestPhone }] : [])
      ]) +
      (reminderType.startsWith('checkin')
        ? `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5A5A54;">✅ Actions : vérifier le logement · envoyer les instructions · communiquer le code d'accès</p>`
        : '') +
      (reminderType.startsWith('checkout')
        ? `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5A5A54;">✅ Actions : planifier le ménage · vérifier l'état du logement</p>`
        : '')
    )).join('')
  });

  try {
    await transporter.sendMail({
      from: `"LCC Booking Manager" <${process.env.EMAIL_USER}>`,
      to: recipients.join(','),
      subject,
      html: htmlContent
    });
    
    console.log(`✅ Rappel envoyé: ${subject}`);
  } catch (error) {
    console.error('❌ Erreur envoi rappel:', error.message);
  }
  
  // Slack notification
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      await axios.post(process.env.SLACK_WEBHOOK_URL, {
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: title,
              emoji: true
            }
          },
          ...reservations.map(r => ({
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*${r.propertyName}*\n${r.guestName}`
              },
              {
                type: 'mrkdwn',
                text: `*Arrivée*\n${moment(r.start).format('DD/MM à HH:mm')}`
              }
            ]
          }))
        ]
      });
    } catch (error) {
      console.error('❌ Erreur Slack:', error.message);
    }
  }
}

/**
 * Génère un message rapide pré-rempli
 */
function generateQuickMessage(reservation, templateKey, customData = {}) {
  const template = MESSAGE_TEMPLATES[templateKey];
  if (!template) return null;
  
  return {
    subject: fillTemplate(template.subject, reservation, customData),
    message: fillTemplate(template.template, reservation, customData),
    templateName: template.name
  };
}

module.exports = {
  MESSAGE_TEMPLATES,
  getUpcomingCheckIns,
  getUpcomingCheckOuts,
  getCurrentStays,
  fillTemplate,
  sendReminderToTeam,
  generateQuickMessage
};
