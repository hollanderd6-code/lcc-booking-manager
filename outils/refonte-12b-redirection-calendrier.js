#!/usr/bin/env node
/* ============================================================
   outils/refonte-12b-redirection-calendrier.js
   Lot 12b : prendre le probleme par l'autre bout
   ============================================================

   ── CE QUI NE MARCHE PAS DANS LE LOT 12 ──────────────────────────
   La barre porte le bon lien — bhVerifBarre() affiche bien
   « Calendrier -> app.html?vue=calendrier ». Et pourtant le clic mene
   toujours a reservations.html.

   La raison : un autre gestionnaire de clic est enregistre avant le
   mien sur le meme bouton, et il navigue en premier. Mon
   stopImmediatePropagation arrive trop tard — il n'arrete que ce qui
   suit, pas ce qui precede.

   Je pourrais chercher qui c'est et m'enregistrer avant lui. Ce serait
   une course, et les courses se reperdent au prochain lot.

   ── LA REPONSE ───────────────────────────────────────────────────
   On ne discute plus du clic. reservations.html redirige.

       reservations.html  ->  app.html?vue=calendrier

   Quel que soit le chemin emprunte — bouton, lien, favori, retour
   arriere, saisie manuelle — on arrive sur la vue calendrier. Il n'y a
   plus rien a gagner ni a perdre dans l'ordre des ecouteurs.

   La redirection est posee en TETE du <head>, avant tout le reste :
   la page ne se construit pas, donc aucun clignotement, et les 97 Ko
   de reservations.html ne sont jamais evalues.

   location.replace, et non location.href : la page redirigee ne laisse
   pas de trace dans l'historique. Sans cela, le bouton « retour » du
   telephone renverrait sur la redirection, qui renverrait a nouveau —
   et l'utilisateur serait prisonnier.

   ── LA PORTE DE SORTIE ───────────────────────────────────────────
   /reservations.html?garder=1  ouvre l'ancienne page, intacte.

   Elle n'est pas supprimee, pas videe, pas modifiee au-dela de ces
   trois lignes. Le jour ou vous voudrez en faire autre chose, tout y
   est encore.

   ── ANNULER ──────────────────────────────────────────────────────
   Relancez avec --retirer : la redirection est enlevee, la page
   redevient joignable normalement.

   Usage :
     node outils/refonte-12b-redirection-calendrier.js --essai
     node outils/refonte-12b-redirection-calendrier.js
     node outils/refonte-12b-redirection-calendrier.js --retirer
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const RESA = path.join(PUBLIC, 'reservations.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const RETIRER = process.argv.includes('--retirer');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(RESA)) echec('public/reservations.html introuvable. Lancez depuis la racine du projet.');

const DEBUT = '<!-- BH-REDIRECTION-CALENDRIER debut -->';
const FIN = '<!-- BH-REDIRECTION-CALENDRIER fin -->';

const BLOC = DEBUT + `
<script>
/* L'onglet Calendrier montre le calendrier de app.html : son moteur y
   est tisse avec le reste de la page et ne peut pas en sortir sans
   plusieurs jours de travail (voir outils/refonte-11c-sonde-scripts.js).

   Pose avant tout le reste : la page ne se construit pas, donc aucun
   clignotement. location.replace pour ne pas piéger le bouton retour.

   Porte de sortie : /reservations.html?garder=1 ouvre cette page,
   intacte. */
(function () {
  if (location.search.indexOf('garder=1') !== -1) return;
  location.replace('/app.html?vue=calendrier');
})();
</script>
` + FIN;

let html = fs.readFileSync(RESA, 'utf8');
const dejaLa = html.indexOf(DEBUT) !== -1;

if (RETIRER) {
  if (!dejaLa) { console.log('\n  Aucune redirection en place — rien a retirer.\n'); process.exit(0); }
  const a = html.indexOf(DEBUT);
  const b = html.indexOf(FIN);
  if (b === -1 || b < a) echec('Bloc de redirection mal ferme. Retrait manuel plus sur.');
  html = html.slice(0, a) + html.slice(b + FIN.length);
  html = html.replace(/\n{3,}/g, '\n\n');
  if (!ESSAI) fs.writeFileSync(RESA, html, 'utf8');
  console.log('\n' + (ESSAI ? '— ESSAI —' : '— RETIREE —'));
  console.log('  reservations.html est de nouveau joignable directement.');
  console.log('  Pensez a repointer l\'onglet si vous le souhaitez.\n');
  process.exit(0);
}

if (dejaLa) {
  console.log('\n  Redirection deja en place — rien a faire.\n');
  process.exit(0);
}

/* ── L'insertion : le plus haut possible dans <head> ──────────── */

const head = html.search(/<head\b[^>]*>/i);
if (head === -1) echec('<head> introuvable dans reservations.html.');
const finHead = html.indexOf('>', head) + 1;

/* Une balise <base> ou <meta charset> doit rester en premier : la
   redirection se place juste apres elles si elles existent. */
let pos = finHead;
const charset = html.search(/<meta[^>]+charset[^>]*>/i);
if (charset !== -1 && charset < html.indexOf('</head>')) {
  pos = html.indexOf('>', charset) + 1;
}

const avant = html.slice(0, pos);
const apres = html.slice(pos);
html = avant + '\n' + BLOC + apres;

/* ── Verifications ────────────────────────────────────────────── */

if (html.indexOf(DEBUT) === -1 || html.indexOf(FIN) === -1) echec('Le bloc n\'a pas ete insere.');
if (html.indexOf(DEBUT) > html.indexOf('</head>')) echec('Le bloc serait hors du <head>. Refus.');
const ordre = html.indexOf(DEBUT);
const premierScript = html.search(/<script\b/i);
if (premierScript !== -1 && premierScript < ordre - BLOC.length) {
  console.warn('\n  Note : un <script> precede la redirection dans le fichier.');
  console.warn('  Il sera evalue avant elle. Sans consequence si c\'est un');
  console.warn('  chargeur, a surveiller si c\'est un rendu.\n');
}
if (html.split(DEBUT).length - 1 !== 1) echec('Le bloc apparait plusieurs fois. Refus.');

if (!ESSAI) {
  fs.writeFileSync(RESA, html, 'utf8');
  const relu = fs.readFileSync(RESA, 'utf8');
  if (relu.indexOf("location.replace('/app.html?vue=calendrier')") === -1) {
    echec("La redirection n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  reservations.html  ->  app.html?vue=calendrier');
console.log('  Pose en tete du <head>, avant tout le reste : la page ne se');
console.log('  construit pas, donc aucun clignotement.');
console.log('\n  Porte de sortie :  /reservations.html?garder=1');
console.log('  L\'ancienne page s\'ouvre intacte. Elle n\'est ni supprimee ni');
console.log('  videe — seules ces trois lignes ont ete ajoutees.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('    onglet Calendrier  -> le calendrier seul, plein ecran');
console.log('    bouton retour      -> ne boucle pas (location.replace)');
console.log('    onglet Aujourd\'hui -> la page du matin, inchangee');
console.log('\n  Pour annuler : node outils/refonte-12b-redirection-calendrier.js --retirer\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
