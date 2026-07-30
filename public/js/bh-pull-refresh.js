// ============================================================
// ⟳ PULL-TO-REFRESH — listes mobiles (app native + Safari)
// Tirer vers le bas en haut de page recharge la vue courante,
// sans reload brut : on rappelle le loader connu de la page.
// ============================================================
(function () {
  'use strict';
  if (!('ontouchstart' in window)) return;

  // Rafraîchisseurs par page (loaders idempotents déjà exposés en global)
  function refresher() {
    var p = (location.pathname.split('/').pop() || '').replace('.html', '');
    if (p === 'messages')     return window.loadConversations;
    if (p === 'reservations') return window.loadData;
    if (p === 'deposits')     return function () {
      if (window.loadReservationsWithDeposits) window.loadReservationsWithDeposits();
      if (window.loadPayments) window.loadPayments(true);
    };
    if (p === 'app')          return window.loadReservations;
    if (p === 'cleaning')     return window.loadCleaningData || window.loadData;
    if (p === 'smart-locks')  return window.loadLocks || window.syncLocks;
    return null;
  }

  // Indicateur
  var ind = document.createElement('div');
  ind.id = 'bh-ptr';
  ind.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 6px);left:50%;'
    + 'width:36px;height:36px;margin-left:-18px;border-radius:50%;background:#FAF7F2;'
    + 'border:1px solid rgba(200,184,154,.5);box-shadow:0 6px 18px rgba(13,17,23,.16);'
    + 'display:flex;align-items:center;justify-content:center;z-index:100003;'
    + 'transform:translateY(-60px);transition:transform .18s ease,opacity .18s;opacity:0;';
  ind.innerHTML = '<i class="fas fa-arrow-down" style="color:#0E3B2E;font-size:14px;transition:transform .2s;"></i>';
  document.body.appendChild(ind);
  var fleche = ind.querySelector('i');

  var y0 = null, tirage = 0, armed = false, refreshing = false;
  var SEUIL = 72;

  function scrollHaut() {
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  }
  function bloque() {
    return refreshing
      || document.querySelector('.bh-sheet-panel, .modal.active, .modal-overlay.active, .checklist-modal-overlay.active, #checklistModal.active, #bhLightbox, #bh-tab-shortcuts')
      || document.querySelector('.mobile-tabs.lg-dragging');
  }

  document.addEventListener('touchstart', function (e) {
    if (!scrollHaut() || bloque()) { y0 = null; return; }
    y0 = e.touches[0].clientY; tirage = 0;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (y0 == null) return;
    tirage = e.touches[0].clientY - y0;
    if (tirage <= 0) { ind.style.transform = 'translateY(-60px)'; ind.style.opacity = '0'; return; }
    var d = Math.min(tirage, 110);
    ind.style.opacity = Math.min(1, d / SEUIL);
    ind.style.transform = 'translateY(' + Math.min(d - 30, 56) + 'px)';
    var maintenant = d >= SEUIL;
    if (maintenant !== armed) {
      armed = maintenant;
      fleche.style.transform = armed ? 'rotate(180deg)' : 'rotate(0deg)';
      if (armed && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics) {
        try { Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' }); } catch (e) {}
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (y0 == null) return;
    y0 = null;
    if (armed && !bloque()) {
      var fn = refresher();
      refreshing = true; armed = false;
      fleche.className = 'fas fa-spinner fa-spin';
      fleche.style.color = '#0E3B2E';
      ind.style.transform = 'translateY(52px)'; ind.style.opacity = '1';
      Promise.resolve().then(function () { if (fn) return fn(); })
        .catch(function () {})
        .finally(function () {
          setTimeout(function () {
            ind.style.transform = 'translateY(-60px)'; ind.style.opacity = '0';
            setTimeout(function () { fleche.className = 'fas fa-arrow-down'; fleche.style.transform = 'rotate(0deg)'; }, 200);
            refreshing = false;
          }, 550);
        });
    } else {
      ind.style.transform = 'translateY(-60px)'; ind.style.opacity = '0';
      armed = false; fleche.style.transform = 'rotate(0deg)';
    }
  });
})();
