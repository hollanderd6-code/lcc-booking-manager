// host-push.js — Push natif pour l'espace hôte BHGuest
// Chargé sur les pages hôte. En natif (Capacitor), demande la permission,
// récupère le token FCM et l'associe au compte hôte connecté.
// Sur le web : ne fait rien (l'email différé prend le relais).
(function () {
  'use strict';

  var API_BASE = window.location.origin;

  function getHostToken() {
    try { return localStorage.getItem('bhguest_host_token'); } catch { return null; }
  }

  async function registerToken(fcmToken) {
    var jwt = getHostToken();
    if (!jwt || !fcmToken) return;
    var cap = window.Capacitor;
    var platform = (cap && cap.getPlatform && cap.getPlatform()) || 'web';
    try {
      var res = await fetch(API_BASE + '/api/host/push/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ fcm_token: fcmToken, device_type: platform })
      });
      if (res.ok) {
        console.log('✅ [HOST PUSH] Token enregistré');
        try { localStorage.setItem('bhguest_host_fcm_registered', fcmToken); } catch {}
      }
    } catch (e) {
      console.warn('⚠️ [HOST PUSH] Enregistrement:', e.message);
    }
  }

  async function init() {
    if (window.__hostPushInitDone) return;
    window.__hostPushInitDone = true;

    if (!getHostToken()) return; // pas connecté en hôte

    var cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
      console.log('🌐 [HOST PUSH] Pas en natif — push ignoré');
      return;
    }
    var FCM = cap.Plugins && cap.Plugins.FirebaseMessaging;
    if (!FCM) { console.warn('❌ [HOST PUSH] Plugin FirebaseMessaging introuvable'); return; }

    // Tap sur une notif de message → ouvrir la messagerie
    try {
      FCM.addListener('notificationActionPerformed', function (action) {
        var d = action && action.notification && action.notification.data;
        if (!d) return;
        if (d.type === 'host_new_message') location.href = 'host-messages.html';
        else if (d.type === 'new_booking') location.href = 'host-reservations.html';
      });
      // Token renouvelé par Firebase → ré-enregistrer
      FCM.addListener('tokenReceived', function (result) {
        if (result && result.token) registerToken(result.token);
      });
    } catch (e) {}

    try {
      var perm = await FCM.requestPermissions();
      if (!perm || perm.receive !== 'granted') {
        console.warn('⚠️ [HOST PUSH] Permission refusée');
        return;
      }
      var result = await FCM.getToken();
      var token = result && result.token;
      if (!token) return;
      // Ne ré-enregistrer que si le token a changé (évite un POST à chaque page)
      var known = null;
      try { known = localStorage.getItem('bhguest_host_fcm_registered'); } catch {}
      if (known !== token) await registerToken(token);
    } catch (e) {
      console.warn('⚠️ [HOST PUSH] Init:', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
