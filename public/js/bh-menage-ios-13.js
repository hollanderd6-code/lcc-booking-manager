/* bh-menage-ios-13.js — Gestion › Ménage, parité avec l'app iOS
   (CleaningView.swift + CleaningViewModel.swift + ChecklistDetailView côté propriétaire)
   Dépend de bh-prop-ios-12.js (BHP.ui). */
(function () {
  'use strict';
  var BHP = window.BHP || {};
  var U = BHP.ui;
  if (!U) { console.error('bh-menage-ios-13 : charger bh-prop-ios-12.js avant.'); return; }
  var esc = U.esc, pick = U.pick, I = U.I, ic = U.ic, pl = U.pl, card = U.card, htmlRow = U.htmlRow, SPIN = U.SPIN, CHEV = U.CHEV;
  var TIGHT = 6 * 3600 * 1000;

  /* ── Dates ── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function fromYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dayLabel(s) { if (!s) return ''; return fromYmd(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase(); }
  function hm(d) { var h = d.getHours(), m = d.getMinutes(); return m ? h + '\u00a0h\u00a0' + pad(m) : h + '\u00a0h'; }
  function parseWin(raw) {
    if (!raw) return null;
    if (String(raw).indexOf('T') >= 0) { var d = new Date(raw); return isNaN(d) ? null : d; }
    var t = U.hhmm(raw); if (!t) return null;
    var now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +t.slice(0, 2), +t.slice(3));
  }
  function slotDur(s, e) { var a = parseWin(s), b = parseWin(e); if (!a || !b) return null; var d = b - a; return d > 0 ? d : null; }
  function winLabel(raw) { if (!raw) return null; var s = String(raw); if (s.indexOf('T') >= 0) s = s.split('T')[1].slice(0, 5); return U.fmtTime(s); }
  function completionLabel(iso, n) {
    var photo = n > 0 ? ' · ' + pl(n, 'photo') : '';
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return 'Terminé' + photo;
    var today = ymd(new Date()), yest = ymd(addDays(new Date(), -1)), k = ymd(d);
    if (k === today) return "Terminé aujourd'hui " + hm(d) + photo;
    if (k === yest) return 'Terminé hier ' + hm(d) + photo;
    return 'Terminé ' + dayLabel(k) + photo;
  }
  function durLabel(sec) {
    if (!sec || sec <= 0) return null;
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? (m ? h + '\u00a0h\u00a0' + pad(m) : h + '\u00a0h') : m + '\u00a0min';
  }
  function keyDay(key) { if (!key || key.length < 10) return null; var s = key.slice(-10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function initials(name) { var w = String(name || '').trim().split(/\s+/).slice(0, 2); var l = w.map(function (x) { return x.charAt(0); }).join('').toUpperCase(); return l || '?'; }
  function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }

  /* ── Normalisation ── */
  function normAssign(a) {
    return {
      propertyId: pick(a, 'propertyId', 'property_id') != null ? String(pick(a, 'propertyId', 'property_id')) : null,
      reservationKey: pick(a, 'reservationKey', 'reservation_key') || null,
      cleanerId: pick(a, 'cleanerId', 'cleaner_id') != null ? String(pick(a, 'cleanerId', 'cleaner_id')) : null,
      cleanerName: pick(a, 'cleanerName', 'cleaner_name') || null,
      cleanerPhone: pick(a, 'cleanerPhone', 'cleaner_phone') || null,
      propertyName: pick(a, 'propertyName', 'property_name') || null
    };
  }
  function normChecklist(c) {
    return {
      id: String(pick(c, '_id', 'id') || ''),
      propertyId: pick(c, 'propertyId', 'property_id') != null ? String(pick(c, 'propertyId', 'property_id')) : null,
      reservationKey: pick(c, 'reservationKey', 'reservation_key') || null,
      cleanerName: pick(c, 'cleanerName', 'cleaner_name') || null,
      ownerStatus: pick(c, 'ownerStatus', 'owner_status') || null,
      completedAt: pick(c, 'completedAt', 'completed_at') || null,
      photos: Array.isArray(c.photos) ? c.photos : [],
      propertyName: pick(c, 'propertyName', 'property_name') || null
    };
  }
  function normCleaner(c) {
    var active = pick(c, 'isActive', 'is_active');
    return {
      id: String(pick(c, 'id', '_id') || ''), name: c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Intervenant',
      phone: c.phone || null, isActive: active == null ? true : U.bool(active) !== false,
      subAccountId: pick(c, 'subAccountId', 'sub_account_id') || null,
      sms: U.bool(pick(c, 'smsRecapEnabled', 'sms_recap_enabled', 'sms_enabled')) === true
    };
  }
  function normResa(r) {
    var start = String(pick(r, 'startDate', 'start_date', 'start', 'checkIn', 'check_in', 'arrival') || '').slice(0, 10);
    var type = String(pick(r, 'type', 'source', 'platform') || '');
    return {
      propertyId: pick(r, 'propertyId', 'property_id') != null ? String(pick(r, 'propertyId', 'property_id')) : null,
      start: start, isBlock: U.bool(pick(r, 'isBlock', 'is_block')) === true || /^block(ed)?$/i.test(type)
    };
  }
  function normDetail(c) {
    var b = U.bool;
    return {
      id: String(pick(c, 'id', '_id') || ''),
      propertyId: pick(c, 'propertyId', 'property_id') != null ? String(pick(c, 'propertyId', 'property_id')) : null,
      reservationKey: pick(c, 'reservationKey', 'reservation_key') || null,
      guestName: pick(c, 'guestName', 'guest_name') || null,
      checkoutDate: pick(c, 'checkoutDate', 'checkout_date') || null,
      tasks: (Array.isArray(c.tasks) ? c.tasks : (typeof c.tasks === 'string' ? (function () { try { return JSON.parse(c.tasks); } catch (e) { return []; } })() : [])).map(function (t) {
        return { id: String(t.id || ''), name: t.name || t.title || 'Tâche', room: t.room || 'general', checked: !!t.checked };
      }),
      photos: (Array.isArray(c.photos) ? c.photos : []).map(function (p) { return typeof p === 'string' ? p : (p && (p.data || p.url)) || ''; }).filter(Boolean),
      notes: c.notes || null,
      completedAt: pick(c, 'completedAt', 'completed_at') || null,
      ownerStatus: pick(c, 'ownerStatus', 'owner_status') || 'pending',
      ownerNotes: pick(c, 'ownerNotes', 'owner_notes') || null,
      ownerValidatedAt: pick(c, 'ownerValidatedAt', 'owner_validated_at') || null,
      durationSeconds: U.int(pick(c, 'durationSeconds', 'duration_seconds', 'duration')),
      cleanerName: pick(c, 'cleanerName', 'cleaner_name') || null,
      cleanerPhone: pick(c, 'cleanerPhone', 'cleaner_phone') || null,
      cleanerCertified: b(pick(c, 'cleanerCertified', 'cleaner_certified')) === true,
      certifiedAt: pick(c, 'certifiedAt', 'certified_at') || null,
      signatureData: pick(c, 'signatureData', 'signature_data') || null
    };
  }
  var ROOMS = { kitchen: 'Cuisine', bathroom: 'Salle de bain', bedroom: 'Chambre', living: 'Salon', terrace: 'Terrasse', general: 'Général' };
  var ROOM_ORDER = ['kitchen', 'bathroom', 'bedroom', 'living', 'terrace', 'general'];
  function roomKey(r) { r = String(r || 'general').toLowerCase(); return ROOMS[r] ? r : 'general'; }
  function groupTasks(tasks) {
    var g = {};
    tasks.forEach(function (t) { var k = roomKey(t.room); (g[k] = g[k] || []).push(t); });
    return ROOM_ORDER.filter(function (k) { return g[k]; }).map(function (k) { return { room: ROOMS[k], tasks: g[k] }; });
  }

  /* ════════════════ Écran Ménage ════════════════ */
  BHP.initMenage = function () {
    var root = document.getElementById('bhpApp');
    var isSub = U.isSubAccount();
    var perms = isSub ? U.subPermissions() : {};
    var canManage = !isSub || perms.can_manage_cleaning === true;
    var S = {
      period: (new URLSearchParams(location.search).get('vue')) || 'today', state: 'loading', err: null,
      tight: [], wide: [], toValidate: [], cleaners: [], week: [], history: [], histNames: [], histFilter: null,
      busy: {}
    };

    function load() {
      if (S.state !== 'loaded') { S.state = 'loading'; render(); }
      var since = ymd(addDays(new Date(), -31));
      Promise.all([
        U.api('GET', '/api/cleaning/assignments').catch(function () { return {}; }),
        U.api('GET', isSub ? '/api/cleaning/property-names' : '/api/properties').catch(function () { return {}; }),
        U.api('GET', '/api/cleaning/checklists?since=' + since).catch(function () { return {}; }),
        U.api('GET', '/api/reservations').catch(function () { return {}; }),
        isSub ? Promise.resolve({}) : U.api('GET', '/api/cleaners').catch(function () { return {}; })
      ]).then(function (r) {
        var assigns = (r[0].assignments || (Array.isArray(r[0]) ? r[0] : [])).map(normAssign);
        var props = (r[1].properties || (Array.isArray(r[1]) ? r[1] : [])).map(U.normProperty);
        var cls = (r[2].checklists || (Array.isArray(r[2]) ? r[2] : [])).map(normChecklist);
        var resas = (r[3].reservations || (Array.isArray(r[3]) ? r[3] : [])).map(normResa).filter(function (x) { return !x.isBlock && x.propertyId; });
        S.cleaners = (r[4].cleaners || (Array.isArray(r[4]) ? r[4] : [])).map(normCleaner);

        var nameBy = {}, depBy = {}, arrBy = {};
        props.forEach(function (p) { nameBy[p.id] = U.dname(p); if (p.departureTime) depBy[p.id] = p.departureTime; if (p.arrivalTime) arrBy[p.id] = p.arrivalTime; });
        var startsBy = {};
        resas.forEach(function (x) { (startsBy[x.propertyId] = startsBy[x.propertyId] || {})[x.start] = 1; });
        var clByKey = {}, draftKeys = {};
        cls.forEach(function (c) { if (!c.reservationKey) return; if (c.completedAt) clByKey[c.reservationKey] = c; else draftKeys[c.reservationKey] = 1; });

        function dayAssigns(day) {
          var seen = {};
          return assigns.filter(function (a) { var d = keyDay(a.reservationKey); if (d !== day || seen[a.reservationKey]) return false; seen[a.reservationKey] = 1; return true; });
        }
        function resolve(a, day) {
          var x = Object.assign({}, a);
          if (!x.propertyId) return x;
          x.name = nameBy[x.propertyId] || x.propertyName || x.propertyId;
          x.windowStart = depBy[x.propertyId] || null;
          x.windowEnd = (startsBy[x.propertyId] && startsBy[x.propertyId][day]) ? (arrBy[x.propertyId] || null) : null;
          x.day = day;
          var cl = x.reservationKey ? clByKey[x.reservationKey] : null;
          x.checklistId = cl ? cl.id : null;
          x.state = cl ? (cl.ownerStatus === 'validated' ? 'validated' : cl.ownerStatus === 'rejected' ? 'rejected' : 'pending') : (draftKeys[x.reservationKey] ? 'inProgress' : 'notStarted');
          return x;
        }
        function classify(items) {
          return {
            tight: items.filter(function (a) { var d = slotDur(a.windowStart, a.windowEnd); return d != null && d <= TIGHT; }),
            wide: items.filter(function (a) { var d = slotDur(a.windowStart, a.windowEnd); return d == null || d > TIGHT; })
          };
        }
        var today = new Date(), todayStr = ymd(today);
        var t = classify(dayAssigns(todayStr).map(function (a) { return resolve(a, todayStr); }));
        S.tight = t.tight; S.wide = t.wide;
        S.toValidate = cls.filter(function (c) { return c.ownerStatus === 'pending' && c.completedAt; }).map(function (c) { c.name = (c.propertyId && nameBy[c.propertyId]) || c.propertyName || c.propertyId || '—'; return c; });
        S.week = [];
        for (var n = 1; n <= 7; n++) {
          var ds = ymd(addDays(today, n)), items = dayAssigns(ds).map(function (a) { return resolve(a, ds); });
          if (items.length) { var c = classify(items); S.week.push({ day: ds, tight: c.tight, wide: c.wide }); }
        }
        var hist = {}; for (var k = 1; k <= 30; k++) hist[ymd(addDays(today, -k))] = 1;
        var seenH = {};
        S.history = assigns.filter(function (a) { var d = keyDay(a.reservationKey); if (!d || !hist[d] || seenH[a.reservationKey]) return false; seenH[a.reservationKey] = 1; return true; })
          .map(function (a) {
            var cl = clByKey[a.reservationKey];
            var eff = (cl && cl.cleanerName) || a.cleanerName;
            return { day: keyDay(a.reservationKey), propertyId: a.propertyId, name: (a.propertyId && nameBy[a.propertyId]) || a.propertyName || (cl && cl.propertyName) || '—',
              cleanerName: a.cleanerName, effective: eff, status: cl ? cl.ownerStatus : null, checklistId: cl ? cl.id : null, reservationKey: a.reservationKey };
          }).sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; });
        var names = {}; S.history.forEach(function (h) { if (h.effective) names[h.effective] = 1; });
        S.histNames = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
        if (S.histFilter && !names[S.histFilter]) S.histFilter = null;
        S.state = 'loaded';
        render();
      }).catch(function (e) { S.state = 'error'; S.err = e.message || 'Chargement impossible'; render(); });
    }

    /* ── Rendu ── */
    function kicker() {
      if (S.state !== 'loaded') return '';
      if (S.period === 'today') {
        var p = [], n = S.tight.length + S.wide.length;
        if (n) p.push(n + " aujourd'hui");
        if (S.toValidate.length) p.push(S.toValidate.length + ' à valider');
        return p.join(' · ');
      }
      if (S.period === 'week') { var w = S.week.reduce(function (s, g) { return s + g.tight.length + g.wide.length; }, 0); return w ? w + ' cette semaine' : ''; }
      return '';
    }
    function nav() {
      var seg = [['today', "Aujourd'hui"], ['week', 'Semaine'], ['history', 'Historique']].map(function (s) {
        return '<button class="bhm-seg__b' + (S.period === s[0] ? ' is-on' : '') + '" data-act="period" data-v="' + s[0] + '">' + s[1] + '</button>';
      }).join('');
      var chips = '';
      if (S.period === 'history' && S.histNames.length) {
        chips = '<div class="bhp-chips"><div class="bhp-chips__in">' + [{ v: '', l: 'Tous' }].concat(S.histNames.map(function (n) { return { v: n, l: n }; })).map(function (c) {
          return '<button class="bhm-chip' + ((c.v || null) === S.histFilter ? ' is-on' : '') + '" data-act="hfilter" data-v="' + esc(c.v) + '">' + esc(c.l) + '</button>';
        }).join('') + '</div></div>';
      }
      return '<header class="bhp-nav"><div class="bhm-nav__in">'
        + (isSub ? '' : U.circleBtn('chevL', 'back', 'Gestion'))
        + '<div class="bhm-nav__t"><div class="bhp-nav__kicker" style="text-align:left">' + (esc(kicker()) || '&#160;') + '</div><h1 class="bhm-title">Ménage</h1></div>'
        + (isSub ? '' : U.circleBtn('plus', 'add', 'Ajouter'))
        + '</div><div class="bhm-nav__in2"><div class="bhm-seg">' + seg + '</div></div>' + chips + '</header>';
    }
    function badge(l, color) { return '<span class="bhm-badge" style="background:' + color + '">' + esc(l) + '</span>'; }
    function gauge(a, tight, future, color) {
      var p = 0;
      if (!future) { var s = parseWin(a.windowStart), e = parseWin(a.windowEnd); if (s && e && e > s) p = Math.max(0, Math.min(1, (Date.now() - s) / (e - s))); }
      return '<div class="bhm-gauge"><span class="bhm-gauge__l">' + esc(winLabel(a.windowStart) || '—') + '</span><span class="bhm-gauge__bar"><i style="width:' + Math.round(p * 100) + '%;background:' + color + '"></i></span><span class="bhm-gauge__r">' + esc(winLabel(a.windowEnd) || 'demain') + '</span></div>';
    }
    function stateLine(a, tight) {
      if (a.state === 'pending') return 'Terminé · À valider';
      if (a.state === 'validated') return 'Validé';
      if (a.state === 'rejected') return 'Complément demandé';
      var st = a.state === 'inProgress' ? 'En cours' : 'Pas commencé', d = slotDur(a.windowStart, a.windowEnd);
      if (d) { var h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000); return st + ' · ' + (m ? h + '\u00a0h ' + m : h + '\u00a0h') + ' de créneau'; }
      if (!tight) return st + ' · aucune arrivée avant demain';
      return st;
    }
    function assignCard(a, tight, future, idx, list) {
      var validated = a.state === 'validated';
      var accent = validated ? '#2E8B62' : (tight ? '#A8452A' : '#2E8B62');
      var lbl = validated ? 'PRÊT' : (tight ? 'RELOUÉ' : 'LIBRE');
      var line = future ? null : stateLine(a, tight);
      var call = '';
      if (canManage && !future && a.cleanerPhone && a.cleanerName) {
        call = validated ? '<a class="bhm-phonechip" href="' + esc(telHref(a.cleanerPhone)) + '" data-stop="1">' + ic('phone') + esc(a.cleanerName) + '</a>'
          : '<a class="bhm-call" href="' + esc(telHref(a.cleanerPhone)) + '" data-stop="1">' + ic('phone') + 'Appeler ' + esc(a.cleanerName) + '</a>';
      }
      var inner = '<div class="bhm-ac"><div class="bhm-ac__top"><div class="bhm-ac__txt"><div class="bhm-ac__n">' + esc(a.name || '—') + '</div>' + (a.cleanerName ? '<div class="bhp-meta">' + esc(a.cleanerName) + '</div>' : '') + '</div>'
        + '<div class="bhm-ac__r">' + badge(lbl, accent) + CHEV + '</div></div>'
        + gauge(a, tight, future, accent)
        + (line ? '<div class="bhm-ac__st" style="color:' + ((validated || tight) ? accent : '#5E6B63') + ';font-weight:' + (tight ? 600 : 400) + '">' + esc(line) + '</div>' : '')
        + (call ? '<div>' + call + '</div>' : '') + '</div>';
      var attrs = ' data-act="detail" data-list="' + list + '" data-i="' + idx + '"';
      if (tight) return '<div class="bhm-tight' + (validated ? ' is-ok' : '') + '"' + attrs + '><span class="bhm-tight__rail" style="background:' + accent + '"></span>' + inner + '</div>';
      return card(inner, 'bhp-card--tap', attrs);
    }
    function emptyState(t) { return '<div class="bhm-empty">' + ic('sparkles') + '<span>' + esc(t) + '</span></div>'; }
    function statusPill(st) {
      if (st === 'validated') return '<span class="bhp-pill bhp-pill--vert">' + ic('checkFill') + 'Validé</span>';
      if (st === 'rejected') return '<span class="bhp-pill bhp-pill--terra">' + ic('xFill') + 'Complément demandé</span>';
      if (st === 'pending') return '<span class="bhp-pill bhp-pill--or">' + ic('clock') + 'À valider</span>';
      return '<span class="bhp-pill bhp-pill--neutre">Pas de retour</span>';
    }
    function cleanerSub(c) { var p = []; if (c.subAccountId) p.push('sous-compte actif'); if (c.sms) p.push('SMS activé'); return p.length ? p.join(' · ') : 'intervenant'; }

    function body() {
      if (S.state === 'loading') return '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      if (S.state === 'error') return '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(S.err) + '</span><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      var h = '';
      if (S.period === 'today') {
        h += S.tight.map(function (a, i) { return assignCard(a, true, false, i, 'tight'); }).join('');
        h += S.wide.map(function (a, i) { return assignCard(a, false, false, i, 'wide'); }).join('');
        if (S.toValidate.length) {
          h += U.label('À valider');
          h += S.toValidate.map(function (c, i) {
            return card('<div class="bhm-vc"><div class="bhm-ac__top"><div class="bhm-ac__txt"><div class="bhm-ac__n" style="font-size:17px">' + esc(c.name) + '</div><div class="bhp-meta">' + esc(completionLabel(c.completedAt, c.photos.length)) + '</div></div>' + CHEV + '</div>'
              + (canManage ? '<div class="bhm-vc__acts"><button class="bhm-call" data-act="validate" data-i="' + i + '"' + (S.busy[c.id] ? ' disabled' : '') + '>' + (S.busy[c.id] ? '<span class="bhp-spin bhp-spin--w"></span>' : ic('checkFill')) + 'Valider</button><button class="bhp-glassbtn bhm-reject" data-act="reject" data-i="' + i + '">Rejeter</button></div>' : '') + '</div>',
              'bhp-card--tap', ' data-act="detail" data-list="validate" data-i="' + i + '"');
          }).join('');
        }
        if (!isSub && S.cleaners.length) {
          h += U.label('Intervenants');
          h += card(S.cleaners.map(function (c) {
            return '<div class="bhp-row bhm-cl"><span class="bhm-ini">' + esc(initials(c.name)) + '</span><div class="bhm-cl__t"><div class="bhm-cl__n">' + esc(c.name) + '</div><div class="bhp-meta">' + esc(cleanerSub(c)) + '</div></div>'
              + (!c.isActive ? '<span class="bhp-meta">Inactif</span>' : '') + (c.phone ? '<a class="bhm-icbtn" href="' + esc(telHref(c.phone)) + '" aria-label="Appeler">' + I.phone + '</a>' : '') + '</div>';
          }).join(''));
        }
        if (!S.tight.length && !S.wide.length && !S.toValidate.length) h += emptyState("Aucun ménage aujourd'hui");
      } else if (S.period === 'week') {
        if (!S.week.length) h += emptyState('Aucun ménage cette semaine');
        S.week.forEach(function (g, gi) {
          h += U.label(dayLabel(g.day));
          h += g.tight.map(function (a, i) { return assignCard(a, true, true, gi + ':' + i, 'wt'); }).join('');
          h += g.wide.map(function (a, i) { return assignCard(a, false, true, gi + ':' + i, 'ww'); }).join('');
        });
      } else {
        if (!S.history.length) h += emptyState('Aucun ménage sur 30 jours');
        else {
          h += '<p class="bhm-count">' + pl(S.history.length, 'ménage') + ' sur 30 jours</p>';
          var items = S.histFilter ? S.history.filter(function (x) { return x.effective === S.histFilter; }) : S.history;
          if (!items.length) h += '<p class="bhm-count">Aucun résultat pour ce filtre</p>';
          var groups = [], cur = null;
          items.forEach(function (x) { if (!cur || cur.day !== x.day) { cur = { day: x.day, items: [] }; groups.push(cur); } cur.items.push(x); });
          groups.forEach(function (g) {
            h += U.label(dayLabel(g.day));
            h += card(g.items.map(function (x) {
              var hi = S.history.indexOf(x);
              return '<div class="bhp-row bhm-hr" data-act="detail" data-list="hist" data-i="' + hi + '"><div class="bhm-cl__t"><div class="bhm-cl__n">' + esc(x.name) + '</div>'
                + (x.effective ? '<div class="bhp-meta">' + esc(x.effective) + '</div>' : '')
                + (x.cleanerName && x.effective && x.cleanerName !== x.effective ? '<div class="bhp-meta" style="opacity:.7">assignée : ' + esc(x.cleanerName) + '</div>' : '')
                + '</div>' + statusPill(x.status) + CHEV + '</div>';
            }).join(''));
          });
        }
      }
      return '<div class="bhp-stack bhm-stack">' + h + '</div>';
    }
    function render() { root.innerHTML = nav() + body(); }

    /* ── Valider / rejeter ── */
    function validate(c) {
      S.busy[c.id] = true; render();
      U.api('PUT', '/api/cleaning/checklists/' + encodeURIComponent(c.id) + '/validate', {}).catch(function (e) { U.alertMsg('Erreur', e.message); })
        .then(function () { delete S.busy[c.id]; load(); });
    }
    function openReject(id, onDone) {
      var txt = '';
      var sh = U.openSheet({ head: { title: '' } });
      function head() {
        sh.setHead({ title: 'Rejeter', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>',
          right: '<button class="bhp-textbtn" style="color:#A8452A;font-weight:600" data-act="rj-go"' + (txt.trim() ? '' : ' disabled') + '>Rejeter</button>' });
      }
      head();
      sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14.5px">Décrivez le problème pour l\'intervenante.</p><textarea class="bhp-input bhp-ta" rows="6" data-rj placeholder="Ex. la salle de bain n\'a pas été faite"></textarea></div>';
      var ta = sh.body.querySelector('[data-rj]');
      setTimeout(function () { ta.focus(); }, 350);
      ta.addEventListener('input', function () { var had = !!txt.trim(); txt = ta.value; if (had !== !!txt.trim()) head(); });
      sh.head.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="rj-go"]') || !txt.trim()) return;
        sh.close();
        U.api('PUT', '/api/cleaning/checklists/' + encodeURIComponent(id) + '/reject', { notes: txt.trim() })
          .then(function (r) { if (onDone) onDone(r); }).catch(function (er) { U.alertMsg('Erreur', er.message); }).then(load);
      });
    }

    /* ── Fiche d'un ménage (ChecklistDetailView, côté propriétaire) ── */
    function openDetail(ref) {
      var st = { phase: 'loading', d: null, tickets: [], expected: null, templateMissing: false, acting: false };
      var sh = U.openSheet({ full: true, head: { title: '' } });
      sh.setHead({ kicker: dayLabel(ref.day) || ' ', title: ref.name || 'Ménage', right: '<button class="bhp-textbtn" data-act="sheet-close">Fermer</button>' });
      function r2() {
        var h = '';
        if (st.phase === 'loading') h = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
        else if (st.phase === 'error') h = '<div class="bhm-empty">' + ic('warnFill') + '<span>' + esc(st.err) + '</span></div>';
        else if (st.phase === 'none') {
          h += card(htmlRow('<div class="bhp-info">' + ic('clock') + '<span>Pas encore de retour de l\'intervenante' + (ref.cleanerName ? ' (' + esc(ref.cleanerName) + ')' : '') + '.</span></div>')
            + (ref.windowStart || ref.windowEnd ? htmlRow(gauge(ref, false, true, '#2E8B62')) : ''));
          if (isSub) h += '<a class="bhp-btn bhp-btn--primary" style="text-decoration:none" href="/cleaning-tasks.html">' + ic('check') + 'Faire la checklist</a>';
          if (st.expected && st.expected.length) {
            h += U.label('Tâches attendues');
            h += groupTasks(st.expected).map(function (g) { return card(U.fh('list', g.room) + g.tasks.map(function (t) { return htmlRow('<div class="bhm-task"><span class="bhm-box"></span><span>' + esc(t.name) + '</span></div>'); }).join('')); }).join('');
          } else if (st.templateMissing) h += U.emptyCard('Aucun modèle de checklist pour ce logement.');
        } else {
          var d = st.d, done = d.tasks.filter(function (t) { return t.checked; }).length;
          var pillH = d.ownerStatus === 'validated' ? statusPill('validated') : d.ownerStatus === 'rejected' ? statusPill('rejected') : statusPill('pending');
          var meta = [completionLabel(d.completedAt, d.photos.length)];
          if (durLabel(d.durationSeconds)) meta.push('durée ' + durLabel(d.durationSeconds));
          h += card('<div class="bhp-row"><div class="bhm-ac__top"><div class="bhm-ac__txt"><div class="bhm-ac__n" style="font-size:17px">' + esc(d.cleanerName || ref.cleanerName || 'Intervenante') + '</div><div class="bhp-meta">' + esc(meta.join(' · ')) + '</div>'
            + (d.guestName ? '<div class="bhp-meta">après ' + esc(d.guestName) + '</div>' : '') + '</div>' + pillH + '</div></div>'
            + (d.cleanerPhone ? '<div class="bhp-row"><a class="bhm-phonechip" href="' + esc(telHref(d.cleanerPhone)) + '">' + ic('phone') + 'Appeler ' + esc(d.cleanerName || '') + '</a></div>' : ''));
          if (d.ownerStatus === 'rejected' && d.ownerNotes) h += '<div class="bhp-warn bhp-warn--err">' + ic('info') + '<span><b>Complément demandé</b><br>' + esc(d.ownerNotes) + '</span></div>';
          if (d.tasks.length) {
            h += U.label('Tâches · ' + done + '/' + d.tasks.length);
            h += groupTasks(d.tasks).map(function (g) {
              return card(U.fh('list', g.room) + g.tasks.map(function (t) {
                return htmlRow('<div class="bhm-task' + (t.checked ? '' : ' is-no') + '">' + (t.checked ? '<span class="bhp-ic bhm-ok">' + I.checkFill + '</span>' : '<span class="bhm-box"></span>') + '<span>' + esc(t.name) + '</span></div>');
              }).join(''));
            }).join('');
          }
          if (d.photos.length) {
            h += U.label(pl(d.photos.length, 'photo'));
            h += '<div class="bhm-photos">' + d.photos.map(function (p, i) { return '<button class="bhm-ph" data-act="ph" data-i="' + i + '"><img src="' + esc(p) + '" alt="" loading="lazy"></button>'; }).join('') + '</div>';
          }
          if (d.notes) h += U.label('Note de l\'intervenante') + card(htmlRow('<div class="bhp-txt">' + esc(d.notes) + '</div>'));
          if (st.tickets.length) {
            h += U.label('Signalements');
            h += card(st.tickets.map(function (t) {
              var kind = String(t.kind || '') === 'damage' ? 'Dégradation' : 'Maintenance';
              var pr = { urgent: 'urgent', high: 'haute', normal: 'normale', low: 'basse' }[t.priority] || t.priority || '';
              return htmlRow('<div class="bhm-ac__top"><div class="bhm-ac__txt"><div style="font-size:15px;font-weight:600">' + esc(t.title || '—') + '</div><div class="bhp-meta">' + esc(kind + (pr ? ' · priorité ' + pr : '')) + '</div>'
                + (t.description ? '<div class="bhp-body13" style="margin-top:4px">' + esc(t.description) + '</div>' : '') + '</div>' + (String(t.status) === 'resolved' ? U.pill('résolu', 'vert') : U.pill('ouvert', 'or')) + '</div>'
                + (Array.isArray(t.photos) && t.photos.length ? '<div class="bhm-photos bhm-photos--s">' + t.photos.map(function (p) { return '<a class="bhm-ph" href="' + esc(p) + '" target="_blank" rel="noopener"><img src="' + esc(p) + '" alt=""></a>'; }).join('') + '</div>' : ''));
            }).join(''));
          }
          if (d.cleanerCertified) {
            h += U.label('Certification');
            h += card(htmlRow((d.signatureData ? '<div class="bhm-sig"><img src="' + esc(d.signatureData) + '" alt="Signature"></div>' : '')
              + '<div class="bhp-meta" style="margin-top:8px">Certifié par ' + esc(d.cleanerName || 'l\'intervenante') + (d.certifiedAt ? ' le ' + esc(new Date(d.certifiedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })) : '') + '</div>'));
          }
          if (canManage && !isSub && d.ownerStatus === 'pending') {
            h += '<button class="bhp-btn bhp-btn--primary" data-act="dv-validate"' + (st.acting ? ' disabled' : '') + '>' + (st.acting ? '<span class="bhp-spin bhp-spin--w"></span>' : ic('checkFill')) + 'Valider le ménage</button>';
            h += '<button class="bhp-btn bhp-btn--danger" data-act="dv-reject"' + (st.acting ? ' disabled' : '') + '>Demander un complément</button>';
          }
          if (d.cleanerCertified) h += '<button class="bhp-btn bhp-btn--ghost" data-act="dv-pdf">' + ic('doc') + 'Rapport certifié (PDF)</button>';
        }
        sh.body.innerHTML = '<div class="bhp-stack">' + h + '</div>';
      }
      sh.body.addEventListener('click', function (e) {
        var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
        var act = el.dataset.act;
        if (act === 'ph') return lightbox(st.d.photos, +el.dataset.i);
        if (act === 'dv-validate') {
          st.acting = true; r2();
          U.api('PUT', '/api/cleaning/checklists/' + encodeURIComponent(st.d.id) + '/validate', {})
            .then(function (r) { if (r && r.checklist) st.d = normDetail(r.checklist); else st.d.ownerStatus = 'validated'; })
            .catch(function (er) { U.alertMsg('Erreur', er.message); }).then(function () { st.acting = false; r2(); load(); });
        }
        if (act === 'dv-reject') openReject(st.d.id, function (r) { if (r && r.checklist) st.d = normDetail(r.checklist); else st.d.ownerStatus = 'rejected'; r2(); });
        if (act === 'dv-pdf') {
          var w = window.open('', '_blank');
          var f = typeof window.authFetch === 'function' ? window.authFetch : fetch;
          f('/api/cleaning/checklists/' + encodeURIComponent(st.d.id) + '/pdf').then(function (res) { if (!res.ok) throw new Error('PDF indisponible.'); return res.blob(); })
            .then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else window.location = u; })
            .catch(function (er) { if (w) w.close(); U.alertMsg('Erreur', er.message); });
        }
      });
      r2();
      if (ref.checklistId) {
        Promise.all([
          U.api('GET', '/api/cleaning/checklists/' + encodeURIComponent(ref.checklistId)),
          U.api('GET', '/api/maintenance/tickets').catch(function () { return {}; })
        ]).then(function (r) {
          st.d = normDetail(r[0].checklist || r[0]);
          var all = r[1].tickets || (Array.isArray(r[1]) ? r[1] : []);
          var key = st.d.reservationKey;
          st.tickets = key ? all.filter(function (t) { return (t.reservationKey || t.reservation_key) === key; }) : [];
          st.phase = st.d.completedAt ? 'loaded' : 'none';
          r2();
        }).catch(function (er) { st.phase = 'error'; st.err = er.status === 401 ? 'Non autorisé' : 'Chargement impossible'; r2(); });
      } else {
        st.phase = 'none'; r2();
        if (!ref.propertyId) { st.templateMissing = true; r2(); return; }
        U.api('GET', '/api/cleaning/templates?propertyId=' + encodeURIComponent(ref.propertyId)).then(function (r) {
          var ts = r.templates || [];
          var t = ts.filter(function (x) { return String(x.property_id || x.propertyId || '') === String(ref.propertyId); })[0]
            || ts.filter(function (x) { return x.is_default || x.isDefault; })[0] || ts.filter(function (x) { return !(x.property_id || x.propertyId); })[0];
          if (t) { var tasks = typeof t.tasks === 'string' ? JSON.parse(t.tasks) : (t.tasks || []); st.expected = normDetail({ tasks: tasks }).tasks; } else st.templateMissing = true;
        }).catch(function () { st.templateMissing = true; }).then(r2);
      }
    }
    function lightbox(photos, i) {
      var ov = document.createElement('div');
      ov.className = 'bhm-lb';
      function draw() {
        ov.innerHTML = '<img src="' + esc(photos[i]) + '" alt=""><button class="bhm-lb__x" data-x aria-label="Fermer">' + I.xsmall + '</button>'
          + (photos.length > 1 ? '<button class="bhm-lb__p" data-p aria-label="Précédente">' + I.chevL + '</button><button class="bhm-lb__n" data-n aria-label="Suivante">' + I.chevR + '</button><span class="bhm-lb__c">' + (i + 1) + ' / ' + photos.length + '</span>' : '');
      }
      draw();
      ov.addEventListener('click', function (e) {
        if (e.target.closest('[data-p]')) { i = (i - 1 + photos.length) % photos.length; draw(); return; }
        if (e.target.closest('[data-n]')) { i = (i + 1) % photos.length; draw(); return; }
        if (e.target.closest('[data-x]') || e.target === ov) { ov.remove(); document.removeEventListener('keydown', key); }
      });
      function key(e) { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', key); } if (e.key === 'ArrowRight') { i = (i + 1) % photos.length; draw(); } if (e.key === 'ArrowLeft') { i = (i - 1 + photos.length) % photos.length; draw(); } }
      document.addEventListener('keydown', key);
      document.body.appendChild(ov);
    }

    /* ── « + » : assigner les départs à venir / ajouter un intervenant (mêmes routes que cleaning.html) ── */
    function openAssign() {
      var sh = U.openSheet({ head: { title: 'Assigner les ménages', kicker: '30 prochains jours', right: '<button class="bhp-textbtn" data-act="sheet-close">OK</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack">' + card(U.loadingRow()) + '</div>';
      var today = ymd(new Date()), max = ymd(addDays(new Date(), 30));
      Promise.all([
        U.api('GET', '/api/reservations'), U.api('GET', '/api/cleaning/assignments').catch(function () { return {}; }),
        U.api('GET', '/api/properties').catch(function () { return {}; })
      ]).then(function (r) {
        var names = {}; ((r[2].properties || (Array.isArray(r[2]) ? r[2] : [])).map(U.normProperty)).forEach(function (p) { names[p.id] = U.dname(p); });
        var cur = {}; (r[1].assignments || (Array.isArray(r[1]) ? r[1] : [])).map(normAssign).forEach(function (a) { if (a.reservationKey) cur[a.reservationKey] = a.cleanerId; });
        var deps = (r[0].reservations || (Array.isArray(r[0]) ? r[0] : [])).map(function (x) {
          var pid = pick(x, 'propertyId', 'property_id'), st = String(pick(x, 'startDate', 'start_date', 'start') || '').slice(0, 10), en = String(pick(x, 'endDate', 'end_date', 'end') || '').slice(0, 10);
          var type = String(pick(x, 'type', 'source', 'platform') || '');
          if (pid == null || !st || !en || U.bool(pick(x, 'isBlock', 'is_block')) === true || /^block(ed)?$/i.test(type) || /cancel/i.test(String(x.status || ''))) return null;
          return { key: pid + '_' + st + '_' + en, pid: String(pid), end: en, guest: x.guestName || x.guest_name || 'Voyageur', name: names[String(pid)] || x.propertyName || String(pid) };
        }).filter(function (d) { return d && d.end >= today && d.end <= max; }).sort(function (a, b) { return a.end < b.end ? -1 : a.end > b.end ? 1 : 0; });
        var seen = {}; deps = deps.filter(function (d) { if (seen[d.key]) return false; seen[d.key] = 1; return true; });
        var active = S.cleaners.filter(function (c) { return c.isActive; });
        if (!active.length) { sh.body.innerHTML = '<div class="bhp-stack"><div class="bhm-empty">' + ic('user') + '<span>Ajoutez d\'abord un intervenant.</span><button class="bhm-call" data-x="new">Ajouter un intervenant</button></div></div>'; return; }
        if (!deps.length) { sh.body.innerHTML = '<div class="bhp-stack"><div class="bhm-empty">' + ic('calendar') + '<span>Aucun départ dans les 30 prochains jours.</span></div></div>'; return; }
        var opts = function (sel) { return '<option value="">Non assigné</option>' + active.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join(''); };
        var by = {}; deps.forEach(function (d) { (by[d.end] = by[d.end] || []).push(d); });
        sh.body.innerHTML = '<div class="bhp-stack"><p class="bhp-note" style="font-size:14px">Choisissez qui fait le ménage après chaque départ. C\'est enregistré tout de suite.</p>' + Object.keys(by).map(function (day) {
          return '<div class="bhp-group">' + U.label(dayLabel(day)) + card(by[day].map(function (d) {
            return '<div class="bhp-row bhp-kv"><div class="bhm-cl__t"><div class="bhm-cl__n">' + esc(d.name) + '</div><div class="bhp-meta">Départ de ' + esc(d.guest) + '</div></div>'
              + '<select class="bhp-input bhp-select" data-key="' + esc(d.key) + '" data-pid="' + esc(d.pid) + '">' + opts(cur[d.key] ? String(cur[d.key]) : '') + '</select></div>';
          }).join('')) + '</div>';
        }).join('') + '</div>';
      }).catch(function (e) { sh.body.innerHTML = '<div class="bhp-stack">' + U.warn(e.message, true) + '</div>'; });
      sh.body.addEventListener('change', function (e) {
        var t = e.target; if (!t.dataset.key) return;
        t.disabled = true;
        U.api('POST', '/api/cleaning/assignments', { reservationKey: t.dataset.key, propertyId: t.dataset.pid, cleanerId: t.value || null })
          .then(function () { t.style.borderColor = 'rgba(46,139,98,.6)'; })
          .catch(function (er) { U.alertMsg('Erreur', er.message); }).then(function () { t.disabled = false; });
      });
      sh.body.addEventListener('click', function (e) { if (e.target.closest('[data-x="new"]')) { sh.close(); openNewCleaner(); } });
      var prevClose = sh.close; sh.close = function () { prevClose(); load(); };
    }
    function openNewCleaner() {
      var sh = U.openSheet({ head: { title: 'Nouvel intervenant', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close">Annuler</button>', right: '<button class="bhp-textbtn bhp-textbtn--vert" style="font-weight:600" data-act="go">Ajouter</button>' } });
      sh.body.innerHTML = '<div class="bhp-stack">' + card('<div class="bhp-row"><input class="bhp-input" data-f="name" placeholder="Nom (obligatoire)"></div>'
        + '<div class="bhp-row"><input class="bhp-input" data-f="phone" type="tel" placeholder="Téléphone"></div><div class="bhp-row"><input class="bhp-input" data-f="email" type="email" placeholder="Email"></div>'
        + '<div class="bhp-row"><textarea class="bhp-input bhp-ta" data-f="notes" rows="2" placeholder="Notes"></textarea></div>') + '<p class="bhp-note">L\'intervenant reçoit un code PIN pour remplir ses checklists de ménage.</p></div>';
      sh.el.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="go"]') || sh.locked) return;
        var v = function (f) { return sh.body.querySelector('[data-f="' + f + '"]').value.trim(); };
        if (!v('name')) { U.alertMsg('Nom requis', 'Indiquez le nom de l\'intervenant.'); return; }
        sh.locked = true;
        U.api('POST', '/api/cleaners', { name: v('name'), phone: v('phone') || null, email: v('email') || null, notes: v('notes') || null, isActive: true }).then(function () { sh.locked = false; sh.close(); load(); })
          .catch(function (er) { sh.locked = false; U.alertMsg('Erreur', er.message); });
      });
    }

    /* ── Délégation ── */
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-stop]')) return;
      var el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
      var act = el.dataset.act;
      if (act === 'back') { location.href = '/manage.html'; return; }
      if (act === 'add') {
        if (!canManage) return;
        U.openMenu(el, [
          { label: 'Assigner un ménage', icon: 'calendar', onClick: openAssign },
          { label: 'Ajouter un intervenant', icon: 'user', onClick: openNewCleaner }
        ]);
        return;
      }
      if (act === 'retry') return load();
      if (act === 'period') { S.period = el.dataset.v; history.replaceState(null, '', location.pathname + (S.period === 'today' ? '' : '?vue=' + S.period)); render(); window.scrollTo(0, 0); return; }
      if (act === 'hfilter') { var v = el.dataset.v || null; S.histFilter = (v === S.histFilter) ? null : v; render(); return; }
      if (act === 'validate') { e.stopPropagation(); return validate(S.toValidate[+el.dataset.i]); }
      if (act === 'reject') { e.stopPropagation(); return openReject(S.toValidate[+el.dataset.i].id); }
      if (act === 'detail') {
        var list = el.dataset.list, i = el.dataset.i, ref;
        if (list === 'tight' || list === 'wide') { var a = (list === 'tight' ? S.tight : S.wide)[+i]; ref = { propertyId: a.propertyId, name: a.name, cleanerName: a.cleanerName, day: a.day, windowStart: a.windowStart, windowEnd: a.windowEnd, checklistId: a.checklistId }; }
        else if (list === 'wt' || list === 'ww') { var gi = +i.split(':')[0], ii = +i.split(':')[1], g = S.week[gi], b = (list === 'wt' ? g.tight : g.wide)[ii]; ref = { propertyId: b.propertyId, name: b.name, cleanerName: b.cleanerName, day: b.day, windowStart: b.windowStart, windowEnd: b.windowEnd, checklistId: b.checklistId }; }
        else if (list === 'validate') { var c = S.toValidate[+i]; ref = { propertyId: c.propertyId, name: c.name, cleanerName: c.cleanerName, day: keyDay(c.reservationKey) || (c.completedAt || '').slice(0, 10), checklistId: c.id }; }
        else { var hI = S.history[+i]; ref = { propertyId: hI.propertyId, name: hI.name, cleanerName: hI.cleanerName, day: hI.day, checklistId: hI.checklistId }; }
        openDetail(ref);
      }
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.state === 'loaded') load(); });
    load();
  };
})();
