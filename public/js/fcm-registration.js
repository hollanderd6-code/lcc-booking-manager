// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  const platform =
    window.Capacitor && typeof window.Capacitor.getPlatform === 'function'
      ? window.Capacitor.getPlatform()
      : 'web';

  const PENDING_KEY = 'pending_fcm_token_v2';

  function isNative() {
    const cap = window.Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  }

  async function findSupabaseKey() {
    const cap = window.Capacitor;
    if (!cap?.Plugins?.Preferences) return null;

    const keys = [
      'lcc_token',
      'sb-ztdzragdnjkastswtvzn-auth-token',
      'supabase.auth.token',
      '@supabase/auth-token',
      'sb-auth-token',
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
      return session.access_token || session.accessToken || session.token || null;
    } catch {
      return null;
    }
  }

  async function setPendingToken(token) {
    try {
      const cap = window.Capacitor;
      if (cap?.Plugins?.Preferences) {
        await cap.Plugins.Preferences.set({
          key: PENDING_KEY,
          value: JSON.stringify({ token, platform, ts: Date.now() }),
        });
      } else {
        localStorage.setItem(PENDING_KEY, JSON.stringify({ token, platform, ts: Date.now() }));
      }
    } catch (e) {
      console.warn('⚠️ Impossible de stocker pending token', e);
    }
  }

  async function getPendingToken() {
    try {
      const cap = window.Capacitor;
      let raw = null;
      if (cap?.Plugins?.Preferences) {
        const { value } = await cap.Plugins.Preferences.get({ key: PENDING_KEY });
        raw = value;
      } else {
        raw = localStorage.getItem(PENDING_KEY);
      }
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function clearPendingToken() {
    try {
      const cap = window.Capacitor;
      if (cap?.Plugins?.Preferences) {
        await cap.Plugins.Preferences.remove({ key: PENDING_KEY });
      } else {
        localStorage.removeItem(PENDING_KEY);
      }
    } catch {}
  }

  async function saveTokenToServer(token) {
    const jwt = await getJwt();
    if (!jwt) {
      console.warn('⛔ Pas de JWT → on garde le token en attente');
      await setPendingToken(token);
      return false;
    }

    console.log(`📤 Envoi token FCM (${platform}) au serveur: ${String(token).slice(0, 18)}...`);

    const res = await fetch(`${API_BASE}/api/save-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        token,
        device_type: platform, // ios / android
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('❌ /api/save-token KO', res.status, data);
      return false;
    }

    console.log('✅ Token enregistré côté serveur', data);
    await clearPendingToken();
    return true;
  }

  async function ensureAndroidPermissionAndChannel(PushNotifications) {
    // Android 13+ permission
    const perm = await PushNotifications.checkPermissions();
    console.log('🤖 Android permissions:', perm);

    if (perm.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      console.log('🤖 Android requestPermissions:', req);

      if (req.receive !== 'granted') {
        console.warn('⛔ Android: permission notif refusée → pas de push');
        return false;
      }
    }

    // Android 8+ channel
    try {
      await PushNotifications.createChannel({
        id: 'default',
        name: 'Notifications',
        description: 'Notifications générales',
        importance: 4,
      });
      console.log('✅ Channel Android prêt');
    } catch (e) {
      console.log('ℹ️ Channel Android déjà existant / erreur non bloquante', e);
    }

    return true;
  }

  async function getFcmTokenPreferFirebaseMessaging() {
    const cap = window.Capacitor;

    // 1) Si le plugin FirebaseMessaging existe (souvent le cas chez toi), on le préfère:
    const FM = cap?.Plugins?.FirebaseMessaging;
    if (FM?.getToken) {
      try {
        // permissions côté iOS/Android (safe)
        if (FM.requestPermissions) {
          await FM.requestPermissions();
        }
        const res = await FM.getToken();
        const t = res?.token || res?.value || null;
        if (t) {
          console.log(`🔥 FCM token via FirebaseMessaging (${platform}): ${t.slice(0, 18)}...`);
          return t;
        }
      } catch (e) {
        console.warn('⚠️ FirebaseMessaging.getToken a échoué', e);
      }
    }

    // 2) Fallback : PushNotifications registration token (utile surtout Android)
    const PN = cap?.Plugins?.PushNotifications;
    if (PN) {
      return new Promise(async (resolve) => {
        let done = false;

        const stop = async () => {
          if (done) return;
          done = true;
          resolve(null);
        };

        try {
          const handle = await PN.addListener('registration', (token) => {
            const v = token?.value || null;
            console.log(`📱 registration token (${platform}):`, v ? `${v.slice(0, 18)}...` : v);
            done = true;
            resolve(v);
          });

          await PN.addListener('registrationError', (err) => {
            console.error('❌ registrationError', err);
            stop();
          });

          if (platform === 'android') {
            const ok = await ensureAndroidPermissionAndChannel(PN);
            if (!ok) return stop();
          }

          await PN.register();

          // timeout de sécurité si jamais pas de token
          setTimeout(() => {
            if (!done) stop();
            // cleanup listener
            try { handle?.remove?.(); } catch {}
          }, 8000);
        } catch (e) {
          console.error('❌ fallback PushNotifications a échoué', e);
          stop();
        }
      });
    }

    return null;
  }

  async function retryPendingIfAny() {
    const pending = await getPendingToken();
    if (!pending?.token) return;
    console.log('🔁 Tentative envoi pending token…');
    await saveTokenToServer(pending.token);
  }

  async function initPush() {
    if (window.__fcmInitV3) return;
    window.__fcmInitV3 = true;

    if (!isNative()) {
      console.log('🌐 Web → pas de push');
      return;
    }

    console.log(`🚀 Init push V3 (${platform})`);

    // 1) Récupérer un vrai token FCM
    const token = await getFcmTokenPreferFirebaseMessaging();
    if (!token) {
      console.warn('⛔ Aucun token FCM obtenu (pour l’instant)');
    } else {
      await saveTokenToServer(token);
    }

    // 2) Si pas connecté au moment T, on réessaie plus tard automatiquement
    setInterval(() => {
      retryPendingIfAny();
    }, 5000);

    // 3) Si FirebaseMessaging peut notifier les refresh de token, on les sauvegarde
    const cap = window.Capacitor;
    const FM = cap?.Plugins?.FirebaseMessaging;
    if (FM?.addListener) {
      try {
        await FM.addListener('tokenReceived', async (ev) => {
          const t = ev?.token;
          if (t) {
            console.log('🔄 Nouveau token FCM reçu:', t.slice(0, 18) + '...');
            await saveTokenToServer(t);
          }
        });
      } catch {}
    }
  }

  setTimeout(initPush, 2000);
})();
