// ============================================================
// ☀️ BH-TODAY-V3 — iOS-parity Today page (TodayView.swift)
// Fetches /api/aujourdhui/etats and /api/cleaning/assignments,
// renders counters, week strip, urgent cards, arrivals, departures
// and cleaning rows with the Boostinghost iOS design language.
// ============================================================
'use strict';
(function () {

  var API = (typeof window.API_URL !== 'undefined' ? window.API_URL : 'https://lcc-booking-manager.onrender.com');

  // ── Helpers ─────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function agencyQS() {
    try {
      if (!localStorage.getItem('lcc_agency_token') &&
          localStorage.getItem('bh_agency_view') === 'all') {
        return '?agency=all';
      }
    } catch (e) {}
    return '';
  }

  // ── Platform helpers (mirrors Palette.swift) ────────────────────────────

  function normPlat(p) {
    return (p || '').toLowerCase().replace(/[ _]/g, '');
  }

  var PLAT_COLORS = {
    airbnb: '#FF5A5F',
    booking: '#003580', bookingcom: '#003580',
    expedia: '#FFC72C', expediacom: '#FFC72C',
    vrbo: '#1A5276',
    direct: '#0E3B2E', manuel: '#0E3B2E', manual: '#0E3B2E',
    block: '#9CA3AF', blocked: '#9CA3AF', bloque: '#9CA3AF'
  };

  var PLAT_LABELS = {
    airbnb: 'Airbnb',
    booking: 'Booking.com', bookingcom: 'Booking.com',
    expedia: 'Expedia', expediacom: 'Expedia',
    vrbo: 'Vrbo',
    direct: 'Direct', manuel: 'Direct', manual: 'Direct',
    block: 'Bloqué', blocked: 'Bloqué', bloque: 'Bloqué'
  };

  function platColor(p) {
    var k = normPlat(p);
    if (k.indexOf('bhguest') !== -1 || k.indexOf('guestapp') !== -1) return '#A8452A';
    return PLAT_COLORS[k] || '#9CA3AF';
  }

  function platLabel(p) {
    var k = normPlat(p);
    if (k.indexOf('bhguest') !== -1 || k.indexOf('guestapp') !== -1) return 'BH Guest';
    if (PLAT_LABELS[k]) return PLAT_LABELS[k];
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : '—';
  }

  // ── Blocking helpers (mirrors TodayView.swift) ──────────────────────────

  function blockingLabel(m) {
    var MAP = {
      pas_de_conversation: 'Pas de conversation',
      ia_a_passe_la_main: 'IA a passé la main',
      message_non_lu: 'Message non lu',
      code_acces_manquant: "Code d'accès manquant",
      reservation_non_confirmee: 'Non confirmée'
    };
    return MAP[m] || null;
  }

  function primaryAction(blocking) {
    if (blocking.indexOf('pas_de_conversation') !== -1) return 'Créer une conversation';
    if (blocking.indexOf('code_acces_manquant') !== -1) return 'Envoyer les codes';
    return 'Voir la réservation';
  }

  function nightsLabel(n) {
    if (!n || n < 1) return null;
    return n === 1 ? '1 nuit' : n + ' nuits';
  }

  // ── HTML components ──────────────────────────────────────────────────────

  function platformBadgeHTML(platform) {
    var color = platColor(platform);
    var label = platLabel(platform);
    return '<span class="bh-tv3-platform" style="background:' + color + ';">' + esc(label) + '</span>';
  }

  function pillHTML(text, style) {
    return '<span class="bh-tv3-pill bh-tv3-pill-' + esc(style) + '">' + esc(text) + '</span>';
  }

  function metaSepHTML(parts) {
    var valid = parts.filter(Boolean);
    if (!valid.length) return '';
    return valid.map(function (p) {
      return '<span>' + esc(p) + '</span>';
    }).join('<span class="bh-tv3-meta-sep"> · </span>');
  }

  // UrgentArrivalCard
  function urgentCardHTML(a) {
    var blocking = a.blocking || [];
    var action   = primaryAction(blocking);
    var labels   = blocking.map(blockingLabel).filter(Boolean).slice(0, 2);
    var convId   = a.conversation_id;

    var pills = labels.map(function (l) { return pillHTML(l, 'terracotta'); }).join('');

    var meta = metaSepHTML([
      a.property_name || null,
      a.arrival_time  || null,
      nightsLabel(a.nights)
    ]);

    var uid = esc(a.reservation_uid || '');

    var primaryBtn = '<button class="bh-tv3-btn-primary" '
      + 'onclick="bhTv3Action(\'' + uid + '\',\'' + esc(action) + '\')">'
      + esc(action) + '</button>';

    var writeBtn = convId
      ? '<a href="/messages.html?bhconv=' + encodeURIComponent(String(convId)) + '" '
        + 'class="bh-tv3-btn-glass">'
        + '<i class="fas fa-comment" style="font-size:11px;"></i> Écrire</a>'
      : '';

    return '<div class="bh-tv3-urgent-card">'
      + '<div class="bh-tv3-urgent-bar"></div>'
      + '<div class="bh-tv3-urgent-content">'
        + '<div class="bh-tv3-urgent-row1">'
          + '<span class="bh-tv3-guest-name">' + esc(a.guest_name || 'Voyageur') + '</span>'
          + pills
          + '<span style="flex:1;min-width:4px;"></span>'
          + platformBadgeHTML(a.platform)
        + '</div>'
        + (meta ? '<div class="bh-tv3-urgent-row2">' + meta + '</div>' : '')
        + '<div class="bh-tv3-urgent-row3">' + primaryBtn + writeBtn + '</div>'
      + '</div>'
    + '</div>';
  }

  // ArrivalCard (blocking empty)
  function arrivalCardHTML(a) {
    var meta = metaSepHTML([
      a.property_name || null,
      a.arrival_time  || null,
      nightsLabel(a.nights)
    ]);
    var uid = esc(a.reservation_uid || '');
    return '<div class="bh-tv3-arrival-card" onclick="bhTv3OpenResa(\'' + uid + '\')">'
      + '<div class="bh-tv3-card-row1">'
        + '<div class="bh-tv3-card-info">'
          + '<div class="bh-tv3-card-name">' + esc(a.guest_name || 'Voyageur') + '</div>'
          + (meta ? '<div class="bh-tv3-card-meta">' + meta + '</div>' : '')
        + '</div>'
        + platformBadgeHTML(a.platform)
      + '</div>'
    + '</div>';
  }

  // DepartCard
  function departureCardHTML(d) {
    var meta = metaSepHTML([
      d.property_name   || null,
      d.departure_time  || null,
      nightsLabel(d.nights)
    ]);
    var uid = esc(d.reservation_uid || '');
    return '<div class="bh-tv3-departure-card" onclick="bhTv3OpenResa(\'' + uid + '\')">'
      + '<div class="bh-tv3-card-row1">'
        + '<div class="bh-tv3-card-info">'
          + '<div class="bh-tv3-card-name">' + esc(d.guest_name || 'Voyageur') + '</div>'
          + (meta ? '<div class="bh-tv3-card-meta">' + meta + '</div>' : '')
        + '</div>'
        + platformBadgeHTML(d.platform)
      + '</div>'
    + '</div>';
  }

  // CleaningRow
  function cleaningRowHTML(a) {
    var name     = a.resolvedPropertyName || a.resolved_property_name || a.propertyName || a.property_name || '—';
    var cleaner  = a.cleanerName || a.cleaner_name || '';
    var wStart   = a.windowStart || a.window_start || '';
    var wEnd     = a.windowEnd   || a.window_end   || '';
    var timeStr  = (wStart && wEnd) ? wStart + ' – ' + wEnd : '';

    return '<div class="bh-tv3-cleaning-row">'
      + '<div class="bh-tv3-cleaning-info">'
        + '<div class="bh-tv3-cleaning-name">' + esc(name) + '</div>'
        + (cleaner ? '<div class="bh-tv3-cleaning-cleaner">' + esc(cleaner) + '</div>' : '')
      + '</div>'
      + (timeStr ? '<div class="bh-tv3-cleaning-time">' + esc(timeStr) + '</div>' : '')
    + '</div>';
  }

  // ── Counter strip ────────────────────────────────────────────────────────

  function countersHTML(compteurs, urgentCount) {
    function card(num, label, iconCls, urgent) {
      var cls = 'bh-tv3-counter-card' + (urgent ? ' urgent' : '');
      return '<div class="' + cls + '">'
        + '<i class="' + iconCls + ' bh-tv3-counter-icon"></i>'
        + '<div class="bh-tv3-counter-num">' + num + '</div>'
        + '<div class="bh-tv3-counter-label">' + label + '</div>'
      + '</div>';
    }
    return card(compteurs.arrivees || 0, 'Arrivées',  'fas fa-arrow-right-to-bracket', false)
         + card(compteurs.departs  || 0, 'Départs',   'fas fa-arrow-right-from-bracket', false)
         + card(urgentCount,             'À traiter', 'fas fa-exclamation-triangle', urgentCount > 0);
  }

  // ── Week strip (calendarStrip in TodayView.swift) ────────────────────────

  var FR_ABBREV = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  var FR_MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin',
                   'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  function weekStripHTML(compteurs, cleaningCount) {
    var today = new Date();
    var days  = [];
    for (var i = -3; i <= 3; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      days.push(d);
    }

    // Build unique month names: "SEPTEMBRE · OCTOBRE"
    var seenM = {}, monthNames = [];
    days.forEach(function (d) {
      var m = d.getMonth();
      if (!seenM[m]) { seenM[m] = true; monthNames.push(FR_MONTHS[m].toUpperCase()); }
    });

    var cellsHTML = days.map(function (d) {
      var isTod = d.getDate() === today.getDate()
               && d.getMonth() === today.getMonth()
               && d.getFullYear() === today.getFullYear();

      var dots = '';
      if (isTod) {
        if ((compteurs.arrivees || 0) > 0) dots += '<span class="bh-tv3-dot bh-tv3-dot-occupe"></span>';
        if ((compteurs.departs  || 0) > 0) dots += '<span class="bh-tv3-dot bh-tv3-dot-depart"></span>';
        if (cleaningCount > 0)             dots += '<span class="bh-tv3-dot bh-tv3-dot-menage"></span>';
      }

      return '<div class="bh-tv3-day-cell' + (isTod ? ' today' : '') + '">'
        + '<span class="bh-tv3-day-abbr">' + FR_ABBREV[d.getDay()] + '</span>'
        + '<span class="bh-tv3-day-num">'  + d.getDate() + '</span>'
        + '<div class="bh-tv3-day-dots">' + dots + '</div>'
      + '</div>';
    }).join('');

    return '<div class="bh-tv3-week-header">'
      + '<span class="bh-tv3-week-month">' + monthNames.join(' · ') + '</span>'
      + '<a href="/reservations.html" class="bh-tv3-week-nav" title="Voir le calendrier">'
        + '<i class="fas fa-chevron-right" style="font-size:10px;"></i></a>'
    + '</div>'
    + '<div class="bh-tv3-week-days">' + cellsHTML + '</div>'
    + '<div class="bh-tv3-week-legend">'
      + '<div class="bh-tv3-legend-item"><span class="bh-tv3-legend-dot" style="background:#2E8B62;"></span>Occupé</div>'
      + '<div class="bh-tv3-legend-item"><span class="bh-tv3-legend-dot" style="background:#E8B48A;"></span>Départ</div>'
      + '<div class="bh-tv3-legend-item"><span class="bh-tv3-legend-dot" style="background:#C9A15B;"></span>Ménage</div>'
    + '</div>';
  }

  // ── Show / hide section ──────────────────────────────────────────────────

  function showSection(sectionId, listId, html) {
    var sec  = $(sectionId);
    var list = $(listId);
    if (!sec || !list) return;
    if (html) {
      list.innerHTML = html;
      sec.style.display = '';
    } else {
      sec.style.display = 'none';
    }
  }

  // ── Open reservation (wires Today cards → existing detail modal) ─────────

  window.bhTv3OpenResa = function (uid) {
    var resas = window.LCC_RESERVATIONS || [];
    var r = null;
    for (var i = 0; i < resas.length; i++) {
      var rx = resas[i];
      if (String(rx.uid || rx.id || '') === String(uid)) { r = rx; break; }
    }
    if (r) {
      window.currentBookingData = r;
      window.currentBooking = r;
      if (typeof window.openBooking === 'function') { window.openBooking(r); return; }
      if (typeof window.fixModalContent === 'function') {
        var fake = document.createElement('div');
        fake.dataset.bookingId = String(r.id || '');
        window.fixModalContent(fake);
      }
    } else {
      // Reservation not cached yet — open modal; it will load via API inside fixModalContent
      var modal = $('reservationDetailsModal');
      if (modal) modal.style.display = 'flex';
    }
  };

  window.bhTv3Action = function (uid, action) {
    if (action === 'Créer une conversation') {
      window.location.href = '/messages.html';
    } else {
      window.bhTv3OpenResa(uid);
    }
  };

  // ── Main load ────────────────────────────────────────────────────────────

  function loadToday() {
    var qs = agencyQS();

    Promise.all([
      fetch(API + '/api/aujourdhui/etats' + qs).then(function (r) { return r.json(); }),
      fetch(API + '/api/cleaning/assignments' + qs).then(function (r) {
        return r.ok ? r.json() : { assignments: [] };
      }).catch(function () { return { assignments: [] }; })
    ]).then(function (results) {
      var todayData    = results[0];
      var cleaningData = results[1];

      var today     = todayStr();
      var arrivees  = todayData.arrivees  || [];
      var departs   = todayData.departs   || [];
      var compteurs = todayData.compteurs || {};

      // Filter cleaning for today
      var assignments = (cleaningData.assignments || []).filter(function (a) {
        var key = a.reservationKey || a.reservation_key || '';
        if (!key || key.length < 10) return false;
        var suffix = key.slice(-10);
        return /^\d{4}-\d{2}-\d{2}$/.test(suffix) && suffix === today;
      });

      var urgentArrivees = arrivees.filter(function (a) { return a.blocking && a.blocking.length > 0; });
      var normalArrivees = arrivees.filter(function (a) { return !a.blocking || a.blocking.length === 0; });

      // Counters strip
      var countersEl = $('bhTv3Counters');
      if (countersEl) countersEl.innerHTML = countersHTML(compteurs, urgentArrivees.length);

      // Week strip
      var weekEl = $('bhTv3WeekCard');
      if (weekEl) weekEl.innerHTML = weekStripHTML(compteurs, assignments.length);

      // Sections
      showSection('bhTv3UrgentSection', 'bhTv3UrgentList',
        urgentArrivees.length ? urgentArrivees.map(urgentCardHTML).join('') : '');

      showSection('bhTv3ArrivalsSection', 'bhTv3ArrivalsList',
        normalArrivees.length ? normalArrivees.map(arrivalCardHTML).join('') : '');

      showSection('bhTv3DeparturesSection', 'bhTv3DeparturesList',
        departs.length ? departs.map(departureCardHTML).join('') : '');

      showSection('bhTv3CleaningSection', 'bhTv3CleaningList',
        assignments.length ? assignments.map(cleaningRowHTML).join('') : '');

      // Empty state
      var emptyEl = $('bhTv3EmptyState');
      if (emptyEl) {
        var allEmpty = !urgentArrivees.length && !normalArrivees.length
                     && !departs.length && !assignments.length;
        emptyEl.style.display = allEmpty ? '' : 'none';
      }

    }).catch(function (err) {
      console.error('[bh-today-v3]', err);

      // Fallback: show error in counters area
      var countersEl = $('bhTv3Counters');
      if (countersEl) {
        countersEl.innerHTML = '<div class="bh-tv3-error" style="grid-column:1/-1;">'
          + '<div class="bh-tv3-error-icon"><i class="fas fa-exclamation-triangle"></i></div>'
          + '<div class="bh-tv3-error-msg">Impossible de charger les données.</div>'
          + '<button class="bh-tv3-error-retry" onclick="bhTv3Reload()">Réessayer</button>'
          + '</div>';
      }
    });
  }

  window.bhTv3Reload = function () { loadToday(); };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    if (!document.body || document.body.getAttribute('data-page') !== 'app') return;
    // Small delay: lets auth-fetch.js finish patching window.fetch
    setTimeout(loadToday, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
