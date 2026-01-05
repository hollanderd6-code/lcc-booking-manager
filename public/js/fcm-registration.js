// public/js/fcm-registration.js
(function () {
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  async function saveTokenToServer(token) {
    try {
      const jwt = localStorage.getItem('token');
      if (!jwt) {
        console.warn('⚠️ Pas de JWT en localStorage, token non envoyé au serveur');
        return;
      }

      const res = await fetch(`${API_BASE}/api/save-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ token }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('❌ save-token failed', res.status, data);
        return;
      }
      console.log('✅ Token sauvegardé serveur:', data);
    } catch (err) {
      console.error('❌ Erreur réseau save-token:', err);
    }
  }

  async function initPush() {
    if (window.__pushInitDone) return;
    window.__pushInitDone = true;

    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
      console.log('🌐 Web: pas d’init push (non-native)');
      return;
    }

    const PushNotifications = cap.Plugins && cap.Plugins.PushNotifications;
    if (!PushNotifications) {
      console.error('❌ PushNotifications plugin introuvable (Capacitor.Plugins.PushNotifications)');
      return;
    }

    console.log('🔔 Init Push (native) ...');

    // 1) Listeners AVANT register()
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

    // 2) Permission
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

    // 3) Register
    console.log('📌 Permission OK, register()...');
    await PushNotifications.register();
    console.log('🟢 register() appelé, attente event registration/registrationError');

    // 4) Watchdog
    setTimeout(() => {
      console.warn("⚠️ Si tu ne vois toujours ni 'registration' ni 'registrationError' après 10s :");
      console.warn('→ très souvent: test sur simulateur, ou souci APNs/provisioning/runtime');
    }, 10000);
  }

  // Expose au global si besoin
  window.initPush = initPush;

  // Auto-start (si tu veux)
  // initPush();
})();
