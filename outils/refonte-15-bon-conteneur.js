#!/usr/bin/env node
/* ============================================================
   outils/refonte-15-bon-conteneur.js
   Lot 15 : je regardais le mauvais conteneur
   ============================================================

   ── L'ERREUR ─────────────────────────────────────────────────────
   Sur /calendrier.html, ma verification disait « grille vide ». Sur
   /app.html, ou le calendrier s'affiche parfaitement, elle dit la meme
   chose : grille 0.

   #calendarGrid est un vestige. Il est vide sur les deux pages. Le
   calendrier que vous voyez est dessine dans #bhMonthOuter — c'etait
   dans l'inventaire du lot 10, sous mes yeux, et je ne l'ai pas
   rapproche.

   Consequence : mon test n'a jamais pu repondre oui. Le module appelait
   les moteurs, ne voyait rien se remplir, n'osait rien masquer, et se
   retractait au bout de dix-huit secondes. Le moteur, lui, marchait
   peut-etre depuis le debut.

   Trois lots pour une question mal posee. C'est le genre d'erreur qui
   coute plus cher qu'une panne franche : tout semblait diagnostique.

   ── LA CORRECTION ────────────────────────────────────────────────
   « Rempli » ne depend plus d'un seul identifiant. Le module regarde,
   dans l'ordre :

       #bhMonthOuter        le rendu reel
       #calendarGrid        l'ancien, au cas ou
       les cellules         plus de dix .calendar-cell dans la section

   Trois facons de repondre oui, une seule suffit. Un renderer qui
   changerait de conteneur demain ne remettrait pas la vue en panne.

   Et bhVerifVueCalendrier() dit desormais lequel des trois a repondu :
   plus de « vide » sans preciser vide de quoi.

   ── CE QUI NE CHANGE PAS ─────────────────────────────────────────
   Le filet reste. Rien n'est masque tant que rien n'est rempli.

   Usage :
     node outils/refonte-15-bon-conteneur.js --essai
     node outils/refonte-15-bon-conteneur.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE = path.join(process.cwd(), 'public', 'js', 'bh-vue-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(MODULE)) echec('bh-vue-calendrier.js absent. Lancez d\'abord les lots 12 et 14.');

let src = fs.readFileSync(MODULE, 'utf8');

if (src.indexOf('bhMonthOuter') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. Le test de remplissage ────────────────────────────────── */

remplacer(
`  function grille() { return document.getElementById('calendarGrid'); }
  function remplie() { var g = grille(); return !!(g && g.childElementCount > 0); }`,
`  /* #calendarGrid est un vestige : il est vide sur app.html aussi,
     alors que le calendrier s'y affiche. Le rendu reel va dans
     #bhMonthOuter. On accepte les trois reponses possibles plutot que
     de parier sur un seul conteneur. */
  function conteneurRempli() {
    var mo = document.getElementById('bhMonthOuter');
    if (mo && mo.childElementCount > 0) return 'bhMonthOuter';
    var g = document.getElementById('calendarGrid');
    if (g && g.childElementCount > 0) return 'calendarGrid';
    var s = document.getElementById('calendarSection');
    if (s && s.querySelectorAll('.calendar-cell, .calendar-row, .day-header').length > 10) return 'cellules';
    return null;
  }
  function grille() { return document.getElementById('bhMonthOuter') || document.getElementById('calendarGrid'); }
  function remplie() {
    var q = conteneurRempli();
    if (q) diag.conteneur = q;
    return !!q;
  }`,
  'le test de remplissage'
);

/* ── 2. Le diagnostic ─────────────────────────────────────────── */

remplacer(
`      grille_remplie: g ? g.childElementCount : 0,`,
`      conteneur_rempli: diag.conteneur || null,
      grille_remplie: g ? g.childElementCount : 0,
      bhMonthOuter: (document.getElementById('bhMonthOuter') || {}).childElementCount || 0,
      calendarGrid: (document.getElementById('calendarGrid') || {}).childElementCount || 0,`,
  'le diagnostic'
);

remplacer(
`    if (!res.grille_remplie) console.warn('Grille vide : ' + (diag.raison || 'moteur non demarre'));`,
`    if (!res.conteneur_rempli) {
      console.warn('Aucun conteneur rempli : ' + (diag.raison || 'moteur non demarre'));
      console.warn('bhMonthOuter ' + res.bhMonthOuter + ' · calendarGrid ' + res.calendarGrid);
    }`,
  'l\'avertissement'
);

/* ── 3. Le champ dans l'etat ──────────────────────────────────── */

remplacer(
`    section: false, masques: 0, voisins: [], moteur_lance_par: null,`,
`    section: false, masques: 0, voisins: [], moteur_lance_par: null, conteneur: null,`,
  'l\'etat interne'
);

/* ── Verifications ────────────────────────────────────────────── */

[
  ['le nouveau test', 'function conteneurRempli()'],
  ['le rendu reel', "getElementById('bhMonthOuter')"],
  ['le repli par cellules', "'.calendar-cell, .calendar-row, .day-header'"],
  ['le champ de diagnostic', 'conteneur_rempli:'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

try { new Function(src); } catch (e) { echec('Le module ne serait plus valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, src, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('conteneurRempli') === -1) echec("La correction n'est pas dans le fichier apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-vue-calendrier.js  test de remplissage corrige');
console.log('\n  « Rempli » se lit maintenant sur trois conteneurs : #bhMonthOuter');
console.log('  d\'abord — le rendu reel —, #calendarGrid ensuite, et en dernier');
console.log('  recours plus de dix cellules dans la section.');
console.log('\n  Mon test precedent ne regardait que #calendarGrid, qui est vide');
console.log('  sur app.html aussi. Il n\'a donc jamais pu repondre oui, et le');
console.log('  module se retractait alors que le calendrier etait peut-etre la');
console.log('  depuis le debut.');
console.log('\n  A verifier, cache vide, sur /calendrier.html :');
console.log('    bhVerifVueCalendrier()');
console.log('  J\'attends conteneur_rempli: "bhMonthOuter" et voisins_masques > 0.');
console.log('  Si conteneur_rempli reste null, les deux compteurs affiches');
console.log('  diront lequel est vide, et cette fois la question sera bien posee.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
