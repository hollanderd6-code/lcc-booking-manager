// ============================================
// 🔔 ENREGISTREMENT DU TOKEN FCM
// ============================================

// Fonction pour afficher des messages debug
function showDebug(msg) {
  console.log(msg);
  
  // Créer une notification visuelle en haut de l'écran
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:60px;left:10px;right:10px;background:rgba(0,0,0,0.9);color:lime;padding:10px;z-index:99999;font-size:12px;border-radius:5px;';
  div.textContent = msg;
  document.body.appendChild(div);
  
  setTimeout(() => div.remove(), 5000);
}

(async function registerFCMToken() {
  showDebug('🔥 Script FCM démarré');
  
  // Vérifier si on est dans l'app Capacitor
  if (!window.Capacitor) {
    showDebug('⚠️ Pas dans Capacitor (navigateur web)');
    return;
  }

  showDebug('✅ Dans Capacitor');

  const { PushNotifications } = window.Capacitor.Plugins;
  
  if (!PushNotifications) {
    showDebug('❌ Plugin PushNotifications non disponible');
    return;
  }

  showDebug('✅ Plugin PushNotifications disponible');

  try {
    // 1. Demander la permission
    showDebug('📱 Demande de permission...');
    
    let permStatus = await PushNotifications.checkPermissions();
    showDebug(`📱 Permission actuelle: ${permStatus.receive}`);
    
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
      showDebug(`📱 Permission après demande: ${permStatus.receive}`);
    }
    
    if (permStatus.receive !== 'granted') {
      showDebug('❌ Permission refusée');
      return;
    }
    
    showDebug('✅ Permission accordée');
    
    // 2. Enregistrer pour recevoir les notifications
    await PushNotifications.register();
    showDebug('📱 Enregistrement FCM lancé...');
    
    // 3. Écouter la réception du token
    PushNotifications.addListener('registration', async (token) => {
      showDebug(`🔑 Token reçu: ${token.value.substring(0, 20)}...`);
      
      // 4. Récupérer le JWT de l'utilisateur
      const jwtToken = localStorage.getItem('lcc_token');
      
      if (!jwtToken) {
        showDebug('❌ JWT non trouvé (utilisateur non connecté)');
        return;
      }
      
      showDebug('✅ JWT trouvé');
      
      // 5. Envoyer le token au serveur
      try {
        showDebug('📤 Envoi au serveur...');
        
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
          showDebug('✅✅✅ TOKEN SAUVEGARDÉ !');
          localStorage.setItem('fcm_token_registered', 'true');
        } else {
          showDebug(`❌ Erreur serveur: ${data.error}`);
        }
      } catch (error) {
        showDebug(`❌ Erreur fetch: ${error.message}`);
      }
    });
    
    // 6. Écouter les erreurs
    PushNotifications.addListener('registrationError', (error) => {
      showDebug(`❌ Erreur FCM: ${error.error}`);
    });
    
    // 7. Écouter les notifications reçues
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      showDebug(`🔔 Notif reçue: ${notification.title}`);
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
    
    showDebug('✅ Listeners configurés');
    
  } catch (error) {
    showDebug(`❌ Erreur globale: ${error.message}`);
  }
})();
