/* bh-property-detail-sections-11b.js — Section editors: Upsell, Access, Neighborhood, Amenities
   Exposes window.BhPropSections11b.mount(propertyId, section, property).
   Called by bh-property-detail-ios-10.js when ?section= param is present.
   Introduced by PROPERTIES_11B. */
(function () {
  'use strict';

  /* ── Early: fix back-nav before bh-layout.js DOMContentLoaded ─ */
  (function () {
    try {
      var params   = new URLSearchParams(window.location.search);
      var section  = params.get('section');
      var propId   = params.get('id');
      if (!section || !propId) return;
      var titles11b = {
        upsell:       'Prestations payantes',
        access:       'Accès',
        neighborhood: 'Le quartier',
        amenities:    'Équipements & règles'
      };
      if (!titles11b[section]) return;
      document.body.setAttribute('data-back-href',  '/property.html?id=' + propId);
      document.body.setAttribute('data-back-label', 'Logement');
      document.body.setAttribute('data-title',  titles11b[section]);
      document.body.setAttribute('data-kicker', titles11b[section]);
    } catch (e) {}
  }());

  /* ── Helpers ──────────────────────────────────────────────── */
  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, type) {
    var bg = type === 'error' ? '#DC2626' : type === 'warning' ? '#D97706' : '#0E3B2E';
    var t  = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:99999;'
      + 'background:' + bg + ';color:#fff;padding:12px 20px;border-radius:20px;'
      + 'font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;'
      + 'box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:none;white-space:nowrap;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity 0.3s';
      t.style.opacity    = '0';
      setTimeout(function () { t.remove(); }, 400);
    }, 2500);
  }

  /* parseJSONField — robust: handles object, JSON string, null, empty, invalid */
  function parseJSONField(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) {}
    }
    return fallback;
  }

  /* trashColorDot — detect color keyword in trash text */
  function trashColorDot(text) {
    if (!text) return null;
    var t = String(text).toLowerCase();
    if (t.indexOf('jaune') !== -1) return '#EAB308';
    if (t.indexOf('vert')  !== -1) return '#22C55E';
    if (t.indexOf('bleu')  !== -1) return '#3B82F6';
    if (t.indexOf('gris')  !== -1) return '#6B7280';
    if (t.indexOf('noir')  !== -1) return '#111827';
    return null;
  }

  /* tri-state helpers — never use Boolean() or || to avoid null→false bugs */
  function triStateToSelectValue(val) {
    if (val === true)  return 'true';
    if (val === false) return 'false';
    return '';
  }

  function selectToTriState(sel) {
    if (!sel) return null;
    if (sel.value === 'true')  return true;
    if (sel.value === 'false') return false;
    return null;
  }

  function numOrNull(el) {
    if (!el || el.value === '') return null;
    var v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  }

  function intOrNull(el) {
    if (!el || el.value === '') return null;
    var v = parseInt(el.value, 10);
    return isNaN(v) ? null : v;
  }

  /* ── Build base FormData — mirrors 11A, preserves ALL fields ─ */
  function buildBaseFormData(p) {
    var fd = new FormData();
    fd.append('name',               p.name         || '');
    fd.append('internalName',       p.internalName || '');
    fd.append('color',              p.color        || '');
    fd.append('airbnbCommissionPct',
      p.airbnbCommissionPct  != null ? p.airbnbCommissionPct  : 3);
    fd.append('bookingCommissionPct',
      p.bookingCommissionPct != null ? p.bookingCommissionPct : 15);
    var optionals = [
      'address', 'photoUrl', 'arrivalTime', 'departureTime', 'arrivalMessage',
      'accessCode', 'wifiName', 'wifiPassword', 'accessInstructions', 'welcomeBookUrl',
      'maxGuests', 'bedrooms', 'beds', 'bathrooms',
      'basePrice', 'weekendPrice', 'cleaningFee', 'touristTaxPerNight',
      'depositAmount', 'depositReleaseDays', 'conciergePct', 'currency',
      'autoResponsesEnabled', 'ownerId'
    ];
    optionals.forEach(function (key) {
      if (p[key] != null && p[key] !== '') fd.append(key, p[key]);
    });
    ['amenities', 'houseRules', 'practicalInfo', 'quickReplies'].forEach(function (key) {
      if (p[key] != null) {
        fd.append(key, typeof p[key] === 'string' ? p[key] : JSON.stringify(p[key]));
      }
    });
    return fd;
  }

  /* ── HTML helpers ─────────────────────────────────────────── */
  function sectionLabel(text) {
    return '<p class="prop-detail-section-label">' + escHtml(text) + '</p>';
  }

  function formField(id, label, value, inputType, extraAttrs) {
    return '<div class="prop-form-field">'
      + '<label class="prop-form-label" for="' + id + '">' + escHtml(label) + '</label>'
      + '<input class="prop-form-input" type="' + (inputType || 'text') + '" id="' + id + '"'
      + ' value="' + escHtml(String(value == null ? '' : value)) + '" '
      + (extraAttrs || '') + '>'
      + '</div>';
  }

  function formTextarea(id, label, value) {
    return '<div class="prop-form-field">'
      + '<label class="prop-form-label" for="' + id + '">' + escHtml(label) + '</label>'
      + '<textarea class="prop-form-textarea" id="' + id + '">'
      + escHtml(String(value == null ? '' : value))
      + '</textarea></div>';
  }

  function makeSectionHeader(title, backHref) {
    return '<div class="prop-section-header">'
      + '<a href="' + escHtml(backHref) + '" class="prop-section-back-btn">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"'
      + ' stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="15 18 9 12 15 6"/></svg>'
      + 'Retour'
      + '</a>'
      + '<span class="prop-section-title-text">' + escHtml(title) + '</span>'
      + '</div>';
  }

  function livretBanner(text) {
    return '<div class="prop-livret-banner">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"'
      + ' width="16" height="16" flex-shrink="0">'
      + '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>'
      + '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
      + '</svg><span>' + escHtml(text) + '</span></div>';
  }

  /* ── UPSELL — read ────────────────────────────────────────── */
  function renderUpsellRead(u) {
    var u  = u || {};
    var hasAny = !!(u.late_checkout_enabled || u.early_checkin_enabled || u.welcome_basket_enabled);
    var html = '';

    if (!hasAny) {
      html += '<div class="prop-read-card">'
        + '<p class="prop-section-empty">Aucune prestation payante configurée.</p>'
        + '</div>';
      return html;
    }

    html += sectionLabel('Services actifs');
    html += '<div class="prop-read-card">';

    var services = [
      {
        enabled: !!u.late_checkout_enabled,
        name:    'Check-out tardif',
        detail:  u.late_checkout_enabled && u.late_checkout_price_per_hour != null
          ? u.late_checkout_price_per_hour + ' €/h'
          + (u.late_checkout_tolerance_minutes ? ' · ' + u.late_checkout_tolerance_minutes + ' min offertes' : '')
          : null
      },
      {
        enabled: !!u.early_checkin_enabled,
        name:    'Check-in anticipé',
        detail:  u.early_checkin_enabled && u.early_checkin_price_per_hour != null
          ? u.early_checkin_price_per_hour + ' €/h'
          + (u.early_checkin_tolerance_minutes ? ' · ' + u.early_checkin_tolerance_minutes + ' min offertes' : '')
          : null
      },
      {
        enabled: !!u.welcome_basket_enabled,
        name:    'Panier de bienvenue',
        detail:  u.welcome_basket_enabled && u.welcome_basket_price != null
          ? u.welcome_basket_price + ' €'
          : null
      }
    ];

    services.forEach(function (svc) {
      html += '<div class="prop-service-read-row">'
        + '<div class="prop-service-read-main">'
        + '<span class="prop-service-read-name">' + escHtml(svc.name) + '</span>'
        + (svc.detail
          ? '<span class="prop-service-read-detail">' + escHtml(svc.detail) + '</span>'
          : '')
        + '</div>'
        + '<span class="prop-upsell-status '
        + (svc.enabled ? 'prop-upsell-status--active' : 'prop-upsell-status--inactive') + '">'
        + (svc.enabled ? 'Actif' : 'Inactif')
        + '</span></div>';
    });

    html += '</div>';
    return html;
  }

  /* ── UPSELL — edit ────────────────────────────────────────── */
  function renderUpsellEdit(u) {
    var u    = u || {};
    var html = '';

    var services = [
      {
        key:     'late_checkout',
        label:   'Check-out tardif',
        enabled: !!u.late_checkout_enabled,
        fields: [
          { id: 'psfLcTolerance', label: 'Tolérance gratuite (min)', key: 'late_checkout_tolerance_minutes', type: 'int' },
          { id: 'psfLcPrice',     label: 'Tarif par heure (€)',       key: 'late_checkout_price_per_hour',   type: 'num' },
          { id: 'psfLcMax',       label: 'Maximum (min)',              key: 'late_checkout_max_minutes',      type: 'int' }
        ]
      },
      {
        key:     'early_checkin',
        label:   'Check-in anticipé',
        enabled: !!u.early_checkin_enabled,
        fields: [
          { id: 'psfEcTolerance', label: 'Tolérance gratuite (min)', key: 'early_checkin_tolerance_minutes', type: 'int' },
          { id: 'psfEcPrice',     label: 'Tarif par heure (€)',       key: 'early_checkin_price_per_hour',   type: 'num' },
          { id: 'psfEcMax',       label: 'Maximum (min)',              key: 'early_checkin_max_minutes',      type: 'int' }
        ]
      },
      {
        key:     'welcome_basket',
        label:   'Panier de bienvenue',
        enabled: !!u.welcome_basket_enabled,
        fields: [
          { id: 'psfWbPrice',       label: 'Prix (€)',    key: 'welcome_basket_price',       type: 'num' },
          { id: 'psfWbDescription', label: 'Description', key: 'welcome_basket_description', type: 'text', textarea: true }
        ]
      }
    ];

    services.forEach(function (svc) {
      var toggleId = 'psfToggle_' + svc.key;
      var fieldsId = 'psfFields_' + svc.key;

      html += '<div class="prop-form-card prop-service-card">';
      html += '<div class="prop-toggle-row">'
        + '<span class="prop-form-label prop-toggle-label">' + escHtml(svc.label) + '</span>'
        + '<button type="button" class="prop-toggle' + (svc.enabled ? ' prop-toggle--on' : '') + '"'
        + ' id="' + toggleId + '" role="switch"'
        + ' aria-checked="' + svc.enabled + '"'
        + ' aria-label="' + escHtml(svc.label) + '">'
        + '<span class="prop-toggle-knob"></span></button>'
        + '</div>';

      html += '<div class="prop-service-fields" id="' + fieldsId + '"'
        + (svc.enabled ? '' : ' style="display:none"') + '>';

      svc.fields.forEach(function (f) {
        var raw = u[f.key];
        var val = raw != null ? raw : '';
        if (f.textarea) {
          html += formTextarea(f.id, f.label, String(val));
        } else {
          html += formField(f.id, f.label, String(val), 'number', 'min="0" step="' + (f.type === 'num' ? '0.01' : '1') + '"');
        }
      });

      html += '</div></div>';
    });

    return html;
  }

  function bindUpsellToggles() {
    ['late_checkout', 'early_checkin', 'welcome_basket'].forEach(function (key) {
      var btn    = document.getElementById('psfToggle_' + key);
      var fields = document.getElementById('psfFields_' + key);
      if (!btn || !fields) return;
      btn.addEventListener('click', function () {
        var isOn = btn.getAttribute('aria-checked') === 'true';
        isOn = !isOn;
        btn.setAttribute('aria-checked', String(isOn));
        btn.classList.toggle('prop-toggle--on', isOn);
        fields.style.display = isOn ? '' : 'none';
      });
    });
  }

  function collectUpsellPayload() {
    function isOn(key) {
      var btn = document.getElementById('psfToggle_' + key);
      return btn ? btn.getAttribute('aria-checked') === 'true' : false;
    }
    return {
      late_checkout_enabled:           isOn('late_checkout'),
      late_checkout_tolerance_minutes: intOrNull(document.getElementById('psfLcTolerance')),
      late_checkout_price_per_hour:    numOrNull(document.getElementById('psfLcPrice')),
      late_checkout_max_minutes:       intOrNull(document.getElementById('psfLcMax')),
      early_checkin_enabled:           isOn('early_checkin'),
      early_checkin_tolerance_minutes: intOrNull(document.getElementById('psfEcTolerance')),
      early_checkin_price_per_hour:    numOrNull(document.getElementById('psfEcPrice')),
      early_checkin_max_minutes:       intOrNull(document.getElementById('psfEcMax')),
      welcome_basket_enabled:          isOn('welcome_basket'),
      welcome_basket_price:            numOrNull(document.getElementById('psfWbPrice')),
      welcome_basket_description:      (function () {
        var el = document.getElementById('psfWbDescription');
        return el ? el.value : null;
      }())
    };
  }

  /* ── ACCESS — read ────────────────────────────────────────── */
  function renderAccessRead(p) {
    var html = '';

    function readRow(label, value, mono) {
      var valHtml = value
        ? '<span class="prop-read-value' + (mono ? ' prop-read-value--mono' : '') + '">'
          + escHtml(value) + '</span>'
        : '<span class="prop-read-empty">Non renseigné</span>';
      return '<div class="prop-read-row">'
        + '<span class="prop-read-label">' + escHtml(label) + '</span>'
        + valHtml + '</div>';
    }

    html += sectionLabel('Code & Wi-Fi');
    html += '<div class="prop-read-card">'
      + readRow('CODE D\'ACCÈS',   p.accessCode,   true)
      + readRow('RÉSEAU WI-FI',    p.wifiName,     false)
      + readRow('MOT DE PASSE',    p.wifiPassword, true)
      + '</div>';

    if (p.accessInstructions) {
      html += sectionLabel("Instructions d'accès");
      html += '<div class="prop-read-card">'
        + '<div class="prop-read-value prop-read-value--multiline">'
        + escHtml(p.accessInstructions)
        + '</div></div>';
    }

    html += livretBanner(
      "Le code, le Wi-Fi et les instructions partent directement dans le livret d'accueil."
    );

    return html;
  }

  /* ── ACCESS — edit ────────────────────────────────────────── */
  function renderAccessEdit(p) {
    var html = '';

    html += sectionLabel("Code d'accès");
    html += '<div class="prop-form-card">'
      + formField('psfAccessCode', "Code d'accès", p.accessCode, 'text', 'autocomplete="off"')
      + '</div>';

    html += sectionLabel('Wi-Fi');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-grid-2">'
      + formField('psfWifiName',     'Nom du réseau', p.wifiName,     'text', '')
      + formField('psfWifiPassword', 'Mot de passe',  p.wifiPassword, 'text', 'autocomplete="off"')
      + '</div></div>';

    html += sectionLabel("Instructions d'accès");
    html += '<div class="prop-form-card">'
      + formTextarea('psfAccessInstructions', "Instructions pour les voyageurs", p.accessInstructions)
      + '</div>';

    return html;
  }

  function applyAccessFields(fd) {
    var ac = document.getElementById('psfAccessCode');
    var wn = document.getElementById('psfWifiName');
    var wp = document.getElementById('psfWifiPassword');
    var ai = document.getElementById('psfAccessInstructions');
    fd.set('accessCode',         ac ? ac.value : '');
    fd.set('wifiName',           wn ? wn.value : '');
    fd.set('wifiPassword',       wp ? wp.value : '');
    fd.set('accessInstructions', ai ? ai.value : '');
  }

  /* ── NEIGHBORHOOD — read ──────────────────────────────────── */
  function renderNeighborhoodRead(p) {
    var info = parseJSONField(p.practicalInfo, {});
    var html = '';

    function nRow(label, val) {
      if (!val) {
        return '<div class="prop-read-row">'
          + '<span class="prop-read-label">' + escHtml(label) + '</span>'
          + '<span class="prop-read-empty">Non renseigné</span></div>';
      }
      var dotHtml = '';
      if (label === 'POUBELLES') {
        var color = trashColorDot(val);
        if (color) {
          dotHtml = '<span class="prop-trash-dot" style="background:' + escHtml(color) + '"></span>';
        }
      }
      return '<div class="prop-read-row">'
        + '<span class="prop-read-label">' + escHtml(label) + '</span>'
        + '<span class="prop-read-value">' + dotHtml + escHtml(val) + '</span>'
        + '</div>';
    }

    html += sectionLabel('Informations pratiques');
    html += '<div class="prop-read-card">'
      + nRow('STATIONNEMENT', info.parking_details)
      + nRow('POUBELLES',     info.trash_day)
      + nRow('COMMERCES',     info.nearby_shops)
      + nRow('TRANSPORTS',    info.public_transport)
      + '</div>';

    html += livretBanner(
      'Ces informations partent directement dans le livret d\'accueil.'
    );

    return html;
  }

  /* ── NEIGHBORHOOD — edit ──────────────────────────────────── */
  function renderNeighborhoodEdit(p) {
    var info = parseJSONField(p.practicalInfo, {});
    var html = '';

    html += sectionLabel('Informations pratiques');
    html += '<div class="prop-form-card">'
      + formTextarea('psfParking',   'Stationnement',       info.parking_details  || '')
      + formTextarea('psfTrash',     'Poubelles',           info.trash_day        || '')
      + formTextarea('psfShops',     'Commerces',           info.nearby_shops     || '')
      + formTextarea('psfTransport', 'Transports en commun', info.public_transport || '')
      + '</div>';

    return html;
  }

  function applyNeighborhoodFields(fd) {
    var info = {
      parking_details:  (document.getElementById('psfParking')   || { value: '' }).value.trim(),
      trash_day:         (document.getElementById('psfTrash')     || { value: '' }).value.trim(),
      nearby_shops:      (document.getElementById('psfShops')     || { value: '' }).value.trim(),
      public_transport:  (document.getElementById('psfTransport') || { value: '' }).value.trim()
    };
    fd.set('practicalInfo', JSON.stringify(info));
  }

  /* ── AMENITIES constants ──────────────────────────────────── */
  var STANDARD_AMENITIES = [
    { key: 'draps',           label: 'Draps'           },
    { key: 'serviettes',      label: 'Serviettes'      },
    { key: 'cuisine_equipee', label: 'Cuisine équipée' },
    { key: 'lave_linge',      label: 'Lave-linge'      },
    { key: 'lave_vaisselle',  label: 'Lave-vaisselle'  },
    { key: 'television',      label: 'Télévision'      },
    { key: 'parking',         label: 'Parking'         },
    { key: 'climatisation',   label: 'Climatisation'   }
  ];

  var HOUSE_RULES = [
    { key: 'animaux', label: 'Animaux',
      trueLabel: 'Animaux acceptés',     falseLabel: 'Animaux non acceptés',    nullLabel: 'Animaux : non précisé' },
    { key: 'fumeurs', label: 'Fumeurs',
      trueLabel: 'Fumeurs autorisés',    falseLabel: 'Fumeurs non autorisés',   nullLabel: 'Fumeurs : non précisé' },
    { key: 'fetes',   label: 'Fêtes',
      trueLabel: 'Fêtes autorisées',     falseLabel: 'Fêtes non autorisées',    nullLabel: 'Fêtes : non précisé' },
    { key: 'enfants', label: 'Enfants',
      trueLabel: 'Enfants bienvenus',    falseLabel: 'Enfants non autorisés',   nullLabel: 'Enfants : non précisé' }
  ];

  var _customAmenities = [];

  /* ── AMENITIES — read ─────────────────────────────────────── */
  function renderAmenitiesRead(p) {
    var am         = parseJSONField(p.amenities,   {});
    var hr         = parseJSONField(p.houseRules,  {});
    var customList = Array.isArray(am.custom) ? am.custom : [];
    var html       = '';

    /* Standard amenities */
    var active = STANDARD_AMENITIES.filter(function (a) { return !!am[a.key]; });
    html += sectionLabel('Équipements');

    if (active.length === 0 && customList.length === 0) {
      html += '<div class="prop-read-card"><p class="prop-section-empty">Aucun équipement renseigné.</p></div>';
    } else {
      html += '<div class="prop-read-card">';
      active.forEach(function (a) {
        html += '<div class="prop-amenity-row">'
          + '<span class="prop-amenity-check">✓</span>'
          + '<span>' + escHtml(a.label) + '</span></div>';
      });
      customList.forEach(function (name) {
        html += '<div class="prop-amenity-row">'
          + '<span class="prop-amenity-check">✓</span>'
          + '<span>' + escHtml(name) + '</span></div>';
      });
      html += '</div>';
    }

    /* House rules */
    html += sectionLabel('Règlement intérieur');
    html += '<div class="prop-read-card">';
    HOUSE_RULES.forEach(function (rule) {
      var val = hr[rule.key];
      var lbl, cls, icon;
      if (val === true)  { lbl = rule.trueLabel;  cls = 'prop-rule-badge--true';  icon = '✓'; }
      else if (val === false) { lbl = rule.falseLabel; cls = 'prop-rule-badge--false'; icon = '✕'; }
      else               { lbl = rule.nullLabel;   cls = 'prop-rule-badge--null';  icon = '—'; }

      html += '<div class="prop-rule-read-row">'
        + '<span class="prop-rule-badge ' + cls + '">' + icon + '</span>'
        + '<span class="prop-rule-read-label">' + escHtml(lbl) + '</span>'
        + '</div>';
    });

    var customRules = Array.isArray(hr.custom) ? hr.custom : [];
    customRules.forEach(function (name) {
      html += '<div class="prop-rule-read-row">'
        + '<span class="prop-rule-badge prop-rule-badge--true">✓</span>'
        + '<span class="prop-rule-read-label">' + escHtml(name) + '</span>'
        + '</div>';
    });
    html += '</div>';

    html += livretBanner(
      'Les équipements renseignés sont inclus dans le livret d\'accueil.'
    );

    return html;
  }

  /* ── AMENITIES — edit ─────────────────────────────────────── */
  function renderAmenitiesEdit(p) {
    var am   = parseJSONField(p.amenities,  {});
    var hr   = parseJSONField(p.houseRules, {});
    _customAmenities = Array.isArray(am.custom) ? am.custom.slice() : [];
    var html = '';

    /* Standard amenities grid */
    html += sectionLabel('Équipements');
    html += '<div class="prop-form-card"><div class="prop-amenities-grid">';
    STANDARD_AMENITIES.forEach(function (a) {
      html += '<label class="prop-amenity-check-label">'
        + '<input type="checkbox" class="prop-amenity-checkbox" id="psfAm_' + a.key + '"'
        + (am[a.key] ? ' checked' : '') + '>'
        + '<span class="prop-amenity-check-text">' + escHtml(a.label) + '</span>'
        + '</label>';
    });
    html += '</div></div>';

    /* Custom amenities */
    html += sectionLabel('Équipements personnalisés');
    html += '<div class="prop-form-card">'
      + '<div id="psfCustomAmenitiesList"></div>'
      + '<div class="prop-custom-add-row">'
      + '<input class="prop-form-input" type="text" id="psfCustomAmenityInput"'
      + ' placeholder="Ajouter un équipement…" aria-label="Nouvel équipement personnalisé">'
      + '<button type="button" class="prop-custom-add-btn" id="psfCustomAmenityAdd"'
      + ' aria-label="Ajouter">+</button>'
      + '</div></div>';

    /* House rules tri-state */
    html += sectionLabel('Règlement intérieur');
    html += '<div class="prop-form-card"><div class="prop-form-grid-2">';
    var triOpts = [
      { value: '',      label: 'Non précisé'  },
      { value: 'true',  label: 'Autorisé'     },
      { value: 'false', label: 'Non autorisé' }
    ];
    HOUSE_RULES.forEach(function (rule) {
      var selVal = triStateToSelectValue(hr[rule.key]);
      html += '<div class="prop-form-field">'
        + '<label class="prop-form-label" for="psfRule_' + rule.key + '">'
        + escHtml(rule.label) + '</label>'
        + '<select class="prop-form-input prop-form-select" id="psfRule_' + rule.key + '">';
      triOpts.forEach(function (o) {
        html += '<option value="' + escHtml(o.value) + '"'
          + (selVal === o.value ? ' selected' : '') + '>'
          + escHtml(o.label) + '</option>';
      });
      html += '</select></div>';
    });
    html += '</div></div>';

    return html;
  }

  function renderCustomAmenitiesList() {
    var listEl = document.getElementById('psfCustomAmenitiesList');
    if (!listEl) return;
    var html = '';
    _customAmenities.forEach(function (name, idx) {
      html += '<div class="prop-custom-item" data-idx="' + idx + '">'
        + '<span class="prop-custom-item-name">' + escHtml(name) + '</span>'
        + '<button type="button" class="prop-custom-remove-btn" data-idx="' + idx + '"'
        + ' aria-label="Supprimer ' + escHtml(name) + '">✕</button>'
        + '</div>';
    });
    listEl.innerHTML = html;
    listEl.querySelectorAll('.prop-custom-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        _customAmenities.splice(idx, 1);
        renderCustomAmenitiesList();
      });
    });
  }

  function bindAmenitiesUI() {
    renderCustomAmenitiesList();
    var addBtn   = document.getElementById('psfCustomAmenityAdd');
    var addInput = document.getElementById('psfCustomAmenityInput');
    if (!addBtn || !addInput) return;
    function addCustom() {
      var name = addInput.value.trim();
      if (!name) return;
      _customAmenities.push(name);
      addInput.value = '';
      renderCustomAmenitiesList();
    }
    addBtn.addEventListener('click', addCustom);
    addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
    });
  }

  function applyAmenitiesFields(fd, p) {
    /* Standard + custom amenities */
    var am = {};
    STANDARD_AMENITIES.forEach(function (a) {
      var el  = document.getElementById('psfAm_' + a.key);
      am[a.key] = el ? el.checked : false;
    });
    am.custom = _customAmenities.slice();
    fd.set('amenities', JSON.stringify(am));

    /* House rules — tri-state, never Boolean(), never || to avoid null→false */
    var existingHR  = parseJSONField(p.houseRules, {});
    var hr = {};
    HOUSE_RULES.forEach(function (rule) {
      var el    = document.getElementById('psfRule_' + rule.key);
      hr[rule.key] = selectToTriState(el);
    });
    hr.custom = Array.isArray(existingHR.custom) ? existingHR.custom : [];
    fd.set('houseRules', JSON.stringify(hr));
  }

  /* ── Shared FormData save ──────────────────────────────────── */
  function savePropertyFd(propertyId, fd, saveBtn, onSuccess) {
    fetch('/api/properties/' + propertyId, { method: 'PUT', body: fd })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, data: d }; });
      })
      .then(function (result) {
        if (result.ok) {
          showToast('Enregistré', 'success');
          onSuccess();
        } else {
          var msg = (result.data && result.data.message)
            ? result.data.message : 'Erreur lors de la sauvegarde';
          showToast(msg, 'error');
          saveBtn.disabled    = false;
          saveBtn.textContent = 'Enregistrer';
        }
      })
      .catch(function () {
        showToast('Erreur réseau', 'error');
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Enregistrer';
      });
  }

  /* ── Section titles ───────────────────────────────────────── */
  var SECTION_TITLES = {
    upsell:       'Prestations payantes',
    access:       'Accès',
    neighborhood: 'Le quartier',
    amenities:    'Équipements & règles'
  };

  /* ── Render section (read or edit) ───────────────────────── */
  function renderSection(propertyId, section, p, editMode, uData) {
    var bodyEl = document.getElementById('propDetBody');
    var loadEl = document.getElementById('propDetLoading');
    if (loadEl) loadEl.style.display = 'none';

    var sectionTitle = SECTION_TITLES[section] || section;
    var backHref     = '/property.html?id=' + propertyId;

    var html = '<div class="prop-section-view">';
    html += makeSectionHeader(sectionTitle, backHref);

    if (editMode) {
      if      (section === 'upsell')       html += renderUpsellEdit(uData);
      else if (section === 'access')       html += renderAccessEdit(p);
      else if (section === 'neighborhood') html += renderNeighborhoodEdit(p);
      else if (section === 'amenities')    html += renderAmenitiesEdit(p);

      html += '<div class="prop-section-actions">'
        + '<button class="prop-section-cancel-btn" id="psfCancelBtn">Annuler</button>'
        + '<button class="prop-section-save-btn" id="psfSaveBtn">Enregistrer</button>'
        + '</div>';
    } else {
      if      (section === 'upsell')       html += renderUpsellRead(uData);
      else if (section === 'access')       html += renderAccessRead(p);
      else if (section === 'neighborhood') html += renderNeighborhoodRead(p);
      else if (section === 'amenities')    html += renderAmenitiesRead(p);

      html += '<button class="prop-section-edit-btn" id="psfEditBtn">Modifier</button>';
    }

    html += '<div class="prop-bottom-pad"></div></div>';

    if (bodyEl) {
      bodyEl.innerHTML = html;
      bodyEl.style.display = '';
    }

    /* Desktop header */
    var desktopTitle  = document.getElementById('propDetTitle');
    var desktopKicker = document.getElementById('propDetKicker');
    if (desktopTitle)  desktopTitle.textContent  = sectionTitle;
    if (desktopKicker) desktopKicker.textContent = p.internalName || p.name || 'Logement';

    if (editMode) {
      /* Section-specific UI bindings */
      if (section === 'upsell')    bindUpsellToggles();
      if (section === 'amenities') bindAmenitiesUI();

      /* Cancel → read mode */
      var cancelBtn = document.getElementById('psfCancelBtn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          renderSection(propertyId, section, p, false, uData);
        });
      }

      /* Save */
      var saveBtn = document.getElementById('psfSaveBtn');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', function () {
        if (saveBtn.disabled) return;
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Enregistrement…';

        if (section === 'upsell') {
          var payload = collectUpsellPayload();
          fetch('/api/properties/' + propertyId + '/upsell', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
          })
          .then(function (r) {
            return r.json().then(function (d) { return { ok: r.ok, data: d }; });
          })
          .then(function (result) {
            if (result.ok) {
              showToast('Enregistré', 'success');
              setTimeout(function () { window.location.href = backHref; }, 800);
            } else {
              var msg = (result.data && result.data.message)
                ? result.data.message : 'Erreur lors de la sauvegarde';
              showToast(msg, 'error');
              saveBtn.disabled    = false;
              saveBtn.textContent = 'Enregistrer';
            }
          })
          .catch(function () {
            showToast('Erreur réseau', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Enregistrer';
          });
          return;
        }

        var fd = buildBaseFormData(p);
        if      (section === 'access')       applyAccessFields(fd);
        else if (section === 'neighborhood') applyNeighborhoodFields(fd);
        else if (section === 'amenities')    applyAmenitiesFields(fd, p);

        savePropertyFd(propertyId, fd, saveBtn, function () {
          setTimeout(function () { window.location.href = backHref; }, 800);
        });
      });

    } else {
      /* Edit button → edit mode */
      var editBtn = document.getElementById('psfEditBtn');
      if (editBtn) {
        editBtn.addEventListener('click', function () {
          renderSection(propertyId, section, p, true, uData);
        });
      }
    }
  }

  /* ── Mount — entry point ──────────────────────────────────── */
  function mount(propertyId, section, p) {
    if (section === 'upsell') {
      /* Fetch upsell data before rendering */
      var loadEl = document.getElementById('propDetLoading');
      var bodyEl = document.getElementById('propDetBody');
      if (loadEl) loadEl.style.display = '';
      if (bodyEl) bodyEl.style.display = 'none';

      fetch('/api/properties/' + propertyId + '/upsell')
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; })
        .then(function (u) {
          renderSection(propertyId, section, p, false, u || {});
        });
      return;
    }
    renderSection(propertyId, section, p, false, null);
  }

  window.BhPropSections11b = { mount: mount };
})();
