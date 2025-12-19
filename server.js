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
// Ã¢Å“â€¦ NOUVEAU : IMPORTS POUR LIVRETS D'ACCUEIL  
// ============================================
const { router: welcomeRouter, initWelcomeBookTables } = require('./routes/welcomeRoutes');
const { generateWelcomeBookHTML } = require('./services/welcomeGenerator');
// ============================================
// ✅ IMPORT DES ROUTES DU CHAT
// ============================================
const { setupChatRoutes } = require('./routes/chat_routes');
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
    // Si BREVO_API_KEY est configurÃƒÂ©, utiliser l'API Brevo
    if (process.env.BREVO_API_KEY) {
      const apiInstance = new brevo.TransactionalEmailsApi();
      apiInstance.authentications['apiKey'].apiKey = process.env.BREVO_API_KEY;
      
      const sendSmtpEmail = new brevo.SendSmtpEmail();
      sendSmtpEmail.subject = mailOptions.subject;
      sendSmtpEmail.htmlContent = mailOptions.html || mailOptions.text;
      sendSmtpEmail.charset = "UTF-8";
      
      // GÃƒÂ©rer l'expÃƒÂ©diteur (CORRIGÃƒâ€°)
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
      
      // GÃƒÂ©rer les destinataires
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
      console.log('Ã¢Å“â€¦ Email envoyÃƒÂ© via Brevo API ÃƒÂ :', mailOptions.to);
      return { success: true };
      
    } else {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â BREVO_API_KEY non configurÃƒÂ©, tentative SMTP...');
      return await smtpTransporter.sendMail(mailOptions);
    }
  } catch (error) {
    console.error('Ã¢ÂÅ’ Erreur envoi email:', error.response?.body || error.message);
    throw error;
  }
}

// CrÃƒÂ©er un objet transporter compatible
const transporter = {
  sendMail: sendEmail,
  verify: () => Promise.resolve(true)
};

// Dossier d'upload pour les photos de logements
// En local : /.../lcc-booking-manager/uploads/properties
// Sur Render : on prÃƒÂ©fÃƒÂ¨re /tmp qui est writable
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
  console.log('Ã°Å¸â€œÂ Dossier uploads initialisÃƒÂ© :', UPLOAD_DIR);
} catch (err) {
  console.error('Ã¢ÂÅ’ Impossible de crÃƒÂ©er le dossier uploads :', UPLOAD_DIR, err);
  // On essaie un dernier fallback dans /tmp
  if (UPLOAD_DIR !== path.join('/tmp', 'uploads', 'properties')) {
    UPLOAD_DIR = path.join('/tmp', 'uploads', 'properties');
    try {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      console.log('Ã°Å¸â€œÂ Dossier uploads fallback :', UPLOAD_DIR);
    } catch (e2) {
      console.error('Ã¢ÂÅ’ Ãƒâ€°chec du fallback pour le dossier uploads :', e2);
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
  console.log('Ã°Å¸â€œÂ Dossier factures PDF initialisÃƒÂ© :', INVOICE_PDF_DIR);
} catch (err) {
  console.error('Ã¢ÂÅ’ Impossible de crÃƒÂ©er le dossier factures PDF :', INVOICE_PDF_DIR, err);
}


// Multer en mÃƒÂ©moire pour envoyer directement ÃƒÂ  Cloudinary
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
    
    console.log('Ã¢ÂÅ’ Fichier rejetÃƒÂ©:', {
      mimetype: file.mimetype,
      extension: fileExtension,
      filename: file.originalname
    });
    
    return cb(new Error('Type de fichier non supportÃƒÂ©. Formats acceptÃƒÂ©s: JPG, PNG, WEBP, GIF'), false);
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
// MIDDLEWARE DE VÃƒâ€°RIFICATION D'ABONNEMENT
// Ãƒâ‚¬ AJOUTER DANS server.js APRÃƒË†S authenticateToken
// ============================================

async function checkSubscription(req, res, next) {
  try {
    const userId = req.user.id;

    // RÃƒÂ©cupÃƒÂ©rer l'abonnement
    const result = await pool.query(
      `SELECT status, trial_end_date, current_period_end
       FROM subscriptions 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Pas d'abonnement trouvÃƒÂ©
      return res.status(403).json({ 
        error: 'Aucun abonnement', 
        subscriptionExpired: true 
      });
    }

    const sub = result.rows[0];
    const now = new Date();

    // VÃƒÂ©rifier si l'abonnement est expirÃƒÂ©
    if (sub.status === 'trial') {
      const trialEnd = new Date(sub.trial_end_date);
      if (now > trialEnd) {
        return res.status(403).json({ 
          error: 'Essai expirÃƒÂ©', 
          subscriptionExpired: true 
        });
      }
    } else if (sub.status === 'active') {
      // L'abonnement actif est valide (gÃƒÂ©rÃƒÂ© par Stripe)
      // On pourrait vÃƒÂ©rifier current_period_end si besoin
    } else if (sub.status === 'expired' || sub.status === 'canceled') {
      return res.status(403).json({ 
        error: 'Abonnement expirÃƒÂ©', 
        subscriptionExpired: true 
      });
    }

    // Abonnement valide, continuer
    next();

  } catch (err) {
    console.error('Erreur vÃƒÂ©rification abonnement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ============================================
// COMMENT UTILISER CE MIDDLEWARE
// ============================================

/*
Pour protÃƒÂ©ger une route, ajoutez le middleware aprÃƒÂ¨s authenticateToken :

AVANT :
app.get('/api/properties', authenticateToken, async (req, res) => {
  // ...
});

APRÃƒË†S :
app.get('/api/properties', authenticateToken, checkSubscription, async (req, res) => {
  // ...
});

Routes ÃƒÂ  protÃƒÂ©ger (exemples) :
- /api/properties
- /api/reservations
- /api/cleaning
- /api/messages
- /api/statistics
- etc.

Routes ÃƒÂ  NE PAS protÃƒÂ©ger :
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

// Init DB : crÃƒÂ©ation tables users + welcome_books + cleaners + user_settings + cleaning_assignments
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

    console.log('Ã¢Å“â€¦ Tables users, welcome_books, cleaners, user_settings & cleaning_assignments OK dans Postgres');
  } catch (err) {
    console.error('Ã¢ÂÅ’ Erreur initDb (Postgres):', err);
    process.exit(1);
  }
}

// ============================================
// NOTIFICATIONS PROPRIÃƒâ€°TAIRES Ã¢â‚¬â€œ EMAIL
// ============================================

let emailTransporter = null;
// Cache des users pour ne pas spammer la base pendant une sync
const notificationUserCache = new Map();

// Valeurs par dÃƒÂ©faut des prÃƒÂ©fÃƒÂ©rences de notifications
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
    console.log('Ã¢Å¡Â Ã¯Â¸Â  Email non configurÃƒÂ© (EMAIL_USER ou EMAIL_PASSWORD manquants)');
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
    // Mode "service" (Gmail, Outlook...) Ã¢â‚¬â€œ compatible avec l'ancien systÃƒÂ¨me
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
    throw new Error('BREVO_API_KEY manquant pour lÃ¢â‚¬â„¢envoi via Brevo');
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
      'Ã¢ÂÅ’ Erreur envoi email via Brevo :',
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

// RÃƒÂ©cupÃƒÂ¨re les prÃƒÂ©fÃƒÂ©rences de notifications pour un utilisateur
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

// Sauvegarde les prÃƒÂ©fÃƒÂ©rences de notifications pour un utilisateur
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
// RÃƒÂ©cupÃƒÂ¨re les assignations de mÃƒÂ©nage pour un utilisateur sous forme de map { propertyId -> cleaner }
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
    // On ignore les cleaners dÃƒÂ©sactivÃƒÂ©s
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
 * Envoie les emails de notifications de nouvelles rÃƒÂ©servations / annulations,
 * en respectant les prÃƒÂ©fÃƒÂ©rences de l'utilisateur.
 * 
 * VERSION CORRIGÃƒâ€°E AVEC LOGS DÃƒâ€°TAILLÃƒâ€°S POUR DEBUGGING WHATSAPP
 */
async function notifyOwnersAboutBookings(newReservations, cancelledReservations) {
  const brevoKey = process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim();
  if (!brevoKey) {
    console.log(
      "Ã¢Å¡Â Ã¯Â¸Â BREVO_API_KEY manquant : aucune notification propriÃƒÂ©taire (nouvelle rÃƒÂ©sa / annulation) ne sera envoyÃƒÂ©e."
    );
    return;
  }

  const from = process.env.EMAIL_FROM || "Boostinghost <no-reply@boostinghost.com>";
  const tasks = [];

  const handleReservation = (res, type) => {
    const userId = res.userId;
    if (!userId) {
      console.log("Ã¢Å¡Â Ã¯Â¸Â  RÃƒÂ©servation sans userId, notification ignorÃƒÂ©e :", res.uid || res.id);
      return;
    }

    tasks.push(
      (async () => {
        const user = await getUserForNotifications(userId);
        if (!user || !user.email) {
          console.log(`Ã¢Å¡Â Ã¯Â¸Â  Aucun email trouvÃƒÂ© pour user ${userId}, notification ignorÃƒÂ©e`);
          return;
        }

        // Ã°Å¸â€â€ RÃƒÂ©cupÃƒÂ©rer les prÃƒÂ©fÃƒÂ©rences de notifications
        let settings;
        try {
          settings = await getNotificationSettings(userId);
          console.log(
            `Ã°Å¸â€œâ€¹ Settings rÃƒÂ©cupÃƒÂ©rÃƒÂ©s pour user ${userId}:`,
            JSON.stringify(settings, null, 2)
          );
        } catch (e) {
          console.error(
            "Erreur lors de la rÃƒÂ©cupÃƒÂ©ration des prÃƒÂ©fÃƒÂ©rences de notifications pour user",
            userId,
            e
          );
          settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
        }

        // Pour l'instant, on utilise la mÃƒÂªme option pour nouvelles rÃƒÂ©sas & annulations
        if (settings && settings.newReservation === false) {
          console.log(
            `Ã¢â€žÂ¹Ã¯Â¸Â Notifications de rÃƒÂ©servations dÃƒÂ©sactivÃƒÂ©es pour user ${userId}, email non envoyÃƒÂ©.`
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
          subject = `Ã°Å¸â€ºÅ½Ã¯Â¸Â Nouvelle rÃƒÂ©servation Ã¢â‚¬â€œ ${propertyName}`;
          textBody = `${hello}

Une nouvelle rÃƒÂ©servation vient d'ÃƒÂªtre enregistrÃƒÂ©e via ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
SÃƒÂ©jour  : du ${start} au ${end}

Vous pouvez retrouver tous les dÃƒÂ©tails dans votre tableau de bord Boostinghost.`;

          htmlBody = `
            <p>${hello}</p>
            <p>Une nouvelle rÃƒÂ©servation vient d'ÃƒÂªtre enregistrÃƒÂ©e via <strong>${source}</strong>.</p>
            <ul>
              <li><strong>Logement :</strong> ${propertyName}</li>
              <li><strong>Voyageur :</strong> ${guest}</li>
              <li><strong>SÃƒÂ©jour :</strong> du ${start} au ${end}</li>
            </ul>
            <p>Vous pouvez retrouver tous les dÃƒÂ©tails dans votre tableau de bord Boostinghost.</p>
          `;
        } else {
          subject = `Ã¢Å¡Â Ã¯Â¸Â RÃƒÂ©servation annulÃƒÂ©e Ã¢â‚¬â€œ ${propertyName}`;
          textBody = `${hello}

Une rÃƒÂ©servation vient d'ÃƒÂªtre annulÃƒÂ©e sur ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
SÃƒÂ©jour initial : du ${start} au ${end}

Pensez ÃƒÂ  vÃƒÂ©rifier votre calendrier et vos blocages si nÃƒÂ©cessaire.`;

          htmlBody = `
            <p>${hello}</p>
            <p>Une rÃƒÂ©servation vient d'ÃƒÂªtre <strong>annulÃƒÂ©e</strong> sur <strong>${source}</strong>.</p>
            <ul>
              <li><strong>Logement :</strong> ${propertyName}</li>
              <li><strong>Voyageur :</strong> ${guest}</li>
              <li><strong>SÃƒÂ©jour initial :</strong> du ${start} au ${end}</li>
            </ul>
            <p>Pensez ÃƒÂ  vÃƒÂ©rifier votre calendrier et vos blocages si nÃƒÂ©cessaire.</p>
          `;
        }

        try {
          // Ã°Å¸â€˜â€° Toujours via l'API Brevo
          console.log("Ã°Å¸â€œÂ§ [Brevo API] Envoi email", type, "ÃƒÂ ", user.email);
          await sendEmailViaBrevo({
            to: user.email,
            subject,
            text: textBody,
            html: htmlBody,
          });

          console.log(
            `Ã°Å¸â€œÂ§ Notification "${type}" envoyÃƒÂ©e ÃƒÂ  ${user.email} (resa uid=${res.uid || res.id})`
          );
        } catch (err) {
          console.error(
            `Ã¢ÂÅ’ Erreur envoi email de notification "${type}" ÃƒÂ  ${user.email} :`,
            err
          );
        }
      })()
    );
  };

  (newReservations || []).forEach((r) => handleReservation(r, "new"));
  (cancelledReservations || []).forEach((r) => handleReservation(r, "cancelled"));

  if (tasks.length === 0) {
    console.log("Ã¢â€žÂ¹Ã¯Â¸Â Aucune notification propriÃƒÂ©taire ÃƒÂ  envoyer (listes vides).");
    return;
  }

  console.log(
    `Ã°Å¸â€œÂ§ Notifications ÃƒÂ  envoyer Ã¢â‚¬â€œ nouvelles: ${newReservations.length || 0}, annulÃƒÂ©es: ${
      cancelledReservations.length || 0
    }`
  );
  await Promise.all(tasks);
}
/**
 * Notifications mÃƒÂ©nage : pour chaque nouvelle rÃƒÂ©servation, si un logement a un cleaner assignÃƒÂ©,
 * on envoie un email + (optionnel) un WhatsApp ÃƒÂ  ce cleaner.
 */
async function notifyCleanersAboutNewBookings(newReservations) {
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      'Ã¢Å¡Â Ã¯Â¸Â  Ni email (Brevo/SMTP) ni WhatsApp configurÃƒÂ©s, aucune notification mÃƒÂ©nage envoyÃƒÂ©e'
    );
    return;
  }

  if (!newReservations || newReservations.length === 0) {
    return;
  }

  const from = process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';
  const tasks = [];

  // On groupe par user, pour ne pas requÃƒÂªter 50 fois la base
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
      console.error('Erreur rÃƒÂ©cupÃƒÂ©ration assignations mÃƒÂ©nage pour user', userId, err);
      continue;
    }

    if (!assignmentsMap || Object.keys(assignmentsMap).length === 0) {
      continue;
    }

    for (const res of userReservations) {
      const assignment = assignmentsMap[res.propertyId];
      if (!assignment) {
        // Aucun cleaner assignÃƒÂ© ÃƒÂ  ce logement Ã¢â€ â€™ rien ÃƒÂ  envoyer
        continue;
      }

      const cleanerEmail = assignment.email;
      const cleanerPhone = assignment.phone;
      const cleanerName  = assignment.name || 'partenaire mÃƒÂ©nage';

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
        const subject = `Ã°Å¸Â§Â¹ Nouveau mÃƒÂ©nage ÃƒÂ  prÃƒÂ©voir Ã¢â‚¬â€œ ${propertyName}`;
        const textBody = `${hello}

Un nouveau sÃ©jour vient dÃ¢â‚¬â„¢ÃƒÂªtre rÃƒÂ©servÃƒÂ© pour le logement ${propertyName}.

Voyageur : ${guest}
SÃƒÂ©jour  : du ${start} au ${end}
MÃƒÂ©nage ÃƒÂ  prÃƒÂ©voir : le ${end} aprÃƒÂ¨s le dÃƒÂ©part des voyageurs
(heure exacte de check-out ÃƒÂ  confirmer avec la conciergerie).

Merci beaucoup,
L'ÃƒÂ©quipe Boostinghost`;

        const htmlBody = `
          <p>${hello}</p>
          <p>Un nouveau sÃ©jour vient dÃ¢â‚¬â„¢ÃƒÂªtre rÃƒÂ©servÃƒÂ© pour le logement <strong>${propertyName}</strong>.</p>
          <ul>
            <li><strong>Voyageur :</strong> ${guest}</li>
            <li><strong>SÃƒÂ©jour :</strong> du ${start} au ${end}</li>
            <li><strong>MÃƒÂ©nage ÃƒÂ  prÃƒÂ©voir :</strong> le ${end} aprÃƒÂ¨s le dÃƒÂ©part des voyageurs</li>
          </ul>
          <p style="font-size:13px;color:#6b7280;">
            Heure exacte de check-out ÃƒÂ  confirmer avec la conciergerie.
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
                `Ã°Å¸â€œÂ§ Notification mÃƒÂ©nage envoyÃƒÂ©e ÃƒÂ  ${cleanerEmail} (resa uid=${res.uid || res.id})`
              );
            })
            .catch((err) => {
              console.error('Ã¢ÂÅ’ Erreur envoi email notification mÃƒÂ©nage :', err);
            })
        );
      }
    }
  }

  await Promise.all(tasks);
}
/**
 * Envoie chaque jour un planning de mÃƒÂ©nage pour "demain"
 * ÃƒÂ  chaque cleaner assignÃƒÂ© (email + WhatsApp si dispo).
 */
async function sendDailyCleaningPlan() {
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      'Ã¢Å¡Â Ã¯Â¸Â  Ni email (Brevo/SMTP) ni WhatsApp configurÃƒÂ©s, planning mÃƒÂ©nage non envoyÃƒÂ©'
    );
    return;
  }

  if (!PROPERTIES || !Array.isArray(PROPERTIES) || PROPERTIES.length === 0) {
    console.log('Ã¢â€žÂ¹Ã¯Â¸Â Aucun logement configurÃƒÂ©, pas de planning mÃƒÂ©nage ÃƒÂ  envoyer.');
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

  // 2) Construire tÃƒÂ¢ches par cleaner
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
      if (endIso !== tomorrowIso) continue; // checkout pas demain Ã¢â€ â€™ ignore

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
const subject = `Ã°Å¸Â§Â¹ Planning mÃƒÂ©nage Ã¢â‚¬â€œ ${tomorrowIso}`;

if ((useBrevo || transporter) && cleanerEmail) {
  // Construction du textBody
  let textBody = `${hello}\n\nPlanning mÃƒÂ©nage de demain (${tomorrowIso}):\n\n`;
  jobs.forEach((job, index) => {
    textBody += `${index + 1}. ${job.propertyName} Ã¢â‚¬â€œ dÃƒÂ©part le ${job.end} (${job.guestName})\n`;
  });
  textBody += '\nMerci beaucoup,\nL\'ÃƒÂ©quipe Boostinghost';

  // Construction du htmlBody
  let htmlBody = `<p>${hello}</p><p>Planning mÃƒÂ©nage de demain (${tomorrowIso}):</p><ul>`;
  jobs.forEach((job) => {
    htmlBody += `<li><strong>${job.propertyName}</strong> Ã¢â‚¬â€œ dÃƒÂ©part le ${job.end} (${job.guestName})</li>`;
  });
  htmlBody += `</ul><p>Merci beaucoup,<br>L'ÃƒÂ©quipe Boostinghost</p>`;

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
          `Ã°Å¸â€œÂ§ Planning mÃƒÂ©nage envoyÃƒÂ© ÃƒÂ  ${cleanerEmail} pour ${tomorrowIso}`
        );
      })
      .catch((err) => {
        console.error('Ã¢ÂÅ’ Erreur envoi planning mÃƒÂ©nage (email) :', err);
      })
  );
  }
    // WhatsApp
  });

  await Promise.all(tasks);

  console.log('Ã¢Å“â€¦ Planning mÃƒÂ©nage quotidien envoyÃƒÂ© (si tÃƒÂ¢ches dÃƒÂ©tectÃƒÂ©es).');
}

// ============================================
// APP / STRIPE / STORE
// ============================================

const app = express();

// Ã¢Å“â€¦ Healthcheck (pour vÃƒÂ©rifier que Render sert bien CE serveur)
app.get('/api/health', (req, res) => res.status(200).send('ok-health'));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
const PORT = process.env.PORT || 3000;


// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;

// Ã¢Å“â€¦ WEBHOOK STRIPE (AVANT LES AUTRES MIDDLEWARES)
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

  console.log('Ã¢Å“â€¦ Webhook Stripe reÃƒÂ§u:', event.type);

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

  console.log(`Ã¢Å“â€¦ Abonnement ACTIF crÃƒÂ©ÃƒÂ© pour user ${userId} (plan: ${plan})`);
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

        console.log(`Ã¢Å“â€¦ Abonnement ${subscriptionId} mis ÃƒÂ  jour: ${status}`);
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

        console.log(`Ã¢Å“â€¦ Abonnement ${subscriptionId} annulÃƒÂ©`);
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

        console.log(`Ã¢Å“â€¦ Paiement rÃƒÂ©ussi pour subscription ${subscriptionId}`);
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

        console.log(`Ã¢ÂÅ’ Paiement ÃƒÂ©chouÃƒÂ© pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Ãƒâ€°vÃƒÂ©nement non gÃƒÂ©rÃƒÂ©: ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Ã¢ÂÅ’ Erreur traitement webhook:', err);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
// Force UTF-8 pour toutes les réponses JSON
app.use((req, res, next) => {
res.charset = 'utf-8';
next();
});

// Store for reservations (en mÃƒÂ©moire)
let reservationsStore = {
  properties: {},
  lastSync: null,
  syncStatus: 'idle'
};

// Fichiers locaux pour certains stocks
const MANUAL_RES_FILE = path.join(__dirname, 'manual-reservations.json');
const DEPOSITS_FILE = path.join(__dirname, 'deposits-config.json');

// âœ… V1 Checklists (JSON)
const CHECKLISTS_FILE = path.join(__dirname, 'checklists.json');
let CHECKLISTS = {}; // { [reservationUid]: { reservationUid, propertyId, userId, status, tasks, createdAt, updatedAt } }


// Data en mÃƒÂ©moire
let MANUAL_RESERVATIONS = {};    // { [propertyId]: [reservations ou blocages] }
let DEPOSITS = [];               // { id, reservationUid, amountCents, ... }

// ============================================
// FONCTIONS UTILITAIRES FICHIERS
// ============================================

async function loadManualReservations() {
  try {
    const data = await fsp.readFile(MANUAL_RES_FILE, 'utf8');
    MANUAL_RESERVATIONS = JSON.parse(data);
    console.log('Ã¢Å“â€¦ RÃƒÂ©servations manuelles chargÃƒÂ©es depuis manual-reservations.json');
  } catch (error) {
    MANUAL_RESERVATIONS = {};
    console.log('Ã¢Å¡Â Ã¯Â¸Â  Aucun fichier manual-reservations.json, dÃƒÂ©marrage sans rÃƒÂ©servations manuelles');
  }
}

async function saveManualReservations() {
  try {
    await fsp.writeFile(MANUAL_RES_FILE, JSON.stringify(MANUAL_RESERVATIONS, null, 2));
    console.log('Ã¢Å“â€¦ RÃƒÂ©servations manuelles sauvegardÃƒÂ©es');
  } catch (error) {
    console.error('Ã¢ÂÅ’ Erreur lors de la sauvegarde des rÃƒÂ©servations manuelles:', error.message);
  }
}

async function loadDeposits() {
  try {
    const data = await fsp.readFile(DEPOSITS_FILE, 'utf8');
    DEPOSITS = JSON.parse(data);
    console.log('Ã¢Å“â€¦ Cautions chargÃƒÂ©es depuis deposits-config.json');
  } catch (error) {
    DEPOSITS = [];
    console.log('Ã¢Å¡Â Ã¯Â¸Â  Aucun fichier deposits-config.json, dÃƒÂ©marrage sans cautions');
  }
}

async function saveDeposits() {
  try {
    await fsp.writeFile(DEPOSITS_FILE, JSON.stringify(DEPOSITS, null, 2));
    console.log('Ã¢Å“â€¦ Cautions sauvegardÃƒÂ©es');
  } catch (error) {
    console.error('Ã¢ÂÅ’ Erreur lors de la sauvegarde des cautions:', error.message);
  }
}

// ============================================
// âœ… CHECKLISTS (V1 - JSON) - Stockage simple, migrable en SQL plus tard
// ============================================

async function loadChecklists() {
  try {
    const data = await fsp.readFile(CHECKLISTS_FILE, 'utf8');
    CHECKLISTS = JSON.parse(data);
    console.log('âœ… Checklists chargÃ©es depuis checklists.json');
  } catch (e) {
    CHECKLISTS = {};
    console.log('â„¹ï¸ Aucun fichier checklists.json, dÃ©marrage sans checklists');
  }
}

async function saveChecklists() {
  try {
    await fsp.writeFile(CHECKLISTS_FILE, JSON.stringify(CHECKLISTS, null, 2));
  } catch (e) {
    console.error('âŒ Erreur saveChecklists:', e);
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
      { id: 't1', title: 'Logement prÃªt (mÃ©nage)', completed: false },
      { id: 't2', title: 'Linge propre installÃ©', completed: false },
      { id: 't3', title: 'AccÃ¨s / clÃ©s vÃ©rifiÃ©s', completed: false },
      { id: 't4', title: "Heure d'arrivÃ©e confirmÃ©e", completed: false },
      { id: 't5', title: "Message d'arrivÃ©e prÃ©parÃ©", completed: false },
      { id: 't6', title: 'Message de dÃ©part prÃ©parÃ©', completed: false },
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
// âœ… RISK ENGINE V1 (opÃ©rationnel + usage intensif)
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

  // 1) OPÃ‰RATIONNEL (cap 60)
  let arrivalPts = 0;
  if (hoursUntilArrival <= 24) { arrivalPts = 45; tags.push('ArrivÃ©e â‰¤ 24h'); }
  else if (hoursUntilArrival <= 48) { arrivalPts = 30; tags.push('ArrivÃ©e â‰¤ 48h'); }
  else if (hoursUntilArrival <= 72) { arrivalPts = 20; tags.push('ArrivÃ©e â‰¤ 72h'); }

  let checklistPts = 0;
  if (input.checklistStatus === 'none') { checklistPts = 30; tags.push('Checklist inexistante'); }
  else if (input.checklistStatus === 'incomplete') { checklistPts = 25; tags.push('Checklist incomplÃ¨te'); }

  const sensitivePts = input.propertySensitive ? 10 : 0;
  if (input.propertySensitive) tags.push('Logement sensible');

  let stayLongPts = 0;
  if (nights >= 14) { stayLongPts = 25; tags.push('SÃ©jour â‰¥ 14 nuits'); }
  else if (nights >= 7) { stayLongPts = 15; tags.push('SÃ©jour â‰¥ 7 nuits'); }

  let depositPts = 0;
  if (channel !== 'airbnb') {
    if (input.depositStatus === 'missing') { depositPts = 40; tags.push('Garantie absente'); }
    else if (input.depositStatus === 'created_pending') { depositPts = 20; tags.push('Garantie Ã  valider'); }
  }

  let turnoverPts = 0;
  if (typeof input.turnoverHoursBefore === 'number') {
    if (input.turnoverHoursBefore < 6) { turnoverPts = 20; tags.push('Turnover < 6h'); }
    else if (input.turnoverHoursBefore < 12) { turnoverPts = 10; tags.push('Turnover < 12h'); }
  }

  let lateArrivalPts = 0;
  if (typeof input.expectedCheckinHour === 'number' && input.expectedCheckinHour >= 22) {
    lateArrivalPts = 10; tags.push('ArrivÃ©e tardive');
  }

  let staleIcalPts = 0;
  if (input.lastIcalSyncAt) {
    const hSinceSync = hoursBetween(input.lastIcalSyncAt, now);
    if (hSinceSync >= 48) { staleIcalPts = 15; tags.push('Sync iCal > 48h'); }
  }

  const operational = clamp(arrivalPts + checklistPts + sensitivePts + stayLongPts + depositPts + turnoverPts + lateArrivalPts + staleIcalPts, 0, 60);

  // 2) USAGE INTENSIF (cap 40)
  let patternPts = 0;

  if (nights === 1) { patternPts += 20; tags.push('SÃ©jour 1 nuit'); }
  else if (nights === 2) { patternPts += 10; tags.push('SÃ©jour 2 nuits'); }

  if (isWeekendArrival(start)) { patternPts += 15; tags.push('Week-end'); }

  if (input.bookedAt) {
    const hoursBetweenBookingAndArrival = hoursBetween(input.bookedAt, start);
    if (hoursBetweenBookingAndArrival <= 24) { patternPts += 25; tags.push('RÃ©servation < 24h'); }
    else if (hoursBetweenBookingAndArrival <= 72) { patternPts += 15; tags.push('RÃ©servation < 72h'); }
  }

  if (input.propertyType === 'entire') { patternPts += 10; tags.push('Logement entier'); }
  if ((input.capacity ?? 0) >= 4) { patternPts += 10; tags.push('CapacitÃ© â‰¥ 4'); }

  const { isHoliday, isHolidayEve } = isFrenchHolidayOrEve(start);
  if (isHoliday) { patternPts += 20; tags.push('Jour fÃ©riÃ©'); }
  if (isHolidayEve) { patternPts += 20; tags.push('Veille jour fÃ©riÃ©'); }
  if (isSensitiveDate(start)) { patternPts += 25; tags.push('Date sensible'); }

  const stayPattern = clamp(patternPts, 0, 40);

  // 3) GLOBAL + couleur
  const score = clamp(operational + stayPattern, 0, 100);
  let level = 'green';
  if (score >= 61) level = 'red';
  else if (score >= 31) level = 'orange';

  const uniqueTags = [...new Set(tags)];
  const label = (level === 'red') ? 'Risque Ã©levÃ©' : (level === 'orange') ? 'Ã€ surveiller' : 'OK';
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

// Cherche l'utilisateur en base ÃƒÂ  partir du token dans Authorization: Bearer
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
// Ãƒâ‚¬ COPIER-COLLER APRÃƒË†S LA FONCTION getUserFromRequest
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
// PROPERTIES (logements) - stockÃƒÂ©es en base
// ============================================

// PROPERTIES est crÃƒÂ©ÃƒÂ© par affectation dans loadProperties (variable globale implicite)
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
        owner_id,
        display_order
      FROM properties
      ORDER BY display_order ASC, created_at ASC
    `);
    PROPERTIES = result.rows.map(row => {
      // Ã¢Å“â€¦ Parser ical_urls si c'est une string JSON
      let icalUrls = row.ical_urls || [];
      if (typeof icalUrls === 'string') {
        try {
          icalUrls = JSON.parse(icalUrls);
        } catch (e) {
          console.error(`Ã¢ÂÅ’ Erreur parse ical_urls pour ${row.name}:`, e.message);
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
    console.log(`Ã¢Å“â€¦ PROPERTIES chargÃƒÂ©es : ${PROPERTIES.length} logements`); 
  } catch (error) {
    console.error('Ã¢ÂÅ’ Erreur loadProperties :', error);
    PROPERTIES = [];
  }
}

function getUserProperties(userId) {
  return PROPERTIES.filter(p => p.userId === userId);
}
// ============================================
// CODE COMPLET Ã€ AJOUTER DANS server-23.js
// ============================================
// Position : AprÃ¨s la fonction getUserProperties() (ligne ~1619)

// Variable globale pour cache en mÃ©moire (performance)
let RESERVATIONS_CACHE = {}; // { [propertyId]: [reservations] }

/**
 * Charger toutes les rÃ©servations depuis PostgreSQL
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

    console.log(`âœ… RÃ©servations chargÃ©es : ${result.rows.length} rÃ©servations`);
    
    reservationsStore.properties = RESERVATIONS_CACHE;
    reservationsStore.lastSync = new Date().toISOString();
    
  } catch (error) {
    console.error('âŒ Erreur loadReservationsFromDB:', error);
    RESERVATIONS_CACHE = {};
  }
}

/**
 * Sauvegarder une rÃ©servation en base
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
    console.error('âŒ Erreur saveReservationToDB:', error);
    return false;
  }
}

/**
 * Sauvegarder toutes les rÃ©servations d'une propriÃ©tÃ© (aprÃ¨s synchro iCal)
 */
async function savePropertyReservations(propertyId, reservations, userId) {
  try {
    for (const reservation of reservations) {
      await saveReservationToDB(reservation, propertyId, userId);
    }
    console.log(`âœ… ${reservations.length} rÃ©servations sauvegardÃ©es pour ${propertyId}`);
    return true;
  } catch (error) {
    console.error('âŒ Erreur savePropertyReservations:', error);
    return false;
  }
}

/**
 * Supprimer une rÃ©servation (soft delete)
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
    console.error('âŒ Erreur deleteReservationFromDB:', error);
    return false;
  }
}

/**
 * RÃ©cupÃ©rer les rÃ©servations d'un utilisateur
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
    console.error('âŒ Erreur getUserReservations:', error);
    return [];
  }
}

/**
 * Migrer les rÃ©servations du JSON vers PostgreSQL (une seule fois)
 */
async function migrateManualReservationsToPostgres() {
  try {
    console.log('ðŸ”„ Migration des rÃ©servations manuelles vers PostgreSQL...');
    
    let migratedCount = 0;
    
    for (const [propertyId, reservations] of Object.entries(MANUAL_RESERVATIONS)) {
      const property = PROPERTIES.find(p => p.id === propertyId);
      if (!property) {
        console.log(`âš ï¸  PropriÃ©tÃ© ${propertyId} introuvable, skip`);
        continue;
      }

      for (const reservation of reservations) {
        const success = await saveReservationToDB(reservation, propertyId, property.userId);
        if (success) migratedCount++;
      }
    }

    console.log(`âœ… Migration terminÃ©e : ${migratedCount} rÃ©servations migrÃ©es`);
    
    // Backup du fichier JSON
    const backupFile = MANUAL_RES_FILE.replace('.json', '.backup.json');
    await fsp.rename(MANUAL_RES_FILE, backupFile);
    console.log(`ðŸ“¦ Backup crÃ©Ã© : ${backupFile}`);
    
  } catch (error) {
    console.error('âŒ Erreur migration:', error);
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
    
    // Mettre Ã  jour le cache
    RESERVATIONS_CACHE[property.id] = reservations;
    reservationsStore.properties[property.id] = reservations;
    
    return reservations;
  } catch (error) {
    console.error(`âŒ Erreur synchro ${property.name}:`, error);
    return [];
  }
}
// ============================================
// GESTION DES DEPOSITS (CAUTIONS) EN POSTGRESQL
// ============================================
// Ã€ ajouter dans server-23.js aprÃ¨s les fonctions des rÃ©servations

// Variable globale pour cache en mÃ©moire
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

    // Reconstruire DEPOSITS pour compatibilitÃ© avec le code existant
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

    // CrÃ©er un cache indexÃ© par reservation_uid
    DEPOSITS_CACHE = {};
    result.rows.forEach(row => {
      DEPOSITS_CACHE[row.reservation_uid] = row;
    });

    console.log(`âœ… Deposits chargÃ©s : ${result.rows.length} cautions`);
    
  } catch (error) {
    console.error('âŒ Erreur loadDepositsFromDB:', error);
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

    console.log(`âœ… Deposit ${deposit.id} sauvegardÃ© en PostgreSQL`);
    return true;
  } catch (error) {
    console.error('âŒ Erreur saveDepositToDB:', error);
    return false;
  }
}

/**
 * Mettre Ã  jour le statut d'un deposit
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

    console.log(`âœ… Deposit ${depositId} mis Ã  jour : ${status}`);
    return true;
  } catch (error) {
    console.error('âŒ Erreur updateDepositStatus:', error);
    return false;
  }
}

/**
 * RÃ©cupÃ©rer un deposit par reservation_uid
 */
async function getDepositByReservation(reservationUid) {
  try {
    const result = await pool.query(`
      SELECT * FROM deposits WHERE reservation_uid = $1 LIMIT 1
    `, [reservationUid]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('âŒ Erreur getDepositByReservation:', error);
    return null;
  }
}

/**
 * RÃ©cupÃ©rer tous les deposits d'un utilisateur
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
    console.error('âŒ Erreur getUserDeposits:', error);
    return [];
  }
}

/**
 * Migrer les deposits du JSON vers PostgreSQL (une seule fois)
 */
async function migrateDepositsToPostgres() {
  try {
    console.log('ðŸ”„ Migration des deposits vers PostgreSQL...');
    
    let migratedCount = 0;
    
    for (const deposit of DEPOSITS) {
      // Trouver la rÃ©servation pour rÃ©cupÃ©rer user_id et property_id
      const reservation = await pool.query(`
        SELECT user_id, property_id FROM reservations WHERE uid = $1
      `, [deposit.reservationUid]);

      if (reservation.rows.length === 0) {
        console.log(`âš ï¸  RÃ©servation ${deposit.reservationUid} introuvable pour deposit ${deposit.id}`);
        continue;
      }

      const { user_id, property_id } = reservation.rows[0];
      
      const success = await saveDepositToDB(deposit, user_id, property_id);
      if (success) migratedCount++;
    }

    console.log(`âœ… Migration terminÃ©e : ${migratedCount} deposits migrÃ©s`);
    
    // Backup du fichier JSON
    const backupFile = DEPOSITS_FILE.replace('.json', '.backup.json');
    await fsp.rename(DEPOSITS_FILE, backupFile);
    console.log(`ðŸ“¦ Backup crÃ©Ã© : ${backupFile}`);
    
  } catch (error) {
    console.error('âŒ Erreur migration deposits:', error);
  }
}

/**
 * Capturer une caution (dÃ©biter le client)
 */
async function captureDeposit(depositId, amountCents = null) {
  try {
    const deposit = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
    
    if (deposit.rows.length === 0) {
      throw new Error('Deposit introuvable');
    }

    const depositData = deposit.rows[0];
    
    if (!depositData.stripe_payment_intent_id) {
      throw new Error('Pas de Payment Intent associÃ©');
    }

    // Capturer via Stripe
    const capture = await stripe.paymentIntents.capture(
      depositData.stripe_payment_intent_id,
      amountCents ? { amount_to_capture: amountCents } : {}
    );

    // Mettre Ã  jour en base
    await updateDepositStatus(depositId, 'captured', {
      stripeChargeId: capture.charges.data[0]?.id
    });

    return true;
  } catch (error) {
    console.error('âŒ Erreur captureDeposit:', error);
    return false;
  }
}

/**
 * LibÃ©rer une caution (annuler l'autorisation)
 */
async function releaseDeposit(depositId) {
  try {
    const deposit = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
    
    if (deposit.rows.length === 0) {
      throw new Error('Deposit introuvable');
    }

    const depositData = deposit.rows[0];
    
    if (!depositData.stripe_payment_intent_id) {
      throw new Error('Pas de Payment Intent associÃ©');
    }

    // Annuler via Stripe
    await stripe.paymentIntents.cancel(depositData.stripe_payment_intent_id);

    // Mettre Ã  jour en base
    await updateDepositStatus(depositId, 'released');

    return true;
  } catch (error) {
    console.error('âŒ Erreur releaseDeposit:', error);
    return false;
  }
}
// ============================================
// GESTION DES CHECKLISTS EN POSTGRESQL
// ============================================
// Ã€ ajouter dans server-23.js aprÃ¨s les fonctions des deposits

/**
 * CrÃ©er une checklist
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

    console.log(`âœ… Checklist crÃ©Ã©e : ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('âŒ Erreur createChecklist:', error);
    return null;
  }
}

/**
 * Mettre Ã  jour une tÃ¢che dans une checklist
 */
async function updateChecklistTask(checklistId, taskId, updates) {
  try {
    // RÃ©cupÃ©rer la checklist
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
      throw new Error('TÃ¢che introuvable');
    }

    // Mettre Ã  jour la tÃ¢che
    tasks[taskIndex] = {
      ...tasks[taskIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // Recalculer la progression
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // DÃ©terminer le statut
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

    console.log(`âœ… TÃ¢che mise Ã  jour : ${taskId} dans checklist ${checklistId}`);
    return result.rows[0];
  } catch (error) {
    console.error('âŒ Erreur updateChecklistTask:', error);
    return null;
  }
}

/**
 * RÃ©cupÃ©rer les checklists d'un utilisateur
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
    console.error('âŒ Erreur getUserChecklists:', error);
    return [];
  }
}

/**
 * RÃ©cupÃ©rer une checklist par ID
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
    console.error('âŒ Erreur getChecklistById:', error);
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
    
    console.log(`âœ… Checklist supprimÃ©e : ${checklistId}`);
    return true;
  } catch (error) {
    console.error('âŒ Erreur deleteChecklist:', error);
    return false;
  }
}

/**
 * CrÃ©er un template de checklist
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

    console.log(`âœ… Template crÃ©Ã© : ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('âŒ Erreur createChecklistTemplate:', error);
    return null;
  }
}

/**
 * RÃ©cupÃ©rer les templates d'un utilisateur
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
    console.error('âŒ Erreur getUserChecklistTemplates:', error);
    return [];
  }
}

/**
 * CrÃ©er une checklist depuis un template
 */
async function createChecklistFromTemplate(userId, templateId, data) {
  try {
    // RÃ©cupÃ©rer le template
    const template = await pool.query(
      'SELECT * FROM checklist_templates WHERE id = $1 AND user_id = $2',
      [templateId, userId]
    );

    if (template.rows.length === 0) {
      throw new Error('Template introuvable');
    }

    const templateData = template.rows[0];
    
    // GÃ©nÃ©rer des IDs uniques pour les tÃ¢ches
    const tasks = templateData.tasks.map(task => ({
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      completed: false,
      completedAt: null,
      completedBy: null
    }));

    // CrÃ©er la checklist
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
    console.error('âŒ Erreur createChecklistFromTemplate:', error);
    return null;
  }
}

/**
 * GÃ©nÃ©rer automatiquement des checklists pour une rÃ©servation
 */
async function generateChecklistsForReservation(userId, reservationUid) {
  try {
    // RÃ©cupÃ©rer la rÃ©servation
    const reservation = await pool.query(
      'SELECT * FROM reservations WHERE uid = $1 AND user_id = $2',
      [reservationUid, userId]
    );

    if (reservation.rows.length === 0) {
      throw new Error('RÃ©servation introuvable');
    }

    const res = reservation.rows[0];
    
    const checklists = [];

    // Checklist d'arrivÃ©e (J-1)
    const arrivalDueDate = new Date(res.start_date);
    arrivalDueDate.setDate(arrivalDueDate.getDate() - 1);

    const arrivalChecklist = await createChecklist(userId, {
      propertyId: res.property_id,
      reservationUid,
      checklistType: 'arrival',
      title: `PrÃ©paration arrivÃ©e - ${res.guest_name || 'Client'}`,
      tasks: [
        { id: 'task_1', title: 'VÃ©rifier le mÃ©nage', completed: false },
        { id: 'task_2', title: 'VÃ©rifier les Ã©quipements', completed: false },
        { id: 'task_3', title: 'PrÃ©parer les clÃ©s/accÃ¨s', completed: false },
        { id: 'task_4', title: 'VÃ©rifier les consommables', completed: false }
      ],
      dueDate: arrivalDueDate
    });

    if (arrivalChecklist) checklists.push(arrivalChecklist);

    // Checklist de dÃ©part (jour du dÃ©part)
    const departureChecklist = await createChecklist(userId, {
      propertyId: res.property_id,
      reservationUid,
      checklistType: 'departure',
      title: `ContrÃ´le dÃ©part - ${res.guest_name || 'Client'}`,
      tasks: [
        { id: 'task_1', title: 'Ã‰tat des lieux', completed: false },
        { id: 'task_2', title: 'VÃ©rifier les dÃ©gÃ¢ts Ã©ventuels', completed: false },
        { id: 'task_3', title: 'RÃ©cupÃ©rer les clÃ©s', completed: false },
        { id: 'task_4', title: 'Photos de l\'Ã©tat', completed: false }
      ],
      dueDate: new Date(res.end_date)
    });

    if (departureChecklist) checklists.push(departureChecklist);

    console.log(`âœ… ${checklists.length} checklists gÃ©nÃ©rÃ©es pour ${reservationUid}`);
    return checklists;
  } catch (error) {
    console.error('âŒ Erreur generateChecklistsForReservation:', error);
    return [];
  }
}

async function syncAllCalendars() {
  console.log('Ã°Å¸â€â€ž DÃƒÂ©marrage de la synchronisation iCal...');
  const isFirstSync = !reservationsStore.lastSync; // premiÃƒÂ¨re sync depuis le dÃƒÂ©marrage ?
  reservationsStore.syncStatus = 'syncing';

  const newReservations = [];
  const cancelledReservations = [];

  for (const property of PROPERTIES) {
    if (!property.icalUrls || property.icalUrls.length === 0) {
      console.log(`Ã¢Å¡Â Ã¯Â¸Â  Aucune URL iCal configurÃƒÂ©e pour ${property.name}`);
      continue;
    }

    try {
      const reservations = await icalService.fetchReservations(property);

      // Ancien ÃƒÂ©tat (iCal + manuelles) :
      const previousAllReservations = reservationsStore.properties[property.id] || [];

      // On ne regarde que les rÃƒÂ©sas iCal (pas les manuelles ni les blocages)
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

      // Ã¢Å¾â€¢ Nouvelles rÃƒÂ©servations (prÃƒÂ©sentes dans new mais pas dans old)
      const trulyNewReservations = newIcalReservations.filter(r => !oldIds.has(r.uid));

      // Ã¢Å¾â€“ RÃƒÂ©servations annulÃƒÂ©es (prÃƒÂ©sentes dans old mais plus dans new)
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

      // Ajouter les rÃƒÂ©servations manuelles (y compris blocages)
      const manualForProperty = MANUAL_RESERVATIONS[property.id] || [];
      if (manualForProperty.length > 0) {
        reservationsStore.properties[property.id] = [
          ...reservationsStore.properties[property.id],
          ...manualForProperty
        ];
      }

      console.log(
        `Ã¢Å“â€¦ ${property.name}: ${reservationsStore.properties[property.id].length} ` +
        `rÃƒÂ©servations (iCal + manuelles)`
      );
    } catch (error) {
      console.error(`Ã¢ÂÅ’ Erreur lors de la synchronisation de ${property.name}:`, error.message);
    }
  }

  reservationsStore.lastSync = new Date();
  reservationsStore.syncStatus = 'idle';

  // Ã°Å¸â€â€ Notifications : nouvelles + annulations (sauf premiÃƒÂ¨re sync pour ÃƒÂ©viter le spam massif)
  if (!isFirstSync && (newReservations.length > 0 || cancelledReservations.length > 0)) {
    console.log(
      `Ã°Å¸â€œÂ§ Notifications ÃƒÂ  envoyer Ã¢â‚¬â€œ nouvelles: ${newReservations.length}, annulÃƒÂ©es: ${cancelledReservations.length}`
    );
    try {
      await notifyOwnersAboutBookings(newReservations, cancelledReservations);
    } catch (err) {
      console.error('Ã¢ÂÅ’ Erreur lors de lÃ¢â‚¬â„¢envoi des notifications propriÃƒÂ©taires:', err);
    }

    if (newReservations.length > 0) {
      try {
        await notifyCleanersAboutNewBookings(newReservations);
      } catch (err) {
        console.error('Ã¢ÂÅ’ Erreur lors de lÃ¢â‚¬â„¢envoi des notifications mÃƒÂ©nage:', err);
      }
    }
  } else if (isFirstSync) {
    console.log('Ã¢â€žÂ¹Ã¯Â¸Â PremiÃƒÂ¨re synchronisation : aucune notification envoyÃƒÂ©e pour ÃƒÂ©viter les doublons.');
  }

  console.log('Ã¢Å“â€¦ Synchronisation terminÃƒÂ©e');
  return reservationsStore;
}
// ============================================
// ROUTE DE TEST WHATSAPP AMÃƒâ€°LIORÃƒâ€°E
// ============================================

app.get('/api/test-whatsapp', async (req, res) => {
  try {
    console.log('Ã°Å¸Â§Âª Test WhatsApp demandÃƒÂ©');
    
    // VÃƒÂ©rifier si le service est configurÃƒÂ©
    console.log('   - Service configurÃƒÂ©:', isConfigured);
    
    if (!isConfigured) {
      return res.status(500).json({ 
        ok: false, 
        error: 'Service WhatsApp non configurÃƒÂ©. VÃƒÂ©rifiez WHATSAPP_API_KEY et WHATSAPP_PHONE_ID' 
      });
    }
    
    // Utiliser le numÃƒÂ©ro passÃƒÂ© en paramÃƒÂ¨tre ou un numÃƒÂ©ro par dÃƒÂ©faut
    const testNumber = req.query.number || '+33680559925'; // 
    const testMessage = req.query.message || 'Test WhatsApp Boostinghost Ã¢Å“â€¦';
    
    console.log(`   - Envoi ÃƒÂ : ${testNumber}`);
    console.log(`   - Message: ${testMessage}`);
    
    
    console.log('Ã¢Å“â€¦ WhatsApp envoyÃƒÂ© avec succÃƒÂ¨s:', result);
    
    res.json({ 
      ok: true, 
      message: 'WhatsApp envoyÃƒÂ© avec succÃƒÂ¨s',
      to: testNumber,
      result: result
    });
  } catch (err) {
    console.error('Ã¢ÂÅ’ Erreur /api/test-whatsapp :', err);
    res.status(500).json({ 
      ok: false,
      error: err.message,
      details: err.stack
    });
  }
});

// Route pour tester avec l'utilisateur connectÃƒÂ©
app.get('/api/test-whatsapp-user', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    console.log(`Ã°Å¸Â§Âª Test WhatsApp pour user ${user.id}`);
    
    // RÃƒÂ©cupÃƒÂ©rer les settings de l'utilisateur
    const settings = await getNotificationSettings(user.id);
    
    console.log('   - Settings utilisateur:', JSON.stringify(settings, null, 2));
    
    if (!settings.whatsappEnabled) {
      return res.json({ 
        ok: false, 
        message: 'WhatsApp dÃƒÂ©sactivÃƒÂ© dans vos prÃƒÂ©fÃƒÂ©rences' 
      });
    }
    
    if (!settings.whatsappNumber) {
      return res.json({ 
        ok: false, 
        message: 'Aucun numÃƒÂ©ro WhatsApp configurÃƒÂ© dans vos prÃƒÂ©fÃƒÂ©rences' 
      });
    }
    
    const testMessage = `Test notification Boostinghost Ã¢Å“â€¦\n\nCeci est un message de test envoyÃƒÂ© ÃƒÂ  ${new Date().toLocaleString('fr-FR')}`;
    
    console.log(`   - Envoi ÃƒÂ : ${settings.whatsappNumber}`);
    
    
    console.log('Ã¢Å“â€¦ Test WhatsApp envoyÃƒÂ© avec succÃƒÂ¨s');
    
    res.json({ 
      ok: true, 
      message: 'Message WhatsApp envoyÃƒÂ© avec succÃƒÂ¨s ÃƒÂ  votre numÃƒÂ©ro',
      to: settings.whatsappNumber
    });
    
  } catch (err) {
    console.error('Ã¢ÂÅ’ Erreur /api/test-whatsapp-user :', err);
    res.status(500).json({ 
      ok: false,
      error: err.message 
    });
  }
});

// ============================================
// TEST CONNEXION BASE DE DONNÃƒâ€°ES
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
      error: 'Erreur de connexion ÃƒÂ  la base'
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
      error: 'Erreur lors de la rÃƒÂ©cupÃƒÂ©ration des utilisateurs'
    });
  }
});

// ============================================
// ROUTES API - RESERVATIONS (par user)
// ============================================
// ============================================
// ENDPOINT /api/reservations/manual
// (appelÃƒÂ© par le frontend)
// ============================================

app.post('/api/reservations/manual', async (req, res) => {
  console.log('Ã°Å¸â€œÂ /api/reservations/manual appelÃƒÂ©');
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { propertyId, start, end, guestName, notes } = req.body;
    console.log('Ã°Å¸â€œÂ¦ DonnÃƒÂ©es reÃƒÂ§ues:', { propertyId, start, end, guestName });

    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      console.log('Ã¢ÂÅ’ Logement non trouvÃƒÂ©:', propertyId);
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
    }
    console.log('Ã¢Å“â€¦ Logement trouvÃƒÂ©:', property.name);

    const uid = 'manual_' + Date.now();
    const reservation = {
      uid: uid,
      start: start,
      end: end,
      source: 'MANUEL',
      platform: 'MANUEL',
      type: 'manual',
      guestName: guestName || 'RÃƒÂ©servation manuelle',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      userId: user.id
    };
    console.log('Ã¢Å“â€¦ RÃƒÂ©servation crÃƒÂ©ÃƒÂ©e:', uid);

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

    // RÃƒÂ©ponse au client AVANT les notifications
    res.status(201).json({
      message: 'RÃƒÂ©servation manuelle crÃƒÂ©ÃƒÂ©e',
      reservation: reservation
    });
    console.log('Ã¢Å“â€¦ RÃƒÂ©ponse envoyÃƒÂ©e au client');

    // Notifications en arriÃƒÂ¨re-plan
    setImmediate(async () => {
      try {
        console.log('Ã°Å¸â€œÂ§ Envoi des notifications...');
        
        if (typeof notifyOwnersAboutBookings === 'function') {
          await notifyOwnersAboutBookings([reservation], []);
          console.log('Ã¢Å“â€¦ Notification propriÃƒÂ©taire envoyÃƒÂ©e');
        }
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('Ã¢Å“â€¦ Notification cleaners envoyÃƒÂ©e');
        }
      } catch (notifErr) {
        console.error('Ã¢Å¡Â Ã¯Â¸Â  Erreur notifications:', notifErr.message);
      }
    });

  } catch (err) {
    console.error('Ã¢ÂÅ’ Erreur /api/reservations/manual:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});
// GET - Toutes les rÃƒÂ©servations du user
app.get('/api/reservations', authenticateUser, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

// POST - CrÃƒÂ©er une rÃƒÂ©servation manuelle
app.post('/api/bookings', async (req, res) => {
  console.log('Ã°Å¸â€œÂ Nouvelle demande de crÃƒÂ©ation de rÃƒÂ©servation');
  
  try {
    // 1. VÃƒâ€°RIFICATION AUTHENTIFICATION
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('Ã¢ÂÅ’ Utilisateur non authentifiÃƒÂ©');
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }
    console.log('Ã¢Å“â€¦ Utilisateur authentifiÃƒÂ©:', user.id);
    
    // 2. EXTRACTION ET VALIDATION DES DONNÃƒâ€°ES
    const { propertyId, checkIn, checkOut, guestName, platform, price } = req.body || {};
    console.log('Ã°Å¸â€œÂ¦ DonnÃƒÂ©es reÃƒÂ§ues:', { propertyId, checkIn, checkOut, guestName, platform, price });
    
    if (!propertyId) {
      console.log('Ã¢ÂÅ’ propertyId manquant');
      return res.status(400).json({ error: 'propertyId est requis' });
    }
    if (!checkIn) {
      console.log('Ã¢ÂÅ’ checkIn manquant');
      return res.status(400).json({ error: 'checkIn est requis' });
    }
    if (!checkOut) {
      console.log('Ã¢ÂÅ’ checkOut manquant');
      return res.status(400).json({ error: 'checkOut est requis' });
    }
    
    // 3. VÃƒâ€°RIFICATION DU LOGEMENT
    if (!Array.isArray(PROPERTIES)) {
      console.error('Ã¢ÂÅ’ PROPERTIES n\'est pas un tableau');
      return res.status(500).json({ error: 'Erreur de configuration serveur (PROPERTIES)' });
    }
    
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      console.log('Ã¢ÂÅ’ Logement non trouvÃƒÂ©:', propertyId);
      console.log('Ã°Å¸â€œâ€¹ Logements disponibles pour cet utilisateur:', 
        PROPERTIES.filter(p => p.userId === user.id).map(p => ({ id: p.id, name: p.name }))
      );
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
    }
    console.log('Ã¢Å“â€¦ Logement trouvÃƒÂ©:', property.name);
    
    // 4. CRÃƒâ€°ATION DE LA RÃƒâ€°SERVATION
    const uid = 'manual_' + Date.now();
    const reservation = {
      uid: uid,
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'RÃƒÂ©servation manuelle',
      price: typeof price === 'number' ? price : 0,
      createdAt: new Date().toISOString(),
      // DonnÃƒÂ©es supplÃƒÂ©mentaires pour les notifications
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      userId: user.id
    };
    console.log('Ã¢Å“â€¦ RÃƒÂ©servation crÃƒÂ©ÃƒÂ©e:', uid);
    
    // 5. SAUVEGARDE DANS MANUAL_RESERVATIONS
    try {
      if (typeof MANUAL_RESERVATIONS === 'undefined') {
        console.log('Ã¢Å¡Â Ã¯Â¸Â  MANUAL_RESERVATIONS non dÃƒÂ©fini, initialisation');
        global.MANUAL_RESERVATIONS = {};
      }
      
     if (!MANUAL_RESERVATIONS[propertyId]) {
  MANUAL_RESERVATIONS[propertyId] = [];
}
MANUAL_RESERVATIONS[propertyId].push(reservation);

// Sauvegarde sur disque (si la fonction existe)
if (typeof saveManualReservations === 'function') {
  await saveManualReservations();
  console.log('âœ… Sauvegarde MANUAL_RESERVATIONS OK');
} else {
  console.log('âš ï¸  Fonction saveManualReservations non trouvÃ©e');
}
} catch (saveErr) {
  console.error('âš ï¸  Erreur sauvegarde MANUAL_RESERVATIONS:', saveErr);
  // On continue quand mÃªme
}
    // DELETE - Supprimer une rÃ©servation
app.delete('/api/bookings/:uid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { uid } = req.params;
    
    const deleted = await deleteReservationFromDB(uid);
    
    if (!deleted) {
      return res.status(500).json({ error: 'Erreur lors de la suppression' });
    }

    await loadReservationsFromDB();
    
    res.json({ message: 'Logement modifié avec succès' });
  } catch (err) {
    console.error('Erreur DELETE /api/bookings:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
    // 6. AJOUT AU STORE DES RÃƒâ€°SERVATIONS
    try {
      if (typeof reservationsStore === 'undefined') {
        console.log('Ã¢Å¡Â Ã¯Â¸Â  reservationsStore non dÃƒÂ©fini, initialisation');
        global.reservationsStore = { properties: {} };
      }
      
      if (!reservationsStore.properties) {
        reservationsStore.properties = {};
      }
      
      if (!reservationsStore.properties[propertyId]) {
        reservationsStore.properties[propertyId] = [];
      }
      reservationsStore.properties[propertyId].push(reservation);
      console.log('Ã¢Å“â€¦ Ajout au reservationsStore OK');
    } catch (storeErr) {
      console.error('Ã¢Å¡Â Ã¯Â¸Â  Erreur ajout au reservationsStore:', storeErr);
      // On continue quand mÃƒÂªme
    }
    
    // 7. PRÃƒâ€°PARATION DE LA RÃƒâ€°PONSE
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
    
    // 8. ENVOI DE LA RÃƒâ€°PONSE (AVANT LES NOTIFICATIONS)
    console.log('Ã¢Å“â€¦ RÃƒÂ©servation crÃƒÂ©ÃƒÂ©e avec succÃƒÂ¨s, envoi de la rÃƒÂ©ponse');
    res.status(201).json(bookingForClient);
    
    // 9. NOTIFICATIONS EN ARRIÃƒË†RE-PLAN (aprÃƒÂ¨s avoir rÃƒÂ©pondu au client)
    setImmediate(async () => {
      try {
        console.log('Ã°Å¸â€œÂ§ Tentative d\'envoi des notifications...');
        
        // VÃƒÂ©rifier que les fonctions de notification existent
        if (typeof notifyOwnersAboutBookings === 'function') {
          await notifyOwnersAboutBookings([reservation], []);
          console.log('Ã¢Å“â€¦ Notification propriÃƒÂ©taire envoyÃƒÂ©e');
        } else {
          console.log('Ã¢Å¡Â Ã¯Â¸Â  Fonction notifyOwnersAboutBookings non trouvÃƒÂ©e');
        }
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('Ã¢Å“â€¦ Notification cleaners envoyÃƒÂ©e');
        } else {
          console.log('Ã¢Å¡Â Ã¯Â¸Â  Fonction notifyCleanersAboutNewBookings non trouvÃƒÂ©e');
        }
        
        console.log('Ã¢Å“â€¦ Notifications traitÃƒÂ©es');
      } catch (notifErr) {
        console.error('Ã¢Å¡Â Ã¯Â¸Â  Erreur lors de l\'envoi des notifications (rÃƒÂ©servation crÃƒÂ©ÃƒÂ©e quand mÃƒÂªme):', notifErr.message);
        console.error('Stack:', notifErr.stack);
      }
    });
    
  } catch (err) {
    console.error('Ã¢ÂÅ’ ERREUR CRITIQUE POST /api/bookings:', err);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    // Si on n'a pas encore envoyÃƒÂ© de rÃƒÂ©ponse
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Erreur serveur lors de la crÃƒÂ©ation de la rÃƒÂ©servation',
        message: err.message,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  }
});

// POST - CrÃƒÂ©er un blocage manuel (dates bloquÃƒÂ©es)
app.post('/api/blocks', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { propertyId, start, end, reason } = req.body || {};

    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
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
      message: 'Blocage crÃƒÂ©ÃƒÂ©',
      block
    });
  } catch (err) {
    console.error('Erreur crÃƒÂ©ation blocage:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - RÃƒÂ©servations dÃ¢â‚¬â„¢un logement
app.get('/api/reservations/:propertyId', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
  }

  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
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
  // Ã¢Å“â€¦ FormData simple : les champs sont directement dans req.body
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
    console.log('Ã¢Å“â€¦ Image uploadÃƒÂ©e vers Cloudinary:', cloudinaryUrl);
    return cloudinaryUrl;
  } catch (error) {
    console.error('Ã¢ÂÅ’ Erreur upload Cloudinary:', error);
    throw error;
  }
}

// ============================================
// ROUTES API - PROFIL UTILISATEUR Ãƒâ€°TENDU
// ============================================
// Ãƒâ‚¬ ajouter dans server.js aprÃƒÂ¨s les routes existantes

app.get('/api/user/profile', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
      return res.status(404).json({ error: 'Utilisateur non trouvÃƒÂ©' });
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

// PUT - Mettre ÃƒÂ  jour le profil complet de l'utilisateur
app.put('/api/user/profile', upload.single('logo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
        error: 'Type de compte invalide. Doit ÃƒÂªtre "individual" ou "business"' 
      });
    }

    // Validation du SIRET si entreprise
    if (accountType === 'business' && siret) {
      const siretClean = siret.replace(/\s/g, '');
      if (siretClean.length !== 14 || !/^\d{14}$/.test(siretClean)) {
        return res.status(400).json({ 
          error: 'Le numÃƒÂ©ro SIRET doit contenir exactement 14 chiffres' 
        });
      }
    }

    // GÃƒÂ©rer le logo uploadÃƒÂ©
   // Upload du logo vers Cloudinary
let logoUrl = null;
if (req.file) {
  logoUrl = await uploadPhotoToCloudinary(req.file);
}

    // Mise ÃƒÂ  jour dans la base de donnÃƒÂ©es
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
      return res.status(404).json({ error: 'Utilisateur non trouvÃƒÂ©' });
    }

    const updated = result.rows[0];

    // Mettre ÃƒÂ  jour le cache si utilisÃƒÂ©
    if (notificationUserCache.has(user.id)) {
      notificationUserCache.delete(user.id);
    }

    res.json({
      success: true,
      message: 'Profil mis ÃƒÂ  jour avec succÃƒÂ¨s',
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
    console.error('Erreur mise ÃƒÂ  jour profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Route pour vÃƒÂ©rifier le statut de l'abonnement
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
      return res.status(404).json({ error: 'Aucun abonnement trouvÃƒÂ©' });
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

    // Ã¢Å“â€¦ AJOUTER LE PRIX
    let planAmount = 0;
    if (sub.plan_type === 'basic') {
      planAmount = 599; // 5,99Ã¢â€šÂ¬ en centimes
    } else if (sub.plan_type === 'pro') {
      planAmount = 899; // 8,99Ã¢â€šÂ¬ en centimes
    }

    // Ã¢Å“â€¦ AJOUTER LE DISPLAY MESSAGE
    let displayMessage = 'Abonnement';
    if (sub.status === 'trial') {
      displayMessage = 'Essai gratuit';
    } else if (sub.status === 'active') {
      displayMessage = sub.plan_type === 'pro' ? 'Abonnement Pro' : 'Abonnement Basic';
    } else if (sub.status === 'expired') {
      displayMessage = 'Abonnement expirÃƒÂ©';
    } else if (sub.status === 'canceled') {
      displayMessage = 'Abonnement annulÃƒÂ©';
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
// 1. RÃƒÂ©cupÃƒÂ©rer le profil au chargement
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

// 2. Mettre ÃƒÂ  jour le profil lors de la sauvegarde
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
    alert('Profil mis ÃƒÂ  jour avec succÃƒÂ¨s !');
  } else {
    alert('Erreur : ' + data.error);
  }
});
*/
// ============================================
// ROUTES API - BOOKINGS (alias pour rÃƒÂ©servations)
// UtilisÃƒÂ© par le calendrier moderne (calendar-modern.js)
// ============================================

// GET - Liste des bookings pour l'utilisateur courant
app.get('/api/bookings', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

// POST - CrÃƒÂ©er un booking manuel (alias de /api/reservations/manual)
app.post('/api/bookings', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { propertyId, checkIn, checkOut, guestName, platform, price } = req.body || {};

    if (!propertyId || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'propertyId, checkIn et checkOut sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
    }

    const reservation = {
      uid: 'manual_' + Date.now(),
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'RÃƒÂ©servation manuelle',
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
  }

  if (reservationsStore.syncStatus === 'syncing') {
    return res.status(409).json({
      error: 'Synchronisation dÃƒÂ©jÃƒÂ  en cours',
      status: 'syncing'
    });
  }

  try {
    const result = await syncAllCalendars();
    const userProps = getUserProperties(user.id);

    res.json({
      message: 'Synchronisation rÃƒÂ©ussie',
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
  }

  const { propertyId } = req.params;
  const { startDate, endDate } = req.query;

  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
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

// GET - RÃƒÂ©servations avec infos de caution
app.get('/api/reservations-with-deposits', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
// âœ… GET - RÃ©servations enrichies (risque + checklist + sous-scores)
// ============================================
app.get('/api/reservations/enriched', authenticateUser, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

  try {
    // PrÃ©-calcul turnover par property
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
        // âœ… Checklist V1 auto (lazy)
        const chk = ensureChecklistForReservation({
          reservationUid: r.uid,
          propertyId: property.id,
          userId: user.id
        });

        // âœ… Deposit (Stripe) via DEPOSITS JSON
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

    // Persister checklists si de nouvelles ont Ã©tÃ© crÃ©Ã©es
    await saveChecklists();

    res.json({ reservations: result });
  } catch (err) {
    console.error('Erreur /api/reservations/enriched :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// âœ… Checklists V1 - toggle task
// ============================================
app.post('/api/checklists/:reservationUid/tasks/:taskId/toggle', authenticateUser, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

  const { reservationUid, taskId } = req.params;
  const chk = CHECKLISTS[reservationUid];
  if (!chk) return res.status(404).json({ error: 'Checklist introuvable' });
  if (chk.userId !== user.id) return res.status(403).json({ error: 'AccÃ¨s refusÃ©' });

  const task = chk.tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'TÃ¢che introuvable' });

  task.completed = !task.completed;
  chk.updatedAt = new Date().toISOString();

  const allDone = chk.tasks.every(t => t.completed);
  chk.status = allDone ? 'completed' : (chk.tasks.some(t => t.completed) ? 'in_progress' : 'pending');

  await saveChecklists();
  res.json({ checklist: chk });
});

// âœ… Checklists V1 - complete all
app.post('/api/checklists/:reservationUid/complete', authenticateUser, checkSubscription, async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autorisÃ©' });

  const { reservationUid } = req.params;
  const chk = CHECKLISTS[reservationUid];
  if (!chk) return res.status(404).json({ error: 'Checklist introuvable' });
  if (chk.userId !== user.id) return res.status(403).json({ error: 'AccÃ¨s refusÃ©' });

  chk.tasks = chk.tasks.map(t => ({ ...t, completed: true }));
  chk.status = 'completed';
  chk.updatedAt = new Date().toISOString();

  await saveChecklists();
  res.json({ checklist: chk });
});


// ============================================
// ROUTES API - PARAMÃƒË†TRES NOTIFICATIONS (par user)
// ============================================

app.get('/api/settings/notifications', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
      message: 'PrÃƒÂ©fÃƒÂ©rences de notifications mises ÃƒÂ  jour',
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

// ICS d'un logement : contient les rÃƒÂ©servations manuelles + blocages
app.get('/ical/property/:propertyId.ics', async (req, res) => {
  try {
    const { propertyId } = req.params;

    const property = PROPERTIES.find(p => p.id === propertyId);
    if (!property) {
      return res.status(404).send('Property not found');
    }

    // On exporte uniquement ce qui est dans MANUAL_RESERVATIONS :
    // - rÃƒÂ©servations manuelles (type: 'manual')
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
          : (r.guestName ? `RÃƒÂ©servation Ã¢â‚¬â€œ ${r.guestName}` : 'RÃƒÂ©servation Boostinghost');

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
// Fonction helper : GÃƒÂ©nÃƒÂ©rer un token de vÃƒÂ©rification
// ============================================
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// Fonction helper : Envoyer l'email de vÃƒÂ©rification
// ============================================
async function sendVerificationEmail(email, firstName, token) {
  const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
  const verificationUrl = `${appUrl}/verify-email.html?token=${token}`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Ã¢Å“â€¦ VÃƒÂ©rifiez votre adresse email - Boostinghost',
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
            <h1>Ã°Å¸Å½â€° Bienvenue sur Boostinghost !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName || 'nouveau membre'},</p>
            
            <p>Merci de vous ÃƒÂªtre inscrit sur <strong>Boostinghost</strong> !</p>
            
            <p>Pour activer votre compte et commencer ÃƒÂ  utiliser notre plateforme de gestion de locations courte durÃƒÂ©e, veuillez vÃƒÂ©rifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
            
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">
                Ã¢Å“â€¦ VÃƒÂ©rifier mon email
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
              Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br>
              <a href="${verificationUrl}" style="color: #10b981;">${verificationUrl}</a>
            </p>
            
            <p style="margin-top: 30px;">
              <strong>Ce lien est valide pendant 24 heures.</strong>
            </p>
            
            <p>Une fois votre email vÃƒÂ©rifiÃƒÂ©, vous aurez accÃƒÂ¨s ÃƒÂ  :</p>
            <ul>
              <li>Ã¢Å“â€¦ Calendrier unifiÃƒÂ©</li>
              <li>Ã¢Å“â€¦ Synchronisation iCal (Airbnb, Booking)</li>
              <li>Ã¢Å“â€¦ Gestion des messages</li>
              <li>Ã¢Å“â€¦ Livret d'accueil personnalisÃƒÂ©</li>
              <li>Ã¢Å“â€¦ Gestion du mÃƒÂ©nage</li>
              <li>Ã¢Å“â€¦ Et bien plus encore !</li>
            </ul>
            
            <p>Ãƒâ‚¬ trÃƒÂ¨s bientÃƒÂ´t sur Boostinghost ! Ã°Å¸Å¡â‚¬</p>
          </div>
          <div class="footer">
            <p>Cet email a ÃƒÂ©tÃƒÂ© envoyÃƒÂ© automatiquement par Boostinghost.</p>
            <p>Si vous n'avez pas crÃƒÂ©ÃƒÂ© de compte, vous pouvez ignorer cet email.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Email de vÃƒÂ©rification envoyÃƒÂ© ÃƒÂ :', email);
    return true;
  } catch (error) {
    console.error('Erreur envoi email vÃƒÂ©rification:', error);
    return false;
  }
}
// ============================================
// SERVICE D'EMAILS AUTOMATIQUES
// ============================================

// ============================================
// FONCTION : VÃƒÂ©rifier si un email a dÃƒÂ©jÃƒÂ  ÃƒÂ©tÃƒÂ© envoyÃƒÂ©
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
// EMAIL 1 : BIENVENUE APRÃƒË†S VÃƒâ€°RIFICATION
// ============================================
async function sendWelcomeEmail(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Ã°Å¸Å½â€° Bienvenue sur Boostinghost !',
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
            <h1 style="margin: 0; font-size: 32px;">Ã°Å¸Å½â€° Bienvenue !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Votre compte Boostinghost est maintenant actif !</strong></p>
            
            <p>Vous avez accÃƒÂ¨s ÃƒÂ  <strong>14 jours d'essai gratuit</strong> pour tester toutes les fonctionnalitÃƒÂ©s de notre plateforme de gestion de locations courte durÃƒÂ©e.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                Ã°Å¸Å¡â‚¬ AccÃƒÂ©der ÃƒÂ  mon espace
              </a>
            </div>
            
            <h3 style="color: #111827; margin-top: 30px;">Ã¢Å“Â¨ Ce que vous pouvez faire dÃƒÂ¨s maintenant :</h3>
            
            <div class="feature">
              <span class="feature-icon">Ã°Å¸â€œâ€¦</span>
              <div>
                <strong>Ajoutez vos logements</strong><br>
                <span style="color: #6b7280; font-size: 14px;">CrÃƒÂ©ez vos fiches de propriÃƒÂ©tÃƒÂ©s en quelques clics</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">Ã°Å¸â€â€”</span>
              <div>
                <strong>Synchronisez vos calendriers</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Connectez Airbnb et Booking.com via iCal</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">Ã°Å¸â€™Â¬</span>
              <div>
                <strong>GÃƒÂ©rez vos messages</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Centralisez toutes vos communications</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">Ã°Å¸Â§Â¹</span>
              <div>
                <strong>Organisez le mÃƒÂ©nage</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Planifiez et suivez les tÃƒÂ¢ches de nettoyage</span>
              </div>
            </div>
            
            <p style="margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              Ã°Å¸â€™Â¡ <strong>Besoin d'aide ?</strong><br>
              Notre ÃƒÂ©quipe est lÃƒÂ  pour vous accompagner : <a href="mailto:support@boostinghost.com" style="color: #10b981;">support@boostinghost.com</a>
            </p>
            
            <p>Ãƒâ‚¬ trÃƒÂ¨s bientÃƒÂ´t sur Boostinghost ! Ã°Å¸Å¡â‚¬</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'ÃƒÂ©quipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Cet email a ÃƒÂ©tÃƒÂ© envoyÃƒÂ© automatiquement par Boostinghost.</p>
            <p>Ã‚Â© ${new Date().getFullYear()} Boostinghost. Tous droits rÃƒÂ©servÃƒÂ©s.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('Ã¢Å“â€¦ Email de bienvenue envoyÃƒÂ© ÃƒÂ :', email);
}

// ============================================
// EMAIL 2 : RAPPEL J-7
// ============================================
async function sendTrialReminder7Days(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Ã¢ÂÂ° Plus qu\'une semaine d\'essai gratuit',
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
            <h1 style="margin: 0; font-size: 28px;">Ã¢ÂÂ° Plus qu'une semaine !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p>Il vous reste <strong>7 jours</strong> d'essai gratuit sur Boostinghost !</p>
            
            <p>C'est le moment idÃƒÂ©al pour :</p>
            <ul>
              <li>Tester toutes les fonctionnalitÃƒÂ©s</li>
              <li>Synchroniser tous vos calendriers</li>
              <li>Configurer vos messages automatiques</li>
              <li>Organiser votre planning de mÃƒÂ©nage</li>
            </ul>
            
            <p>Pour continuer ÃƒÂ  profiter de Boostinghost aprÃƒÂ¨s votre essai, choisissez le plan qui vous convient :</p>
            
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
            <p>Ã‚Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('Ã¢Å“â€¦ Email rappel J-7 envoyÃƒÂ© ÃƒÂ :', email);
}

// ============================================
// EMAIL 3 : RAPPEL J-3
// ============================================
async function sendTrialReminder3Days(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Ã°Å¸â€â€ Plus que 3 jours d\'essai gratuit !',
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
            <h1 style="margin: 0; font-size: 28px;">Ã°Å¸â€â€ Plus que 3 jours !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <div class="alert">
              <strong>Ã¢Å¡Â Ã¯Â¸Â Attention !</strong><br>
              Votre essai gratuit se termine dans <strong>3 jours</strong>.
            </div>
            
            <p>Pour continuer ÃƒÂ  utiliser Boostinghost sans interruption, choisissez votre plan dÃƒÂ¨s maintenant :</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Plan Basic - 5,99Ã¢â€šÂ¬/mois</strong></p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">Toutes les fonctionnalitÃƒÂ©s essentielles</p>
            </div>
            
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border: 2px solid #10b981; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Plan Pro - 8,99Ã¢â€šÂ¬/mois</strong></p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">+ Gestion des cautions Stripe (commission 2%)</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                Choisir mon plan
              </a>
            </div>
          </div>
          <div class="footer">
            <p>Ã‚Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('Ã¢Å“â€¦ Email rappel J-3 envoyÃƒÂ© ÃƒÂ :', email);
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
    subject: 'Ã°Å¸Å¡Â¨ Dernier jour d\'essai gratuit !',
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
            <h1 style="margin: 0; font-size: 32px;">Ã°Å¸Å¡Â¨ Dernier jour !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <div class="alert">
              <strong style="font-size: 18px;">Ã¢ÂÂ° Votre essai gratuit se termine demain !</strong><br><br>
              Pour continuer ÃƒÂ  utiliser Boostinghost, souscrivez ÃƒÂ  un plan dÃƒÂ¨s maintenant.
            </div>
            
            <p style="font-size: 16px;">Sans abonnement actif, vous perdrez l'accÃƒÂ¨s ÃƒÂ  :</p>
            <ul style="font-size: 16px;">
              <li>Votre calendrier unifiÃƒÂ©</li>
              <li>La synchronisation iCal</li>
              <li>La gestion des messages</li>
              <li>Le suivi du mÃƒÂ©nage</li>
              <li>Toutes vos donnÃƒÂ©es et rÃƒÂ©servations</li>
            </ul>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                Ã°Å¸Å¡â‚¬ Activer mon abonnement maintenant
              </a>
            </div>
            
            <p style="text-align: center; color: #6b7280; font-size: 14px;">
              Seulement 5,99Ã¢â€šÂ¬/mois pour le plan Basic<br>
              ou 8,99Ã¢â€šÂ¬/mois pour le plan Pro
            </p>
          </div>
          <div class="footer">
            <p>Ã‚Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('Ã¢Å“â€¦ Email rappel J-1 envoyÃƒÂ© ÃƒÂ :', email);
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
    subject: 'Ã¢Å“â€¦ Abonnement confirmÃƒÂ© - Merci !',
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
            <h1 style="margin: 0; font-size: 32px;">Ã¢Å“â€¦ Abonnement confirmÃƒÂ© !</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p><strong>Merci pour votre confiance ! Ã°Å¸Å½â€°</strong></p>
            
            <p>Votre abonnement Boostinghost est maintenant actif.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Votre plan</p>
              <p style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #10b981;">Plan ${planName}</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                <strong style="font-size: 18px; color: #111827;">${price}Ã¢â€šÂ¬</strong> / mois
              </p>
            </div>
            
            <p>Vous avez maintenant accÃƒÂ¨s ÃƒÂ  toutes les fonctionnalitÃƒÂ©s de Boostinghost :</p>
            <ul>
              <li>Ã¢Å“â€¦ Calendrier unifiÃƒÂ©</li>
              <li>Ã¢Å“â€¦ Synchronisation iCal (Airbnb, Booking)</li>
              <li>Ã¢Å“â€¦ Gestion des messages</li>
              <li>Ã¢Å“â€¦ Livret d'accueil personnalisÃƒÂ©</li>
              <li>Ã¢Å“â€¦ Gestion du mÃƒÂ©nage</li>
              <li>Ã¢Å“â€¦ Statistiques & rapports</li>
              ${planType === 'pro' ? '<li>Ã¢Å“â€¦ Gestion des cautions Stripe (2% commission)</li>' : ''}
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                AccÃƒÂ©der ÃƒÂ  mon espace
              </a>
            </div>
            
            <p style="padding: 16px; background: #f0fdf4; border-radius: 6px; border-left: 4px solid #10b981; margin-top: 30px;">
              Ã°Å¸â€™Â¡ <strong>GÃƒÂ©rer mon abonnement</strong><br>
              Vous pouvez modifier ou annuler votre abonnement ÃƒÂ  tout moment depuis votre espace compte.
            </p>
            
            <p style="margin-top: 30px;">Merci encore et bonne gestion ! Ã°Å¸Å¡â‚¬</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'ÃƒÂ©quipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Questions ? Contactez-nous : support@boostinghost.com</p>
            <p>Ã‚Â© ${new Date().getFullYear()} Boostinghost. Tous droits rÃƒÂ©servÃƒÂ©s.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('Ã¢Å“â€¦ Email confirmation abonnement envoyÃƒÂ© ÃƒÂ :', email);
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
    subject: 'Ã°Å¸â€â€ž Prochain renouvellement dans 3 jours',
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
            <h1 style="margin: 0; font-size: 28px;">Ã°Å¸â€â€ž Rappel de renouvellement</h1>
          </div>
          <div class="content">
            <p>Bonjour ${firstName},</p>
            
            <p>Votre abonnement Boostinghost <strong>Plan ${planName}</strong> sera automatiquement renouvelÃƒÂ© dans <strong>3 jours</strong>.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Prochain prÃƒÂ©lÃƒÂ¨vement</p>
              <p style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #3b82f6;">${price}Ã¢â€šÂ¬</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Date : <strong>${formattedDate}</strong>
              </p>
            </div>
            
            <p>Aucune action n'est nÃƒÂ©cessaire de votre part. Le paiement sera effectuÃƒÂ© automatiquement.</p>
            
            <p style="padding: 16px; background: #f0f9ff; border-radius: 6px; border-left: 4px solid #3b82f6;">
              Ã°Å¸â€™Â¡ Vous souhaitez modifier ou annuler votre abonnement ? Rendez-vous dans votre espace compte.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/settings-account.html" class="button">
                GÃƒÂ©rer mon abonnement
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              Merci de votre confiance !<br>
              L'ÃƒÂ©quipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Questions ? Contactez-nous : support@boostinghost.com</p>
            <p>Ã‚Â© ${new Date().getFullYear()} Boostinghost</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log('Ã¢Å“â€¦ Email rappel renouvellement envoyÃƒÂ© ÃƒÂ :', email);
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
  }

  try {
    const result = await pool.query(
      'SELECT data FROM welcome_books_v2 WHERE user_id = $1',
      [user.id]
    );

    let data;
    if (result.rows.length === 0) {
      // Pas encore de livret pour cet utilisateur Ã¢â€ â€™ on crÃƒÂ©e un dÃƒÂ©faut
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
      message: 'Livret sauvegardÃƒÂ©',
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

// GET - Liste des personnes de mÃƒÂ©nage de l'utilisateur
app.get('/api/cleaners', authenticateUser, checkSubscription, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

// POST - CrÃƒÂ©er une nouvelle personne de mÃƒÂ©nage
app.post('/api/cleaners', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
      message: 'Membre du mÃƒÂ©nage crÃƒÂ©ÃƒÂ©',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaners :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Modifier une personne de mÃƒÂ©nage
app.put('/api/cleaners/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
      return res.status(404).json({ error: 'Membre du mÃƒÂ©nage introuvable' });
    }

    res.json({
      message: 'Membre du mÃƒÂ©nage mis ÃƒÂ  jour',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur PUT /api/cleaners/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une personne de mÃƒÂ©nage
app.delete('/api/cleaners/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membre du mÃƒÂ©nage introuvable' });
    }

    res.json({ message: 'Membre du ménage supprimé' });
  } catch (err) {
    console.error('Erreur DELETE /api/cleaners/:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - ASSIGNATIONS MENAGE (par user)
// ============================================

// GET - Liste des assignations de mÃƒÂ©nage
app.get('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

// POST - CrÃƒÂ©er / mettre ÃƒÂ  jour / supprimer une assignation
app.post('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { propertyId, cleanerId } = req.body || {};

    if (!propertyId) {
      return res.status(400).json({ error: 'propertyId requis' });
    }

    // Si cleanerId vide Ã¢â€ â€™ on supprime l'assignation
    if (!cleanerId) {
      await pool.query(
        'DELETE FROM cleaning_assignments WHERE user_id = $1 AND property_id = $2',
        [user.id, propertyId]
      );
      return res.json({
        message: 'Assignation mÃƒÂ©nage supprimÃƒÂ©e',
        propertyId
      });
    }

    // VÃƒÂ©rifier que le logement appartient bien ÃƒÂ  l'utilisateur
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ© pour cet utilisateur' });
    }

    // VÃƒÂ©rifier que le cleaner appartient bien ÃƒÂ  l'utilisateur
    const cleanerResult = await pool.query(
      `SELECT id, name, email, phone
       FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [cleanerId, user.id]
    );

    if (cleanerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Personne de mÃƒÂ©nage introuvable pour cet utilisateur' });
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
      message: 'Assignation mÃƒÂ©nage enregistrÃƒÂ©e',
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
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

              // Nouveau format ÃƒÂ©ventuel : dÃƒÂ©jÃƒÂ  un objet
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

        // Ã°Å¸â€˜â€¡ nouveaux champs que le front attend
        address: p.address || null,
        arrivalTime: p.arrival_time || p.arrivalTime || null,
        departureTime: p.departure_time || p.departureTime || null,
        depositAmount: p.deposit_amount ?? p.depositAmount ?? null,
        photoUrl: p.photo_url || p.photoUrl || null,

        // Ã¢Å“â€¦ NOUVEAUX CHAMPS ENRICHIS
        welcomeBookUrl: p.welcome_book_url || null,
        accessCode: p.access_code || null,
        wifiName: p.wifi_name || null,
        wifiPassword: p.wifi_password || null,
        accessInstructions: p.access_instructions || null,
        ownerId: p.owner_id || null,  
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
  }

  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
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
    
    // Ã¢Å“â€¦ NOUVEAUX CHAMPS ENRICHIS
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
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

    // Upload vers Cloudinary si un fichier est prÃƒÂ©sent
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
     owner_id, display_order, created_at
   )
   VALUES (
     $1, $2, $3, $4, $5,
     $6, $7, $8, $9, $10,
     $11, $12, $13, $14, $15,
     $16,
     (SELECT COALESCE(MAX(display_order), 0) + 1 FROM properties WHERE user_id = $2),
     NOW()
   )`,
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
      message: 'Logement crÃƒÂ©ÃƒÂ© avec succÃƒÂ¨s',
      property
    });
  } catch (err) {
    console.error('Erreur crÃƒÂ©ation logement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/properties/:propertyId', upload.single('photo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
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
    newOwnerId, // Ã¢â€ Â AJOUTE CETTE LIGNE
    propertyId,
    user.id
  ]
);
    await loadProperties();

    const updated = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

    res.json({
      message: 'Logement modifiÃƒÂ© avec succÃƒÂ¨s',
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
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { propertyId } = req.params;

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
    }

    await pool.query(
      'DELETE FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, user.id]
    );

    delete reservationsStore.properties[propertyId];

    await loadProperties();

    res.json({
      message: 'Logement supprimÃƒÂ© avec succÃƒÂ¨s',
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

  // ============================================
// Réorganiser l'ordre des logements (SAFE)
// ============================================
app.put('/api/properties/:propertyId/reorder', authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    const { propertyId } = req.params;
    const { direction } = req.body; // 'up' | 'down'

    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: 'Direction invalide' });
    }

    // 🔹 Logement courant
    const currentRes = await pool.query(
      `SELECT id, display_order
       FROM properties
       WHERE id = $1 AND user_id = $2`,
      [propertyId, user.id]
    );

    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Logement introuvable' });
    }

    const current = currentRes.rows[0];
    const currentOrder = Number(current.display_order);

    // 🔹 Voisin à échanger
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
      [user.id, currentOrder]
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
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

    // VÃƒÂ©rifier si l'email existe dÃƒÂ©jÃƒÂ 
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un compte existe dÃƒÂ©jÃƒÂ  avec cet e-mail' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);
    
    // GÃƒÂ©nÃƒÂ©rer l'ID utilisateur
    const id = `u_${Date.now().toString(36)}`;

    // GÃƒÂ©nÃƒÂ©rer le token de vÃƒÂ©rification
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 heures

    // CrÃƒÂ©er l'utilisateur avec email_verified = FALSE
    await pool.query(
      `INSERT INTO users (
        id, company, first_name, last_name, email, password_hash, 
        created_at, stripe_account_id,
        email_verified, verification_token, verification_token_expires
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, $7, $8, $9)`,
      [id, company, firstName, lastName, email, passwordHash, false, verificationToken, tokenExpires]
    );

    // CrÃƒÂ©er l'abonnement trial (seulement s'il n'existe pas dÃƒÂ©jÃƒÂ )
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

    // Envoyer l'email de vÃƒÂ©rification
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
    const verificationUrl = `${appUrl}/verify-email.html?token=${verificationToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Ã¢Å“â€¦ VÃƒÂ©rifiez votre adresse email - Boostinghost',
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
              <h1>Ã°Å¸Å½â€° Bienvenue sur Boostinghost !</h1>
            </div>
            <div class="content">
              <p>Bonjour ${firstName},</p>
              
              <p>Merci de vous ÃƒÂªtre inscrit sur <strong>Boostinghost</strong> !</p>
              
              <p>Pour activer votre compte et commencer ÃƒÂ  utiliser notre plateforme, veuillez vÃƒÂ©rifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
              
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">
                  Ã¢Å“â€¦ VÃƒÂ©rifier mon email
                </a>
              </div>
              
              <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
                Si le bouton ne fonctionne pas, copiez ce lien :<br>
                <a href="${verificationUrl}" style="color: #10b981;">${verificationUrl}</a>
              </p>
              
              <p style="margin-top: 30px;">
                <strong>Ce lien est valide pendant 24 heures.</strong>
              </p>
              
              <p>Ãƒâ‚¬ trÃƒÂ¨s bientÃƒÂ´t sur Boostinghost ! Ã°Å¸Å¡â‚¬</p>
            </div>
            <div class="footer">
              <p>Cet email a ÃƒÂ©tÃƒÂ© envoyÃƒÂ© automatiquement par Boostinghost.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Email de vÃƒÂ©rification envoyÃƒÂ© ÃƒÂ :', email);
    } catch (emailErr) {
      console.error('Erreur envoi email:', emailErr);
      // On continue quand mÃƒÂªme
    }
// Retourner succÃƒÂ¨s
    res.status(201).json({
      success: true,
      message: 'Compte crÃƒÂ©ÃƒÂ© ! VÃƒÂ©rifiez votre email pour activer votre compte.',
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
    error: 'Email non vÃƒÂ©rifiÃƒÂ©',
    emailNotVerified: true,
    email: row.email,
    message: 'Veuillez vÃƒÂ©rifier votre email avant de vous connecter.'
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
    return res.status(401).json({ error: 'Token invalide ou expirÃƒÂ©' });
  }
});
// Route de vÃƒÂ©rification d'email
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token manquant' });
    }

    // VÃƒÂ©rifier le token
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

    // VÃƒÂ©rifier si le token est expirÃƒÂ©
    if (new Date() > new Date(user.verification_token_expires)) {
      return res.status(400).json({ error: 'Token expirÃƒÂ©' });
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

    console.log('Ã¢Å“â€¦ Email vÃƒÂ©rifiÃƒÂ© pour:', user.email);

    // Ã¢Å“â€¦ Envoyer email de bienvenue
    await sendWelcomeEmail(user.email, user.first_name || 'nouveau membre');
    await logEmailSent(user.id, 'welcome', { email: user.email });

    res.json({
      success: true,
      message: 'Email vÃƒÂ©rifiÃƒÂ© avec succÃƒÂ¨s !',
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
    return res.status(404).json({ error: 'RÃƒÂ©servation non trouvÃƒÂ©e' });
  }

  const customData = {
    propertyAddress: 'Adresse du logement ÃƒÂ  dÃƒÂ©finir',
    accessCode: 'Code ÃƒÂ  dÃƒÂ©finir'
  };

  const message = messagingService.generateQuickMessage(reservation, templateKey, customData);

  if (!message) {
    return res.status(404).json({ error: 'Template non trouvÃƒÂ©' });
  }

  res.json(message);
});

app.get('/api/messages/upcoming', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
// Ã°Å¸â€™Â³ ROUTES API - ABONNEMENTS (Stripe Billing)
// ============================================

function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par dÃƒÂ©faut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃƒÂ© (clÃƒÂ© secrÃƒÂ¨te manquante)' });
    }
    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }
    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configurÃƒÂ©' });
    }
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      // Ã¢Å“â€¦ AJOUTEZ LES METADATA ICI DIRECTEMENT
      metadata: {
        userId: user.id,
        plan: plan
      },
      customer_email: user.email,
      client_reference_id: user.id, // Ã¢Å“â€¦ IMPORTANT pour le webhook
      success_url: `${appUrl}/app.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing.html`,
    });
    
    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur /api/billing/create-checkout-session :', err);
    res.status(500).json({ error: 'Impossible de crÃƒÂ©er la session de paiement' });
  }
});

// ============================================
// Ã°Å¸â€™Â³ ROUTES API - STRIPE CONNECT (compte hÃƒÂ´te)
// ============================================

app.get('/api/stripe/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    if (!stripe) {
      // Stripe pas configurÃƒÂ© Ã¢â€ â€™ on indique juste "pas connectÃƒÂ©"
      return res.json({
        connected: false,
        error: 'Stripe non configurÃƒÂ© cÃƒÂ´tÃƒÂ© serveur'
      });
    }

    if (!user.stripeAccountId) {
      // LÃ¢â‚¬â„¢utilisateur nÃ¢â‚¬â„¢a encore jamais connectÃƒÂ© de compte Stripe
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
      // Si on nÃ¢â‚¬â„¢arrive pas ÃƒÂ  rÃƒÂ©cupÃƒÂ©rer le compte, on considÃƒÂ¨re "non connectÃƒÂ©"
      return res.json({
        connected: false,
        error: 'Impossible de rÃƒÂ©cupÃƒÂ©rer le compte Stripe'
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
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃƒÂ© (clÃƒÂ© secrÃƒÂ¨te manquante)' });
    }

    let accountId = user.stripeAccountId;

    // 1) Si lÃ¢â‚¬â„¢utilisateur nÃ¢â‚¬â„¢a pas encore de compte Stripe, on en crÃƒÂ©e un
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

      // On sauvegarde lÃ¢â‚¬â„¢ID du compte Stripe en base
      await pool.query(
        'UPDATE users SET stripe_account_id = $1 WHERE id = $2',
        [accountId, user.id]
      );
    }

    // 2) On crÃƒÂ©e le lien dÃ¢â‚¬â„¢onboarding pour que lÃ¢â‚¬â„¢utilisateur complÃƒÂ¨te ses infos chez Stripe
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
      error: 'Impossible de gÃƒÂ©nÃƒÂ©rer le lien Stripe : ' + (err.message || 'Erreur interne'),
      stripeType: err.type || null,
      stripeCode: err.code || null
    });
  }
});

// ============================================
// Ã°Å¸Å¡â‚¬ ROUTES API - CAUTIONS (Stripe)
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

// GET - RÃƒÂ©cupÃƒÂ©rer la caution liÃƒÂ©e ÃƒÂ  une rÃƒÂ©servation (si existe)
app.get('/api/deposits/:reservationUid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { reservationUid } = req.params;
    
    // âœ… NOUVEAU : RÃ©cupÃ©rer depuis PostgreSQL
    const deposit = await getDepositByReservation(reservationUid);
    
    res.json({ deposit });
  } catch (err) {
    console.error('Erreur GET /api/deposits:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// POST - CrÃƒÂ©er une caution Stripe pour une rÃƒÂ©servation (empreinte bancaire)
app.post('/api/deposits', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃƒÂ© (clÃƒÂ© secrÃƒÂ¨te manquante)' });
    }

    const { reservationUid, amount } = req.body;

    if (!reservationUid || !amount || amount <= 0) {
      return res.status(400).json({ error: 'reservationUid et montant (>0) sont requis' });
    }

    // Retrouver la rÃƒÂ©servation dans les rÃƒÂ©servations du user
    const result = findReservationByUidForUser(reservationUid, user.id);
    if (!result) {
      return res.status(404).json({ error: 'RÃƒÂ©servation non trouvÃƒÂ©e pour cet utilisateur' });
    }

    const { reservation, property } = result;
    const amountCents = Math.round(amount * 100);

    // CrÃƒÂ©er l'objet "caution" en mÃƒÂ©moire + fichier JSON
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
    // âœ… NOUVEAU : Sauvegarder en PostgreSQL
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
            name: `Caution sÃ©jour Ã¢â‚¬â€œ ${property ? property.name : 'Logement'}`,
            description: `Du ${reservation.start} au ${reservation.end}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      // Ã°Å¸â€Â¹ Empreinte bancaire : autorisation non capturÃƒÂ©e
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

    // Si tu as un compte Stripe Connect liÃƒÂ©, on crÃƒÂ©e la session sur CE compte
    if (user.stripeAccountId) {
      console.log('CrÃƒÂ©ation session de caution sur compte connectÃƒÂ© :', user.stripeAccountId);
      session = await stripe.checkout.sessions.create(
        sessionParams,
        { stripeAccount: user.stripeAccountId }
      );
    } else {
      console.log('CrÃƒÂ©ation session de caution sur le compte plateforme (pas de stripeAccountId)');
      session = await stripe.checkout.sessions.create(sessionParams);
    }

    deposit.stripeSessionId = session.id;
    deposit.checkoutUrl = session.url;
    // Mettre Ã  jour aprÃ¨s crÃ©ation de la session Stripe
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
    console.error('Erreur crÃƒÂ©ation caution:', err);
    return res.status(500).json({
      error: 'Erreur lors de la crÃƒÂ©ation de la caution : ' + (err.message || 'Erreur interne Stripe')
    });
  }
});
// GET - Liste des cautions d'un utilisateur
app.get('/api/deposits', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { status, propertyId } = req.query;
    
    const deposits = await getUserDeposits(user.id, { status, propertyId });
    
    res.json({ deposits });
  } catch (err) {
    console.error('Erreur GET /api/deposits:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Capturer une caution (dÃ©biter le client)
app.post('/api/deposits/:depositId/capture', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { depositId } = req.params;
    const { amountCents } = req.body;
    
    // VÃ©rifier que le deposit appartient Ã  l'utilisateur
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

// POST - LibÃ©rer une caution (annuler l'autorisation)
app.post('/api/deposits/:depositId/release', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { depositId } = req.params;
    
    // VÃ©rifier que le deposit appartient Ã  l'utilisateur
    const deposit = await pool.query(
      'SELECT * FROM deposits WHERE id = $1 AND user_id = $2',
      [depositId, user.id]
    );

    if (deposit.rows.length === 0) {
      return res.status(404).json({ error: 'Caution introuvable' });
    }

    const success = await releaseDeposit(depositId);
    
    if (!success) {
      return res.status(500).json({ error: 'Erreur lors de la libÃ©ration' });
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
      return res.status(401).json({ error: 'Non autorisÃ©' });
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
      return res.status(401).json({ error: 'Non autorisÃ©' });
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

// POST - CrÃ©er une checklist
app.post('/api/checklists', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const checklist = await createChecklist(user.id, req.body);
    
    if (!checklist) {
      return res.status(500).json({ error: 'Erreur lors de la crÃ©ation' });
    }
    
    res.status(201).json({ checklist });
  } catch (err) {
    console.error('Erreur POST /api/checklists:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Mettre Ã  jour une tÃ¢che
app.put('/api/checklists/:checklistId/tasks/:taskId', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { checklistId, taskId } = req.params;
    
    // VÃ©rifier que la checklist appartient Ã  l'utilisateur
    const checklist = await getChecklistById(checklistId, user.id);
    if (!checklist) {
      return res.status(404).json({ error: 'Checklist introuvable' });
    }
    
    const updated = await updateChecklistTask(checklistId, taskId, req.body);
    
    if (!updated) {
      return res.status(500).json({ error: 'Erreur lors de la mise Ã  jour' });
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
      return res.status(401).json({ error: 'Non autorisÃ©' });
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
      return res.status(401).json({ error: 'Non autorisÃ©' });
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

// POST - CrÃ©er un template
app.post('/api/checklist-templates', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const template = await createChecklistTemplate(user.id, req.body);
    
    if (!template) {
      return res.status(500).json({ error: 'Erreur lors de la crÃ©ation' });
    }
    
    res.status(201).json({ template });
  } catch (err) {
    console.error('Erreur POST /api/checklist-templates:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - CrÃ©er une checklist depuis un template
app.post('/api/checklist-templates/:templateId/create', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { templateId } = req.params;
    
    const checklist = await createChecklistFromTemplate(user.id, templateId, req.body);
    
    if (!checklist) {
      return res.status(500).json({ error: 'Erreur lors de la crÃ©ation' });
    }
    
    res.status(201).json({ checklist });
  } catch (err) {
    console.error('Erreur POST /api/checklist-templates/create:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - GÃ©nÃ©rer les checklists automatiques pour une rÃ©servation
app.post('/api/reservations/:reservationUid/generate-checklists', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃ©' });
    }

    const { reservationUid } = req.params;
    
    const checklists = await generateChecklistsForReservation(user.id, reservationUid);
    
    res.status(201).json({ 
      message: `${checklists.length} checklists crÃ©Ã©es`,
      checklists 
    });
  } catch (err) {
    console.error('Erreur POST /api/reservations/generate-checklists:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// ROUTES API - FACTURATION PROPRIÃƒâ€°TAIRES
// ============================================
// Ãƒâ‚¬ ajouter dans server.js
// 
// IMPORTANT : Ne pas re-dÃƒÂ©clarer ces variables si elles existent dÃƒÂ©jÃƒÂ  :
// - const multer = require('multer');
// - const path = require('path');
// - const ExcelJS = require('exceljs');
//
// Chercher dans server.js si elles sont dÃƒÂ©jÃƒÂ  prÃƒÂ©sentes, sinon les ajouter EN HAUT du fichier
// ============================================
// ROUTES API - ABONNEMENTS STRIPE
// Ãƒâ‚¬ COPIER-COLLER DANS server.js APRÃƒË†S LES AUTRES ROUTES
// ============================================

// Helper : RÃƒÂ©cupÃƒÂ©rer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par dÃƒÂ©faut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

// POST - CrÃƒÂ©er une session de paiement Stripe
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

    // CrÃƒÂ©er la session Stripe Checkout
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

// GET - RÃƒÂ©cupÃƒÂ©rer le statut d'abonnement de l'utilisateur
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

// POST - CrÃƒÂ©er un lien vers le portail client Stripe
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configure' });
    }

    // RÃƒÂ©cupÃƒÂ©rer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouve' });
    }

    const customerId = result.rows[0].stripe_customer_id;
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃƒÂ©er la session du portail
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
    cb(new Error('Format de fichier non supportÃƒÂ©'));
  }
});

// ============================================
// CLIENTS PROPRIÃƒâ€°TAIRES - CRUD
// ============================================

// 1. LISTE DES CLIENTS
app.get('/api/owner-clients', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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

// 2. DÃƒâ€°TAIL D'UN CLIENT
app.get('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const result = await pool.query(
      'SELECT * FROM owner_clients WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvÃƒÂ©' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur dÃƒÂ©tail client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 3. CRÃƒâ€°ER UN CLIENT
app.post('/api/owner-clients', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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
      return res.status(400).json({ error: 'Nom et prÃƒÂ©nom requis' });
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
    console.error('Erreur crÃƒÂ©ation client:', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});
app.put('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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
      return res.status(404).json({ error: 'Client non trouvÃƒÂ©' });
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const clientId = req.params.id;

    // OPTIONNEL : bloquer si des factures existent dÃƒÂ©jÃƒÂ  pour ce client
    const invRes = await pool.query(
      'SELECT COUNT(*) FROM owner_invoices WHERE client_id = $1 AND user_id = $2',
      [clientId, user.id]
    );
    const invCount = parseInt(invRes.rows[0].count, 10) || 0;
    if (invCount > 0) {
      return res.status(400).json({
        error: 'Impossible de supprimer un client qui a dÃƒÂ©jÃƒÂ  des factures.'
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    // VÃƒÂ©rifier qu'il n'y a pas de factures liÃƒÂ©es
    const checkInvoices = await pool.query(
      'SELECT COUNT(*) as count FROM owner_invoices WHERE client_id = $1',
      [req.params.id]
    );

    if (parseInt(checkInvoices.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Impossible de supprimer : ce client a des factures associÃƒÂ©es' 
      });
    }

    const result = await pool.query(
      'DELETE FROM owner_clients WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client non trouvÃƒÂ©' });
    }

    res.json({ message: 'Client supprimé' });
  } catch (err) {
    console.error('Erreur suppression client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API V2 - FACTURATION PROPRIÃƒâ€°TAIRES
// ============================================
// NOUVELLES ROUTES ÃƒÂ  ajouter APRÃƒË†S les routes V1 existantes

// ============================================
// ARTICLES (CATALOGUE)
// ============================================

// 1. LISTE DES ARTICLES
app.get('/api/owner-articles', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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

// 2. CRÃƒâ€°ER UN ARTICLE
app.post('/api/owner-articles', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const { articleType, name, description, unitPrice, commissionRate } = req.body;

    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const result = await pool.query(`
      INSERT INTO owner_articles (user_id, article_type, name, description, unit_price, commission_rate)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [user.id, articleType, name, description, unitPrice || 0, commissionRate || 0]);

    res.json({ article: result.rows[0] });
  } catch (err) {
    console.error('Erreur crÃƒÂ©ation article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 3. MODIFIER UN ARTICLE
app.put('/api/owner-articles/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const { name, description, unitPrice, commissionRate } = req.body;

    const result = await pool.query(`
      UPDATE owner_articles 
      SET name = $1, description = $2, unit_price = $3, commission_rate = $4
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [name, description, unitPrice, commissionRate, req.params.id, user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article non trouvÃƒÂ©' });
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const result = await pool.query(
      'UPDATE owner_articles SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article non trouvÃƒÂ©' });
    }

    res.json({ message: 'Article supprimé' });
  } catch (err) {
    console.error('Erreur suppression article:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 5. CRÃƒâ€°ER ARTICLES PAR DÃƒâ€°FAUT
app.post('/api/owner-articles/init-defaults', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    await pool.query('SELECT create_default_owner_articles($1)', [user.id]);

    res.json({ message: 'Articles par défaut crés' });
  } catch (err) {
    console.error('Erreur init articles:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FACTURES PROPRIÃƒâ€°TAIRES - LISTE & CRÃƒâ€°ATION
// ============================================

// 1. LISTE DES FACTURES PROPRIÃƒâ€°TAIRES
app.get('/api/owner-invoices', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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
    console.error('Erreur liste factures propriÃƒÂ©taires:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. CRÃƒâ€°ER UNE NOUVELLE FACTURE PROPRIÃƒâ€°TAIRE (BROUILLON PAR DÃƒâ€°FAUT)
app.post('/api/owner-invoices', async (req, res) => {
  const client = await pool.connect();

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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
      return res.status(400).json({ error: 'DonnÃƒÂ©es facture incomplÃƒÂ¨tes' });
    }

    await client.query('BEGIN');

    // Recalculer les totaux de la mÃƒÂªme faÃƒÂ§on que dans le PUT /api/owner-invoices/:id
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

    // CrÃƒÂ©ation de la facture (brouillon)
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
// Sauvegarder les logements liÃƒÂ©s
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
    console.error('Erreur crÃƒÂ©ation facture propriÃƒÂ©taire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});
// 2bis. RÃƒâ€°CUPÃƒâ€°RER UNE FACTURE PROPRIÃƒâ€°TAIRE PAR ID
app.get('/api/owner-invoices/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const invoiceId = req.params.id;

    // Facture
    const invResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (invResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    const invoice = invResult.rows[0];

    // Lignes
    // RÃƒÂ©cupÃƒÂ©rer les logements liÃƒÂ©s
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
    console.error('Erreur lecture facture propriÃƒÂ©taire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// CRÃƒâ€°ER UN AVOIR SUR UNE FACTURE EXISTANTE
app.post('/api/owner-invoices/:id/credit-note', async (req, res) => {
  const client = await pool.connect();

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const invoiceId = req.params.id;

    // RÃƒÂ©cupÃƒÂ©rer la facture d'origine
    const origResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (origResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    const orig = origResult.rows[0];

    if (orig.is_credit_note) {
      return res.status(400).json({ error: 'Impossible de crÃƒÂ©er un avoir sur un avoir.' });
    }
    if (orig.status === 'draft') {
      return res.status(400).json({ error: 'On ne peut crÃƒÂ©er un avoir que sur une facture facturÃƒÂ©e.' });
    }

    await client.query('BEGIN');

    // Totaux nÃƒÂ©gatifs pour l'avoir
    const creditSubtotalHt     = -Number(orig.subtotal_ht     || 0);
    const creditSubtotalDebours = -Number(orig.subtotal_debours || 0);
    const creditVatAmount      = -Number(orig.vat_amount      || 0);
    const creditTotalTtc       = -Number(orig.total_ttc       || 0);
    const creditDiscountAmount = -Number(orig.discount_amount || 0);

    // CrÃƒÂ©er la facture d'avoir (statut "invoiced" directement)
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

    // GÃƒÂ©nÃƒÂ©rer un numÃƒÂ©ro d'avoir type A-2025-0007
    const year = new Date().getFullYear();
    const creditNumber = `A-${year}-${String(creditId).padStart(4, '0')}`;

    await client.query(
      'UPDATE owner_invoices SET invoice_number = $1 WHERE id = $2',
      [creditNumber, creditId]
    );

    // Copier les lignes en nÃƒÂ©gatif
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

    // Renvoie l'avoir crÃƒÂ©ÃƒÂ©
    res.json({ invoice: { ...credit, invoice_number: creditNumber } });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur crÃƒÂ©ation avoir propriÃƒÂ©taire:', err);
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
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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

    // GÃƒÂ©nÃƒÂ©rer le numÃƒÂ©ro de facture
    const invoiceNumber = 'FACT-' + Date.now();
    const invoiceId = 'inv_' + Date.now();

    // Calculer les montants
    const subtotal = parseFloat(rentAmount || 0) + parseFloat(touristTaxAmount || 0) + parseFloat(cleaningFee || 0);
    const vatAmount = subtotal * (parseFloat(vatRate || 0) / 100);
    const total = subtotal + vatAmount;

    

    
// GÃƒÂ©nÃƒÂ©rer un PDF simple (serveur) avec PDFKit
    async function generateInvoicePdfToFile(outputPath) {
      return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);

        doc.fontSize(20).text(`FACTURE ${invoiceNumber}`, { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Ãƒâ€°metteur : ${user.company || 'Conciergerie'}`);
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
          doc.text(`SÃƒÂ©jour : du ${ci} au ${co} (${nights} nuit${nights > 1 ? 's' : ''})`);
        }

        doc.moveDown();
        doc.fontSize(13).text('DÃƒÂ©tails', { underline: true });
        doc.moveDown(0.5);

        const addLine = (label, value) => {
          doc.fontSize(12).text(`${label} : ${Number(value).toFixed(2)} Ã¢â€šÂ¬`);
        };
// Ã¢Å“â€¦ Download facture PDF via token expirant
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
      return res.status(410).send('Lien expirÃƒÂ©.');
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
    console.error('Ã¢ÂÅ’ Erreur download invoice:', err);
    res.status(500).send('Erreur serveur.');
  }
});

        if (parseFloat(rentAmount || 0) > 0) addLine('Loyer', rentAmount);
        if (parseFloat(touristTaxAmount || 0) > 0) addLine('Taxes de sÃ©jour', touristTaxAmount);
        if (parseFloat(cleaningFee || 0) > 0) addLine('Frais de mÃƒÂ©nage', cleaningFee);

        doc.moveDown();
        doc.fontSize(12).text(`Sous-total : ${subtotal.toFixed(2)} Ã¢â€šÂ¬`);
        if (vatAmount > 0) doc.text(`TVA (${vatRate}%) : ${vatAmount.toFixed(2)} Ã¢â€šÂ¬`);
        doc.fontSize(16).text(`TOTAL TTC : ${total.toFixed(2)} Ã¢â€šÂ¬`, { underline: true });

        doc.end();

        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    }

// Si sendEmail est true, envoyer l'email via API Brevo

    if (sendEmail && clientEmail) {
      const profile = user;
      

      // 1) GÃƒÂ©nÃƒÂ©rer le fichier PDF
      const pdfPath = path.join(INVOICE_PDF_DIR, `${invoiceNumber}.pdf`);
      await generateInvoicePdfToFile(pdfPath);

      // 2) CrÃƒÂ©er un token expirant 24h
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO invoice_download_tokens (token, user_id, invoice_number, file_path, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token, user.id, invoiceNumber, pdfPath, expiresAt]
      );

      // 3) Construire lÃ¢â‚¬â„¢URL de download (idÃƒÂ©alement via env)
      const origin = new URL(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).origin;
const pdfUrl = `${origin}/api/invoice/download/${token}`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111827;">Facture NÃ‚Â° ${invoiceNumber}</h2>
          <p><strong>De :</strong> ${profile.company || 'Conciergerie'}</p>
          <p><strong>Pour :</strong> ${clientName}</p>
          <p><strong>Logement :</strong> ${propertyName}</p>
          ${propertyAddress ? `<p><strong>Adresse :</strong> ${propertyAddress}</p>` : ''}
          ${checkinDate && checkoutDate ? `<p><strong>SÃƒÂ©jour :</strong> Du ${new Date(checkinDate).toLocaleDateString('fr-FR')} au ${new Date(checkoutDate).toLocaleDateString('fr-FR')} (${nights} nuit${nights > 1 ? 's' : ''})</p>` : ''}
          
          <h3 style="margin-top: 24px; color: #374151;">DÃƒÂ©tails de la facture</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${rentAmount > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Loyer</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(rentAmount).toFixed(2)} Ã¢â€šÂ¬</td></tr>` : ''}
            ${touristTaxAmount > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Taxes de sÃ©jour</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(touristTaxAmount).toFixed(2)} Ã¢â€šÂ¬</td></tr>` : ''}
            ${cleaningFee > 0 ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Frais de mÃƒÂ©nage</td><td style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb;">${parseFloat(cleaningFee).toFixed(2)} Ã¢â€šÂ¬</td></tr>` : ''}
          </table>
          
          <p style="margin-top: 16px; font-weight: 600;">Sous-total : ${subtotal.toFixed(2)} Ã¢â€šÂ¬</p>
          ${vatAmount > 0 ? `<p style="font-weight: 600;">TVA (${vatRate}%) : ${vatAmount.toFixed(2)} Ã¢â€šÂ¬</p>` : ''}
          <h3 style="font-size: 20px; color: #10B981; margin-top: 24px;">TOTAL TTC : ${total.toFixed(2)} Ã¢â€šÂ¬</h3>
          
          <div style="background: #ecfdf5; border: 2px solid #10B981; border-radius: 8px; padding: 16px; margin-top: 24px; text-align: center;">
            <p style="color: #10B981; font-weight: bold; margin: 0; font-size: 18px;">Ã¢Å“â€œ FACTURE ACQUITTÃƒâ€°E</p>
          </div>

          <div style="margin-top: 18px; text-align: center;">
            <a href="${pdfUrl}"
              style="display:inline-block; padding:12px 18px; background:#111827; color:#fff; text-decoration:none; border-radius:10px; font-weight:700;">
              TÃƒÂ©lÃƒÂ©charger la facture (PDF)
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
        
        console.log('Ã¢Å“â€¦ Email facture client envoyÃƒÂ© ÃƒÂ :', clientEmail);

      } catch (emailErr) {
        console.error('Ã¢ÂÅ’ Erreur envoi email facture client:', emailErr);
      }
    }
    
    res.json({ 
      success: true, 
      invoiceNumber,
      invoiceId,
      message: 'Facture crÃƒÂ©ÃƒÂ©e avec succÃƒÂ¨s' 
    });
    
  } catch (err) {
    console.error('Erreur crÃƒÂ©ation facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// FACTURES - ROUTES MODIFIÃƒâ€°ES (AVEC RÃƒâ€°DUCTIONS)
// ============================================

// 6. MODIFIER UNE FACTURE BROUILLON
app.put('/api/owner-invoices/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    // VÃƒÂ©rifier que c'est un brouillon
    const checkResult = await client.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent ÃƒÂªtre modifiÃƒÂ©s' });
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

    // Calculer rÃƒÂ©duction
    let discountAmount = 0;
    if (discountType === 'percentage') {
      discountAmount = subtotalHt * (parseFloat(discountValue) / 100);
    } else if (discountType === 'fixed') {
      discountAmount = parseFloat(discountValue);
    }

    const netHt = subtotalHt - discountAmount;
    const vatAmount = vatApplicable ? netHt * (parseFloat(vatRate) / 100) : 0;
    const totalTtc = netHt + subtotalDebours + vatAmount;

    // Mettre ÃƒÂ  jour facture
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

    // InsÃƒÂ©rer nouvelles lignes
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

    res.json({ success: true, message: 'Facture modifiÃƒÂ©e' });


// TÃƒÂ©lÃƒÂ©charger une facture PDF via token expirant
    console.log('Ã¢Å“â€¦ REGISTER: /api/invoice/download/:token');
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
      return res.status(410).send('Lien expirÃƒÂ©.');
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
    console.error('Ã¢ÂÅ’ Erreur download invoice:', err);
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
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    // VÃƒÂ©rifier que c'est un brouillon
    const checkResult = await pool.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent ÃƒÂªtre supprimÃƒÂ©s. CrÃƒÂ©ez un avoir pour annuler.' });
    }

    await pool.query('DELETE FROM owner_invoices WHERE id = $1', [req.params.id]);

    res.json({ message: 'Facture supprimée' });
  } catch (err) {
    console.error('Erreur suppression facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// 2bis. VALIDER UNE FACTURE (BROUILLON -> FACTURÃƒâ€°E)
app.post('/api/owner-invoices/:id/finalize', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const invoiceId = req.params.id;

    // RÃƒÂ©cupÃƒÂ©rer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    const invoice = result.rows[0];

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Seuls les brouillons peuvent ÃƒÂªtre validÃƒÂ©s.' });
    }

    // GÃƒÂ©nÃƒÂ©rer un numÃƒÂ©ro si absent
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
    console.error('Erreur finalisation facture propriÃƒÂ©taire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 8. ENVOYER UN BROUILLON
app.post('/api/owner-invoices/:id/send', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    // RÃƒÂ©cupÃƒÂ©rer la facture
    const invoiceResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Cette facture a dÃƒÂ©jÃƒÂ  ÃƒÂ©tÃƒÂ© envoyÃƒÂ©e' });
    }

    // RÃƒÂ©cupÃƒÂ©rer les items
    const itemsResult = await pool.query(
      'SELECT * FROM owner_invoice_items WHERE invoice_id = $1 ORDER BY order_index',
      [req.params.id]
    );

    // Mettre ÃƒÂ  jour statut
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

    res.json({ success: true, message: 'Facture envoyÃƒÂ©e' });

  } catch (err) {
    console.error('Erreur envoi facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// MARQUER UNE FACTURE COMME ENCAISSÃƒâ€°E
app.post('/api/owner-invoices/:id/mark-paid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const invoiceId = req.params.id;

    // RÃƒÂ©cupÃƒÂ©rer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    const invoice = result.rows[0];

    if (invoice.status === 'draft') {
      return res.status(400).json({ error: 'Vous devez d\'abord valider cette facture.' });
    }

    // Marquer comme payÃƒÂ©e (sans paid_at)
    const updateResult = await pool.query(
      `UPDATE owner_invoices
       SET status = 'paid'
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [invoiceId, user.id]
    );

    res.json({ success: true, invoice: updateResult.rows[0] });
  } catch (err) {
    console.error('Erreur marquage facture payÃƒÂ©e:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// ============================================
// AVOIRS
// ============================================

// 9. CRÃƒâ€°ER UN AVOIR
app.post('/api/owner-credit-notes', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    await client.query('BEGIN');

    const { invoiceId, reason } = req.body;

    // RÃƒÂ©cupÃƒÂ©rer la facture d'origine
    const invoiceResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
    );

    if (invoiceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture non trouvÃƒÂ©e' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.status !== 'sent' && invoice.status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Seules les factures envoyÃƒÂ©es peuvent avoir un avoir' });
    }

    // VÃƒÂ©rifier qu'il n'y a pas dÃƒÂ©jÃƒÂ  un avoir
    const existingCredit = await client.query(
      'SELECT id FROM owner_credit_notes WHERE original_invoice_id = $1',
      [invoiceId]
    );

    if (existingCredit.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Un avoir existe dÃƒÂ©jÃƒÂ  pour cette facture' });
    }

    // GÃƒÂ©nÃƒÂ©rer numÃƒÂ©ro avoir
    const creditNumberResult = await client.query(
      'SELECT get_next_credit_note_number($1) as credit_note_number',
      [user.id]
    );
    const creditNoteNumber = creditNumberResult.rows[0].credit_note_number;

    // CrÃƒÂ©er l'avoir (montants nÃƒÂ©gatifs)
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

    // Copier les lignes (nÃƒÂ©gatif)
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

    // Mettre ÃƒÂ  jour facture (lien vers avoir + statut cancelled)
    await client.query(
      'UPDATE owner_invoices SET credit_note_id = $1, status = $2 WHERE id = $3',
      [creditNoteId, 'cancelled', invoiceId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      creditNoteId,
      creditNoteNumber,
      message: 'Avoir crÃƒÂ©ÃƒÂ© et facture annulÃƒÂ©e'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur crÃƒÂ©ation avoir:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// 10. LISTE DES AVOIRS
app.get('/api/owner-credit-notes', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

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

// 11. DÃƒâ€°TAIL AVOIR
app.get('/api/owner-credit-notes/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisÃƒÂ©' });

    const creditResult = await pool.query(
      'SELECT * FROM owner_credit_notes WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (creditResult.rows.length === 0) {
      return res.status(404).json({ error: 'Avoir non trouvÃƒÂ©' });
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
    console.error('Erreur dÃƒÂ©tail avoir:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// FIN DES ROUTES V2
// ============================================
// ============================================
// Ã¢Å“â€¦ NOUVEAU : ROUTES POUR LIVRETS D'ACCUEIL
// ============================================
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/api/welcome-books', welcomeRouter);
// ============================================
// ============================================
// NOTES D'INSTALLATION
// ============================================

/*
1. Installer les dÃƒÂ©pendances :
   npm install exceljs

2. CrÃƒÂ©er le dossier uploads :
   mkdir -p public/uploads/justificatifs

3. Les dÃƒÂ©pendances nodemailer et pdfkit sont dÃƒÂ©jÃƒÂ  installÃƒÂ©es
*/
// ============================================
// ROUTES STRIPE - Ãƒâ‚¬ AJOUTER DANS server.js
// Copier APRÃƒË†S les autres routes API, AVANT app.listen()
// ============================================

// Helper : RÃƒÂ©cupÃƒÂ©rer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par dÃƒÂ©faut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

// ============================================
// POST /api/billing/create-checkout-session
// CrÃƒÂ©er une session de paiement Stripe
// ============================================
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃƒÂ©' });
    }

    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configurÃƒÂ©' });
    }

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃƒÂ©er la session Stripe Checkout
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
    res.status(500).json({ error: 'Impossible de crÃƒÂ©er la session de paiement' });
  }
});

// ============================================
// GET /api/subscription/status
// RÃƒÂ©cupÃƒÂ©rer le statut d'abonnement de l'utilisateur
// ============================================
app.get('/api/subscription/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
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
        error: 'Aucun abonnement trouvÃƒÂ©',
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
        displayMessage = 'PÃƒÂ©riode essai expirÃƒÂ©e';
      }
    } else if (subscription.status === 'active') {
      displayMessage = `Abonnement ${subscription.plan_type === 'pro' ? 'Pro' : 'Basic'} actif`;
    } else if (subscription.status === 'expired') {
      displayMessage = 'Abonnement expirÃƒÂ©';
    } else if (subscription.status === 'canceled') {
      displayMessage = 'Abonnement annulÃƒÂ©';
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
// CrÃƒÂ©er un lien vers le portail client Stripe
// ============================================
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configurÃƒÂ©' });
    }

    // RÃƒÂ©cupÃƒÂ©rer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouvÃƒÂ©' });
    }

    const customerId = result.rows[0].stripe_customer_id;
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // CrÃƒÂ©er la session du portail
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings-account.html?tab=subscription`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Erreur create-portal-session:', err);
    res.status(500).json({ error: 'Impossible de crÃƒÂ©er la session portail' });
  }
});

// ============================================
// POST /api/webhooks/stripe
// Webhook Stripe (ÃƒÂ©vÃƒÂ©nements de paiement)
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
    console.error('Erreur vÃƒÂ©rification webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Webhook Stripe reÃƒÂ§u:', event.type);

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

        // RÃƒÂ©cupÃƒÂ©rer la subscription Stripe
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Mettre ÃƒÂ  jour la base de donnÃƒÂ©es
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

        console.log(`Abonnement crÃƒÂ©ÃƒÂ© pour user ${userId} (plan: ${plan})`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        // DÃƒÂ©terminer le statut
        let status = 'active';
        if (subscription.status === 'trialing') status = 'trial';
        else if (subscription.status === 'canceled') status = 'canceled';
        else if (subscription.status === 'past_due') status = 'past_due';

        // Mettre ÃƒÂ  jour en base
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = $1,
             current_period_end = to_timestamp($2),
             updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscriptionId]
        );

        console.log(`Abonnement ${subscriptionId} mis ÃƒÂ  jour: ${status}`);
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

        console.log(`Abonnement ${subscriptionId} annulÃƒÂ©`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        // Passer de trial ÃƒÂ  active si c'ÃƒÂ©tait le premier paiement
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = 'active',
             updated_at = NOW()
           WHERE stripe_subscription_id = $1 AND status = 'trial'`,
          [subscriptionId]
        );

        console.log(`Paiement rÃƒÂ©ussi pour subscription ${subscriptionId}`);
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

        console.log(`Paiement ÃƒÂ©chouÃƒÂ© pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Ãƒâ€°vÃƒÂ©nement non gÃƒÂ©rÃƒÂ©: ${event.type}`);
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
// Ãƒâ‚¬ AJOUTER DANS server.js
// ============================================

// ============================================
// CRON JOB : VÃƒÂ©rifier et envoyer les emails automatiques
// S'exÃƒÂ©cute toutes les heures
// ============================================
cron.schedule('0 * * * *', async () => {
  console.log('Ã°Å¸â€â€ž VÃƒÂ©rification des emails automatiques ÃƒÂ  envoyer...');
  
  try {
    // RÃƒÂ©cupÃƒÂ©rer tous les utilisateurs avec leur abonnement
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
        // EMAIL 1 : BIENVENUE (si jamais envoyÃƒÂ©)
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
            // VÃƒÂ©rifier si un email de rappel a ÃƒÂ©tÃƒÂ© envoyÃƒÂ© pour cette pÃƒÂ©riode
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

    console.log('Ã¢Å“â€¦ VÃƒÂ©rification des emails automatiques terminÃƒÂ©e');

  } catch (err) {
    console.error('Ã¢ÂÅ’ Erreur cron emails automatiques:', err);
  }
});

console.log('Ã¢ÂÂ° TÃƒÂ¢che CRON emails automatiques activÃƒÂ©e (toutes les heures)');

// ============================================
// MODIFIER LE WEBHOOK : ENVOYER EMAIL CONFIRMATION
// ============================================
// Dans le case 'checkout.session.completed' de votre webhook,
// ajoutez ceci aprÃƒÂ¨s la mise ÃƒÂ  jour de la base de donnÃƒÂ©es :

/*
case 'checkout.session.completed': {
  // ... votre code existant ...
  
  await pool.query(...); // Mise ÃƒÂ  jour de la base

  // Ã¢Å“â€¦ AJOUTER ICI : Envoyer email de confirmation
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

  console.log(`Ã¢Å“â€¦ Abonnement ACTIF crÃƒÂ©ÃƒÂ© pour user ${userId} (plan: ${plan})`);
  break;
}
*/

// ============================================
// FIN DU SCRIPT CRON
// ============================================

// Route pour supprimer une rÃƒÂ©servation manuelle ou un blocage
app.post('/api/manual-reservations/delete', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('Ã¢ÂÅ’ Suppression refusÃƒÂ©e : utilisateur non authentifiÃƒÂ©');
      return res.status(401).json({ error: 'Non autorisÃƒÂ©' });
    }

    const { propertyId, uid } = req.body || {};
    console.log('Ã°Å¸â€”â€˜ Demande de suppression manuelle reÃƒÂ§ue :', {
      userId: user.id,
      propertyId,
      uid
    });

    if (!propertyId || !uid) {
      console.log('Ã¢ÂÅ’ RequÃƒÂªte invalide pour suppression : propertyId ou uid manquant', {
        propertyId,
        uid
      });
      return res.status(400).json({ error: 'propertyId et uid sont requis' });
    }

    const property = PROPERTIES.find(
      (p) => p.id === propertyId && p.userId === user.id
    );
    if (!property) {
      console.log('Ã¢ÂÅ’ Logement non trouvÃƒÂ© pour suppression', {
        propertyId,
        userId: user.id
      });
      return res.status(404).json({ error: 'Logement non trouvÃƒÂ©' });
    }

    if (!MANUAL_RESERVATIONS[propertyId] || MANUAL_RESERVATIONS[propertyId].length === 0) {
      console.log('Ã¢ÂÅ’ Aucune rÃƒÂ©servation/blocage trouvÃƒÂ© pour ce logement', {
        propertyId,
        uid
      });
      return res.status(404).json({ error: 'RÃƒÂ©servation/blocage non trouvÃƒÂ©' });
    }

    const initialLength = MANUAL_RESERVATIONS[propertyId].length;
    MANUAL_RESERVATIONS[propertyId] =
      MANUAL_RESERVATIONS[propertyId].filter((r) => r.uid !== uid);
    const newLength = MANUAL_RESERVATIONS[propertyId].length;

    console.log('Ã°Å¸â€œÅ  Suppression dans MANUAL_RESERVATIONS :', {
      propertyId,
      uid,
      initialLength,
      newLength
    });

    if (initialLength === newLength) {
      console.log(
        'Ã¢ÂÅ’ Aucune entrÃƒÂ©e supprimÃƒÂ©e (uid non trouvÃƒÂ© dans MANUAL_RESERVATIONS)',
        { propertyId, uid }
      );
      return res.status(404).json({ error: 'RÃƒÂ©servation/blocage non trouvÃƒÂ©' });
    }

    await saveManualReservations();
    console.log('Ã°Å¸â€™Â¾ MANUAL_RESERVATIONS sauvegardÃƒÂ© aprÃƒÂ¨s suppression');

    if (reservationsStore.properties[propertyId]) {
      const initialStoreLength = reservationsStore.properties[propertyId].length;
      reservationsStore.properties[propertyId] =
        reservationsStore.properties[propertyId].filter((r) => r.uid !== uid);
      const newStoreLength = reservationsStore.properties[propertyId].length;

      console.log('Ã°Å¸Â§Â® reservationsStore mis ÃƒÂ  jour :', {
        propertyId,
        uid,
        initialStoreLength,
        newStoreLength
      });
    } else {
      console.log(
        'Ã¢â€žÂ¹Ã¯Â¸Â Aucun entry dans reservationsStore pour ce propertyId au moment de la suppression',
        { propertyId }
      );
    }

    res.status(200).json({
      success: true,
      message: 'RÃƒÂ©servation/blocage supprimÃƒÂ©'
    });
  } catch (err) {
    console.error('Erreur suppression rÃƒÂ©servation manuelle:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// DEBUG: vÃƒÂ©rifier que les GET fonctionnent et lister les routes chargÃƒÂ©es
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
// Ã¢Å“â€¦ ROUTE PUBLIQUE LIVRET D'ACCUEIL (VERSION PREMIUM)
// ============================================
app.get('/welcome/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    
    // 1. RÃ©cupÃ©ration des donnÃ©es
    const result = await pool.query(
      `SELECT data FROM welcome_books_v2 WHERE unique_id = $1`, 
      [uniqueId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send("<h1>Livret introuvable</h1>");
    }
    
    const d = result.rows[0].data || {};

    // 2. PrÃ©paration des variables (Correction du Titre ici)
    // On s'assure que si une info manque, on met un texte vide
    const title = d.propertyName || "Mon Livret d'Accueil";
    const coverPhoto = (d.photos && d.photos.cover) ? d.photos.cover : 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=2070&auto=format&fit=crop';
    
    // 3. GÃ©nÃ©ration du HTML "Design Moderne"
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

        /* GRID INFO CLÃƒâ€°S */
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

        /* LISTES (Restaurants, PiÃƒÂ¨ces) */
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
          <p>${(d.welcomeDescription || 'Bienvenue chez nous ! Passez un excellent sÃ©jour.').replace(/\n/g, '<br>')}</p>
        </div>

        <div class="key-info-grid">
          <div class="info-item">
            <div class="info-label">ArrivÃ©e</div>
            <div class="info-value">${d.accessInstructions ? 'Voir instructions' : 'DÃ¨s 15h'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">DÃ©part</div>
            <div class="info-value">Avant ${d.checkoutTime || '11h00'}</div>
          </div>
          ${d.keyboxCode ? `
          <div class="info-item">
            <div class="info-label">BoÃƒÂ®te ÃƒÂ  clÃƒÂ©s</div>
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
          <div class="section-title"><i class="fas fa-key"></i> AccÃ¨s au logement</div>
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
           <div class="section-title"><i class="fas fa-clipboard-check"></i> RÃ¨gles & DÃ©part</div>
           ${d.importantRules ? `<p><strong>Ã€ savoir :</strong><br>${d.importantRules.replace(/\n/g, '<br>')}</p><br>` : ''}
           ${d.checkoutInstructions ? `<p><strong>Au dÃ©part :</strong><br>${d.checkoutInstructions.replace(/\n/g, '<br>')}</p>` : ''}
        </div>

        ${(d.restaurants?.length > 0 || d.places?.length > 0) ? `
        <div class="card">
          <div class="section-title"><i class="fas fa-map-signs"></i> Guide Local</div>
          
          ${d.restaurants && d.restaurants.length > 0 ? `
            <h4 style="margin:1rem 0 0.5rem 0; color:#64748b;">Ã°Å¸ÂÂ½Ã¯Â¸Â Restaurants</h4>
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
            <h4 style="margin:1.5rem 0 0.5rem 0; color:#64748b;">Ã°Å¸Ââ€ºÃ¯Â¸Â Ã€ visiter</h4>
            ${d.places.map(place => `
              <div class="list-item">
                <div class="item-title">${place.name}</div>
                <p class="item-desc">${place.description}</p>
              </div>
            `).join('')}
          ` : ''}
        </div>` : ''}

        <div class="footer">
          <p>Livret propulsÃ© par BoostingHost</p>
        </div>

      </div>

      ${d.contactPhone ? `
      <a href="tel:${d.contactPhone}" class="fab" title="Contacter l'hÃ´te">
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
// ✅ CRÉATION DU SERVEUR HTTP + SOCKET.IO
// ============================================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.APP_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ============================================
// ✅ INITIALISATION DES ROUTES DU CHAT
// ============================================
setupChatRoutes(app, pool, io, authenticateToken, checkSubscription);
console.log('✅ Routes du chat initialisées');

// ============================================
// DÉMARRAGE (TOUJOURS EN DERNIER)
// ============================================

server.listen(PORT, async () => {
  console.log('');
  console.log('Ã¢â€¢â€Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢â€”');
  console.log('Ã¢â€¢â€˜   Ã°Å¸ÂÂ  LCC Booking Manager - SystÃƒÂ¨me de RÃƒÂ©servations    Ã¢â€¢â€˜');
  console.log('Ã¢â€¢Å¡Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â');
  console.log('');
  console.log(`Ã°Å¸Å¡â‚¬ Serveur dÃƒÂ©marrÃƒÂ© sur http://localhost:${PORT}`);
  console.log('');

  await initDb();
  // Ã¢Å“â€¦ NOUVEAU : Initialiser les tables livrets d'accueil
  app.locals.pool = pool;
  await initWelcomeBookTables(pool);
  console.log('Ã¢Å“â€¦ Tables welcome_books initialisÃƒÂ©es');
  await loadProperties();
    // âœ… NOUVEAU : Charger les rÃ©servations depuis PostgreSQL
  await loadReservationsFromDB();
  
  // Migration one-time (Ã  dÃ©commenter UNE SEULE FOIS pour migrer)
  // await migrateManualReservationsToPostgres();
  await loadManualReservations();
  // âœ… NOUVEAU : Charger depuis PostgreSQL
  await loadDepositsFromDB();
  
  // Migration one-time (Ã  dÃ©commenter UNE SEULE FOIS)
  // await migrateDepositsToPostgres();
  await loadChecklists();

  console.log('Logements configurÃƒÂ©s:');
  PROPERTIES.forEach(p => {
    const status = p.icalUrls && p.icalUrls.length > 0 ? 'Ã¢Å“â€¦' : 'Ã¢Å¡Â Ã¯Â¸Â';
    console.log(`  ${status} ${p.name} (${p.icalUrls.length} source${p.icalUrls.length > 1 ? 's' : ''})`);
  });
  console.log('');

  console.log('Ã°Å¸â€â€ž Synchronisation initiale...');
  await syncAllCalendars();

  const syncInterval = parseInt(process.env.SYNC_INTERVAL) || 15;
  cron.schedule(`*/${syncInterval} * * * *`, async () => {
    console.log('');
    console.log('Ã¢ÂÂ° Synchronisation automatique programmÃƒÂ©e');
    await syncAllCalendars();
  });

  const cleaningPlanHour = parseInt(process.env.CLEANING_PLAN_HOUR || '18', 10); // heure FR (18h par dÃƒÂ©faut)
  cron.schedule(`0 ${cleaningPlanHour} * * *`, async () => {
    console.log('');
    console.log(`Ã¢ÂÂ° Envoi du planning mÃƒÂ©nage quotidien (pour demain) ÃƒÂ  ${cleaningPlanHour}h`);
    try {
      await sendDailyCleaningPlan();
    } catch (err) {
      console.error('Ã¢ÂÅ’ Erreur lors de lÃ¢â‚¬â„¢envoi du planning mÃƒÂ©nage quotidien :', err);
    }
  });

  console.log('');
  console.log(`Ã¢ÂÂ° Synchronisation automatique: toutes les ${syncInterval} minutes`);
  console.log('');
  console.log('Ã°Å¸â€œÂ§ Notifications configurÃƒÂ©es:', process.env.EMAIL_USER ? 'Ã¢Å“â€¦ OUI' : 'Ã¢Å¡Â Ã¯Â¸Â  NON');
  console.log('Ã°Å¸â€™Â³ Stripe configurÃƒÂ© :', STRIPE_SECRET_KEY ? 'Ã¢Å“â€¦ OUI' : 'Ã¢Å¡Â Ã¯Â¸Â  NON (pas de crÃƒÂ©ation de cautions possible)');
  console.log('');
});

