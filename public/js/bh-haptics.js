// ============================================================
// 📳 BH HAPTICS — retour haptique (app Capacitor uniquement)
// No-op silencieux sur web/desktop : aucun risque hors app.
// Règles de sobriété :
//   • impact léger  : boutons d'action, onglets de la bottom bar
//   • impact moyen  : boutons primaires (encaisser, valider, envoyer)
//   • notification  : toasts succès / erreur
// ============================================================
(function () {
  'use strict';

  function plugin() {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform
          && window.Capacitor.isNativePlatform()
          && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
        return window.Capacitor.Plugins.Haptics;
      }
    } catch (e) { /* jamais bloquant */ }
    return null;
  }

  var derniere = 0;
  function tap(style) {
    var h = plugin();
    if (!h) return;
    var now = Date.now();
    if (now - derniere < 80) return;   // anti-mitraillette
    derniere = now;
    try { h.impact({ style: style }); } catch (e) {}
  }
  function notif(type) {
    var h = plugin();
    if (!h) return;
    try { h.notification({ type: type }); } catch (e) {}
  }

  // ── Délégation : un seul écouteur pour toute l'app ──
  document.addEventListener('click', function (e) {
    var el = e.target.closest(
      'button, [role="button"], .mobile-tabs a, .btn, [data-haptic]'
    );
    if (!el || el.disabled) return;
    if (el.closest('[data-no-haptic]')) return;
    // primaire = action forte -> retour plus net
    var fort = el.matches('.btn-primary, [type="submit"], [data-haptic="medium"]')
      || /encaisser|valider|envoyer|payer|confirmer/i.test(el.textContent || '');
    tap(fort ? 'MEDIUM' : 'LIGHT');
  }, { capture: true, passive: true });

  // ── Toasts : vibration de notification ──
  var attend = setInterval(function () {
    if (!window.showBHToast) return;
    clearInterval(attend);
    var original = window.showBHToast;
    window.showBHToast = function (message, type) {
      var t = String(type || '').toLowerCase();
      if (t === 'success' || t === 'ok') notif('SUCCESS');
      else if (t === 'error' || t === 'err' || t === 'danger') notif('ERROR');
      else if (t === 'warning') notif('WARNING');
      return original(message, type);
    };
  }, 300);
  setTimeout(function () { clearInterval(attend); }, 10000);
})();
