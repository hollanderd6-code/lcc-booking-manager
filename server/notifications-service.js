const admin = require('firebase-admin');

// Initialiser Firebase Admin (une seule fois)
let firebaseInitialized = false;

function initializeFirebase() {
  if (!firebaseInitialized) {
    const serviceAccount = require('./firebase-service-account.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialisé');
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
    token: token
  };
  
  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Notification envoyée:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Erreur envoi notification:', error);
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
    tokens: tokens
  };
  
  try {
    const response = await admin.messaging().sendMulticast(message);
    console.log(`✅ ${response.successCount} notifications envoyées`);
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
  sendNotification,
  sendNotificationToMultiple
};