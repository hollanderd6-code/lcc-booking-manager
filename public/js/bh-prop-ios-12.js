/* bh-prop-ios-12.js — Gestion › Logements, parité avec l'app iOS (Boostinghost-ios)
   - BHP.initList()      → /properties.html  (PropertiesView.swift)
   - BHP.initProperty()  → /property.html?id=…[&section=…]  (PropertyDetailView.swift + 9 blocs)
   Sections : identity · stay · money · upsell · access · neighborhood · amenities · ai · platforms
   Feuilles : nouveau logement, dupliquer, connecter à la diffusion, gérer la diffusion, lien iCal */
(function () {
  'use strict';
  var BHP = window.BHP = window.BHP || {};

  /* ════════════════ Utilitaires ════════════════ */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pick(o) {
    if (!o) return undefined;
    for (var i = 1; i < arguments.length; i++) {
      var v = o[arguments[i]];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }
  function num(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
    return isNaN(n) ? null : n;
  }
  function int(v) { var n = num(v); return n == null ? null : Math.round(n); }
  function bool(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'boolean') return v;
    var s = String(v).toLowerCase();
    if (s === 'true' || s === '1' || s === 't' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'f' || s === 'no') return false;
    return null;
  }
  function parseJSON(v) {
    if (v == null) return null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      try { return JSON.parse(s); } catch (e) { return null; }
    }
    return v;
  }
  function str(v) { return (v == null || v === '') ? null : String(v); }
  function numStr(v) { return v == null ? '' : (Math.round(v) === v ? String(v) : String(v)); }
  function intStr(v) { return v == null ? '' : String(v); }
  function pl(n, w, suf) { return n + ' ' + w + (n === 1 ? '' : (suf == null ? 's' : suf)); }
  function lines(v) { return String(v || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function hhmm(v) {
    if (!v) return null;
    var m = String(v).match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/);
    if (!m) return null;
    var h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 23 || mi > 59) return null;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function fmtTime(v) {
    var t = hhmm(v);
    if (!t) return null;
    var h = +t.slice(0, 2), m = +t.slice(3);
    return m ? h + ' h ' + (m < 10 ? '0' : '') + m : h + ' h';
  }
  var nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  function fmtAmount(n) { return nf.format(n) + '\u00a0€'; }
  function fmtPct(v) { return (Math.round(v) === v ? String(v) : nf.format(v)); }
  function duration(min) {
    if (!min || min <= 0) return '—';
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' min';
    return m ? h + ' h ' + m + ' min' : h + ' h';
  }
  function validHex(c) { return c && /^#?[0-9a-f]{6}$/i.test(String(c).trim()) ? ('#' + String(c).trim().replace('#', '')).toUpperCase() : null; }
  function setPath(obj, path, val) {
    var parts = path.split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i], nk = parts[i + 1];
      if (o[k] == null) o[k] = /^\d+$/.test(nk) ? [] : {};
      o = o[k];
    }
    o[parts[parts.length - 1]] = val;
  }
  function collect(root, draft) {
    if (!root || !draft) return draft;
    root.querySelectorAll('[data-k]').forEach(function (el) {
      var v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.dataset.type === 'nbool') v = el.value === '' ? null : el.value === 'true';
      else v = el.value;
      setPath(draft, el.dataset.k, v);
    });
    return draft;
  }
  function isSubAccount() {
    return localStorage.getItem('lcc_is_sub_account') === 'true' || localStorage.getItem('lcc_account_type') === 'sub';
  }
  function subPermissions() {
    var perms = {};
    try { var sd = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}'); if (sd.permissions) perms = sd.permissions; } catch (e) {}
    try { var pd = localStorage.getItem('lcc_permissions'); if (pd) perms = Object.assign(JSON.parse(pd), perms); } catch (e) {}
    return perms;
  }
  function relTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "il y a moins d'une minute";
    if (diff < 3600) { var m = Math.floor(diff / 60); return 'il y a ' + pl(m, 'minute'); }
    if (diff < 86400) { var h = Math.floor(diff / 3600); return 'il y a ' + pl(h, 'heure'); }
    return 'le ' + d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase();
  }

  /* ════════════════ API ════════════════ */
  function api(method, url, body) {
    var init = { method: method, headers: {} };
    if (typeof FormData !== 'undefined' && body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var f = (typeof window.authFetch === 'function' && !(typeof FormData !== 'undefined' && body instanceof FormData)) ? window.authFetch : fetch;
    return f(url, init).catch(function () { throw new Error('Erreur réseau. Vérifiez votre connexion.'); })
      .then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var msg = (data && (data.error || data.message || data.avertissement)) || ('Erreur serveur (' + res.status + ')');
            if (res.status === 401) msg = 'Session expirée. Reconnectez-vous.';
            var err = new Error(msg); err.status = res.status; err.data = data; throw err;
          }
          return data || {};
        });
      });
  }

  /* ════════════════ Modèle (Property.swift) ════════════════ */
  var PLATFORM_COLORS = { airbnb: '#FF5A5F', booking: '#003580', expedia: '#FFC72C', vrbo: '#1A5276', direct: '#0E3B2E', bloque: '#9CA3AF' };
  function pnorm(s) { return String(s || '').toLowerCase().replace(/[\s_]/g, ''); }
  function platformColor(name) {
    var k = pnorm(name);
    if (k.indexOf('bhguest') >= 0 || k.indexOf('guestapp') >= 0) return '#A8452A';
    if (k === 'airbnb') return PLATFORM_COLORS.airbnb;
    if (k === 'booking' || k === 'booking.com' || k === 'bookingcom') return PLATFORM_COLORS.booking;
    if (k === 'expedia' || k === 'expediacom') return PLATFORM_COLORS.expedia;
    if (k === 'vrbo' || k === 'abritel') return PLATFORM_COLORS.vrbo;
    if (k === 'direct' || k === 'manuel' || k === 'manual') return PLATFORM_COLORS.direct;
    return PLATFORM_COLORS.bloque;
  }
  function guessPlatform(url) {
    var u = String(url || '').toLowerCase();
    if (u.indexOf('airbnb') >= 0) return 'Airbnb';
    if (u.indexOf('booking') >= 0) return 'Booking.com';
    if (u.indexOf('abritel') >= 0 || u.indexOf('vrbo') >= 0 || u.indexOf('homeaway') >= 0) return 'Abritel';
    if (u.indexOf('expedia') >= 0) return 'Expedia';
    return 'iCal';
  }
  var AMEN_KEYS = [
    ['draps', 'draps', 'Draps fournis', 'draps'],
    ['serviettes', 'serviettes', 'Serviettes fournies', 'serviettes'],
    ['cuisineEquipee', 'cuisine_equipee', 'Cuisine équipée', 'cuisine'],
    ['laveLinge', 'lave_linge', 'Lave-linge', 'lave-linge'],
    ['laveVaisselle', 'lave_vaisselle', 'Lave-vaisselle', 'lave-vaisselle'],
    ['television', 'television', 'Télévision', 'TV'],
    ['parking', 'parking', 'Parking', 'parking'],
    ['climatisation', 'climatisation', 'Climatisation', 'clim']
  ];
  var RULE_KEYS = [['animaux', 'Animaux'], ['fumeurs', 'Fumeurs'], ['fetes', 'Fêtes'], ['enfants', 'Enfants']];
  var UPSELL_MAP = [
    ['lateCheckoutEnabled', 'late_checkout_enabled', bool], ['lateCheckoutToleranceMinutes', 'late_checkout_tolerance_minutes', int],
    ['lateCheckoutPricePerHour', 'late_checkout_price_per_hour', num], ['lateCheckoutMaxMinutes', 'late_checkout_max_minutes', int],
    ['earlyCheckinEnabled', 'early_checkin_enabled', bool], ['earlyCheckinToleranceMinutes', 'early_checkin_tolerance_minutes', int],
    ['earlyCheckinPricePerHour', 'early_checkin_price_per_hour', num], ['earlyCheckinMaxMinutes', 'early_checkin_max_minutes', int],
    ['welcomeBasketEnabled', 'welcome_basket_enabled', bool], ['welcomeBasketPrice', 'welcome_basket_price', num],
    ['welcomeBasketDescription', 'welcome_basket_description', str]
  ];

  function normProperty(raw) {
    var r = raw || {};
    if (r.property && typeof r.property === 'object') r = r.property;
    function g() { return pick.apply(null, [r].concat([].slice.call(arguments))); }
    var p = { _raw: r };
    p.id = String(g('_id', 'id') || '');
    p.name = g('name') || '';
    p.internalName = str(g('internalName', 'internal_name'));
    p.color = str(g('color'));
    p.address = str(g('address'));
    p.photoUrl = str(g('photoUrl', 'photo_url', 'photo'));
    p.maxGuests = int(g('maxGuests', 'max_guests', 'capacity'));
    p.bedrooms = int(g('bedrooms'));
    p.beds = int(g('beds'));
    p.bathrooms = int(g('bathrooms'));
    p.arrivalTime = str(g('arrivalTime', 'arrival_time'));
    p.departureTime = str(g('departureTime', 'departure_time'));
    p.minNights = int(g('minNights', 'min_nights'));
    p.basePrice = num(g('basePrice', 'base_price'));
    p.weekendPrice = num(g('weekendPrice', 'weekend_price'));
    p.cleaningFee = num(g('cleaningFee', 'cleaning_fee'));
    p.touristTax = num(g('touristTaxPerNight', 'tourist_tax_per_night', 'touristTax', 'tourist_tax'));
    p.depositAmount = num(g('depositAmount', 'deposit_amount'));
    p.depositReleaseDays = int(g('depositReleaseDays', 'deposit_release_days'));
    p.conciergePct = num(g('conciergePct', 'concierge_pct', 'conciergeCommission', 'concierge_commission'));
    p.airbnbCommissionPct = num(g('airbnbCommissionPct', 'airbnb_commission_pct', 'airbnbCommission', 'airbnb_commission'));
    p.bookingCommissionPct = num(g('bookingCommissionPct', 'booking_commission_pct', 'bookingCommission', 'booking_commission'));
    p.accessCode = str(g('accessCode', 'access_code'));
    p.accessInstructions = str(g('accessInstructions', 'access_instructions'));
    p.wifiName = str(g('wifiName', 'wifi_name'));
    p.wifiPassword = str(g('wifiPassword', 'wifi_password'));
    var oid = g('ownerId', 'owner_id');
    p.ownerId = (oid == null || oid === '') ? null : String(oid);
    p.welcomeBookUrl = str(g('welcomeBookUrl', 'welcome_book_url', 'welcomeUrl', 'welcome_url'));
    p.autoResponsesEnabled = bool(g('autoResponsesEnabled', 'auto_responses_enabled'));
    p.channexEnabled = bool(g('channexEnabled', 'channex_enabled'));
    p.channexPropertyId = str(g('channexPropertyId', 'channex_property_id'));
    p.lastIcalSyncAt = str(g('lastIcalSyncAt', 'last_ical_sync_at'));
    p.icalSyncStatus = parseJSON(g('icalSyncStatus', 'ical_sync_status')) || {};
    var ic = parseJSON(g('icalUrls', 'ical_urls'));
    p.icalUrls = (Array.isArray(ic) ? ic : []).map(function (it) {
      if (typeof it === 'string') return { url: it, platform: guessPlatform(it) };
      if (it && typeof it === 'object') return { url: String(it.url || ''), platform: String(it.platform || guessPlatform(it.url)) };
      return null;
    }).filter(function (e) { return e && e.url; });

    var am = parseJSON(g('amenities'));
    p.amenities = null;
    if (Array.isArray(am)) {
      p.amenities = { custom: [] };
      am.forEach(function (x) {
        if (typeof x !== 'string') return;
        var found = AMEN_KEYS.filter(function (k) { return k[0] === x || k[1] === x; })[0];
        if (found) p.amenities[found[0]] = true; else p.amenities.custom.push(x);
      });
    } else if (am && typeof am === 'object') {
      p.amenities = { custom: Array.isArray(am.custom) ? am.custom.filter(Boolean).map(String) : [] };
      AMEN_KEYS.forEach(function (k) { p.amenities[k[0]] = bool(pick(am, k[0], k[1])); });
    }
    var hr = parseJSON(g('houseRules', 'house_rules'));
    p.houseRules = null;
    if (hr && typeof hr === 'object' && !Array.isArray(hr)) {
      p.houseRules = { custom: Array.isArray(hr.custom) ? hr.custom.filter(Boolean).map(String) : [] };
      RULE_KEYS.forEach(function (k) { p.houseRules[k[0]] = bool(hr[k[0]]); });
    }
    var pi = parseJSON(g('practicalInfo', 'practical_info'));
    p.practicalInfo = (pi && typeof pi === 'object') ? {
      parkingDetails: str(pick(pi, 'parking_details', 'parkingDetails')),
      trashDay: str(pick(pi, 'trash_day', 'trashDay')),
      nearbyShops: str(pick(pi, 'nearby_shops', 'nearbyShops')),
      publicTransport: str(pick(pi, 'public_transport', 'publicTransport'))
    } : null;
    p.arrivalMessage = str(g('arrivalMessage', 'arrival_message'));
    var car = parseJSON(g('customAutoResponses', 'custom_auto_responses'));
    p.customAutoResponses = (Array.isArray(car) ? car : []).map(function (x) {
      return { keywords: String((x && (x.keywords || x.keyword)) || ''), response: String((x && (x.response || x.answer)) || '') };
    });
    var qr = parseJSON(g('quickReplies', 'quick_replies'));
    p.quickReplies = (Array.isArray(qr) ? qr : []).map(function (x) {
      return { title: String((x && x.title) || ''), text: String((x && x.text) || '') };
    });
    UPSELL_MAP.forEach(function (m) { p[m[0]] = m[2](g(m[0], m[1])); });
    p.externalPricing = bool(g('externalPricing', 'external_pricing'));
    return p;
  }
  function mergeUpsell(p, src, snake) {
    if (!src) return p;
    UPSELL_MAP.forEach(function (m) {
      if (p[m[0]] == null) { var v = snake ? src[m[1]] : src[m[0]]; if (v == null && snake) v = src[m[0]]; p[m[0]] = m[2](v); }
    });
    return p;
  }
  function dname(p) { return p.internalName || p.name || '(sans nom)'; }
  function hasAmen(a) { return !!a && AMEN_KEYS.some(function (k) { return a[k[0]] === true; }); }
  function rulesDefined(r) { return !!r && RULE_KEYS.some(function (k) { return r[k[0]] != null; }); }
  function piHasAny(pi) { return !!pi && ['parkingDetails', 'trashDay', 'nearbyShops', 'publicTransport'].some(function (k) { return !!pi[k]; }); }
  function livretBlocks(p) {
    var n = 0;
    if (p.accessCode || p.wifiName || p.wifiPassword || p.accessInstructions) n++;
    if (piHasAny(p.practicalInfo)) n++;
    if (hasAmen(p.amenities) || (p.amenities && p.amenities.custom.length) || rulesDefined(p.houseRules) || (p.houseRules && p.houseRules.custom.length)) n++;
    return n;
  }
  function connState(p) {
    var ota = p.channexEnabled === true && !!p.channexPropertyId;
    var ical = p.icalUrls.length > 0;
    if (ota && ical) return { label: 'OTA · iCal', cls: 'ota', ok: true };
    if (ota) return { label: 'OTA', cls: 'ota', ok: true };
    if (ical) return { label: 'iCal', cls: 'ical', ok: true };
    return { label: 'Non relié', cls: 'none', ok: false };
  }
  function clientName(c) {
    var cn = c.company_name || c.companyName;
    if (cn) return cn;
    var parts = [c.first_name || c.firstName, c.last_name || c.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : 'Client sans nom';
  }
  function clientId(c) { return String(c.original_id || c.originalId || c.id || '').replace('agency_client_', ''); }

  /* ════════════════ Icônes (équivalents SF Symbols) ════════════════ */
  function S(d, fill) { return '<svg class="bhp-svg" viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="' + (fill ? 'none' : 'currentColor') + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  var I = {
    chevL: S('<polyline points="15 18 9 12 15 6"/>'),
    chevR: S('<polyline points="9 18 15 12 9 6"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    ellipsis: S('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>', true),
    book: S('<path d="M2 4.5h6a4 4 0 0 1 4 4V20a3 3 0 0 0-3-3H2z"/><path d="M22 4.5h-6a4 4 0 0 0-4 4V20a3 3 0 0 1 3-3h7z"/>'),
    compass: S('<circle cx="12" cy="12" r="9.5"/><polygon points="15.8 8.2 13.6 13.6 8.2 15.8 10.4 10.4"/>'),
    share: S('<path d="M8 9H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/><path d="M12 3v12M8 7l4-4 4 4"/>'),
    idcard: S('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h4.5M14.5 14h3.5"/>'),
    clock: S('<circle cx="12" cy="12" r="9.5"/><polyline points="12 7 12 12 15.5 14"/>'),
    euro: S('<circle cx="12" cy="12" r="9.5"/><path d="M15.5 8.6a4 4 0 1 0 0 6.8M7.5 11h6M7.5 13.4h5"/>'),
    gift: S('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
    key: S('<circle cx="7.5" cy="15.5" r="5"/><path d="M11 12 21 2M16 7l3 3M18.5 4.5l2 2"/>'),
    map: S('<polygon points="2 6 2 22 8 18 16 22 22 18 22 2 16 6 8 2 2 6"/><path d="M8 2v16M16 6v16"/>'),
    list: S('<path d="M8.5 6H21M8.5 12H21M8.5 18H21"/><circle cx="4" cy="6" r="1.1" fill="currentColor"/><circle cx="4" cy="12" r="1.1" fill="currentColor"/><circle cx="4" cy="18" r="1.1" fill="currentColor"/>'),
    sparkles: S('<path d="M12 4.5l1.8 4.7 4.7 1.8-4.7 1.8L12 17.5l-1.8-4.7L5.5 11l4.7-1.8z"/><path d="M5.5 2.5v3M4 4h3M19 16.5v4M17 18.5h4"/>'),
    antenna: S('<circle cx="12" cy="12" r="1.8"/><path d="M12 13.8V22M15.5 8.5a5 5 0 0 1 0 7M8.5 15.5a5 5 0 0 1 0-7M18.4 5.6a9 9 0 0 1 0 12.8M5.6 18.4a9 9 0 0 1 0-12.8"/>'),
    antennaOff: S('<circle cx="12" cy="12" r="1.8"/><path d="M12 13.8V22M15.5 8.5a5 5 0 0 1 0 7M8.5 15.5a5 5 0 0 1 0-7M18.4 5.6a9 9 0 0 1 0 12.8M5.6 18.4a9 9 0 0 1 0-12.8M3 3l18 18"/>'),
    checkFill: '<svg class="bhp-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M7.4 12.4l3.1 3.1 6.1-6.6" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    xFill: '<svg class="bhp-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plusFill: '<svg class="bhp-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M12 7.5v9M7.5 12h9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    minusFill: '<svg class="bhp-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M7.5 12h9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warnFill: '<svg class="bhp-svg" viewBox="0 0 24 24"><path d="M10.3 3.6 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" fill="currentColor"/><path d="M12 9v4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#fff"/></svg>',
    errFill: '<svg class="bhp-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><path d="M12 7v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.2" fill="#fff"/></svg>',
    info: S('<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5M12 8h.01"/>'),
    copy: S('<rect x="9" y="9" width="12.5" height="12.5" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>'),
    sync: S('<path d="M20.5 12a8.5 8.5 0 0 1-15 5.5L3.5 15.5M3.5 20.5v-5h5M3.5 12a8.5 8.5 0 0 1 15-5.5l2 2M20.5 3.5v5h-5"/>'),
    trash: S('<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2"/>'),
    pencil: S('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    text: S('<path d="M4 7V5h16v2M9 19h6M12 5v14"/>'),
    tag: S('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/>'),
    dot: S('<circle cx="12" cy="12" r="6"/>', true),
    pin: S('<path d="M20 10c0 6.5-8 12-8 12s-8-5.5-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
    users: S('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
    user: S('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    photo: S('<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>'),
    calendar: S('<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>'),
    mail: S('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M22 7l-10 6.5L2 7"/>'),
    bed: S('<path d="M2 5v15M2 9h16a4 4 0 0 1 4 4v7M2 16h20M6.5 9v7"/>'),
    shield: S('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><rect x="9.2" y="10.5" width="5.6" height="4.5" rx="1"/><path d="M10.3 10.5V9a1.7 1.7 0 0 1 3.4 0v1.5"/>'),
    percent: S('<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
    building: S('<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 13v.01M9 17v.01"/>'),
    moon: S('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    sunrise: S('<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>'),
    wifi: S('<path d="M5 12.5a10 10 0 0 1 14 0M1.5 9a15 15 0 0 1 21 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1.1" fill="currentColor"/>'),
    align: S('<path d="M17 10H3M21 6H3M21 14H3M17 18H3"/>'),
    parking: S('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>'),
    store: S('<path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6"/>'),
    bus: S('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M7.5 21v-3M16.5 21v-3"/><circle cx="8" cy="14.5" r=".9" fill="currentColor"/><circle cx="16" cy="14.5" r=".9" fill="currentColor"/>'),
    house: S('<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
    hand: S('<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>'),
    check: S('<polyline points="20 6 9 17 4 12"/>'),
    xmark: S('<path d="M18 6 6 18M6 6l12 12"/>'),
    qbubble: S('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.6 8.4a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5M12 14.2h.01"/>'),
    brain: S('<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'),
    bolt: S('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
    chart: S('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
    envOpen: S('<path d="M21.5 10v9.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V10l9.5-7z"/><path d="M21.5 10 12 16 2.5 10"/>'),
    xsmall: S('<path d="M17 7 7 17M7 7l10 10"/>'),
    phone: S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
    doc: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
    wifiOff: S('<path d="M2 2l20 20M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M1.5 9a15 15 0 0 1 4.3-2.8M19 12.5a10 10 0 0 0-2-1.5M22.5 9a15 15 0 0 0-11-4"/>')
  };
  function ic(name, cls) { return '<span class="bhp-ic ' + (cls || '') + '">' + (I[name] || '') + '</span>'; }
  var CHEV = '<span class="bhp-ic bhp-chev">' + I.chevR + '</span>';
  var SPIN = '<span class="bhp-spin"></span>';

  /* ════════════════ Briques UI ════════════════ */
  function navHTML(o) {
    return '<header class="bhp-nav"><div class="bhp-nav__bar">'
      + '<div class="bhp-nav__side">' + (o.left || '') + '</div>'
      + '<div class="bhp-nav__center">'
      + (o.kicker !== undefined ? '<div class="bhp-nav__kicker">' + (o.kicker ? esc(o.kicker) : '&#160;') + '</div>' : '')
      + '<div class="bhp-nav__title">' + esc(o.title) + '</div></div>'
      + '<div class="bhp-nav__side bhp-nav__side--r">' + (o.right || '') + '</div>'
      + '</div>' + (o.below || '') + '</header>';
  }
  function circleBtn(icon, act, label, muted) { return '<button class="bhp-circle' + (muted ? ' bhp-circle--muted' : '') + '" data-act="' + act + '" aria-label="' + esc(label) + '">' + I[icon] + '</button>'; }
  function glassBtn(label, act, opts) {
    opts = opts || {};
    return '<button class="bhp-glassbtn' + (opts.medium ? ' bhp-glassbtn--m' : '') + '" data-act="' + act + '"' + (opts.disabled ? ' disabled' : '') + '>' + (opts.spin ? '<span class="bhp-spin bhp-spin--v"></span>' : esc(label)) + '</button>';
  }
  function card(inner, cls, attrs) { return '<div class="bhp-card ' + (cls || '') + '"' + (attrs || '') + '>' + inner + '</div>'; }
  function fh(icon, label) { return '<div class="bhp-row bhp-fh">' + ic(icon) + '<span>' + esc(label) + '</span></div>'; }
  function kv(label, value, vcls) { return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">' + esc(label) + '</span><span class="bhp-kv__v ' + (vcls || '') + '">' + esc(value) + '</span></div>'; }
  function txtRow(v, cls) { return '<div class="bhp-row bhp-txt ' + (cls || '') + '">' + esc(v) + '</div>'; }
  function htmlRow(h, cls) { return '<div class="bhp-row ' + (cls || '') + '">' + h + '</div>'; }
  function fieldCard(icon, label, value) { return card(fh(icon, label) + lines(value).map(function (l) { return txtRow(l); }).join('')); }
  function emptyCard(t) { return card('<div class="bhp-row bhp-empty">' + esc(t) + '</div>'); }
  function loadingRow() { return '<div class="bhp-row"><div class="bhp-loadrow">' + SPIN + '<span>Chargement…</span></div></div>'; }
  function label(t) { return '<p class="bhp-label">' + esc(t) + '</p>'; }
  function banner(t) { return '<div class="bhp-banner">' + ic('book') + '<span>' + esc(t) + '</span></div>'; }
  function warn(t, err) { return '<div class="bhp-warn' + (err ? ' bhp-warn--err' : '') + '">' + ic(err ? 'errFill' : 'warnFill') + '<span>' + esc(t) + '</span></div>'; }
  function okLine(t) { return '<span class="bhp-okline">' + ic('checkFill') + esc(t) + '</span>'; }
  function pill(t, style) { return '<span class="bhp-pill bhp-pill--' + style + '">' + esc(t) + '</span>'; }
  function sw(k, on, rerender) { return '<label class="bhp-switch"><input type="checkbox" data-k="' + k + '"' + (on ? ' checked' : '') + (rerender ? ' data-rerender="1"' : '') + '><span></span></label>'; }
  function toggleRow(lbl, k, on, rerender) { return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">' + esc(lbl) + '</span>' + sw(k, on, rerender) + '</div>'; }
  function inRow(lbl, k, val, o) {
    o = o || {};
    return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">' + esc(lbl) + '</span><span class="bhp-in-wrap">'
      + '<input class="bhp-input ' + (o.small ? 'bhp-input--s' : 'bhp-input--r') + (o.mono ? ' bhp-mono' : '') + '" data-k="' + k + '" value="' + esc(val) + '" inputmode="' + (o.mode || 'decimal') + '" placeholder="' + esc(o.ph || '—') + '"' + (o.wide ? ' style="width:min(60vw,240px);text-align:right"' : '') + '>'
      + (o.unit ? '<span class="bhp-unit">' + esc(o.unit) + '</span>' : '') + '</span></div>';
  }
  function tfRow(k, val, ph, mono) { return '<div class="bhp-row"><input class="bhp-input' + (mono ? ' bhp-mono' : '') + '" data-k="' + k + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '"></div>'; }
  function taRow(k, val, ph, rows) { return '<div class="bhp-row"><textarea class="bhp-input bhp-ta" data-k="' + k + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph) + '">' + esc(val) + '</textarea></div>'; }
  function addRow(act, lbl) { return '<div class="bhp-row"><button class="bhp-add" data-act="' + act + '">' + ic('plusFill') + '<span>' + esc(lbl) + '</span></button></div>'; }
  function minusBtn(act, i) { return '<button class="bhp-minus" data-act="' + act + '" data-i="' + i + '" aria-label="Retirer">' + I.minusFill + '</button>'; }
  function statusHTML(st) {
    if (st === 'complete') return '<span class="bhp-ic bhp-check">' + I.checkFill + '</span>';
    if (st === 'toFill') return pill('à remplir', 'or');
    return pill('inactif', 'neutre');
  }

  /* ── Alerte iOS ── */
  function dialog(o) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'bhp-dlg-ov';
      var acts = o.actions || [{ label: 'OK', role: 'cancel' }];
      var row = acts.length === 2;
      ov.innerHTML = '<div class="bhp-dlg" role="alertdialog"><div class="bhp-dlg__b"><div class="bhp-dlg__t">' + esc(o.title) + '</div>'
        + (o.message ? '<div class="bhp-dlg__m">' + esc(o.message) + '</div>' : '') + '</div>'
        + '<div class="bhp-dlg__a' + (row ? ' bhp-dlg__a--row' : '') + '">'
        + acts.map(function (a, i) { return '<button data-i="' + i + '" class="' + (a.role === 'cancel' ? 'is-cancel' : '') + (a.role === 'destructive' ? ' is-danger' : '') + '">' + esc(a.label) + '</button>'; }).join('')
        + '</div></div>';
      document.body.appendChild(ov);
      requestAnimationFrame(function () { ov.classList.add('is-open'); });
      ov.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-i]');
        if (!b) return;
        ov.classList.remove('is-open');
        setTimeout(function () { ov.remove(); }, 200);
        resolve(acts[+b.dataset.i].value !== undefined ? acts[+b.dataset.i].value : +b.dataset.i);
      });
    });
  }
  function alertMsg(title, msg) { return dialog({ title: title, message: msg, actions: [{ label: 'OK', role: 'cancel' }] }); }
  function confirmMsg(title, msg, okLabel, cancelLabel) {
    return dialog({ title: title, message: msg, actions: [{ label: cancelLabel || 'Annuler', role: 'cancel', value: false }, { label: okLabel, role: 'destructive', value: true }] });
  }

  /* ── Menu contextuel ── */
  function openMenu(anchor, items) {
    var r = anchor.getBoundingClientRect();
    var ov = document.createElement('div');
    ov.className = 'bhp-menu-ov';
    var m = document.createElement('div');
    m.className = 'bhp-menu';
    m.innerHTML = items.map(function (it, i) {
      if (it === '-') return '<hr>';
      return '<button data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + ' class="' + (it.danger ? 'is-danger' : '') + '"><span>' + esc(it.label) + '</span>' + (it.icon ? ic(it.icon) : '') + '</button>';
    }).join('');
    ov.appendChild(m);
    document.body.appendChild(ov);
    var w = m.offsetWidth, h = m.offsetHeight;
    var left = Math.max(10, Math.min(r.right - w, window.innerWidth - w - 10));
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    function close() { ov.remove(); }
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      close();
      if (b && !b.disabled) { var it = items[+b.dataset.i]; if (it && it.onClick) it.onClick(); }
    });
  }

  /* ── Feuille (sheet) ── */
  function openSheet(o) {
    var ov = document.createElement('div');
    ov.className = 'bhp-ov';
    ov.innerHTML = '<div class="bhp-sheet' + (o.full ? ' bhp-sheet--full' : '') + '" role="dialog" aria-modal="true"><div class="bhp-sheet__bg"></div>'
      + '<div class="bhp-sheet__head"><div class="bhp-handle"></div><div class="bhp-nav__bar" data-head></div></div>'
      + '<div class="bhp-sheet__body" data-body></div><div class="bhp-sheet__foot" data-foot style="display:none"></div></div>';
    document.body.appendChild(ov);
    var prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    var sh = {
      el: ov, locked: false,
      head: ov.querySelector('[data-head]'), body: ov.querySelector('[data-body]'), foot: ov.querySelector('[data-foot]'),
      setHead: function (h) {
        sh.head.innerHTML = '<div class="bhp-nav__side">' + (h.left || '') + '</div><div class="bhp-nav__center">'
          + (h.kicker != null ? '<div class="bhp-nav__kicker">' + esc(h.kicker) + '</div>' : '')
          + '<div class="bhp-nav__title">' + esc(h.title) + '</div>' + (h.sub != null ? '<div class="bhp-nav__kicker">' + esc(h.sub) + '</div>' : '') + '</div>'
          + '<div class="bhp-nav__side bhp-nav__side--r">' + (h.right || '') + '</div>';
      },
      setFoot: function (html) { sh.foot.style.display = html ? '' : 'none'; sh.foot.innerHTML = html || ''; },
      close: function () {
        if (sh.closed) return;
        sh.closed = true;
        ov.classList.remove('is-open');
        document.documentElement.style.overflow = prevOverflow;
        setTimeout(function () { ov.remove(); }, 320);
        if (o.onClose) o.onClose();
      }
    };
    sh.setHead(o.head || { title: '' });
    ov.addEventListener('click', function (e) {
      if (e.target === ov && !sh.locked) sh.close();
      var c = e.target.closest('[data-act="sheet-close"]');
      if (c && !sh.locked) sh.close();
    });
    requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('is-open'); }); });
    return sh;
  }

  /* ════════════════ Chargements communs ════════════════ */
  function findInList(id) {
    return api('GET', '/api/properties').then(function (r) {
      var arr = r.properties || (Array.isArray(r) ? r : []);
      var raw = arr.filter(function (x) { return String(x.id) === String(id) || String(x._id) === String(id); })[0];
      if (!raw) { var e = new Error('Logement introuvable.'); e.status = 404; throw e; }
      return normProperty(raw);
    });
  }
  function fetchProperty(id) {
    return api('GET', '/api/properties/' + encodeURIComponent(id)).then(function (r) {
      var p = normProperty(r);
      if (!p.id) throw new Error('vide');
      return p;
    }).catch(function () { return findInList(id); });
  }
  var clientsPromise = null;
  function loadClients() {
    if (!clientsPromise) clientsPromise = api('GET', '/api/owner-clients').then(function (r) { return r.clients || []; }).catch(function () { return []; });
    return clientsPromise;
  }
  function putProperty(p, fields) {
    var fd = new FormData();
    var all = Object.assign({ name: p.name, internalName: p.internalName || '', ownerId: p.ownerId || '', photoUrl: p.photoUrl || '' }, fields);
    Object.keys(all).forEach(function (k) { if (all[k] !== undefined && all[k] !== null) fd.append(k, String(all[k])); });
    return api('PUT', '/api/properties/' + encodeURIComponent(p.id), fd).then(function (r) {
      var src = (r && (r.property || r.data || ((r.id || r._id) ? r : null)));
      var pr = src ? Promise.resolve(normProperty(src)) : fetchProperty(p.id);
      return pr.then(function (np) {
        if (!np.id) np.id = p.id;
        UPSELL_MAP.forEach(function (m) { if (np[m[0]] == null) np[m[0]] = p[m[0]]; });
        return np;
      });
    });
  }

  /* ════════════════ Feuille : nouveau logement (NewPropertySheet) ════════════════ */
  function openNewPropertySheet(onSuccess) {
    var st = { name: '', internal: '', color: '#2E8B62', owner: '', clients: null, err: null, nameErr: false, creating: false, created: false };
    var sh = openSheet({ head: { title: 'Nouveau logement' } });
    function head() { sh.setHead({ title: 'Nouveau logement', right: '<button class="bhp-textbtn" data-act="sheet-close"' + (st.creating ? ' disabled' : '') + '>' + (st.created ? 'Fermer' : 'Annuler') + '</button>' }); }
    function render() {
      head();
      sh.locked = st.creating;
      if (st.created) {
        sh.body.innerHTML = '<div class="bhp-stack">' + card('<div class="bhp-success">' + ic('checkFill') + '<b>Logement créé</b><span>' + esc(st.internal.trim() || st.name.trim()) + '</span></div>')
          + card(htmlRow('<div class="bhp-info">' + ic('info') + '<span>Ce logement n\'est pas encore diffusé. Connectez-le à la diffusion depuis sa fiche.</span></div>'))
          + '<button class="bhp-btn bhp-btn--primary" data-act="sheet-close">Fermer</button></div>';
        return;
      }
      var owners = st.clients == null ? loadingRow()
        : htmlRow('<div class="bhp-kv"><span class="bhp-lbl" style="margin:0">Propriétaire</span><select class="bhp-input bhp-select" data-f="owner"><option value="">Aucun</option>'
          + st.clients.map(function (c) { var id = clientId(c); return '<option value="' + esc(id) + '"' + (id === st.owner ? ' selected' : '') + '>' + esc(clientName(c)) + '</option>'; }).join('') + '</select></div>');
      sh.body.innerHTML = '<div class="bhp-stack">'
        + card(htmlRow('<div class="bhp-lbl' + (st.nameErr ? ' bhp-lbl--err' : '') + '">Nom public<span class="bhp-req">obligatoire</span></div><input class="bhp-input" data-f="name" value="' + esc(st.name) + '" placeholder="Nom visible par les voyageurs">' + (st.nameErr ? '<div class="bhp-ferr">Ce champ est obligatoire.</div>' : ''))
          + htmlRow('<div class="bhp-lbl">Nom interne</div><input class="bhp-input" data-f="internal" value="' + esc(st.internal) + '" placeholder="Optionnel — pour votre usage">'))
        + card(htmlRow('<div class="bhp-flexrow"><div class="bhp-grow"><div class="bhp-lbl" style="margin-bottom:2px">Couleur<span class="bhp-req">obligatoire</span></div><div class="bhp-meta">Point coloré dans le classement des revenus</div></div><span class="bhp-colorbar" style="background:' + esc(st.color) + '"></span><input type="color" class="bhp-colorin" data-f="color" value="' + esc(st.color) + '"></div>'))
        + card(owners)
        + (st.err ? warn(st.err, true) : '')
        + '<button class="bhp-btn bhp-btn--primary" data-act="np-create"' + (st.creating ? ' disabled' : '') + '>' + (st.creating ? '<span class="bhp-spin bhp-spin--w"></span><span>Création…</span>' : ic('plus') + '<span>Créer le logement</span>') + '</button></div>';
    }
    function read() { sh.body.querySelectorAll('[data-f]').forEach(function (el) { st[el.dataset.f] = el.value; }); }
    sh.body.addEventListener('input', function (e) {
      var f = e.target.dataset.f;
      if (!f) return;
      st[f] = e.target.value;
      if (f === 'color') { var bar = sh.body.querySelector('.bhp-colorbar'); if (bar) bar.style.background = st.color; }
      if (f === 'name' && st.nameErr) { st.nameErr = false; render(); var n = sh.body.querySelector('[data-f="name"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
    });
    sh.body.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="np-create"]')) return;
      read();
      var name = st.name.trim();
      if (!name) { st.nameErr = true; render(); return; }
      st.creating = true; st.err = null; render();
      var fd = new FormData();
      fd.append('name', name);
      fd.append('color', st.color.toUpperCase());
      if (st.internal.trim()) fd.append('internalName', st.internal.trim());
      if (st.owner) fd.append('ownerId', st.owner);
      api('POST', '/api/properties', fd).then(function () {
        st.created = true; if (onSuccess) onSuccess();
      }).catch(function (err) {
        if (err.status === 403) st.err = 'Le plan Starter est limité à 3 logements. Passez au plan Pro pour créer des logements supplémentaires.';
        else if (err.status === 402) st.err = 'La facturation du logement supplémentaire a échoué. Vérifiez votre moyen de paiement.';
        else if (err.status === 409) st.err = (err.data && err.data.error) || 'Un logement porte déjà ce nom, choisissez-en un autre.';
        else st.err = err.message;
      }).then(function () { st.creating = false; render(); });
    });
    render();
    loadClients().then(function (c) { read(); st.clients = c; if (!st.created) render(); });
    return sh;
  }

  /* ════════════════ LISTE ════════════════ */
  BHP.initList = function () {
    var root = document.getElementById('bhpApp');
    var st = { state: 'loading', props: [], groups: [], diff: {}, filter: null };
    var canAdd = !isSubAccount() || subPermissions().can_view_properties === true;

    function groupOf(p) { return st.groups.filter(function (g) { return g.propertyIds.indexOf(p.id) >= 0; })[0]; }
    function subline(p) {
      var parts = [], g = groupOf(p), a = fmtTime(p.arrivalTime), d = fmtTime(p.departureTime);
      if (g) parts.push(g.name);
      if (a && d) parts.push(a + ' → ' + d);
      if (p.depositAmount > 0) parts.push('caution');
      return parts.length ? parts.join(' · ') : '—';
    }
    function filtered() {
      if (!st.filter) return st.props;
      if (st.filter === '__ungrouped__') {
        var grouped = {};
        st.groups.forEach(function (g) { g.propertyIds.forEach(function (id) { grouped[id] = 1; }); });
        return st.props.filter(function (p) { return !grouped[p.id]; });
      }
      var g = st.groups.filter(function (x) { return x.id === st.filter; })[0];
      if (!g) return st.props;
      return st.props.filter(function (p) { return g.propertyIds.indexOf(p.id) >= 0; });
    }
    function isProblem(p) { var d = st.diff[p.id]; return !!d && (!d.vendable || !d.diffuse); }
    function badge(c) { return '<span class="bhp-badge bhp-badge--' + c.cls + '">' + esc(c.label) + '</span>'; }

    function render() {
      var n = st.props.length;
      var chips = '';
      if (st.state === 'loaded') {
        var list = [{ id: '', label: 'Tous · ' + n }];
        var groupedIds = {};
        st.groups.forEach(function (g) {
          g.propertyIds.forEach(function (id) { groupedIds[id] = 1; });
          var c = st.props.filter(function (p) { return g.propertyIds.indexOf(p.id) >= 0; }).length;
          list.push({ id: g.id, label: g.name + ' · ' + c });
        });
        var ung = st.props.filter(function (p) { return !groupedIds[p.id]; }).length;
        if (ung > 0) list.push({ id: '__ungrouped__', label: 'Non groupés · ' + ung });
        chips = '<div class="bhp-chips"><div class="bhp-chips__in">' + list.map(function (c) {
          return '<button class="bhp-chip' + ((c.id || null) === st.filter ? ' is-on' : '') + '" data-act="chip" data-id="' + esc(c.id) + '">' + esc(c.label) + '</button>';
        }).join('') + '</div></div>';
      }
      var nav = navHTML({
        kicker: st.state === 'loaded' ? pl(n, 'logement') : '', title: 'Logements',
        left: circleBtn('chevL', 'back', 'Gestion'),
        right: canAdd ? circleBtn('plus', 'new', 'Ajouter un logement') : '',
        below: chips
      });
      var body;
      if (st.state === 'loading') body = '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>';
      else if (st.state === 'failed') body = '<div class="bhp-state">Impossible de charger les logements.<br><br><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>';
      else {
        var props = filtered();
        if (!props.length) body = '<div class="bhp-state">' + (st.filter ? 'Aucun logement dans ce groupe.' : 'Aucun logement pour le moment.') + '</div>';
        else {
          var problems = props.filter(isProblem), normals = props.filter(function (p) { return !isProblem(p); });
          body = '<div class="bhp-stack bhp-stack--tight">'
            + problems.map(function (p) {
              var d = st.diff[p.id], urgent = !d.vendable, c = connState(p);
              return card('<span class="bhp-rail bhp-rail--' + (urgent ? 'urgent' : 'partial') + '"></span><div class="bhp-prop"><div class="bhp-prop__txt"><div class="bhp-prop__name">' + esc(dname(p)) + '</div><div class="bhp-prop__sub">' + esc(subline(p)) + '</div></div>'
                + badge(c) + (c.ok ? '<span class="bhp-pill bhp-pill--alert bhp-pill--' + (urgent ? 'terra' : 'or') + '">' + (urgent ? 'À compléter' : 'Incomplète') + '</span>' : '') + CHEV + '</div>',
                'bhp-card--tap ' + (urgent ? 'bhp-card--urgent' : 'bhp-card--partial'), ' data-act="open" data-id="' + esc(p.id) + '"');
            }).join('')
            + normals.map(function (p) {
              return card('<div class="bhp-prop"><div class="bhp-prop__txt"><div class="bhp-prop__name">' + esc(dname(p)) + '</div><div class="bhp-prop__sub">' + esc(subline(p)) + '</div></div>' + badge(connState(p)) + CHEV + '</div>',
                'bhp-card--tap', ' data-act="open" data-id="' + esc(p.id) + '"');
            }).join('')
            + '</div>';
        }
      }
      var sx = root.querySelector('.bhp-chips');
      var keepScroll = sx ? sx.scrollLeft : 0;
      root.innerHTML = nav + body;
      var nsx = root.querySelector('.bhp-chips');
      if (nsx) nsx.scrollLeft = keepScroll;
    }

    function load() {
      st.state = 'loading'; render();
      Promise.all([
        api('GET', '/api/properties'),
        api('GET', '/api/property-groups').catch(function () { return {}; }),
        api('GET', '/api/properties/diffusion').catch(function () { return {}; })
      ]).then(function (res) {
        st.props = (res[0].properties || (Array.isArray(res[0]) ? res[0] : [])).map(normProperty).filter(function (p) { return p.id; })
          .sort(function (a, b) { return dname(a).localeCompare(dname(b), 'fr', { numeric: true, sensitivity: 'base' }); });
        st.groups = (res[1].groups || []).map(function (g) { return { id: String(g.id), name: g.name || '', propertyIds: (g.propertyIds || g.property_ids || []).map(String) }; })
          .filter(function (g) { return g.propertyIds.some(function (id) { return st.props.some(function (p) { return p.id === id; }); }); })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        st.diff = {};
        (res[2].logements || []).forEach(function (l) {
          var id = String(pick(l, 'property_id', 'propertyId', 'id') || '');
          if (id) st.diff[id] = { vendable: bool(l.vendable) !== false, diffuse: bool(l.diffuse) !== false };
        });
        st.state = 'loaded';
        render();
      }).catch(function () { st.state = 'failed'; render(); });
    }

    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.dataset.act;
      if (act === 'back') { window.location.href = document.body.getAttribute('data-back-href') || '/manage.html'; }
      else if (act === 'new') openNewPropertySheet(load);
      else if (act === 'retry') load();
      else if (act === 'chip') { st.filter = el.dataset.id || null; render(); }
      else if (act === 'open') window.location.href = '/property.html?id=' + encodeURIComponent(el.dataset.id);
    });

    load();
    if (new URLSearchParams(location.search).get('new') === '1' && canAdd) openNewPropertySheet(load);
  };

  /* ════════════════ FICHE + BLOCS ════════════════ */
  BHP.initProperty = function () {
    var root = document.getElementById('bhpApp');
    var params = new URLSearchParams(location.search);
    var S = {
      id: params.get('id'), p: null, groups: [], livret: null,
      channels: [], channelsLoaded: false, isSub: isSubAccount(),
      section: params.get('section'), lastSection: null, sec: null, pushed: false,
      showSyncPrompt: false, diffSyncing: false, diffStep: '', diffResult: null,
      syncingAll: false, icalSyncing: false, disconnecting: false, detailScroll: 0, loadErr: null
    };

    function groupOf(p) { return S.groups.filter(function (g) { return g.propertyIds.indexOf(p.id) >= 0; })[0]; }
    function render() {
      if (!S.p) {
        root.innerHTML = navHTML({ kicker: '', title: 'Logement', left: circleBtn('chevL', 'det-back', 'Logements') })
          + (S.loadErr ? '<div class="bhp-state">' + esc(S.loadErr) + '<br><br><button class="bhp-glassbtn" data-act="retry">Réessayer</button></div>'
            : '<div class="bhp-state bhp-center"><span class="bhp-spin bhp-spin--lg"></span></div>');
        return;
      }
      if (S.section && SECTIONS[S.section]) renderSection();
      else renderDetail();
    }

    /* ── Statuts & résumés (PropertyDetailView.swift) ── */
    function blocks(p) {
      var r = {};
      r.identity = { s: p.address || '—', st: p.address ? 'complete' : 'toFill' };
      var sp = [], a = fmtTime(p.arrivalTime), d = fmtTime(p.departureTime);
      if (a && d) sp.push(a + ' → ' + d);
      if (p.maxGuests != null) sp.push(p.maxGuests + ' pers.');
      if (p.minNights > 0) sp.push(pl(p.minNights, 'nuit') + ' min');
      r.stay = { s: sp.join(' · ') || '—', st: (p.arrivalTime || p.maxGuests != null) ? 'complete' : 'toFill' };
      var mp = [];
      if (p.basePrice > 0) {
        mp.push(fmtAmount(p.basePrice));
        if (p.cleaningFee > 0) mp.push('ménage ' + fmtAmount(p.cleaningFee));
        if (p.touristTax > 0) mp.push('taxe ' + fmtAmount(p.touristTax) + ' p.nuit');
      }
      r.money = { s: mp.join(' · ') || '—', st: p.basePrice > 0 ? 'complete' : 'toFill' };
      var up = [];
      if (p.lateCheckoutEnabled === true) up.push('départ tardif');
      if (p.earlyCheckinEnabled === true) up.push('arrivée anticipée');
      if (p.welcomeBasketEnabled === true) up.push('panier');
      var flags = [p.lateCheckoutEnabled, p.earlyCheckinEnabled, p.welcomeBasketEnabled];
      r.upsell = { s: up.join(' · ') || '—', st: flags.indexOf(true) >= 0 ? 'complete' : (flags.every(function (f) { return f === false; }) ? 'inactive' : 'toFill') };
      var ap = [];
      if (p.accessCode) ap.push('code ' + p.accessCode);
      if (p.wifiName) ap.push('wifi ' + p.wifiName);
      if (!ap.length && p.accessInstructions) ap.push(p.accessInstructions.slice(0, 40));
      r.access = { s: ap.join(' · ') || '—', st: (p.accessCode || p.wifiName || p.accessInstructions) ? 'complete' : 'toFill' };
      var pi = p.practicalInfo, qp = [];
      if (pi) { if (pi.parkingDetails) qp.push('parking'); if (pi.trashDay) qp.push('poubelles'); if (pi.nearbyShops) qp.push('commerces'); if (pi.publicTransport) qp.push('transports'); }
      r.neighborhood = { s: qp.join(' · ') || '—', st: piHasAny(pi) ? 'complete' : 'toFill' };
      var ep = [];
      if (p.amenities) AMEN_KEYS.forEach(function (k) { if (p.amenities[k[0]] === true) ep.push(k[3]); });
      r.amenities = { s: ep.join(' · ') || '—', st: hasAmen(p.amenities) ? 'complete' : 'toFill' };
      var ip = [];
      if (p.autoResponsesEnabled === true) ip.push('actif'); else if (p.autoResponsesEnabled === false) ip.push('inactif');
      if (p.customAutoResponses.length) ip.push(p.customAutoResponses.length + ' Q&R');
      if (p.quickReplies.length) ip.push(pl(p.quickReplies.length, 'raccourci'));
      r.ai = { s: ip.join(' · ') || '—', st: p.autoResponsesEnabled === true ? 'complete' : (p.autoResponsesEnabled === false ? 'inactive' : 'toFill') };
      var pp = [];
      if (p.channexEnabled === true) {
        if (S.channelsLoaded || S.isSub) {
          var n = S.channels.length;
          pp.push(n > 0 ? 'diffusé sur ' + n + ' plateforme' + (n > 1 ? 's' : '') : 'connecté · aucune diffusion');
        } else pp.push('connecté');
      }
      if (p.icalUrls.length) pp.push(p.icalUrls.length + ' iCal');
      var pst = p.icalUrls.length ? 'complete' : (p.channexEnabled !== true ? 'toFill' : (!S.channelsLoaded ? 'complete' : (S.channels.length ? 'complete' : 'toFill')));
      r.platforms = { s: pp.join(' · ') || 'non connecté', st: pst };
      return r;
    }
    var BLOCK_DEFS = [
      ['identity', 'idcard', 'Identité', false], ['stay', 'clock', 'Séjour', false], ['money', 'euro', 'Argent', false],
      ['upsell', 'gift', 'Prestations payantes', false], ['access', 'key', 'Accès', true], ['neighborhood', 'map', 'Le quartier', true],
      ['amenities', 'list', 'Équipements & règles', true], ['ai', 'sparkles', 'Assistant IA', false], ['platforms', 'antenna', 'Plateformes & prix', false]
    ];

    /* ── Rendu de la fiche ── */
    function normP(s) { return String(s || '').toLowerCase().replace(/[\s.\-_]/g, ''); }
    function platformMatches(input, ch) {
      var n = normP(input);
      if (n.length < 4) return false;
      return [normP(ch.channel), normP(ch.title)].some(function (ref) { return n === ref || (ref.indexOf(n) === 0 && n.length >= 5); });
    }
    function renderDetail() {
      var p = S.p, g = groupOf(p), kick = [g && g.name, p.address].filter(Boolean).join(' · ');
      var b = blocks(p), h = '';
      // Livret
      var L = S.livret || {}, filled = livretBlocks(p);
      if (L.exists) {
        h += card('<div class="bhp-livret__top"><div class="bhp-tile">' + I.book + '</div><div class="bhp-livret__txt"><div class="bhp-livret__t">Livret d\'accueil</div><div class="bhp-livret__s">Publié · accessible aux voyageurs</div></div>' + glassBtn('Modifier', 'livret-edit') + '</div>'
          + '<div class="bhp-livret__acts"><button class="bhp-link" data-act="livret-preview">' + ic('compass') + 'Aperçu</button><button class="bhp-link" data-act="livret-share">' + ic('share') + 'Partager</button></div>', 'bhp-livret');
      } else {
        h += card('<div class="bhp-livret__top"><div class="bhp-tile">' + I.book + '</div><div class="bhp-livret__txt"><div class="bhp-livret__t">Livret d\'accueil</div><div class="bhp-livret__s">' + pl(filled, 'bloc') + ' sur 3 rempli' + (filled === 1 ? '' : 's') + '</div></div>' + glassBtn(S.livret ? 'Créer' : '…', 'livret-edit') + '</div>'
          + '<div class="bhp-progress"><i style="width:' + Math.round(filled / 3 * 100) + '%"></i></div>'
          + '<div class="bhp-meta" style="font-size:12px">Il se remplit à partir des blocs Accès, Le quartier et Équipements &amp; règles. Rien à ressaisir.</div>', 'bhp-livret');
      }
      // Les 9 blocs
      h += card(BLOCK_DEFS.map(function (d) {
        var bb = b[d[0]];
        return '<div class="bhp-row bhp-block' + (S.lastSection === d[0] ? ' bhp-row--active' : '') + '" data-act="go" data-sec="' + d[0] + '">'
          + '<div class="bhp-block__ic">' + I[d[1]] + '</div><div class="bhp-block__txt"><div class="bhp-block__t"><span>' + esc(d[2]) + '</span>' + (d[3] ? '<span class="bhp-livtag">LIVRET</span>' : '') + '</div>'
          + '<div class="bhp-block__s">' + esc(bb.s) + '</div></div>' + statusHTML(bb.st) + CHEV + '</div>';
      }).join(''));
      // Diffusion
      if (!S.isSub) {
        var chans;
        if (!S.channelsLoaded) chans = card('<div class="bhp-row bhp-center" style="padding:16px">' + SPIN + '</div>');
        else if (!S.channels.length) chans = card(htmlRow('<span class="bhp-empty" style="font-size:14px">Ce logement n\'est diffusé sur aucune plateforme.</span>'));
        else chans = S.channels.map(function (c) { return card('<div class="bhp-chan"><span class="bhp-chan__dot" style="background:' + platformColor(c.channel || c.title) + '"></span><span class="bhp-chan__n">' + esc(c.title || c.channel) + '</span><span class="bhp-ic bhp-check">' + I.checkFill + '</span></div>'); }).join('');
        var syncCard = '';
        if (S.showSyncPrompt) {
          var inner;
          if (S.diffResult) inner = '<div style="font-size:14px;font-weight:600">Synchronisation terminée</div><div class="bhp-meta" style="white-space:pre-line;margin-top:6px">' + esc(S.diffResult) + '</div>';
          else if (S.diffSyncing) inner = '<div class="bhp-loadrow" style="font-size:14px">' + SPIN + '<span>' + esc(S.diffStep) + '</span></div>';
          else inner = '<button class="bhp-btn bhp-btn--mint" style="background:none;border:0;padding:2px" data-act="diff-sync">' + ic('sync') + 'Synchroniser</button>';
          syncCard = card(htmlRow(inner));
        }
        h += '<div class="bhp-group">' + label('Diffusion') + chans
          + '<button class="bhp-btn bhp-btn--mint" data-act="diff-manage">' + ic('antenna') + 'Gérer la diffusion</button>' + syncCard + '</div>';
      }
      // Synchronisation par lien
      var overlap = p.icalUrls.some(function (e) { return S.channels.some(function (c) { return platformMatches(e.platform, c); }); });
      var flux = !p.icalUrls.length ? card(htmlRow('<span class="bhp-empty" style="font-size:14px">Aucun lien configuré.</span>'))
        : card(p.icalUrls.map(function (e, i) {
          var s = p.icalSyncStatus[e.url], badgeH;
          if (s) badgeH = s.ok === false ? pill('Erreur', 'terra') : pill(pl(+(s.events || 0), 'réservation'), 'vert');
          else badgeH = '<span class="bhp-meta">Jamais synchronisé</span>';
          return '<div class="bhp-row"><div class="bhp-flux__top"><span class="bhp-flux__p">' + esc(e.platform) + '</span>' + badgeH + '<button class="bhp-dots" data-act="ical-menu" data-i="' + i + '" aria-label="Options">' + I.ellipsis + '</button></div>'
            + '<div class="bhp-flux__u">' + esc(e.url) + '</div>' + (s && s.ok === false && s.error ? '<div class="bhp-flux__e">' + esc(s.error) + '</div>' : '') + '</div>';
        }).join(''));
      var last = p.lastIcalSyncAt ? (relTime(p.lastIcalSyncAt) ? 'Dernière synchronisation ' + relTime(p.lastIcalSyncAt) : 'Dernière synchronisation inconnue') : 'Jamais synchronisé';
      h += '<div class="bhp-group">' + label('Synchronisation par lien')
        + (overlap ? warn('Ce logement est à la fois diffusé et synchronisé par lien. Une même réservation peut arriver par les deux chemins ; si les dates diffèrent d\'un jour entre les sources, elle peut apparaître en double dans le calendrier.') : '')
        + flux + '<p class="bhp-note">' + esc(last) + '</p>'
        + '<button class="bhp-btn bhp-btn--mint" data-act="ical-add">' + ic('plus') + 'Ajouter un lien</button>'
        + '<button class="bhp-btn bhp-btn--ghost" data-act="ical-sync"' + (S.icalSyncing ? ' disabled' : '') + '>' + (S.icalSyncing ? SPIN + 'Synchronisation en cours…' : ic('sync') + 'Synchroniser maintenant') + '</button>'
        + '<p class="bhp-note">La synchronisation porte sur tous vos logements, pas seulement celui-ci. Le cron passe toutes les heures — vous n\'avez pas à le déclencher manuellement.</p></div>';
      // Actions secondaires
      h += '<button class="bhp-btn bhp-btn--ghost" data-act="dup">' + ic('copy') + 'Dupliquer ce logement</button>';
      if (p.channexEnabled === true) h += '<button class="bhp-btn bhp-btn--danger" data-act="chx-disconnect"' + (S.disconnecting ? ' disabled' : '') + '>' + (S.disconnecting ? SPIN + 'Déconnexion…' : ic('antennaOff') + 'Déconnecter la diffusion') + '</button>';
      else h += '<button class="bhp-btn bhp-btn--ghost" data-act="chx-connect">' + ic('antenna') + 'Connecter à la diffusion</button>';

      root.innerHTML = navHTML({ kicker: kick, title: dname(p), left: circleBtn('chevL', 'det-back', 'Logements'), right: circleBtn('ellipsis', 'det-menu', 'Plus', true) })
        + '<div class="bhp-stack">' + h + '</div>';
      document.title = dname(p) + ' — Boostinghost';
    }

    /* ── Sections : contrôleur générique (lecture / édition) ── */
    function ctx() { return { S: S, sec: S.sec, p: S.p, rerender: render, root: root }; }
    function renderSection() {
      var def = SECTIONS[S.section], sec = S.sec, p = S.p;
      if (!sec || sec.key !== S.section) sec = S.sec = { key: S.section, editing: false, saving: false, draft: null, x: {} };
      var left = sec.editing ? glassBtn('Annuler', 'sec-cancel', { medium: true, disabled: sec.saving }) : circleBtn('chevL', 'sec-back', 'Retour');
      var right = def.readOnly ? '' : (sec.editing ? glassBtn('Enregistrer', 'sec-save', { spin: sec.saving, disabled: sec.saving }) : glassBtn('Modifier', 'sec-edit'));
      var body = (def.banner ? banner(def.banner) : '') + (sec.editing ? def.edit(sec.draft, ctx()) : def.read(p, ctx()));
      root.innerHTML = navHTML({ kicker: dname(p), title: def.title, left: left, right: right }) + '<div class="bhp-stack" data-sec-body>' + body + '</div>';
      document.title = def.title + ' · ' + dname(p) + ' — Boostinghost';
      if (def.mount && !sec.x.mounted) { sec.x.mounted = true; def.mount(ctx()); }
    }
    function secBody() { return root.querySelector('[data-sec-body]'); }
    function collectDraft() { if (S.sec && S.sec.editing) collect(secBody(), S.sec.draft); }

    function goSection(key) {
      S.detailScroll = window.scrollY;
      S.section = key; S.lastSection = key; S.sec = null; S.pushed = true;
      history.pushState({ bhpSection: key }, '', location.pathname + '?id=' + encodeURIComponent(S.id) + '&section=' + key);
      render(); window.scrollTo(0, 0);
    }
    function leaveSection() {
      if (S.pushed && history.state && history.state.bhpSection) { history.back(); return; }
      history.replaceState(null, '', location.pathname + '?id=' + encodeURIComponent(S.id));
      S.section = null; S.sec = null; render(); window.scrollTo(0, S.detailScroll);
    }
    window.addEventListener('popstate', function () {
      var sct = new URLSearchParams(location.search).get('section');
      S.section = sct; S.sec = null;
      render();
      window.scrollTo(0, sct ? 0 : S.detailScroll);
    });

    /* ── Actions de la fiche ── */
    function reloadProperty() {
      return fetchProperty(S.id).then(function (np) {
        UPSELL_MAP.forEach(function (m) { if (np[m[0]] == null && S.p) np[m[0]] = S.p[m[0]]; });
        S.p = np; render(); return np;
      }).catch(function () {});
    }
    function loadChannels() {
      if (S.isSub) { S.channelsLoaded = true; return Promise.resolve(); }
      S.channelsLoaded = false;
      return api('GET', '/api/channex/connected-channels/' + encodeURIComponent(S.id))
        .then(function (r) { S.channels = (r.channels || []).map(function (c) { return { id: c.id, channel: c.channel || '', title: c.title || '' }; }); })
        .catch(function () { S.channels = []; })
        .then(function () { S.channelsLoaded = true; render(); });
    }
    function syncAll() {
      S.syncingAll = true;
      Promise.all([
        api('POST', '/api/sync/ical', {}).then(function () { return true; }).catch(function () { return false; }),
        api('POST', '/api/diffusion/sync-all', {}).then(function () { return true; }).catch(function () { return false; })
      ]).then(function (r) {
        S.syncingAll = false;
        reloadProperty();
        var msg = r[0] && r[1] ? 'Synchronisation lancée.' : (!r[0] && r[1] ? 'Diffusion synchronisée — calendriers iCal non atteints.' : (r[0] ? 'Calendriers iCal synchronisés — diffusion non atteinte.' : 'Synchronisation échouée.'));
        alertMsg('Synchronisation', msg);
      });
    }
    function deleteProperty() {
      confirmMsg('Supprimer ce logement ?', 'Cette action est irréversible.', 'Supprimer').then(function (ok) {
        if (!ok) return;
        api('DELETE', '/api/properties/' + encodeURIComponent(S.id)).then(function () { window.location.href = '/properties.html'; })
          .catch(function (e) { alertMsg('Erreur', e.message); });
      });
    }
    function disconnect() {
      dialog({
        title: 'Déconnecter la diffusion ?',
        message: 'Les identifiants de diffusion seront supprimés de cette application, mais la fiche restera active chez le prestataire et les réservations continueront d\'arriver — sans que les disponibilités soient mises à jour. Risque de double réservation.',
        actions: [{ label: 'Déconnecter quand même', role: 'destructive', value: true }, { label: 'Annuler', role: 'cancel', value: false }]
      }).then(function (ok) {
        if (!ok) return;
        S.disconnecting = true; render();
        api('POST', '/api/channex/disconnect-property', { property_id: S.id })
          .then(function () { return reloadProperty().then(loadChannels); })
          .catch(function (e) { alertMsg('Erreur', e.message); })
          .then(function () { S.disconnecting = false; render(); });
      });
    }
    function diffusionSync() {
      if (S.diffSyncing) return;
      S.diffSyncing = true; S.diffResult = null; var parts = [];
      function step(t) { S.diffStep = t; render(); }
      step('Récupération des réservations…');
      api('POST', '/api/channex/pull-bookings/' + encodeURIComponent(S.id), {})
        .then(function () { parts.push('✓ Réservations récupérées'); }, function () { parts.push('✗ Récupération des réservations échouée'); })
        .then(function () { step('Attente de traitement…'); return new Promise(function (r) { setTimeout(r, 8000); }); })
        .then(function () { step('Synchronisation des réservations…'); return api('POST', '/api/channex/sync-bookings/' + encodeURIComponent(S.id), {}); })
        .then(function () { parts.push('✓ Réservations synchronisées'); }, function () { parts.push('✗ Synchronisation des réservations échouée'); })
        .then(function () { step('Envoi des disponibilités…'); return api('POST', '/api/channex/push-availability/' + encodeURIComponent(S.id), {}); })
        .then(function () { parts.push('✓ Disponibilités envoyées'); }, function () { parts.push('✗ Envoi des disponibilités échoué'); })
        .then(function () { S.diffSyncing = false; S.diffStep = ''; S.diffResult = parts.join('\n'); render(); });
    }
    function icalSync() {
      S.icalSyncing = true; render();
      api('POST', '/api/sync/ical', {}).then(function (r) {
        S.icalSyncing = false; reloadProperty();
        alertMsg('Synchronisation', (r && r.message) || 'Synchronisation lancée.');
      }).catch(function (e) { S.icalSyncing = false; render(); alertMsg('Erreur', e.message); });
    }
    function icalDelete(entry) {
      confirmMsg('Supprimer ce lien ?', 'Le lien « ' + entry.platform + ' » sera retiré de ce logement.', 'Supprimer').then(function (ok) {
        if (!ok) return;
        var remaining = S.p.icalUrls.filter(function (e) { return e.url !== entry.url; });
        api('PATCH', '/api/properties/' + encodeURIComponent(S.id), { icalUrls: remaining }).then(function (r) {
          reloadProperty();
          if (r && r.avertissement) alertMsg('Erreur', r.avertissement);
        }).catch(function (e) { alertMsg('Erreur', e.message); });
      });
    }

    /* ── Feuille : lien iCal (ICalFluxSheet) ── */
    function openIcalSheet(editing) {
      var st = { platform: editing ? editing.platform : '', url: editing ? editing.url : '', err: null, saving: false };
      var sh = openSheet({ head: { title: '' } });
      function render2() {
        sh.locked = st.saving;
        sh.setHead({ title: editing ? 'Modifier le lien' : 'Ajouter un lien', left: '<button class="bhp-textbtn bhp-textbtn--vert" data-act="sheet-close"' + (st.saving ? ' disabled' : '') + '>Annuler</button>' });
        var co = st.platform.trim() && S.channels.some(function (c) { return platformMatches(st.platform.trim(), c); });
        sh.body.innerHTML = '<div class="bhp-stack">' + '<div data-co>' + (co ? warn('Cette plateforme est déjà diffusée sur ce logement. En ajoutant ce lien, les mêmes réservations peuvent arriver deux fois — une fois par la diffusion, une fois par le calendrier importé.') : '') + '</div>'
          + card(htmlRow('<div class="bhp-lbl">Plateforme</div><input class="bhp-input" data-f="platform" value="' + esc(st.platform) + '" placeholder="Airbnb, Booking.com, Abritel…" autocomplete="off">')
            + htmlRow('<div class="bhp-lbl">URL du lien</div><input class="bhp-input" data-f="url" value="' + esc(st.url) + '" placeholder="https://…" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false">'))
          + (st.err ? warn(st.err, true) : '')
          + '<button class="bhp-btn bhp-btn--primary" data-act="ical-save"' + (st.saving ? ' disabled' : '') + '>' + (st.saving ? '<span class="bhp-spin bhp-spin--w"></span>Enregistrement…' : 'Enregistrer') + '</button></div>';
      }
      sh.body.addEventListener('input', function (e) {
        var f = e.target.dataset.f; if (!f) return;
        st[f] = e.target.value;
        if (f === 'platform') {
          var co = st.platform.trim() && S.channels.some(function (c) { return platformMatches(st.platform.trim(), c); });
          sh.body.querySelector('[data-co]').innerHTML = co ? warn('Cette plateforme est déjà diffusée sur ce logement. En ajoutant ce lien, les mêmes réservations peuvent arriver deux fois — une fois par la diffusion, une fois par le calendrier importé.') : '';
        }
      });
      sh.body.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="ical-save"]')) return;
        var pf = st.platform.trim(), u = st.url.trim();
        st.err = null;
        if (!pf) st.err = 'Veuillez saisir le nom de la plateforme.';
        else if (!u) st.err = 'Veuillez saisir l\'URL du lien.';
        else if (!/^https?:\/\/\S+$/i.test(u)) st.err = 'L\'URL doit être valide et commencer par http:// ou https://.';
        else if (S.p.icalUrls.some(function (x) { return x.url === u && (!editing || x.url !== editing.url); })) st.err = 'Cette URL est déjà configurée pour ce logement.';
        if (st.err) { render2(); return; }
        st.saving = true; render2();
        var list = S.p.icalUrls.filter(function (x) { return !editing || x.url !== editing.url; }).concat([{ url: u, platform: pf }]);
        api('PATCH', '/api/properties/' + encodeURIComponent(S.id), { icalUrls: list })
          .then(function () { sh.locked = false; sh.close(); reloadProperty(); })
          .catch(function (er) { st.saving = false; st.err = er.message; render2(); });
      });
      render2();
    }

    /* ── Feuille : dupliquer (DuplicatePropertySheet) ── */
    function openDuplicateSheet() {
      var src = S.p;
      var st = { internal: dname(src) + ' (copie)', pub: '', creating: false, err: null, created: false };
      var sh = openSheet({ head: { title: '' } });
      function render2() {
        sh.locked = st.creating;
        sh.setHead({ kicker: 'Dupliquer', title: dname(src), right: '<button class="bhp-textbtn" data-act="sheet-close"' + (st.creating ? ' disabled' : '') + '>' + (st.created ? 'Fermer' : 'Annuler') + '</button>' });
        if (st.created) {
          sh.body.innerHTML = '<div class="bhp-stack">' + card('<div class="bhp-success">' + ic('checkFill') + '<b>Logement créé</b><span>' + esc(st.internal) + '</span></div>')
            + card(htmlRow('<div class="bhp-info">' + ic('info') + '<span>Ce logement n\'est pas encore diffusé. Connectez-le à la diffusion depuis sa nouvelle fiche.</span></div>'))
            + '<button class="bhp-btn bhp-btn--primary" data-act="sheet-close">Fermer</button></div>';
          return;
        }
        var enabled = st.pub.trim() && !st.creating;
        sh.body.innerHTML = '<div class="bhp-stack">'
          + card(htmlRow('<div class="bhp-lbl">Nom interne</div><input class="bhp-input" data-f="internal" value="' + esc(st.internal) + '" placeholder="Nom interne">')
            + htmlRow('<div class="bhp-lbl">Nom public<span class="bhp-req">obligatoire</span></div><input class="bhp-input" data-f="pub" value="' + esc(st.pub) + '" placeholder="À saisir">'))
          + card(htmlRow('<div class="bhp-info">' + ic('info') + '<span>Les URLs de calendrier, identifiants de diffusion et code PIN ne sont pas copiés.</span></div>'))
          + (st.err ? warn(st.err, true) : '')
          + '<button class="bhp-btn bhp-btn--primary" data-act="dup-create"' + (enabled ? '' : ' disabled') + '>' + (st.creating ? '<span class="bhp-spin bhp-spin--w"></span>Création…' : ic('copy') + 'Créer le duplicata') + '</button></div>';
      }
      sh.body.addEventListener('input', function (e) {
        var f = e.target.dataset.f; if (!f) return;
        st[f] = e.target.value;
        var b = sh.body.querySelector('[data-act="dup-create"]');
        if (b) b.disabled = !st.pub.trim() || st.creating;
      });
      sh.body.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="dup-create"]')) return;
        var pub = st.pub.trim(); if (!pub) return;
        st.creating = true; st.err = null; render2();
        var s = src, body = {
          name: pub, internalName: st.internal, color: s.color, address: s.address, maxGuests: s.maxGuests, bedrooms: s.bedrooms, beds: s.beds, bathrooms: s.bathrooms,
          arrivalTime: s.arrivalTime, departureTime: s.departureTime, minNights: s.minNights, basePrice: s.basePrice, weekendPrice: s.weekendPrice, cleaningFee: s.cleaningFee,
          touristTaxPerNight: s.touristTax, depositAmount: s.depositAmount, depositReleaseDays: s.depositReleaseDays, conciergePct: s.conciergePct,
          airbnbCommissionPct: s.airbnbCommissionPct, bookingCommissionPct: s.bookingCommissionPct, accessInstructions: s.accessInstructions,
          wifiName: s.wifiName, wifiPassword: s.wifiPassword, ownerId: s.ownerId || null, autoResponsesEnabled: s.autoResponsesEnabled, arrivalMessage: s.arrivalMessage,
          externalPricing: s.externalPricing
        };
        UPSELL_MAP.forEach(function (m) { body[m[0]] = s[m[0]]; });
        Object.keys(body).forEach(function (k) { if (body[k] == null) delete body[k]; });
        api('POST', '/api/properties', body).then(function () { st.created = true; })
          .catch(function (er) { st.err = er.status === 409 ? ((er.data && er.data.error) || 'Un logement portant un identifiant similaire existe déjà. Modifiez le nom public.') : er.message; })
          .then(function () { st.creating = false; render2(); });
      });
      render2();
    }

    /* ── Feuille : connecter à la diffusion (PropertyChannexSheet) ── */
    function openConnectSheet() {
      var st = { connecting: false, failed: null };
      var sh = openSheet({ head: { title: '' } });
      function render2() {
        sh.locked = st.connecting;
        sh.setHead({ kicker: 'Connecter à la diffusion', title: dname(S.p), right: '<button class="bhp-textbtn" data-act="sheet-close"' + (st.connecting ? ' disabled' : '') + '>Fermer</button>' });
        sh.body.innerHTML = '<div class="bhp-stack">'
          + (!(S.p.basePrice > 0) ? card(htmlRow('<div class="bhp-warn" style="background:none;border:0;padding:0">' + ic('warnFill') + '<span>Ce logement n\'a pas de tarif de base. La fiche sera créée chez le prestataire de diffusion mais restera fermée à la vente. Renseignez le bloc Argent avant de connecter.</span></div>')) : '')
          + (st.failed ? card(htmlRow('<div class="bhp-warn bhp-warn--err" style="background:none;border:0;padding:0">' + ic('warnFill') + '<span>' + esc(st.failed) + '<br><span class="bhp-att" style="font-size:12.5px">Une fiche partielle a peut-être été créée chez le prestataire de diffusion. Vérifiez-y avant de retenter la connexion pour éviter les doublons.</span></span></div>')) : '')
          + '<button class="bhp-btn bhp-btn--primary" data-act="chx-go"' + (st.connecting ? ' disabled' : '') + '>' + (st.connecting ? '<span class="bhp-spin bhp-spin--w"></span>Connexion en cours…' : ic('antenna') + 'Connecter à la diffusion') + '</button></div>';
      }
      sh.body.addEventListener('click', function (e) {
        if (!e.target.closest('[data-act="chx-go"]')) return;
        st.connecting = true; st.failed = null; render2();
        api('POST', '/api/channex/connect-property', { property_id: S.id }).then(function () {
          sh.locked = false; sh.close(); reloadProperty().then(loadChannels);
        }).catch(function (er) { st.connecting = false; st.failed = er.message; render2(); });
      });
      render2();
    }

    /* ── Feuille : gérer la diffusion (PropertyDiffusionSheet, iframe) ── */
    function openDiffusionSheet() {
      var sh = openSheet({ full: true, head: { title: '' }, onClose: function () { S.showSyncPrompt = true; S.diffResult = null; loadChannels(); reloadProperty(); } });
      sh.setHead({ title: 'Diffusion du logement', sub: dname(S.p), right: '<button class="bhp-circle bhp-circle--muted" style="width:32px;height:32px;font-size:14px" data-act="sheet-close" aria-label="Fermer">' + I.xsmall + '</button>' });
      sh.body.style.overflow = 'hidden';
      function stateHTML(icon, t, spin) {
        return '<div class="bhp-center" style="height:100%;flex-direction:column;gap:14px;padding:32px;text-align:center">' + (spin ? '<span class="bhp-spin bhp-spin--lg"></span>' : '<span class="bhp-ic" style="font-size:32px;color:#A8452A">' + I[icon] + '</span>') + '<span class="bhp-meta" style="font-size:13.5px">' + esc(t) + '</span></div>';
      }
      sh.body.innerHTML = stateHTML(null, 'Préparation…', true);
      var warning = null;
      var already = S.p.channexEnabled === true && !!S.p.channexPropertyId;
      var step1 = already ? Promise.resolve() : api('POST', '/api/channex/connect-property', { property_id: S.id }).then(function (r) {
        if (r && r.avertissement) warning = String(r.avertissement).replace(/channex/ig, 'le prestataire de diffusion');
      }).catch(function (er) {
        var t = String(er.message || '').toLowerCase();
        if (er.status === 400 && (t.indexOf('déjà') >= 0 || t.indexOf('already') >= 0)) return;
        throw er;
      });
      step1.then(function () { return api('POST', '/api/channex/iframe-token', { property_id: S.id }); }).then(function (r) {
        var url = r.iframe_url || r.iframeUrl;
        if (!url) throw new Error('URL de gestion invalide.');
        sh.body.innerHTML = '<div class="bhp-iframe-wrap">' + (warning ? '<div class="bhp-band">' + ic('warnFill') + '<span>' + esc(warning) + '</span></div>' : '')
          + '<div class="bhp-grow"><iframe class="bhp-iframe" src="' + esc(url) + '" allow="clipboard-write" referrerpolicy="no-referrer-when-downgrade"></iframe></div></div>';
        sh.setFoot('<button class="bhp-btn bhp-btn--primary" data-act="sheet-close">J\'ai terminé</button>');
      }).catch(function (er) {
        sh.body.innerHTML = stateHTML('warnFill', er.message || 'Impossible de préparer la gestion de la diffusion.');
      });
    }

    /* ── Livret ── */
    function livretUrl() { var L = S.livret || {}; return L.publicUrl || L.public_url || S.p.welcomeBookUrl || (L.uniqueId ? location.origin + '/welcome/' + L.uniqueId : null); }

    /* ── Délégation des clics ── */
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      var act = el.dataset.act;
      // Fiche
      if (act === 'retry') return load();
      if (act === 'det-back') { window.location.href = '/properties.html'; return; }
      if (act === 'det-menu') {
        return openMenu(el, [
          { label: 'Dupliquer', icon: 'copy', onClick: openDuplicateSheet },
          { label: S.syncingAll ? 'Synchronisation…' : 'Resynchroniser', icon: 'sync', disabled: S.syncingAll, onClick: syncAll },
          '-',
          { label: 'Supprimer', icon: 'trash', danger: true, onClick: deleteProperty }
        ]);
      }
      if (act === 'go') return goSection(el.dataset.sec);
      if (act === 'livret-edit') { var L = S.livret || {}; window.location.href = '/welcome.html' + (L.uniqueId ? '?id=' + encodeURIComponent(L.uniqueId) : '?property=' + encodeURIComponent(S.id)); return; }
      if (act === 'livret-preview') { var u = livretUrl(); if (u) window.open(u, '_blank', 'noopener'); return; }
      if (act === 'livret-share') {
        var su = livretUrl(); if (!su) return;
        if (navigator.share) navigator.share({ title: 'Livret d\'accueil — ' + S.p.name, url: su }).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(su).then(function () { alertMsg('Lien copié', su); });
        else alertMsg('Lien du livret', su);
        return;
      }
      if (act === 'diff-manage') return openDiffusionSheet();
      if (act === 'diff-sync') return diffusionSync();
      if (act === 'ical-add') return openIcalSheet(null);
      if (act === 'ical-menu') {
        var entry = S.p.icalUrls[+el.dataset.i];
        return openMenu(el, [{ label: 'Modifier', icon: 'pencil', onClick: function () { openIcalSheet(entry); } }, { label: 'Supprimer', icon: 'trash', danger: true, onClick: function () { icalDelete(entry); } }]);
      }
      if (act === 'ical-sync') return icalSync();
      if (act === 'dup') return openDuplicateSheet();
      if (act === 'chx-disconnect') return disconnect();
      if (act === 'chx-connect') return openConnectSheet();
      // Sections
      var sec = S.sec, def = S.section && SECTIONS[S.section];
      if (!def || !sec) return;
      if (act === 'sec-back') return leaveSection();
      if (act === 'sec-edit') { sec.draft = def.draft(S.p, ctx()); sec.editing = true; render(); return; }
      if (act === 'sec-cancel') { sec.editing = false; sec.draft = null; if (def.onCancel) def.onCancel(ctx()); render(); return; }
      if (act === 'sec-save') {
        collectDraft();
        sec.saving = true; render();
        Promise.resolve().then(function () { return def.save(S.p, sec.draft, ctx()); }).then(function (np) {
          if (np) S.p = np;
          sec.editing = false; sec.draft = null;
        }).catch(function (er) { alertMsg('Erreur', er.message || 'Erreur serveur'); })
          .then(function () { sec.saving = false; render(); });
        return;
      }
      if (def.act) { collectDraft(); def.act(act, el, ctx()); }
    });
    root.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.rerender && S.sec && S.sec.editing) { collectDraft(); render(); }
    });
    root.addEventListener('input', function (e) {
      var c = e.target.dataset && e.target.dataset.counter;
      if (c) {
        var out = document.getElementById(c), max = +e.target.getAttribute('maxlength');
        if (out) { out.textContent = e.target.value.length + '/' + max; }
      }
    });

    /* ── Chargement ── */
    function load() {
      S.loadErr = null; S.p = null; render();
      if (!S.id) { S.loadErr = 'Identifiant de logement manquant.'; render(); return; }
      Promise.all([
        fetchProperty(S.id),
        api('GET', '/api/property-groups').catch(function () { return {}; }),
        api('GET', '/api/welcome-books/by-property/' + encodeURIComponent(S.id)).catch(function () { return { exists: false }; }),
        api('GET', '/api/properties/' + encodeURIComponent(S.id) + '/upsell').catch(function () { return null; })
      ]).then(function (r) {
        var p = r[0];
        if (!p || !p.id) { S.loadErr = 'Logement introuvable.'; render(); return; }
        var up = r[3]; if (up && up.upsell) up = up.upsell;
        S.p = mergeUpsell(p, up, true);
        S.groups = (r[1].groups || []).map(function (g) { return { id: String(g.id), name: g.name || '', propertyIds: (g.propertyIds || g.property_ids || []).map(String) }; });
        S.livret = r[2] || { exists: false };
        render();
        loadChannels();
      }).catch(function (er) {
        S.loadErr = er.status === 404 ? 'Logement introuvable.' : 'Erreur de chargement. Vérifiez votre connexion.';
        render();
      });
    }
    if (S.section && !SECTIONS[S.section]) S.section = null;
    load();
  };

  /* ════════════════ Les 9 blocs ════════════════ */
  function capDetail(p) {
    var a = [];
    if (p.bedrooms != null) a.push(pl(p.bedrooms, 'chambre'));
    if (p.beds != null) a.push(pl(p.beds, 'lit'));
    if (p.bathrooms != null) a.push(p.bathrooms + ' salle' + (p.bathrooms === 1 ? '' : 's') + ' de bain');
    return a.join(' · ');
  }
  function numFields(d, map) {
    var f = {};
    map.forEach(function (m) { var v = String(d[m[0]] == null ? '' : d[m[0]]).trim().replace(',', '.'); if (v !== '') f[m[1]] = v; });
    return f;
  }
  function trashColor(l) {
    l = l.toLowerCase();
    if (l.indexOf('jaune') >= 0) return '#F1C40F';
    if (l.indexOf('vert') >= 0) return '#27AE60';
    if (l.indexOf('bleu') >= 0) return '#3498DB';
    if (l.indexOf('gris') >= 0) return '#95A5A6';
    if (l.indexOf('noir') >= 0) return '#000';
    return null;
  }

  var SECTIONS = {
    /* ── Identité ── */
    identity: {
      title: 'Identité',
      draft: function (p) {
        return { name: p.name || '', internalName: p.internalName || '', color: validHex(p.color) || '#2E8B62', address: p.address || '',
          maxGuests: intStr(p.maxGuests), bedrooms: intStr(p.bedrooms), beds: intStr(p.beds), bathrooms: intStr(p.bathrooms), ownerId: p.ownerId || '' };
      },
      mount: function (c) { loadClients().then(function (cl) { c.sec.x.clients = cl; if (c.S.sec === c.sec) { if (c.sec.editing) collect(c.root.querySelector('[data-sec-body]'), c.sec.draft); c.rerender(); } }); },
      read: function (p, c) {
        var hasInt = p.internalName && p.internalName !== p.name;
        var h = card(fh('text', 'Nom public') + txtRow(p.name)
          + (hasInt ? fh('tag', 'Nom interne') + txtRow(p.internalName) : '')
          + (p.color ? fh('dot', 'Couleur') + htmlRow('<div class="bhp-color"><i style="background:' + esc(p.color) + '"></i><span class="bhp-mono bhp-att">' + esc(p.color.toUpperCase()) + '</span></div>') : ''));
        if (p.address) h += fieldCard('pin', 'Adresse', p.address);
        var det = capDetail(p);
        h += card(fh('users', 'Capacité') + htmlRow((p.maxGuests != null ? '<div class="bhp-txt">' + pl(p.maxGuests, 'personne') + ' max</div>' : '') + (det ? '<div class="bhp-sub">' + esc(det) + '</div>' : '') + (p.maxGuests == null && !det ? '<span class="bhp-att">—</span>' : '')));
        if (p.photoUrl) h += card(fh('photo', 'Photo') + htmlRow('<img class="bhp-photo" src="' + esc(p.photoUrl) + '" alt="">'));
        var cl = c.sec.x.clients, own;
        if (!p.ownerId) own = '<span class="bhp-txt bhp-att">Aucun propriétaire lié</span>';
        else if (!cl) own = '<div class="bhp-loadrow">' + SPIN + '<span>Chargement…</span></div>';
        else {
          var f = cl.filter(function (x) { return clientId(x) === String(p.ownerId) || String(x.id) === String(p.ownerId); })[0];
          own = f ? '<span class="bhp-txt">' + esc(clientName(f)) + '</span>' : '<span class="bhp-txt bhp-att">Propriétaire introuvable</span>';
        }
        h += card(fh('user', 'Propriétaire') + htmlRow(own));
        return h;
      },
      edit: function (d, c) {
        var p = c.p, cl = c.sec.x.clients;
        var h = card(fh('text', 'Nom public') + tfRow('name', d.name, 'Nom du logement')
          + fh('tag', 'Nom interne') + tfRow('internalName', d.internalName, 'Identifiant de gestion (facultatif)')
          + fh('dot', 'Couleur') + htmlRow('<div class="bhp-flexrow"><span class="bhp-color"><i style="background:' + esc(d.color) + '"></i></span><span class="bhp-grow bhp-meta">Point coloré dans le classement des revenus</span><input type="color" class="bhp-colorin" data-k="color" value="' + esc(d.color) + '" data-rerender="1"></div>'));
        h += card(fh('pin', 'Adresse') + taRow('address', d.address, 'Adresse complète', 2));
        h += card(fh('users', 'Capacité') + inRow('Voyageurs max', 'maxGuests', d.maxGuests, { mode: 'numeric', small: true })
          + inRow('Chambres', 'bedrooms', d.bedrooms, { mode: 'numeric', small: true }) + inRow('Lits', 'beds', d.beds, { mode: 'numeric', small: true })
          + inRow('Salles de bain', 'bathrooms', d.bathrooms, { mode: 'numeric', small: true }));
        if (p.photoUrl) h += card(fh('photo', 'Photo') + htmlRow('<img class="bhp-photo" src="' + esc(p.photoUrl) + '" alt="">'));
        h += card(fh('user', 'Propriétaire') + (!cl ? loadingRow() : htmlRow('<select class="bhp-input bhp-select bhp-select--full" data-k="ownerId"><option value="">Aucun propriétaire</option>'
          + cl.map(function (x) { var id = clientId(x); return '<option value="' + esc(id) + '"' + (id === String(d.ownerId) || String(x.id) === String(d.ownerId) ? ' selected' : '') + '>' + esc(clientName(x)) + '</option>'; }).join('') + '</select>')));
        return h;
      },
      save: function (p, d) {
        var name = d.name.trim();
        if (!name) return Promise.reject(new Error('Le nom du logement ne peut pas être vide.'));
        var ownerChanged = (d.ownerId || '') !== (p.ownerId || '');
        var pre = ownerChanged ? api('PATCH', '/api/properties/' + encodeURIComponent(p.id), { ownerId: d.ownerId || '' }) : Promise.resolve();
        return pre.then(function () {
          var f = { name: name, internalName: d.internalName.trim(), color: d.color.toUpperCase(), address: d.address.trim(), ownerId: d.ownerId || '' };
          Object.assign(f, numFields(d, [['maxGuests', 'maxGuests'], ['bedrooms', 'bedrooms'], ['beds', 'beds'], ['bathrooms', 'bathrooms']]));
          return putProperty(p, f);
        });
      }
    },

    /* ── Séjour ── */
    stay: {
      title: 'Séjour',
      draft: function (p) {
        return { arrivalEnabled: !!hhmm(p.arrivalTime), arrivalTime: hhmm(p.arrivalTime) || '15:00', departureEnabled: !!hhmm(p.departureTime), departureTime: hhmm(p.departureTime) || '11:00',
          maxGuests: intStr(p.maxGuests), minNights: intStr(p.minNights), arrivalMessage: p.arrivalMessage || '' };
      },
      read: function (p) {
        var a = fmtTime(p.arrivalTime), d = fmtTime(p.departureTime);
        var h = card(fh('clock', 'Horaires') + (a ? kv('Arrivée', 'à partir de ' + a) : '') + (d ? kv('Départ', 'avant ' + d) : '') + (!a && !d ? txtRow('—', 'bhp-att') : ''));
        var hasDet = p.bedrooms != null || p.beds != null || p.bathrooms != null;
        if (p.maxGuests != null || hasDet) {
          h += card(fh('users', 'Capacité') + (p.maxGuests != null ? txtRow(pl(p.maxGuests, 'personne') + ' maximum') : '')
            + (hasDet ? fh('bed', 'Logement') + txtRow(capDetail(p)) : ''));
        }
        if (p.minNights > 0) h += card(fh('calendar', 'Durée min') + txtRow(pl(p.minNights, 'nuit') + ' minimum'));
        if (p.arrivalMessage) h += fieldCard('envOpen', 'Message d\'arrivée', p.arrivalMessage);
        return h;
      },
      edit: function (d) {
        return card(fh('clock', 'Horaires') + toggleRow('Arrivée', 'arrivalEnabled', d.arrivalEnabled, true)
          + (d.arrivalEnabled ? '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">à partir de</span><input type="time" class="bhp-input bhp-time" data-k="arrivalTime" value="' + esc(d.arrivalTime) + '" step="900"></div>' : '')
          + toggleRow('Départ', 'departureEnabled', d.departureEnabled, true)
          + (d.departureEnabled ? '<div class="bhp-row bhp-kv"><span class="bhp-kv__l">avant</span><input type="time" class="bhp-input bhp-time" data-k="departureTime" value="' + esc(d.departureTime) + '" step="900"></div>' : ''))
          + card(fh('users', 'Capacité & logement') + inRow('Voyageurs max', 'maxGuests', d.maxGuests, { mode: 'numeric', small: true }) + inRow('Durée min (nuits)', 'minNights', d.minNights, { mode: 'numeric', small: true }))
          + card(fh('envOpen', 'Message d\'arrivée') + taRow('arrivalMessage', d.arrivalMessage, 'Message envoyé automatiquement à l\'arrivée', 4));
      },
      save: function (p, d) {
        var f = { arrivalMessage: d.arrivalMessage, arrivalTime: d.arrivalEnabled ? (hhmm(d.arrivalTime) || '') : '', departureTime: d.departureEnabled ? (hhmm(d.departureTime) || '') : '' };
        Object.assign(f, numFields(d, [['maxGuests', 'maxGuests'], ['minNights', 'minNights']]));
        return putProperty(p, f);
      }
    },

    /* ── Argent ── */
    money: {
      title: 'Argent',
      draft: function (p) {
        return { basePrice: numStr(p.basePrice), weekendPrice: numStr(p.weekendPrice), cleaningFee: numStr(p.cleaningFee), touristTax: numStr(p.touristTax),
          depositAmount: numStr(p.depositAmount), depositReleaseDays: intStr(p.depositReleaseDays), conciergePct: numStr(p.conciergePct),
          airbnbCommissionPct: numStr(p.airbnbCommissionPct), bookingCommissionPct: numStr(p.bookingCommissionPct) };
      },
      read: function (p) {
        var h = card(fh('euro', 'Prix') + (p.basePrice > 0 ? kv('Semaine', fmtAmount(p.basePrice) + ' / nuit') + (p.weekendPrice > 0 ? kv('Week-end', fmtAmount(p.weekendPrice) + ' / nuit') : '') : txtRow('—', 'bhp-att')));
        if (p.cleaningFee > 0) h += card(fh('sparkles', 'Frais de ménage') + txtRow(fmtAmount(p.cleaningFee)));
        if (p.touristTax > 0) h += card(fh('building', 'Taxe de séjour') + txtRow(fmtAmount(p.touristTax) + ' / nuit / pers.'));
        if (p.depositAmount > 0) h += card(fh('shield', 'Caution') + kv('Montant', fmtAmount(p.depositAmount)) + (p.depositReleaseDays != null ? kv('Libération', pl(p.depositReleaseDays, 'jour')) : ''));
        if (p.conciergePct != null || p.airbnbCommissionPct != null || p.bookingCommissionPct != null) {
          var rows = [['Conciergerie', p.conciergePct], ['Airbnb', p.airbnbCommissionPct], ['Booking.com', p.bookingCommissionPct]].filter(function (r) { return r[1] > 0; });
          h += card(fh('percent', 'Commissions') + rows.map(function (r) { return kv(r[0], Math.round(r[1]) + ' %'); }).join(''));
        }
        return h;
      },
      edit: function (d) {
        var e = { unit: '€' }, pc = { unit: '%', small: true };
        return card(fh('euro', 'Prix') + inRow('Semaine (nuit)', 'basePrice', d.basePrice, e) + inRow('Week-end (nuit)', 'weekendPrice', d.weekendPrice, e))
          + card(fh('sparkles', 'Frais de ménage') + inRow('Montant forfaitaire', 'cleaningFee', d.cleaningFee, e))
          + card(fh('building', 'Taxe de séjour') + inRow('Par nuit / personne', 'touristTax', d.touristTax, e))
          + card(fh('shield', 'Caution') + inRow('Montant', 'depositAmount', d.depositAmount, e) + inRow('Libération (jours)', 'depositReleaseDays', d.depositReleaseDays, { mode: 'numeric', small: true }))
          + card(fh('percent', 'Commissions') + inRow('Conciergerie', 'conciergePct', d.conciergePct, pc) + inRow('Airbnb', 'airbnbCommissionPct', d.airbnbCommissionPct, pc) + inRow('Booking.com', 'bookingCommissionPct', d.bookingCommissionPct, pc))
          + '<p class="bhp-note bhp-note--c">Saisir 0 efface un montant.<br>Un champ vide conserve la valeur actuelle.</p>';
      },
      save: function (p, d) {
        return putProperty(p, numFields(d, [['basePrice', 'basePrice'], ['weekendPrice', 'weekendPrice'], ['cleaningFee', 'cleaningFee'], ['touristTax', 'touristTaxPerNight'],
          ['depositAmount', 'depositAmount'], ['depositReleaseDays', 'depositReleaseDays'], ['conciergePct', 'conciergePct'], ['airbnbCommissionPct', 'airbnbCommissionPct'], ['bookingCommissionPct', 'bookingCommissionPct']]));
      }
    },

    /* ── Prestations payantes ── */
    upsell: {
      title: 'Prestations payantes',
      draft: function (p) {
        return { lcoEnabled: p.lateCheckoutEnabled === true, lcoTolerance: intStr(p.lateCheckoutToleranceMinutes), lcoPrice: numStr(p.lateCheckoutPricePerHour), lcoMax: intStr(p.lateCheckoutMaxMinutes),
          eciEnabled: p.earlyCheckinEnabled === true, eciTolerance: intStr(p.earlyCheckinToleranceMinutes), eciPrice: numStr(p.earlyCheckinPricePerHour), eciMax: intStr(p.earlyCheckinMaxMinutes),
          basketEnabled: p.welcomeBasketEnabled === true, basketPrice: numStr(p.welcomeBasketPrice), basketDescription: p.welcomeBasketDescription || '' };
      },
      read: function (p) {
        function rows(t, pr, m) {
          var r = [];
          if (t > 0) r.push(kv('Tolérance gratuite', duration(t)));
          if (pr > 0) r.push(kv('Tarif', fmtAmount(pr) + ' / h'));
          if (m > 0) r.push(kv('Maximum', duration(m)));
          return r.join('');
        }
        var h = '';
        if (p.lateCheckoutEnabled === true) h += card(fh('moon', 'Check-out tardif') + rows(p.lateCheckoutToleranceMinutes, p.lateCheckoutPricePerHour, p.lateCheckoutMaxMinutes));
        if (p.earlyCheckinEnabled === true) h += card(fh('sunrise', 'Check-in anticipé') + rows(p.earlyCheckinToleranceMinutes, p.earlyCheckinPricePerHour, p.earlyCheckinMaxMinutes));
        if (p.welcomeBasketEnabled === true) h += card(fh('gift', 'Panier de bienvenue') + (p.welcomeBasketPrice > 0 ? kv('Prix', fmtAmount(p.welcomeBasketPrice)) : '') + (p.welcomeBasketDescription ? txtRow(p.welcomeBasketDescription) : ''));
        return h || emptyCard('Aucune prestation payante configurée.');
      },
      edit: function (d) {
        var m = { unit: 'min', mode: 'numeric', small: true }, e = { unit: '€' };
        return card(fh('moon', 'Check-out tardif') + toggleRow('Activé', 'lcoEnabled', d.lcoEnabled, true)
          + (d.lcoEnabled ? inRow('Tolérance gratuite', 'lcoTolerance', d.lcoTolerance, m) + inRow('Tarif / heure', 'lcoPrice', d.lcoPrice, e) + inRow('Durée max', 'lcoMax', d.lcoMax, m) : ''))
          + card(fh('sunrise', 'Check-in anticipé') + toggleRow('Activé', 'eciEnabled', d.eciEnabled, true)
          + (d.eciEnabled ? inRow('Tolérance gratuite', 'eciTolerance', d.eciTolerance, m) + inRow('Tarif / heure', 'eciPrice', d.eciPrice, e) + inRow('Durée max', 'eciMax', d.eciMax, m) : ''))
          + card(fh('gift', 'Panier de bienvenue') + toggleRow('Activé', 'basketEnabled', d.basketEnabled, true)
          + (d.basketEnabled ? inRow('Prix', 'basketPrice', d.basketPrice, e) + taRow('basketDescription', d.basketDescription, 'Description du panier', 3) : ''));
      },
      save: function (p, d) {
        var body = {
          late_checkout_enabled: !!d.lcoEnabled, late_checkout_tolerance_minutes: int(d.lcoTolerance), late_checkout_price_per_hour: num(d.lcoPrice), late_checkout_max_minutes: int(d.lcoMax),
          early_checkin_enabled: !!d.eciEnabled, early_checkin_tolerance_minutes: int(d.eciTolerance), early_checkin_price_per_hour: num(d.eciPrice), early_checkin_max_minutes: int(d.eciMax),
          welcome_basket_enabled: !!d.basketEnabled, welcome_basket_price: num(d.basketPrice), welcome_basket_description: d.basketDescription ? d.basketDescription : null
        };
        Object.keys(body).forEach(function (k) { if (body[k] === null && k !== 'welcome_basket_description') delete body[k]; });
        if (body.welcome_basket_description === null) delete body.welcome_basket_description;
        return api('PUT', '/api/properties/' + encodeURIComponent(p.id) + '/upsell', body).then(function () {
          return fetchProperty(p.id).catch(function () { return clone(Object.assign({}, p, { _raw: null })); });
        }).then(function (np) {
          np.lateCheckoutEnabled = !!d.lcoEnabled; np.lateCheckoutToleranceMinutes = int(d.lcoTolerance); np.lateCheckoutPricePerHour = num(d.lcoPrice); np.lateCheckoutMaxMinutes = int(d.lcoMax);
          np.earlyCheckinEnabled = !!d.eciEnabled; np.earlyCheckinToleranceMinutes = int(d.eciTolerance); np.earlyCheckinPricePerHour = num(d.eciPrice); np.earlyCheckinMaxMinutes = int(d.eciMax);
          np.welcomeBasketEnabled = !!d.basketEnabled; np.welcomeBasketPrice = num(d.basketPrice); np.welcomeBasketDescription = d.basketDescription || null;
          return np;
        });
      }
    },

    /* ── Accès (LIVRET) ── */
    access: {
      title: 'Accès',
      banner: 'Le code, le WiFi et les instructions partent directement dans le livret d\'accueil. Tu ne les saisis qu\'ici.',
      draft: function (p) { return { accessCode: p.accessCode || '', wifiName: p.wifiName || '', wifiPassword: p.wifiPassword || '', accessInstructions: p.accessInstructions || '' }; },
      read: function (p) {
        var h = '';
        if (p.accessCode) h += card(fh('key', 'Code d\'accès') + txtRow(p.accessCode, 'bhp-mono'));
        if (p.wifiName || p.wifiPassword) h += card(fh('wifi', 'WiFi') + (p.wifiName ? kv('Réseau', p.wifiName) : '') + (p.wifiPassword ? kv('Mot de passe', p.wifiPassword, 'bhp-mono') : ''));
        if (p.accessInstructions) h += fieldCard('align', 'Instructions', p.accessInstructions);
        return h || emptyCard('Aucune information d\'accès renseignée.');
      },
      edit: function (d) {
        return card(fh('key', 'Code d\'accès') + tfRow('accessCode', d.accessCode, 'Code de la boîte à clés, digicode…', true))
          + card(fh('wifi', 'WiFi') + inRow('Réseau', 'wifiName', d.wifiName, { mode: 'text', ph: 'Nom du réseau', wide: true }) + inRow('Mot de passe', 'wifiPassword', d.wifiPassword, { mode: 'text', ph: 'Mot de passe', wide: true, mono: true }))
          + card(fh('align', 'Instructions') + taRow('accessInstructions', d.accessInstructions, 'Comment accéder au logement ?', 5));
      },
      save: function (p, d) { return putProperty(p, { accessCode: d.accessCode, wifiName: d.wifiName, wifiPassword: d.wifiPassword, accessInstructions: d.accessInstructions }); }
    },

    /* ── Le quartier (LIVRET) ── */
    neighborhood: {
      title: 'Le quartier',
      banner: 'Ces quatre champs partent directement dans le livret d\'accueil. Tu ne les saisis qu\'ici.',
      draft: function (p) { var i = p.practicalInfo || {}; return { parkingDetails: i.parkingDetails || '', trashDay: i.trashDay || '', nearbyShops: i.nearbyShops || '', publicTransport: i.publicTransport || '' }; },
      read: function (p) {
        var i = p.practicalInfo || {}, h = '';
        if (i.parkingDetails) h += fieldCard('parking', 'Stationnement', i.parkingDetails);
        if (i.trashDay) h += card(fh('trash', 'Poubelles') + lines(i.trashDay).map(function (l) { var c = trashColor(l); return htmlRow('<div class="bhp-list-item">' + (c ? '<span class="bhp-bin" style="background:' + c + '"></span>' : '') + '<span>' + esc(l) + '</span></div>'); }).join(''));
        if (i.nearbyShops) h += fieldCard('store', 'Commerces', i.nearbyShops);
        if (i.publicTransport) h += fieldCard('bus', 'Transports en commun', i.publicTransport);
        return h || emptyCard('Aucune information sur le quartier.');
      },
      edit: function (d) {
        return card(fh('parking', 'Stationnement') + taRow('parkingDetails', d.parkingDetails, 'Comment se garer ?'))
          + card(fh('trash', 'Poubelles') + taRow('trashDay', d.trashDay, 'Jours et couleurs des bacs'))
          + card(fh('store', 'Commerces') + taRow('nearbyShops', d.nearbyShops, 'Supérette, boulangerie…'))
          + card(fh('bus', 'Transports en commun') + taRow('publicTransport', d.publicTransport, 'Bus, métro, RER…'));
      },
      save: function (p, d) {
        return putProperty(p, { practicalInfo: JSON.stringify({ parking_details: d.parkingDetails, trash_day: d.trashDay, nearby_shops: d.nearbyShops, public_transport: d.publicTransport }) });
      }
    },

    /* ── Équipements & règles (LIVRET) ── */
    amenities: {
      title: 'Équipements & règles',
      banner: 'Les équipements et le règlement partent directement dans le livret d\'accueil. Tu ne les saisis qu\'ici.',
      draft: function (p) {
        var a = p.amenities || {}, r = p.houseRules || {}, d = { am: {}, rules: {}, customEquip: (a.custom || []).slice(), customRules: (r.custom || []).slice() };
        AMEN_KEYS.forEach(function (k) { d.am[k[0]] = a[k[0]] === true; });
        RULE_KEYS.forEach(function (k) { d.rules[k[0]] = r[k[0]] == null ? null : r[k[0]]; });
        return d;
      },
      read: function (p) {
        var a = p.amenities, r = p.houseRules, h = '';
        var items = [];
        if (a) { AMEN_KEYS.forEach(function (k) { if (a[k[0]] === true) items.push(k[2]); }); items = items.concat(a.custom || []); }
        if (items.length) h += card(fh('house', 'Équipements') + items.map(function (t) { return htmlRow('<div class="bhp-list-item">' + ic('check') + '<span>' + esc(t) + '</span></div>'); }).join(''));
        var rules = r ? RULE_KEYS.filter(function (k) { return r[k[0]] != null; }) : [], customs = r ? (r.custom || []) : [];
        if (rules.length || customs.length) {
          h += card(fh('hand', 'Règlement') + rules.map(function (k) {
            var ok = r[k[0]], f = k[1] === 'Fêtes';
            return htmlRow('<div class="bhp-list-item">' + ic(ok ? 'check' : 'xmark', ok ? '' : 'bhp-ic--no') + '<span>' + esc(k[1] + (ok ? (f ? ' acceptées' : ' acceptés') : (f ? ' non autorisées' : ' non autorisés'))) + '</span></div>');
          }).join('') + customs.map(function (t) { return txtRow(t); }).join(''));
        }
        return h || emptyCard('Aucun équipement ni règlement renseigné.');
      },
      edit: function (d) {
        var h = card(fh('house', 'Équipements') + AMEN_KEYS.map(function (k) { return toggleRow(k[2], 'am.' + k[0], d.am[k[0]], false); }).join('')
          + d.customEquip.map(function (v, i) { return htmlRow('<div class="bhp-flexrow"><input class="bhp-input bhp-grow" data-k="customEquip.' + i + '" value="' + esc(v) + '" placeholder="Équipement personnalisé">' + minusBtn('am-del-equip', i) + '</div>'); }).join('')
          + addRow('am-add-equip', 'Ajouter un équipement'));
        h += card(fh('hand', 'Règlement') + RULE_KEYS.map(function (k) {
          var v = d.rules[k[0]];
          return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">' + k[1] + '</span><select class="bhp-input bhp-select" data-k="rules.' + k[0] + '" data-type="nbool">'
            + '<option value=""' + (v == null ? ' selected' : '') + '>Non précisé</option><option value="true"' + (v === true ? ' selected' : '') + '>Autorisé</option><option value="false"' + (v === false ? ' selected' : '') + '>Non autorisé</option></select></div>';
        }).join('')
          + d.customRules.map(function (v, i) { return htmlRow('<div class="bhp-flexrow"><input class="bhp-input bhp-grow" data-k="customRules.' + i + '" value="' + esc(v) + '" placeholder="Règle personnalisée">' + minusBtn('am-del-rule', i) + '</div>'); }).join('')
          + addRow('am-add-rule', 'Ajouter une règle'));
        return h;
      },
      act: function (act, el, c) {
        var d = c.sec.draft;
        if (act === 'am-add-equip') d.customEquip.push('');
        else if (act === 'am-del-equip') d.customEquip.splice(+el.dataset.i, 1);
        else if (act === 'am-add-rule') d.customRules.push('');
        else if (act === 'am-del-rule') d.customRules.splice(+el.dataset.i, 1);
        else return;
        c.rerender();
        if (act.indexOf('add') >= 0) { var ins = c.root.querySelectorAll('[data-k^="' + (act === 'am-add-equip' ? 'customEquip.' : 'customRules.') + '"]'); if (ins.length) ins[ins.length - 1].focus(); }
      },
      save: function (p, d) {
        var am = {};
        AMEN_KEYS.forEach(function (k) { am[k[0]] = !!d.am[k[0]]; if (k[1] !== k[0]) am[k[1]] = !!d.am[k[0]]; });
        var ce = d.customEquip.map(function (s) { return s.trim(); }).filter(Boolean);
        am.custom = ce;
        var hr = {};
        RULE_KEYS.forEach(function (k) { hr[k[0]] = d.rules[k[0]] == null ? null : d.rules[k[0]]; });
        hr.custom = d.customRules.map(function (s) { return s.trim(); }).filter(Boolean);
        return putProperty(p, { amenities: JSON.stringify(am), houseRules: JSON.stringify(hr) });
      }
    },

    /* ── Assistant IA ── */
    ai: {
      title: 'Assistant IA',
      draft: function (p) {
        return { enabled: p.autoResponsesEnabled == null ? true : p.autoResponsesEnabled, qr: p.customAutoResponses.map(function (x) { return { keywords: x.keywords, response: x.response }; }),
          replies: p.quickReplies.map(function (x) { return { title: x.title, text: x.text }; }), nf: { q: '', a: true, d: '' } };
      },
      mount: function (c) {
        var x = c.sec.x; x.factsLoading = true; x.facts = [];
        api('GET', '/api/properties/' + encodeURIComponent(c.p.id) + '/facts').then(function (r) { x.facts = r.facts || []; }).catch(function () {})
          .then(function () { x.factsLoading = false; if (c.S.sec === c.sec) { if (c.sec.editing) collect(c.root.querySelector('[data-sec-body]'), c.sec.draft); c.rerender(); } });
      },
      onCancel: function (c) { c.sec.x.adding = false; },
      read: function (p, c) { return SECTIONS.ai._render(p, null, c); },
      edit: function (d, c) { return SECTIONS.ai._render(c.p, d, c); },
      _render: function (p, d, c) {
        var x = c.sec.x, editing = !!d, h = '';
        if (!x.facts) x.facts = [];
        if (x.factsLoading == null) x.factsLoading = true;
        // Statut
        var stat;
        if (editing) stat = toggleRow('Auto-réponses actives', 'enabled', d.enabled, false);
        else stat = htmlRow(p.autoResponsesEnabled === true ? okLine('Actif') : '<span class="bhp-txt bhp-att">' + (p.autoResponsesEnabled === false ? 'Inactif' : '—') + '</span>');
        h += card(fh('sparkles', 'Statut') + stat);
        // Q&R
        var qrs = editing ? d.qr : p.customAutoResponses, qh = '';
        if (editing) {
          qh = qrs.map(function (q, i) {
            return htmlRow('<div class="bhp-vstack"><div class="bhp-flexrow"><span class="bhp-mini bhp-grow" style="margin:0">Mots-clés</span>' + minusBtn('ai-del-qr', i) + '</div>'
              + '<input class="bhp-input" data-k="qr.' + i + '.keywords" value="' + esc(q.keywords) + '" placeholder="piscine, pool, wifi…">'
              + '<span class="bhp-mini" style="margin:0">Réponse</span><textarea class="bhp-input bhp-ta" rows="3" data-k="qr.' + i + '.response" placeholder="La réponse à envoyer au voyageur">' + esc(q.response) + '</textarea></div>');
          }).join('') + addRow('ai-add-qr', 'Ajouter une Q&R');
        } else if (!qrs.length) qh = htmlRow('<span class="bhp-empty">Aucune Q&amp;R personnalisée.</span>');
        else qh = qrs.map(function (q) {
          var kws = q.keywords.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          return htmlRow('<div class="bhp-vstack">' + (kws.length ? '<div><div class="bhp-mini">Mots-clés</div>' + kws.map(function (k) { return '<div class="bhp-bullet">' + esc(k) + '</div>'; }).join('') + '</div>' : '')
            + '<div><div class="bhp-mini">Réponse</div><div class="bhp-body13">' + esc(q.response) + '</div></div></div>');
        }).join('');
        h += card(fh('qbubble', 'Q&R personnalisées') + qh);
        // Faits mémorisés
        var fhh = '';
        if (x.factsLoading) fhh = loadingRow();
        else if (!x.facts.length && !editing) fhh = htmlRow('<span class="bhp-empty">Aucun fait mémorisé.</span>');
        else {
          fhh = x.facts.map(function (f) {
            var ans = f.answer === true ? '<span class="bhp-okline" style="font-size:13.5px">' + ic('checkFill') + 'Oui</span>' : (f.answer === false ? '<span class="bhp-okline" style="font-size:13.5px;color:#5E6B63">' + ic('xFill') + 'Non</span>' : '<span class="bhp-att">—</span>');
            return htmlRow('<div class="bhp-flexrow" style="align-items:flex-start"><div class="bhp-grow"><div class="bhp-flexrow"><span class="bhp-grow" style="font-size:14.5px">' + esc(f.question) + '</span>' + ans + '</div>'
              + (f.detail ? '<div class="bhp-meta" style="margin-top:4px;font-size:12.5px">' + esc(f.detail) + '</div>' : '') + '</div>'
              + (editing ? '<button class="bhp-trash" data-act="ai-fact-del" data-id="' + esc(f.id) + '"' + (x.factSaving ? ' disabled' : '') + ' aria-label="Supprimer">' + I.trash + '</button>' : '') + '</div>');
          }).join('');
          if (editing) {
            if (x.adding) {
              fhh += htmlRow('<div class="bhp-vstack"><span class="bhp-mini" style="margin:0">Nouveau fait</span>'
                + '<input class="bhp-input" data-k="nf.q" value="' + esc(d.nf.q) + '" placeholder="Question (ex: Y a-t-il une piscine ?)">'
                + '<div class="bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink" style="font-size:14px">Réponse</span>' + sw('nf.a', d.nf.a, false) + '</div>'
                + '<textarea class="bhp-input bhp-ta" rows="2" style="min-height:60px" data-k="nf.d" placeholder="Précision (optionnel)">' + esc(d.nf.d) + '</textarea>'
                + '<div class="bhp-flexrow"><button class="bhp-textbtn" style="font-size:14px" data-act="ai-fact-cancel">Annuler</button><span class="bhp-grow"></span>'
                + '<button class="bhp-glassbtn" data-act="ai-fact-add"' + (x.factSaving ? ' disabled' : '') + '>' + (x.factSaving ? '<span class="bhp-spin bhp-spin--v"></span>' : 'Ajouter') + '</button></div></div>');
            } else fhh += addRow('ai-fact-new', 'Ajouter un fait');
          }
        }
        h += card(fh('brain', 'Faits mémorisés') + fhh);
        // Raccourcis
        var reps = editing ? d.replies : p.quickReplies, rh = '';
        if (editing) {
          rh = reps.map(function (r, i) {
            return htmlRow('<div class="bhp-vstack"><div class="bhp-flexrow"><span class="bhp-mini bhp-grow" style="margin:0">Titre</span><span class="bhp-count" id="bhpc-t' + i + '">' + r.title.length + '/50</span>' + minusBtn('ai-del-reply', i) + '</div>'
              + '<input class="bhp-input" maxlength="50" data-counter="bhpc-t' + i + '" data-k="replies.' + i + '.title" value="' + esc(r.title) + '" placeholder="Libellé du bouton">'
              + '<div class="bhp-flexrow"><span class="bhp-mini bhp-grow" style="margin:0">Message</span><span class="bhp-count" id="bhpc-m' + i + '">' + r.text.length + '/200</span></div>'
              + '<textarea class="bhp-input bhp-ta" rows="3" maxlength="200" data-counter="bhpc-m' + i + '" data-k="replies.' + i + '.text" placeholder="Message envoyé au voyageur">' + esc(r.text) + '</textarea></div>');
          }).join('') + (reps.length < 5 ? addRow('ai-add-reply', 'Ajouter un raccourci') : '');
        } else if (!reps.length) rh = htmlRow('<span class="bhp-empty">Aucun raccourci configuré.</span>');
        else rh = reps.map(function (r) { return htmlRow('<div style="font-size:14px;font-weight:600">' + esc(r.title) + '</div><div class="bhp-body13 bhp-body13--att" style="margin-top:3px">' + esc(r.text) + '</div>'); }).join('');
        h += card(fh('bolt', 'Raccourcis (max 5)') + rh);
        return h;
      },
      act: function (act, el, c) {
        var d = c.sec.draft, x = c.sec.x, pid = c.p.id;
        if (act === 'ai-add-qr') { d.qr.push({ keywords: '', response: '' }); c.rerender(); }
        else if (act === 'ai-del-qr') { d.qr.splice(+el.dataset.i, 1); c.rerender(); }
        else if (act === 'ai-add-reply') { if (d.replies.length < 5) d.replies.push({ title: '', text: '' }); c.rerender(); }
        else if (act === 'ai-del-reply') { d.replies.splice(+el.dataset.i, 1); c.rerender(); }
        else if (act === 'ai-fact-new') { d.nf = { q: '', a: true, d: '' }; x.adding = true; c.rerender(); }
        else if (act === 'ai-fact-cancel') { x.adding = false; c.rerender(); }
        else if (act === 'ai-fact-add') {
          if (!d.nf.q.trim()) return;
          x.factSaving = true; c.rerender();
          api('POST', '/api/properties/' + encodeURIComponent(pid) + '/facts', { question: d.nf.q.trim(), answer: !!d.nf.a, detail: d.nf.d.trim() || null })
            .then(function (r) { if (r.fact) x.facts.push(r.fact); d.nf = { q: '', a: true, d: '' }; x.adding = false; })
            .catch(function (er) { alertMsg('Erreur (fait)', er.message); })
            .then(function () { x.factSaving = false; collect(c.root.querySelector('[data-sec-body]'), d); c.rerender(); });
        } else if (act === 'ai-fact-del') {
          var fid = el.dataset.id;
          x.factSaving = true; c.rerender();
          api('DELETE', '/api/properties/' + encodeURIComponent(pid) + '/facts/' + encodeURIComponent(fid))
            .then(function () { x.facts = x.facts.filter(function (f) { return String(f.id) !== String(fid); }); })
            .catch(function (er) { alertMsg('Erreur (fait)', er.message); })
            .then(function () { x.factSaving = false; collect(c.root.querySelector('[data-sec-body]'), d); c.rerender(); });
        }
      },
      save: function (p, d, c) {
        c.sec.x.adding = false;
        return putProperty(p, {
          autoResponsesEnabled: d.enabled ? 'true' : 'false',
          customAutoResponses: JSON.stringify(d.qr.map(function (q) { return { keywords: q.keywords, response: q.response }; })),
          quickReplies: JSON.stringify(d.replies.slice(0, 5).map(function (r) { return { title: r.title.slice(0, 50), text: r.text.slice(0, 200) }; }))
        });
      }
    },

    /* ── Plateformes & prix ── */
    platforms: {
      title: 'Plateformes & prix',
      draft: function (p, c) {
        var d = { ical: p.icalUrls.map(function (e) { return { platform: e.platform, url: e.url }; }), externalPricing: p.externalPricing === true, markups: {} };
        var mk = c.sec.x.markups;
        if (mk) Object.keys(mk.codes || {}).forEach(function (code) { d.markups[code] = mk.markups[code] != null ? fmtPct(mk.markups[code]).replace(',', '.') : ''; });
        return d;
      },
      mount: function (c) {
        var x = c.sec.x; x.mkLoading = true;
        api('GET', '/api/properties/' + encodeURIComponent(c.p.id) + '/markups').then(function (r) { x.markups = { markups: r.markups || {}, codes: r.codes || {} }; })
          .catch(function () { x.markups = null; })
          .then(function () {
            x.mkLoading = false; x.mkLoaded = true;
            if (c.S.sec !== c.sec) return;
            if (c.sec.editing) {
              collect(c.root.querySelector('[data-sec-body]'), c.sec.draft);
              if (x.markups) Object.keys(x.markups.codes).forEach(function (code) { var v = x.markups.markups[code]; c.sec.draft.markups[code] = v != null ? String(v) : ''; });
            }
            c.rerender();
          });
      },
      read: function (p, c) {
        var x = c.sec.x, h = '';
        h += card(fh('antenna', 'Diffusion') + htmlRow(p.channexEnabled === true ? okLine('Canal actif') : '<span class="bhp-txt bhp-att">Non connecté</span>'));
        h += card(fh('calendar', 'Calendriers iCal') + (p.icalUrls.length ? p.icalUrls.map(function (e) { return htmlRow('<div style="font-size:14px;font-weight:600">' + esc(e.platform) + '</div><div class="bhp-flux__u bhp-mono" style="font-size:12.5px">' + esc(e.url) + '</div>'); }).join('') : htmlRow('<span class="bhp-txt bhp-att">Aucun calendrier iCal importé.</span>')));
        if (p.externalPricing != null) h += card(fh('chart', 'Outil de pricing externe') + htmlRow(p.externalPricing ? okLine('Activé') : '<span class="bhp-txt bhp-att">Inactif</span>'));
        var mh;
        if (x.mkLoading || !x.mkLoaded) mh = loadingRow();
        else if (!x.markups) mh = htmlRow('<span class="bhp-empty">Impossible de charger les majorations.</span>');
        else {
          var codes = Object.keys(x.markups.codes).sort(function (a, b) { return String(x.markups.codes[a]).localeCompare(String(x.markups.codes[b]), 'fr'); });
          mh = !codes.length ? htmlRow('<span class="bhp-empty">Aucune plateforme configurée.</span>') : codes.map(function (code) {
            var v = x.markups.markups[code];
            return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">' + esc(x.markups.codes[code]) + '</span>' + (v != null ? '<span class="bhp-kv__v bhp-kv__v--b">+' + esc(fmtPct(v)) + '\u202f%</span>' : '<span class="bhp-kv__v bhp-att" style="font-size:14.5px">aucune majoration</span>') + '</div>';
          }).join('');
        }
        h += card(fh('percent', 'Majorations') + mh);
        return h;
      },
      edit: function (d, c) {
        var p = c.p, x = c.sec.x, h = '';
        h += card(fh('antenna', 'Diffusion') + htmlRow(p.channexEnabled === true ? okLine('Canal actif') : '<span class="bhp-txt bhp-att">Non connecté</span>'));
        h += card(fh('calendar', 'Calendriers iCal') + d.ical.map(function (e, i) {
          return htmlRow('<div class="bhp-flexrow" style="align-items:flex-start"><div class="bhp-grow bhp-vstack"><input class="bhp-input" data-k="ical.' + i + '.platform" value="' + esc(e.platform) + '" placeholder="Plateforme">'
            + '<input class="bhp-input bhp-mono" style="font-size:13px" data-k="ical.' + i + '.url" value="' + esc(e.url) + '" placeholder="https://…" inputmode="url" autocapitalize="off" spellcheck="false"></div>' + minusBtn('pl-del-ical', i) + '</div>');
        }).join('') + addRow('pl-add-ical', 'Ajouter une URL iCal'));
        h += card(fh('chart', 'Outil de pricing externe') + toggleRow('Activé', 'externalPricing', d.externalPricing, false));
        if (x.mkLoaded && x.markups) {
          var codes = Object.keys(x.markups.codes).sort(function (a, b) { return String(x.markups.codes[a]).localeCompare(String(x.markups.codes[b]), 'fr'); });
          h += card(fh('percent', 'Majorations par plateforme') + codes.map(function (code) {
            return '<div class="bhp-row bhp-kv"><span class="bhp-kv__l bhp-kv__l--ink">' + esc(x.markups.codes[code]) + '</span><span class="bhp-in-wrap"><input class="bhp-input bhp-input--s" data-k="markups.' + esc(code) + '" value="' + esc(d.markups[code] || '') + '" inputmode="decimal" placeholder="0"><span class="bhp-unit">%</span></span></div>';
          }).join('') + htmlRow('<span class="bhp-note" style="margin:0">Laisser vide ou saisir 0 pour supprimer la majoration.</span>'));
        } else if (!x.mkLoaded) h += card(fh('percent', 'Majorations par plateforme') + loadingRow());
        return h;
      },
      act: function (act, el, c) {
        var d = c.sec.draft;
        if (act === 'pl-add-ical') { d.ical.push({ platform: '', url: '' }); c.rerender(); }
        else if (act === 'pl-del-ical') { d.ical.splice(+el.dataset.i, 1); c.rerender(); }
      },
      save: function (p, d, c) {
        var list = d.ical.map(function (e) { return { url: String(e.url || '').trim(), platform: String(e.platform || '').trim() }; })
          .filter(function (e) { return e.url; }).map(function (e) { if (!e.platform) e.platform = guessPlatform(e.url); return e; });
        var bad = list.filter(function (e) { return !/^https?:\/\//i.test(e.url); })[0];
        if (bad) return Promise.reject(new Error('L\'URL doit être valide et commencer par http:// ou https://.'));
        var x = c.sec.x;
        return putProperty(p, { icalUrls: JSON.stringify(list), externalPricing: d.externalPricing ? 'true' : 'false' }).then(function (np) {
          if (!x.markups) return np;
          var jobs = Object.keys(x.markups.codes).map(function (code) {
            var s = String(d.markups[code] || '').trim().replace(',', '.'), orig = x.markups.markups[code] || 0, val = num(s) || 0;
            var changed = Math.abs(val - orig) > 0.001 || (s === '' && orig !== 0);
            if (!changed) return null;
            return api('PATCH', '/api/properties/' + encodeURIComponent(p.id) + '/markups', { code: code, pct: val })
              .then(function (r) { if (r && r.markups) x.markups.markups = r.markups; else { if (val) x.markups.markups[code] = val; else delete x.markups.markups[code]; } })
              .catch(function () {});
          }).filter(Boolean);
          return Promise.all(jobs).then(function () { return np; });
        });
      }
    }
  };

  BHP._internals = { normProperty: normProperty, fmtTime: fmtTime, fmtAmount: fmtAmount };
  BHP.ui = {
    esc: esc, pick: pick, num: num, int: int, bool: bool, str: str, pl: pl, hhmm: hhmm, fmtTime: fmtTime, fmtAmount: fmtAmount,
    api: api, dialog: dialog, alertMsg: alertMsg, confirmMsg: confirmMsg, openSheet: openSheet, openMenu: openMenu,
    navHTML: navHTML, circleBtn: circleBtn, glassBtn: glassBtn, card: card, fh: fh, kv: kv, txtRow: txtRow, htmlRow: htmlRow,
    emptyCard: emptyCard, loadingRow: loadingRow, label: label, warn: warn, okLine: okLine, pill: pill, ic: ic, I: I,
    SPIN: SPIN, CHEV: CHEV, isSubAccount: isSubAccount, subPermissions: subPermissions, normProperty: normProperty, dname: dname
  };
})();
