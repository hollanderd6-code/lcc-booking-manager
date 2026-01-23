// public/js/push-notifications-handler.js
// Version corrigée (Capacitor iOS/Android + garde-fous plugin + sauvegarde token serveur)
(function () {
  console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé');

  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  // ---------- Helpers ----------
  function getDeviceType() {
    const cap = window.Capacitor;
    const ua = (navigator.userAgent || '').toLowerCase();

    if (!cap || typeof cap.getPlatform !== 'function') {
      console.log('🌐 [DEBUG] Pas de Capacitor, device type: web');
      return 'web';
    }

    const platform = cap.getPlatform(); // 'ios' | 'android' | 'web'
    console.log('📱 [DEBUG] Capacitor.getPlatform():', platform);
    console.log('🌐 [DEBUG] User Agent:', ua);

    // Cross-check (certaines WebViews/UA peuvent être trompeuses)
    if (platform === 'ios' && ua.includes('android')) {
      console.warn('⚠️ [DEBUG] Correction: platform iOS mais UA Android → android');
      return 'android';
    }
    if (platform === 'android' && (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios'))) {
      console.warn('⚠️ [DEBUG] Correction: platform Android mais UA iOS → ios');
      return 'ios';
    }

    return platform === 'ios' ? 'ios' : platform === 'android' ? 'android' : 'web';
  }

  function getPushPlugin() {
    const cap = window.Capacitor;

    // Capacitor “global” (script) : plugins souvent exposés ici
    const pn = cap?.Plugins?.PushNotifications;

    // Si non présent, on ne jette PAS d’erreur : on log et on sort proprement
    if (!pn) return null;

    const hasCoreFns =
      typeof pn.requestPermissions === 'function' &&
      typeof pn.register === 'function' &&
      typeof pn.addListener === 'function';

    return hasCoreFns ? pn : null;
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function extractAccessToken(obj) {
    if (!obj || typeof obj !== 'object') return null;

    // formats possibles
    if (typeof obj.access_token === 'string') return obj.access_token;
    if (obj?.currentSession && typeof obj.currentSession.access_token === 'string') return obj.currentSession.access_token;
    if (obj?.session && typeof obj.session.access_token === 'string') return obj.session.access_token;
    if (obj?.data?.session && typeof obj.data.session.access_token === 'string') return obj.data.session.access_token;

    return null;
  }

  async function getSupabaseJwt() {
    // 1) localStorage (souvent le plus fiable côté WebView)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        // pattern le plus courant: sb-<projectRef>-auth-token
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
          const raw = localStorage.getItem(k);
          const parsed = safeJsonParse(raw);
          const token = extractAccessToken(parsed);
          if (token) {
            console.log('✅ [DEBUG] JWT trouvé via localStorage:', k);
            return token;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ [DEBUG] localStorage scan failed:', e);
    }

    // 2) Capacitor Preferences (si dispo)
    try {
      const pref = window.Capacitor?.Plugins?.Preferences;
      if (!pref || typeof pref.get !== 'function') return null;

      const possibleKeys = [
        // clés “classiques”:
        'supabase.auth.token',
        'supabase-auth-token',
        // si tu connais ton projectRef Supabase, tu peux en ajouter ici:
        // 'sb-xxxxxxxxxxxxxxxxxxxx-auth-token'
      ];

      for (const key of possibleKeys) {
        const { value } = await pref.get({ key });
        if (!value) continue;
        const parsed = safeJsonParse(value);
        const token = extractAccessToken(parsed);
        if (token) {
          console.log('✅ [DEBUG] JWT trouvé via Preferences:', key);
          return token;
        }
      }
    } catch (e) {
      console.warn('⚠️ [DEBUG] Preferences scan failed:', e);
    }

    console.warn('⚠️ [DEBUG] Aucun JWT Supabase trouvé');
    return null;
  }

  async function saveTokenToServer(pushToken, deviceType) {
    console.log('💾 [DEBUG] saveTokenToServer appelée');
    console.log('   Token:', String(pushToken).slice(0, 30) + '...');
    console.log('   Device:', deviceType);

    try {
      const jwt = await getSupabaseJwt();
      console.log('   Auth token:', jwt ? 'Présent' : 'Absent');

      if (!jwt) {
        console.warn('⚠️ [DEBUG] Pas de token auth - impossible de sauvegarder');
        return;
      }

      console.log('📤 [DEBUG] Envoi au serveur...');
      const res = await fetch(`${API_BASE}/api/save-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          token: pushToken,
          device_type: deviceType,
        }),
      });

      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : { raw: await res.text() };

      if (!res.ok) {
        console.error('❌ [DEBUG] Erreur serveur:', res.status, data);
        return;
      }

      console.log('✅✅✅ [DEBUG] TOKEN SAUVEGARDÉ SUR SERVEUR !', data);
    } catch (err) {
      console.error('❌ [DEBUG] Erreur réseau:', err?.name, err?.message, err);
    }
  }

  // ---------- Main init ----------
  async function initPushNotifications() {
    console.log('🔔 [DEBUG] initPushNotifications appelée');

    if (window.__pushInitDone) {
      console.log('⏭️ [DEBUG] Push déjà initialisé, skip');
      return;
    }
    window.__pushInitDone = true;

    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
      console.log('🌐 [DEBUG] Pas en natif, skip push');
      return;
    }

    const platform = cap.getPlatform?.();
    console.log('📱 [DEBUG] Platform:', platform);

    if (platform !== 'ios' && platform !== 'android') {
      console.log('🌐 [DEBUG] Pas iOS/Android, skip push');
      return;
    }

    const PushNotifications = getPushPlugin();
    if (!PushNotifications) {
      console.error('❌ [DEBUG] Plugin PushNotifications introuvable (non installé/sync iOS/Android ?)');
      // Important: on sort proprement, sans casser le reste de l’app (login etc.)
      return;
    }

    const deviceType = getDeviceType();
    console.log('✅ [DEBUG] On est sur mobile:', deviceType);

    // Listeners
    PushNotifications.addListener('registration', async (token) => {
      const tokenValue = token?.value || token;
      console.log('✅ [DEBUG] Registration success:', tokenValue);

      try {
        localStorage.setItem('push_token', String(tokenValue));
      } catch {}

      await saveTokenToServer(String(tokenValue), deviceType);
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ [DEBUG] Registration error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📩 [DEBUG] Push received:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('👉 [DEBUG] Push action performed:', action);
    });

    // Permission + register
    try {
      console.log('🔐 [DEBUG] Demande permission...');
      const perm = await PushNotifications.requestPermissions();
      console.log('🔐 [DEBUG] Permission result:', perm);

      if (perm?.receive !== 'granted') {
        console.warn('⚠️ [DEBUG] Permission refusée');
        return;
      }

      console.log('✅ [DEBUG] Permission accordée → register()');
      await PushNotifications.register();
      console.log('✅ [DEBUG] register() appelé avec succès');
    } catch (err) {
      console.error('❌ [DEBUG] Erreur request/register:', err?.name, err?.message, err);
    }
  }

  console.log('⏰ [DEBUG] Programmation initialisation dans 3 secondes...');
  setTimeout(() => {
    console.log('⏰ [DEBUG] Démarrage initialisation...');
    initPushNotifications();
  }, 3000);

  console.log('✅ [DEBUG] Fin du chargement du fichier');
})();
