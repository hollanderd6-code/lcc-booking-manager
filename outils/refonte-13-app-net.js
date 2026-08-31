#!/usr/bin/env node
/* ============================================================
   outils/refonte-13-app-net.js
   Lot 13 : trois selecteurs, zero deduction
   ============================================================

   ── CE QUE LE RELEVE ETABLIT ─────────────────────────────────────
       div.bh2-feat[h=157]
           section#kpiCaCard          CA mensuel
           section#kpiOccupancyCard   Occupation du mois
       section#kpiAutoCard[h=78]      Automatisation
       section#calendarSection[h=1810]
           div#bhCalRoot              le calendrier

   Trois noeuds suffisent. .bh2-feat porte les DEUX kpi — je cherchais
   deux cartes separees, elles n'en font qu'une.

   ── POURQUOI allege ECHOUAIT ─────────────────────────────────────
       « bilans_du_mois : contient bhEnteteJour — rien masque »

   Sa methode : trouver le libelle, puis remonter les ancetres jusqu'a un
   bloc « assez grand ». Depuis « CA MENSUEL » il remonte a .bh2-feat,
   puis a .bh2-hero — 2 241 px, qui contient tout le haut de la page, y
   compris l'en-tete que j'y ai pose. Sa protection fait alors son
   travail et refuse. Elle a raison de refuser ; c'est la remontee qui
   est fautive.

       « contient kpiCaCard — rien masque »

   Et sa liste de protection ramasse encore un identifiant en kpi* que je
   ne connaissais pas — #kpiCaCard, apparu depuis mon dernier relevé.
   Elle se protege donc contre la carte qu'on lui demande de masquer.

   Deux symptomes, une seule maladie : deduire au lieu de designer.

   ── CE QUE FAIT CE LOT ───────────────────────────────────────────
   Un module qui masque trois selecteurs, nommes. Aucune remontee
   d'ancetre, aucune recherche par texte, aucune liste de protection a
   maintenir. La seule verification qui reste est celle qui compte : la
   cible ne doit pas contenir un bloc a vous — en-tete, tuiles, bande,
   listes. Si elle en contient un, ce module s'abstient et le dit.

   allege n'est pas modifie. Ses refus sur bilans_du_mois deviennent du
   bruit sans effet — il refuse de masquer ce qui est deja masque. Le
   retoucher pour lui apprendre trois selecteurs qu'un module de 4 Ko
   porte mieux ne servirait personne.

   Rien n'est supprime : bhRendreApp() rend les trois blocs.

   Usage :
     node outils/refonte-13-app-net.js --essai
     node outils/refonte-13-app-net.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const JS = path.join(PUBLIC, 'js');
const MODULE = path.join(JS, 'bh-app-net.js');
const APP = path.join(PUBLIC, 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable.');

const SOURCE = `/* ============================================================
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
    console.log(n + ' bloc(s) rendu(s) a Aujourd\\'hui.');
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
    console.log('── Aujourd\\'hui, net ──');
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
`;

try { new Function(SOURCE); }
catch (e) { echec('Le module ne serait pas du JavaScript valide — ' + e.message); }

const BALISE = '<script src="js/bh-app-net.js"></script>';
let html = fs.readFileSync(APP, 'utf8');
let etat;

if (html.indexOf('bh-app-net.js') !== -1) {
  etat = 'deja';
} else {
  /* Apres bh-aujourdhui-allege : le dernier a parler gagne, et c'est
     celui qui designe plutot que de deduire. */
  const ordre = ['bh-aujourdhui-allege.js', 'bh-liste-unifiee.js', 'bh-entete-jour.js'];
  let ancre = -1, quoi = null;
  for (let i = 0; i < ordre.length && ancre === -1; i++) {
    const k = html.indexOf(ordre[i]);
    if (k !== -1) { ancre = k; quoi = ordre[i]; }
  }
  if (ancre === -1) echec('Aucun module de la refonte dans app.html.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etat = 'apres ' + quoi;
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  if (etat !== 'deja') fs.writeFileSync(APP, html, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhVerifAppNet') === -1) echec("Le module n'est pas complet apres ecriture.");
  if (fs.readFileSync(APP, 'utf8').indexOf('bh-app-net.js') === -1) {
    echec("La balise n'est pas dans app.html apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-app-net.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html             ' + etat);
console.log('\n  Trois selecteurs, nommes :');
console.log('    .bh2-feat         CA mensuel + Occupation (les deux)');
console.log('    #kpiAutoCard      Automatisation');
console.log('    #calendarSection  le calendrier');
console.log('\n  Aucune remontee d\'ancetre. C\'est ce qui perdait allege : depuis');
console.log('  « CA MENSUEL » il remontait a .bh2-hero, 2 241 px contenant');
console.log('  votre en-tete — et sa protection refusait, avec raison.');
console.log('\n  La seule verification qui reste : la cible ne doit pas contenir');
console.log('  un bloc a vous. Si elle en contient un, le module s\'abstient et');
console.log('  le nomme. Annulation :  bhRendreApp()');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  1. Plus de CA, ni Occupation, ni Automatisation, ni calendrier.');
console.log('  2. En-tete, trois tuiles, bande, listes : intacts.');
console.log('  3. bhVerifAppNet()  — « etat » doit dire « masque » trois fois,');
console.log('     et « refuses » etre vide.');
console.log('  4. /calendrier.html doit toujours montrer le calendrier :');
console.log('     ce module ne s\'y lance pas.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
