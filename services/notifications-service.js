// services/notifications-service.js
// Service de notifications push Firebase Cloud Messaging

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
 * Envoyer une notification à un utilisateur
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
        color: '#3B82F6'
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
    console.error('❌ Erreur envoi notification:', error);
    
    // Si le token est invalide, on pourrait le supprimer de la DB
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.warn('⚠️  Token FCM invalide ou expiré:', fcmToken.substring(0, 20) + '...');
      // TODO: Supprimer le token de la DB
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Envoyer une notification à plusieurs utilisateurs
 */
async function sendNotificationToMultiple(fcmTokens, title, body, data = {}) {
  if (!firebaseInitialized) {
    console.error('❌ Firebase non initialisé');
    return { success: false, error: 'Firebase non initialisé' };
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    return { success: false, error: 'Aucun token FCM fourni' };
  }

  // Firebase limite à 500 tokens par requête
  const batchSize = 500;
  const results = [];

  for (let i = 0; i < fcmTokens.length; i += batchSize) {
    const batch = fcmTokens.slice(i, i + batchSize);
    
    const message = {
      tokens: batch,
      notification: { title, body },
      data: Object.entries(data).reduce((acc, [key, value]) => {
        acc[key] = String(value);
        return acc;
      }, {}),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default'
        }
      }
    };

    try {
      const response = await admin.messaging().sendMulticast(message);
      console.log(`✅ ${response.successCount}/${batch.length} notifications envoyées`);
      
      if (response.failureCount > 0) {
        console.warn(`⚠️  ${response.failureCount} échecs`);
      }
      
      results.push(response);
    } catch (error) {
      console.error('❌ Erreur envoi batch:', error);
    }
  }

  return results;
}

/**
 * Envoyer une notification de nouveau message
 */
async function sendNewMessageNotification(userId, senderName, messagePreview, conversationId, propertyName) {
  try {
    if (!pool) {
      console.error('❌ Pool non défini');
      return;
    }

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️  Aucun token FCM pour user ${userId}`);
      return;
    }

    const token = result.rows[0].fcm_token;
    
    await sendNotification(
      token,
      `📩 Nouveau message de Voyageur — ${propertyName}`,
      messagePreview,
      {
        type: 'new_message',
        conversationId: conversationId.toString(),
        propertyName: propertyName
      }
    );
  } catch (error) {
    console.error('❌ Erreur sendNewMessageNotification:', error);
  }
}

/**
 * Envoyer une notification de nouveau nettoyage
 */
async function sendNewCleaningNotification(userId, propertyName, date) {
  try {
    if (!pool) return;

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    await sendNotification(
      result.rows[0].fcm_token,
      '🧹 Nouveau ménage assigné',
      `${propertyName} - ${date}`,
      { type: 'new_cleaning', date }
    );
  } catch (error) {
    console.error('❌ Erreur sendNewCleaningNotification:', error);
  }
}

/**
 * Envoyer un rappel de nettoyage
 */
async function sendCleaningReminderNotification(userId, propertyName, date) {
  try {
    if (!pool) return;

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    await sendNotification(
      result.rows[0].fcm_token,
      '⏰ Rappel : Ménage à faire',
      `${propertyName} - ${date}`,
      { type: 'cleaning_reminder', date }
    );
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
async function sendNewReservationNotification(userId, guestName, propertyName, checkIn) {
  try {
    if (!pool) return;

    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    await sendNotification(
      result.rows[0].fcm_token,
      '🏠 Nouvelle réservation',
      `${guestName} - ${propertyName} (${checkIn})`,
      { type: 'new_reservation', checkIn }
    );
  } catch (error) {
    console.error('❌ Erreur sendNewReservationNotification:', error);
  }
}

module.exports = {
  setPool,
  initializeFirebase,
  sendNotification,
  sendNotificationToMultiple,
  sendNewMessageNotification,
  sendNewCleaningNotification,
  sendCleaningReminderNotification,
  sendNewInvoiceNotification,
  sendNewReservationNotification
};
