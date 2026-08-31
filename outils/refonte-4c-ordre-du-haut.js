#!/usr/bin/env node
/* ============================================================
   outils/refonte-4c-ordre-du-haut.js
   Lot 4c : fixer l'ordre, une fois pour toutes
   ============================================================

   ── LA COURSE ────────────────────────────────────────────────────
   deplacement_fait: true, au_dessus_de_la_bande: false. Les tuiles ont
   bougé, mais elles sont sous la bande.

   Deux de mes modules deplacent des blocs au meme endroit, chacun avec
   ses propres delais :

       bh-entete-jour   remonte la bande apres l'en-tete  (1s, 2.2s, 4s, 6s)
       bh-kpi-haut      insere les tuiles avant la bande  (1.8s, 3.2s, 5.2s)

   A 1.8 s les tuiles se placent avant la bande. A 4 s l'en-tete
   repasse, remet la bande juste apres lui — donc devant les tuiles. Le
   dernier qui parle a raison, et ce n'est pas le bon.

   Deux modules qui se disputent un ordre finissent toujours par
   dependre du reseau. Il faut un seul arbitre.

   ── LA CORRECTION ────────────────────────────────────────────────
   bh-kpi-haut devient cet arbitre. Au lieu d'inserer une fois, il
   IMPOSE la sequence a chaque passage :

       en-tete  ->  tuiles  ->  bande

   Et bh-entete-jour cesse de deplacer la bande : sa fonction de remontee
   est neutralisee, puisque l'arbitre s'en charge. Une seule main sur
   l'ordre, plus de course possible.

   L'arbitre repasse aussi apres l'arrivee tardive de la bande — elle
   depend d'un appel reseau, elle peut naitre a 3 s comme a 8 s.

   Usage :
     node outils/refonte-4c-ordre-du-haut.js --essai
     node outils/refonte-4c-ordre-du-haut.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const KPI = path.join(PUBLIC, 'js', 'bh-kpi-haut.js');
const ENTETE = path.join(PUBLIC, 'js', 'bh-entete-jour.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(KPI)) echec('bh-kpi-haut.js introuvable.');
if (!fs.existsSync(ENTETE)) echec('bh-entete-jour.js introuvable.');

let kpi = fs.readFileSync(KPI, 'utf8');
let entete = fs.readFileSync(ENTETE, 'utf8');

if (kpi.indexOf('imposerOrdre') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (kpi.indexOf('bh2-ops') === -1) echec('Lancez d\'abord refonte-4b-kpi-vrais-noms.js.');

function remplacer(texte, avant, apres, quoi, fichier) {
  const n = texte.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois dans ' + fichier + ' (attendu : 1).');
  return texte.split(avant).join(apres);
}

/* ── 1. L'arbitre : une sequence imposee a chaque passage ────── */

kpi = remplacer(kpi,
`    /* Au-dessus de la bande, sous l'en-tete. */
    var ancre = bande || entete.nextSibling;
    if (bande) bande.parentElement.insertBefore(ops, bande);
    else entete.parentElement.insertBefore(ops, entete.nextSibling);
    return true;
  }`,
`    imposerOrdre();
    return true;
  }

  /* ── L'arbitre de l'ordre ─────────────────────────────────────
     Un seul module decide de la sequence, et il la reaffirme a chaque
     passage. Sinon deux modules se la disputent et le resultat depend
     de la vitesse du reseau — ce qui n'est pas un resultat. */
  function imposerOrdre() {
    var entete = document.getElementById('bhEnteteJour');
    var ops = document.querySelector('[data-bh-kpi-haut]');
    if (!entete || !ops || !entete.parentElement) return false;

    /* en-tete -> tuiles */
    if (ops.previousElementSibling !== entete) {
      entete.parentElement.insertBefore(ops, entete.nextSibling);
      diag.ordre_corrige = (diag.ordre_corrige || 0) + 1;
    }
    /* tuiles -> bande */
    var bande = document.getElementById('bhBandeJours');
    if (bande && bande.previousElementSibling !== ops) {
      ops.parentElement.insertBefore(bande, ops.nextSibling);
      diag.ordre_corrige = (diag.ordre_corrige || 0) + 1;
    }
    return true;
  }`,
  'l\'insertion finale', 'bh-kpi-haut.js');

kpi = remplacer(kpi,
  '  function demarrer() { deplacer(); }',
  '  function demarrer() {\n    deplacer();\n    imposerOrdre();\n  }',
  'la fonction demarrer', 'bh-kpi-haut.js');

/* La bande nait d'un appel reseau : on veille plus longtemps. */
kpi = remplacer(kpi,
  '  setTimeout(demarrer, 5200);',
  '  setTimeout(demarrer, 5200);\n  setTimeout(demarrer, 7000);\n  setTimeout(demarrer, 9500);',
  'les passages', 'bh-kpi-haut.js');

/* Le diagnostic dit si l\'ordre a du etre corrige. */
kpi = remplacer(kpi,
  '      annulable: mem.length',
  '      ordre_corrige_fois: diag.ordre_corrige || 0,\n      annulable: mem.length',
  'le diagnostic', 'bh-kpi-haut.js');

/* ── 2. L'en-tete cesse de deplacer la bande ─────────────────── */

entete = remplacer(entete,
`  function demarrer() {
    poserEntete();
    deplacerCommandes();
    remonterBande();
  }`,
`  function demarrer() {
    poserEntete();
    deplacerCommandes();
    /* remonterBande() n'est plus appelee : l'ordre du haut est arbitre
       par bh-kpi-haut.js. Deux modules qui deplacent le meme bloc
       finissent par dependre de la vitesse du reseau. */
    if (!document.querySelector('[data-bh-kpi-haut]')) remonterBande();
  }`,
  'la fonction demarrer', 'bh-entete-jour.js');

/* ── Verifications ───────────────────────────────────────────── */

[
  ['l\'arbitre', 'function imposerOrdre() {'],
  ['la sequence en-tete puis tuiles', 'if (ops.previousElementSibling !== entete) {'],
  ['la sequence tuiles puis bande', 'if (bande && bande.previousElementSibling !== ops) {'],
  ['l\'appel a chaque passage', 'deplacer();\n    imposerOrdre();'],
  ['la veille prolongee', 'setTimeout(demarrer, 9500);'],
  ['le diagnostic', 'ordre_corrige_fois:'],
].forEach(function (c) {
  if (kpi.indexOf(c[1]) === -1) echec('Verification (kpi) : ' + c[0] + ' est absent.');
});

if (entete.indexOf("if (!document.querySelector('[data-bh-kpi-haut]')) remonterBande();") === -1) {
  echec('Verification (entete) : la remontee n\'est pas conditionnee.');
}
if (kpi.indexOf('bande.parentElement.insertBefore(ops, bande)') !== -1) {
  echec('L\'ancienne insertion subsiste. Refus.');
}

[[kpi, 'bh-kpi-haut.js'], [entete, 'bh-entete-jour.js']].forEach(function (p) {
  try { new Function(p[0]); }
  catch (e) { echec(p[1] + ' ne serait plus du JavaScript valide — ' + e.message); }
});

if (!ESSAI) {
  fs.writeFileSync(KPI, kpi, 'utf8');
  fs.writeFileSync(ENTETE, entete, 'utf8');
  if (fs.readFileSync(KPI, 'utf8').indexOf('imposerOrdre') === -1) {
    echec("La correction n'est pas dans bh-kpi-haut.js apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  bh-kpi-haut.js    devient l\'arbitre : il impose');
console.log('                    en-tete -> tuiles -> bande, a chaque passage');
console.log('  bh-entete-jour.js cesse de deplacer la bande');
console.log('\n  Une seule main sur l\'ordre : plus de course entre deux modules,');
console.log('  donc plus de resultat qui depend de la vitesse du reseau.');
console.log('  Deux passages de plus (7 s, 9.5 s) : la bande nait d\'un appel');
console.log('  reseau, elle peut arriver tard.');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  1. Titre, puis les trois tuiles, puis la bande de sept jours.');
console.log('  2. Attendez 10 secondes : l\'ordre ne doit pas bouger.');
console.log('  3. bhVerifKpi()  — au_dessus_de_la_bande: true.');
console.log('     « ordre_corrige_fois » dit combien de fois l\'arbitre a');
console.log('     du remettre les blocs en place : 1 ou 2 est normal.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
