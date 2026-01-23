// public/js/push-notifications-handler.js
(function () {
  console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé');
  
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  // ✅✅✅ DÉTECTION ROBUSTE DE LA PLATEFORME ✅✅✅
  function getDeviceType() {
    if (!window.Capacitor || typeof window.Capacitor.getPlatform !== 'function') {
      console.log('🌐 [DEBUG] Pas de Capacitor, device type: web');
      return 'web';
    }
    
    const platform = window.Capacitor.getPlatform();
    const ua = navigator.userAgent.toLowerCase();
    
    console.log('📱 [DEBUG] Capacitor.getPlatform():', platform);
    console.log('🌐 [DEBUG] User Agent:', ua);
    
    // ⚠️ CORRECTION : Cross-validation entre Capacitor et UserAgent
    if (platform === 'ios' && ua.includes('android')) {
      console.warn('⚠️⚠️⚠️ CORRECTION APPLIQUÉE : Capacitor dit iOS mais UserAgent dit Android!');
      return 'android';
    }
    
    if (platform === 'android' && (ua.includes('iphone') || ua.includes('ipad'))) {
      console.warn('⚠️⚠️⚠️ CORRECTION APPLIQUÉE : Capacitor dit Android mais UserAgent dit iOS!');
      return 'ios';
    }
    
    const detectedType = platform === 'ios' ? 'ios' : platform === 'android' ? 'android' : 'web';
    console.log('✅ [DEBUG] Device type détecté:', detectedType);
    return detectedType;
  }

  async function initPushNotifications() {
    console.log('🔔 [DEBUG] initPushNotifications appelée');
    console.log('🔔 [DEBUG] typeof Capacitor:', typeof window.Capacitor);
    console.log('🔔 [DEBUG] window.Capacitor:', window.Capacitor);
    
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

    const platform = cap.getPlatform();
    console.log('📱 [DEBUG] Platform:', platform);

    if (platform !== 'ios' && platform !== 'android') {
      console.log('🌐 [DEBUG] Pas iOS/Android, skip push');
      return;
    }

    console.log('✅ [DEBUG] On est sur mobile:', platform);

    const PushNotifications = cap.Plugins && cap.Plugins.PushNotifications;
    if (!PushNotifications) {
      console.error('❌ [DEBUG] Plugin PushNotifications introuvable');
      return;
    }

    console.log('✅ [DEBUG] Plugin PushNotifications trouvé');

    // ===== LISTENERS =====
    console.log('📝 [DEBUG] Ajout des listeners...');

    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ [DEBUG] Token reçu:', token && token.value);
      if (!token || !token.value) {
        console.error('❌ [DEBUG] Token invalide');
        return;
      }
      
      const deviceType = getDeviceType();
      console.log('📱 [DEBUG] Device type:', deviceType);
      
      await saveTokenToServer(token.value, deviceType);
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ [DEBUG] Erreur registration:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📩 [DEBUG] Notif reçue (foreground):', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👆 [DEBUG] Notif tapped:', notification);
    });

    console.log('✅ [DEBUG] Listeners ajoutés');

    // ===== PERMISSIONS =====
    console.log('📝 [DEBUG] Vérification permission...');
    const permStatus = await PushNotifications.checkPermissions();
    console.log('📊 [DEBUG] Permission actuelle:', permStatus);

    if (!permStatus || permStatus.receive !== 'granted') {
      console.log('📝 [DEBUG] Demande permission...');
      const requestStatus = await PushNotifications.requestPermissions();
      console.log('📊 [DEBUG] Permission demandée:', requestStatus);
      
      if (!requestStatus || requestStatus.receive !== 'granted') {
        console.warn('⛔ [DEBUG] Permission refusée');
        return;
      }
    }

    console.log('✅ [DEBUG] Permission accordée');

    // ===== REGISTER =====
    console.log('📝 [DEBUG] Appel PushNotifications.register()...');
    await PushNotifications.register();
    console.log('✅ [DEBUG] Register() appelé avec succès');
  }

  // ===== RECHERCHE TOKEN SUPABASE =====
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
          console.log('✅ Clé trouvée:', key);
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
        console.log('✅ JWT direct trouvé');
        return found.value;
      }

      const session = JSON.parse(found.value);
      console.log('✅ Session parsée');

      const token = session.access_token || session.accessToken || session.token;
      if (token) {
        console.log('✅ JWT extrait');
        return token;
      }

      console.warn('⚠️ Pas de token dans la session');
      return null;
    } catch (err) {
      console.error('❌ Erreur parsing session:', err);
      return null;
    }
  }

  async function saveTokenToServer(token, deviceType) {
    console.log('💾 [DEBUG] saveTokenToServer appelée');
    console.log('   Token:', token.substring(0, 30) + '...');
    console.log('   Device:', deviceType);

    try {
      const jwt = await getSupabaseSession();
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
          token,
          device_type: deviceType
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error('❌ [DEBUG] Erreur serveur:', res.status, data);
        return;
      }

      console.log('✅✅✅ [DEBUG] TOKEN SAUVEGARDÉ SUR SERVEUR !', data);
    } catch (err) {
      console.error('❌ [DEBUG] Erreur réseau:', err);
    }
  }

  // ===== AUTO-START =====
  console.log('⏰ [DEBUG] Programmation initialisation dans 3 secondes...');
  setTimeout(() => {
    console.log('⏰ [DEBUG] Démarrage initialisation...');
    initPushNotifications();
  }, 3000);

  console.log('✅ [DEBUG] Fin du chargement du fichier');
})();
