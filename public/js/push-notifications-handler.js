// public/js/push-notifications-handler.js
// Version Firebase Cloud Messaging avec debug étendu
(function () {
  console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé (version Firebase)');

  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  // ---------- Helpers ----------
  function getDeviceType() {
    const cap = window.Capacitor;
    const ua = (navigator.userAgent || '').toLowerCase();

    if (!cap || typeof cap.getPlatform !== 'function') {
      console.log('🌐 [DEBUG] Pas de Capacitor, device type: web');
      return 'web';
    }

    const platform = cap.getPlatform();
    console.log('📱 [DEBUG] Capacitor.getPlatform():', platform);

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

  function getFirebaseMessaging() {
    const cap = window.Capacitor;
    const fcm = cap?.Plugins?.FirebaseMessaging;

    if (!fcm) {
      console.error('❌ [DEBUG] Plugin FirebaseMessaging introuvable');
      return null;
    }

    const hasCoreFns =
      typeof fcm.requestPermissions === 'function' &&
      typeof fcm.getToken === 'function' &&
      typeof fcm.addListener === 'function';

    return hasCoreFns ? fcm : null;
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function extractAccessToken(obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (typeof obj.access_token === 'string') return obj.access_token;
    if (obj?.currentSession && typeof obj.currentSession.access_token === 'string') return obj.currentSession.access_token;
    if (obj?.session && typeof obj.session.access_token === 'string') return obj.session.access_token;
    if (obj?.data?.session && typeof obj.data.session.access_token === 'string') return obj.data.session.access_token;

    return null;
  }

  async function getSupabaseJwt() {
    console.log('🔍 [DEBUG] === DÉBUT RECHERCHE JWT ===');
    
    // 1) localStorage - scanner TOUTES les clés pour debug
    console.log('🔍 [DEBUG] Scan localStorage...');
    try {
      const allKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) allKeys.push(k);
      }
      console.log('📋 [DEBUG] Toutes les clés localStorage:', allKeys);

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        
        // Chercher toutes les clés qui pourraient contenir un token
        if (k.includes('supabase') || k.includes('auth') || k.startsWith('sb-')) {
          const raw = localStorage.getItem(k);
          console.log(`🔑 [DEBUG] Clé trouvée: ${k}`);
          console.log(`📦 [DEBUG] Valeur (100 premiers chars): ${raw?.substring(0, 100)}`);
          
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

    // 2) Capacitor Preferences
    console.log('🔍 [DEBUG] Scan Capacitor Preferences...');
    try {
      const pref = window.Capacitor?.Plugins?.Preferences;
      if (!pref || typeof pref.get !== 'function') {
        console.log('⚠️ [DEBUG] Preferences plugin non disponible');
        return null;
      }

      const possibleKeys = [
        'supabase.auth.token',
        'supabase-auth-token',
        'sb-ztdzragdnjkastswtvzn-auth-token', // Votre project ref Supabase
        '@supabase/auth-token',
        'lcc_token',
      ];

      for (const key of possibleKeys) {
        console.log(`🔍 [DEBUG] Test clé Preferences: ${key}`);
        const { value } = await pref.get({ key });
        if (value) {
          console.log(`✅ [DEBUG] Valeur trouvée pour ${key}`);
          console.log(`📦 [DEBUG] Valeur (100 premiers chars): ${value.substring(0, 100)}`);
          
          const parsed = safeJsonParse(value);
          const token = extractAccessToken(parsed);
          if (token) {
            console.log('✅ [DEBUG] JWT trouvé via Preferences:', key);
            return token;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ [DEBUG] Preferences scan failed:', e);
    }

    console.warn('❌ [DEBUG] Aucun JWT Supabase trouvé');
    console.log('🔍 [DEBUG] === FIN RECHERCHE JWT ===');
    return null;
  }

  async function saveTokenToServer(fcmToken, deviceType) {
    console.log('💾 [DEBUG] saveTokenToServer appelée');
    console.log('   Token FCM:', String(fcmToken).slice(0, 30) + '...');
    console.log('   Device:', deviceType);

    try {
      const jwt = await getSupabaseJwt();
      console.log('   Auth token:', jwt ? 'Présent (longueur: ' + jwt.length + ')' : 'Absent');

      if (!jwt) {
        console.warn('⚠️ [DEBUG] Pas de token auth - impossible de sauvegarder');
        console.warn('💡 [DEBUG] Le token sera sauvegardé lors de la prochaine connexion');
        
        // Sauvegarder temporairement en local pour retry plus tard
        try {
          localStorage.setItem('pending_fcm_token', fcmToken);
          localStorage.setItem('pending_device_type', deviceType);
          console.log('💾 [DEBUG] Token FCM sauvegardé localement pour retry');
        } catch {}
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
          token: fcmToken,
          device_type: deviceType,
        }),
      });

      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : { raw: await res.text() };

      if (!res.ok) {
        console.error('❌ [DEBUG] Erreur serveur:', res.status, data);
        return;
      }

      console.log('✅✅✅ [DEBUG] TOKEN FCM SAUVEGARDÉ SUR SERVEUR !', data);
      
      // Supprimer le pending token
      try {
        localStorage.removeItem('pending_fcm_token');
        localStorage.removeItem('pending_device_type');
      } catch {}
      
    } catch (err) {
      console.error('❌ [DEBUG] Erreur réseau:', err?.name, err?.message, err);
    }
  }

  // Fonction pour retry la sauvegarde si un token était en attente
  async function retryPendingToken() {
    try {
      const pendingToken = localStorage.getItem('pending_fcm_token');
      const pendingDevice = localStorage.getItem('pending_device_type');
      
      if (pendingToken && pendingDevice) {
        console.log('🔄 [DEBUG] Token FCM en attente détecté, tentative de sauvegarde...');
        await saveTokenToServer(pendingToken, pendingDevice);
      }
    } catch (e) {
      console.error('❌ [DEBUG] Erreur retry pending token:', e);
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

    const FirebaseMessaging = getFirebaseMessaging();
    if (!FirebaseMessaging) {
      console.error('❌ [DEBUG] Plugin FirebaseMessaging introuvable');
      console.error('💡 [DEBUG] Installez-le avec: npm install @capacitor-firebase/messaging');
      return;
    }

    const deviceType = getDeviceType();
    console.log('✅ [DEBUG] On est sur mobile:', deviceType);

    // Listeners
    FirebaseMessaging.addListener('notificationReceived', (notification) => {
      console.log('📩 [DEBUG] Notification received:', notification);
    });

    FirebaseMessaging.addListener('notificationActionPerformed', (action) => {
      console.log('👉 [DEBUG] Notification action performed:', action);
    });

    FirebaseMessaging.addListener('tokenReceived', async (result) => {
      const fcmToken = result?.token;
      console.log('✅✅✅ [DEBUG] FCM Token received:', fcmToken);

      if (fcmToken) {
        try {
          localStorage.setItem('fcm_token', String(fcmToken));
        } catch {}

        await saveTokenToServer(String(fcmToken), deviceType);
      }
    });

    // Permission + get token
    try {
      console.log('🔐 [DEBUG] Demande permission...');
      const perm = await FirebaseMessaging.requestPermissions();
      console.log('🔐 [DEBUG] Permission result:', perm);

      if (perm?.receive !== 'granted') {
        console.warn('⚠️ [DEBUG] Permission refusée');
        return;
      }

      console.log('✅ [DEBUG] Permission accordée → getToken()');
      const tokenResult = await FirebaseMessaging.getToken();
      const fcmToken = tokenResult?.token;

      console.log('🔑 [DEBUG] FCM Token obtenu:', fcmToken);

      if (fcmToken) {
        try {
          localStorage.setItem('fcm_token', String(fcmToken));
        } catch {}

        await saveTokenToServer(String(fcmToken), deviceType);
      }
    } catch (err) {
      console.error('❌ [DEBUG] Erreur permission/getToken:', err?.name, err?.message, err);
    }
  }

  // Exposer la fonction retry globalement pour qu'elle soit appelée après login
  window.retryFCMTokenSave = retryPendingToken;

  console.log('⏰ [DEBUG] Programmation initialisation dans 3 secondes...');
  setTimeout(() => {
    console.log('⏰ [DEBUG] Démarrage initialisation...');
    initPushNotifications();
  }, 3000);

  console.log('✅ [DEBUG] Fin du chargement du fichier');
})();
