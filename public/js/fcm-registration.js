// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';
  
  async function saveTokenToServer(token) {
    try {
      // ✅ Utiliser Capacitor Preferences au lieu de localStorage
      const cap = window.Capacitor;
      if (!cap || !cap.Plugins || !cap.Plugins.Preferences) {
        console.error('❌ Capacitor Preferences non disponible');
        return;
      }
      
      const { value: jwt } = await cap.Plugins.Preferences.get({ key: 'lcc_token' });
      
      if (!jwt) {
        console.warn('⚠️ Pas de JWT dans Preferences');
        return;
      }
      
      console.log('✅ JWT trouvé, envoi du token au serveur...');
      
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
      console.log('✅ Push registration token:', token && token.value);
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
  }, 2000);
})();
