// services/notifications-service.js
// ============================================
// 🔔 SERVICE DE NOTIFICATIONS PUSH - VERSION CORRIGÉE
// ============================================
// Service de notifications push Firebase Cloud Messaging
// Corrections :
// - sendNewCleaningNotification : envoi au cleaner (pas au propriétaire)
// - sendCleaningReminderNotification : envoi au cleaner
// - Meilleure gestion des erreurs
// - Support multi-tokens (plusieurs appareils)

const admin = require('firebase-admin');

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
    // ============================================
    // MODE PRODUCTION (Render) : Variables d'environnement
    // ============================================
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('🔧 Initialisation Firebase avec variable JSON (PRODUCTION)');
      
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('✅ Firebase initialisé avec succès (production - env vars)');
      firebaseInitialized = true;
    } 
    // ============================================
    // MODE LOCAL : Fichier serviceAccountKey.json
    // ============================================
    else {
      console.log('🔧 Initialisation Firebase avec fichier JSON (LOCAL)');
      
      const serviceAccount = require('../serviceAccountKey.json');
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
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

  const message = {
    token: fcmToken,
    notification: {
      title,
      body
    },
    data: Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {}),
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default',
        color: '#10B981'
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1
        }
      }
    }
  };

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

  for (const token of fcmTokens) {
    const result = await sendNotification(token, title, body, data);
    results.push(result);
    if (result.success) {
      successCount++;
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

  console.log(`✅ ${successCount}/${fcmTokens.length} notifications envoyées${failureCount > 0 ? ` (${failureCount} échecs)` : ''}`);
  return { success: successCount > 0, successCount, failureCount, results };
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
    
    // Envoyer la notification à TOUS les appareils
    for (const row of result.rows) {
      await sendNotification(
        row.fcm_token,
        `💬 Message de ${property_name}`,
        messagePreview,
        {
          type: 'new_message',
          conversationId: conversationId.toString()
        }
      );
      
      console.log(`📱 Notification message envoyée au token: ${row.fcm_token.substring(0, 30)}...`);
    }
    
  } catch (error) {
    console.error('❌ Erreur sendNewMessageNotification:', error);
  }
}

/**
 * ✅ CORRIGÉ : Envoyer une notification de nouveau ménage AU CLEANER
 * @param {number} cleanerId - ID du cleaner assigné
 * @param {string} propertyName - Nom de la propriété
 * @param {Date} cleaningDate - Date du ménage
 */
async function sendNewCleaningNotification(cleanerId, propertyName, cleaningDate) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    // ✅ Récupérer le token FCM du CLEANER (et non du propriétaire)
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
        cleaning_date: cleaningDate.toISOString()
      }
    );
    
    console.log(`✅ Notification ménage envoyée au cleaner ${result.rows[0].cleaner_name} (ID: ${cleanerId})`);
    
  } catch (error) {
    console.error('❌ Erreur sendNewCleaningNotification:', error);
  }
}

/**
 * ✅ CORRIGÉ : Envoyer un rappel de ménage J-1 AU CLEANER
 * @param {number} cleanerId - ID du cleaner assigné
 * @param {string} propertyName - Nom de la propriété
 * @param {Date} cleaningDate - Date du ménage
 */
async function sendCleaningReminderNotification(cleanerId, propertyName, cleaningDate) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    // ✅ Récupérer le token FCM du CLEANER
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
        cleaning_date: cleaningDate.toISOString()
      }
    );
    
    console.log(`✅ Rappel ménage envoyé au cleaner ${result.rows[0].cleaner_name} (ID: ${cleanerId})`);
    
  } catch (error) {
    console.error('❌ Erreur sendCleaningReminderNotification:', error);
  }
}

/**
 * Envoyer une notification de nouvelle facture
 */
async function sendNewInvoiceNotification(userId, amount, propertyName) {
  try {
    if (!pool) return;

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    await sendNotification(
      result.rows[0].fcm_token,
      '💳 Nouvelle facture',
      `${amount}€ - ${propertyName}`,
      { type: 'new_invoice', amount: amount.toString() }
    );
  } catch (error) {
    console.error('❌ Erreur sendNewInvoiceNotification:', error);
  }
}

/**
 * Envoyer une notification de nouvelle réservation
 */
async function sendNewReservationNotification(userId, guestName, propertyName, checkIn, checkOut) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    // ✅ Récupérer TOUS les tokens FCM (Android + iOS + etc.)
    const result = await pool.query(
      'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️ Aucun token FCM pour user ${userId}`);  // ✅ CORRIGÉ
      return;
    }

    // ✅ Fonction helper pour formater les dates
    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      
      // Gérer les chaînes et les objets Date
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    };

    const checkInFormatted = formatDate(checkIn);
    const checkOutFormatted = formatDate(checkOut);

    // ✅ Créer la plage de dates
    const dateRange = checkOut 
      ? `${checkInFormatted} → ${checkOutFormatted}`
      : checkInFormatted;

    // ✅ ENVOYER LA NOTIFICATION À TOUS LES APPAREILS
    for (const tokenRow of result.rows) {
      await sendNotification(
        tokenRow.fcm_token,
        '🏠 Nouvelle réservation',
        `${guestName} - ${propertyName} (${dateRange})`,
        { 
          type: 'new_reservation',
          property_name: propertyName,
          check_in: typeof checkIn === 'string' ? checkIn : checkIn.toISOString(),
          check_out: typeof checkOut === 'string' ? checkOut : (checkOut ? checkOut.toISOString() : null)
        }
      );
      
      console.log(`📱 Notification réservation envoyée au ${tokenRow.device_type}`);  // ✅ CORRIGÉ
    }
    
    console.log(`✅ ${result.rows.length} notification(s) envoyée(s) pour ${propertyName}`);  // ✅ CORRIGÉ
    
  } catch (error) {
    console.error('❌ Erreur sendNewReservationNotification:', error);
    console.error('   Stack:', error.stack);
  }
}
/**
 * Envoyer une notification d'annulation de réservation
 */
async function sendCancelledReservationNotification(userId, guestName, propertyName, checkIn, checkOut) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    // ✅ Récupérer TOUS les tokens FCM (Android + iOS + etc.)
    const result = await pool.query(
      'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️ Aucun token FCM pour user ${userId}`);
      return;
    }

    // ✅ Fonction helper pour formater les dates
    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    };

    const checkInFormatted = formatDate(checkIn);
    const checkOutFormatted = formatDate(checkOut);

    // ✅ Créer la plage de dates
    const dateRange = checkOut 
      ? `${checkInFormatted} → ${checkOutFormatted}`
      : checkInFormatted;

    // ✅ ENVOYER LA NOTIFICATION À TOUS LES APPAREILS
    for (const tokenRow of result.rows) {
      await sendNotification(
        tokenRow.fcm_token,
        '❌ Réservation annulée',
        `${guestName} - ${propertyName} (${dateRange})`,
        { 
          type: 'cancelled_reservation',
          property_name: propertyName,
          check_in: typeof checkIn === 'string' ? checkIn : checkIn.toISOString(),
          check_out: typeof checkOut === 'string' ? checkOut : (checkOut ? checkOut.toISOString() : null)
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
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`⚠️  Aucun token FCM pour user ${userId}`);
      return { success: false, error: 'Aucun token trouvé' };
    }

    return await sendNotification(result.rows[0].fcm_token, title, body, data);
    
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
