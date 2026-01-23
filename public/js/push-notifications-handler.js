// ============================================
// 📱 GESTIONNAIRE DE NOTIFICATIONS PUSH - VERSION DEBUG
// ============================================

console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé');

// Fonction principale
async function initPushNotifications() {
  console.log('🔔 [DEBUG] initPushNotifications appelée');
  console.log('🔔 [DEBUG] typeof Capacitor:', typeof Capacitor);
  console.log('🔔 [DEBUG] window.Capacitor:', window.Capacitor);
  
  try {
    // Vérifier si Capacitor est disponible
    if (typeof Capacitor === 'undefined' && typeof window.Capacitor === 'undefined') {
      console.log('⚠️ [DEBUG] Capacitor non disponible');
      return;
    }

    const Cap = window.Capacitor || Capacitor;
    const platform = Cap.getPlatform();
    console.log('📱 [DEBUG] Platform:', platform);
    
    // Si on est sur le web, ne rien faire
    if (platform === 'web') {
      console.log('⚠️ [DEBUG] Sur web, pas de push notifications');
      return;
    }

    console.log('✅ [DEBUG] On est sur mobile:', platform);

    // Récupérer le plugin PushNotifications
    const { PushNotifications } = window.Capacitor.Plugins;
    
    if (!PushNotifications) {
      console.error('❌ [DEBUG] Plugin PushNotifications non trouvé');
      console.log('Plugins disponibles:', Object.keys(window.Capacitor.Plugins));
      return;
    }
    
    console.log('✅ [DEBUG] Plugin PushNotifications trouvé');

    // ============================================
    // LISTENERS D'ABORD (avant register)
    // ============================================
    
    console.log('📝 [DEBUG] Ajout des listeners...');
    
    // Listener pour le token
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ [DEBUG] Token reçu:', token.value);
      
      const deviceType = platform === 'ios' ? 'ios' : 'android';
      console.log('📱 [DEBUG] Device type:', deviceType);
      
      await saveTokenToServer(token.value, deviceType);
    });

    // Listener pour les erreurs
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ [DEBUG] Erreur registration:', error);
    });

    // Listener notification reçue (foreground)
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📬 [DEBUG] Notification reçue:', notification);
      alert(`Notification: ${notification.title || ''}\n${notification.body || ''}`);
    });

    // Listener notification cliquée
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👆 [DEBUG] Notification cliquée:', notification);
    });

    console.log('✅ [DEBUG] Listeners ajoutés');

    // ============================================
    // DEMANDER LA PERMISSION
    // ============================================
    
    console.log('🔐 [DEBUG] Vérification permission...');
    let permStatus = await PushNotifications.checkPermissions();
    console.log('📊 [DEBUG] Permission actuelle:', JSON.stringify(permStatus));

    if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
      console.log('🔐 [DEBUG] Demande de permission...');
      permStatus = await PushNotifications.requestPermissions();
      console.log('📊 [DEBUG] Nouvelle permission:', JSON.stringify(permStatus));
    }

    if (permStatus.receive !== 'granted') {
      console.warn('⚠️ [DEBUG] Permission refusée:', permStatus.receive);
      alert('Permission refusée pour les notifications. Activez-les dans les paramètres de l\'app.');
      return;
    }

    console.log('✅ [DEBUG] Permission accordée');

    // ============================================
    // ENREGISTRER
    // ============================================
    
    console.log('📝 [DEBUG] Appel PushNotifications.register()...');
    await PushNotifications.register();
    console.log('✅ [DEBUG] Register() appelé avec succès');

  } catch (error) {
    console.error('❌ [DEBUG] Erreur dans initPushNotifications:', error);
    console.error('❌ [DEBUG] Stack:', error.stack);
  }
}

// Fonction pour envoyer le token au serveur
async function saveTokenToServer(token, deviceType) {
  try {
    console.log('💾 [DEBUG] saveTokenToServer appelée');
    console.log('   Token:', token.substring(0, 30) + '...');
    console.log('   Device:', deviceType);
    
    const authToken = localStorage.getItem('token');
    console.log('   Auth token:', authToken ? 'Présent' : 'Absent');
    
    if (!authToken) {
      console.warn('⚠️ [DEBUG] Pas de token auth - sauvegarde en local');
      localStorage.setItem('pending_fcm_token', token);
      localStorage.setItem('pending_device_type', deviceType);
      return;
    }

    console.log('📤 [DEBUG] Envoi au serveur...');
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

    console.log('📊 [DEBUG] Response status:', response.status);
    const data = await response.json();
    console.log('📊 [DEBUG] Response data:', data);

    if (response.ok) {
      console.log('✅ [DEBUG] Token enregistré sur serveur');
      localStorage.removeItem('pending_fcm_token');
      localStorage.removeItem('pending_device_type');
      alert('✅ Token enregistré avec succès !');
    } else {
      console.error('❌ [DEBUG] Erreur serveur:', data);
      alert('❌ Erreur: ' + (data.error || 'Erreur inconnue'));
    }

  } catch (error) {
    console.error('❌ [DEBUG] Erreur saveTokenToServer:', error);
    alert('❌ Erreur réseau: ' + error.message);
  }
}

// Fonction pour envoyer un token en attente
async function sendPendingToken() {
  const pendingToken = localStorage.getItem('pending_fcm_token');
  const pendingDeviceType = localStorage.getItem('pending_device_type');
  
  console.log('📤 [DEBUG] sendPendingToken - Token:', pendingToken ? 'Présent' : 'Absent');
  
  if (pendingToken && pendingDeviceType) {
    console.log('📤 [DEBUG] Envoi du token en attente...');
    await saveTokenToServer(pendingToken, pendingDeviceType);
  }
}

// Exposer globalement pour debug
window.initPushNotifications = initPushNotifications;
window.saveTokenToServer = saveTokenToServer;
window.sendPendingToken = sendPendingToken;

// Initialisation automatique avec délai
console.log('⏰ [DEBUG] Programmation initialisation dans 2 secondes...');
setTimeout(() => {
  console.log('⏰ [DEBUG] Démarrage initialisation...');
  initPushNotifications();
}, 2000);

console.log('✅ [DEBUG] Fin du chargement du fichier');
