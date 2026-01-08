// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  const deviceType =
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

  async function saveTokenToServer(token) {
    const jwt = await getJwt();
    if (!jwt) {
      console.warn('⛔ JWT absent, token non envoyé');
      return;
    }

    console.log(`📤 Envoi token ${deviceType} au serveur`);

    await fetch(`${API_BASE}/api/save-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        token,
        device_type: deviceType
      })
    });
  }

  async function initPush() {
    if (window.__pushInitDone) return;
    window.__pushInitDone = true;

    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) {
      console.log('🌐 Web → pas de push');
      return;
    }

    const PushNotifications = cap.Plugins.PushNotifications;
    if (!PushNotifications) return;

    console.log(`🔔 Init Push (${deviceType})`);

    /* ================= ANDROID 13+ ================= */
    if (deviceType === 'android') {
      const perm = await PushNotifications.checkPermissions();
      console.log('🤖 Android permissions:', perm);

      if (perm.receive !== 'granted') {
        const req = await PushNotifications.requestPermissions();
        console.log('🤖 Android permission request:', req);

        if (req.receive !== 'granted') {
          console.warn('⛔ Android: permission refusée → PAS DE TOKEN');
          return;
        }
      }

      console.log('🤖 Création channel Android');
      await PushNotifications.createChannel({
        id: 'default',
        name: 'Notifications',
        description: 'Notifications générales',
        importance: 4
      });
    }

    /* ================= LISTENERS ================= */
    PushNotifications.addListener('registration', async (token) => {
      console.log(`📱 TOKEN REÇU (${deviceType})`, token.value);
      if (token?.value) await saveTokenToServer(token.value);
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

    console.log('📌 register()');
    await PushNotifications.register();
  }

  setTimeout(initPush, 3000);
})();
