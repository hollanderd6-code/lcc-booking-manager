// Initialiser les notifications push (Capacitor)
//
// - iOS: l'événement 'registration' renvoie généralement un token APNS (pas FCM).
// - Android: token FCM.
// Ton backend peut stocker le token + platform pour router correctement.

let __pushInitDone = false;

export async function initPushNotifications() {
  if (__pushInitDone) return;
  __pushInitDone = true;

  const cap = window?.Capacitor;
  const PushNotifications = cap?.Plugins?.PushNotifications;

  // Pas dans l'app native / plugin absent
  if (!cap || !PushNotifications) {
    console.log('📱 Pas en environnement Capacitor natif -> notifications désactivées');
    return;
  }

  // Évite les doublons de listeners si la page est rechargée dans la WebView
  try {
    if (typeof PushNotifications.removeAllListeners === 'function') {
      await PushNotifications.removeAllListeners();
    }
  } catch (e) {
    // non bloquant
  }

  console.log('📱 Demande de permission pour les notifications...');

  // 1) Vérifier / demander la permission
  let permStatus;
  try {
    permStatus = await PushNotifications.checkPermissions();
  } catch (e) {
    console.error('❌ checkPermissions a échoué:', e);
    return;
  }

  if (permStatus.receive === 'prompt') {
    try {
      permStatus = await PushNotifications.requestPermissions();
    } catch (e) {
      console.error('❌ requestPermissions a échoué:', e);
      return;
    }
  }

  if (permStatus.receive !== 'granted') {
    console.warn('🔕 Permission de notification refusée:', permStatus.receive);
    // Important: ne pas throw ici sinon ça casse l'app
    return;
  }

  console.log('✅ Permission notifications accordée');

  // 2) Listeners
  await PushNotifications.addListener('registration', async (token) => {
    // token.value = APNS sur iOS, FCM sur Android
    console.log('✅ Push registration token reçu:', token?.value);

    try {
      await saveTokenToBackend({
        token: token?.value,
        platform: cap.getPlatform?.() || cap.platform || 'unknown',
      });
      console.log('✅ Token sauvegardé (backend)');
    } catch (e) {
      console.error('❌ Sauvegarde token (backend) a échoué:', e);
    }
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.error('❌ Push registration error:', error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('📩 Push reçu (foreground):', notification);
    // Ici tu peux afficher un toast / badge si tu veux
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    console.log('👉 Action sur notification (tap / action):', notification);
    // Ici tu peux naviguer selon notification.notification.data
  });

  // 3) Enregistrer le device (déclenche l'événement 'registration')
  console.log('📱 Enregistrement push lancé...');
  try {
    await PushNotifications.register();
  } catch (e) {
    console.error('❌ PushNotifications.register a échoué:', e);
  }
}

// Fonction pour sauvegarder le token
async function saveTokenToBackend(payload) {
  // payload: { token: string, platform: 'ios' | 'android' | 'web' | 'unknown' }
  const res = await fetch('https://lcc-booking-manager.onrender.com/api/save-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`.trim());
  }

  return res.json().catch(() => ({}));
}

// Auto-init si tu veux (optionnel)
// Si tu préfères contrôler l'init ailleurs, supprime ce bloc.
document.addEventListener('DOMContentLoaded', () => {
  // Petite protection: certains frameworks déclenchent plusieurs fois
  initPushNotifications().catch((e) => console.error('❌ initPushNotifications error:', e));
});
