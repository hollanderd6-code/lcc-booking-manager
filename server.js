require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs').promises;
const icalService = require('./services/icalService');
const notificationService = require('./services/notificationService');
const messagingService = require('./services/messagingService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer'); // 
const whatsappService = require('./services/whatsappService');
const Stripe = require('stripe');
const { Pool } = require('pg');

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
};

function getEmailTransporter() {
  if (emailTransporter) return emailTransporter;

  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;

  if (!host || !user || !pass) {
    console.log('⚠️  Email non configuré (EMAIL_HOST, EMAIL_USER ou EMAIL_PASSWORD manquants)');
    return null;
  }

  emailTransporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true', // true = 465
    auth: {
      user,
      pass
    }
  });

  return emailTransporter;
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
 */
async function notifyOwnersAboutBookings(newReservations, cancelledReservations) {
  const transporter = getEmailTransporter();
  if (!transporter) {
    console.log('⚠️  Transport email non configuré, aucune notification propriétaire envoyée');
    return;
  }

  const from = process.env.EMAIL_FROM || 'Boostinghost <no-reply@boostinghost.com>';
  const tasks = [];

  const handleReservation = (res, type) => {
    const userId = res.userId;
    if (!userId) {
      console.log('⚠️  Réservation sans userId, notification ignorée :', res.uid || res.id);
      return;
    }

    tasks.push((async () => {
      const user = await getUserForNotifications(userId);
      if (!user || !user.email) {
        console.log(`⚠️  Aucun email trouvé pour user ${userId}, notification ignorée`);
        return;
      }

      // 🔔 Récupérer les préférences de notifications
      let settings;
      try {
        settings = await getNotificationSettings(userId);
      } catch (e) {
        console.error(
          'Erreur lors de la récupération des préférences de notifications pour user',
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
        res.propertyName ||
        (res.property && res.property.name) ||
        'Votre logement';

      const guest =
        res.guestName ||
        res.guest_name ||
        res.guest ||
        res.name ||
        'Un voyageur';

      const source = res.source || res.platform || 'une plateforme';

      const start = formatDateForEmail(
        res.start || res.startDate || res.checkIn || res.checkin
      );
      const end = formatDateForEmail(
        res.end || res.endDate || res.checkOut || res.checkout
      );

      const hello = user.firstName ? `Bonjour ${user.firstName},` : 'Bonjour,';

      let subject;
      let textBody;
      let htmlBody;

      if (type === 'new') {
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
        await transporter.sendMail({
          from,
          to: user.email,
          subject,
          text: textBody,
          html: htmlBody
        });
        console.log(
          `📧 Notification "${type}" envoyée à ${user.email} (resa uid=${res.uid || res.id})`
        );
      } catch (err) {
        console.error('❌ Erreur envoi email notification réservation :', err);
      }
    })());
  };

  (newReservations || []).forEach(res => handleReservation(res, 'new'));
  (cancelledReservations || []).forEach(res => handleReservation(res, 'cancelled'));

  await Promise.all(tasks);
}
/**
 * Notifications ménage : pour chaque nouvelle réservation, si un logement a un cleaner assigné,
 * on envoie un email + (optionnel) un WhatsApp à ce cleaner.
 */
async function notifyCleanersAboutNewBookings(newReservations) {
  const transporter = getEmailTransporter();
  if (!transporter && !whatsappService.isConfigured()) {
    console.log('⚠️  Ni email ni WhatsApp configurés, aucune notification ménage envoyée');
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
      if (transporter && cleanerEmail) {
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
          transporter
            .sendMail({
              from,
              to: cleanerEmail,
              subject,
              text: textBody,
              html: htmlBody
            })
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

      // WhatsApp
      if (whatsappService.isConfigured() && cleanerPhone) {
        const waText =
          `Nouveau ménage à prévoir:\n` +
          `Logement: ${propertyName}\n` +
          `Voyageur: ${guest}\n` +
          `Séjour: du ${start} au ${end}\n` +
          `Ménage à prévoir le ${end} après check-out.`;

        tasks.push(
          whatsappService
            .sendWhatsAppText(cleanerPhone, waText)
            .then(() => {
              console.log(
                `📱 Notification WhatsApp ménage envoyée à ${cleanerPhone} (resa uid=${res.uid || res.id})`
              );
            })
            .catch((err) => {
              console.error('❌ Erreur envoi WhatsApp notification ménage :', err);
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
  const transporter = getEmailTransporter();
  if (!transporter && !whatsappService.isConfigured()) {
    console.log('⚠️  Ni email ni WhatsApp configurés, planning ménage non envoyé');
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

    // Email
    if (transporter && cleanerEmail) {
      let textBody = `${hello}\n\nVoici vos ménages prévus pour demain :\n\n`;
      let htmlBody = `<p>${hello}</p><p>Voici vos ménages prévus pour demain :</p><ul>`;

      jobs.forEach((job, index) => {
        textBody += `${index + 1}. ${job.propertyName} – départ le ${job.end} (séjour du ${job.start} au ${job.end}, ${job.guestName})\n`;
        htmlBody += `<li><strong>${job.propertyName}</strong> – départ le ${job.end} (séjour du ${job.start} au ${job.end}, ${job.guestName})</li>`;
      });

      textBody += `\nMerci beaucoup,\nL'équipe Boostinghost\n`;
      htmlBody += `</ul><p style="font-size:13px;color:#6b7280;">Merci beaucoup,<br>L'équipe Boostinghost</p>`;

      tasks.push(
        transporter
          .sendMail({
            from,
            to: cleanerEmail,
            subject,
            text: textBody,
            html: htmlBody
          })
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
    if (whatsappService.isConfigured() && cleanerPhone) {
      let waText = `Planning ménage de demain (${tomorrowIso}):\n`;
      jobs.forEach((job, index) => {
        waText += `${index + 1}. ${job.propertyName} – départ le ${job.end} (${job.guestName})\n`;
      });

      tasks.push(
        whatsappService
          .sendWhatsAppText(cleanerPhone, waText)
          .then(() => {
            console.log(
              `📱 Planning ménage WhatsApp envoyé à ${cleanerPhone} pour ${tomorrowIso}`
            );
          })
          .catch((err) => {
            console.error('❌ Erreur WhatsApp planning ménage :', err);
          })
      );
    }
  });

  await Promise.all(tasks);

  console.log('✅ Planning ménage quotidien envoyé (si tâches détectées).');
}


// ============================================
// APP / STRIPE / STORE
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.use(express.static(__dirname)); // Servir aussi les fichiers à la racine

// Store for reservations (en mémoire)
let reservationsStore = {
  properties: {},
  lastSync: null,
  syncStatus: 'idle'
};

// Fichiers locaux pour certains stocks
const MANUAL_RES_FILE = path.join(__dirname, 'manual-reservations.json');
const DEPOSITS_FILE = path.join(__dirname, 'deposits-config.json');
const CHECKINS_FILE = path.join(__dirname, 'checkins.json');

// Données de check-in invités : { [reservationUid]: { ...données formulaire... } }
let CHECKINS = {};

// Data en mémoire
let MANUAL_RESERVATIONS = {};    // { [propertyId]: [reservations ou blocages] }
let DEPOSITS = [];               // { id, reservationUid, amountCents, ... }

// ============================================
// FONCTIONS UTILITAIRES FICHIERS
// ============================================

async function loadManualReservations() {
  try {
    const data = await fs.readFile(MANUAL_RES_FILE, 'utf8');
    MANUAL_RESERVATIONS = JSON.parse(data);
    console.log('✅ Réservations manuelles chargées depuis manual-reservations.json');
  } catch (error) {
    MANUAL_RESERVATIONS = {};
    console.log('⚠️  Aucun fichier manual-reservations.json, démarrage sans réservations manuelles');
  }
}
async function loadEmailProxies() {
  try {
    const data = await fs.readFile(EMAIL_PROXIES_FILE, 'utf8');
    EMAIL_PROXIES = JSON.parse(data);
    console.log('✅ Email proxies chargés depuis email-proxies.json');
  } catch (error) {
    EMAIL_PROXIES = {};
    console.log('ℹ️ Aucun fichier email-proxies.json, démarrage à vide');
  }
}

async function saveEmailProxies() {
  try {
    await fs.writeFile(EMAIL_PROXIES_FILE, JSON.stringify(EMAIL_PROXIES, null, 2));
    console.log('✅ Email proxies sauvegardés');
  } catch (error) {
    console.error('❌ Erreur sauvegarde email proxies:', error.message);
  }
}

async function saveManualReservations() {
  try {
    await fs.writeFile(MANUAL_RES_FILE, JSON.stringify(MANUAL_RESERVATIONS, null, 2));
    console.log('✅ Réservations manuelles sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des réservations manuelles:', error.message);
  }
}

async function loadDeposits() {
  try {
    const data = await fs.readFile(DEPOSITS_FILE, 'utf8');
    DEPOSITS = JSON.parse(data);
    console.log('✅ Cautions chargées depuis deposits-config.json');
  } catch (error) {
    DEPOSITS = [];
    console.log('⚠️  Aucun fichier deposits-config.json, démarrage sans cautions');
  }
}

async function saveDeposits() {
  try {
    await fs.writeFile(DEPOSITS_FILE, JSON.stringify(DEPOSITS, null, 2));
    console.log('✅ Cautions sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des cautions:', error.message);
  }
}
async function loadCheckins() {
  try {
    const data = await fs.readFile(CHECKINS_FILE, 'utf8');
    CHECKINS = JSON.parse(data);
    console.log('✅ Check-ins chargés depuis checkins.json');
  } catch (error) {
    CHECKINS = {};
    console.log('ℹ️ Aucun fichier checkins.json, démarrage sans check-ins');
  }
}

async function saveCheckins() {
  try {
    await fs.writeFile(CHECKINS_FILE, JSON.stringify(CHECKINS, null, 2));
    console.log('✅ Check-ins sauvegardés dans checkins.json');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des check-ins:', error.message);
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
// PROPERTIES (logements) - stockées en base
// ============================================

// PROPERTIES est créé par affectation dans loadProperties (variable globale implicite)
async function loadProperties() {
  try {
    const result = await pool.query(`
      SELECT id, user_id, name, color, ical_urls
      FROM properties
      ORDER BY created_at ASC
    `);

    PROPERTIES = result.rows.map(row => {
      const raw = row.ical_urls || [];
      let icalUrls = [];

      if (Array.isArray(raw)) {
        icalUrls = raw
          .map(item => {
            // Cas ancien : tableau de chaînes
            if (typeof item === 'string') {
              return item;
            }
            // Cas nouveau : tableau d'objets { url, source }
            if (item && typeof item === 'object' && item.url) {
              return item.url;
            }
            return null;
          })
          .filter(url => typeof url === 'string' && url.trim().length > 0);
      }

      return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        color: row.color,
        // Toujours un tableau de STRING en interne
        icalUrls
      };
    });

    console.log(`✅ ${PROPERTIES.length} logements chargés depuis Postgres`);
  } catch (error) {
    console.error('❌ Erreur lors du chargement des logements:', error.message);
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

// GET - Toutes les réservations du user
app.get('/api/reservations', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const allReservations = [];
  const userProps = getUserProperties(user.id);
  const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

  userProps.forEach(property => {
    const propertyReservations = reservationsStore.properties[property.id] || [];
    propertyReservations.forEach(reservation => {
      const uid = reservation.uid || reservation.id;
      const checkinData = uid ? (CHECKINS[uid] || null) : null;
      const checkinUrl = uid ? `${appUrl}/checkin.html?res=${uid}` : null;

      allReservations.push({
        ...reservation,
        property: {
          id: property.id,
          name: property.name,
          color: property.color
        },
        checkinData,
        checkinUrl
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
app.post('/api/reservations/manual', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId, checkIn, checkOut, guestName, guestPhone, guestEmail, platform, price, notes, source } = req.body;

    // Support both 'checkIn/checkOut' and 'start/end' formats
    const startDate = checkIn || req.body.start;
    const endDate = checkOut || req.body.end;

    if (!propertyId || !startDate || !endDate) {
      return res.status(400).json({ error: 'propertyId, checkIn et checkOut sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    const reservation = {
      id: 'manual_' + Date.now(),
      uid: 'manual_' + Date.now(),
      propertyId: propertyId,
      start: startDate,
      end: endDate,
      checkIn: startDate,
      checkOut: endDate,
      source: source || 'manual',
      platform: platform || 'direct',
      type: 'manual',
      guestName: guestName || 'Réservation manuelle',
      guestPhone: guestPhone || '',
      guestEmail: guestEmail || '',
      price: price || 0,
      notes: notes || '',
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

    res.status(201).json(reservation);
  } catch (err) {
    console.error('Erreur création réservation manuelle:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Modifier une réservation manuelle
app.put('/api/reservations/manual/:uid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const uid = req.params.uid;
    const { propertyId, checkIn, checkOut, guestName, guestPhone, guestEmail, platform, price, notes } = req.body;

    if (!uid) {
      return res.status(400).json({ error: 'Identifiant de réservation manquant' });
    }

    if (!checkIn || !checkOut) {
      return res.status(400).json({ error: 'checkIn et checkOut sont requis' });
    }

    let foundPropertyId = null;
    let foundReservationIndex = -1;

    // Trouver la réservation
    for (const [propId, list] of Object.entries(MANUAL_RESERVATIONS)) {
      const property = PROPERTIES.find(p => p.id === propId && p.userId === user.id);
      if (!property) {
        continue;
      }

      const index = list.findIndex(r => r.uid === uid);
      if (index !== -1) {
        foundPropertyId = propId;
        foundReservationIndex = index;
        break;
      }
    }

    if (!foundPropertyId || foundReservationIndex === -1) {
      return res.status(404).json({ error: 'Réservation non trouvée' });
    }

    // Vérifier que le nouveau propertyId appartient à l'utilisateur si fourni
    if (propertyId && propertyId !== foundPropertyId) {
      const newProperty = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
      if (!newProperty) {
        return res.status(404).json({ error: 'Nouveau logement non trouvé' });
      }
    }

    // Mettre à jour la réservation
    const updatedReservation = {
      ...MANUAL_RESERVATIONS[foundPropertyId][foundReservationIndex],
      start: checkIn,
      end: checkOut,
      checkIn: checkIn,
      checkOut: checkOut,
      guestName: guestName || MANUAL_RESERVATIONS[foundPropertyId][foundReservationIndex].guestName,
      guestPhone: guestPhone || '',
      guestEmail: guestEmail || '',
      platform: platform || MANUAL_RESERVATIONS[foundPropertyId][foundReservationIndex].platform,
      price: price || 0,
      notes: notes || '',
      updatedAt: new Date().toISOString()
    };

    // Si on change de logement
    if (propertyId && propertyId !== foundPropertyId) {
      // Supprimer de l'ancien logement
      MANUAL_RESERVATIONS[foundPropertyId].splice(foundReservationIndex, 1);
      if (MANUAL_RESERVATIONS[foundPropertyId].length === 0) {
        delete MANUAL_RESERVATIONS[foundPropertyId];
      }

      // Ajouter au nouveau logement
      if (!MANUAL_RESERVATIONS[propertyId]) {
        MANUAL_RESERVATIONS[propertyId] = [];
      }
      updatedReservation.propertyId = propertyId;
      MANUAL_RESERVATIONS[propertyId].push(updatedReservation);

      // Mettre à jour le store global
      if (reservationsStore.properties[foundPropertyId]) {
        const idx = reservationsStore.properties[foundPropertyId].findIndex(r => r.uid === uid);
        if (idx !== -1) {
          reservationsStore.properties[foundPropertyId].splice(idx, 1);
        }
      }
      if (!reservationsStore.properties[propertyId]) {
        reservationsStore.properties[propertyId] = [];
      }
      reservationsStore.properties[propertyId].push(updatedReservation);
    } else {
      // Même logement, juste mettre à jour
      updatedReservation.propertyId = foundPropertyId;
      MANUAL_RESERVATIONS[foundPropertyId][foundReservationIndex] = updatedReservation;

      // Mettre à jour le store global
      if (reservationsStore.properties[foundPropertyId]) {
        const idx = reservationsStore.properties[foundPropertyId].findIndex(r => r.uid === uid);
        if (idx !== -1) {
          reservationsStore.properties[foundPropertyId][idx] = updatedReservation;
        }
      }
    }

    await saveManualReservations();

    res.json({
      message: 'Réservation modifiée avec succès',
      reservation: updatedReservation
    });
  } catch (err) {
    console.error('Erreur modification réservation manuelle:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE - Supprimer une réservation manuelle
app.delete('/api/reservations/manual/:uid', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const uid = req.params.uid;
    if (!uid) {
      return res.status(400).json({ error: 'Identifiant de réservation manquant' });
    }

    let foundPropertyId = null;
    let foundReservationIndex = -1;
    let foundReservation = null;

    // On parcourt toutes les réservations manuelles de l'utilisateur
    for (const [propertyId, list] of Object.entries(MANUAL_RESERVATIONS)) {
      const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
      if (!property) {
        // ce logement ne lui appartient pas, on ignore
        continue;
      }

      const index = list.findIndex(r => r.uid === uid);
      if (index !== -1) {
        foundPropertyId = propertyId;
        foundReservationIndex = index;
        foundReservation = list[index];
        break;
      }
    }

    if (!foundPropertyId || foundReservationIndex === -1 || !foundReservation) {
      return res.status(404).json({ error: 'Réservation manuelle non trouvée' });
    }

    // Suppression dans MANUAL_RESERVATIONS
    MANUAL_RESERVATIONS[foundPropertyId].splice(foundReservationIndex, 1);
    if (MANUAL_RESERVATIONS[foundPropertyId].length === 0) {
      delete MANUAL_RESERVATIONS[foundPropertyId];
    }
    await saveManualReservations();

    // Suppression aussi dans le store global utilisé par /api/reservations
    if (reservationsStore.properties[foundPropertyId]) {
      const idx = reservationsStore.properties[foundPropertyId].findIndex(r => r.uid === uid);
      if (idx !== -1) {
        reservationsStore.properties[foundPropertyId].splice(idx, 1);
      }
    }

    return res.json({
      message: 'Réservation manuelle supprimée',
      deletedUid: uid
    });
  } catch (err) {
    console.error('Erreur suppression réservation manuelle:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
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
    const { newReservation, reminder } = req.body || {};
    const saved = await saveNotificationSettings(user.id, {
      newReservation,
      reminder,
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
app.get('/api/cleaners', async (req, res) => {
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
// ROUTE API - CHECK-IN INVITÉS (publique)
// ============================================
app.post('/api/checkin/submit', async (req, res) => {
  try {
    const data = req.body || {};
    const reservationUid =
      data.reservationId ||
      data.reservationUid ||
      data.uid;

    if (!reservationUid) {
      return res.status(400).json({ error: 'reservationId requis' });
    }

    CHECKINS[reservationUid] = {
      ...data,
      reservationUid,
      receivedAt: new Date().toISOString()
    };

    await saveCheckins();

    return res.json({ ok: true });
  } catch (error) {
    console.error('❌ Erreur /api/checkin/submit :', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTE API - CHECK-IN INVITÉS (publique)
// ============================================
app.post('/api/checkin/submit', async (req, res) => {
  try {
    const data = req.body || {};
    const reservationUid =
      data.reservationId ||
      data.reservationUid ||
      data.uid;

    if (!reservationUid) {
      return res.status(400).json({ error: 'reservationId requis' });
    }

    CHECKINS[reservationUid] = {
      ...data,
      reservationUid,
      receivedAt: new Date().toISOString()
    };

    await saveCheckins();

    return res.json({ ok: true });
  } catch (error) {
    console.error('❌ Erreur /api/checkin/submit :', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// ROUTES API - GESTION DES LOGEMENTS (par user)
// ============================================

app.get('/api/properties', async (req, res) => {
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
      icalUrls: p.icalUrls.map(url => ({
        url,
        source: icalService.extractSource ? icalService.extractSource(url) : 'Inconnu'
      })),
      reservationCount: (reservationsStore.properties[p.id] || []).length
    }))
  });
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
    icalUrls: property.icalUrls,
    reservationCount: (reservationsStore.properties[property.id] || []).length
  });
});

app.post('/api/properties', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { name, color, icalUrls } = req.body;

    if (!name || !color) {
      return res.status(400).json({ error: 'Nom et couleur requis' });
    }

    const baseId = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const id = `${user.id}-${baseId}`;

    await pool.query(
      `INSERT INTO properties (id, user_id, name, color, ical_urls, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [id, user.id, name, color, JSON.stringify(icalUrls || [])]
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

app.put('/api/properties/:propertyId', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { propertyId } = req.params;
    const { name, color, icalUrls } = req.body;

    const property = PROPERTIES.find(p => p.id === propertyId && p.userId === user.id);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    const newName = name || property.name;
    const newColor = color || property.color;
    const newIcalUrls = (icalUrls !== undefined) ? icalUrls : property.icalUrls;

    await pool.query(
      `UPDATE properties
       SET name = $1,
           color = $2,
           ical_urls = $3
       WHERE id = $4 AND user_id = $5`,
      [newName, newColor, JSON.stringify(newIcalUrls), propertyId, user.id]
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
    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD),
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

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = `u_${Date.now().toString(36)}`;

    await pool.query(
      `INSERT INTO users (id, company, first_name, last_name, email, password_hash, created_at, stripe_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL)`,
      [id, company, firstName, lastName, email, passwordHash]
    );

    const user = {
      id,
      company,
      firstName,
      lastName,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
      stripeAccountId: null
    };

    const token = generateToken(user);

    res.json({
      user: publicUser(user),
      token
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
      `SELECT id, company, first_name, last_name, email, password_hash, created_at, stripe_account_id
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

    if (!reservation) {
    return res.status(404).json({ error: 'Réservation non trouvée' });
  }

  const uid = reservation.uid || reservation.id;
  const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
  const checkinUrl = uid ? `${appUrl}/checkin.html?res=${uid}` : null;
  const checkinData = uid ? (CHECKINS[uid] || null) : null;

  const customData = {
    propertyAddress: 'Adresse du logement à définir',
    accessCode: 'Code à définir',
    checkinUrl,
    checkinData
  };

  const message = messagingService.generateQuickMessage(
    { ...reservation, checkinData, checkinUrl },
    templateKey,
    customData
  );

  if (!message) {
    return res.status(404).json({ error: 'Template non trouvé' });
  }

  res.json(message);
});

  // 🔴 NOUVEAU : construire l'URL de check-in pour cette réservation
  const uid = reservation.uid || reservation.id;  // au cas où ce soit "id" et pas "uid"
  const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';
  const checkinUrl = uid ? `${appUrl}/checkin.html?res=${uid}` : null;

  // Données supplémentaires envoyées au moteur de messages
  const customData = {
    propertyAddress: 'Adresse du logement à définir',
    accessCode: 'Code à définir',
    checkinUrl      // 👉 nouvelle clé accessible dans messagingService
  };

  const message = messagingService.generateQuickMessage(
    reservation,
    templateKey,
    customData
  );


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
// ROUTE API - EMAIL PROXY PAR RÉSERVATION
// ============================================

app.post('/api/reservations/:uid/email-proxy', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const { uid } = req.params;
    const { emailProxy, platform } = req.body || {};

    if (!emailProxy) {
      return res.status(400).json({ error: 'emailProxy requis' });
    }

    EMAIL_PROXIES[uid] = {
      email: emailProxy,
      platform: platform || null,
      updatedAt: new Date().toISOString()
    };

    await saveEmailProxies();

    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Erreur /api/reservations/:uid/email-proxy :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
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
          plan
        }
      },
      customer_email: user.email,
      success_url: `${appUrl}/pricing-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing-cancel.html`
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

    // 🔁 Idempotence : 1 seule caution par séjour (reservationUid)
    let deposit = DEPOSITS.find(d => d.reservationUid === reservationUid);

    // Si une caution existe déjà ET qu'un lien a déjà été généré,
    // on renvoie simplement le même lien (pas de nouvelle caution Stripe)
    if (deposit && deposit.checkoutUrl) {
      return res.json({
        deposit,
        checkoutUrl: deposit.checkoutUrl,
        alreadyExists: true
      });
    }

    // Sinon, on crée ou complète l'objet caution
    if (!deposit) {
      const depositId = 'dep_' + Date.now().toString(36);
      deposit = {
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
    } else {
      // Caution déjà créée mais sans checkoutUrl (par ex. crash avant Stripe)
      deposit.amountCents = amountCents;
    }

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
// 🗄️ ADMIN - GESTION BASE DE DONNÉES
// ============================================

// Page admin database
app.get('/admin/database', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.redirect('/login.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin-database.html'));
  } catch (error) {
    console.error('Erreur page admin:', error);
    res.status(500).send('Erreur serveur');
  }
});

// API : Vérifier l'état de la DB
app.get('/api/admin/check-database', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const requiredColumns = [
      'guest_nationality',
      'guest_birth_date',
      'id_document_path',
      'checkin_completed',
      'checkin_date',
      'checkin_link_sent',
      'checkin_link_sent_at',
      'proxy_email'
    ];

    // Récupérer les colonnes existantes de la table reservations
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
        AND table_name = 'reservations'
    `);

    const existingColumns = result.rows.map(row => row.column_name);
    const missingColumns = requiredColumns.filter(
      col => !existingColumns.includes(col)
    );

    res.json({
      allColumnsExist: missingColumns.length === 0,
      existingColumns: requiredColumns.filter(col => existingColumns.includes(col)),
      missingColumns,
      totalRequired: requiredColumns.length
    });

  } catch (error) {
    console.error('Erreur vérification DB:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification',
      message: error.message 
    });
  }
});

// API : Installer les colonnes manquantes
app.post('/api/admin/install-columns', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const columnsToAdd = [
      { name: 'guest_nationality', type: 'VARCHAR(10)' },
      { name: 'guest_birth_date', type: 'DATE' },
      { name: 'id_document_path', type: 'VARCHAR(255)' },
      { name: 'checkin_completed', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'checkin_date', type: 'TIMESTAMP' },
      { name: 'checkin_link_sent', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'checkin_link_sent_at', type: 'TIMESTAMP' },
      { name: 'proxy_email', type: 'VARCHAR(255)' }
    ];

    let installed = 0;

    for (const column of columnsToAdd) {
      try {
        // Vérifier si la colonne existe déjà
        const checkResult = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public'
            AND table_name = 'reservations'
            AND column_name = $1
        `, [column.name]);

        if (checkResult.rows.length > 0) {
          console.log(`⚠️  Colonne ${column.name} existe déjà`);
          continue;
        }

        // Ajouter la colonne
        await pool.query(`
          ALTER TABLE reservations 
          ADD COLUMN ${column.name} ${column.type}
        `);
        
        installed++;
        console.log(`✅ Colonne ajoutée: ${column.name}`);
        
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Colonne ${column.name} existe déjà (erreur)`);
          continue;
        }
        console.error(`❌ Erreur pour ${column.name}:`, error.message);
      }
    }

    res.json({
      success: true,
      installed: installed,
      message: `${installed} colonne${installed > 1 ? 's ajoutées' : ' ajoutée'}`
    });

  } catch (error) {
    console.error('Erreur installation colonnes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'installation',
      message: error.message
    });
  }
});

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
  await loadEmailProxies();
  await loadCheckins();
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
