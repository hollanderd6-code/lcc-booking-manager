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
const multer = require('multer');
const whatsappService = require('./services/whatsappService');
const Stripe = require('stripe');
const { Pool } = require('pg');
const axios = require('axios');


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
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter) {
    console.log(
      '⚠️  Transport email non configuré (ni Brevo ni SMTP), aucune notification propriétaire envoyée'
    );
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
        console.log(`📋 Settings récupérés pour user ${userId}:`, JSON.stringify(settings, null, 2));
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
        // 1) Email au propriétaire
        if (useBrevo) {
          await sendEmailViaBrevo({
            to: user.email,
            subject,
            text: textBody,
            html: htmlBody
          });
        } else if (transporter) {
          await transporter.sendMail({
            from,
            to: user.email,
            subject,
            text: textBody,
            html: htmlBody
          });
        }
        console.log(
          `📧 Notification "${type}" envoyée à ${user.email} (resa uid=${res.uid || res.id})`
        );

        // 2) WhatsApp au client (si configuré + activé)
        console.log(`🔍 Vérification WhatsApp pour user ${userId}:`);
        console.log(`   - whatsappService.isConfigured(): ${whatsappService.isConfigured()}`);
        console.log(`   - settings.whatsappEnabled: ${settings?.whatsappEnabled}`);
        console.log(`   - settings.whatsappNumber: ${settings?.whatsappNumber}`);
        
        if (
          whatsappService.isConfigured() &&
          settings &&
          settings.whatsappEnabled &&
          settings.whatsappNumber
        ) {
          console.log(`✅ Toutes les conditions WhatsApp remplies, envoi en cours...`);
          
          const waText =
            type === 'new'
              ? `Nouvelle réservation\n` +
                `Logement : ${propertyName}\n` +
                `Voyageur : ${guest}\n` +
                `Séjour : du ${start} au ${end}\n` +
                `Source : ${source}`
              : `Réservation annulée\n` +
                `Logement : ${propertyName}\n` +
                `Voyageur : ${guest}\n` +
                `Séjour initial : du ${start} au ${end}\n` +
                `Source : ${source}`;

          console.log(`📲 Tentative d'envoi WhatsApp à: ${settings.whatsappNumber}`);
          console.log(`📝 Message: ${waText.substring(0, 100)}...`);

          try {
            await whatsappService.sendWhatsAppText(settings.whatsappNumber, waText);
            console.log(
              `✅ WhatsApp "${type}" envoyé avec succès à ${settings.whatsappNumber} (user ${userId}, resa uid=${res.uid || res.id})`
            );
          } catch (waErr) {
            console.error(
              `❌ Erreur spécifique WhatsApp pour ${settings.whatsappNumber}:`,
              waErr.message || waErr
            );
          }
        } else {
          console.log(`⏭️  WhatsApp non envoyé - au moins une condition non remplie`);
        }
      } catch (err) {
        console.error(
          '❌ Erreur envoi notification réservation (email/WhatsApp) :',
          err
        );
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
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter && !whatsappService.isConfigured()) {
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
  const useBrevo = !!process.env.BREVO_API_KEY;
  const transporter = useBrevo ? null : getEmailTransporter();

  if (!useBrevo && !transporter && !whatsappService.isConfigured()) {
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
    const data = await fs.readFile(MANUAL_RES_FILE, 'utf8');
    MANUAL_RESERVATIONS = JSON.parse(data);
    console.log('✅ Réservations manuelles chargées depuis manual-reservations.json');
  } catch (error) {
    MANUAL_RESERVATIONS = {};
    console.log('⚠️  Aucun fichier manual-reservations.json, démarrage sans réservations manuelles');
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
// ROUTE DE TEST WHATSAPP AMÉLIORÉE
// ============================================

app.get('/api/test-whatsapp', async (req, res) => {
  try {
    console.log('🧪 Test WhatsApp demandé');
    
    // Vérifier si le service est configuré
    const isConfigured = whatsappService.isConfigured();
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
    
    const result = await whatsappService.sendWhatsAppText(testNumber, testMessage);
    
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
    
    await whatsappService.sendWhatsAppText(settings.whatsappNumber, testMessage);
    
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
app.get('/api/reservations', async (req, res) => {
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

// ============================================
// ROUTES API - PROFIL UTILISATEUR ÉTENDU
// ============================================
// À ajouter dans server.js après les routes existantes

// GET - Récupérer le profil complet de l'utilisateur
app.get('/api/user/profile', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    // Récupérer les infos complètes depuis la base
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
        created_at
       FROM users 
       WHERE id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const userProfile = result.rows[0];
    
    res.json({
      id: userProfile.id,
      email: userProfile.email,
      firstName: userProfile.first_name,
      lastName: userProfile.last_name,
      company: userProfile.company,
      accountType: userProfile.account_type || 'individual',
      address: userProfile.address || '',
      postalCode: userProfile.postal_code || '',
      city: userProfile.city || '',
      siret: userProfile.siret || '',
      createdAt: userProfile.created_at
    });

  } catch (err) {
    console.error('Erreur récupération profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT - Mettre à jour le profil complet de l'utilisateur
app.put('/api/user/profile', async (req, res) => {
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
         siret = $8
       WHERE id = $9
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
         siret`,
      [
        firstName || null,
        lastName || null,
        company || null,
        accountType || 'individual',
        address || null,
        postalCode || null,
        city || null,
        (accountType === 'business' ? siret : null) || null,
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
        siret: updated.siret
      }
    });

  } catch (err) {
    console.error('Erreur mise à jour profil:', err);
    
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
      clientType, firstName, lastName, companyName,
      email, phone, address, postalCode, city, country,
      siret, vatNumber,
      defaultCommissionRate, vatApplicable, defaultVatRate,
      properties, notes
    } = req.body;

    // Validation
    if (clientType === 'business' && !companyName) {
      return res.status(400).json({ error: 'Nom d\'entreprise requis' });
    }
    if (clientType === 'individual' && (!firstName || !lastName)) {
      return res.status(400).json({ error: 'Nom et prénom requis' });
    }

    const result = await pool.query(`
      INSERT INTO owner_clients (
        user_id, client_type, first_name, last_name, company_name,
        email, phone, address, postal_code, city, country,
        siret, vat_number,
        default_commission_rate, vat_applicable, default_vat_rate,
        properties, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [
      user.id, clientType, firstName, lastName, companyName,
      email, phone, address, postalCode, city, country || 'France',
      siret, vatNumber,
      defaultCommissionRate || 20, vatApplicable || false, defaultVatRate || 20,
      JSON.stringify(properties || []), notes
    ]);

    res.json({ client: result.rows[0] });
  } catch (err) {
    console.error('Erreur création client:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 4. MODIFIER UN CLIENT
app.put('/api/owner-clients/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const {
      clientType, firstName, lastName, companyName,
      email, phone, address, postalCode, city, country,
      siret, vatNumber,
      defaultCommissionRate, vatApplicable, defaultVatRate,
      properties, notes
    } = req.body;

    const result = await pool.query(`
      UPDATE owner_clients SET
        client_type = $1, first_name = $2, last_name = $3, company_name = $4,
        email = $5, phone = $6, address = $7, postal_code = $8, city = $9, country = $10,
        siret = $11, vat_number = $12,
        default_commission_rate = $13, vat_applicable = $14, default_vat_rate = $15,
        properties = $16, notes = $17
      WHERE id = $18 AND user_id = $19
      RETURNING *
    `, [
      clientType, firstName, lastName, companyName,
      email, phone, address, postalCode, city, country,
      siret, vatNumber,
      defaultCommissionRate, vatApplicable, defaultVatRate,
      JSON.stringify(properties || []), notes,
      req.params.id, user.id
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
// FACTURES PROPRIÉTAIRES
// ============================================

// 6. CRÉER UNE FACTURE
app.post('/api/owner-invoices', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    await client.query('BEGIN');

    const {
      clientId, periodStart, periodEnd, issueDate, dueDate,
      items, // Array des prestations
      vatApplicable, vatRate,
      notes, footerText, internalNotes,
      sendEmail
    } = req.body;

    // Récupérer les infos du client
    const clientResult = await client.query(
      'SELECT * FROM owner_clients WHERE id = $1 AND user_id = $2',
      [clientId, user.id]
    );

    if (clientResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    const clientData = clientResult.rows[0];
    const clientName = clientData.client_type === 'business' 
      ? clientData.company_name 
      : `${clientData.first_name} ${clientData.last_name}`;

    // Calculs
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

    const vatAmount = vatApplicable ? subtotalHt * (parseFloat(vatRate) / 100) : 0;
    const totalTtc = subtotalHt + subtotalDebours + vatAmount;

    // Générer numéro de facture
    const invoiceNumberResult = await client.query(
      "SELECT get_next_invoice_number($1) as invoice_number",
      [user.id]
    );
    const invoiceNumber = invoiceNumberResult.rows[0].invoice_number;

    // Insérer la facture
    const invoiceResult = await client.query(`
      INSERT INTO owner_invoices (
        invoice_number, user_id, client_id,
        client_name, client_email, client_address, client_postal_code, client_city, client_siret,
        period_start, period_end, issue_date, due_date,
        vat_applicable, vat_rate,
        subtotal_ht, subtotal_debours, vat_amount, total_ttc,
        status, notes, footer_text, internal_notes, sent_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
      ) RETURNING id
    `, [
      invoiceNumber, user.id, clientId,
      clientName, clientData.email, clientData.address, clientData.postal_code, clientData.city, clientData.siret,
      periodStart, periodEnd, issueDate || new Date(), dueDate,
      vatApplicable, vatRate,
      subtotalHt, subtotalDebours, vatAmount, totalTtc,
      sendEmail ? 'sent' : 'draft', notes, footerText, internalNotes, sendEmail ? new Date() : null
    ]);

    const invoiceId = invoiceResult.rows[0].id;

    // Insérer les lignes
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(`
        INSERT INTO owner_invoice_items (
          invoice_id, item_type, description,
          rental_amount, commission_rate, quantity, unit_price, total,
          order_index, is_debours
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        invoiceId, item.itemType, item.description,
        item.rentalAmount, item.commissionRate, item.quantity, item.unitPrice, item.total,
        i, item.isDebours || false
      ]);
    }

    await client.query('COMMIT');

    // Envoyer email si demandé
    if (sendEmail && clientData.email) {
      try {
        await sendOwnerInvoiceEmail({
          invoiceNumber, clientName, clientEmail: clientData.email,
          periodStart, periodEnd, totalTtc, items,
          userCompany: user.company, userEmail: user.email
        });
      } catch (emailErr) {
        console.error('Erreur envoi email:', emailErr);
      }
    }

    res.json({
      success: true,
      invoiceId,
      invoiceNumber,
      message: sendEmail ? 'Facture créée et envoyée' : 'Facture créée'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// 7. LISTE DES FACTURES
app.get('/api/owner-invoices', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const { status, clientId, year, limit, offset } = req.query;

    let query = `
      SELECT oi.*, oc.email as client_email_current
      FROM owner_invoices oi
      LEFT JOIN owner_clients oc ON oi.client_id = oc.id
      WHERE oi.user_id = $1
    `;
    const params = [user.id];
    let paramIndex = 2;

    if (status) {
      query += ` AND oi.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (clientId) {
      query += ` AND oi.client_id = $${paramIndex}`;
      params.push(clientId);
      paramIndex++;
    }

    if (year) {
      query += ` AND EXTRACT(YEAR FROM oi.issue_date) = $${paramIndex}`;
      params.push(year);
      paramIndex++;
    }

    query += ' ORDER BY oi.issue_date DESC';

    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(limit);
      paramIndex++;
    }

    if (offset) {
      query += ` OFFSET $${paramIndex}`;
      params.push(offset);
    }

    const result = await pool.query(query, params);

    res.json({ invoices: result.rows });
  } catch (err) {
    console.error('Erreur liste factures:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 8. DÉTAIL FACTURE
app.get('/api/owner-invoices/:id', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const invoiceResult = await pool.query(
      'SELECT * FROM owner_invoices WHERE id = $1 AND user_id = $2',
      [req.params.id, user.id]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvée' });
    }

    const itemsResult = await pool.query(
      'SELECT * FROM owner_invoice_items WHERE invoice_id = $1 ORDER BY order_index',
      [req.params.id]
    );

    const attachmentsResult = await pool.query(
      'SELECT * FROM owner_invoice_attachments WHERE invoice_id = $1',
      [req.params.id]
    );

    res.json({
      invoice: invoiceResult.rows[0],
      items: itemsResult.rows,
      attachments: attachmentsResult.rows
    });
  } catch (err) {
    console.error('Erreur détail facture:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 9. UPLOAD JUSTIFICATIF
app.post('/api/owner-invoices/:id/upload-justificatif', uploadAttachment.single('file'), async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier' });
    }

    const { itemId } = req.body;

    const result = await pool.query(`
      INSERT INTO owner_invoice_attachments (invoice_id, item_id, filename, file_path, file_size, mime_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      req.params.id,
      itemId || null,
      req.file.originalname,
      '/uploads/justificatifs/' + req.file.filename,
      req.file.size,
      req.file.mimetype
    ]);

    res.json({ attachment: result.rows[0] });
  } catch (err) {
    console.error('Erreur upload:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 10. EXPORT EXCEL
app.get('/api/owner-invoices/export/excel', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Non autorisé' });

    const { year } = req.query;

    let query = 'SELECT * FROM owner_invoices WHERE user_id = $1';
    const params = [user.id];

    if (year) {
      query += ' AND EXTRACT(YEAR FROM issue_date) = $2';
      params.push(year);
    }

    query += ' ORDER BY issue_date DESC';

    const result = await pool.query(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Factures Propriétaires');

    worksheet.columns = [
      { header: 'N° Facture', key: 'invoice_number', width: 15 },
      { header: 'Client', key: 'client_name', width: 30 },
      { header: 'Date émission', key: 'issue_date', width: 15 },
      { header: 'Période début', key: 'period_start', width: 15 },
      { header: 'Période fin', key: 'period_end', width: 15 },
      { header: 'Montant HT', key: 'subtotal_ht', width: 12 },
      { header: 'Débours', key: 'subtotal_debours', width: 12 },
      { header: 'TVA', key: 'vat_amount', width: 12 },
      { header: 'Total TTC', key: 'total_ttc', width: 12 },
      { header: 'Statut', key: 'status', width: 12 }
    ];

    result.rows.forEach(invoice => {
      worksheet.addRow({
        invoice_number: invoice.invoice_number,
        client_name: invoice.client_name,
        issue_date: invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('fr-FR') : '',
        period_start: invoice.period_start ? new Date(invoice.period_start).toLocaleDateString('fr-FR') : '',
        period_end: invoice.period_end ? new Date(invoice.period_end).toLocaleDateString('fr-FR') : '',
        subtotal_ht: parseFloat(invoice.subtotal_ht),
        subtotal_debours: parseFloat(invoice.subtotal_debours),
        vat_amount: parseFloat(invoice.vat_amount),
        total_ttc: parseFloat(invoice.total_ttc),
        status: invoice.status
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=factures-proprietaires-${year || 'all'}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Erreur export Excel:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================
// FONCTION EMAIL
// ============================================

async function sendOwnerInvoiceEmail(data) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const itemsList = data.items.map(item => {
    if (item.itemType === 'commission') {
      return `- ${item.description}: ${item.total.toFixed(2)} € (${item.commissionRate}% de ${item.rentalAmount} €)`;
    }
    return `- ${item.description}: ${item.total.toFixed(2)} €`;
  }).join('\n');

  const emailContent = `
Bonjour ${data.clientName},

Veuillez trouver ci-dessous votre facture pour la période du ${new Date(data.periodStart).toLocaleDateString('fr-FR')} au ${new Date(data.periodEnd).toLocaleDateString('fr-FR')}.

FACTURE N° ${data.invoiceNumber}

Prestations :
${itemsList}

TOTAL : ${data.totalTtc.toFixed(2)} €

Cordialement,
${data.userCompany}
  `;

  await transporter.sendMail({
    from: data.userEmail,
    to: data.clientEmail,
    subject: `Facture ${data.invoiceNumber} - ${data.userCompany}`,
    text: emailContent
  });
}

// ============================================
// FIN DES ROUTES - FACTURATION PROPRIÉTAIRES
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
