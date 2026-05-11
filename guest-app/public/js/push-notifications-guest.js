// push-notifications-guest.js
// Gestion des notifications push côté BHGuest
// Utilise Firebase Cloud Messaging + session guest (guest_session)
(function () {
  'use strict';
  console.log('🔔 [GUEST PUSH] Handler chargé');

  const API_BASE = window.location.origin;

  // ── Récupérer le JWT guest depuis localStorage ────────────────
  function getGuestToken() {
    try {
      const raw = localStorage.getItem('guest_session');
      if (!raw) return null;
      const session = JSON.parse(raw);
      return session?.token || null;
    } catch { return null; }
  }

  // ── Générer/récupérer un device_id unique ────────────────────
  function getOrCreateDeviceId() {
    try {
      let id = localStorage.getItem('bh_guest_device_id');
      if (!id) {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        localStorage.setItem('bh_guest_device_id', id);
      }
      return id;
    } catch { return null; }
  }

  // ── Enregistrer le token FCM pour une conversation ───────────
  async function registerGuestToken(fcmToken, conversationId) {
    const jwt = getGuestToken();
    if (!jwt || !conversationId) return;

    const cap = window.Capacitor;
    const platform = cap?.getPlatform?.() || 'web';
    const deviceType = platform === 'ios' ? 'ios' : platform === 'android' ? 'android' : 'web';

    try {
      const res = await fetch(`${API_BASE}/api/chat/register-guest-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          fcm_token: fcmToken,
          device_type: deviceType
        })
      });
      if (res.ok) {
        console.log(`✅ [GUEST PUSH] Token enregistré pour conv ${conversationId}`);
        // Mémoriser le token pour les nouvelles conversations
        try { localStorage.setItem('guest_fcm_token', fcmToken); } catch {}
      }
    } catch(e) {
      console.warn('⚠️ [GUEST PUSH] Erreur enregistrement token:', e.message);
    }
  }

  // ── Enregistrer pour toutes les conversations actives ─────────
  async function registerForAllConversations(fcmToken) {
    const jwt = getGuestToken();
    if (!jwt) return;
    try {
      const res = await fetch(`${API_BASE}/api/guest/conversations`, {
        headers: { 'Authorization': 'Bearer ' + jwt }
      });
      if (!res.ok) return;
      const data = await res.json();
      const convs = data.conversations || [];
      for (const conv of convs) {
        await registerGuestToken(fcmToken, conv.id);
      }
      console.log(`✅ [GUEST PUSH] Token enregistré pour ${convs.length} conversation(s)`);
    } catch(e) {
      console.warn('⚠️ [GUEST PUSH] Erreur fetch conversations:', e.message);
    }
  }

  // ── Init push notifications ──────────────────────────────────
  async function initGuestPush() {
    if (window.__guestPushInitDone) return;
    window.__guestPushInitDone = true;

    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) {
      console.log('🌐 [GUEST PUSH] Pas en natif — push ignoré');
      return;
    }

    const platform = cap.getPlatform?.();
    if (platform !== 'ios' && platform !== 'android') return;

    const FCM = cap?.Plugins?.FirebaseMessaging;
    if (!FCM) {
      console.error('❌ [GUEST PUSH] Plugin FirebaseMessaging introuvable');
      return;
    }

    // Listener : notif reçue en foreground
    FCM.addListener('notificationReceived', function(notification) {
      const n = notification.notification || notification;
      const title = n.title || notification.data?.title || '';
      const body  = n.body  || notification.data?.body  || '';
      const convId = notification.data?.conversation_id;
      console.log(`📩 [GUEST PUSH] Notif reçue: ${title} — conv ${convId}`);

      // Si le voyageur est dans le bon chat → pas de notif (déjà visible)
      if (convId && window.currentGuestConvId && String(convId) === String(window.currentGuestConvId)) {
        return;
      }

      // Mettre à jour le badge messages
      if (typeof window.updateGuestMsgBadge === 'function') {
        window.updateGuestMsgBadge(1);
      }
    });

    // Listener : tap sur une notif
    FCM.addListener('notificationActionPerformed', function(action) {
      const convId = action.notification?.data?.conversation_id;
      console.log(`👉 [GUEST PUSH] Tap notif, conv ${convId}`);
      if (convId && typeof window.openGuestChat === 'function') {
        window.openGuestChat(parseInt(convId), '', '', '');
      }
    });

    // Listener : token renouvelé
    FCM.addListener('tokenReceived', async function(result) {
      const token = result?.token;
      if (token) {
        console.log('🔑 [GUEST PUSH] Token renouvelé');
        try { localStorage.setItem('guest_fcm_token', token); } catch {}
        await registerForAllConversations(token);
      }
    });

    // Demander la permission
    try {
      const perm = await FCM.requestPermissions();
      if (perm?.receive !== 'granted') {
        console.warn('⚠️ [GUEST PUSH] Permission refusée');
        return;
      }

      const result = await FCM.getToken();
      const token = result?.token;
      if (token) {
        console.log('✅ [GUEST PUSH] Token obtenu:', token.substring(0, 20) + '...');
        try { localStorage.setItem('guest_fcm_token', token); } catch {}
        await registerForAllConversations(token);
      }
    } catch(e) {
      console.error('❌ [GUEST PUSH] Erreur init:', e.message);
    }
  }

  // ── API publique ─────────────────────────────────────────────
  // Appelée depuis app-guest.js quand on ouvre un chat
  window.registerGuestFCMForConv = async function(conversationId) {
    const token = localStorage.getItem('guest_fcm_token');
    if (token && conversationId) {
      await registerGuestToken(token, conversationId);
    }
  };

  // Démarrer après 2s (laisser Capacitor s'initialiser)
  setTimeout(initGuestPush, 2000);

})();
