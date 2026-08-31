/* ============================================================
   bh-aujourdhui-allege.js — l'ecran du matin, sans les bilans
   ============================================================
   Cinq blocs quittent Aujourd'hui. Deux d'entre eux ont leur place sur
   Calendrier, un sur Messages — mais ce sont d'autres pages : ce module
   ne fait que le depart, proprement et reversiblement.

   Avant de masquer, il releve les identifiants et les valeurs de chaque
   bloc. C'est ce qui permettra de les reconstruire ailleurs sans
   recopier un chiffre mort.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhAujourdhuiAllege) return;
  window.__bhAujourdhuiAllege = true;

  var CIBLES = [
    { cle: 'journee', motif: 'VOTRE JOURN', vers: 'doublon de l en-tete' },
    { cle: 'ca_mensuel', motif: 'CA MENSUEL', vers: 'Calendrier' },
    { cle: 'occupation', motif: 'OCCUPATION DU MOIS', vers: 'Calendrier' },
    { cle: 'automatisation', motif: 'AUTOMATISATION', vers: 'Messages' },
    { cle: 'calendrier', motif: 'CALENDRIER DES R', vers: 'Calendrier' }
  ];

  var mem = [];
  var diag = { masques: [], refuses: [], introuvables: [], valeurs: {} };

  function normaliser(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function repere() {
    return document.getElementById('bhEnteteJour') || document.getElementById('bhBandeJours');
  }

  /* L'intitule : une feuille de texte, courte, qui commence par le
     motif. Court, sinon on attrape le conteneur entier. */
  function trouverIntitule(motif) {
    var noeuds = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, label, strong');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length > 2) continue;
      var t = normaliser(n.textContent);
      if (t.length > 70) continue;
      if (t.indexOf(motif) === 0) return n;
    }
    return null;
  }

  /* Le bloc de premier niveau : on remonte jusqu'au noeud dont le PARENT
     porte aussi l'en-tete. C'est le frere des autres sections de la
     page — ni la carte interieure, ni la page entiere. */
  function blocDe(el) {
    var r = repere();
    if (!r) return null;
    var c = el;
    var garde = 0;
    while (c && c.parentElement && c !== document.body && garde++ < 14) {
      if (c.contains(r)) return null;
      if (c.parentElement.contains(r)) return c;
      c = c.parentElement;
    }
    return null;
  }

  /* L'inventaire, pris AVANT de masquer : identifiants et valeurs
     affichees. C'est ce qui servira a reconstruire ces blocs sur leur
     page d'arrivee, sans figer un chiffre. */
  function inventaire(bloc) {
    var out = {};
    var avecId = bloc.querySelectorAll('[id]');
    for (var i = 0; i < avecId.length && i < 40; i++) {
      var e = avecId[i];
      var t = normaliser(e.textContent);
      out[e.id] = t.length > 60 ? t.slice(0, 60) + '…' : t;
    }
    if (!Object.keys(out).length) out['(aucun identifiant)'] = normaliser(bloc.textContent).slice(0, 80);
    return out;
  }

  function masquer() {
    if (!repere()) return false;
    var faits = 0;

    CIBLES.forEach(function (cible) {
      if (diag.masques.indexOf(cible.cle) !== -1) return;

      var titre = trouverIntitule(cible.motif);
      if (!titre) {
        if (diag.introuvables.indexOf(cible.cle) === -1) diag.introuvables.push(cible.cle);
        return;
      }

      var bloc = blocDe(titre);
      if (!bloc) {
        if (diag.refuses.indexOf(cible.cle) === -1) {
          diag.refuses.push(cible.cle + ' : aucun bloc de premier niveau sur — rien masque');
        }
        return;
      }

      /* Un bloc qui contiendrait l'intitule d'une autre cible masquerait
         plus que demande. On s'abstient. */
      var deTrop = null;
      CIBLES.forEach(function (autre) {
        if (autre.cle === cible.cle || deTrop) return;
        var t = trouverIntitule(autre.motif);
        if (t && bloc.contains(t) && autre.cle !== 'journee') deTrop = autre.cle;
      });
      if (deTrop) {
        if (diag.refuses.indexOf(cible.cle) === -1) {
          diag.refuses.push(cible.cle + ' : engloberait ' + deTrop + ' — rien masque');
        }
        return;
      }

      diag.valeurs[cible.cle] = inventaire(bloc);
      mem.push({ el: bloc, valeur: bloc.style.getPropertyValue('display'), priorite: bloc.style.getPropertyPriority('display') });
      bloc.style.setProperty('display', 'none', 'important');
      diag.masques.push(cible.cle);

      var pos = diag.introuvables.indexOf(cible.cle);
      if (pos !== -1) diag.introuvables.splice(pos, 1);
      faits++;
    });

    return faits > 0;
  }

  window.bhAnnulerAllege = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
    }
    var n = mem.length;
    mem = [];
    diag.masques = [];
    console.log(n + ' bloc(s) rendu(s) a Aujourd\'hui.');
    return n;
  };

  window.bhVerifAllege = function () {
    var res = {
      masques: diag.masques,
      refuses: diag.refuses,
      introuvables: diag.introuvables,
      valeurs: diag.valeurs,
      annulable: mem.length + ' bloc(s) memorise(s)'
    };
    console.log('── Aujourd\'hui allege ──');
    console.log(res);
    console.log('Inventaire pour la reconstruction (a me coller) :');
    console.log(JSON.stringify(diag.valeurs, null, 1));
    if (diag.refuses.length) console.warn('Refus : ' + diag.refuses.join(' | '));
    if (diag.introuvables.length) console.warn('Intitules non trouves : ' + diag.introuvables.join(', '));
    console.log('Pour revenir en arriere : bhAnnulerAllege()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(masquer, 2000); });
  } else {
    setTimeout(masquer, 2000);
  }
  setTimeout(masquer, 3800);
  setTimeout(masquer, 6400);
  setTimeout(masquer, 9000);
})();
