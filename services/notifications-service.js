// services/notifications-service.js
// ============================================
// 🔔 SERVICE DE NOTIFICATIONS PUSH
// ============================================
// Firebase Cloud Messaging. Corrections successives :
// - sendNewCleaningNotification / sendCleaningReminderNotification : envoi au
//   cleaner, pas au propriétaire
// - support multi-tokens (plusieurs appareils)
// - ✅ NOUVEAU : les préférences de Mon compte ▸ Notifications sont respectées.
//   Le filtre est posé dans sendNotification(), donc il couvre AUSSI tous les
//   appelants externes (integrated-chat-handler, crons cautions, upsell) sans
//   les modifier. server.js garde son propre shouldSendNotification() : les deux
//   lisent la même colonne, le double contrôle est inoffensif.
// - ✅ NOUVEAU : payloads complétés (invoice_number, reservation_id) pour que
//   l'app iOS puisse ouvrir l'élément concerné et pas seulement l'onglet.

const admin = require('firebase-admin');
const { allowsForToken } = require('./notification-preferences');

let pool = null;
let firebaseInitialized = false;

/**
 * Définir le pool PostgreSQL
 */
function setPool(pgPool) {
  pool = pgPool;
  console.log('✅ Pool PostgreSQL défini dans notifications-service');
}

/**
 * Initialiser Firebase Admin SDK
 * Gère automatiquement :
 * - Production (Render) : Variables d'environnement
 * - Local : Fichier serviceAccountKey.json
 */
function initializeFirebase() {
  if (firebaseInitialized) {
    console.log('ℹ️  Firebase déjà initialisé');
    return;
  }

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('🔧 Initialisation Firebase avec variable JSON (PRODUCTION)');
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase initialisé avec succès (production - env vars)');
      firebaseInitialized = true;
    } else {
      console.log('🔧 Initialisation Firebase avec fichier JSON (LOCAL)');
      const serviceAccount = require('../serviceAccountKey.json');
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase initialisé avec succès (local - fichier JSON)');
      firebaseInitialized = true;
    }
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation de Firebase:', error);
    console.error('   Assurez-vous que :');
    console.error('   - Les variables d\'environnement sont définies sur Render');
    console.error('   - OU que serviceAccountKey.json existe en local');
  }
}

// Les valeurs `null` / `undefined` d'un payload FCM deviennent les chaînes
// "null" / "undefined" (data n'accepte que des strings) : l'app lit alors une
// date invalide. On les retire à la source.
function cleanData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

/**
 * Envoyer une notification à un token spécifique
 */
async function sendNotification(fcmToken, title, body, data = {}) {
  if (!firebaseInitialized) {
    console.error('❌ Firebase non initialisé, impossible d\'envoyer la notification');
    return { success: false, error: 'Firebase non initialisé' };
  }

  if (!fcmToken) {
    console.error('❌ Token FCM manquant');
    return { success: false, error: 'Token FCM manquant' };
  }

  // ── Préférences utilisateur ───────────────────────────────────────────────
  // Seul point de passage de tous les envois de ce fichier ET de ses appelants
  // externes. Une lecture ratée (token inconnu, panne SQL) laisse passer :
  // le filtre ne doit jamais faire taire l'app par accident.
  if (pool && data && data.type) {
    const allowed = await allowsForToken(pool, fcmToken, data.type);
    if (!allowed) {
      console.log(`🔕 [NOTIF-PREF] ${data.type} coupé par l'utilisateur — envoi annulé`);
      return { success: false, skipped: true, error: 'Préférence utilisateur' };
    }
  }

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: cleanData(data),
    android: {
      priority: 'high',
      ttl: 86400000, // 24h en ms
      notification: {
        sound: 'default',
        channelId: 'default',
        color: '#10B981'
      }
    },
    apns: {
      headers: {
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
        'apns-priority': '10',
        // Push d'alerte visible (PAS un push d'arrière-plan).
        // ⚠️ Ne JAMAIS remettre 'content-available': 1 ici : ça transforme la notif
        // en push silencieux qu'iOS bride et JETTE après une période hors-ligne
        // (ex. mode avion la nuit) → notifications perdues au réveil.
        'apns-push-type': 'alert'
      },
      payload: {
        aps: {
          sound: 'default'
          // badge retire volontairement : iOS affichait la valeur telle quelle
          // (toujours 1) et aucun push ne renvoyait jamais 0. Le badge est
          // desormais pilote par l'app, qui connait le vrai etat de lecture.
        }
      }
    }
  };

  // Regroupement écran verrouillé : iOS empile par thread-id (pas de perte de message).
  // Clé = data._group (posée par bhPush) sinon par type. Android : le client lit data._group.
  const _groupKey = data && (data._group || (data.type ? ('type_' + data.type) : null));
  if (_groupKey) {
    message.apns.payload.aps['thread-id'] = String(_groupKey);
  }

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Notification envoyée:', { title, to: fcmToken.substring(0, 20) + '...' });
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Erreur envoi notification:', error.message);

    // Si le token est invalide ou introuvable, le supprimer de la DB
    const invalidCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument'
    ];
    const isInvalid = invalidCodes.includes(error.code) ||
                      (error.message || '').includes('Requested entity was not found');

    if (isInvalid) {
      console.warn('⚠️  Token FCM invalide, suppression en DB:', fcmToken.substring(0, 20) + '...');
      try {
        if (pool) {
          await pool.query('DELETE FROM user_fcm_tokens WHERE fcm_token = $1', [fcmToken]);
          console.log('🗑️ Token invalide supprimé de la DB');
        }
      } catch (e) {}
    }

    return { success: false, error: error.message };
  }
}

/**
 * Envoyer une notification à plusieurs tokens
 */
async function sendNotificationToMultiple(fcmTokens, title, body, data = {}) {
  if (!firebaseInitialized) {
    console.error('❌ Firebase non initialisé');
    return { success: false, error: 'Firebase non initialisé' };
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    return { success: false, error: 'Aucun token FCM fourni' };
  }

  const results = [];
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  for (const token of fcmTokens) {
    const result = await sendNotification(token, title, body, data);
    results.push(result);
    if (result.success) {
      successCount++;
    } else if (result.skipped) {
      skippedCount++;                 // préférence coupée : pas un échec
    } else {
      failureCount++;
      // Nettoyer les tokens invalides
      const errorMsg = result.error || '';
      if (errorMsg.includes('not-registered') ||
          errorMsg.includes('invalid-registration-token') ||
          errorMsg.includes('authentication credential') ||
          errorMsg.includes('UNREGISTERED')) {
        if (pool) {
          try {
            await pool.query('DELETE FROM user_fcm_tokens WHERE fcm_token = $1', [token]);
            console.log(`🗑️ Token invalide supprimé: ${token.substring(0, 20)}...`);
          } catch (e) {}
        }
      }
    }
  }

  console.log(`✅ ${successCount}/${fcmTokens.length} notifications envoyées${failureCount > 0 ? ` (${failureCount} échecs)` : ''}${skippedCount > 0 ? ` (${skippedCount} coupées par préférence)` : ''}`);
  return { success: successCount > 0, successCount, failureCount, skippedCount, results };
}

/**
 * Envoyer une notification de nouveau message
 * Support multi-appareils (tous les tokens de l'utilisateur)
 */
async function sendNewMessageNotification(userId, senderName, messagePreview, conversationId) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    // Récupérer TOUS les tokens de l'utilisateur (iPhone + Android + Web)
    const result = await pool.query(
      `SELECT t.fcm_token, p.name as property_name
       FROM user_fcm_tokens t
       LEFT JOIN conversations c ON c.user_id = t.user_id
       LEFT JOIN properties p ON p.id = c.property_id
       WHERE t.user_id = $1 
       AND c.id = $2
       AND t.fcm_token IS NOT NULL`,
      [userId, conversationId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️  Aucun token FCM pour user ${userId}`);
      return;
    }

    const property_name = result.rows[0].property_name || 'Voyageur';

    for (const row of result.rows) {
      await sendNotification(
        row.fcm_token,
        `💬 Message de ${property_name}`,
        messagePreview,
        {
          type: 'new_message',
          // Les deux casses : l'app iOS et le routeur web lisent l'une ou l'autre
          // selon le type. Les envoyer toutes les deux évite un tap qui n'ouvre
          // que la liste des conversations.
          conversationId: conversationId.toString(),
          conversation_id: conversationId.toString()
        }
      );
    }

  } catch (error) {
    console.error('❌ Erreur sendNewMessageNotification:', error);
  }
}

/**
 * Envoyer une notification de nouveau ménage AU CLEANER
 * (type dans ALWAYS : le propriétaire ne peut pas couper le travail d'un tiers)
 */
async function sendNewCleaningNotification(cleanerId, propertyName, cleaningDate, checklistId = null) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    const result = await pool.query(
      `SELECT t.fcm_token, c.name as cleaner_name, c.user_id
       FROM cleaners c
       LEFT JOIN user_fcm_tokens t ON t.user_id = c.user_id
       WHERE c.id = $1`,
      [cleanerId]
    );

    if (result.rows.length === 0) {
      console.log(`⚠️  Cleaner ${cleanerId} non trouvé`);
      return;
    }

    if (!result.rows[0].fcm_token) {
      console.log(`⚠️  Aucun token FCM pour cleaner ${cleanerId} (${result.rows[0].cleaner_name})`);
      return;
    }

    const formattedDate = new Date(cleaningDate).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    await sendNotification(
      result.rows[0].fcm_token,
      '🧹 Nouveau ménage assigné',
      `${propertyName} - ${formattedDate}`,
      {
        type: 'new_cleaning',
        property_name: propertyName,
        cleaning_date: cleaningDate.toISOString(),
        // Permet à l'app d'ouvrir directement la checklist quand elle existe.
        checklist_id: checklistId,
        checklistId: checklistId
      }
    );

    console.log(`✅ Notification ménage envoyée au cleaner ${result.rows[0].cleaner_name} (ID: ${cleanerId})`);

  } catch (error) {
    console.error('❌ Erreur sendNewCleaningNotification:', error);
  }
}

/**
 * Rappel de ménage J-1 AU CLEANER
 */
async function sendCleaningReminderNotification(cleanerId, propertyName, cleaningDate, checklistId = null) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    const result = await pool.query(
      `SELECT t.fcm_token, c.name as cleaner_name
       FROM cleaners c
       LEFT JOIN user_fcm_tokens t ON t.user_id = c.user_id
       WHERE c.id = $1`,
      [cleanerId]
    );

    if (result.rows.length === 0 || !result.rows[0].fcm_token) {
      console.log(`⚠️  Aucun token FCM pour cleaner ${cleanerId}`);
      return;
    }

    const formattedDate = new Date(cleaningDate).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    await sendNotification(
      result.rows[0].fcm_token,
      '⏰ Rappel : Ménage demain',
      `${propertyName} - ${formattedDate}`,
      {
        type: 'cleaning_reminder',
        property_name: propertyName,
        cleaning_date: cleaningDate.toISOString(),
        checklist_id: checklistId,
        checklistId: checklistId
      }
    );

    console.log(`✅ Rappel ménage envoyé au cleaner ${result.rows[0].cleaner_name} (ID: ${cleanerId})`);

  } catch (error) {
    console.error('❌ Erreur sendCleaningReminderNotification:', error);
  }
}

/**
 * Envoyer une notification de nouvelle facture
 *
 * ⚠️ invoiceNumber est le seul identifiant utilisable côté client
 * (POST /api/invoice/resend et l'écran Séjours ▸ Factures travaillent avec lui).
 * Sans lui, un tap sur la notification ne peut ouvrir que la liste.
 */
async function sendNewInvoiceNotification(userId, amount, propertyName, invoiceNumber = null) {
  try {
    if (!pool) return;

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length === 0) return;

    // Tous les appareils, pas seulement le premier (bug historique : rows[0]).
    for (const row of result.rows) {
      await sendNotification(
        row.fcm_token,
        '💳 Nouvelle facture',
        `${amount}€ - ${propertyName}`,
        {
          type: 'new_invoice',
          amount: amount,
          property_name: propertyName,
          invoice_number: invoiceNumber,
          invoiceNumber: invoiceNumber
        }
      );
    }
  } catch (error) {
    console.error('❌ Erreur sendNewInvoiceNotification:', error);
  }
}

/**
 * Envoyer une notification de nouvelle réservation
 */
async function sendNewReservationNotification(userId, guestName, propertyName, checkIn, checkOut, reservationId = null, propertyId = null) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    const result = await pool.query(
      'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️ Aucun token FCM pour user ${userId}`);
      return;
    }

    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const iso = (d) => (!d ? null : (typeof d === 'string' ? d : d.toISOString()));

    const checkInFormatted  = formatDate(checkIn);
    const checkOutFormatted = formatDate(checkOut);
    const dateRange = checkOut ? `${checkInFormatted} → ${checkOutFormatted}` : checkInFormatted;

    for (const tokenRow of result.rows) {
      await sendNotification(
        tokenRow.fcm_token,
        '🏠 Nouvelle réservation',
        `${guestName} - ${propertyName} (${dateRange})`,
        {
          type: 'new_reservation',
          property_name: propertyName,
          property_id: propertyId,
          // L'app ouvre le calendrier sur cette date, et la fiche réservation
          // quand l'uid est fourni.
          reservation_id: reservationId,
          check_in: iso(checkIn),
          start_date: iso(checkIn),
          check_out: iso(checkOut),
          end_date: iso(checkOut)
        }
      );
      console.log(`📱 Notification réservation envoyée au ${tokenRow.device_type}`);
    }

    console.log(`✅ ${result.rows.length} notification(s) envoyée(s) pour ${propertyName}`);

  } catch (error) {
    console.error('❌ Erreur sendNewReservationNotification:', error);
    console.error('   Stack:', error.stack);
  }
}

/**
 * Envoyer une notification d'annulation de réservation
 */
async function sendCancelledReservationNotification(userId, guestName, propertyName, checkIn, checkOut, reservationId = null, propertyId = null) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    const result = await pool.query(
      'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️ Aucun token FCM pour user ${userId}`);
      return;
    }

    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    const iso = (d) => (!d ? null : (typeof d === 'string' ? d : d.toISOString()));

    const checkInFormatted  = formatDate(checkIn);
    const checkOutFormatted = formatDate(checkOut);
    const dateRange = checkOut ? `${checkInFormatted} → ${checkOutFormatted}` : checkInFormatted;

    for (const tokenRow of result.rows) {
      await sendNotification(
        tokenRow.fcm_token,
        '❌ Réservation annulée',
        `${guestName} - ${propertyName} (${dateRange})`,
        {
          type: 'cancelled_reservation',
          property_name: propertyName,
          property_id: propertyId,
          reservation_id: reservationId,
          check_in: iso(checkIn),
          start_date: iso(checkIn),
          check_out: iso(checkOut),
          end_date: iso(checkOut)
        }
      );
      console.log(`📱 Notification annulation envoyée au ${tokenRow.device_type}`);
    }

    console.log(`✅ ${result.rows.length} notification(s) d'annulation envoyée(s) pour ${propertyName}`);

  } catch (error) {
    console.error('❌ Erreur sendCancelledReservationNotification:', error);
    console.error('   Stack:', error.stack);
  }
}

/**
 * Envoyer une notification à un utilisateur par son ID
 * (Wrapper pour simplifier l'envoi)
 */
async function sendNotificationByUserId(userId, title, body, data = {}) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return { success: false, error: 'Pool non défini' };
    }

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`⚠️  Aucun token FCM pour user ${userId}`);
      return { success: false, error: 'Aucun token trouvé' };
    }

    // Tous les appareils : un utilisateur avec iPhone + iPad ne recevait que
    // sur le premier enregistré.
    return await sendNotificationToMultiple(
      result.rows.map((r) => r.fcm_token),
      title,
      body,
      data
    );

  } catch (error) {
    console.error('❌ Erreur sendNotificationByUserId:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  setPool,
  initializeFirebase,
  sendNotification,
  sendNotificationToMultiple,
  sendNotificationByUserId,
  sendNewMessageNotification,
  sendNewCleaningNotification,
  sendCleaningReminderNotification,
  sendNewInvoiceNotification,
  sendNewReservationNotification,
  sendCancelledReservationNotification
};
