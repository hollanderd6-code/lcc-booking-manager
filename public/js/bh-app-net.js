/* ============================================================
   bh-app-net.js — trois blocs quittent Aujourd'hui
   ============================================================
   .bh2-feat        CA mensuel + Occupation (les deux, un seul noeud)
   #kpiAutoCard     Automatisation
   #calendarSection le calendrier

   Ils vivent desormais sur /calendrier.html. Ici on les masque, on ne
   les supprime pas : bhRendreApp() les rend.

   Aucune remontee d'ancetre, aucune recherche par texte. Trois
   selecteurs designes — c'est ce qui manquait a bh-aujourdhui-allege,
   qui deduisait et tombait sur .bh2-hero, 2 241 px contenant l'en-tete.
   ============================================================ */
(function () {
  'use strict';

  /* En vue calendrier ces blocs sont le contenu de la page : les masquer
     y viderait l'ecran. */
  if ((location.search || '').indexOf('vue=calendrier') !== -1) return;
  if ((location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html') return;
  if (window.__bhAppNet) return;
  window.__bhAppNet = true;

  var CIBLES = [
    { sel: '.bh2-feat', nom: 'CA mensuel + Occupation' },
    { sel: '#kpiAutoCard', nom: 'Automatisation' },
    { sel: '#calendarSection', nom: 'Calendrier' }
  ];

  /* Vos blocs. Une cible qui en contient un n'est pas la bonne cible :
     mieux vaut s'abstenir et le dire que masquer votre en-tete. */
  var VOS_BLOCS = ['bhEnteteJour', 'bhBandeJours', 'bhListeUnifiee', 'bhListesJour', 'bhChiffresFond'];

  var mem = [];
  var diag = { masques: [], refuses: [], absents: [] };

  function contientVotreTravail(zone) {
    for (var i = 0; i < VOS_BLOCS.length; i++) {
      var e = document.getElementById(VOS_BLOCS[i]);
      if (e && zone.contains(e)) return VOS_BLOCS[i];
    }
    var ops = document.querySelector('[data-bh-kpi-haut]');
    if (ops && zone.contains(ops)) return 'les trois tuiles';
    return null;
  }

  function passer() {
    CIBLES.forEach(function (c) {
      var el = document.querySelector(c.sel);
      if (!el) {
        if (diag.absents.indexOf(c.nom) === -1) diag.absents.push(c.nom);
        return;
      }
      if (el.dataset.bhAppNet) return;

      var bloqueur = contientVotreTravail(el);
      if (bloqueur) {
        var msg = c.nom + ' (' + c.sel + ') contient ' + bloqueur;
        if (diag.refuses.indexOf(msg) === -1) diag.refuses.push(msg);
        return;
      }

      el.dataset.bhAppNet = '1';
      mem.push({ el: el, valeur: el.style.getPropertyValue('display'), priorite: el.style.getPropertyPriority('display') });
      el.style.setProperty('display', 'none', 'important');
      diag.masques.push(c.nom);
    });
  }

  window.bhRendreApp = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
      delete m.el.dataset.bhAppNet;
    }
    var n = mem.length;
    mem = [];
    diag.masques = [];
    console.log(n + ' bloc(s) rendu(s) a Aujourd\'hui.');
    return n;
  };

  window.bhVerifAppNet = function () {
    var res = {
      masques: diag.masques,
      refuses: diag.refuses,
      absents: diag.absents,
      etat: CIBLES.map(function (c) {
        var el = document.querySelector(c.sel);
        return c.sel + ' : ' + (!el ? 'absent' : (getComputedStyle(el).display === 'none' ? 'masque' : 'VISIBLE'));
      }),
      entete_intact: !!document.getElementById('bhEnteteJour'),
      tuiles_intactes: !!document.querySelector('[data-bh-kpi-haut]'),
      liste_intacte: !!document.getElementById('bhListeUnifiee'),
      annulable: mem.length + ' bloc(s) memorise(s)'
    };
    console.log('── Aujourd\'hui, net ──');
    console.log(res);
    if (diag.refuses.length) console.warn('Refus : ' + diag.refuses.join(' | '));
    if (diag.absents.length) console.warn('Absents : ' + diag.absents.join(', '));
    console.log('Pour revenir en arriere : bhRendreApp()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(passer, 1200); });
  } else {
    setTimeout(passer, 1200);
  }
  /* Le calendrier se construit tard, et son moteur peut recreer sa
     section. On repasse, sans observateur : trois requetes de selecteur
     par passage ne coutent rien. */
  [2500, 4000, 6500, 9500, 13000].forEach(function (t) { setTimeout(passer, t); });
})();
