// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  const platform =
    window.Capacitor && typeof window.Capacitor.getPlatform === 'function'
      ? window.Capacitor.getPlatform()
      : 'web';

  async function findSupabaseKey() {
    const cap = window.Capacitor;
    if (!cap?.Plugins?.Preferences) return null;

    const keys = [
      'lcc_token',
      'sb-ztdzragdnjkastswtvzn-auth-token',
      'supabase.auth.token',
      '@supabase/auth-token',
      'sb-auth-token'
    ];

    for (const key of keys) {
      const { value } = await cap.Plugins.Preferences.get({ key });
      if (value) return { key, value };
    }
    return null;
  }

  async function getJwt() {
    const found = await findSupabaseKey();
    if (!found) return null;

    try {
      if (found.key === 'lcc_token') return found.value;
      const session = JSON.parse(found.value);
      return session.access_token || session.token || null;
    } catch {
      return null;
    }
  }

  async function saveTokenToServer(token, device_type) {
    const jwt = await getJwt();
    if (!jwt) {
      console.warn('⛔ JWT absent, token non envoyé');
      return;
    }

    console.log(`📤 Envoi token ${device_type} au serveur (début): ${String(token).slice(0, 20)}...`);

    const res = await fetch(`${API_BASE}/api/save-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        token,
        device_type
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('❌ /api/save-token KO', res.status, data);
      return;
    }
    console.log('✅ Token sauvegardé', data);
  }

  async function initPush() {
    if (window.__pushInitDoneV2) return;
    window.__pushInitDoneV2 = true;

    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) {
      console.log('🌐 Web → pas de push');
      return;
    }

    const PushNotifications = cap.Plugins?.PushNotifications;
    if (!PushNotifications) {
      console.error('❌ PushNotifications plugin introuvable');
      return;
    }

    console.log(`🔔 Init Push (${platform})`);

    // ---- Permissions (Android 13+) + Channel ----
    if (platform === 'android') {
      const perm = await PushNotifications.checkPermissions();
      console.log('🤖 Android permissions:', perm);

      if (perm.receive !== 'granted') {
        const req = await PushNotifications.requestPermissions();
        console.log('🤖 Android permission request:', req);
        if (req.receive !== 'granted') {
          console.warn('⛔ Android: permission refusée → pas de token');
          return;
        }
      }

      // Channel obligatoire Android 8+
      try {
        await PushNotifications.createChannel({
          id: 'default',
          name: 'Notifications',
          description: 'Notifications générales',
          importance: 4
        });
        console.log('✅ Channel Android prêt');
      } catch (e) {
        console.log('ℹ️ Channel Android déjà existant', e);
      }
    }

    // ---- Listeners ----
    PushNotifications.addListener('registration', async (token) => {
      console.log(`📱 registration token (${platform}):`, token?.value);

      // iOS => token.value = APNs (inutile pour FCM). On ne l’envoie pas.
      if (platform === 'ios') return;

      // Android => token.value = FCM token (en général)
      if (token?.value) await saveTokenToServer(token.value, 'android');
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('❌ registrationError', err);
    });

    PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.log('📩 Push reçu', n);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (n) => {
      console.log('👉 Push action', n);
    });

    // ---- iOS: récupérer le VRAI token FCM via FirebaseMessaging ----
    if (platform === 'ios') {
      const FirebaseMessaging = cap.Plugins?.FirebaseMessaging;
      if (!FirebaseMessaging) {
        console.warn('⚠️ FirebaseMessaging plugin introuvable sur iOS → pas de token FCM');
      } else {
        try {
          const perm = await FirebaseMessaging.requestPermissions();
          console.log('🍏 iOS FirebaseMessaging permissions:', perm);

          const t = await FirebaseMessaging.getToken();
          const fcmToken = t?.token;
          console.log('🍏 iOS FCM token:', fcmToken ? `${fcmToken.slice(0, 20)}...` : null);

          if (fcmToken) {
            await saveTokenToServer(fcmToken, 'ios');
          } else {
            console.warn('⛔ iOS: pas de token FCM reçu');
          }
        } catch (e) {
          console.error('❌ iOS FirebaseMessaging error', e);
        }
      }
    }

    // Toujours register (permet de recevoir les notifs + events)
    console.log('📌 PushNotifications.register()');
    await PushNotifications.register();
  }

  setTimeout(initPush, 2500);
})();
