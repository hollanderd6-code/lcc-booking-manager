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

    /* Les majorations de prix par plateforme. Le resultat de cet appel sert
       aussi de test de disponibilite : si la route n'est pas montee cote
       serveur, on n'affiche pas les champs — plutot que de proposer une
       saisie qui ne serait jamais enregistree. */
    var majorations = {};
    var majorationsDispo = false;
    try {
      var rMaj = await fetch(API_URL + '/api/properties/' + pid + '/markups',
        { headers: { Authorization: 'Bearer ' + token() } });
      if (rMaj.ok) {
        var dMaj = await rMaj.json();
        majorations = dMaj.markups || {};
        majorationsDispo = true;
      }
    } catch (eMaj) {}

    var voisin = voisinConnecte(pid);
    var lignes = PLATEFORMES.map(function (p) {
      var ok = connectees.some(function (c) { return c.indexOf(p.cle) > -1 || (p.cle === 'booking' && c.indexOf('bdc') > -1) || (p.cle === 'airbnb' && c === 'abb'); });
      var attente = p.prep && !prepFaite();
      var etat = ok ? 'Connecté' : (attente ? "Une autorisation à donner une fois dans votre extranet" : p.cout);
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
        /* Majoration : le prix du calendrier, majore de ce pourcentage, pour
           cette plateforme seulement. Vide ou 0 = prix du calendrier tel quel. */
        (majorationsDispo
          ? '<span style="display:flex;align-items:center;gap:5px;flex:none;">' +
            '<span style="font-size:12.5px;color:' + V.t3 + ';">+</span>' +
            '<input type="number" min="0" max="100" step="0.5" inputmode="decimal" ' +
            'value="' + (majorations[p.code] != null ? majorations[p.code] : '') + '" placeholder="0" ' +
            'aria-label="Majoration de prix pour ' + esc(p.label) + ', en pourcentage" ' +
            'onchange="window._bhMajoration(\'' + p.code + '\', this)" ' +
            'style="width:54px;padding:7px;border:1px solid ' + V.ligne + ';border-radius:8px;font-family:' + V.sans +
            ';font-size:13px;text-align:right;color:' + V.encre + ';background:#fff;">' +
            '<span style="font-size:12.5px;color:' + V.t3 + ';">%</span></span>'
          : '') +
        /* Une connexion etablie doit rester modifiable : corriger un mapping,
           remapper apres avoir renomme une annonce, verifier ce qui est
           associe. « Connecte — rien a faire » fermait la porte. */
        (ok
          ? '<span style="display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:13px;color:' + V.vertClair + ';font-weight:500;">✓</span>' +
            '<button type="button" onclick="window._bhOta(\'' + p.code + '\')" style="border:1px solid ' + V.ligne +
            ';background:#fff;color:' + V.t2 + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
            'padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;">Modifier</button></span>'
          : action) +
        '</div>';
    }).join('');

    var noteImmeuble = (!estConnecte && voisin)
      ? '<div style="background:' + V.creme + ';border:1px solid ' + V.ligne + ';border-radius:12px;padding:13px 15px;' +
        'font-size:13px;color:' + V.t2 + ';line-height:1.5;">Même adresse que <strong style="font-weight:500;color:' +
        V.encre + ';">' + esc(voisin.name || 'un logement déjà connecté') + '</strong> : ce logement sera rattaché au ' +
        'même établissement, automatiquement. Rien à saisir.</div>'
      : '';

    /* Lot 4 : sans adresse, le rattachement d'immeuble ne peut pas être déduit.
       On le dit avant la connexion, pas après. */
    var sansAdresse = !!(moi && !String(moi.address || '').trim() && !estConnecte);
    var noteAdresse = sansAdresse
      ? '<div style="background:' + V.orFond + ';border:1px solid ' + V.orFilet + ';border-radius:12px;padding:13px 15px;' +
        'display:flex;align-items:flex-start;gap:11px;">' +
        '<i class="fas fa-circle-exclamation" style="color:' + V.or + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
        '<span style="font-size:13px;color:' + V.or + ';line-height:1.5;flex:1;">Ce logement n\'a pas d\'adresse. ' +
        'Il sera traité comme un logement indépendant — s\'il fait partie d\'un immeuble déjà connecté, ' +
        'renseignez l\'adresse d\'abord pour éviter un doublon d\'établissement.</span>' +
        '<button type="button" onclick="window._bhAdresse()" style="border:1px solid ' + V.orFilet +
        ';background:#fff;color:' + V.or + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;padding:7px 12px;' +
        'border-radius:8px;cursor:pointer;white-space:nowrap;flex:none;">Ajouter l\'adresse</button></div>'
      : '';

    modal.innerHTML = carte(540,
      entete(null, 'Connecter mes plateformes', pname) +
      '<div style="padding:18px 24px;display:flex;flex-direction:column;gap:12px;">' + noteAdresse + noteImmeuble + lignes + '</div>' +
      pied(estConnecte
        ? '<button type="button" onclick="channexDisconnect(\'' + pid + '\')" style="border:0;background:transparent;' +
          'color:#C0433C;font-family:' + V.sans + ';font-size:13px;cursor:pointer;padding:8px 0;">Déconnecter ce logement</button>'
        : '<button type="button" onclick="window._bhLot()" style="border:0;background:transparent;color:' + V.vert +
          ';font-family:' + V.sans + ';font-size:13.5px;font-weight:500;cursor:pointer;padding:8px 0;text-align:left;">' +
          'Préparer tous mes logements d\'un coup →</button>',
        btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));

    window._bhRetourPerso = null;
    window._bhLot = function () { ecranLot(modal); };
    window._bhAdresse = function () {
      modal.remove();
      if (typeof openEditPropertyModal === 'function') openEditPropertyModal(pid);
      else toast("Ouvrez la fiche du logement pour renseigner l'adresse", 'info');
    };

    /* Enregistrement d'une majoration. Un PATCH par plateforme : deux
       onglets ouverts ne s'ecrasent pas. Le champ passe au vert le temps de
       confirmer, et on rappelle QUAND le prix partira — sinon l'utilisateur
       verifie sur la plateforme, ne voit rien, et recommence. */
    window._bhMajoration = async function (code, champ) {
      var val = String(champ.value || '').trim().replace(',', '.');
      var pct = val === '' ? 0 : parseFloat(val);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        champ.style.borderColor = '#C0433C';
        toast('La majoration doit être un nombre entre 0 et 100.', 'error');
        return;
      }
      champ.value = pct > 0 ? String(pct) : '';
      champ.disabled = true;
      try {
        var r = await fetch(API_URL + '/api/properties/' + pid + '/markups', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify({ code: code, pct: pct })
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Enregistrement impossible');
        majorations = d.markups || {};
        champ.style.borderColor = V.vertFilet;
        setTimeout(function () { champ.style.borderColor = V.ligne; }, 1400);
        var nom = (PLATEFORMES.find(function (x) { return x.code === code; }) || {}).label || code;
        toast(pct > 0
          ? nom + ' : +' + pct + '% — appliqué à la prochaine synchronisation des tarifs.'
          : nom + ' : majoration retirée, prix du calendrier.', 'success');
      } catch (e) {
        champ.style.borderColor = '#C0433C';
        toast(e.message, 'error');
      } finally {
        champ.disabled = false;
      }
    };

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

  /* ── mode lot : préparer tous les logements en un passage ──────────────── */
  async function ecranLot(modal) {
    modal.innerHTML = carte(420,
      '<div style="padding:40px;text-align:center;">' +
      '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
      ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
      '<div style="margin-top:14px;font-size:13px;color:' + V.t3 + ';">Lecture de vos logements…</div></div>');

    var etat;
    try {
      var r = await fetch(API_URL + '/api/channex/bulk-status', { headers: { Authorization: 'Bearer ' + token() } });
      etat = await r.json();
      if (!r.ok) throw new Error(etat.error || 'Erreur serveur');
    } catch (e) {
      modal.innerHTML = carte(460,
        entete(null, 'Mode lot indisponible', null) +
        '<div style="padding:22px 24px;font-size:14px;line-height:1.55;color:' + V.t2 + ';">' +
        'La route <code>/api/channex/bulk-status</code> n\'est pas encore installée sur le serveur. ' +
        'Une fois <code>routes/channex-bulk-routes.js</code> monté dans <code>server.js</code>, cet écran fonctionnera.' +
        '</div>' + pied('', btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));
      return;
    }

    var aPreparer = etat.a_preparer || [];
    if (!aPreparer.length) {
      modal.innerHTML = carte(460,
        entete(null, 'Tout est déjà prêt', etat.total + ' logements dans Channex') +
        '<div style="padding:22px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.55;">' +
        'Chaque logement a son établissement. Il ne reste qu\'à autoriser les plateformes, logement par logement ou établissement par établissement.</div>' +
        pied('', btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));
      return;
    }

    var lignes = aPreparer.map(function (l) {
      return '<label style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid ' + V.ligne2 + ';cursor:pointer;">' +
        '<input type="checkbox" checked data-bh-lot="' + esc(l.id) + '" style="width:17px;height:17px;accent-color:' + V.vert + ';flex:none;">' +
        '<span style="flex:1;"><span style="display:block;font-size:14px;font-weight:500;">' + esc(l.name) + '</span>' +
        '<span style="display:block;font-size:12.5px;color:' + (l.sans_adresse ? '#916018' : V.t3) + ';margin-top:2px;">' +
        (l.sans_adresse ? 'Adresse manquante — sera traité comme un logement indépendant'
          : (l.immeuble ? 'Même adresse qu\'un autre logement — sera rattaché au même établissement' : esc(l.address || ''))) +
        '</span></span></label>';
    }).join('');

    modal.innerHTML = carte(620,
      entete('En un passage', 'Préparer mes logements',
        aPreparer.length + ' logements sur ' + etat.total + ' ne sont pas encore dans Channex') +
      '<div style="padding:14px 24px;background:' + V.creme + ';border-bottom:1px solid ' + V.ligne2 +
      ';font-size:13px;color:' + V.t2 + ';line-height:1.5;">Les logements qui partagent une adresse sont regroupés ' +
      'dans un seul établissement, automatiquement. Vous n\'aurez ensuite qu\'une autorisation à donner par établissement, ' +
      'au lieu d\'une par logement.</div>' +
      '<div id="bhLotListe" style="padding:6px 24px 12px;max-height:44vh;overflow:auto;">' + lignes + '</div>' +
      pied(btnFantome('Retour', "window._bhRetourLot()"),
        btnPlein('Préparer ' + aPreparer.length + ' logements', 'window._bhLancerLot()')),
      'max-height:90vh;overflow:auto;');

    window._bhRetourLot = function () { document.getElementById('channexModal')?.remove(); };

    window._bhLancerLot = async function () {
      var ids = [].slice.call(document.querySelectorAll('[data-bh-lot]'))
        .filter(function (c) { return c.checked; })
        .map(function (c) { return c.getAttribute('data-bh-lot'); });
      if (!ids.length) return toast('Sélectionnez au moins un logement', 'warning');

      modal.innerHTML = carte(460,
        '<div style="padding:40px;text-align:center;">' +
        '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
        ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
        '<div style="margin-top:14px;font-size:13.5px;color:' + V.encre + ';">Préparation de ' + ids.length + ' logements…</div>' +
        '<div style="margin-top:6px;font-size:12.5px;color:' + V.t3 + ';">Comptez quelques secondes par logement. Ne fermez pas cette fenêtre.</div></div>');

      try {
        var rp = await fetch(API_URL + '/api/channex/bulk-prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify({ property_ids: ids })
        });
        var d = await rp.json();
        if (!rp.ok) throw new Error(d.error || 'Erreur serveur');
        if (typeof loadProperties === 'function') loadProperties().catch(function () {});
        ecranLotFini(modal, d);
      } catch (e) {
        modal.innerHTML = carte(460,
          entete(null, 'La préparation a échoué', null) +
          '<div style="padding:22px 24px;font-size:14px;color:' + V.encre + ';line-height:1.55;">' + esc(e.message) + '</div>' +
          pied('', btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));
      }
    };
  }

  function ecranLotFini(modal, d) {
    var file = [];
    var vus = [];
    (d.resultats || []).forEach(function (r) {
      if (r.channex_property_id && vus.indexOf(r.channex_property_id) === -1) {
        vus.push(r.channex_property_id);
        file.push({ id: r.id, name: r.name });
      }
    });

    var erreurs = (d.erreurs || []).map(function (e) {
      return '<div style="font-size:13px;color:#C0433C;">' + esc(e.name) + ' — à reprendre</div>';
    }).join('');

    var rangees = file.map(function (f, i) {
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid ' + V.ligne2 + ';">' +
        '<span style="font-size:14px;font-weight:500;flex:1;">' + esc(f.name) + '</span>' +
        '<button type="button" onclick="window._bhFile(' + i + ',\'ABB\')" style="border:1px solid ' + V.ligne +
        ';background:#fff;color:' + V.encre + ';font-family:' + V.sans + ';font-size:13px;padding:8px 12px;border-radius:8px;cursor:pointer;">Airbnb</button>' +
        '<button type="button" onclick="window._bhFile(' + i + ',\'BDC\')" style="border:1px solid ' + V.ligne +
        ';background:#fff;color:' + V.encre + ';font-family:' + V.sans + ';font-size:13px;padding:8px 12px;border-radius:8px;cursor:pointer;">Booking.com</button>' +
        '</div>';
    }).join('');

    modal.innerHTML = carte(620,
      entete('Terminé', 'Vos logements sont prêts',
        d.crees + ' établissements créés · ' + d.rattaches + ' logements rattachés à un immeuble existant') +
      '<div style="padding:14px 24px;background:' + V.creme + ';border-bottom:1px solid ' + V.ligne2 +
      ';font-size:13px;color:' + V.t2 + ';line-height:1.5;">Il reste ' + file.length + ' autorisation' +
      (file.length > 1 ? 's' : '') + ' à donner — une par établissement, pas une par logement. ' +
      'Choisissez la plateforme sur chaque ligne : vous revenez ici après chacune.</div>' +
      (erreurs ? '<div style="padding:12px 24px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid ' + V.ligne2 + ';">' + erreurs + '</div>' : '') +
      '<div style="padding:6px 24px 12px;max-height:44vh;overflow:auto;">' + rangees + '</div>' +
      pied('', btnFantome('Fermer', "window._bhFinirLot()")),
      'max-height:90vh;overflow:auto;');

    window._bhFinirLot = function () {
      modal.remove();
      if (typeof loadProperties === 'function') loadProperties().catch(function () {});
    };
    window._bhFile = function (i, code) {
      var f = file[i];
      window._bhRetourPerso = function () { ecranLotFini(modal, d); };
      if (code === 'BDC' && !prepFaite()) return ecranPrep(modal, f.id, f.name, code);
      lancer(modal, f.id, f.name, code);
    };
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

    var g = function (t) { return '<strong style="font-weight:500;color:' + V.encre + ';">' + t + '</strong>'; };
    /* Le parcours dans la fenetre Channex se decompose en deux parties :
       une TETE propre a chaque plateforme — la seule chose qui differe, c'est
       la facon de s'authentifier — et une QUEUE identique partout : mapper
       l'annonce, puis activer le canal. Ecrire la queue une seule fois evite
       qu'une correction n'en oublie trois.

       L'etape « Title » est commune aux quatre : un seul endroit a modifier. */
    var etapeTitre = 'Dans ' + g('Title') + ', donnez un nom à votre logement — idéalement le même que sur BoostingHost.';

    var teteCanal = {
      ABB: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Airbnb') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis descendez et cliquez sur le bouton rouge ' + g('Connect with Airbnb') + '.',
            'Autorisez la connexion sur Airbnb, puis revenez sur cette fenêtre.'],
      BDC: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Booking.com') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + ' : le numéro affiché en haut de votre extranet, à côté du nom de l\'établissement.'],
      EXP: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Expedia') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + ' : il se trouve dans les paramètres de votre logement sur ' + g('Expedia Partner Central') + '.'],
      VRB: ['Cliquez sur ' + g('Create') + '.',
            'Dans ' + g('Channel') + ', choisissez ' + g('Abritel / VRBO') + '.',
            etapeTitre,
            'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + ' : il est visible dans l\'URL de votre annonce.']
    };

    var teteGenerique = ['Cliquez sur ' + g('Create') + '.',
      'Dans ' + g('Channel') + ', choisissez ' + g(p.label) + '.',
      etapeTitre,
      'Cliquez sur ' + g('Save') + ', puis renseignez votre ' + g('Property ID') + '.'];

    /* Identique sur les quatre plateformes. La derniere etape est la plus
       couteuse a manquer : sans activation, le canal existe, le mapping est
       fait, et rien ne remonte. */
    var queueCanal = [
      'Fermez la fiche avec la croix ' + g('✕') + ' en haut à gauche, puis cliquez sur ' + g('Refresh') + ' : votre canal apparaît dans la liste.',
      'Ouvrez la ligne, allez dans l\'onglet ' + g('Mapping') + ', choisissez votre logement en face de ' + g('Not mapped') + ', puis ' + g('Save') + '.',
      'À la question ' + g('Activate Channel') + ', répondez ' + g('Save &amp; Activate') + ' — sans cette activation, le canal existe mais rien ne se synchronise.'
    ];

    var etapesFenetre = (teteCanal[code] || teteGenerique).concat(queueCanal);

    var aide = '<div style="display:flex;flex-direction:column;gap:6px;">' +
      etapesFenetre.map(function (t, i) {
        return '<div style="display:flex;gap:9px;align-items:flex-start;">' +
          '<span style="width:18px;height:18px;border-radius:50%;background:#fff;border:1px solid ' + V.ligne +
          ';color:' + V.vert + ';font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;' +
          'flex:none;margin-top:1px;">' + (i + 1) + '</span><span>' + t + '</span></div>';
      }).join('') + '</div>';

    /* Lot 1 : le nom à utiliser dans le champ Title, copiable en un clic —
       l'utilisateur ne réfléchit plus, et les noms restent alignés des deux côtés. */
    var bandeauNom = pname
      ? '<div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid ' + V.ligne +
        ';border-radius:10px;padding:9px 12px;margin-top:10px;">' +
        '<span style="font-size:12px;color:' + V.t3 + ';flex:none;">Nom à utiliser</span>' +
        '<span style="font-size:13.5px;font-weight:500;color:' + V.encre + ';flex:1;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;">' + esc(pname) + '</span>' +
        '<button type="button" id="bhCopieNom" onclick="window._bhCopierNom()" style="border:1px solid ' + V.vertFilet +
        ';background:' + V.vertPale + ';color:' + V.vert + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
        'padding:7px 12px;border-radius:8px;cursor:pointer;flex:none;">Copier</button></div>'
      : '';

    /* Airbnb refuse l'autorisation si le profil du compte est incomplet :
       une photo de profil est obligatoire. Sans elle, « Connect with Airbnb »
       renvoie sur l'onboarding Airbnb et n'y revient jamais — le client croit
       a une panne. On le dit ici, juste avant le clic concerne, et seulement
       pour Airbnb : les autres plateformes n'ont pas cette contrainte. */
    var bandeauPhoto = code === 'ABB'
      ? '<div style="display:flex;align-items:flex-start;gap:11px;background:' + V.orFond +
        ';border:1px solid ' + V.orFilet + ';border-radius:10px;padding:11px 13px;margin-top:10px;">' +
        '<i class="fas fa-circle-exclamation" style="color:' + V.or + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
        '<span style="flex:1;color:' + V.or + ';line-height:1.5;">' +
        '<strong style="font-weight:600;">Votre compte Airbnb doit avoir une photo de profil.</strong> ' +
        'Sans elle, Airbnb affiche « Complétez votre profil » au lieu de l\'écran d\'autorisation, ' +
        'et la connexion ne peut pas aboutir — même avec des annonces publiées.' +
        '</span>' +
        '<a href="https://www.airbnb.fr/account-settings/personal-info" target="_blank" rel="noopener" ' +
        'style="border:1px solid ' + V.orFilet + ';background:#fff;color:' + V.or + ';font-family:' + V.sans +
        ';font-size:12.5px;font-weight:500;padding:7px 12px;border-radius:8px;text-decoration:none;' +
        'white-space:nowrap;flex:none;">Vérifier mon profil</a></div>'
      : '';

    var cadre = function (interieur) {
      return carte(720,
        entete(p.prep ? 'Étape 2 sur 2' : 'Dernière étape', p.label, pname) +
        '<div style="padding:12px 24px;background:' + V.creme + ';border-bottom:1px solid ' + V.ligne2 + ';font-size:12.5px;' +
        'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom + bandeauPhoto +
        '<div style="margin-top:8px;color:' + V.t4 + ';">Cette fenêtre est celle de notre partenaire : elle est en anglais, c\'est normal.</div></div>' +
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

    window._bhRetour = function () {
      if (typeof window._bhRetourPerso === 'function') return window._bhRetourPerso();
      ecranPlateformes(modal, pid, pname);
    };
    window._bhCopierNom = function () {
      var b = document.getElementById('bhCopieNom');
      var fini = function () {
        if (!b) return;
        b.textContent = 'Copié ✓';
        setTimeout(function () { if (b) b.textContent = 'Copier'; }, 1800);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(pname).then(fini).catch(function () { toast('Nom : ' + pname); });
      else toast('Nom : ' + pname);
    };
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
    window._bhRetourPerso = null;
    if (channelCode) return lancer(modal, propertyId, propertyName || '', channelCode);
    return ecranPlateformes(modal, propertyId, propertyName || '');
  };

  /* Point d'entrée du mode lot, à brancher sur un bouton de la page si besoin :
     <button onclick="bhOuvrirLotOTA()">Connecter tous mes logements</button> */
  window.bhOuvrirLotOTA = function () {
    window._bhRetourPerso = null;
    ecranLot(coquille());
  };

  if (!document.getElementById('bhOtaKeyframes')) {
    var st = document.createElement('style');
    st.id = 'bhOtaKeyframes';
    st.textContent = '@keyframes bhspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
})();
