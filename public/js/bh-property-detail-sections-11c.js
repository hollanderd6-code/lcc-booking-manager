/* bh-property-detail-sections-11c.js — Section editors: AI & Platforms
   Exposes window.BhPropSections11c.mount(propertyId, section, property).
   Called by bh-property-detail-ios-10.js when ?section= param is present.
   External prices: NOT in GET /api/properties/:id response — omitted.
   Introduced by PROPERTIES_11C. */
(function () {
  'use strict';

  /* ── Early: fix back-nav before bh-layout.js DOMContentLoaded ─ */
  (function () {
    try {
      var params   = new URLSearchParams(window.location.search);
      var section  = params.get('section');
      var propId   = params.get('id');
      if (!section || !propId) return;
      var titles11c = {
        ai:        'Assistant IA',
        platforms: 'Plateformes & prix'
      };
      if (!titles11c[section]) return;
      document.body.setAttribute('data-back-href',  '/property.html?id=' + propId);
      document.body.setAttribute('data-back-label', 'Logement');
      document.body.setAttribute('data-title',  titles11c[section]);
      document.body.setAttribute('data-kicker', titles11c[section]);
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

  function isSubAccount() {
    return localStorage.getItem('lcc_is_sub_account') === 'true'
      || localStorage.getItem('lcc_account_type') === 'sub';
  }

  /* ── Build base FormData — mirrors 11A/11B, preserves ALL fields ─ */
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

  /* ── Platform colors ──────────────────────────────────────── */
  var PLATFORM_COLORS = {
    ABB: '#FF5A5F',
    BDC: '#003580',
    EXP: '#FFC72C',
    VRB: '#1A5276'
  };

  function platformColor(code) {
    return PLATFORM_COLORS[code] || '#0E3B2E';
  }

  /* ── Fact edit row ────────────────────────────────────────── */
  function renderFactEditRow(fact) {
    var answerClass = fact.answer === true
      ? 'prop-fact-answer-badge--true'
      : 'prop-fact-answer-badge--false';
    var answerText = fact.answer === true ? 'O' : 'N';
    return '<div class="prop-fact-row" data-fact-id="' + escHtml(String(fact.id)) + '">'
      + '<div class="prop-fact-answer-badge ' + answerClass + '">' + answerText + '</div>'
      + '<div class="prop-fact-content">'
      + '<div class="prop-fact-question">' + escHtml(fact.question) + '</div>'
      + (fact.detail ? '<div class="prop-fact-detail">' + escHtml(fact.detail) + '</div>' : '')
      + '</div>'
      + '<button type="button" class="prop-fact-delete-btn"'
      + ' data-fact-id="' + escHtml(String(fact.id)) + '"'
      + ' aria-label="Supprimer">✕</button>'
      + '</div>';
  }

  /* ── Quick reply edit item ────────────────────────────────── */
  function renderQrEditItem(qr, i) {
    return '<div class="prop-qr-edit-item" data-qr-index="' + i + '">'
      + '<div class="prop-qr-edit-header">'
      + '<span class="prop-qr-edit-num">Réponse ' + (i + 1) + '</span>'
      + '<button type="button" class="prop-fact-delete-btn" data-qr-index="' + i + '"'
      + ' aria-label="Supprimer">✕</button>'
      + '</div>'
      + '<div class="prop-form-field"><label class="prop-form-label">Titre</label>'
      + '<input class="prop-form-input" type="text" data-qr-title="' + i + '"'
      + ' value="' + escHtml(qr.title || '') + '" maxlength="50" placeholder="Titre…">'
      + '<div class="prop-qr-char-hint">max 50 caractères</div>'
      + '</div>'
      + '<div class="prop-form-field"><label class="prop-form-label">Texte</label>'
      + '<textarea class="prop-form-textarea" data-qr-text="' + i + '" maxlength="200">'
      + escHtml(qr.text || '')
      + '</textarea>'
      + '<div class="prop-qr-char-hint">max 200 caractères</div>'
      + '</div>'
      + '</div>';
  }

  /* ── iCal edit row ────────────────────────────────────────── */
  function renderIcalEditRow(item, i) {
    var platform = typeof item === 'object' ? (item.platformName || item.platform || 'iCal') : 'iCal';
    var url      = typeof item === 'object' ? (item.url || '') : String(item);
    var color    = typeof item === 'object' ? (item.color || '#8FA99A') : '#8FA99A';
    var shortUrl = url.length > 40 ? url.slice(0, 37) + '…' : url;
    return '<div class="prop-read-row" data-ical-index="' + i + '">'
      + '<span class="prop-read-label" style="display:flex;align-items:center;gap:6px;">'
      + '<span class="prop-ical-dot" style="background:' + escHtml(color) + '"></span>'
      + escHtml(platform) + '</span>'
      + '<span class="prop-read-value">' + escHtml(shortUrl) + '</span>'
      + '<button type="button" class="prop-fact-delete-btn" data-ical-index="' + i + '"'
      + ' aria-label="Supprimer">✕</button>'
      + '</div>';
  }

  /* ── AI — read ────────────────────────────────────────────── */
  function renderAiRead(p, facts) {
    var html = '';
    var quickReplies = Array.isArray(p.quick_replies) ? p.quick_replies : [];

    html += sectionLabel('Réponses automatiques');
    html += '<div class="prop-read-card">'
      + '<div class="prop-read-row">'
      + '<span class="prop-read-label">Statut</span>'
      + '<span class="prop-read-value">'
      + (p.autoResponsesEnabled ? 'Activé' : 'Désactivé')
      + '</span></div></div>';

    html += sectionLabel('Questions / Réponses');
    if (facts.length === 0) {
      html += '<div class="prop-read-card">'
        + '<p class="prop-section-empty">Aucune question / réponse configurée.</p>'
        + '</div>';
    } else {
      html += '<div class="prop-read-card">';
      facts.forEach(function (fact) {
        var cls  = fact.answer === true ? 'prop-fact-answer-badge--true' : 'prop-fact-answer-badge--false';
        var ans  = fact.answer === true ? 'O' : 'N';
        html += '<div class="prop-fact-row">'
          + '<div class="prop-fact-answer-badge ' + cls + '">' + ans + '</div>'
          + '<div class="prop-fact-content">'
          + '<div class="prop-fact-question">' + escHtml(fact.question) + '</div>'
          + (fact.detail ? '<div class="prop-fact-detail">' + escHtml(fact.detail) + '</div>' : '')
          + '</div></div>';
      });
      html += '</div>';
    }

    html += sectionLabel('Réponses rapides');
    if (quickReplies.length === 0) {
      html += '<div class="prop-read-card">'
        + '<p class="prop-section-empty">Aucune réponse rapide configurée.</p>'
        + '</div>';
    } else {
      html += '<div class="prop-read-card">';
      quickReplies.forEach(function (qr) {
        html += '<div class="prop-qr-row">'
          + '<div class="prop-qr-title">' + escHtml(qr.title || '') + '</div>'
          + '<div class="prop-qr-text">'  + escHtml(qr.text  || '') + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  /* ── AI — edit ────────────────────────────────────────────── */
  function renderAiEdit(p, facts) {
    var html = '';
    var quickReplies = Array.isArray(p.quick_replies) ? p.quick_replies : [];

    html += sectionLabel('Réponses automatiques');
    html += '<div class="prop-form-card">'
      + '<div class="prop-toggle-row">'
      + '<span class="prop-form-label prop-toggle-label">Réponses automatiques</span>'
      + '<button type="button"'
      + ' class="prop-toggle' + (p.autoResponsesEnabled ? ' prop-toggle--on' : '') + '"'
      + ' id="psfAiAutoToggle" role="switch"'
      + ' aria-checked="' + !!p.autoResponsesEnabled + '"'
      + ' aria-label="Réponses automatiques">'
      + '<span class="prop-toggle-knob"></span></button>'
      + '</div></div>';

    html += sectionLabel('Questions / Réponses');
    html += '<div class="prop-form-card" id="psfFactsCard">';
    if (facts.length === 0) {
      html += '<p class="prop-section-empty" id="psfFactsEmpty">Aucune question / réponse.</p>';
    } else {
      html += '<div id="psfFactsList">';
      facts.forEach(function (fact) { html += renderFactEditRow(fact); });
      html += '</div>';
    }
    html += '<div class="prop-fact-add-form">'
      + '<div class="prop-form-field"><label class="prop-form-label" for="psfFactQ">Question</label>'
      + '<input class="prop-form-input" type="text" id="psfFactQ"'
      + ' placeholder="Climatisation disponible ?"></div>'
      + '<div class="prop-form-field"><label class="prop-form-label" for="psfFactA">Réponse</label>'
      + '<select class="prop-fact-answer-select" id="psfFactA">'
      + '<option value="">-- Choisir --</option>'
      + '<option value="true">Oui</option>'
      + '<option value="false">Non</option>'
      + '</select></div>'
      + '<div class="prop-form-field"><label class="prop-form-label" for="psfFactD">Détail (optionnel)</label>'
      + '<input class="prop-form-input" type="text" id="psfFactD" placeholder="Précision…"></div>'
      + '<button type="button" class="prop-fact-add-btn" id="psfFactAddBtn">+ Ajouter</button>'
      + '</div></div>';

    html += sectionLabel('Réponses rapides');
    html += '<div class="prop-form-card" id="psfQrCard">'
      + '<div id="psfQrList">';
    quickReplies.forEach(function (qr, i) { html += renderQrEditItem(qr, i); });
    html += '</div>';
    if (quickReplies.length < 5) {
      html += '<button type="button" class="prop-fact-add-btn" id="psfQrAddBtn">'
        + '+ Ajouter une réponse rapide</button>';
    }
    html += '</div>';

    return html;
  }

  /* ── Platforms — read ─────────────────────────────────────── */
  function renderPlatformsRead(p, markupsData) {
    var html     = '';
    var icalUrls = Array.isArray(p.icalUrls) ? p.icalUrls : [];
    var markups  = (markupsData && markupsData.markups) ? markupsData.markups : {};
    var codes    = (markupsData && markupsData.codes)   ? markupsData.codes   : {};

    if (!isSubAccount()) {
      var isConnected = !!(p.channexEnabled && p.channexPropertyId);
      html += sectionLabel('Diffusion OTA');
      html += '<div class="prop-read-card">'
        + '<div class="prop-diffusion-status-row">'
        + '<span class="prop-diffusion-status-label">Statut</span>'
        + '<span class="prop-diffusion-status-badge '
        + (isConnected ? 'prop-diffusion-status-badge--connected' : 'prop-diffusion-status-badge--disconnected')
        + '">' + (isConnected ? 'Connecté' : 'Non connecté') + '</span>'
        + '</div>';
      if (isConnected && p.channexPropertyId) {
        html += '<div class="prop-diffusion-status-row">'
          + '<span class="prop-diffusion-status-label">Channex ID</span>'
          + '<span class="prop-read-value prop-read-value--mono">'
          + escHtml(String(p.channexPropertyId)) + '</span>'
          + '</div>';
      }
      html += '</div>';
    }

    html += sectionLabel('Calendriers iCal');
    if (icalUrls.length === 0) {
      html += '<div class="prop-read-card">'
        + '<p class="prop-section-empty">Aucun flux iCal configuré.</p>'
        + '</div>';
    } else {
      html += '<div class="prop-read-card">';
      icalUrls.forEach(function (item) {
        var url      = typeof item === 'object' ? (item.url || '') : String(item);
        var platform = typeof item === 'object' ? (item.platformName || item.platform || 'iCal') : 'iCal';
        var color    = typeof item === 'object' ? (item.color || '#8FA99A') : '#8FA99A';
        var shortUrl = url.length > 40 ? url.slice(0, 37) + '…' : url;
        html += '<div class="prop-read-row">'
          + '<span class="prop-read-label" style="display:flex;align-items:center;gap:6px;">'
          + '<span class="prop-ical-dot" style="background:' + escHtml(color) + '"></span>'
          + escHtml(platform) + '</span>'
          + '<span class="prop-read-value">' + escHtml(shortUrl) + '</span>'
          + '</div>';
      });
      html += '</div>';
    }

    var markupKeys = Object.keys(markups);
    if (markupKeys.length > 0) {
      html += sectionLabel('Commissions par plateforme');
      html += '<div class="prop-read-card">';
      markupKeys.forEach(function (code) {
        var pct  = markups[code];
        var name = codes[code] || code;
        var col  = platformColor(code);
        html += '<div class="prop-markup-row">'
          + '<span class="prop-markup-label">'
          + '<span class="prop-platform-badge" style="background:' + escHtml(col) + '">'
          + escHtml(name) + '</span></span>'
          + '<span class="prop-markup-pct">' + escHtml(String(pct)) + ' %</span>'
          + '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  /* ── Platforms — edit ─────────────────────────────────────── */
  function renderPlatformsEdit(p, markupsData) {
    var html     = '';
    var markups  = (markupsData && markupsData.markups) ? markupsData.markups : {};
    var codes    = (markupsData && markupsData.codes)   ? markupsData.codes   : {};

    if (!isSubAccount()) {
      var isConnected = !!(p.channexEnabled && p.channexPropertyId);
      html += sectionLabel('Diffusion OTA');
      html += '<div class="prop-form-card">'
        + '<div class="prop-diffusion-status-row">'
        + '<span class="prop-diffusion-status-label">Statut Channex</span>'
        + '<span class="prop-diffusion-status-badge '
        + (isConnected ? 'prop-diffusion-status-badge--connected' : 'prop-diffusion-status-badge--disconnected')
        + '">' + (isConnected ? 'Connecté' : 'Non connecté') + '</span>'
        + '</div>';
      if (isConnected) {
        html += '<button type="button" class="prop-diffusion-disconnect-btn"'
          + ' id="psfDisconnectBtn">Déconnecter</button>';
      } else {
        html += '<button type="button" class="prop-diffusion-connect-btn"'
          + ' id="psfConnectBtn">Connecter la diffusion</button>';
      }
      html += '</div>';
    }

    var icalUrls = Array.isArray(p.icalUrls) ? p.icalUrls : [];
    html += sectionLabel('Calendriers iCal');
    html += '<div class="prop-form-card" id="psfIcalCard">'
      + '<div id="psfIcalList">';
    icalUrls.forEach(function (item, i) { html += renderIcalEditRow(item, i); });
    html += '</div>'
      + '<div class="prop-ical-add-form">'
      + '<div class="prop-form-field"><label class="prop-form-label" for="psfIcalPlatform">Plateforme</label>'
      + '<input class="prop-form-input" type="text" id="psfIcalPlatform"'
      + ' placeholder="ex: Gîtes de France"></div>'
      + '<div class="prop-form-field"><label class="prop-form-label" for="psfIcalUrl">URL iCal</label>'
      + '<input class="prop-form-input" type="url" id="psfIcalUrl" placeholder="https://…"></div>'
      + '<button type="button" class="prop-fact-add-btn" id="psfIcalAddBtn">+ Ajouter le flux</button>'
      + '</div>'
      + '<button type="button" class="prop-ical-sync-btn" id="psfIcalSyncBtn">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + ' width="16" height="16">'
      + '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>'
      + '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
      + '</svg>Synchroniser iCal</button>'
      + '</div>';

    var markupKeys = Object.keys(markups);
    if (markupKeys.length > 0) {
      html += sectionLabel('Commissions par plateforme');
      html += '<div class="prop-form-card">';
      markupKeys.forEach(function (code) {
        var pct  = markups[code];
        var name = codes[code] || code;
        var col  = platformColor(code);
        html += '<div class="prop-markup-row">'
          + '<span class="prop-markup-label">'
          + '<span class="prop-platform-badge" style="background:' + escHtml(col) + '">'
          + escHtml(name) + '</span></span>'
          + '<input type="number" class="prop-markup-input"'
          + ' data-markup-code="' + escHtml(code) + '"'
          + ' value="' + escHtml(String(pct)) + '"'
          + ' min="0" max="100" step="0.1"'
          + ' aria-label="' + escHtml(name) + '">'
          + '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  /* ── Section titles ───────────────────────────────────────── */
  var SECTION_TITLES = {
    ai:        'Assistant IA',
    platforms: 'Plateformes & prix'
  };

  /* ── Render section ───────────────────────────────────────── */
  function renderSection(propertyId, section, p, editMode, extraData) {
    var bodyEl = document.getElementById('propDetBody');
    var loadEl = document.getElementById('propDetLoading');
    if (loadEl) loadEl.style.display = 'none';

    var sectionTitle = SECTION_TITLES[section] || section;
    var backHref     = '/property.html?id=' + propertyId;

    var html = '<div class="prop-section-view">';
    html += makeSectionHeader(sectionTitle, backHref);

    if (editMode) {
      if (section === 'ai') {
        html += renderAiEdit(p, (extraData && extraData.facts) ? extraData.facts : []);
      } else if (section === 'platforms') {
        html += renderPlatformsEdit(p, extraData);
      }
      html += '<div class="prop-section-actions">'
        + '<button class="prop-section-cancel-btn" id="psfCancelBtn">Annuler</button>'
        + '<button class="prop-section-save-btn" id="psfSaveBtn">Enregistrer</button>'
        + '</div>';
    } else {
      if (section === 'ai') {
        html += renderAiRead(p, (extraData && extraData.facts) ? extraData.facts : []);
      } else if (section === 'platforms') {
        html += renderPlatformsRead(p, extraData);
      }
      html += '<button class="prop-section-edit-btn" id="psfEditBtn">Modifier</button>';
    }

    html += '<div class="prop-bottom-pad"></div></div>';

    if (bodyEl) {
      bodyEl.innerHTML = html;
      bodyEl.style.display = '';
    }

    var desktopTitle  = document.getElementById('propDetTitle');
    var desktopKicker = document.getElementById('propDetKicker');
    if (desktopTitle)  desktopTitle.textContent  = sectionTitle;
    if (desktopKicker) desktopKicker.textContent = p.internalName || p.name || 'Logement';

    if (editMode) {
      var cancelBtn = document.getElementById('psfCancelBtn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          renderSection(propertyId, section, p, false, extraData);
        });
      }
      if (section === 'ai') {
        bindAiEdit(propertyId, p, extraData, backHref);
      } else if (section === 'platforms') {
        bindPlatformsEdit(propertyId, p, extraData, backHref);
      }
    } else {
      var editBtn = document.getElementById('psfEditBtn');
      if (editBtn) {
        editBtn.addEventListener('click', function () {
          renderSection(propertyId, section, p, true, extraData);
        });
      }
    }
  }

  /* ── Bind AI edit ─────────────────────────────────────────── */
  function bindAiEdit(propertyId, p, extraData, backHref) {
    /* Toggle */
    var autoToggle = document.getElementById('psfAiAutoToggle');
    if (autoToggle) {
      autoToggle.addEventListener('click', function () {
        var isOn = autoToggle.classList.contains('prop-toggle--on');
        if (isOn) {
          autoToggle.classList.remove('prop-toggle--on');
          autoToggle.setAttribute('aria-checked', 'false');
        } else {
          autoToggle.classList.add('prop-toggle--on');
          autoToggle.setAttribute('aria-checked', 'true');
        }
      });
    }

    /* Facts: delete via event delegation */
    var factsCard = document.getElementById('psfFactsCard');
    if (factsCard) {
      factsCard.addEventListener('click', function (e) {
        var btn = e.target;
        if (!btn.classList.contains('prop-fact-delete-btn')) return;
        var factId = btn.getAttribute('data-fact-id');
        if (!factId) return;
        btn.disabled = true;
        fetch('/api/properties/' + propertyId + '/facts/' + factId, { method: 'DELETE' })
          .then(function (r) {
            if (r.ok) {
              var row = document.querySelector('.prop-fact-row[data-fact-id="' + factId + '"]');
              if (row) row.remove();
              var list = document.getElementById('psfFactsList');
              if (list && list.children.length === 0) {
                list.outerHTML = '<p class="prop-section-empty" id="psfFactsEmpty">Aucune question / réponse.</p>';
              }
              showToast('Question supprimée', 'success');
            } else {
              showToast('Erreur lors de la suppression', 'error');
              btn.disabled = false;
            }
          })
          .catch(function () {
            showToast('Erreur réseau', 'error');
            btn.disabled = false;
          });
      });
    }

    /* Facts: add */
    var factAddBtn = document.getElementById('psfFactAddBtn');
    if (factAddBtn) {
      factAddBtn.addEventListener('click', function () {
        var qEl  = document.getElementById('psfFactQ');
        var aEl  = document.getElementById('psfFactA');
        var dEl  = document.getElementById('psfFactD');
        var question  = qEl ? qEl.value.trim() : '';
        var answerVal = aEl ? aEl.value : '';
        if (!question)  { showToast('La question est requise', 'error'); return; }
        if (!answerVal) { showToast('La réponse est requise', 'error'); return; }
        var answer = answerVal === 'true';
        var detail = dEl ? dEl.value.trim() : '';

        factAddBtn.disabled    = true;
        factAddBtn.textContent = 'Ajout…';
        var payload = { question: question, answer: answer };
        if (detail) payload.detail = detail;

        fetch('/api/properties/' + propertyId + '/facts', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload)
        })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (result) {
          if (result.ok) {
            var newFact = result.data.fact || result.data;
            var emptyEl = document.getElementById('psfFactsEmpty');
            if (emptyEl) {
              emptyEl.outerHTML = '<div id="psfFactsList">' + renderFactEditRow(newFact) + '</div>';
            } else {
              var listEl = document.getElementById('psfFactsList');
              if (listEl) listEl.insertAdjacentHTML('beforeend', renderFactEditRow(newFact));
            }
            if (qEl) qEl.value = '';
            if (aEl) aEl.value = '';
            if (dEl) dEl.value = '';
            showToast('Question ajoutée', 'success');
          } else {
            var msg = (result.data && result.data.message) ? result.data.message : 'Erreur';
            showToast(msg, 'error');
          }
          factAddBtn.disabled    = false;
          factAddBtn.textContent = '+ Ajouter';
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          factAddBtn.disabled    = false;
          factAddBtn.textContent = '+ Ajouter';
        });
      });
    }

    /* Quick replies: add */
    var qrAddBtn = document.getElementById('psfQrAddBtn');
    if (qrAddBtn) {
      qrAddBtn.addEventListener('click', function () {
        var listEl = document.getElementById('psfQrList');
        if (!listEl) return;
        var currentCount = listEl.querySelectorAll('.prop-qr-edit-item').length;
        if (currentCount >= 5) return;
        listEl.insertAdjacentHTML('beforeend', renderQrEditItem({ title: '', text: '' }, currentCount));
        if (currentCount + 1 >= 5) qrAddBtn.style.display = 'none';
      });
    }

    /* Quick replies: delete via event delegation */
    var qrCard = document.getElementById('psfQrCard');
    if (qrCard) {
      qrCard.addEventListener('click', function (e) {
        var btn = e.target;
        if (!btn.classList.contains('prop-fact-delete-btn')) return;
        var idx = btn.getAttribute('data-qr-index');
        if (idx === null) return;
        var item = btn.parentElement;
        while (item && !item.classList.contains('prop-qr-edit-item')) {
          item = item.parentElement;
        }
        if (!item) return;
        item.remove();
        var listEl = document.getElementById('psfQrList');
        if (listEl) {
          var items = listEl.querySelectorAll('.prop-qr-edit-item');
          items.forEach(function (el, newIdx) {
            el.setAttribute('data-qr-index', newIdx);
            var numEl = el.querySelector('.prop-qr-edit-num');
            if (numEl) numEl.textContent = 'Réponse ' + (newIdx + 1);
          });
          if (qrAddBtn) qrAddBtn.style.display = items.length < 5 ? '' : 'none';
        }
      });
    }

    /* Save: autoResponsesEnabled + quick replies */
    var saveBtn = document.getElementById('psfSaveBtn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', function () {
      if (saveBtn.disabled) return;
      saveBtn.disabled    = true;
      saveBtn.textContent = 'Enregistrement…';

      var toggle      = document.getElementById('psfAiAutoToggle');
      var autoEnabled = toggle ? toggle.classList.contains('prop-toggle--on') : !!p.autoResponsesEnabled;

      var qrItems     = document.querySelectorAll('.prop-qr-edit-item');
      var quickReplies = [];
      qrItems.forEach(function (el) {
        var titleEl = el.querySelector('[data-qr-title]');
        var textEl  = el.querySelector('[data-qr-text]');
        var title   = titleEl ? titleEl.value.trim() : '';
        var text    = textEl  ? textEl.value.trim()  : '';
        if (title || text) quickReplies.push({ title: title, text: text });
      });

      var fd = buildBaseFormData(p);
      fd.set('autoResponsesEnabled', autoEnabled ? 'true' : 'false');

      fetch('/api/properties/' + propertyId, { method: 'PUT', body: fd })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (propResult) {
          if (!propResult.ok) {
            var msg = (propResult.data && propResult.data.message) ? propResult.data.message : 'Erreur';
            showToast(msg, 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Enregistrer';
            return;
          }
          return fetch('/api/properties/' + propertyId + '/quick-replies', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ quickReplies: quickReplies })
          })
          .then(function (r) {
            return r.json().then(function (d) { return { ok: r.ok, data: d }; });
          })
          .then(function (qrResult) {
            if (qrResult.ok) {
              showToast('Enregistré', 'success');
              setTimeout(function () { window.location.href = backHref; }, 800);
            } else {
              var msg2 = (qrResult.data && qrResult.data.message) ? qrResult.data.message : 'Erreur';
              showToast(msg2, 'error');
              saveBtn.disabled    = false;
              saveBtn.textContent = 'Enregistrer';
            }
          });
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          saveBtn.disabled    = false;
          saveBtn.textContent = 'Enregistrer';
        });
    });
  }

  /* ── Bind Platforms edit ──────────────────────────────────── */
  function bindPlatformsEdit(propertyId, p, markupsData, backHref) {
    var currentIcalUrls = Array.isArray(p.icalUrls) ? p.icalUrls.slice() : [];

    /* Connect */
    var connectBtn = document.getElementById('psfConnectBtn');
    if (connectBtn) {
      connectBtn.addEventListener('click', function () {
        connectBtn.disabled    = true;
        connectBtn.textContent = 'Connexion…';
        fetch('/api/channex/connect-property', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ property_id: propertyId })
        })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (result) {
          if (result.ok) {
            showToast('Connexion réussie', 'success');
            setTimeout(function () { window.location.reload(); }, 800);
          } else {
            var msg = (result.data && result.data.message) ? result.data.message : 'Erreur de connexion';
            showToast(msg, 'error');
            connectBtn.disabled    = false;
            connectBtn.textContent = 'Connecter la diffusion';
          }
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          connectBtn.disabled    = false;
          connectBtn.textContent = 'Connecter la diffusion';
        });
      });
    }

    /* Disconnect */
    var disconnectBtn = document.getElementById('psfDisconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', function () {
        disconnectBtn.disabled    = true;
        disconnectBtn.textContent = 'Déconnexion…';
        fetch('/api/channex/disconnect-property', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ property_id: propertyId })
        })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (result) {
          if (result.ok) {
            showToast('Déconnexion réussie', 'success');
            setTimeout(function () { window.location.reload(); }, 800);
          } else {
            var msg = (result.data && result.data.message) ? result.data.message : 'Erreur';
            showToast(msg, 'error');
            disconnectBtn.disabled    = false;
            disconnectBtn.textContent = 'Déconnecter';
          }
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          disconnectBtn.disabled    = false;
          disconnectBtn.textContent = 'Déconnecter';
        });
      });
    }

    /* iCal: delete via event delegation */
    var icalCard = document.getElementById('psfIcalCard');
    if (icalCard) {
      icalCard.addEventListener('click', function (e) {
        var btn = e.target;
        if (!btn.classList.contains('prop-fact-delete-btn')) return;
        var idx = parseInt(btn.getAttribute('data-ical-index'), 10);
        if (isNaN(idx)) return;
        currentIcalUrls.splice(idx, 1);
        var listEl = document.getElementById('psfIcalList');
        if (listEl) {
          listEl.innerHTML = currentIcalUrls.map(function (item, i) {
            return renderIcalEditRow(item, i);
          }).join('');
        }
      });
    }

    /* iCal: add */
    var icalAddBtn = document.getElementById('psfIcalAddBtn');
    if (icalAddBtn) {
      icalAddBtn.addEventListener('click', function () {
        var platformEl = document.getElementById('psfIcalPlatform');
        var urlEl      = document.getElementById('psfIcalUrl');
        var platform   = platformEl ? platformEl.value.trim() : '';
        var url        = urlEl ? urlEl.value.trim() : '';
        if (!url) { showToast("L'URL est requise", 'error'); return; }
        currentIcalUrls.push({
          platform:     platform || 'iCal',
          platformName: platform || 'iCal',
          url:          url,
          color:        '#8FA99A',
          domain:       ''
        });
        var listEl = document.getElementById('psfIcalList');
        if (listEl) {
          listEl.innerHTML = currentIcalUrls.map(function (item, i) {
            return renderIcalEditRow(item, i);
          }).join('');
        }
        if (platformEl) platformEl.value = '';
        if (urlEl)      urlEl.value      = '';
      });
    }

    /* iCal sync */
    var syncBtn = document.getElementById('psfIcalSyncBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', function () {
        syncBtn.disabled    = true;
        syncBtn.textContent = 'Synchronisation…';
        fetch('/api/sync/ical', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    '{}'
        })
        .then(function (r) {
          if (r.ok) {
            showToast('Synchronisation réussie', 'success');
          } else {
            showToast('Erreur de synchronisation', 'error');
          }
          syncBtn.disabled    = false;
          syncBtn.textContent = 'Synchroniser iCal';
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          syncBtn.disabled    = false;
          syncBtn.textContent = 'Synchroniser iCal';
        });
      });
    }

    /* Save: iCal + markups */
    var saveBtn = document.getElementById('psfSaveBtn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', function () {
      if (saveBtn.disabled) return;
      saveBtn.disabled    = true;
      saveBtn.textContent = 'Enregistrement…';

      var markupInputs = document.querySelectorAll('[data-markup-code]');
      var markupCodes  = [];
      markupInputs.forEach(function (inp) {
        var code = inp.getAttribute('data-markup-code');
        var pct  = parseFloat(inp.value);
        if (code && !isNaN(pct)) markupCodes.push({ code: code, pct: pct });
      });

      var fd = buildBaseFormData(p);
      fd.append('icalUrls', JSON.stringify(currentIcalUrls));

      fetch('/api/properties/' + propertyId, { method: 'PUT', body: fd })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (propResult) {
          if (!propResult.ok) {
            var msg = (propResult.data && propResult.data.message) ? propResult.data.message : 'Erreur';
            showToast(msg, 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Enregistrer';
            return;
          }
          var chain = Promise.resolve();
          markupCodes.forEach(function (m) {
            chain = chain.then(function () {
              return fetch('/api/properties/' + propertyId + '/markups', {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ code: m.code, pct: m.pct })
              });
            });
          });
          return chain.then(function () {
            showToast('Enregistré', 'success');
            setTimeout(function () { window.location.href = backHref; }, 800);
          });
        })
        .catch(function () {
          showToast('Erreur réseau', 'error');
          saveBtn.disabled    = false;
          saveBtn.textContent = 'Enregistrer';
        });
    });
  }

  /* ── Mount — entry point ──────────────────────────────────── */
  function mount(propertyId, section, p) {
    var loadEl = document.getElementById('propDetLoading');
    var bodyEl = document.getElementById('propDetBody');
    if (loadEl) loadEl.style.display = '';
    if (bodyEl) bodyEl.style.display = 'none';

    if (section === 'ai') {
      fetch('/api/properties/' + propertyId + '/facts')
        .then(function (r) { return r.ok ? r.json() : { facts: [] }; })
        .catch(function () { return { facts: [] }; })
        .then(function (factsData) {
          var facts = Array.isArray(factsData.facts) ? factsData.facts : [];
          renderSection(propertyId, section, p, false, { facts: facts });
        });
      return;
    }

    if (section === 'platforms') {
      fetch('/api/properties/' + propertyId + '/markups')
        .then(function (r) { return r.ok ? r.json() : { markups: {}, codes: {} }; })
        .catch(function () { return { markups: {}, codes: {} }; })
        .then(function (markupsData) {
          renderSection(propertyId, section, p, false, markupsData);
        });
      return;
    }

    renderSection(propertyId, section, p, false, null);
  }

  window.BhPropSections11c = { mount: mount };
})();
