require('dotenv').config();
const express = require('express')
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');  
const fs = require('fs');
const fsp = require('fs').promises;
const icalService = require('./services/icalService');
const notificationService = require('./services/notifications-service');
const messagingService = require('./services/messagingService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const multer = require('multer');
const Stripe = require('stripe');
const { Pool } = require('pg');

// ============================================
// 🤖 IMPORTS SYSTÈME ONBOARDING + RÉPONSES AUTO
// ============================================
const { handleIncomingMessage } = require('./integrated-chat-handler');
const { startOnboarding } = require('./onboarding-system');
const crypto = require('crypto');
const axios = require('axios');
const brevo = require('@getbrevo/brevo');
const PDFDocument = require('pdfkit');

// ============================================
// ✅ NOUVEAU : IMPORTS POUR LIVRETS D'ACCUEIL  
// ============================================
const { router: welcomeRouter, initWelcomeBookTables } = require('./routes/welcomeRoutes');
const { generateWelcomeBookHTML } = require('./services/welcomeGenerator');

// ============================================
// ✅ IMPORT DES ROUTES DU CHAT
// ============================================
const { setupChatRoutes } = require('./routes/chat_routes');
const smartLocksRoutes = require('./routes/smart-locks-routes');

// ============================================
// 📨 IMPORT SYSTÈME DE MESSAGES D'ARRIVÉE AUTOMATIQUES
// ============================================
const { initArrivalMessagesCron } = require('./arrival-messages-cron');

// ============================================
// 💰 IMPORT SYSTÈME DE MESSAGES POUR LES CAUTIONS
// ============================================
const { initDepositRemindersCron } = require('./deposit-messages-cron');
const { 
  sendDepositAuthorizedMessage,
  sendDepositReleasedMessage,
  sendDepositFailedMessage
} = require('./deposit-messages-scheduler');

// ============================================
// ✅ IMPORT SYSTÈME DE SOUS-COMPTES
// ============================================
const { setupSubAccountsRoutes } = require('./sub-accounts-routes');
const { 
  authenticateAny, 
  requirePermission, 
  loadSubAccountData, 
  filterByAccessibleProperties, 
  getRealUserId 
} = require('./sub-accounts-middleware');

// ============================================
// 💬 IMPORT SUPPORT CHAT
// ============================================
const { setupSupportRoutes, initSupportTables } = require('./support-chat-routes');

// ============================================
// ✅ NOUVEAU : NOTIFICATIONS PUSH FIREBASE
// ============================================
const { 
  sendNotification, 
  sendNotificationToMultiple,
  sendNewMessageNotification,
  sendNewCleaningNotification,
  sendCleaningReminderNotification,
  sendNewInvoiceNotification,
  sendNewReservationNotification,
  sendCancelledReservationNotification,
  setPool,             
  initializeFirebase    
} = require('./services/notifications-service');
/**
 * Nettoie le nom du voyageur extrait d'iCal
 */
function cleanGuestName(rawName, platform) {
  if (!rawName) {
    return platform ? `Voyageur ${platform}` : 'Voyageur';
  }
  
  const cleaned = rawName.trim().replace(/^\(|\)$/g, '');
  
  const invalidNames = ['not available', 'closed', 'reservation', 'blocked', 'unavailable', 'booked'];
  
if (invalidNames.some(invalid => cleaned.toLowerCase().includes(invalid))) {
    if (platform && platform.toLowerCase().includes('airbnb')) {
      return 'Voyageur Airbnb';
    } else if (platform && platform.toLowerCase().includes('booking')) {
      return 'Voyageur Booking';
    } else {
      return 'Voyageur';
    }
  }
  
  return cleaned;
}
// ============================================
// ✅ IMPORT DU SERVICE DE MESSAGES D'ARRIVÉE
// ============================================

// ============================================
// SERVICE D'ENVOI AUTOMATIQUE DES MESSAGES D'ARRIVEE (INLINE)
// ============================================

function generateArrivalMessage(conversation, property, hasCleaningPhotos, cleaningPhotoCount) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const baseUrl = appUrl.replace(/\/$/, '');
  
  const propertyName = property.name || 'votre logement';
  const chatLink = `${baseUrl}/chat/${conversation.unique_token}`;
  const cleaningPhotosLink = `${baseUrl}/chat/${conversation.photos_token}/cleaning-photos`;
  const checkoutFormLink = `${baseUrl}/chat/${conversation.photos_token}/checkout-form`;
  
  let message = `Bienvenue dans ${propertyName} !

Nous sommes ravis de vous accueillir aujourd'hui.

Informations importantes :

`;

  if (property.welcome_book_url) {
    message += `Livret d'accueil :
Retrouvez toutes les informations sur le logement (WiFi, acces, regles, etc.) :
${property.welcome_book_url}

`;
  }

  if (hasCleaningPhotos) {
    message += `Etat du logement a votre arrivee :
Consultez les photos du nettoyage effectue juste avant votre arrivee (${cleaningPhotoCount} photos) :
${cleaningPhotosLink}

`;
  }

  message += `Photos de depart (optionnel) :
Si vous le souhaitez, vous pouvez prendre quelques photos avant de partir pour documenter l'etat du logement :
${checkoutFormLink}

`;

  if (!property.welcome_book_url) {
    message += `Informations pratiques :
`;
    if (property.arrival_time) message += `- Arrivee : a partir de ${property.arrival_time}\n`;
    if (property.departure_time) message += `- Depart : avant ${property.departure_time}\n`;
    if (property.access_code) message += `- Code d'acces : ${property.access_code}\n`;
    if (property.wifi_name) {
      message += `- WiFi : "${property.wifi_name}"`;
      if (property.wifi_password) message += ` / Mot de passe : "${property.wifi_password}"`;
      message += `\n`;
    }
    message += `\n`;
  }

  message += `Questions ?
N'hesitez pas a nous contacter via le chat pour toute question :
${chatLink}

Excellent sejour !`;

  return message;
}

async function hasArrivalMessageBeenSent(pool, conversationId) {
  try {
    const result = await pool.query(
      `SELECT id FROM messages 
       WHERE conversation_id = $1 
       AND sender_type = 'system' 
       AND message LIKE '%Bienvenue dans%'
       LIMIT 1`,
      [conversationId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Erreur verification message arrivee:', error);
    return false;
  }
}

async function sendArrivalMessage(pool, io, conversation) {
  try {
    const alreadySent = await hasArrivalMessageBeenSent(pool, conversation.id);
    if (alreadySent) {
      console.log(`Message d'arrivee deja envoye pour conversation ${conversation.id}`);
      return { success: false, reason: 'already_sent' };
    }

    const propertyResult = await pool.query(
      `SELECT id, name, welcome_book_url, arrival_time, departure_time,
              access_code, wifi_name, wifi_password
       FROM properties WHERE id = $1`,
      [conversation.property_id]
    );

    if (propertyResult.rows.length === 0) {
      return { success: false, reason: 'property_not_found' };
    }

    const property = propertyResult.rows[0];

    const startDate = new Date(conversation.reservation_start_date).toISOString().split('T')[0];
    const endDate = conversation.reservation_end_date 
      ? new Date(conversation.reservation_end_date).toISOString().split('T')[0]
      : null;
    
    const reservationKey = endDate ? `${conversation.property_id}_${startDate}_${endDate}` : null;

    let hasCleaningPhotos = false;
    let cleaningPhotoCount = 0;

    if (reservationKey) {
      const cleaningResult = await pool.query(
        `SELECT photos FROM cleaning_checklists WHERE reservation_key = $1`,
        [reservationKey]
      );

      if (cleaningResult.rows.length > 0) {
        const photos = cleaningResult.rows[0].photos;
        cleaningPhotoCount = Array.isArray(photos) ? photos.length : 
                           (typeof photos === 'string' ? JSON.parse(photos).length : 0);
        hasCleaningPhotos = cleaningPhotoCount > 0;
      }
    }

    const message = generateArrivalMessage(conversation, property, hasCleaningPhotos, cleaningPhotoCount);

    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, created_at)
       VALUES ($1, 'system', 'Bienvenue', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, sender_name, message, is_read, created_at`,
      [conversation.id, message]
    );

    const savedMessage = messageResult.rows[0];

    if (io) {
      io.to(`conversation_${conversation.id}`).emit('new_message', savedMessage);
    }

    console.log(`Message d'arrivee envoye pour conversation ${conversation.id} (${property.name})`);

    return {
      success: true,
      messageId: savedMessage.id,
      conversationId: conversation.id,
      propertyName: property.name,
      guestName: conversation.guest_name,
      guestEmail: conversation.guest_email
    };

  } catch (error) {
    console.error(`Erreur envoi message arrivee:`, error);
    return { success: false, reason: 'error', error: error.message };
  }
}

async function processArrivalsForToday(pool, io, transporter) {
  try {
    console.log('Traitement des arrivees du jour...');

    const today = new Date().toLocaleDateString('fr-FR', { 
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).split('/').reverse().join('-');

    console.log(`Recherche des arrivees pour le ${today}`);

    const result = await pool.query(
      `SELECT c.*, u.email as owner_email, u.first_name as owner_first_name
       FROM conversations c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE DATE(c.reservation_start_date) = $1
       AND c.is_verified = TRUE`,
      [today]
    );

    console.log(`${result.rows.length} arrivee(s) trouvee(s)`);

    const results = [];
    const successfulSends = [];

    for (const conversation of result.rows) {
      const sendResult = await sendArrivalMessage(pool, io, conversation);
      results.push(sendResult);

      if (sendResult.success) {
        successfulSends.push({
          ...sendResult,
          ownerEmail: conversation.owner_email,
          ownerFirstName: conversation.owner_first_name
        });
      }
    }

    if (transporter && successfulSends.length > 0) {
      for (const send of successfulSends) {
        if (!send.ownerEmail) continue;

        try {
          await transporter.sendMail({
            from: process.env.EMAIL_FROM || 'noreply@bookingmanage.com',
            to: send.ownerEmail,
            subject: `Message de bienvenue envoye - ${send.propertyName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #10B981;">Message de bienvenue envoye</h2>
                <p>Bonjour ${send.ownerFirstName || ''},</p>
                <p>Le message de bienvenue automatique a ete envoye a votre voyageur :</p>
                <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>Logement :</strong> ${send.propertyName}</p>
                  <p style="margin: 5px 0;"><strong>Voyageur :</strong> ${send.guestName || 'Non renseigne'}</p>
                  ${send.guestEmail ? `<p style="margin: 5px 0;"><strong>Email :</strong> ${send.guestEmail}</p>` : ''}
                </div>
                <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">
                  Bookingmanage - Gestion simplifiee de vos locations
                </p>
              </div>
            `
          });
          console.log(`Email de notification envoye a ${send.ownerEmail}`);
        } catch (emailError) {
          console.error('Erreur envoi email:', emailError);
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`${successCount}/${results.length} message(s) envoye(s)`);

    return { total: results.length, success: successCount, results };

  } catch (error) {
    console.error('Erreur traitement arrivees:', error);
    return { total: 0, success: 0, error: error.message };
  }
}

// Stripe Connect pour les cautions des utilisateurs
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY) 
  : null;

const cloudinary = require('cloudinary').v2;

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Stripe Subscriptions pour les abonnements Bookingmanage
const stripeSubscriptions = process.env.STRIPE_SUBSCRIPTION_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SUBSCRIPTION_SECRET_KEY) 
  : null;

// Ancien transporter SMTP (garde-le pour fallback)
const smtpTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});
// ============================================
// CRON JOB : MESSAGES D'ARRIVÉE AUTOMATIQUES
// ============================================

cron.schedule('0 7 * * *', async () => {
  console.log('🕐 CRON: Envoi des messages d\'arrivée à 7h00');
  try {
    await arrivalMessageService.processArrivalsForToday(pool, io, transporter);
  } catch (error) {
    console.error('❌ Erreur CRON messages d\'arrivée:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('✅ CRON job messages d\'arrivée configuré (tous les jours à 7h)');

// ============================================
// CRON JOB : SYNCHRONISATION ICAL AUTOMATIQUE
// ============================================

cron.schedule('*/5 * * * *', async () => {
  console.log('CRON: Synchronisation iCal automatique (toutes les 5 minutes)');
  try {
    await syncAllCalendars();
  } catch (error) {
    console.error('Erreur CRON synchronisation iCal:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('CRON job synchronisation iCal configure (toutes les 5 minutes)');

// ============================================
// CRON JOB : DEMANDE DE CAUTION J-2
// ============================================

cron.schedule('0 10 * * *', async () => {
  console.log('🕐 CRON: Envoi demandes de caution (J-2) à 10h00');
  try {
    await sendDepositRequestMessages(io);
  } catch (error) {
    console.error('❌ Erreur CRON demandes caution:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('✅ CRON job demandes de caution configuré (tous les jours à 10h, J-2 avant arrivée)');

// ============================================
// CRON JOB : RAPPEL LIBERATION CAUTION J-1
// ============================================
cron.schedule('0 10 * * *', async () => {
  console.log('CRON: Rappel liberation cautions a 10h00');
  try {
    // Recuperer tous les utilisateurs
    const usersResult = await pool.query(
      `SELECT DISTINCT u.id 
       FROM users u 
       JOIN user_fcm_tokens t ON u.id = t.user_id 
       WHERE t.fcm_token IS NOT NULL`
    );
    
    for (const user of usersResult.rows) {
      // Recuperer TOUS les tokens
      const tokensResult = await pool.query(
        'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
        [user.id]
      );
      
      if (tokensResult.rows.length === 0) continue;
      
      // Chercher les cautions capturees il y a 6 jours (liberation demain)
      const sixDaysAgo = new Date();
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
      sixDaysAgo.setHours(0, 0, 0, 0);
      const fiveDaysAgo = new Date(sixDaysAgo);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() + 1);
      
      // ✅ CORRECTION : Requête SQL sans JOIN (conversation_id n'existe pas)
      const depositsResult = await pool.query(
        `SELECT * 
         FROM deposits 
         WHERE user_id = $1
         AND status = 'captured'
         AND captured_at >= $2
         AND captured_at < $3`,
        [user.id, sixDaysAgo, fiveDaysAgo]
      );
      
      if (depositsResult.rows.length > 0) {
        // ✅ Enrichir avec les données du store en mémoire
        const enrichedDeposits = depositsResult.rows.map(d => {
          const result = findReservationByUidForUser(d.reservation_uid, user.id);
          return {
            ...d,
            property_name: result?.property?.name || 'Logement',
            guest_name: result?.reservation?.guestName || 'Voyageur',
            amount: (d.amount_cents / 100).toFixed(0)
          };
        });
        
        const depositsList = enrichedDeposits
          .map(d => `${d.property_name} - ${d.guest_name} (${d.amount}€)`)
          .join(', ');
        
        // Envoyer a TOUS les appareils
        if (await shouldSendNotification(user.id, 'notif_deposit_release')) {
          for (const token of tokensResult.rows) {
            await sendNotification(
              token.fcm_token,
              `Rappel : ${depositsResult.rows.length} caution(s) a liberer demain`,
              depositsList,
              { 
                type: 'deposit_release_reminder', 
                count: depositsResult.rows.length.toString() 
              }
            );
          }
          console.log(`Rappel liberation caution envoye a user ${user.id} : ${depositsResult.rows.length} caution(s)`);
        } // end shouldSendNotification
      }
    }
    
    console.log('Rappels liberation cautions envoyes');
  } catch (error) {
    console.error('Erreur CRON rappels cautions:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('CRON rappels liberation cautions configure (tous les jours a 10h)');
// ============================================
// CRON JOB : INFOS D'ACCÈS JOUR J À 7H
// ============================================

cron.schedule('0 7 * * *', async () => {
  console.log('🕐 CRON: Envoi infos d\'accès (jour J) à 7h00');
  try {
    await sendArrivalInfoMessages(io);
  } catch (error) {
    console.error('❌ Erreur CRON infos accès:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('✅ CRON job infos d\'accès configuré (tous les jours à 7h, jour d\'arrivée)');


// ============================================
// SERVICE DE RÉPONSES AUTOMATIQUES (INLINE)
// ============================================

const QUESTION_PATTERNS = {
  checkin: {
    keywords: ['arriver', 'arrivée', 'check-in', 'checkin', 'heure arrivée', 'quelle heure arriver', 'arrive'],
    priority: 1
  },
  checkout: {
    keywords: ['partir', 'départ', 'check-out', 'checkout', 'heure départ', 'quelle heure partir', 'libérer', 'quitter'],
    priority: 1
  },
  draps: {
    keywords: ['draps', 'drap', 'linge de lit', 'literie'],
    priority: 2
  },
  serviettes: {
    keywords: ['serviettes', 'serviette', 'linge de toilette', 'bain'],
    priority: 2
  },
  cuisine: {
    keywords: ['cuisine', 'cuisiner', 'équipée', 'ustensiles', 'vaisselle'],
    priority: 2
  },
  wifi: {
    keywords: ['wifi', 'wi-fi', 'internet', 'réseau', 'connexion', 'mot de passe wifi', 'code wifi'],
    priority: 1
  },
  acces_code: {
    keywords: ['code', 'clé', 'clef', 'accès', 'entrer', 'porte', 'digicode'],
    priority: 1
  },
  animaux: {
    keywords: ['animaux', 'animal', 'chien', 'chat', 'accepté'],
    priority: 2
  }
};

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectQuestions(message) {
  const normalized = normalizeText(message);
  const detected = [];
  
  for (const [category, config] of Object.entries(QUESTION_PATTERNS)) {
    for (const keyword of config.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalized.includes(normalizedKeyword)) {
        detected.push({ category, priority: config.priority });
        break;
      }
    }
  }
  
  return detected.sort((a, b) => a.priority - b.priority);
}

function generateAutoResponse(property, detectedQuestions) {
  if (!property || detectedQuestions.length === 0) return null;
  
  const amenities = typeof property.amenities === 'string' ? JSON.parse(property.amenities) : (property.amenities || {});
  const houseRules = typeof property.house_rules === 'string' ? JSON.parse(property.house_rules) : (property.house_rules || {});
  
  const responses = [];
  
  for (const question of detectedQuestions) {
    let response = null;
    
    switch (question.category) {
      case 'checkin':
        if (property.arrival_time) response = `L'arrivée est possible à partir de ${property.arrival_time}.`;
        break;
      case 'checkout':
        if (property.departure_time) response = `Le départ doit se faire avant ${property.departure_time}.`;
        break;
      case 'draps':
        response = amenities.draps ? 'Oui, les draps sont fournis.' : 'Non, les draps ne sont pas fournis.';
        break;
      case 'serviettes':
        response = amenities.serviettes ? 'Oui, les serviettes sont fournies.' : 'Non, les serviettes ne sont pas fournies.';
        break;
      case 'cuisine':
        response = amenities.cuisine_equipee ? 'Oui, la cuisine est équipée.' : 'La cuisine dispose d\'équipements de base.';
        break;
      case 'wifi':
        if (property.wifi_name && property.wifi_password) {
          response = `Réseau WiFi : "${property.wifi_name}"\nMot de passe : "${property.wifi_password}"`;
        }
        break;
      case 'acces_code':
        if (property.access_code) response = `Le code d'accès est : ${property.access_code}`;
        break;
      case 'animaux':
        response = houseRules.animaux ? 'Oui, les animaux sont acceptés.' : 'Non, les animaux ne sont pas acceptés.';
        break;
    }
    
    if (response) responses.push(response);
  }
  
  return responses.length > 0 ? responses.join('\n\n') : null;
}
// Nouvelle fonction d'envoi email avec Brevo API
async function sendEmail(mailOptions) {
  try {
    // Si BREVO_API_KEY est configuré, utiliser l'API Brevo
    if (process.env.BREVO_API_KEY) {
      const apiInstance = new brevo.TransactionalEmailsApi();
      apiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
      
      const sendSmtpEmail = new brevo.SendSmtpEmail();
      sendSmtpEmail.subject = mailOptions.subject;
      sendSmtpEmail.htmlContent = mailOptions.html || mailOptions.text;
      
      // Gérer l'expéditeur (CORRIGÉ)
      let senderEmail = process.env.EMAIL_FROM;
      let senderName = '';
      
      if (typeof mailOptions.from === 'string') {
        // Format: "Name <email@domain.com>" ou juste "email@domain.com"
        const fromMatch = mailOptions.from.match(/^(.+?)\s*<(.+?)>$/);
        if (fromMatch) {
          senderName = fromMatch[1].trim();
          senderEmail = fromMatch[2].trim();
        } else {
          senderEmail = mailOptions.from.trim();
        }
      } else if (mailOptions.from && mailOptions.from.email) {
        senderEmail = mailOptions.from.email;
        senderName = mailOptions.from.name || '';
      }
      
      // S'assurer que l'email est propre (pas de < > ni de texte autour)
      senderEmail = senderEmail.replace(/[<>]/g, '').trim();
      
      sendSmtpEmail.sender = { 
        email: senderEmail,
        name: senderName || undefined
      };
      
      // Gérer les destinataires
      if (Array.isArray(mailOptions.to)) {
        sendSmtpEmail.to = mailOptions.to.map(recipient => {
          if (typeof recipient === 'string') {
            return { email: recipient };
          }
          return recipient;
        });
      } else if (typeof mailOptions.to === 'string') {
        sendSmtpEmail.to = [{ email: mailOptions.to }];
      } else {
        sendSmtpEmail.to = [mailOptions.to];
      }
      
      await apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log('✅ Email envoyé via Brevo API à:', mailOptions.to);
      return { success: true };
      
    } else {
      console.warn('⚠️ BREVO_API_KEY non configuré, tentative SMTP...');
      return await smtpTransporter.sendMail(mailOptions);
    }
  } catch (error) {
    console.error('❌ Erreur envoi email:', error.response?.body || error.message);
    throw error;
  }
}

// Créer un objet transporter compatible
const transporter = {
  sendMail: sendEmail,
  verify: () => Promise.resolve(true)
};

// Dossier d'upload pour les photos de logements
// En local : /.../lcc-booking-manager/uploads/properties
// Sur Render : on préfère /tmp qui est writable
const isRenderEnv =
  process.env.RENDER === 'true' ||
  !!process.env.RENDER_EXTERNAL_URL ||
  process.env.NODE_ENV === 'production';

let UPLOAD_DIR = isRenderEnv
  ? path.join('/tmp', 'uploads', 'properties')
  : path.join(__dirname, 'uploads', 'properties');

try {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  console.log('📁 Dossier uploads initialisé :', UPLOAD_DIR);
} catch (err) {
  console.error('❌ Impossible de créer le dossier uploads :', UPLOAD_DIR, err);
  // On essaie un dernier fallback dans /tmp
  if (UPLOAD_DIR !== path.join('/tmp', 'uploads', 'properties')) {
    UPLOAD_DIR = path.join('/tmp', 'uploads', 'properties');
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      console.log('📁 Dossier uploads fallback :', UPLOAD_DIR);
    } catch (e2) {
      console.error('❌ Échec du fallback pour le dossier uploads :', e2);
    }
  }
}

// UPLOAD_DIR = .../uploads/properties (ou /tmp/uploads/properties en prod)
const UPLOAD_ROOT = path.dirname(UPLOAD_DIR);
// Dossier de stockage des PDF de factures (writable sur Render via /tmp)
const INVOICE_PDF_DIR = isRenderEnv
  ? path.join('/tmp', 'invoices')
  : path.join(__dirname, 'public', 'invoices');

try {
  if (!fs.existsSync(INVOICE_PDF_DIR)) {
    fs.mkdirSync(INVOICE_PDF_DIR, { recursive: true });
  }
  console.log('📁 Dossier factures PDF initialisé :', INVOICE_PDF_DIR);
} catch (err) {
  console.error('❌ Impossible de créer le dossier factures PDF :', INVOICE_PDF_DIR, err);
}


// Multer en mémoire pour envoyer directement à Cloudinary
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ];
    
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'];
    const fileExtension = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    
    const mimeOk = allowedMimes.includes(file.mimetype.toLowerCase());
    const extOk = fileExtension && allowedExtensions.includes(fileExtension);
    
    if (mimeOk || extOk) {
      return cb(null, true);
    }
    
    console.log('❌ Fichier rejeté:', {
      mimetype: file.mimetype,
      extension: fileExtension,
      filename: file.originalname
    });
    
    return cb(new Error('Type de fichier non supporté. Formats acceptés: JPG, PNG, WEBP, GIF'), false);
  }
});
// Fonction helper pour uploader vers Cloudinary
async function uploadToCloudinary(fileBuffer, filename) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'lcc-properties',
        public_id: filename.replace(/\.[^.]+$/, ''), // Nom sans extension
        resource_type: 'auto'
      },
      (error, result) => {
        if (error) {
          console.error('Erreur upload Cloudinary:', error);
          reject(error);
        } else {
          resolve(result.secure_url);
        }
      }
    );
    
    // Envoyer le buffer vers Cloudinary
    const bufferStream = require('stream').Readable.from(fileBuffer);
    bufferStream.pipe(uploadStream);
  });
}
// ============================================
// MIDDLEWARE D'AUTHENTIFICATION JWT
// ============================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  try {
    const decoded = jwt.verify(token, secret);
    
    // ✅ Détecter le type de compte
    if (decoded.type === 'sub_account') {
      // C'est un sous-compte
      req.user = { 
        id: null,
        subAccountId: decoded.subAccountId,
        type: 'sub',
        isSubAccount: true
      };
    } else {
      // C'est un compte principal
      req.user = decoded;
      req.user.type = 'main';
      req.user.isSubAccount = false;
    }
    
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalide' });
  }
}
// ============================================
// MIDDLEWARE DE VÉRIFICATION D'ABONNEMENT
// À AJOUTER DANS server.js APRÈS authenticateToken
// ============================================

async function checkSubscription(req, res, next) {
  try {
    // ✅ Skip vérification pour sous-comptes
    if (req.user && req.user.isSubAccount) {
      return next();
    }
    
    const userId = req.user.id;

    // Récupérer l'abonnement
    const result = await pool.query(
      `SELECT status, trial_end_date, current_period_end
       FROM subscriptions 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Pas d'abonnement trouvé
      return res.status(403).json({ 
        error: 'Aucun abonnement', 
        subscriptionExpired: true 
      });
    }

    const sub = result.rows[0];
    const now = new Date();

    // Vérifier si l'abonnement est expiré
    if (sub.status === 'trial') {
      const trialEnd = new Date(sub.trial_end_date);
      if (now > trialEnd) {
        return res.status(403).json({ 
          error: 'Essai expiré', 
          subscriptionExpired: true 
        });
      }
    } else if (sub.status === 'active') {
      // L'abonnement actif est valide (géré par Stripe)
      // On pourrait vérifier current_period_end si besoin
    } else if (sub.status === 'expired' || sub.status === 'canceled') {
      return res.status(403).json({ 
        error: 'Abonnement expiré', 
        subscriptionExpired: true 
      });
    }

    // Abonnement valide, continuer
    next();

  } catch (err) {
    console.error('Erreur vérification abonnement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ============================================
// COMMENT UTILISER CE MIDDLEWARE
// ============================================

/*
Pour protéger une route, ajoutez le middleware après authenticateToken :

AVANT :
app.get('/api/properties', authenticateAny, async (req, res) => {
  // ...
});

APRÈS :
app.get('/api/properties', authenticateAny, checkSubscription, async (req, res) => {
  // ...
});

Routes à protéger (exemples) :
- /api/properties
- /api/reservations
- /api/cleaning
- /api/messages
- /api/statistics
- etc.

Routes à NE PAS protéger :
- /api/auth/login
- /api/auth/register
- /api/subscription/status
- /api/billing/* (routes Stripe)
*/

// ============================================
// CONNEXION POSTGRES
// ============================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Initialiser le pool pour les notifications
setPool(pool);

// FORCER L'INITIALISATION DE FIREBASE AU DÉMARRAGE
try {
  console.log('🔥 Initialisation de Firebase...');
  initializeFirebase();
  console.log('✅ Firebase initialisé avec succès');
} catch (error) {
  console.error('❌ Erreur initialisation Firebase:', error);
}
// Init DB : création tables users + welcome_books + cleaners + user_settings + cleaning_assignments
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        stripe_account_id TEXT
      );

      CREATE TABLE IF NOT EXISTS public.welcome_books_v2 (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        unique_id TEXT UNIQUE NOT NULL,
        property_name TEXT,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_welcome_books_v2_user_id ON public.welcome_books_v2(user_id);
      CREATE INDEX IF NOT EXISTS idx_welcome_books_v2_unique_id ON public.welcome_books_v2(unique_id);

      CREATE TABLE IF NOT EXISTS cleaners (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        notes TEXT,
        pin_code TEXT UNIQUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cleaning_assignments (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL,
        cleaner_id TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, property_id)
      );

      CREATE TABLE IF NOT EXISTS cleaning_checklists (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL,
        reservation_key TEXT NOT NULL UNIQUE,
        cleaner_id TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
        guest_name TEXT,
        checkout_date DATE NOT NULL,
        tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
        photos JSONB NOT NULL DEFAULT '[]'::jsonb,
        notes TEXT,
        completed_at TIMESTAMPTZ,
        sent_to_owner BOOLEAN NOT NULL DEFAULT FALSE,
        sent_to_guest BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_cleaning_checklists_user_id ON cleaning_checklists(user_id);
      CREATE INDEX IF NOT EXISTS idx_cleaning_checklists_cleaner_id ON cleaning_checklists(cleaner_id);
      CREATE INDEX IF NOT EXISTS idx_cleaning_checklists_reservation_key ON cleaning_checklists(reservation_key);
      
      -- Ajouter la colonne pin_code si elle n'existe pas déjà
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaners' AND column_name = 'pin_code'
        ) THEN
          ALTER TABLE cleaners ADD COLUMN pin_code TEXT UNIQUE;
        END IF;
      END $$;
    

CREATE TABLE IF NOT EXISTS invoice_download_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id TEXT,
  invoice_number TEXT NOT NULL,
  file_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invoice_download_tokens_token
ON invoice_download_tokens(token);
`);

    // ============================================
    // 🧹 MIGRATIONS MÉNAGE — Templates + colonnes enrichies
    // ============================================
    await pool.query(`
      -- Table des templates de ménage par logement
      CREATE TABLE IF NOT EXISTS cleaning_templates (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id TEXT,
        name TEXT NOT NULL DEFAULT 'Template ménage',
        tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_cleaning_templates_user_id ON cleaning_templates(user_id);
      CREATE INDEX IF NOT EXISTS idx_cleaning_templates_property ON cleaning_templates(user_id, property_id);

      -- Nouvelles colonnes sur cleaning_checklists
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaning_checklists' AND column_name = 'duration_seconds')
        THEN
          ALTER TABLE cleaning_checklists ADD COLUMN duration_seconds INTEGER DEFAULT NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaning_checklists' AND column_name = 'started_at')
        THEN
          ALTER TABLE cleaning_checklists ADD COLUMN started_at TIMESTAMPTZ DEFAULT NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaning_checklists' AND column_name = 'owner_status')
        THEN
          ALTER TABLE cleaning_checklists ADD COLUMN owner_status TEXT NOT NULL DEFAULT 'pending';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaning_checklists' AND column_name = 'owner_validated_at')
        THEN
          ALTER TABLE cleaning_checklists ADD COLUMN owner_validated_at TIMESTAMPTZ DEFAULT NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaning_checklists' AND column_name = 'owner_notes')
        THEN
          ALTER TABLE cleaning_checklists ADD COLUMN owner_notes TEXT DEFAULT NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'cleaning_checklists' AND column_name = 'is_validated')
        THEN
          ALTER TABLE cleaning_checklists ADD COLUMN is_validated BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END $$;

      -- Table des cleaners par défaut par logement
      CREATE TABLE IF NOT EXISTS property_default_cleaners (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL,
        cleaner_id TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, property_id)
      );
    `);

    console.log('✅ Tables users, welcome_books, cleaners, user_settings, cleaning_assignments, cleaning_checklists & cleaning_templates OK dans Postgres');

    // Ajouter colonnes escalade sur conversations (si pas déjà existantes)
    try {
      await pool.query(`
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT FALSE;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_escalation BOOLEAN DEFAULT FALSE;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
      `);
      console.log('✅ Colonnes escalated ajoutées à conversations');
    } catch (e) {
      console.log('ℹ️ Colonnes escalated: ', e.message);
    }

    // Ajouter colonnes escalade sur conversations (si pas déjà existantes)
    try {
      await pool.query(`
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT FALSE;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_escalation BOOLEAN DEFAULT FALSE;
        ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
      `);
      console.log('✅ Colonnes escalated ajoutées à conversations');
    } catch (e) {
      // Colonnes déjà existantes ou table pas encore créée
      console.log('ℹ️ Colonnes escalated: ', e.message);
    }
  } catch (err) {
    console.error('❌ Erreur initDb (Postgres):', err);
    process.exit(1);
  }
}

// ============================================
// NOTIFICATIONS PROPRIÉTAIRES – EMAIL
// ============================================

let emailTransporter = null;
// Cache des users pour ne pas spammer la base pendant une sync
const notificationUserCache = new Map();

// Valeurs par défaut des préférences de notifications
const DEFAULT_NOTIFICATION_SETTINGS = {
  newReservation: true,
  reminder: false,
  whatsappEnabled: false,
  whatsappNumber: '',
  // Nouvelles préférences granulaires
  notif_new_reservation: true,
  notif_reservation_cancelled: true,
  notif_daily_summary: true,
  notif_reminder_j1: true,
  notif_cleaning_reminder: true,
  notif_cleaning_completed: true,
  notif_checklist_done: true,
  notif_deposit_request: true,
  notif_deposit_release: true,
  notif_new_message: true,
  notif_new_invoice: true
};

function getEmailTransporter() {
  if (emailTransporter) return emailTransporter;

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;
  const host = process.env.EMAIL_HOST;
  const service = process.env.EMAIL_SERVICE;

  if (!user || !pass) {
    console.log('⚠️  Email non configuré (EMAIL_USER ou EMAIL_PASSWORD manquants)');
    return null;
  }

  // Mode SMTP complet (Mailgun, OVH, etc.)
  if (host) {
    emailTransporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user,
        pass
      }
    });
  } else {
    // Mode "service" (Gmail, Outlook...) – compatible avec l'ancien système
    emailTransporter = nodemailer.createTransport({
      service: service || 'gmail',
      auth: {
        user,
        pass
      }
    });
  }

  return emailTransporter;
}
function getBrevoSender() {
  const from = process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';

  const match = from.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return {
      name: (match[1] || 'Boostinghost').trim().replace(/^"|"$/g, ''),
      email: match[2].trim()
    };
  }

  return {
    name: 'Boostinghost',
    email: from.trim()
  };
}

async function sendEmailViaBrevo({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY manquant pour l’envoi via Brevo');
  }

  const sender = getBrevoSender();

  const payload = {
    sender,
    to: [{ email: to }],
    subject
  };

  if (html) payload.htmlContent = html;
  if (text) payload.textContent = text;

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      payload,
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 10000
      }
    );

    return response.data;
  } catch (err) {
    console.error(
      '❌ Erreur envoi email via Brevo :',
      err.response?.data || err.message || err
    );
    throw err;
  }
}
async function getUserForNotifications(userId) {
  if (!userId) return null;
  if (notificationUserCache.has(userId)) {
    return notificationUserCache.get(userId);
  }

  const result = await pool.query(
    `SELECT id, company, first_name, last_name, email
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    notificationUserCache.set(userId, null);
    return null;
  }

  const row = result.rows[0];
  const user = {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company
  };

  notificationUserCache.set(userId, user);
  return user;
}

function formatDateForEmail(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Récupère les préférences de notifications pour un utilisateur
async function getNotificationSettings(userId) {
  if (!userId) return { ...DEFAULT_NOTIFICATION_SETTINGS };

  const result = await pool.query(
    'SELECT notifications FROM user_settings WHERE user_id = $1',
    [userId]
  );

  if (!result.rows.length || !result.rows[0].notifications) {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }

  const raw = result.rows[0].notifications;

  return {
    newReservation:
      typeof raw.newReservation === 'boolean'
        ? raw.newReservation
        : DEFAULT_NOTIFICATION_SETTINGS.newReservation,
    reminder:
      typeof raw.reminder === 'boolean'
        ? raw.reminder
        : DEFAULT_NOTIFICATION_SETTINGS.reminder,
    whatsappEnabled:
      typeof raw.whatsappEnabled === 'boolean'
        ? raw.whatsappEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.whatsappEnabled,
    whatsappNumber:
      typeof raw.whatsappNumber === 'string'
        ? raw.whatsappNumber
        : DEFAULT_NOTIFICATION_SETTINGS.whatsappNumber,
    // Préférences granulaires
    notif_new_reservation: typeof raw.notif_new_reservation === 'boolean' ? raw.notif_new_reservation : DEFAULT_NOTIFICATION_SETTINGS.notif_new_reservation,
    notif_reservation_cancelled: typeof raw.notif_reservation_cancelled === 'boolean' ? raw.notif_reservation_cancelled : DEFAULT_NOTIFICATION_SETTINGS.notif_reservation_cancelled,
    notif_daily_summary: typeof raw.notif_daily_summary === 'boolean' ? raw.notif_daily_summary : DEFAULT_NOTIFICATION_SETTINGS.notif_daily_summary,
    notif_reminder_j1: typeof raw.notif_reminder_j1 === 'boolean' ? raw.notif_reminder_j1 : DEFAULT_NOTIFICATION_SETTINGS.notif_reminder_j1,
    notif_cleaning_reminder: typeof raw.notif_cleaning_reminder === 'boolean' ? raw.notif_cleaning_reminder : DEFAULT_NOTIFICATION_SETTINGS.notif_cleaning_reminder,
    notif_cleaning_completed: typeof raw.notif_cleaning_completed === 'boolean' ? raw.notif_cleaning_completed : DEFAULT_NOTIFICATION_SETTINGS.notif_cleaning_completed,
    notif_checklist_done: typeof raw.notif_checklist_done === 'boolean' ? raw.notif_checklist_done : DEFAULT_NOTIFICATION_SETTINGS.notif_checklist_done,
    notif_deposit_request: typeof raw.notif_deposit_request === 'boolean' ? raw.notif_deposit_request : DEFAULT_NOTIFICATION_SETTINGS.notif_deposit_request,
    notif_deposit_release: typeof raw.notif_deposit_release === 'boolean' ? raw.notif_deposit_release : DEFAULT_NOTIFICATION_SETTINGS.notif_deposit_release,
    notif_new_message: typeof raw.notif_new_message === 'boolean' ? raw.notif_new_message : DEFAULT_NOTIFICATION_SETTINGS.notif_new_message,
    notif_new_invoice: typeof raw.notif_new_invoice === 'boolean' ? raw.notif_new_invoice : DEFAULT_NOTIFICATION_SETTINGS.notif_new_invoice,
  };
}

// Sauvegarde les préférences de notifications pour un utilisateur
async function saveNotificationSettings(userId, settings) {
  if (!userId) throw new Error('userId manquant pour saveNotificationSettings');

  const clean = {
    newReservation:
      typeof settings.newReservation === 'boolean'
        ? settings.newReservation
        : DEFAULT_NOTIFICATION_SETTINGS.newReservation,
    reminder:
      typeof settings.reminder === 'boolean'
        ? settings.reminder
        : DEFAULT_NOTIFICATION_SETTINGS.reminder,
    whatsappEnabled:
      typeof settings.whatsappEnabled === 'boolean'
        ? settings.whatsappEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.whatsappEnabled,
    whatsappNumber:
      typeof settings.whatsappNumber === 'string'
        ? settings.whatsappNumber.trim()
        : DEFAULT_NOTIFICATION_SETTINGS.whatsappNumber,
    // Préférences granulaires
    notif_new_reservation: typeof settings.notif_new_reservation === 'boolean' ? settings.notif_new_reservation : DEFAULT_NOTIFICATION_SETTINGS.notif_new_reservation,
    notif_reservation_cancelled: typeof settings.notif_reservation_cancelled === 'boolean' ? settings.notif_reservation_cancelled : DEFAULT_NOTIFICATION_SETTINGS.notif_reservation_cancelled,
    notif_daily_summary: typeof settings.notif_daily_summary === 'boolean' ? settings.notif_daily_summary : DEFAULT_NOTIFICATION_SETTINGS.notif_daily_summary,
    notif_reminder_j1: typeof settings.notif_reminder_j1 === 'boolean' ? settings.notif_reminder_j1 : DEFAULT_NOTIFICATION_SETTINGS.notif_reminder_j1,
    notif_cleaning_reminder: typeof settings.notif_cleaning_reminder === 'boolean' ? settings.notif_cleaning_reminder : DEFAULT_NOTIFICATION_SETTINGS.notif_cleaning_reminder,
    notif_cleaning_completed: typeof settings.notif_cleaning_completed === 'boolean' ? settings.notif_cleaning_completed : DEFAULT_NOTIFICATION_SETTINGS.notif_cleaning_completed,
    notif_checklist_done: typeof settings.notif_checklist_done === 'boolean' ? settings.notif_checklist_done : DEFAULT_NOTIFICATION_SETTINGS.notif_checklist_done,
    notif_deposit_request: typeof settings.notif_deposit_request === 'boolean' ? settings.notif_deposit_request : DEFAULT_NOTIFICATION_SETTINGS.notif_deposit_request,
    notif_deposit_release: typeof settings.notif_deposit_release === 'boolean' ? settings.notif_deposit_release : DEFAULT_NOTIFICATION_SETTINGS.notif_deposit_release,
    notif_new_message: typeof settings.notif_new_message === 'boolean' ? settings.notif_new_message : DEFAULT_NOTIFICATION_SETTINGS.notif_new_message,
    notif_new_invoice: typeof settings.notif_new_invoice === 'boolean' ? settings.notif_new_invoice : DEFAULT_NOTIFICATION_SETTINGS.notif_new_invoice,
  };

  await pool.query(
    `INSERT INTO user_settings (user_id, notifications, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET notifications = EXCLUDED.notifications,
           updated_at = NOW()`,
    [userId, clean]
  );

  return clean;
}

// ===== Helper: vérifier préférence avant envoi =====
async function shouldSendNotification(userId, prefKey) {
  try {
    const settings = await getNotificationSettings(userId);
    const allowed = settings[prefKey] !== false;
    if (!allowed) console.log(`ℹ️ Notif [${prefKey}] désactivée pour ${userId}`);
    return allowed;
  } catch(e) {
    return true;
  }
}

// Récupère les assignations de ménage pour un utilisateur sous forme de map { propertyId -> cleaner }
// Prend en compte : 1) assignation par reservation_key spécifique 2) cleaner par défaut du logement
async function getCleanerAssignmentsMapForUser(userId) {
  if (!userId) return {};

  // Assignations spécifiques (par reservation_key ou par property_id)
  const result = await pool.query(
    `
    SELECT
      ca.property_id,
      ca.cleaner_id,
      c.name  AS cleaner_name,
      c.email AS cleaner_email,
      c.phone AS cleaner_phone,
      c.is_active AS cleaner_active
    FROM cleaning_assignments ca
    LEFT JOIN cleaners c ON c.id = ca.cleaner_id
    WHERE ca.user_id = $1
    `,
    [userId]
  );

  const map = {};
  for (const row of result.rows) {
    if (row.cleaner_active === false) continue;
    if (!row.property_id || !row.cleaner_id) continue;

    map[row.property_id] = {
      cleanerId: row.cleaner_id,
      name: row.cleaner_name,
      email: row.cleaner_email,
      phone: row.cleaner_phone
    };
  }

  // Compléter avec les cleaners par défaut pour les logements sans assignation
  try {
    const defaults = await pool.query(
      `SELECT pdc.property_id, pdc.cleaner_id, c.name, c.email, c.phone, c.is_active
       FROM property_default_cleaners pdc
       LEFT JOIN cleaners c ON c.id = pdc.cleaner_id
       WHERE pdc.user_id = $1`,
      [userId]
    );

    for (const row of defaults.rows) {
      if (row.is_active === false) continue;
      // Ne pas écraser une assignation spécifique existante
      if (!map[row.property_id]) {
        map[row.property_id] = {
          cleanerId: row.cleaner_id,
          name: row.name,
          email: row.email,
          phone: row.phone
        };
      }
    }
  } catch (e) {
    // Table peut ne pas encore exister
    console.error('Fallback defaults cleaners:', e.message);
  }

  return map;
}

/**
 * Envoie les emails de notifications de nouvelles réservations / annulations,
 * en respectant les préférences de l'utilisateur.
 * 
 * VERSION CORRIGÉE AVEC LOGS DÉTAILLÉS POUR DEBUGGING WHATSAPP
 */
async function notifyOwnersAboutBookings(newReservations, cancelledReservations) {
   // ===================================================================
  // 🛑 EMAILS DÉSACTIVÉS : Nouvelles réservations et annulations
  // Si vous voulez les réactiver plus tard, supprimez juste le "return;" ci-dessous
  // ===================================================================
  console.log('ℹ️ notifyOwnersAboutBookings appelée mais DÉSACTIVÉE (pas d\'emails envoyés)');
  return;
  const brevoKey = process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim();
  if (!brevoKey) {
    console.log(
      "⚠️ BREVO_API_KEY manquant : aucune notification propriétaire (nouvelle résa / annulation) ne sera envoyée."
    );
    return;
  }

  const from = process.env.EMAIL_FROM || "Boostinghost <no-reply@boostinghost.com>";
  const tasks = [];

  const handleReservation = (res, type) => {
    const userId = res.userId;
    if (!userId) {
      console.log("⚠️  Réservation sans userId, notification ignorée :", res.uid || res.id);
      return;
    }

    tasks.push(
      (async () => {
        const user = await getUserForNotifications(userId);
        if (!user || !user.email) {
          console.log(`⚠️  Aucun email trouvé pour user ${userId}, notification ignorée`);
          return;
        }

        // 🔔 Récupérer les préférences de notifications
        let settings;
        try {
          settings = await getNotificationSettings(userId);
          console.log(
            `📋 Settings récupérés pour user ${userId}:`,
            JSON.stringify(settings, null, 2)
          );
        } catch (e) {
          console.error(
            "Erreur lors de la récupération des préférences de notifications pour user",
            userId,
            e
          );
          settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
        }

        // Pour l'instant, on utilise la même option pour nouvelles résas & annulations
        if (settings && settings.newReservation === false) {
          console.log(
            `ℹ️ Notifications de réservations désactivées pour user ${userId}, email non envoyé.`
          );
          return;
        }

        const propertyName =
          res.propertyName || (res.property && res.property.name) || "Votre logement";

        const guest = res.guestName || res.guest_name || res.guest || res.name || "Un voyageur";

        const source = res.source || res.platform || "une plateforme";

        const start = formatDateForEmail(res.start || res.startDate || res.checkIn || res.checkin);
        const end = formatDateForEmail(res.end || res.endDate || res.checkOut || res.checkout);

        const hello = user.firstName ? `Bonjour ${user.firstName},` : "Bonjour,";

        let subject;
        let textBody;
        let htmlBody;

        if (type === "new") {
          subject = `🛎️ Nouvelle réservation – ${propertyName}`;
          textBody = `${hello}

Une nouvelle réservation vient d'être enregistrée via ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
Séjour  : du ${start} au ${end}

Vous pouvez retrouver tous les détails dans votre tableau de bord Boostinghost.`;

          htmlBody = `
            <p>${hello}</p>
            <p>Une nouvelle réservation vient d'être enregistrée via <strong>${source}</strong>.</p>
            <ul>
              <li><strong>Logement :</strong> ${propertyName}</li>
              <li><strong>Voyageur :</strong> ${guest}</li>
              <li><strong>Séjour :</strong> du ${start} au ${end}</li>
            </ul>
            <p>Vous pouvez retrouver tous les détails dans votre tableau de bord Boostinghost.</p>
          `;
        } else {
          subject = `⚠️ Réservation annulée – ${propertyName}`;
          textBody = `${hello}

Une réservation vient d'être annulée sur ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
Séjour initial : du ${start} au ${end}

Pensez à vérifier votre calendrier et vos blocages si nécessaire.`;

          htmlBody = `
            <p>${hello}</p>
            <p>Une réservation vient d'être <strong>annulée</strong> sur <strong>${source}</strong>.</p>
            <ul>
              <li><strong>Logement :</strong> ${propertyName}</li>
              <li><strong>Voyageur :</strong> ${guest}</li>
              <li><strong>Séjour initial :</strong> du ${start} au ${end}</li>
            </ul>
            <p>Pensez à vérifier votre calendrier et vos blocages si nécessaire.</p>
          `;
        }

        try {
          // 👉 Toujours via l'API Brevo
          console.log("📧 [Brevo API] Envoi email", type, "à", user.email);
          await sendEmailViaBrevo({
            to: user.email,
            subject,
            text: textBody,
            html: htmlBody,
          });

          console.log(
            `📧 Notification "${type}" envoyée à ${user.email} (resa uid=${res.uid || res.id})`
          );
        } catch (err) {
          console.error(
            `❌' Erreur envoi email de notification "${type}" à ${user.email} :`,
            err
          );
        }
      })()
    );
  };

  (newReservations || []).forEach((r) => handleReservation(r, "new"));
  (cancelledReservations || []).forEach((r) => handleReservation(r, "cancelled"));

  if (tasks.length === 0) {
    console.log("ℹ️ Aucune notification propriétaire à envoyer (listes vides).");
    return;
  }

  console.log(
    `📧 Notifications à envoyer – nouvelles: ${newReservations.length || 0}, annulées: ${
      cancelledReservations.length || 0
    }`
  );
  await Promise.all(tasks);
}
/**
 * Notifications ménage : pour chaque nouvelle réservation, si un logement a un cleaner assigné,
 * on envoie un email + (optionnel) un WhatsApp à ce cleaner.
 */
async function notifyCleanersAboutNewBookings(newReservations) {
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      '⚠️  Ni email (Brevo/SMTP) ni WhatsApp configurés, aucune notification ménage envoyée'
    );
    return;
  }

  if (!newReservations || newReservations.length === 0) {
    return;
  }

  const from = process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';
  const tasks = [];

  // On groupe par user, pour ne pas requêter 50 fois la base
  const byUser = new Map();
  for (const res of newReservations) {
    if (!res.userId || !res.propertyId) continue;
    if (!byUser.has(res.userId)) {
      byUser.set(res.userId, []);
    }
    byUser.get(res.userId).push(res);
  }

  for (const [userId, userReservations] of byUser.entries()) {
    let assignmentsMap = {};
    try {
      assignmentsMap = await getCleanerAssignmentsMapForUser(userId);
    } catch (err) {
      console.error('Erreur récupération assignations ménage pour user', userId, err);
      continue;
    }

    if (!assignmentsMap || Object.keys(assignmentsMap).length === 0) {
      continue;
    }

    for (const res of userReservations) {
      const assignment = assignmentsMap[res.propertyId];
      if (!assignment) {
        // Aucun cleaner assigné à ce logement → rien à envoyer
        continue;
      }

      const cleanerEmail = assignment.email;
      const cleanerPhone = assignment.phone;
      const cleanerName  = assignment.name || 'partenaire ménage';

      const propertyName =
        res.propertyName ||
        (res.property && res.property.name) ||
        'Votre logement';

      const guest =
        res.guestName ||
        res.guest_name ||
        res.guest ||
        res.name ||
        'Un voyageur';

      const start = formatDateForEmail(
        res.start || res.startDate || res.checkIn || res.checkin
      );
      const end = formatDateForEmail(
        res.end || res.endDate || res.checkOut || res.checkout
      );

      const hello = cleanerName ? `Bonjour ${cleanerName},` : 'Bonjour,';

            // Email
      if ((useBrevo || transporter) && cleanerEmail) {
        const subject = `🧹 Nouveau ménage à prévoir – ${propertyName}`;
        const textBody = `${hello}

Un nouveau séjour vient d'être réservé pour le logement ${propertyName}.

Voyageur : ${guest}
Séjour  : du ${start} au ${end}
Ménage à prévoir : le ${end} après le départ des voyageurs
(heure exacte de check-out à confirmer avec la conciergerie).

Merci beaucoup,
L'équipe Boostinghost`;

        const htmlBody = `
          <p>${hello}</p>
          <p>Un nouveau séjour vient d'être réservé pour le logement <strong>${propertyName}</strong>.</p>
          <ul>
            <li><strong>Voyageur :</strong> ${guest}</li>
            <li><strong>Séjour :</strong> du ${start} au ${end}</li>
            <li><strong>Ménage à prévoir :</strong> le ${end} après le départ des voyageurs</li>
          </ul>
          <p style="font-size:13px;color:#6b7280;">
            Heure exacte de check-out à confirmer avec la conciergerie.
          </p>
        `;

        tasks.push(
          (useBrevo
            ? sendEmailViaBrevo({
                to: cleanerEmail,
                subject,
                text: textBody,
                html: htmlBody
              })
            : transporter.sendMail({
                from,
                to: cleanerEmail,
                subject,
                text: textBody,
                html: htmlBody
              })
          )
            .then(() => {
              console.log(
                `📧 Notification ménage envoyée à ${cleanerEmail} (resa uid=${res.uid || res.id})`
              );
            })
            .catch((err) => {
              console.error('❌ Erreur envoi email notification ménage :', err);
            })
        );
      }
    }
  }

  await Promise.all(tasks);
}
/**
 * Envoie chaque jour un planning de ménage pour "demain"
 * à chaque cleaner assigné (email + WhatsApp si dispo).
 */
async function sendDailyCleaningPlan() {
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      '⚠️  Ni email (Brevo/SMTP) ni WhatsApp configurés, planning ménage non envoyé'
    );
    return;
  }

  if (!PROPERTIES || !Array.isArray(PROPERTIES) || PROPERTIES.length === 0) {
    console.log('ℹ️ Aucun logement configuré, pas de planning ménage à envoyer.');
    return;
  }

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10); // yyyy-mm-dd

  // 1) Construire un map propertyId -> { cleanerId, name, email, phone }
  const assignmentsByPropertyId = {};

  const userIds = [...new Set(PROPERTIES.map((p) => p.userId))];
  for (const userId of userIds) {
    const map = await getCleanerAssignmentsMapForUser(userId);
    Object.keys(map).forEach((propertyId) => {
      assignmentsByPropertyId[propertyId] = map[propertyId];
    });
  }

  // 2) Construire tâches par cleaner
  const tasksByCleanerId = {}; // cleanerId -> { cleaner, tasks: [] }

  for (const property of PROPERTIES) {
    const assignment = assignmentsByPropertyId[property.id];
    if (!assignment) continue;

    const reservations = reservationsStore.properties[property.id] || [];
    for (const r of reservations) {
      if (!r || !r.end) continue;
      if (r.type === 'block' || r.source === 'BLOCK') continue;

      const endDate = new Date(r.end);
      if (Number.isNaN(endDate.getTime())) continue;

      const endIso = endDate.toISOString().slice(0, 10);
      if (endIso !== tomorrowIso) continue; // checkout pas demain → ignore

      const cleanerId = assignment.cleanerId;
      if (!tasksByCleanerId[cleanerId]) {
        tasksByCleanerId[cleanerId] = {
          cleaner: assignment,
          tasks: []
        };
      }

      tasksByCleanerId[cleanerId].tasks.push({
        propertyName: property.name || property.id,
        guestName: r.guestName || r.guest_name || r.name || 'Voyageur',
        start: formatDateForEmail(r.start || r.startDate || r.checkIn || r.checkin),
        end: formatDateForEmail(r.end)
      });
    }
  }

  const tasks = [];
  const from = process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';

  Object.keys(tasksByCleanerId).forEach((cleanerId) => {
    const entry = tasksByCleanerId[cleanerId];
    const cleaner = entry.cleaner;
    const jobs = entry.tasks;

    if (!jobs || jobs.length === 0) return;

const cleanerName = cleaner.name || '';
const cleanerEmail = cleaner.email;
const cleanerPhone = cleaner.phone;

const hello = cleanerName ? `Bonjour ${cleanerName},` : 'Bonjour,';
const subject = `🧹 Planning ménage – ${tomorrowIso}`;

if ((useBrevo || transporter) && cleanerEmail) {
  // Construction du textBody
  let textBody = `${hello}\n\nPlanning ménage de demain (${tomorrowIso}):\n\n`;
  jobs.forEach((job, index) => {
    textBody += `${index + 1}. ${job.propertyName} – départ le ${job.end} (${job.guestName})\n`;
  });
  textBody += '\nMerci beaucoup,\nL\'équipe Boostinghost';

  // Construction du htmlBody
  let htmlBody = `<p>${hello}</p><p>Planning ménage de demain (${tomorrowIso}):</p><ul>`;
  jobs.forEach((job) => {
    htmlBody += `<li><strong>${job.propertyName}</strong> – départ le ${job.end} (${job.guestName})</li>`;
  });
  htmlBody += `</ul><p>Merci beaucoup,<br>L'équipe Boostinghost</p>`;

  tasks.push(
    (useBrevo
      ? sendEmailViaBrevo({
          to: cleanerEmail,
          subject,
          text: textBody,
          html: htmlBody
        })
      : transporter.sendMail({
          from,
          to: cleanerEmail,
          subject,
          text: textBody,
          html: htmlBody
        })
    )
      .then(() => {
        console.log(
          `📧 Planning ménage envoyé à ${cleanerEmail} pour ${tomorrowIso}`
        );
      })
      .catch((err) => {
        console.error('❌ Erreur envoi planning ménage (email) :', err);
      })
  );
  }
    // WhatsApp
  });

  await Promise.all(tasks);

  console.log('✅ Planning ménage quotidien envoyé (si tâches détectées).');
}

// ============================================
// APP / STRIPE / STORE
// ============================================
const app = express();

// ✅ Configuration de l'expéditeur des emails
const EMAIL_FROM = `"Boostinghost" <${process.env.EMAIL_USER}>`;

// Rendre les variables globales disponibles pour les routes
app.locals.pool = pool;

// Augmenter la limite pour les uploads de photos
// ⚠️ COMMENTÉ : bodyParser doit être APRÈS le webhook Stripe (voir ligne 2038-2041)
// app.use(bodyParser.json({ limit: '50mb' }));
// app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// ✅ Healthcheck (pour vérifier que Render sert bien CE serveur)
app.get('/api/health', (req, res) => res.status(200).send('ok-health'));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
const PORT = process.env.PORT || 3000;


// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;

// ✅ WEBHOOK STRIPE (AVANT LES AUTRES MIDDLEWARES)
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET manquant');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Erreur verification webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Webhook Stripe reçu:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        
        // 🔍 Déterminer le type de session (abonnement, caution, ou paiement)
        const paymentType = session.metadata?.payment_type;
        const depositId = session.metadata?.deposit_id;
        const paymentId = session.metadata?.payment_id;
        // 💰 PAIEMENT DE LOCATION
        if (paymentType === 'location' || paymentId) {
          console.log('Paiement de location detecte');
          try {
            await pool.query(`
              UPDATE payments 
              SET status = 'paid',
                  stripe_payment_intent_id = $1,
                  updated_at = NOW()
              WHERE id = $2 OR stripe_session_id = $3
            `, [session.payment_intent, paymentId, session.id]);
            
            console.log(`Paiement confirme: ${paymentId || session.id}`);
          } catch (err) {
            console.error('Erreur mise a jour payment:', err);
          }
          break;
        }
        
        // 🛡️ CAUTION
        if (depositId || session.metadata?.deposit_id) {
          console.log('Caution detectee');
          try {
            // Recuperer le Payment Intent pour verifier s'il est autorise ou capture
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
            
            // Determiner le statut en fonction de l'etat Stripe
            let depositStatus = 'authorized';
            if (paymentIntent.status === 'succeeded' && paymentIntent.charges.data[0]?.captured) {
              depositStatus = 'captured';
            }
            
            // Mettre à jour la caution - VERSION SIMPLIFIÉE
            const updateQuery = `
              UPDATE deposits 
              SET status = $1,
                  stripe_payment_intent_id = $2,
                  updated_at = NOW()
              WHERE id = $3 OR stripe_session_id = $4
            `;
            
            await pool.query(updateQuery, [depositStatus, session.payment_intent, depositId, session.id]);
            
            // Mettre à jour les timestamps séparément pour éviter les conflits de type
            if (depositStatus === 'authorized') {
              await pool.query(`UPDATE deposits SET authorized_at = NOW() WHERE id = $1`, [depositId]);
            } else if (depositStatus === 'captured') {
              await pool.query(`UPDATE deposits SET captured_at = NOW() WHERE id = $1`, [depositId]);
            }
            
            console.log(`Caution confirmee: ${depositId} (statut: ${depositStatus})`);
            
            // 📨 ENVOYER MESSAGE AUTOMATIQUE : CAUTION AUTORISÉE
            if (depositStatus === 'authorized') {
              try {
                await sendDepositAuthorizedMessage(pool, io, depositId);
              } catch (msgError) {
                console.error('❌ Erreur envoi message caution autorisée:', msgError);
              }
            }
            
            // Envoyer automatiquement les infos si c'est bientot l'arrivee
            if (depositId) {
              await handleDepositPaid(depositId, io);
            }
          } catch (err) {
            console.error('Erreur mise a jour deposit:', err);
          }
          break;
        }
        
        // 📝 ABONNEMENT (logique existante)
        const userId = session.client_reference_id || session.metadata?.userId;
        
        if (!userId) {
          console.error('userId manquant dans checkout.session.completed');
          break;
        }

        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Récupérer l'abonnement Stripe pour vérifier s'il y a un essai gratuit
        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        const isTrialing = stripeSubscription.status === 'trialing';
        
        // ✅ AMÉLIORATION : Récupérer le vrai plan depuis le Price ID Stripe
        let plan = session.metadata?.plan;
        
        // Si pas de metadata ou metadata incorrecte, récupérer depuis le Price ID
        if (!plan || plan === 'solo_monthly') {
          const priceId = stripeSubscription.items.data[0]?.price?.id;
          if (priceId) {
            plan = getPlanFromPriceId(priceId);
            console.log(`✅ Plan détecté depuis Price ID: ${priceId} -> ${plan}`);
          } else {
            plan = 'solo_monthly';
            console.warn('⚠️ Aucun Price ID trouvé, utilisation du plan Solo par défaut');
          }
        }
        
        const basePlan = getBasePlanName(plan);
        const subscriptionStatus = isTrialing ? 'trial' : 'active';

        if (isTrialing) {
          // Avec période d'essai
          await pool.query(
            `INSERT INTO subscriptions 
             (user_id, stripe_subscription_id, stripe_customer_id, plan_type, status, trial_start_date, trial_end_date, current_period_end)
             VALUES ($1, $2, $3, $4, 'trial', NOW(), to_timestamp($5), to_timestamp($6))
             ON CONFLICT (user_id) 
             DO UPDATE SET
               stripe_subscription_id = $2,
               stripe_customer_id = $3,
               plan_type = $4,
               status = 'trial',
               trial_start_date = NOW(),
               trial_end_date = to_timestamp($5),
               current_period_end = to_timestamp($6),
               updated_at = NOW()`,
            [userId, subscriptionId, customerId, basePlan, stripeSubscription.trial_end, stripeSubscription.current_period_end]
          );
        } else {
          // Sans période d'essai - abonnement actif immédiatement
          await pool.query(
            `INSERT INTO subscriptions 
             (user_id, stripe_subscription_id, stripe_customer_id, plan_type, status, current_period_end)
             VALUES ($1, $2, $3, $4, 'active', to_timestamp($5))
             ON CONFLICT (user_id) 
             DO UPDATE SET
               stripe_subscription_id = $2,
               stripe_customer_id = $3,
               plan_type = $4,
               status = 'active',
               trial_start_date = NULL,
               trial_end_date = NULL,
               current_period_end = to_timestamp($5),
               updated_at = NOW()`,
            [userId, subscriptionId, customerId, basePlan, stripeSubscription.current_period_end]
          );
        }

        const userResult = await pool.query(
          'SELECT email, first_name FROM users WHERE id = $1',
          [userId]
        );

        if (userResult.rows.length > 0) {
          const userEmail = userResult.rows[0].email;
          const userFirstName = userResult.rows[0].first_name || 'cher membre';
          const planAmount = getPlanAmount(plan);

          if (isTrialing) {
            await sendTrialStartedEmail(userEmail, userFirstName, basePlan, planAmount);
            await logEmailSent(userId, 'trial_started', { plan: basePlan, planAmount });
            console.log(`✅ Essai gratuit démarré pour user ${userId} (plan: ${basePlan})`);
          } else {
            await sendSubscriptionConfirmedEmail(userEmail, userFirstName, basePlan, planAmount);
            await logEmailSent(userId, 'subscription_confirmed', { plan: basePlan, planAmount });
            console.log(`✅ Abonnement actif créé pour user ${userId} (plan: ${basePlan})`);
          }
        }

        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = subscription.metadata?.userId;
        const plan = subscription.metadata?.plan;

        if (invoice.billing_reason === 'subscription_create') {
          await pool.query(
            `UPDATE subscriptions 
             SET 
               status = 'active',
               trial_end_date = NULL,
               current_period_end = to_timestamp($1),
               updated_at = NOW()
             WHERE stripe_subscription_id = $2`,
            [subscription.current_period_end, subscriptionId]
          );

          console.log(`✅ Abonnement ACTIF après essai: ${subscriptionId}`);
          
          if (userId) {
            const userResult = await pool.query(
              'SELECT email, first_name FROM users WHERE id = $1',
              [userId]
            );

            if (userResult.rows.length > 0) {
              const userEmail = userResult.rows[0].email;
              const userFirstName = userResult.rows[0].first_name || 'cher membre';
              const basePlan = getBasePlanName(plan || 'solo_monthly');
              const planAmount = getPlanAmount(plan || 'solo_monthly');

              await sendSubscriptionConfirmedEmail(userEmail, userFirstName, basePlan, planAmount);
              await logEmailSent(userId, 'subscription_confirmed', { plan: basePlan, planAmount });
            }
          }
        } else {
          await pool.query(
            `UPDATE subscriptions 
             SET 
               current_period_end = to_timestamp($1),
               updated_at = NOW()
             WHERE stripe_subscription_id = $2`,
            [subscription.current_period_end, subscriptionId]
          );
          
          console.log(`✅ Abonnement renouvelé: ${subscriptionId}`);
        }
        
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        let status = 'active';
        if (subscription.status === 'trialing') status = 'trial';
        else if (subscription.status === 'canceled') status = 'canceled';
        else if (subscription.status === 'past_due') status = 'past_due';
        else if (subscription.status === 'unpaid') status = 'expired';

        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = $1,
             current_period_end = to_timestamp($2),
             updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscriptionId]
        );

        console.log(`✅ Abonnement ${subscriptionId} mis à jour: ${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        await pool.query(
          `UPDATE subscriptions 
           SET status = 'canceled', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`✅ Abonnement ${subscriptionId} annulé`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (subscriptionId) {
          await pool.query(
            `UPDATE subscriptions 
             SET status = 'past_due', updated_at = NOW()
             WHERE stripe_subscription_id = $1`,
            [subscriptionId]
          );

          console.log(`⚠️ Paiement échoué pour: ${subscriptionId}`);
        }
        break;
      }

      // 💰 ÉVÉNEMENTS SPÉCIFIQUES AUX CAUTIONS
      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object;
        
        // Vérifier si c'est une caution
        const depositResult = await pool.query(
          'SELECT id FROM deposits WHERE stripe_payment_intent_id = $1',
          [paymentIntent.id]
        );
        
        if (depositResult.rows.length > 0) {
          const depositId = depositResult.rows[0].id;
          
          await pool.query(
            `UPDATE deposits 
             SET status = 'canceled', cancelled_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [depositId]
          );
          
          console.log(`❌ Caution annulée: ${depositId}`);
          
          // 📨 ENVOYER MESSAGE : ÉCHEC
          try {
            await sendDepositFailedMessage(pool, io, depositId);
          } catch (msgError) {
            console.error('❌ Erreur envoi message caution annulée:', msgError);
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;
        
        // Vérifier si c'est une caution
        const depositResult = await pool.query(
          'SELECT id FROM deposits WHERE stripe_payment_intent_id = $1',
          [paymentIntentId]
        );
        
        if (depositResult.rows.length > 0) {
          const depositId = depositResult.rows[0].id;
          
          await pool.query(
            `UPDATE deposits 
             SET status = 'released', released_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [depositId]
          );
          
          console.log(`🎉 Caution libérée: ${depositId}`);
          
          // 📨 ENVOYER MESSAGE : CAUTION LIBÉRÉE
          try {
            await sendDepositReleasedMessage(pool, io, depositId);
          } catch (msgError) {
            console.error('❌ Erreur envoi message caution libérée:', msgError);
          }
        }
        break;
      }

      // 💳 SESSION STRIPE EXPIRÉE (le voyageur n'a pas payé dans le délai)
      case 'checkout.session.expired': {
        const expiredSession = event.data.object;
        const expiredDepositId = expiredSession.metadata?.deposit_id;
        
        if (expiredDepositId) {
          console.log(`⏰ Session Stripe expirée pour caution ${expiredDepositId}`);
          
          // Récupérer le deposit pour vérifier s'il est toujours pending
          const depCheck = await pool.query(
            'SELECT id, status FROM deposits WHERE id = $1',
            [expiredDepositId]
          );
          
          if (depCheck.rows.length > 0 && depCheck.rows[0].status === 'pending') {
            await pool.query(
              `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1`,
              [expiredDepositId]
            );
            
            // 📨 Envoyer message d'échec
            try {
              await sendDepositFailedMessage(pool, io, expiredDepositId);
            } catch (msgError) {
              console.error('❌ Erreur envoi message session expirée:', msgError);
            }
          }
        }
        break;
      }

      // 💳 PAIEMENT ÉCHOUÉ (carte refusée, fonds insuffisants, etc.)
      case 'payment_intent.payment_failed': {
        const failedIntent = event.data.object;
        
        // Vérifier si c'est une caution
        const failedDepositResult = await pool.query(
          'SELECT id, status FROM deposits WHERE stripe_payment_intent_id = $1',
          [failedIntent.id]
        );
        
        if (failedDepositResult.rows.length > 0) {
          const failedDepositId = failedDepositResult.rows[0].id;
          const failReason = failedIntent.last_payment_error?.message || 'Paiement refusé';
          
          console.log(`❌ Paiement échoué pour caution ${failedDepositId}: ${failReason}`);
          
          // 📨 Envoyer message d'échec
          try {
            await sendDepositFailedMessage(pool, io, failedDepositId);
          } catch (msgError) {
            console.error('❌ Erreur envoi message paiement échoué:', msgError);
          }
        }
        break;
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Erreur traitement webhook:', error);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// ============================================
// 📱 ROUTES GUEST APP - DEEP LINKS iOS/Android
// ============================================

// Apple App Site Association pour Universal Links iOS
app.get('/.well-known/apple-app-site-association', (req, res) => {
  const association = {
    "applinks": {
      "apps": [],
      "details": [
        {
          "appID": "H5H2Y3S26J.com.boostinghost.guest",
         "paths": ["/guest", "/guest/*", "/guest-app/*", "/guest-app/public/*"]
        }
      ]
    }
  };
  res.setHeader('Content-Type', 'application/json');
  res.json(association);
});

// Android App Links - assetlinks.json
app.get('/.well-known/assetlinks.json', (req, res) => {
  const assetlinks = [
    {
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "com.boostinghost.guest",
        "sha256_cert_fingerprints": []
      }
    }
  ];
  res.setHeader('Content-Type', 'application/json');
  res.json(assetlinks);
});

// Route pour les deep links guest - redirige vers l'app web
app.get('/guest', (req, res) => {
  const propertyId = req.query.property;
  
  if (propertyId) {
    // Redirige vers la page guest-app avec le property_id
    res.redirect(`/guest-app/public/index.html?property=${propertyId}`);
  } else {
    res.status(400).send('Property ID manquant. Veuillez utiliser le lien fourni par votre hôte.');
  }
});

// Servir les fichiers statiques de la guest-app
app.use('/guest-app', express.static(path.join(__dirname, 'guest-app')));

// Store for reservations (en mémoire)
let reservationsStore = {
  properties: {},
  lastSync: null,
  syncStatus: 'idle'
};

// Fichiers locaux pour certains stocks
const MANUAL_RES_FILE = path.join(__dirname, 'manual-reservations.json');
const DEPOSITS_FILE = path.join(__dirname, 'deposits-config.json');

// ✅ V1 Checklists (JSON)
const CHECKLISTS_FILE = path.join(__dirname, 'checklists.json');
let CHECKLISTS = {}; // { [reservationUid]: { reservationUid, propertyId, userId, status, tasks, createdAt, updatedAt } }


// Data en mémoire
let MANUAL_RESERVATIONS = {};    // { [propertyId]: [reservations ou blocages] }
let DEPOSITS = [];               // { id, reservationUid, amountCents, ... }

// ============================================
// FONCTIONS UTILITAIRES FICHIERS
// ============================================

async function loadManualReservations() {
  try {
    const data = await fsp.readFile(MANUAL_RES_FILE, 'utf8');
    const jsonData = JSON.parse(data);
    
    // Fusionner avec les données existantes (de la DB)
    for (const [propId, reservations] of Object.entries(jsonData)) {
      if (!MANUAL_RESERVATIONS[propId]) {
        MANUAL_RESERVATIONS[propId] = [];
      }
      MANUAL_RESERVATIONS[propId].push(...reservations);
    }
    
    console.log('✅ Réservations manuelles chargées depuis manual-reservations.json');
  } catch (error) {
    // NE RIEN FAIRE - garder les données de la DB
    console.log('⚠️  Aucun fichier manual-reservations.json, utilisation des données DB uniquement');
  }
}

async function saveManualReservations() {
  try {
    await fsp.writeFile(MANUAL_RES_FILE, JSON.stringify(MANUAL_RESERVATIONS, null, 2));
    console.log('✅ Réservations manuelles sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des réservations manuelles:', error.message);
  }
}

async function loadDeposits() {
  try {
    const data = await fsp.readFile(DEPOSITS_FILE, 'utf8');
    DEPOSITS = JSON.parse(data);
    console.log('✅ Cautions chargées depuis deposits-config.json');
  } catch (error) {
    DEPOSITS = [];
    console.log('⚠️  Aucun fichier deposits-config.json, démarrage sans cautions');
  }
}

async function saveDeposits() {
  try {
    await fsp.writeFile(DEPOSITS_FILE, JSON.stringify(DEPOSITS, null, 2));
    console.log('✅ Cautions sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des cautions:', error.message);
  }
}

// ============================================
// ✅ CHECKLISTS (V1 - JSON) - Stockage simple, migrable en SQL plus tard
// ============================================

async function loadChecklists() {
  try {
    const data = await fsp.readFile(CHECKLISTS_FILE, 'utf8');
    CHECKLISTS = JSON.parse(data);
    console.log('✅ Checklists chargées depuis checklists.json');
  } catch (e) {
    CHECKLISTS = {};
    console.log('ℹ️ Aucun fichier checklists.json, démarrage sans checklists');
  }
}

async function saveChecklists() {
  try {
    await fsp.writeFile(CHECKLISTS_FILE, JSON.stringify(CHECKLISTS, null, 2));
  } catch (e) {
    console.error('❌ Erreur saveChecklists:', e);
  }
}

function ensureChecklistForReservation({ reservationUid, propertyId, userId }) {
  if (CHECKLISTS[reservationUid]) return CHECKLISTS[reservationUid];

  const nowIso = new Date().toISOString();
  CHECKLISTS[reservationUid] = {
    reservationUid,
    propertyId,
    userId,
    status: 'pending', // pending | in_progress | completed
    tasks: [
      { id: 't1', title: 'Logement prêt (ménage)', completed: false },
      { id: 't2', title: 'Linge propre installé', completed: false },
      { id: 't3', title: 'Accès / clés vérifiés', completed: false },
      { id: 't4', title: "Heure d'arrivée confirmée", completed: false },
      { id: 't5', title: "Message d'arrivée préparé", completed: false },
      { id: 't6', title: 'Message de départ préparé', completed: false },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return CHECKLISTS[reservationUid];
}

function mapChecklistStatusFromChecklist(chk) {
  if (!chk) return 'none';
  if (chk.status === 'completed') return 'complete';
  return 'incomplete';
}

// ============================================
// ✅ RISK ENGINE V1 (opérationnel + usage intensif)
// ============================================

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function hoursBetween(a, b) {
  const da = (a instanceof Date) ? a : new Date(a);
  const db = (b instanceof Date) ? b : new Date(b);
  return (db.getTime() - da.getTime()) / (1000 * 60 * 60);
}

function getNights(startDate, endDate) {
  const s = (startDate instanceof Date) ? startDate : new Date(startDate);
  const e = (endDate instanceof Date) ? endDate : new Date(endDate);
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
}

function isWeekendArrival(startDate) {
  const d = (startDate instanceof Date) ? startDate : new Date(startDate);
  const day = d.getDay(); // 0=dim, 5=ven, 6=sam
  return day === 5 || day === 6;
}

// --- France holidays (fixed + Easter-based) ---
function easterDateUTC(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function addDaysUTC(date, days) { const d = new Date(date.getTime()); d.setUTCDate(d.getUTCDate() + days); return d; }
function ymdUTC(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function franceHolidaysYMD(year) {
  const easter = easterDateUTC(year);
  const easterMon = addDaysUTC(easter, 1);
  const ascension = addDaysUTC(easter, 39);
  const whitMon = addDaysUTC(easter, 50);

  const fixed = [
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`,
    `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
  ];
  return new Set([...fixed, ymdUTC(easterMon), ymdUTC(ascension), ymdUTC(whitMon)]);
}
function isFrenchHolidayOrEve(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const year = d.getUTCFullYear();
  const holidays = franceHolidaysYMD(year);

  const today = ymdUTC(d);
  const tomorrow = ymdUTC(addDaysUTC(new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate())), 1));

  return { isHoliday: holidays.has(today), isHolidayEve: holidays.has(tomorrow) };
}
function isSensitiveDate(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const m = d.getMonth() + 1;
  const da = d.getDate();
  return (m === 10 && da === 31) || (m === 7 && da === 14) || (m === 12 && da === 31) || (m === 1 && da === 1);
}

function parseHour(arrivalTimeStr) {
  if (!arrivalTimeStr) return null;
  const m = String(arrivalTimeStr).match(/(\d{1,2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return Number.isFinite(h) ? h : null;
}

function mapChannelFromReservation(r) {
  if (r?.source && String(r.source).toLowerCase() === 'airbnb') return 'airbnb';
  if (r?.platform && String(r.platform).toLowerCase() === 'direct') return 'direct';
  return 'other';
}

function mapDepositStatusFromDeposit(dep) {
  if (!dep) return 'missing';
  switch (dep.status) {
    case 'pending': return 'created_pending';
    case 'authorized':
    case 'captured':
    case 'released':
      return 'ok';
    default:
      return 'created_pending';
  }
}

function computeRiskV1(input, now = new Date()) {
  const tags = [];
  const channel = input.channel ?? 'other';
  const start = input.startDate;
  const end = input.endDate;

  const hoursUntilArrival = hoursBetween(now, start);
  const nights = getNights(start, end);

  // 1) OPÉRATIONNEL (cap 60)
  let arrivalPts = 0;
  if (hoursUntilArrival <= 24) { arrivalPts = 45; tags.push('Arrivée ≤ 24h'); }
  else if (hoursUntilArrival <= 48) { arrivalPts = 30; tags.push('Arrivée ≤ 48h'); }
  else if (hoursUntilArrival <= 72) { arrivalPts = 20; tags.push('Arrivée ≤ 72h'); }

  let checklistPts = 0;
  if (input.checklistStatus === 'none') { checklistPts = 30; tags.push('Checklist inexistante'); }
  else if (input.checklistStatus === 'incomplete') { checklistPts = 25; tags.push('Checklist incomplète'); }

  const sensitivePts = input.propertySensitive ? 10 : 0;
  if (input.propertySensitive) tags.push('Logement sensible');

  let stayLongPts = 0;
  if (nights >= 14) { stayLongPts = 25; tags.push('Séjour ≥ 14 nuits'); }
  else if (nights >= 7) { stayLongPts = 15; tags.push('Séjour ≥ 7 nuits'); }

  let depositPts = 0;
  if (channel !== 'airbnb') {
    if (input.depositStatus === 'missing') { depositPts = 40; tags.push('Garantie absente'); }
    else if (input.depositStatus === 'created_pending') { depositPts = 20; tags.push('Garantie à valider'); }
  }

  let turnoverPts = 0;
  if (typeof input.turnoverHoursBefore === 'number') {
    if (input.turnoverHoursBefore < 6) { turnoverPts = 20; tags.push('Turnover < 6h'); }
    else if (input.turnoverHoursBefore < 12) { turnoverPts = 10; tags.push('Turnover < 12h'); }
  }

  let lateArrivalPts = 0;
  if (typeof input.expectedCheckinHour === 'number' && input.expectedCheckinHour >= 22) {
    lateArrivalPts = 10; tags.push('Arrivée tardive');
  }

  let staleIcalPts = 0;
  if (input.lastIcalSyncAt) {
    const hSinceSync = hoursBetween(input.lastIcalSyncAt, now);
    if (hSinceSync >= 48) { staleIcalPts = 15; tags.push('Sync iCal > 48h'); }
  }

  const operational = clamp(arrivalPts + checklistPts + sensitivePts + stayLongPts + depositPts + turnoverPts + lateArrivalPts + staleIcalPts, 0, 60);

  // 2) USAGE INTENSIF (cap 40)
  let patternPts = 0;

  if (nights === 1) { patternPts += 20; tags.push('Séjour 1 nuit'); }
  else if (nights === 2) { patternPts += 10; tags.push('Séjour 2 nuits'); }

  if (isWeekendArrival(start)) { patternPts += 15; tags.push('Week-end'); }

  if (input.bookedAt) {
    const hoursBetweenBookingAndArrival = hoursBetween(input.bookedAt, start);
    if (hoursBetweenBookingAndArrival <= 24) { patternPts += 25; tags.push('Réservation < 24h'); }
    else if (hoursBetweenBookingAndArrival <= 72) { patternPts += 15; tags.push('Réservation < 72h'); }
  }

  if (input.propertyType === 'entire') { patternPts += 10; tags.push('Logement entier'); }
  if ((input.capacity ?? 0) >= 4) { patternPts += 10; tags.push('Capacité ≥ 4'); }

  const { isHoliday, isHolidayEve } = isFrenchHolidayOrEve(start);
  if (isHoliday) { patternPts += 20; tags.push('Jour férié'); }
  if (isHolidayEve) { patternPts += 20; tags.push('Veille jour férié'); }
  if (isSensitiveDate(start)) { patternPts += 25; tags.push('Date sensible'); }

  const stayPattern = clamp(patternPts, 0, 40);

  // 3) GLOBAL + couleur
  const score = clamp(operational + stayPattern, 0, 100);
  let level = 'green';
  if (score >= 61) level = 'red';
  else if (score >= 31) level = 'orange';

  const uniqueTags = [...new Set(tags)];
  const label = (level === 'red') ? 'Risque élevé' : (level === 'orange') ? 'À surveiller' : 'OK';
  const summary = uniqueTags.length ? `${label} : ${uniqueTags.join(' + ')}` : label;

  return { score, level, label, summary, tags: uniqueTags, subScores: { operational, stayPattern }, parts: { nights, hoursUntilArrival: Math.round(hoursUntilArrival), channel } };
}



// ============================================
// JWT & UTILISATEURS (Postgres)
// ============================================

function generateToken(user) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return jwt.sign(
    { id: user.id, email: user.email },
    secret,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

// Cherche l'utilisateur en base à partir du token dans Authorization: Bearer
async function getUserFromRequest(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const payload = jwt.verify(token, secret);

    const result = await pool.query(
      `SELECT id, company, first_name, last_name, email, password_hash, created_at, stripe_account_id
       FROM users
       WHERE id = $1`,
      [payload.id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const user = {
      id: row.id,
      company: row.company,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      stripeAccountId: row.stripe_account_id
    };

    return user;
  } catch (err) {
    return null;
  }
}
// ============================================
// MIDDLEWARE D'AUTHENTIFICATION ET ABONNEMENT
// À COPIER-COLLER APRÈS LA FONCTION getUserFromRequest
// ============================================

async function authenticateUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token manquant', code: 'NO_TOKEN' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const payload = jwt.verify(token, secret);

    const result = await pool.query(
      `SELECT id, company, first_name, last_name, email, created_at, stripe_account_id
       FROM users
       WHERE id = $1`,
      [payload.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable', code: 'USER_NOT_FOUND' });
    }

    const row = result.rows[0];
    req.user = {
      id: row.id,
      company: row.company,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      createdAt: row.created_at,
      stripeAccountId: row.stripe_account_id
    };

    next();
  } catch (err) {
    console.error('Erreur authenticateUser:', err);
    return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
  }
}


async function getSubscriptionInfo(req, res, next) {
  try {
    const user = req.user;
    if (!user || !user.id) {
      req.subscription = null;
      return next();
    }

    const result = await pool.query(
      `SELECT status, trial_end_date, plan_type FROM subscriptions WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      req.subscription = null;
      return next();
    }

    const sub = result.rows[0];
    let days = null;
    
    if (sub.status === 'trial') {
      const end = new Date(sub.trial_end_date);
      days = Math.ceil((end - new Date()) / 86400000);
    }

    req.subscription = {
      status: sub.status,
      days_remaining: days,
      plan_type: sub.plan_type
    };

    next();
  } catch (error) {
    console.error('Erreur getSubscriptionInfo:', error);
    req.subscription = null;
    next();
  }
}

// ============================================
// PROPERTIES (logements) - stockées en base
// ============================================

// PROPERTIES est créé par affectation dans loadProperties (variable globale implicite)
async function loadProperties() {
  try {
    const result = await pool.query(`
      SELECT
        id,
        user_id,
        name,
        color,
        ical_urls,
        address,
        arrival_time,
        departure_time,
        deposit_amount,
        photo_url,
        welcome_book_url,
        access_code,
        wifi_name,
        wifi_password,
        access_instructions,
        arrival_message,
        owner_id,
        display_order,
        chat_pin,
        amenities,
        house_rules,
        practical_info,
        auto_responses_enabled
      FROM properties
      ORDER BY display_order ASC, created_at ASC
    `);
    PROPERTIES = result.rows.map(row => {
      // ✅ Parser ical_urls si c'est une string JSON
      let icalUrls = row.ical_urls || [];
      if (typeof icalUrls === 'string') {
        try {
          icalUrls = JSON.parse(icalUrls);
        } catch (e) {
          console.error('❌ Erreur parse ical_urls pour ${row.name}:', e.message);
          icalUrls = [];
        }
      }
      
      return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        color: row.color,
        icalUrls,
        address: row.address,
        arrival_time: row.arrival_time,
        departure_time: row.departure_time,
        deposit_amount: row.deposit_amount,
        photo_url: row.photo_url,
        welcome_book_url: row.welcome_book_url,
        access_code: row.access_code,
        wifi_name: row.wifi_name,
        wifi_password: row.wifi_password,
        access_instructions: row.access_instructions,
        arrival_message: row.arrival_message,
        owner_id: row.owner_id,
        display_order: row.display_order,
        chat_pin: row.chat_pin,
        amenities: row.amenities,
        house_rules: row.house_rules,
        practical_info: row.practical_info,
        auto_responses_enabled: row.auto_responses_enabled
      };
    });
    console.log('✅ PROPERTIES chargées : ${PROPERTIES.length} logements'); 
  } catch (error) {
    console.error('❌ Erreur loadProperties :', error);
    PROPERTIES = [];
  }
}
function getUserProperties(userId) {
  return PROPERTIES.filter(p => p.userId === userId);
}
// ============================================
// CODE COMPLET À AJOUTER DANS server-23.js
// ============================================
// Position : Après la fonction getUserProperties() (ligne ~1619)

// Variable globale pour cache en mémoire (performance)
let RESERVATIONS_CACHE = {}; // { [propertyId]: [reservations] }

/**
 * Charger toutes les réservations depuis PostgreSQL
 */
async function loadReservationsFromDB() {
  try {
    const result = await pool.query(`
      SELECT 
        id, uid, property_id, user_id,
        start_date, end_date,
        guest_name, guest_email, guest_phone,
        source, platform, reservation_type,
        price, currency, status,
        raw_ical_data, notes,
        created_at, updated_at, synced_at
      FROM reservations
      WHERE status != 'cancelled'
      ORDER BY start_date ASC
    `);

    RESERVATIONS_CACHE = {};
    
    result.rows.forEach(row => {
      const reservation = {
        id: row.id,
        uid: row.uid,
        start: row.start_date,
        end: row.end_date,
        guestName: row.guest_name,
        guestEmail: row.guest_email,
        guestPhone: row.guest_phone,
        source: row.source,
        platform: row.platform,
        type: row.reservation_type,
        price: parseFloat(row.price) || 0,
        currency: row.currency,
        status: row.status,
        rawData: row.raw_ical_data,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        syncedAt: row.synced_at
      };

      if (!RESERVATIONS_CACHE[row.property_id]) {
        RESERVATIONS_CACHE[row.property_id] = [];
      }
      RESERVATIONS_CACHE[row.property_id].push(reservation);
    });

    console.log(`✅ Réservations chargées : ${result.rows.length} réservations`);
    
    reservationsStore.properties = RESERVATIONS_CACHE;
    reservationsStore.lastSync = new Date().toISOString();
    
  } catch (error) {
    console.error('❌ Erreur loadReservationsFromDB:', error);
    RESERVATIONS_CACHE = {};
  }
}

/**
 * Sauvegarder une réservation en base
 */
async function saveReservationToDB(reservation, propertyId, userId) {
  try {
    // ✅ Utiliser le userId passé en paramètre
    const realUserId = userId;
    
    // Vérifier si la réservation existe déjà
    const existingResult = await pool.query(
      'SELECT id FROM reservations WHERE uid = $1',
      [reservation.uid]
    );
    
    const isNewReservation = existingResult.rows.length === 0;
    // ✅ AJOUTEZ CES LOGS
console.log(`🔍 DEBUG saveReservationToDB:`);
console.log(`   → UID: ${reservation.uid}`);
console.log(`   → Source: ${reservation.source}`);
console.log(`   → Type: ${reservation.type}`);
console.log(`   → isNewReservation: ${isNewReservation}`);
console.log(`   → realUserId: ${realUserId}`);
    // Insérer ou mettre à jour
    const result = await pool.query(`
      INSERT INTO reservations (
        uid, property_id, user_id,
        start_date, end_date,
        guest_name, guest_email, guest_phone,
        source, platform, reservation_type,
        price, currency, status,
        raw_ical_data, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT (uid) 
      DO UPDATE SET
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        guest_name = EXCLUDED.guest_name,
        source = EXCLUDED.source,
        platform = EXCLUDED.platform,
        price = EXCLUDED.price,
        status = EXCLUDED.status,
        raw_ical_data = EXCLUDED.raw_ical_data,
        synced_at = NOW(),
        updated_at = NOW()
      RETURNING id
    `, [
      reservation.uid,
      propertyId,
      realUserId,
      reservation.start,
      reservation.end,
cleanGuestName(reservation.guestName, reservation.platform || reservation.source),
      reservation.guestEmail || null,
      reservation.guestPhone || null,
      reservation.source || 'MANUEL',
      reservation.platform || 'direct',
      reservation.type || 'manual',
      reservation.price || 0,
      reservation.currency || 'EUR',
      reservation.status || 'confirmed',
      reservation.rawData ? JSON.stringify(reservation.rawData) : null
    ]);

    const reservationId = result.rows[0].id;
   // Verifier si la reservation est dans les 6 prochains mois
const now = new Date();
const sixMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
const reservationStart = new Date(reservation.start);
const isWithinSixMonths = reservationStart >= now && reservationStart <= sixMonthsFromNow;

if (isNewReservation && reservation.source !== 'MANUEL' && reservation.type !== 'manual' && isWithinSixMonths) {
  if (await shouldSendNotification(realUserId, 'notif_new_reservation')) {
  try {
    const propResult = await pool.query(
      'SELECT name FROM properties WHERE id = $1',
      [propertyId]
    );
    
    if (propResult.rows.length > 0) {
      await sendNewReservationNotification(
  realUserId,
  cleanGuestName(reservation.guestName, reservation.platform || reservation.source),  
  propResult.rows[0].name,
  reservation.start,
  reservation.end 
);
      
      console.log(`Notification reservation iCal envoyee pour ${propResult.rows[0].name}`);
    }
    } catch (notifError) {
      console.error('Erreur notification reservation:', notifError.message);
    }
  } // end shouldSendNotification

  // ============================================
  // CREATION AUTOMATIQUE DE CONVERSATION
  // ============================================
  
  // Verifier si une conversation existe deja
  const existingConv = await pool.query(
    `SELECT id FROM conversations 
     WHERE property_id = $1 
     AND reservation_start_date = $2 
     AND platform = $3`,
    [propertyId, reservation.start, reservation.platform || 'direct']
  );

  // Si pas de conversation, en creer une
  if (existingConv.rows.length === 0) {
    const crypto = require('crypto');
    const uniqueToken = crypto.randomBytes(32).toString('hex');
    const photosToken = crypto.randomBytes(32).toString('hex');
    const pinCode = Math.floor(1000 + Math.random() * 9000).toString();
    
    const convResult = await pool.query(
      `INSERT INTO conversations 
      (user_id, property_id, reservation_start_date, reservation_end_date, platform, guest_name, guest_email, pin_code, unique_token, photos_token, is_verified, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, 'pending')
      RETURNING id`,
      [
        realUserId,
        propertyId,
        reservation.start,
        reservation.end,
        reservation.platform || 'direct',
        reservation.guestName || null,
        reservation.guestEmail || null,
        pinCode,
        uniqueToken,
        photosToken
      ]
    );
    
    const conversationId = convResult.rows[0].id;
    
    // Envoyer le message de bienvenue automatique
    if (typeof sendWelcomeMessageForNewReservation === 'function') {
      await sendWelcomeMessageForNewReservation(pool, io, conversationId, propertyId, realUserId);
    }
    
    console.log(`Conversation ${conversationId} creee automatiquement pour reservation ${reservation.uid}`);
  }
} else if (isNewReservation && !isWithinSixMonths) {
  console.log(`Nouvelle reservation pour ${reservation.start} ignoree (au-dela de 6 mois)`);
}

    return true;
  } catch (error) {
    console.error('❌ Erreur saveReservationToDB:', error);
    throw error;
  }
} 

// ============================================
// ✅ FONCTION HELPER POUR DÉMARRER L'ONBOARDING
// ============================================

async function sendWelcomeMessageForNewReservation(pool, io, conversationId, propertyId, userId) {
  try {
    console.log(`🎯 Démarrage de l'onboarding pour conversation ${conversationId}`);
    
    // Démarrer l'onboarding au lieu du message de bienvenue classique
    await startOnboarding(conversationId, pool, io);
    
    console.log(`✅ Onboarding démarré pour conversation ${conversationId}`);
  } catch (error) {
    console.error('❌ Erreur sendWelcomeMessageForNewReservation:', error);
  }
}

// ============================================
// 🤖 MESSAGES AUTOMATIQUES - SYSTÈME CAUTIONS
// ============================================

/**
 * Envoyer un message automatique dans une conversation
 */
async function sendAutomatedMessage(conversationId, message, io) {
  try {
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, is_bot_response)
       VALUES ($1, 'bot', 'Assistant automatique', $2, FALSE, TRUE)
       RETURNING id, conversation_id, sender_type, sender_name, message, is_read, is_bot_response, created_at`,
      [conversationId, message]
    );

    const savedMessage = messageResult.rows[0];

    // Émettre via Socket.io si disponible
    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', savedMessage);
    }

    console.log(`✅ Message automatique envoyé pour conversation ${conversationId}`);
    return savedMessage;
  } catch (error) {
    console.error('❌ Erreur envoi message automatique:', error);
    return null;
  }
}

/**
 * Envoyer demande de caution J-2 pour réservations Booking
 */
async function sendDepositRequestMessages(io) {
  try {
    console.log('🔍 Recherche réservations Booking nécessitant une caution (J-2)...');
    
    // Date J-2 (dans 2 jours)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 2);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Récupérer toutes les conversations arrivant dans 2 jours (Booking uniquement)
    const conversationsResult = await pool.query(`
      SELECT c.*, p.name as property_name, p.deposit_amount, u.stripe_account_id,
             r.uid as reservation_uid
      FROM conversations c
      LEFT JOIN properties p ON p.id = c.property_id
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN reservations r ON r.property_id = c.property_id AND DATE(r.start_date) = DATE(c.reservation_start_date)
      WHERE DATE(c.reservation_start_date) = $1
      AND LOWER(c.platform) = 'booking'
      AND c.status != 'cancelled'
    `, [targetDateStr]);

    const conversations = conversationsResult.rows;
    console.log(`📋 ${conversations.length} réservations Booking dans 2 jours`);

    for (const conv of conversations) {
      // Vérifier si une caution est obligatoire pour ce logement
      if (!conv.deposit_amount || parseFloat(conv.deposit_amount) <= 0) {
        console.log(`⏭️ Pas de caution pour ${conv.property_name}`);
        continue;
      }

      // Vérifier si un lien de caution existe déjà
      const depositResult = await pool.query(
        'SELECT * FROM deposits WHERE reservation_uid = $1 AND user_id = $2',
        [conv.reservation_uid || '', conv.user_id]
      );

      let depositUrl = null;

      if (depositResult.rows.length > 0) {
        const deposit = depositResult.rows[0];
        
        // Si déjà payé, skip
        if (deposit.status === 'paid') {
          console.log(`✅ Caution déjà payée pour ${conv.guest_name}`);
          continue;
        }

        depositUrl = deposit.checkout_url;
      } else {
        // Créer automatiquement le lien de caution
        console.log(`🔗 Création automatique lien caution pour ${conv.guest_name}`);
        
        const depositId = 'dep_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const amountCents = Math.round(parseFloat(conv.deposit_amount) * 100);

        const appUrl = (process.env.APP_URL || 'https://lcc-booking-manager.onrender.com').replace(/\/$/, '');
        
        const sessionParams = {
          payment_method_types: ['card'],
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'eur',
              unit_amount: amountCents,
              product_data: {
                name: `Caution - ${conv.property_name}`,
                description: `Réservation du ${conv.reservation_start_date} au ${conv.reservation_end_date}`
              }
            },
            quantity: 1
          }],
          payment_intent_data: {
            capture_method: 'manual',
            metadata: {
              deposit_id: depositId,
              reservation_uid: conv.reservation_uid || ''
            }
          },
          metadata: {
            deposit_id: depositId,
            reservation_uid: conv.reservation_uid || '',
            user_id: conv.user_id
          },
          success_url: `${appUrl}/caution-success.html?depositId=${depositId}`,
          cancel_url: `${appUrl}/caution-cancel.html?depositId=${depositId}`
        };

        let session;
        if (conv.stripe_account_id) {
          session = await stripe.checkout.sessions.create(sessionParams, { stripeAccount: conv.stripe_account_id });
        } else {
          session = await stripe.checkout.sessions.create(sessionParams);
        }

        // Sauvegarder en DB
        await pool.query(`
          INSERT INTO deposits (id, user_id, reservation_uid, property_id, amount_cents, status, stripe_session_id, checkout_url, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW(), NOW())
        `, [depositId, conv.user_id, conv.reservation_uid || '', conv.property_id, amountCents, session.id, session.url]);

        depositUrl = session.url;
      }

      // Envoyer le message avec le lien
      const message = `Bonjour ! 👋

Votre séjour approche ! Pour finaliser votre réservation, merci de régler la caution de sécurité via ce lien :

${depositUrl}

Une fois la caution validée, vous recevrez toutes vos informations d'accès.

À bientôt ! 😊`;

      await sendAutomatedMessage(conv.id, message, io);
    }

    console.log('✅ Demandes de caution envoyées');
  } catch (error) {
    console.error('❌ Erreur sendDepositRequestMessages:', error);
  }
}

/**
 * Envoyer informations d'accès le jour J à 7h
 */
async function sendArrivalInfoMessages(io) {
  try {
    console.log('🔍 Recherche arrivées du jour pour envoi infos d\'accès...');
    
    // Date du jour
    const today = new Date().toISOString().split('T')[0];

    // Récupérer toutes les conversations arrivant aujourd'hui
    const conversationsResult = await pool.query(`
      SELECT c.*, p.name as property_name, p.deposit_amount, p.welcome_book_url,
             r.uid as reservation_uid
      FROM conversations c
      LEFT JOIN properties p ON p.id = c.property_id
      LEFT JOIN reservations r ON r.property_id = c.property_id AND DATE(r.start_date) = DATE(c.reservation_start_date)
      WHERE DATE(c.reservation_start_date) = $1
      AND c.status != 'cancelled'
    `, [today]);

    const conversations = conversationsResult.rows;
    console.log(`📋 ${conversations.length} arrivées aujourd'hui`);

    for (const conv of conversations) {
      const platform = (conv.platform || '').toLowerCase();
      const isAirbnb = platform.includes('airbnb');
      const needsDeposit = !isAirbnb && conv.deposit_amount && parseFloat(conv.deposit_amount) > 0;

      // Si pas Airbnb + caution obligatoire, vérifier si autorisée
      if (needsDeposit) {
        const depositResult = await pool.query(
          'SELECT status FROM deposits WHERE reservation_uid = $1 AND user_id = $2',
          [conv.reservation_uid || '', conv.user_id]
        );

        const depositStatus = depositResult.rows[0]?.status;
        if (!depositStatus || !['authorized', 'captured', 'paid'].includes(depositStatus)) {
          console.log(`⏸️ Caution non autorisée pour ${conv.guest_name} (status: ${depositStatus || 'aucune'}), pas d'envoi infos`);
          
          // Envoyer un rappel
          const depositCheck = await pool.query(
            'SELECT checkout_url FROM deposits WHERE reservation_uid = $1 AND user_id = $2',
            [conv.reservation_uid || '', conv.user_id]
          );

          if (depositCheck.rows.length > 0) {
            const reminderMessage = `Bonjour ! 👋

C'est aujourd'hui votre jour d'arrivée ! 

Pour recevoir vos informations d'accès, merci de finaliser le règlement de votre caution de sécurité :

${depositCheck.rows[0].checkout_url}

À très vite ! 😊`;

            await sendAutomatedMessage(conv.id, reminderMessage, io);
          }
          
          continue;
        }
      }

      // Envoyer les infos d'accès
      let message = `Bonjour ! 🎉

Bienvenue ! Vous pouvez dès à présent consulter votre livret d'accueil qui contient toutes les informations pratiques (code d'accès, wifi, instructions...) :`;

      if (conv.welcome_book_url) {
        message += `\n\n${conv.welcome_book_url}`;
      } else {
        message += `\n\n(Le livret d'accueil sera bientôt disponible)`;
      }

      message += `\n\nTrès bon séjour ! ✨`;

      await sendAutomatedMessage(conv.id, message, io);
    }

    console.log('✅ Infos d\'accès envoyées');
  } catch (error) {
    console.error('❌ Erreur sendArrivalInfoMessages:', error);
  }
}

/**
 * Gérer l'envoi automatique quand une caution est payée
 */
async function handleDepositPaid(depositId, io) {
  try {
    console.log(`💰 Caution payée : ${depositId}, vérification envoi infos d'arrivée...`);

    // Récupérer le deposit
    const depositResult = await pool.query(
      'SELECT * FROM deposits WHERE id = $1',
      [depositId]
    );

    if (depositResult.rows.length === 0) return;

    const deposit = depositResult.rows[0];

    // Récupérer la conversation liée (par property_id + date de réservation)
    let conv = null;
    
    // Récupérer la date de début depuis la réservation
    if (deposit.reservation_uid) {
      const resResult = await pool.query(
        'SELECT start_date, end_date FROM reservations WHERE uid = $1',
        [deposit.reservation_uid]
      );
      
      if (resResult.rows.length > 0) {
        const startDate = resResult.rows[0].start_date;
        
        const convResult = await pool.query(`
          SELECT c.*, p.name as property_name
          FROM conversations c
          LEFT JOIN properties p ON p.id = c.property_id
          WHERE c.property_id = $1 AND DATE(c.reservation_start_date) = DATE($2) AND c.user_id = $3
          ORDER BY c.created_at DESC LIMIT 1
        `, [deposit.property_id, startDate, deposit.user_id]);
        conv = convResult.rows[0] || null;
      }
    }
    
    // Fallback : par property_id seul (dernier en date)
    if (!conv && deposit.property_id) {
      const convResult = await pool.query(`
        SELECT c.*, p.name as property_name
        FROM conversations c
        LEFT JOIN properties p ON p.id = c.property_id
        WHERE c.property_id = $1 AND c.user_id = $2
        ORDER BY c.created_at DESC LIMIT 1
      `, [deposit.property_id, deposit.user_id]);
      conv = convResult.rows[0] || null;
    }

    if (!conv) {
      console.log(`⚠️ Conversation introuvable pour caution ${depositId}`);
      return;
    }

    // Vérifier si c'est le jour J et après 7h (heure Paris)
    const now = new Date();
    const nowParis = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const currentHour = nowParis.getHours();
    
    const todayParis = new Date(nowParis);
    todayParis.setHours(0, 0, 0, 0);
    
    const arrivalDate = new Date(conv.reservation_start_date);
    arrivalDate.setHours(0, 0, 0, 0);
    
    const isArrivalToday = arrivalDate.getTime() === todayParis.getTime();
    const isAfter7am = currentHour >= 7;

    if (isArrivalToday && isAfter7am) {
      // ✅ Jour J après 7h → envoyer les infos d'arrivée immédiatement
      console.log(`📨 Jour J après 7h → envoi immédiat des infos d'arrivée pour conversation ${conv.id}`);
      try {
        const { sendImmediateArrivalMessage } = require('./arrival-messages-scheduler');
        await sendImmediateArrivalMessage(pool, io, conv.id);
      } catch (arrErr) {
        console.error('⚠️ Erreur sendImmediateArrivalMessage:', arrErr);
      }
    } else if (isArrivalToday && !isAfter7am) {
      console.log(`⏰ Jour J mais ${currentHour}h < 7h → le cron enverra les infos à 7h`);
    } else {
      console.log(`📅 Arrivée pas aujourd'hui → le cron enverra le jour J à 7h`);
    }

  } catch (error) {
    console.error('❌ Erreur handleDepositPaid:', error);
  }
}

/**
 * Sauvegarder toutes les réservations d'une propriété (après synchro iCal)
 */
async function savePropertyReservations(propertyId, reservations, userId) {
  try {
    for (const reservation of reservations) {
      await saveReservationToDB(reservation, propertyId, userId);
    }
    console.log(`✅ ${reservations.length} réservations sauvegardées pour ${propertyId}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur savePropertyReservations:', error);
    return false;
  }
}
/**
 * Supprimer une réservation (soft delete)
 */
async function deleteReservationFromDB(uid) {
  try {
    await pool.query(`
      UPDATE reservations 
      SET status = 'cancelled', updated_at = NOW()
      WHERE uid = $1
    `, [uid]);
    return true;
  } catch (error) {
    console.error('❌ Erreur deleteReservationFromDB:', error);
    return false;
  }
}

/**
 * Récupérer les réservations d'un utilisateur
 */
async function getUserReservations(userId, filters = {}) {
  try {
    let query = `
      SELECT 
        r.id, r.uid, r.property_id, r.start_date, r.end_date, 
        r.platform, r.source, r.status, r.number_of_guests,
        r.guest_email, r.notes, r.created_at, r.updated_at, r.user_id,
        
        COALESCE(
          NULLIF(TRIM(c.guest_first_name || ' ' || c.guest_last_name), ''),
          r.guest_name,
          'Voyageur ' || COALESCE(r.source, 'direct')
        ) as guest_name,
        
        COALESCE(c.guest_phone, r.guest_phone) as guest_phone,
        
        CASE 
          WHEN c.guest_first_name IS NOT NULL 
          THEN LEFT(UPPER(c.guest_first_name), 1)
          WHEN r.guest_name IS NOT NULL AND r.guest_name != ''
          THEN LEFT(UPPER(r.guest_name), 1)
          ELSE 'V'
        END as guest_initial,
        
        c.language as guest_language,
        c.onboarding_completed,
        c.id as conversation_id,
        
        p.name as property_name,
        p.address as property_address,
        p.color as property_color
      FROM reservations r
      JOIN properties p ON r.property_id = p.id
      LEFT JOIN conversations c ON (
        c.property_id = r.property_id 
        AND DATE(c.reservation_start_date) = DATE(r.start_date)
        AND LOWER(c.platform) = LOWER(r.source)
      )
      WHERE r.user_id = $1
      AND r.status != 'cancelled'
    `;
    
    const params = [userId];
    let paramCount = 1;

    if (filters.propertyId) {
      paramCount++;
      query += ` AND r.property_id = $${paramCount}`;
      params.push(filters.propertyId);
    }

    if (filters.startDate) {
      paramCount++;
      query += ` AND r.end_date >= $${paramCount}`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      paramCount++;
      query += ` AND r.start_date <= $${paramCount}`;
      params.push(filters.endDate);
    }

    query += ` ORDER BY r.start_date ASC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('❌ Erreur getUserReservations:', error);
    return [];
  }
}

/**
 * Migrer les réservations du JSON vers PostgreSQL (une seule fois)
 */
async function migrateManualReservationsToPostgres() {
  try {
    console.log('🔄 Migration des réservations manuelles vers PostgreSQL...');
    
    let migratedCount = 0;
    
    for (const [propertyId, reservations] of Object.entries(MANUAL_RESERVATIONS)) {
      const property = PROPERTIES.find(p => p.id === propertyId);
      if (!property) {
        console.log(`⚠️  Propriété ${propertyId} introuvable, skip`);
        continue;
      }

      for (const reservation of reservations) {
        const success = await saveReservationToDB(reservation, propertyId, property.userId);
        if (success) migratedCount++;
      }
    }

    console.log(`✅ Migration terminée : ${migratedCount} réservations migrées`);
    
    // Backup du fichier JSON
    const backupFile = MANUAL_RES_FILE.replace('.json', '.backup.json');
    await fsp.rename(MANUAL_RES_FILE, backupFile);
    console.log(`📦 Backup créé : ${backupFile}`);
    
  } catch (error) {
    console.error('❌ Erreur migration:', error);
  }
}

/**
 * Nouvelle fonction de synchronisation iCal avec sauvegarde en base
 */
async function syncCalendarAndSaveToPostgres(property) {
  try {
    const reservations = await icalService.fetchAllReservations(property.icalUrls || []);
    
    // Sauvegarder en PostgreSQL
    await savePropertyReservations(property.id, reservations, property.userId);
    
    // Marquer les réservations passées comme "completed"
    const now = new Date();
    await pool.query(
      `UPDATE reservations 
       SET status = 'completed', updated_at = NOW()
       WHERE property_id = $1 
       AND end_date < $2 
       AND status = 'confirmed'`,
      [property.id, now]
    );

    // ✅ CORRECTION : Récupérer les réservations 'completed' depuis PostgreSQL
    const completedResult = await pool.query(
      `SELECT 
        id, uid, property_id, user_id,
        start_date, end_date,
        guest_name, guest_email, guest_phone,
        source, platform, reservation_type,
        price, currency, status,
        raw_ical_data, notes,
        created_at, updated_at, synced_at
       FROM reservations
       WHERE property_id = $1 
       AND status = 'completed'
       AND source != 'MANUEL'
       AND reservation_type != 'manual'
       ORDER BY start_date ASC`,
      [property.id]
    );

    const completedReservations = completedResult.rows.map(row => ({
      id: row.id,
      uid: row.uid,
      start: row.start_date,
      end: row.end_date,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      guestPhone: row.guest_phone,
      source: row.source,
      platform: row.platform,
      type: row.reservation_type,
      price: parseFloat(row.price) || 0,
      currency: row.currency,
      status: row.status,
      rawData: row.raw_ical_data,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      syncedAt: row.synced_at
    }));
    
    // ✅ Mettre à jour le cache avec iCal actuel + historique completed
    const allReservations = [
      ...reservations,
      ...completedReservations
    ];
    
    RESERVATIONS_CACHE[property.id] = allReservations;
    reservationsStore.properties[property.id] = allReservations;
    
    return allReservations;
  } catch (error) {
    console.error(`❌ Erreur synchro ${property.name}:`, error);
    return [];
  }
}
// ============================================
// GESTION DES DEPOSITS (CAUTIONS) EN POSTGRESQL
// ============================================
// À ajouter dans server-23.js après les fonctions des réservations

// Variable globale pour cache en mémoire
let DEPOSITS_CACHE = {}; // { [reservationUid]: deposit }

/**
 * Charger tous les deposits depuis PostgreSQL
 */
async function loadDepositsFromDB() {
  try {
    const result = await pool.query(`
      SELECT 
        id, user_id, reservation_uid, property_id,
        amount_cents, currency,
        stripe_session_id, stripe_payment_intent_id,
        checkout_url, status,
        authorized_at, captured_at, released_at, cancelled_at,
        notes, metadata,
        created_at, updated_at
      FROM deposits
      ORDER BY created_at DESC
    `);

    // Reconstruire DEPOSITS pour compatibilité avec le code existant
    DEPOSITS = result.rows.map(row => ({
      id: row.id,
      reservationUid: row.reservation_uid,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      stripeSessionId: row.stripe_session_id,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      checkoutUrl: row.checkout_url,
      authorizedAt: row.authorized_at,
      capturedAt: row.captured_at,
      releasedAt: row.released_at,
      cancelledAt: row.cancelled_at,
      notes: row.notes,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    // Créer un cache indexé par reservation_uid
    DEPOSITS_CACHE = {};
    result.rows.forEach(row => {
      DEPOSITS_CACHE[row.reservation_uid] = row;
    });

    console.log(`✅ Deposits chargés : ${result.rows.length} cautions`);
    
  } catch (error) {
    console.error('❌ Erreur loadDepositsFromDB:', error);
    DEPOSITS = [];
    DEPOSITS_CACHE = {};
  }
}

/**
 * Sauvegarder un deposit en base
 */
async function saveDepositToDB(deposit, userId, propertyId = null) {
  try {
    console.log('🔍 Tentative de sauvegarde deposit:', {
      depositId: deposit.id,
      userId: userId,
      reservationUid: deposit.reservationUid,
      propertyId: propertyId,
      amountCents: deposit.amountCents
    });

    await pool.query(`
      INSERT INTO deposits (
        id, user_id, reservation_uid, property_id,
        amount_cents, currency,
        stripe_session_id, stripe_payment_intent_id,
        checkout_url, status,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) 
      DO UPDATE SET
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
        status = EXCLUDED.status,
        checkout_url = EXCLUDED.checkout_url,
        updated_at = NOW()
    `, [
      deposit.id,
      userId,
      deposit.reservationUid,
      propertyId,
      deposit.amountCents,
      deposit.currency || 'eur',
      deposit.stripeSessionId || null,
      deposit.stripePaymentIntentId || null,
      deposit.checkoutUrl || null,
      deposit.status || 'pending',
      deposit.metadata ? JSON.stringify(deposit.metadata) : null
    ]);

    console.log(`✅ Deposit ${deposit.id} sauvegardé en PostgreSQL`);
    return true;
  } catch (error) {
    console.error('❌ Erreur saveDepositToDB DÉTAILLÉE:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      table: error.table,
      column: error.column,
      fullError: error
    });
    return false;
  }
}

/**
 * Créer la table payments si elle n'existe pas
 */
async function ensurePaymentsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(255) PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reservation_uid VARCHAR(255) NOT NULL,
        property_id VARCHAR(255),
        amount_cents INTEGER NOT NULL,
        platform_fee_cents INTEGER DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'eur',
        stripe_session_id VARCHAR(255),
        stripe_payment_intent_id VARCHAR(255),
        checkout_url TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_uid)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)
    `);
    
    console.log('✅ Table payments vérifiée/créée');
    return true;
  } catch (error) {
    console.error('❌ Erreur création table payments:', error);
    return false;
  }
}

/**
 * Sauvegarder un payment en base
 */
async function savePaymentToDB(payment, userId, propertyId = null) {
  try {
    console.log('🔍 Tentative de sauvegarde payment:', {
      paymentId: payment.id,
      userId: userId,
      reservationUid: payment.reservationUid,
      propertyId: propertyId,
      amountCents: payment.amountCents
    });

    await pool.query(`
      INSERT INTO payments (
        id, user_id, reservation_uid, property_id,
        amount_cents, platform_fee_cents, currency,
        stripe_session_id, stripe_payment_intent_id,
        checkout_url, status,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) 
      DO UPDATE SET
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
        status = EXCLUDED.status,
        checkout_url = EXCLUDED.checkout_url,
        updated_at = NOW()
    `, [
      payment.id,
      userId,
      payment.reservationUid,
      propertyId,
      payment.amountCents,
      payment.platformFeeCents || 0,
      payment.currency || 'eur',
      payment.stripeSessionId || null,
      payment.stripePaymentIntentId || null,
      payment.checkoutUrl || null,
      payment.status || 'pending',
      payment.metadata ? JSON.stringify(payment.metadata) : null
    ]);

    console.log(`✅ Payment ${payment.id} sauvegardé en PostgreSQL`);
    return true;
  } catch (error) {
    console.error('❌ Erreur savePaymentToDB:', error);
    return false;
  }
}

/**
 * Mettre à jour le statut d'un deposit
 */
async function updateDepositStatus(depositId, status, additionalData = {}) {
  try {
    const updates = ['status = $2', 'updated_at = NOW()'];
    const params = [depositId, status];
    let paramCount = 2;

    if (status === 'authorized' && !additionalData.authorized_at) {
      paramCount++;
      updates.push(`authorized_at = $${paramCount}`);
      params.push(new Date());
    }

    if (status === 'captured' && !additionalData.captured_at) {
      paramCount++;
      updates.push(`captured_at = $${paramCount}`);
      params.push(new Date());
    }

    if (status === 'released' && !additionalData.released_at) {
      paramCount++;
      updates.push(`released_at = $${paramCount}`);
      params.push(new Date());
    }

    if (status === 'cancelled' && !additionalData.cancelled_at) {
      paramCount++;
      updates.push(`cancelled_at = $${paramCount}`);
      params.push(new Date());
    }

    if (additionalData.stripePaymentIntentId) {
      paramCount++;
      updates.push(`stripe_payment_intent_id = $${paramCount}`);
      params.push(additionalData.stripePaymentIntentId);
    }

    const query = `UPDATE deposits SET ${updates.join(', ')} WHERE id = $1`;
    
    await pool.query(query, params);

    console.log(`✅ Deposit ${depositId} mis à jour : ${status}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur updateDepositStatus:', error);
    return false;
  }
}

/**
 * Récupérer un deposit par reservation_uid
 */
async function getDepositByReservation(reservationUid) {
  try {
    const result = await pool.query(`
      SELECT * FROM deposits WHERE reservation_uid = $1 LIMIT 1
    `, [reservationUid]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('❌ Erreur getDepositByReservation:', error);
    return null;
  }
}

/**
 * Récupérer tous les deposits d'un utilisateur
 */
async function getUserDeposits(userId, filters = {}) {
  try {
    let query = `
      SELECT 
        d.*,
        r.guest_name,
        r.start_date,
        r.end_date,
        p.name as property_name
      FROM deposits d
      LEFT JOIN reservations r ON d.reservation_uid = r.uid
      LEFT JOIN properties p ON d.property_id = p.id
      WHERE d.user_id = $1
    `;
    
    const params = [userId];
    let paramCount = 1;

    if (filters.status) {
      paramCount++;
      query += ` AND d.status = $${paramCount}`;
      params.push(filters.status);
    }

    if (filters.propertyId) {
      paramCount++;
      query += ` AND d.property_id = $${paramCount}`;
      params.push(filters.propertyId);
    }

    query += ` ORDER BY d.created_at DESC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('❌ Erreur getUserDeposits:', error);
    return [];
  }
}

/**
 * Migrer les deposits du JSON vers PostgreSQL (une seule fois)
 */
async function migrateDepositsToPostgres() {
  try {
    console.log('🔄 Migration des deposits vers PostgreSQL...');
    
    let migratedCount = 0;
    
    for (const deposit of DEPOSITS) {
      // Trouver la réservation pour récupérer user_id et property_id
      const reservation = await pool.query(`
        SELECT user_id, property_id FROM reservations WHERE uid = $1
      `, [deposit.reservationUid]);

      if (reservation.rows.length === 0) {
        console.log(`⚠️  Réservation ${deposit.reservationUid} introuvable pour deposit ${deposit.id}`);
        continue;
      }

      const { user_id, property_id } = reservation.rows[0];
      
      const success = await saveDepositToDB(deposit, user_id, property_id);
      if (success) migratedCount++;
    }

    console.log(`✅ Migration terminée : ${migratedCount} deposits migrés`);
    
    // Backup du fichier JSON
    const backupFile = DEPOSITS_FILE.replace('.json', '.backup.json');
    await fsp.rename(DEPOSITS_FILE, backupFile);
    console.log(`📦 Backup créé : ${backupFile}`);
    
  } catch (error) {
    console.error('❌ Erreur migration deposits:', error);
  }
}

/**
 * Capturer une caution (débiter le client)
 */
async function captureDeposit(depositId, amountCents = null) {
  try {
    const deposit = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
    
    if (deposit.rows.length === 0) {
      throw new Error('Deposit introuvable');
    }

    const depositData = deposit.rows[0];
    
    if (!depositData.stripe_payment_intent_id) {
      throw new Error('Pas de Payment Intent associé');
    }

    // Capturer via Stripe
    const capture = await stripe.paymentIntents.capture(
      depositData.stripe_payment_intent_id,
      amountCents ? { amount_to_capture: amountCents } : {}
    );

    // Mettre à jour en base
    await updateDepositStatus(depositId, 'captured', {
      stripeChargeId: capture.charges.data[0]?.id
    });

    return true;
  } catch (error) {
    console.error('❌ Erreur captureDeposit:', error);
    return false;
  }
}

/**
 * Libérer une caution (annuler l'autorisation)
 */
async function releaseDeposit(depositId) {
  try {
    const deposit = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
    
    if (deposit.rows.length === 0) {
      throw new Error('Deposit introuvable');
    }

    const depositData = deposit.rows[0];
    
    // CAS 1 : Caution AVEC Stripe Payment Intent
    if (depositData.stripe_payment_intent_id) {
      console.log(`Liberation caution Stripe ${depositId}`);
      
      // Si la caution a ete capturee, il faut faire un REFUND
      if (depositData.status === 'captured' || depositData.status === 'paid') {
        console.log(`Creation refund pour ${depositData.stripe_payment_intent_id}`);
        
        const refund = await stripe.refunds.create({
          payment_intent: depositData.stripe_payment_intent_id,
        });
        
        console.log(`Refund cree : ${refund.id}`);
        
      } else if (depositData.status === 'authorized') {
        // Si la caution est seulement autorisee, on peut annuler
        console.log(`Annulation Payment Intent ${depositData.stripe_payment_intent_id}`);
        await stripe.paymentIntents.cancel(depositData.stripe_payment_intent_id);
      }
    } 
    // CAS 2 : Caution MANUELLE (sans Stripe)
    else {
      console.log(`Liberation caution manuelle ${depositId} (pas de Stripe Payment Intent)`);
    }

    // Mettre a jour en base (dans tous les cas)
    await updateDepositStatus(depositId, 'released');
    
    console.log(`Caution ${depositId} liberee avec succes`);
    return true;
    
  } catch (error) {
    console.error('Erreur releaseDeposit:', error);
    console.error('Stack:', error.stack);
    return false;
  }
}
// ============================================
// GESTION DES CHECKLISTS EN POSTGRESQL
// ============================================
// À ajouter dans server-23.js après les fonctions des deposits

/**
 * Créer une checklist
 */
async function createChecklist(userId, data) {
  try {
    const {
      propertyId,
      reservationUid,
      checklistType,
      title,
      tasks,
      dueDate,
      assignedTo,
      assignedToName
    } = data;

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const result = await pool.query(`
      INSERT INTO checklists (
        user_id, property_id, reservation_uid,
        checklist_type, title, tasks,
        total_tasks, completed_tasks, progress_percentage,
        assigned_to, assigned_to_name,
        due_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      userId,
      propertyId,
      reservationUid || null,
      checklistType,
      title,
      JSON.stringify(tasks),
      totalTasks,
      completedTasks,
      progressPercentage,
      assignedTo || null,
      assignedToName || null,
      dueDate || null,
      'pending'
    ]);

    console.log(`✅ Checklist créée : ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Erreur createChecklist:', error);
    return null;
  }
}

/**
 * Mettre à jour une tâche dans une checklist
 */
async function updateChecklistTask(checklistId, taskId, updates) {
  try {
    // Récupérer la checklist
    const checklist = await pool.query(
      'SELECT * FROM checklists WHERE id = $1',
      [checklistId]
    );

    if (checklist.rows.length === 0) {
      throw new Error('Checklist introuvable');
    }

    const tasks = checklist.rows[0].tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
      throw new Error('Tâche introuvable');
    }

    // Mettre à jour la tâche
    tasks[taskIndex] = {
      ...tasks[taskIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // Recalculer la progression
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Déterminer le statut
    let status = checklist.rows[0].status;
    if (completedTasks === 0) {
      status = 'pending';
    } else if (completedTasks === totalTasks) {
      status = 'completed';
    } else {
      status = 'in_progress';
    }

    // Sauvegarder
    const result = await pool.query(`
      UPDATE checklists 
      SET 
        tasks = $1,
        completed_tasks = $2,
        progress_percentage = $3,
        status = $4,
        completed_at = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [
      JSON.stringify(tasks),
      completedTasks,
      progressPercentage,
      status,
      status === 'completed' ? new Date() : null,
      checklistId
    ]);

    console.log(`✅ Tâche mise à jour : ${taskId} dans checklist ${checklistId}`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Erreur updateChecklistTask:', error);
    return null;
  }
}

/**
 * Récupérer les checklists d'un utilisateur
 */
async function getUserChecklists(userId, filters = {}) {
  try {
    let query = `
      SELECT 
        c.*,
        p.name as property_name,
        r.start_date,
        r.end_date,
        
        COALESCE(
          NULLIF(TRIM(conv.guest_first_name || ' ' || conv.guest_last_name), ''),
          r.guest_name,
          'Voyageur'
        ) as guest_name,
        
        CASE 
          WHEN conv.guest_first_name IS NOT NULL 
          THEN LEFT(UPPER(conv.guest_first_name), 1)
          ELSE 'V'
        END as guest_initial
        
      FROM checklists c
      JOIN properties p ON c.property_id = p.id
      LEFT JOIN reservations r ON c.reservation_uid = r.uid
      LEFT JOIN conversations conv ON (
        conv.property_id = r.property_id 
        AND DATE(conv.reservation_start_date) = DATE(r.start_date)
        AND LOWER(conv.platform) = LOWER(r.source)
      )
      WHERE c.user_id = $1
    `;
    
    const params = [userId];
    let paramCount = 1;

    if (filters.propertyId) {
      paramCount++;
      query += ` AND c.property_id = $${paramCount}`;
      params.push(filters.propertyId);
    }

    if (filters.status) {
      paramCount++;
      query += ` AND c.status = $${paramCount}`;
      params.push(filters.status);
    }

    if (filters.checklistType) {
      paramCount++;
      query += ` AND c.checklist_type = $${paramCount}`;
      params.push(filters.checklistType);
    }

    if (filters.reservationUid) {
      paramCount++;
      query += ` AND c.reservation_uid = $${paramCount}`;
      params.push(filters.reservationUid);
    }

    query += ` ORDER BY c.due_date ASC NULLS LAST, c.created_at DESC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('❌ Erreur getUserChecklists:', error);
    return [];
  }
}

/**
 * Récupérer une checklist par ID
 */
async function getChecklistById(checklistId, userId) {
  try {
    const result = await pool.query(`
      SELECT 
        c.*,
        p.name as property_name,
        r.start_date,
        r.end_date,
        
        COALESCE(
          NULLIF(TRIM(conv.guest_first_name || ' ' || conv.guest_last_name), ''),
          r.guest_name,
          'Voyageur'
        ) as guest_name,
        
        CASE 
          WHEN conv.guest_first_name IS NOT NULL 
          THEN LEFT(UPPER(conv.guest_first_name), 1)
          ELSE 'V'
        END as guest_initial
        
      FROM checklists c
      JOIN properties p ON c.property_id = p.id
      LEFT JOIN reservations r ON c.reservation_uid = r.uid
      LEFT JOIN conversations conv ON (
        conv.property_id = r.property_id 
        AND DATE(conv.reservation_start_date) = DATE(r.start_date)
        AND LOWER(conv.platform) = LOWER(r.source)
      )
      WHERE c.id = $1 AND c.user_id = $2
    `, [checklistId, userId]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('❌ Erreur getChecklistById:', error);
    return null;
  }
}

/**
 * Supprimer une checklist
 */
async function deleteChecklist(checklistId, userId) {
  try {
    await pool.query(
      'DELETE FROM checklists WHERE id = $1 AND user_id = $2',
      [checklistId, userId]
    );
    
    console.log(`✅ Checklist supprimée : ${checklistId}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur deleteChecklist:', error);
    return false;
  }
}

/**
 * Créer un template de checklist
 */
async function createChecklistTemplate(userId, data) {
  try {
    const { propertyId, name, checklistType, tasks } = data;

    const result = await pool.query(`
      INSERT INTO checklist_templates (
        user_id, property_id, name, checklist_type, tasks
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      userId,
      propertyId || null,
      name,
      checklistType,
      JSON.stringify(tasks)
    ]);

    console.log(`✅ Template créé : ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Erreur createChecklistTemplate:', error);
    return null;
  }
}

/**
 * Récupérer les templates d'un utilisateur
 */
async function getUserChecklistTemplates(userId, filters = {}) {
  try {
    let query = `
      SELECT * FROM checklist_templates
      WHERE user_id = $1 AND is_active = true
    `;
    
    const params = [userId];
    let paramCount = 1;

    if (filters.propertyId) {
      paramCount++;
      query += ` AND (property_id = $${paramCount} OR property_id IS NULL)`;
      params.push(filters.propertyId);
    }

    if (filters.checklistType) {
      paramCount++;
      query += ` AND checklist_type = $${paramCount}`;
    }

    query += ` ORDER BY name ASC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('❌ Erreur getUserChecklistTemplates:', error);
    return [];
  }
}

/**
 * Créer une checklist depuis un template
 */
async function createChecklistFromTemplate(userId, templateId, data) {
  try {
    // Récupérer le template
    const template = await pool.query(
      'SELECT * FROM checklist_templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );

    if (template.rows.length === 0) {
      throw new Error('Template introuvable');
    }

    const templateData = template.rows[0];
    
    // Générer des IDs uniques pour les tâches
    const tasks = templateData.tasks.map(task => ({
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      completed: false,
      completedAt: null,
      completedBy: null
    }));

    // Créer la checklist
    return await createChecklist(userId, {
      propertyId: data.propertyId,
      reservationUid: data.reservationUid,
      checklistType: templateData.checklist_type,
      title: data.title || templateData.name,
      tasks,
      dueDate: data.dueDate,
      assignedTo: data.assignedTo,
      assignedToName: data.assignedToName
    });
  } catch (error) {
    console.error('❌ Erreur createChecklistFromTemplate:', error);
    return null;
  }
}

/**
 * Générer automatiquement des checklists pour une réservation
 */
async function generateChecklistsForReservation(userId, reservationUid) {
  try {
    // Récupérer la réservation
    const reservation = await pool.query(
      'SELECT * FROM reservations WHERE uid = $1 AND user_id = $2',
      [reservationUid, userId]
    );

    if (reservation.rows.length === 0) {
      throw new Error('Réservation introuvable');
    }

    const res = reservation.rows[0];
    
    const checklists = [];

    // Checklist d'arrivée (J-1)
    const arrivalDueDate = new Date(res.start_date);
    arrivalDueDate.setDate(arrivalDueDate.getDate() - 1);

    const arrivalChecklist = await createChecklist(userId, {
      propertyId: res.property_id,
      reservationUid,
      checklistType: 'arrival',
      title: `Préparation arrivée - ${res.guest_name || 'Client'}`,
      tasks: [
        { id: 'task_1', title: 'Vérifier le ménage', completed: false },
        { id: 'task_2', title: 'Vérifier les équipements', completed: false },
        { id: 'task_3', title: 'Préparer les clés/accès', completed: false },
        { id: 'task_4', title: 'Vérifier les consommables', completed: false }
      ],
      dueDate: arrivalDueDate
    });

    if (arrivalChecklist) checklists.push(arrivalChecklist);

    // Checklist de départ (jour du départ)
    const departureChecklist = await createChecklist(userId, {
      propertyId: res.property_id,
      reservationUid,
      checklistType: 'departure',
      title: `Contrôle départ - ${res.guest_name || 'Client'}`,
      tasks: [
        { id: 'task_1', title: 'État des lieux', completed: false },
        { id: 'task_2', title: 'Vérifier les dégâts éventuels', completed: false },
        { id: 'task_3', title: 'Récupérer les clés', completed: false },
        { id: 'task_4', title: 'Photos de l\'état', completed: false }
      ],
      dueDate: new Date(res.end_date)
    });

    if (departureChecklist) checklists.push(departureChecklist);

    console.log(`✅ ${checklists.length} checklists générées pour ${reservationUid}`);
    return checklists;
  } catch (error) {
    console.error('❌ Erreur generateChecklistsForReservation:', error);
    return [];
  }
}

async function syncAllCalendars() {
  console.log('🔄 Démarrage de la synchronisation iCal...');
  const isFirstSync = !reservationsStore.lastSync; // première sync depuis le démarrage ?
  reservationsStore.syncStatus = 'syncing';

  const newReservations = [];
  const cancelledReservations = [];

  for (const property of PROPERTIES) {
    if (!property.icalUrls || property.icalUrls.length === 0) {
      console.log(`⚠️  Aucune URL iCal configurée pour ${property.name}`);
      continue;
    }

    try {
      const reservations = await icalService.fetchReservations(property);

      // Ancien état (iCal + manuelles) :
      const previousAllReservations = reservationsStore.properties[property.id] || [];

      // On ne regarde que les résas iCal (pas les manuelles ni les blocages)
      const oldIcalReservations = previousAllReservations.filter(r =>
        r &&
        r.uid &&
        r.source !== 'MANUEL' &&
        r.source !== 'BLOCK' &&
        r.type !== 'manual' &&
        r.type !== 'block'
      );

      const newIcalReservations = reservations || [];

      const oldIds = new Set(oldIcalReservations.map(r => r.uid));
      const newIds = new Set(newIcalReservations.map(r => r.uid));

      // ➕ Nouvelles réservations (présentes dans new mais pas dans old)
      const trulyNewReservations = newIcalReservations.filter(r => !oldIds.has(r.uid));
      
      // ➖ Réservations annulées (présentes dans old mais plus dans new, ET FUTURES)
      const now = new Date();
      const cancelledForProperty = oldIcalReservations.filter(r => {
        // Si la réservation n'est plus dans le flux
        if (!newIds.has(r.uid)) {
          // Vérifier si c'est une réservation FUTURE
          const endDate = new Date(r.end);
          // Seulement considérer comme annulée si la date de fin est dans le futur
          return endDate >= now;
        }
        return false;
      });
      
      if (trulyNewReservations.length > 0) {
        newReservations.push(
          ...trulyNewReservations.map(r => ({
            ...r,
            propertyId: property.id,
            propertyName: property.name,
            propertyColor: property.color,
            userId: property.userId
          }))
        );
      }
      
      if (cancelledForProperty.length > 0) {
        cancelledReservations.push(
          ...cancelledForProperty.map(r => ({
            ...r,
            propertyId: property.id,
            propertyName: property.name,
            propertyColor: property.color,
            userId: property.userId
          }))
        );
      }

      // SAUVEGARDER DANS POSTGRESQL
      if (newIcalReservations.length > 0) {
        await savePropertyReservations(property.id, newIcalReservations, property.userId);
      }

      // MARQUER LES RESERVATIONS PASSEES COMME "COMPLETED"
      await pool.query(
        `UPDATE reservations 
         SET status = 'completed', updated_at = NOW()
         WHERE property_id = $1 
         AND end_date < $2 
         AND status = 'confirmed'`,
        [property.id, now]
      );

      // ✅ CORRECTION : Récupérer les réservations 'completed' depuis PostgreSQL
      const completedResult = await pool.query(
        `SELECT 
          id, uid, property_id, user_id,
          start_date, end_date,
          guest_name, guest_email, guest_phone,
          source, platform, reservation_type,
          price, currency, status,
          raw_ical_data, notes,
          created_at, updated_at, synced_at
         FROM reservations
         WHERE property_id = $1 
         AND status = 'completed'
         AND source != 'MANUEL'
         AND reservation_type != 'manual'
         ORDER BY start_date ASC`,
        [property.id]
      );

      const completedReservations = completedResult.rows.map(row => ({
        id: row.id,
        uid: row.uid,
        start: row.start_date,
        end: row.end_date,
        guestName: row.guest_name,
        guestEmail: row.guest_email,
        guestPhone: row.guest_phone,
        source: row.source,
        platform: row.platform,
        type: row.reservation_type,
        price: parseFloat(row.price) || 0,
        currency: row.currency,
        status: row.status,
        rawData: row.raw_ical_data,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        syncedAt: row.synced_at
      }));

      // ✅ Base = iCal actuel + historique completed
      reservationsStore.properties[property.id] = [
        ...newIcalReservations,
        ...completedReservations
      ];

      console.log(`Recherche manuelles pour property.id: ${property.id}`);
      console.log(`Cles dans MANUAL_RESERVATIONS:`, Object.keys(MANUAL_RESERVATIONS));
      const manualForProperty = MANUAL_RESERVATIONS[property.id] || [];
      console.log(`Trouve ${manualForProperty.length} reservations manuelles`);
      
// Ajouter les réservations manuelles SANS DOUBLON
if (manualForProperty.length > 0) {
  // Créer un Set des UIDs déjà présents dans reservationsStore
  const existingUids = new Set(
    reservationsStore.properties[property.id].map(r => r.uid)
  );
  
  // Filtrer pour ne garder que les nouvelles réservations
  const newManuals = manualForProperty.filter(r => !existingUids.has(r.uid));
  
  // Ajouter uniquement les nouvelles
  if (newManuals.length > 0) {
    reservationsStore.properties[property.id] = [
      ...reservationsStore.properties[property.id],
      ...newManuals
    ];
    console.log(`➕ ${newManuals.length} nouvelles réservations manuelles ajoutées`);
  } else {
    console.log(`ℹ️ Aucune nouvelle réservation manuelle (${manualForProperty.length} déjà présentes)`);
  }
}
console.log(
  `✅ ${property.name}: ${reservationsStore.properties[property.id].length} ` +
  `réservations (iCal + manuelles)`
);
    } catch (error) {
      console.error(`❌' Erreur lors de la synchronisation de ${property.name}:`, error.message);
    }
  }

  reservationsStore.lastSync = new Date();
  reservationsStore.syncStatus = 'idle';

 // Notifications : nouvelles + annulations (sauf première sync pour éviter le spam massif)
  if (!isFirstSync && (newReservations.length > 0 || cancelledReservations.length > 0)) {
    console.log(
      `Notifications a envoyer - nouvelles: ${newReservations.length}, annulees: ${cancelledReservations.length}`
    );
      //     try {
      //       await notifyOwnersAboutBookings(newReservations, cancelledReservations);
      //     } catch (err) {
      //       console.error('Erreur lors de l envoi des notifications proprietaires:', err);
      //     }
      console.log('Envoi email desactive - notifications push uniquement');
    
    // NOTIFICATIONS POUR NOUVELLES RESERVATIONS
    if (newReservations.length > 0) {
      try {
        await notifyCleanersAboutNewBookings(newReservations);
      } catch (err) {
        console.error('Erreur lors de l envoi des notifications menage:', err);
      }
    }

    // NOTIFICATIONS POUR ANNULATIONS (UNIQUEMENT DANS LES 3 PROCHAINS MOIS)
if (cancelledReservations.length > 0) {
  // Filtrer pour ne garder que les reservations dans les 3 prochains mois
  const now = new Date();
  const threeMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
  
  const futureCancelledReservations = cancelledReservations.filter(r => {
    const startDate = new Date(r.start);
    return startDate >= now && startDate <= threeMonthsFromNow;
  });
  
  if (futureCancelledReservations.length > 0) {
    console.log(`${futureCancelledReservations.length} annulation(s) detectee(s) dans les 3 mois, verification en DB...`);
    
    for (const reservation of futureCancelledReservations) {
      try {
        // Verifier si la reservation est deja marquee comme annulee en DB
        const dbCheck = await pool.query(
          'SELECT status FROM reservations WHERE uid = $1',
          [reservation.uid]
        );
        
        // Si la reservation existe en DB et n'est PAS deja annulee
        if (dbCheck.rows.length > 0 && dbCheck.rows[0].status !== 'cancelled') {
          // Marquer comme annulee en DB
          await pool.query(
            'UPDATE reservations SET status = $1, updated_at = NOW() WHERE uid = $2',
            ['cancelled', reservation.uid]
          );
          
          // Envoyer la notification
          await sendCancelledReservationNotification(
            reservation.userId || 1,
            cleanGuestName(reservation.guestName, reservation.platform || reservation.source),
            reservation.propertyName,
            reservation.start,
            reservation.end
          );
          
          console.log(`Notification annulation envoyee pour ${reservation.propertyName} (${reservation.uid})`);
        } else if (dbCheck.rows.length > 0 && dbCheck.rows[0].status === 'cancelled') {
          console.log(`Annulation deja traitee pour ${reservation.propertyName} (${reservation.uid}) - pas de notification`);
        }
      } catch (err) {
        console.error(`Erreur notification annulation pour ${reservation.propertyName}:`, err);
      }
    }
  } else {
    console.log(`${cancelledReservations.length} reservation(s) annulee(s) mais toutes sont passees ou au-dela de 3 mois - pas de notification`);
  }
}

  } else if (isFirstSync) {
    console.log('Premiere synchronisation : aucune notification envoyee pour eviter les doublons.');
  }

  console.log('Synchronisation terminee');
  return reservationsStore;
}
// ============================================
// ROUTE DE TEST WHATSAPP AMÉLIORÉE
// ============================================

app.get('/api/test-whatsapp', async (req, res) => {
  try {
    console.log('🧪 Test WhatsApp demandé');
    
    // Vérifier si le service est configuré
    console.log('   - Service configuré:', isConfigured);
    
    if (!isConfigured) {
      return res.status(500).json({ 
        ok: false, 
        error: 'Service WhatsApp non configuré. Vérifiez WHATSAPP_API_KEY et WHATSAPP_PHONE_ID' 
      });
    }
    
    // Utiliser le numéro passé en paramètre ou un numéro par défaut
    const testNumber = req.query.number || '+33680559925'; // 
    const testMessage = req.query.message || 'Test WhatsApp Boostinghost ✅';
    
    console.log(`   - Envoi à: ${testNumber}`);
    console.log(`   - Message: ${testMessage}`);
    
    
    console.log('✅ WhatsApp envoyé avec succès:', result);
    
    res.json({ 
      ok: true, 
      message: 'WhatsApp envoyé avec succès',
      to: testNumber,
      result: result
    });
  } catch (err) {
    console.error('❌ Erreur /api/test-whatsapp :', err);
    res.status(500).json({ 
      ok: false,
      error: err.message,
      details: err.stack
    });
  }
});

// Route pour tester avec l'utilisateur connecté
app.get('/api/test-whatsapp-user', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    console.log(`🧪 Test WhatsApp pour user ${user.id}`);
    
    // Récupérer les settings de l'utilisateur
    const settings = await getNotificationSettings(user.id);
    
    console.log('   - Settings utilisateur:', JSON.stringify(settings, null, 2));
    
    if (!settings.whatsappEnabled) {
      return res.json({ 
        ok: false, 
        message: 'WhatsApp désactivé dans vos préférences' 
      });
    }
    
    if (!settings.whatsappNumber) {
      return res.json({ 
        ok: false, 
        message: 'Aucun numéro WhatsApp configuré dans vos préférences' 
      });
    }
    
    const testMessage = `Test notification Boostinghost ✅\n\nCeci est un message de test envoyé à ${new Date().toLocaleString('fr-FR')}`;
    
    console.log(`   - Envoi à: ${settings.whatsappNumber}`);
    
    
    console.log('✅ Test WhatsApp envoyé avec succès');
    
    res.json({ 
      ok: true, 
      message: 'Message WhatsApp envoyé avec succès à votre numéro',
      to: settings.whatsappNumber
    });
    
  } catch (err) {
    console.error('❌ Erreur /api/test-whatsapp-user :', err);
    res.status(500).json({ 
      ok: false,
      error: err.message 
    });
  }
});

// ============================================
// TEST CONNEXION BASE DE DONNÉES
// ============================================

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({
      ok: true,
      now: result.rows[0].now
    });
  } catch (err) {
    console.error('Erreur DB :', err);
    res.status(500).json({
      ok: false,
      error: 'Erreur de connexion à la base'
    });
  }
});

// DEBUG - LISTER LES UTILISATEURS
app.get('/api/debug-users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, company, first_name, last_name, email, created_at
      FROM users
      ORDER BY created_at DESC
    `);

    res.json({
      count: result.rows.length,
      users: result.rows
    });
  } catch (err) {
    console.error('Erreur debug users :', err);
    res.status(500).json({
      error: 'Erreur lors de la récupération des utilisateurs'
    });
  }
});

// ============================================
// ROUTES API - RESERVATIONS (par user)
// ============================================
// ============================================
// ENDPOINT /api/reservations/manual
// (appelé par le frontend)
app.post('/api/reservations/manual', async (req, res) => {
  console.log('📝 /api/reservations/manual appelé');
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    
    const { propertyId, start, end, guestName, notes } = req.body;
    console.log('📦 Données reçues:', { propertyId, start, end, guestName });
    
    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }
    
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      console.log('❌ Logement non trouvé:', propertyId);
      return res.status(404).json({ error: 'Logement non trouvé' });
    }
    
    console.log('✅ Logement trouvé:', property.name);
    
    const uid = 'manual_' + Date.now();
    const userId = user.id; 
    const reservation = {
      uid: uid,
      start: start,
      end: end,
      source: 'MANUEL',
      platform: 'MANUEL',
      type: 'manual',
      guestName: guestName || 'Réservation manuelle',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      userId: userId
    };
    
    console.log('✅ Réservation créée:', uid);
    
    // 🔥 SAUVEGARDER EN BASE DE DONNÉES
    try {
      await pool.query(`
        INSERT INTO reservations (
          uid, property_id, user_id,
          start_date, end_date,
          guest_name, source, platform, reservation_type,
          price, currency, status,
          synced_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        ON CONFLICT (uid) DO NOTHING
      `, [
        uid,
        propertyId,
        user.id,
        start,
        end,
        guestName || 'Réservation manuelle',
        'MANUEL',
        'MANUEL',
        'manual',
        0,
        'EUR',
        'confirmed'
      ]);
      
      console.log('✅ Réservation sauvegardée en DB');
    } catch (dbError) {
      console.error('❌ Erreur sauvegarde DB:', dbError.message);
      return res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
    }
    
// 🔥 AJOUTER DANS MANUAL_RESERVATIONS
if (!MANUAL_RESERVATIONS[propertyId]) {
  MANUAL_RESERVATIONS[propertyId] = [];
}
MANUAL_RESERVATIONS[propertyId].push(reservation);
console.log('✅ Ajouté à MANUAL_RESERVATIONS');
    setImmediate(() => syncAllCalendars());
    // Réponse au client AVANT les notifications
    res.status(201).json({
      message: 'Réservation manuelle créée',
      reservation: reservation
    });
    console.log('✅ Réponse envoyée au client');
    
    // Notifications en arrière-plan
    setImmediate(async () => {
      try {
        console.log('📧 Envoi des notifications...');
        
        //         // 1. Notification email propriétaire
        //         if (typeof notifyOwnersAboutBookings === 'function') {
        //           await notifyOwnersAboutBookings([reservation], []);
        //           console.log('✅ Notification email envoyée');
        //         }
        console.log('ℹ️ Envoi email désactivé - notifications push uniquement');
        
        // 2. Notification push Firebase - ENVOYER À TOUS LES APPAREILS
        try {
          if (await shouldSendNotification(user.id, 'notif_new_reservation')) {
          const tokenResult = await pool.query(
            'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
            [user.id]
          );
          
          if (tokenResult.rows.length > 0) {
            const checkInDate = new Date(start).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'short'
            });
            const checkOutDate = new Date(end).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'short'
            });
            
            // ✅ GROUPER TOUS LES TOKENS ET ENVOYER UNE SEULE NOTIFICATION
            const fcmTokens = tokenResult.rows.map(row => row.fcm_token);
            
            await sendNotificationToMultiple(
              fcmTokens,
              '📅 Nouvelle réservation',
              `${property.name} - ${checkInDate} au ${checkOutDate}`,
              {
                type: 'new_reservation',
                reservation_id: uid,
                property_name: property.name
              }
            );
            
            console.log(`✅ Notification groupée envoyée à ${fcmTokens.length} appareil(s) pour ${property.name}`);
          }
          } // end shouldSendNotification
        } catch (pushError) {
          console.error('❌ Erreur notification push:', pushError.message);
        }
        
      } catch (notifError) {
        console.error('❌ Erreur notifications:', notifError.message);
      }
    });
    
  } catch (err) {
    console.error('❌ Erreur /api/reservations/manual:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});
// ============================================
// 🧪 ROUTE DE TEST - FORMAT IDENTIQUE AU CHAT
// ============================================
// Cette route envoie EXACTEMENT le même format que les notifications
// de chat qui fonctionnent (pour isoler le problème)

app.get('/test-push-like-chat', async (req, res) => {
  console.log('🧪 [TEST CHAT FORMAT] Début du test format chat...');
  
  try {
    const userId = req.query.user_id;
    
    if (!userId) {
      return res.status(400).json({
        error: '❌ Paramètre manquant',
        message: 'Utilisez : /test-push-like-chat?user_id=VOTRE_ID'
      });
    }
    
    // Récupérer l'utilisateur
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.json({ error: 'User introuvable' });
    }
    
    // Récupérer TOUS les tokens (comme sendNewMessageNotification)
    const tokensResult = await pool.query(
      `SELECT fcm_token, device_type
       FROM user_fcm_tokens 
       WHERE user_id = $1 
       AND fcm_token IS NOT NULL`,
      [userId]
    );
    
    if (tokensResult.rows.length === 0) {
      return res.json({ error: 'Pas de token FCM' });
    }
    
    console.log(`✅ [TEST CHAT FORMAT] ${tokensResult.rows.length} token(s) trouvé(s)`);
    
    // Récupérer une propriété
    const propResult = await pool.query(
      'SELECT name FROM properties WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    
    const propertyName = propResult.rows.length > 0 
      ? propResult.rows[0].name 
      : 'Voyageur';
    
    // Envoyer aux TOUS les appareils avec le MÊME FORMAT que le chat
    const results = [];
    
    for (const row of tokensResult.rows) {
      console.log(`📤 [TEST CHAT FORMAT] Envoi au ${row.device_type}...`);
      
      // ✅ FORMAT IDENTIQUE À sendNewMessageNotification
      const result = await sendNotification(
        row.fcm_token,
        `📩 Message de ${propertyName}`,  // Même format de titre
        'Ceci est un test de notification (format chat)',  // Message preview
        {
          type: 'new_message',  // ✅ MÊME TYPE QUE LE CHAT
          conversationId: '99999'  // Fake conversation ID
        }
      );
      
      results.push({
        device: row.device_type,
        success: result.success,
        token_preview: row.fcm_token.substring(0, 20) + '...'
      });
      
      console.log(`${result.success ? '✅' : '❌'} [TEST CHAT FORMAT] ${row.device_type}: ${result.success ? 'OK' : result.error}`);
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      message: `✅ ${successCount}/${results.length} envoyé(s) avec FORMAT CHAT`,
      user: userResult.rows[0].email,
      results: results,
      info: 'Cette notification utilise le MÊME format que le chat qui fonctionne'
    });
    
  } catch (error) {
    console.error('❌ [TEST CHAT FORMAT] Erreur:', error);
    res.json({ error: error.message });
  }
});

console.log('✅ Route de test format chat disponible : GET /test-push-like-chat?user_id=X');

// ============================================
// 🧪 BONUS : ROUTE POUR COMPARER LES 2 FORMATS
// ============================================

app.get('/test-push-compare', async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) {
      return res.json({ error: 'user_id requis' });
    }
    
    const tokensResult = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    
    if (tokensResult.rows.length === 0) {
      return res.json({ error: 'Pas de token' });
    }
    
    const token = tokensResult.rows[0].fcm_token;
    
    // Test 1 : Format CHAT (qui marche)
    console.log('📤 Test 1 : Format CHAT...');
    const test1 = await sendNotification(
      token,
      '📩 Message de Test',
      'Notification format CHAT',
      { type: 'new_message', conversationId: '1' }
    );
    
    // Attendre 3 secondes
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test 2 : Format RÉSERVATION
    console.log('📤 Test 2 : Format RÉSERVATION...');
    const test2 = await sendNotification(
      token,
      '📅 Nouvelle réservation',
      'Notification format RÉSERVATION',
      { type: 'new_reservation', property_name: 'Test' }
    );
    
    // Attendre 3 secondes
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test 3 : Format SIMPLE
    console.log('📤 Test 3 : Format SIMPLE...');
    const test3 = await sendNotification(
      token,
      '🧪 Test Simple',
      'Notification format SIMPLE',
      { type: 'test' }
    );
    
    res.json({
      message: '3 notifications envoyées avec des formats différents',
      results: {
        'Format CHAT (fonctionne normalement)': test1.success,
        'Format RÉSERVATION': test2.success,
        'Format SIMPLE': test3.success
      },
      next_step: 'Vérifiez lesquelles vous avez reçues sur votre téléphone'
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

console.log('✅ Route de comparaison disponible : GET /test-push-compare?user_id=X');
// ============================================
// ROUTES RÉSERVATIONS - VERSION CORRIGÉE POSTGRESQL
// Remplace les routes dans server.js
// ============================================

// GET - Toutes les réservations du user
app.get('/api/reservations', authenticateAny, checkSubscription, async (req, res) => {
  try {
    let userId;
    let accessibleProperties = [];

    // Détecter si sous-compte
    if (req.user.isSubAccount) {
      // Récupérer les infos du sous-compte
      const subResult = await pool.query(`
        SELECT parent_user_id
        FROM sub_accounts
        WHERE id = $1
      `, [req.user.subAccountId]);

      if (subResult.rows.length === 0) {
        return res.status(401).json({ error: 'Sous-compte introuvable' });
      }

      userId = subResult.rows[0].parent_user_id;

      // Récupérer les propriétés accessibles
      const propsResult = await pool.query(`
        SELECT property_id
        FROM sub_account_properties
        WHERE sub_account_id = $1
      `, [req.user.subAccountId]);

      accessibleProperties = propsResult.rows.map(r => r.property_id);

      console.log(`🔐 Sous-compte ${req.user.subAccountId} - Propriétés: ${accessibleProperties.join(', ')}`);

    } else {
      // Compte principal - accès à tout
      userId = req.user.id;
    }

    // Charger les propriétés de l'utilisateur
    const allReservations = [];
    const userProps = getUserProperties(userId);

    // Filtrer selon propriétés accessibles (si sous-compte)
    const filteredProps = req.user.isSubAccount
      ? userProps.filter(p => accessibleProperties.includes(p.id))
      : userProps;

    console.log(`🔍 DEBUG: userProps.length=${userProps.length}, filteredProps.length=${filteredProps.length}`);

    // ⭐ Fonction pour normaliser les plateformes
    function normalizePlatform(platform) {
      if (!platform) return '';
      const p = platform.toLowerCase().trim();
      // Normaliser toutes les variantes de Booking
      if (p.includes('booking')) return 'booking';
      // Normaliser toutes les variantes d'Airbnb
      if (p.includes('airbnb')) return 'airbnb';
      return p;
    }

   // ⭐ ENRICHISSEMENT : Charger TOUTES les conversations pour cet utilisateur
    let conversationsMap = new Map();
    try {
      const allConversationsResult = await pool.query(
        `SELECT 
          property_id,
          TO_CHAR(reservation_start_date, 'YYYY-MM-DD') as start_date,
          platform,
          guest_first_name, 
          guest_last_name, 
          guest_phone,
          onboarding_completed
         FROM conversations 
         WHERE user_id = $1`,
        [userId]
      );
      
      // Créer un index pour lookup rapide avec matching flexible
      // On crée plusieurs clés par conversation pour gérer le décalage de dates
      allConversationsResult.rows.forEach(conv => {
        const platform = normalizePlatform(conv.platform);
        const baseKey = `${conv.property_id}_${conv.start_date}_${platform}`;
        
        // Fonction helper pour ajouter une clé sans écraser si elle existe déjà avec des infos
        const addKey = (key, conversation) => {
          const existing = conversationsMap.get(key);
          // Ne pas écraser si la clé existe déjà et a des infos guest
          if (existing && existing.guest_first_name) {
            return; // Garder l'existant qui a des infos
          }
          // Sinon, ajouter/écraser
          conversationsMap.set(key, conversation);
        };
        
        // Ajouter la clé principale
        addKey(baseKey, conv);
        
        // Ajouter aussi les clés avec ±1 jour pour gérer les décalages
        const date = new Date(conv.start_date);
        
        // Jour précédent
        const prevDate = new Date(date);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevKey = `${conv.property_id}_${prevDate.toISOString().split('T')[0]}_${platform}`;
        addKey(prevKey, conv);
        
        // Jour suivant
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextKey = `${conv.property_id}_${nextDate.toISOString().split('T')[0]}_${platform}`;
        addKey(nextKey, conv);
        
        // ⭐ DEBUG TEMPORAIRE pour Jean
        if (conv.guest_first_name === 'Jean') {
          console.log('🔍 DEBUG Jean - Clés créées:', {
            baseKey: baseKey,
            prevKey: prevKey,
            nextKey: nextKey,
            platform_original: conv.platform,
            platform_normalized: platform
          });
        }
      });
      
      console.log(`💬 ${conversationsMap.size} conversations chargées pour enrichissement`);
      
      // 🔍 DEBUG: Afficher quelques exemples de clés
      if (conversationsMap.size > 0) {
        console.log('🔍 Exemples de clés de conversations:');
        let count = 0;
        for (const [key, conv] of conversationsMap.entries()) {
          if (count < 3) {
            console.log(`   ${key} -> ${conv.guest_first_name} ${conv.guest_last_name || ''}`);
            count++;
          }
        }
      }
    } catch (error) {
      console.error('❌ Erreur chargement conversations:', error);
    }

   // Enrichir les réservations avec les données des conversations
    filteredProps.forEach(property => {
      const propertyReservations = reservationsStore.properties[property.id] || [];
      
      propertyReservations.forEach((reservation, index) => {
        // Préparer la clé de recherche avec normalisation
        const startDate = new Date(reservation.start || reservation.checkIn).toISOString().split('T')[0];
        const platform = normalizePlatform(reservation.source || reservation.platform);
        const key = `${property.id}_${startDate}_${platform}`;
        
        // 🔍 DEBUG: Log pour les premières réservations
        if (index < 2) {
          console.log(`🔍 Recherche réservation: ${key}`);
        }
        
        // 🔍 DEBUG: Log si c'est la réservation de Jean
        if (key === 'u_mjcpmi2k-sg-rdc_2026-02-06_booking') {
          console.log('🔍 DEBUG MATCHING Jean:');
          console.log('   Clé recherchée:', key);
          console.log('   Map size:', conversationsMap.size);
          console.log('   Has key?:', conversationsMap.has(key));
          console.log('   Get result:', conversationsMap.get(key));
        }
        
        // Chercher la conversation correspondante
        const conversationData = conversationsMap.get(key) || {};
        
        // 🔍 DEBUG: Log si trouvé
        if (conversationData.guest_first_name && index < 2) {
          console.log(`   ✅ Trouvé: ${conversationData.guest_first_name} ${conversationData.guest_last_name || ''}`);
        } else if (index < 2) {
          console.log(`   ❌ Pas trouvé`);
        }
        // Enrichir la réservation
        const enrichedReservation = {
          ...reservation,
          property: {
            id: property.id,
            name: property.name,
            color: property.color
          },
          // ⭐ Ajouter les infos du voyageur depuis la conversation
          guest_first_name: conversationData.guest_first_name || null,
          guest_last_name: conversationData.guest_last_name || null,
          guest_phone: conversationData.guest_phone || null,
          onboarding_completed: conversationData.onboarding_completed || false,
          // Calculer les champs dérivés
          guest_display_name: conversationData.guest_first_name 
            ? `${conversationData.guest_first_name} ${conversationData.guest_last_name || ''}`.trim()
            : null,
          guest_initial: conversationData.guest_first_name 
            ? conversationData.guest_first_name.charAt(0).toUpperCase() 
            : null
        };
        
        allReservations.push(enrichedReservation);
      });
    });

    console.log(`📅 Réservations retournées: ${allReservations.length} (${filteredProps.length} propriétés)`);
    
    // 🔍 DEBUG: Compter combien ont des infos guest
    const withGuestInfo = allReservations.filter(r => r.guest_first_name);
    console.log(`👤 Réservations avec infos guest: ${withGuestInfo.length}`);
    if (withGuestInfo.length > 0) {
      console.log(`   Exemple: ${withGuestInfo[0].guest_display_name} (${withGuestInfo[0].guest_phone || 'pas de tel'})`);
    }

    res.json({
      reservations: allReservations,
      lastSync: reservationsStore.lastSync,
      syncStatus: reservationsStore.syncStatus,
      properties: filteredProps.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        count: (reservationsStore.properties[p.id] || []).length
      }))
    });
  } catch (err) {
    console.error('❌ Erreur /api/reservations:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// POST - Créer une réservation manuelle
app.post('/api/bookings', authenticateAny, checkSubscription, async (req, res) => {
  console.log('📝 Nouvelle demande de création de réservation');
  
  try {
    // 1. VÉRIFICATION AUTHENTIFICATION
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('❌ Utilisateur non authentifié');
      return res.status(401).json({ error: 'Non autorisé' });
    }
    console.log('✅ Utilisateur authentifié:', user.id);
    
    // 2. EXTRACTION ET VALIDATION DES DONNÉES
    const { propertyId, checkIn, checkOut, guestName, platform, price } = req.body || {};
    console.log('📦 Données reçues:', { propertyId, checkIn, checkOut, guestName, platform, price });
    
    if (!propertyId) {
      console.log('❌ propertyId manquant');
      return res.status(400).json({ error: 'propertyId est requis' });
    }
    if (!checkIn) {
      console.log('❌ checkIn manquant');
      return res.status(400).json({ error: 'checkIn est requis' });
    }
    if (!checkOut) {
      console.log('❌ checkOut manquant');
      return res.status(400).json({ error: 'checkOut est requis' });
    }
    
    // 3. VÉRIFICATION DU LOGEMENT EN POSTGRESQL
    const propertyCheck = await pool.query(
      'SELECT id, name, color FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, userId]
    );
    
    if (propertyCheck.rows.length === 0) {
      console.log('❌ Logement non trouvé:', propertyId);
      return res.status(404).json({ error: 'Logement non trouvé' });
    }
    
    const property = propertyCheck.rows[0];
    console.log('✅ Logement trouvé:', property.name);
    
    // 4. CRÉATION DE LA RÉSERVATION
    // ✅ CORRECTION : UID unique avec timestamp + random pour éviter les doublons
    const crypto = require('crypto');
    const randomStr = crypto.randomBytes(4).toString('hex'); // 8 caractères hex
    const uid = `manual_${Date.now()}_${randomStr}`;
    
    const reservation = {
      uid: uid,
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'Réservation manuelle',
      price: typeof price === 'number' ? price : 0,
      currency: 'EUR',
      status: 'confirmed'
    };
    console.log('✅ Réservation créée:', uid);
    
    // 5. SAUVEGARDE EN POSTGRESQL
    // Utilise la fonction saveReservationToDB que vous avez déjà modifiée
    // Elle va aussi créer automatiquement la conversation !
    const saved = await saveReservationToDB(reservation, propertyId, user.id);
    
    if (!saved) {
      console.error('❌ Erreur lors de la sauvegarde');
      return res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
    }
    
    console.log('✅ Réservation sauvegardée en PostgreSQL');
    
    // 6. PRÉPARATION DE LA RÉPONSE
    const bookingForClient = {
      id: reservation.uid,
      uid: reservation.uid,
      propertyId: property.id,
      property_id: property.id,
      propertyName: property.name,
      property_name: property.name,
      propertyColor: property.color || '#3b82f6',
      property_color: property.color || '#3b82f6',
      checkIn: checkIn,
      start_date: checkIn,
      checkOut: checkOut,
      end_date: checkOut,
      guestName: reservation.guestName,
      guest_name: reservation.guestName,
      platform: reservation.platform,
      source: reservation.source,
      price: reservation.price,
      type: reservation.type,
      status: reservation.status
    };
    
    // 7. ENVOI DE LA RÉPONSE (AVANT LES NOTIFICATIONS)
    console.log('✅ Réservation créée avec succès, envoi de la réponse');
    res.status(201).json({
      success: true,
      reservation: bookingForClient
    });
    
    // 8. NOTIFICATIONS EN ARRIÈRE-PLAN (après avoir répondu au client)
    setImmediate(async () => {
      try {
        console.log('📧 Tentative d\'envoi des notifications...');
        
        //         // Vérifier que les fonctions de notification existent
        //         if (typeof notifyOwnersAboutBookings === 'function') {
        //           await notifyOwnersAboutBookings([reservation], []);
        //           console.log('✅ Notification propriétaire envoyée');
        //         } else {
        //           console.log('⚠️  Fonction notifyOwnersAboutBookings non trouvée');
        //         }
        console.log('ℹ️ Envoi email désactivé - notifications push uniquement');
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('✅ Notification cleaners envoyée');
        } else {
          console.log('⚠️  Fonction notifyCleanersAboutNewBookings non trouvée');
        }
        
        console.log('✅ Notifications traitées');
      } catch (notifErr) {
        console.error('⚠️  Erreur lors de l\'envoi des notifications (réservation créée quand même):', notifErr.message);
      }
    });
    
  } catch (err) {
    console.error('❌ ERREUR CRITIQUE POST /api/bookings:', err);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    // Si on n'a pas encore envoyé de réponse
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Erreur serveur lors de la création de la réservation',
        message: err.message,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  }
});

// ============================================
// 🔧 CORRECTION : Route DELETE /api/bookings/:uid
// ============================================
// Remplacez la route ligne ~4797 dans server.js

app.delete('/api/bookings/:uid', authenticateAny, checkSubscription, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { uid } = req.params;
    
    console.log('🗑️ Suppression de la réservation:', uid);
    
    // ✅ SUPPRESSION RÉELLE DE LA DB (pas juste UPDATE status)
    let deleted = false;
    let deletedReservation = null;
    let propertyName = 'Logement';
    
    try {
      const deleteResult = await pool.query(
        `DELETE FROM reservations 
         WHERE uid = $1 AND user_id = $2 
         RETURNING *, (SELECT name FROM properties WHERE id = reservations.property_id) as property_name`,
        [uid, user.id]
      );
      
      deleted = deleteResult.rowCount > 0;
      
      if (deleted) {
        deletedReservation = deleteResult.rows[0];
        propertyName = deletedReservation.property_name || 'Logement';
        console.log(`✅ Réservation ${uid} supprimée de PostgreSQL`);
      } else {
        console.log(`⚠️ Réservation ${uid} non trouvée`);
        return res.status(404).json({ error: 'Réservation non trouvée' });
      }
    } catch (dbError) {
      console.error('❌ Erreur suppression DB:', dbError);
      return res.status(500).json({ error: 'Erreur lors de la suppression' });
    }
    
    // ✅ ENVOYER NOTIFICATION D'ANNULATION
    if (deleted && deletedReservation) {
      if (await shouldSendNotification(user.id, 'notif_reservation_cancelled')) {
      try {
        const tokensResult = await pool.query(
          'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
          [user.id]
        );
        
        if (tokensResult.rows.length > 0) {
          const cancelDate = new Date(deletedReservation.start_date).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short'
          });
          
          // ✅ GROUPER TOUS LES TOKENS
          const fcmTokens = tokensResult.rows.map(row => row.fcm_token);
          
          await sendNotificationToMultiple(
            fcmTokens,
            '❌ Réservation annulée',
            `${propertyName} - ${cancelDate}`,
            {
              type: 'reservation_cancelled',
              reservation_id: uid,
              property_name: propertyName
            }
          );
          
          console.log(`✅ Notification annulation groupée envoyée à ${fcmTokens.length} appareil(s)`);
        }
      } catch (notifError) {
        console.error('❌ Erreur notification:', notifError.message);
        // On continue, la suppression a réussi
      }
      } // end shouldSendNotification
    }
    
    // ✅ Forcer la resynchronisation
    setImmediate(() => syncAllCalendars());
    
    console.log('✅ Réservation supprimée');
    
    res.json({ 
      success: true,
      message: 'Réservation supprimée avec succès' 
    });
    
  } catch (err) {
    console.error('❌ Erreur DELETE /api/bookings:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer un blocage manuel (dates bloquées)
app.post('/api/blocks', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    const { propertyId, start, end, reason } = req.body || {};
    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }
    const block = {
      uid: 'block_' + Date.now(),
      propertyId,
      start,
      end,
      source: 'BLOCK',
      platform: 'BLOCK',
      type: 'block',
      guestName: reason || 'Blocage calendrier',
      notes: reason || '',
      createdAt: new Date().toISOString()
    };
    
    if (!MANUAL_RESERVATIONS[propertyId]) {
      MANUAL_RESERVATIONS[propertyId] = [];
    }
    MANUAL_RESERVATIONS[propertyId].push(block);
    setImmediate(() => syncAllCalendars());
    
    res.status(201).json({
      message: 'Blocage créé',
      block
    });
  } catch (err) {
    console.error('Erreur création blocage:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Réservations d'un logement
app.get('/api/reservations/:propertyId', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }

  const reservations = reservationsStore.properties[propertyId] || [];

  res.json({
    property: {
      id: property.id,
      name: property.name,
      color: property.color
    },
    reservations,
    count: reservations.length
  });
});
function parsePropertyBody(req) {
  // ✅ FormData simple : les champs sont directement dans req.body
  const body = req.body || {};
  
  // Si icalUrls est une string JSON, la parser
  if (body.icalUrls && typeof body.icalUrls === 'string') {
    try {
      body.icalUrls = JSON.parse(body.icalUrls);
    } catch (e) {
      console.error('Erreur parse icalUrls:', e);
      body.icalUrls = [];
    }
  }
  
  return body;
}

// Upload vers Cloudinary et retourner l'URL
async function uploadPhotoToCloudinary(file) {
  if (!file) return null;
  
  try {
    const filename = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    
    const cloudinaryUrl = await uploadToCloudinary(file.buffer, filename);
    console.log('✅ Image uploadée vers Cloudinary:', cloudinaryUrl);
    return cloudinaryUrl;
  } catch (error) {
    console.error('❌ Erreur upload Cloudinary:', error);
    throw error;
  }
}

// ============================================
// ROUTES API - PROFIL UTILISATEUR ÉTENDU
// ============================================
// À ajouter dans server.js après les routes existantes

app.get('/api/user/profile', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const result = await pool.query(
      `SELECT 
        id, 
        email, 
        first_name, 
        last_name, 
        company,
        account_type,
        address,
        postal_code,
        city,
        siret,
        logo_url,
        created_at
       FROM users 
       WHERE id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const row = result.rows[0];

    res.json({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      company: row.company,
      accountType: row.account_type,
      address: row.address,
      postalCode: row.postal_code,
      city: row.city,
      siret: row.siret,
      logoUrl: row.logo_url,
      createdAt: row.created_at
    });
  } catch (error) {
    console.error('Erreur profil utilisateur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Mettre à jour le profil complet de l'utilisateur
app.put('/api/user/profile', upload.single('logo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const {
      firstName,
      lastName,
      company,
      accountType,
      address,
      postalCode,
      city,
      siret
    } = req.body;

    // Validation du type de compte
    if (accountType && !['individual', 'business'].includes(accountType)) {
      return res.status(400).json({ 
        error: 'Type de compte invalide. Doit être "individual" ou "business"' 
      });
    }

    // Validation du SIRET si entreprise
    if (accountType === 'business' && siret) {
      const siretClean = siret.replace(/\s/g, '');
      if (siretClean.length !== 14 || !/^\d{14}$/.test(siretClean)) {
        return res.status(400).json({ 
          error: 'Le numéro SIRET doit contenir exactement 14 chiffres' 
        });
      }
    }

    // Gérer le logo uploadé
   // Upload du logo vers Cloudinary
let logoUrl = null;
if (req.file) {
  logoUrl = await uploadPhotoToCloudinary(req.file);
}

    // Mise à jour dans la base de données
    const result = await pool.query(
      `UPDATE users 
       SET 
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         company = COALESCE($3, company),
         account_type = COALESCE($4, account_type),
         address = $5,
         postal_code = $6,
         city = $7,
         siret = $8,
         logo_url = COALESCE($9, logo_url)
       WHERE id = $10
       RETURNING 
         id, 
         email, 
         first_name, 
         last_name, 
         company,
         account_type,
         address,
         postal_code,
         city,
         siret,
         logo_url`,
      [
        firstName || null,
        lastName || null,
        company || null,
        accountType || 'individual',
        address || null,
        postalCode || null,
        city || null,
        (accountType === 'business' ? siret : null) || null,
        logoUrl,
        user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const updated = result.rows[0];

    // Mettre à jour le cache si utilisé
    if (notificationUserCache.has(user.id)) {
      notificationUserCache.delete(user.id);
    }

    res.json({
      success: true,
      message: 'Profil mis à jour avec succès',
      profile: {
        id: updated.id,
        email: updated.email,
        firstName: updated.first_name,
        lastName: updated.last_name,
        company: updated.company,
        accountType: updated.account_type,
        address: updated.address,
        postalCode: updated.postal_code,
        city: updated.city,
        siret: updated.siret,
        logoUrl: updated.logo_url
      }
    });

  } catch (err) {
    console.error('Erreur mise à jour profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Route pour vérifier le statut de l'abonnement
app.get('/api/subscription/status', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        status, 
        plan_type, 
        trial_end_date,
        current_period_end,
        stripe_subscription_id
      FROM subscriptions 
      WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun abonnement trouvé' });
    }

    const sub = result.rows[0];
    const now = new Date();

    // Calculer les jours restants pour les trials
    let daysRemaining = null;
    if (sub.status === 'trial' && sub.trial_end_date) {
      const trialEnd = new Date(sub.trial_end_date);
      const diffTime = trialEnd - now;
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // ✅ Calculer le montant avec la fonction getPlanAmount
    const planAmount = getPlanAmount(sub.plan_type);

    // ✅ Message d'affichage
    let displayMessage = 'Abonnement';
    if (sub.status === 'trial') {
      displayMessage = 'Essai gratuit';
    } else if (sub.status === 'active') {
      displayMessage = `Abonnement ${getPlanDisplayName(sub.plan_type)}`;
    } else if (sub.status === 'expired') {
      displayMessage = 'Abonnement expiré';
    } else if (sub.status === 'canceled') {
      displayMessage = 'Abonnement annulé';
    }

    res.json({
      status: sub.status,
      planType: sub.plan_type,
      planAmount: planAmount,
      trialEndDate: sub.trial_end_date,
      currentPeriodEnd: sub.current_period_end,
      daysRemaining: daysRemaining,
      displayMessage: displayMessage,
      showAlert: sub.status === 'trial' && daysRemaining !== null && daysRemaining <= 3
    });

  } catch (err) {
    console.error('Erreur subscription status:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// EXEMPLE D'UTILISATION DEPUIS LE FRONTEND
// ============================================

/*
// 1. Récupérer le profil au chargement
fetch('/api/user/profile', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
})
.then(res => res.json())
.then(data => {
  // Remplir les champs du formulaire
  document.getElementById('profileFirstName').value = data.firstName || '';
  document.getElementById('profileLastName').value = data.lastName || '';
  document.getElementById('profileCompany').value = data.company || '';
  document.getElementById('profileAddress').value = data.address || '';
  document.getElementById('profilePostalCode').value = data.postalCode || '';
  document.getElementById('profileCity').value = data.city || '';
  document.getElementById('profileSiret').value = data.siret || '';
  
  if (data.accountType === 'business') {
    document.getElementById('accountTypeBusiness').checked = true;
  } else {
    document.getElementById('accountTypeIndividual').checked = true;
  }
});

// 2. Mettre à jour le profil lors de la sauvegarde
fetch('/api/user/profile', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  },
  body: JSON.stringify({
    firstName: document.getElementById('profileFirstName').value,
    lastName: document.getElementById('profileLastName').value,
    company: document.getElementById('profileCompany').value,
    accountType: document.getElementById('accountTypeBusiness').checked ? 'business' : 'individual',
    address: document.getElementById('profileAddress').value,
    postalCode: document.getElementById('profilePostalCode').value,
    city: document.getElementById('profileCity').value,
    siret: document.getElementById('profileSiret').value
  })
})
.then(res => res.json())
.then(data => {
  if (data.success) {
    alert('Profil mis à jour avec succès !');
  } else {
    alert('Erreur : ' + data.error);
  }
});
*/
// ============================================
// ROUTES API - BOOKINGS (alias pour réservations)
// Utilisé par le calendrier moderne (calendar-modern.js)
// ============================================

// GET - Liste des bookings pour l'utilisateur courant
app.get('/api/bookings', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const userProps = getUserProperties(user.id);
    const bookings = [];

    userProps.forEach(property => {
      const propertyReservations = reservationsStore.properties[property.id] || [];

      propertyReservations.forEach(r => {
        const checkIn = r.checkIn || r.start;
        const checkOut = r.checkOut || r.end;
        if (!checkIn || !checkOut) return;

        let platformRaw = r.platform || r.source || '';
        let platform = (platformRaw || '').toString().toLowerCase();
        if (platform.includes('airbnb')) platform = 'airbnb';
        else if (platform.includes('booking')) platform = 'booking';
        else if (platform.includes('vrbo') || platform.includes('abritel') || platform.includes('homeaway')) platform = 'vrbo';
        else if (platform.includes('expedia')) platform = 'expedia';
        else if (platform.includes('block')) platform = 'block';
        else if (!platform) platform = 'direct';

        bookings.push({
          id: r.uid || r.id || `${property.id}-${checkIn}-${checkOut}`,
          propertyId: property.id,
          propertyName: property.name,
          propertyColor: property.color,
          checkIn,
          checkOut,
          guestName: r.guestName || r.summary || '',
          platform,
          price: r.price || 0,
          type: r.type || (platform === 'block' ? 'block' : 'manual')
        });
      });
    });

    res.json(bookings);
  } catch (err) {
    console.error('Erreur GET /api/bookings :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer un booking manuel (alias de /api/reservations/manual)
app.post('/api/bookings', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    const { propertyId, checkIn, checkOut, guestName, platform, price } = req.body || {};
    if (!propertyId || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'propertyId, checkIn et checkOut sont requis' });
    }
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }
    const reservation = {
      uid: 'manual_' + Date.now(),
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'Réservation manuelle',
      price: typeof price === 'number' ? price : 0,
      createdAt: new Date().toISOString()
    };
    
    if (!MANUAL_RESERVATIONS[propertyId]) {
      MANUAL_RESERVATIONS[propertyId] = [];
    }
    MANUAL_RESERVATIONS[propertyId].push(reservation);
    setImmediate(() => syncAllCalendars());
    
    const bookingForClient = {
      id: reservation.uid,
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color,
      checkIn,
      checkOut,
      guestName: reservation.guestName,
      platform: reservation.platform,
      price: reservation.price,
      type: reservation.type
    };
    
    res.status(201).json(bookingForClient);
  } catch (err) {
    console.error('Erreur POST /api/bookings :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Forcer une synchronisation
app.post('/api/sync', authenticateAny, async (req, res) => {
  // Déterminer l'userId (parent si sous-compte, sinon user direct)
  let userId;
  
  if (req.user.isSubAccount) {
    const subResult = await pool.query(
      'SELECT parent_user_id FROM sub_accounts WHERE id = $1',
      [req.user.subAccountId]
    );
    
    if (subResult.rows.length === 0) {
      return res.status(401).json({ error: 'Sous-compte introuvable' });
    }
    
    userId = subResult.rows[0].parent_user_id;
    console.log(`🔄 Sync demandé par sous-compte ${req.user.subAccountId} (parent: ${userId})`);
  } else {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    userId = user.id;
  }

  if (reservationsStore.syncStatus === 'syncing') {
    return res.status(409).json({
      error: 'Synchronisation déjà en cours',
      status: 'syncing'
    });
  }

  try {
    const result = await syncAllCalendars();
    const userProps = getUserProperties(userId);

    res.json({
      message: 'Synchronisation réussie',
      lastSync: result.lastSync,
      properties: userProps.map(p => ({
        id: p.id,
        name: p.name,
        count: (result.properties[p.id] || []).length
      }))
    });
  } catch (error) {
    res.status(500).json({
      error: 'Erreur lors de la synchronisation',
      details: error.message
    });
  }
});

app.get('/api/stats', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const stats = {
    totalReservations: 0,
    upcomingReservations: 0,
    currentReservations: 0,
    byProperty: {},
    byMonth: {}
  };

  const now = new Date();
  const userProps = getUserProperties(user.id);

  userProps.forEach(property => {
    const reservations = reservationsStore.properties[property.id] || [];
    stats.totalReservations += reservations.length;

    const upcoming = reservations.filter(r => new Date(r.start) > now).length;
    const current = reservations.filter(r =>
      new Date(r.start) <= now && new Date(r.end) >= now
    ).length;

    stats.upcomingReservations += upcoming;
    stats.currentReservations += current;

    stats.byProperty[property.id] = {
      name: property.name,
      total: reservations.length,
      upcoming,
      current
    };

    reservations.forEach(r => {
      const month = new Date(r.start).toISOString().slice(0, 7);
      stats.byMonth[month] = (stats.byMonth[month] || 0) + 1;
    });
  });

  res.json(stats);
});

app.get('/api/availability/:propertyId', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { propertyId } = req.params;
  const { startDate, endDate } = req.query;

  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }

  const reservations = reservationsStore.properties[propertyId] || [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const overlappingReservations = reservations.filter(r => {
    const rStart = new Date(r.start);
    const rEnd = new Date(r.end);
    return (rStart <= end && rEnd >= start);
  });

  res.json({
    property: {
      id: property.id,
      name: property.name
    },
    period: { start: startDate, end: endDate },
    available: overlappingReservations.length === 0,
    overlappingReservations
  });
});

// ============================================
// ROUTE CORRIGÉE : /api/reservations-with-deposits
// AVEC INFOS VOYAGEUR (guest_first_name, guest_last_name)
// ============================================
// Remplacer la route existante dans server.js (vers ligne 6421)

app.get('/api/reservations-with-deposits', authenticateAny, loadSubAccountData(pool), async (req, res) => {
  try {
    // Gérer compte principal ET sous-compte
    let userId;
    
    if (req.user.isSubAccount) {
      // C'est un sous-compte - récupérer le parent_user_id
      const subAccountResult = await pool.query(
        'SELECT parent_user_id FROM sub_accounts WHERE id = $1',
        [req.user.subAccountId]
      );
      
      if (subAccountResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }
      
      userId = subAccountResult.rows[0].parent_user_id;
      console.log('🔐 Sous-compte - userId parent:', userId);
    } else {
      // Compte principal
      userId = req.user.id;
      console.log('👤 Compte principal - userId:', userId);
    }

    // Vérifier que userId existe
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    // ✅ Récupérer tous les deposits de l'utilisateur depuis PostgreSQL
    const depositsResult = await pool.query(`
      SELECT id, reservation_uid, amount_cents, status, checkout_url, stripe_session_id, created_at
      FROM deposits
      WHERE user_id = $1
    `, [userId]);
    
    // Créer un Map pour un accès rapide par reservationUid
    const depositsMap = new Map();
    depositsResult.rows.forEach(d => {
      depositsMap.set(d.reservation_uid, {
        id: d.id,
        amountCents: d.amount_cents,
        status: d.status,
        checkoutUrl: d.checkout_url,
        stripeSessionId: d.stripe_session_id,
        createdAt: d.created_at
      });
    });

    // ✅ NOUVEAU : Récupérer les conversations avec infos voyageur
    const conversationsResult = await pool.query(`
      SELECT 
        property_id,
        reservation_start_date,
        platform,
        guest_first_name,
        guest_last_name,
        guest_phone,
        guest_name
      FROM conversations
      WHERE user_id = $1
    `, [userId]);
    
    // Créer un Map pour matcher conversations avec réservations
    // Clé: propertyId + startDate + platform (lowercased)
    const conversationsMap = new Map();
    conversationsResult.rows.forEach(c => {
      const startDate = c.reservation_start_date ? new Date(c.reservation_start_date).toISOString().split('T')[0] : '';
      const key = `${c.property_id}_${startDate}_${(c.platform || '').toLowerCase()}`;
      conversationsMap.set(key, {
        guestFirstName: c.guest_first_name,
        guestLastName: c.guest_last_name,
        guestPhone: c.guest_phone,
        guestNameFromConv: c.guest_name
      });
    });

    const result = [];
    let userProps = getUserProperties(userId);

    // ✅ Filtrer par propriétés accessibles si sous-compte
    if (req.user.isSubAccount && req.subAccountData?.accessible_property_ids?.length > 0) {
      userProps = userProps.filter(p => 
        req.subAccountData.accessible_property_ids.includes(p.id)
      );
      console.log('🔐 Sous-compte - propriétés filtrées:', userProps.map(p => p.id));
    }

    userProps.forEach(property => {
      const reservations = reservationsStore.properties[property.id] || [];

      reservations.forEach(r => {
        // ✅ Chercher le deposit dans la Map
        const deposit = depositsMap.get(r.uid) || null;
        
        // ✅ NOUVEAU : Chercher les infos voyageur dans les conversations
        const startDate = r.start ? new Date(r.start).toISOString().split('T')[0] : '';
        const platform = (r.platform || r.source || '').toLowerCase();
        const convKey = `${property.id}_${startDate}_${platform}`;
        const convData = conversationsMap.get(convKey);
        
        // Construire le nom complet du voyageur
        let guestDisplayName = '';
        let guestFirstName = '';
        let guestLastName = '';
        let guestPhone = '';
        
        if (convData) {
          guestFirstName = convData.guestFirstName || '';
          guestLastName = convData.guestLastName || '';
          guestPhone = convData.guestPhone || '';
          
          if (guestFirstName) {
            guestDisplayName = guestLastName 
              ? `${guestFirstName} ${guestLastName}`
              : guestFirstName;
          } else if (convData.guestNameFromConv) {
            guestDisplayName = convData.guestNameFromConv;
          }
        }
        
        // Fallback sur guestName de la réservation si pas d'info conversation
        if (!guestDisplayName && r.guestName) {
          guestDisplayName = r.guestName;
        }

        result.push({
          reservationUid: r.uid,
          propertyId: property.id,
          propertyName: property.name,
          startDate: r.start,
          endDate: r.end,
          guestName: r.guestName || '',
          // ✅ NOUVEAUX CHAMPS
          guestFirstName: guestFirstName,
          guestLastName: guestLastName,
          guestDisplayName: guestDisplayName,
          guestPhone: guestPhone,
          source: r.source || '',
          deposit: deposit
            ? {
                id: deposit.id,
                amountCents: deposit.amountCents,
                status: deposit.status,
                checkoutUrl: deposit.checkoutUrl,
                createdAt: deposit.createdAt
              }
            : null
        });
      });
    });

    console.log('✅ Deposits chargés:', result.length, 'réservations');
    res.json(result);
    
  } catch (error) {
    console.error('❌ Erreur /api/reservations-with-deposits:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ✅ GET - Réservations enrichies (risque + checklist + sous-scores)
// ============================================
app.get('/api/reservations/enriched', authenticateAny, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autorisé' });

  try {
    // Pré-calcul turnover par property
    const turnoverByUid = new Map();

    const userProps = PROPERTIES.filter(p => p.userId === user.id);

    for (const property of userProps) {
      const list = (reservationsStore.properties[property.id] || [])
        .filter(r => r && r.start && r.end && r.type !== 'block' && r.source !== 'BLOCK');

      const sorted = [...list].sort((a, b) => new Date(a.start) - new Date(b.start));
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        const prev = sorted[i - 1];
        if (!prev) continue;
        const gapHours = (new Date(cur.start) - new Date(prev.end)) / (1000 * 60 * 60);
        turnoverByUid.set(cur.uid, gapHours);
      }
    }

    const now = new Date();
    const result = [];

    for (const property of userProps) {
      const reservations = (reservationsStore.properties[property.id] || [])
        .filter(r => r && r.start && r.end && r.type !== 'block' && r.source !== 'BLOCK');

      for (const r of reservations) {
        // ✅ Checklist V1 auto (lazy)
        const chk = ensureChecklistForReservation({
          reservationUid: r.uid,
          propertyId: property.id,
          userId: userId
        });

        // ✅ Deposit (Stripe) via DEPOSITS JSON
        const dep = DEPOSITS.find(d => d.reservationUid === r.uid) || null;

        const channel = mapChannelFromReservation(r);

        const input = {
          startDate: r.start,
          endDate: r.end,
          bookedAt: r.createdAt || null,
          channel,
          checklistStatus: mapChecklistStatusFromChecklist(chk),
          depositStatus: mapDepositStatusFromDeposit(dep),

          // Champs optionnels (chemin A : defaults)
          propertySensitive: false,
          capacity: 2,
          propertyType: 'entire',
          expectedCheckinHour: parseHour(property.arrivalTime || property.arrival_time),
          turnoverHoursBefore: turnoverByUid.has(r.uid) ? turnoverByUid.get(r.uid) : null,
          lastIcalSyncAt: reservationsStore.lastSync || null,
        };

        const risk = computeRiskV1(input, now);

        result.push({
          ...r,
          propertyId: property.id,
          propertyName: property.name,
          deposit: dep,
          checklist: chk,

          riskScore: risk.score,
          riskLevel: risk.level,
          riskLabel: risk.label,
          riskSummary: risk.summary,
          riskTags: risk.tags,
          riskSubScores: risk.subScores,
          riskParts: risk.parts
        });
      }
    }

    // Tri : risque desc puis date
    result.sort((a, b) => (b.riskScore - a.riskScore) || (new Date(a.start) - new Date(b.start)));

    // Persister checklists si de nouvelles ont été créées
    await saveChecklists();

    res.json({ reservations: result });
  } catch (err) {
    console.error('Erreur /api/reservations/enriched :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ✅ Checklists V1 - toggle task
// ============================================
app.post('/api/checklists/:reservationUid/tasks/:taskId/toggle', authenticateAny, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autorisé' });

  const { reservationUid, taskId } = req.params;
  const chk = CHECKLISTS[reservationUid];
  if (!chk) return res.status(404).json({ error: 'Checklist introuvable' });
  if (chk.userId !== user.id) return res.status(403).json({ error: 'Accès refusé' });

  const task = chk.tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'Tâche introuvable' });

  task.completed = !task.completed;
  chk.updatedAt = new Date().toISOString();

  const allDone = chk.tasks.every(t => t.completed);
  chk.status = allDone ? 'completed' : (chk.tasks.some(t => t.completed) ? 'in_progress' : 'pending');

  await saveChecklists();
  res.json({ checklist: chk });
});

// ✅ Checklists V1 - complete all
app.post('/api/checklists/:reservationUid/complete', authenticateAny, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autorisé' });

  const { reservationUid } = req.params;
  const chk = CHECKLISTS[reservationUid];
  if (!chk) return res.status(404).json({ error: 'Checklist introuvable' });
  if (chk.userId !== user.id) return res.status(403).json({ error: 'Accès refusé' });

  chk.tasks = chk.tasks.map(t => ({ ...t, completed: true }));
  chk.status = 'completed';
  chk.updatedAt = new Date().toISOString();

  await saveChecklists();
  
  // ✅ Envoyer notification push au propriétaire
  if (await shouldSendNotification(user.id, 'notif_checklist_done')) {
  try {
    const tokensResult = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [user.id]
    );
    
    if (tokensResult.rows.length > 0) {
      const propertyName = chk.propertyName || chk.title || 'Logement';
      
      await sendNotification(
        tokensResult.rows[0].fcm_token,
        '✅ Ménage terminé',
        `${propertyName} - Checklist complétée`,
        {
          type: 'cleaning_completed',
          reservation_uid: reservationUid,
          property_name: propertyName
        }
      );
      
      console.log(`✅ Notification ménage complété envoyée pour ${propertyName}`);
    }
  } catch (notifError) {
    console.error('❌ Erreur notification ménage complété:', notifError.message);
  }
  } // end shouldSendNotification
  
  res.json({ checklist: chk });
});


// ============================================
// ROUTES API - PARAMÈTRES NOTIFICATIONS (par user)
// ============================================

app.get('/api/settings/notifications', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const settings = await getNotificationSettings(user.id);
    res.json(settings);
  } catch (err) {
    console.error('Erreur /api/settings/notifications GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/settings/notifications', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

    try {
    const {
      newReservation, reminder, whatsappEnabled, whatsappNumber,
      notif_new_reservation, notif_reservation_cancelled, notif_daily_summary, notif_reminder_j1, notif_cleaning_reminder, notif_cleaning_completed, notif_checklist_done, notif_deposit_request, notif_deposit_release, notif_new_message, notif_new_invoice,
    } = req.body || {};

    const saved = await saveNotificationSettings(user.id, {
      newReservation, reminder, whatsappEnabled, whatsappNumber,
      notif_new_reservation, notif_reservation_cancelled, notif_daily_summary, notif_reminder_j1, notif_cleaning_reminder, notif_cleaning_completed, notif_checklist_done, notif_deposit_request, notif_deposit_release, notif_new_message, notif_new_invoice,
    });

    res.json({
      message: 'Préférences de notifications mises à jour',
      settings: saved,
    });

  } catch (err) {
    console.error('Erreur /api/settings/notifications POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTE ICS EXPORT - Calendrier Boostinghost
// ============================================

function formatDateToICS(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateTimeToICS(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

// ICS d'un logement : contient les réservations manuelles + blocages
app.get('/ical/property/:propertyId.ics', async (req, res) => {
  try {
    const { propertyId } = req.params;

    const property = PROPERTIES.find(p => p.id === propertyId);
    if (!property) {
      return res.status(404).send('Property not found');
    }

    // On exporte uniquement ce qui est dans MANUAL_RESERVATIONS :
    // - réservations manuelles (type: 'manual')
    // - blocages (type: 'block')
    const manual = MANUAL_RESERVATIONS[propertyId] || [];

    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//Boostinghost//BookingManager//FR');

    const nowICS = formatDateTimeToICS(new Date());

    manual.forEach((r, idx) => {
      if (!r.start || !r.end) return;
      const dtStart = formatDateToICS(r.start);
      const dtEnd = formatDateToICS(r.end);

      const uid = (r.uid || `block_${propertyId}_${idx}`) + '@boostinghost-manager';
      const summary =
        r.type === 'block' || r.source === 'BLOCK'
          ? 'Blocage Boostinghost'
          : (r.guestName ? `Réservation – ${r.guestName}` : 'Réservation Boostinghost');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${nowICS}`);
      lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
      lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
      lines.push(`SUMMARY:${summary}`);
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('Erreur /ical/property/:propertyId.ics :', err);
    res.status(500).send('Internal server error');
  }
});

// ============================================
// Fonction helper : Générer un token de vérification
// ============================================
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// Fonction helper : Envoyer l'email de vérification
// ============================================
async function sendVerificationEmail(email, firstName, token) {
  const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
  const verificationUrl = `${appUrl}/verify-email.html?token=${token}`;

  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '✅ Vérifiez votre adresse email - Boostinghost',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Bienvenue sur Boostinghost !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName || 'nouveau membre'},</p>
            
            <p>Merci de vous être inscrit sur <strong>Boostinghost</strong> !</p>
            
            <p>Pour activer votre compte et commencer à utiliser notre plateforme de gestion de locations courte durée, veuillez vérifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
            
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">
                ✅ Vérifier mon email
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
              Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
              <a href="${verificationUrl}" style="color: #10b981;">${verificationUrl}</a>
            </p>
            
            <p style="margin-top: 30px;">
              <strong>Ce lien est valide pendant 24 heures.</strong>
            </p>
            
            <p>Une fois votre email vérifié, vous aurez accès à :</p>
            <ul>
              <li>✅ Calendrier unifié</li>
              <li>✅ Synchronisation iCal (Airbnb, Booking)</li>
              <li>✅ Gestion des messages</li>
              <li>✅ Livret d'accueil personnalisé</li>
              <li>✅ Gestion du ménage</li>
              <li>✅ Et bien plus encore !</li>
            </ul>
            
            <p>À très bientôt sur Boostinghost ! 🚀</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement par Boostinghost.</p>
            <p>Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Email de vérification envoyé à:', email);
    return true;
  } catch (error) {
    console.error('Erreur envoi email vérification:', error);
    return false;
  }
}
// ============================================
// SERVICE D'EMAILS AUTOMATIQUES - MIS À JOUR
// ============================================

// ============================================
// FONCTION : Vérifier si un email a déjà été envoyé
// ============================================
async function hasEmailBeenSent(userId, emailType) {
  const result = await pool.query(
    `SELECT id FROM email_logs 
     WHERE user_id = $1 AND email_type = $2`,
    [userId, emailType]
  );
  return result.rows.length > 0;
}

// ============================================
// FONCTION : Enregistrer l'envoi d'un email
// ============================================
async function logEmailSent(userId, emailType, emailData = {}) {
  try {
    await pool.query(
      `INSERT INTO email_logs (user_id, email_type, recipient_email, status, sent_at, metadata)
       VALUES ($1, $2, $3, 'sent', NOW(), $4)`,
      [userId, emailType, emailData.email || '', JSON.stringify(emailData)]
    );
  } catch (error) {
    console.error('❌ Erreur logEmailSent:', error.message);
    // Ne pas bloquer si le log échoue
  }
}

// ============================================
// EMAIL 1 : BIENVENUE APRÈS INSCRIPTION
// ============================================
async function sendWelcomeEmail(email, firstName) {
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '🎉 Bienvenue sur Boostinghost !',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .feature { padding: 12px 0; display: flex; align-items: start; }
          .feature-icon { color: #10b981; margin-right: 12px; font-size: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 32px;">🎉 Bienvenue !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Votre compte Boostinghost est maintenant actif !</strong></p>
            
            <p>Pour démarrer, choisissez le plan qui vous convient et profitez de <strong>14 jours d'essai gratuit</strong> sans carte bancaire.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                🚀 Choisir mon plan
              </a>
            </div>
            
            <h3 style="color: #111827; margin-top: 30px;">✨ Nos plans :</h3>
            
            <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 12px 0;">
              <strong>Solo - 14,90€/mois</strong> (1-3 logements)<br>
              <span style="color: #6b7280; font-size: 14px;">Pour propriétaires individuels</span>
            </div>
            
            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 12px 0; border: 2px solid #10b981;">
              <strong>Pro - 49€/mois</strong> (4-15 logements)<br>
              <span style="color: #6b7280; font-size: 14px;">Pour conciergeries</span>
            </div>
            
            <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 12px 0;">
              <strong>Business - 99€/mois</strong> (16-50 logements)<br>
              <span style="color: #6b7280; font-size: 14px;">Pour grosses conciergeries</span>
            </div>
            
            <h3 style="color: #111827; margin-top: 30px;">📦 Tout inclus dans tous les plans :</h3>
            
            <div class="feature">
              <span class="feature-icon">📅</span>
              <div><strong>Calendrier unifié</strong> - Synchronisation iCal Airbnb & Booking</div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">🤖</span>
              <div><strong>Messages automatiques IA</strong> - Réponses intelligentes</div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">🔐</span>
              <div><strong>Serrures connectées</strong> - Codes d'accès Igloohome</div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">🧹</span>
              <div><strong>Gestion du ménage</strong> - Planning et suivi</div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">💰</span>
              <div><strong>Facturation</strong> - Voyageurs & propriétaires</div>
            </div>
            
            <p style="margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              💡 <strong>Besoin d'aide ?</strong><br>
              Notre équipe est là : <a href="mailto:support@boostinghost.com" style="color: #10b981;">support@boostinghost.com</a>
            </p>
            
            <p>À très bientôt sur Boostinghost ! 🚀</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'équipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Boostinghost. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email de bienvenue envoyé à:', email);
}

// ============================================
// EMAIL 2 : ESSAI GRATUIT DÉMARRÉ
// ============================================
async function sendTrialStartedEmail(email, firstName, plan, amount) {
  const planName = plan === 'solo' ? 'Solo' : plan === 'pro' ? 'Pro' : 'Business';
  const price = (amount / 100).toFixed(2);
  
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '🎉 Votre essai gratuit de 14 jours a commencé !',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .card { background: #f0fdf4; padding: 24px; border-radius: 8px; margin: 24px 0; border: 2px solid #10b981; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 32px;">🎉 C'est parti !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Votre essai gratuit du plan ${planName} est maintenant actif pour 14 jours !</strong></p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; color: #047857; font-size: 14px; font-weight: 600;">VOTRE PLAN</p>
              <p style="margin: 0 0 16px 0; font-size: 28px; font-weight: 800; color: #10b981;">Plan ${planName}</p>
              <p style="margin: 0; font-size: 16px; color: #374151;">
                ✨ <strong>14 jours gratuits</strong><br>
                <span style="font-size: 14px; color: #6b7280;">Puis ${price}€/mois</span>
              </p>
            </div>
            
            <p><strong>Profitez de toutes les fonctionnalités sans aucune limitation :</strong></p>
            <ul>
              <li>📅 Calendrier unifié (synchro iCal)</li>
              <li>🤖 Messages automatiques IA</li>
              <li>🔐 Serrures connectées Igloohome</li>
              <li>🧹 Gestion des ménages</li>
              <li>💰 Facturation voyageurs & propriétaires</li>
              <li>🛡️ Cautions & décomptes</li>
              <li>📖 Livrets d'accueil</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                🚀 Accéder à mon espace
              </a>
            </div>
            
            <p style="padding: 16px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
              ⚠️ <strong>Important</strong> : À la fin de l'essai, votre abonnement démarrera automatiquement. Vous pouvez annuler à tout moment depuis vos paramètres.
            </p>
            
            <p style="margin-top: 30px;">Besoin d'aide ? Notre équipe est là : support@boostinghost.com</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'équipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email essai démarré envoyé à:', email);
}

// ============================================
// EMAIL 3 : RAPPEL J-7
// ============================================
async function sendTrialReminder7Days(email, firstName, plan, amount) {
  const planName = plan === 'solo' ? 'Solo' : plan === 'pro' ? 'Pro' : 'Business';
  const price = (amount / 100).toFixed(2);
  
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '⏰ Plus qu\'une semaine d\'essai gratuit',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">⏰ Plus qu'une semaine !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p>Il vous reste <strong>7 jours</strong> d'essai gratuit sur votre plan <strong>${planName}</strong> !</p>
            
            <p>C'est le moment idéal pour :</p>
            <ul>
              <li>✅ Finaliser la configuration de vos logements</li>
              <li>✅ Tester les messages automatiques IA</li>
              <li>✅ Configurer vos serrures connectées</li>
              <li>✅ Organiser votre planning de ménage</li>
            </ul>
            
            <p style="padding: 16px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b; margin: 24px 0;">
              📅 <strong>Dans 7 jours</strong>, votre abonnement passera automatiquement à <strong>${price}€/mois</strong>.<br>
              <span style="font-size: 14px; color: #6b7280;">Vous pouvez annuler ou changer de plan à tout moment.</span>
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/settings-account.html" class="button">
                Gérer mon abonnement
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px;">
              Profitez au maximum de votre semaine restante !
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email rappel J-7 envoyé à:', email);
}

// ============================================
// EMAIL 4 : RAPPEL J-3
// ============================================
async function sendTrialReminder3Days(email, firstName, plan, amount) {
  const planName = plan === 'solo' ? 'Solo' : plan === 'pro' ? 'Pro' : 'Business';
  const price = (amount / 100).toFixed(2);
  
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '🔔 Plus que 3 jours d\'essai gratuit !',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">🔔 Plus que 3 jours !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <div class="alert">
              <strong>⚠️ Attention !</strong><br>
              Votre essai gratuit se termine dans <strong>3 jours</strong>.
            </div>
            
            <p>Votre plan <strong>${planName}</strong> sera automatiquement activé à <strong>${price}€/mois</strong>.</p>
            
            <p><strong>Vous souhaitez :</strong></p>
            <ul>
              <li>✅ Continuer avec ce plan ? Aucune action nécessaire !</li>
              <li>🔄 Changer de plan ? Modifiez-le dès maintenant</li>
              <li>❌ Annuler ? Faites-le avant la fin de l'essai</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/settings-account.html" class="button">
                Gérer mon abonnement
              </a>
            </div>
            
            <p style="padding: 16px; background: #f0fdf4; border-radius: 6px; border-left: 4px solid #10b981;">
              💡 <strong>Vous aimez Boostinghost ?</strong><br>
              Passez à l'année et économisez 17% !
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email rappel J-3 envoyé à:', email);
}

// ============================================
// EMAIL 5 : RAPPEL J-1
// ============================================
async function sendTrialReminder1Day(email, firstName, plan, amount) {
  const planName = plan === 'solo' ? 'Solo' : plan === 'pro' ? 'Pro' : 'Business';
  const price = (amount / 100).toFixed(2);
  
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '🚨 Dernier jour d\'essai gratuit !',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white !important; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; font-size: 18px; }
          .alert { background: #fee2e2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 32px;">🚨 Dernier jour !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <div class="alert">
              <strong style="font-size: 18px;">⏰ Votre essai gratuit se termine demain !</strong><br><br>
              Votre plan <strong>${planName}</strong> sera automatiquement activé à <strong>${price}€/mois</strong>.
            </div>
            
            <p><strong>Vous voulez annuler ?</strong> Faites-le maintenant :</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/settings-account.html" class="button">
                Gérer mon abonnement
              </a>
            </div>
            
            <p style="text-align: center; padding: 20px; background: #f0fdf4; border-radius: 8px; border: 2px solid #10b981;">
              <strong>Vous restez avec nous ? Merci ! 🙏</strong><br>
              <span style="font-size: 14px; color: #6b7280;">Votre paiement de ${price}€ sera effectué automatiquement demain.</span>
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email rappel J-1 envoyé à:', email);
}

// ============================================
// EMAIL 6 : CONFIRMATION D'ABONNEMENT
// ============================================
async function sendSubscriptionConfirmedEmail(email, firstName, plan, amount) {
  const planName = plan === 'solo' ? 'Solo' : plan === 'pro' ? 'Pro' : 'Business';
  const price = (amount / 100).toFixed(2);
  
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '✅ Abonnement confirmé - Merci !',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .card { background: #f0fdf4; padding: 24px; border-radius: 8px; margin: 20px 0; border: 2px solid #10b981; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 32px;">✅ Abonnement confirmé !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Merci pour votre confiance ! 🎉</strong></p>
            
            <p>Votre abonnement Boostinghost est maintenant actif.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; color: #047857; font-size: 14px; font-weight: 600;">VOTRE PLAN</p>
              <p style="margin: 0 0 16px 0; font-size: 28px; font-weight: 800; color: #10b981;">Plan ${planName}</p>
              <p style="margin: 0; font-size: 18px; color: #111827;">
                <strong>${price}€</strong> <span style="font-size: 14px; color: #6b7280;">/ mois</span>
              </p>
            </div>
            
            <p><strong>Vous avez accès à :</strong></p>
            <ul>
              <li>✅ Calendrier unifié (synchro iCal)</li>
              <li>✅ Messages automatiques IA</li>
              <li>✅ Serrures connectées Igloohome</li>
              <li>✅ Gestion des ménages</li>
              <li>✅ Facturation voyageurs & propriétaires</li>
              <li>✅ Cautions & décomptes</li>
              <li>✅ Livrets d'accueil</li>
              <li>✅ Support ${plan === 'business' ? 'téléphone' : plan === 'pro' ? 'prioritaire' : 'email'}</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                Accéder à mon espace
              </a>
            </div>
            
            <p style="padding: 16px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b; margin-top: 30px;">
              💡 <strong>Astuce</strong> : Passez à l'abonnement annuel et économisez 17% (2 mois gratuits) !
            </p>
            
            <p style="margin-top: 30px;">Merci encore et bonne gestion ! 🚀</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'équipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Questions ? Contactez-nous : support@boostinghost.com</p>
            <p>© ${new Date().getFullYear()} Boostinghost. Tous droits réservés.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email confirmation abonnement envoyé à:', email);
}

// ============================================
// EMAIL 7 : RAPPEL AVANT RENOUVELLEMENT
// ============================================
async function sendRenewalReminderEmail(email, firstName, plan, amount, renewalDate) {
  const planName = plan === 'solo' ? 'Solo' : plan === 'pro' ? 'Pro' : 'Business';
  const price = (amount / 100).toFixed(2);
  const formattedDate = new Date(renewalDate).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  
  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: '🔄 Prochain renouvellement dans 3 jours',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #3b82f6; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .card { background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">🔄 Rappel de renouvellement</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p>Votre abonnement <strong>Plan ${planName}</strong> sera automatiquement renouvelé dans <strong>3 jours</strong>.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #1e40af; font-weight: 600;">PROCHAIN PRÉLÈVEMENT</p>
              <p style="margin: 0 0 16px 0; font-size: 32px; font-weight: 800; color: #3b82f6;">${price}€</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Date : <strong>${formattedDate}</strong>
              </p>
            </div>
            
            <p>Aucune action n'est nécessaire de votre part. Le paiement sera effectué automatiquement.</p>
            
            <p style="padding: 16px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
              💡 <strong>Passez à l'année</strong> et économisez 17% (2 mois gratuits) !
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/settings-account.html" class="button">
                Gérer mon abonnement
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              Merci de votre confiance !<br>
              L'équipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Questions ? Contactez-nous : support@boostinghost.com</p>
            <p>© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('✅ Email rappel renouvellement envoyé à:', email);
}

// ============================================
// FIN DU SERVICE D'EMAILS
// ============================================

// ============================================
// ROUTES - MOT DE PASSE OUBLIÉ
// ============================================

// Route : Demander un lien de réinitialisation
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }
    
    const emailLower = email.toLowerCase().trim();
    
    // Vérifier si l'utilisateur existe
    const userResult = await pool.query(
      'SELECT id, first_name, email FROM users WHERE LOWER(email) = $1',
      [emailLower]
    );
    
    if (userResult.rows.length === 0) {
      // Pour des raisons de sécurité, on renvoie toujours le même message
      return res.json({ 
        message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.' 
      });
    }
    
    const user = userResult.rows[0];
    
    // Générer un token de réinitialisation
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000); // 1 heure
    
    // Créer la table si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Stocker le token en DB
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) 
       DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()`,
      [user.id, resetToken, resetExpires]
    );
    
    // Construire le lien de réinitialisation
    const appUrl = (process.env.APP_URL || 'https://lcc-booking-manager.onrender.com').replace(/\/$/, ''); // ✅ Supprimer le slash final
    const resetUrl = `${appUrl}/reset-password.html?token=${resetToken}`;
    
    console.log('📧 Tentative envoi email reset à:', user.email);
    console.log('🔗 Reset URL:', resetUrl);
    console.log('📤 EMAIL_FROM:', process.env.EMAIL_FROM || process.env.EMAIL_USER);
    console.log('🔑 BREVO_API_KEY défini:', !!process.env.BREVO_API_KEY);
    
    // Envoyer l'email via sendEmail (même fonction que les autres emails)
    await sendEmail({
      from: `"Boostinghost" <${(process.env.EMAIL_FROM || process.env.EMAIL_USER || '').replace(/[<>"]/g, '').trim()}>`,
      to: user.email,
      subject: '🔑 Réinitialisation de votre mot de passe - Boostinghost',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #10b981; color: white !important; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; margin: 20px 0; }
            .warning { background: #fef3c7; padding: 16px; border-radius: 6px; border-left: 4px solid #f59e0b; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 26px;">🔑 Réinitialisation de mot de passe</h1>
            </div>
            <div class="content">
              <p>Bonjour <strong>${user.first_name || 'cher utilisateur'}</strong>,</p>
              <p>Vous avez demandé à réinitialiser votre mot de passe Boostinghost.</p>
              <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
              </div>
              <div class="warning">
                <strong>⚠️ Important :</strong>
                <ul style="margin: 8px 0; padding-left: 20px;">
                  <li>Ce lien expire dans <strong>1 heure</strong></li>
                  <li>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email</li>
                  <li>Ne partagez jamais ce lien avec qui que ce soit</li>
                </ul>
              </div>
              <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
                Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
                <a href="${resetUrl}" style="color: #10b981; word-break: break-all;">${resetUrl}</a>
              </p>
            </div>
            <div class="footer">
              <p>Questions ? <a href="mailto:support@boostinghost.com" style="color: #10b981;">support@boostinghost.com</a></p>
              <p>© ${new Date().getFullYear()} Boostinghost</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    
    console.log('✅ Email reset password envoyé à:', user.email);
    
    res.json({ 
      message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.' 
    });
    
  } catch (error) {
    console.error('❌ Erreur forgot password:', error.message);
    console.error('❌ Stack:', error.stack);
    console.error('❌ Détails:', error.response?.body || error.response?.data || error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// Route : Réinitialiser le mot de passe avec le token
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token et nouveau mot de passe requis' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }
    
    // Vérifier le token
    const tokenResult = await pool.query(
      `SELECT user_id, expires_at 
       FROM password_reset_tokens 
       WHERE token = $1`,
      [token]
    );
    
    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Token invalide ou expiré' });
    }
    
    const resetData = tokenResult.rows[0];
    
    // Vérifier si le token a expiré
    if (new Date() > new Date(resetData.expires_at)) {
      return res.status(400).json({ error: 'Token expiré. Veuillez refaire une demande.' });
    }
    
    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Mettre à jour le mot de passe
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashedPassword, resetData.user_id]
    );
    
    // Supprimer le token utilisé
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE token = $1',
      [token]
    );
    
    console.log('✅ Mot de passe réinitialisé pour user:', resetData.user_id);
    
    res.json({ message: 'Mot de passe réinitialisé avec succès' });
    
  } catch (error) {
    console.error('❌ Erreur reset password:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

console.log('✅ Routes mot de passe oublié ajoutées');

// ============================================
// ROUTES API - LIVRET D'ACCUEIL (par user)
// ============================================

function defaultWelcomeData(user) {
  return {
    propertyName: '',
    address: '',
    accessCode: '',
    accessInstructions: '',
    emergencyPhone: '',
    wifiName: '',
    wifiPassword: '',
    wifiNote: '',
    generalNotes: '',
    restaurants: [],
    shops: [],
    photos: []
  };
}

// GET - Livret de l'utilisateur courant
app.get('/api/welcome', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const result = await pool.query(
      'SELECT data FROM welcome_books_v2 WHERE user_id = $1',
      [userId]
    );

    let data;
    if (result.rows.length === 0) {
      // Pas encore de livret pour cet utilisateur → on crée un défaut
      data = defaultWelcomeData(user);

      await pool.query(
        'INSERT INTO welcome_books_v2 (user_id, data, updated_at) VALUES ($1, $2, NOW())',
        [user.id, data]
      );
    } else {
      const rowData = result.rows[0].data;
      data = (rowData && typeof rowData === 'object')
        ? rowData
        : { ...defaultWelcomeData(user), ...(JSON.parse(rowData || '{}')) };
    }

    res.json(data);
  } catch (err) {
    console.error('Erreur /api/welcome GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Sauvegarder le livret
app.post('/api/welcome', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const payload = req.body || {};

    const newData = {
      ...defaultWelcomeData(user),
      ...payload
    };

    await pool.query(
      `INSERT INTO welcome_books_v2 (user_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET data = EXCLUDED.data,
           updated_at = NOW()`,
      [user.id, newData]
    );

    res.json({
      message: 'Livret sauvegardé',
      data: newData
    });
  } catch (err) {
    console.error('Erreur /api/welcome POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API - GESTION DU MENAGE / CLEANERS
// ============================================

// GET - Liste des personnes de ménage de l'utilisateur
app.get('/api/cleaners', authenticateAny, checkSubscription, requirePermission(pool, 'can_view_cleaning'), async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const result = await pool.query(
      `SELECT id, name, phone, email, notes, pin_code, is_active, created_at
       FROM cleaners
       WHERE user_id = $1
       ORDER BY name ASC`,
      [userId]
    );

    res.json({
      cleaners: result.rows
    });
  } catch (err) {
    console.error('Erreur GET /api/cleaners :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer une nouvelle personne de ménage
app.post('/api/cleaners', authenticateAny, requirePermission(pool, 'can_manage_cleaning'), async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { name, phone, email, notes, isActive } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Nom requis' });
    }

    const id = 'c_' + Date.now().toString(36);
    
    // Générer un PIN code unique à 4 chiffres
    let pinCode;
    let isUnique = false;
    while (!isUnique) {
      pinCode = Math.floor(1000 + Math.random() * 9000).toString();
      const existingPin = await pool.query(
        'SELECT id FROM cleaners WHERE pin_code = $1',
        [pinCode]
      );
      if (existingPin.rows.length === 0) {
        isUnique = true;
      }
    }

    const result = await pool.query(
      `INSERT INTO cleaners (id, user_id, name, phone, email, notes, pin_code, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE), NOW())
       RETURNING id, name, phone, email, notes, pin_code, is_active, created_at`,
      [id, userId, name, phone || null, email || null, notes || null, pinCode, isActive]
    );

    res.status(201).json({
      message: 'Membre du ménage créé',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaners :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Modifier une personne de ménage
app.put('/api/cleaners/:id', authenticateAny, requirePermission(pool, 'can_manage_cleaning'), async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { id } = req.params;
    const { name, phone, email, notes, isActive } = req.body || {};

    const result = await pool.query(
      `UPDATE cleaners
       SET
         name = COALESCE($3, name),
         phone = COALESCE($4, phone),
         email = COALESCE($5, email),
         notes = COALESCE($6, notes),
         is_active = COALESCE($7, is_active)
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, phone, email, notes, is_active, created_at`,
      [id, userId, name, phone, email, notes, isActive]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre du ménage introuvable' });
    }

    res.json({
      message: 'Membre du ménage mis à jour',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur PUT /api/cleaners/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une personne de ménage
app.delete('/api/cleaners/:id', authenticateAny, requirePermission(pool, 'can_manage_cleaning'), async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membre du ménage introuvable' });
    }

    res.json({ message: 'Membre du ménage supprimé' });
  } catch (err) {
    console.error('Erreur DELETE /api/cleaners/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.post('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { reservationKey, propertyId, cleanerId } = req.body || {};

    if (!reservationKey || !propertyId) {
      return res.status(400).json({ error: 'reservationKey et propertyId requis' });
    }

    // Si cleanerId vide → on supprime l'assignation
    if (!cleanerId) {
      await pool.query(
        'DELETE FROM cleaning_assignments WHERE user_id = $1 AND reservation_key = $2',
        [user.id, reservationKey]
      );
      return res.json({
        message: 'Assignation ménage supprimée',
        reservationKey
      });
    }

    // Vérifier que le logement appartient bien à l'utilisateur
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé pour cet utilisateur' });
    }

    // Vérifier que le cleaner appartient bien à l'utilisateur
    const cleanerResult = await pool.query(
      `SELECT id, name, email, phone
       FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [cleanerId, user.id]
    );

    if (cleanerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Personne de ménage introuvable pour cet utilisateur' });
    }

    // D'abord, supprimer toute assignation existante pour cette réservation
    await pool.query(
      'DELETE FROM cleaning_assignments WHERE user_id = $1 AND reservation_key = $2',
      [user.id, reservationKey]
    );

    // Puis insérer la nouvelle assignation
    await pool.query(
      `INSERT INTO cleaning_assignments (user_id, property_id, reservation_key, cleaner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [user.id, propertyId, reservationKey, cleanerId]
    );

    // 🔔 ENVOYER NOTIFICATION DE NOUVEAU MÉNAGE
try {
  const { sendNewCleaningNotification } = require('./server/notifications-service');
  
  // Récupérer la date de fin de la réservation depuis la DB
  const resResult = await pool.query(
    'SELECT end_date FROM reservations WHERE uid = $1 OR id::text = $1',
    [reservationKey]
  );
  
  if (resResult.rows.length > 0) {
    const cleaningDate = resResult.rows[0].end_date;
    
    await sendNewCleaningNotification(
      user.id,
      reservationKey,
      property.name,
      cleanerResult.rows[0].name,
      cleaningDate
    );
    
    console.log(`✅ Notification ménage envoyée à ${user.id}`);
  }
} catch (notifError) {
  console.error('❌ Erreur notification ménage:', notifError.message);
}
    res.json({
      message: 'Assignation ménage enregistrée',
      assignment: {
        reservationKey,
        propertyId,
        cleanerId
      }
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaning/assignments :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer / mettre à jour / supprimer une assignation
app.post('/api/cleaning/assignments', 
  authenticateAny,
  requirePermission(pool, 'can_assign_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    // ✅ Support des sous-comptes
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { reservationKey, propertyId, cleanerId } = req.body || {};

    if (!reservationKey || !propertyId) {
      return res.status(400).json({ error: 'reservationKey et propertyId requis' });
    }

    // ✅ Vérifier accès propriété si sous-compte
    if (req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0) {
      if (!req.subAccountData.accessible_property_ids.includes(propertyId)) {
        return res.status(403).json({ error: 'Accès refusé à cette propriété' });
      }
    }

    // Si cleanerId vide → on supprime l'assignation
    if (!cleanerId) {
      await pool.query(
        'DELETE FROM cleaning_assignments WHERE user_id = $1 AND reservation_key = $2',
        [userId, reservationKey]
      );
      return res.json({
        message: 'Assignation ménage supprimée',
        reservationKey
      });
    }

    // Vérifier que le logement appartient bien à l'utilisateur
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé pour cet utilisateur' });
    }

    // Vérifier que le cleaner appartient bien à l'utilisateur
    const cleanerResult = await pool.query(
      `SELECT id, name, email, phone
       FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [cleanerId, userId]
    );

    if (cleanerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Personne de ménage introuvable pour cet utilisateur' });
    }

    // D'abord, supprimer toute assignation existante pour cette réservation
    await pool.query(
      'DELETE FROM cleaning_assignments WHERE user_id = $1 AND reservation_key = $2',
      [userId, reservationKey]
    );

    // Puis insérer la nouvelle assignation
    await pool.query(
      `INSERT INTO cleaning_assignments (user_id, property_id, reservation_key, cleaner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [userId, propertyId, reservationKey, cleanerId]
    );

    res.json({
      message: 'Assignation ménage enregistrée',
      assignment: {
        reservationKey,
        propertyId,
        cleanerId
      }
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaning/assignments :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - CHECKLISTS MENAGE
// ============================================

// GET - Liste des tâches pour une personne de ménage (accès via PIN)
app.get('/api/cleaning/tasks/:pinCode', async (req, res) => {
  try {
    const { pinCode } = req.params;
    
    // Vérifier le PIN et récupérer le cleaner
    const cleanerResult = await pool.query(
      'SELECT id, user_id, name FROM cleaners WHERE pin_code = $1 AND is_active = TRUE',
      [pinCode]
    );
    
    if (cleanerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Code PIN invalide' });
    }
    
    const cleaner = cleanerResult.rows[0];
    
    // Récupérer les assignations PAR RÉSERVATION de ce cleaner
    const assignmentsResult = await pool.query(
      'SELECT reservation_key, property_id FROM cleaning_assignments WHERE cleaner_id = $1',
      [cleaner.id]
    );
    
    if (assignmentsResult.rows.length === 0) {
      return res.json({ tasks: [], cleaner: { id: cleaner.id, name: cleaner.name } });
    }
    
    const todayStr = new Date().toISOString().slice(0, 10);
    
    // Construire la liste des tâches uniquement pour les réservations assignées
    const tasks = [];
    
    for (const assignment of assignmentsResult.rows) {
      const { reservation_key, property_id } = assignment;
      console.log('🔍 Assignment:', { reservation_key, property_id });
  console.log('🔍 reservationsStore.properties[property_id]:', reservationsStore.properties[property_id]);
      
      // Vérifier si c'est une assignation par réservation (nouveau système)
if (reservation_key && reservation_key !== null) {
  const parts = reservation_key.split('_');
  if (parts.length < 3) continue;
  
  // Le dernier élément est endDate, l'avant-dernier est startDate
  // Tout ce qui est avant est le propertyId
  const endDate = parts[parts.length - 1];
  const startDate = parts[parts.length - 2];
  const keyPropertyId = parts.slice(0, parts.length - 2).join('_');
  
  console.log('🔍 Parsed:', { keyPropertyId, startDate, endDate });
  
  // Ne garder que les réservations avec départ futur ou aujourd'hui
  if (endDate < todayStr) continue;
  
  // Trouver la réservation complète dans reservationsStore
  const propertyReservations = reservationsStore.properties[property_id] || [];
  const reservation = propertyReservations.find(r => {
    const rKey = `${property_id}_${r.start}_${r.end}`;
    return rKey === reservation_key;
  });
  
  // Récupérer le nom du logement depuis PROPERTIES
const property = PROPERTIES.find(p => p.id === property_id);
const propertyName = property?.name || property?.title || property?.label || property_id;
  const guestName = reservation?.guestName || reservation?.name || '';
  
  tasks.push({
    reservationKey: reservation_key,
    propertyId: property_id,
    propertyName,
    guestName,
    checkoutDate: endDate,
    completed: false
  });
}
      // Sinon, c'est une ancienne assignation par logement
      else if (property_id) {
        // Récupérer toutes les réservations de ce logement
        const propertyReservations = reservationsStore.properties[property_id] || [];
        propertyReservations.forEach(r => {
          if (!r.end) return;
          const endStr = String(r.end).slice(0, 10);
          if (endStr < todayStr) return;
          
          const reservationKey = `${property_id}_${r.start}_${r.end}`;
          const propertyName = r.propertyName || (r.property && r.property.name) || property_id;
          const guestName = r.guestName || r.name || '';
          
          tasks.push({
            reservationKey,
            propertyId: property_id,
            propertyName,
            guestName,
            checkoutDate: endStr,
            completed: false
          });
        });
      }
    }
    
    // Vérifier quelles checklists existent déjà
    const existingChecklists = await pool.query(
      `SELECT reservation_key, completed_at 
       FROM cleaning_checklists 
       WHERE cleaner_id = $1`,
      [cleaner.id]
    );
    
    const completedKeys = new Set(existingChecklists.rows.map(c => c.reservation_key));
    
    // Marquer les tâches complétées
    tasks.forEach(task => {
      task.completed = completedKeys.has(task.reservationKey);
    });
    
    // Trier par date de départ
    tasks.sort((a, b) => a.checkoutDate.localeCompare(b.checkoutDate));
    
    res.json({
      cleaner: { id: cleaner.id, name: cleaner.name },
      tasks
    });
  } catch (err) {
    console.error('Erreur GET /api/cleaning/tasks/:pinCode :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// POST - Soumettre une checklist complétée (avec timer + notification propriétaire)
app.post('/api/cleaning/checklist', async (req, res) => {
  try {
    const { pinCode, reservationKey, propertyId, tasks, photos, notes, duration, startedAt, completedAt } = req.body;
    
    if (!pinCode || !reservationKey || !propertyId) {
      return res.status(400).json({ error: 'Données manquantes' });
    }
    
    // Vérifier le PIN
    const cleanerResult = await pool.query(
      'SELECT id, user_id, name FROM cleaners WHERE pin_code = $1 AND is_active = TRUE',
      [pinCode]
    );
    
    if (cleanerResult.rows.length === 0) {
      return res.status(401).json({ error: 'Code PIN invalide' });
    }
    
    const cleaner = cleanerResult.rows[0];
    
    // Vérifier les photos (minimum 5)
    if (!photos || photos.length < 5) {
      return res.status(400).json({ error: 'Minimum 5 photos requises' });
    }
    
    // Vérifier que toutes les tâches sont cochées
    const allChecked = tasks && tasks.every(t => t.checked === true);
    if (!allChecked) {
      return res.status(400).json({ error: 'Toutes les tâches doivent être complétées' });
    }
    
    // Extraire la date de fin depuis reservation_key
    const parts = reservationKey.split('_');
    const checkoutDate = parts.length >= 2 ? parts[parts.length - 1] : null;

    // Récupérer les infos de la réservation depuis reservationsStore
    let reservation = null;
    const propertyReservations = reservationsStore.properties[propertyId] || [];
    
    // Stratégie 1 : match exact par clé
    reservation = propertyReservations.find(r => {
      const rKey = `${propertyId}_${r.start}_${r.end}`;
      return rKey === reservationKey;
    });
    
    // Stratégie 2 : match par date de checkout
    if (!reservation && checkoutDate) {
      reservation = propertyReservations.find(r => {
        const rEnd = String(r.end || '').slice(0, 10);
        return rEnd === checkoutDate;
      });
    }
    
    // Stratégie 3 : match par reservation_key partiel
    if (!reservation) {
      reservation = propertyReservations.find(r => {
        const rKey1 = `${propertyId}_${String(r.start).slice(0,10)}_${String(r.end).slice(0,10)}`;
        const rKey2 = `${propertyId}_${r.start}_${r.end}`;
        return rKey1 === reservationKey || rKey2 === reservationKey || 
               reservationKey.includes(String(r.end).slice(0,10));
      });
    }

    const guestName = reservation ? (reservation.guestName || reservation.name || reservation.guest_name || '') : '';
    console.log(`🧹 Checklist POST — propertyId: ${propertyId}, checkout: ${checkoutDate}, guestName: "${guestName}", match: ${!!reservation}`);
    
    // Insérer ou mettre à jour la checklist (avec duration + started_at + owner_status)
    const result = await pool.query(
      `INSERT INTO cleaning_checklists 
       (user_id, property_id, reservation_key, cleaner_id, guest_name, checkout_date, 
        tasks, photos, notes, duration_seconds, started_at, completed_at, 
        owner_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 'pending', NOW(), NOW())
       ON CONFLICT (reservation_key) 
       DO UPDATE SET
         tasks = EXCLUDED.tasks,
         photos = EXCLUDED.photos,
         notes = EXCLUDED.notes,
         duration_seconds = EXCLUDED.duration_seconds,
         started_at = EXCLUDED.started_at,
         completed_at = NOW(),
         owner_status = 'pending',
         updated_at = NOW()
       RETURNING id`,
      [
        cleaner.user_id, propertyId, reservationKey, cleaner.id, 
        guestName, checkoutDate,
        JSON.stringify(tasks), JSON.stringify(photos), notes,
        duration || null,
        startedAt || null
      ]
    );

    const checklistId = result.rows[0].id;

    // ============================
    // 🔔 NOTIFICATION AU PROPRIÉTAIRE
    // ============================
    try {
      const property = PROPERTIES.find(p => p.id === propertyId);
      const propertyName = property?.name || property?.title || propertyId;
      const durationMin = duration ? Math.round(duration / 60) : null;

      // ✅ Notification push Firebase — envoi direct sur TOUS les appareils du propriétaire
      try {
        const tokensResult = await pool.query(
          'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
          [cleaner.user_id]
        );

        if (tokensResult.rows.length > 0 && await shouldSendNotification(cleaner.user_id, 'notif_cleaning_completed')) {
          const title = `🧹 Ménage terminé — ${propertyName}`;
          const body = `${cleaner.name} a terminé le ménage${durationMin ? ' en ' + durationMin + ' min' : ''}. ${photos ? photos.length : 0} photos. À valider !`;
          const pushData = {
            type: 'cleaning_completed',
            checklistId: String(checklistId),
            propertyId: propertyId,
            click_action: '/app.html'
          };

          // ✅ GROUPER TOUS LES TOKENS
          const fcmTokens = tokensResult.rows.map(row => row.fcm_token);
          
          try {
            await sendNotificationToMultiple(fcmTokens, title, body, pushData);
            console.log(`📱 Push ménage groupé envoyé à ${fcmTokens.length} appareil(s) de ${cleaner.user_id}`);
          } catch (pushErr) {
            console.error(`❌ Push ménage échoué:`, pushErr.message);
          }
        } else {
          console.log(`ℹ️ Pas de token FCM pour user ${cleaner.user_id} — pas de push envoyé`);
        }
      } catch (pushErr) {
        console.error('❌ Erreur push Firebase ménage:', pushErr.message);
      }

      // ✅ Émettre événement Socket.IO temps réel (toast dans l'app web)
      if (typeof io !== 'undefined' && io) {
        io.to(`user_${cleaner.user_id}`).emit('cleaning:completed', {
          checklistId,
          propertyId,
          propertyName,
          cleanerName: cleaner.name,
          duration: duration || null
        });
        console.log(`🔌 Socket cleaning:completed émis vers user_${cleaner.user_id}`);
      }
    } catch (notifErr) {
      console.error('Erreur notification ménage terminé:', notifErr);
    }
    
    res.json({
      message: 'Checklist enregistrée avec succès',
      checklistId
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaning/checklist :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// GET - Détails d'une checklist spécifique
app.get('/api/cleaning/checklists/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        cc.*,
        c.name as cleaner_name,
        c.email as cleaner_email,
        c.phone as cleaner_phone
       FROM cleaning_checklists cc
       LEFT JOIN cleaners c ON c.id = cc.cleaner_id
       WHERE cc.id = $1 AND cc.user_id = $2`,
      [id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist non trouvée' });
    }

    res.json({
      checklist: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur GET /api/cleaning/checklists/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// GET - Récupérer une checklist par reservation_key
app.get('/api/cleaning/checklist/:reservationKey', async (req, res) => {
  try {
    const { reservationKey } = req.params;
    
    const result = await pool.query(
      `SELECT 
        cc.*,
        c.name as cleaner_name
       FROM cleaning_checklists cc
       LEFT JOIN cleaners c ON c.id = cc.cleaner_id
       WHERE cc.reservation_key = $1`,
      [reservationKey]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist non trouvée' });
    }
    
    res.json({ checklist: result.rows[0] });
  } catch (err) {
    console.error('Erreur GET /api/cleaning/checklist/:reservationKey :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// GET - Liste des checklists pour un utilisateur
app.get('/api/cleaning/checklists', 
  authenticateAny,
  requirePermission(pool, 'can_view_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const result = await pool.query(
      `SELECT 
        cc.*,
        c.name as cleaner_name,
        c.email as cleaner_email,
        
        -- Enrichissement guest depuis conversations (onboarding)
        COALESCE(
          NULLIF(TRIM(COALESCE(conv.guest_first_name, '') || ' ' || COALESCE(conv.guest_last_name, '')), ''),
          NULLIF(cc.guest_name, ''),
          r.guest_name,
          'Voyageur'
        ) as guest_display_name,
        
        conv.guest_first_name,
        conv.guest_last_name,
        conv.guest_phone,
        
        CASE 
          WHEN conv.guest_first_name IS NOT NULL AND conv.guest_first_name != ''
          THEN LEFT(UPPER(conv.guest_first_name), 1)
          WHEN cc.guest_name IS NOT NULL AND cc.guest_name != ''
          THEN LEFT(UPPER(cc.guest_name), 1)
          WHEN r.guest_name IS NOT NULL AND r.guest_name != ''
          THEN LEFT(UPPER(r.guest_name), 1)
          ELSE 'V'
        END as guest_initial,
        
        r.source as platform

       FROM cleaning_checklists cc
       LEFT JOIN cleaners c ON c.id = cc.cleaner_id
       LEFT JOIN reservations r ON r.property_id = cc.property_id 
         AND r.end_date::date = cc.checkout_date::date
         AND r.user_id = cc.user_id
       LEFT JOIN conversations conv ON conv.property_id = cc.property_id
         AND conv.reservation_start_date::date = r.start_date::date
         AND conv.user_id = cc.user_id
       WHERE cc.user_id = $1
       ORDER BY cc.completed_at DESC
       LIMIT 50`,
      [userId]
    );

    // ✅ Filtrer par propriétés si sous-compte
    const filteredChecklists = req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0
      ? result.rows.filter(c => req.subAccountData.accessible_property_ids.includes(c.property_id))
      : result.rows;

    // ✅ Enrichir avec les noms de voyageurs depuis reservationsStore
    const enrichedChecklists = filteredChecklists.map(cl => {
      // Si guest_name déjà rempli, on garde
      if (cl.guest_name && cl.guest_name.trim() !== '') return cl;

      // Chercher la réservation correspondante dans le store
      const propertyReservations = reservationsStore.properties[cl.property_id] || [];
      const checkoutStr = cl.checkout_date ? String(cl.checkout_date).slice(0, 10) : '';
      
      const match = propertyReservations.find(r => {
        const rEnd = String(r.end || '').slice(0, 10);
        return rEnd === checkoutStr;
      });

      if (match) {
        cl.guest_name = match.guestName || match.name || '';
        cl.guest_first_name = match.guest_first_name || '';
        cl.guest_last_name = match.guest_last_name || '';
        cl.source = match.source || match.platform || '';
        cl.platform = match.platform || match.source || '';
      }

      return cl;
    });

    res.json({
      checklists: enrichedChecklists
    });
  } catch (err) {
    console.error('Erreur GET /api/cleaning/checklists :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTE GET : Récupérer les assignations de ménage
// ============================================
app.get('/api/cleaning/assignments', 
  authenticateAny,
  requirePermission(pool, 'can_view_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    // ✅ Support des sous-comptes
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    
    const result = await pool.query(
      `SELECT 
        ca.*,
        c.name as cleaner_name,
        c.phone as cleaner_phone,
        c.email as cleaner_email
      FROM cleaning_assignments ca
      LEFT JOIN cleaners c ON ca.cleaner_id = c.id
      WHERE ca.user_id = $1
      ORDER BY ca.created_at DESC`,
      [userId]
    );

    // Enrichir avec les infos des properties depuis PROPERTIES (en mémoire)
    const enrichedAssignments = result.rows.map(assignment => {
      const property = PROPERTIES.find(p => p.id === assignment.property_id);
      return {
        ...assignment,
        property_name: property?.name || 'Logement inconnu',
        property_color: property?.color || '#999999'
      };
    });

    // ✅ Filtrer par propriétés accessibles si sous-compte
    const filteredAssignments = filterByAccessibleProperties(enrichedAssignments, req);

    res.json({ 
      success: true, 
      assignments: filteredAssignments 
    });
  } catch (error) {
    console.error('Erreur GET /api/cleaning/assignments:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// ============================================
// 🧹 NOUVELLES ROUTES MÉNAGE — Templates, Validation, Stats, QR
// ============================================

// GET /api/cleaning/template/:propertyId — Récupérer le template pour un logement (accès cleaner par PIN)
app.get('/api/cleaning/template/:propertyId', async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { pin } = req.query;

    if (!pin) {
      return res.status(400).json({ error: 'PIN requis' });
    }

    const cleanerResult = await pool.query(
      'SELECT user_id FROM cleaners WHERE pin_code = $1 AND is_active = TRUE',
      [pin]
    );

    if (cleanerResult.rows.length === 0) {
      return res.status(404).json({ error: 'PIN invalide' });
    }

    const userId = cleanerResult.rows[0].user_id;

    // 1) Template spécifique au logement
    let template = await pool.query(
      `SELECT * FROM cleaning_templates 
       WHERE user_id = $1 AND property_id = $2 
       ORDER BY updated_at DESC LIMIT 1`,
      [userId, propertyId]
    );

    // 2) Template par défaut
    if (template.rows.length === 0) {
      template = await pool.query(
        `SELECT * FROM cleaning_templates 
         WHERE user_id = $1 AND is_default = TRUE 
         ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );
    }

    // 3) N'importe quel template global
    if (template.rows.length === 0) {
      template = await pool.query(
        `SELECT * FROM cleaning_templates 
         WHERE user_id = $1 AND property_id IS NULL 
         ORDER BY updated_at DESC LIMIT 1`,
        [userId]
      );
    }

    if (template.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun template trouvé' });
    }

    const t = template.rows[0];
    const tasks = typeof t.tasks === 'string' ? JSON.parse(t.tasks) : (t.tasks || []);

    res.json({
      templateId: t.id,
      name: t.name,
      propertyId: t.property_id,
      tasks
    });

  } catch (err) {
    console.error('Erreur GET /api/cleaning/template/:propertyId :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cleaning/templates — Créer ou modifier un template
app.post('/api/cleaning/templates',
  authenticateAny,
  requirePermission(pool, 'can_manage_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const { propertyId, name, tasks, isDefault, templateId } = req.body;

      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        return res.status(400).json({ error: 'La liste de tâches est requise' });
      }

      const sanitizedTasks = tasks.map((t, i) => ({
        id: t.id || `task_${i}`,
        name: t.name || t.title || 'Tâche sans nom',
        room: t.room || t.category || 'general'
      }));

      let result;

      if (templateId) {
        result = await pool.query(
          `UPDATE cleaning_templates 
           SET name = $1, tasks = $2, property_id = $3, is_default = $4, updated_at = NOW()
           WHERE id = $5 AND user_id = $6
           RETURNING *`,
          [name || 'Template ménage', JSON.stringify(sanitizedTasks), propertyId || null, isDefault || false, templateId, userId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Template non trouvé' });
        }
      } else {
        if (isDefault) {
          await pool.query(
            'UPDATE cleaning_templates SET is_default = FALSE WHERE user_id = $1',
            [userId]
          );
        }

        result = await pool.query(
          `INSERT INTO cleaning_templates (user_id, property_id, name, tasks, is_default)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, propertyId || null, name || 'Template ménage', JSON.stringify(sanitizedTasks), isDefault || false]
        );
      }

      res.status(201).json({ success: true, template: result.rows[0] });

    } catch (err) {
      console.error('Erreur POST /api/cleaning/templates :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/cleaning/templates — Lister les templates
app.get('/api/cleaning/templates',
  authenticateAny,
  requirePermission(pool, 'can_view_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const { propertyId } = req.query;

      let query = `SELECT * FROM cleaning_templates WHERE user_id = $1`;
      const params = [userId];

      if (propertyId) {
        query += ` AND (property_id = $2 OR property_id IS NULL)`;
        params.push(propertyId);
      }

      query += ` ORDER BY is_default DESC, updated_at DESC`;

      const result = await pool.query(query, params);

      res.json({ success: true, templates: result.rows });

    } catch (err) {
      console.error('Erreur GET /api/cleaning/templates :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// DELETE /api/cleaning/templates/:id — Supprimer un template
app.delete('/api/cleaning/templates/:id',
  authenticateAny,
  requirePermission(pool, 'can_manage_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const { id } = req.params;

      const result = await pool.query(
        'DELETE FROM cleaning_templates WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Template non trouvé' });
      }

      res.json({ success: true, deleted: id });

    } catch (err) {
      console.error('Erreur DELETE /api/cleaning/templates/:id :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PUT /api/cleaning/checklists/:id/validate — Validation propriétaire
app.put('/api/cleaning/checklists/:id/validate',
  authenticateAny,
  requirePermission(pool, 'can_manage_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const { id } = req.params;

      const result = await pool.query(
        `UPDATE cleaning_checklists 
         SET owner_status = 'validated', 
             owner_validated_at = NOW(), 
             is_validated = TRUE,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Checklist non trouvée' });
      }

      if (typeof io !== 'undefined' && io) {
        io.to(`user_${userId}`).emit('cleaning:validated', {
          checklistId: id,
          propertyId: result.rows[0].property_id
        });
      }

      console.log(`✅ Checklist ${id} validée par propriétaire ${userId}`);

      res.json({ success: true, checklist: result.rows[0] });

    } catch (err) {
      console.error('Erreur PUT /api/cleaning/checklists/:id/validate :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PUT /api/cleaning/checklists/:id/reject — Demande de complément
app.put('/api/cleaning/checklists/:id/reject',
  authenticateAny,
  requirePermission(pool, 'can_manage_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const { id } = req.params;
      const { notes } = req.body;

      const result = await pool.query(
        `UPDATE cleaning_checklists 
         SET owner_status = 'rejected', 
             owner_notes = $3,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId, notes || 'Merci de compléter le ménage']
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Checklist non trouvée' });
      }

      const checklist = result.rows[0];
      console.log(`⚠️ Checklist ${id} rejetée — complément demandé pour ${checklist.property_id}`);

      // Notifier le cleaner
      try {
        const cleanerResult = await pool.query(
          'SELECT email, phone, name FROM cleaners WHERE id = $1',
          [checklist.cleaner_id]
        );
        if (cleanerResult.rows.length > 0) {
          const cleaner = cleanerResult.rows[0];
          const property = PROPERTIES.find(p => p.id === checklist.property_id);
          const propertyName = property?.name || checklist.property_id;

          if (cleaner.email) {
            const subject = `⚠️ Complément demandé — ${propertyName}`;
            const htmlBody = `
              <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
                <h2 style="color: #f59e0b;">⚠️ Complément de ménage demandé</h2>
                <p>Bonjour <strong>${cleaner.name}</strong>,</p>
                <p>Le propriétaire demande un complément pour le ménage de <strong>${propertyName}</strong>.</p>
                ${notes ? `<div style="padding:12px 16px; background:#fef3c7; border-radius:8px; margin:16px 0;"><strong>Message :</strong> ${notes}</div>` : ''}
                <p>Merci de repasser dès que possible.</p>
              </div>
            `;

            const useBrevo = !!process.env.BREVO_API_KEY;
            if (useBrevo) {
              await sendEmailViaBrevo({ to: cleaner.email, subject, text: '', html: htmlBody });
            } else {
              const transporter = getEmailTransporter();
              if (transporter) {
                await transporter.sendMail({
                  from: process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>',
                  to: cleaner.email,
                  subject,
                  html: htmlBody
                });
              }
            }
            console.log(`📧 Notification de rejet envoyée à ${cleaner.email}`);
          }
        }
      } catch (notifErr) {
        console.error('Erreur notification rejet:', notifErr);
      }

      res.json({ success: true, checklist: result.rows[0] });

    } catch (err) {
      console.error('Erreur PUT /api/cleaning/checklists/:id/reject :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/cleaning/stats — Statistiques ménage
app.get('/api/cleaning/stats',
  authenticateAny,
  requirePermission(pool, 'can_view_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const { period } = req.query;

      let dateFilter = '';
      if (period === 'week') {
        dateFilter = `AND cc.completed_at >= NOW() - INTERVAL '7 days'`;
      } else if (period === 'month') {
        dateFilter = `AND cc.completed_at >= NOW() - INTERVAL '30 days'`;
      } else {
        dateFilter = `AND cc.completed_at >= NOW() - INTERVAL '365 days'`;
      }

      const globalStats = await pool.query(`
        SELECT 
          COUNT(*) as total_checklists,
          COUNT(CASE WHEN owner_status = 'validated' THEN 1 END) as validated,
          COUNT(CASE WHEN owner_status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN owner_status = 'rejected' THEN 1 END) as rejected,
          AVG(duration_seconds) as avg_duration,
          MIN(duration_seconds) as min_duration,
          MAX(duration_seconds) as max_duration
        FROM cleaning_checklists cc
        WHERE cc.user_id = $1 ${dateFilter}
      `, [userId]);

      const cleanerStats = await pool.query(`
        SELECT 
          c.id as cleaner_id,
          c.name as cleaner_name,
          COUNT(cc.id) as total,
          AVG(cc.duration_seconds) as avg_duration,
          COUNT(CASE WHEN cc.owner_status = 'validated' THEN 1 END) as validated,
          COUNT(CASE WHEN cc.owner_status = 'rejected' THEN 1 END) as rejected
        FROM cleaning_checklists cc
        LEFT JOIN cleaners c ON c.id = cc.cleaner_id
        WHERE cc.user_id = $1 ${dateFilter}
        GROUP BY c.id, c.name
        ORDER BY total DESC
      `, [userId]);

      const propertyStats = await pool.query(`
        SELECT 
          cc.property_id,
          COUNT(cc.id) as total,
          AVG(cc.duration_seconds) as avg_duration
        FROM cleaning_checklists cc
        WHERE cc.user_id = $1 ${dateFilter}
        GROUP BY cc.property_id
        ORDER BY total DESC
      `, [userId]);

      const enrichedPropertyStats = propertyStats.rows.map(row => {
        const property = PROPERTIES.find(p => p.id === row.property_id);
        return {
          ...row,
          property_name: property?.name || property?.title || row.property_id,
          avg_duration_min: row.avg_duration ? Math.round(row.avg_duration / 60) : null
        };
      });

      const global = globalStats.rows[0] || {};

      res.json({
        success: true,
        stats: {
          total: parseInt(global.total_checklists) || 0,
          validated: parseInt(global.validated) || 0,
          pending: parseInt(global.pending) || 0,
          rejected: parseInt(global.rejected) || 0,
          avgDurationMin: global.avg_duration ? Math.round(global.avg_duration / 60) : null,
          minDurationMin: global.min_duration ? Math.round(global.min_duration / 60) : null,
          maxDurationMin: global.max_duration ? Math.round(global.max_duration / 60) : null,
          validationRate: global.total_checklists > 0
            ? Math.round((global.validated / global.total_checklists) * 100) : 0,
          byCleaner: cleanerStats.rows.map(r => ({
            ...r,
            avg_duration_min: r.avg_duration ? Math.round(r.avg_duration / 60) : null
          })),
          byProperty: enrichedPropertyStats
        }
      });

    } catch (err) {
      console.error('Erreur GET /api/cleaning/stats :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============================================
// 🧹 CLEANER PAR DÉFAUT PAR LOGEMENT
// ============================================

// GET /api/cleaning/default-cleaners — Liste des cleaners par défaut par logement
app.get('/api/cleaning/default-cleaners',
  authenticateAny,
  requirePermission(pool, 'can_view_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;
      if (!userId) return res.status(401).json({ error: 'Non autorisé' });

      const result = await pool.query(
        `SELECT pdc.property_id, pdc.cleaner_id, c.name as cleaner_name, c.pin_code
         FROM property_default_cleaners pdc
         LEFT JOIN cleaners c ON c.id = pdc.cleaner_id
         WHERE pdc.user_id = $1`,
        [userId]
      );

      // Retourner en format map { propertyId: { cleanerId, cleanerName, pinCode } }
      const defaults = {};
      result.rows.forEach(row => {
        defaults[row.property_id] = {
          cleanerId: row.cleaner_id,
          cleanerName: row.cleaner_name,
          pinCode: row.pin_code
        };
      });

      res.json({ success: true, defaults });
    } catch (err) {
      console.error('Erreur GET /api/cleaning/default-cleaners:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PUT /api/cleaning/default-cleaner/:propertyId — Définir ou supprimer le cleaner par défaut
app.put('/api/cleaning/default-cleaner/:propertyId',
  authenticateAny,
  requirePermission(pool, 'can_manage_cleaning'),
  loadSubAccountData(pool),
  async (req, res) => {
    try {
      const userId = req.user.isSubAccount
        ? (await getRealUserId(pool, req))
        : (await getUserFromRequest(req))?.id;
      if (!userId) return res.status(401).json({ error: 'Non autorisé' });

      const { propertyId } = req.params;
      const { cleanerId } = req.body;

      // Vérifier que le logement existe
      const property = PROPERTIES.find(p => p.id === propertyId && p.userId === userId);
      if (!property) {
        return res.status(404).json({ error: 'Logement non trouvé' });
      }

      if (!cleanerId) {
        // Supprimer le cleaner par défaut
        await pool.query(
          'DELETE FROM property_default_cleaners WHERE user_id = $1 AND property_id = $2',
          [userId, propertyId]
        );
        console.log(`🧹 Cleaner par défaut supprimé pour ${propertyId}`);
        return res.json({ success: true, message: 'Cleaner par défaut supprimé' });
      }

      // Vérifier que le cleaner existe et appartient à l'utilisateur
      const cleanerResult = await pool.query(
        'SELECT id, name FROM cleaners WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
        [cleanerId, userId]
      );
      if (cleanerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Personne de ménage introuvable' });
      }

      // Upsert
      await pool.query(
        `INSERT INTO property_default_cleaners (user_id, property_id, cleaner_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, property_id)
         DO UPDATE SET cleaner_id = $3, updated_at = NOW()`,
        [userId, propertyId, cleanerId]
      );

      console.log(`✅ Cleaner par défaut pour ${propertyId}: ${cleanerResult.rows[0].name}`);

      res.json({
        success: true,
        message: 'Cleaner par défaut défini',
        default: {
          propertyId,
          cleanerId,
          cleanerName: cleanerResult.rows[0].name
        }
      });
    } catch (err) {
      console.error('Erreur PUT /api/cleaning/default-cleaner:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/cleaning/qr/:propertyId — Données QR code
app.get('/api/cleaning/qr/:propertyId',
  authenticateAny,
  requirePermission(pool, 'can_manage_cleaning'),
  async (req, res) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Non autorisé' });

      const { propertyId } = req.params;

      const property = PROPERTIES.find(
        p => p.id === propertyId && p.userId === user.id
      );

      if (!property) {
        return res.status(404).json({ error: 'Logement non trouvé' });
      }

      // Trouver le cleaner assigné pour le PIN
      const assignment = await pool.query(
        `SELECT ca.cleaner_id, c.pin_code, c.name
         FROM cleaning_assignments ca
         LEFT JOIN cleaners c ON c.id = ca.cleaner_id
         WHERE ca.user_id = $1 AND ca.property_id = $2
         LIMIT 1`,
        [user.id, propertyId]
      );

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      let qrUrl = `${baseUrl}/cleaning-tasks.html`;
      
      if (assignment.rows.length > 0 && assignment.rows[0].pin_code) {
        qrUrl += `?pin=${assignment.rows[0].pin_code}`;
      }

      res.json({
        success: true,
        propertyId,
        propertyName: property.name || property.title || propertyId,
        qrUrl,
        cleanerName: assignment.rows[0]?.name || null,
        pinCode: assignment.rows[0]?.pin_code || null
      });

    } catch (err) {
      console.error('Erreur GET /api/cleaning/qr/:propertyId :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============================================
// ROUTES API - GESTION DES LOGEMENTS (par user)

// ============================================
// ROUTES API - SERRURES CONNECTÉES
// ============================================
app.use('/api/smart-locks', 
  authenticateAny, 
  requirePermission(pool, 'can_view_smart_locks'),
  smartLocksRoutes
);
// ============================================

app.get('/api/properties', 
  authenticateAny, 
  checkSubscription, 
  requirePermission(pool, 'can_view_properties'),
  async (req, res) => {
  try {
    // ✅ GESTION DES SOUS-COMPTES
    let userId;
    let accessiblePropertyIds = null;
    
    if (req.user.isSubAccount) {
      // C'est un sous-compte
      console.log('🔐 Sous-compte détecté:', req.user.subAccountId);
      
      // Récupérer le parent_user_id
      const subAccountResult = await pool.query(
        'SELECT parent_user_id FROM sub_accounts WHERE id = $1 AND is_active = TRUE',
        [req.user.subAccountId]
      );
      
      if (subAccountResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sous-compte introuvable' });
      }
      
      userId = subAccountResult.rows[0].parent_user_id;
      
      // Récupérer les propriétés accessibles
      const accessResult = await pool.query(
        'SELECT property_id FROM sub_account_properties WHERE sub_account_id = $1',
        [req.user.subAccountId]
      );
      
      accessiblePropertyIds = accessResult.rows.map(r => r.property_id);
      console.log('🏠 Propriétés accessibles:', accessiblePropertyIds);
      
    } else {
      // C'est un compte principal
      const user = await getUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ error: 'Non autorisé' });
      }
      userId = user.id;
    }
    
    // Charger les propriétés du compte parent
    console.log('🔍 userId pour getUserProperties:', userId);
    console.log('🔍 PROPERTIES total en mémoire:', PROPERTIES.length);
    let userProps = getUserProperties(userId);
    console.log('🔍 userProps AVANT filtrage:', userProps.length, userProps.map(p => p.id));
    
    // ✅ FILTRER selon les propriétés accessibles (si sous-compte avec restrictions)
    if (accessiblePropertyIds && accessiblePropertyIds.length > 0) {
      userProps = userProps.filter(p => accessiblePropertyIds.includes(p.id));
      console.log('✅ Propriétés filtrées APRÈS:', userProps.length, userProps.map(p => p.id));
    }
    
    const properties = userProps.map(p => {
      const rawIcal = p.icalUrls || p.ical_urls || [];
      // On reconstruit un tableau d'objets { url, platform }
      const icalUrls = Array.isArray(rawIcal)
        ? rawIcal
            .map(item => {
              // Ancien format : tableau de strings
              if (typeof item === 'string') {
                return {
                  url: item,
                  platform:
                    icalService && icalService.extractSource
                      ? icalService.extractSource(item)
                      : 'Inconnu'
                };
              }
              // Nouveau format éventuel : déjà un objet
              if (item && typeof item === 'object' && item.url) {
                return {
                  url: item.url,
                  platform:
                    item.platform ||
                    (icalService && icalService.extractSource
                      ? icalService.extractSource(item.url)
                      : 'Inconnu')
                };
              }
              return null;
            })
            .filter(Boolean)
        : [];
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        address: p.address || null,
        arrivalTime: p.arrival_time || p.arrivalTime || null,
        departureTime: p.departure_time || p.departureTime || null,
        depositAmount: p.deposit_amount ?? p.depositAmount ?? null,
        photoUrl: p.photo_url || p.photoUrl || null,
        welcomeBookUrl: p.welcome_book_url || null,
        accessCode: p.access_code || null,
        wifiName: p.wifi_name || null,
        wifiPassword: p.wifi_password || null,
        accessInstructions: p.access_instructions || null,
        arrivalMessage: p.arrival_message || null,  // ✅ NOUVEAU
        ownerId: p.owner_id || null,
        chatPin: p.chat_pin || null,
        amenities: p.amenities || '{}',                    // ✅ AJOUTÉ
        houseRules: p.house_rules || '{}',                 // ✅ AJOUTÉ
        practicalInfo: p.practical_info || '{}',           // ✅ AJOUTÉ
        autoResponsesEnabled: p.auto_responses_enabled !== undefined ? p.auto_responses_enabled : true,  // ✅ AJOUTÉ
        icalUrls,
        reservationCount: (reservationsStore.properties[p.id] || []).length
      };
    });

 res.json({ properties });
  } catch (err) {
    console.error('Erreur /api/properties :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/properties/:propertyId', 
  authenticateAny,
  requirePermission(pool, 'can_view_properties'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    
    const { propertyId } = req.params;
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }
    
    // ✅ Vérifier accès si sous-compte
    if (req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0) {
      if (!req.subAccountData.accessible_property_ids.includes(propertyId)) {
        return res.status(403).json({ error: 'Accès refusé à cette propriété' });
      }
    }
    
    res.json({
      id: property.id,
      name: property.name,
      color: property.color,
      address: property.address || null,
      arrivalTime: property.arrival_time || property.arrivalTime || null,
      departureTime: property.departure_time || property.departureTime || null,
      depositAmount: property.deposit_amount ?? property.depositAmount ?? null,
      photoUrl: property.photo_url || property.photoUrl || null,
      
      // ✅ NOUVEAUX CHAMPS ENRICHIS
      welcomeBookUrl: property.welcome_book_url || null,
      accessCode: property.access_code || null,
      wifiName: property.wifi_name || null,
      wifiPassword: property.wifi_password || null,
      accessInstructions: property.access_instructions || null,
      chatPin: property.chat_pin || null,
      amenities: property.amenities || '{}',                    // ✅ AJOUTÉ
      houseRules: property.house_rules || '{}',                 // ✅ AJOUTÉ
      practicalInfo: property.practical_info || '{}',           // ✅ AJOUTÉ
      autoResponsesEnabled: property.auto_responses_enabled !== undefined ? property.auto_responses_enabled : true,  // ✅ AJOUTÉ
      
      icalUrls: property.icalUrls || property.ical_urls || [],
      reservationCount: (reservationsStore.properties[property.id] || []).length
    });
  } catch (error) {
    console.error('Erreur GET /api/properties/:propertyId:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/properties', 
  authenticateAny,
  requirePermission(pool, 'can_edit_properties'),
  upload.single('photo'), 
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    let body;
    try {
      body = parsePropertyBody(req);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const {
      name,
      color,
      icalUrls,
      address,
      arrivalTime,
      departureTime,
      depositAmount,
      photoUrl: existingPhotoUrl,
      welcomeBookUrl,
      accessCode,
      wifiName,
      wifiPassword,
      accessInstructions,
      arrivalMessage,  // ✅ NOUVEAU
      chatPin 
    } = body;

    const amenities = body.amenities || {};
    const houseRules = body.house_rules || {};
    const practicalInfo = body.practical_info || {};
    const autoResponsesEnabled = body.auto_responses_enabled !== undefined ? body.auto_responses_enabled : true;

    const finalChatPin = chatPin || Math.floor(1000 + Math.random() * 9000).toString();

    if (!name || !color) {
      return res.status(400).json({ error: 'Nom et couleur requis' });
    }

    // ============================================
    // CHECK QUOTA LOGEMENTS PAR PLAN
    // ============================================
    {
      // Récupérer le plan actif de l'utilisateur
      const subResult = await pool.query(
        `SELECT plan_type, stripe_subscription_id FROM subscriptions
         WHERE user_id = $1 AND status IN ('active', 'trialing')
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      const planType = subResult.rows[0]?.plan_type || 'solo';
      const stripeSubId = subResult.rows[0]?.stripe_subscription_id;
      const limits = getPlanLimits(planType);
      const isAnnualPlan = (planType || '').toLowerCase().includes('annual');

      // Compter les logements existants de cet utilisateur
      const propCountRes = await pool.query(
        'SELECT COUNT(*) AS count FROM properties WHERE user_id = $1',
        [userId]
      );
      const currentCount = parseInt(propCountRes.rows[0].count, 10);

      // Calculer le slug de la propriété qu'on essaie de créer
      const nameSlugCheck = name.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const tentativeId = `${userId}-${nameSlugCheck}`;

      // Vérifier si c'est une mise à jour (propriété existante) ou un ajout
      const existCheck = await pool.query(
        'SELECT id FROM properties WHERE id = $1',
        [tentativeId]
      );
      const isExistingProperty = existCheck.rows.length > 0;

      if (!isExistingProperty) {
        const basePlanName = getBasePlanName(planType);

        // Plan Solo : 1 logement max, pas de supplément possible
        if (basePlanName === 'solo' && currentCount >= 1) {
          return res.status(403).json({
            error: 'Limite atteinte',
            code: 'PLAN_LIMIT_SOLO',
            message: 'Le plan Solo est limité à 1 logement. Passez au plan Standard pour gérer jusqu\'à 3 logements.',
            currentCount,
            limit: 1,
            upgradeUrl: '/pricing.html'
          });
        }

        // Standard/Pro : au-delà du quota inclus → facturer automatiquement le supplément
        if (currentCount >= limits.included && limits.extraPrice !== null) {
          const extraEnvKey = `STRIPE_PRICE_${basePlanName.toUpperCase()}_EXTRA_${isAnnualPlan ? 'ANNUAL' : 'MONTHLY'}`;
          const extraPriceId = process.env[extraEnvKey];

          if (!extraPriceId) {
            return res.status(500).json({
              error: 'Configuration manquante',
              code: 'NO_EXTRA_PRICE',
              message: `Le prix pour logement supplémentaire (${extraEnvKey}) n'est pas configuré. Contactez le support.`
            });
          }

          if (!stripeSubId || !stripeSubscriptions) {
            return res.status(400).json({
              error: 'Abonnement introuvable',
              code: 'NO_SUBSCRIPTION',
              message: 'Impossible d\'ajouter un logement supplémentaire : aucun abonnement Stripe actif trouvé.'
            });
          }

          try {
            await stripeSubscriptions.subscriptionItems.create({
              subscription: stripeSubId,
              price: extraPriceId,
              quantity: 1,
              proration_behavior: 'create_prorations'
            });
            const extraPrice = isAnnualPlan ? limits.extraPriceAnnual : limits.extraPrice;
            console.log(`✅ Logement supplémentaire facturé: user=${userId} plan=${planType} +${extraPrice}€`);
          } catch (stripeErr) {
            console.error('❌ Erreur Stripe ajout logement extra:', stripeErr.message);
            return res.status(402).json({
              error: 'Erreur de facturation',
              code: 'STRIPE_ERROR',
              message: `Impossible de facturer le logement supplémentaire : ${stripeErr.message}`
            });
          }
        }
      }
    }
    // ============================================

    const baseId = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const id = `${userId}-${baseId}`;

    // Upload vers Cloudinary si un fichier est présent
    let photoUrl = existingPhotoUrl || null;
    if (req.file) {
      photoUrl = await uploadPhotoToCloudinary(req.file);
    }

    // Normaliser les URLs iCal
    let normalizedIcal = [];
    if (Array.isArray(icalUrls)) {
      normalizedIcal = icalUrls
        .map(item => {
          if (typeof item === 'string') {
            return {
              url: item,
              platform: icalService && icalService.extractSource
                ? icalService.extractSource(item)
                : 'iCal'
            };
          }

          if (item && typeof item === 'object' && item.url) {
            const url = item.url;
            const platform = item.platform && item.platform.trim().length > 0
              ? item.platform.trim()
              : (icalService && icalService.extractSource
                  ? icalService.extractSource(url)
                  : 'iCal');

            return { url, platform };
          }

          return null;
        })
        .filter(Boolean);
    }

    const ownerId = req.body.ownerId || null;

    // ✅ VÉRIFIER SI LA PROPRIÉTÉ EXISTE DÉJÀ
    const existingProperty = await pool.query(
      'SELECT id FROM properties WHERE id = $1',
      [id]
    );

    if (existingProperty.rows.length > 0) {
      // ✅ UPDATE si elle existe
      console.log('🔄 UPDATE - Propriété existe déjà, mise à jour...');
      
      await pool.query(
        `UPDATE properties SET
           name = $1, color = $2, ical_urls = $3,
           address = $4, arrival_time = $5, departure_time = $6,
           deposit_amount = $7, photo_url = $8, welcome_book_url = $9,
           access_code = $10, wifi_name = $11, wifi_password = $12,
           access_instructions = $13, owner_id = $14, chat_pin = $15,
           amenities = $16, house_rules = $17, practical_info = $18,
           auto_responses_enabled = $19, arrival_message = $20
         WHERE id = $21`,
        [
          name,
          color,
          JSON.stringify(normalizedIcal),
          address || null,
          arrivalTime || null,
          departureTime || null,
          depositAmount ? parseFloat(depositAmount) : null,
          photoUrl,
          welcomeBookUrl || null,
          accessCode || null,
          wifiName || null,
          wifiPassword || null,
          accessInstructions || null,
          ownerId,
          finalChatPin,
          JSON.stringify(amenities),
          JSON.stringify(houseRules),
          JSON.stringify(practicalInfo),
          autoResponsesEnabled,
          arrivalMessage || null,  // ✅ NOUVEAU
          id
        ]
      );

      return res.json({
        success: true,
        message: 'Propriété mise à jour avec succès',
        property: { id }
      });
    }

    // ✅ INSERT si elle n'existe pas
    console.log('🆕 INSERT - Création nouvelle propriété...');

    await pool.query(
      `INSERT INTO properties (
         id, user_id, name, color, ical_urls,
         address, arrival_time, departure_time, deposit_amount, photo_url,
         welcome_book_url, access_code, wifi_name, wifi_password, access_instructions,
         owner_id, chat_pin, display_order, created_at,
         amenities, house_rules, practical_info, auto_responses_enabled, arrival_message
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15,
         $16, $17,
         (SELECT COALESCE(MAX(display_order), 0) + 1 FROM properties WHERE user_id = $2),
         NOW(),
         $18, $19, $20, $21, $22
       )`,
      [
        id,
        userId,
        name,
        color,
        JSON.stringify(normalizedIcal),
        address || null,
        arrivalTime || null,
        departureTime || null,
        depositAmount ? parseFloat(depositAmount) : null,
        photoUrl,
        welcomeBookUrl || null,
        accessCode || null,
        wifiName || null,
        wifiPassword || null,
        accessInstructions || null,
        ownerId,
        finalChatPin,
        JSON.stringify(amenities),
        JSON.stringify(houseRules),
        JSON.stringify(practicalInfo),
        autoResponsesEnabled,
        arrivalMessage || null  // ✅ NOUVEAU
      ]
    );

    // Rafraîchir le cache mémoire
    await loadProperties();

    res.json({
      success: true,
      message: 'Propriété créée avec succès',
      property: { id }
    });

  } catch (error) {
    console.error('❌ Erreur création/mise à jour propriété:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      details: error.message 
    });
  }
});
// ============================================
// MODIFIER UN LOGEMENT
// ============================================
app.put('/api/properties/:propertyId', 
  authenticateAny,
  requirePermission(pool, 'can_edit_properties'),
  loadSubAccountData(pool),
  upload.single('photo'), 
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    
    const { propertyId } = req.params;
    
    // ✅ Vérifier accès propriété si sous-compte
    if (req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0) {
      if (!req.subAccountData.accessible_property_ids.includes(propertyId)) {
        return res.status(403).json({ error: 'Accès refusé à cette propriété' });
      }
    }
    
    let body;
    try {
      body = parsePropertyBody(req);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    
    const {
      name,
      color,
      icalUrls,
      address,
      arrivalTime,
      departureTime,
      depositAmount,
      photoUrl: existingPhotoUrl,
      welcomeBookUrl,
      accessCode,
      wifiName,
      wifiPassword,
      accessInstructions,
      arrivalMessage,  // ✅ NOUVEAU
      ownerId,
      amenities,
      houseRules,
      practicalInfo,
      autoResponsesEnabled,
      chatPin 
    } = body;
    
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === userId);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    // Gérer la mise à jour du PIN (garder l'ancien si non fourni)
    const newChatPin = 
      chatPin !== undefined 
        ? (chatPin || property.chat_pin) 
        : (property.chat_pin || null);

    const newName = name || property.name;
    const newColor = color || property.color;

    const newAddress =
      address !== undefined ? address : (property.address || null);

    const newArrivalTime =
      arrivalTime !== undefined
        ? arrivalTime
        : (property.arrival_time || property.arrivalTime || null);

    const newDepartureTime =
      departureTime !== undefined
        ? departureTime
        : (property.departure_time || property.departureTime || null);

    const newDepositAmount =
      depositAmount !== undefined
        ? (depositAmount === '' || depositAmount == null
            ? null
            : Number(depositAmount))
        : (property.deposit_amount ?? property.depositAmount ?? null);

    const newWelcomeBookUrl = 
      welcomeBookUrl !== undefined 
        ? (welcomeBookUrl || null) 
        : (property.welcome_book_url || null);

    const newAccessCode = 
      accessCode !== undefined 
        ? (accessCode || null) 
        : (property.access_code || null);

    const newWifiName = 
      wifiName !== undefined 
        ? (wifiName || null) 
        : (property.wifi_name || null);

    const newWifiPassword = 
      wifiPassword !== undefined 
        ? (wifiPassword || null) 
        : (property.wifi_password || null);

    const newAccessInstructions = 
      accessInstructions !== undefined 
        ? (accessInstructions || null) 
        : (property.access_instructions || null);

    // ✅ NOUVEAUX CHAMPS
    const newAmenities = 
      amenities !== undefined 
        ? amenities 
        : (property.amenities || '{}');

    const newHouseRules = 
      houseRules !== undefined 
        ? houseRules 
        : (property.house_rules || '{}');

    const newPracticalInfo = 
      practicalInfo !== undefined 
        ? practicalInfo 
        : (property.practical_info || '{}');

    const newAutoResponsesEnabled = 
      autoResponsesEnabled !== undefined 
        ? autoResponsesEnabled 
        : (property.auto_responses_enabled !== undefined ? property.auto_responses_enabled : true);
    
    const newArrivalMessage = 
      arrivalMessage !== undefined 
        ? arrivalMessage 
        : (property.arrival_message || null);  // ✅ NOUVEAU
        
    let newPhotoUrl =
      existingPhotoUrl !== undefined
        ? (existingPhotoUrl || null)
        : (property.photo_url || property.photoUrl || null);

    // Upload vers Cloudinary si une nouvelle photo est fournie
    if (req.file) {
      try {
        newPhotoUrl = await uploadPhotoToCloudinary(req.file);
      } catch (uploadError) {
        console.error('Erreur upload Cloudinary:', uploadError);
        return res.status(500).json({ error: 'Erreur lors de l\'upload de la photo' });
      }
    }

    let newIcalUrls;
    if (icalUrls !== undefined) {
      newIcalUrls = Array.isArray(icalUrls)
        ? icalUrls
            .map(item => {
              if (typeof item === 'string') {
                return {
                  url: item,
                  platform:
                    icalService && icalService.extractSource
                      ? icalService.extractSource(item)
                      : 'iCal'
                };
              }
              if (item && typeof item === 'object' && item.url) {
                const url = item.url;
                const platform =
                  item.platform && item.platform.trim().length > 0
                    ? item.platform.trim()
                    : (icalService && icalService.extractSource
                        ? icalService.extractSource(url)
                        : 'iCal');
                return { url, platform };
              }
              return null;
            })
            .filter(Boolean)
        : [];
    } else {
      // on garde ce qui est en base
      newIcalUrls = property.icalUrls || property.ical_urls || [];
    }

    const newOwnerId = ownerId || null;
    
    console.log('💾 UPDATE - Valeurs à sauvegarder:', {
      newAmenities,
      newHouseRules,
      newPracticalInfo,
      newAutoResponsesEnabled,
      propertyId,
userId: userId
    });
    
    const result = await pool.query(
      `UPDATE properties
       SET
         name = $1,
         color = $2,
         ical_urls = $3,
         address = $4,
         arrival_time = $5,
         departure_time = $6,
         deposit_amount = $7,
         photo_url = $8,
         welcome_book_url = $9,
         access_code = $10,
         wifi_name = $11,
         wifi_password = $12,
         access_instructions = $13,
         owner_id = $14,
         chat_pin = $15,
         amenities = $16,
         house_rules = $17,
         practical_info = $18,
         auto_responses_enabled = $19,
         arrival_message = $20,
         updated_at = NOW()
       WHERE id = $21 AND user_id = $22`,
      [
        newName,
        newColor,
        JSON.stringify(newIcalUrls || []),
        newAddress,
        newArrivalTime,
        newDepartureTime,
        newDepositAmount,
        newPhotoUrl,
        newWelcomeBookUrl,
        newAccessCode,
        newWifiName,
        newWifiPassword,
        newAccessInstructions,
        newOwnerId,
        newChatPin,
        newAmenities,
        newHouseRules,
        newPracticalInfo,
        newAutoResponsesEnabled,
        newArrivalMessage,  // ✅ NOUVEAU
        propertyId,
        userId
      ]
    );
    
    console.log('✅ UPDATE terminé, lignes affectées:', result.rowCount);
    
    await loadProperties();

    const updated = PROPERTIES.find(p => p.id === propertyId && p.userId === userId);
    res.json({
      message: 'Logement modifié avec succès',
      property: updated
    });
  } catch (err) {
    console.error('❌ Erreur modification logement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// SUPPRIMER UN LOGEMENT
// ============================================
app.delete('/api/properties/:propertyId', 
  authenticateAny,
  requirePermission(pool, 'can_delete_properties'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId } = req.params;
    
    // ✅ Vérifier accès propriété si sous-compte
    if (req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0) {
      if (!req.subAccountData.accessible_property_ids.includes(propertyId)) {
        return res.status(403).json({ error: 'Accès refusé à cette propriété' });
      }
    }
    
    // ✅ FIX : Utiliser userId au lieu de user.id
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === userId);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    // ✅ SUPPRESSION EN CASCADE (évite les erreurs de contraintes)
    console.log(`🗑️ Suppression du logement ${propertyId} et toutes ses dépendances...`);
    
    // 1. Supprimer les réservations
    await pool.query('DELETE FROM reservations WHERE property_id = $1', [propertyId]);
    console.log('  ✅ Réservations supprimées');
    
    // 2. Supprimer les conversations
    await pool.query('DELETE FROM conversations WHERE property_id = $1', [propertyId]);
    console.log('  ✅ Conversations supprimées');
    
    // 3. Supprimer les messages de chat liés
    try {
      await pool.query('DELETE FROM chat_messages WHERE property_id = $1', [propertyId]);
      console.log('  ✅ Messages supprimés');
    } catch (e) {
      console.log('  ⚠️ Pas de messages liés');
    }
    
    // 4. Supprimer les factures liées (si la colonne existe)
    try {
      await pool.query('DELETE FROM invoices WHERE property_id = $1', [propertyId]);
      console.log('  ✅ Factures supprimées');
    } catch (e) {
      console.log('  ⚠️ Factures non liées à property_id:', e.message);
    }
    
    // 5. Supprimer le logement
    await pool.query(
      'DELETE FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, userId]
    );
    console.log('  ✅ Logement supprimé');

    // Nettoyer le cache mémoire
    delete reservationsStore.properties[propertyId];

    // Recharger les propriétés
    await loadProperties();

    res.json({
      message: 'Logement supprimé avec succès',
      property
    });
  } catch (err) {
    console.error('❌ Erreur suppression logement:', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// ============================================
// TESTER UNE URL ICAL
// ============================================
app.post('/api/properties/test-ical', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL requise' });
  }

  try {
    const testProperty = {
      id: 'test',
      name: 'Test',
      color: '#000000',
      icalUrls: [url]
    };

    const reservations = await icalService.fetchReservations(testProperty);

    res.json({
      success: true,
      message: 'URL iCal valide',
      reservationCount: reservations.length,
      sampleReservation: reservations[0] || null
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'URL iCal invalide ou inaccessible',
      details: error.message
    });
  }
});
  // ============================================
// Réorganiser l'ordre des logements (SAFE)
// ============================================
app.put('/api/properties/:propertyId/reorder', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorise' });
    }
    
    const { propertyId } = req.params;
    const { direction } = req.body;

    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: 'Direction invalide' });
    }

    // Logement courant
    const currentRes = await pool.query(
      `SELECT id, display_order
       FROM properties
       WHERE id = $1 AND user_id = $2`,
      [propertyId, userId]
    );

    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Logement introuvable' });
    }

    const current = currentRes.rows[0];
    const currentOrder = Number(current.display_order);

    // Voisin a echanger
    const neighborRes = await pool.query(
      direction === 'up'
        ? `
          SELECT id, display_order
          FROM properties
          WHERE user_id = $1 AND display_order < $2
          ORDER BY display_order DESC
          LIMIT 1
        `
        : `
          SELECT id, display_order
          FROM properties
          WHERE user_id = $1 AND display_order > $2
          ORDER BY display_order ASC
          LIMIT 1
        `,
      [userId, currentOrder]
    );

    if (neighborRes.rows.length === 0) {
      return res.status(400).json({
        error: direction === 'up'
          ? 'Déjà en première position'
          : 'Déjà en dernière position'
      });
    }

    const neighbor = neighborRes.rows[0];

    // 🔁 SWAP SÉCURISÉ (anti conflit UNIQUE)
    await pool.query('BEGIN');

    // 1️⃣ Mettre le courant en temporaire
    await pool.query(
      `UPDATE properties
       SET display_order = -1
       WHERE id = $1`,
      [current.id]
    );

    // 2️⃣ Déplacer le voisin
    await pool.query(
      `UPDATE properties
       SET display_order = $1
       WHERE id = $2`,
      [currentOrder, neighbor.id]
    );

    // 3️⃣ Mettre le courant à la place du voisin
    await pool.query(
      `UPDATE properties
       SET display_order = $1
       WHERE id = $2`,
      [neighbor.display_order, current.id]
    );

    await pool.query('COMMIT');

    // 🔄 Recharger le cache mémoire
    await loadProperties();

    return res.json({ success: true });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Erreur réorganisation logements:', err);

    return res.status(500).json({
      error: 'Erreur serveur lors de la réorganisation'
    });
  }
});
// ============================================
// ROUTES API - CONFIG (par user)
// ============================================

app.get('/api/config', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const userProps = getUserProperties(user.id);

  res.json({
    properties: userProps.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      hasIcalUrls: p.icalUrls && p.icalUrls.length > 0
    })),
    syncInterval: process.env.SYNC_INTERVAL || 15,
   emailConfigured:
  !!process.env.BREVO_API_KEY ||
  !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD),
    timezone: process.env.TIMEZONE || 'Europe/Paris',
    stripeConfigured: !!STRIPE_SECRET_KEY
  });
});

// ============================================
// ROUTES API - AUTH (Postgres)
// ============================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { company, firstName, lastName, email, password } = req.body;
    
    if (!company || !firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    // Vérifier si l'email existe déjà
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Générer l'ID utilisateur
    const id = `u_${Date.now().toString(36)}`;

    // Générer le token de vérification
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 heures

    // Créer l'utilisateur avec email_verified = FALSE
    await pool.query(
      `INSERT INTO users (
        id, company, first_name, last_name, email, password_hash, 
        created_at, stripe_account_id,
        email_verified, verification_token, verification_token_expires
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, $7, $8, $9)`,
      [id, company, firstName, lastName, email, passwordHash, false, verificationToken, tokenExpires]
    );

    // Créer l'abonnement trial (seulement s'il n'existe pas déjà)
    const existingSub = await pool.query(
      'SELECT id FROM subscriptions WHERE user_id = $1',
      [id]
    );

    if (existingSub.rows.length === 0) {
      const trialStartDate = new Date();
      const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO subscriptions (
          id, user_id, status, plan_type, plan_amount,
          trial_start_date, trial_end_date,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          `sub_${Date.now()}`,
          id,
          'trial',
          'trial',
          0,
          trialStartDate,
          trialEndDate
        ]
      );
    }

    // Envoyer l'email de vérification
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
    const verificationUrl = `${appUrl}/verify-email.html?token=${verificationToken}`;

    const mailOptions = {
      from: EMAIL_FROM,
      to: email,
      subject: 'Vérif¦ Vérifiez votre adresse email - Boostinghost',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
            .button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Bienvenue sur Boostinghost !</h1>
            </div>
            <div class="content">
              <p>Bonjour ${firstName},</p>
              
              <p>Merci de vous être inscrit sur <strong>Boostinghost</strong> !</p>
              
              <p>Pour activer votre compte et commencer à utiliser notre plateforme, veuillez vérifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
              
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">
                  ✅ Vérifier mon email
                </a>
              </div>
              
              <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
                Si le bouton ne fonctionne pas, copiez ce lien :<br>
                <a href="${verificationUrl}" style="color: #10b981;">${verificationUrl}</a>
              </p>
              
              <p style="margin-top: 30px;">
                <strong>Ce lien est valide pendant 24 heures.</strong>
              </p>
              
              <p>À très bientôt sur Boostinghost ! 🚀</p>
            </div>
            <div class="footer">
              <p>Cet email a été envoyé automatiquement par Boostinghost.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Email de vérification envoyé à:', email);
    } catch (emailErr) {
      console.error('Erreur envoi email:', emailErr);
      // On continue quand même
    }
// Retourner succès
    res.status(201).json({
      success: true,
      message: 'Compte créé ! Vérifiez votre email pour activer votre compte.',
      emailSent: true,
      email: email
    });

  } catch (err) {
    console.error('Erreur register:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await pool.query(
      `SELECT id, company, first_name, last_name, email, password_hash, created_at, stripe_account_id, email_verified
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const row = result.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }
if (!row.email_verified) {
  return res.status(403).json({ 
    error: 'Email non vérifié',
    emailNotVerified: true,
    email: row.email,
    message: 'Veuillez vérifier votre email avant de vous connecter.'
  });
}
    const user = {
      id: row.id,
      company: row.company,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      stripeAccountId: row.stripe_account_id
    };

    const token = generateToken(user);

    res.json({
      user: publicUser(user),
      token
    });
  } catch (err) {
    console.error('Erreur login:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ✅ ENDPOINT VERIFY - Pour auto-login
// ============================================
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  try {
    // Si le token est valide, authenticateToken a déjà vérifié et ajouté req.user
    res.json({
      valid: true,
      user: req.user
    });
  } catch (err) {
    console.error('Erreur verify:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.get('/api/auth/me', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const payload = jwt.verify(token, secret);

    const result = await pool.query(
      `SELECT id, company, first_name, last_name, email, created_at, stripe_account_id
       FROM users
       WHERE id = $1`,
      [payload.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const row = result.rows[0];
    const user = {
      id: row.id,
      company: row.company,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      createdAt: row.created_at,
      stripeAccountId: row.stripe_account_id
    };

    res.json({ user });
  } catch (err) {
    console.error('Erreur /api/auth/me:', err);
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
});
// Route de vérification d'email
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token manquant' });
    }

    // Vérifier le token
    const result = await pool.query(
      `SELECT id, email, first_name, verification_token_expires
       FROM users 
       WHERE verification_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Token invalide' });
    }

    const user = result.rows[0];

    // Vérifier si le token est expiré
    if (new Date() > new Date(user.verification_token_expires)) {
      return res.status(400).json({ error: 'Token expiré' });
    }

    // Activer le compte
    await pool.query(
      `UPDATE users 
       SET email_verified = TRUE,
           verification_token = NULL,
           verification_token_expires = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]  // ✅ FIX: user.id au lieu de userId
    );

    console.log('✅ Email vérifié pour:', user.email);

    // ✅ Envoyer email de bienvenue
    await sendWelcomeEmail(user.email, user.first_name || 'nouveau membre');
    await logEmailSent(user.id, 'welcome', { email: user.email });

    res.json({
      success: true,
      message: 'Email vérifié avec succès !',
      user: {
        email: user.email,
        firstName: user.first_name
      }
    });

  } catch (err) {
    console.error('Erreur verify-email:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - MESSAGES
// ============================================

app.get('/api/messages/templates', (req, res) => {
  res.json({
    templates: messagingService.MESSAGE_TEMPLATES
  });
});

app.post('/api/messages/generate', (req, res) => {
  const { reservationUid, templateKey } = req.body;

  if (!reservationUid || !templateKey) {
    return res.status(400).json({ error: 'reservationUid et templateKey requis' });
  }

  let reservation = null;
  for (const propertyId in reservationsStore.properties) {
    const found = reservationsStore.properties[propertyId].find(r => r.uid === reservationUid);
    if (found) {
      reservation = found;
      break;
    }
  }

  if (!reservation) {
    return res.status(404).json({ error: 'Réservation non trouvée' });
  }

  const customData = {
    propertyAddress: 'Adresse du logement à définir',
    accessCode: 'Code à définir'
  };

  const message = messagingService.generateQuickMessage(reservation, templateKey, customData);

  if (!message) {
    return res.status(404).json({ error: 'Template non trouvé' });
  }

  res.json(message);
});

app.get('/api/messages/upcoming', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const allReservations = [];
  const userProps = getUserProperties(user.id);

  userProps.forEach(property => {
    const propertyReservations = reservationsStore.properties[property.id] || [];
    propertyReservations.forEach(reservation => {
      allReservations.push({
        ...reservation,
        property: {
          id: property.id,
          name: property.name,
          color: property.color
        }
      });
    });
  });

  res.json({
    checkinsToday: messagingService.getUpcomingCheckIns(allReservations, 0),
    checkinsTomorrow: messagingService.getUpcomingCheckIns(allReservations, 1),
    checkinsIn3Days: messagingService.getUpcomingCheckIns(allReservations, 3),
    checkinsIn7Days: messagingService.getUpcomingCheckIns(allReservations, 7),
    currentStays: messagingService.getCurrentStays(allReservations),
    checkoutsToday: messagingService.getUpcomingCheckOuts(allReservations, 0)
  });
});

// ============================================
// 💳 ROUTES API - ABONNEMENTS (Stripe Billing)
// ============================================

// ============================================
// 💳 ROUTES API - STRIPE CONNECT (compte hôte)
// ============================================

app.get('/api/stripe/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!stripe) {
      // Stripe pas configuré → on indique juste "pas connecté"
      return res.json({
        connected: false,
        error: 'Stripe non configuré côté serveur'
      });
    }

    if (!user.stripeAccountId) {
      // L'utilisateur n'a encore jamais connecté de compte Stripe
      return res.json({ connected: false });
    }

    try {
      const account = await stripe.accounts.retrieve(user.stripeAccountId);

      const connected = !!(account.charges_enabled && account.details_submitted);

      return res.json({
        connected,
        accountId: user.stripeAccountId,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted
      });
    } catch (err) {
      console.error('Erreur retrieve Stripe account:', err);
      // Si on n'arrive pas à récupérer le compte, on considère "non connecté"
      return res.json({
        connected: false,
        error: 'Impossible de récupérer le compte Stripe'
      });
    }
  } catch (err) {
    console.error('Erreur /api/stripe/status :', err);
    res.status(500).json({ error: 'Erreur serveur Stripe' });
  }
});

app.post('/api/stripe/create-onboarding-link', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré (clé secrète manquante)' });
    }

    let accountId = user.stripeAccountId;

    // 1) Si l'utilisateur n'a pas encore de compte Stripe, on en crée un
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        metadata: {
          userId: user.id,
          company: user.company || ''
        }
      });

      accountId = account.id;

      // On sauvegarde l'ID du compte Stripe en base
      await pool.query(
        'UPDATE users SET stripe_account_id = $1 WHERE id = $2',
        [accountId, user.id]
      );
    }

    // 2) On crée le lien d'onboarding pour que l'utilisateur complète ses infos chez Stripe
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/settings-account.html?stripe=refresh`,
      return_url: `${appUrl}/settings-account.html?stripe=return`,
      type: 'account_onboarding'
    });

    return res.json({ url: accountLink.url });
  } catch (err) {
    console.error('Erreur /api/stripe/create-onboarding-link :', err);
    res.status(500).json({
      error: 'Impossible de générer le lien Stripe : ' + (err.message || 'Erreur interne'),
      stripeType: err.type || null,
      stripeCode: err.code || null
    });
  }
});

// ============================================
// 🚀 ROUTES API - CAUTIONS (Stripe)
// ============================================

function findReservationByUidForUser(reservationUid, userId) {
  for (const property of PROPERTIES) {
    if (property.userId !== userId) continue;

    const propertyReservations = reservationsStore.properties[property.id] || [];
    const found = propertyReservations.find(r => r.uid === reservationUid);
    if (found) {
      return {
        reservation: found,
        property
      };
    }
  }
  return null;
}

// GET - Récupérer la caution liée à une réservation (si existe)
app.get('/api/deposits/:reservationUid', 
  authenticateAny,
  requirePermission(pool, 'can_view_deposits'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { reservationUid } = req.params;
    
    // ✅ NOUVEAU : Récupérer depuis PostgreSQL
    const deposit = await getDepositByReservation(reservationUid);
    
    res.json({ deposit });
  } catch (err) {
    console.error('Erreur GET /api/deposits:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// POST - Créer une caution Stripe pour une réservation (empreinte bancaire)
app.post('/api/deposits', 
  authenticateAny,
  requirePermission(pool, 'can_manage_deposits'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré (clé secrète manquante)' });
    }

    const { reservationUid, amount } = req.body;

    if (!reservationUid || !amount || amount <= 0) {
      return res.status(400).json({ error: 'reservationUid et montant (>0) sont requis' });
    }

    // Retrouver la réservation dans les réservations du user
    const result = findReservationByUidForUser(reservationUid, user.id);
    if (!result) {
      return res.status(404).json({ error: 'Réservation non trouvée pour cet utilisateur' });
    }

    const { reservation, property } = result;
    const amountCents = Math.round(amount * 100);

    // Créer l'objet "caution" en mémoire + fichier JSON
    const depositId = 'dep_' + Date.now().toString(36);
    const deposit = {
      id: depositId,
      reservationUid,
      amountCents,
      currency: 'eur',
      status: 'pending',
      stripeSessionId: null,
      checkoutUrl: null,
      createdAt: new Date().toISOString()
    };
    // ✅ NOUVEAU : Sauvegarder en PostgreSQL
  const saved = await saveDepositToDB(deposit, user.id, property.id);
  
  if (!saved) {
    return res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }

    // ✅ Nettoyer l'URL pour éviter les double slashes
    const appUrl = (process.env.APP_URL || 'https://lcc-booking-manager.onrender.com').replace(/\/$/, '');

    // ✅ Session avec capture_method: 'manual' mais SANS user_id dans payment_intent_data
    // pour éviter le routing automatique vers Connect
    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Caution séjour – ${property ? property.name : 'Logement'}`,
            description: `Du ${reservation.start} au ${reservation.end}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      // 🔹 Empreinte bancaire : autorisation non capturée
      payment_intent_data: {
        capture_method: 'manual',
        metadata: {
          deposit_id: deposit.id,
          reservation_uid: reservationUid
          // ⚠️ On enlève user_id pour éviter le routing vers Connect
        }
      },
      // Metadata sur la Session (on garde user_id ici, pas de problème)
      metadata: {
        deposit_id: deposit.id,
        reservation_uid: reservationUid,
        user_id: user.id
      },
      success_url: `${appUrl}/caution-success.html?depositId=${deposit.id}`,
      cancel_url: `${appUrl}/caution-cancel.html?depositId=${deposit.id}`
    };

    let session;

    // ✅ CAUTIONS : TOUJOURS sur le compte plateforme (pas de Stripe Connect)
    console.log('✅ Création caution sur compte plateforme Boostinghost');
    session = await stripe.checkout.sessions.create(sessionParams);

    deposit.stripeSessionId = session.id;
    deposit.checkoutUrl = session.url;
    // Mettre à jour après création de la session Stripe
deposit.stripeSessionId = session.id;
deposit.checkoutUrl = session.url;

await pool.query(`
  UPDATE deposits 
  SET stripe_session_id = $1, checkout_url = $2, updated_at = NOW()
  WHERE id = $3
`, [session.id, session.url, deposit.id]);

    return res.json({
      deposit,
      checkoutUrl: session.url
    });
  } catch (err) {
    console.error('Erreur création caution:', err);
    return res.status(500).json({
      error: 'Erreur lors de la création de la caution : ' + (err.message || 'Erreur interne Stripe')
    });
  }
});

// ============================================
// POST - Créer un PAIEMENT de location (Stripe Connect avec commission 8%)
// ============================================
app.post('/api/payments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    // ⚠️ VÉRIFIER que l'utilisateur a un compte Stripe Connect
    if (!user.stripeAccountId) {
      return res.status(400).json({ 
        error: 'Vous devez connecter votre compte Stripe pour recevoir des paiements',
        needsStripeConnect: true 
      });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré (clé secrète manquante)' });
    }

    const { reservationUid, amount, description } = req.body;

    if (!reservationUid || !amount || amount <= 0) {
      return res.status(400).json({ error: 'reservationUid et montant (>0) sont requis' });
    }

    // Retrouver la réservation
    const result = findReservationByUidForUser(reservationUid, user.id);
    if (!result) {
      return res.status(404).json({ error: 'Réservation non trouvée pour cet utilisateur' });
    }

    const { reservation, property } = result;
    const amountCents = Math.round(amount * 100);
    
    // 💰 Calcul de la commission (8% pour la plateforme)
    const platformFee = Math.round(amountCents * 0.08);
    const ownerReceives = amountCents - platformFee;
    
    // Créer l'objet "payment"
    const paymentId = 'pay_' + Date.now().toString(36);
    const payment = {
      id: paymentId,
      reservationUid,
      amountCents,
      platformFeeCents: platformFee,
      currency: 'eur',
      status: 'pending',
      stripeSessionId: null,
      checkoutUrl: null,
      createdAt: new Date().toISOString()
    };
    
    // Sauvegarder en PostgreSQL
    const saved = await savePaymentToDB(payment, user.id, property.id);
    
    if (!saved) {
      return res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
    }

    const appUrl = (process.env.APP_URL || 'https://boostinghost.com').replace(/\/$/, '');

    // 🎯 Créer une session de paiement sur le compte Stripe Connect du propriétaire
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: description || `Location – ${property.name}`,
            description: `Du ${reservation.start} au ${reservation.end}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      payment_intent_data: {
        // 💰 Commission de la plateforme (8%)
        application_fee_amount: platformFee,
        metadata: {
          payment_id: payment.id,
          reservation_uid: reservationUid,
          property_id: property.id,
          user_id: user.id,
          payment_type: 'location'
        }
      },
      metadata: {
        payment_id: payment.id,
        reservation_uid: reservationUid,
        property_id: property.id,
        user_id: user.id,
        payment_type: 'location'
      },
      success_url: `${appUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/cautions-paiements.html?tab=payments`
    }, {
      stripeAccount: user.stripeAccountId // 🎯 Le compte du propriétaire
    });

    payment.stripeSessionId = session.id;
    payment.checkoutUrl = session.url;
    
    // Mettre à jour après création de la session Stripe
    await pool.query(`
      UPDATE payments 
      SET stripe_session_id = $1, checkout_url = $2, updated_at = NOW()
      WHERE id = $3
    `, [session.id, session.url, payment.id]);

    console.log(`✅ Paiement créé: ${payment.id} - Montant: ${amount}€ - Commission: ${(platformFee/100).toFixed(2)}€ - Propriétaire reçoit: ${(ownerReceives/100).toFixed(2)}€`);

    return res.json({
      payment,
      checkoutUrl: session.url,
      amount: amount,
      platformFee: platformFee / 100,
      ownerReceives: ownerReceives / 100
    });
  } catch (err) {
    console.error('Erreur création paiement:', err);
    return res.status(500).json({
      error: 'Erreur lors de la création du paiement : ' + (err.message || 'Erreur interne Stripe')
    });
  }
});

// GET - Liste des cautions d'un utilisateur
app.get('/api/deposits', 
  authenticateAny,
  requirePermission(pool, 'can_view_deposits'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { status, propertyId } = req.query;
    
    const deposits = await getUserDeposits(userId, { status, propertyId });
    
    // ✅ Filtrer par propriétés si sous-compte
    let filteredDeposits = deposits;
    if (req.user.isSubAccount && req.subAccountData.accessible_property_ids.length > 0) {
      filteredDeposits = deposits.filter(d => 
        req.subAccountData.accessible_property_ids.includes(d.property_id)
      );
    }
    
    res.json({ deposits: filteredDeposits });
  } catch (err) {
    console.error('Erreur GET /api/deposits:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Liste des paiements d'un utilisateur
app.get('/api/payments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { status, propertyId } = req.query;
    
    let query = 'SELECT * FROM payments WHERE user_id = $1';
    const params = [userId];
    
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }
    
    if (propertyId) {
      query += ` AND property_id = $${params.length + 1}`;
      params.push(propertyId);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({ payments: result.rows });
  } catch (err) {
    console.error('Erreur GET /api/payments:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Capturer une caution (débiter le client)
app.post('/api/deposits/:depositId/capture', 
  authenticateAny,
  requirePermission(pool, 'can_manage_deposits'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { depositId } = req.params;
    const { amountCents } = req.body;
    
    // Vérifier que le deposit appartient à l'utilisateur
    const deposit = await pool.query(
      'SELECT * FROM deposits WHERE id = $1 AND user_id = $2',
      [depositId, userId]
    );

    if (deposit.rows.length === 0) {
      return res.status(404).json({ error: 'Caution introuvable' });
    }

    const success = await captureDeposit(depositId, amountCents);
    
    if (!success) {
      return res.status(500).json({ error: 'Erreur lors de la capture' });
    }

    res.json({ message: 'Caution capturée avec succès' });
  } catch (err) {
    console.error('Erreur POST /api/deposits/capture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Libérer une caution (annuler l'autorisation)
app.post('/api/deposits/:depositId/release', 
  authenticateAny,
  requirePermission(pool, 'can_manage_deposits'),
  loadSubAccountData(pool),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount 
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { depositId } = req.params;
    
    // Vérifier que le deposit appartient à l'utilisateur
    const deposit = await pool.query(
      'SELECT * FROM deposits WHERE id = $1 AND user_id = $2',
      [depositId, userId]
    );

    if (deposit.rows.length === 0) {
      return res.status(404).json({ error: 'Caution introuvable' });
    }

    const success = await releaseDeposit(depositId);
    
    if (!success) {
      return res.status(500).json({ error: 'Erreur lors de la libération' });
    }

    res.json({ message: 'Caution libérée avec succès' });
  } catch (err) {
    console.error('Erreur POST /api/deposits/release:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - CHECKLISTS
// ============================================

// GET - Liste des checklists
app.get('/api/checklists', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, status, checklistType, reservationUid } = req.query;
    
    const checklists = await getUserChecklists(user.id, {
      propertyId,
      status,
      checklistType,
      reservationUid
    });
    
    res.json({ checklists });
  } catch (err) {
    console.error('Erreur GET /api/checklists:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Une checklist par ID
app.get('/api/checklists/:checklistId', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { checklistId } = req.params;
    
    const checklist = await getChecklistById(checklistId, user.id);
    
    if (!checklist) {
      return res.status(404).json({ error: 'Checklist introuvable' });
    }
    
    res.json({ checklist });
  } catch (err) {
    console.error('Erreur GET /api/checklists/:id:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer une checklist
app.post('/api/checklists', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const checklist = await createChecklist(user.id, req.body);
    
    if (!checklist) {
      return res.status(500).json({ error: 'Erreur lors de la création' });
    }
    
    res.status(201).json({ checklist });
  } catch (err) {
    console.error('Erreur POST /api/checklists:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Mettre à jour une tâche
app.put('/api/checklists/:checklistId/tasks/:taskId', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { checklistId, taskId } = req.params;
    
    // Vérifier que la checklist appartient à l'utilisateur
    const checklist = await getChecklistById(checklistId, user.id);
    if (!checklist) {
      return res.status(404).json({ error: 'Checklist introuvable' });
    }
    
    const updated = await updateChecklistTask(checklistId, taskId, req.body);
    
    if (!updated) {
      return res.status(500).json({ error: 'Erreur lors de la mise à jour' });
    }
    
    res.json({ checklist: updated });
  } catch (err) {
    console.error('Erreur PUT /api/checklists/tasks:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une checklist
app.delete('/api/checklists/:checklistId', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { checklistId } = req.params;
    
    const deleted = await deleteChecklist(checklistId, user.id);
    
    if (!deleted) {
      return res.status(500).json({ error: 'Erreur lors de la suppression' });
    }
    
    res.json({ message: 'Checklist supprimée avec succès' });
  } catch (err) {
    console.error('Erreur DELETE /api/checklists:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API - CHECKLIST TEMPLATES
// ============================================

// GET - Liste des templates
app.get('/api/checklist-templates', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, checklistType } = req.query;
    
    const templates = await getUserChecklistTemplates(user.id, {
      propertyId,
      checklistType
    });
    
    res.json({ templates });
  } catch (err) {
    console.error('Erreur GET /api/checklist-templates:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer un template
app.post('/api/checklist-templates', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const template = await createChecklistTemplate(user.id, req.body);
    
    if (!template) {
      return res.status(500).json({ error: 'Erreur lors de la création' });
    }
    
    res.status(201).json({ template });
  } catch (err) {
    console.error('Erreur POST /api/checklist-templates:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer une checklist depuis un template
app.post('/api/checklist-templates/:templateId/create', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { templateId } = req.params;
    
    const checklist = await createChecklistFromTemplate(user.id, templateId, req.body);
    
    if (!checklist) {
      return res.status(500).json({ error: 'Erreur lors de la création' });
    }
    
    res.status(201).json({ checklist });
  } catch (err) {
    console.error('Erreur POST /api/checklist-templates/create:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Générer les checklists automatiques pour une réservation
app.post('/api/reservations/:reservationUid/generate-checklists', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { reservationUid } = req.params;
    
    const checklists = await generateChecklistsForReservation(user.id, reservationUid);
    
    res.status(201).json({ 
      message: `${checklists.length} checklists créées`,
      checklists 
    });
  } catch (err) {
    console.error('Erreur POST /api/reservations/generate-checklists:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - FACTURATION PROPRIÉTAIRES
// ============================================
// À ajouter dans server.js
// 
// IMPORTANT : Ne pas re-déclarer ces variables si elles existent déjà :
// - const multer = require('multer');
// - const path = require('path');
// - const ExcelJS = require('exceljs');
//
// Chercher dans server.js si elles sont déjà présentes, sinon les ajouter EN HAUT du fichier
// ============================================
// ROUTES API - ABONNEMENTS STRIPE
// À COPIER-COLLER DANS server.js APRÈS LES AUTRES ROUTES
// ============================================

// POST - Créer un lien vers le portail client Stripe
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configure' });
    }

    // Récupérer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouve' });
    }

    const customerId = result.rows[0].stripe_customer_id;
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // Créer la session du portail
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings-account.html?tab=subscription`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Erreur create-portal-session:', err);
    res.status(500).json({ error: 'Impossible de creer la session portail' });
  }
});

// ============================================
// CONFIGURATION UPLOAD JUSTIFICATIFS
// ============================================

const storageAttachments = multer.diskStorage({
  destination: 'public/uploads/justificatifs/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'justificatif-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadAttachment = multer({
  storage: storageAttachments,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Format de fichier non supporté'));
  }
});

// ============================================
// CLIENTS PROPRIÉTAIRES - CRUD
// ============================================

// 1. LISTE DES CLIENTS
app.get('/api/owner-clients', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const result = await pool.query(
      `SELECT * FROM owner_clients 
       WHERE user_id = $1 
       ORDER BY 
         CASE WHEN client_type = 'business' THEN company_name ELSE last_name END`,
      [user.id]
    );

    res.json({ clients: result.rows });
  } catch (err) {
    console.error('Erreur liste clients:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. DÉTAIL D'UN CLIENT
app.get('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const result = await pool.query(
      'SELECT * FROM owner_clients WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur détail client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 3. CRÉER UN CLIENT
app.post('/api/owner-clients', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const {
      clientType,
      firstName,
      lastName,
      companyName,
      email,
      address,
      postalCode,
      city,
      defaultCommissionRate
    } = req.body;

    // Validation simple
    if (clientType === 'business' && !companyName) {
      return res.status(400).json({ error: "Nom d'entreprise requis" });
    }
    if (clientType === 'individual' && (!firstName || !lastName)) {
      return res.status(400).json({ error: 'Nom et prénom requis' });
    }

    const result = await pool.query(
      `INSERT INTO owner_clients (
        user_id,
        client_type,
        first_name,
        last_name,
        company_name,
        email,
        address,
        postal_code,
        city,
        default_commission_rate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        user.id,
        clientType,
        firstName || null,
        lastName || null,
        companyName || null,
        email || null,
        address || null,
        postalCode || null,
        city || null,
        defaultCommissionRate || 20
      ]
    );

    res.json({ client: result.rows[0] });
  } catch (err) {
    console.error('Erreur création client:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});
app.put('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const clientId = req.params.id;
    const {
      clientType, firstName, lastName, companyName,
      email, address, postalCode, city, defaultCommissionRate
    } = req.body;
  
    const result = await pool.query(`
      UPDATE owner_clients SET
        client_type = $1, 
        first_name = $2, 
        last_name = $3, 
        company_name = $4,
        email = $5, 
        address = $6, 
        postal_code = $7, 
        city = $8,
        default_commission_rate = $9
      WHERE id = $10 AND user_id = $11
      RETURNING *
    `, [
      clientType, 
      firstName || null, 
      lastName || null, 
      companyName || null,
      email || null, 
      address || null, 
      postalCode || null, 
      city || null,
      defaultCommissionRate || 20,
      clientId, 
      user.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    res.json({ client: result.rows[0] });
  } catch (err) {
    console.error('Erreur modification client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.delete('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const clientId = req.params.id;

    // OPTIONNEL : bloquer si des factures existent déjà pour ce client
    const invRes = await pool.query(
      'SELECT COUNT(*) FROM owner_invoices WHERE client_id = $1 AND user_id = $2',
      [clientId, user.id]
    );
    const invCount = parseInt(invRes.rows[0].count, 10) || 0;
    if (invCount > 0) {
      return res.status(400).json({
        error: 'Impossible de supprimer un client qui a déjà des factures.'
      });
    }

    const result = await pool.query(
      'DELETE FROM owner_clients WHERE id = $1 AND user_id = $2',
      [clientId, user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Client introuvable' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur suppression client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 5. SUPPRIMER UN CLIENT
app.delete('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    // Vérifier qu'il n'y a pas de factures liées
    const checkInvoices = await pool.query(
      'SELECT COUNT(*) as count FROM owner_invoices WHERE client_id = $1',
      [req.params.id]
    );

    if (parseInt(checkInvoices.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer : ce client a des factures associées' 
      });
    }

    const result = await pool.query(
      'DELETE FROM owner_clients WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    res.json({ message: 'Client supprimé' });
  } catch (err) {
    console.error('Erreur suppression client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API V2 - FACTURATION PROPRIÉTAIRES
// ============================================
// NOUVELLES ROUTES à ajouter APRÈS les routes V1 existantes

// ============================================
// ARTICLES (CATALOGUE)
// ============================================

// 1. LISTE DES ARTICLES
app.get('/api/owner-articles', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const result = await pool.query(
      `SELECT * FROM owner_articles 
       WHERE user_id = $1 AND is_active = true
       ORDER BY article_type, name`,
      [userId]
    );

    res.json({ articles: result.rows });
  } catch (err) {
    console.error('Erreur liste articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. CRÉER UN ARTICLE
app.post('/api/owner-articles', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const { articleType, name, description, unitPrice, commissionRate } = req.body;

    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const result = await pool.query(`
      INSERT INTO owner_articles (user_id, article_type, name, description, unit_price, commission_rate)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user.id, articleType, name, description, unitPrice || 0, commissionRate || 0]);

    res.json({ article: result.rows[0] });
  } catch (err) {
    console.error('Erreur création article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 3. MODIFIER UN ARTICLE
app.put('/api/owner-articles/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const { name, description, unitPrice, commissionRate } = req.body;

    const result = await pool.query(`
      UPDATE owner_articles 
      SET name = $1, description = $2, unit_price = $3, commission_rate = $4
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [name, description, unitPrice, commissionRate, req.params.id, user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article non trouvé' });
    }

    res.json({ article: result.rows[0] });
  } catch (err) {
    console.error('Erreur modification article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 4. SUPPRIMER UN ARTICLE (soft delete)
app.delete('/api/owner-articles/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const result = await pool.query(
      'UPDATE owner_articles SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article non trouvé' });
    }

    res.json({ message: 'Article supprimé' });
  } catch (err) {
    console.error('Erreur suppression article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 5. CRÉER ARTICLES PAR DÉFAUT
app.post('/api/owner-articles/init-defaults', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    await pool.query('SELECT create_default_owner_articles($1)', [userId]);

    res.json({ message: 'Articles par défaut créés' });
  } catch (err) {
    console.error('Erreur init articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FACTURES PROPRIÉTAIRES - LISTE & CRÉATION
// ============================================

// 1. LISTE DES FACTURES PROPRIÉTAIRES
app.get('/api/owner-invoices',
  authenticateAny,
  requirePermission(pool, 'can_view_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const result = await pool.query(`
            SELECT
        i.id,
        COALESCE(i.invoice_number, 'Brouillon #' || i.id::text) AS invoice_number,
        i.issue_date,
        i.total_ttc,
        i.status,
        i.is_credit_note,
        COALESCE(c.company_name, c.first_name || ' ' || c.last_name) AS client_name

      FROM owner_invoices i
      JOIN owner_clients c ON c.id = i.client_id
      WHERE i.user_id = $1
      ORDER BY i.issue_date DESC, i.id DESC
    `, [userId]);

    res.json({ invoices: result.rows });
  } catch (err) {
    console.error('Erreur liste factures propriétaires:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. CRÉER UNE NOUVELLE FACTURE PROPRIÉTAIRE (BROUILLON PAR DÉFAUT)
app.post('/api/owner-invoices',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const {
      clientId,
      periodStart,
      periodEnd,
      issueDate,
      dueDate,
      items = [],
      vatApplicable,
      vatRate,
      discountType,
      discountValue,
      notes,
      internalNotes
    } = req.body;

    if (!clientId || !issueDate || !dueDate || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Données facture incomplètes' });
    }

    await client.query('BEGIN');

    // Recalculer les totaux de la même façon que dans le PUT /api/owner-invoices/:id
    let subtotalHt = 0;
    let subtotalDebours = 0;

    items.forEach(item => {
      const itemTotal = parseFloat(item.total) || 0;
      if (item.isDebours) {
        subtotalDebours += itemTotal;
      } else {
        subtotalHt += itemTotal;
      }
    });

    let discountAmount = 0;
    if (discountType === 'percent') {
      discountAmount = subtotalHt * (parseFloat(discountValue) / 100 || 0);
    } else if (discountType === 'fixed') {
      discountAmount = parseFloat(discountValue) || 0;
    }

    const netHt = subtotalHt - discountAmount;
    const vatAmount = vatApplicable ? netHt * (parseFloat(vatRate) / 100 || 0) : 0;
    const totalTtc = netHt + subtotalDebours + vatAmount;

    // Création de la facture (brouillon)
    const invoiceResult = await client.query(`
      INSERT INTO owner_invoices (
        user_id,
        client_id,
        period_start,
        period_end,
        issue_date,
        due_date,
        vat_applicable,
        vat_rate,
        discount_type,
        discount_value,
        discount_amount,
        subtotal_ht,
        subtotal_debours,
        vat_amount,
        total_ttc,
        notes,
        internal_notes,
        status,
        created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,
        $9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,
        $18,
        NOW()
      )
      RETURNING *
    `, [
      userId,
      clientId,
      periodStart || null,
      periodEnd || null,
      issueDate,
      dueDate,
      !!vatApplicable,
      vatRate || 0,
      discountType || 'none',
      discountValue || 0,
      discountAmount,
      netHt,
      subtotalDebours,
      vatAmount,
      totalTtc,
      notes || null,
      internalNotes || null,
      'draft'
    ]);

    const invoice = invoiceResult.rows[0];
    const invoiceId = invoice.id;

    // Lignes de facture
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(`
        INSERT INTO owner_invoice_items (
          invoice_id, item_type, description,
          rental_amount, commission_rate,
          quantity, unit_price, total,
          order_index, is_debours
        ) VALUES (
          $1,$2,$3,
          $4,$5,
          $6,$7,$8,
          $9,$10
        )
      `, [
        invoiceId,
        item.itemType,
        item.description,
        item.rentalAmount || 0,
        item.commissionRate || 0,
        item.quantity || 0,
        item.unitPrice || 0,
        item.total || 0,
        i,
        item.isDebours || false
      ]);
    }
// Sauvegarder les logements liés
const propertyIds = req.body.propertyIds || [];
if (Array.isArray(propertyIds) && propertyIds.length > 0) {
  for (const propId of propertyIds) {
    await client.query(`
      INSERT INTO owner_invoice_properties (invoice_id, property_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [invoiceId, propId]);
  }
}
    await client.query('COMMIT');

    res.json({ invoice });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création facture propriétaire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});
// 2bis. RÉCUPÉRER UNE FACTURE PROPRIÉTAIRE PAR ID
app.get('/api/owner-invoices/:id',
  authenticateAny,
  requirePermission(pool, 'can_view_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Facture
    const invResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, userId]
    );

    if (invResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const invoice = invResult.rows[0];

    // Lignes
    // Récupérer les logements liés
const propertiesResult = await pool.query(
  `SELECT p.id, p.name, p.address 
   FROM owner_invoice_properties oip
   JOIN properties p ON p.id = oip.property_id
   WHERE oip.invoice_id = $1`,
  [invoiceId]
);

res.json({
  invoice,
  items: itemsResult.rows,
  properties: propertiesResult.rows
});

  } catch (err) {
    console.error('Erreur lecture facture propriétaire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// CRÉER UN AVOIR SUR UNE FACTURE EXISTANTE
app.post('/api/owner-invoices/:id/credit-note',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Récupérer la facture d'origine
    const origResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, userId]
    );

    if (origResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const orig = origResult.rows[0];

    if (orig.is_credit_note) {
      return res.status(400).json({ error: 'Impossible de créer un avoir sur un avoir.' });
    }
    if (orig.status === 'draft') {
      return res.status(400).json({ error: 'On ne peut créer un avoir que sur une facture facturée.' });
    }

    await client.query('BEGIN');

    // Totaux négatifs pour l'avoir
    const creditSubtotalHt     = -Number(orig.subtotal_ht     || 0);
    const creditSubtotalDebours = -Number(orig.subtotal_debours || 0);
    const creditVatAmount      = -Number(orig.vat_amount      || 0);
    const creditTotalTtc       = -Number(orig.total_ttc       || 0);
    const creditDiscountAmount = -Number(orig.discount_amount || 0);

    // Créer la facture d'avoir (statut "invoiced" directement)
    const insertResult = await client.query(`
      INSERT INTO owner_invoices (
        user_id,
        client_id,
        period_start,
        period_end,
        issue_date,
        due_date,
        vat_applicable,
        vat_rate,
        discount_type,
        discount_value,
        discount_amount,
        subtotal_ht,
        subtotal_debours,
        vat_amount,
        total_ttc,
        notes,
        internal_notes,
        status,
        is_credit_note,
        original_invoice_id,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,
        CURRENT_DATE,
        $5,
        $6,$7,
        $8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,
        'invoiced',
        TRUE,
        $17,
        NOW()
      )
      RETURNING *
    `, [
      orig.user_id,
      orig.client_id,
      orig.period_start,
      orig.period_end,
      orig.due_date,
      orig.vat_applicable,
      orig.vat_rate,
      orig.discount_type,
      orig.discount_value,
      creditDiscountAmount,
      creditSubtotalHt,
      creditSubtotalDebours,
      creditVatAmount,
      creditTotalTtc,
      orig.notes,
      orig.internal_notes,
      orig.id
    ]);

    const credit = insertResult.rows[0];
    const creditId = credit.id;

    // Générer un numéro d'avoir type A-2025-0007
    const year = new Date().getFullYear();
    const creditNumber = `A-${year}-${String(creditId).padStart(4, '0')}`;

    await client.query(
      'UPDATE owner_invoices SET invoice_number = $1 WHERE id = $2',
      [creditNumber, creditId]
    );

    // Copier les lignes en négatif
    await client.query(`
      INSERT INTO owner_invoice_items (
        invoice_id, item_type, description,
        rental_amount, commission_rate,
        quantity, unit_price, total,
        order_index, is_debours
      )
      SELECT
        $1,
        item_type,
        description,
        -rental_amount,
        commission_rate,
        -quantity,
        -unit_price,
        -total,
        order_index,
        is_debours
      FROM owner_invoice_items
      WHERE invoice_id = $2
    `, [creditId, invoiceId]);

    await client.query('COMMIT');

    // Renvoie l'avoir créé
    res.json({ invoice: { ...credit, invoice_number: creditNumber } });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création avoir propriétaire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});
// ============================================
// ROUTES API - FACTURES CLIENTS (AVEC API BREVO)
// ============================================

// NOTE : Cette route utilise l'API Brevo au lieu de SMTP
// car Render bloque parfois le port 587

app.post('/api/invoice/create',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    // Récupérer le profil utilisateur pour le PDF/email
    const profileResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = profileResult.rows[0];
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const { 
      clientName, 
      clientEmail,
      clientAddress, 
      clientPostalCode, 
      clientCity, 
      clientSiret,
      propertyName, 
      propertyAddress,
      checkinDate,
      checkoutDate,
      nights,
      rentAmount, 
      touristTaxAmount, 
      cleaningFee,
      vatRate,
      sendEmail
    } = req.body;

    // Générer le numéro de facture
    const invoiceNumber = 'FACT-' + Date.now();
    const invoiceId = 'inv_' + Date.now();

    // Calculer les montants
    const subtotal = parseFloat(rentAmount || 0) + parseFloat(touristTaxAmount || 0) + parseFloat(cleaningFee || 0);
    const vatAmount = subtotal * (parseFloat(vatRate || 0) / 100);
    const total = subtotal + vatAmount;

    

    
// Générer un PDF simple (serveur) avec PDFKit
    async function generateInvoicePdfToFile(outputPath) {
      return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);

        doc.fontSize(20).text(`FACTURE ${invoiceNumber}`, { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Émetteur : ${user.company || 'Conciergerie'}`);
        if (user.email) doc.text(`Email : ${user.email}`);
        doc.moveDown();

        doc.fontSize(12).text(`Client : ${clientName}`);
        if (clientAddress) doc.text(`Adresse : ${clientAddress}`);
        const cityLine = `${clientPostalCode || ''} ${clientCity || ''}`.trim();
        if (cityLine) doc.text(cityLine);
        if (clientSiret) doc.text(`SIRET : ${clientSiret}`);
        doc.moveDown();

        doc.text(`Logement : ${propertyName}`);
        if (propertyAddress) doc.text(`Adresse : ${propertyAddress}`);

        if (checkinDate && checkoutDate) {
          const ci = new Date(checkinDate).toLocaleDateString('fr-FR');
          const co = new Date(checkoutDate).toLocaleDateString('fr-FR');
          doc.text(`Séjour : du ${ci} au ${co} (${nights} nuit${nights > 1 ? 's' : ''})`);
        }

        doc.moveDown();
        doc.fontSize(13).text('Détails', { underline: true });
        doc.moveDown(0.5);

        const addLine = (label, value) => {
          doc.fontSize(12).text(`${label} : ${Number(value).toFixed(2)} €`);
        };
// ✅ Download facture PDF via token expirant
app.get('/api/invoice/download/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const r = await pool.query(
      `SELECT file_path, invoice_number, expires_at
       FROM invoice_download_tokens
       WHERE token = $1`,
      [token]
    );

    if (!r.rowCount) return res.status(404).send('Lien invalide.');

    const row = r.rows[0];
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(410).send('Lien expiré.');
    }

    const absolutePath = path.resolve(row.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).send('Fichier introuvable.');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.invoice_number}.pdf"`
    );

    fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    console.error('❌ Erreur download invoice:', err);
    res.status(500).send('Erreur serveur.');
  }
});

        if (parseFloat(rentAmount || 0) > 0) addLine('Loyer', rentAmount);
        if (parseFloat(touristTaxAmount || 0) > 0) addLine('Taxes de séjour', touristTaxAmount);
        if (parseFloat(cleaningFee || 0) > 0) addLine('Frais de ménage', cleaningFee);

        doc.moveDown();
        doc.fontSize(12).text(`Sous-total : ${subtotal.toFixed(2)} €`);
        if (vatAmount > 0) doc.text(`TVA (${vatRate}%) : ${vatAmount.toFixed(2)} €`);
        doc.fontSize(16).text(`TOTAL TTC : ${total.toFixed(2)} €`, { underline: true });

        doc.end();

        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    }

// Si sendEmail est true, envoyer l'email via API Brevo

    if (sendEmail && clientEmail) {
      const profile = user;
      

      // 1) Générer le fichier PDF
      const pdfPath = path.join(INVOICE_PDF_DIR, `${invoiceNumber}.pdf`);
      await generateInvoicePdfToFile(pdfPath);

      // 2) Créer un token expirant 24h
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO invoice_download_tokens (token, user_id, invoice_number, file_path, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token, userId, invoiceNumber, pdfPath, expiresAt]
      );

      // 3) Construire l'URL de download (idéalement via env)
      const origin = new URL(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).origin;
const pdfUrl = `${origin}/api/invoice/download/${token}`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111827;">Facture N° ${invoiceNumber}</h2>
          <p><strong>De :</strong> ${profile.company || 'Conciergerie'}</p>
          <p><strong>Pour :</strong> ${clientName}</p>
          <p><strong>Logement :</strong> ${propertyName}</p>
          ${propertyAddress ? `<p><strong>Adresse :</strong> ${propertyAddress}</p>` : ''}
          ${checkinDate && checkoutDate ? `<p><strong>Séjour :</strong> Du ${new Date(checkinDate).toLocaleDateString('fr-FR')} au ${new Date(checkoutDate).toLocaleDateString('fr-FR')} (${nights} nuit${nights > 1 ? 's' : ''})</p>` : ''}
          
          <h3 style="margin-top: 24px; color: #374151;">Détails de la facture</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${rentAmount > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Loyer</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(rentAmount).toFixed(2)} €</td></tr>` : ''}
            ${touristTaxAmount > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Taxes de séjour</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(touristTaxAmount).toFixed(2)} €</td></tr>` : ''}
            ${cleaningFee > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Frais de ménage</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(cleaningFee).toFixed(2)} €</td></tr>` : ''}
          </table>
          
          <p style="margin-top: 16px; font-weight: 600;">Sous-total : ${subtotal.toFixed(2)} €</p>
          ${vatAmount > 0 ? `<p style="font-weight: 600;">TVA (${vatRate}%) : ${vatAmount.toFixed(2)} €</p>` : ''}
          <h3 style="font-size: 20px; color: #10B981; margin-top: 24px;">TOTAL TTC : ${total.toFixed(2)} €</h3>
          
          <div style="background: #ecfdf5; border: 2px solid #10B981; border-radius: 8px; padding: 16px; margin-top: 24px; text-align: center;">
            <p style="color: #10B981; font-weight: bold; margin: 0; font-size: 18px;">✓ FACTURE ACQUITTÉE</p>
          </div>

          <div style="margin-top: 18px; text-align: center;">
            <a href="${pdfUrl}"
              style="display:inline-block; padding:12px 18px; background:#111827; color:#fff; text-decoration:none; border-radius:10px; font-weight:700;">
              Télécharger la facture (PDF)
            </a>
            <div style="font-size:12px; color:#6b7280; margin-top:10px;">
              Lien valable 24h.
            </div>
          </div>

          <p style="font-size: 12px; color: #6b7280; margin-top: 32px; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 16px;">
            ${profile.company || 'Ma Conciergerie'}<br>
            ${profile.address || ''} ${profile.postalCode || ''} ${profile.city || ''}<br>
            ${profile.siret ? 'SIRET : ' + profile.siret + '<br>' : ''}
            ${user.email || ''}
          </p>
        </div>
      `;

      // Envoyer via transporter (utilise automatiquement Brevo API avec nettoyage)
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM || user.email,
          to: clientEmail,
          subject: `Facture ${invoiceNumber} - ${propertyName}`,
          html: emailHtml
        });
        
        console.log('✅ Email facture client envoyé à:', clientEmail);

      } catch (emailErr) {
        console.error('❌ Erreur envoi email facture client:', emailErr);
      }
    }
    
    res.json({ 
      success: true, 
      invoiceNumber,
      invoiceId,
      message: 'Facture créée avec succès' 
    });
    
  } catch (err) {
    console.error('Erreur création facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FACTURES - ROUTES MODIFIÉES (AVEC RÉDUCTIONS)
// ============================================

// 6. MODIFIER UNE FACTURE BROUILLON
app.put('/api/owner-invoices/:id',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    // Vérifier que c'est un brouillon
    const checkResult = await client.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent être modifiés' });
    }

    await client.query('BEGIN');

    const {
      items,
      vatApplicable, vatRate,
      discountType, discountValue,
      notes, internalNotes
    } = req.body;

    // Recalculer totaux
    let subtotalHt = 0;
    let subtotalDebours = 0;

    items.forEach(item => {
      const itemTotal = parseFloat(item.total || 0);
      if (item.isDebours) {
        subtotalDebours += itemTotal;
      } else {
        subtotalHt += itemTotal;
      }
    });

    // Calculer réduction
    let discountAmount = 0;
    if (discountType === 'percentage') {
      discountAmount = subtotalHt * (parseFloat(discountValue) / 100);
    } else if (discountType === 'fixed') {
      discountAmount = parseFloat(discountValue);
    }

    const netHt = subtotalHt - discountAmount;
    const vatAmount = vatApplicable ? netHt * (parseFloat(vatRate) / 100) : 0;
    const totalTtc = netHt + subtotalDebours + vatAmount;

    // Mettre à jour facture
    await client.query(`
      UPDATE owner_invoices SET
        vat_applicable = $1, vat_rate = $2,
        discount_type = $3, discount_value = $4, discount_amount = $5,
        subtotal_ht = $6, subtotal_debours = $7, vat_amount = $8, total_ttc = $9,
        notes = $10, internal_notes = $11
      WHERE id = $12
    `, [
      vatApplicable, vatRate,
      discountType || 'none', discountValue || 0, discountAmount,
      subtotalHt, subtotalDebours, vatAmount, totalTtc,
      notes, internalNotes,
      req.params.id
    ]);

    // Supprimer anciennes lignes
    await client.query('DELETE FROM owner_invoice_items WHERE invoice_id = $1', [req.params.id]);

    // Insérer nouvelles lignes
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(`
        INSERT INTO owner_invoice_items (
          invoice_id, item_type, description,
          rental_amount, commission_rate, quantity, unit_price, total,
          order_index, is_debours
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        req.params.id, item.itemType, item.description,
        item.rentalAmount, item.commissionRate, item.quantity, item.unitPrice, item.total,
        i, item.isDebours || false
      ]);
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Facture modifiée' });


// Télécharger une facture PDF via token expirant
    console.log('✅ REGISTER: /api/invoice/download/:token');
app.get('/api/invoice/download/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const r = await pool.query(
      `SELECT file_path, invoice_number, expires_at
       FROM invoice_download_tokens
       WHERE token = $1`,
      [token]
    );

    if (!r.rowCount) return res.status(404).send('Lien invalide.');
    const row = r.rows[0];

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(410).send('Lien expiré.');
    }

    const absolutePath = path.resolve(row.file_path);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).send('Fichier introuvable.');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.invoice_number}.pdf"`
    );

    fs.createReadStream(absolutePath).pipe(res);

  } catch (err) {
    console.error('❌ Erreur download invoice:', err);
    res.status(500).send('Erreur serveur.');
  }
});

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur modification facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// 7. SUPPRIMER UNE FACTURE BROUILLON
app.delete('/api/owner-invoices/:id',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    // Vérifier que c'est un brouillon
    const checkResult = await pool.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent être supprimés. Créez un avoir pour annuler.' });
    }

    await pool.query('DELETE FROM owner_invoices WHERE id = $1', [req.params.id]);

    res.json({ message: 'Facture supprimée' });
  } catch (err) {
    console.error('Erreur suppression facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// 2bis. VALIDER UNE FACTURE (BROUILLON -> FACTURÉE)
app.post('/api/owner-invoices/:id/finalize',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Récupérer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const invoice = result.rows[0];

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent être validés.' });
    }

    // Générer un numéro si absent
    let invoiceNumber = invoice.invoice_number;
    if (!invoiceNumber) {
      const year = new Date().getFullYear();
      invoiceNumber = `P-${year}-${String(invoice.id).padStart(4, '0')}`;
    }

    const updateResult = await pool.query(
      `UPDATE owner_invoices
       SET status = $1, invoice_number = $2
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      ['invoiced', invoiceNumber, invoiceId, userId]
    );

    res.json({ invoice: updateResult.rows[0] });
  } catch (err) {
    console.error('Erreur finalisation facture propriétaire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 8. ENVOYER UN BROUILLON
app.post('/api/owner-invoices/:id/send',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    // Récupérer la facture
    const invoiceResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Cette facture a déjà été envoyée' });
    }

    // Récupérer les items
    const itemsResult = await pool.query(
      'SELECT * FROM owner_invoice_items WHERE invoice_id = $1 ORDER BY order_index',
      [req.params.id]
    );

    // Mettre à jour statut
    await pool.query(
      'UPDATE owner_invoices SET status = $1, sent_at = NOW() WHERE id = $2',
      ['sent', req.params.id]
    );

    // Envoyer email
    if (invoice.client_email) {
      try {
        // Récupérer le profil pour l'email
        const profileResult = await pool.query('SELECT company, email FROM users WHERE id = $1', [userId]);
        const profile = profileResult.rows[0] || {};

        await sendOwnerInvoiceEmail({
          invoiceNumber: invoice.invoice_number,
          clientName: invoice.client_name,
          clientEmail: invoice.client_email,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
          totalTtc: invoice.total_ttc,
          items: itemsResult.rows,
          userCompany: profile.company,
          userEmail: profile.email
        });
      } catch (emailErr) {
        console.error('Erreur envoi email:', emailErr);
      }
    }

    res.json({ success: true, message: 'Facture envoyée' });

  } catch (err) {
    console.error('Erreur envoi facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// MARQUER UNE FACTURE COMME ENCAISSÉE
app.post('/api/owner-invoices/:id/mark-paid',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Récupérer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const invoice = result.rows[0];

    if (invoice.status === 'draft') {
      return res.status(400).json({ error: 'Vous devez d\'abord valider cette facture.' });
    }

    // Marquer comme payée (sans paid_at)
    const updateResult = await pool.query(
      `UPDATE owner_invoices
       SET status = 'paid'
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [invoiceId, userId]
    );

    res.json({ success: true, invoice: updateResult.rows[0] });
  } catch (err) {
    console.error('Erreur marquage facture payée:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// AVOIRS
// ============================================

// 9. CRÉER UN AVOIR
app.post('/api/owner-credit-notes',
  authenticateAny,
  requirePermission(pool, 'can_manage_invoices'),
  async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    await client.query('BEGIN');

    const { invoiceId, reason } = req.body;

    // Récupérer la facture d'origine
    const invoiceResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, userId]
    );

    if (invoiceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'sent' && invoice.status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Seules les factures envoyées peuvent avoir un avoir' });
    }

    // Vérifier qu'il n'y a pas déjà un avoir
    const existingCredit = await client.query(
      'SELECT id FROM owner_credit_notes WHERE original_invoice_id = $1',
      [invoiceId]
    );

    if (existingCredit.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Un avoir existe déjà pour cette facture' });
    }

    // Générer numéro avoir
    const creditNumberResult = await client.query(
      'SELECT get_next_credit_note_number($1) as credit_note_number',
      [userId]
    );
    const creditNoteNumber = creditNumberResult.rows[0].credit_note_number;

    // Créer l'avoir (montants négatifs)
    const creditResult = await client.query(`
      INSERT INTO owner_credit_notes (
        credit_note_number, user_id, original_invoice_id, original_invoice_number,
        client_id, client_name, client_email,
        subtotal_ht, subtotal_debours, vat_amount, total_ttc,
        reason, status, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING id
    `, [
      creditNoteNumber, userId, invoiceId, invoice.invoice_number,
      invoice.client_id, invoice.client_name, invoice.client_email,
      -invoice.subtotal_ht, -invoice.subtotal_debours, -invoice.vat_amount, -invoice.total_ttc,
      reason, 'issued'
    ]);

    const creditNoteId = creditResult.rows[0].id;

    // Copier les lignes (négatif)
    const itemsResult = await client.query(
      'SELECT * FROM owner_invoice_items WHERE invoice_id = $1',
      [invoiceId]
    );

    for (const item of itemsResult.rows) {
      await client.query(`
        INSERT INTO owner_credit_note_items (credit_note_id, item_type, description, total, order_index)
        VALUES ($1, $2, $3, $4, $5)
      `, [creditNoteId, item.item_type, item.description, -item.total, item.order_index]);
    }

    // Mettre à jour facture (lien vers avoir + statut cancelled)
    await client.query(
      'UPDATE owner_invoices SET credit_note_id = $1, status = $2 WHERE id = $3',
      [creditNoteId, 'cancelled', invoiceId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      creditNoteId,
      creditNoteNumber,
      message: 'Avoir créé et facture annulée'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création avoir:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// 10. LISTE DES AVOIRS
app.get('/api/owner-credit-notes',
  authenticateAny,
  requirePermission(pool, 'can_view_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const result = await pool.query(
      `SELECT * FROM owner_credit_notes 
       WHERE user_id = $1 
       ORDER BY issue_date DESC`,
      [userId]
    );

    res.json({ creditNotes: result.rows });
  } catch (err) {
    console.error('Erreur liste avoirs:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 11. DÉTAIL AVOIR
app.get('/api/owner-credit-notes/:id',
  authenticateAny,
  requirePermission(pool, 'can_view_invoices'),
  async (req, res) => {
  try {
    const userId = req.user.isSubAccount
      ? (await getRealUserId(pool, req))
      : (await getUserFromRequest(req))?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé' });

    const creditResult = await pool.query(
      'SELECT * FROM owner_credit_notes WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );

    if (creditResult.rows.length === 0) {
      return res.status(404).json({ error: 'Avoir non trouvé' });
    }

    const itemsResult = await pool.query(
      'SELECT * FROM owner_credit_note_items WHERE credit_note_id = $1 ORDER BY order_index',
      [req.params.id]
    );

    res.json({
      creditNote: creditResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    console.error('Erreur détail avoir:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Routes pour les pages publiques (pas d'authentification requise)
app.get('/chat/:photosToken/cleaning-photos', (req, res) => {
  console.log('✅ Route cleaning-photos appelée ! Token:', req.params.photosToken);
  res.sendFile(path.join(__dirname, 'public', 'html', 'cleaning-photos.html'));
});

app.get('/chat/:photosToken/checkout-form', (req, res) => {
  console.log('✅ Route checkout-form appelée ! Token:', req.params.photosToken);
  res.sendFile(path.join(__dirname, 'public', 'html', 'checkout-form.html'));
});
// Route de test (à ajouter temporairement)
app.post('/api/test-notif', async (req, res) => {
  try {
    const result = await sendNotification(
      'c0FiPJpgR8W2uamYdAM5VE:APA91bGmWYKtrCmoicgRmTGCJWF5NHpauBqgt_p1F6uJ8_D43Og2wftJCUMope773X118jM88IaTkFLCtGCCdJg8GAOLhWMw7gHhK8U5Ntk2SHqb8xzKZYY',
      '🧪 Test depuis serveur',
      'Ça marche !',
      { type: 'test' }
    );
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// FIN DES ROUTES V2
// ============================================
// ============================================
// ✅ NOUVEAU : ROUTES POUR LIVRETS D'ACCUEIL
// ============================================
app.locals.pool = pool;
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/api/welcome-books', welcomeRouter);
// ============================================
// ============================================
// NOTES D'INSTALLATION
// ============================================

/*
1. Installer les dépendances :
   npm install exceljs

2. Créer le dossier uploads :
   mkdir -p public/uploads/justificatifs

3. Les dépendances nodemailer et pdfkit sont déjà installées
*/
// ============================================
// ROUTES STRIPE - À COPIER DANS server.js
// Placer APRÈS les autres routes API, AVANT server.listen()
// ============================================

// ============================================
// 1. FONCTION : Récupérer le Price ID Stripe
// ============================================
// ============================================
// GESTION DES PLANS STRIPE - VERSION FINALE
// ============================================

// ============================================
// 1. FONCTION : Obtenir le Price ID Stripe
// ============================================
function getPriceIdForPlan(plan) {
  const planLower = (plan || 'solo_monthly').toLowerCase();
  
  // ✅ Plan Solo (15€/mois - 149€/an)
  if (planLower === 'solo_monthly' || planLower === 'solo') {
    return process.env.STRIPE_PRICE_SOLO_MONTHLY;
  }
  if (planLower === 'solo_annual') {
    return process.env.STRIPE_PRICE_SOLO_ANNUAL;
  }
  
  // ✅ Plan Standard (29€/mois - 289€/an)
  if (planLower === 'standard_monthly' || planLower === 'standard') {
    return process.env.STRIPE_PRICE_STANDARD_MONTHLY;
  }
  if (planLower === 'standard_annual') {
    return process.env.STRIPE_PRICE_STANDARD_ANNUAL;
  }
  
  // ✅ Plan Standard Extra (7€/mois - 70€/an par logement supplémentaire)
  if (planLower === 'standard_extra_monthly') {
    return process.env.STRIPE_PRICE_STANDARD_EXTRA_MONTHLY;
  }
  if (planLower === 'standard_extra_annual') {
    return process.env.STRIPE_PRICE_STANDARD_EXTRA_ANNUAL;
  }
  
  // ✅ Plan Pro (49€/mois - 489€/an)
  if (planLower === 'pro_monthly' || planLower === 'pro') {
    return process.env.STRIPE_PRICE_PRO_MONTHLY;
  }
  if (planLower === 'pro_annual') {
    return process.env.STRIPE_PRICE_PRO_ANNUAL;
  }
  
  // ✅ Plan Pro Extra (5€/mois - 50€/an par logement supplémentaire)
  if (planLower === 'pro_extra_monthly') {
    return process.env.STRIPE_PRICE_PRO_EXTRA_MONTHLY;
  }
  if (planLower === 'pro_extra_annual') {
    return process.env.STRIPE_PRICE_PRO_EXTRA_ANNUAL;
  }
  
  // Par défaut : Solo mensuel
  console.warn(`⚠️ Plan inconnu: ${plan}, utilisation du plan Solo mensuel par défaut`);
  return process.env.STRIPE_PRICE_SOLO_MONTHLY;
}

// ============================================
// 1b. FONCTION : Récupérer le nom du plan depuis un Price ID
// ============================================
function getPlanFromPriceId(priceId) {
  if (!priceId) return 'solo_monthly';
  
  // Solo
  if (priceId === process.env.STRIPE_PRICE_SOLO_MONTHLY) return 'solo_monthly';
  if (priceId === process.env.STRIPE_PRICE_SOLO_ANNUAL) return 'solo_annual';
  
  // Standard
  if (priceId === process.env.STRIPE_PRICE_STANDARD_MONTHLY) return 'standard_monthly';
  if (priceId === process.env.STRIPE_PRICE_STANDARD_ANNUAL) return 'standard_annual';
  
  // Pro
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return 'pro_monthly';
  if (priceId === process.env.STRIPE_PRICE_PRO_ANNUAL) return 'pro_annual';
  
  console.warn(`⚠️ Price ID inconnu: ${priceId}, utilisation du plan Solo par défaut`);
  return 'solo_monthly';
}

// ============================================
// 2. FONCTION : Extraire le nom de base du plan
// ============================================
function getBasePlanName(plan) {
  const planLower = (plan || 'solo').toLowerCase();
  
  if (planLower.includes('solo')) return 'solo';
  if (planLower.includes('standard')) return 'standard';
  if (planLower.includes('pro')) return 'pro';
  
  return 'solo';
}

// ============================================
// 3. FONCTION : Calculer le montant du plan (en euros)
// ============================================
function getPlanAmount(plan) {
  const basePlan = getBasePlanName(plan);
  const isAnnual = (plan || '').toLowerCase().includes('annual');
  
  if (basePlan === 'solo') {
    return isAnnual ? 149 : 15;
  }
  if (basePlan === 'standard') {
    return isAnnual ? 289 : 29;
  }
  if (basePlan === 'pro') {
    return isAnnual ? 489 : 49;
  }
  
  return 15; // Par défaut
}

// ============================================
// 4. FONCTION : Nom d'affichage du plan
// ============================================
function getPlanDisplayName(plan) {
  const basePlan = getBasePlanName(plan);
  
  if (basePlan === 'solo') return 'Solo';
  if (basePlan === 'standard') return 'Standard';
  if (basePlan === 'pro') return 'Pro';
  
  return 'Solo';
}

// ============================================
// 5. FONCTION : Limites du plan
// ============================================
function getPlanLimits(plan) {
  const basePlan = getBasePlanName(plan);
  
  const limits = {
    solo: {
      included: 1,
      extraPrice: null,
      extraPriceAnnual: null
    },
    standard: {
      included: 3,
      extraPrice: 7,
      extraPriceAnnual: 70
    },
    pro: {
      included: 6,
      extraPrice: 5,
      extraPriceAnnual: 50
    }
  };
  
  return limits[basePlan] || limits.solo;
}

// ============================================
// 6. FONCTION : Calculer le coût total
// ============================================
function calculateTotalCost(plan, propertyCount) {
  const basePlan = getBasePlanName(plan);
  const isAnnual = (plan || '').toLowerCase().includes('annual');
  const limits = getPlanLimits(basePlan);
  
  const basePrice = getPlanAmount(plan);
  const extraCount = Math.max(0, propertyCount - limits.included);
  
  let extraPrice = 0;
  if (extraCount > 0 && limits.extraPrice) {
    extraPrice = extraCount * (isAnnual ? limits.extraPriceAnnual : limits.extraPrice);
  }
  
  return basePrice + extraPrice;
}

// ============================================
// POST /api/billing/create-checkout-session
// Créer une session de paiement Stripe
// ============================================
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré' });
    }

    // Validation du plan
    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ 
        error: 'Plan requis',
        validPlans: ['solo_monthly', 'solo_annual', 'standard_monthly', 'standard_annual', 'pro_monthly', 'pro_annual']
      });
    }

    // ✅ Plans valides (UNIQUEMENT solo, standard, pro)
    const validPlans = [
      'solo_monthly', 'solo_annual',
      'standard_monthly', 'standard_annual',
      'pro_monthly', 'pro_annual'
    ];
    
    const planLower = plan.toLowerCase();
    if (!validPlans.includes(planLower)) {
      return res.status(400).json({ 
        error: 'Plan invalide',
        received: plan,
        validPlans: validPlans
      });
    }

    // Obtenir le Price ID
    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      console.error(`❌ Aucun Price ID trouvé pour le plan: ${plan}`);
      return res.status(400).json({ 
        error: 'Plan non configuré dans Stripe',
        hint: `Vérifiez que STRIPE_PRICE_${plan.toUpperCase()} existe dans votre .env`
      });
    }

    console.log('✅ Création session Stripe:', {
      user: user.email,
      userId: user.id,
      plan: plan,
      priceId: priceId
    });

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // ✅ CORRECTION CRITIQUE : Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      subscription_data: {
        metadata: {
          userId: user.id.toString(),
          plan: plan,
          planDisplay: getPlanDisplayName(plan)
        }
      },
      customer_email: user.email,
      client_reference_id: user.id.toString(),
      success_url: `${appUrl}/settings-account.html?tab=subscription&success=true`,
      cancel_url: `${appUrl}/pricing.html?cancelled=true`,
      locale: 'fr'
    });

    console.log('✅ Session créée avec succès:', session.id);

    res.json({ 
      url: session.url,
      sessionId: session.id
    });

  } catch (err) {
    console.error('❌ Erreur create-checkout-session:', err);
    console.error('Stack:', err.stack);
    
    res.status(500).json({ 
      error: 'Impossible de créer la session de paiement',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});


// ============================================
// GET /api/subscription/status
// Récupérer le statut d'abonnement de l'utilisateur
// ============================================

// ============================================
// POST /api/billing/create-portal-session
// Créer une session Stripe Customer Portal
// ============================================

// ============================================
// ROUTES POUR MESSAGE DE RÉSERVATION AVEC CLEANING PHOTOS
// À ajouter dans chat_routes-4.js
// ============================================

/**
 * Générer le message de bienvenue à envoyer sur Airbnb/Booking
 * avec lien vers les photos du cleaning
 */
// ============================================
  // 8. GÉNÉRATION DE MESSAGE DE RÉSERVATION
  // ============================================
  
  app.post('/api/chat/generate-booking-message/:conversationId', authenticateAny, checkSubscription, async (req, res) => {
    try {
      const userId = req.user.id;
      const { conversationId } = req.params;
      
      // 1. Récupérer la conversation
      const convResult = await pool.query(
        `SELECT c.*, p.name as property_name 
         FROM conversations c
         LEFT JOIN properties p ON c.property_id = p.id
         WHERE c.id = $1 AND c.user_id = $2`,
        [conversationId, userId]
      );
      
      if (convResult.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation non trouvée' });
      }
      
      const conversation = convResult.rows[0];
      
      // 2. Générer ou récupérer le token pour les photos
      let photosToken = conversation.photos_token;
      
      if (!photosToken) {
        photosToken = crypto.randomBytes(32).toString('hex');
        
        await pool.query(
          'UPDATE conversations SET photos_token = $1 WHERE id = $2',
          [photosToken, conversationId]
        );
      }
      
      // 3. Construire le reservation_key pour trouver le cleaning
      const startDate = new Date(conversation.reservation_start_date).toISOString().split('T')[0];
      const endDate = conversation.reservation_end_date 
        ? new Date(conversation.reservation_end_date).toISOString().split('T')[0]
        : null;
      
      const reservationKey = endDate 
        ? `${conversation.property_id}_${startDate}_${endDate}`
        : null;
      
      // 4. Vérifier si un cleaning checklist existe
      let hasCleaningPhotos = false;
      let cleaningPhotoCount = 0;
      
      if (reservationKey) {
        const cleaningResult = await pool.query(
          `SELECT photos FROM cleaning_checklists WHERE reservation_key = $1`,
          [reservationKey]
        );
        
        if (cleaningResult.rows.length > 0) {
          const photos = cleaningResult.rows[0].photos;
          cleaningPhotoCount = Array.isArray(photos) ? photos.length : 
                             (typeof photos === 'string' ? JSON.parse(photos).length : 0);
          hasCleaningPhotos = cleaningPhotoCount > 0;
        }
      }
      
      // 5. Générer le message
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const baseUrl = appUrl.replace(/\/$/, ''); // Enlève le / final s'il existe
      const chatLink = `${baseUrl}/chat/${conversation.unique_token}`;
      const cleaningPhotosLink = `${baseUrl}/chat/${photosToken}/cleaning-photos`;
      const checkoutFormLink = `${baseUrl}/chat/${photosToken}/checkout-form`;
      
      const propertyName = conversation.property_name || 'votre logement';
      const pinCode = conversation.pin_code;
      
      let message = `🎉 Bienvenue dans ${propertyName} !

📋 Informations importantes :
- Code PIN pour le chat sécurisé : ${pinCode}
- Accédez au chat pour toutes vos questions : ${chatLink}

`;
      
      if (hasCleaningPhotos) {
        message += `🧹 État du logement à votre arrivée :
Consultez les photos du nettoyage effectué juste avant votre arrivée (${cleaningPhotoCount} photos) :
👉 ${cleaningPhotosLink}

`;
      }
      
      message += `📸 Photos de départ (optionnel) :
Si vous le souhaitez, vous pouvez prendre quelques photos avant de partir pour documenter l'état du logement :
👉 ${checkoutFormLink}

Bon séjour ! 🏡`;
      
      res.json({
        success: true,
        message: message,
        links: {
          chat: chatLink,
          cleaningPhotos: hasCleaningPhotos ? cleaningPhotosLink : null,
          checkoutForm: checkoutFormLink
        },
        hasCleaningPhotos,
        cleaningPhotoCount,
        pinCode
      });
      
    } catch (error) {
      console.error('❌ Erreur génération message:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // ============================================
  // GESTION SOCKET.IO
  // ============================================

/**
 * Récupérer les informations pour afficher les photos du cleaning
 */
app.get('/api/chat/:photosToken/cleaning-info', async (req, res) => {
  try {
    const { photosToken } = req.params;

    // 1. Trouver la conversation via le photos_token
    const convResult = await pool.query(
      `SELECT c.*, p.name as property_name 
       FROM conversations c
       LEFT JOIN properties p ON c.property_id = p.id
       WHERE c.photos_token = $1`,
      [photosToken]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lien invalide' });
    }

    const conversation = convResult.rows[0];

    // 2. Construire le reservation_key
    const startDate = new Date(conversation.reservation_start_date).toISOString().split('T')[0];
    const endDate = conversation.reservation_end_date 
      ? new Date(conversation.reservation_end_date).toISOString().split('T')[0]
      : null;
    
    const reservationKey = endDate 
      ? `${conversation.property_id}_${startDate}_${endDate}`
      : null;

    if (!reservationKey) {
      return res.status(404).json({ error: 'Informations de réservation incomplètes' });
    }

    // 3. Récupérer le cleaning checklist
    const cleaningResult = await pool.query(
      `SELECT 
        id, photos, departure_photos, completed_at, guest_name,
        checkout_date, notes
       FROM cleaning_checklists 
       WHERE reservation_key = $1`,
      [reservationKey]
    );

    if (cleaningResult.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun nettoyage trouvé pour cette réservation' });
    }

    const cleaning = cleaningResult.rows[0];

    // 4. Parser les photos
    const arrivalPhotos = typeof cleaning.photos === 'string' 
      ? JSON.parse(cleaning.photos) 
      : (cleaning.photos || []);
    
    const departurePhotos = cleaning.departure_photos 
      ? (typeof cleaning.departure_photos === 'string' 
          ? JSON.parse(cleaning.departure_photos) 
          : cleaning.departure_photos)
      : [];

    res.json({
      success: true,
      propertyName: conversation.property_name,
      guestName: conversation.guest_name || cleaning.guest_name,
      checkinDate: conversation.reservation_start_date,
      checkoutDate: conversation.reservation_end_date || cleaning.checkout_date,
      cleaningCompletedAt: cleaning.completed_at,
      arrivalPhotos,
      departurePhotos,
      notes: cleaning.notes
    });

  } catch (error) {
    console.error('❌ Erreur récupération cleaning info:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Upload des photos de départ par le guest
 */
app.post('/api/chat/:photosToken/checkout-photos', async (req, res) => {
  try {
    const { photosToken } = req.params;
    const { photos } = req.body;
    
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'Aucune photo fournie' });
    }
    
    if (photos.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 photos autorisées' });
    }
    
    // 1. Trouver la conversation
    const convResult = await pool.query(
      `SELECT * FROM conversations WHERE photos_token = $1`,
      [photosToken]
    );
    
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lien invalide' });
    }
    
    const conversation = convResult.rows[0];
    
    // 2. Construire le reservation_key
    const startDate = new Date(conversation.reservation_start_date).toISOString().split('T')[0];
    const endDate = conversation.reservation_end_date 
      ? new Date(conversation.reservation_end_date).toISOString().split('T')[0]
      : null;
    
    const reservationKey = endDate 
      ? `${conversation.property_id}_${startDate}_${endDate}`
      : null;
    
    if (!reservationKey) {
      return res.status(404).json({ error: 'Informations de réservation incomplètes' });
    }
    
    // 🔍 DEBUG : Voir ce qu'on cherche
    console.log('🔍 Recherche cleaning_checklist avec reservation_key:', reservationKey);
    
    // Vérifier si le checklist existe
    const checkExists = await pool.query(
      `SELECT id, reservation_key FROM cleaning_checklists WHERE reservation_key = $1`,
      [reservationKey]
    );
    
    console.log('✅ Cleaning checklists trouvés:', checkExists.rows);
    
    if (checkExists.rows.length === 0) {
  console.log('⚠️ Aucun cleaning_checklist trouvé, création...');
  
  const createResult = await pool.query(
    `INSERT INTO cleaning_checklists (
      user_id,
      property_id,
      reservation_key,
      cleaner_id,
      checkout_date,
      tasks,
      photos,
      sent_to_owner,
      sent_to_guest,
      created_at,
      updated_at,
      departure_photos,
      departure_photos_uploaded_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10, NOW())
    RETURNING id`,
    [
      conversation.user_id,              // $1 - user_id
      conversation.property_id,          // $2 - property_id
      reservationKey,                    // $3 - reservation_key
      null,  // $4 - cleaner_id (null car pas encore assigné)
      conversation.reservation_end_date || conversation.reservation_start_date,  // $5 - checkout_date
      JSON.stringify([]),                // $6 - tasks (tableau vide)
      JSON.stringify([]),                // $7 - photos (tableau vide)
      false,                             // $8 - sent_to_owner
      false,                             // $9 - sent_to_guest
      JSON.stringify(photos)             // $10 - departure_photos
    ]
  );
  
  console.log('✅ Cleaning checklist créé avec ID:', createResult.rows[0].id);
  
  await pool.query(
    `INSERT INTO chat_notifications (user_id, conversation_id, message, type, is_read)
     VALUES ($1, $2, $3, $4, FALSE)`,
    [
      conversation.user_id, 
      conversation.id,
      `Le voyageur a uploadé ${photos.length} photo(s) de départ`,
      'checkout_photos'
    ]
  );
  
  return res.json({
    success: true,
    message: 'Photos de départ enregistrées avec succès',
    photoCount: photos.length
  });
}
    
    // 3. Mettre à jour le cleaning checklist existant
    const result = await pool.query(
      `UPDATE cleaning_checklists 
       SET departure_photos = $1, 
           departure_photos_uploaded_at = NOW(),
           updated_at = NOW()
       WHERE reservation_key = $2
       RETURNING id`,
      [JSON.stringify(photos), reservationKey]
    );
    
    console.log('✅ Cleaning checklist mis à jour:', result.rows[0].id);
    
    // Notification
await pool.query(
  `INSERT INTO chat_notifications (user_id, conversation_id, message, notification_type, is_read)
   VALUES ($1, $2, $3, $4, FALSE)`,
  [
    conversation.user_id, 
    conversation.id,
    `Le voyageur a uploadé ${photos.length} photo(s) de départ`,
    'checkout_photos'
  ]
);
    
    res.json({
      success: true,
      message: 'Photos de départ enregistrées avec succès',
      photoCount: photos.length
    });
    
  } catch (error) {
    console.error('❌ Erreur upload photos départ:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});
// ============================================
// ROUTE À AJOUTER DANS chat_routes.js
// Suppression de conversation
// ============================================

// DELETE - Supprimer une conversation
app.delete('/api/chat/conversations/:conversationId', authenticateAny, checkSubscription, async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    
    // Vérifier que la conversation appartient à l'utilisateur
    const checkResult = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }
    
    // Supprimer les messages associés
    await pool.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
    
    // Supprimer la conversation
    await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    
    res.json({ 
      success: true,
      message: 'Conversation supprimée avec succès'
    });
    
  } catch (error) {
    console.error('❌ Erreur suppression conversation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FIN DES ROUTES STRIPE
// ============================================
// ============================================
// SCRIPT CRON : ENVOI AUTOMATIQUE DES EMAILS
// À AJOUTER DANS server.js
// ============================================

// ============================================
// CRON JOB : Vérifier et envoyer les emails automatiques
// S'exécute toutes les heures
// ============================================
cron.schedule('0 * * * *', async () => {
  console.log('🔄 Vérification des emails automatiques à envoyer...');
  
  try {
    // Récupérer tous les utilisateurs avec leur abonnement
    const result = await pool.query(`
      SELECT 
        u.id as user_id,
        u.email,
        u.first_name,
        s.status,
        s.plan_type,
        s.trial_end_date,
        s.current_period_end
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      WHERE u.email_verified = TRUE
    `);

    const users = result.rows;
    const now = new Date();

    for (const user of users) {
      try {
        // ============================================
        // EMAIL 1 : BIENVENUE (si jamais envoyé)
        // ============================================
        const welcomeSent = await hasEmailBeenSent(user.user_id, 'welcome');
        if (!welcomeSent && user.status === 'trial') {
          try {
            await sendWelcomeEmail(user.email, user.first_name || 'cher membre');
            await logEmailSent(user.user_id, 'welcome', { email: user.email });
          } catch (emailError) {
            console.error('❌ Erreur envoi email bienvenue:', emailError.message);
            // ✅ On enregistre quand même le log pour éviter les tentatives infinies
            await logEmailSent(user.user_id, 'welcome', { 
              email: user.email, 
              error: emailError.message,
              status: 'failed'
            });
          }
        }

        // ============================================
        // EMAILS DE RAPPEL D'EXPIRATION (seulement si trial)
        // ============================================
        if (user.status === 'trial' && user.trial_end_date) {
          const trialEnd = new Date(user.trial_end_date);
          const diffTime = trialEnd - now;
          const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // RAPPEL J-7
          if (daysRemaining === 7) {
            const reminder7Sent = await hasEmailBeenSent(user.user_id, 'trial_reminder_7');
            if (!reminder7Sent) {
              await sendTrialReminder7Days(user.email, user.first_name || 'cher membre');
              await logEmailSent(user.user_id, 'trial_reminder_7', { daysRemaining: 7 });
            }
          }

          // RAPPEL J-3
          if (daysRemaining === 3) {
            const reminder3Sent = await hasEmailBeenSent(user.user_id, 'trial_reminder_3');
            if (!reminder3Sent) {
              await sendTrialReminder3Days(user.email, user.first_name || 'cher membre');
              await logEmailSent(user.user_id, 'trial_reminder_3', { daysRemaining: 3 });
            }
          }

          // RAPPEL J-1
          if (daysRemaining === 1) {
            const reminder1Sent = await hasEmailBeenSent(user.user_id, 'trial_reminder_1');
            if (!reminder1Sent) {
              await sendTrialReminder1Day(user.email, user.first_name || 'cher membre');
              await logEmailSent(user.user_id, 'trial_reminder_1', { daysRemaining: 1 });
            }
          }
        }

        // ============================================
        // EMAIL DE RAPPEL AVANT RENOUVELLEMENT
        // ============================================
        if (user.status === 'active' && user.current_period_end) {
          const periodEnd = new Date(user.current_period_end);
          const diffTime = periodEnd - now;
          const daysUntilRenewal = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (daysUntilRenewal === 3) {
            // Vérifier si un email de rappel a été envoyé pour cette période
            const renewalKey = `renewal_reminder_${periodEnd.toISOString().split('T')[0]}`;
            const renewalSent = await hasEmailBeenSent(user.user_id, renewalKey);
            
            if (!renewalSent) {
              const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
planAmount = subscription.items.data[0].price.unit_amount;
              await sendRenewalReminderEmail(
                user.email, 
                user.first_name || 'cher membre',
                user.plan_type,
                planAmount,
                user.current_period_end
              );
              await logEmailSent(user.user_id, renewalKey, { 
                renewalDate: user.current_period_end,
                planType: user.plan_type 
              });
            }
          }
        }

      } catch (userErr) {
        console.error(`Erreur traitement user ${user.user_id}:`, userErr);
        // Continuer avec le prochain utilisateur
      }
    }

    console.log('✅ Vérification des emails automatiques terminée');

  } catch (err) {
    console.error('❌ Erreur cron emails automatiques:', err);
  }
});

console.log('⏰ Tâche CRON emails automatiques activée (toutes les heures)');

// ⏰ Rappels de ménage J-1 (tous les jours à 9h)
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ Vérification des rappels de ménage (J-1)...');
  
  try {
    const { sendCleaningReminderNotification } = require('./server/notifications-service');
    
    // Date de demain
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    // Récupérer tous les utilisateurs
    const usersResult = await pool.query('SELECT DISTINCT user_id FROM user_fcm_tokens');
    
    for (const userRow of usersResult.rows) {
      const userId = userRow.user_id;
      
      // Récupérer les réservations de demain pour cet utilisateur
      const reservations = await getReservationsForUser(userId);
      
      // Filtrer les réservations qui finissent demain (= ménage demain)
      const cleaningsTomorrow = reservations.filter(r => {
        const endDate = new Date(r.endDate).toISOString().split('T')[0];
        return endDate === tomorrowStr;
      });
      
      // Pour chaque ménage de demain, vérifier s'il y a une assignation
      for (const reservation of cleaningsTomorrow) {
        try {
          const assignmentResult = await pool.query(
            `SELECT ca.*, c.name as cleaner_name
             FROM cleaning_assignments ca
             JOIN cleaners c ON ca.cleaner_id = c.id
             WHERE ca.user_id = $1 AND ca.reservation_key = $2`,
            [userId, reservation.key]
          );
          
          if (assignmentResult.rows.length > 0) {
            const assignment = assignmentResult.rows[0];
            
            await sendCleaningReminderNotification(
              userId,
              reservation.key,
              reservation.propertyName,
              assignment.cleaner_name,
              reservation.endDate
            );
            
            console.log(`✅ Rappel ménage envoyé pour ${reservation.propertyName}`);
          }
        } catch (error) {
          console.error(`❌ Erreur rappel pour ${reservation.key}:`, error);
        }
      }
    }
    
    console.log('✅ Vérification des rappels terminée');
    
  } catch (error) {
    console.error('❌ Erreur cron rappels ménage:', error);
  }
});

console.log('✅ Cron job rappels de ménage configuré (9h tous les jours)');
// ============================================
// MODIFIER LE WEBHOOK : ENVOYER EMAIL CONFIRMATION
// ============================================
// Dans le case 'checkout.session.completed' de votre webhook,
// ajoutez ceci après la mise à jour de la base de données :

/*
case 'checkout.session.completed': {
  // ... votre code existant ...
  
  await pool.query(...); // Mise à jour de la base

  // ✅ AJOUTER ICI : Envoyer email de confirmation
  const userResult = await pool.query(
    'SELECT email, first_name FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length > 0) {
    const userEmail = userResult.rows[0].email;
    const userFirstName = userResult.rows[0].first_name;
    const planAmount = plan === 'pro' ? 899 : 599;

    await sendSubscriptionConfirmedEmail(
      userEmail,
      userFirstName || 'cher membre',
      plan,
      planAmount
    );
    await logEmailSent(userId, 'subscription_confirmed', { plan, planAmount });
  }

  console.log(`✅ Abonnement ACTIF créé pour user ${userId} (plan: ${plan})`);
  break;
}
*/

// ============================================
// FIN DU SCRIPT CRON
// ============================================

app.post('/api/manual-reservations/delete', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('❌ Suppression refusée : utilisateur non authentifié');
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, uid } = req.body || {};
    console.log('🗑 Demande de suppression reçue :', { userId: user.id, propertyId, uid });

    if (!propertyId || !uid) {
      return res.status(400).json({ error: 'propertyId et uid sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    // ✅ SUPPRIMER DE LA DB EN PREMIER (source de vérité)
    let deleted = false;
    try {
      const deleteResult = await pool.query(
        'DELETE FROM reservations WHERE uid = $1 AND user_id = $2 RETURNING *',
        [uid, user.id]
      );
      
      deleted = deleteResult.rowCount > 0;
      
      if (deleted) {
        console.log(`✅ Réservation ${uid} supprimée de PostgreSQL`);
        
        // 📩 ENVOYER NOTIFICATION D'ANNULATION
        if (await shouldSendNotification(user.id, 'notif_reservation_cancelled')) {
        try {
          const deletedReservation = deleteResult.rows[0];
          
          const tokensResult = await pool.query(
            'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
            [user.id]
          );
          
          if (tokensResult.rows.length > 0) {
            const cancelDate = new Date(deletedReservation.start_date).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'short'
            });
            
            for (const tokenRow of tokensResult.rows) {
              await sendNotification(
                tokenRow.fcm_token,
                '❌ Réservation annulée',
                `${property.name} - ${cancelDate}`,
                {
                  type: 'reservation_cancelled',
                  reservation_id: uid,
                  property_name: property.name
                }
              );
              
              console.log(`📩 Notification annulation envoyée au ${tokenRow.device_type}`);
            }
          }
        } catch (notifError) {
          console.error('❌ Erreur notification annulation:', notifError.message);
        }
        } // end shouldSendNotification
      } else {
        console.log(`⚠️ Réservation ${uid} non trouvée dans PostgreSQL`);
      }
    } catch (dbError) {
      console.error('❌ Erreur suppression DB:', dbError.message);
      return res.status(500).json({ error: 'Erreur lors de la suppression' });
    }

    // ✅ NETTOYER MANUAL_RESERVATIONS (si existe)
    if (MANUAL_RESERVATIONS[propertyId]) {
      const beforeLength = MANUAL_RESERVATIONS[propertyId].length;
      MANUAL_RESERVATIONS[propertyId] = MANUAL_RESERVATIONS[propertyId].filter(r => r.uid !== uid);
      const afterLength = MANUAL_RESERVATIONS[propertyId].length;
      
      if (beforeLength > afterLength) {
        console.log(`✅ Supprimé de MANUAL_RESERVATIONS (${beforeLength} → ${afterLength})`);
      }
    }

    // ✅ NETTOYER reservationsStore (si existe)
    if (reservationsStore.properties && reservationsStore.properties[propertyId]) {
      const beforeLength = reservationsStore.properties[propertyId].length;
      reservationsStore.properties[propertyId] = 
        reservationsStore.properties[propertyId].filter(r => r.uid !== uid);
      const afterLength = reservationsStore.properties[propertyId].length;
      
      if (beforeLength > afterLength) {
        console.log(`✅ Supprimé de reservationsStore (${beforeLength} → ${afterLength})`);
      }
    }

    // ✅ Répondre avec succès (même si pas dans les caches)
    if (deleted) {
      // Forcer la resynchronisation
      setImmediate(() => syncAllCalendars());
      
      return res.status(200).json({
        success: true,
        message: 'Réservation supprimée'
      });
    } else {
      return res.status(404).json({
        error: 'Réservation non trouvée'
      });
    }

  } catch (err) {
    console.error('❌ Erreur suppression réservation:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// DEBUG: vérifier que les GET fonctionnent et lister les routes chargées
app.get('/api/health', (req, res) => res.status(200).send('ok'));

app.get('/api/_routes', (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
        routes.push(`${methods} ${layer.route.path}`);
      }
    });
    res.json({ count: routes.length, routes });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
// ============================================
// ✅ ROUTE PUBLIQUE LIVRET D'ACCUEIL (VERSION PREMIUM)
// ============================================
app.get('/welcome/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    
    // 1. Récupération des données
    const result = await pool.query(
      `SELECT data FROM welcome_books_v2 WHERE unique_id = $1`, 
      [uniqueId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send("<h1>Livret introuvable</h1>");
    }
    
    const d = result.rows[0].data || {};

    // 2. Préparation des variables (Correction du Titre ici)
    // On s'assure que si une info manque, on met un texte vide
    const title = d.propertyName || "Mon Livret d'Accueil";
    const coverPhoto = (d.photos && d.photos.cover) ? d.photos.cover : 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=2070&auto=format&fit=crop';
    
    // 3. Génération du HTML "Design Moderne"
    const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root {
          --primary: #2563eb;
          --text: #1e293b;
          --bg: #f8fafc;
          --card: #ffffff;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          background: var(--bg);
          color: var(--text);
          line-height: 1.6;
          padding-bottom: 4rem;
        }

        /* HERO HEADER */
        .hero {
          position: relative;
          height: 60vh;
          min-height: 400px;
          background-image: url('${coverPhoto}');
          background-size: cover;
          background-position: center;
        }
        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.7));
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 2rem;
        }
        .hero-content {
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
          color: white;
        }
        .hero h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin-bottom: 0.5rem;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .hero p {
          font-size: 1.1rem;
          opacity: 0.9;
        }

        /* CONTAINER */
        .container {
          max-width: 800px;
          margin: -3rem auto 0;
          padding: 0 1rem;
          position: relative;
          z-index: 10;
        }

        /* CARDS */
        .card {
          background: var(--card);
          border-radius: 16px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
          border: 1px solid rgba(0,0,0,0.05);
        }
        
        .section-title {
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: var(--primary);
        }

        /* GRID INFO CLÉS */
        .key-info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }
        .info-item {
          background: #eff6ff;
          padding: 1rem;
          border-radius: 12px;
        }
        .info-label { font-size: 0.85rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .info-value { font-size: 1.1rem; font-weight: 700; color: #1e293b; margin-top: 0.25rem; }
        
        /* WIFI CARD */
        .wifi-card {
          background: #1e293b;
          color: white;
          text-align: center;
          padding: 2rem;
        }
        .wifi-icon { font-size: 2rem; margin-bottom: 1rem; color: #60a5fa; }
        .wifi-ssid { font-size: 1.2rem; margin-bottom: 0.5rem; }
        .wifi-pass { font-family: monospace; font-size: 1.4rem; background: rgba(255,255,255,0.1); padding: 0.5rem 1rem; border-radius: 8px; display: inline-block; }

        /* LISTES (Restaurants, Pièces) */
        .list-item {
          border-bottom: 1px solid #f1f5f9;
          padding: 1rem 0;
        }
        .list-item:last-child { border-bottom: none; }
        .item-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
        .item-title { font-weight: 700; font-size: 1.1rem; }
        .item-meta { font-size: 0.9rem; color: #64748b; }
        .item-desc { color: #475569; font-size: 0.95rem; }

        /* GALERIE */
        .gallery {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 0.5rem;
          margin-top: 1rem;
        }
        .gallery img {
          width: 100%;
          height: 120px;
          object-fit: cover;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .gallery img:hover { transform: scale(1.02); }

        /* FOOTER */
        .footer {
          text-align: center;
          color: #94a3b8;
          font-size: 0.9rem;
          margin-top: 3rem;
        }
        
        /* BOUTTON CONTACT */
        .fab {
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          background: #25d366; /* Couleur WhatsApp/Tel */
          color: white;
          width: 60px;
          height: 60px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
          text-decoration: none;
          z-index: 100;
          transition: transform 0.2s;
        }
        .fab:hover { transform: scale(1.1); }
      </style>
    </head>
    <body>

      <div class="hero">
        <div class="hero-overlay">
          <div class="hero-content">
            <h1>${title}</h1>
            <p><i class="fas fa-map-marker-alt"></i> ${d.address || ''} ${d.postalCode || ''} ${d.city || ''}</p>
          </div>
        </div>
      </div>

      <div class="container">
      
        <div class="card">
          <div class="section-title"><i class="fas fa-hand-sparkles"></i> Bienvenue</div>
          <p>${(d.welcomeDescription || 'Bienvenue chez nous ! Passez un excellent séjour.').replace(/\n/g, '<br>')}</p>
        </div>

        <div class="key-info-grid">
          <div class="info-item">
            <div class="info-label">Arrivée</div>
            <div class="info-value">${d.accessInstructions ? 'Voir instructions' : 'Dès 15h'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Départ</div>
            <div class="info-value">Avant ${d.checkoutTime || '11h00'}</div>
          </div>
          ${d.keyboxCode ? `
          <div class="info-item">
            <div class="info-label">Boîte à clés</div>
            <div class="info-value">${d.keyboxCode}</div>
          </div>` : ''}
        </div>

        <br>

        ${d.wifiSSID ? `
        <div class="card wifi-card">
          <div class="wifi-icon"><i class="fas fa-wifi"></i></div>
          <div class="wifi-ssid">${d.wifiSSID}</div>
          <div class="wifi-pass">${d.wifiPassword || 'Pas de mot de passe'}</div>
        </div>` : ''}

        ${d.accessInstructions ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-key"></i> Accès au logement</div>
          <p>${d.accessInstructions.replace(/\n/g, '<br>')}</p>
          ${d.photos && d.photos.entrance ? `
            <div class="gallery">
              ${d.photos.entrance.map(url => `<img src="${url}" onclick="window.open(this.src)">`).join('')}
            </div>
          ` : ''}
        </div>` : ''}

        ${d.rooms && d.rooms.length > 0 ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-bed"></i> Le Logement</div>
          ${d.rooms.map((room, i) => `
            <div class="list-item">
              <div class="item-header">
                <div class="item-title">${room.name}</div>
              </div>
              <p class="item-desc">${room.description}</p>
              ${d.photos && d.photos.roomPhotos ? `
                 ` : ''}
            </div>
          `).join('')}
          
          ${d.photos && d.photos.roomPhotos && d.photos.roomPhotos.length > 0 ? `
            <div class="gallery" style="margin-top:1rem; border-top:1px dashed #e2e8f0; padding-top:1rem;">
               ${d.photos.roomPhotos.map(url => `<img src="${url}" onclick="window.open(this.src)">`).join('')}
            </div>
          ` : ''}
        </div>` : ''}

        <div class="card">
           <div class="section-title"><i class="fas fa-clipboard-check"></i> Règles & Départ</div>
           ${d.importantRules ? `<p><strong>À savoir :</strong><br>${d.importantRules.replace(/\n/g, '<br>')}</p><br>` : ''}
           ${d.checkoutInstructions ? `<p><strong>Au départ :</strong><br>${d.checkoutInstructions.replace(/\n/g, '<br>')}</p>` : ''}
        </div>

        ${(d.restaurants?.length > 0 || d.places?.length > 0) ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-map-signs"></i> Guide Local</div>
          
          ${d.restaurants && d.restaurants.length > 0 ? `
            <h4 style="margin:1rem 0 0.5rem 0; color:#64748b;">🍽️ Restaurants</h4>
            ${d.restaurants.map(resto => `
              <div class="list-item">
                <div class="item-header">
                  <div class="item-title">${resto.name}</div>
                  <div class="item-meta">${resto.phone || ''}</div>
                </div>
                <p class="item-desc">${resto.description}</p>
                ${resto.address ? `<small style="color:#94a3b8"><i class="fas fa-location-arrow"></i> ${resto.address}</small>` : ''}
              </div>
            `).join('')}
          ` : ''}

          ${d.places && d.places.length > 0 ? `
            <h4 style="margin:1.5rem 0 0.5rem 0; color:#64748b;">🏞️ À visiter</h4>
            ${d.places.map(place => `
              <div class="list-item">
                <div class="item-title">${place.name}</div>
                <p class="item-desc">${place.description}</p>
              </div>
            `).join('')}
          ` : ''}
        </div>` : ''}

        <div class="footer">
          <p>Livret propulsé par BoostingHost</p>
        </div>

      </div>

      ${d.contactPhone ? `
      <a href="tel:${d.contactPhone}" class="fab" title="Contacter l'hôte">
        <i class="fas fa-phone"></i>
      </a>` : ''}

    </body>
    </html>
    `;
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
return res.send(html);

  } catch (error) {
  console.error('Erreur affichage livret:', error);
  if (res.headersSent) return;
  return res.status(500).send("Erreur lors de l'affichage du livret");
}
});

// ============================================
// ✅ CRÉATION DU SERVEUR HTTP + SOCKET.IO
// ============================================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  }
});

// ============================================
// 🔌 SOCKET.IO — Gestion des connexions
// ============================================
io.on('connection', (socket) => {
  console.log('🔌 Socket connecté:', socket.id);

  // Permettre aux clients de rejoindre leur room utilisateur
  socket.on('join', (room) => {
    if (room && typeof room === 'string' && room.startsWith('user_')) {
      socket.join(room);
      console.log(`🔌 Socket ${socket.id} a rejoint la room ${room}`);
    }
  });

  // Room support (utilisateur)
  socket.on('join_support', (conversationId) => {
    if (conversationId && typeof conversationId === 'string') {
      socket.join(`support_${conversationId}`);
      console.log(`💬 Socket ${socket.id} a rejoint support_${conversationId}`);
    }
  });

  // Room support admin (pour recevoir tous les messages)
  socket.on('join_support_admin', () => {
    socket.join('support_admin');
    console.log(`💬 Socket ${socket.id} a rejoint support_admin`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket déconnecté:', socket.id);
  });
});

// ============================================
// ✅ INITIALISATION DES ROUTES DU CHAT
// ============================================
setupChatRoutes(app, pool, io, authenticateAny, checkSubscription);
console.log('✅ Routes du chat initialisées');

// ============================================
// 📨 INITIALISATION DU CRON JOB DES MESSAGES D'ARRIVÉE
// ============================================
initArrivalMessagesCron(pool, io);
console.log('✅ Cron job messages d\'arrivée initialisé');

// ============================================
// 💰 INITIALISATION DU CRON JOB DES RAPPELS CAUTION
// ============================================
initDepositRemindersCron(pool, io);
console.log('✅ Cron job rappels caution initialisé');

// ============================================
// ✅ INITIALISATION DES ROUTES SOUS-COMPTES
// ============================================
setupSubAccountsRoutes(app, pool, authenticateAny);
console.log('✅ Routes sous-comptes initialisées');

// ============================================
// 💬 INITIALISATION DU SUPPORT CHAT
// ============================================
initSupportTables(pool);
setupSupportRoutes(app, pool, io, authenticateToken);
console.log('✅ Routes support chat initialisées');
// ============================================
// 🔐 ROUTE DE VÉRIFICATION D'AUTHENTIFICATION
// ============================================
app.get('/api/auth/verify', authenticateAny, async (req, res) => {
  try {
    console.log('🔍 Vérification auth - Type:', req.isSubAccount ? 'sub-account' : 'main');
    
    if (req.isSubAccount) {
      res.json({
        valid: true,
        accountType: 'sub',
        subAccount: {
          id: req.subAccount.id,
          name: req.subAccount.name,
          email: req.subAccount.email,
          parent_user_id: req.parentUserId,
          is_active: req.subAccount.is_active
        },
        permissions: {
          can_view_reservations: req.subAccount.can_view_reservations || false,
          can_edit_reservations: req.subAccount.can_edit_reservations || false,
          can_view_properties: req.subAccount.can_view_properties || false,
          can_edit_properties: req.subAccount.can_edit_properties || false,
          can_view_messages: req.subAccount.can_view_messages || false,
          can_send_messages: req.subAccount.can_send_messages || false,
          can_manage_team: req.subAccount.can_manage_team || false,
          can_view_cleaning: req.subAccount.can_view_cleaning || false,
          can_manage_cleaning: req.subAccount.can_manage_cleaning || false
        },
        accessibleProperties: req.subAccount.accessible_properties || []
      });
    } else {
      res.json({
        valid: true,
        accountType: 'main',
        user: {
          id: req.userId,
          email: req.user.email,
          name: req.user.name || req.user.email,
          created_at: req.user.created_at
        },
        permissions: 'all'
      });
    }
  } catch (error) {
    console.error('❌ Erreur vérification auth:', error);
    res.status(401).json({ 
      valid: false,
      error: 'Session invalide' 
    });
  }
});
// ============================================
// 🤖 ENDPOINT ENVOI MESSAGE AVEC TRAITEMENT AUTO
// ============================================

app.post('/api/chat/send', async (req, res) => {
  try {
    const { conversation_id, message, sender_type, sender_name } = req.body;

    if (!conversation_id || !message) {
      return res.status(400).json({ error: 'conversation_id et message requis' });
    }

    // Insérer le message dans la DB
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, sender_name, message, is_read, created_at`,
      [conversation_id, sender_type || 'guest', sender_name || 'Voyageur', message]
    );

    const savedMessage = messageResult.rows[0];

    // Émettre via Socket.io
    if (io) {
      io.to(`conversation_${conversation_id}`).emit('new_message', savedMessage);
    }

    // 🤖 TRAITER AUTOMATIQUEMENT (Onboarding + Réponses auto)
    if (sender_type === 'guest') {
      // Récupérer la conversation complète
      const convResult = await pool.query(
        'SELECT * FROM conversations WHERE id = $1',
        [conversation_id]
      );

      if (convResult.rows.length > 0) {
        const conversation = convResult.rows[0];
        
        // Traiter le message (onboarding + réponses auto)
        const msgNotifAllowed = await shouldSendNotification(conversation.user_id, 'notif_new_message');
        await handleIncomingMessage(savedMessage, conversation, pool, io, { allowPushNotification: msgNotifAllowed });
      }
    }

    res.json({ success: true, message: savedMessage });

  } catch (error) {
    console.error('❌ Erreur /api/chat/send:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTE VERIFICATION CHAT (AJOUTEE DIRECTEMENT)
// ============================================

app.post('/api/chat/verify-by-property', async (req, res) => {
  try {
    const { property_id, chat_pin, checkin_date, checkout_date, platform } = req.body;

    if (!property_id || !chat_pin || !checkin_date || !platform) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const propertyResult = await pool.query(
      'SELECT id, user_id, name, chat_pin FROM properties WHERE id = $1',
      [property_id]
    );

    if (propertyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Logement non trouve' });
    }

    const property = propertyResult.rows[0];

    if (property.chat_pin !== chat_pin) {
      return res.status(401).json({ error: 'Code PIN incorrect' });
    }

    const checkinDateStr = new Date(checkin_date).toISOString().split('T')[0];
    const checkoutDateStr = checkout_date ? new Date(checkout_date).toISOString().split('T')[0] : null;

    // ✅ Pour les réservations "direct" ou "manuel", on skip la vérification dans la table reservations
    const isDirectReservation = ['direct', 'manuel', 'manual'].includes(platform.toLowerCase());
    
    if (!isDirectReservation) {
      // Vérifier uniquement pour Airbnb, Booking, etc.
      const reservationResult = await pool.query(
        `SELECT id FROM reservations 
         WHERE property_id = $1 
         AND DATE(start_date) = $2 
         AND ($3::date IS NULL OR DATE(end_date) = $3)
         AND LOWER(source) = LOWER($4)
         LIMIT 1`,
        [property_id, checkinDateStr, checkoutDateStr, platform]
      );

      if (reservationResult.rows.length === 0) {
        return res.status(404).json({ error: 'Aucune reservation trouvee pour cette plateforme' });
      }
    } else {
      console.log(`✅ Réservation directe/manuelle - pas de vérification dans table reservations`);
    }

    let conversation;
    const existingConv = await pool.query(
      `SELECT * FROM conversations 
       WHERE property_id = $1 
       AND reservation_start_date = $2 
       AND platform = $3`,
      [property_id, checkinDateStr, platform]
    );

    if (existingConv.rows.length > 0) {
      conversation = existingConv.rows[0];
      
      if (!conversation.is_verified) {
        await pool.query(
          `UPDATE conversations SET is_verified = TRUE, verified_at = NOW(), status = 'active' WHERE id = $1`,
          [conversation.id]
        );
      }
    } else {
      const uniqueToken = crypto.randomBytes(32).toString('hex');

      const newConvResult = await pool.query(
        `INSERT INTO conversations 
        (user_id, property_id, reservation_start_date, reservation_end_date, platform, pin_code, unique_token, is_verified, verified_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), 'active')
        RETURNING *`,
        [property.user_id, property_id, checkinDateStr, checkoutDateStr, platform, chat_pin, uniqueToken]
      );

      conversation = newConvResult.rows[0];
    }

    res.json({
      success: true,
      conversation_id: conversation.id,
      property_id: property_id,
      property_name: property.name
    });

  } catch (error) {
    console.error('Erreur verification:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTE DE TEST : Messages d'arrivée manuels
// ============================================
// 🧪 ROUTE DE TEST : Envoyer les messages d'arrivée maintenant
app.post('/api/test/arrival-messages', authenticateAny, async (req, res) => {
  try {
    console.log('🧪 TEST MANUEL : Déclenchement des messages d\'arrivée');
    
    const { processTodayArrivals } = require('./arrival-messages-scheduler');
    const result = await processTodayArrivals(pool, io);
    
    console.log('📊 Résultat du test:', result);
    
    res.json({ 
      success: true, 
      message: 'Messages d\'arrivée traités',
      total: result.total,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors
    });
    
  } catch (error) {
    console.error('❌ Erreur test arrival messages:', error);
    res.status(500).json({ 
      error: 'Erreur lors du test',
      message: error.message 
    });
  }
});

console.log('✅ Route de test /api/test/arrival-messages ajoutée');

// 🧪 ROUTE DE TEST : Rappels caution J-2
app.post('/api/test/deposit-reminders', authenticateAny, async (req, res) => {
  try {
    console.log('🧪 TEST MANUEL : Déclenchement des rappels caution J-2');
    
    const { sendDepositReminderJ2 } = require('./deposit-messages-scheduler');
    const result = await sendDepositReminderJ2(pool, io);
    
    console.log('📊 Résultat du test:', result);
    
    res.json({ 
      success: true, 
      message: 'Rappels caution traités',
      total: result.total,
      sent: result.sent,
      errors: result.errors
    });
    
  } catch (error) {
    console.error('❌ Erreur test deposit reminders:', error);
    res.status(500).json({ 
      error: 'Erreur lors du test',
      message: error.message 
    });
  }
});

console.log('✅ Route de test /api/test/deposit-reminders ajoutée');

console.log('Route verify-by-property ajoutee');
// Route pour recuperer les messages d'une conversation
app.get('/api/chat/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC`,
      [conversationId]
    );
    
    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Erreur recuperation messages:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTE : MARQUER LES MESSAGES COMME LUS
// ============================================
app.post('/api/chat/conversations/:conversationId/mark-read', authenticateAny, async (req, res) => {
  const { conversationId } = req.params;
  
  try {
    console.log(`📖 Marquage messages lus - Conversation: ${conversationId}`);
    
    // Marquer tous les messages NON envoyés par le propriétaire comme lus
    const result = await pool.query(
      `UPDATE messages 
       SET is_read = true
       WHERE conversation_id = $1 
       AND sender_type != 'owner'
       AND is_read = false
       RETURNING id`,
      [conversationId]
    );
    
    const markedCount = result.rowCount;
    console.log(`✅ ${markedCount} message(s) marqué(s) comme lu(s)`);
    
    res.json({ 
      success: true,
      markedCount: markedCount
    });
    
  } catch (error) {
    console.error('❌ Erreur marquage messages lus:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      details: error.message 
    });
  }
});
// Route de test notification
app.get('/api/test-notification', async (req, res) => {
  try {
    const result = await notificationService.sendNotificationByUserId(
      'u_mjcpmi2k',
      '🎉 Test de notification',
      'Si vous voyez ce message, ça marche !',
      { type: 'test' }
    );
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ============================================
// 🔔 ROUTES NOTIFICATIONS PUSH
// ============================================
// Endpoint pour sauvegarder le token FCM d'un utilisateur
app.post('/api/save-token', authenticateAny, async (req, res) => {
  try {
    const { token, device_type } = req.body;
    const userId = req.user.userId || req.user.id;
    
    if (!token) {
      return res.status(400).json({ error: 'Token manquant' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID manquant' });
    }
    
    // Déterminer le device_type
    const deviceType = device_type || 'android';
    
    console.log(`📱 Enregistrement token pour ${userId} (${deviceType})`);
    console.log(`   Token: ${token.substring(0, 30)}...`);
    
    await pool.query(
  `INSERT INTO user_fcm_tokens (user_id, fcm_token, device_type, created_at, updated_at)
   VALUES ($1, $2, $3, NOW(), NOW())
   ON CONFLICT (user_id, device_type)
   DO UPDATE SET fcm_token = EXCLUDED.fcm_token,
                 updated_at = NOW()`,
  [userId, token, deviceType]
);
    
    console.log(`✅ Token FCM enregistré pour ${userId} (${deviceType})`);
    res.json({ success: true, message: 'Token sauvegardé' });
  } catch (error) {
    console.error('❌ Erreur sauvegarde token:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Endpoint pour envoyer une notification test
app.post('/api/notifications/send', authenticateAny, async (req, res) => {
  try {
    const { token, title, body } = req.body;
    
    if (!token || !title || !body) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }
    
    const result = await sendNotification(token, title, body);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Erreur envoi notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour notifier les arrivées du jour
app.post('/api/notifications/today-arrivals', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Récupérer le token FCM de l'utilisateur
    const tokenResult = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (tokenResult.rows.length === 0) {
      return res.json({ message: 'Aucun token FCM enregistré' });
    }
    
    const fcmTokens = tokenResult.rows.map(r => r.fcm_token);
    
    // Récupérer les arrivées du jour
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const arrivalsResult = await pool.query(
      `SELECT 
        r.id, r.uid, r.property_id, r.start_date, r.end_date,
        r.source, r.platform, r.status, r.number_of_guests,
        r.guest_email, r.created_at, r.updated_at,
        
        COALESCE(
          NULLIF(TRIM(c.guest_first_name || ' ' || c.guest_last_name), ''),
          r.guest_name,
          'Voyageur ' || COALESCE(r.source, 'direct')
        ) as guest_name,
        
        COALESCE(c.guest_phone, r.guest_phone) as guest_phone,
        
        CASE 
          WHEN c.guest_first_name IS NOT NULL 
          THEN LEFT(UPPER(c.guest_first_name), 1)
          ELSE 'V'
        END as guest_initial,
        
        p.id as property_id,
        p.name as property_name,
        p.address as property_address,
        p.color as property_color
        
       FROM reservations r
       JOIN properties p ON r.property_id = p.id
       LEFT JOIN conversations c ON (
         c.property_id = r.property_id 
         AND DATE(c.reservation_start_date) = DATE(r.start_date)
         AND LOWER(c.platform) = LOWER(r.source)
       )
       WHERE r.start_date >= $1 AND r.start_date < $2
       ORDER BY r.start_date`,
      [today, tomorrow]
    );
    
    const arrivals = arrivalsResult.rows;
    
    if (arrivals.length === 0) {
      return res.json({ message: 'Aucune arrivée aujourd\'hui' });
    }
    
    const title = `🏠 ${arrivals.length} arrivée(s) aujourd'hui`;
    const body = arrivals.map(a => 
      `${a.property_name} - ${a.guest_name || 'Voyageur'}`
    ).join('\n');
    
    const result = await sendNotificationToMultiple(fcmTokens, title, body, {
      type: 'arrivals',
      count: arrivals.length.toString()
    });
    
    res.json(result);
  } catch (error) {
    console.error('❌ Erreur notification arrivées:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint pour notifier les départs du jour
app.post('/api/notifications/today-departures', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Récupérer le token FCM
    const tokenResult = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (tokenResult.rows.length === 0) {
      return res.json({ message: 'Aucun token FCM enregistré' });
    }
    
    const fcmTokens = tokenResult.rows.map(r => r.fcm_token);
    
    // Récupérer les départs du jour
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const departuresResult = await pool.query(
      `SELECT 
        r.id, r.uid, r.property_id, r.start_date, r.end_date,
        r.source, r.platform, r.status, r.number_of_guests,
        r.guest_email, r.created_at, r.updated_at,
        
        COALESCE(
          NULLIF(TRIM(c.guest_first_name || ' ' || c.guest_last_name), ''),
          r.guest_name,
          'Voyageur ' || COALESCE(r.source, 'direct')
        ) as guest_name,
        
        COALESCE(c.guest_phone, r.guest_phone) as guest_phone,
        
        CASE 
          WHEN c.guest_first_name IS NOT NULL 
          THEN LEFT(UPPER(c.guest_first_name), 1)
          ELSE 'V'
        END as guest_initial,
        
        p.id as property_id,
        p.name as property_name,
        p.address as property_address,
        p.color as property_color
        
       FROM reservations r
       JOIN properties p ON r.property_id = p.id
       LEFT JOIN conversations c ON (
         c.property_id = r.property_id 
         AND DATE(c.reservation_start_date) = DATE(r.start_date)
         AND LOWER(c.platform) = LOWER(r.source)
       )
       WHERE r.end_date >= $1 AND r.end_date < $2
       ORDER BY r.end_date`,
      [today, tomorrow]
    );
    
   const departures = departuresResult.rows;

if (departures.length === 0) {
  return res.json({ message: 'Aucun départ aujourd\'hui' });
}

// ✅ DÉDUPLIQUER les logements
const uniqueProperties = [...new Set(departures.map(d => d.property_name))];
const uniqueCount = uniqueProperties.length;

const title = `🚪 ${uniqueCount} départ(s) aujourd'hui`;
const body = `Ménages à prévoir : ${uniqueProperties.join(', ')}`;
    const result = await sendNotificationToMultiple(fcmTokens, title, body, {
      type: 'departures',
      count: departures.length.toString()
    });
    
    res.json(result);
  } catch (error) {
    console.error('❌ Erreur notification départs:', error);
    res.status(500).json({ error: error.message });
  }
});

console.log('✅ Routes notifications push ajoutées');
console.log('Route messages ajoutee');

// ============================================
// DÉMARRAGE (TOUJOURS EN DERNIER)
// ============================================


// ============================================
// CRON JOB : MESSAGES D'ARRIVEE AUTOMATIQUES
// ============================================

cron.schedule('0 7 * * *', async () => {
  console.log('CRON: Envoi des messages d arrivee a 7h00');
  try {
    await processArrivalsForToday(pool, io, transporter);
  } catch (error) {
    console.error('Erreur CRON messages arrivee:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('CRON job messages arrivee configure (tous les jours a 7h)');
// ============================================
// CRON JOB : NOTIFICATIONS PUSH QUOTIDIENNES
// ============================================
cron.schedule('0 8 * * *', async () => {
  console.log('========================================');
  console.log('🔔 CRON 8H: Envoi des notifications quotidiennes');
  console.log(`🕐 Heure serveur: ${new Date().toISOString()}`);
  console.log(`🕐 Heure Paris: ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
  console.log('========================================');
  try {
    // Recuperer tous les utilisateurs avec token FCM
    const usersResult = await pool.query(
      `SELECT DISTINCT u.id 
       FROM users u 
       JOIN user_fcm_tokens t ON u.id = t.user_id 
       WHERE t.fcm_token IS NOT NULL`
    );
    
    console.log(`🔔 ${usersResult.rows.length} utilisateur(s) avec token FCM`);
    
    for (const user of usersResult.rows) {
      // Recuperer TOUS les tokens de l'utilisateur
      const tokensResult = await pool.query(
        'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
        [user.id]
      );
      
      if (tokensResult.rows.length === 0) continue;
      
      // ✅ Utiliser la date Paris pour éviter les décalages timezone
      const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const todayStr = nowParis.toISOString().split('T')[0]; // ex: "2026-02-08"
      
      // Arrivees du jour
      const arrivalsResult = await pool.query(
        `SELECT DISTINCT ON (r.id) 
          r.id, r.uid, r.property_id, r.start_date, r.end_date,
          r.source, r.platform, r.status,
          
          COALESCE(
            NULLIF(TRIM(COALESCE(c.guest_first_name, '') || ' ' || COALESCE(c.guest_last_name, '')), ''),
            r.guest_name,
            'Voyageur ' || COALESCE(r.source, 'direct')
          ) as guest_name,
          
          COALESCE(c.guest_phone, r.guest_phone) as guest_phone,
          
          CASE 
            WHEN c.guest_first_name IS NOT NULL AND c.guest_first_name != ''
            THEN LEFT(UPPER(c.guest_first_name), 1)
            ELSE 'V'
          END as guest_initial,
          
          p.name as property_name,
          p.color as property_color
          
         FROM reservations r
         JOIN properties p ON r.property_id = p.id
         LEFT JOIN conversations c ON (
           c.property_id = r.property_id 
           AND DATE(c.reservation_start_date) = DATE(r.start_date)
         )
         WHERE p.user_id = $1 
         AND DATE(r.start_date) = $2
         AND r.status != 'cancelled'
         ORDER BY r.id`,
        [user.id, todayStr]
      );
      
      const arrivalsCount = arrivalsResult.rows.length;
      const arrivalsText = arrivalsCount > 0 
        ? arrivalsResult.rows.map(a => `${a.property_name} - ${a.guest_name || 'Voyageur'}`).join(', ')
        : 'Aucune arrivée prévue';
      
      console.log(`🔔 User ${user.id}: ${arrivalsCount} arrivée(s) - ${arrivalsText}`);
      
      // Envoyer a TOUS les appareils
      if (await shouldSendNotification(user.id, 'notif_daily_summary')) {
      for (const token of tokensResult.rows) {
        try {
          await sendNotification(
            token.fcm_token,
            `📥 ${arrivalsCount} arrivée(s) aujourd'hui`,
            arrivalsText,
            { type: 'daily_arrivals', count: arrivalsCount.toString() }
          );
        } catch (notifErr) {
          console.error(`❌ Erreur envoi notif arrivées (token ${token.fcm_token.substring(0, 20)}...):`, notifErr.message);
        }
      }
      } // end shouldSendNotification arrivées
      
      // Departs du jour
      const departuresResult = await pool.query(
        `SELECT DISTINCT ON (r.id) 
          r.id, r.uid, r.property_id, r.start_date, r.end_date,
          r.source, r.platform, r.status,
          
          COALESCE(
            NULLIF(TRIM(COALESCE(c.guest_first_name, '') || ' ' || COALESCE(c.guest_last_name, '')), ''),
            r.guest_name,
            'Voyageur ' || COALESCE(r.source, 'direct')
          ) as guest_name,
          
          COALESCE(c.guest_phone, r.guest_phone) as guest_phone,
          
          CASE 
            WHEN c.guest_first_name IS NOT NULL AND c.guest_first_name != ''
            THEN LEFT(UPPER(c.guest_first_name), 1)
            ELSE 'V'
          END as guest_initial,
          
          p.name as property_name,
          p.color as property_color
          
         FROM reservations r
         JOIN properties p ON r.property_id = p.id
         LEFT JOIN conversations c ON (
           c.property_id = r.property_id 
           AND DATE(c.reservation_start_date) = DATE(r.start_date)
         )
         WHERE p.user_id = $1 
         AND DATE(r.end_date) = $2
         AND r.status != 'cancelled'
         ORDER BY r.id`,
        [user.id, todayStr]
      );
      
      // ✅ DÉDUPLIQUER les logements pour éviter les doublons
      const uniqueProperties = [...new Set(departuresResult.rows.map(d => d.property_name))];
      const departuresCount = uniqueProperties.length; // Nombre de LOGEMENTS uniques
      const departuresText = departuresCount > 0
        ? `Ménages à prévoir : ${uniqueProperties.join(', ')}`
        : 'Aucun départ prévu';
      
      console.log(`🔔 User ${user.id}: ${departuresCount} départ(s) unique(s) - ${departuresText}`);
      
      // Envoyer a TOUS les appareils
      if (await shouldSendNotification(user.id, 'notif_daily_summary')) {
      for (const token of tokensResult.rows) {
        try {
          await sendNotification(
            token.fcm_token,
            `📤 ${departuresCount} départ(s) aujourd'hui`,
            departuresText,
            { type: 'daily_departures', count: departuresCount.toString() }
          );
        } catch (notifErr) {
          console.error(`❌ Erreur envoi notif départs (token ${token.fcm_token.substring(0, 20)}...):`, notifErr.message);
        }
      }
      } // end shouldSendNotification
      
      console.log(`✅ Notifications quotidiennes envoyées à user ${user.id} (${tokensResult.rows.length} appareil(s))`);
    }
    
    console.log('✅ CRON 8H terminé: Notifications quotidiennes envoyées');
  } catch (error) {
    console.error('❌ ERREUR CRON 8H notifications:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('CRON job notifications configure (tous les jours a 8h)');
// ============================================
// CRON JOB : RAPPELS J-1 A 18H
// ============================================
cron.schedule('0 18 * * *', async () => {
  console.log('CRON: Rappels J-1 a 18h');
  try {
    const usersResult = await pool.query(
      `SELECT DISTINCT u.id 
       FROM users u 
       JOIN user_fcm_tokens t ON u.id = t.user_id 
       WHERE t.fcm_token IS NOT NULL`
    );
    
    for (const user of usersResult.rows) {
      // Recuperer TOUS les tokens
      const tokensResult = await pool.query(
        'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
        [user.id]
      );
      
      if (tokensResult.rows.length === 0) continue;
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      
      // Arrivees de demain
      const arrivalsResult = await pool.query(
        `SELECT 
          r.id, r.uid, r.property_id, r.start_date, r.end_date,
          r.source, r.platform, r.status,
          
          COALESCE(
            NULLIF(TRIM(c.guest_first_name || ' ' || c.guest_last_name), ''),
            r.guest_name,
            'Voyageur ' || COALESCE(r.source, 'direct')
          ) as guest_name,
          
          COALESCE(c.guest_phone, r.guest_phone) as guest_phone,
          
          CASE 
            WHEN c.guest_first_name IS NOT NULL 
            THEN LEFT(UPPER(c.guest_first_name), 1)
            ELSE 'V'
          END as guest_initial,
          
          p.name as property_name,
          p.color as property_color
          
         FROM reservations r
         JOIN properties p ON r.property_id = p.id
         LEFT JOIN conversations c ON (
           c.property_id = r.property_id 
           AND DATE(c.reservation_start_date) = DATE(r.start_date)
           AND LOWER(c.platform) = LOWER(r.source)
         )
         WHERE p.user_id = $1 
         AND r.start_date >= $2 
         AND r.start_date < $3
         AND r.status != 'cancelled'`,
        [user.id, tomorrow, dayAfter]
      );
      
      const count = arrivalsResult.rows.length;
      
      if (count > 0) {
        const propertiesList = arrivalsResult.rows
          .map(a => `${a.property_name} - ${a.guest_name || 'Voyageur'}`)
          .join(', ');
        
        // Envoyer a TOUS les appareils
        if (await shouldSendNotification(user.id, 'notif_reminder_j1')) {
        for (const token of tokensResult.rows) {
          await sendNotification(
            token.fcm_token,
            `Rappel : ${count} arrivee(s) demain`,
            propertiesList,
            { type: 'reminder_j1', count: count.toString() }
          );
        }
        
        console.log(`Rappel J-1 envoye a user ${user.id} : ${count} arrivee(s)`);
        } // end shouldSendNotification
      }
    }
    
    console.log('Rappels J-1 envoyes');
  } catch (error) {
    console.error('Erreur CRON rappels:', error);
  }
}, {
  timezone: "Europe/Paris"
});

console.log('CRON rappels J-1 configure (18h quotidien)');
// ============================================
// CHARGER LES RÉSERVATIONS MANUELLES DEPUIS LA DB
// ============================================
async function loadManualReservationsFromDB() {
  try {
    console.log('📦 Chargement des réservations manuelles depuis la DB...');
    
    const result = await pool.query(`
      SELECT * FROM reservations 
      WHERE source = 'MANUEL' 
      AND status != 'cancelled'
      ORDER BY start_date ASC
    `);
    
    // Reconstruire les objets réservation en mémoire
    for (const row of result.rows) {
      const reservation = {
        uid: row.uid,
        start: row.start_date,
        end: row.end_date,
        source: row.source,
        platform: row.platform,
        type: row.reservation_type,
        guestName: row.guest_name,
        notes: '',
        createdAt: row.created_at,
        propertyId: row.property_id,
        propertyName: '', // Sera rempli par la synchro
        propertyColor: '#3b82f6',
        userId: row.user_id,
        nights: Math.ceil((new Date(row.end_date) - new Date(row.start_date)) / (1000 * 60 * 60 * 24))
      };
      
      // Ajouter à MANUAL_RESERVATIONS
      if (!MANUAL_RESERVATIONS[row.property_id]) {
        MANUAL_RESERVATIONS[row.property_id] = [];
      }
      MANUAL_RESERVATIONS[row.property_id].push(reservation);
    }
    
    console.log(`✅ ${result.rows.length} réservations manuelles chargées depuis la DB`);
    
    // 📊 DEBUG : Afficher combien de réservations par propriété
    console.log('📊 Répartition par propriété:');
    for (const [propId, reservations] of Object.entries(MANUAL_RESERVATIONS)) {
      console.log(`  - ${propId}: ${reservations.length} réservations`);
    }
    
  } catch (error) {
    console.error('❌ Erreur chargement réservations manuelles:', error);
  }
}
server.listen(PORT, async () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🏠 LCC Booking Manager - Système de Réservations    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log('');
  
  await initDb();
  
setPool(pool);
initializeFirebase();
console.log('✅ Service de notifications initialisé');
  
  // ✅ Initialiser les tables livrets d'accueil
  await initWelcomeBookTables(pool);
  console.log('✅ Tables welcome_books initialisées');
  
  // ✅ Initialiser la table payments
  await ensurePaymentsTable();
  console.log('✅ Table payments initialisée');
  
  // ✅ Charger les propriétés
  await loadProperties();
  app.locals.PROPERTIES = PROPERTIES;
  
  // ✅ Charger les réservations depuis PostgreSQL
  await loadReservationsFromDB();
  
  // ✅ Charger les réservations manuelles depuis PostgreSQL (AVANT la synchro iCal)
  await loadManualReservationsFromDB();
  
  // Compatibilité : charger depuis JSON si présent
  await loadManualReservations();
  
  // ✅ Charger les cautions depuis PostgreSQL
  await loadDepositsFromDB();
  
  // ✅ Charger les checklists
  await loadChecklists();
  
  // Migration one-time (à décommenter UNE SEULE FOIS pour migrer)
  // await migrateManualReservationsToPostgres();
  // await migrateDepositsToPostgres();
  
  // Afficher les logements configurés
  console.log('');
  console.log('Logements configurés:');
  PROPERTIES.forEach(p => {
    const status = p.icalUrls && p.icalUrls.length > 0 ? '✅' : '⚠️';
    console.log(`  ${status} ${p.name} (${p.icalUrls.length} source${p.icalUrls.length > 1 ? 's' : ''})`);
  });
  console.log('');
  
  // ✅ Synchronisation initiale (APRÈS le chargement des manuelles)
  console.log('🔄 Synchronisation initiale...');
  await syncAllCalendars();
  
  const syncInterval = parseInt(process.env.SYNC_INTERVAL) || 15;
  cron.schedule(`*/${syncInterval} * * * *`, async () => {
    console.log('');
    console.log('⏰ Synchronisation automatique programmée');
    await syncAllCalendars();
  });
  
  const cleaningPlanHour = parseInt(process.env.CLEANING_PLAN_HOUR || '18', 10); // heure FR (18h par défaut)
  cron.schedule(`0 ${cleaningPlanHour} * * *`, async () => {
    console.log('');
    console.log(`⏰ Envoi du planning ménage quotidien (pour demain) à ${cleaningPlanHour}h`);
    try {
      await sendDailyCleaningPlan();
    } catch (err) {
      console.error("❌ Erreur lors de l'envoi du planning ménage quotidien :", err);
    }
  });
  
  console.log('');
  console.log(`⏰ Synchronisation automatique: toutes les ${syncInterval} minutes`);
  console.log('');
  console.log('📧 Notifications configurées:', process.env.EMAIL_USER ? '✅ OUI' : '⚠️  NON');
  console.log('💳 Stripe configuré :', STRIPE_SECRET_KEY ? '✅ OUI' : '⚠️  NON (pas de création de cautions possible)');
  console.log('');
});

// ============================================
// 🤖 HELPER POUR TRAITER LES MESSAGES ENTRANTS
// ============================================

/**
 * À appeler après chaque insertion de message guest dans la DB
 * Cette fonction gère automatiquement:
 * - L'onboarding (prénom, nom, téléphone, langue)
 * - Les réponses automatiques (mots-clés + Groq AI)
 */
async function processIncomingGuestMessage(savedMessage, conversationId) {
  try {
    // Ne traiter que les messages des clients
    if (savedMessage.sender_type !== 'guest') {
      return;
    }

    // Récupérer la conversation complète avec toutes les infos
    const convResult = await pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [conversationId]
    );

    if (convResult.rows.length === 0) {
      console.log('⚠️ Conversation introuvable:', conversationId);
      return;
    }

    const conversation = convResult.rows[0];

    // Traiter le message (onboarding + réponses auto)
    await handleIncomingMessage(savedMessage, conversation, pool, io);

  } catch (error) {
    console.error('❌ Erreur processIncomingGuestMessage:', error);
  }
}

// Exporter pour utilisation depuis d'autres fichiers
global.processIncomingGuestMessage = processIncomingGuestMessage;
