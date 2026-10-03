/* bh-reporting-ios-23.js — Gestion › Reporting, dans le style de RevenusView.swift (app iOS)
   /revenus.html (?annee=&mois=&logement=&vue=mois|logements|reservations)
   Même route que l'ancienne page reporting.html : GET /api/reporting?year=&month=&property_id=
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {}, U = BHP.ui;
  if (!U) { console.error('bh-reporting-ios-23 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, ic = U.ic, card = U.card, kv = U.kv;
  var TABS = [['synthese', 'Synthèse'], ['mois', 'Mois'], ['logements', 'Logements'], ['reservations', 'Réservations']];
  var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  var PCOL = { airbnb: '#FF5A5F', booking: '#003580', expedia: '#FFC72C', vrbo: '#1A5276', direct: '#0E3B2E', bhguest: '#C2410C' };
  var PLAB = { airbnb: 'Airbnb', booking: 'Booking.com', expedia: 'Expedia', vrbo: 'Vrbo', direct: 'Direct', bhguest: 'BHGuest', manual: 'Direct' };
  function pkey(n) { var s = String(n || '').toLowerCase().replace(/[\s_.]/g, ''); if (s.indexOf('airbnb') >= 0) return 'airbnb'; if (s.indexOf('booking') >= 0) return 'booking'; if (s.indexOf('expedia') >= 0) return 'expedia'; if (s.indexOf('vrbo') >= 0 || s.indexOf('abritel') >= 0) return 'vrbo'; if (s.indexOf('guest') >= 0 || s === 'boostinghost') return 'bhguest'; if (s === 'manual' || s === 'manuel' || s === 'direct' || !s) return 'direct'; return s; }
  function plabel(n) { var k = pkey(n); return PLAB[k] || (n ? String(n).replace(/^\w/, function (c) { return c.toUpperCase(); }) : 'Direct'); }

  BHP.initReporting = function () {
    var root = document.getElementById('bhpApp');
    var qs = new URLSearchParams(location.search), now = new Date();
    var S = {
      tab: TABS.some(function (t) { return t[0] === qs.get('vue'); }) ? qs.get('vue') : 'synthese',
      year: +qs.get('annee') || now.getFullYear(), month: qs.get('mois') || '', prop: qs.get('logement') || '',
      state: 'loading', d: null, yearMonthly: null, props: [], chart: 'grossRevenue', rsort: 'date'
    };
    function cur() { return S.d && S.d.summary && S.d.summary.singleCurrency; }
    function money(v, c) {
      if (v == null || isNaN(v)) return '—';
      c = c || cur(); if (!c) return '—';
      try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v); } catch (e) { return U.fmtAmount(v); }
    }
    function sync() {
      var p = new URLSearchParams(); if (S.year !== now.getFullYear()) p.set('annee', S.year); if (S.month) p.set('mois', S.month); if (S.prop) p.set('logement', S.prop); if (S.tab !== 'synthese') p.set('vue', S.tab);
      history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
    }
    function load() {
      S.state = 'loading'; render(); sync();
      var q = '/api/reporting?year=' + S.year + (S.prop ? '&property_id=' + encodeURIComponent(S.prop) : '');
      return Promise.all([U.api('GET', q + (S.month ? '&month=' + S.month : '')), S.month ? U.api('GET', q).catch(function () { return null; }) : Promise.resolve(null)]).then(function (r) {
        S.d = r[0]; S.yearMonthly = (r[1] && r[1].monthly) || r[0].monthly || []; S.state = 'loaded';
      }).catch(function (e) { S.state = 'error'; S.err = e.status === 403 ? 'Vous n\'avez pas accès au reporting.' : e.message; }).then(render);
    }

    function render() {
      var per = (S.month ? MONTHS[+S.month - 1] + ' ' : '') + S.year;
      var pname = S.prop ? ((S.props.filter(function (p) { return p.id === S.prop; })[0] || {}).name || 'Logement') : 'Tous les logements';
      var seg = '<div class="bhm-seg bhb-seg">' + TABS.map(function (t) { return '<button class="bhm-seg__b' + (S.tab === t[0] ? ' is-on' : '') + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
      var years = []; for (var y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y--) years.push(y);
      var filters = '<div class="bhr-filters">'
        + '<select class="bhp-input bhp-select" data-f="year">' + years.map(function (y) { return '<option' + (y === S.year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>'
        + '<select class="bhp-input bhp-select" data-f="month"><option value="">Toute l\'année</option>' + MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '"' + (String(i + 1) === String(S.month) ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>'
        + '<select class="bhp-input bhp-select" data-f="prop"><option value="">Tous les logements</option>' + S.props.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.prop ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div>';
      var nav = '<header class="bhp-nav"><div class="bhm-nav__in">' + U.circleBtn('chevL', 'back', 'Gestion') + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + esc(per + ' · ' + pname) + '</div><h1 class="bhm-title">Reporting</h1></div>'
        + (S.state === 'loaded' ? '<button class="bhp-glassbtn" data-act="export">' + ic('share') + 'Exporter</button>' : '') + '</div><div class="bhm-nav__in2">' + filters + '<div style="height:10px"></div>' + seg + '</div></header>';
      var h;
      if (S.state === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (S.state === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else h = S.tab === 'synthese' ? synthese() : S.tab === 'mois' ? mois() : S.tab === 'logements' ? logements() : reservations();
      root.innerHTML = nav + '<div class="bhp-stack bhm-stack">' + h + '</div>';
    }

    /* ── Synthèse (RevenusView) ── */
    function synthese() {
      var s = S.d.summary || {};
      if (!s.totalBookings && !s.pendingBookings) return '<div class="bhm-empty">' + ic('chart') + '<span>Aucune réservation encaissée sur cette période.</span></div>';
      var h = '';
      if (s.singleCurrency === false) h += U.warn('Vos logements utilisent plusieurs devises : les totaux tous logements confondus ne sont pas additionnés. Filtrez par logement pour voir les montants.');
      h += '<div class="bhp-card bhr-hero"><span class="bhp-label" style="margin:0">CA brut</span><b class="bhr-big">' + esc(money(s.totalGrossRevenue)) + '</b>'
        + '<span class="bhp-meta">dont ' + esc(money(s.totalCleaningFee)) + ' de ménage · ' + esc(money(s.totalTouristTax)) + ' de taxe de séjour</span>'
        + (s.pendingBookings ? '<span class="bhp-meta" style="color:#8A5B14">+ ' + U.pl(s.pendingBookings, 'réservation') + ' en attente d\'approbation · ' + esc(money(s.pendingGrossRevenue)) + '</span>' : '')
        + '<span class="bhp-meta" style="margin-top:4px">Revenus à la date d\'encaissement : Booking après le départ, Airbnb après l\'arrivée.</span></div>';
      h += '<div class="bhp-card bhr-hero"><span class="bhp-label" style="margin:0">Revenu net</span><b class="bhr-big" style="color:#0E3B2E">' + esc(money(s.totalNetRevenue)) + '</b>'
        + '<div class="bhr-sub"><div class="is-mint"><span>Conciergerie</span><b>' + esc(money(s.totalConcierge)) + '</b></div><div><span>Propriétaires</span><b>' + esc(money(s.totalOwnerRevenue)) + '</b></div></div></div>';
      var avg = s.totalNights > 0 && s.totalGrossRevenue != null ? money(s.totalGrossRevenue / s.totalNights) : '—';
      h += '<div class="bhr-grid">' + [['Réservations', String(s.totalBookings || 0)], ['Nuits louées', String(s.totalNights || 0)], ['Commissions OTA', money(s.totalOtaCommission), '#A8452A'], ['Moyenne par nuit', avg]].map(function (x) {
        return '<div class="bhp-card bhr-tile"><span class="bhp-meta">' + esc(x[0]) + '</span><b' + (x[2] ? ' style="color:' + x[2] + '"' : '') + '>' + esc(x[1]) + '</b></div>';
      }).join('') + '</div>';
      var pf = S.d.platforms || [];
      if (pf.length) h += card('<div class="bhp-row"><span class="bhp-label" style="margin:0">Par plateforme</span></div>' + pf.map(function (p) {
        var c = PCOL[pkey(p.name)] || '#5E6B63', pend = !p.revenue && p.pendingRevenue > 0;
        return '<div class="bhp-row bhr-plat"><div class="bhr-plat__t"><i style="background:' + c + '"></i><span>' + esc(plabel(p.name)) + '</span><span class="bhp-meta">' + U.pl(p.bookings || 0, 'réservation') + '</span>'
          + '<div class="bhr-plat__v">' + (pend ? '<b style="color:#8A5B14">' + esc(money(p.pendingRevenue)) + '</b><span>en attente</span>' : '<b>' + esc(p.revenue != null ? money(p.revenue) : '—') + '</b><span>' + Math.round(p.pct || 0) + ' %</span>') + '</div></div>'
          + '<div class="bhr-bar" style="background:' + c + '2E"><i style="width:' + (pend ? 0 : Math.max(2, p.pct || 0)) + '%;background:' + c + '"></i></div></div>';
      }).join(''));
      var top = (S.d.byProperty || []).filter(function (p) { return p.bookings > 0; }).sort(function (a, b) { return (b.grossRevenue || 0) - (a.grossRevenue || 0); }).slice(0, 4);
      if (top.length > 1) h += card('<div class="bhp-row"><span class="bhp-label" style="margin:0">Meilleurs logements</span></div>' + top.map(function (p) {
        return '<div class="bhp-row bho-cl bhp-row--tap" data-act="prop" data-id="' + esc(p.id) + '"><i class="bhr-dot" style="background:' + esc(p.color || '#0E3B2E') + '"></i><div class="bho-cl__t"><div class="bho-cl__n">' + esc(p.name) + '</div><div class="bhp-meta">' + U.pl(p.nights || 0, 'nuit') + ' · occupation ' + (p.occupancyRate || 0) + ' %</div></div><b style="font-size:15px">' + esc(money(p.grossRevenue, p.currency)) + '</b></div>';
      }).join(''));
      return h;
    }

    /* ── Mois ── */
    function mois() {
      var ym = S.yearMonthly || [], k = S.chart;
      var max = Math.max.apply(null, ym.map(function (m) { return m[k] || 0; }).concat([1]));
      var h = '<div class="bhp-card bhr-chart"><div class="bhr-chart__h"><span class="bhp-label" style="margin:0">' + S.year + '</span><div class="bhm-seg" style="width:260px">'
        + [['grossRevenue', 'CA brut'], ['netRevenue', 'Net'], ['nights', 'Nuits']].map(function (x) { return '<button class="bhm-seg__b' + (k === x[0] ? ' is-on' : '') + '" data-act="chart" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>'
        + '<div class="bhr-bars">' + ym.map(function (m) {
          var v = m[k] || 0, sel = String(m.month) === String(S.month);
          return '<button class="bhr-col' + (sel ? ' is-sel' : '') + '" data-act="pickmonth" data-v="' + m.month + '" title="' + esc(MONTHS[m.month - 1] + ' : ' + (k === 'nights' ? v + ' nuits' : money(v))) + '"><span class="bhr-col__v">' + (v ? esc(k === 'nights' ? String(v) : compact(v)) : '') + '</span><i style="height:' + Math.round(v / max * 100) + '%"></i><span>' + esc(MONTHS[m.month - 1].slice(0, 3)) + '</span></button>';
        }).join('') + '</div><p class="bhp-note" style="margin:0">Touchez un mois pour filtrer toute la page.</p></div>';
      var rows = (S.d.monthly || []).filter(function (m) { return m.bookings > 0; });
      if (!rows.length) return h + '<p class="bhp-state" style="padding:30px 0">Aucune réservation encaissée.</p>';
      var tot = function (key) { return rows.reduce(function (s, m) { return s + (m[key] || 0); }, 0); };
      h += U.label('Détail par mois') + rows.map(function (m) {
        return card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">' + esc(MONTHS[m.month - 1]) + '</span><span class="bhp-meta">' + U.pl(m.bookings, 'réservation') + ' · ' + U.pl(m.nights, 'nuit') + '</span></div>'
          + kv('CA brut', money(m.grossRevenue)) + kv('Commissions OTA', money(-(m.otaCommissionAmount || 0))) + kv('Ménage', money(m.cleaningFee)) + kv('Taxe de séjour', money(m.touristTax))
          + (m.conciergeAmount ? kv('Conciergerie', money(m.conciergeAmount)) + kv('Propriétaires', money(m.ownerRevenue)) : '')
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">Revenu net</span><span class="bhp-kv__v" style="font-weight:700;color:#0E3B2E">' + esc(money(m.netRevenue)) + '</span></div>');
      }).join('');
      if (rows.length > 1) h += card('<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">Total</span><span class="bhp-meta">' + U.pl(tot('bookings'), 'réservation') + ' · ' + U.pl(tot('nights'), 'nuit') + '</span></div>'
        + kv('CA brut', money(tot('grossRevenue'))) + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">Revenu net</span><span class="bhp-kv__v" style="font-weight:700;color:#0E3B2E">' + esc(money(tot('netRevenue'))) + '</span></div>');
      return h;
    }
    function compact(v) { return v >= 1000 ? (Math.round(v / 100) / 10).toString().replace('.', ',') + 'k' : String(Math.round(v)); }

    /* ── Logements (rentabilité) ── */
    function logements() {
      var ps = (S.d.byProperty || []).slice().sort(function (a, b) { return (b.grossRevenue || 0) - (a.grossRevenue || 0); });
      if (!ps.length) return '<p class="bhp-state">Aucun logement.</p>';
      return ps.map(function (p) {
        var c = p.currency || cur(), pct = p.netMarginPct != null ? p.netMarginPct : (p.grossRevenue ? Math.round((p.netMargin || 0) / p.grossRevenue * 100) : 0);
        return '<div class="bhp-card bhr-prop"><div class="bhp-row bho-cl bhp-row--tap" data-act="prop" data-id="' + esc(p.id) + '"><i class="bhr-dot" style="background:' + esc(p.color || '#0E3B2E') + '"></i><div class="bho-cl__t"><div class="bho-cl__n">' + esc(p.name) + '</div>'
          + '<div class="bhp-meta">' + U.pl(p.bookings || 0, 'réservation') + ' · ' + U.pl(p.nights || 0, 'nuit') + ' · occupation ' + (p.occupancyRate || 0) + ' %</div></div><b style="font-size:16px">' + esc(money(p.grossRevenue, c)) + '</b></div>'
          + kv('Commissions OTA (' + (p.airbnbCommissionPct || 3) + ' % / ' + (p.bookingCommissionPct || 15) + ' %)', money(-(p.otaCommissionAmount || 0), c))
          + kv('Ménage', money(-(p.cleaningFee || 0), c)) + (p.conciergePct ? kv('Conciergerie (' + p.conciergePct + ' %)', money(-(p.conciergeAmount || 0), c)) + kv('Versé au propriétaire', money(p.ownerRevenue, c)) : '')
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">Marge nette</span><span>' + U.pill(pct + ' %', pct >= 30 ? 'vert' : pct >= 15 ? 'or' : 'terra') + ' <b style="font-size:16px;margin-left:6px">' + esc(money(p.netMargin, c)) + '</b></span></div>'
          + (p.pendingBookings ? '<div class="bhp-row"><span class="bhp-meta" style="color:#8A5B14">+ ' + U.pl(p.pendingBookings, 'réservation') + ' en attente · ' + esc(money(p.pendingGrossRevenue, c)) + '</span></div>' : '') + '</div>';
      }).join('');
    }

    /* ── Réservations ── */
    function reservations() {
      var rs = (S.d.reservations || []).slice();
      if (!rs.length) return '<p class="bhp-state">Aucune réservation sur cette période.</p>';
      var sorts = { date: function (a, b) { return String(b.paymentDate || b.startDate).localeCompare(String(a.paymentDate || a.startDate)); }, montant: function (a, b) { return (b.grossRevenue || 0) - (a.grossRevenue || 0); }, marge: function (a, b) { return (a.netMargin || 0) - (b.netMargin || 0); } };
      rs.sort(sorts[S.rsort]);
      var chips = '<div class="bhp-chips"><div class="bhp-chips__in">' + [['date', 'Plus récentes'], ['montant', 'Montant'], ['marge', 'Marge la plus faible']].map(function (x) { return '<button class="bhm-chip' + (S.rsort === x[0] ? ' is-on' : '') + '" data-act="rsort" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
      return chips + '<p class="bhp-note">' + U.pl(rs.length, 'réservation') + '</p>' + card(rs.map(function (r, i) {
        var c = r.currency || cur(), col = PCOL[pkey(r.platform)] || '#5E6B63';
        return '<div class="bhp-row bho-cl bhp-row--tap" data-act="resa" data-i="' + (S.d.reservations.indexOf(r)) + '"><i class="bhr-dot" style="background:' + col + '"></i><div class="bho-cl__t"><div class="bho-cl__n">' + esc(r.guestName || '—') + '</div>'
          + '<div class="bhp-meta">' + esc(r.propertyName) + ' · ' + esc(plabel(r.platform)) + '</div><div class="bhp-meta">' + esc(dShort(r.startDate)) + ' → ' + esc(dShort(r.endDate)) + ' · ' + U.pl(r.nights || 0, 'nuit') + '</div></div>'
          + '<div class="bhc-right"><b style="font-size:15px">' + esc(money(r.grossRevenue, c)) + '</b><span class="bhp-meta" style="font-size:12px">net ' + esc(money(r.netRevenue, c)) + '</span></div>' + U.CHEV + '</div>';
      }).join(''));
    }
    function dShort(d) { var x = new Date(String(d).slice(0, 10) + 'T00:00:00'); return isNaN(x) ? '—' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
    function openResa(r) {
      var c = r.currency || cur();
      var sh = U.openSheet({ head: { kicker: r.propertyName, title: r.guestName || 'Réservation', right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack"><div class="bhp-card bhf-hero"><div class="bhf-hero__l"><span class="bhp-meta">CA brut</span><b>' + esc(money(r.grossRevenue, c)) + '</b></div>' + U.pill(plabel(r.platform), 'neutre') + '</div>'
        + '<div class="bhp-group">' + U.label('Séjour') + card(kv('Arrivée', dShort(r.startDate)) + kv('Départ', dShort(r.endDate)) + kv('Nuits', String(r.nights || 0)) + (r.paymentDate ? kv('Encaissement', dShort(r.paymentDate)) : '')) + '</div>'
        + '<div class="bhp-group">' + U.label('Montants') + card(kv('Prix du séjour', money(r.rawPrice, c)) + kv('Ménage', money(r.cleaningFee, c)) + kv('Taxe de séjour', money(r.touristTax, c))
          + kv('Commission OTA', money(-(r.otaCommissionAmount || 0), c)) + (r.hostPayout != null ? kv('Versé par la plateforme', money(r.hostPayout, c)) : '')
          + (r.conciergeAmount ? kv('Conciergerie' + (r.conciergePct ? ' (' + r.conciergePct + ' %)' : ''), money(r.conciergeAmount, c)) + kv('Propriétaire', money(r.ownerRevenue, c)) : '')
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-weight:600">Revenu net</span><span class="bhp-kv__v" style="font-weight:700">' + esc(money(r.netRevenue, c)) + '</span></div>'
          + '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">Marge nette</span><span class="bhp-kv__v">' + esc(money(r.netMargin, c)) + '</span></div>') + '</div></div>';
    }

    /* ── Exports ── */
    function dlCSV(name, headers, rows) {
      var csv = '﻿' + [headers].concat(rows).map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    function exportSheet() {
      var sh = U.openSheet({ head: { title: 'Exporter', right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' } });
      var per = (S.month ? MONTHS[+S.month - 1].toLowerCase() + ' ' : '') + S.year;
      function row(act, icon, t, s) { return '<div class="bhp-row bho-cl bhp-row--tap" data-x="' + act + '"><div class="bhk-ic is-on">' + U.I[icon] + '</div><div class="bho-cl__t"><div class="bho-cl__n">' + esc(t) + '</div><div class="bhp-meta">' + esc(s) + '</div></div>' + U.CHEV + '</div>'; }
      sh.body.innerHTML = '<div class="bhp-stack">' + U.label('Ce rapport · ' + per) + card(row('csv', 'chart', 'Revenus par mois', 'CSV : réservations, nuits, CA, ménage, taxe, net') + row('conc', 'users', 'Conciergerie', 'CSV : commissions et montants versés aux propriétaires'))
        + U.label('Comptabilité · ' + per) + card(row('reservations', 'calendar', 'Réservations', 'Date, logement, voyageur, plateforme, montants') + row('invoices', 'doc', 'Factures propriétaires', 'Numéro, client, HT, TVA, TTC, statut')) + '</div>';
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-x]'); if (!el) return;
        var x = el.dataset.x, d = S.d;
        if (x === 'csv') {
          var hc = (d.byProperty || []).some(function (p) { return p.conciergePct > 0; });
          var hd = ['Mois', 'Réservations', 'Nuits', 'CA brut', 'Frais ménage', 'Taxe séjour', 'Revenu net'].concat(hc ? ['Commission conciergerie', 'Revenu propriétaire'] : []);
          var rows = (d.monthly || []).map(function (m) { return [m.label, m.bookings, m.nights, m.grossRevenue, m.cleaningFee, m.touristTax, m.netRevenue].concat(hc ? [m.conciergeAmount, m.ownerRevenue] : []); });
          var sum = function (k) { return Math.round((d.monthly || []).reduce(function (s, m) { return s + (m[k] || 0); }, 0) * 100) / 100; };
          rows.push(['TOTAL', sum('bookings'), sum('nights'), sum('grossRevenue'), sum('cleaningFee'), sum('touristTax'), sum('netRevenue')].concat(hc ? [sum('conciergeAmount'), sum('ownerRevenue')] : []));
          dlCSV('revenus_' + S.year + (S.month ? '_' + S.month : '') + '.csv', hd, rows);
        }
        if (x === 'conc') {
          var rs = (d.reservations || []).filter(function (r) { return r.conciergePct > 0; });
          if (!rs.length) { U.alertMsg('Aucune commission', 'Aucune réservation avec commission de conciergerie. Réglez le pourcentage dans la fiche du logement, bloc Argent.'); return; }
          dlCSV('conciergerie_' + S.year + '.csv', ['Logement', 'Plateforme', 'Arrivée', 'Départ', 'Nuits', 'Prix brut', 'Frais ménage', 'Taxe séjour', 'Revenu net', '% Conciergerie', 'Commission', 'Versé propriétaire'],
            rs.map(function (r) { return [r.propertyName, r.platform, r.startDate, r.endDate, r.nights, r.rawPrice, r.cleaningFee, r.touristTax, r.netRevenue, r.conciergePct + '%', r.conciergeAmount, r.ownerRevenue]; }));
        }
        if (x === 'reservations' || x === 'invoices') {
          el.style.opacity = '.5';
          (window.authFetch || fetch)('/api/export/' + x + '?year=' + S.year + (S.month ? '&month=' + S.month : '')).then(function (res) {
            if (!res.ok) throw new Error('Export indisponible (' + res.status + ').');
            var fn = ((res.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/) || [])[1] || 'boostinghost_' + x + '_' + S.year + '.csv';
            return res.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fn; document.body.appendChild(a); a.click(); a.remove(); });
          }).catch(function (er) { U.alertMsg('Erreur', er.message); }).then(function () { el.style.opacity = ''; });
        }
      });
    }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var a = el.dataset.act;
      if (a === 'back') { location.href = '/manage.html'; return; }
      if (a === 'retry') return load();
      if (a === 'tab') { S.tab = el.dataset.v; sync(); render(); return; }
      if (a === 'chart') { S.chart = el.dataset.v; render(); return; }
      if (a === 'pickmonth') { S.month = String(S.month) === el.dataset.v ? '' : el.dataset.v; load(); return; }
      if (a === 'rsort') { S.rsort = el.dataset.v; render(); return; }
      if (a === 'prop') { if (S.prop !== el.dataset.id) { S.prop = el.dataset.id; S.tab = 'synthese'; load(); } return; }
      if (a === 'resa') return openResa(S.d.reservations[+el.dataset.i]);
      if (a === 'export') return exportSheet();
    });
    root.addEventListener('change', function (e) {
      var f = e.target.dataset.f; if (!f) return;
      if (f === 'year') S.year = +e.target.value;
      if (f === 'month') S.month = e.target.value;
      if (f === 'prop') S.prop = e.target.value;
      load();
    });

    U.api('GET', '/api/properties').then(function (r) {
      S.props = (r.properties || (Array.isArray(r) ? r : [])).map(function (p) { return { id: String(p.id), name: p.internal_name || p.internalName || p.name || String(p.id) }; });
      if (S.state !== 'loading') render();
    }).catch(function () {});
    load();
  };
})();
