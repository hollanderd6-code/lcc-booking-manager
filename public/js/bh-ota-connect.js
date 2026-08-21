/* ============================================================================
   BH-OTA-CONNECT — nouveau parcours de connexion des plateformes
   ============================================================================
   Remplace openChannexModal() de settings.js, sans toucher au reste.

   INSTALLATION — dans public/settings.html (et public/app.html si la modale y
   est aussi utilisée), APRÈS le script settings.js :

     <script src="/js/bh-ota-connect.js"></script>

   Aucun changement serveur : ce fichier n'utilise que les routes existantes
   (/api/channex/connect-property, /iframe-token, /connected-channels,
   /list-user-properties).

   CE QUI CHANGE
   1. La question « Logement indépendant ou partie d'un immeuble ? » disparaît.
      Elle est déduite de l'adresse : si un autre logement à la même adresse est
      déjà connecté, on rattache automatiquement au même établissement Channex.
      Plus aucun UUID de 36 caractères à retrouver et à coller.
   2. L'autorisation Channex dans l'extranet Booking.com devient une étape de
      compte, faite UNE FOIS (mémorisée), au lieu d'être réaffichée à chaque
      logement et à chaque plateforme.
   3. La fenêtre Channex (en anglais) n'arrive qu'en dernier, précédée d'une
      bande d'explication en français qui dit exactement quoi y faire.
   4. Chaque écran indique où l'on en est : « Étape 1 sur 2 », « 2 sur 2 ».
   ========================================================================== */
(function () {
  'use strict';

  var V = {
    vert: '#0E3B2E', vertFonce: '#0A2C22', vertClair: '#1E6E52',
    vertPale: '#F1F6F3', vertFilet: '#A8CDBE',
    encre: '#20221F', t2: '#5A5A54', t3: '#6A6A64', t4: '#878782',
    ligne: '#EAE9E5', ligne2: '#F1F0EC', cote: '#F7F7F5', creme: '#F4F1E9',
    or: '#916018', orFond: '#FBF6E9', orFilet: '#E5C98F',
    serif: "'Instrument Serif',Georgia,serif",
    sans: "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  };

  /* Icônes : celles déjà utilisées par settings.js (Font Awesome, chargé par la page),
     posées sur une pastille teintée aux couleurs de chaque plateforme. */
  var PLATEFORMES = [
    { code: 'ABB', cle: 'airbnb', label: 'Airbnb', couleur: '#FF5A5F', fond: '#FFF1F0', filet: '#FFD6D4',
      icone: '<i class="fa-brands fa-airbnb" style="font-size:17px;"></i>',
      cout: 'Un seul clic, aucun identifiant à saisir', prep: false },
    { code: 'BDC', cle: 'booking', label: 'Booking.com', couleur: '#003580', fond: '#F0F4FF', filet: '#C7D7F9',
      icone: '<i class="fas fa-building" style="font-size:15px;"></i>',
      cout: 'Le Property ID de votre extranet', prep: true },
    { code: 'EXP', cle: 'expedia', label: 'Expedia', couleur: '#1B5E96', fond: '#F0F6FF', filet: '#C5DAF7',
      icone: '<i class="fas fa-plane" style="font-size:14px;"></i>',
      cout: 'Le Property ID Expedia Partner Central', prep: false },
    { code: 'VRB', cle: 'vrbo', label: 'Abritel / VRBO', couleur: '#1C61A5', fond: '#F0F5FF', filet: '#C9DCF7',
      icone: '<i class="fas fa-home" style="font-size:14px;"></i>',
      cout: "Le Property ID visible dans l'URL de votre annonce", prep: false }
  ];

  var CLE_PREP = 'bh_bdc_extranet_ok';

  function prepFaite() { try { return localStorage.getItem(CLE_PREP) === '1'; } catch (e) { return false; } }
  function marquerPrep(v) { try { v ? localStorage.setItem(CLE_PREP, '1') : localStorage.removeItem(CLE_PREP); } catch (e) {} }
  function token() { try { return localStorage.getItem('lcc_token'); } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function normAdresse(a) {
    return String(a || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* Le logement voisin déjà connecté, à la même adresse : c'est lui qui porte
     l'établissement Channex auquel on doit se rattacher. */
  function voisinConnecte(propertyId) {
    var liste = window.allProperties || [];
    var moi = liste.find(function (p) { return (p.id || p._id) === propertyId; });
    if (!moi || !moi.address) return null;
    var a = normAdresse(moi.address);
    if (!a) return null;
    return liste.find(function (p) {
      return (p.id || p._id) !== propertyId && normAdresse(p.address) === a &&
             (p.channexPropertyId || p.channex_property_id);
    }) || null;
  }

  /* ── coquille de modale ─────────────────────────────────────────────────── */
  function coquille() {
    var vieux = document.getElementById('channexModal');
    if (vieux) vieux.remove();
    var m = document.createElement('div');
    m.id = 'channexModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(32,34,31,.42);' +
      'backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;';
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }

  function carte(largeur, contenu, extra) {
    return '<div style="background:#fff;border-radius:16px;max-width:' + largeur + 'px;width:100%;' +
      'box-shadow:0 24px 60px rgba(32,34,31,.28);overflow:hidden;font-family:' + V.sans + ';color:' + V.encre + ';' +
      (extra || '') + '">' + contenu + '</div>';
  }

  function entete(surtitre, titre, sous) {
    return '<div style="padding:22px 24px;border-bottom:1px solid ' + V.ligne2 + ';display:flex;' +
      'align-items:flex-start;justify-content:space-between;gap:16px;">' +
      '<div>' +
      (surtitre ? '<div style="font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:' + V.or + ';">' + esc(surtitre) + '</div>' : '') +
      '<div style="font-family:' + V.serif + ';font-size:24px;margin-top:' + (surtitre ? '6px' : '0') + ';">' + esc(titre) + '</div>' +
      (sous ? '<div style="font-size:13px;color:' + V.t2 + ';margin-top:4px;">' + esc(sous) + '</div>' : '') +
      '</div>' +
      '<button type="button" onclick="document.getElementById(\'channexModal\')?.remove()" ' +
      'style="border:0;background:transparent;font-size:18px;color:' + V.t4 + ';cursor:pointer;line-height:1;padding:4px;">✕</button>' +
      '</div>';
  }

  function pied(gauche, droite) {
    return '<div style="padding:15px 24px;background:' + V.cote + ';border-top:1px solid ' + V.ligne2 + ';' +
      'display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '<div>' + (gauche || '') + '</div><div style="display:flex;gap:10px;">' + (droite || '') + '</div></div>';
  }

  function btnPlein(texte, onclick, actif) {
    return '<button type="button" ' + (actif === false ? 'disabled' : 'onclick="' + onclick + '"') +
      ' style="border:0;background:' + (actif === false ? '#C9C7C1' : V.vert) + ';color:#fff;font-family:' + V.sans + ';' +
      'font-size:14px;font-weight:500;padding:11px 18px;border-radius:9px;cursor:' +
      (actif === false ? 'not-allowed' : 'pointer') + ';">' + texte + '</button>';
  }

  function btnFantome(texte, onclick) {
    return '<button type="button" onclick="' + onclick + '" style="border:0;background:transparent;color:' + V.t2 +
      ';font-family:' + V.sans + ';font-size:13.5px;padding:10px 12px;cursor:pointer;">' + texte + '</button>';
  }

  /* ── écran 1 : les plateformes de CE logement ───────────────────────────── */
  async function ecranPlateformes(modal, pid, pname) {
    var connectees = [];
    var estConnecte = false;
    var liste = window.allProperties || [];
    var moi = liste.find(function (p) { return (p.id || p._id) === pid; });
    if (moi && (moi.channexEnabled || moi.channex_enabled)) {
      estConnecte = true;
      try {
        var r = await fetch(API_URL + '/api/channex/connected-channels/' + pid + '?bh_property_id=' + pid,
          { headers: { Authorization: 'Bearer ' + token() } });
        var d = await r.json();
        connectees = (d.channels || []).map(function (c) { return String(c.channel || '').toLowerCase(); });
      } catch (e) {}
    }

    var voisin = voisinConnecte(pid);
    var lignes = PLATEFORMES.map(function (p) {
      var ok = connectees.some(function (c) { return c.indexOf(p.cle) > -1 || (p.cle === 'booking' && c.indexOf('bdc') > -1) || (p.cle === 'airbnb' && c === 'abb'); });
      var attente = p.prep && !prepFaite();
      var etat = ok ? 'Connecté — rien à faire' : (attente ? "Une autorisation à donner une fois dans votre extranet" : p.cout);
      var action = ok ? '' :
        '<button type="button" onclick="window._bhOta(\'' + p.code + '\')" style="border:' +
        (attente ? '1px solid ' + V.orFilet : '0') + ';background:' + (attente ? V.orFond : V.vert) + ';color:' +
        (attente ? V.or : '#fff') + ';font-family:' + V.sans + ';font-size:13.5px;font-weight:500;padding:10px 15px;' +
        'border-radius:9px;cursor:pointer;white-space:nowrap;">' + (attente ? 'Préparer' : 'Connecter') + '</button>';
      return '<div style="border:1px solid ' + V.ligne + ';border-radius:12px;padding:14px 16px;display:flex;' +
        'align-items:center;gap:13px;">' +
        '<span style="width:30px;height:30px;border-radius:8px;background:' + p.fond + ';border:1px solid ' + p.filet +
        ';color:' + p.couleur + ';display:flex;align-items:center;justify-content:center;flex:none;">' + p.icone + '</span>' +
        '<span style="flex:1;"><span style="display:block;font-size:14.5px;font-weight:500;">' + p.label + '</span>' +
        '<span style="display:block;font-size:12.5px;color:' + V.t3 + ';margin-top:2px;">' + esc(etat) + '</span></span>' +
        (ok ? '<span style="font-size:13px;color:' + V.vertClair + ';font-weight:500;">✓</span>' : action) +
        '</div>';
    }).join('');

    var noteImmeuble = (!estConnecte && voisin)
      ? '<div style="background:' + V.creme + ';border:1px solid ' + V.ligne + ';border-radius:12px;padding:13px 15px;' +
        'font-size:13px;color:' + V.t2 + ';line-height:1.5;">Même adresse que <strong style="font-weight:500;color:' +
        V.encre + ';">' + esc(voisin.name || 'un logement déjà connecté') + '</strong> : ce logement sera rattaché au ' +
        'même établissement, automatiquement. Rien à saisir.</div>'
      : '';

    modal.innerHTML = carte(540,
      entete(null, 'Connecter mes plateformes', pname) +
      '<div style="padding:18px 24px;display:flex;flex-direction:column;gap:12px;">' + noteImmeuble + lignes + '</div>' +
      pied(estConnecte
        ? '<button type="button" onclick="channexDisconnect(\'' + pid + '\')" style="border:0;background:transparent;' +
          'color:#C0433C;font-family:' + V.sans + ';font-size:13px;cursor:pointer;padding:8px 0;">Déconnecter ce logement</button>'
        : '', btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));

    window._bhOta = function (code) {
      var p = PLATEFORMES.find(function (x) { return x.code === code; });
      if (p.prep && !prepFaite()) return ecranPrep(modal, pid, pname, code);
      lancer(modal, pid, pname, code);
    };
  }

  /* ── écran 2 (Booking, une seule fois) : autorisation extranet ──────────── */
  function ecranPrep(modal, pid, pname, code) {
    var etapes = [
      "Connectez-vous à l'extranet Booking.com.",
      'Allez dans <strong style="font-weight:500;">Compte → Fournisseur de connectivité</strong>.',
      'Cherchez « Channex » et cliquez sur <strong style="font-weight:500;">Accepter</strong>.',
      'Notez votre <strong style="font-weight:500;">Property ID</strong> : le numéro affiché en haut, à côté du nom de votre établissement.'
    ].map(function (t, i) {
      return '<div style="display:flex;gap:12px;align-items:flex-start;">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:#E4EDE8;color:' + V.vert + ';font-size:12px;' +
        'font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;">' + (i + 1) + '</span>' +
        '<span style="font-size:14px;line-height:1.5;">' + t + '</span></div>';
    }).join('');

    modal.innerHTML = carte(560,
      entete('Étape 1 sur 2 · une seule fois', 'Autoriser Channex chez Booking.com',
        'Une opération de compte, pas de logement. Vous ne reverrez plus cet écran.') +
      '<div style="padding:22px 24px;display:flex;flex-direction:column;gap:16px;">' +
      '<div style="display:flex;flex-direction:column;gap:12px;">' + etapes + '</div>' +
      '<a href="https://admin.booking.com" target="_blank" rel="noopener" style="align-self:flex-start;font-size:13.5px;' +
      'font-weight:500;color:' + V.vert + ';text-decoration:none;border:1px solid ' + V.ligne + ';padding:9px 14px;border-radius:9px;">' +
      "Ouvrir l'extranet Booking.com ↗</a>" +
      '<div style="height:1px;background:' + V.ligne2 + ';"></div>' +
      '<label style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;background:' + V.vertPale +
      ';border:1px solid ' + V.vertFilet + ';border-radius:12px;padding:14px;">' +
      '<input type="checkbox" id="bhPrepOk" onchange="window._bhPrep(this.checked)" ' +
      'style="width:18px;height:18px;accent-color:' + V.vert + ';margin-top:1px;flex:none;">' +
      '<span><span style="display:block;font-size:14px;font-weight:500;">C\'est fait — Channex est accepté dans mon extranet.</span>' +
      '<span style="display:block;font-size:12.5px;color:' + V.t2 + ';margin-top:3px;">Cette étape ne vous sera plus demandée.</span></span>' +
      '</label></div>' +
      pied('', btnFantome('Plus tard', "document.getElementById('channexModal')?.remove()") +
        '<span id="bhPrepSuite">' + btnPlein('Continuer', '', false) + '</span>'));

    window._bhPrep = function (coche) {
      marquerPrep(coche);
      document.getElementById('bhPrepSuite').innerHTML =
        btnPlein('Continuer', "window._bhLancer('" + code + "')", !!coche);
    };
    window._bhLancer = function (c) { if (prepFaite()) lancer(modal, pid, pname, c); };
  }

  /* ── écran 3 : rattachement automatique puis fenêtre Channex ────────────── */
  async function lancer(modal, pid, pname, code) {
    var p = PLATEFORMES.find(function (x) { return x.code === code; });
    modal.innerHTML = carte(420,
      '<div style="padding:40px;text-align:center;">' +
      '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
      ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
      '<div style="margin-top:14px;font-size:13px;color:' + V.t3 + ';">Préparation de la connexion…</div></div>');

    var liste = window.allProperties || [];
    var moi = liste.find(function (x) { return (x.id || x._id) === pid; });
    var dejaConnecte = !!(moi && (moi.channexEnabled || moi.channex_enabled));

    if (!dejaConnecte) {
      var voisin = voisinConnecte(pid);
      var corps = { property_id: pid };
      if (voisin) corps.channex_property_id = voisin.channexPropertyId || voisin.channex_property_id;
      try {
        var r = await fetch(API_URL + '/api/channex/connect-property', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify(corps)
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Erreur activation');
        if (voisin) toast('Rattaché au même établissement que ' + (voisin.name || 'votre autre logement') + '.', 'success');
        if (typeof loadProperties === 'function') loadProperties().catch(function () {});
      } catch (e) {
        modal.innerHTML = carte(420,
          '<div style="padding:34px;text-align:center;">' +
          '<div style="font-size:14px;color:' + V.encre + ';line-height:1.5;">' + esc(e.message) + '</div>' +
          '<div style="margin-top:16px;">' + btnPlein('Fermer', "document.getElementById('channexModal')?.remove()") + '</div></div>');
        return;
      }
    }

    var aide = code === 'BDC'
      ? 'Dans la fenêtre ci-dessous, cliquez sur <strong style="font-weight:500;">Create</strong>, puis collez votre <strong style="font-weight:500;">Property ID Booking.com</strong> et validez.'
      : code === 'ABB'
        ? 'La fenêtre ci-dessous vous redirige vers Airbnb pour donner votre accord, puis vous laisse associer votre annonce.'
        : 'Dans la fenêtre ci-dessous, cliquez sur <strong style="font-weight:500;">Create</strong>, puis renseignez votre Property ID.';

    var cadre = function (interieur) {
      return carte(720,
        entete(p.prep ? 'Étape 2 sur 2' : 'Dernière étape', p.label, pname) +
        '<div style="padding:12px 24px;background:' + V.creme + ';border-bottom:1px solid ' + V.ligne2 + ';font-size:12.5px;' +
        'color:' + V.t2 + ';line-height:1.5;">' + aide +
        ' <span style="color:' + V.t4 + ';">Cette fenêtre est celle de notre partenaire : elle est en anglais, c\'est normal.</span></div>' +
        '<div style="padding:14px 20px 18px;">' + interieur + '</div>' +
        pied('<button type="button" onclick="window._bhRetour()" style="border:0;background:transparent;color:' + V.vert +
          ';font-family:' + V.sans + ';font-size:13.5px;font-weight:500;cursor:pointer;padding:8px 0;">← Retour aux plateformes</button>',
          btnFantome('Fermer', "window._bhFinir()")), 'max-height:90vh;overflow:auto;');
    };

    modal.innerHTML = cadre('<div style="height:clamp(280px,46vh,420px);display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:12px;border:1px solid ' + V.ligne + ';border-radius:12px;">' +
      '<div style="width:22px;height:22px;border:2px solid ' + V.ligne + ';border-top-color:' + p.couleur +

      ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
      '<div style="font-size:13px;color:' + V.t3 + ';">Ouverture de la fenêtre sécurisée…</div></div>');

    window._bhRetour = function () { ecranPlateformes(modal, pid, pname); };
    window._bhFinir = function () {
      modal.remove();
      if (typeof loadProperties === 'function') loadProperties().catch(function () {});
    };

    try {
      var res = await fetch(API_URL + '/api/channex/iframe-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({ property_id: pid, channel_code: code })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      modal.innerHTML = cadre('<div style="border:1px solid ' + V.ligne + ';border-radius:12px;overflow:hidden;">' +
        '<iframe src="' + esc(data.iframe_url) + '" style="width:100%;height:clamp(280px,46vh,420px);border:none;display:block;" allow="same-origin"></iframe></div>');
    } catch (e) {
      modal.innerHTML = cadre('<div style="padding:30px;text-align:center;border:1px solid ' + V.ligne +
        ';border-radius:12px;font-size:14px;color:' + V.encre + ';">' + esc(e.message) + '</div>');
    }
  }

  /* ── remplacement de l'ancienne modale ─────────────────────────────────── */
  window.openChannexModal = function (propertyId, propertyName, isConnected, channelCode) {
    var modal = coquille();
    if (channelCode) return lancer(modal, propertyId, propertyName || '', channelCode);
    return ecranPlateformes(modal, propertyId, propertyName || '');
  };

  if (!document.getElementById('bhOtaKeyframes')) {
    var st = document.createElement('style');
    st.id = 'bhOtaKeyframes';
    st.textContent = '@keyframes bhspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
})();
