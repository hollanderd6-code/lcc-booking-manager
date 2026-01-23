// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';
  
  // ✅ Détection robuste de la plateforme
  function getDeviceType() {
    if (!window.Capacitor || typeof window.Capacitor.getPlatform !== 'function') {
      return 'web';
    }
    
    const platform = window.Capacitor.getPlatform();
    const ua = navigator.userAgent.toLowerCase();
    
    console.log('📱 Capacitor platform:', platform);
    console.log('🌐 UserAgent:', ua);
    
    // Correction si Capacitor se trompe
    if (platform === 'ios' && ua.includes('android')) {
      console.warn('⚠️ CORRECTION: Capacitor dit iOS mais UserAgent dit Android!');
      return 'android';
    }
    
    if (platform === 'android' && (ua.includes('iphone') || ua.includes('ipad'))) {
      console.warn('⚠️ CORRECTION: Capacitor dit Android mais UserAgent dit iOS!');
      return 'ios';
    }
    
    return platform === 'ios' ? 'ios' : platform === 'android' ? 'android' : 'web';
  }
  
  const deviceType = getDeviceType();
  console.log('✅ Device type final:', deviceType);
  
async function findSupabaseKey() {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.Plugins || !cap.Plugins.Preferences) {
        console.error('❌ Capacitor Preferences non disponible');
        return null;
      }
      
      // Essayer différentes clés possibles
      const possibleKeys = [
        'sb-ztdzragdnjkastswtvzn-auth-token',
        'supabase.auth.token',
        '@supabase/auth-token',
        'sb-auth-token',
        'lcc_token'  // Peut-être que c'est stocké directement
      ];
      
      console.log('🔍 Recherche de la clé Supabase...');
      
      for (const key of possibleKeys) {
        const { value } = await cap.Plugins.Preferences.get({ key });
        if (value) {
          console.log(`✅ Clé trouvée: ${key}`);
          console.log(`📦 Valeur (début): ${value.substring(0, 100)}...`);
          return { key, value };
        }
      }
      
      console.warn('⚠️ Aucune clé Supabase trouvée dans les clés testées');
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
      // Si c'est lcc_token, c'est directement le JWT
      if (found.key === 'lcc_token') {
        console.log('✅ JWT direct trouvé');
        return found.value;
      }
      
      // Sinon, parser le JSON
      const session = JSON.parse(found.value);
      console.log('✅ Session Supabase parsée');
      
      // Essayer différents chemins pour le token
      const token = session.access_token || session.accessToken || session.token;
      if (token) {
        console.log('✅ JWT extrait de la session');
        return token;
      }
      
      console.warn('⚠️ Pas de token dans la session');
      return null;
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
      
      console.log('✅ JWT récupéré, envoi du token au serveur...');
      console.log('📱 Device type:', deviceType);
      console.log('🔑 Token FCM:', token.substring(0, 30) + '...');
      
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
        console.error('❌ Enregistrement token échoué:', res.status, data);
        return;
      }
      console.log('✅ Token sauvegardé sur le serveur:', data);
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
    
    const PushNotifications = cap.Plugins && cap.Plugins.PushNotifications;
    if (!PushNotifications) {
      console.error('❌ PushNotifications plugin introuvable');
      return;
    }
    
    console.log('🔔 Init Push (native)...');
    console.log('📱 Device type:', deviceType);
    
    // Listeners
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅✅✅ DEVICE TOKEN RECEIVED!');
      console.log('📱 Device type:', deviceType);
      console.log('🔑 Token:', token && token.value);
      if (token && token.value) await saveTokenToServer(token.value);
    });
    
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Push registration error:', error);
    });
    
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📩 Push received:', notification);
    });
    
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👉 Push action performed:', notification);
    });
    
    // Permissions
    const permStatus = await PushNotifications.checkPermissions();
    console.log('🔎 checkPermissions:', permStatus);
    
    if (!permStatus || permStatus.receive !== 'granted') {
      const requestStatus = await PushNotifications.requestPermissions();
      console.log('🟦 requestPermissions:', requestStatus);
      if (!requestStatus || requestStatus.receive !== 'granted') {
        console.warn('⛔ Permission refusée');
        return;
      }
    }
    
    console.log('🔌 Permission OK, register()...');
    await PushNotifications.register();
    console.log('🟢 register() appelé, attente token...');
  }
  
  // Auto-start
  setTimeout(() => {
    initPush();
  }, 3000);
})();
