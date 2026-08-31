/* ============================================================
   bh-cartes-mois.js — « CA mensuel » et « Occupation » quittent le matin
   ============================================================
   Deux mesures de bilan sur un ecran d'action. Elles ne se lisent pas a
   9 h : elles se consultent. Leur place est dans Argent.

   Les cartes sont reperees par leur INTITULE, pas par un identifiant
   devine. Si l'intitule change, le module ne masque rien et le dit —
   plutot que de masquer la mauvaise carte.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhCartesMois) return;
  window.__bhCartesMois = true;

  var CIBLES = ['CA MENSUEL', 'OCCUPATION DU MOIS'];
  var mem = [];
  var diag = { masquees: [], introuvables: [], raison: '' };

  function normaliser(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  /* On part de l'intitule et on remonte jusqu'a la carte : le premier
     ancetre assez grand pour en etre une. */
  function carteDe(el) {
    var c = el;
    var garde = 0;
    while (c && c.parentElement && garde++ < 8) {
      var r = c.getBoundingClientRect();
      if (r.height >= 90 && r.width >= 120) return c;
      c = c.parentElement;
    }
    return null;
  }

  function trouver(intitule) {
    var noeuds = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, label');
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length) continue;
      if (normaliser(n.textContent) === intitule) return n;
    }
    return null;
  }

  function masquer() {
    if (diag.masquees.length === CIBLES.length) return true;
    var faits = 0;

    CIBLES.forEach(function (intitule) {
      if (diag.masquees.indexOf(intitule) !== -1) return;
      var titre = trouver(intitule);
      if (!titre) { if (diag.introuvables.indexOf(intitule) === -1) diag.introuvables.push(intitule); return; }
      var c = carteDe(titre);
      if (!c) { diag.raison = 'carte introuvable autour de ' + intitule; return; }

      mem.push({ el: c, valeur: c.style.getPropertyValue('display'), priorite: c.style.getPropertyPriority('display') });
      c.style.setProperty('display', 'none', 'important');
      diag.masquees.push(intitule);
      var pos = diag.introuvables.indexOf(intitule);
      if (pos !== -1) diag.introuvables.splice(pos, 1);
      faits++;
    });

    return faits > 0;
  }

  window.bhAnnulerCartesMois = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
    }
    var n = mem.length;
    mem = [];
    diag.masquees = [];
    console.log(n + ' carte(s) rendue(s) : CA mensuel et Occupation du mois sont revenues.');
    return n;
  };

  window.bhVerifCartesMois = function () {
    var res = {
      masquees: diag.masquees,
      introuvables: diag.introuvables,
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Cartes du mois ──');
    console.log(res);
    if (diag.introuvables.length) {
      console.warn('Intitule(s) non trouve(s) : ' + diag.introuvables.join(', ')
        + ' — rien n a ete masque pour eux, aucune carte au hasard.');
    }
    console.log('Pour revenir en arriere : bhAnnulerCartesMois()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(masquer, 1600); });
  } else {
    setTimeout(masquer, 1600);
  }
  setTimeout(masquer, 3400);
  setTimeout(masquer, 6000);
})();
