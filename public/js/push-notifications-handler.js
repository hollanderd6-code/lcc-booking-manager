// public/js/push-notifications-handler.js
// Version Firebase Cloud Messaging avec support lcc_token
(function () {
  console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé (version Firebase)');

  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  function getDeviceType() {
    const cap = window.Capacitor;
    const ua = (navigator.userAgent || '').toLowerCase();

    if (!cap || typeof cap.getPlatform !== 'function') {
      return 'web';
    }

    const platform = cap.getPlatform();

    if (platform === 'ios' && ua.includes('android')) {
      return 'android';
    }
    if (platform === 'android' && (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios'))) {
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

    return fcm;
  }

  async function getSupabaseJwt() {
    console.log('🔍 [DEBUG] === DÉBUT RECHERCHE JWT ===');
    
    // Chercher directement lcc_token
    try {
      const lccToken = localStorage.getItem('lcc_token');
      if (lccToken) {
        console.log('✅ [DEBUG] JWT trouvé dans lcc_token');
        return lccToken;
      }
    } catch (e) {
      console.warn('⚠️ [DEBUG] Erreur lecture lcc_token:', e);
    }

    // Sinon scanner toutes les clés
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
        
        if (k.includes('supabase') || k.includes('auth') || k.startsWith('sb-')) {
          const raw = localStorage.getItem(k);
          console.log(\`🔑 [DEBUG] Clé trouvée: \${k}\`);
          
          try {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.session?.access_token || parsed?.data?.session?.access_token;
            if (token) {
              console.log('✅ [DEBUG] JWT trouvé via localStorage:', k);
              return token;
            }
          } catch {}
        }
      }
    } catch (e) {
      console.warn('⚠️ [DEBUG] localStorage scan failed:', e);
    }

    console.warn('❌ [DEBUG] Aucun JWT Supabase trouvé');
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
        console.warn('⚠️ [DEBUG] Pas de token auth - sauvegarde en attente');
        try {
          localStorage.setItem('pending_fcm_token', fcmToken);
          localStorage.setItem('pending_device_type', deviceType);
          console.log('💾 [DEBUG] Token FCM sauvegardé localement pour retry');
        } catch {}
        return;
      }

      console.log('📤 [DEBUG] Envoi au serveur...');
      const res = await fetch(\`\${API_BASE}/api/save-token\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${jwt}\`,
        },
        body: JSON.stringify({
          token: fcmToken,
          device_type: deviceType,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error('❌ [DEBUG] Erreur serveur:', res.status, data);
        return;
      }

      console.log('✅✅✅ [DEBUG] TOKEN FCM SAUVEGARDÉ !', data);
      
      try {
        localStorage.removeItem('pending_fcm_token');
        localStorage.removeItem('pending_device_type');
      } catch {}
      
    } catch (err) {
      console.error('❌ [DEBUG] Erreur réseau:', err);
    }
  }

  async function retryPendingToken() {
    try {
      const pendingToken = localStorage.getItem('pending_fcm_token');
      const pendingDevice = localStorage.getItem('pending_device_type');
      
      if (pendingToken && pendingDevice) {
        console.log('🔄 [DEBUG] Token FCM en attente, retry...');
        await saveTokenToServer(pendingToken, pendingDevice);
      }
    } catch (e) {
      console.error('❌ [DEBUG] Erreur retry:', e);
    }
  }

  async function initPushNotifications() {
    console.log('🔔 [DEBUG] initPushNotifications appelée');

    if (window.__pushInitDone) {
      console.log('⏭️ [DEBUG] Push déjà initialisé');
      return;
    }
    window.__pushInitDone = true;

    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) {
      console.log('🌐 [DEBUG] Pas en natif');
      return;
    }

    const platform = cap.getPlatform?.();
    if (platform !== 'ios' && platform !== 'android') {
      console.log('🌐 [DEBUG] Pas iOS/Android');
      return;
    }

    const FirebaseMessaging = getFirebaseMessaging();
    if (!FirebaseMessaging) {
      console.error('❌ [DEBUG] FirebaseMessaging non disponible');
      return;
    }

    const deviceType = getDeviceType();
    console.log('📱 [DEBUG] Platform:', platform);
    console.log('✅ [DEBUG] On est sur mobile:', deviceType);

    FirebaseMessaging.addListener('notificationReceived', (notification) => {
      console.log('📩 [DEBUG] Notification reçue:', notification);
    });

    FirebaseMessaging.addListener('notificationActionPerformed', (action) => {
      console.log('👉 [DEBUG] Notification action:', action);
    });

    FirebaseMessaging.addListener('tokenReceived', async (result) => {
      const fcmToken = result?.token;
      console.log('✅✅✅ [DEBUG] FCM Token received:', fcmToken);

      if (fcmToken) {
        try {
          localStorage.setItem('fcm_token', fcmToken);
        } catch {}
        await saveTokenToServer(fcmToken, deviceType);
      }
    });

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
          localStorage.setItem('fcm_token', fcmToken);
        } catch {}
        await saveTokenToServer(fcmToken, deviceType);
      }
    } catch (err) {
      console.error('❌ [DEBUG] Erreur:', err);
    }

    // Retry pending token si existe
    setTimeout(() => {
      retryPendingToken();
    }, 2000);
  }

  window.retryFCMTokenSave = retryPendingToken;

  setTimeout(() => {
    initPushNotifications();
  }, 3000);
})();
