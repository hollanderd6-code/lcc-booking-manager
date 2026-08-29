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

  /* L'autorisation se donne dans l'extranet d'UN compte Booking. La retenir
     sous une cle fixe ferait croire a une agence, ou a un second utilisateur
     du meme navigateur, que l'etape est faite alors qu'elle ne l'est pas
     pour eux. La cle porte donc l'identifiant du compte. */
  function compteCourant() {
    try {
      var gere = localStorage.getItem('lcc_managed_user');
      if (gere) return 'u:' + gere;
      var sous = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
      if (sous && sous.id) return 's:' + sous.id;
      var u = JSON.parse(localStorage.getItem('lcc_user') || '{}');
      if (u && (u.id || u.email)) return 'u:' + (u.id || u.email);
    } catch (e) {}
    return 'anon';
  }

  function clePrep() { return CLE_PREP + ':' + compteCourant(); }

  function prepFaite() {
    try {
      if (localStorage.getItem(clePrep()) === '1') return true;
      /* Reprise de l'ancienne cle globale, une seule fois et pour le compte
         courant seulement : celui qui a deja fait l'etape ne la refait pas. */
      if (localStorage.getItem(CLE_PREP) === '1') {
        localStorage.setItem(clePrep(), '1');
        localStorage.removeItem(CLE_PREP);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function marquerPrep(v) {
    try { v ? localStorage.setItem(clePrep(), '1') : localStorage.removeItem(clePrep()); } catch (e) {}
  }
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


  /* ── L'etat reel du logement, avant la liste des plateformes ──────────
     « Connecte » ne veut pas dire « vendable ». Un logement peut etre relie
     a Booking et rester ferme a la reservation faute de tarifs envoyes —
     c'est arrive, et rien ne le disait. Ce bloc affiche ce que le serveur
     constate, avec l'action qui repare a cote. */
  function renduSante(d) {
    if (!d || !d.points || !d.points.length) return '';
    if (d.vendable) {
      return '<div style="background:' + V.vertPale + ';border:1px solid ' + V.vertFilet + ';border-radius:12px;' +
        'padding:13px 15px;display:flex;align-items:center;gap:11px;">' +
        '<span style="color:' + V.vertClair + ';font-size:14px;flex:none;">\u2713</span>' +
        '<span style="font-size:13px;color:' + V.vert + ';line-height:1.5;">' +
        '<strong style="font-weight:600;">Ce logement est ouvert a la vente.</strong> ' +
        'Calendrier et tarifs sont partis vers vos plateformes.</span></div>';
    }

    var lignes = d.points.map(function (pt) {
      var couleur = pt.ok ? '#2E8B62' : V.or;
      var quand = pt.quand
        ? '<span style="display:block;font-size:11.5px;color:' + V.t4 + ';margin-top:2px;">' +
          esc(new Date(pt.quand).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })) + '</span>'
        : '';
      var bouton = '';
      if (!pt.ok && pt.action) {
        var libelle = pt.action === 'prix' ? 'Fixer mon prix'
          : pt.action === 'stripe' ? 'Verifier le compte'
          : 'Envoyer maintenant';
        bouton = '<button type="button" onclick="window._bhSante(\'' + pt.action + '\')" ' +
          'style="border:1px solid ' + V.orFilet + ';background:#fff;color:' + V.or + ';font-family:' + V.sans + ';' +
          'font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;flex:none;">' +
          libelle + '</button>';
      }
      return '<div style="display:flex;align-items:flex-start;gap:11px;padding:11px 0;border-bottom:1px solid ' + V.ligne2 + ';">' +
        '<span style="color:' + couleur + ';font-size:13px;flex:none;margin-top:2px;">' + (pt.ok ? '\u2713' : '\u2715') + '</span>' +
        '<span style="flex:1;">' +
        '<span style="display:block;font-size:13.5px;font-weight:' + (pt.ok ? '400' : '600') + ';color:' + V.encre + ';">' + esc(pt.titre) + '</span>' +
        (pt.details ? '<span style="display:block;font-size:12.5px;color:' + V.or + ';margin-top:3px;line-height:1.5;">' + esc(pt.details) + '</span>' : '') +
        quand + '</span>' + bouton + '</div>';
    }).join('');

    return '<div style="background:#fff;border:1px solid ' + V.orFilet + ';border-radius:12px;overflow:hidden;">' +
      '<div style="padding:13px 15px 4px;">' +
      '<span style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:' + V.or + ';">' +
      (d.a_regler > 1 ? d.a_regler + ' choses a regler' : 'Une chose a regler') + '</span></div>' +
      '<div style="padding:0 15px 6px;">' + lignes + '</div></div>';
  }

  /* Les actions de reparation. « Envoyer » couvre calendrier et tarifs :
     les deux partent ensemble, et l'utilisateur n'a pas a savoir lequel
     manquait. */
  window._bhSante = async function (action) {
    if (action === 'prix') {
      document.getElementById('channexModal')?.remove();
      if (typeof openEditPropertyModal === 'function') openEditPropertyModal(window._bhSantePid);
      return;
    }
    if (action === 'stripe') { window.location.href = '/settings-account.html'; return; }
    if (typeof window._bhEnvoyerTout === 'function') window._bhEnvoyerTout();
  };
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

    /* L'etat reel avant la liste : « connecte » ne veut pas dire « vendable ». */
    window._bhSantePid = pid;
    var blocSante = '';
    try {
      var rSante = await fetch(API_URL + '/api/properties/' + pid + '/sante',
        { headers: { Authorization: 'Bearer ' + token() } });
      if (rSante.ok) blocSante = renduSante(await rSante.json());
    } catch (eSante) {}
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
            'class="bhMajChamp" style="width:68px;padding:7px 6px;border:1px solid ' + V.ligne + ';border-radius:8px;font-family:' + V.sans +
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
        '<span style="font-size:13px;color:' + V.or + ';line-height:1.5;flex:1;">' +
        '<strong style="font-weight:600;">Adresse requise avant connexion.</strong> ' +
        'C\'est elle qui permet de reconnaître les logements d\'un même immeuble, ' +
        'qui doivent partager un seul établissement chez la plateforme.</span>' +
        '<button type="button" onclick="window._bhAdresse()" style="border:1px solid ' + V.orFilet +
        ';background:#fff;color:' + V.or + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;padding:7px 12px;' +
        'border-radius:8px;cursor:pointer;white-space:nowrap;flex:none;">Ajouter l\'adresse</button></div>'
      : '';

    /* Meme adresse qu'un autre logement, mais etablissement different chez le
       partenaire : Booking.com refusera le second. On le detecte et on propose
       le rattachement, au lieu de laisser deviner qu'une deconnexion est la
       solution. La route sert aussi de test de disponibilite. */
    var noteRegroupement = '';
    try {
      var rReg = await fetch(API_URL + '/api/properties/' + pid + '/regroupement',
        { headers: { Authorization: 'Bearer ' + token() } });
      if (rReg.ok) {
        var dReg = await rReg.json();
        if (!dReg.deja_groupe && dReg.candidats && dReg.candidats.length) {
          var c0 = dReg.candidats[0];
          window._bhRegCible = c0.id;

          // Ce qui sera casse. null = la liste n'a pas pu etre lue : on le dit,
          // plutot que de laisser croire qu'il n'y a rien a refaire.
          var coutRemap = dReg.a_remapper === null
            ? 'Les plateformes déjà connectées sur ce logement devront être remappées (liste indisponible).'
            : (dReg.a_remapper.length
                ? 'À remapper ensuite : ' + dReg.a_remapper.map(function (x) { return esc(x.titre); }).join(', ') + '.'
                : 'Aucune plateforme n\'est encore mappée sur ce logement : rien à refaire.');

          var coutResa = dReg.reservations_a_venir > 0
            ? '<span style="display:block;margin-top:6px;color:' + V.or + ';font-weight:500;">' +
              dReg.reservations_a_venir + ' réservation' + (dReg.reservations_a_venir > 1 ? 's' : '') +
              ' à venir sur ce logement — traitez-les avant.</span>'
            : '';

          noteRegroupement =
            '<div style="background:' + V.orFond + ';border:1px solid ' + V.orFilet + ';border-radius:12px;' +
            'padding:13px 15px;display:flex;align-items:flex-start;gap:11px;">' +
            '<i class="fas fa-building" style="color:' + V.or + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
            '<span style="flex:1;font-size:13px;color:' + V.or + ';line-height:1.5;">' +
            '<strong style="font-weight:600;">Même adresse que ' + esc(c0.nom) + ', mais établissement séparé.</strong> ' +
            'Booking.com refusera ce logement : l\'identifiant de l\'établissement n\'est utilisable qu\'une fois. ' +
            'Rattachez-le pour qu\'ils partagent le même. ' + coutRemap + coutResa +
            '</span>' +
            '<button type="button" onclick="window._bhRegrouper()" style="border:1px solid ' + V.orFilet +
            ';background:#fff;color:' + V.or + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
            'padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;flex:none;">Rattacher</button></div>';
        }
      }
    } catch (eReg) {}

    modal.innerHTML = carte(540,
      entete(null, 'Connecter mes plateformes', pname) +
      '<div style="padding:18px 24px;display:flex;flex-direction:column;gap:12px;">' + blocSante + noteAdresse + noteRegroupement + noteImmeuble + lignes + '</div>' +
      pied(estConnecte
        ? '<button type="button" onclick="channexDisconnect(\'' + pid + '\')" style="border:0;background:transparent;' +
          'color:#C0433C;font-family:' + V.sans + ';font-size:13px;cursor:pointer;padding:8px 0;">Déconnecter ce logement</button>'
        : '<button type="button" onclick="window._bhLot()" style="border:0;background:transparent;color:' + V.vert +
          ';font-family:' + V.sans + ';font-size:13.5px;font-weight:500;cursor:pointer;padding:8px 0;text-align:left;">' +
          'Préparer tous mes logements d\'un coup →</button>',
        /* Un logement connecte mais jamais synchronise reste ferme a la vente
           chez le partenaire. Ce bouton est le seul moyen de le debloquer. */
        estConnecte
          ? btnPlein('Envoyer vers les plateformes', 'window._bhEnvoyer()')
          : btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));

    window._bhRetourPerso = null;
    window._bhLot = function () { ecranLot(modal); };
    window._bhRegrouper = async function () {
      var cible = window._bhRegCible;
      if (!cible) return;
      modal.innerHTML = carte(420,
        '<div style="padding:40px;text-align:center;">' +
        '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
        ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
        '<div style="margin-top:14px;font-size:13.5px;color:' + V.encre + ';">Rattachement en cours…</div>' +
        '<div style="margin-top:6px;font-size:12.5px;color:' + V.t3 + ';">Ne fermez pas cette fenêtre.</div></div>');
      try {
        var r = await fetch(API_URL + '/api/properties/' + pid + '/regroupement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify({ cible_property_id: cible })
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Rattachement impossible');
        if (typeof loadProperties === 'function') loadProperties().catch(function () {});
        modal.innerHTML = carte(480,
          entete(null, 'Rattaché à l\'immeuble', esc(d.immeuble_de || '')) +
          '<div style="padding:22px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.6;">' +
          esc(d.message || '') + '</div>' +
          /* Un logement fraichement rattache n'a aucune disponibilite sous son
             nouvel etablissement : sans cet envoi il resterait « Tarif fermé ». */
          pied(btnFantome('Plus tard', 'window._bhRetourPlateformes()'),
            btnPlein('Envoyer les disponibilités', 'window._bhEnvoyer()')));
        window._bhRetourPlateformes = function () { ecranPlateformes(modal, pid, pname); };
      } catch (e) {
        modal.innerHTML = carte(480,
          entete(null, 'Le rattachement n\'a pas abouti', null) +
          '<div style="padding:22px 24px;font-size:14px;color:' + V.encre + ';line-height:1.6;">' +
          esc(e.message) + '</div>' +
          pied('', btnFantome('Retour', 'window._bhRetourPlateformes()')));
        window._bhRetourPlateformes = function () { ecranPlateformes(modal, pid, pname); };
      }
    };

    /* La sequence de fin de connexion. Sans elle, un logement mappe chez le
       partenaire reste « Tarif fermé » : il est visible mais ferme a la vente,
       faute de disponibilites envoyees. */
    /* Calendrier ET tarifs. La sequence _bhEnvoyer ci-dessous importe les
       reservations puis pousse les disponibilites, mais jamais les tarifs :
       or un logement sans tarif reste ferme a la vente, ce que rien
       n'indiquait. */
    window._bhEnvoyerTout = async function () {
      modal.innerHTML = carte(430,
        '<div style="padding:38px 30px;text-align:center;">' +
        '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne +
        ';border-top-color:' + V.vert + ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
        '<div style="margin-top:16px;font-size:14px;color:' + V.encre + ';">Envoi du calendrier et des tarifs\u2026</div>' +
        '<div style="margin-top:6px;font-size:12.5px;color:' + V.t3 + ';">Ne fermez pas cette fen\u00eatre.</div></div>');
      var appel = function (url) {
        return fetch(API_URL + url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: '{}'
        }).then(function (r) { return { ok: r.ok, statut: r.status }; })
          .catch(function () { return { ok: false, statut: 0 }; });
      };
      var dispo = await appel('/api/channex/push-availability/' + pid);
      var tarifs = await appel('/api/pricing/rules/push-channex/' + pid);
      var bilan = [];
      bilan.push(dispo.ok ? 'calendrier envoy\u00e9' : 'calendrier : \u00e9chec');
      bilan.push(tarifs.ok ? 'tarifs envoy\u00e9s'
        : (tarifs.statut === 403 ? 'tarifs non envoy\u00e9s (droit \u00ab gestion des prix \u00bb requis)' : 'tarifs : \u00e9chec'));
      var toutOk = dispo.ok && tarifs.ok;
      modal.innerHTML = carte(470,
        entete(null, toutOk ? 'C\'est parti' : 'Envoi incomplet', esc(pname)) +
        '<div style="padding:20px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.65;">' +
        esc(bilan.join(' \u00b7 ')) +
        (toutOk ? '<span style="display:block;margin-top:10px;">Comptez quelques minutes avant que les plateformes ouvrent les dates.</span>' : '') +
        '</div>' +
        pied('', btnPlein('Revoir l\'\u00e9tat', 'window._bhRevoirSante()')));
      window._bhRevoirSante = function () { ecranPlateformes(modal, pid, pname); };
      if (typeof loadProperties === 'function') loadProperties().catch(function () {});
    };
    window._bhEnvoyer = async function () {
      var etapes = [
        'Connexion à la plateforme…',
        'Récupération des réservations existantes…',
        'Import des réservations dans BoostingHost…',
        'Envoi des disponibilités et des tarifs…'
      ];
      var n = 0;

      var afficher = function (texte, sousTexte) {
        modal.innerHTML = carte(440,
          '<div style="padding:38px 30px;text-align:center;">' +
          '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne +
          ';border-top-color:' + V.vert + ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
          '<div style="margin-top:16px;font-size:14px;color:' + V.encre + ';">' + esc(texte) + '</div>' +
          '<div style="margin-top:6px;font-size:12.5px;color:' + V.t3 + ';">' +
          esc(sousTexte || 'Ne fermez pas cette fenêtre.') + '</div>' +
          '<div style="margin-top:14px;font-size:11.5px;color:' + V.t4 + ';font-variant-numeric:tabular-nums;">' +
          'Étape ' + (n) + ' sur ' + etapes.length + '</div></div>');
      };

      var appel = function (chemin) {
        return fetch(API_URL + '/api/channex/' + chemin + '/' + pid, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token() }
        }).then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
          .catch(function () { return null; });
      };

      n = 1; afficher(etapes[0]);
      await appel('pull-bookings');

      n = 2; afficher(etapes[1], 'La plateforme peut mettre quelques secondes à répondre.');
      // Sans cette attente, sync-bookings arrive avant la reponse de la
      // plateforme et n'importe rien.
      await new Promise(function (r) { setTimeout(r, 8000); });

      n = 3; afficher(etapes[2]);
      var dSync = await appel('sync-bookings');

      n = 4; afficher(etapes[3], 'Cinq cents jours de calendrier sont envoyés.');
      var dDispo = await appel('push-availability');

      var importees = dSync ? ((dSync.imported || 0) + (dSync.updated || 0)) : 0;
      var echecDispo = dDispo === null;

      modal.innerHTML = carte(460,
        entete(null, echecDispo ? 'Envoi incomplet' : 'Disponibilités envoyées', esc(pname)) +
        '<div style="padding:20px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.65;">' +
        (echecDispo
          ? 'Les réservations ont été relevées, mais l\'envoi des disponibilités a échoué. ' +
            'Le logement restera fermé à la vente sur les plateformes tant qu\'il n\'aura pas abouti — ' +
            'réessayez dans quelques minutes.'
          : 'Le calendrier des 500 prochains jours est parti vers vos plateformes. ' +
            'Comptez quelques minutes avant de voir les dates s\'ouvrir dans leur extranet.') +
        (importees
          ? '<span style="display:block;margin-top:10px;color:' + V.encre + ';">' +
            importees + ' réservation' + (importees > 1 ? 's' : '') + ' importée' + (importees > 1 ? 's' : '') +
            ' depuis les plateformes.</span>'
          : '<span style="display:block;margin-top:10px;color:' + V.t3 + ';">Aucune réservation à importer.</span>') +
        '</div>' +
        pied('', btnPlein('Terminer', "document.getElementById('channexModal')?.remove()")));

      if (typeof loadProperties === 'function') loadProperties().catch(function () {});
    };

    window._bhAdresseRequise = function () {
      modal.innerHTML = carte(500,
        entete(null, 'Renseignez l\'adresse d\'abord', esc(pname)) +
        '<div style="padding:22px 24px;display:flex;flex-direction:column;gap:14px;">' +
        '<div style="font-size:14px;line-height:1.6;color:' + V.encre + ';">' +
        'Les logements d\'un meme immeuble doivent partager un seul etablissement chez ' +
        'la plateforme, et c\'est l\'adresse qui permet de les reconnaitre.</div>' +
        '<div style="font-size:13px;line-height:1.6;color:' + V.t2 + ';background:' + V.creme +
        ';border-radius:12px;padding:14px 16px;">Sans elle, ce logement serait declare separement. ' +
        'Booking.com refuserait alors son identifiant, deja utilise par le premier logement de ' +
        'l\'immeuble, et il faudrait tout reprendre : detacher, rattacher, puis remapper chaque plateforme.</div>' +
        '<div style="font-size:12.5px;color:' + V.t4 + ';">Si ce logement est bien independant, ' +
        'renseignez tout de meme son adresse : elle sert aussi aux voyageurs.</div>' +
        '</div>' +
        pied(btnFantome('Plus tard', "document.getElementById('channexModal')?.remove()"),
          btnPlein('Renseigner l\'adresse', 'window._bhAdresse()')));
    };

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
      /* Sans adresse, le regroupement d'immeuble ne peut pas etre deduit et
         un etablissement separe serait cree. Le reparer ensuite coute un
         detachement, un rattachement et un remappage de chaque plateforme.
         On demande l'adresse maintenant. */
      if (sansAdresse) return window._bhAdresseRequise();
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
      'Cherchez <strong style="font-weight:500;">Channex</strong> — le nom de notre fournisseur de connectivité chez Booking.com — puis cliquez sur <strong style="font-weight:500;">Accepter</strong>.',
      'Notez votre <strong style="font-weight:500;">Property ID</strong> : le numéro affiché en haut, à côté du nom de votre établissement.'
    ].map(function (t, i) {
      return '<div style="display:flex;gap:12px;align-items:flex-start;">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:#E4EDE8;color:' + V.vert + ';font-size:12px;' +
        'font-weight:700;display:flex;align-items:center;justify-content:center;flex:none;">' + (i + 1) + '</span>' +
        '<span style="font-size:14px;line-height:1.5;">' + t + '</span></div>';
    }).join('');

    modal.innerHTML = carte(560,
      entete('Étape 1 sur 2 · une seule fois', 'Autoriser la connexion chez Booking.com',
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
      '<span><span style="display:block;font-size:14px;font-weight:500;">C\'est fait — la connexion est autorisée dans mon extranet.</span>' +
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
      /* Deux situations tombaient ici : « tout est pret » et « rien n'a ete lu ».
         Le test « la liste a preparer est vide » est vrai dans les deux, d'ou
         l'ecran contradictoire « Tout est déjà prêt · 0 logements ». Un zero
         n'est pas une reussite : on distingue, et on dit quoi faire. */
      var rienDeLu = !etat.total;
      var n = etat.total || 0;
      modal.innerHTML = carte(460,
        entete(null,
          rienDeLu ? 'Préparation groupée indisponible' : 'Tout est déjà prêt',
          rienDeLu ? null : n + (n > 1 ? ' logements prêts' : ' logement prêt')) +
        '<div style="padding:22px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.6;">' +
        (rienDeLu
          ? 'Vos logements n\'ont pas pu être relevés ici — ce n\'est pas une erreur de votre part. ' +
            'Connectez vos plateformes depuis la fiche de chaque logement : le résultat est le même, ' +
            'cela demande simplement un passage par logement.'
          : 'Chaque logement est prêt. Il ne reste qu\'à autoriser les plateformes, ' +
            'logement par logement ou immeuble par immeuble.') +
        '</div>' +
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
        aPreparer.length + (aPreparer.length > 1 ? ' logements' : ' logement') + ' à préparer sur ' + etat.total) +
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
  /* ── Rattacher a l'etablissement voisin ? On demande. ──────────────────
     Deux logements a la meme adresse ne sont pas forcement deux chambres du
     meme etablissement. Jusqu'ici le rattachement etait AUTOMATIQUE des que
     l'adresse coincidait, et l'utilisateur l'apprenait par un message une
     fois le fait accompli.

     Les consequences sont lourdes et invisibles : les deux logements
     partagent alors une seule property Channex, et Channex mappe le nouveau
     room type sur TOUS les canaux deja branches sur cette property. Un gite
     connecte a Booking seul se retrouve ainsi annonce sur Airbnb.

     Le defaut est desormais « logements independants » — le cas courant.
     Le rattachement reste possible, mais il se choisit. */
  /* ── La question d'immeuble, posee au bon moment ──────────────────────
     Deux logements a la meme adresse ne sont pas forcement deux chambres du
     meme etablissement. Le rattachement etait autrefois automatique, et
     l'utilisateur l'apprenait une fois le fait accompli.

     La consequence est desormais ecrite DANS l'option, pas en note de bas
     de page, et elle nomme les plateformes reelles du voisin : « sera aussi
     mise en vente sur Airbnb » se comprend, « les canaux seront partages »
     non. C'est exactement ce qui a mis Airbnb sur une longere qui n'y
     etait pas. */
  async function plateformesDuVoisin(voisin) {
    var id = voisin && (voisin.id || voisin._id);
    if (!id) return [];
    try {
      var r = await fetch(API_URL + '/api/channex/connected-channels/' + id + '?bh_property_id=' + id,
        { headers: { Authorization: 'Bearer ' + token() } });
      if (!r.ok) return [];
      var d = await r.json();
      var noms = { airbnb: 'Airbnb', bookingcom: 'Booking.com', expedia: 'Expedia', vrbo: 'Abritel' };
      return (d.channels || []).map(function (c) { return noms[String(c.channel || '').toLowerCase()]; })
        .filter(function (x, i, t) { return x && t.indexOf(x) === i; });
    } catch (e) { return []; }   // sans la liste, on reste general plutot que faux
  }

  function enumerer(liste) {
    if (liste.length === 1) return liste[0];
    return liste.slice(0, -1).join(', ') + ' et ' + liste[liste.length - 1];
  }

  function demanderRattachement(modal, moi, voisin) {
    return new Promise(function (resoudre) {
      var nomVoisin = esc(voisin.name || 'votre autre logement');
      var nomMoi = esc((moi && moi.name) || 'ce logement');

      var fini = false;
      var veille = null;
      var repondre = function (valeur) {
        if (fini) return;
        fini = true;
        if (veille) clearInterval(veille);
        resoudre(valeur);
      };

      var peindre = function (plateformes) {
        // L'avertissement n'apparait que s'il y a quelque chose a perdre :
        // un voisin sans plateforme connectee ne fait courir aucun risque.
        var alerte = plateformes.length
          ? '<div style="font-size:12.5px;line-height:1.5;color:#8A5B14;margin-top:8px;background:' + V.orFond +
            ';border-radius:8px;padding:9px 11px;">Attention : ' + nomMoi + ' sera aussi mise en vente sur ' +
            esc(enumerer(plateformes)) + ', o\u00f9 ' + nomVoisin + ' est d\u00e9j\u00e0 pr\u00e9sente.</div>'
          : '';

        var option = function (id, titre, texte, courant, sous) {
          return '<button type="button" id="' + id + '" style="width:100%;text-align:left;cursor:pointer;' +
            'background:' + (courant ? V.vertPale : '#fff') + ';border:1.5px solid ' + (courant ? V.vertFilet : V.ligne) +
            ';border-radius:13px;padding:15px 16px;margin-bottom:10px;font-family:inherit;display:block;">' +
            '<div style="display:flex;align-items:center;gap:9px;">' +
            '<span style="font-size:14.5px;font-weight:600;color:' + V.encre + ';">' + titre + '</span>' +
            (courant ? '<span style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' +
              V.vert + ';background:#fff;border-radius:99px;padding:3px 9px;">Le plus courant</span>' : '') +
            '</div>' +
            '<div style="font-size:13px;line-height:1.55;color:' + V.t2 + ';margin-top:6px;">' + texte + '</div>' +
            (sous || '') + '</button>';
        };

        modal.innerHTML = carte(500,
          entete('Une question avant de brancher',
                 nomMoi + ' partage son adresse avec ' + nomVoisin, null) +
          '<div style="padding:18px 22px 20px;">' +
          option('bh-rat-independant', 'Deux logements s\u00e9par\u00e9s',
                 'Deux g\u00eetes, deux annonces, deux calendriers. Chacun ses plateformes et ses tarifs.', true) +
          option('bh-rat-immeuble', 'Deux chambres du m\u00eame \u00e9tablissement',
                 'Un h\u00f4tel, une r\u00e9sidence. Vos annonces partagent d\u00e9j\u00e0 le m\u00eame num\u00e9ro chez Booking.com.',
                 false, alerte) +
          '<div style="text-align:center;margin-top:4px;">' +
          '<button type="button" id="bh-rat-annuler" style="background:none;border:none;cursor:pointer;' +
          'font-family:inherit;font-size:12.5px;color:' + V.t3 + ';padding:8px 12px;">Annuler</button>' +
          '</div></div>');

        // Fermer par la croix vaut annulation : sans cela, la connexion
        // resterait suspendue sans que rien ne l'indique.
        if (veille) clearInterval(veille);
        veille = setInterval(function () { if (!modal.isConnected) repondre(null); }, 300);

        var brancher = function (id, valeur) {
          var b = modal.querySelector('#' + id);
          if (b) b.onclick = function () { repondre(valeur); };
        };
        brancher('bh-rat-independant', false);
        brancher('bh-rat-immeuble', true);
        brancher('bh-rat-annuler', null);
      };

      // On peint tout de suite avec ce qu'on sait, puis on enrichit des que
      // les plateformes du voisin sont connues : l'ecran ne reste jamais vide
      // en attendant le reseau.
      peindre([]);
      plateformesDuVoisin(voisin).then(function (liste) {
        if (!fini && liste.length) peindre(liste);
      });
    });
  }

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

      /* Le rattachement n'est plus automatique. Voir demanderRattachement :
         partager une adresse ne veut pas dire partager un etablissement, et
         le rattachement embarque le logement sur toutes les plateformes du
         voisin. */
      var rattacher = false;
      if (voisin) {
        rattacher = await demanderRattachement(modal, moi, voisin);
        if (rattacher === null) { if (modal.isConnected) modal.remove(); return; }
        modal.innerHTML = carte(420,
          '<div style="padding:40px;text-align:center;">' +
          '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
          ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
          '<div style="margin-top:14px;font-size:13px;color:' + V.t3 + ';">Préparation de la connexion…</div></div>');
      }

      var corps = { property_id: pid };
      if (voisin && rattacher) corps.channex_property_id = voisin.channexPropertyId || voisin.channex_property_id;
      try {
        var r = await fetch(API_URL + '/api/channex/connect-property', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify(corps)
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Erreur activation');
        if (voisin && rattacher) toast('Rattaché au même établissement que ' + (voisin.name || 'votre autre logement') + '.', 'success');
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

    /* Deuxieme logement d'un meme immeuble : le canal existe deja au niveau de
       l'etablissement. Cliquer sur « Create » echoue — Booking.com refuse un
       identifiant d'etablissement deja utilise, parce que 9001519 designe
       l'IMMEUBLE et 900151901 / 900151902 les logements qu'il contient.
       Dans ce cas il ne faut pas creer un canal, mais mapper ce logement
       dans le canal existant. */
    var frereImmeuble = voisinConnecte(pid);
    var canalDejaSurImmeuble = false;
    if (frereImmeuble) {
      try {
        var fid = frereImmeuble.id || frereImmeuble._id;
        var rFrere = await fetch(API_URL + '/api/channex/connected-channels/' + fid + '?bh_property_id=' + fid,
          { headers: { Authorization: 'Bearer ' + token() } });
        if (rFrere.ok) {
          var dFrere = await rFrere.json();
          canalDejaSurImmeuble = (dFrere.channels || []).some(function (c) {
            var s = String(c.channel || '').toLowerCase();
            return s === p.cle || s.indexOf(p.cle) > -1 ||
                   (p.cle === 'booking' && s.indexOf('bdc') > -1) ||
                   (p.cle === 'airbnb' && s === 'abb');
          });
        }
      } catch (eFrere) {}
    }

    var etapesFenetre = canalDejaSurImmeuble
      ? ['Ne cliquez ' + g('pas') + ' sur ' + g('Create') + ' : le canal ' + g(p.label) +
           ' existe déjà pour cet immeuble.',
         'Ouvrez la ligne ' + g(p.label) + ' déjà présente dans la liste.',
         'Allez dans l\'onglet ' + g('Mapping') + '.',
         'En face de ' + g('Not mapped') + ', choisissez ce logement — côté ' + p.label +
           ', son identifiant est celui de l\'immeuble suivi de deux chiffres propres au logement.',
         'Cliquez sur ' + g('Save') + ', puis répondez ' + g('Save &amp; Activate') +
           ' — sans cette activation, rien ne se synchronise.']
      : (teteCanal[code] || teteGenerique).concat(queueCanal);

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

    /* Le mur le plus couteux du parcours : reutiliser l'identifiant de
       l'etablissement pour un second logement. On explique la difference
       AVANT la saisie, pas apres le refus. */
    var bandeauImmeuble = canalDejaSurImmeuble
      ? '<div style="display:flex;align-items:flex-start;gap:11px;background:' + V.creme +
        ';border:1px solid ' + V.ligne + ';border-radius:10px;padding:11px 13px;margin-top:10px;">' +
        '<i class="fas fa-building" style="color:' + V.t2 + ';font-size:14px;margin-top:2px;flex:none;"></i>' +
        '<span style="flex:1;color:' + V.t2 + ';line-height:1.5;">' +
        '<strong style="font-weight:600;color:' + V.encre + ';">Même immeuble que ' +
        esc(frereImmeuble ? (frereImmeuble.name || 'votre autre logement') : 'votre autre logement') +
        '.</strong> Ne ressaisissez pas l\'identifiant de l\'établissement : il n\'est utilisable ' +
        'qu\'une fois. Ce logement se rattache en le mappant dans le canal déjà créé.' +
        '</span></div>'
      : '';

    var cadre = function (interieur) {
      return carte(720,
        entete(p.prep ? 'Étape 2 sur 2' : 'Dernière étape', p.label, pname) +
        '<div style="padding:12px 24px;background:' + V.creme + ';border-bottom:1px solid ' + V.ligne2 + ';font-size:12.5px;' +
        'color:' + V.t2 + ';line-height:1.5;">' + aide + bandeauNom + bandeauImmeuble + bandeauPhoto +
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
    st.textContent = '@keyframes bhspin{to{transform:rotate(360deg)}}' +
      /* Les fleches d'un input number mangent la moitie de la largeur
         utile : sans elles, « 15 » tient sans etre coupe. */
      '.bhMajChamp{-moz-appearance:textfield;appearance:textfield;}' +
      '.bhMajChamp::-webkit-outer-spin-button,.bhMajChamp::-webkit-inner-spin-button' +
      '{-webkit-appearance:none;appearance:none;margin:0;}';
    document.head.appendChild(st);
  }
})();
