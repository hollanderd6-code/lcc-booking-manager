// ============================================
// 🔔 ENREGISTREMENT FCM AVEC @capacitor-firebase/messaging
// ============================================

/**
 * Enregistrer les notifications push
 */
export async function registerForPushNotifications() {
  try {
    console.log('📱 Environnement:', window.Capacitor?.isNativePlatform() ? 'App Native' : 'Web');
    
    // Vérifier si on est en mode natif
    const isNative = window.Capacitor?.isNativePlatform();
    
    if (!isNative) {
      console.log('⚠️ Pas en mode natif');
      return null;
    }
    
    // Importer le plugin Firebase
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    
    console.log('📱 Demande de permission pour les notifications...');
    
    // 1. Vérifier les permissions
    const permissionStatus = await FirebaseMessaging.checkPermissions();
    console.log('🔐 Status permission:', permissionStatus.receive);
    
    if (permissionStatus.receive === 'prompt') {
      // Demander la permission
      const result = await FirebaseMessaging.requestPermissions();
      
      if (result.receive !== 'granted') {
        console.log('❌ Permission refusée');
        return null;
      }
    }
    
    if (permissionStatus.receive !== 'granted') {
      console.log('❌ Permission non accordée');
      return null;
    }
    
    console.log('✅ Permission notifications accordée');
    
    // 2. Récupérer le token FCM (déjà converti par le plugin !)
    console.log('📱 Enregistrement FCM lancé...');
    
    const result = await FirebaseMessaging.getToken();
    const fcmToken = result.token;
    
    if (fcmToken) {
      console.log('🔑 Token FCM reçu:', fcmToken.substring(0, 20) + '...');
      
      // 3. Envoyer au serveur
      await saveFCMToken(fcmToken);
      
      return fcmToken;
    } else {
      console.error('❌ Pas de token FCM');
      return null;
    }
    
  } catch (error) {
    console.error('❌ Erreur enregistrement notifications:', error);
    return null;
  }
}

/**
 * Envoyer le token FCM au serveur
 */
async function saveFCMToken(token) {
  try {
    const authToken = localStorage.getItem('authToken');
    
    if (!authToken) {
      console.warn('⚠️ Pas de token d\'authentification');
      return;
    }
    
    const response = await fetch('/api/save-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ token })
    });
    
    if (response.ok) {
      console.log('✅ Token FCM sauvegardé sur le serveur');
    } else {
      const error = await response.json();
      console.error('❌ Erreur sauvegarde token:', error);
    }
  } catch (error) {
    console.error('❌ Erreur requête sauvegarde token:', error);
  }
}

/**
 * Configurer les listeners de notifications
 */
export async function setupNotificationListeners() {
  try {
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    
    // Écouter les notifications
    await FirebaseMessaging.addListener('notificationReceived', (event) => {
      console.log('🔔 Notification reçue (foreground):', event.notification);
    });
    
    await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      console.log('👆 Notification cliquée:', event.notification);
      
      // Naviguer vers la bonne page
      const data = event.notification.data;
      
      if (data?.type === 'new_chat_message' && data?.conversation_id) {
        window.location.href = `/dashboard?tab=messages&conversation=${data.conversation_id}`;
      }
    });
    
    console.log('✅ Listeners de notifications configurés');
    
  } catch (error) {
    console.error('❌ Erreur configuration listeners:', error);
  }
}
