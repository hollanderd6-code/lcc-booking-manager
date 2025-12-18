require('dotenv').config();
const express = require('express')
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');
const fsp = require('fs').promises;
const icalService = require('./services/icalService');
const notificationService = require('./services/notificationService');
const messagingService = require('./services/messagingService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const multer = require('multer');
const Stripe = require('stripe');
const { Pool } = require('pg');
const crypto = require('crypto');
const axios = require('axios');
const brevo = require('@getbrevo/brevo');
const PDFDocument = require('pdfkit');
// ============================================
// âœ… NOUVEAU : IMPORTS POUR LIVRETS D'ACCUEIL  
// ============================================
const { router: welcomeRouter, initWelcomeBookTables } = require('./routes/welcomeRoutes');
const { generateWelcomeBookHTML } = require('./services/welcomeGenerator');
// ============================================

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

// Nouvelle fonction d'envoi email avec Brevo API
async function sendEmail(mailOptions) {
  try {
    // Si BREVO_API_KEY est configurÃ©, utiliser l'API Brevo
    if (process.env.BREVO_API_KEY) {
      const apiInstance = new brevo.TransactionalEmailsApi();
      apiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
      
      const sendSmtpEmail = new brevo.SendSmtpEmail();
      sendSmtpEmail.subject = mailOptions.subject;
      sendSmtpEmail.htmlContent = mailOptions.html || mailOptions.text;
      
      // GÃ©rer l'expÃ©diteur (CORRIGÃ‰)
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
      
      // GÃ©rer les destinataires
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
      console.log('âœ… Email envoyÃ© via Brevo API Ã :', mailOptions.to);
      return { success: true };
      
    } else {
      console.warn('âš ï¸ BREVO_API_KEY non configurÃ©, tentative SMTP...');
      return await smtpTransporter.sendMail(mailOptions);
    }
  } catch (error) {
    console.error('âŒ Erreur envoi email:', error.response?.body || error.message);
    throw error;
  }
}

// CrÃ©er un objet transporter compatible
const transporter = {
  sendMail: sendEmail,
  verify: () => Promise.resolve(true)
};

// Dossier d'upload pour les photos de logements
// En local : /.../lcc-booking-manager/uploads/properties
// Sur Render : on prÃ©fÃ¨re /tmp qui est writable
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
  console.log('ðŸ“ Dossier uploads initialisÃ© :', UPLOAD_DIR);
} catch (err) {
  console.error('âŒ Impossible de crÃ©er le dossier uploads :', UPLOAD_DIR, err);
  // On essaie un dernier fallback dans /tmp
  if (UPLOAD_DIR !== path.join('/tmp', 'uploads', 'properties')) {
    UPLOAD_DIR = path.join('/tmp', 'uploads', 'properties');
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      console.log('ðŸ“ Dossier uploads fallback :', UPLOAD_DIR);
    } catch (e2) {
      console.error('âŒ Ã‰chec du fallback pour le dossier uploads :', e2);
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
  console.log('ðŸ“ Dossier factures PDF initialisÃ© :', INVOICE_PDF_DIR);
} catch (err) {
  console.error('âŒ Impossible de crÃ©er le dossier factures PDF :', INVOICE_PDF_DIR, err);
}


// Multer en mÃ©moire pour envoyer directement Ã  Cloudinary
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
    
    console.log('âŒ Fichier rejetÃ©:', {
      mimetype: file.mimetype,
      extension: fileExtension,
      filename: file.originalname
    });
    
    return cb(new Error('Type de fichier non supportÃ©. Formats acceptÃ©s: JPG, PNG, WEBP, GIF'), false);
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
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token invalide' });
  }
}
// ============================================
// MIDDLEWARE DE VÃ‰RIFICATION D'ABONNEMENT
// Ã€ AJOUTER DANS server.js APRÃˆS authenticateToken
// ============================================

async function checkSubscription(req, res, next) {
  try {
    const userId = req.user.id;

    // RÃ©cupÃ©rer l'abonnement
    const result = await pool.query(
      `SELECT status, trial_end_date, current_period_end
       FROM subscriptions 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Pas d'abonnement trouvÃ©
      return res.status(403).json({ 
        error: 'Aucun abonnement', 
        subscriptionExpired: true 
      });
    }

    const sub = result.rows[0];
    const now = new Date();

    // VÃ©rifier si l'abonnement est expirÃ©
    if (sub.status === 'trial') {
      const trialEnd = new Date(sub.trial_end_date);
      if (now > trialEnd) {
        return res.status(403).json({ 
          error: 'Essai expirÃ©', 
          subscriptionExpired: true 
        });
      }
    } else if (sub.status === 'active') {
      // L'abonnement actif est valide (gÃ©rÃ© par Stripe)
      // On pourrait vÃ©rifier current_period_end si besoin
    } else if (sub.status === 'expired' || sub.status === 'canceled') {
      return res.status(403).json({ 
        error: 'Abonnement expirÃ©', 
        subscriptionExpired: true 
      });
    }

    // Abonnement valide, continuer
    next();

  } catch (err) {
    console.error('Erreur vÃ©rification abonnement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ============================================
// COMMENT UTILISER CE MIDDLEWARE
// ============================================

/*
Pour protÃ©ger une route, ajoutez le middleware aprÃ¨s authenticateToken :

AVANT :
app.get('/api/properties', authenticateToken, async (req, res) => {
  // ...
});

APRÃˆS :
app.get('/api/properties', authenticateToken, checkSubscription, async (req, res) => {
  // ...
});

Routes Ã  protÃ©ger (exemples) :
- /api/properties
- /api/reservations
- /api/cleaning
- /api/messages
- /api/statistics
- etc.

Routes Ã  NE PAS protÃ©ger :
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

// Init DB : crÃ©ation tables users + welcome_books + cleaners + user_settings + cleaning_assignments
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

    console.log('âœ… Tables users, welcome_books, cleaners, user_settings & cleaning_assignments OK dans Postgres');
  } catch (err) {
    console.error('âŒ Erreur initDb (Postgres):', err);
    process.exit(1);
  }
}

// ============================================
// NOTIFICATIONS PROPRIÃ‰TAIRES â€“ EMAIL
// ============================================

let emailTransporter = null;
// Cache des users pour ne pas spammer la base pendant une sync
const notificationUserCache = new Map();

// Valeurs par dÃ©faut des prÃ©fÃ©rences de notifications
const DEFAULT_NOTIFICATION_SETTINGS = {
  newReservation: true,
  reminder: false,
   whatsappEnabled: false,
  whatsappNumber: ''
};

function getEmailTransporter() {
  if (emailTransporter) return emailTransporter;

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;
  const host = process.env.EMAIL_HOST;
  const service = process.env.EMAIL_SERVICE;

  if (!user || !pass) {
    console.log('âš ï¸  Email non configurÃ© (EMAIL_USER ou EMAIL_PASSWORD manquants)');
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
    // Mode "service" (Gmail, Outlook...) â€“ compatible avec l'ancien systÃ¨me
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
    throw new Error('BREVO_API_KEY manquant pour lâ€™envoi via Brevo');
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
      'âŒ Erreur envoi email via Brevo :',
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

// RÃ©cupÃ¨re les prÃ©fÃ©rences de notifications pour un utilisateur
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
  };
}

// Sauvegarde les prÃ©fÃ©rences de notifications pour un utilisateur
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
// RÃ©cupÃ¨re les assignations de mÃ©nage pour un utilisateur sous forme de map { propertyId -> cleaner }
async function getCleanerAssignmentsMapForUser(userId) {
  if (!userId) return {};

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
    // On ignore les cleaners dÃ©sactivÃ©s
    if (row.cleaner_active === false) continue;
    if (!row.property_id || !row.cleaner_id) continue;

    map[row.property_id] = {
      cleanerId: row.cleaner_id,
      name: row.cleaner_name,
      email: row.cleaner_email,
      phone: row.cleaner_phone
    };
  }

  return map;
}

/**
 * Envoie les emails de notifications de nouvelles rÃ©servations / annulations,
 * en respectant les prÃ©fÃ©rences de l'utilisateur.
 * 
 * VERSION CORRIGÃ‰E AVEC LOGS DÃ‰TAILLÃ‰S POUR DEBUGGING WHATSAPP
 */
async function notifyOwnersAboutBookings(newReservations, cancelledReservations) {
  const brevoKey = process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim();
  if (!brevoKey) {
    console.log(
      "âš ï¸ BREVO_API_KEY manquant : aucune notification propriÃ©taire (nouvelle rÃ©sa / annulation) ne sera envoyÃ©e."
    );
    return;
  }

  const from = process.env.EMAIL_FROM || "Boostinghost <no-reply@boostinghost.com>";
  const tasks = [];

  const handleReservation = (res, type) => {
    const userId = res.userId;
    if (!userId) {
      console.log("âš ï¸  RÃ©servation sans userId, notification ignorÃ©e :", res.uid || res.id);
      return;
    }

    tasks.push(
      (async () => {
        const user = await getUserForNotifications(userId);
        if (!user || !user.email) {
          console.log(`âš ï¸  Aucun email trouvÃ© pour user ${userId}, notification ignorÃ©e`);
          return;
        }

        // ðŸ”” RÃ©cupÃ©rer les prÃ©fÃ©rences de notifications
        let settings;
        try {
          settings = await getNotificationSettings(userId);
          console.log(
            `ðŸ“‹ Settings rÃ©cupÃ©rÃ©s pour user ${userId}:`,
            JSON.stringify(settings, null, 2)
          );
        } catch (e) {
          console.error(
            "Erreur lors de la rÃ©cupÃ©ration des prÃ©fÃ©rences de notifications pour user",
            userId,
            e
          );
          settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
        }

        // Pour l'instant, on utilise la mÃªme option pour nouvelles rÃ©sas & annulations
        if (settings && settings.newReservation === false) {
          console.log(
            `â„¹ï¸ Notifications de rÃ©servations dÃ©sactivÃ©es pour user ${userId}, email non envoyÃ©.`
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
          subject = `ðŸ›Žï¸ Nouvelle rÃ©servation â€“ ${propertyName}`;
          textBody = `${hello}

Une nouvelle rÃ©servation vient d'Ãªtre enregistrÃ©e via ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
SÃ©jour  : du ${start} au ${end}

Vous pouvez retrouver tous les dÃ©tails dans votre tableau de bord Boostinghost.`;

          htmlBody = `
            <p>${hello}</p>
            <p>Une nouvelle rÃ©servation vient d'Ãªtre enregistrÃ©e via <strong>${source}</strong>.</p>
            <ul>
              <li><strong>Logement :</strong> ${propertyName}</li>
              <li><strong>Voyageur :</strong> ${guest}</li>
              <li><strong>SÃ©jour :</strong> du ${start} au ${end}</li>
            </ul>
            <p>Vous pouvez retrouver tous les dÃ©tails dans votre tableau de bord Boostinghost.</p>
          `;
        } else {
          subject = `âš ï¸ RÃ©servation annulÃ©e â€“ ${propertyName}`;
          textBody = `${hello}

Une rÃ©servation vient d'Ãªtre annulÃ©e sur ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
SÃ©jour initial : du ${start} au ${end}

Pensez Ã  vÃ©rifier votre calendrier et vos blocages si nÃ©cessaire.`;

          htmlBody = `
            <p>${hello}</p>
            <p>Une rÃ©servation vient d'Ãªtre <strong>annulÃ©e</strong> sur <strong>${source}</strong>.</p>
            <ul>
              <li><strong>Logement :</strong> ${propertyName}</li>
              <li><strong>Voyageur :</strong> ${guest}</li>
              <li><strong>SÃ©jour initial :</strong> du ${start} au ${end}</li>
            </ul>
            <p>Pensez Ã  vÃ©rifier votre calendrier et vos blocages si nÃ©cessaire.</p>
          `;
        }

        try {
          // ðŸ‘‰ Toujours via l'API Brevo
          console.log("ðŸ“§ [Brevo API] Envoi email", type, "Ã ", user.email);
          await sendEmailViaBrevo({
            to: user.email,
            subject,
            text: textBody,
            html: htmlBody,
          });

          console.log(
            `ðŸ“§ Notification "${type}" envoyÃ©e Ã  ${user.email} (resa uid=${res.uid || res.id})`
          );
        } catch (err) {
          console.error(
            `âŒ Erreur envoi email de notification "${type}" Ã  ${user.email} :`,
            err
          );
        }
      })()
    );
  };

  (newReservations || []).forEach((r) => handleReservation(r, "new"));
  (cancelledReservations || []).forEach((r) => handleReservation(r, "cancelled"));

  if (tasks.length === 0) {
    console.log("â„¹ï¸ Aucune notification propriÃ©taire Ã  envoyer (listes vides).");
    return;
  }

  console.log(
    `ðŸ“§ Notifications Ã  envoyer â€“ nouvelles: ${newReservations.length || 0}, annulÃ©es: ${
      cancelledReservations.length || 0
    }`
  );
  await Promise.all(tasks);
}
/**
 * Notifications mÃ©nage : pour chaque nouvelle rÃ©servation, si un logement a un cleaner assignÃ©,
 * on envoie un email + (optionnel) un WhatsApp Ã  ce cleaner.
 */
async function notifyCleanersAboutNewBookings(newReservations) {
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      'âš ï¸  Ni email (Brevo/SMTP) ni WhatsApp configurÃ©s, aucune notification mÃ©nage envoyÃ©e'
    );
    return;
  }

  if (!newReservations || newReservations.length === 0) {
    return;
  }

  const from = process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';
  const tasks = [];

  // On groupe par user, pour ne pas requÃªter 50 fois la base
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
      console.error('Erreur rÃ©cupÃ©ration assignations mÃ©nage pour user', userId, err);
      continue;
    }

    if (!assignmentsMap || Object.keys(assignmentsMap).length === 0) {
      continue;
    }

    for (const res of userReservations) {
      const assignment = assignmentsMap[res.propertyId];
      if (!assignment) {
        // Aucun cleaner assignÃ© Ã  ce logement â†’ rien Ã  envoyer
        continue;
      }

      const cleanerEmail = assignment.email;
      const cleanerPhone = assignment.phone;
      const cleanerName  = assignment.name || 'partenaire mÃ©nage';

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
        const subject = `ðŸ§¹ Nouveau mÃ©nage Ã  prÃ©voir â€“ ${propertyName}`;
        const textBody = `${hello}

Un nouveau séjour vient dâ€™Ãªtre rÃ©servÃ© pour le logement ${propertyName}.

Voyageur : ${guest}
SÃ©jour  : du ${start} au ${end}
MÃ©nage Ã  prÃ©voir : le ${end} aprÃ¨s le dÃ©part des voyageurs
(heure exacte de check-out Ã  confirmer avec la conciergerie).

Merci beaucoup,
L'Ã©quipe Boostinghost`;

        const htmlBody = `
          <p>${hello}</p>
          <p>Un nouveau séjour vient dâ€™Ãªtre rÃ©servÃ© pour le logement <strong>${propertyName}</strong>.</p>
          <ul>
            <li><strong>Voyageur :</strong> ${guest}</li>
            <li><strong>SÃ©jour :</strong> du ${start} au ${end}</li>
            <li><strong>MÃ©nage Ã  prÃ©voir :</strong> le ${end} aprÃ¨s le dÃ©part des voyageurs</li>
          </ul>
          <p style="font-size:13px;color:#6b7280;">
            Heure exacte de check-out Ã  confirmer avec la conciergerie.
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
                `ðŸ“§ Notification mÃ©nage envoyÃ©e Ã  ${cleanerEmail} (resa uid=${res.uid || res.id})`
              );
            })
            .catch((err) => {
              console.error('âŒ Erreur envoi email notification mÃ©nage :', err);
            })
        );
      }
    }
  }

  await Promise.all(tasks);
}
/**
 * Envoie chaque jour un planning de mÃ©nage pour "demain"
 * Ã  chaque cleaner assignÃ© (email + WhatsApp si dispo).
 */
async function sendDailyCleaningPlan() {
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      'âš ï¸  Ni email (Brevo/SMTP) ni WhatsApp configurÃ©s, planning mÃ©nage non envoyÃ©'
    );
    return;
  }

  if (!PROPERTIES || !Array.isArray(PROPERTIES) || PROPERTIES.length === 0) {
    console.log('â„¹ï¸ Aucun logement configurÃ©, pas de planning mÃ©nage Ã  envoyer.');
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

  // 2) Construire tÃ¢ches par cleaner
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
      if (endIso !== tomorrowIso) continue; // checkout pas demain â†’ ignore

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
const subject = `ðŸ§¹ Planning mÃ©nage â€“ ${tomorrowIso}`;

if ((useBrevo || transporter) && cleanerEmail) {
  // Construction du textBody
  let textBody = `${hello}\n\nPlanning mÃ©nage de demain (${tomorrowIso}):\n\n`;
  jobs.forEach((job, index) => {
    textBody += `${index + 1}. ${job.propertyName} â€“ dÃ©part le ${job.end} (${job.guestName})\n`;
  });
  textBody += '\nMerci beaucoup,\nL\'Ã©quipe Boostinghost';

  // Construction du htmlBody
  let htmlBody = `<p>${hello}</p><p>Planning mÃ©nage de demain (${tomorrowIso}):</p><ul>`;
  jobs.forEach((job) => {
    htmlBody += `<li><strong>${job.propertyName}</strong> â€“ dÃ©part le ${job.end} (${job.guestName})</li>`;
  });
  htmlBody += `</ul><p>Merci beaucoup,<br>L'Ã©quipe Boostinghost</p>`;

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
          `ðŸ“§ Planning mÃ©nage envoyÃ© Ã  ${cleanerEmail} pour ${tomorrowIso}`
        );
      })
      .catch((err) => {
        console.error('âŒ Erreur envoi planning mÃ©nage (email) :', err);
      })
  );
  }
    // WhatsApp
  });

  await Promise.all(tasks);

  console.log('âœ… Planning mÃ©nage quotidien envoyÃ© (si tÃ¢ches dÃ©tectÃ©es).');
}

// ============================================
// APP / STRIPE / STORE
// ============================================

const app = express();

// âœ… Healthcheck (pour vÃ©rifier que Render sert bien CE serveur)
app.get('/api/health', (req, res) => res.status(200).send('ok-health'));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
const PORT = process.env.PORT || 3000;


// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;

// âœ… WEBHOOK STRIPE (AVANT LES AUTRES MIDDLEWARES)
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

  console.log('âœ… Webhook Stripe reÃ§u:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.userId;
        const plan = session.metadata?.plan || 'basic';

        if (!userId) {
          console.error('userId manquant dans checkout.session.completed');
          break;
        }

        const subscriptionId = session.subscription;
        const customerId = session.customer;

        await pool.query(
          `UPDATE subscriptions 
           SET 
             stripe_subscription_id = $1,
             stripe_customer_id = $2,
             plan_type = $3,
             status = 'active',
             current_period_end = NOW() + INTERVAL '1 month',
             updated_at = NOW()
           WHERE user_id = $4`,
          [subscriptionId, customerId, plan, userId]
        );
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

  console.log(`âœ… Abonnement ACTIF crÃ©Ã© pour user ${userId} (plan: ${plan})`);
  break;
}
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        let status = 'active';
        if (subscription.status === 'trialing') status = 'trial';
        else if (subscription.status === 'canceled') status = 'canceled';
        else if (subscription.status === 'past_due') status = 'past_due';

        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = $1,
             current_period_end = to_timestamp($2),
             updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscriptionId]
        );

        console.log(`âœ… Abonnement ${subscriptionId} mis Ã  jour: ${status}`);
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

        console.log(`âœ… Abonnement ${subscriptionId} annulÃ©`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = 'active',
             updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`âœ… Paiement rÃ©ussi pour subscription ${subscriptionId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        await pool.query(
          `UPDATE subscriptions 
           SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`âŒ Paiement Ã©chouÃ© pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Ã‰vÃ©nement non gÃ©rÃ©: ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('âŒ Erreur traitement webhook:', err);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// Store for reservations (en mÃ©moire)
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


// Data en mÃ©moire
let MANUAL_RESERVATIONS = {};    // { [propertyId]: [reservations ou blocages] }
let DEPOSITS = [];               // { id, reservationUid, amountCents, ... }

// ============================================
// FONCTIONS UTILITAIRES FICHIERS
// ============================================

async function loadManualReservations() {
  try {
    const data = await fsp.readFile(MANUAL_RES_FILE, 'utf8');
    MANUAL_RESERVATIONS = JSON.parse(data);
    console.log('âœ… RÃ©servations manuelles chargÃ©es depuis manual-reservations.json');
  } catch (error) {
    MANUAL_RESERVATIONS = {};
    console.log('âš ï¸  Aucun fichier manual-reservations.json, dÃ©marrage sans rÃ©servations manuelles');
  }
}

async function saveManualReservations() {
  try {
    await fsp.writeFile(MANUAL_RES_FILE, JSON.stringify(MANUAL_RESERVATIONS, null, 2));
    console.log('âœ… RÃ©servations manuelles sauvegardÃ©es');
  } catch (error) {
    console.error('âŒ Erreur lors de la sauvegarde des rÃ©servations manuelles:', error.message);
  }
}

async function loadDeposits() {
  try {
    const data = await fsp.readFile(DEPOSITS_FILE, 'utf8');
    DEPOSITS = JSON.parse(data);
    console.log('âœ… Cautions chargÃ©es depuis deposits-config.json');
  } catch (error) {
    DEPOSITS = [];
    console.log('âš ï¸  Aucun fichier deposits-config.json, dÃ©marrage sans cautions');
  }
}

async function saveDeposits() {
  try {
    await fsp.writeFile(DEPOSITS_FILE, JSON.stringify(DEPOSITS, null, 2));
    console.log('âœ… Cautions sauvegardÃ©es');
  } catch (error) {
    console.error('âŒ Erreur lors de la sauvegarde des cautions:', error.message);
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

// Cherche l'utilisateur en base Ã  partir du token dans Authorization: Bearer
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
// Ã€ COPIER-COLLER APRÃˆS LA FONCTION getUserFromRequest
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

async function checkSubscription(req, res, next) {
  try {
    const user = req.user;
    
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Non autorise', code: 'UNAUTHORIZED' });
    }

    const result = await pool.query(
      `SELECT id, status, trial_end_date, current_period_end, plan_type
      FROM subscriptions WHERE user_id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      console.error('User sans abonnement:', user.id);
      return res.status(403).json({ error: 'Pas abonnement', code: 'NO_SUBSCRIPTION' });
    }

    const subscription = result.rows[0];
    const now = new Date();

    if (subscription.status === 'trial') {
      const trialEnd = new Date(subscription.trial_end_date);
      if (now > trialEnd) {
        await pool.query(`UPDATE subscriptions SET status = 'expired' WHERE id = $1`, [subscription.id]);
        return res.status(402).json({ error: 'Trial expire', code: 'TRIAL_EXPIRED' });
      }
      const days = Math.ceil((trialEnd - now) / 86400000);
      req.subscription = { status: 'trial', days_remaining: days };
      return next();
    }

    if (subscription.status === 'active') {
      req.subscription = { status: 'active', plan_type: subscription.plan_type };
      return next();
    }

    return res.status(402).json({ error: 'Abonnement inactif', code: 'SUBSCRIPTION_INACTIVE' });

  } catch (error) {
    console.error('Erreur checkSubscription:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
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
      [user.id]
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
// PROPERTIES (logements) - stockÃ©es en base
// ============================================

// PROPERTIES est crÃ©Ã© par affectation dans loadProperties (variable globale implicite)
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
        owner_id
      FROM properties
      ORDER BY display_order ASC, created_at ASC
    `);
    PROPERTIES = result.rows.map(row => {
      // âœ… Parser ical_urls si c'est une string JSON
      let icalUrls = row.ical_urls || [];
      if (typeof icalUrls === 'string') {
        try {
          icalUrls = JSON.parse(icalUrls);
        } catch (e) {
          console.error(`âŒ Erreur parse ical_urls pour ${row.name}:`, e.message);
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
        owner_id: row.owner_id,
        display_order: row.display_order
      };
    });
    console.log(`âœ… PROPERTIES chargÃ©es : ${PROPERTIES.length} logements`); 
  } catch (error) {
    console.error('âŒ Erreur loadProperties :', error);
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
    await pool.query(`
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
    `, [
      reservation.uid,
      propertyId,
      userId,
      reservation.start,
      reservation.end,
      reservation.guestName || null,
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

    return true;
  } catch (error) {
    console.error('❌ Erreur saveReservationToDB:', error);
    return false;
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
        r.*,
        p.name as property_name,
        p.color as property_color
      FROM reservations r
      JOIN properties p ON r.property_id = p.id
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
    
    // Mettre à jour le cache
    RESERVATIONS_CACHE[property.id] = reservations;
    reservationsStore.properties[property.id] = reservations;
    
    return reservations;
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
        stripe_session_id, stripe_payment_intent_id, stripe_charge_id,
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
      stripeChargeId: row.stripe_charge_id,
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
    console.error('❌ Erreur saveDepositToDB:', error);
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

    if (additionalData.stripeChargeId) {
      paramCount++;
      updates.push(`stripe_charge_id = $${paramCount}`);
      params.push(additionalData.stripeChargeId);
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
    
    if (!depositData.stripe_payment_intent_id) {
      throw new Error('Pas de Payment Intent associé');
    }

    // Annuler via Stripe
    await stripe.paymentIntents.cancel(depositData.stripe_payment_intent_id);

    // Mettre à jour en base
    await updateDepositStatus(depositId, 'released');

    return true;
  } catch (error) {
    console.error('❌ Erreur releaseDeposit:', error);
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
        r.guest_name,
        r.start_date,
        r.end_date
      FROM checklists c
      JOIN properties p ON c.property_id = p.id
      LEFT JOIN reservations r ON c.reservation_uid = r.uid
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
        r.guest_name,
        r.start_date,
        r.end_date
      FROM checklists c
      JOIN properties p ON c.property_id = p.id
      LEFT JOIN reservations r ON c.reservation_uid = r.uid
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
      params.push(filters.checklistType);
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
  console.log('ðŸ”„ DÃ©marrage de la synchronisation iCal...');
  const isFirstSync = !reservationsStore.lastSync; // premiÃ¨re sync depuis le dÃ©marrage ?
  reservationsStore.syncStatus = 'syncing';

  const newReservations = [];
  const cancelledReservations = [];

  for (const property of PROPERTIES) {
    if (!property.icalUrls || property.icalUrls.length === 0) {
      console.log(`âš ï¸  Aucune URL iCal configurÃ©e pour ${property.name}`);
      continue;
    }

    try {
      const reservations = await icalService.fetchReservations(property);

      // Ancien Ã©tat (iCal + manuelles) :
      const previousAllReservations = reservationsStore.properties[property.id] || [];

      // On ne regarde que les rÃ©sas iCal (pas les manuelles ni les blocages)
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

      // âž• Nouvelles rÃ©servations (prÃ©sentes dans new mais pas dans old)
      const trulyNewReservations = newIcalReservations.filter(r => !oldIds.has(r.uid));

      // âž– RÃ©servations annulÃ©es (prÃ©sentes dans old mais plus dans new)
      const cancelledForProperty = oldIcalReservations.filter(r => !newIds.has(r.uid));

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

      // Base = iCal
      reservationsStore.properties[property.id] = newIcalReservations;

      // Ajouter les rÃ©servations manuelles (y compris blocages)
      const manualForProperty = MANUAL_RESERVATIONS[property.id] || [];
      if (manualForProperty.length > 0) {
        reservationsStore.properties[property.id] = [
          ...reservationsStore.properties[property.id],
          ...manualForProperty
        ];
      }

      console.log(
        `âœ… ${property.name}: ${reservationsStore.properties[property.id].length} ` +
        `rÃ©servations (iCal + manuelles)`
      );
    } catch (error) {
      console.error(`âŒ Erreur lors de la synchronisation de ${property.name}:`, error.message);
    }
  }

  reservationsStore.lastSync = new Date();
  reservationsStore.syncStatus = 'idle';

  // ðŸ”” Notifications : nouvelles + annulations (sauf premiÃ¨re sync pour Ã©viter le spam massif)
  if (!isFirstSync && (newReservations.length > 0 || cancelledReservations.length > 0)) {
    console.log(
      `ðŸ“§ Notifications Ã  envoyer â€“ nouvelles: ${newReservations.length}, annulÃ©es: ${cancelledReservations.length}`
    );
    try {
      await notifyOwnersAboutBookings(newReservations, cancelledReservations);
    } catch (err) {
      console.error('âŒ Erreur lors de lâ€™envoi des notifications propriÃ©taires:', err);
    }

    if (newReservations.length > 0) {
      try {
        await notifyCleanersAboutNewBookings(newReservations);
      } catch (err) {
        console.error('âŒ Erreur lors de lâ€™envoi des notifications mÃ©nage:', err);
      }
    }
  } else if (isFirstSync) {
    console.log('â„¹ï¸ PremiÃ¨re synchronisation : aucune notification envoyÃ©e pour Ã©viter les doublons.');
  }

  console.log('âœ… Synchronisation terminÃ©e');
  return reservationsStore;
}
// ============================================
// ROUTE DE TEST WHATSAPP AMÃ‰LIORÃ‰E
// ============================================

app.get('/api/test-whatsapp', async (req, res) => {
  try {
    console.log('ðŸ§ª Test WhatsApp demandÃ©');
    
    // VÃ©rifier si le service est configurÃ©
    console.log('   - Service configurÃ©:', isConfigured);
    
    if (!isConfigured) {
      return res.status(500).json({ 
        ok: false, 
        error: 'Service WhatsApp non configurÃ©. VÃ©rifiez WHATSAPP_API_KEY et WHATSAPP_PHONE_ID' 
      });
    }
    
    // Utiliser le numÃ©ro passÃ© en paramÃ¨tre ou un numÃ©ro par dÃ©faut
    const testNumber = req.query.number || '+33680559925'; // 
    const testMessage = req.query.message || 'Test WhatsApp Boostinghost âœ…';
    
    console.log(`   - Envoi Ã : ${testNumber}`);
    console.log(`   - Message: ${testMessage}`);
    
    
    console.log('âœ… WhatsApp envoyÃ© avec succÃ¨s:', result);
    
    res.json({ 
      ok: true, 
      message: 'WhatsApp envoyÃ© avec succÃ¨s',
      to: testNumber,
      result: result
    });
  } catch (err) {
    console.error('âŒ Erreur /api/test-whatsapp :', err);
    res.status(500).json({ 
      ok: false,
      error: err.message,
      details: err.stack
    });
  }
});

// Route pour tester avec l'utilisateur connectÃ©
app.get('/api/test-whatsapp-user', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    console.log(`ðŸ§ª Test WhatsApp pour user ${user.id}`);
    
    // RÃ©cupÃ©rer les settings de l'utilisateur
    const settings = await getNotificationSettings(user.id);
    
    console.log('   - Settings utilisateur:', JSON.stringify(settings, null, 2));
    
    if (!settings.whatsappEnabled) {
      return res.json({ 
        ok: false, 
        message: 'WhatsApp dÃ©sactivÃ© dans vos prÃ©fÃ©rences' 
      });
    }
    
    if (!settings.whatsappNumber) {
      return res.json({ 
        ok: false, 
        message: 'Aucun numÃ©ro WhatsApp configurÃ© dans vos prÃ©fÃ©rences' 
      });
    }
    
    const testMessage = `Test notification Boostinghost âœ…\n\nCeci est un message de test envoyÃ© Ã  ${new Date().toLocaleString('fr-FR')}`;
    
    console.log(`   - Envoi Ã : ${settings.whatsappNumber}`);
    
    
    console.log('âœ… Test WhatsApp envoyÃ© avec succÃ¨s');
    
    res.json({ 
      ok: true, 
      message: 'Message WhatsApp envoyÃ© avec succÃ¨s Ã  votre numÃ©ro',
      to: settings.whatsappNumber
    });
    
  } catch (err) {
    console.error('âŒ Erreur /api/test-whatsapp-user :', err);
    res.status(500).json({ 
      ok: false,
      error: err.message 
    });
  }
});

// ============================================
// TEST CONNEXION BASE DE DONNÃ‰ES
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
      error: 'Erreur de connexion Ã  la base'
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
      error: 'Erreur lors de la rÃ©cupÃ©ration des utilisateurs'
    });
  }
});

// ============================================
// ROUTES API - RESERVATIONS (par user)
// ============================================
// ============================================
// ENDPOINT /api/reservations/manual
// (appelÃ© par le frontend)
// ============================================

app.post('/api/reservations/manual', async (req, res) => {
  console.log('ðŸ“ /api/reservations/manual appelÃ©');
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId, start, end, guestName, notes } = req.body;
    console.log('ðŸ“¦ DonnÃ©es reÃ§ues:', { propertyId, start, end, guestName });

    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      console.log('âŒ Logement non trouvÃ©:', propertyId);
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }
    console.log('âœ… Logement trouvÃ©:', property.name);

    const uid = 'manual_' + Date.now();
    const reservation = {
      uid: uid,
      start: start,
      end: end,
      source: 'MANUEL',
      platform: 'MANUEL',
      type: 'manual',
      guestName: guestName || 'RÃ©servation manuelle',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      userId: user.id
    };
    console.log('âœ… RÃ©servation crÃ©Ã©e:', uid);

    // Sauvegarde
    if (!MANUAL_RESERVATIONS[propertyId]) {
      MANUAL_RESERVATIONS[propertyId] = [];
    }
    MANUAL_RESERVATIONS[propertyId].push(reservation);
    
    if (typeof saveManualReservations === 'function') {
      await saveManualReservations();
    }

    if (!reservationsStore.properties[propertyId]) {
      reservationsStore.properties[propertyId] = [];
    }
    reservationsStore.properties[propertyId].push(reservation);

    // RÃ©ponse au client AVANT les notifications
    res.status(201).json({
      message: 'RÃ©servation manuelle crÃ©Ã©e',
      reservation: reservation
    });
    console.log('âœ… RÃ©ponse envoyÃ©e au client');

    // Notifications en arriÃ¨re-plan
    setImmediate(async () => {
      try {
        console.log('ðŸ“§ Envoi des notifications...');
        
        if (typeof notifyOwnersAboutBookings === 'function') {
          await notifyOwnersAboutBookings([reservation], []);
          console.log('âœ… Notification propriÃ©taire envoyÃ©e');
        }
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('âœ… Notification cleaners envoyÃ©e');
        }
      } catch (notifErr) {
        console.error('âš ï¸  Erreur notifications:', notifErr.message);
      }
    });

  } catch (err) {
    console.error('âŒ Erreur /api/reservations/manual:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});
// GET - Toutes les rÃ©servations du user
app.get('/api/reservations', authenticateUser, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
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
    reservations: allReservations,
    lastSync: reservationsStore.lastSync,
    syncStatus: reservationsStore.syncStatus,
    properties: userProps.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      count: (reservationsStore.properties[p.id] || []).length
    }))
  });
});

// POST - CrÃ©er une rÃ©servation manuelle
app.post('/api/bookings', async (req, res) => {
  console.log('ðŸ“ Nouvelle demande de crÃ©ation de rÃ©servation');
  
  try {
    // 1. VÃ‰RIFICATION AUTHENTIFICATION
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('âŒ Utilisateur non authentifiÃ©');
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }
    console.log('âœ… Utilisateur authentifiÃ©:', user.id);
    
    // 2. EXTRACTION ET VALIDATION DES DONNÃ‰ES
    const { propertyId, checkIn, checkOut, guestName, platform, price } = req.body || {};
    console.log('ðŸ“¦ DonnÃ©es reÃ§ues:', { propertyId, checkIn, checkOut, guestName, platform, price });
    
    if (!propertyId) {
      console.log('âŒ propertyId manquant');
      return res.status(400).json({ error: 'propertyId est requis' });
    }
    if (!checkIn) {
      console.log('âŒ checkIn manquant');
      return res.status(400).json({ error: 'checkIn est requis' });
    }
    if (!checkOut) {
      console.log('âŒ checkOut manquant');
      return res.status(400).json({ error: 'checkOut est requis' });
    }
    
    // 3. VÃ‰RIFICATION DU LOGEMENT
    if (!Array.isArray(PROPERTIES)) {
      console.error('âŒ PROPERTIES n\'est pas un tableau');
      return res.status(500).json({ error: 'Erreur de configuration serveur (PROPERTIES)' });
    }
    
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      console.log('âŒ Logement non trouvÃ©:', propertyId);
      console.log('ðŸ“‹ Logements disponibles pour cet utilisateur:', 
        PROPERTIES.filter(p => p.userId === user.id).map(p => ({ id: p.id, name: p.name }))
      );
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }
    console.log('âœ… Logement trouvÃ©:', property.name);
    
    // 4. CRÃ‰ATION DE LA RÃ‰SERVATION
    const uid = 'manual_' + Date.now();
    const reservation = {
      uid: uid,
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'RÃ©servation manuelle',
      price: typeof price === 'number' ? price : 0,
      createdAt: new Date().toISOString(),
      // DonnÃ©es supplÃ©mentaires pour les notifications
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      userId: user.id
    };
    console.log('âœ… RÃ©servation crÃ©Ã©e:', uid);
    
    // 5. SAUVEGARDE DANS MANUAL_RESERVATIONS
    try {
      if (typeof MANUAL_RESERVATIONS === 'undefined') {
        console.log('âš ï¸  MANUAL_RESERVATIONS non dÃ©fini, initialisation');
        global.MANUAL_RESERVATIONS = {};
      }
      
     if (!MANUAL_RESERVATIONS[propertyId]) {
  MANUAL_RESERVATIONS[propertyId] = [];
}
MANUAL_RESERVATIONS[propertyId].push(reservation);

// Sauvegarde sur disque (si la fonction existe)
if (typeof saveManualReservations === 'function') {
  await saveManualReservations();
  console.log('✅ Sauvegarde MANUAL_RESERVATIONS OK');
} else {
  console.log('⚠️  Fonction saveManualReservations non trouvée');
}
} catch (saveErr) {
  console.error('⚠️  Erreur sauvegarde MANUAL_RESERVATIONS:', saveErr);
  // On continue quand même
}
    // DELETE - Supprimer une réservation
app.delete('/api/bookings/:uid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { uid } = req.params;
    
    const deleted = await deleteReservationFromDB(uid);
    
    if (!deleted) {
      return res.status(500).json({ error: 'Erreur lors de la suppression' });
    }

    await loadReservationsFromDB();
    
    res.json({ message: 'Réservation supprimée avec succès' });
  } catch (err) {
    console.error('Erreur DELETE /api/bookings:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
    // 6. AJOUT AU STORE DES RÃ‰SERVATIONS
    try {
      if (typeof reservationsStore === 'undefined') {
        console.log('âš ï¸  reservationsStore non dÃ©fini, initialisation');
        global.reservationsStore = { properties: {} };
      }
      
      if (!reservationsStore.properties) {
        reservationsStore.properties = {};
      }
      
      if (!reservationsStore.properties[propertyId]) {
        reservationsStore.properties[propertyId] = [];
      }
      reservationsStore.properties[propertyId].push(reservation);
      console.log('âœ… Ajout au reservationsStore OK');
    } catch (storeErr) {
      console.error('âš ï¸  Erreur ajout au reservationsStore:', storeErr);
      // On continue quand mÃªme
    }
    
    // 7. PRÃ‰PARATION DE LA RÃ‰PONSE
    const bookingForClient = {
      id: reservation.uid,
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      checkIn: checkIn,
      checkOut: checkOut,
      guestName: reservation.guestName,
      platform: reservation.platform,
      price: reservation.price,
      type: reservation.type
    };
    
    // 8. ENVOI DE LA RÃ‰PONSE (AVANT LES NOTIFICATIONS)
    console.log('âœ… RÃ©servation crÃ©Ã©e avec succÃ¨s, envoi de la rÃ©ponse');
    res.status(201).json(bookingForClient);
    
    // 9. NOTIFICATIONS EN ARRIÃˆRE-PLAN (aprÃ¨s avoir rÃ©pondu au client)
    setImmediate(async () => {
      try {
        console.log('ðŸ“§ Tentative d\'envoi des notifications...');
        
        // VÃ©rifier que les fonctions de notification existent
        if (typeof notifyOwnersAboutBookings === 'function') {
          await notifyOwnersAboutBookings([reservation], []);
          console.log('âœ… Notification propriÃ©taire envoyÃ©e');
        } else {
          console.log('âš ï¸  Fonction notifyOwnersAboutBookings non trouvÃ©e');
        }
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('âœ… Notification cleaners envoyÃ©e');
        } else {
          console.log('âš ï¸  Fonction notifyCleanersAboutNewBookings non trouvÃ©e');
        }
        
        console.log('âœ… Notifications traitÃ©es');
      } catch (notifErr) {
        console.error('âš ï¸  Erreur lors de l\'envoi des notifications (rÃ©servation crÃ©Ã©e quand mÃªme):', notifErr.message);
        console.error('Stack:', notifErr.stack);
      }
    });
    
  } catch (err) {
    console.error('âŒ ERREUR CRITIQUE POST /api/bookings:', err);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    // Si on n'a pas encore envoyÃ© de rÃ©ponse
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Erreur serveur lors de la crÃ©ation de la rÃ©servation',
        message: err.message,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  }
});

// POST - CrÃ©er un blocage manuel (dates bloquÃ©es)
app.post('/api/blocks', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId, start, end, reason } = req.body || {};

    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
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
    await saveManualReservations();

    if (!reservationsStore.properties[propertyId]) {
      reservationsStore.properties[propertyId] = [];
    }
    reservationsStore.properties[propertyId].push(block);

    res.status(201).json({
      message: 'Blocage crÃ©Ã©',
      block
    });
  } catch (err) {
    console.error('Erreur crÃ©ation blocage:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - RÃ©servations dâ€™un logement
app.get('/api/reservations/:propertyId', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvÃ©' });
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
  // âœ… FormData simple : les champs sont directement dans req.body
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
    console.log('âœ… Image uploadÃ©e vers Cloudinary:', cloudinaryUrl);
    return cloudinaryUrl;
  } catch (error) {
    console.error('âŒ Erreur upload Cloudinary:', error);
    throw error;
  }
}

// ============================================
// ROUTES API - PROFIL UTILISATEUR Ã‰TENDU
// ============================================
// Ã€ ajouter dans server.js aprÃ¨s les routes existantes

app.get('/api/user/profile', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
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
      return res.status(404).json({ error: 'Utilisateur non trouvÃ©' });
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

// PUT - Mettre Ã  jour le profil complet de l'utilisateur
app.put('/api/user/profile', upload.single('logo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
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
        error: 'Type de compte invalide. Doit Ãªtre "individual" ou "business"' 
      });
    }

    // Validation du SIRET si entreprise
    if (accountType === 'business' && siret) {
      const siretClean = siret.replace(/\s/g, '');
      if (siretClean.length !== 14 || !/^\d{14}$/.test(siretClean)) {
        return res.status(400).json({ 
          error: 'Le numÃ©ro SIRET doit contenir exactement 14 chiffres' 
        });
      }
    }

    // GÃ©rer le logo uploadÃ©
   // Upload du logo vers Cloudinary
let logoUrl = null;
if (req.file) {
  logoUrl = await uploadPhotoToCloudinary(req.file);
}

    // Mise Ã  jour dans la base de donnÃ©es
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
      return res.status(404).json({ error: 'Utilisateur non trouvÃ©' });
    }

    const updated = result.rows[0];

    // Mettre Ã  jour le cache si utilisÃ©
    if (notificationUserCache.has(user.id)) {
      notificationUserCache.delete(user.id);
    }

    res.json({
      success: true,
      message: 'Profil mis Ã  jour avec succÃ¨s',
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
    console.error('Erreur mise Ã  jour profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Route pour vÃ©rifier le statut de l'abonnement
app.get('/api/subscription/status', authenticateToken, async (req, res) => {
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
      return res.status(404).json({ error: 'Aucun abonnement trouvÃ©' });
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

    // âœ… AJOUTER LE PRIX
    let planAmount = 0;
    if (sub.plan_type === 'basic') {
      planAmount = 599; // 5,99â‚¬ en centimes
    } else if (sub.plan_type === 'pro') {
      planAmount = 899; // 8,99â‚¬ en centimes
    }

    // âœ… AJOUTER LE DISPLAY MESSAGE
    let displayMessage = 'Abonnement';
    if (sub.status === 'trial') {
      displayMessage = 'Essai gratuit';
    } else if (sub.status === 'active') {
      displayMessage = sub.plan_type === 'pro' ? 'Abonnement Pro' : 'Abonnement Basic';
    } else if (sub.status === 'expired') {
      displayMessage = 'Abonnement expirÃ©';
    } else if (sub.status === 'canceled') {
      displayMessage = 'Abonnement annulÃ©';
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
// 1. RÃ©cupÃ©rer le profil au chargement
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

// 2. Mettre Ã  jour le profil lors de la sauvegarde
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
    alert('Profil mis Ã  jour avec succÃ¨s !');
  } else {
    alert('Erreur : ' + data.error);
  }
});
*/
// ============================================
// ROUTES API - BOOKINGS (alias pour rÃ©servations)
// UtilisÃ© par le calendrier moderne (calendar-modern.js)
// ============================================

// GET - Liste des bookings pour l'utilisateur courant
app.get('/api/bookings', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
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

// POST - CrÃ©er un booking manuel (alias de /api/reservations/manual)
app.post('/api/bookings', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId, checkIn, checkOut, guestName, platform, price } = req.body || {};

    if (!propertyId || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'propertyId, checkIn et checkOut sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }

    const reservation = {
      uid: 'manual_' + Date.now(),
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'RÃ©servation manuelle',
      price: typeof price === 'number' ? price : 0,
      createdAt: new Date().toISOString()
    };

    if (!MANUAL_RESERVATIONS[propertyId]) {
      MANUAL_RESERVATIONS[propertyId] = [];
    }
    MANUAL_RESERVATIONS[propertyId].push(reservation);
    await saveManualReservations();

    if (!reservationsStore.properties[propertyId]) {
      reservationsStore.properties[propertyId] = [];
    }
    reservationsStore.properties[propertyId].push(reservation);

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
app.post('/api/sync', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

  if (reservationsStore.syncStatus === 'syncing') {
    return res.status(409).json({
      error: 'Synchronisation dÃ©jÃ  en cours',
      status: 'syncing'
    });
  }

  try {
    const result = await syncAllCalendars();
    const userProps = getUserProperties(user.id);

    res.json({
      message: 'Synchronisation rÃ©ussie',
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
    return res.status(401).json({ error: 'Non autorisÃ©' });
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
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

  const { propertyId } = req.params;
  const { startDate, endDate } = req.query;

  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvÃ©' });
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

// GET - RÃ©servations avec infos de caution
app.get('/api/reservations-with-deposits', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

  const result = [];
  const userProps = getUserProperties(user.id);

  userProps.forEach(property => {
    const reservations = reservationsStore.properties[property.id] || [];

    reservations.forEach(r => {
      const deposit = DEPOSITS.find(d => d.reservationUid === r.uid) || null;

      result.push({
        reservationUid: r.uid,
        propertyId: property.id,
        propertyName: property.name,
        startDate: r.start,
        endDate: r.end,
        guestName: r.guestName || '',
        deposit: deposit
          ? {
              id: deposit.id,
              amountCents: deposit.amountCents,
              status: deposit.status,
              checkoutUrl: deposit.checkoutUrl
            }
          : null
      });
    });
  });

  res.json(result);
});
// ============================================
// ✅ GET - Réservations enrichies (risque + checklist + sous-scores)
// ============================================
app.get('/api/reservations/enriched', authenticateUser, checkSubscription, async (req, res) => {
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
          userId: user.id
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
app.post('/api/checklists/:reservationUid/tasks/:taskId/toggle', authenticateUser, checkSubscription, async (req, res) => {
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
app.post('/api/checklists/:reservationUid/complete', authenticateUser, checkSubscription, async (req, res) => {
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
  res.json({ checklist: chk });
});


// ============================================
// ROUTES API - PARAMÃˆTRES NOTIFICATIONS (par user)
// ============================================

app.get('/api/settings/notifications', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
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
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

    try {
    const {
      newReservation,
      reminder,
      whatsappEnabled,
      whatsappNumber,
    } = req.body || {};

    const saved = await saveNotificationSettings(user.id, {
      newReservation,
      reminder,
      whatsappEnabled,
      whatsappNumber,
    });

    res.json({
      message: 'PrÃ©fÃ©rences de notifications mises Ã  jour',
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

// ICS d'un logement : contient les rÃ©servations manuelles + blocages
app.get('/ical/property/:propertyId.ics', async (req, res) => {
  try {
    const { propertyId } = req.params;

    const property = PROPERTIES.find(p => p.id === propertyId);
    if (!property) {
      return res.status(404).send('Property not found');
    }

    // On exporte uniquement ce qui est dans MANUAL_RESERVATIONS :
    // - rÃ©servations manuelles (type: 'manual')
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
          : (r.guestName ? `RÃ©servation â€“ ${r.guestName}` : 'RÃ©servation Boostinghost');

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
// Fonction helper : GÃ©nÃ©rer un token de vÃ©rification
// ============================================
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// Fonction helper : Envoyer l'email de vÃ©rification
// ============================================
async function sendVerificationEmail(email, firstName, token) {
  const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
  const verificationUrl = `${appUrl}/verify-email.html?token=${token}`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'âœ… VÃ©rifiez votre adresse email - Boostinghost',
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
            <h1>ðŸŽ‰ Bienvenue sur Boostinghost !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName || 'nouveau membre'},</p>
            
            <p>Merci de vous Ãªtre inscrit sur <strong>Boostinghost</strong> !</p>
            
            <p>Pour activer votre compte et commencer Ã  utiliser notre plateforme de gestion de locations courte durÃ©e, veuillez vÃ©rifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
            
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">
                âœ… VÃ©rifier mon email
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
              Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
              <a href="${verificationUrl}" style="color: #10b981;">${verificationUrl}</a>
            </p>
            
            <p style="margin-top: 30px;">
              <strong>Ce lien est valide pendant 24 heures.</strong>
            </p>
            
            <p>Une fois votre email vÃ©rifiÃ©, vous aurez accÃ¨s Ã  :</p>
            <ul>
              <li>âœ… Calendrier unifiÃ©</li>
              <li>âœ… Synchronisation iCal (Airbnb, Booking)</li>
              <li>âœ… Gestion des messages</li>
              <li>âœ… Livret d'accueil personnalisÃ©</li>
              <li>âœ… Gestion du mÃ©nage</li>
              <li>âœ… Et bien plus encore !</li>
            </ul>
            
            <p>Ã€ trÃ¨s bientÃ´t sur Boostinghost ! ðŸš€</p>
          </div>
          <div class="footer">
            <p>Cet email a Ã©tÃ© envoyÃ© automatiquement par Boostinghost.</p>
            <p>Si vous n'avez pas crÃ©Ã© de compte, vous pouvez ignorer cet email.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Email de vÃ©rification envoyÃ© Ã :', email);
    return true;
  } catch (error) {
    console.error('Erreur envoi email vÃ©rification:', error);
    return false;
  }
}
// ============================================
// SERVICE D'EMAILS AUTOMATIQUES
// ============================================

// ============================================
// FONCTION : VÃ©rifier si un email a dÃ©jÃ  Ã©tÃ© envoyÃ©
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
  await pool.query(
    `INSERT INTO email_logs (id, user_id, email_type, email_data, sent_at, status)
     VALUES ($1, $2, $3, $4, NOW(), 'sent')`,
    [`email_${Date.now()}`, userId, emailType, JSON.stringify(emailData)]
  );
}

// ============================================
// EMAIL 1 : BIENVENUE APRÃˆS VÃ‰RIFICATION
// ============================================
async function sendWelcomeEmail(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'ðŸŽ‰ Bienvenue sur Boostinghost !',
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
            <h1 style="margin: 0; font-size: 32px;">ðŸŽ‰ Bienvenue !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Votre compte Boostinghost est maintenant actif !</strong></p>
            
            <p>Vous avez accÃ¨s Ã  <strong>14 jours d'essai gratuit</strong> pour tester toutes les fonctionnalitÃ©s de notre plateforme de gestion de locations courte durÃ©e.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                ðŸš€ AccÃ©der Ã  mon espace
              </a>
            </div>
            
            <h3 style="color: #111827; margin-top: 30px;">âœ¨ Ce que vous pouvez faire dÃ¨s maintenant :</h3>
            
            <div class="feature">
              <span class="feature-icon">ðŸ“…</span>
              <div>
                <strong>Ajoutez vos logements</strong><br>
                <span style="color: #6b7280; font-size: 14px;">CrÃ©ez vos fiches de propriÃ©tÃ©s en quelques clics</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">ðŸ”—</span>
              <div>
                <strong>Synchronisez vos calendriers</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Connectez Airbnb et Booking.com via iCal</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">ðŸ’¬</span>
              <div>
                <strong>GÃ©rez vos messages</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Centralisez toutes vos communications</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">ðŸ§¹</span>
              <div>
                <strong>Organisez le mÃ©nage</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Planifiez et suivez les tÃ¢ches de nettoyage</span>
              </div>
            </div>
            
            <p style="margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              ðŸ’¡ <strong>Besoin d'aide ?</strong><br>
              Notre Ã©quipe est lÃ  pour vous accompagner : <a href="mailto:support@boostinghost.com" style="color: #10b981;">support@boostinghost.com</a>
            </p>
            
            <p>Ã€ trÃ¨s bientÃ´t sur Boostinghost ! ðŸš€</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'Ã©quipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Cet email a Ã©tÃ© envoyÃ© automatiquement par Boostinghost.</p>
            <p>Â© ${new Date().getFullYear()} Boostinghost. Tous droits rÃ©servÃ©s.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('âœ… Email de bienvenue envoyÃ© Ã :', email);
}

// ============================================
// EMAIL 2 : RAPPEL J-7
// ============================================
async function sendTrialReminder7Days(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'â° Plus qu\'une semaine d\'essai gratuit',
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
            <h1 style="margin: 0; font-size: 28px;">â° Plus qu'une semaine !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p>Il vous reste <strong>7 jours</strong> d'essai gratuit sur Boostinghost !</p>
            
            <p>C'est le moment idÃ©al pour :</p>
            <ul>
              <li>Tester toutes les fonctionnalitÃ©s</li>
              <li>Synchroniser tous vos calendriers</li>
              <li>Configurer vos messages automatiques</li>
              <li>Organiser votre planning de mÃ©nage</li>
            </ul>
            
            <p>Pour continuer Ã  profiter de Boostinghost aprÃ¨s votre essai, choisissez le plan qui vous convient :</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                Voir les plans
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px;">
              Pas encore convaincu ? Profitez au maximum de votre semaine restante !
            </p>
          </div>
          <div class="footer">
            <p>Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('âœ… Email rappel J-7 envoyÃ© Ã :', email);
}

// ============================================
// EMAIL 3 : RAPPEL J-3
// ============================================
async function sendTrialReminder3Days(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'ðŸ”” Plus que 3 jours d\'essai gratuit !',
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
          .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">ðŸ”” Plus que 3 jours !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <div class="alert">
              <strong>âš ï¸ Attention !</strong><br>
              Votre essai gratuit se termine dans <strong>3 jours</strong>.
            </div>
            
            <p>Pour continuer Ã  utiliser Boostinghost sans interruption, choisissez votre plan dÃ¨s maintenant :</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Plan Basic - 5,99â‚¬/mois</strong></p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">Toutes les fonctionnalitÃ©s essentielles</p>
            </div>
            
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border: 2px solid #10b981; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Plan Pro - 8,99â‚¬/mois</strong></p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">+ Gestion des cautions Stripe (commission 2%)</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                Choisir mon plan
              </a>
            </div>
          </div>
          <div class="footer">
            <p>Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('âœ… Email rappel J-3 envoyÃ© Ã :', email);
}
// ============================================
// SERVICE D'EMAILS AUTOMATIQUES (SUITE)
// ============================================

// ============================================
// EMAIL 4 : RAPPEL J-1
// ============================================
async function sendTrialReminder1Day(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'ðŸš¨ Dernier jour d\'essai gratuit !',
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
            <h1 style="margin: 0; font-size: 32px;">ðŸš¨ Dernier jour !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <div class="alert">
              <strong style="font-size: 18px;">â° Votre essai gratuit se termine demain !</strong><br><br>
              Pour continuer Ã  utiliser Boostinghost, souscrivez Ã  un plan dÃ¨s maintenant.
            </div>
            
            <p style="font-size: 16px;">Sans abonnement actif, vous perdrez l'accÃ¨s Ã  :</p>
            <ul style="font-size: 16px;">
              <li>Votre calendrier unifiÃ©</li>
              <li>La synchronisation iCal</li>
              <li>La gestion des messages</li>
              <li>Le suivi du mÃ©nage</li>
              <li>Toutes vos donnÃ©es et rÃ©servations</li>
            </ul>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                ðŸš€ Activer mon abonnement maintenant
              </a>
            </div>
            
            <p style="text-align: center; color: #6b7280; font-size: 14px;">
              Seulement 5,99â‚¬/mois pour le plan Basic<br>
              ou 8,99â‚¬/mois pour le plan Pro
            </p>
          </div>
          <div class="footer">
            <p>Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('âœ… Email rappel J-1 envoyÃ© Ã :', email);
}

// ============================================
// EMAIL 5 : CONFIRMATION D'ABONNEMENT
// ============================================
async function sendSubscriptionConfirmedEmail(email, firstName, planType, planAmount) {
  const planName = planType === 'pro' ? 'Pro' : 'Basic';
  const price = (planAmount / 100).toFixed(2);
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'âœ… Abonnement confirmÃ© - Merci !',
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
          .card { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 32px;">âœ… Abonnement confirmÃ© !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Merci pour votre confiance ! ðŸŽ‰</strong></p>
            
            <p>Votre abonnement Boostinghost est maintenant actif.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Votre plan</p>
              <p style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #10b981;">Plan ${planName}</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                <strong style="font-size: 18px; color: #111827;">${price}â‚¬</strong> / mois
              </p>
            </div>
            
            <p>Vous avez maintenant accÃ¨s Ã  toutes les fonctionnalitÃ©s de Boostinghost :</p>
            <ul>
              <li>âœ… Calendrier unifiÃ©</li>
              <li>âœ… Synchronisation iCal (Airbnb, Booking)</li>
              <li>âœ… Gestion des messages</li>
              <li>âœ… Livret d'accueil personnalisÃ©</li>
              <li>âœ… Gestion du mÃ©nage</li>
              <li>âœ… Statistiques & rapports</li>
              ${planType === 'pro' ? '<li>âœ… Gestion des cautions Stripe (2% commission)</li>' : ''}
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                AccÃ©der Ã  mon espace
              </a>
            </div>
            
            <p style="padding: 16px; background: #f0fdf4; border-radius: 6px; border-left: 4px solid #10b981; margin-top: 30px;">
              ðŸ’¡ <strong>GÃ©rer mon abonnement</strong><br>
              Vous pouvez modifier ou annuler votre abonnement Ã  tout moment depuis votre espace compte.
            </p>
            
            <p style="margin-top: 30px;">Merci encore et bonne gestion ! ðŸš€</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'Ã©quipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Questions ? Contactez-nous : support@boostinghost.com</p>
            <p>Â© ${new Date().getFullYear()} Boostinghost. Tous droits rÃ©servÃ©s.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('âœ… Email confirmation abonnement envoyÃ© Ã :', email);
}

// ============================================
// EMAIL 6 : RAPPEL AVANT RENOUVELLEMENT
// ============================================
async function sendRenewalReminderEmail(email, firstName, planType, planAmount, renewalDate) {
  const planName = planType === 'pro' ? 'Pro' : 'Basic';
  const price = (planAmount / 100).toFixed(2);
  const formattedDate = new Date(renewalDate).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'ðŸ”„ Prochain renouvellement dans 3 jours',
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
          .card { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">ðŸ”„ Rappel de renouvellement</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p>Votre abonnement Boostinghost <strong>Plan ${planName}</strong> sera automatiquement renouvelÃ© dans <strong>3 jours</strong>.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Prochain prÃ©lÃ¨vement</p>
              <p style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #3b82f6;">${price}â‚¬</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Date : <strong>${formattedDate}</strong>
              </p>
            </div>
            
            <p>Aucune action n'est nÃ©cessaire de votre part. Le paiement sera effectuÃ© automatiquement.</p>
            
            <p style="padding: 16px; background: #f0f9ff; border-radius: 6px; border-left: 4px solid #3b82f6;">
              ðŸ’¡ Vous souhaitez modifier ou annuler votre abonnement ? Rendez-vous dans votre espace compte.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/settings-account.html" class="button">
                GÃ©rer mon abonnement
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              Merci de votre confiance !<br>
              L'Ã©quipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Questions ? Contactez-nous : support@boostinghost.com</p>
            <p>Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('âœ… Email rappel renouvellement envoyÃ© Ã :', email);
}

// ============================================
// FIN DU SERVICE D'EMAILS
// ============================================

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
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

  try {
    const result = await pool.query(
      'SELECT data FROM welcome_books_v2 WHERE user_id = $1',
      [user.id]
    );

    let data;
    if (result.rows.length === 0) {
      // Pas encore de livret pour cet utilisateur â†’ on crÃ©e un dÃ©faut
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
    return res.status(401).json({ error: 'Non autorisÃ©' });
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
      message: 'Livret sauvegardÃ©',
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

// GET - Liste des personnes de mÃ©nage de l'utilisateur
app.get('/api/cleaners', authenticateUser, checkSubscription, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const result = await pool.query(
      `SELECT id, name, phone, email, notes, is_active, created_at
       FROM cleaners
       WHERE user_id = $1
       ORDER BY name ASC`,
      [user.id]
    );

    res.json({
      cleaners: result.rows
    });
  } catch (err) {
    console.error('Erreur GET /api/cleaners :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - CrÃ©er une nouvelle personne de mÃ©nage
app.post('/api/cleaners', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { name, phone, email, notes, isActive } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Nom requis' });
    }

    const id = 'c_' + Date.now().toString(36);

    const result = await pool.query(
      `INSERT INTO cleaners (id, user_id, name, phone, email, notes, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE), NOW())
       RETURNING id, name, phone, email, notes, is_active, created_at`,
      [id, user.id, name, phone || null, email || null, notes || null, isActive]
    );

    res.status(201).json({
      message: 'Membre du mÃ©nage crÃ©Ã©',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaners :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Modifier une personne de mÃ©nage
app.put('/api/cleaners/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
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
      [id, user.id, name, phone, email, notes, isActive]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre du mÃ©nage introuvable' });
    }

    res.json({
      message: 'Membre du mÃ©nage mis Ã  jour',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur PUT /api/cleaners/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une personne de mÃ©nage
app.delete('/api/cleaners/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membre du mÃ©nage introuvable' });
    }

    res.json({ message: 'Membre du mÃ©nage supprimÃ©' });
  } catch (err) {
    console.error('Erreur DELETE /api/cleaners/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - ASSIGNATIONS MENAGE (par user)
// ============================================

// GET - Liste des assignations de mÃ©nage
app.get('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const result = await pool.query(
      `
      SELECT
        ca.property_id,
        ca.cleaner_id,
        c.name  AS cleaner_name,
        c.email AS cleaner_email,
        c.phone AS cleaner_phone
      FROM cleaning_assignments ca
      LEFT JOIN cleaners c ON c.id = ca.cleaner_id
      WHERE ca.user_id = $1
      ORDER BY ca.property_id ASC
      `,
      [user.id]
    );

    res.json({
      assignments: result.rows
    });
  } catch (err) {
    console.error('Erreur GET /api/cleaning/assignments :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - CrÃ©er / mettre Ã  jour / supprimer une assignation
app.post('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId, cleanerId } = req.body || {};

    if (!propertyId) {
      return res.status(400).json({ error: 'propertyId requis' });
    }

    // Si cleanerId vide â†’ on supprime l'assignation
    if (!cleanerId) {
      await pool.query(
        'DELETE FROM cleaning_assignments WHERE user_id = $1 AND property_id = $2',
        [user.id, propertyId]
      );
      return res.json({
        message: 'Assignation mÃ©nage supprimÃ©e',
        propertyId
      });
    }

    // VÃ©rifier que le logement appartient bien Ã  l'utilisateur
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃ© pour cet utilisateur' });
    }

    // VÃ©rifier que le cleaner appartient bien Ã  l'utilisateur
    const cleanerResult = await pool.query(
      `SELECT id, name, email, phone
       FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [cleanerId, user.id]
    );

    if (cleanerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Personne de mÃ©nage introuvable pour cet utilisateur' });
    }

    await pool.query(
      `
      INSERT INTO cleaning_assignments (user_id, property_id, cleaner_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, property_id) DO UPDATE
        SET cleaner_id = EXCLUDED.cleaner_id,
            updated_at = NOW()
      `,
      [user.id, propertyId, cleanerId]
    );

    res.json({
      message: 'Assignation mÃ©nage enregistrÃ©e',
      assignment: {
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
// ROUTES API - GESTION DES LOGEMENTS (par user)
// ============================================

app.get('/api/properties', authenticateUser, checkSubscription, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const userProps = getUserProperties(user.id);

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

              // Nouveau format Ã©ventuel : dÃ©jÃ  un objet
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

        // ðŸ‘‡ nouveaux champs que le front attend
        address: p.address || null,
        arrivalTime: p.arrival_time || p.arrivalTime || null,
        departureTime: p.departure_time || p.departureTime || null,
        depositAmount: p.deposit_amount ?? p.depositAmount ?? null,
        photoUrl: p.photo_url || p.photoUrl || null,

        // âœ… NOUVEAUX CHAMPS ENRICHIS
        welcomeBookUrl: p.welcome_book_url || null,
        accessCode: p.access_code || null,
        wifiName: p.wifi_name || null,
        wifiPassword: p.wifi_password || null,
        accessInstructions: p.access_instructions || null,

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

app.get('/api/properties/:propertyId', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
  }

  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvÃ©' });
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
    
    // âœ… NOUVEAUX CHAMPS ENRICHIS
    welcomeBookUrl: property.welcome_book_url || null,
    accessCode: property.access_code || null,
    wifiName: property.wifi_name || null,
    wifiPassword: property.wifi_password || null,
    accessInstructions: property.access_instructions || null,
    
    icalUrls: property.icalUrls || property.ical_urls || [],
    reservationCount: (reservationsStore.properties[property.id] || []).length
  });
});

app.post('/api/properties', upload.single('photo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
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
  accessInstructions
    } = body;

    if (!name || !color) {
      return res.status(400).json({ error: 'Nom et couleur requis' });
    }

    const baseId = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const id = `${user.id}-${baseId}`;

    // Upload vers Cloudinary si un fichier est prÃ©sent
let photoUrl = existingPhotoUrl || null;
if (req.file) {
  photoUrl = await uploadPhotoToCloudinary(req.file);
}

    // normaliser les URLs iCal : on accepte strings ou objets {platform,url}
    // normaliser les URLs iCal : on stocke un tableau d'objets { platform, url }
let normalizedIcal = [];
if (Array.isArray(icalUrls)) {
  normalizedIcal = icalUrls
    .map(item => {
      // Ancien cas : juste une string
      if (typeof item === 'string') {
        return {
          url: item,
          platform:
            icalService && icalService.extractSource
              ? icalService.extractSource(item)
              : 'iCal'
        };
      }

      // Nouveau cas : objet { platform, url }
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
    .filter(Boolean);
}

    const ownerId = req.body.ownerId || null; 

await pool.query(
  `INSERT INTO properties (
     id, user_id, name, color, ical_urls,
     address, arrival_time, departure_time, deposit_amount, photo_url,
     welcome_book_url, access_code, wifi_name, wifi_password, access_instructions,
     owner_id, created_at
   )
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
  [
    id,
    user.id,
    name,
    color,
    JSON.stringify(normalizedIcal),
    address || null,
    arrivalTime || null,
    departureTime || null,
    depositAmount === '' || depositAmount == null ? null : Number(depositAmount),
    photoUrl,
    welcomeBookUrl || null,
    accessCode || null,
    wifiName || null,
    wifiPassword || null,
    accessInstructions || null,
    ownerId
  ]
);
      
    await loadProperties();

    const property = PROPERTIES.find(p => p.id === id);

    res.status(201).json({
      message: 'Logement crÃ©Ã© avec succÃ¨s',
      property
    });
  } catch (err) {
    console.error('Erreur crÃ©ation logement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/properties/:propertyId', upload.single('photo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId } = req.params;

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
  ownerId
    } = body;

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }

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

const newOwnerId = body.ownerId || null;
    
await pool.query(
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
     owner_id = $14
   WHERE id = $15 AND user_id = $16`,
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
    newOwnerId, // â† AJOUTE CETTE LIGNE
    propertyId,
    user.id
  ]
);
    await loadProperties();

    const updated = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

    res.json({
      message: 'Logement modifiÃ© avec succÃ¨s',
      property: updated
    });
  } catch (err) {
    console.error('Erreur modification logement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/properties/:propertyId', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId } = req.params;

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }

    await pool.query(
      'DELETE FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, user.id]
    );

    delete reservationsStore.properties[propertyId];

    await loadProperties();

    res.json({
      message: 'Logement supprimÃ© avec succÃ¨s',
      property
    });
  } catch (err) {
    console.error('Erreur suppression logement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
  // RÃ©organiser l'ordre des logements
app.put('/api/properties/:propertyId/reorder', authenticateUser, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId } = req.params;
    const { direction } = req.body; // 'up' ou 'down'

    // RÃ©cupÃ©rer le logement actuel
    const currentResult = await pool.query(
      'SELECT id, display_order FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, user.id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }

    const currentOrder = currentResult.rows[0].display_order;
    const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;

    if (newOrder < 1) {
      return res.status(400).json({ error: 'DÃ©jÃ  en premiÃ¨re position' });
    }

    // Trouver le logement Ã  Ã©changer
    const swapResult = await pool.query(
      'SELECT id, display_order FROM properties WHERE user_id = $1 AND display_order = $2',
      [user.id, newOrder]
    );

    if (swapResult.rows.length === 0) {
      return res.status(400).json({ error: 'DÃ©jÃ  en derniÃ¨re position' });
    }

    const swapId = swapResult.rows[0].id;

    // Ã‰changer les positions
    await pool.query('UPDATE properties SET display_order = $1 WHERE id = $2', [newOrder, propertyId]);
    await pool.query('UPDATE properties SET display_order = $1 WHERE id = $2', [currentOrder, swapId]);

    // Recharger les propriÃ©tÃ©s
    await loadProperties();

    res.json({ success: true, message: 'Ordre mis Ã  jour' });

  } catch (err) {
    console.error('Erreur rÃ©organisation:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API - NOTIFICATIONS TEST
// ============================================

app.post('/api/test-notification', async (req, res) => {
  try {
    await notificationService.sendTestNotification();
    res.json({ message: 'Notification de test envoyÃ©e' });
  } catch (error) {
    res.status(500).json({
      error: 'Erreur lors de l\'envoi de la notification',
      details: error.message
    });
  }
});

// ============================================
// ROUTES API - CONFIG (par user)
// ============================================

app.get('/api/config', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
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

    // VÃ©rifier si l'email existe dÃ©jÃ 
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un compte existe dÃ©jÃ  avec cet e-mail' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);
    
    // GÃ©nÃ©rer l'ID utilisateur
    const id = `u_${Date.now().toString(36)}`;

    // GÃ©nÃ©rer le token de vÃ©rification
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 heures

    // CrÃ©er l'utilisateur avec email_verified = FALSE
    await pool.query(
      `INSERT INTO users (
        id, company, first_name, last_name, email, password_hash, 
        created_at, stripe_account_id,
        email_verified, verification_token, verification_token_expires
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, $7, $8, $9)`,
      [id, company, firstName, lastName, email, passwordHash, false, verificationToken, tokenExpires]
    );

    // CrÃ©er l'abonnement trial (seulement s'il n'existe pas dÃ©jÃ )
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

    // Envoyer l'email de vÃ©rification
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
    const verificationUrl = `${appUrl}/verify-email.html?token=${verificationToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'âœ… VÃ©rifiez votre adresse email - Boostinghost',
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
              <h1>ðŸŽ‰ Bienvenue sur Boostinghost !</h1>
            </div>
            <div class="content">
              <p>Bonjour ${firstName},</p>
              
              <p>Merci de vous Ãªtre inscrit sur <strong>Boostinghost</strong> !</p>
              
              <p>Pour activer votre compte et commencer Ã  utiliser notre plateforme, veuillez vÃ©rifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
              
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">
                  âœ… VÃ©rifier mon email
                </a>
              </div>
              
              <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
                Si le bouton ne fonctionne pas, copiez ce lien :<br>
                <a href="${verificationUrl}" style="color: #10b981;">${verificationUrl}</a>
              </p>
              
              <p style="margin-top: 30px;">
                <strong>Ce lien est valide pendant 24 heures.</strong>
              </p>
              
              <p>Ã€ trÃ¨s bientÃ´t sur Boostinghost ! ðŸš€</p>
            </div>
            <div class="footer">
              <p>Cet email a Ã©tÃ© envoyÃ© automatiquement par Boostinghost.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Email de vÃ©rification envoyÃ© Ã :', email);
    } catch (emailErr) {
      console.error('Erreur envoi email:', emailErr);
      // On continue quand mÃªme
    }
// Retourner succÃ¨s
    res.status(201).json({
      success: true,
      message: 'Compte crÃ©Ã© ! VÃ©rifiez votre email pour activer votre compte.',
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
    error: 'Email non vÃ©rifiÃ©',
    emailNotVerified: true,
    email: row.email,
    message: 'Veuillez vÃ©rifier votre email avant de vous connecter.'
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
    return res.status(401).json({ error: 'Token invalide ou expirÃ©' });
  }
});
// Route de vÃ©rification d'email
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token manquant' });
    }

    // VÃ©rifier le token
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

    // VÃ©rifier si le token est expirÃ©
    if (new Date() > new Date(user.verification_token_expires)) {
      return res.status(400).json({ error: 'Token expirÃ©' });
    }

    // Activer le compte
    await pool.query(
      `UPDATE users 
       SET email_verified = TRUE,
           verification_token = NULL,
           verification_token_expires = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    console.log('âœ… Email vÃ©rifiÃ© pour:', user.email);

    // âœ… Envoyer email de bienvenue
    await sendWelcomeEmail(user.email, user.first_name || 'nouveau membre');
    await logEmailSent(user.id, 'welcome', { email: user.email });

    res.json({
      success: true,
      message: 'Email vÃ©rifiÃ© avec succÃ¨s !',
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
    return res.status(404).json({ error: 'RÃ©servation non trouvÃ©e' });
  }

  const customData = {
    propertyAddress: 'Adresse du logement Ã  dÃ©finir',
    accessCode: 'Code Ã  dÃ©finir'
  };

  const message = messagingService.generateQuickMessage(reservation, templateKey, customData);

  if (!message) {
    return res.status(404).json({ error: 'Template non trouvÃ©' });
  }

  res.json(message);
});

app.get('/api/messages/upcoming', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃ©' });
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
// ðŸ’³ ROUTES API - ABONNEMENTS (Stripe Billing)
// ============================================

function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par dÃ©faut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃ© (clÃ© secrÃ¨te manquante)' });
    }
    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }
    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configurÃ©' });
    }
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      // âœ… AJOUTEZ LES METADATA ICI DIRECTEMENT
      metadata: {
        userId: user.id,
        plan: plan
      },
      customer_email: user.email,
      client_reference_id: user.id, // âœ… IMPORTANT pour le webhook
      success_url: `${appUrl}/app.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing.html`,
    });
    
    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur /api/billing/create-checkout-session :', err);
    res.status(500).json({ error: 'Impossible de crÃ©er la session de paiement' });
  }
});

// ============================================
// ðŸ’³ ROUTES API - STRIPE CONNECT (compte hÃ´te)
// ============================================

app.get('/api/stripe/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    if (!stripe) {
      // Stripe pas configurÃ© â†’ on indique juste "pas connectÃ©"
      return res.json({
        connected: false,
        error: 'Stripe non configurÃ© cÃ´tÃ© serveur'
      });
    }

    if (!user.stripeAccountId) {
      // Lâ€™utilisateur nâ€™a encore jamais connectÃ© de compte Stripe
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
      // Si on nâ€™arrive pas Ã  rÃ©cupÃ©rer le compte, on considÃ¨re "non connectÃ©"
      return res.json({
        connected: false,
        error: 'Impossible de rÃ©cupÃ©rer le compte Stripe'
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
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃ© (clÃ© secrÃ¨te manquante)' });
    }

    let accountId = user.stripeAccountId;

    // 1) Si lâ€™utilisateur nâ€™a pas encore de compte Stripe, on en crÃ©e un
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

      // On sauvegarde lâ€™ID du compte Stripe en base
      await pool.query(
        'UPDATE users SET stripe_account_id = $1 WHERE id = $2',
        [accountId, user.id]
      );
    }

    // 2) On crÃ©e le lien dâ€™onboarding pour que lâ€™utilisateur complÃ¨te ses infos chez Stripe
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
      error: 'Impossible de gÃ©nÃ©rer le lien Stripe : ' + (err.message || 'Erreur interne'),
      stripeType: err.type || null,
      stripeCode: err.code || null
    });
  }
});

// ============================================
// ðŸš€ ROUTES API - CAUTIONS (Stripe)
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

// GET - RÃ©cupÃ©rer la caution liÃ©e Ã  une rÃ©servation (si existe)
app.get('/api/deposits/:reservationUid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
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
// POST - CrÃ©er une caution Stripe pour une rÃ©servation (empreinte bancaire)
app.post('/api/deposits', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃ© (clÃ© secrÃ¨te manquante)' });
    }

    const { reservationUid, amount } = req.body;

    if (!reservationUid || !amount || amount <= 0) {
      return res.status(400).json({ error: 'reservationUid et montant (>0) sont requis' });
    }

    // Retrouver la rÃ©servation dans les rÃ©servations du user
    const result = findReservationByUidForUser(reservationUid, user.id);
    if (!result) {
      return res.status(404).json({ error: 'RÃ©servation non trouvÃ©e pour cet utilisateur' });
    }

    const { reservation, property } = result;
    const amountCents = Math.round(amount * 100);

    // CrÃ©er l'objet "caution" en mÃ©moire + fichier JSON
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

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Caution séjour â€“ ${property ? property.name : 'Logement'}`,
            description: `Du ${reservation.start} au ${reservation.end}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      // ðŸ”¹ Empreinte bancaire : autorisation non capturÃ©e
      payment_intent_data: {
        capture_method: 'manual',
        metadata: {
          deposit_id: deposit.id,
          reservation_uid: reservationUid,
          user_id: user.id
        }
      },
      // (metadata aussi sur la Session)
      metadata: {
        deposit_id: deposit.id,
        reservation_uid: reservationUid,
        user_id: user.id
      },
      success_url: `${appUrl}/caution-success.html?depositId=${deposit.id}`,
      cancel_url: `${appUrl}/caution-cancel.html?depositId=${deposit.id}`
    };

    let session;

    // Si tu as un compte Stripe Connect liÃ©, on crÃ©e la session sur CE compte
    if (user.stripeAccountId) {
      console.log('CrÃ©ation session de caution sur compte connectÃ© :', user.stripeAccountId);
      session = await stripe.checkout.sessions.create(
        sessionParams,
        { stripeAccount: user.stripeAccountId }
      );
    } else {
      console.log('CrÃ©ation session de caution sur le compte plateforme (pas de stripeAccountId)');
      session = await stripe.checkout.sessions.create(sessionParams);
    }

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
    console.error('Erreur crÃ©ation caution:', err);
    return res.status(500).json({
      error: 'Erreur lors de la crÃ©ation de la caution : ' + (err.message || 'Erreur interne Stripe')
    });
  }
});
// GET - Liste des cautions d'un utilisateur
app.get('/api/deposits', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { status, propertyId } = req.query;
    
    const deposits = await getUserDeposits(user.id, { status, propertyId });
    
    res.json({ deposits });
  } catch (err) {
    console.error('Erreur GET /api/deposits:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Capturer une caution (débiter le client)
app.post('/api/deposits/:depositId/capture', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { depositId } = req.params;
    const { amountCents } = req.body;
    
    // Vérifier que le deposit appartient à l'utilisateur
    const deposit = await pool.query(
      'SELECT * FROM deposits WHERE id = $1 AND user_id = $2',
      [depositId, user.id]
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
app.post('/api/deposits/:depositId/release', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { depositId } = req.params;
    
    // Vérifier que le deposit appartient à l'utilisateur
    const deposit = await pool.query(
      'SELECT * FROM deposits WHERE id = $1 AND user_id = $2',
      [depositId, user.id]
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
// ROUTES API - FACTURATION PROPRIÃ‰TAIRES
// ============================================
// Ã€ ajouter dans server.js
// 
// IMPORTANT : Ne pas re-dÃ©clarer ces variables si elles existent dÃ©jÃ  :
// - const multer = require('multer');
// - const path = require('path');
// - const ExcelJS = require('exceljs');
//
// Chercher dans server.js si elles sont dÃ©jÃ  prÃ©sentes, sinon les ajouter EN HAUT du fichier
// ============================================
// ROUTES API - ABONNEMENTS STRIPE
// Ã€ COPIER-COLLER DANS server.js APRÃˆS LES AUTRES ROUTES
// ============================================

// Helper : RÃ©cupÃ©rer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par dÃ©faut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

// POST - CrÃ©er une session de paiement Stripe
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configure' });
    }

    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configure' });
    }

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃ©er la session Stripe Checkout
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
        trial_period_days: 14,
        metadata: {
          userId: user.id,
          plan: plan
        }
      },
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${appUrl}/settings-account.html?tab=subscription&success=true`,
      cancel_url: `${appUrl}/pricing.html?cancelled=true`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur create-checkout-session:', err);
    res.status(500).json({ error: 'Impossible de creer la session de paiement' });
  }
});

// GET - RÃ©cupÃ©rer le statut d'abonnement de l'utilisateur
app.get('/api/subscription/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    const result = await pool.query(
      `SELECT 
        id, status, plan_type, plan_amount,
        trial_start_date, trial_end_date, 
        current_period_end, stripe_subscription_id
      FROM subscriptions 
      WHERE user_id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Aucun abonnement trouve',
        hasSubscription: false
      });
    }

    const subscription = result.rows[0];
    const now = new Date();

    let daysRemaining = null;
    let isExpiringSoon = false;

    if (subscription.status === 'trial') {
      const trialEnd = new Date(subscription.trial_end_date);
      daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      isExpiringSoon = daysRemaining <= 3 && daysRemaining > 0;
    }

    let displayMessage = '';
    if (subscription.status === 'trial') {
      if (daysRemaining > 0) {
        displayMessage = `${daysRemaining} jour${daysRemaining > 1 ? 's' : ''} d'essai restant${daysRemaining > 1 ? 's' : ''}`;
      } else {
        displayMessage = 'Periode essai expiree';
      }
    } else if (subscription.status === 'active') {
      displayMessage = `Abonnement ${subscription.plan_type === 'pro' ? 'Pro' : 'Basic'} actif`;
    } else if (subscription.status === 'expired') {
      displayMessage = 'Abonnement expire';
    } else if (subscription.status === 'canceled') {
      displayMessage = 'Abonnement annule';
    }

    res.json({
      hasSubscription: true,
      status: subscription.status,
      planType: subscription.plan_type,
      planAmount: subscription.plan_amount,
      trialEndDate: subscription.trial_end_date,
      currentPeriodEnd: subscription.current_period_end,
      daysRemaining: daysRemaining,
      isExpiringSoon: isExpiringSoon,
      displayMessage: displayMessage,
      stripeSubscriptionId: subscription.stripe_subscription_id
    });

  } catch (err) {
    console.error('Erreur subscription/status:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - CrÃ©er un lien vers le portail client Stripe
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configure' });
    }

    // RÃ©cupÃ©rer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouve' });
    }

    const customerId = result.rows[0].stripe_customer_id;
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃ©er la session du portail
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
    cb(new Error('Format de fichier non supportÃ©'));
  }
});

// ============================================
// CLIENTS PROPRIÃ‰TAIRES - CRUD
// ============================================

// 1. LISTE DES CLIENTS
app.get('/api/owner-clients', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

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

// 2. DÃ‰TAIL D'UN CLIENT
app.get('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const result = await pool.query(
      'SELECT * FROM owner_clients WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvÃ©' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur dÃ©tail client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 3. CRÃ‰ER UN CLIENT
app.post('/api/owner-clients', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

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
      return res.status(400).json({ error: 'Nom et prÃ©nom requis' });
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
    console.error('Erreur crÃ©ation client:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});
app.put('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

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
      return res.status(404).json({ error: 'Client non trouvÃ©' });
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const clientId = req.params.id;

    // OPTIONNEL : bloquer si des factures existent dÃ©jÃ  pour ce client
    const invRes = await pool.query(
      'SELECT COUNT(*) FROM owner_invoices WHERE client_id = $1 AND user_id = $2',
      [clientId, user.id]
    );
    const invCount = parseInt(invRes.rows[0].count, 10) || 0;
    if (invCount > 0) {
      return res.status(400).json({
        error: 'Impossible de supprimer un client qui a dÃ©jÃ  des factures.'
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    // VÃ©rifier qu'il n'y a pas de factures liÃ©es
    const checkInvoices = await pool.query(
      'SELECT COUNT(*) as count FROM owner_invoices WHERE client_id = $1',
      [req.params.id]
    );

    if (parseInt(checkInvoices.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer : ce client a des factures associÃ©es' 
      });
    }

    const result = await pool.query(
      'DELETE FROM owner_clients WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvÃ©' });
    }

    res.json({ message: 'Client supprimÃ©' });
  } catch (err) {
    console.error('Erreur suppression client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API V2 - FACTURATION PROPRIÃ‰TAIRES
// ============================================
// NOUVELLES ROUTES Ã  ajouter APRÃˆS les routes V1 existantes

// ============================================
// ARTICLES (CATALOGUE)
// ============================================

// 1. LISTE DES ARTICLES
app.get('/api/owner-articles', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const result = await pool.query(
      `SELECT * FROM owner_articles 
       WHERE user_id = $1 AND is_active = true
       ORDER BY article_type, name`,
      [user.id]
    );

    res.json({ articles: result.rows });
  } catch (err) {
    console.error('Erreur liste articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. CRÃ‰ER UN ARTICLE
app.post('/api/owner-articles', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const { articleType, name, description, unitPrice, commissionRate } = req.body;

    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const result = await pool.query(`
      INSERT INTO owner_articles (user_id, article_type, name, description, unit_price, commission_rate)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user.id, articleType, name, description, unitPrice || 0, commissionRate || 0]);

    res.json({ article: result.rows[0] });
  } catch (err) {
    console.error('Erreur crÃ©ation article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 3. MODIFIER UN ARTICLE
app.put('/api/owner-articles/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const { name, description, unitPrice, commissionRate } = req.body;

    const result = await pool.query(`
      UPDATE owner_articles 
      SET name = $1, description = $2, unit_price = $3, commission_rate = $4
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [name, description, unitPrice, commissionRate, req.params.id, user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article non trouvÃ©' });
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const result = await pool.query(
      'UPDATE owner_articles SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article non trouvÃ©' });
    }

    res.json({ message: 'Article supprimÃ©' });
  } catch (err) {
    console.error('Erreur suppression article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 5. CRÃ‰ER ARTICLES PAR DÃ‰FAUT
app.post('/api/owner-articles/init-defaults', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    await pool.query('SELECT create_default_owner_articles($1)', [user.id]);

    res.json({ message: 'Articles par dÃ©faut crÃ©Ã©s' });
  } catch (err) {
    console.error('Erreur init articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FACTURES PROPRIÃ‰TAIRES - LISTE & CRÃ‰ATION
// ============================================

// 1. LISTE DES FACTURES PROPRIÃ‰TAIRES
app.get('/api/owner-invoices', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

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
    `, [user.id]);

    res.json({ invoices: result.rows });
  } catch (err) {
    console.error('Erreur liste factures propriÃ©taires:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. CRÃ‰ER UNE NOUVELLE FACTURE PROPRIÃ‰TAIRE (BROUILLON PAR DÃ‰FAUT)
app.post('/api/owner-invoices', async (req, res) => {
  const client = await pool.connect();

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

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
      return res.status(400).json({ error: 'DonnÃ©es facture incomplÃ¨tes' });
    }

    await client.query('BEGIN');

    // Recalculer les totaux de la mÃªme faÃ§on que dans le PUT /api/owner-invoices/:id
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

    // CrÃ©ation de la facture (brouillon)
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
      user.id,
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
// Sauvegarder les logements liÃ©s
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
    console.error('Erreur crÃ©ation facture propriÃ©taire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});
// 2bis. RÃ‰CUPÃ‰RER UNE FACTURE PROPRIÃ‰TAIRE PAR ID
app.get('/api/owner-invoices/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const invoiceId = req.params.id;

    // Facture
    const invResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (invResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    const invoice = invResult.rows[0];

    // Lignes
    // RÃ©cupÃ©rer les logements liÃ©s
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
    console.error('Erreur lecture facture propriÃ©taire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// CRÃ‰ER UN AVOIR SUR UNE FACTURE EXISTANTE
app.post('/api/owner-invoices/:id/credit-note', async (req, res) => {
  const client = await pool.connect();

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const invoiceId = req.params.id;

    // RÃ©cupÃ©rer la facture d'origine
    const origResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (origResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    const orig = origResult.rows[0];

    if (orig.is_credit_note) {
      return res.status(400).json({ error: 'Impossible de crÃ©er un avoir sur un avoir.' });
    }
    if (orig.status === 'draft') {
      return res.status(400).json({ error: 'On ne peut crÃ©er un avoir que sur une facture facturÃ©e.' });
    }

    await client.query('BEGIN');

    // Totaux nÃ©gatifs pour l'avoir
    const creditSubtotalHt     = -Number(orig.subtotal_ht     || 0);
    const creditSubtotalDebours = -Number(orig.subtotal_debours || 0);
    const creditVatAmount      = -Number(orig.vat_amount      || 0);
    const creditTotalTtc       = -Number(orig.total_ttc       || 0);
    const creditDiscountAmount = -Number(orig.discount_amount || 0);

    // CrÃ©er la facture d'avoir (statut "invoiced" directement)
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

    // GÃ©nÃ©rer un numÃ©ro d'avoir type A-2025-0007
    const year = new Date().getFullYear();
    const creditNumber = `A-${year}-${String(creditId).padStart(4, '0')}`;

    await client.query(
      'UPDATE owner_invoices SET invoice_number = $1 WHERE id = $2',
      [creditNumber, creditId]
    );

    // Copier les lignes en nÃ©gatif
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

    // Renvoie l'avoir crÃ©Ã©
    res.json({ invoice: { ...credit, invoice_number: creditNumber } });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur crÃ©ation avoir propriÃ©taire:', err);
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

app.post('/api/invoice/create', authenticateUser, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

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

    // GÃ©nÃ©rer le numÃ©ro de facture
    const invoiceNumber = 'FACT-' + Date.now();
    const invoiceId = 'inv_' + Date.now();

    // Calculer les montants
    const subtotal = parseFloat(rentAmount || 0) + parseFloat(touristTaxAmount || 0) + parseFloat(cleaningFee || 0);
    const vatAmount = subtotal * (parseFloat(vatRate || 0) / 100);
    const total = subtotal + vatAmount;

    

    
// GÃ©nÃ©rer un PDF simple (serveur) avec PDFKit
    async function generateInvoicePdfToFile(outputPath) {
      return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);

        doc.fontSize(20).text(`FACTURE ${invoiceNumber}`, { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Ã‰metteur : ${user.company || 'Conciergerie'}`);
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
          doc.text(`SÃ©jour : du ${ci} au ${co} (${nights} nuit${nights > 1 ? 's' : ''})`);
        }

        doc.moveDown();
        doc.fontSize(13).text('DÃ©tails', { underline: true });
        doc.moveDown(0.5);

        const addLine = (label, value) => {
          doc.fontSize(12).text(`${label} : ${Number(value).toFixed(2)} â‚¬`);
        };
// âœ… Download facture PDF via token expirant
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
      return res.status(410).send('Lien expirÃ©.');
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
    console.error('âŒ Erreur download invoice:', err);
    res.status(500).send('Erreur serveur.');
  }
});

        if (parseFloat(rentAmount || 0) > 0) addLine('Loyer', rentAmount);
        if (parseFloat(touristTaxAmount || 0) > 0) addLine('Taxes de séjour', touristTaxAmount);
        if (parseFloat(cleaningFee || 0) > 0) addLine('Frais de mÃ©nage', cleaningFee);

        doc.moveDown();
        doc.fontSize(12).text(`Sous-total : ${subtotal.toFixed(2)} â‚¬`);
        if (vatAmount > 0) doc.text(`TVA (${vatRate}%) : ${vatAmount.toFixed(2)} â‚¬`);
        doc.fontSize(16).text(`TOTAL TTC : ${total.toFixed(2)} â‚¬`, { underline: true });

        doc.end();

        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    }

// Si sendEmail est true, envoyer l'email via API Brevo

    if (sendEmail && clientEmail) {
      const profile = user;
      

      // 1) GÃ©nÃ©rer le fichier PDF
      const pdfPath = path.join(INVOICE_PDF_DIR, `${invoiceNumber}.pdf`);
      await generateInvoicePdfToFile(pdfPath);

      // 2) CrÃ©er un token expirant 24h
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO invoice_download_tokens (token, user_id, invoice_number, file_path, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token, user.id, invoiceNumber, pdfPath, expiresAt]
      );

      // 3) Construire lâ€™URL de download (idÃ©alement via env)
      const origin = new URL(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).origin;
const pdfUrl = `${origin}/api/invoice/download/${token}`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111827;">Facture NÂ° ${invoiceNumber}</h2>
          <p><strong>De :</strong> ${profile.company || 'Conciergerie'}</p>
          <p><strong>Pour :</strong> ${clientName}</p>
          <p><strong>Logement :</strong> ${propertyName}</p>
          ${propertyAddress ? `<p><strong>Adresse :</strong> ${propertyAddress}</p>` : ''}
          ${checkinDate && checkoutDate ? `<p><strong>SÃ©jour :</strong> Du ${new Date(checkinDate).toLocaleDateString('fr-FR')} au ${new Date(checkoutDate).toLocaleDateString('fr-FR')} (${nights} nuit${nights > 1 ? 's' : ''})</p>` : ''}
          
          <h3 style="margin-top: 24px; color: #374151;">DÃ©tails de la facture</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${rentAmount > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Loyer</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(rentAmount).toFixed(2)} â‚¬</td></tr>` : ''}
            ${touristTaxAmount > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Taxes de séjour</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(touristTaxAmount).toFixed(2)} â‚¬</td></tr>` : ''}
            ${cleaningFee > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Frais de mÃ©nage</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(cleaningFee).toFixed(2)} â‚¬</td></tr>` : ''}
          </table>
          
          <p style="margin-top: 16px; font-weight: 600;">Sous-total : ${subtotal.toFixed(2)} â‚¬</p>
          ${vatAmount > 0 ? `<p style="font-weight: 600;">TVA (${vatRate}%) : ${vatAmount.toFixed(2)} â‚¬</p>` : ''}
          <h3 style="font-size: 20px; color: #10B981; margin-top: 24px;">TOTAL TTC : ${total.toFixed(2)} â‚¬</h3>
          
          <div style="background: #ecfdf5; border: 2px solid #10B981; border-radius: 8px; padding: 16px; margin-top: 24px; text-align: center;">
            <p style="color: #10B981; font-weight: bold; margin: 0; font-size: 18px;">âœ“ FACTURE ACQUITTÃ‰E</p>
          </div>

          <div style="margin-top: 18px; text-align: center;">
            <a href="${pdfUrl}"
              style="display:inline-block; padding:12px 18px; background:#111827; color:#fff; text-decoration:none; border-radius:10px; font-weight:700;">
              TÃ©lÃ©charger la facture (PDF)
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
        
        console.log('âœ… Email facture client envoyÃ© Ã :', clientEmail);

      } catch (emailErr) {
        console.error('âŒ Erreur envoi email facture client:', emailErr);
      }
    }
    
    res.json({ 
      success: true, 
      invoiceNumber,
      invoiceId,
      message: 'Facture crÃ©Ã©e avec succÃ¨s' 
    });
    
  } catch (err) {
    console.error('Erreur crÃ©ation facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FACTURES - ROUTES MODIFIÃ‰ES (AVEC RÃ‰DUCTIONS)
// ============================================

// 6. MODIFIER UNE FACTURE BROUILLON
app.put('/api/owner-invoices/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    // VÃ©rifier que c'est un brouillon
    const checkResult = await client.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent Ãªtre modifiÃ©s' });
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

    // Calculer rÃ©duction
    let discountAmount = 0;
    if (discountType === 'percentage') {
      discountAmount = subtotalHt * (parseFloat(discountValue) / 100);
    } else if (discountType === 'fixed') {
      discountAmount = parseFloat(discountValue);
    }

    const netHt = subtotalHt - discountAmount;
    const vatAmount = vatApplicable ? netHt * (parseFloat(vatRate) / 100) : 0;
    const totalTtc = netHt + subtotalDebours + vatAmount;

    // Mettre Ã  jour facture
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

    // InsÃ©rer nouvelles lignes
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

    res.json({ success: true, message: 'Facture modifiÃ©e' });


// TÃ©lÃ©charger une facture PDF via token expirant
    console.log('âœ… REGISTER: /api/invoice/download/:token');
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
      return res.status(410).send('Lien expirÃ©.');
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
    console.error('âŒ Erreur download invoice:', err);
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
app.delete('/api/owner-invoices/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    // VÃ©rifier que c'est un brouillon
    const checkResult = await pool.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent Ãªtre supprimÃ©s. CrÃ©ez un avoir pour annuler.' });
    }

    await pool.query('DELETE FROM owner_invoices WHERE id = $1', [req.params.id]);

    res.json({ message: 'Facture supprimÃ©e' });
  } catch (err) {
    console.error('Erreur suppression facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// 2bis. VALIDER UNE FACTURE (BROUILLON -> FACTURÃ‰E)
app.post('/api/owner-invoices/:id/finalize', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const invoiceId = req.params.id;

    // RÃ©cupÃ©rer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    const invoice = result.rows[0];

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent Ãªtre validÃ©s.' });
    }

    // GÃ©nÃ©rer un numÃ©ro si absent
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
      ['invoiced', invoiceNumber, invoiceId, user.id]
    );

    res.json({ invoice: updateResult.rows[0] });
  } catch (err) {
    console.error('Erreur finalisation facture propriÃ©taire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 8. ENVOYER UN BROUILLON
app.post('/api/owner-invoices/:id/send', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    // RÃ©cupÃ©rer la facture
    const invoiceResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Cette facture a dÃ©jÃ  Ã©tÃ© envoyÃ©e' });
    }

    // RÃ©cupÃ©rer les items
    const itemsResult = await pool.query(
      'SELECT * FROM owner_invoice_items WHERE invoice_id = $1 ORDER BY order_index',
      [req.params.id]
    );

    // Mettre Ã  jour statut
    await pool.query(
      'UPDATE owner_invoices SET status = $1, sent_at = NOW() WHERE id = $2',
      ['sent', req.params.id]
    );

    // Envoyer email
    if (invoice.client_email) {
      try {
        await sendOwnerInvoiceEmail({
          invoiceNumber: invoice.invoice_number,
          clientName: invoice.client_name,
          clientEmail: invoice.client_email,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
          totalTtc: invoice.total_ttc,
          items: itemsResult.rows,
          userCompany: user.company,
          userEmail: user.email
        });
      } catch (emailErr) {
        console.error('Erreur envoi email:', emailErr);
      }
    }

    res.json({ success: true, message: 'Facture envoyÃ©e' });

  } catch (err) {
    console.error('Erreur envoi facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// MARQUER UNE FACTURE COMME ENCAISSÃ‰E
app.post('/api/owner-invoices/:id/mark-paid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const invoiceId = req.params.id;

    // RÃ©cupÃ©rer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    const invoice = result.rows[0];

    if (invoice.status === 'draft') {
      return res.status(400).json({ error: 'Vous devez d\'abord valider cette facture.' });
    }

    // Marquer comme payÃ©e (sans paid_at)
    const updateResult = await pool.query(
      `UPDATE owner_invoices
       SET status = 'paid'
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [invoiceId, user.id]
    );

    res.json({ success: true, invoice: updateResult.rows[0] });
  } catch (err) {
    console.error('Erreur marquage facture payÃ©e:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// AVOIRS
// ============================================

// 9. CRÃ‰ER UN AVOIR
app.post('/api/owner-credit-notes', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    await client.query('BEGIN');

    const { invoiceId, reason } = req.body;

    // RÃ©cupÃ©rer la facture d'origine
    const invoiceResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (invoiceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture non trouvÃ©e' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'sent' && invoice.status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Seules les factures envoyÃ©es peuvent avoir un avoir' });
    }

    // VÃ©rifier qu'il n'y a pas dÃ©jÃ  un avoir
    const existingCredit = await client.query(
      'SELECT id FROM owner_credit_notes WHERE original_invoice_id = $1',
      [invoiceId]
    );

    if (existingCredit.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Un avoir existe dÃ©jÃ  pour cette facture' });
    }

    // GÃ©nÃ©rer numÃ©ro avoir
    const creditNumberResult = await client.query(
      'SELECT get_next_credit_note_number($1) as credit_note_number',
      [user.id]
    );
    const creditNoteNumber = creditNumberResult.rows[0].credit_note_number;

    // CrÃ©er l'avoir (montants nÃ©gatifs)
    const creditResult = await client.query(`
      INSERT INTO owner_credit_notes (
        credit_note_number, user_id, original_invoice_id, original_invoice_number,
        client_id, client_name, client_email,
        subtotal_ht, subtotal_debours, vat_amount, total_ttc,
        reason, status, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING id
    `, [
      creditNoteNumber, user.id, invoiceId, invoice.invoice_number,
      invoice.client_id, invoice.client_name, invoice.client_email,
      -invoice.subtotal_ht, -invoice.subtotal_debours, -invoice.vat_amount, -invoice.total_ttc,
      reason, 'issued'
    ]);

    const creditNoteId = creditResult.rows[0].id;

    // Copier les lignes (nÃ©gatif)
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

    // Mettre Ã  jour facture (lien vers avoir + statut cancelled)
    await client.query(
      'UPDATE owner_invoices SET credit_note_id = $1, status = $2 WHERE id = $3',
      [creditNoteId, 'cancelled', invoiceId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      creditNoteId,
      creditNoteNumber,
      message: 'Avoir crÃ©Ã© et facture annulÃ©e'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur crÃ©ation avoir:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// 10. LISTE DES AVOIRS
app.get('/api/owner-credit-notes', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const result = await pool.query(
      `SELECT * FROM owner_credit_notes 
       WHERE user_id = $1 
       ORDER BY issue_date DESC`,
      [user.id]
    );

    res.json({ creditNotes: result.rows });
  } catch (err) {
    console.error('Erreur liste avoirs:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 11. DÃ‰TAIL AVOIR
app.get('/api/owner-credit-notes/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

    const creditResult = await pool.query(
      'SELECT * FROM owner_credit_notes WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (creditResult.rows.length === 0) {
      return res.status(404).json({ error: 'Avoir non trouvÃ©' });
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
    console.error('Erreur dÃ©tail avoir:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// FIN DES ROUTES V2
// ============================================
// ============================================
// âœ… NOUVEAU : ROUTES POUR LIVRETS D'ACCUEIL
// ============================================
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/api/welcome-books', welcomeRouter);
// ============================================
// ============================================
// NOTES D'INSTALLATION
// ============================================

/*
1. Installer les dÃ©pendances :
   npm install exceljs

2. CrÃ©er le dossier uploads :
   mkdir -p public/uploads/justificatifs

3. Les dÃ©pendances nodemailer et pdfkit sont dÃ©jÃ  installÃ©es
*/
// ============================================
// ROUTES STRIPE - Ã€ AJOUTER DANS server.js
// Copier APRÃˆS les autres routes API, AVANT app.listen()
// ============================================

// Helper : RÃ©cupÃ©rer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par dÃ©faut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

// ============================================
// POST /api/billing/create-checkout-session
// CrÃ©er une session de paiement Stripe
// ============================================
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃ©' });
    }

    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configurÃ©' });
    }

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃ©er la session Stripe Checkout
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
        trial_period_days: 14,
        metadata: {
          userId: user.id,
          plan: plan
        }
      },
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${appUrl}/settings-account.html?tab=subscription&success=true`,
      cancel_url: `${appUrl}/pricing.html?cancelled=true`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur create-checkout-session:', err);
    res.status(500).json({ error: 'Impossible de crÃ©er la session de paiement' });
  }
});

// ============================================
// GET /api/subscription/status
// RÃ©cupÃ©rer le statut d'abonnement de l'utilisateur
// ============================================
app.get('/api/subscription/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const result = await pool.query(
      `SELECT 
        id, status, plan_type, plan_amount,
        trial_start_date, trial_end_date, 
        current_period_end, stripe_subscription_id
      FROM subscriptions 
      WHERE user_id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Aucun abonnement trouvÃ©',
        hasSubscription: false
      });
    }

    const subscription = result.rows[0];
    const now = new Date();

    let daysRemaining = null;
    let isExpiringSoon = false;

    if (subscription.status === 'trial') {
      const trialEnd = new Date(subscription.trial_end_date);
      daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      isExpiringSoon = daysRemaining <= 3 && daysRemaining > 0;
    }

    let displayMessage = '';
    if (subscription.status === 'trial') {
      if (daysRemaining > 0) {
        displayMessage = `${daysRemaining} jour${daysRemaining > 1 ? 's' : ''} d'essai restant${daysRemaining > 1 ? 's' : ''}`;
      } else {
        displayMessage = 'PÃ©riode essai expirÃ©e';
      }
    } else if (subscription.status === 'active') {
      displayMessage = `Abonnement ${subscription.plan_type === 'pro' ? 'Pro' : 'Basic'} actif`;
    } else if (subscription.status === 'expired') {
      displayMessage = 'Abonnement expirÃ©';
    } else if (subscription.status === 'canceled') {
      displayMessage = 'Abonnement annulÃ©';
    }

    res.json({
      hasSubscription: true,
      status: subscription.status,
      planType: subscription.plan_type,
      planAmount: subscription.plan_amount,
      trialEndDate: subscription.trial_end_date,
      currentPeriodEnd: subscription.current_period_end,
      daysRemaining: daysRemaining,
      isExpiringSoon: isExpiringSoon,
      displayMessage: displayMessage,
      stripeSubscriptionId: subscription.stripe_subscription_id
    });

  } catch (err) {
    console.error('Erreur subscription/status:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// POST /api/billing/create-portal-session
// CrÃ©er un lien vers le portail client Stripe
// ============================================
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃ©' });
    }

    // RÃ©cupÃ©rer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouvÃ©' });
    }

    const customerId = result.rows[0].stripe_customer_id;
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃ©er la session du portail
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings-account.html?tab=subscription`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Erreur create-portal-session:', err);
    res.status(500).json({ error: 'Impossible de crÃ©er la session portail' });
  }
});

// ============================================
// POST /api/webhooks/stripe
// Webhook Stripe (Ã©vÃ©nements de paiement)
// ============================================
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
    console.error('Erreur vÃ©rification webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Webhook Stripe reÃ§u:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.userId;
        const plan = session.metadata?.plan || 'basic';

        if (!userId) {
          console.error('userId manquant dans checkout.session.completed');
          break;
        }

        // RÃ©cupÃ©rer la subscription Stripe
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Mettre Ã  jour la base de donnÃ©es
        await pool.query(
          `UPDATE subscriptions 
           SET 
             stripe_subscription_id = $1,
             stripe_customer_id = $2,
             plan_type = $3,
             status = 'trial',
             updated_at = NOW()
           WHERE user_id = $4`,
          [subscriptionId, customerId, plan, userId]
        );

        console.log(`Abonnement crÃ©Ã© pour user ${userId} (plan: ${plan})`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        // DÃ©terminer le statut
        let status = 'active';
        if (subscription.status === 'trialing') status = 'trial';
        else if (subscription.status === 'canceled') status = 'canceled';
        else if (subscription.status === 'past_due') status = 'past_due';

        // Mettre Ã  jour en base
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = $1,
             current_period_end = to_timestamp($2),
             updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscriptionId]
        );

        console.log(`Abonnement ${subscriptionId} mis Ã  jour: ${status}`);
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

        console.log(`Abonnement ${subscriptionId} annulÃ©`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        // Passer de trial Ã  active si c'Ã©tait le premier paiement
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = 'active',
             updated_at = NOW()
           WHERE stripe_subscription_id = $1 AND status = 'trial'`,
          [subscriptionId]
        );

        console.log(`Paiement rÃ©ussi pour subscription ${subscriptionId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        await pool.query(
          `UPDATE subscriptions 
           SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`Paiement Ã©chouÃ© pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Ã‰vÃ©nement non gÃ©rÃ©: ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Erreur traitement webhook:', err);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

// ============================================
// FIN DES ROUTES STRIPE
// ============================================
// ============================================
// SCRIPT CRON : ENVOI AUTOMATIQUE DES EMAILS
// Ã€ AJOUTER DANS server.js
// ============================================

// ============================================
// CRON JOB : VÃ©rifier et envoyer les emails automatiques
// S'exÃ©cute toutes les heures
// ============================================
cron.schedule('0 * * * *', async () => {
  console.log('ðŸ”„ VÃ©rification des emails automatiques Ã  envoyer...');
  
  try {
    // RÃ©cupÃ©rer tous les utilisateurs avec leur abonnement
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
        // EMAIL 1 : BIENVENUE (si jamais envoyÃ©)
        // ============================================
        const welcomeSent = await hasEmailBeenSent(user.user_id, 'welcome');
        if (!welcomeSent && user.status === 'trial') {
          await sendWelcomeEmail(user.email, user.first_name || 'cher membre');
          await logEmailSent(user.user_id, 'welcome', { email: user.email });
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
            // VÃ©rifier si un email de rappel a Ã©tÃ© envoyÃ© pour cette pÃ©riode
            const renewalKey = `renewal_reminder_${periodEnd.toISOString().split('T')[0]}`;
            const renewalSent = await hasEmailBeenSent(user.user_id, renewalKey);
            
            if (!renewalSent) {
              const planAmount = user.plan_type === 'pro' ? 899 : 599;
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

    console.log('âœ… VÃ©rification des emails automatiques terminÃ©e');

  } catch (err) {
    console.error('âŒ Erreur cron emails automatiques:', err);
  }
});

console.log('â° TÃ¢che CRON emails automatiques activÃ©e (toutes les heures)');

// ============================================
// MODIFIER LE WEBHOOK : ENVOYER EMAIL CONFIRMATION
// ============================================
// Dans le case 'checkout.session.completed' de votre webhook,
// ajoutez ceci aprÃ¨s la mise Ã  jour de la base de donnÃ©es :

/*
case 'checkout.session.completed': {
  // ... votre code existant ...
  
  await pool.query(...); // Mise Ã  jour de la base

  // âœ… AJOUTER ICI : Envoyer email de confirmation
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

  console.log(`âœ… Abonnement ACTIF crÃ©Ã© pour user ${userId} (plan: ${plan})`);
  break;
}
*/

// ============================================
// FIN DU SCRIPT CRON
// ============================================

// Route pour supprimer une rÃ©servation manuelle ou un blocage
app.post('/api/manual-reservations/delete', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('âŒ Suppression refusÃ©e : utilisateur non authentifiÃ©');
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { propertyId, uid } = req.body || {};
    console.log('ðŸ—‘ Demande de suppression manuelle reÃ§ue :', {
      userId: user.id,
      propertyId,
      uid
    });

    if (!propertyId || !uid) {
      console.log('âŒ RequÃªte invalide pour suppression : propertyId ou uid manquant', {
        propertyId,
        uid
      });
      return res.status(400).json({ error: 'propertyId et uid sont requis' });
    }

    const property = PROPERTIES.find(
      (p) => p.id === propertyId && p.userId === user.id
    );
    if (!property) {
      console.log('âŒ Logement non trouvÃ© pour suppression', {
        propertyId,
        userId: user.id
      });
      return res.status(404).json({ error: 'Logement non trouvÃ©' });
    }

    if (!MANUAL_RESERVATIONS[propertyId] || MANUAL_RESERVATIONS[propertyId].length === 0) {
      console.log('âŒ Aucune rÃ©servation/blocage trouvÃ© pour ce logement', {
        propertyId,
        uid
      });
      return res.status(404).json({ error: 'RÃ©servation/blocage non trouvÃ©' });
    }

    const initialLength = MANUAL_RESERVATIONS[propertyId].length;
    MANUAL_RESERVATIONS[propertyId] =
      MANUAL_RESERVATIONS[propertyId].filter((r) => r.uid !== uid);
    const newLength = MANUAL_RESERVATIONS[propertyId].length;

    console.log('ðŸ“Š Suppression dans MANUAL_RESERVATIONS :', {
      propertyId,
      uid,
      initialLength,
      newLength
    });

    if (initialLength === newLength) {
      console.log(
        'âŒ Aucune entrÃ©e supprimÃ©e (uid non trouvÃ© dans MANUAL_RESERVATIONS)',
        { propertyId, uid }
      );
      return res.status(404).json({ error: 'RÃ©servation/blocage non trouvÃ©' });
    }

    await saveManualReservations();
    console.log('ðŸ’¾ MANUAL_RESERVATIONS sauvegardÃ© aprÃ¨s suppression');

    if (reservationsStore.properties[propertyId]) {
      const initialStoreLength = reservationsStore.properties[propertyId].length;
      reservationsStore.properties[propertyId] =
        reservationsStore.properties[propertyId].filter((r) => r.uid !== uid);
      const newStoreLength = reservationsStore.properties[propertyId].length;

      console.log('ðŸ§® reservationsStore mis Ã  jour :', {
        propertyId,
        uid,
        initialStoreLength,
        newStoreLength
      });
    } else {
      console.log(
        'â„¹ï¸ Aucun entry dans reservationsStore pour ce propertyId au moment de la suppression',
        { propertyId }
      );
    }

    res.status(200).json({
      success: true,
      message: 'RÃ©servation/blocage supprimÃ©'
    });
  } catch (err) {
    console.error('Erreur suppression rÃ©servation manuelle:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// DEBUG: vÃ©rifier que les GET fonctionnent et lister les routes chargÃ©es
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
// âœ… ROUTE PUBLIQUE LIVRET D'ACCUEIL (VERSION PREMIUM)
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

        /* GRID INFO CLÃ‰S */
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

        /* LISTES (Restaurants, PiÃ¨ces) */
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
            <div class="info-label">BoÃ®te Ã  clÃ©s</div>
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
            <h4 style="margin:1rem 0 0.5rem 0; color:#64748b;">ðŸ½ï¸ Restaurants</h4>
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
            <h4 style="margin:1.5rem 0 0.5rem 0; color:#64748b;">ðŸ›ï¸ À visiter</h4>
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
    
    res.send(html);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

  } catch (error) {
    console.error('Erreur affichage livret:', error);
    res.status(500).send('Erreur lors de l\'affichage du livret');
  }
});

// ============================================
// DÃ‰MARRAGE (TOUJOURS EN DERNIER)
// ============================================

app.listen(PORT, async () => {
  console.log('');
  console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
  console.log('â•‘   ðŸ  LCC Booking Manager - SystÃ¨me de RÃ©servations    â•‘');
  console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('');
  console.log(`ðŸš€ Serveur dÃ©marrÃ© sur http://localhost:${PORT}`);
  console.log('');

  await initDb();
  // âœ… NOUVEAU : Initialiser les tables livrets d'accueil
  app.locals.pool = pool;
  await initWelcomeBookTables(pool);
  console.log('âœ… Tables welcome_books initialisÃ©es');
  await loadProperties();
    // ✅ NOUVEAU : Charger les réservations depuis PostgreSQL
  await loadReservationsFromDB();
  
  // Migration one-time (à décommenter UNE SEULE FOIS pour migrer)
  // await migrateManualReservationsToPostgres();
  await loadManualReservations();
  // ✅ NOUVEAU : Charger depuis PostgreSQL
  await loadDepositsFromDB();
  
  // Migration one-time (à décommenter UNE SEULE FOIS)
  // await migrateDepositsToPostgres();
  await loadChecklists();

  console.log('Logements configurÃ©s:');
  PROPERTIES.forEach(p => {
    const status = p.icalUrls && p.icalUrls.length > 0 ? 'âœ…' : 'âš ï¸';
    console.log(`  ${status} ${p.name} (${p.icalUrls.length} source${p.icalUrls.length > 1 ? 's' : ''})`);
  });
  console.log('');

  console.log('ðŸ”„ Synchronisation initiale...');
  await syncAllCalendars();

  const syncInterval = parseInt(process.env.SYNC_INTERVAL) || 15;
  cron.schedule(`*/${syncInterval} * * * *`, async () => {
    console.log('');
    console.log('â° Synchronisation automatique programmÃ©e');
    await syncAllCalendars();
  });

  const cleaningPlanHour = parseInt(process.env.CLEANING_PLAN_HOUR || '18', 10); // heure FR (18h par dÃ©faut)
  cron.schedule(`0 ${cleaningPlanHour} * * *`, async () => {
    console.log('');
    console.log(`â° Envoi du planning mÃ©nage quotidien (pour demain) Ã  ${cleaningPlanHour}h`);
    try {
      await sendDailyCleaningPlan();
    } catch (err) {
      console.error('âŒ Erreur lors de lâ€™envoi du planning mÃ©nage quotidien :', err);
    }
  });

  console.log('');
  console.log(`â° Synchronisation automatique: toutes les ${syncInterval} minutes`);
  console.log('');
  console.log('ðŸ“§ Notifications configurÃ©es:', process.env.EMAIL_USER ? 'âœ… OUI' : 'âš ï¸  NON');
  console.log('ðŸ’³ Stripe configurÃ© :', STRIPE_SECRET_KEY ? 'âœ… OUI' : 'âš ï¸  NON (pas de crÃ©ation de cautions possible)');
  console.log('');
});

