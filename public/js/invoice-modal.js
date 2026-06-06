// invoice-modal.js — Extracted from app.html
// ── Invoice Modal ────────────────────────────────────────────
(function() {
  window.openInvoiceModal = function(data) {
    // data = { guestName, guestEmail, propertyId, propertyName, checkin, checkout,
    //          amountRooms, amountTaxes, amountCleaning, guest_country, occupancy_adults }
    data = data || {};

    const _nationalityMap = {
      FR:'Française', GB:'Britannique', DE:'Allemande', ES:'Espagnole', IT:'Italienne',
      US:'Américaine', NL:'Néerlandaise', BE:'Belge', CH:'Suisse', PT:'Portugaise',
      CA:'Canadienne', AU:'Australienne', JP:'Japonaise', CN:'Chinoise', BR:'Brésilienne',
      MX:'Mexicaine', RU:'Russe', IN:'Indienne', ZA:'Sud-africaine', MA:'Marocaine',
      TN:'Tunisienne', DZ:'Algérienne', SN:'Sénégalaise', LU:'Luxembourgeoise',
      IE:'Irlandaise', SE:'Suédoise', NO:'Norvégienne', DK:'Danoise', FI:'Finlandaise',
      PL:'Polonaise', CZ:'Tchèque', AT:'Autrichienne', GR:'Grecque', TR:'Turque',
      AE:'Émiratie', SG:'Singapourienne', KR:'Sud-coréenne', CI:'Ivoirienne',
    };
    const nationality = data.guestCountry
      ? (_nationalityMap[data.guestCountry.toUpperCase()] || data.guestCountry)
      : '';

    // Remplir logements si pas encore fait
    _populateInvPropertySelect(data.propertyId, data.propertyName);

    // Remplir champs
    _setVal('inv_clientName',        data.guestName   || '');
    _setVal('inv_clientEmail',       data.guestEmail  || '');
    _setVal('inv_clientNationality', nationality);
    _setVal('inv_checkin',           data.checkin     || '');
    _setVal('inv_checkout',          data.checkout    || '');
    _setVal('inv_rent',              data.amountRooms || data.amountTotal || '');
    _setVal('inv_taxes',             data.amountTaxes    || '');
    _setVal('inv_cleaning',          data.amountCleaning || '');
    // Stocker la plateforme dans un champ caché
    const invPlatformEl = document.getElementById('inv_platform');
    if (invPlatformEl) invPlatformEl.value = data.platform || '';

    document.getElementById('invoiceModal').classList.add('active');
    renderInvoicePreview();
  };

  window.closeInvoiceModal = function() {
    document.getElementById('invoiceModal').classList.remove('active');
  };

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined && val !== '') el.value = val;
  }

  function _populateInvPropertySelect(propertyId, propertyName) {
    const sel = document.getElementById('inv_propertyName');
    if (!sel) return;
    // Toujours depuis l'API — le localStorage ne contient pas ownerId
    fetch('/api/properties', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('lcc_token') } })
      .then(r => r.json()).then(data => {
        while (sel.options.length > 1) sel.remove(1);
        (data.properties || []).forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id; opt.textContent = p.name;
          opt.dataset.address = p.address || '';
          opt.dataset.ownerId = p.ownerId || p.owner_id || '';
          sel.appendChild(opt);
        });
        if (propertyId) {
          for (let o of sel.options) { if (o.value === propertyId) { sel.value = propertyId; break; } }
        }
        renderInvoicePreview();
      }).catch(() => {});
  }

  // Cache propriétaire par logement pour éviter appels répétés
  const _invOwnerCache = {};

  async function _getInvOwner(propertyId) {
    if (!propertyId) return null;
    // Récupérer l'ownerId depuis le dataset de l'option sélectionnée
    const sel = document.getElementById('inv_propertyName');
    const selectedOpt = sel ? sel.options[sel.selectedIndex] : null;
    const ownerId = selectedOpt?.dataset?.ownerId || null;
    if (!ownerId) return null;
    if (_invOwnerCache[ownerId] !== undefined) return _invOwnerCache[ownerId];
    try {
      const res = await fetch('/api/owner-clients/' + ownerId, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('lcc_token') }
      });
      if (!res.ok) { _invOwnerCache[ownerId] = null; return null; }
      const owner = await res.json();
      _invOwnerCache[ownerId] = owner;
      return owner;
    } catch(e) { _invOwnerCache[ownerId] = null; return null; }
  }

  window.renderInvoicePreview = async function() {
    const preview = document.getElementById('inv_preview');
    const sendBtn = document.getElementById('inv_sendBtn');
    if (!preview) return;

    const clientName   = document.getElementById('inv_clientName')?.value || '';
    const clientNationality = document.getElementById('inv_clientNationality')?.value || '';
    const clientEmail  = document.getElementById('inv_clientEmail')?.value || '';
    const clientAddr   = document.getElementById('inv_clientAddress')?.value || '';
    const clientCP     = document.getElementById('inv_clientPostalCode')?.value || '';
    const clientCity   = document.getElementById('inv_clientCity')?.value || '';
    const isCompany    = document.getElementById('inv_isCompany')?.checked || false;
    const clientCompany= isCompany ? (document.getElementById('inv_clientCompany')?.value || '') : '';
    const clientSiret  = isCompany ? (document.getElementById('inv_clientSiret')?.value || '') : '';
    const freeNote     = document.getElementById('inv_freeNote')?.value || '';
    const propSel      = document.getElementById('inv_propertyName');
    const propId       = propSel?.value || '';
    const propName     = propSel?.options[propSel.selectedIndex]?.text || '';
    const propAddr     = propSel?.options[propSel.selectedIndex]?.dataset?.address || '';
    const checkin      = document.getElementById('inv_checkin')?.value || '';
    const checkout     = document.getElementById('inv_checkout')?.value || '';
    const rent         = parseFloat(document.getElementById('inv_rent')?.value || 0);
    const taxes        = parseFloat(document.getElementById('inv_taxes')?.value || 0);
    const cleaning     = parseFloat(document.getElementById('inv_cleaning')?.value || 0);
    const withVat      = document.getElementById('inv_withVat')?.checked;
    const vatRate      = withVat ? parseFloat(document.getElementById('inv_vatRate')?.value || 10) : 0;

    if (!clientName || !propName) {
      preview.innerHTML = '<div class="inv-empty"><i class="fas fa-file-invoice"></i><p>Remplissez le nom client et le logement</p></div>';
      if (sendBtn) sendBtn.disabled = true;
      return;
    }

    const subtotal = rent + taxes + cleaning;
    const vatAmt   = withVat ? subtotal * (vatRate / 100) : 0;
    const total    = subtotal + vatAmt;

    let nights = 0;
    if (checkin && checkout) {
      nights = Math.ceil((new Date(checkout) - new Date(checkin)) / 86400000);
    }
    const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR') : '';
    const fmtAmt  = n => n.toFixed(2) + ' €';

    // Récupérer le propriétaire du logement (comme factures.html)
    const profile = JSON.parse(localStorage.getItem('lcc_settings_profile') || '{}');
    const user    = JSON.parse(localStorage.getItem('lcc_user') || '{}');
    const owner   = propId ? await _getInvOwner(propId) : null;
    const emitter = owner
      ? (owner.company_name || ((owner.first_name || '') + ' ' + (owner.last_name || '')).trim())
      : (profile.company || user.company || user.name || 'Ma Conciergerie');
    const emitterAddr  = owner ? (owner.address || '') : (profile.address || '');
    const emitterCity  = owner
      ? ((owner.postal_code || '') + ' ' + (owner.city || '')).trim()
      : ((profile.postalCode || '') + ' ' + (profile.city || '')).trim();
    const emitterSiret = owner ? (owner.siret || '') : (profile.siret || '');
    const emitterEmail = owner ? (owner.email || '') : (user.email || '');

    const invoiceNum = 'FACT-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4);

    preview.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <h2>${emitter}</h2>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            ${emitterAddr ? emitterAddr + '<br>' : ''}
            ${emitterCity.trim() ? emitterCity + '<br>' : ''}
            ${emitterSiret ? 'SIRET : ' + emitterSiret + '<br>' : ''}
            ${emitterEmail ? emitterEmail : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div class="inv-num">FACTURE N° ${invoiceNum}</div>
          <div style="font-size:12px;color:#6b7280;">Date : ${fmtDate(new Date().toISOString())}</div>
        </div>
      </div>

      <div class="inv-sec">
        <h3>Facturé à</h3>
        <strong>${clientCompany || clientName}</strong><br>
        ${clientCompany ? clientName + '<br>' : ''}
        ${clientNationality ? 'Nationalité : ' + clientNationality + '<br>' : ''}
        ${clientSiret ? 'N° fiscal : ' + clientSiret + '<br>' : ''}
        ${clientEmail ? clientEmail + '<br>' : ''}
        ${clientAddr ? clientAddr + '<br>' : ''}
        ${(clientCP || clientCity) ? (clientCP + ' ' + clientCity).trim() : ''}
        ${freeNote ? '<br><em>' + freeNote + '</em>' : ''}
      </div>

      <div class="inv-sec">
        <h3>Séjour</h3>
        <strong>${propName}</strong>
        ${propAddr ? '<br>' + propAddr : ''}
        ${checkin && checkout ? '<br>Du ' + fmtDate(checkin) + ' au ' + fmtDate(checkout) + (nights ? ' (' + nights + ' nuit' + (nights > 1 ? 's' : '') + ')' : '') : ''}
      </div>

      <div class="inv-sec">
        <h3>Détails</h3>
        ${rent > 0   ? '<div class="inv-line"><span>Séjour' + (nights ? ' (' + nights + ' nuit' + (nights > 1 ? 's' : '') + ')' : '') + '</span><span>' + fmtAmt(rent) + '</span></div>' : ''}
        ${taxes > 0  ? '<div class="inv-line"><span>Taxe de séjour</span><span>' + fmtAmt(taxes) + '</span></div>' : ''}
        ${cleaning > 0 ? '<div class="inv-line"><span>Frais de ménage</span><span>' + fmtAmt(cleaning) + '</span></div>' : ''}
      </div>

      <div class="inv-line inv-sub"><span>Sous-total</span><span>${fmtAmt(subtotal)}</span></div>
      ${withVat ? '<div class="inv-line"><span>TVA (' + vatRate + '%)</span><span>' + fmtAmt(vatAmt) + '</span></div>' : ''}
      <div class="inv-line inv-tot"><span>TOTAL TTC</span><span>${fmtAmt(total)}</span></div>

      <div class="inv-stamp"><i class="fas fa-check-circle"></i> FACTURE ACQUITTÉE</div>
      ${!withVat ? '<div class="inv-footer-note">TVA non applicable — Art. 293B du CGI</div>' : ''}
    `;

    if (sendBtn) sendBtn.disabled = !clientEmail;
  };

  window.sendInvoiceFromModal = async function() {
    const clientEmail = document.getElementById('inv_clientEmail')?.value;
    if (!clientEmail) { alert('Veuillez renseigner l\'email du client'); return; }

    const propSel = document.getElementById('inv_propertyName');
    const data = {
      clientName:    document.getElementById('inv_clientName')?.value,
      clientNationality: document.getElementById('inv_clientNationality')?.value || '',
      clientEmail,
      clientAddress: document.getElementById('inv_clientAddress')?.value,
      clientPostalCode: document.getElementById('inv_clientPostalCode')?.value,
      clientCity:    document.getElementById('inv_clientCity')?.value,
      clientCompany: document.getElementById('inv_isCompany')?.checked ? (document.getElementById('inv_clientCompany')?.value || '') : '',
      clientSiret:   document.getElementById('inv_isCompany')?.checked ? (document.getElementById('inv_clientSiret')?.value || '') : '',
      freeNote:      document.getElementById('inv_freeNote')?.value || '',
      platform:      document.getElementById('inv_platform')?.value || '',
      propertyName:  propSel?.options[propSel.selectedIndex]?.text || '',
      propertyAddress: propSel?.options[propSel.selectedIndex]?.dataset?.address || '',
      checkinDate:   document.getElementById('inv_checkin')?.value,
      checkoutDate:  document.getElementById('inv_checkout')?.value,
      nights: (() => {
        const ci = document.getElementById('inv_checkin')?.value;
        const co = document.getElementById('inv_checkout')?.value;
        return (ci && co) ? Math.ceil((new Date(co) - new Date(ci)) / 86400000) : 0;
      })(),
      rentAmount:       document.getElementById('inv_rent')?.value || 0,
      touristTaxAmount: document.getElementById('inv_taxes')?.value || 0,
      cleaningFee:      document.getElementById('inv_cleaning')?.value || 0,
      vatRate: document.getElementById('inv_withVat')?.checked ? document.getElementById('inv_vatRate')?.value : 0,
      sendEmail: true
    };

    const btn = document.getElementById('inv_sendBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…'; }

    try {
      const res = await fetch('/api/invoice/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('lcc_token') },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erreur envoi');
      alert('✅ Facture envoyée à ' + clientEmail);
      closeInvoiceModal();
    } catch (err) {
      alert('❌ Erreur : ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-envelope"></i> Envoyer par email'; }
    }
  };

  // Fermer en cliquant en dehors
  document.getElementById('invoiceModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeInvoiceModal();
  });

  // Neutraliser mobile-native-experience.js qui slide les modaux
  (function() {
    const invContent = document.querySelector('#invoiceModal .inv-content');
    const invModal   = document.getElementById('invoiceModal');
    if (!invContent || !invModal) return;
    // Marquer pour exclure des scripts natifs
    invModal.dataset.noNative = '1';
    invContent.dataset.noNative = '1';
    // Observer et annuler tout transform/animation injecté en inline style
    const obs = new MutationObserver(() => {
      ['transform','transition','animation','bottom','top','left','right'].forEach(prop => {
        if (invContent.style[prop] && invContent.style[prop] !== 'none') {
          invContent.style.setProperty(prop, prop === 'transform' ? 'none' : '', 'important');
        }
      });
      if (invModal.style.transform) invModal.style.setProperty('transform','none','important');
    });
    obs.observe(invContent, { attributes: true, attributeFilter: ['style'] });
    obs.observe(invModal,   { attributes: true, attributeFilter: ['style'] });
  })();
})();
