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
const nodemailer = require('nodemailer'); // 
const multer = require('multer');
const Stripe = require('stripe');
const { Pool } = require('pg');
const crypto = require('crypto');
const axios = require('axios');
// Stripe Connect pour les cautions des utilisateurs
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY) 
  : null;

// Stripe Subscriptions pour les abonnements Boostinghost
const stripeSubscriptions = process.env.STRIPE_SUBSCRIPTION_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SUBSCRIPTION_SECRET_KEY) 
  : null;
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `${base}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // ✅ Liste élargie des types MIME acceptés
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',      // Parfois envoyé au lieu de image/jpeg
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',     // Photos iPhone
      'image/heif'      // Photos iPhone
    ];
    
    // ✅ Vérifier aussi l'extension du fichier
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
// MIDDLEWARE DE VÉRIFICATION D'ABONNEMENT
// À AJOUTER DANS server.js APRÈS authenticateToken
// ============================================

async function checkSubscription(req, res, next) {
  try {
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
app.get('/api/properties', authenticateToken, async (req, res) => {
  // ...
});

APRÈS :
app.get('/api/properties', authenticateToken, checkSubscription, async (req, res) => {
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

      CREATE TABLE IF NOT EXISTS welcome_books (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
    `);

    console.log('✅ Tables users, welcome_books, cleaners, user_settings & cleaning_assignments OK dans Postgres');
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
  whatsappNumber: ''
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
// Récupère les assignations de ménage pour un utilisateur sous forme de map { propertyId -> cleaner }
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
    // On ignore les cleaners désactivés
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
 * Envoie les emails de notifications de nouvelles réservations / annulations,
 * en respectant les préférences de l'utilisateur.
 * 
 * VERSION CORRIGÉE AVEC LOGS DÉTAILLÉS POUR DEBUGGING WHATSAPP
 */
async function notifyOwnersAboutBookings(newReservations, cancelledReservations) {
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
            `❌ Erreur envoi email de notification "${type}" à ${user.email} :`,
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

Un nouveau séjour vient d’être réservé pour le logement ${propertyName}.

Voyageur : ${guest}
Séjour  : du ${start} au ${end}
Ménage à prévoir : le ${end} après le départ des voyageurs
(heure exacte de check-out à confirmer avec la conciergerie).

Merci beaucoup,
L'équipe Boostinghost`;

        const htmlBody = `
          <p>${hello}</p>
          <p>Un nouveau séjour vient d’être réservé pour le logement <strong>${propertyName}</strong>.</p>
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
app.use('/uploads', express.static(UPLOAD_ROOT));
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

  console.log(`✅ Abonnement ACTIF créé pour user ${userId} (plan: ${plan})`);
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

        console.log(`✅ Paiement réussi pour subscription ${subscriptionId}`);
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

        console.log(`❌ Paiement échoué pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Événement non géré: ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('❌ Erreur traitement webhook:', err);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// Store for reservations (en mémoire)
let reservationsStore = {
  properties: {},
  lastSync: null,
  syncStatus: 'idle'
};

// Fichiers locaux pour certains stocks
const MANUAL_RES_FILE = path.join(__dirname, 'manual-reservations.json');
const DEPOSITS_FILE = path.join(__dirname, 'deposits-config.json');

// Data en mémoire
let MANUAL_RESERVATIONS = {};    // { [propertyId]: [reservations ou blocages] }
let DEPOSITS = [];               // { id, reservationUid, amountCents, ... }

// ============================================
// FONCTIONS UTILITAIRES FICHIERS
// ============================================

async function loadManualReservations() {
  try {
    const data = await fsp.readFile(MANUAL_RES_FILE, 'utf8');
    MANUAL_RESERVATIONS = JSON.parse(data);
    console.log('✅ Réservations manuelles chargées depuis manual-reservations.json');
  } catch (error) {
    MANUAL_RESERVATIONS = {};
    console.log('⚠️  Aucun fichier manual-reservations.json, démarrage sans réservations manuelles');
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
        owner_id
      FROM properties
      ORDER BY created_at ASC
    `);
    PROPERTIES = result.rows.map(row => {
      // ✅ Parser ical_urls si c'est une string JSON
      let icalUrls = row.ical_urls || [];
      if (typeof icalUrls === 'string') {
        try {
          icalUrls = JSON.parse(icalUrls);
        } catch (e) {
          console.error(`❌ Erreur parse ical_urls pour ${row.name}:`, e.message);
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
        owner_id: row.owner_id
      };
    });
    console.log(`✅ PROPERTIES chargées : ${PROPERTIES.length} logements`); 
  } catch (error) {
    console.error('❌ Erreur loadProperties :', error);
    PROPERTIES = [];
  }
}

function getUserProperties(userId) {
  return PROPERTIES.filter(p => p.userId === userId);
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

      // ➖ Réservations annulées (présentes dans old mais plus dans new)
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

      // Ajouter les réservations manuelles (y compris blocages)
      const manualForProperty = MANUAL_RESERVATIONS[property.id] || [];
      if (manualForProperty.length > 0) {
        reservationsStore.properties[property.id] = [
          ...reservationsStore.properties[property.id],
          ...manualForProperty
        ];
      }

      console.log(
        `✅ ${property.name}: ${reservationsStore.properties[property.id].length} ` +
        `réservations (iCal + manuelles)`
      );
    } catch (error) {
      console.error(`❌ Erreur lors de la synchronisation de ${property.name}:`, error.message);
    }
  }

  reservationsStore.lastSync = new Date();
  reservationsStore.syncStatus = 'idle';

  // 🔔 Notifications : nouvelles + annulations (sauf première sync pour éviter le spam massif)
  if (!isFirstSync && (newReservations.length > 0 || cancelledReservations.length > 0)) {
    console.log(
      `📧 Notifications à envoyer – nouvelles: ${newReservations.length}, annulées: ${cancelledReservations.length}`
    );
    try {
      await notifyOwnersAboutBookings(newReservations, cancelledReservations);
    } catch (err) {
      console.error('❌ Erreur lors de l’envoi des notifications propriétaires:', err);
    }

    if (newReservations.length > 0) {
      try {
        await notifyCleanersAboutNewBookings(newReservations);
      } catch (err) {
        console.error('❌ Erreur lors de l’envoi des notifications ménage:', err);
      }
    }
  } else if (isFirstSync) {
    console.log('ℹ️ Première synchronisation : aucune notification envoyée pour éviter les doublons.');
  }

  console.log('✅ Synchronisation terminée');
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
// ============================================

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
      userId: user.id
    };
    console.log('✅ Réservation créée:', uid);

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
        
        if (typeof notifyOwnersAboutBookings === 'function') {
          await notifyOwnersAboutBookings([reservation], []);
          console.log('✅ Notification propriétaire envoyée');
        }
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('✅ Notification cleaners envoyée');
        }
      } catch (notifErr) {
        console.error('⚠️  Erreur notifications:', notifErr.message);
      }
    });

  } catch (err) {
    console.error('❌ Erreur /api/reservations/manual:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});
// GET - Toutes les réservations du user
app.get('/api/reservations', authenticateUser, checkSubscription, async (req, res) => {
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

// POST - Créer une réservation manuelle
app.post('/api/bookings', async (req, res) => {
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
    
    // 3. VÉRIFICATION DU LOGEMENT
    if (!Array.isArray(PROPERTIES)) {
      console.error('❌ PROPERTIES n\'est pas un tableau');
      return res.status(500).json({ error: 'Erreur de configuration serveur (PROPERTIES)' });
    }
    
    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      console.log('❌ Logement non trouvé:', propertyId);
      console.log('📋 Logements disponibles pour cet utilisateur:', 
        PROPERTIES.filter(p => p.userId === user.id).map(p => ({ id: p.id, name: p.name }))
      );
      return res.status(404).json({ error: 'Logement non trouvé' });
    }
    console.log('✅ Logement trouvé:', property.name);
    
    // 4. CRÉATION DE LA RÉSERVATION
    const uid = 'manual_' + Date.now();
    const reservation = {
      uid: uid,
      start: checkIn,
      end: checkOut,
      source: platform || 'MANUEL',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'Réservation manuelle',
      price: typeof price === 'number' ? price : 0,
      createdAt: new Date().toISOString(),
      // Données supplémentaires pour les notifications
      propertyId: property.id,
      propertyName: property.name,
      propertyColor: property.color || '#3b82f6',
      userId: user.id
    };
    console.log('✅ Réservation créée:', uid);
    
    // 5. SAUVEGARDE DANS MANUAL_RESERVATIONS
    try {
      if (typeof MANUAL_RESERVATIONS === 'undefined') {
        console.log('⚠️  MANUAL_RESERVATIONS non défini, initialisation');
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
    
    // 6. AJOUT AU STORE DES RÉSERVATIONS
    try {
      if (typeof reservationsStore === 'undefined') {
        console.log('⚠️  reservationsStore non défini, initialisation');
        global.reservationsStore = { properties: {} };
      }
      
      if (!reservationsStore.properties) {
        reservationsStore.properties = {};
      }
      
      if (!reservationsStore.properties[propertyId]) {
        reservationsStore.properties[propertyId] = [];
      }
      reservationsStore.properties[propertyId].push(reservation);
      console.log('✅ Ajout au reservationsStore OK');
    } catch (storeErr) {
      console.error('⚠️  Erreur ajout au reservationsStore:', storeErr);
      // On continue quand même
    }
    
    // 7. PRÉPARATION DE LA RÉPONSE
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
    
    // 8. ENVOI DE LA RÉPONSE (AVANT LES NOTIFICATIONS)
    console.log('✅ Réservation créée avec succès, envoi de la réponse');
    res.status(201).json(bookingForClient);
    
    // 9. NOTIFICATIONS EN ARRIÈRE-PLAN (après avoir répondu au client)
    setImmediate(async () => {
      try {
        console.log('📧 Tentative d\'envoi des notifications...');
        
        // Vérifier que les fonctions de notification existent
        if (typeof notifyOwnersAboutBookings === 'function') {
          await notifyOwnersAboutBookings([reservation], []);
          console.log('✅ Notification propriétaire envoyée');
        } else {
          console.log('⚠️  Fonction notifyOwnersAboutBookings non trouvée');
        }
        
        if (typeof notifyCleanersAboutNewBookings === 'function') {
          await notifyCleanersAboutNewBookings([reservation]);
          console.log('✅ Notification cleaners envoyée');
        } else {
          console.log('⚠️  Fonction notifyCleanersAboutNewBookings non trouvée');
        }
        
        console.log('✅ Notifications traitées');
      } catch (notifErr) {
        console.error('⚠️  Erreur lors de l\'envoi des notifications (réservation créée quand même):', notifErr.message);
        console.error('Stack:', notifErr.stack);
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
    await saveManualReservations();

    if (!reservationsStore.properties[propertyId]) {
      reservationsStore.properties[propertyId] = [];
    }
    reservationsStore.properties[propertyId].push(block);

    res.status(201).json({
      message: 'Blocage créé',
      block
    });
  } catch (err) {
    console.error('Erreur création blocage:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Réservations d’un logement
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

function buildPhotoUrl(req, filename) {
  if (!filename) return null;
  
  // ✅ Utiliser le bon protocole (HTTPS sur Render via x-forwarded-proto)
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = `${protocol}://${req.get('host')}`;
  
  return `${baseUrl}/uploads/properties/${filename}`;
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
    let logoUrl = null;
    if (req.file) {
      logoUrl = buildPhotoUrl(req, req.file.filename);
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
    
    // Gérer les erreurs de contraintes
    if (err.code === '23514') { // Constraint violation
      if (err.constraint === 'check_account_type') {
        return res.status(400).json({ 
          error: 'Type de compte invalide' 
        });
      }
      if (err.constraint === 'check_siret_format') {
        return res.status(400).json({ 
          error: 'Format du SIRET invalide (14 chiffres requis)' 
        });
      }
    }
    
    res.status(500).json({ error: 'Erreur serveur lors de la mise à jour' });
  }
});
// Route pour vérifier le statut de l'abonnement
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

    // ✅ AJOUTER LE PRIX
    let planAmount = 0;
    if (sub.plan_type === 'basic') {
      planAmount = 599; // 5,99€ en centimes
    } else if (sub.plan_type === 'pro') {
      planAmount = 899; // 8,99€ en centimes
    }

    // ✅ AJOUTER LE DISPLAY MESSAGE
    let displayMessage = 'Abonnement';
    if (sub.status === 'trial') {
      displayMessage = 'Essai gratuit';
    } else if (sub.status === 'active') {
      displayMessage = sub.plan_type === 'pro' ? 'Abonnement Pro' : 'Abonnement Basic';
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
    return res.status(401).json({ error: 'Non autorisé' });
  }

  if (reservationsStore.syncStatus === 'syncing') {
    return res.status(409).json({
      error: 'Synchronisation déjà en cours',
      status: 'syncing'
    });
  }

  try {
    const result = await syncAllCalendars();
    const userProps = getUserProperties(user.id);

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

// GET - Réservations avec infos de caution
app.get('/api/reservations-with-deposits', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
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
    from: process.env.EMAIL_USER,
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
// SERVICE D'EMAILS AUTOMATIQUES
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
  await pool.query(
    `INSERT INTO email_logs (id, user_id, email_type, email_data, sent_at, status)
     VALUES ($1, $2, $3, $4, NOW(), 'sent')`,
    [`email_${Date.now()}`, userId, emailType, JSON.stringify(emailData)]
  );
}

// ============================================
// EMAIL 1 : BIENVENUE APRÈS VÉRIFICATION
// ============================================
async function sendWelcomeEmail(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
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
            
            <p>Vous avez accès à <strong>14 jours d'essai gratuit</strong> pour tester toutes les fonctionnalités de notre plateforme de gestion de locations courte durée.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                🚀 Accéder à mon espace
              </a>
            </div>
            
            <h3 style="color: #111827; margin-top: 30px;">✨ Ce que vous pouvez faire dès maintenant :</h3>
            
            <div class="feature">
              <span class="feature-icon">📅</span>
              <div>
                <strong>Ajoutez vos logements</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Créez vos fiches de propriétés en quelques clics</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">🔗</span>
              <div>
                <strong>Synchronisez vos calendriers</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Connectez Airbnb et Booking.com via iCal</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">💬</span>
              <div>
                <strong>Gérez vos messages</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Centralisez toutes vos communications</span>
              </div>
            </div>
            
            <div class="feature">
              <span class="feature-icon">🧹</span>
              <div>
                <strong>Organisez le ménage</strong><br>
                <span style="color: #6b7280; font-size: 14px;">Planifiez et suivez les tâches de nettoyage</span>
              </div>
            </div>
            
            <p style="margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              💡 <strong>Besoin d'aide ?</strong><br>
              Notre équipe est là pour vous accompagner : <a href="mailto:support@boostinghost.com" style="color: #10b981;">support@boostinghost.com</a>
            </p>
            
            <p>À très bientôt sur Boostinghost ! 🚀</p>
            
            <p style="color: #6b7280; font-size: 13px; margin-top: 30px;">
              L'équipe Boostinghost
            </p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement par Boostinghost.</p>
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
// EMAIL 2 : RAPPEL J-7
// ============================================
async function sendTrialReminder7Days(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
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
            
            <p>Il vous reste <strong>7 jours</strong> d'essai gratuit sur Boostinghost !</p>
            
            <p>C'est le moment idéal pour :</p>
            <ul>
              <li>Tester toutes les fonctionnalités</li>
              <li>Synchroniser tous vos calendriers</li>
              <li>Configurer vos messages automatiques</li>
              <li>Organiser votre planning de ménage</li>
            </ul>
            
            <p>Pour continuer à profiter de Boostinghost après votre essai, choisissez le plan qui vous convient :</p>
            
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
// EMAIL 3 : RAPPEL J-3
// ============================================
async function sendTrialReminder3Days(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
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
          .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 6px; margin: 20px 0; }
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
            
            <p>Pour continuer à utiliser Boostinghost sans interruption, choisissez votre plan dès maintenant :</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Plan Basic - 5,99€/mois</strong></p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">Toutes les fonctionnalités essentielles</p>
            </div>
            
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border: 2px solid #10b981; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Plan Pro - 8,99€/mois</strong></p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">+ Gestion des cautions Stripe (commission 2%)</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                Choisir mon plan
              </a>
            </div>
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
// SERVICE D'EMAILS AUTOMATIQUES (SUITE)
// ============================================

// ============================================
// EMAIL 4 : RAPPEL J-1
// ============================================
async function sendTrialReminder1Day(email, firstName) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
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
              Pour continuer à utiliser Boostinghost, souscrivez à un plan dès maintenant.
            </div>
            
            <p style="font-size: 16px;">Sans abonnement actif, vous perdrez l'accès à :</p>
            <ul style="font-size: 16px;">
              <li>Votre calendrier unifié</li>
              <li>La synchronisation iCal</li>
              <li>La gestion des messages</li>
              <li>Le suivi du ménage</li>
              <li>Toutes vos données et réservations</li>
            </ul>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/pricing.html" class="button">
                🚀 Activer mon abonnement maintenant
              </a>
            </div>
            
            <p style="text-align: center; color: #6b7280; font-size: 14px;">
              Seulement 5,99€/mois pour le plan Basic<br>
              ou 8,99€/mois pour le plan Pro
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
// EMAIL 5 : CONFIRMATION D'ABONNEMENT
// ============================================
async function sendSubscriptionConfirmedEmail(email, firstName, planType, planAmount) {
  const planName = planType === 'pro' ? 'Pro' : 'Basic';
  const price = (planAmount / 100).toFixed(2);
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
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
          .card { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
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
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Votre plan</p>
              <p style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #10b981;">Plan ${planName}</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                <strong style="font-size: 18px; color: #111827;">${price}€</strong> / mois
              </p>
            </div>
            
            <p>Vous avez maintenant accès à toutes les fonctionnalités de Boostinghost :</p>
            <ul>
              <li>✅ Calendrier unifié</li>
              <li>✅ Synchronisation iCal (Airbnb, Booking)</li>
              <li>✅ Gestion des messages</li>
              <li>✅ Livret d'accueil personnalisé</li>
              <li>✅ Gestion du ménage</li>
              <li>✅ Statistiques & rapports</li>
              ${planType === 'pro' ? '<li>✅ Gestion des cautions Stripe (2% commission)</li>' : ''}
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'https://lcc-booking-manager.onrender.com'}/app.html" class="button">
                Accéder à mon espace
              </a>
            </div>
            
            <p style="padding: 16px; background: #f0fdf4; border-radius: 6px; border-left: 4px solid #10b981; margin-top: 30px;">
              💡 <strong>Gérer mon abonnement</strong><br>
              Vous pouvez modifier ou annuler votre abonnement à tout moment depuis votre espace compte.
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
          .card { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6; }
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
            
            <p>Votre abonnement Boostinghost <strong>Plan ${planName}</strong> sera automatiquement renouvelé dans <strong>3 jours</strong>.</p>
            
            <div class="card">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Prochain prélèvement</p>
              <p style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #3b82f6;">${price}€</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Date : <strong>${formattedDate}</strong>
              </p>
            </div>
            
            <p>Aucune action n'est nécessaire de votre part. Le paiement sera effectué automatiquement.</p>
            
            <p style="padding: 16px; background: #f0f9ff; border-radius: 6px; border-left: 4px solid #3b82f6;">
              💡 Vous souhaitez modifier ou annuler votre abonnement ? Rendez-vous dans votre espace compte.
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
      'SELECT data FROM welcome_books WHERE user_id = $1',
      [user.id]
    );

    let data;
    if (result.rows.length === 0) {
      // Pas encore de livret pour cet utilisateur → on crée un défaut
      data = defaultWelcomeData(user);

      await pool.query(
        'INSERT INTO welcome_books (user_id, data, updated_at) VALUES ($1, $2, NOW())',
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
      `INSERT INTO welcome_books (user_id, data, updated_at)
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
app.get('/api/cleaners', authenticateUser, checkSubscription, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
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

// POST - Créer une nouvelle personne de ménage
app.post('/api/cleaners', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
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
      message: 'Membre du ménage créé',
      cleaner: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur POST /api/cleaners :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Modifier une personne de ménage
app.put('/api/cleaners/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
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
      [id, user.id, name, phone, email, notes, isActive]
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
app.delete('/api/cleaners/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM cleaners
       WHERE id = $1 AND user_id = $2`,
      [id, user.id]
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
// ============================================
// ROUTES API - ASSIGNATIONS MENAGE (par user)
// ============================================

// GET - Liste des assignations de ménage
app.get('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
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

// POST - Créer / mettre à jour / supprimer une assignation
app.post('/api/cleaning/assignments', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, cleanerId } = req.body || {};

    if (!propertyId) {
      return res.status(400).json({ error: 'propertyId requis' });
    }

    // Si cleanerId vide → on supprime l'assignation
    if (!cleanerId) {
      await pool.query(
        'DELETE FROM cleaning_assignments WHERE user_id = $1 AND property_id = $2',
        [user.id, propertyId]
      );
      return res.json({
        message: 'Assignation ménage supprimée',
        propertyId
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
      message: 'Assignation ménage enregistrée',
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
      return res.status(401).json({ error: 'Non autorisé' });
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

        // 👇 nouveaux champs que le front attend
        address: p.address || null,
        arrivalTime: p.arrival_time || p.arrivalTime || null,
        departureTime: p.departure_time || p.departureTime || null,
        depositAmount: p.deposit_amount ?? p.depositAmount ?? null,
        photoUrl: p.photo_url || p.photoUrl || null,

        // ✅ NOUVEAUX CHAMPS ENRICHIS
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
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvé' });
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
    
    icalUrls: property.icalUrls || property.ical_urls || [],
    reservationCount: (reservationsStore.properties[property.id] || []).length
  });
});

app.post('/api/properties', upload.single('photo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
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

    // photo : si un fichier est uploadé on l’utilise, sinon on garde l’éventuelle valeur existante
    let photoUrl = existingPhotoUrl || null;
    if (req.file) {
      photoUrl = buildPhotoUrl(req, req.file.filename);
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
      message: 'Logement créé avec succès',
      property
    });
  } catch (err) {
    console.error('Erreur création logement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/properties/:propertyId', upload.single('photo'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
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
      return res.status(404).json({ error: 'Logement non trouvé' });
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

    if (req.file) {
      newPhotoUrl = buildPhotoUrl(req, req.file.filename);
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
    newOwnerId, // ← AJOUTE CETTE LIGNE
    propertyId,
    user.id
  ]
);
    await loadProperties();

    const updated = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);

    res.json({
      message: 'Logement modifié avec succès',
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
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId } = req.params;

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    await pool.query(
      'DELETE FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, user.id]
    );

    delete reservationsStore.properties[propertyId];

    await loadProperties();

    res.json({
      message: 'Logement supprimé avec succès',
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
// ROUTES API - NOTIFICATIONS TEST
// ============================================

app.post('/api/test-notification', async (req, res) => {
  try {
    await notificationService.sendTestNotification();
    res.json({ message: 'Notification de test envoyée' });
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
      from: process.env.EMAIL_USER,
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

app.post('/auth/login', async (req, res) => {  // ← AJOUTE CETTE LIGNE
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
      [user.id]
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

function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par défaut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré (clé secrète manquante)' });
    }
    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }
    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configuré' });
    }
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
    
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      // ✅ AJOUTEZ LES METADATA ICI DIRECTEMENT
      metadata: {
        userId: user.id,
        plan: plan
      },
      customer_email: user.email,
      client_reference_id: user.id, // ✅ IMPORTANT pour le webhook
      success_url: `${appUrl}/app.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing.html`,
    });
    
    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur /api/billing/create-checkout-session :', err);
    res.status(500).json({ error: 'Impossible de créer la session de paiement' });
  }
});

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
      // L’utilisateur n’a encore jamais connecté de compte Stripe
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
      // Si on n’arrive pas à récupérer le compte, on considère "non connecté"
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

    // 1) Si l’utilisateur n’a pas encore de compte Stripe, on en crée un
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

      // On sauvegarde l’ID du compte Stripe en base
      await pool.query(
        'UPDATE users SET stripe_account_id = $1 WHERE id = $2',
        [accountId, user.id]
      );
    }

    // 2) On crée le lien d’onboarding pour que l’utilisateur complète ses infos chez Stripe
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
app.get('/api/deposits/:reservationUid', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { reservationUid } = req.params;
  const deposit = DEPOSITS.find(d => d.reservationUid === reservationUid) || null;
  res.json({ deposit });
});

// POST - Créer une caution Stripe pour une réservation (empreinte bancaire)
app.post('/api/deposits', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
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
    DEPOSITS.push(deposit);

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

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

    // Si tu as un compte Stripe Connect lié, on crée la session sur CE compte
    if (user.stripeAccountId) {
      console.log('Création session de caution sur compte connecté :', user.stripeAccountId);
      session = await stripe.checkout.sessions.create(
        sessionParams,
        { stripeAccount: user.stripeAccountId }
      );
    } else {
      console.log('Création session de caution sur le compte plateforme (pas de stripeAccountId)');
      session = await stripe.checkout.sessions.create(sessionParams);
    }

    deposit.stripeSessionId = session.id;
    deposit.checkoutUrl = session.url;
    await saveDeposits();

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

// Helper : Récupérer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par défaut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

// POST - Créer une session de paiement Stripe
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

    // Créer la session Stripe Checkout
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

// GET - Récupérer le statut d'abonnement de l'utilisateur
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
      [req.params.id, user.id]
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
      [req.params.id, user.id]
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
      [user.id]
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
      [req.params.id, user.id]
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

    await pool.query('SELECT create_default_owner_articles($1)', [user.id]);

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
app.get('/api/owner-invoices', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

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
    console.error('Erreur liste factures propriétaires:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 2. CRÉER UNE NOUVELLE FACTURE PROPRIÉTAIRE (BROUILLON PAR DÉFAUT)
app.post('/api/owner-invoices', async (req, res) => {
  const client = await pool.connect();

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

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
app.get('/api/owner-invoices/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Facture
    const invResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
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
app.post('/api/owner-invoices/:id/credit-note', async (req, res) => {
  const client = await pool.connect();

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Récupérer la facture d'origine
    const origResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
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
// FACTURES - ROUTES MODIFIÉES (AVEC RÉDUCTIONS)
// ============================================

// 6. MODIFIER UNE FACTURE BROUILLON
app.put('/api/owner-invoices/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    // Vérifier que c'est un brouillon
    const checkResult = await client.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
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
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    // Vérifier que c'est un brouillon
    const checkResult = await pool.query(
      'SELECT status FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
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
app.post('/api/owner-invoices/:id/finalize', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Récupérer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
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
      ['invoiced', invoiceNumber, invoiceId, user.id]
    );

    res.json({ invoice: updateResult.rows[0] });
  } catch (err) {
    console.error('Erreur finalisation facture propriétaire:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 8. ENVOYER UN BROUILLON
app.post('/api/owner-invoices/:id/send', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    // Récupérer la facture
    const invoiceResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
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

    res.json({ success: true, message: 'Facture envoyée' });

  } catch (err) {
    console.error('Erreur envoi facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// MARQUER UNE FACTURE COMME ENCAISSÉE
app.post('/api/owner-invoices/:id/mark-paid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceId = req.params.id;

    // Récupérer la facture
    const result = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
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
      [invoiceId, user.id]
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
app.post('/api/owner-credit-notes', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    await client.query('BEGIN');

    const { invoiceId, reason } = req.body;

    // Récupérer la facture d'origine
    const invoiceResult = await client.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [invoiceId, user.id]
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
      [user.id]
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
      creditNoteNumber, user.id, invoiceId, invoice.invoice_number,
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
app.get('/api/owner-credit-notes', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

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

// 11. DÉTAIL AVOIR
app.get('/api/owner-credit-notes/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const creditResult = await pool.query(
      'SELECT * FROM owner_credit_notes WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
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

// ============================================
// FIN DES ROUTES V2
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
// ROUTES STRIPE - À AJOUTER DANS server.js
// Copier APRÈS les autres routes API, AVANT app.listen()
// ============================================

// Helper : Récupérer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par défaut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
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

    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configuré' });
    }

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // Créer la session Stripe Checkout
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
    res.status(500).json({ error: 'Impossible de créer la session de paiement' });
  }
});

// ============================================
// GET /api/subscription/status
// Récupérer le statut d'abonnement de l'utilisateur
// ============================================
app.get('/api/subscription/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
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
        error: 'Aucun abonnement trouvé',
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
        displayMessage = 'Période essai expirée';
      }
    } else if (subscription.status === 'active') {
      displayMessage = `Abonnement ${subscription.plan_type === 'pro' ? 'Pro' : 'Basic'} actif`;
    } else if (subscription.status === 'expired') {
      displayMessage = 'Abonnement expiré';
    } else if (subscription.status === 'canceled') {
      displayMessage = 'Abonnement annulé';
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
// Créer un lien vers le portail client Stripe
// ============================================
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré' });
    }

    // Récupérer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouvé' });
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
    res.status(500).json({ error: 'Impossible de créer la session portail' });
  }
});

// ============================================
// POST /api/webhooks/stripe
// Webhook Stripe (événements de paiement)
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
    console.error('Erreur vérification webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Webhook Stripe reçu:', event.type);

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

        // Récupérer la subscription Stripe
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Mettre à jour la base de données
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

        console.log(`Abonnement créé pour user ${userId} (plan: ${plan})`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        // Déterminer le statut
        let status = 'active';
        if (subscription.status === 'trialing') status = 'trial';
        else if (subscription.status === 'canceled') status = 'canceled';
        else if (subscription.status === 'past_due') status = 'past_due';

        // Mettre à jour en base
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = $1,
             current_period_end = to_timestamp($2),
             updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscriptionId]
        );

        console.log(`Abonnement ${subscriptionId} mis à jour: ${status}`);
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

        console.log(`Abonnement ${subscriptionId} annulé`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        // Passer de trial à active si c'était le premier paiement
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = 'active',
             updated_at = NOW()
           WHERE stripe_subscription_id = $1 AND status = 'trial'`,
          [subscriptionId]
        );

        console.log(`Paiement réussi pour subscription ${subscriptionId}`);
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

        console.log(`Paiement échoué pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Événement non géré: ${event.type}`);
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
            // Vérifier si un email de rappel a été envoyé pour cette période
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

    console.log('✅ Vérification des emails automatiques terminée');

  } catch (err) {
    console.error('❌ Erreur cron emails automatiques:', err);
  }
});

console.log('⏰ Tâche CRON emails automatiques activée (toutes les heures)');

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

// ============================================
// DÉMARRAGE
// ============================================

app.listen(PORT, async () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🏠 LCC Booking Manager - Système de Réservations    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log('');

  await initDb();

  await loadProperties();
  await loadManualReservations();
  await loadDeposits();

  console.log('Logements configurés:');
  PROPERTIES.forEach(p => {
    const status = p.icalUrls && p.icalUrls.length > 0 ? '✅' : '⚠️';
    console.log(`  ${status} ${p.name} (${p.icalUrls.length} source${p.icalUrls.length > 1 ? 's' : ''})`);
  });
  console.log('');

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
      console.error('❌ Erreur lors de l’envoi du planning ménage quotidien :', err);
    }
  });

  console.log('');
  console.log(`⏰ Synchronisation automatique: toutes les ${syncInterval} minutes`);
  console.log('');
  console.log('📧 Notifications configurées:', process.env.EMAIL_USER ? '✅ OUI' : '⚠️  NON');
  console.log('💳 Stripe configuré :', STRIPE_SECRET_KEY ? '✅ OUI' : '⚠️  NON (pas de création de cautions possible)');
  console.log('');
});
// Route pour supprimer une réservation manuelle ou un blocage
app.post('/api/manual-reservations/delete', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      console.log('❌ Suppression refusée : utilisateur non authentifié');
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, uid } = req.body || {};
    console.log('🗑 Demande de suppression manuelle reçue :', {
      userId: user.id,
      propertyId,
      uid
    });

    if (!propertyId || !uid) {
      console.log('❌ Requête invalide pour suppression : propertyId ou uid manquant', {
        propertyId,
        uid
      });
      return res.status(400).json({ error: 'propertyId et uid sont requis' });
    }

    const property = PROPERTIES.find(
      (p) => p.id === propertyId && p.userId === user.id
    );
    if (!property) {
      console.log('❌ Logement non trouvé pour suppression', {
        propertyId,
        userId: user.id
      });
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    if (!MANUAL_RESERVATIONS[propertyId] || MANUAL_RESERVATIONS[propertyId].length === 0) {
      console.log('❌ Aucune réservation/blocage trouvé pour ce logement', {
        propertyId,
        uid
      });
      return res.status(404).json({ error: 'Réservation/blocage non trouvé' });
    }

    const initialLength = MANUAL_RESERVATIONS[propertyId].length;
    MANUAL_RESERVATIONS[propertyId] =
      MANUAL_RESERVATIONS[propertyId].filter((r) => r.uid !== uid);
    const newLength = MANUAL_RESERVATIONS[propertyId].length;

    console.log('📊 Suppression dans MANUAL_RESERVATIONS :', {
      propertyId,
      uid,
      initialLength,
      newLength
    });

    if (initialLength === newLength) {
      console.log(
        '❌ Aucune entrée supprimée (uid non trouvé dans MANUAL_RESERVATIONS)',
        { propertyId, uid }
      );
      return res.status(404).json({ error: 'Réservation/blocage non trouvé' });
    }

    await saveManualReservations();
    console.log('💾 MANUAL_RESERVATIONS sauvegardé après suppression');

    if (reservationsStore.properties[propertyId]) {
      const initialStoreLength = reservationsStore.properties[propertyId].length;
      reservationsStore.properties[propertyId] =
        reservationsStore.properties[propertyId].filter((r) => r.uid !== uid);
      const newStoreLength = reservationsStore.properties[propertyId].length;

      console.log('🧮 reservationsStore mis à jour :', {
        propertyId,
        uid,
        initialStoreLength,
        newStoreLength
      });
    } else {
      console.log(
        'ℹ️ Aucun entry dans reservationsStore pour ce propertyId au moment de la suppression',
        { propertyId }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Réservation/blocage supprimé'
    });
  } catch (err) {
    console.error('Erreur suppression réservation manuelle:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
