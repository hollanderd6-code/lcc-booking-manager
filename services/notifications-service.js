const admin = require('firebase-admin');

// Pool sera passé en paramètre
let pool = null;

function setPool(pgPool) {
  pool = pgPool;
}

// Initialiser Firebase Admin (une seule fois)
let firebaseInitialized = false;

function initializeFirebase() {
  if (!firebaseInitialized) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : require('./firebase-service-account.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialisé');
  }
}

// ============================================
// FONCTION DE BASE : ENVOYER UNE NOTIFICATION
// ============================================

async function sendNotification(token, title, body, data = {}) {
  initializeFirebase();
  
  const message = {
    notification: { title, body },
    data: data,
    token: token,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default'
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
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Erreur Firebase:', error.code, error.message);
    
    // Supprimer token invalide
    if (pool && (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered')) {
      try {
        await pool.query('DELETE FROM user_fcm_tokens WHERE fcm_token = $1', [token]);
        console.log('🗑️ Token invalide supprimé');
      } catch (dbError) {
        console.error('❌ Erreur suppression token:', dbError);
      }
    }
    
    return { success: false, error: error.message };
  }
}

// ============================================
// NOTIFICATIONS PAR TYPE
// ============================================

/**
 * Envoyer une notification de nouveau message
 */
async function sendNewMessageNotification(userId, conversationId, messagePreview, propertyName) {
  try {
    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No token' };
    }
    
    return await sendNotification(
      result.rows[0].fcm_token,
      '💬 Nouveau message',
      messagePreview,
      {
        type: 'new_chat_message',
        conversation_id: conversationId.toString(),
        property_name: propertyName || 'Logement'
      }
    );
  } catch (error) {
    console.error('❌ Erreur notification message:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Envoyer une notification de nouveau ménage assigné
 */
async function sendNewCleaningNotification(userId, cleaningId, propertyName, cleanerName, cleaningDate) {
  try {
    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No token' };
    }
    
    const formattedDate = new Date(cleaningDate).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long'
    });
    
    return await sendNotification(
      result.rows[0].fcm_token,
      '🧹 Nouveau ménage assigné',
      `${cleanerName} - ${propertyName} le ${formattedDate}`,
      {
        type: 'new_cleaning',
        cleaning_id: cleaningId.toString(),
        property_name: propertyName
      }
    );
  } catch (error) {
    console.error('❌ Erreur notification ménage:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Envoyer un rappel de ménage (J-1)
 */
async function sendCleaningReminderNotification(userId, cleaningId, propertyName, cleanerName, cleaningDate) {
  try {
    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No token' };
    }
    
    return await sendNotification(
      result.rows[0].fcm_token,
      '⏰ Rappel : Ménage demain',
      `${cleanerName} - ${propertyName}`,
      {
        type: 'cleaning_reminder',
        cleaning_id: cleaningId.toString(),
        property_name: propertyName
      }
    );
  } catch (error) {
    console.error('❌ Erreur rappel ménage:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Envoyer une notification de nouvelle facture
 */
async function sendNewInvoiceNotification(userId, invoiceId, invoiceType, amount) {
  try {
    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No token' };
    }
    
    const typeLabel = invoiceType === 'owner' ? 'Facture propriétaire' : 'Facture';
    const formattedAmount = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
    
    return await sendNotification(
      result.rows[0].fcm_token,
      `💰 ${typeLabel}`,
      `Nouvelle facture de ${formattedAmount}`,
      {
        type: 'new_invoice',
        invoice_id: invoiceId.toString(),
        invoice_type: invoiceType
      }
    );
  } catch (error) {
    console.error('❌ Erreur notification facture:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Envoyer une notification de nouvelle réservation
 */
async function sendNewReservationNotification(userId, reservationId, propertyName, guestName, checkIn, checkOut, platform) {
  try {
    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No token' };
    }
    
    const checkInDate = new Date(checkIn).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short'
    });
    const checkOutDate = new Date(checkOut).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short'
    });
    
    const platformEmoji = platform === 'airbnb' ? '🏠' : platform === 'booking' ? '🏨' : '📅';
    
    return await sendNotification(
      result.rows[0].fcm_token,
      `${platformEmoji} Nouvelle réservation`,
      `${propertyName} - ${checkInDate} au ${checkOutDate}`,
      {
        type: 'new_reservation',
        reservation_id: reservationId.toString(),
        property_name: propertyName
      }
    );
  } catch (error) {
    console.error('❌ Erreur notification réservation:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Envoyer à plusieurs tokens (broadcast)
 */
async function sendNotificationToMultiple(tokens, title, body, data = {}) {
  initializeFirebase();
  
  const message = {
    notification: { title, body },
    data: data,
    tokens: tokens,
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
    console.log(`✅ ${response.successCount} notifications envoyées`);
    
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`❌ Échec pour token ${idx}:`, resp.error);
        }
      });
    }
    
    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount 
    };
  } catch (error) {
    console.error('❌ Erreur multicast:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  setPool,
  initializeFirebase,
  sendNotification,
  sendNewMessageNotification,
  sendNewCleaningNotification,
  sendCleaningReminderNotification,
  sendNewInvoiceNotification,
  sendNewReservationNotification,
  sendNotificationToMultiple
};
