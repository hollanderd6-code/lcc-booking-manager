async function sendNotification(token, title, body, data = {}) {
  initializeFirebase();
  
  // Détecter le type de token
  const isApnsToken = !token.includes(':'); // Les tokens FCM contiennent ':'
  
  const message = {
    notification: {
      title: title,
      body: body
    },
    data: data,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default'
      }
    },
    apns: {
      headers: {
        'apns-priority': '10'
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
        }
      }
    }
  };
  
  // Si c'est un token APNs natif, utiliser l'envoi direct APNs
  if (isApnsToken) {
    // Option A: Convertir en utilisant le topic (Bundle ID)
    message.token = token;
    message.apns.headers['apns-topic'] = 'com.votre.bundle.id'; // IMPORTANT
    
  } else {
    // Token FCM standard
    message.token = token;
  }
  
  try {
    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Erreur:', error);
    return { success: false, error: error.message };
  }
}
