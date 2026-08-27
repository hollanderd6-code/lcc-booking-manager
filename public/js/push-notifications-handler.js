// public/js/push-notifications-handler.js
// ============================================================
// GESTIONNAIRE UNIQUE DES NOTIFICATIONS PUSH
// ============================================================
// Plugin : @capacitor-firebase/messaging (le seul restant).
//
// Ce fichier est le SEUL endroit qui decide ou envoie un clic sur une
// notification. Avant, trois codes se disputaient ce role :
//   - une table de routage en Swift dans AppDelegate.swift, qui envoyait
//     vers messages.html?open=ID alors que la page lit ?conv= ;
//   - un bloc initPushNotifications dans mobile-native-experience.js, qui
//     utilisait le second plugin @capacitor/push-notifications ;
//   - ce fichier, qui ne connaissait pas le type 'new_message' pourtant
//     envoye par le serveur pour les messages voyageurs.
// Les deux premiers ont ete supprimes.
//
// Trois autres defauts corriges ici :
//   - l'initialisation etait retardee de 3 secondes : au demarrage a froid
//     (app fermee, notification tapee), l'evenement de clic arrive bien
//     avant et etait donc perdu ;
//   - rien ne vidait le tiroir de notifications : sur Android la pastille
//     du lanceur restait affichee tant qu'une notification y trainait ;
//   - le canal Android 'default' demande par le serveur n'existait pas,
//     donc le son et la priorite haute etaient ignores.
// ============================================================
(function () {
  console.log('[PUSH] Gestionnaire de notifications charge');
  const API_BASE = 'https://lcc-booking-manager.onrender.com';

  // ============================================
  // TABLE DE ROUTAGE — type de notification -> page
  // ============================================
  // Les types listes ici viennent de services/notifications-service.js et
  // services/pushNotificationService.js. Un type ajoute cote serveur doit
  // etre ajoute ici, sinon la notification tombe sur l'accueil.
  const ROUTES = {
    messages: ['new_message', 'new_chat_message', 'new_guest_message',
               'escalade', 'escalade_message', 'escalade_reminder',
               'chat_sms', 'sms_reply', 'template_failed'],
    calendar: ['new_reservation', 'new_booking', 'new_booking_channex',
               'cancelled_reservation', 'reservation_cancelled',
               'daily_arrivals', 'check_in', 'arrivals', 'departures',
               'reminder_j1'],
    cleaning: ['new_cleaning', 'cleaning_reminder', 'cleaning_assigned',
               'cleaning_completed', 'cleaning_validated', 'cleaning_recap',
               'cleaning_alert', 'cleaning_lastminute'],
    deposits: ['new_deposit', 'deposit_paid', 'deposit_captured',
               'caution', 'payment_received'],
    invoices: ['new_invoice']
  };

  function pageFor(data) {
    const type = (data && data.type) || '';
    // Les payloads serveur melangent snake_case et camelCase.
    const conv = (data && (data.conversation_id || data.conversationId)) || '';
    const cleaning = (data && (data.cleaning_id || data.cleaningId)) || '';

    if (ROUTES.messages.indexOf(type) !== -1 || data.screen === 'messages') {
      // ?conv= : c'est le parametre que lit chat-owner.js pour ouvrir
      // automatiquement la conversation. Surtout ne pas remettre ?open=.
      return conv ? '/messages.html?conv=' + conv : '/messages.html';
    }
    if (ROUTES.calendar.indexOf(type) !== -1) return '/app.html?view=calendar';
    if (ROUTES.cleaning.indexOf(type) !== -1) {
      return cleaning ? '/cleaning.html?checklist=' + cleaning : '/cleaning.html';
    }
    if (ROUTES.deposits.indexOf(type) !== -1) return '/deposits.html';
    if (ROUTES.invoices.indexOf(type) !== -1) return '/clients.html';

    // Un conversation_id sans type reconnu, c'est un message.
    if (conv) return '/messages.html?conv=' + conv;

    console.warn('[PUSH] Type inconnu, repli accueil :', type);
    return '/app.html';
  }

  function navigateFromNotification(data) {
    if (!data) return;
    const target = pageFor(data);
    console.log('[PUSH] Navigation ->', target, '| type:', data.type || '(aucun)');
    window.location.href = target;
  }

  // ============================================
  // BADGE ET TIROIR DE NOTIFICATIONS
  // ============================================
  // Le serveur n'envoie plus de valeur de badge : c'est l'app qui nettoie.
  // Appele au demarrage et a chaque retour d'arriere-plan.
  async function purgerNotifications() {
    const FM = getFirebaseMessaging();
    if (!FM) return;
    try {
      await FM.removeAllDeliveredNotifications();
      console.log('[PUSH] Tiroir de notifications vide');
    } catch (e) {
      console.warn('[PUSH] Purge impossible :', e.message);
    }
  }

  // Capacitor emet 'resume' sur document au retour d'arriere-plan ;
  // visibilitychange couvre les cas ou l'evenement natif manque.
  document.addEventListener('resume', purgerNotifications);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) purgerNotifications();
  });

  // ============================================
  // HISTORIQUE
  // ============================================
  async function logNotificationToHistory(title, body, type, data) {
    try {
      const jwt = localStorage.getItem('lcc_token');
      if (!jwt) return;
      await fetch(API_BASE + '/api/notifications/history/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ title: title || '', body: body || '', type: type || 'push', data: data || {} })
      });
    } catch (e) {
      console.warn('[PUSH] logNotificationToHistory:', e.message);
    }
  }

  // ============================================
  // PLATEFORME ET PLUGIN
  // ============================================
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
    const fcm = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseMessaging;
    if (!fcm) return null;
    return fcm;
  }

  // ============================================
  // JETON FCM
  // ============================================
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
            const token = parsed && (parsed.access_token
              || (parsed.session && parsed.session.access_token)
              || (parsed.data && parsed.data.session && parsed.data.session.access_token));
            if (token) return token;
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  function getOrCreateDeviceId() {
    try {
      let deviceId = localStorage.getItem('bh_device_id');
      if (!deviceId) {
        deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        localStorage.setItem('bh_device_id', deviceId);
      }
      return deviceId;
    } catch (e) { return null; }
  }

  async function saveTokenToServer(fcmToken, deviceType) {
    const deviceId = getOrCreateDeviceId();
    try {
      const jwt = await getSupabaseJwt();
      if (!jwt) {
        // Pas encore connecte : on reessaiera apres la connexion.
        try {
          localStorage.setItem('pending_fcm_token', fcmToken);
          localStorage.setItem('pending_device_type', deviceType);
        } catch (e) {}
        return;
      }
      const res = await fetch(API_BASE + '/api/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ token: fcmToken, device_type: deviceType, device_id: deviceId })
      });
      if (res.ok) {
        console.log('[PUSH] Jeton FCM enregistre');
        try {
          localStorage.removeItem('pending_fcm_token');
          localStorage.removeItem('pending_device_type');
        } catch (e) {}
      }
    } catch (err) {
      console.error('[PUSH] Erreur reseau enregistrement jeton :', err);
    }
  }

  async function retryPendingToken() {
    try {
      const pendingToken = localStorage.getItem('pending_fcm_token');
      const pendingDevice = localStorage.getItem('pending_device_type');
      if (pendingToken && pendingDevice) await saveTokenToServer(pendingToken, pendingDevice);
    } catch (e) {}
  }

  // ============================================
  // INITIALISATION
  // ============================================
  async function initPushNotifications() {
    if (window.__pushInitDone) return;
    window.__pushInitDone = true;

    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    const platform = cap.getPlatform ? cap.getPlatform() : null;
    if (platform !== 'ios' && platform !== 'android') return;

    const FirebaseMessaging = getFirebaseMessaging();
    if (!FirebaseMessaging) {
      console.error('[PUSH] Plugin FirebaseMessaging introuvable');
      return;
    }

    const deviceType = getDeviceType();

    // ── Les ecouteurs D'ABORD, sans aucun delai ──────────────
    // Au demarrage a froid, l'evenement de clic est emis dans les premieres
    // centaines de millisecondes : tout retard ici le perd.

    FirebaseMessaging.addListener('notificationReceived', function (notification) {
      const n = notification.notification || notification;
      const data = notification.data || (n && n.data) || {};
      const title = n.title || data.title || '';
      const body = n.body || data.body || '';
      const type = data.type || 'push';
      console.log('[PUSH] Notification recue (app ouverte) :', type);
      logNotificationToHistory(title, body, type, data);
      if (typeof window.initNotifBadge === 'function') setTimeout(window.initNotifBadge, 500);
    });

    FirebaseMessaging.addListener('notificationActionPerformed', function (action) {
      try {
        const data = (action && action.notification && action.notification.data)
          || (action && action.data) || {};
        console.log('[PUSH] Notification cliquee :', JSON.stringify(data));
        navigateFromNotification(data);
      } catch (e) {
        console.error('[PUSH] Erreur navigation :', e.message);
      }
    });

    FirebaseMessaging.addListener('tokenReceived', async function (result) {
      const fcmToken = result && result.token;
      if (fcmToken) {
        try { localStorage.setItem('fcm_token', fcmToken); } catch (e) {}
        await saveTokenToServer(fcmToken, deviceType);
      }
    });

    // ── Permission et jeton ──────────────────────────────────
    try {
      const perm = await FirebaseMessaging.requestPermissions();
      if (!perm || perm.receive !== 'granted') {
        console.warn('[PUSH] Permission refusee');
        return;
      }

      // Canal Android : doit porter le meme id que le channelId envoye par
      // le serveur ('default'), sinon Android 8+ retombe sur le canal par
      // defaut du plugin et ignore le son et la priorite demandes.
      if (platform === 'android') {
        try {
          await FirebaseMessaging.createChannel({
            id: 'default',
            name: 'Notifications',
            description: 'Messages, reservations et menages',
            importance: 5,
            visibility: 1
          });
        } catch (e) { console.warn('[PUSH] Canal Android :', e.message); }
      }

      const tokenResult = await FirebaseMessaging.getToken();
      const fcmToken = tokenResult && tokenResult.token;
      if (fcmToken) {
        try { localStorage.setItem('fcm_token', fcmToken); } catch (e) {}
        await saveTokenToServer(fcmToken, deviceType);
      }
    } catch (err) {
      console.error('[PUSH] Erreur initialisation :', err);
    }

    // Icone propre des l'ouverture.
    purgerNotifications();

    setTimeout(retryPendingToken, 2000);
  }

  window.retryFCMTokenSave = retryPendingToken;
  window.purgerNotifications = purgerNotifications;

  // Sans setTimeout : voir le commentaire des ecouteurs.
  initPushNotifications();
})();
