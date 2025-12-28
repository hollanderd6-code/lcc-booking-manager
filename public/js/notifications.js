// Initialiser les notifications push
// Test pour vérifier que le fichier est bien chargé
console.log('🔔 notifications.js chargé !');
alert('🔔 Système de notifications chargé');
async function initPushNotifications() {
  // Vérifier si Capacitor est disponible
  if (!window.Capacitor || !window.Capacitor.Plugins.PushNotifications) {
    console.log('Pas sur mobile, notifications désactivées');
    return;
  }

  const { PushNotifications } = window.Capacitor.Plugins;

  // Demander la permission
  let permStatus = await PushNotifications.checkPermissions();
  
  if (permStatus.receive === 'prompt') {
    permStatus = await PushNotifications.requestPermissions();
  }
  
  if (permStatus.receive !== 'granted') {
    console.log('Permission de notification refusée');
    return;
  }

  // S'enregistrer pour les notifications
  await PushNotifications.register();

  // Écouter l'enregistrement réussi
  PushNotifications.addListener('registration', (token) => {
  console.log('✅ Token FCM:', token.value);
  // Afficher le token à l'écran
  alert('✅ Token FCM reçu !\n\n' + token.value.substring(0, 50) + '...');
  saveTokenToBackend(token.value);
});

  // Écouter les erreurs
  PushNotifications.addListener('registrationError', (error) => {
    console.error('❌ Erreur notification:', error);
  });

  // Notification reçue quand l'app est ouverte
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('📬 Notification reçue:', notification);
    alert(`Nouvelle notification: ${notification.title}\n${notification.body}`);
  });

  // Notification cliquée
  PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    console.log('👆 Notification cliquée:', notification);
  });
}

// Fonction pour sauvegarder le token
async function saveTokenToBackend(token) {
  try {
    const response = await fetch('https://lcc-booking-manager.onrender.com/api/save-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    console.log('✅ Token sauvegardé');
  } catch (error) {
    console.error('❌ Erreur sauvegarde token:', error);
  }
}
