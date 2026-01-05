import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

// Optionnel: si tu installes le plugin Firebase Messaging (voir plus bas)
let FirebaseMessaging = null;
try {
  // eslint-disable-next-line import/no-unresolved
  FirebaseMessaging = (await import('@capacitor-firebase/messaging')).FirebaseMessaging;
} catch (e) {
  // plugin pas installé -> on continue en APNs only
}

const API_BASE = 'https://lcc-booking-manager.onrender.com';

async function saveTokenToServer(token) {
  try {
    const jwt = localStorage.getItem('token');
    if (!jwt) {
      console.warn('⚠️ Pas de JWT en localStorage, token non envoyé au serveur');
      return;
    }

    const res = await fetch(`${API_BASE}/api/save-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ token }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('❌ save-token failed', res.status, data);
      return;
    }
    console.log('✅ Token sauvegardé serveur:', data);
  } catch (err) {
    console.error('❌ Erreur réseau save-token:', err);
  }
}

export async function initPush() {
  if (window.__pushInitDone) return;
  window.__pushInitDone = true;

  // On ne fait ça que dans l’app native
  if (!Capacitor.isNativePlatform()) {
    console.log('🌐 Web: pas d’init push iOS/Android');
    return;
  }

  console.log('🔔 Init Push (native) ...');

  // 1) Listeners AVANT register()
  await PushNotifications.addListener('registration', async (token) => {
    console.log('✅ Push registration token (APNs):', token?.value);

    // IMPORTANT: token.value ici = APNs token (iOS) / FCM token (Android selon setup)
    // Pour ton serveur, tu veux idéalement un vrai FCM token.
    await saveTokenToServer(token?.value);
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.error('❌ Push registration error:', error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('📩 Push received:', notification);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    console.log('👉 Push action performed:', notification);
  });

  // 2) Permission
  const permStatus = await PushNotifications.checkPermissions();
  console.log('🔎 checkPermissions:', permStatus);

  if (permStatus.receive !== 'granted') {
    const requestStatus = await PushNotifications.requestPermissions();
    console.log('🟦 requestPermissions:', requestStatus);
    if (requestStatus.receive !== 'granted') {
      console.warn('⛔ Permission refusée');
      return;
    }
  }

  // 3) Register APNs/FCM (Capacitor PushNotifications)
  console.log('📌 Permission OK, register()...');
  await PushNotifications.register();
  console.log('🟢 register() appelé, attente event registration/registrationError');

  // 4) BONUS: si tu installes Firebase Messaging, récupère le VRAI token FCM iOS
  if (FirebaseMessaging) {
    try {
      const fcmPerm = await FirebaseMessaging.requestPermissions();
      console.log('🟦 FirebaseMessaging permissions:', fcmPerm);

      const { token } = await FirebaseMessaging.getToken();
      console.log('✅ FCM token (FirebaseMessaging):', token);
      if (token) await saveTokenToServer(token);
    } catch (e) {
      console.warn('⚠️ Impossible de récupérer token FCM via FirebaseMessaging:', e);
    }
  } else {
    console.log('ℹ️ Plugin FirebaseMessaging non installé → iOS aura seulement APNs token');
  }

  // 5) watchdog debug
  setTimeout(() => {
    console.warn("⚠️ Si tu ne vois toujours ni 'registration' ni 'registrationError' :");
    console.warn('→ très souvent: test sur simulateur, ou souci APNs/provisioning/runtime');
  }, 10000);
}
