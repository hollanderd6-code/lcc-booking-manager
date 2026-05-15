// public/js/push-notifications-handler.js
// Version Firebase Cloud Messaging avec support lcc_token + deep linking
(function () {
  console.log('🔔 [DEBUG] Fichier push-notifications-handler.js chargé (version Firebase)');
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  // ============================================
  // 🧭 DEEP LINKING — Navigation depuis notif
  // ============================================
  function navigateFromNotification(data) {
    if (!data) return;
    const type = data.type || '';
    const convId = data.conversation_id || data.conversationId || '';
    const propId = data.property_id || data.propertyId || '';
    const cleaningId = data.cleaning_id || data.cleaningId || '';
    const screen = data.screen || '';

    console.log('🧭 [DEEP LINK] Type:', type, '| convId:', convId, '| propId:', propId);

    // Détecter la page actuelle
    const currentPath = window.location.pathname;
    const isNative = !!(window.Capacitor?.isNativePlatform?.());

    // Fonction de navigation
    const goTo = (path, params) => {
      const url = params ? path + '?' + new URLSearchParams(params).toString() : path;
      if (isNative) {
        window.location.href = url;
      } else {
        window.location.href = url;
      }
    };

    // Routing selon le type
    if (type === 'new_guest_message' || type === 'new_chat_message' || type === 'escalade_message' || screen === 'messages') {
      if (convId) {
        goTo('messages.html', { conv: convId });
      } else {
        goTo('messages.html');
      }
      return;
    }

    if (type === 'new_reservation' || type === 'daily_arrivals' || type === 'check_in') {
      goTo('app.html');
      return;
    }

    if (type === 'new_cleaning' || type === 'cleaning_completed' || type === 'cleaning_reminder') {
      if (cleaningId) {
        goTo('cleaning.html', { checklist: cleaningId });
      } else {
        goTo('cleaning.html');
      }
      return;
    }

    if (type === 'new_deposit' || type === 'deposit_paid' || type === 'caution') {
      goTo('app.html');
      return;
    }

    if (type === 'escalade' || type === 'escalade_reminder') {
      if (convId) {
        goTo('messages.html', { conv: convId });
      } else {
        goTo('messages.html');
      }
      return;
    }

    // Fallback : page d'accueil
    console.log('⚠️ [DEEP LINK] Type inconnu, redirection accueil');
    goTo('app.html');
  }

  // Sauvegarder la notif dans l'historique
  async function logNotificationToHistory(title, body, type, data) {
    try {
      const jwt = localStorage.getItem('lcc_token');
      if (!jwt) return;
      await fetch(API_BASE + '/api/notifications/history/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ title: title || '', body: body || '', type: type || 'push', data: data || {} })
      });
    } catch(e) {
      console.warn('⚠️ logNotificationToHistory:', e.message);
    }
  }

  function getDeviceType() {
    const cap = window.Capacitor;
    const ua = (navigator.userAgent || '').toLowerCase();
    if (!cap || typeof cap.getPlatform !== 'function') return 'web';
    const platform = cap.getPlatform();
    if (platform === 'ios' && ua.includes('android')) return 'android';
    if (platform === 'android' && (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios'))) return 'ios';
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
    try {
      const lccToken = localStorage.getItem('lcc_token');
      if (lccToken) return lccToken;
    } catch (e) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.includes('supabase') || k.includes('auth') || k.startsWith('sb-')) {
          const raw = localStorage.getItem(k);
          try {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.session?.access_token || parsed?.data?.session?.access_token;
            if (token) return token;
          } catch {}
        }
      }
    } catch (e) {}
    return null;
  }

  function getOrCreateDeviceId() {
    try {
      let deviceId = localStorage.getItem('bh_device_id');
      if (!deviceId) {
        deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        localStorage.setItem('bh_device_id', deviceId);
      }
      return deviceId;
    } catch(e) { return null; }
  }

  async function saveTokenToServer(fcmToken, deviceType) {
    const deviceId = getOrCreateDeviceId();
    try {
      const jwt = await getSupabaseJwt();
      if (!jwt) {
        try {
          localStorage.setItem('pending_fcm_token', fcmToken);
          localStorage.setItem('pending_device_type', deviceType);
        } catch {}
        return;
      }
      const res = await fetch(API_BASE + '/api/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ token: fcmToken, device_type: deviceType, device_id: deviceId }),
      });
      const data = await res.json().catch(function() { return {}; });
      if (res.ok) {
        console.log('✅ [DEBUG] TOKEN FCM SAUVEGARDÉ !', data);
        try { localStorage.removeItem('pending_fcm_token'); localStorage.removeItem('pending_device_type'); } catch {}
      }
    } catch (err) {
      console.error('❌ [DEBUG] Erreur réseau:', err);
    }
  }

  async function retryPendingToken() {
    try {
      const pendingToken = localStorage.getItem('pending_fcm_token');
      const pendingDevice = localStorage.getItem('pending_device_type');
      if (pendingToken && pendingDevice) await saveTokenToServer(pendingToken, pendingDevice);
    } catch (e) {}
  }

  async function initPushNotifications() {
    if (window.__pushInitDone) return;
    window.__pushInitDone = true;

    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    const platform = cap.getPlatform ? cap.getPlatform() : null;
    if (platform !== 'ios' && platform !== 'android') return;

    const FirebaseMessaging = getFirebaseMessaging();
    if (!FirebaseMessaging) return;

    const deviceType = getDeviceType();

    // ── Notification reçue en foreground ──
    FirebaseMessaging.addListener('notificationReceived', function(notification) {
      console.log('📩 [DEBUG] Notification reçue:', notification);
      var n = notification.notification || notification;
      var title = n.title || (notification.data && notification.data.title) || '';
      var body  = n.body  || (notification.data && notification.data.body)  || '';
      var type  = (notification.data && notification.data.type) || 'push';
      logNotificationToHistory(title, body, type, notification.data || {});
      if (typeof window.initNotifBadge === 'function') setTimeout(window.initNotifBadge, 500);
    });

    // ── Clic sur une notification (deep linking) ──
    FirebaseMessaging.addListener('notificationActionPerformed', function(action) {
      console.log('👉 [DEBUG] Notification cliquée:', action);
      try {
        // Les data peuvent être dans action.notification.data ou action.data
        const data = action?.notification?.data || action?.data || {};
        console.log('🧭 [DEEP LINK] Data reçue:', JSON.stringify(data));
        // Attendre que l'app soit prête avant de naviguer
        if (document.readyState === 'complete') {
          navigateFromNotification(data);
        } else {
          document.addEventListener('DOMContentLoaded', function() {
            navigateFromNotification(data);
          });
        }
      } catch(e) {
        console.error('❌ [DEEP LINK] Erreur navigation:', e.message);
      }
    });

    // ── Notif reçue quand l'app était fermée (cold start) ──
    try {
      const deliveredNotifs = await FirebaseMessaging.getDeliveredNotifications();
      if (deliveredNotifs?.notifications?.length > 0) {
        console.log('📬 [DEBUG] Notifs livrées (cold start):', deliveredNotifs.notifications.length);
        // Ne pas naviguer automatiquement au cold start — laisser l'utilisateur choisir
      }
    } catch(e) {}

    FirebaseMessaging.addListener('tokenReceived', async function(result) {
      const fcmToken = result?.token;
      if (fcmToken) {
        try { localStorage.setItem('fcm_token', fcmToken); } catch {}
        await saveTokenToServer(fcmToken, deviceType);
      }
    });

    try {
      const perm = await FirebaseMessaging.requestPermissions();
      if (perm?.receive !== 'granted') return;
      const tokenResult = await FirebaseMessaging.getToken();
      const fcmToken = tokenResult?.token;
      if (fcmToken) {
        try { localStorage.setItem('fcm_token', fcmToken); } catch {}
        await saveTokenToServer(fcmToken, deviceType);
      }
    } catch (err) {
      console.error('❌ [DEBUG] Erreur:', err);
    }

    setTimeout(function() { retryPendingToken(); }, 2000);
  }

  window.retryFCMTokenSave = retryPendingToken;

  setTimeout(function() { initPushNotifications(); }, 3000);
})();
