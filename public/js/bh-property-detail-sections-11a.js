/* bh-property-detail-sections-11a.js — Section editors: Identity, Stay, Money
   Exposes window.BhPropSections.mount(propertyId, section, property).
   Called by bh-property-detail-ios-10.js when ?section= param is present.
   Introduced by PROPERTIES_11A. */
(function () {
  'use strict';

  /* ── Early: fix back-nav before bh-layout.js DOMContentLoaded ─
     Scripts run synchronously; DOMContentLoaded fires after all scripts
     have executed, so body attribute updates here are visible to
     bh-layout.js's DOMContentLoaded handler. */
  (function () {
    try {
      var params  = new URLSearchParams(window.location.search);
      var section = params.get('section');
      var propId  = params.get('id');
      if (!section || !propId) return;
      document.body.setAttribute('data-back-href', '/property.html?id=' + propId);
      document.body.setAttribute('data-back-label', 'Logement');
      var titles = { identity: 'Identité', stay: 'Séjour', money: 'Argent' };
      if (titles[section]) {
        document.body.setAttribute('data-title',  titles[section]);
        document.body.setAttribute('data-kicker', titles[section]);
      }
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
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 400);
    }, 2500);
  }

  /* ── FormData builder — pre-fills all existing fields ────── */
  function buildBaseFormData(p) {
    var fd = new FormData();
    /* Always send required fields */
    fd.append('name',         p.name || '');
    fd.append('internalName', p.internalName || '');
    fd.append('color',        p.color || '');
    /* Commission defaults — always send per settings.js contract */
    fd.append('airbnbCommissionPct',  p.airbnbCommissionPct  != null ? p.airbnbCommissionPct  : 3);
    fd.append('bookingCommissionPct', p.bookingCommissionPct != null ? p.bookingCommissionPct : 15);
    /* Optional fields — only send if currently set */
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
    /* Rich JSON fields */
    ['amenities', 'houseRules', 'practicalInfo', 'quickReplies'].forEach(function (key) {
      if (p[key] != null) {
        fd.append(key, typeof p[key] === 'string' ? p[key] : JSON.stringify(p[key]));
      }
    });
    return fd;
  }

  /* ── Form field HTML renderers ────────────────────────────── */
  function sectionLabel(text) {
    return '<p class="prop-detail-section-label">' + escHtml(text) + '</p>';
  }

  function formField(id, label, value, inputType, extraAttrs) {
    return '<div class="prop-form-field">'
      + '<label class="prop-form-label" for="' + id + '">' + escHtml(label) + '</label>'
      + '<input class="prop-form-input" type="' + (inputType || 'text') + '" id="' + id + '"'
      + ' value="' + escHtml(String(value == null ? '' : value)) + '" ' + (extraAttrs || '') + '>'
      + '</div>';
  }

  function formTextarea(id, label, value) {
    return '<div class="prop-form-field">'
      + '<label class="prop-form-label" for="' + id + '">' + escHtml(label) + '</label>'
      + '<textarea class="prop-form-textarea" id="' + id + '">'
      + escHtml(String(value == null ? '' : value))
      + '</textarea>'
      + '</div>';
  }

  function formSelect(id, label, value, options, locked) {
    var cls = 'prop-form-input prop-form-select' + (locked ? ' prop-form-input--locked' : '');
    var html = '<div class="prop-form-field">'
      + '<label class="prop-form-label" for="' + id + '">' + escHtml(label) + '</label>'
      + '<select class="' + cls + '" id="' + id + '"' + (locked ? ' disabled' : '') + '>';
    options.forEach(function (o) {
      var sel = String(value) === String(o.value) ? ' selected' : '';
      html += '<option value="' + escHtml(String(o.value)) + '"' + sel + '>'
        + escHtml(o.label) + '</option>';
    });
    html += '</select></div>';
    return html;
  }

  /* ── Section: Identity ────────────────────────────────────── */
  function renderIdentity(p) {
    var html = '';

    html += sectionLabel('Informations générales');
    html += '<div class="prop-form-card">'
      + formField('psfName',         'Nom affiché *',  p.name,         'text', 'required')
      + formField('psfInternalName', 'Nom interne',     p.internalName, 'text', '')
      + formField('psfAddress',      'Adresse',         p.address,      'text', '')
      + '</div>';

    html += sectionLabel('Couleur');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-field">'
      + '<label class="prop-form-label">Couleur</label>'
      + '<div class="prop-color-field">'
      + '<input type="color" class="prop-color-swatch" id="psfColorPicker"'
      + ' value="' + escHtml(p.color || '#0E3B2E') + '">'
      + '<input class="prop-form-input prop-form-input--color" type="text"'
      + ' id="psfColor" value="' + escHtml(p.color || '') + '" placeholder="#000000" maxlength="7">'
      + '</div></div></div>';

    html += sectionLabel('Capacité');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-grid-2">'
      + formField('psfMaxGuests', 'Voyageurs max', p.maxGuests, 'number', 'min="1"')
      + formField('psfBedrooms',  'Chambres',       p.bedrooms,  'number', 'min="0"')
      + '</div>'
      + '<div class="prop-form-grid-2">'
      + formField('psfBeds',      'Lits',           p.beds,      'number', 'min="0"')
      + formField('psfBathrooms', 'Salles de bain', p.bathrooms, 'number', 'min="0" step="0.5"')
      + '</div>'
      + '</div>';

    html += sectionLabel('Photo');
    html += '<div class="prop-form-card">'
      + formField('psfPhotoUrl', 'URL de la photo', p.photoUrl, 'url', 'placeholder="https://..."')
      + '</div>';

    html += sectionLabel('Propriétaire');
    html += '<div class="prop-form-card" id="psfOwnerContainer" style="display:none"></div>';

    return html;
  }

  /* ── Section: Stay ────────────────────────────────────────── */
  function renderStay(p) {
    var html = '';

    html += sectionLabel('Horaires');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-grid-2">'
      + formField('psfArrivalTime',   'Arrivée', p.arrivalTime,   'text', 'placeholder="14:00"')
      + formField('psfDepartureTime', 'Départ',  p.departureTime, 'text', 'placeholder="11:00"')
      + '</div>'
      + '</div>';

    html += sectionLabel("Message d'arrivée");
    html += '<div class="prop-form-card">'
      + formTextarea('psfArrivalMessage', "Message envoyé à l'arrivée", p.arrivalMessage)
      + '</div>';

    return html;
  }

  /* ── Section: Money ───────────────────────────────────────── */
  function renderMoney(p) {
    var html = '';
    var currencyLocked = !!(p.channexEnabled && p.channexPropertyId);

    html += sectionLabel('Tarifs');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-grid-2">'
      + formField('psfBasePrice',    'Prix de base / nuit',  p.basePrice,    'number', 'min="0" step="0.01"')
      + formField('psfWeekendPrice', 'Prix week-end / nuit', p.weekendPrice, 'number', 'min="0" step="0.01"')
      + '</div>'
      + '<div class="prop-form-grid-2">'
      + formField('psfCleaningFee', 'Frais de ménage',      p.cleaningFee,        'number', 'min="0" step="0.01"')
      + formField('psfTouristTax',  'Taxe de séjour / nuit', p.touristTaxPerNight, 'number', 'min="0" step="0.01"')
      + '</div>'
      + '</div>';

    html += sectionLabel('Caution');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-grid-2">'
      + formField('psfDepositAmount', 'Montant caution',              p.depositAmount,     'number', 'min="0" step="0.01"')
      + formField('psfDepositDays',   'Délai remboursement (jours)', p.depositReleaseDays, 'number', 'min="0"')
      + '</div>'
      + '</div>';

    html += sectionLabel('Commissions');
    html += '<div class="prop-form-card">'
      + '<div class="prop-form-grid-3">'
      + formField('psfConciergePct', 'Gestion prop. (%)', p.conciergePct,
          'number', 'min="0" max="100" step="0.1"')
      + formField('psfAirbnbPct', 'Airbnb (%)',
          p.airbnbCommissionPct  != null ? p.airbnbCommissionPct  : 3,
          'number', 'min="0" max="100" step="0.1"')
      + formField('psfBookingPct', 'Booking.com (%)',
          p.bookingCommissionPct != null ? p.bookingCommissionPct : 15,
          'number', 'min="0" max="100" step="0.1"')
      + '</div>'
      + '</div>';

    var currencyOptions = [
      { value: 'EUR', label: 'EUR — Euro' },
      { value: 'USD', label: 'USD — Dollar US' },
      { value: 'GBP', label: 'GBP — Livre sterling' },
      { value: 'CHF', label: 'CHF — Franc suisse' },
      { value: 'CAD', label: 'CAD — Dollar canadien' },
      { value: 'AUD', label: 'AUD — Dollar australien' },
      { value: 'JPY', label: 'JPY — Yen japonais' },
      { value: 'MAD', label: 'MAD — Dirham marocain' },
      { value: 'TND', label: 'TND — Dinar tunisien' },
      { value: 'XOF', label: 'XOF — Franc CFA' }
    ];

    html += sectionLabel('Devise');
    html += '<div class="prop-form-card">'
      + formSelect('psfCurrency', 'Devise', p.currency || 'EUR', currencyOptions, currencyLocked);

    if (currencyLocked) {
      html += '<p class="prop-currency-locked-notice">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
        + ' width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/>'
        + '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
        + ' La devise est verrouillée car Channex est connecté.</p>';
    }
    html += '</div>';

    return html;
  }

  /* ── Owner loading — async, feature-gated ─────────────────── */
  function loadOwners(p) {
    fetch('/api/owner-clients').then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (d) {
      if (!d || !d.owners || !d.owners.length) return;
      var container = document.getElementById('psfOwnerContainer');
      if (!container) return;
      var html = '<div class="prop-form-field">'
        + '<label class="prop-form-label" for="psfOwnerId">Propriétaire</label>'
        + '<select class="prop-form-input prop-form-select" id="psfOwnerId">'
        + '<option value="">— Aucun —</option>';
      d.owners.forEach(function (o) {
        var sel = p.ownerId && String(p.ownerId) === String(o.id) ? ' selected' : '';
        html += '<option value="' + escHtml(String(o.id)) + '"' + sel + '>'
          + escHtml(o.name || o.email || String(o.id)) + '</option>';
      });
      html += '</select></div>';
      container.innerHTML = html;
      container.style.display = '';
    }).catch(function () { /* facturation_proprietaires not available */ });
  }

  /* ── Color picker ↔ hex text sync ────────────────────────── */
  function bindColorSync() {
    var picker = document.getElementById('psfColorPicker');
    var text   = document.getElementById('psfColor');
    if (!picker || !text) return;
    picker.addEventListener('input', function () {
      text.value = picker.value;
    });
    text.addEventListener('input', function () {
      if (/^#[0-9A-Fa-f]{6}$/.test(text.value)) picker.value = text.value;
    });
  }

  /* ── Save: apply section form values over base FormData ───── */
  function applyIdentityFields(fd, p) {
    var name         = document.getElementById('psfName');
    var internalName = document.getElementById('psfInternalName');
    var address      = document.getElementById('psfAddress');
    var color        = document.getElementById('psfColor');
    var maxGuests    = document.getElementById('psfMaxGuests');
    var bedrooms     = document.getElementById('psfBedrooms');
    var beds         = document.getElementById('psfBeds');
    var bathrooms    = document.getElementById('psfBathrooms');
    var photoUrl     = document.getElementById('psfPhotoUrl');
    var ownerId      = document.getElementById('psfOwnerId');

    fd.set('name',         name         ? name.value.trim()         : (p.name || ''));
    fd.set('internalName', internalName ? internalName.value.trim() : (p.internalName || ''));
    if (color)    fd.set('color',    color.value.trim());
    if (address)  fd.set('address',  address.value.trim());
    if (photoUrl) fd.set('photoUrl', photoUrl.value.trim());
    if (maxGuests  && maxGuests.value  !== '') fd.set('maxGuests',  maxGuests.value);
    if (bedrooms   && bedrooms.value   !== '') fd.set('bedrooms',   bedrooms.value);
    if (beds       && beds.value       !== '') fd.set('beds',       beds.value);
    if (bathrooms  && bathrooms.value  !== '') fd.set('bathrooms',  bathrooms.value);
    if (ownerId) fd.set('ownerId', ownerId.value);
  }

  function applyStayFields(fd) {
    var arrivalTime    = document.getElementById('psfArrivalTime');
    var departureTime  = document.getElementById('psfDepartureTime');
    var arrivalMessage = document.getElementById('psfArrivalMessage');
    if (arrivalTime)    fd.set('arrivalTime',    arrivalTime.value.trim());
    if (departureTime)  fd.set('departureTime',  departureTime.value.trim());
    if (arrivalMessage) fd.set('arrivalMessage', arrivalMessage.value);
  }

  function applyMoneyFields(fd, p) {
    var basePrice     = document.getElementById('psfBasePrice');
    var weekendPrice  = document.getElementById('psfWeekendPrice');
    var cleaningFee   = document.getElementById('psfCleaningFee');
    var touristTax    = document.getElementById('psfTouristTax');
    var depositAmount = document.getElementById('psfDepositAmount');
    var depositDays   = document.getElementById('psfDepositDays');
    var conciergePct  = document.getElementById('psfConciergePct');
    var airbnbPct     = document.getElementById('psfAirbnbPct');
    var bookingPct    = document.getElementById('psfBookingPct');
    var currency      = document.getElementById('psfCurrency');

    if (basePrice    && basePrice.value    !== '') fd.set('basePrice',         basePrice.value);
    if (weekendPrice && weekendPrice.value !== '') fd.set('weekendPrice',       weekendPrice.value);
    if (cleaningFee  && cleaningFee.value  !== '') fd.set('cleaningFee',        cleaningFee.value);
    if (touristTax   && touristTax.value   !== '') fd.set('touristTaxPerNight', touristTax.value);
    if (depositAmount && depositAmount.value !== '') fd.set('depositAmount',    depositAmount.value);
    if (depositDays  && depositDays.value  !== '') fd.set('depositReleaseDays', depositDays.value);
    if (conciergePct && conciergePct.value !== '') fd.set('conciergePct',       conciergePct.value);
    fd.set('airbnbCommissionPct',
      airbnbPct  && airbnbPct.value  !== '' ? airbnbPct.value  :
      (p.airbnbCommissionPct  != null ? p.airbnbCommissionPct  : 3));
    fd.set('bookingCommissionPct',
      bookingPct && bookingPct.value !== '' ? bookingPct.value :
      (p.bookingCommissionPct != null ? p.bookingCommissionPct : 15));
    if (currency && !currency.disabled) fd.set('currency', currency.value);
  }

  /* ── Mount ──────────────────────────────────────────────────
     Entry point called by bh-property-detail-ios-10.js. */
  function mount(propertyId, section, p) {
    var loadEl = document.getElementById('propDetLoading');
    var bodyEl = document.getElementById('propDetBody');
    var errEl  = document.getElementById('propDetError');

    if (loadEl) loadEl.style.display = 'none';
    if (errEl)  errEl.style.display  = 'none';

    var backHref = '/property.html?id=' + propertyId;
    var sectionTitles = { identity: 'Identité', stay: 'Séjour', money: 'Argent' };
    var sectionTitle  = sectionTitles[section] || section;

    var html = '<div class="prop-section-view">';

    /* Mobile section header with back button */
    html += '<div class="prop-section-header">'
      + '<a href="' + escHtml(backHref) + '" class="prop-section-back-btn">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"'
      + ' stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="15 18 9 12 15 6"/></svg>'
      + 'Retour'
      + '</a>'
      + '<span class="prop-section-title-text">' + escHtml(sectionTitle) + '</span>'
      + '</div>';

    if      (section === 'identity') html += renderIdentity(p);
    else if (section === 'stay')     html += renderStay(p);
    else if (section === 'money')    html += renderMoney(p);

    html += '<button class="prop-section-save-btn" id="psfSaveBtn">Sauvegarder</button>';
    html += '<div class="prop-bottom-pad"></div>';
    html += '</div>';

    if (bodyEl) {
      bodyEl.innerHTML = html;
      bodyEl.style.display = '';
    }

    /* Desktop header */
    var desktopTitle  = document.getElementById('propDetTitle');
    var desktopKicker = document.getElementById('propDetKicker');
    if (desktopTitle)  desktopTitle.textContent  = sectionTitle;
    if (desktopKicker) desktopKicker.textContent = p.internalName || p.name || 'Logement';

    /* Section-specific setup */
    if (section === 'identity') {
      bindColorSync();
      loadOwners(p);
    }

    /* Save handler */
    var saveBtn = document.getElementById('psfSaveBtn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', function () {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Enregistrement…';

      var fd = buildBaseFormData(p);
      if      (section === 'identity') applyIdentityFields(fd, p);
      else if (section === 'stay')     applyStayFields(fd, p);
      else if (section === 'money')    applyMoneyFields(fd, p);

      fetch('/api/properties/' + propertyId, { method: 'PUT', body: fd })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, status: r.status, data: d };
          });
        })
        .then(function (result) {
          if (result.ok) {
            showToast('Enregistré', 'success');
            setTimeout(function () { window.location.href = backHref; }, 800);
          } else if (result.status === 409) {
            showToast('La devise ne peut pas être modifiée lorsque Channex est connecté.', 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Sauvegarder';
          } else {
            var msg = (result.data && result.data.message)
              ? result.data.message : 'Erreur lors de la sauvegarde';
            showToast(msg, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Sauvegarder';
          }
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Sauvegarder';
        });
    });
  }

  window.BhPropSections = { mount: mount };
})();
