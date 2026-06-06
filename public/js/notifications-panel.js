// notifications-panel.js — Extracted from app.html
(function() {

  const BH_API = 'https://lcc-booking-manager.onrender.com';

  function getToken() { return localStorage.getItem('lcc_token') || ''; }

  // ── Ouvrir / fermer ──────────────────────────────────────────
  window.openPromoPanel = function() {
    if (document.getElementById('bhPromoPanel')) {
      closePromoPanel(); return;
    }

    // Overlay
    var ov = document.createElement('div');
    ov.id = 'bhPromoOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9998;';
    ov.onclick = closePromoPanel;
    document.body.appendChild(ov);

    // Panel
    var panel = document.createElement('div');
    panel.id = 'bhPromoPanel';
    panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:380px;max-width:96vw;background:#F5F2EC;z-index:9999;box-shadow:-4px 0 32px rgba(0,0,0,.18);display:flex;flex-direction:column;font-family:"DM Sans",system-ui,sans-serif;';

    // Header
    panel.innerHTML = `
      <div style="background:#1A7A5E;padding:20px 18px 16px;flex-shrink:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:9px;">
            <i class="fas fa-tag" style="color:rgba(255,255,255,.8);font-size:15px;"></i>
            <span style="font-size:16px;font-weight:700;color:white;letter-spacing:-.01em;">Offres & Codes promo</span>
          </div>
          <button onclick="closePromoPanel()" style="background:rgba(255,255,255,.15);border:none;cursor:pointer;color:white;width:30px;height:30px;border-radius:8px;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
        <p style="font-size:12px;color:rgba(255,255,255,.65);margin:0;">Créez des remises et partagez des liens personnalisés vers BHGUEST</p>
      </div>

      <!-- Onglets -->
      <div id="bhPromoTabs" style="display:flex;gap:0;background:white;border-bottom:1px solid #E5E7EB;flex-shrink:0;">
        <button onclick="bhPromoTab('link')" id="bhTabLink" style="flex:1;padding:11px 8px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:white;color:#1A7A5E;border-bottom:2px solid #1A7A5E;transition:all .15s;">
          <i class="fas fa-link" style="margin-right:5px;"></i>Lien personnalisé
        </button>
        <button onclick="bhPromoTab('codes')" id="bhTabCodes" style="flex:1;padding:11px 8px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:white;color:#6B7280;border-bottom:2px solid transparent;transition:all .15s;">
          <i class="fas fa-ticket-alt" style="margin-right:5px;"></i>Codes promo
        </button>
      </div>

      <!-- Corps scrollable -->
      <div id="bhPromoBody" style="flex:1;overflow-y:auto;padding:16px;-webkit-overflow-scrolling:touch;"></div>
    `;

    document.body.appendChild(panel);
    // Charger les logements d'abord, puis afficher l'onglet lien
    bhLoadProperties().then(() => {
      bhPromoTab('link');
    }).catch(() => {
      bhPromoTab('link');
    });
  };

  window.closePromoPanel = function() {
    var p = document.getElementById('bhPromoPanel');
    var o = document.getElementById('bhPromoOv');
    if (p) p.remove();
    if (o) o.remove();
  };

  // ── Onglets ──────────────────────────────────────────────────
  window.bhPromoTab = function(tab) {
    document.getElementById('bhTabCodes').style.cssText = tab === 'codes'
      ? 'flex:1;padding:11px 8px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:white;color:#1A7A5E;border-bottom:2px solid #1A7A5E;transition:all .15s;'
      : 'flex:1;padding:11px 8px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:white;color:#6B7280;border-bottom:2px solid transparent;transition:all .15s;';
    document.getElementById('bhTabLink').style.cssText = tab === 'link'
      ? 'flex:1;padding:11px 8px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:white;color:#1A7A5E;border-bottom:2px solid #1A7A5E;transition:all .15s;'
      : 'flex:1;padding:11px 8px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:white;color:#6B7280;border-bottom:2px solid transparent;transition:all .15s;';

    if (tab === 'codes') bhRenderCodesTab();
    else bhRenderLinkTab();
  };

  // ── Charger les logements (pour le générateur de lien) ───────
  var _bhProperties = [];
  function bhLoadProperties() {
    return fetch(BH_API + '/api/properties', {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    }).then(r => r.json()).then(data => {
      _bhProperties = Array.isArray(data) ? data : (data.properties || []);
    }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════
  // ONGLET CODES PROMO
  // ══════════════════════════════════════════════════════════════
  function bhRenderCodesTab() {
    var body = document.getElementById('bhPromoBody');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:#9CA3AF;"><i class="fas fa-spinner fa-spin"></i></div>';

    fetch(BH_API + '/api/guest/promo/list', {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    })
    .then(r => r.json())
    .then(codes => { bhRenderCodesList(codes); })
    .catch(() => {
      body.innerHTML = '<p style="color:#EF4444;font-size:13px;text-align:center;padding:20px;">Impossible de charger les codes</p>';
    });
  }

  function bhRenderCodesList(codes) {
    var body = document.getElementById('bhPromoBody');
    var activeCodes = codes.filter(c => c.active);
    var inactiveCodes = codes.filter(c => !c.active);

    var html = `
      <!-- Formulaire création -->
      <div style="background:white;border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div style="font-size:12px;font-weight:700;color:#1A7A5E;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">
          <i class="fas fa-plus-circle" style="margin-right:5px;"></i>Nouveau code
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Code</label>
            <input id="bhPromoCode" type="text" placeholder="Ex: BEEN10" maxlength="20"
              style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;box-sizing:border-box;font-family:inherit;outline:none;"
              oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')"
              onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
          </div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Type</label>
              <select id="bhPromoType" style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;background:white;outline:none;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
                <option value="percent">% remise</option>
                <option value="fixed">€ fixe</option>
              </select>
            </div>
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Valeur</label>
              <input id="bhPromoValue" type="number" placeholder="10" min="1"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Utilisations max</label>
              <input id="bhPromoMaxUses" type="number" placeholder="∞" min="1"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Expiration</label>
              <input id="bhPromoExpiry" type="date"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Description (optionnel)</label>
            <input id="bhPromoDesc" type="text" placeholder="Ex: Remise fidélité Jean"
              style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
              onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
          </div>
          <button onclick="bhCreatePromo()" id="bhPromoCreateBtn"
            style="width:100%;padding:11px;background:#1A7A5E;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;">
            <i class="fas fa-plus"></i> Créer le code promo
          </button>
          <div id="bhPromoCreateMsg" style="display:none;font-size:12px;text-align:center;padding:6px 10px;border-radius:8px;"></div>
        </div>
      </div>

      <!-- Liste codes actifs -->
      <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">
        Codes actifs (${activeCodes.length})
      </div>
    `;

    if (!activeCodes.length) {
      html += '<div style="text-align:center;color:#9CA3AF;font-size:13px;padding:16px 0 8px;">Aucun code actif</div>';
    } else {
      activeCodes.forEach(c => { html += bhPromoCard(c, true); });
    }

    if (inactiveCodes.length) {
      html += `<div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px;">Désactivés (${inactiveCodes.length})</div>`;
      inactiveCodes.forEach(c => { html += bhPromoCard(c, false); });
    }

    body.innerHTML = html;
  }

  function bhPromoCard(c, active) {
    var badge = c.discount_type === 'percent'
      ? `-${c.discount_value}%`
      : `-${c.discount_value}€`;
    var expiry = c.expires_at
      ? new Date(c.expires_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' })
      : null;
    var usageText = c.max_uses ? `${c.uses_count || 0}/${c.max_uses}` : `${c.uses_count || 0} util.`;

    return `
      <div style="background:white;border-radius:12px;padding:13px 14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);display:flex;align-items:center;gap:12px;opacity:${active ? 1 : 0.55};">
        <div style="width:48px;height:48px;background:${active ? '#ECFDF5' : '#F3F4F6'};border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-size:13px;font-weight:800;color:${active ? '#1A7A5E' : '#9CA3AF'};">${badge}</span>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:#111827;letter-spacing:.04em;">${c.code}</div>
          ${c.description ? `<div style="font-size:12px;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.description}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;">
            <span style="font-size:11px;color:#9CA3AF;">${usageText}</span>
            ${expiry ? `<span style="font-size:11px;color:#9CA3AF;">· exp. ${expiry}</span>` : ''}
          </div>
        </div>
        ${active ? `
        <button onclick="bhDeletePromo(${c.id})" title="Désactiver"
          style="background:#FEF2F2;border:none;cursor:pointer;color:#EF4444;width:32px;height:32px;border-radius:8px;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-ban"></i>
        </button>` : ''}
      </div>
    `;
  }

  window.bhCreatePromo = async function() {
    var code  = (document.getElementById('bhPromoCode')?.value || '').trim().toUpperCase();
    var type  = document.getElementById('bhPromoType')?.value;
    var val   = parseFloat(document.getElementById('bhPromoValue')?.value);
    var max   = parseInt(document.getElementById('bhPromoMaxUses')?.value) || null;
    var exp   = document.getElementById('bhPromoExpiry')?.value || null;
    var desc  = (document.getElementById('bhPromoDesc')?.value || '').trim() || null;

    var msg = document.getElementById('bhPromoCreateMsg');
    function showMsg(text, color) {
      msg.style.display = 'block';
      msg.style.background = color === 'green' ? '#ECFDF5' : '#FEF2F2';
      msg.style.color = color === 'green' ? '#065F46' : '#991B1B';
      msg.textContent = text;
    }

    if (!code || code.length < 2) { showMsg('Le code doit faire au moins 2 caractères', 'red'); return; }
    if (!type || isNaN(val) || val <= 0) { showMsg('Valeur de remise invalide', 'red'); return; }
    if (type === 'percent' && val > 100) { showMsg('La remise en % ne peut pas dépasser 100', 'red'); return; }

    var btn = document.getElementById('bhPromoCreateBtn');
    btn.textContent = '⏳ Création...';
    btn.disabled = true;

    try {
      var res = await fetch(BH_API + '/api/guest/promo/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: JSON.stringify({ code, discount_type: type, discount_value: val, max_uses: max, expires_at: exp, description: desc })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      showMsg('✓ Code "' + data.promo.code + '" créé !', 'green');
      setTimeout(() => bhRenderCodesTab(), 1000);
    } catch(e) {
      showMsg(e.message, 'red');
      btn.innerHTML = '<i class="fas fa-plus"></i> Créer le code promo';
      btn.disabled = false;
    }
  };

  window.bhDeletePromo = async function(id) {
    if (!await bhConfirm('Désactiver ce code promo ?')) return;
    try {
      await fetch(BH_API + '/api/guest/promo/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      bhRenderCodesTab();
    } catch(e) { alert('Erreur: ' + e.message); }
  };

  // ══════════════════════════════════════════════════════════════
  // ONGLET LIEN PERSONNALISÉ
  // ══════════════════════════════════════════════════════════════
  function bhRenderLinkTab() {
    var body = document.getElementById('bhPromoBody');
    var GUEST_BASE = 'https://www.boostinghost.fr/guest-app/public/index.html';

    var propOptions = _bhProperties.length
      ? _bhProperties.map(p => `<option value="${p.id}">${p.name || p.internalName || p.id}</option>`).join('')
      : '<option value="">Chargement...</option>';

    body.innerHTML = `
      <div style="background:white;border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div style="font-size:12px;font-weight:700;color:#1A7A5E;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;">
          <i class="fas fa-magic" style="margin-right:5px;"></i>Générateur de lien
        </div>
        <div style="display:flex;flex-direction:column;gap:11px;">

          <div>
            <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Logement <span style="color:#EF4444;">*</span></label>
            <select id="bhLinkProp" onchange="bhUpdateLink()"
              style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;background:white;outline:none;"
              onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
              <option value="">— Sélectionner —</option>
              ${propOptions}
            </select>
          </div>

          <div style="display:flex;gap:8px;">
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Arrivée</label>
              <input type="date" id="bhLinkCheckin" onchange="bhUpdateLink()"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
            <div style="flex:1;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Départ</label>
              <input type="date" id="bhLinkCheckout" onchange="bhUpdateLink()"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
          </div>

          <div>
            <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Code promo (optionnel)</label>
            <input type="text" id="bhLinkPromo" placeholder="Ex: BEEN10" maxlength="20"
              oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'');bhUpdateLink()"
              style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;font-weight:600;letter-spacing:.04em;box-sizing:border-box;font-family:inherit;outline:none;"
              onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
          </div>

          <div>
            <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Voyageurs</label>
            <input type="number" id="bhLinkGuests" value="2" min="1" max="20" onchange="bhUpdateLink()"
              style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;box-sizing:border-box;font-family:inherit;outline:none;"
              onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
          </div>

          <div style="border-top:1.5px dashed #E5E7EB;padding-top:12px;margin-top:2px;">
            <!-- Email client -->
            <div style="margin-bottom:10px;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Email client (optionnel)</label>
              <input type="email" id="bhLinkEmail" placeholder="client@email.com" oninput="bhUpdateLink()"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
            <!-- Téléphone client -->
            <div style="margin-bottom:12px;">
              <label style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">Téléphone client (optionnel)</label>
              <input type="tel" id="bhLinkPhone" placeholder="+33 6 00 00 00 00" oninput="bhUpdateLink()"
                style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;"
                onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='#E5E7EB'">
            </div>
            <label style="font-size:11px;font-weight:600;color:#1A7A5E;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px;">
              💶 Prix fixe total (optionnel)
            </label>
            <div style="display:flex;align-items:center;border:1.5px solid #E5E7EB;border-radius:9px;overflow:hidden;background:white;" id="bhFixedPriceWrap"
              onfocusin="this.style.borderColor='#1A7A5E'" onfocusout="this.style.borderColor='#E5E7EB'">
              <span style="padding:0 10px;font-size:14px;color:#9CA3AF;font-weight:600;flex-shrink:0;border-right:1.5px solid #E5E7EB;height:100%;display:flex;align-items:center;background:#F9FAFB;">€</span>
              <input type="number" id="bhLinkFixedPrice" placeholder="350" min="1" onchange="bhUpdateLink()" oninput="bhUpdateLink()"
                style="flex:1;padding:9px 12px;border:none;font-size:14px;font-weight:600;box-sizing:border-box;font-family:inherit;outline:none;background:transparent;">
            </div>
            <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">Prix total du séjour affiché au voyageur. Les 3% de frais BHGuest s'appliqueront en plus.</div>
          </div>
        </div>
      </div>

      <!-- Aperçu lien -->
      <div id="bhLinkPreview" style="display:none;background:white;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">
          <i class="fas fa-link" style="margin-right:5px;"></i>Lien généré
        </div>
        <div id="bhLinkText" style="font-size:11px;color:#374151;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;word-break:break-all;line-height:1.5;margin-bottom:12px;font-family:monospace;"></div>

        <!-- Bandeau info blocage automatique -->
        <div style="background:#FEF9C3;border:1px solid #FDE047;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#713F12;display:flex;align-items:center;gap:8px;">
          <i class="fas fa-clock" style="flex-shrink:0;"></i>
          <span>La création du lien bloque automatiquement les dates pendant <strong>4 heures</strong> pour éviter les réservations simultanées.</span>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button onclick="bhCopyLink()" id="bhCopyBtn"
            style="flex:1;min-width:100px;padding:11px;background:#1A7A5E;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;">
            <i class="fas fa-copy"></i> Copier le lien
          </button>
          <button onclick="bhShareLink()" id="bhShareBtn"
            style="padding:11px 14px;background:#F3F4F6;color:#374151;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-share-alt"></i> Partager
          </button>
        </div>

        <!-- Bouton Envoyer unique (email et/ou SMS) -->
        <button onclick="bhHoldDates()" id="bhHoldBtn" style="display:none;width:100%;margin-top:8px;padding:11px;background:#3B82F6;color:white;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;align-items:center;justify-content:center;gap:7px;">
          <i class="fas fa-paper-plane"></i> <span id="bhSendBtnLabel">Envoyer le lien</span>
        </button>
        <div id="bhHoldStatus" style="margin-top:8px;font-size:12px;text-align:center;display:none;"></div>
        <div id="bhLinkSummary" style="margin-top:10px;font-size:12px;color:#6B7280;text-align:center;line-height:1.5;"></div>
      </div>
    `;
  }

  window.bhUpdateLink = function() {
    var propId     = document.getElementById('bhLinkProp')?.value;
    var checkin    = document.getElementById('bhLinkCheckin')?.value;
    var checkout   = document.getElementById('bhLinkCheckout')?.value;
    var promo      = (document.getElementById('bhLinkPromo')?.value || '').trim();
    var guests     = document.getElementById('bhLinkGuests')?.value || 2;
    var fixedPrice = parseFloat(document.getElementById('bhLinkFixedPrice')?.value) || null;
    var email      = (document.getElementById('bhLinkEmail')?.value || '').trim();
    var phone      = (document.getElementById('bhLinkPhone')?.value || '').trim();

    var preview = document.getElementById('bhLinkPreview');
    if (!propId) { if(preview) preview.style.display='none'; return; }

    var GUEST_BASE = 'https://www.boostinghost.fr/guest-app/public/index.html';
    var params = new URLSearchParams();
    params.set('property', propId);
    if (checkin)     params.set('checkin', checkin);
    if (checkout)    params.set('checkout', checkout);
    if (promo)       params.set('promo', promo);
    if (guests && guests != 2) params.set('guests', guests);
    if (fixedPrice)  params.set('fixed_price', fixedPrice);

    var url = GUEST_BASE + '?' + params.toString();
    window._bhGeneratedLink = url;

    document.getElementById('bhLinkText').textContent = url;
    preview.style.display = 'block';

    // Résumé
    var prop = _bhProperties.find(p => String(p.id) === String(propId));
    var lines = [];
    if (prop) lines.push('🏠 ' + (prop.name || prop.id));
    if (checkin && checkout) {
      var nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
      lines.push('📅 ' + new Date(checkin + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric',month:'short'})
        + ' → ' + new Date(checkout + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric',month:'short'})
        + ' (' + nights + ' nuit' + (nights > 1 ? 's' : '') + ')');
    }
    if (fixedPrice) {
      var commission = Math.round(fixedPrice * 0.03 * 100) / 100;
      lines.push('💶 Prix fixe : ' + fixedPrice + '€ + ' + commission + '€ frais BHGuest = ' + (fixedPrice + commission) + '€ TTC');
    }
    if (promo) lines.push('🏷️ Code promo : ' + promo);
    document.getElementById('bhLinkSummary').innerHTML = lines.join('<br>');

    // Afficher/masquer le bouton Envoyer selon email/SMS remplis
    var holdBtn  = document.getElementById('bhHoldBtn');
    var sendLabel = document.getElementById('bhSendBtnLabel');
    var email = (document.getElementById('bhLinkEmail')?.value || '').trim();
    var phone = (document.getElementById('bhLinkPhone')?.value || '').trim();
    if (holdBtn) {
      if (email || phone) {
        holdBtn.style.display = 'flex';
        if (sendLabel) {
          if (email && phone) sendLabel.textContent = 'Envoyer le lien (email + SMS)';
          else if (email)     sendLabel.textContent = 'Envoyer le lien par email';
          else                sendLabel.textContent = 'Envoyer le lien par SMS';
        }
      } else {
        holdBtn.style.display = 'none';
      }
    }
  };


  window.bhHoldDates = async function() {
    var propId     = document.getElementById('bhLinkProp')?.value;
    var checkin    = document.getElementById('bhLinkCheckin')?.value;
    var checkout   = document.getElementById('bhLinkCheckout')?.value;
    var fixedPrice = parseFloat(document.getElementById('bhLinkFixedPrice')?.value) || null;
    var email      = (document.getElementById('bhLinkEmail')?.value || '').trim();
    var phone      = (document.getElementById('bhLinkPhone')?.value || '').trim();
    if (!propId || !checkin || !checkout) return;

    var btn = document.getElementById('bhHoldBtn');
    var status = document.getElementById('bhHoldStatus');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi en cours...';
    status.style.display = 'none';

    try {
      const token = localStorage.getItem('lcc_token');
      const res = await fetch((window.API_URL || '') + '/api/guest/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ property_id: propId, checkin, checkout, fixed_price: fixedPrice, guest_email: email || null, guest_phone: phone || null })
      });
      const data = await res.json();
      if (res.ok) {
        var exp = new Date(data.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        btn.innerHTML = '<i class="fas fa-check"></i> Lien envoyé';
        btn.style.background = '#059669';
        status.style.display = 'block';
        status.style.color = '#059669';
        var dest = [];
        if (email) dest.push('email');
        if (phone) dest.push('SMS');
        status.innerHTML = '✅ Lien envoyé' + (dest.length ? ' par ' + dest.join(' et ') : '') + ' · Dates bloquées jusqu\'à ' + exp;
        // 🔄 Rafraîchir le calendrier tout de suite (la pré-réservation doit apparaître sans F5)
        if (typeof window.loadCalendarData === 'function') window.loadCalendarData();
        else if (typeof window.renderCalendar === 'function') window.renderCalendar();
      } else {
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le lien';
        btn.style.background = '#3B82F6';
        btn.disabled = false;
        status.style.display = 'block';
        status.style.color = '#DC2626';
        status.innerHTML = '❌ ' + (data.error || 'Erreur lors de l\'envoi');
      }
    } catch(e) {
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le lien';
      btn.disabled = false;
      status.style.display = 'block';
      status.style.color = '#DC2626';
      status.innerHTML = '❌ Erreur réseau';
    }
  };

  window.bhSendEmail = async function() {
    var email = (document.getElementById('bhLinkEmail')?.value || '').trim();
    if (!email) return;
    // Déclenche le hold (qui envoie l'email automatiquement)
    await window.bhHoldDates();
  };

  window.bhSendSMS = async function() {
    var phone = (document.getElementById('bhLinkPhone')?.value || '').trim();
    if (!phone) return;
    // Déclenche le hold (qui envoie le SMS automatiquement)
    await window.bhHoldDates();
  };

  window.bhCopyLink = function() {
    var url = window._bhGeneratedLink;
    if (!url) return;
    var btn = document.getElementById('bhCopyBtn');
    navigator.clipboard.writeText(url).then(() => {
      btn.innerHTML = '<i class="fas fa-check"></i> Copié !';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-copy"></i> Copier le lien';
        btn.style.background = '#1A7A5E';
      }, 2000);
    }).catch(() => {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      ta.remove();
      btn.innerHTML = '<i class="fas fa-check"></i> Copié !';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-copy"></i> Copier le lien';
        btn.style.background = '#1A7A5E';
      }, 2000);
    });
  };

  window.bhShareLink = function() {
    var url = window._bhGeneratedLink;
    if (!url) return;
    if (navigator.share) {
      navigator.share({ title: 'Réservation Boostinghost', url });
    } else {
      bhCopyLink();
    }
  };

})();
