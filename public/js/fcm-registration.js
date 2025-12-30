// ============================================
// 🔔 ENREGISTREMENT DU TOKEN FCM
// ============================================

(async function registerFCMToken() {
  // Vérifier si on est dans l'app Capacitor
  if (!window.Capacitor) {
    console.log('⚠️ Pas dans Capacitor, skip FCM');
    return;
  }

  const { PushNotifications } = window.Capacitor.Plugins;
  
  if (!PushNotifications) {
    console.log('⚠️ Plugin PushNotifications non disponible');
    return;
  }

  try {
    // 1. Demander la permission
    console.log('📱 Demande de permission pour les notifications...');
    
    let permStatus = await PushNotifications.checkPermissions();
    
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }
    
    if (permStatus.receive !== 'granted') {
      console.log('❌ Permission notifications refusée');
      return;
    }
    
    console.log('✅ Permission notifications accordée');
    
    // 2. Enregistrer pour recevoir les notifications
    await PushNotifications.register();
    console.log('📱 Enregistrement FCM lancé...');
    
    // 3. Écouter la réception du token
    PushNotifications.addListener('registration', async (token) => {
      console.log('🔑 Token FCM reçu:', token.value.substring(0, 30) + '...');
      
      // 4. Récupérer le JWT de l'utilisateur
      const jwtToken = localStorage.getItem('lcc_token');
      
      if (!jwtToken) {
        console.log('❌ Utilisateur non connecté, impossible de sauvegarder le token');
        return;
      }
      
      // 5. Envoyer le token au serveur
      try {
        console.log('📤 Envoi du token au serveur...');
        
        const response = await fetch('/api/save-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
          },
          body: JSON.stringify({
            token: token.value
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          console.log('✅ Token FCM sauvegardé sur le serveur');
          localStorage.setItem('fcm_token_registered', 'true');
        } else {
          console.error('❌ Erreur serveur:', data.error);
        }
      } catch (error) {
        console.error('❌ Erreur envoi token:', error);
      }
    });
    
    // 6. Écouter les erreurs
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Erreur enregistrement FCM:', error);
    });
    
    // 7. Écouter les notifications reçues
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('🔔 Notification reçue:', notification);
    });
    
    // 8. Écouter les clics sur les notifications
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('👆 Notification cliquée:', action);
      
      // Rediriger vers la conversation si c'est un message
      if (action.notification.data.type === 'new_chat_message') {
        const conversationId = action.notification.data.conversation_id;
        if (conversationId) {
          window.location.href = `/messages.html?conversation=${conversationId}`;
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur globale FCM:', error);
  }
})();
