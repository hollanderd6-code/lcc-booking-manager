// sub-account-restrictions.js — Extracted from app.html
// ── Restrictions dashboard pour sous-comptes ──────────────────
(function() {
  const _accountType = localStorage.getItem('lcc_account_type');
  if (_accountType !== 'sub') return;

  let _userRole = '';
  let _perms = {};
  try {
    // Le rôle est dans lcc_sub_account (lcc_user est null pour les sous-comptes)
    const _subData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
    _userRole = _subData.role || '';
    // Les permissions sont dans lcc_sub_account.permissions
    // (lcc_permissions peut être absent ou vide pour les sous-comptes)
    const _lccp = JSON.parse(localStorage.getItem('lcc_permissions') || '{}');
    _perms = Object.keys(_lccp).length > 0 ? _lccp : (_subData.permissions || {});
  } catch(e) {}

  // Mapping KPI id → clé visible_kpis
  const KPI_MAP = {
    kpiPropertiesCard:  'kpi_properties',
    kpiTodayMovesCard:  'kpi_checkins',
    kpiCleaning48hCard: 'kpi_cleaning',
    kpiTopRisksCard:    'kpi_notes',
    kpiOccupancyCard:   'kpi_occupancy',
    kpiDepositsCard:    'kpi_deposits',
    kpiChecklistsCard:  'kpi_checklists',
    kpiCaCard:          'kpi_ca'
  };

  // KPI cachés par défaut pour tous les sous-comptes (sauf si explicitement autorisés)
  // Le CA est toujours masqué sauf si can_view_finances ET kpi_ca=true
  const visibleKpis = _perms.visible_kpis || {};

  function applyKpiRestrictions() {
    Object.keys(KPI_MAP).forEach(function(cardId) {
      var key = KPI_MAP[cardId];
      var el = document.getElementById(cardId);
      if (!el) return;

      // CA mensuel : double protection — can_view_finances ET kpi_ca
      if (cardId === 'kpiCaCard') {
        if (!_perms.can_view_finances || visibleKpis.kpi_ca !== true) {
          el.style.setProperty('display', 'none', 'important');
        }
        return;
      }

      // Cleaner : 4 KPI forcés visibles quelle que soit la config en DB
      const CLEANER_VISIBLE = ['kpiPropertiesCard','kpiTodayMovesCard','kpiCleaning48hCard','kpiTopRisksCard'];
      if (_userRole === 'cleaner') {
        if (!CLEANER_VISIBLE.includes(cardId)) {
          el.style.setProperty('display', 'none', 'important');
        }
        return; // ne pas appliquer la logique visibleKpis pour le cleaner
      }

      // Autres rôles : visible UNIQUEMENT si visible_kpis[key] === true explicitement
      // Par défaut (undefined ou false) = masqué pour les sous-comptes
      var shouldHide = (visibleKpis[key] !== true);
      if (shouldHide) {
        el.style.setProperty('display', 'none', 'important');
      }
    });

    // Masquer checklists widget si kpi_checklists !== true
    if (visibleKpis.kpi_checklists !== true) {
      var checklistWidget = document.querySelector('.cleaning-checklists-widget');
      if (checklistWidget) checklistWidget.style.display = 'none';
    }

    // Masquer bouton nouvelle réservation pour cleaner
    if (_userRole === 'cleaner') {
      var newResBtn = document.getElementById('newReservationBtn');
      if (newResBtn) newResBtn.style.display = 'none';
    }

    // Observer pour masquer les boutons créés dynamiquement
    var _btnObserver = new MutationObserver(function() {
      if (_userRole === 'cleaner') {
        var btn = document.getElementById('newReservationBtn');
        if (btn) btn.style.setProperty('display', 'none', 'important');
        var fab = document.getElementById('fabAddResa');
        if (fab) fab.style.setProperty('display', 'none', 'important');
      }
      // Re-appliquer les restrictions KPI si le DOM change
      Object.keys(KPI_MAP).forEach(function(cardId) {
        var key = KPI_MAP[cardId];
        var el = document.getElementById(cardId);
        if (!el) return;
        if (cardId === 'kpiCaCard' && (!_perms.can_view_finances || visibleKpis.kpi_ca !== true)) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    });
    _btnObserver.observe(document.body, { childList: true, subtree: true });
  }

  function applyCleanerRestrictions() {
    // Conservé pour compatibilité — maintenant géré dans applyKpiRestrictions
    if (_userRole === 'cleaner') {
      // Bloquer le clic sur les cellules vides du calendrier (openBlockModal)
      var origOpenBlockModal = window.openBlockModal;
      window.openBlockModal = function() { return; };

      // Bloquer le mousedown sur les booking-blocks (ouverture fiche réservation)
      document.addEventListener('mousedown', function(ev) {
        if (ev.target.closest && ev.target.closest('.booking-block')) {
          ev.stopImmediatePropagation();
          ev.preventDefault();
        }
      }, true);
    }

    // Faux début de bloc pour maintenir la compatibilité avec le code suivant

    // Bloquer aussi le touchstart pour mobile
    document.addEventListener('touchstart', function(ev) {
      if (ev.target.closest && ev.target.closest('.booking-block')) {
        ev.stopImmediatePropagation();
      }
      if (ev.target.closest && ev.target.closest('.calendar-cell')) {
        ev.stopImmediatePropagation();
      }
    }, true);

    // Curseur non-cliquable sur le calendrier
    var style = document.getElementById('cleaner-restrictions-css');
    if (style) {
      style.textContent += ' .calendar-cell, .booking-block { cursor: default !important; pointer-events: none !important; }';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyKpiRestrictions();
      applyCleanerRestrictions();
    });
  } else {
    applyKpiRestrictions();
    applyCleanerRestrictions();
  }
})();
