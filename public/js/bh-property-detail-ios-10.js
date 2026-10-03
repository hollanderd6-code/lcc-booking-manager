/* bh-property-detail-ios-10.js — Property detail hub
   Fetches /api/properties/:id + /api/property-groups +
   /api/properties/diffusion + /api/welcome-books/by-property/:id
   then renders livret card, 9 blocks, diffusion, iCal, actions.
   Bridge: block rows link to /settings.html until PROPERTIES_11
   introduces per-section editors. */
(function () {
  'use strict';

  var propertyId = null;
  var propData   = null;
  var upsellData = null;

  /* ── Helpers ───────────────────────────────────────────── */
  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function chevronSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  }

  function hasContent(val) {
    if (val == null) return false;
    if (Array.isArray(val)) return val.length > 0;
    var s = String(val).trim();
    if (!s || s === '[]' || s === '{}' || s === 'null') return false;
    try {
      var parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0;
    } catch (e) {}
    return s.length > 2;
  }

  function isSubAccount() {
    return localStorage.getItem('lcc_is_sub_account') === 'true'
      || localStorage.getItem('lcc_account_type') === 'sub';
  }

  /* ── SVG icons ─────────────────────────────────────────── */
  var ICONS = {
    identity:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>',
    stay:         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    pricing:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    upsell:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    access:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    neighborhood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    amenities:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    ai:           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="15" x2="8" y2="17"/><line x1="12" y1="15" x2="12" y2="17"/><line x1="16" y1="15" x2="16" y2="17"/></svg>',
    platforms:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>',
    connect:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    duplicate:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    resync:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    trash:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    book:         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    ical:         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
  };

  /* ── Livret completion ────────────────────────────────── */
  function livretCompletion(p) {
    var accesOk     = !!(p.accessCode || p.wifiName);
    var quartierOk  = hasContent(p.practicalInfo);
    var equipeOk    = hasContent(p.amenities);
    return {
      count:      (accesOk ? 1 : 0) + (quartierOk ? 1 : 0) + (equipeOk ? 1 : 0),
      accesOk:    accesOk,
      quartierOk: quartierOk,
      equipeOk:   equipeOk
    };
  }

  /* ── Block status ─────────────────────────────────────── */
  function blockStatus(p) {
    return {
      identity:     (p.name && p.internalName) ? 'complete' : (p.name ? 'to-fill' : 'to-fill'),
      stay:         (p.arrivalTime && p.departureTime && p.maxGuests) ? 'complete' : 'to-fill',
      pricing:      (p.basePrice) ? 'complete' : 'to-fill',
      upsell:       (function () {
        if (!upsellData) return 'inactive';
        var u = upsellData;
        return (u.late_checkout_enabled || u.early_checkin_enabled || u.welcome_basket_enabled)
          ? 'complete' : 'inactive';
      }()),
      access:       (p.accessCode || p.wifiName) ? 'complete' : 'to-fill',
      neighborhood: hasContent(p.practicalInfo) ? 'complete' : 'to-fill',
      amenities:    hasContent(p.amenities) ? 'complete' : 'to-fill',
      ai:           p.autoResponsesEnabled ? 'complete' : 'inactive',
      platforms:    (p.channexEnabled && p.channexPropertyId) ? 'complete'
                  : (Array.isArray(p.icalUrls) && p.icalUrls.length > 0) ? 'complete'
                  : 'inactive'
    };
  }

  /* ── Status badge SVG ─────────────────────────────────── */
  function statusBadgeSvg(status) {
    if (status === 'complete') {
      return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.293 14.707L5.5 11.5l1.414-1.414 3.793 3.793 6.793-6.793 1.414 1.414-8.207 8.207z"/></svg>';
    }
    if (status === 'to-fill') {
      return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
    }
    return '';
  }

  /* ── Render livret card ───────────────────────────────── */
  function renderLivretCard(p, livret) {
    var comp = livretCompletion(p);
    if (comp.count >= 3) return '';

    var livretUrl = (livret && livret.exists && livret.uniqueId)
      ? '/welcome.html?id=' + escHtml(livret.uniqueId)
      : '/welcome.html';
    var btnLabel = (livret && livret.exists) ? 'Voir le livret' : 'Créer le livret';

    function blockItem(ok, label) {
      var cls = ok ? 'prop-livret-block--complete' : 'prop-livret-block--to-fill';
      var svg = ok
        ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.293 14.707L5.5 11.5l1.414-1.414 3.793 3.793 6.793-6.793 1.414 1.414-8.207 8.207z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
      return '<div class="prop-livret-block ' + cls + '">' + svg + escHtml(label) + '</div>';
    }

    return '<div class="prop-livret-card">'
      + '<div class="prop-livret-title">' + ICONS.book + 'Livret d\'accueil</div>'
      + '<div class="prop-livret-blocks">'
      + blockItem(comp.accesOk, 'Accès & Wi-Fi')
      + blockItem(comp.quartierOk, 'Le quartier')
      + blockItem(comp.equipeOk, 'Équipements')
      + '</div>'
      + '<div class="prop-livret-footer">'
      + '<span class="prop-livret-progress">' + comp.count + ' / 3 complétés</span>'
      + '<a href="' + livretUrl + '" class="prop-livret-btn">' + escHtml(btnLabel) + '</a>'
      + '</div>'
      + '</div>';
  }

  /* ── Render single block row ──────────────────────────── */
  function renderBlock(iconKey, label, status, hasLivretBadge, sub) {
    var sectionRoutes = {
      identity:     'identity',
      stay:         'stay',
      pricing:      'money',
      upsell:       'upsell',
      access:       'access',
      neighborhood: 'neighborhood',
      amenities:    'amenities'
    };
    var href = sectionRoutes[iconKey]
      ? '/property.html?id=' + propertyId + '&section=' + sectionRoutes[iconKey]
      : '/settings.html'; /* Bridge: ai, platforms — PROPERTIES_11C+ */

    var badgesHtml = '';
    if (status !== 'inactive') {
      var cls   = status === 'complete' ? 'prop-status-badge--complete' : 'prop-status-badge--to-fill';
      var text  = status === 'complete' ? 'Complété' : 'À remplir';
      badgesHtml += '<span class="prop-status-badge ' + cls + '">'
        + statusBadgeSvg(status)
        + escHtml(text)
        + '</span>';
    }
    if (hasLivretBadge) {
      badgesHtml += '<span class="prop-livret-badge">Livret</span>';
    }

    return '<a href="' + escHtml(href) + '" class="prop-block-row">'
      + '<div class="prop-block-icon">' + (ICONS[iconKey] || '') + '</div>'
      + '<div class="prop-block-text">'
      + '<div class="prop-block-name">' + escHtml(label) + '</div>'
      + (sub ? '<div class="prop-block-sub">' + escHtml(sub) + '</div>' : '')
      + '</div>'
      + '<div class="prop-block-badges">' + badgesHtml + '</div>'
      + '<div class="prop-block-chevron">' + chevronSvg() + '</div>'
      + '</a>';
  }

  /* ── Render 9-block card ──────────────────────────────── */
  function renderBlocksCard(p) {
    var stat     = blockStatus(p);
    var priceSub = p.basePrice ? (p.basePrice + ' ' + (p.currency || 'EUR') + '/nuit') : null;
    var staySub  = (p.arrivalTime && p.departureTime)
      ? (p.arrivalTime + ' → ' + p.departureTime) : null;
    var accessSub = p.accessCode
      ? 'Code : ·····'
      : (p.wifiName ? 'Wi-Fi : ' + p.wifiName : null);

    var rows = [
      renderBlock('identity',     'Identité',              stat.identity,     false, null),
      renderBlock('stay',         'Séjour',                 stat.stay,         false, staySub),
      renderBlock('pricing',      'Argent',                      stat.pricing,      false, priceSub),
      renderBlock('upsell',       'Prestations payantes',        stat.upsell,       false, null),
      renderBlock('access',       'Accès',                  stat.access,       true,  accessSub),
      renderBlock('neighborhood', 'Le quartier',                 stat.neighborhood, true,  null),
      renderBlock('amenities',    'Équipements & règles', stat.amenities, true,  null),
      renderBlock('ai',           'Assistant IA',                stat.ai,           false, null),
      renderBlock('platforms',    'Plateformes & prix',          stat.platforms,    false, null)
    ];

    return '<div class="prop-detail-card">' + rows.join('') + '</div>';
  }

  /* ── Render diffusion section ─────────────────────────── */
  function renderDiffusion(p) {
    if (isSubAccount()) return '';

    var isConnected = !!(p.channexEnabled && p.channexPropertyId);
    var html = '<div class="prop-detail-card">';

    if (!isConnected) {
      html += '<a href="/settings.html" class="prop-diffusion-row">'
        + '<div class="prop-block-icon">' + ICONS.connect + '</div>'
        + '<span class="prop-diffusion-label">Connecter à la diffusion</span>'
        + '<div class="prop-block-chevron">' + chevronSvg() + '</div>'
        + '</a>';
    } else {
      html += '<a href="/settings.html" class="prop-diffusion-row">'
        + '<div class="prop-block-icon">' + ICONS.connect + '</div>'
        + '<span class="prop-diffusion-label">Gérer la diffusion</span>'
        + '<div class="prop-block-chevron">' + chevronSvg() + '</div>'
        + '</a>';
      html += '<button class="prop-diffusion-row prop-diffusion-row--danger" id="propDetDisconnectBtn">'
        + '<div class="prop-block-icon" style="background:rgba(168,69,42,0.10);color:#A8452A;">' + ICONS.connect + '</div>'
        + '<span class="prop-diffusion-label prop-diffusion-label--danger">Déconnecter</span>'
        + '</button>';
    }

    html += '</div>';
    return html;
  }

  /* ── Render iCal section ──────────────────────────────── */
  function renderIcal(p) {
    var icalUrls = Array.isArray(p.icalUrls) ? p.icalUrls : [];
    var html = '<div class="prop-detail-card">';

    icalUrls.forEach(function (item) {
      var url      = typeof item === 'object' ? (item.url || '') : String(item);
      var platform = typeof item === 'object' ? (item.platform || 'iCal') : 'iCal';
      var shortUrl = url.length > 40 ? url.slice(0, 37) + '…' : url;
      html += '<div class="prop-ical-row">'
        + '<span class="prop-ical-platform">' + escHtml(platform) + '</span>'
        + '<span class="prop-ical-url">' + escHtml(shortUrl) + '</span>'
        + '</div>';
    });

    var actionLabel = icalUrls.length > 0 ? 'Modifier les flux iCal' : 'Ajouter un flux iCal';
    html += '<a href="/settings.html" class="prop-block-row">'
      + '<div class="prop-block-text"><div class="prop-block-name">' + escHtml(actionLabel) + '</div></div>'
      + '<div class="prop-block-chevron">' + chevronSvg() + '</div>'
      + '</a>';

    html += '</div>';
    return html;
  }

  /* ── Render bottom actions ────────────────────────────── */
  function renderActions() {
    return '<div class="prop-action-card">'
      + '<button class="prop-action-row" id="propDetDuplicate">'
      + '<div class="prop-action-icon" style="background:rgba(14,59,46,0.08);color:#0E3B2E;">' + ICONS.duplicate + '</div>'
      + 'Dupliquer'
      + '</button>'
      + '<button class="prop-action-row" id="propDetResync">'
      + '<div class="prop-action-icon" style="background:rgba(14,59,46,0.08);color:#0E3B2E;">' + ICONS.resync + '</div>'
      + 'Resynchroniser'
      + '</button>'
      + '<button class="prop-action-row prop-action-row--danger" id="propDetDelete">'
      + '<div class="prop-action-icon" style="background:rgba(168,69,42,0.10);color:#A8452A;">' + ICONS.trash + '</div>'
      + 'Supprimer'
      + '</button>'
      + '</div>';
  }

  /* ── Header update ────────────────────────────────────── */
  function updateHeader(p, groups) {
    var title = p.internalName || p.name || 'Logement';

    var group = Array.isArray(groups) && groups.find(function (g) {
      return Array.isArray(g.propertyIds) && g.propertyIds.indexOf(p.id) !== -1;
    });
    var kickerParts = [];
    if (group) kickerParts.push(group.name);
    if (p.address) kickerParts.push(p.address);
    var kicker = kickerParts.join(' · ') || 'Logement';

    document.body.setAttribute('data-title', title);
    document.body.setAttribute('data-kicker', kicker);

    var mobileTitle  = document.querySelector('#bhHeader .page-title');
    var mobileKicker = document.querySelector('#bhHeader .page-kicker');
    if (mobileTitle)  mobileTitle.textContent  = title;
    if (mobileKicker) mobileKicker.textContent = kicker;

    var desktopTitle  = document.getElementById('propDetTitle');
    var desktopKicker = document.getElementById('propDetKicker');
    if (desktopTitle)  desktopTitle.textContent  = title;
    if (desktopKicker) desktopKicker.textContent = kicker;
  }

  /* ── Toast ────────────────────────────────────────────── */
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

  /* ── Resync ───────────────────────────────────────────── */
  function resyncProperty(id, btn) {
    if (btn) { btn.disabled = true; }

    Promise.all([
      fetch('/api/channex/sync-availability/' + id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      }).then(function (r) { return r.json(); }).catch(function () { return { error: 'sync failed' }; }),
      fetch('/api/pricing/rules/push-channex/' + id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      }).then(function (r) { return r.json(); }).catch(function () { return { error: 'push failed' }; })
    ]).then(function (results) {
      var ok = !results[0].error && !results[1].error;
      showToast(ok ? 'Synchronisation réussie' : 'Synchronisation partielle', ok ? 'success' : 'warning');
    }).catch(function () {
      showToast('Erreur de synchronisation', 'error');
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  /* ── Delete confirmation ──────────────────────────────── */
  function confirmDelete(p) {
    var existing = document.getElementById('_propDetDeleteModal');
    if (existing) existing.remove();

    var propName = escHtml(p.internalName || p.name || 'ce logement');
    var modal = document.createElement('div');
    modal.id = '_propDetDeleteModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,17,23,.55);'
      + 'backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = '<div style="background:#fff;border-radius:20px;padding:28px;max-width:360px;'
      + 'width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.15);">'
      + '<div style="width:52px;height:52px;border-radius:50%;background:#FEF2F2;'
      + 'display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px;">🗑️</div>'
      + '<h3 style="font-family:\'DM Sans\',sans-serif;font-size:16px;font-weight:700;'
      + 'color:#0D1117;margin:0 0 8px;">Supprimer ce logement ?</h3>'
      + '<p style="font-size:13px;color:#7A8695;margin:0 0 20px;">'
      + '<strong>' + propName + '</strong> sera définitivement supprimé. Cette action est irréversible.</p>'
      + '<div style="display:flex;gap:10px;">'
      + '<button id="_propDetDeleteCancel" style="flex:1;height:44px;border-radius:12px;'
      + 'border:1.5px solid rgba(13,17,23,.15);background:#fff;color:#374151;'
      + 'font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">Annuler</button>'
      + '<button id="_propDetDeleteConfirm" style="flex:1;height:44px;border-radius:12px;'
      + 'border:none;background:#DC2626;color:#fff;'
      + 'font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">Supprimer</button>'
      + '</div></div>';
    document.body.appendChild(modal);

    document.getElementById('_propDetDeleteCancel').onclick = function () { modal.remove(); };
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

    document.getElementById('_propDetDeleteConfirm').onclick = function () {
      modal.remove();
      fetch('/api/properties/' + propertyId, { method: 'DELETE' })
        .then(function (r) {
          if (r.ok) {
            showToast('Logement supprimé', 'success');
            setTimeout(function () { window.location.href = '/properties.html'; }, 1200);
          } else {
            return r.json().then(function (d) {
              showToast(d.error || 'Erreur lors de la suppression', 'error');
            });
          }
        })
        .catch(function () {
          showToast('Erreur lors de la suppression', 'error');
        });
    };
  }

  /* ── Bind action buttons ──────────────────────────────── */
  function bindActions(p) {
    var dupBtn = document.getElementById('propDetDuplicate');
    if (dupBtn) {
      dupBtn.addEventListener('click', function () {
        /* Bridge: duplication editor lives in settings.html for now */
        window.location.href = '/settings.html';
      });
    }

    var resyncBtn = document.getElementById('propDetResync');
    if (resyncBtn) {
      resyncBtn.addEventListener('click', function () {
        resyncProperty(p.id, resyncBtn);
      });
    }

    var delBtn = document.getElementById('propDetDelete');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        confirmDelete(p);
      });
    }

    var disconnectBtn = document.getElementById('propDetDisconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', function () {
        /* Bridge: Channex disconnect lives in settings.html for now */
        window.location.href = '/settings.html';
      });
    }

    window._propDetDisconnect = function () { window.location.href = '/settings.html'; };
  }

  /* ── Main render ──────────────────────────────────────── */
  function render(p, groups, diffInfo, livret) {
    updateHeader(p, groups);

    var html = '';
    html += renderLivretCard(p, livret);
    html += '<p class="prop-detail-section-label">Informations</p>';
    html += renderBlocksCard(p);

    if (!isSubAccount()) {
      html += '<p class="prop-detail-section-label">Diffusion</p>';
      html += renderDiffusion(p);
      html += '<p class="prop-detail-section-label">Calendriers iCal</p>';
      html += renderIcal(p);
    }

    html += '<p class="prop-detail-section-label">Actions</p>';
    html += renderActions();
    html += '<div class="prop-bottom-pad"></div>';

    var bodyEl = document.getElementById('propDetBody');
    if (bodyEl) {
      bodyEl.innerHTML = html;
      bodyEl.style.display = '';
    }
    document.getElementById('propDetLoading').style.display = 'none';

    bindActions(p);
  }

  /* ── Error display ────────────────────────────────────── */
  function showError(msg) {
    var loadEl = document.getElementById('propDetLoading');
    if (loadEl) loadEl.style.display = 'none';
    var errEl = document.getElementById('propDetError');
    if (!errEl) return;
    errEl.innerHTML = '<div>' + escHtml(msg || 'Erreur de chargement.') + '</div>'
      + '<button class="prop-det-retry-btn" onclick="window._propDetRetry && window._propDetRetry()">Réessayer</button>';
    errEl.style.display = '';
  }

  /* ── Load ─────────────────────────────────────────────── */
  function loadAll() {
    var loadEl = document.getElementById('propDetLoading');
    var errEl  = document.getElementById('propDetError');
    var bodyEl = document.getElementById('propDetBody');
    if (loadEl) loadEl.style.display = '';
    if (errEl)  errEl.style.display  = 'none';
    if (bodyEl) bodyEl.style.display = 'none';

    Promise.all([
      fetch('/api/properties/' + propertyId).then(function (r) {
        if (!r.ok) throw new Error('not-found');
        return r.json();
      }),
      fetch('/api/property-groups').then(function (r) { return r.json(); })
        .catch(function () { return { groups: [] }; }),
      fetch('/api/properties/diffusion').then(function (r) { return r.json(); })
        .catch(function () { return { logements: [] }; }),
      fetch('/api/welcome-books/by-property/' + propertyId).then(function (r) { return r.json(); })
        .catch(function () { return { exists: false }; }),
      fetch('/api/properties/' + propertyId + '/upsell')
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; })
    ]).then(function (results) {
      var p            = results[0];
      var groupsResult = results[1];
      var diffResult   = results[2];
      var livret       = results[3];
      upsellData       = results[4] || {};

      if (!p || !p.id) { showError('Logement introuvable.'); return; }
      propData = p;

      var groups   = (groupsResult && groupsResult.groups) ? groupsResult.groups : [];
      var logements = (diffResult && diffResult.logements) ? diffResult.logements : [];
      var diffInfo = logements.find(function (l) {
        return String(l.property_id) === String(propertyId);
      }) || null;

      render(p, groups, diffInfo, livret);
    }).catch(function () {
      showError('Erreur de chargement. Vérifiez votre connexion.');
    });
  }

  /* ── Section load — delegates to BhPropSections ──────── */
  function loadSection(section) {
    var loadEl = document.getElementById('propDetLoading');
    var errEl  = document.getElementById('propDetError');
    var bodyEl = document.getElementById('propDetBody');
    if (loadEl) loadEl.style.display = '';
    if (errEl)  errEl.style.display  = 'none';
    if (bodyEl) bodyEl.style.display = 'none';

    fetch('/api/properties/' + propertyId).then(function (r) {
      if (!r.ok) throw new Error('not-found');
      return r.json();
    }).then(function (p) {
      if (!p || !p.id) { showError('Logement introuvable.'); return; }
      propData = p;
      var is11a = (section === 'identity' || section === 'stay' || section === 'money');
      var is11b = (section === 'upsell' || section === 'access'
        || section === 'neighborhood' || section === 'amenities');
      if (is11a) {
        if (window.BhPropSections && window.BhPropSections.mount) {
          window.BhPropSections.mount(propertyId, section, p);
        } else {
          showError('Erreur de chargement du module de section.');
        }
      } else if (is11b) {
        if (window.BhPropSections11b && window.BhPropSections11b.mount) {
          window.BhPropSections11b.mount(propertyId, section, p);
        } else {
          showError('Erreur de chargement du module de section.');
        }
      } else {
        showError('Section inconnue.');
      }
    }).catch(function () {
      showError('Erreur de chargement. Vérifiez votre connexion.');
    });
  }

  /* ── Init ─────────────────────────────────────────────── */
  function init() {
    var params = new URLSearchParams(window.location.search);
    propertyId = params.get('id');
    var section = params.get('section');
    if (!propertyId) {
      showError('Identifiant de logement manquant.');
      return;
    }
    var knownSections = ['identity', 'stay', 'money',
      'upsell', 'access', 'neighborhood', 'amenities'];
    if (section && knownSections.indexOf(section) !== -1) {
      window._propDetRetry = function () { loadSection(section); };
      loadSection(section);
    } else {
      window._propDetRetry = loadAll;
      loadAll();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
