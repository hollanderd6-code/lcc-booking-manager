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
    try {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : require('../firebase-service-account.json');
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      firebaseInitialized = true;
      console.log('✅ Firebase Admin initialisé');
    } catch (error) {
      console.error('❌ Erreur initialisation Firebase:', error.message);
      firebaseInitialized = false;
    }
  }
}

// ============================================
// FONCTIONS DE BASE
// ============================================

async function sendNotification(token, title, body, data = {}) {
  initializeFirebase();
  
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase non initialisé - notification ignorée');
    return { success: false, error: 'Firebase not initialized' };
  }
  
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

async function sendApnsNotification(apnsToken, title, body, data = {}) {
  initializeFirebase();
  
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase non initialisé');
    return { success: false, error: 'Firebase not initialized' };
  }
  
  const message = {
    token: apnsToken,
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert'
      },
      payload: {
        aps: {
          alert: {
            title: title,
            body: body
          },
          sound: 'default',
          badge: 1,
          'content-available': 1
        },
        ...data
      }
    }
  };
  
  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Notification APNs envoyée:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Erreur APNs:', error.code, error.message);
    
    // Supprimer token invalide
    if (pool && (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered')) {
      try {
        await pool.query('DELETE FROM user_fcm_tokens WHERE fcm_token = $1', [apnsToken]);
        console.log('🗑️ Token APNs invalide supprimé');
      } catch (dbError) {
        console.error('❌ Erreur suppression token:', dbError);
      }
    }
    
    return { success: false, error: error.message };
  }
}

async function sendNotificationByUserId(userId, title, body, data = {}) {
  try {
    if (!pool) {
      console.warn('⚠️ Pool non initialisé');
      return { success: false, error: 'Pool not initialized' };
    }
    
    const result = await pool.query(
      'SELECT fcm_token, device_type FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'No token' };
    }
    
    const token = result.rows[0].fcm_token;
    const deviceType = result.rows[0].device_type || 'android';
    
    console.log(`📱 Envoi notification à ${userId} (${deviceType})`);
    
    // Si c'est iOS, utiliser APNs
    if (deviceType === 'ios') {
      return await sendApnsNotification(token, title, body, data);
    }
    
    // Sinon, utiliser FCM (Android)
    return await sendNotification(token, title, body, data);
  } catch (error) {
    console.error('❌ Erreur notification:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// NOTIFICATIONS PAR TYPE
// ============================================

async function sendNewMessageNotification(userId, conversationId, messagePreview, propertyName) {
  return await sendNotificationByUserId(
    userId,
    '💬 Nouveau message',
    messagePreview,
    {
      type: 'new_chat_message',
      conversation_id: conversationId.toString(),
      property_name: propertyName || 'Logement'
    }
  );
}

async function sendNewCleaningNotification(userId, cleaningId, propertyName, cleanerName, cleaningDate) {
  const formattedDate = new Date(cleaningDate).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long'
  });
  
  return await sendNotificationByUserId(
    userId,
    '🧹 Nouveau ménage assigné',
    `${cleanerName} - ${propertyName} le ${formattedDate}`,
    {
      type: 'new_cleaning',
      cleaning_id: cleaningId.toString(),
      property_name: propertyName
    }
  );
}

async function sendCleaningReminderNotification(userId, cleaningId, propertyName, cleanerName, cleaningDate) {
  return await sendNotificationByUserId(
    userId,
    '⏰ Rappel : Ménage demain',
    `${cleanerName} - ${propertyName}`,
    {
      type: 'cleaning_reminder',
      cleaning_id: cleaningId.toString(),
      property_name: propertyName
    }
  );
}

async function sendNewInvoiceNotification(userId, invoiceId, invoiceType, amount) {
  const typeLabel = invoiceType === 'owner' ? 'Facture propriétaire' : 'Facture';
  const formattedAmount = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format(amount);
  
  return await sendNotificationByUserId(
    userId,
    `💰 ${typeLabel}`,
    `Nouvelle facture de ${formattedAmount}`,
    {
      type: 'new_invoice',
      invoice_id: invoiceId.toString(),
      invoice_type: invoiceType
    }
  );
}

async function sendNewReservationNotification(userId, reservationId, propertyName, guestName, checkIn, checkOut, platform) {
  const checkInDate = new Date(checkIn).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short'
  });
  const checkOutDate = new Date(checkOut).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short'
  });
  
  const platformEmoji = platform === 'airbnb' ? '🏠' : platform === 'booking' ? '🏨' : '📅';
  
  return await sendNotificationByUserId(
    userId,
    `${platformEmoji} Nouvelle réservation`,
    `${propertyName} - ${checkInDate} au ${checkOutDate}`,
    {
      type: 'new_reservation',
      reservation_id: reservationId ? reservationId.toString() : '',
      property_name: propertyName
    }
  );
}

async function sendNotificationToMultiple(tokens, title, body, data = {}) {
  initializeFirebase();
  
  if (!firebaseInitialized) {
    console.warn('⚠️ Firebase non initialisé - notification ignorée');
    return { success: false, error: 'Firebase not initialized' };
  }
  
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
  sendApnsNotification,
  sendNotificationByUserId,
  sendNewMessageNotification,
  sendNewCleaningNotification,
  sendCleaningReminderNotification,
  sendNewInvoiceNotification,
  sendNewReservationNotification,
  sendNotificationToMultiple
};
