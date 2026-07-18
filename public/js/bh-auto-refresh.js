// ============================================================
// 🔄 ACTUALISATION AU RETOUR DE L'APP
// Quand l'app revient au premier plan après ≥ 60 s en arrière-plan
// (notification poussée → ouverture, retour depuis une autre app),
// on recharge silencieusement les données de la page courante.
// Chaque page déclare son rafraîchisseur ; pas de reload brut
// (aucun risque de perdre une saisie en cours).
// ============================================================
(function () {
  'use strict';

  // Rafraîchisseurs par page — uniquement des loaders idempotents connus.
  var REFRESHERS = {
    'messages':      function () { if (window.loadConversations) window.loadConversations(); },
    'reservations':  function () { if (window.loadData) window.loadData(); },
    'deposits':      function () {
      if (window.loadReservationsWithDeposits) window.loadReservationsWithDeposits();
      if (window.loadPayments) window.loadPayments(true);
    },
    'app':           function () { if (window.loadReservations) window.loadReservations(); },
    'dashboard':     function () { if (window.loadReservations) window.loadReservations(); },
  };

  function pageKey() {
    var p = (location.pathname.split('/').pop() || 'app').replace('.html', '');
    return document.body?.getAttribute('data-page') || p;
  }

  var hiddenAt = null;

  function surRetour() {
    if (document.visibilityState !== 'visible') return;
    var absent = hiddenAt ? (Date.now() - hiddenAt) : 0;
    hiddenAt = null;
    if (absent < 60000) return;                    // absences courtes : rien
    if (document.querySelector('.modal-overlay.active, #invoiceModal.active, #templateModal[style*="flex"]')) return; // saisie possible en cours
    var fn = REFRESHERS[pageKey()];
    if (fn) {
      try { fn(); console.log('🔄 [AUTO-REFRESH] Données rechargées (' + pageKey() + ')'); }
      catch (e) { console.warn('🔄 [AUTO-REFRESH]', e.message); }
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else surRetour();
  });
  document.addEventListener('resume', surRetour);   // événement Capacitor
})();
