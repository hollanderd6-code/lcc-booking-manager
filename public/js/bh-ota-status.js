/* ============================================================================
   BH-OTA-STATUS — l'état des plateformes, visible sans ouvrir de modale
   ============================================================================
   INSTALLATION — dans public/settings.html, après bh-ota-connect.js :

     <script src="/js/bh-ota-status.js"></script>

   Insère un panneau au-dessus de la grille des logements (#propertiesGrid) :
   une ligne par plateforme, avec le nombre de logements connectés sur le
   total, ce qui reste à faire, et un bouton qui ouvre le mode lot.

   Aucune route nouvelle : on interroge /api/channex/connected-channels pour
   chaque logement déjà dans Channex — le même appel que les badges des cartes,
   avec 4 requêtes en parallèle au maximum et un cache mémoire de 3 minutes.

   Deux règles de lecture, volontaires :
   — « 22 / 25 » quand la plateforme est utilisée quelque part.
   — « — · Jamais connectée » quand elle ne l'est nulle part : un zéro laisse
     croire à un échec, le tiret dit qu'on n'a pas essayé.
   ========================================================================== */
(function () {
  'use strict';

  var V = {
    vert: '#0E3B2E', vertClair: '#1E6E52', vertPale: '#F1F6F3', vertFilet: '#A8CDBE',
    encre: '#20221F', t2: '#5A5A54', t3: '#6A6A64', t4: '#878782',
    ligne: '#EAE9E5', ligne2: '#F1F0EC', cote: '#F7F7F5',
    serif: "'Instrument Serif',Georgia,serif",
    sans: "'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  };

  var PLATEFORMES = [
    { cle: 'airbnb', label: 'Airbnb', couleur: '#FF5A5F', fond: '#FFF1F0', filet: '#FFD6D4',
      icone: '<i class="fa-brands fa-airbnb" style="font-size:16px;"></i>', codes: ['airbnb', 'abb'] },
    { cle: 'booking', label: 'Booking.com', couleur: '#003580', fond: '#F0F4FF', filet: '#C7D7F9',
      icone: '<i class="fas fa-building" style="font-size:14px;"></i>', codes: ['booking', 'bdc'] },
    { cle: 'expedia', label: 'Expedia', couleur: '#1B5E96', fond: '#F0F6FF', filet: '#C5DAF7',
      icone: '<i class="fas fa-plane" style="font-size:13px;"></i>', codes: ['expedia', 'exp'] },
    { cle: 'vrbo', label: 'Abritel / VRBO', couleur: '#1C61A5', fond: '#F0F5FF', filet: '#C9DCF7',
      icone: '<i class="fas fa-home" style="font-size:13px;"></i>', codes: ['vrbo', 'vrb', 'homeaway', 'abritel'] }
  ];

  var cache = { at: 0, parPlateforme: null };
  var enCours = false;

  function token() { try { return localStorage.getItem('lcc_token'); } catch (e) { return null; } }
  function logements() { return window.allProperties || []; }

  async function enFile(taches, largeur) {
    var i = 0, resultats = [];
    async function ouvrier() {
      while (i < taches.length) {
        var n = i++;
        try { resultats[n] = await taches[n](); } catch (e) { resultats[n] = null; }
      }
    }
    await Promise.all(new Array(Math.min(largeur, taches.length)).fill(0).map(ouvrier));
    return resultats;
  }

  async function compter() {
    if (cache.parPlateforme && Date.now() - cache.at < 180000) return cache.parPlateforme;

    var prets = logements().filter(function (p) {
      return (p.channexEnabled || p.channex_enabled) && (p.channexPropertyId || p.channex_property_id);
    });

    var reponses = await enFile(prets.map(function (p) {
      return async function () {
        var id = p.id || p._id;
        var r = await fetch(API_URL + '/api/channex/connected-channels/' + id + '?bh_property_id=' + id,
          { headers: { Authorization: 'Bearer ' + token() } });
        var d = await r.json();
        return (d.channels || []).map(function (c) { return String(c.channel || '').toLowerCase(); });
      };
    }), 4);

    var parPlateforme = {};
    PLATEFORMES.forEach(function (pf) {
      parPlateforme[pf.cle] = reponses.filter(function (canaux) {
        return canaux && canaux.some(function (c) {
          return pf.codes.some(function (code) { return c === code || c.indexOf(code) > -1; });
        });
      }).length;
    });

    cache = { at: Date.now(), parPlateforme: parPlateforme };
    return parPlateforme;
  }

  function ligne(pf, connectes, total) {
    var restants = Math.max(0, total - connectes);
    var jamais = connectes === 0;
    var compteur = jamais ? '—' : connectes + ' / ' + total;
    var detail = jamais ? 'Jamais connectée'
      : (restants ? restants + ' logement' + (restants > 1 ? 's' : '') + ' à connecter' : 'Tous vos logements sont connectés');

    return '<div style="display:grid;grid-template-columns:34px 1fr auto auto;align-items:center;gap:14px;' +
      'padding:13px 20px;border-bottom:1px solid ' + V.ligne2 + ';">' +
      '<span style="width:30px;height:30px;border-radius:8px;background:' + pf.fond + ';border:1px solid ' + pf.filet +
      ';color:' + pf.couleur + ';display:flex;align-items:center;justify-content:center;">' + pf.icone + '</span>' +
      '<span><span style="display:block;font-size:14px;font-weight:600;color:' + V.encre + ';">' + pf.label + '</span>' +
      '<span style="display:block;font-size:12.5px;color:' + (jamais ? V.t4 : V.t3) + ';margin-top:2px;">' + detail + '</span></span>' +
      '<span style="font-size:14px;font-weight:600;color:' + (jamais ? V.t4 : (restants ? V.encre : V.vertClair)) +
      ';font-variant-numeric:tabular-nums;">' + compteur + '</span>' +
      (restants
        ? '<button type="button" onclick="bhOuvrirLotOTA&&bhOuvrirLotOTA()" style="border:1px solid ' + V.vertFilet +
          ';background:' + V.vertPale + ';color:' + V.vert + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
          'padding:7px 13px;border-radius:8px;cursor:pointer;white-space:nowrap;">Connecter</button>'
        : '<span style="font-size:13px;color:' + V.vertClair + ';">✓</span>') +
      '</div>';
  }

  function coquille(interieur) {
    return '<div style="background:#fff;border:1px solid ' + V.ligne + ';border-radius:14px;overflow:hidden;' +
      'box-shadow:0 2px 10px rgba(32,34,31,.07);font-family:' + V.sans + ';margin-bottom:22px;">' + interieur + '</div>';
  }

  async function dessiner() {
    var grille = document.getElementById('propertiesGrid');
    if (!grille || enCours) return;
    var total = logements().length;
    if (!total) return;

    enCours = true;
    var hote = document.getElementById('bhOtaStatus');
    if (!hote) {
      hote = document.createElement('div');
      hote.id = 'bhOtaStatus';
      grille.parentNode.insertBefore(hote, grille);
    }

    var aPreparer = logements().filter(function (p) {
      return !((p.channexEnabled || p.channex_enabled) && (p.channexPropertyId || p.channex_property_id));
    }).length;

    var tete = '<div style="padding:16px 20px;border-bottom:1px solid ' + V.ligne2 + ';display:flex;' +
      'align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">' +
      '<div><div style="font-family:' + V.serif + ';font-size:20px;color:' + V.encre + ';">Vos plateformes</div>' +
      '<div style="font-size:12.5px;color:' + V.t3 + ';margin-top:2px;">' + total + ' logements' +
      (aPreparer ? ' · ' + aPreparer + ' pas encore dans Channex' : '') + '</div></div>' +
      (aPreparer
        ? '<button type="button" onclick="bhOuvrirLotOTA&&bhOuvrirLotOTA()" style="border:0;background:' + V.vert +
          ';color:#fff;font-family:' + V.sans + ';font-size:13.5px;font-weight:500;padding:10px 16px;border-radius:9px;' +
          'cursor:pointer;">Préparer mes logements</button>'
        : '') + '</div>';

    hote.innerHTML = coquille(tete +
      '<div style="padding:26px 20px;display:flex;align-items:center;gap:10px;color:' + V.t3 + ';font-size:13px;">' +
      '<span style="width:16px;height:16px;border:2px solid ' + V.ligne + ';border-top-color:' + V.vert +
      ';border-radius:50%;display:inline-block;animation:bhspin .8s linear infinite;"></span>Lecture des plateformes…</div>');

    var compte = await compter();

    hote.innerHTML = coquille(tete +
      PLATEFORMES.map(function (pf) { return ligne(pf, compte[pf.cle] || 0, total); }).join('') +
      '<div style="padding:12px 20px;font-size:12.5px;color:' + V.t4 + ';background:' + V.cote + ';">' +
      'Un tiret signifie que la plateforme n\'a jamais été essayée, pas qu\'elle a échoué.</div>');

    enCours = false;
  }

  window.bhRafraichirStatutOTA = function () { cache = { at: 0, parPlateforme: null }; dessiner(); };

  /* La grille est peuplée par renderProperties() : on attend qu'elle ait des
     cartes, puis on dessine une fois. Un nouveau rendu (ajout, suppression,
     connexion) redessine sans relancer les appels réseau. */
  function surveiller() {
    var grille = document.getElementById('propertiesGrid');
    if (!grille) return setTimeout(surveiller, 400);
    if (grille.children.length) dessiner();
    new MutationObserver(function () {
      if (grille.children.length && !document.getElementById('bhOtaStatus')) dessiner();
    }).observe(grille, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', surveiller);
  else surveiller();

  if (!document.getElementById('bhOtaKeyframes')) {
    var st = document.createElement('style');
    st.id = 'bhOtaKeyframes';
    st.textContent = '@keyframes bhspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
})();
