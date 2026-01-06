// ============================================
// 📱 GESTIONNAIRE DE NOTIFICATIONS PUSH
// À intégrer dans l'app pour enregistrer les tokens FCM
// ============================================

/**
 * Initialise et enregistre les notifications push
 * Fonctionne avec Capacitor sur Android et iOS
 */
async function initPushNotifications() {
  console.log('🔔 Initialisation push notifications...');
  
  try {
    // Vérifier si Capacitor est disponible
    if (typeof Capacitor === 'undefined') {
      console.log('⚠️ Capacitor non disponible - Mode web');
      return;
    }

    const platform = Capacitor.getPlatform();
    console.log('📱 Platform détectée:', platform);
    
    // Si on est sur le web, ne rien faire
    if (platform === 'web') {
      console.log('⚠️ Push notifications non disponibles sur web');
      return;
    }

    // Import dynamique du plugin PushNotifications
    const { PushNotifications } = await import('@capacitor/push-notifications');
    
    console.log('✅ Plugin PushNotifications chargé');

    // ============================================
    // 1. DEMANDER LA PERMISSION
    // ============================================
    console.log('🔐 Demande de permission...');
    
    let permStatus = await PushNotifications.checkPermissions();
    console.log('📊 Statut permission actuel:', permStatus);

    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
      console.log('📊 Nouveau statut permission:', permStatus);
    }

    if (permStatus.receive !== 'granted') {
      console.warn('⚠️ Permission refusée pour les notifications');
      return;
    }

    console.log('✅ Permission accordée');

    // ============================================
    // 2. ENREGISTRER POUR RECEVOIR DES NOTIFICATIONS
    // ============================================
    console.log('📝 Enregistrement pour les notifications...');
    await PushNotifications.register();

    // ============================================
    // 3. ÉCOUTER LA RÉCEPTION DU TOKEN
    // ============================================
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ Token FCM reçu:', token.value.substring(0, 30) + '...');
      
      // Déterminer le type d'appareil
      const deviceType = platform === 'ios' ? 'ios' : 'android';
      console.log('📱 Device type:', deviceType);
      
      // Enregistrer sur le serveur
      await saveTokenToServer(token.value, deviceType);
    });

    // ============================================
    // 4. ÉCOUTER LES ERREURS D'ENREGISTREMENT
    // ============================================
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Erreur enregistrement notifications:', error);
    });

    // ============================================
    // 5. ÉCOUTER LES NOTIFICATIONS REÇUES
    // ============================================
    
    // Notification reçue quand l'app est au premier plan
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📬 Notification reçue (foreground):', notification);
      
      // Afficher une alerte ou un toast
      showInAppNotification(notification);
    });

    // Notification cliquée (app en arrière-plan ou fermée)
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👆 Notification cliquée:', notification);
      
      // Naviguer vers la bonne page selon le type
      handleNotificationClick(notification);
    });

    console.log('✅ Push notifications initialisées avec succès');

  } catch (error) {
    console.error('❌ Erreur initialisation push notifications:', error);
  }
}

/**
 * Enregistre le token sur le serveur
 */
async function saveTokenToServer(token, deviceType) {
  try {
    console.log('💾 Enregistrement token sur le serveur...');
    console.log('   Token:', token.substring(0, 30) + '...');
    console.log('   Device:', deviceType);
    
    // Récupérer le token d'authentification
    const authToken = localStorage.getItem('token');
    
    if (!authToken) {
      console.warn('⚠️ Pas de token d\'authentification - utilisateur non connecté');
      // Sauvegarder le token localement pour l'envoyer après connexion
      localStorage.setItem('pending_fcm_token', token);
      localStorage.setItem('pending_device_type', deviceType);
      return;
    }

    // Envoyer au serveur
    const response = await fetch('/api/save-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        token: token,
        device_type: deviceType
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Token enregistré sur le serveur:', data);
      // Supprimer le token en attente s'il existe
      localStorage.removeItem('pending_fcm_token');
      localStorage.removeItem('pending_device_type');
    } else {
      console.error('❌ Erreur serveur:', data);
    }

  } catch (error) {
    console.error('❌ Erreur saveTokenToServer:', error);
    // En cas d'erreur, sauvegarder pour réessayer plus tard
    localStorage.setItem('pending_fcm_token', token);
    localStorage.setItem('pending_device_type', deviceType);
  }
}

/**
 * Envoie un token en attente après connexion
 */
async function sendPendingToken() {
  const pendingToken = localStorage.getItem('pending_fcm_token');
  const pendingDeviceType = localStorage.getItem('pending_device_type');
  
  if (pendingToken && pendingDeviceType) {
    console.log('📤 Envoi du token en attente...');
    await saveTokenToServer(pendingToken, pendingDeviceType);
  }
}

/**
 * Affiche une notification dans l'app (quand l'app est au premier plan)
 */
function showInAppNotification(notification) {
  const { title, body } = notification;
  
  // Créer un élément de notification
  const notifElement = document.createElement('div');
  notifElement.className = 'in-app-notification';
  notifElement.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 350px;
      z-index: 99999;
      animation: slideIn 0.3s ease-out;
    ">
      <div style="font-weight: 600; margin-bottom: 5px;">${title || 'Notification'}</div>
      <div style="color: #666; font-size: 14px;">${body || ''}</div>
    </div>
  `;
  
  document.body.appendChild(notifElement);
  
  // Retirer après 5 secondes
  setTimeout(() => {
    notifElement.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => notifElement.remove(), 300);
  }, 5000);
}

/**
 * Gère le clic sur une notification
 */
function handleNotificationClick(notification) {
  const data = notification.notification.data;
  console.log('📱 Data de notification:', data);
  
  if (!data) return;
  
  // Naviguer selon le type de notification
  switch (data.type) {
    case 'new_chat_message':
      if (data.conversation_id) {
        window.location.href = `/messages.html?conversation=${data.conversation_id}`;
      }
      break;
      
    case 'new_reservation':
      window.location.href = '/app.html';
      break;
      
    case 'new_cleaning':
      window.location.href = '/cleaning.html';
      break;
      
    case 'new_invoice':
      if (data.invoice_type === 'owner') {
        window.location.href = '/factures-proprietaires.html';
      } else {
        window.location.href = '/factures.html';
      }
      break;
      
    default:
      console.log('Type de notification inconnu:', data.type);
  }
}

// ============================================
// EXPORT ET INITIALISATION AUTOMATIQUE
// ============================================

// Initialiser au chargement de la page
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPushNotifications);
} else {
  initPushNotifications();
}

// Fonction à appeler après connexion réussie
window.sendPendingFCMToken = sendPendingToken;

// Export pour utilisation manuelle si nécessaire
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initPushNotifications,
    saveTokenToServer,
    sendPendingToken
  };
}

console.log('✅ Module push-notifications-handler chargé');
