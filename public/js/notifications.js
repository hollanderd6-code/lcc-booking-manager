/* notifications.js (vanilla script - PAS de 'export')
 * Compatible avec <script src="/js/notifications.js"></script>
 * Capacitor Push Notifications (iOS/Android)
 *
 * Notes:
 * - iOS: l'événement 'registration' renvoie généralement un token APNS (pas FCM).
 * - Android: token FCM.
 * - On envoie le token au backend pour l'associer à l'utilisateur/appareil.
 */

(function () {
  'use strict';

  var __pushInitDone = false;

  function log() {
    try { console.log.apply(console, arguments); } catch (_) {}
  }
  function warn() {
    try { console.warn.apply(console, arguments); } catch (_) {}
  }
  function err() {
    try { console.error.apply(console, arguments); } catch (_) {}
  }

  async function safeJson(res) {
    try { return await res.json(); } catch (_) { return {}; }
  }

  async function postJson(url, body) {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {})
    });

    if (!res.ok) {
      var txt = '';
      try { txt = await res.text(); } catch (_) {}
      throw new Error(('HTTP ' + res.status + ' ' + res.statusText + ' ' + txt).trim());
    }
    return safeJson(res);
  }

  async function saveTokenToBackend(token, platform) {
    // IMPORTANT: adapte l'URL si ton backend attend un autre endpoint
    // (j'ai gardé celui qui existait dans ton fichier précédent).
    return postJson('/api/save-token', {
      token: token,
      platform: platform || 'unknown',
      ts: Date.now()
    });
  }

  async function initPushNotifications() {
    if (__pushInitDone) return;
    __pushInitDone = true;

    var cap = window && window.Capacitor;
    var PushNotifications = cap && cap.Plugins && cap.Plugins.PushNotifications;

    if (!cap || !PushNotifications) {
      warn('🔕 PushNotifications non dispo (pas dans l’app native ? plugin absent ?).', { hasCapacitor: !!cap, hasPlugin: !!PushNotifications });
      return;
    }

    // Platform
    var platform = (cap.getPlatform && cap.getPlatform()) || 'unknown';
    log('📱 Push init (platform=' + platform + ')');

    // Listeners
    PushNotifications.addListener('registration', function (token) {
      // token.value contient la valeur (APNS sur iOS / FCM sur Android)
      log('✅ Push registration token:', token && token.value ? token.value : token);

      // Envoi au backend
      saveTokenToBackend(token && token.value ? token.value : token, platform)
        .then(function (r) { log('📨 Token sauvegardé côté serveur:', r); })
        .catch(function (e) { err('❌ Erreur sauvegarde token:', e); });
    });

    PushNotifications.addListener('registrationError', function (error) {
      err('❌ Push registrationError:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', function (notification) {
      log('🔔 pushNotificationReceived:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', function (notification) {
      log('👉 pushNotificationActionPerformed:', notification);
    });

    // Permissions
    try {
      var permStatus = await PushNotifications.checkPermissions();
      log('🔎 checkPermissions:', permStatus);

      if (permStatus && permStatus.receive !== 'granted') {
        log('📱 Demande permission notifications...');
        permStatus = await PushNotifications.requestPermissions();
        log('📝 requestPermissions:', permStatus);
      }

      if (permStatus && permStatus.receive === 'granted') {
        log('📌 Permission accordée, register()...');
        await PushNotifications.register();
        log('🟢 register() appelé (attends l’événement registration)');
      } else {
        warn('🚫 Permission notifications refusée ou indéterminée:', permStatus);
      }
    } catch (e) {
      err('❌ Erreur init push:', e);
    }
  }

  // Expose global (pour pouvoir appeler depuis d’autres scripts)
  window.initPushNotifications = initPushNotifications;

  // Auto-init
  document.addEventListener('DOMContentLoaded', function () {
    initPushNotifications();
  });
})();
