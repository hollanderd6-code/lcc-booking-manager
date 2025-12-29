const admin = require('firebase-admin');

// Pool sera passé en paramètre depuis server.js
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

// Envoyer une notification par USER_ID (récupère le token automatiquement)
async function sendNotificationByUserId(userId, title, body, data = {}) {
  initializeFirebase();
  
  try {
    console.log('📤 Envoi notification à userId:', userId);
    console.log('📝 Title:', title);
    console.log('📝 Body:', body);
    
    // Récupérer le token FCM depuis la base de données
    const result = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1',
      [userId]
    );
    
    if (!result.rows.length) {
      console.log('❌ Aucun token FCM trouvé pour userId:', userId);
      return { success: false, error: 'No FCM token found for user' };
    }
    
    const token = result.rows[0].fcm_token;
    console.log('🔑 Token trouvé:', token.substring(0, 30) + '...');
    
    // Envoyer via Firebase
    return await sendNotification(token, title, body, data);
    
  } catch (error) {
    console.error('❌ Erreur complète:', error);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error message:', error.message);
    return { success: false, error: error.message };
  }
}

// Envoyer une notification à un token spécifique
async function sendNotification(token, title, body, data = {}) {
  initializeFirebase();
  
  const message = {
    notification: {
      title: title,
      body: body
    },
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
    console.log('📨 Envoi vers Firebase...');
    const response = await admin.messaging().send(message);
    console.log('✅ Réponse Firebase:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Erreur Firebase:', error);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error message:', error.message);
    
    // Si le token est invalide, le supprimer de la DB
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.log('🗑️ Suppression du token invalide...');
      try {
        await pool.query('DELETE FROM user_fcm_tokens WHERE fcm_token = $1', [token]);
        console.log('✅ Token invalide supprimé');
      } catch (dbError) {
        console.error('❌ Erreur suppression token:', dbError);
      }
    }
    
    return { success: false, error: error.message };
  }
}

// Envoyer à plusieurs tokens
async function sendNotificationToMultiple(tokens, title, body, data = {}) {
  initializeFirebase();
  
  const message = {
    notification: {
      title: title,
      body: body
    },
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
    console.log(`📨 Envoi vers ${tokens.length} appareils...`);
    const response = await admin.messaging().sendMulticast(message);
    console.log(`✅ ${response.successCount} notifications envoyées`);
    console.log(`❌ ${response.failureCount} échecs`);
    
    // Supprimer les tokens invalides
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`❌ Échec pour token ${idx}:`, resp.error);
          if (resp.error.code === 'messaging/invalid-registration-token' ||
              resp.error.code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(tokens[idx]);
          }
        }
      });
      
      if (invalidTokens.length > 0) {
        console.log(`🗑️ Suppression de ${invalidTokens.length} tokens invalides...`);
        for (const token of invalidTokens) {
          try {
            await pool.query('DELETE FROM user_fcm_tokens WHERE fcm_token = $1', [token]);
          } catch (dbError) {
            console.error('❌ Erreur suppression token:', dbError);
          }
        }
      }
    }
    
    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount 
    };
  } catch (error) {
    console.error('❌ Erreur:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  setPool,
  sendNotification,
  sendNotificationByUserId,
  sendNotificationToMultiple
};
