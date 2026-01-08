// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  const deviceType =
    window.Capacitor && typeof window.Capacitor.getPlatform === 'function'
      ? window.Capacitor.getPlatform()
      : 'web';

  async function findSupabaseKey() {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.Plugins || !cap.Plugins.Preferences) {
        console.error('❌ Capacitor Preferences non disponible');
        return null;
      }

      const possibleKeys = [
        'sb-ztdzragdnjkastswtvzn-auth-token',
        'supabase.auth.token',
        '@supabase/auth-token',
        'sb-auth-token',
        'lcc_token'
      ];

      console.log('🔍 Recherche de la clé Supabase...');

      for (const key of possibleKeys) {
        const { value } = await cap.Plugins.Preferences.get({ key });
        if (value) {
          console.log(`✅ Clé trouvée: ${key}`);
          return { key, value };
        }
      }

      console.warn('⚠️ Aucune clé Supabase trouvée');
      return null;
    } catch (err) {
      console.error('❌ Erreur recherche clé:', err);
      return null;
    }
  }

  async function getSupabaseSession() {
    const found = await findSupabaseKey();
    if (!found) return null;

    try {
      if (found.key === 'lcc_token') {
        return found.value;
      }

      const session = JSON.parse(found.value);
      return session.access_token || session.accessToken || session.token || null;
    } catch (err) {
      console.error('❌ Erreur parsing session:', err);
      return null;
    }
  }

  async function saveTokenToServer(token) {
    try {
      const jwt = await getSupabaseSession();
      if (!jwt) {
        console.warn('⚠️ Pas de JWT disponible');
        return;
      }

      console.log(`📱 Envoi token (${deviceType}) au serveur`);

      const res = await fetch(`${API_BASE}/api/save-token`, {
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('❌ Enregistrement token échoué:', data);
        return;
      }

      console.log('✅ Token sauvegardé:', data);
    } catch (err) {
      console.error('❌ Erreur réseau:', err);
    }
  }

  async function initPush() {
    if (window.__fcmRegInitDone) return;
    window.__fcmRegInitDone = true;

    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
      console.log('🌐 Web: pas d\'init push');
      return;
    }

    const PushNotifications = cap.Plugins?.PushNotifications;
    if (!PushNotifications) {
      console.error('❌ PushNotifications plugin introuvable');
      return;
    }

    console.log('🔔 Init Push (native)...');

    // 🔥 ANDROID ONLY : création du channel
    if (deviceType === 'android') {
      console.log('🤖 Création du channel Android');
      try {
        await PushNotifications.createChannel({
          id: 'default',
          name: 'Notifications',
          description: 'Notifications générales',
          importance: 4 // HIGH
        });
        console.log('✅ Channel Android créé');
      } catch (e) {
        console.warn('⚠️ Channel Android déjà existant ou erreur:', e);
      }
    }

    // Listeners
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ DEVICE TOKEN RECEIVED');
      console.log('📱 Token:', token?.value);
      if (token?.value) await saveTokenToServer(token.value);
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Push registration error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📩 Push reçu:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👉 Push action:', notification);
    });

    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      const requestStatus = await PushNotifications.requestPermissions();
      if (requestStatus.receive !== 'granted') {
        console.warn('⛔ Permission refusée');
        return;
      }
    }

    console.log('📌 Permission OK → register()');
    await PushNotifications.register();
  }

  // Auto-start
  setTimeout(initPush, 3000);
})();
