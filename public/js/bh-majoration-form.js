/* ============================================================================
   BH-MAJORATION-FORM — la majoration par plateforme dans la fiche du logement
   ============================================================================
   INSTALLATION — dans public/settings.html, après settings.js :

     <script src="/js/bh-majoration-form.js"></script>

   Le bloc de champs est ajouté dans le formulaire par l'installateur, juste
   sous « Commission Airbnb / Commission Booking ». Ce script s'occupe du
   reste : remplir les champs à l'ouverture, enregistrer à la sauvegarde.

   POURQUOI UN SCRIPT SÉPARÉ
   saveProperty() envoie un FormData dont le serveur filtre les clés : deux
   champs de plus dans le formulaire seraient ignorés en silence. La majoration
   passe donc par sa route dédiée (PATCH /api/properties/:id/markups), déclenchée
   au même moment que la sauvegarde du formulaire. L'utilisateur ne voit qu'un
   seul bouton Enregistrer.

   DISTINCTION IMPORTANTE, tenue dans les libellés
   Commission = ce que la plateforme prélève sur le prix (sert au calcul du
   revenu net). Majoration = ce que l'on ajoute au prix envoyé à la plateforme.
   Deux notions opposées, voisines à l'écran : les intitulés et les aides ne
   doivent jamais être raccourcis.
   ========================================================================== */
(function () {
  'use strict';

  var CHAMPS = {
    ABB: 'propertyMarkupABB',
    BDC: 'propertyMarkupBDC',
    EXP: 'propertyMarkupEXP',
    VRB: 'propertyMarkupVRB'
  };

  var NOMS = { ABB: 'Airbnb', BDC: 'Booking.com', EXP: 'Expedia', VRB: 'Abritel / VRBO' };

  var initial = {};      // ce qui était en base à l'ouverture
  var dispo = false;     // la route répond-elle ?
  var pidCharge = null;

  function token() { try { return localStorage.getItem('lcc_token'); } catch (e) { return null; } }
  function pid() { var e = document.getElementById('propertyId'); return e && e.value ? e.value : null; }
  function bloc() { return document.getElementById('bhMajorationBloc'); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }

  function vider() {
    Object.keys(CHAMPS).forEach(function (code) {
      var ch = document.getElementById(CHAMPS[code]);
      if (ch) ch.value = '';
    });
  }

  async function charger() {
    var id = pid();
    var b = bloc();
    if (!b) return;

    // Création d'un logement : pas encore d'id, donc rien à régler ici.
    if (!id) {
      b.style.display = 'none';
      vider();
      pidCharge = null;
      return;
    }
    if (id === pidCharge) return;
    pidCharge = id;
    vider();
    try {
      var r = await fetch(API_URL + '/api/properties/' + id + '/markups',
        { headers: { Authorization: 'Bearer ' + token() } });
      if (!r.ok) throw new Error('indisponible');
      var d = await r.json();
      initial = d.markups || {};
      dispo = true;
      b.style.display = '';
      Object.keys(CHAMPS).forEach(function (code) {
        var ch = document.getElementById(CHAMPS[code]);
        if (ch) ch.value = initial[code] != null ? initial[code] : '';
      });
    } catch (e) {
      // La route n'est pas montée : on masque plutôt que de proposer une
      // saisie qui ne serait jamais enregistrée.
      dispo = false;
      b.style.display = 'none';
    }
  }

  async function enregistrer() {
    if (!dispo) return;
    var id = pid();
    if (!id) return;

    var aEnvoyer = [];
    Object.keys(CHAMPS).forEach(function (code) {
      var ch = document.getElementById(CHAMPS[code]);
      if (!ch) return;
      var brut = String(ch.value).trim();
      var val = brut === '' ? 0 : parseFloat(brut);
      if (!isFinite(val) || val < 0 || val > 100) {
        return toast(NOMS[code] + ' : la majoration doit être un nombre entre 0 et 100.', 'error');
      }
      var avant = initial[code] != null ? parseFloat(initial[code]) : 0;
      if (val !== avant) aEnvoyer.push({ code: code, pct: val });
    });

    if (!aEnvoyer.length) return;

    var faits = [];
    var aRemapper = [];   // majoration active mais canal non remappé
    var aFaireMain = [];  // ce que le serveur ne peut pas réparer seul
    for (var i = 0; i < aEnvoyer.length; i++) {
      var m = aEnvoyer[i];
      try {
        var r = await fetch(API_URL + '/api/properties/' + id + '/markups', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify(m)
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Erreur');
        initial = d.markups || {};
        faits.push(m.pct > 0 ? NOMS[m.code] + ' +' + m.pct + '%' : NOMS[m.code] + ' sans majoration');
        if (m.pct > 0 && !d.remappe) aRemapper.push(NOMS[m.code]);
        (d.action_utilisateur || []).forEach(function (msg) {
          if (aFaireMain.indexOf(msg) === -1) aFaireMain.push(msg);
        });
      } catch (e) {
        toast(NOMS[m.code] + ' : ' + e.message, 'error');
      }
    }

    if (faits.length) {
      toast('Majoration enregistrée — ' + faits.join(', ') +
        '. Appliquée à la prochaine synchronisation des tarifs.', 'success');
    }

    /* Le remappage automatique a échoué : on le dit, plutôt que de laisser
       croire que le prix majoré partira alors que le canal lit encore le
       tarif standard. */
    if (aFaireMain.length) {
      aFaireMain.slice(0, 2).forEach(function (msg) { toast(msg, 'warning'); });
    } else if (aRemapper.length) {
      toast(aRemapper.join(', ') + ' : le canal lit encore le tarif standard. ' +
        'Mappez-le sur le plan majoré dans la fenêtre du partenaire.', 'warning');
    }
  }

  /* La sauvegarde part avec celle du formulaire. On n'écoute pas l'événement
     submit : selon la façon dont le bouton Enregistrer est câblé, il peut ne
     jamais être émis. On enveloppe saveProperty(), qui est appelée dans tous
     les cas — et on lit l'identifiant avant elle, car closeEditModal() le vide. */
  function brancher() {
    if (typeof window.saveProperty === 'function' && !window.saveProperty.__bhMaj) {
      var origine = window.saveProperty;
      var enveloppe = function () {
        try { enregistrer(); } catch (e) {}
        return origine.apply(this, arguments);
      };
      enveloppe.__bhMaj = true;
      window.saveProperty = enveloppe;
    }

    // Ceinture et bretelles : si le formulaire émet bien un submit et que
    // saveProperty n'a pas pu être enveloppée, on passe par là.
    var form = document.getElementById('propertyForm');
    if (form && !form.dataset.bhMaj) {
      form.dataset.bhMaj = '1';
      form.addEventListener('submit', function () {
        if (!(window.saveProperty && window.saveProperty.__bhMaj)) enregistrer();
      }, true);
    }

    var modal = document.getElementById('editPropertyModal');
    if (modal && !modal.dataset.bhMaj) {
      modal.dataset.bhMaj = '1';
      // Le formulaire est rempli à l'ouverture : on attend le changement de
      // classe, puis on relit quelques fois au cas où #propertyId arrive tard.
      new MutationObserver(function () {
        if (modal.classList.contains('active')) {
          [80, 250, 600].forEach(function (d) { setTimeout(charger, d); });
        } else {
          pidCharge = null;
        }
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* saveProperty peut être définie après nous : on retente le temps qu'il faut. */
  function attendre(n) {
    brancher();
    if (!(window.saveProperty && window.saveProperty.__bhMaj) && n > 0) {
      setTimeout(function () { attendre(n - 1); }, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { attendre(20); });
  } else {
    attendre(20);
  }
})();
