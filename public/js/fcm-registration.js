// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';
  const SUPABASE_URL = 'https://ztdzragdnjkastswtvzn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0ZHpyYWdkbmprYXN0c3d0dnpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQzNTc2OTAsImV4cCI6MjA0OTkzMzY5MH0.VE_2vYBO7RfNGLa_iHtSZhPOnOk9ofmvdlb_EY6-TrU';
  
  async function getSupabaseSession() {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.Plugins || !cap.Plugins.Preferences) {
        console.error('❌ Capacitor Preferences non disponible');
        return null;
      }
      
      // Récupérer la session Supabase stockée par Capacitor
      const { value: authStorage } = await cap.Plugins.Preferences.get({ 
        key: 'sb-ztdzragdnjkastswtvzn-auth-token' 
      });
      
      if (!authStorage) {
        console.warn('⚠️ Pas de session Supabase trouvée');
        return null;
      }
      
      const session = JSON.parse(authStorage);
      console.log('✅ Session Supabase trouvée');
      
      return session.access_token;
    } catch (err) {
      console.error('❌ Erreur lecture session Supabase:', err);
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
      console.log('📱 Token iOS:', token);
      
      const res = await fetch(`${API_BASE}/api/save-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({ 
          token,
          device_type: 'ios'
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
    if (window.__pushInitDone) return;
    window.__pushInitDone = true;
    
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
    
    // Listeners
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅✅✅ DEVICE TOKEN RECEIVED!');
      console.log('📱 Token:', token && token.value);
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
    
    console.log('📌 Permission OK, register()...');
    await PushNotifications.register();
    console.log('🟢 register() appelé, attente token...');
  }
  
  // Auto-start
  setTimeout(() => {
    initPush();
  }, 3000);
})();
