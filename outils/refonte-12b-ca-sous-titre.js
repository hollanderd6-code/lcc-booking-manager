#!/usr/bin/env node
/* ============================================================
   outils/refonte-12b-ca-sous-titre.js
   Lot 12b : le CA a cote de l'occupation
   ============================================================

   Le sous-titre disait « 32 % d'occupation ce mois ». Il dira :

       19 111 € ce mois  ·  32 % d'occupation

   L'argent d'abord : c'est le chiffre qu'on cherche en ouvrant la page,
   l'occupation en est la cause. Sur 390 px les deux tiennent sur une
   ligne ; si la police les fait deborder, ils passent a la ligne d'eux-
   memes plutot que d'etre tronques.

   ── LE CHIFFRE N'EST PAS RECALCULE ───────────────────────────────
   Il est LU dans la carte CA mensuel, comme le pourcentage est lu dans
   la carte Occupation. Meme raison : un seul endroit calcule le CA. Si
   je le recalculais depuis /api/reservations, vous auriez deux montants
   qui finiraient par differer — et vous ne sauriez pas lequel croire.

   La lecture cherche un montant en euros dans le texte de la carte. Si
   elle ne trouve rien, le sous-titre n'affiche que l'occupation : pas de
   « 0 € » trompeur, pas de tiret enigmatique.

   ── LE VARIANT ───────────────────────────────────────────────────
   « −34 % vs juil » n'est pas reprise. Sur une ligne de 13 px a cote de
   deux autres nombres, elle ferait trois informations pour un sous-titre
   — et une baisse de CA meritera mieux qu'un fragment de ligne quand
   vous voudrez la traiter. Dites-le si vous la voulez quand meme.

   Usage :
     node outils/refonte-12b-ca-sous-titre.js --essai
     node outils/refonte-12b-ca-sous-titre.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-entete-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('bh-entete-calendrier.js introuvable. Lancez d\'abord refonte-12-entete-calendrier.js.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('function caMensuel') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function rempl(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. La lecture du CA, a cote de celle de l'occupation ────── */

rempl(
  '  var SVG_LOUPE =',
`  /* Le CA, lu la ou il est calcule. La carte affiche « 19 111 € » avec
     une espace insecable : on accepte les deux espaces, et on rend le
     montant tel qu'il est ecrit plutot que de le reformater. */
  function caMensuel() {
    var c = document.querySelector('.bh2-feat');
    if (!c) return null;
    var txt = (c.textContent || '').replace(/\\u00a0/g, ' ');
    var m = txt.match(/(\\d[\\d  .,]{0,12}\\d)\\s*€/);
    if (!m) return null;
    var brut = m[1].replace(/[.,]$/, '').trim();
    return brut ? brut + ' €' : null;
  }

  /* Le sous-titre : l'argent d'abord, l'occupation qui l'explique
     ensuite. Ce qui manque est omis, jamais remplace par un zero. */
  function sousTitre() {
    var bouts = [];
    var ca = caMensuel();
    var occ = occupation();
    if (ca) bouts.push(ca + ' ce mois');
    if (occ) bouts.push(occ + " % d'occupation");
    return bouts.join('  \\u00b7  ');
  }

  var SVG_LOUPE =`,
  'l\'entete du SVG');

/* ── 2. Le sous-titre a la creation ─────────────────────────── */

rempl(
`      sous.textContent = pct ? pct + " % d'occupation ce mois" : '';`,
`      sous.textContent = sousTitre();`,
  'le sous-titre initial');

/* ── 3. Et a chaque passage, tant qu'il est incomplet ────────── */

rempl(
`      /* Le pourcentage arrive parfois apres nous. */
      var s = document.getElementById('bhEnteteCalSous');
      if (s && pct && !s.textContent) s.textContent = pct + " % d'occupation ce mois";`,
`      /* Les deux chiffres arrivent par des chemins differents, et l'un
         peut etre pret avant l'autre. On reecrit tant qu'il en manque un,
         puis on cesse — sinon on ecraserait a chaque passage. */
      var s = document.getElementById('bhEnteteCalSous');
      if (s) {
        var frais = sousTitre();
        var complet = frais.indexOf('\\u00b7') !== -1;
        if (frais && (!s.textContent || !s.dataset.bhComplet)) {
          s.textContent = frais;
          if (complet) s.dataset.bhComplet = '1';
        }
      }`,
  'la mise a jour du sous-titre');

/* ── 4. Le sous-titre peut tenir sur deux lignes ─────────────── */

rempl(
  "      sous.style.cssText = 'font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em;min-height:18px';",
  "      sous.style.cssText = 'font-size:13.5px;font-weight:500;color:' + GRIS\n        + ';letter-spacing:-.01em;min-height:18px;line-height:1.35;text-wrap:pretty';",
  'le style du sous-titre');

/* ── 5. Le diagnostic nomme les deux lectures ────────────────── */

rempl(
  '      occupation_lue: diag.occupation,',
  '      occupation_lue: diag.occupation,\n      ca_lu: caMensuel(),\n      sous_titre: (document.getElementById(\'bhEnteteCalSous\') || {}).textContent || null,',
  'le diagnostic');

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la lecture du CA', 'function caMensuel() {'],
  ['la composition', 'function sousTitre() {'],
  ['l\'argent en premier', "bouts.push(ca + ' ce mois')"],
  ['l\'usage a la creation', 'sous.textContent = sousTitre();'],
  ['la mise a jour', 'var frais = sousTitre();'],
  ['le diagnostic', 'ca_lu: caMensuel(),'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* La carte CA doit toujours etre masquee : son chiffre est remonte. */
if (src.indexOf("'.bh2-feat', '#kpiOccupancyCard', '#kpiAutoCard'") === -1) {
  echec('La liste des cartes masquees a change. Refus.');
}

try { new Function(src); }
catch (e) { echec('Le module ne serait plus du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('function caMensuel') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Sous-titre :  19 111 € ce mois  ·  32 % d\'occupation');
console.log('  L\'argent d\'abord : c\'est le chiffre qu\'on cherche en ouvrant');
console.log('  la page, l\'occupation en est la cause.');
console.log('\n  Les deux sont LUS dans leurs cartes, jamais recalcules — un');
console.log('  seul endroit calcule le CA. Si la lecture echoue, le sous-titre');
console.log('  n\'affiche que ce qu\'il a : pas de « 0 € » trompeur.');
console.log('\n  « −34 % vs juil » n\'est pas reprise : trois nombres sur une');
console.log('  ligne de 13 px, et une baisse de CA merite mieux qu\'un fragment.');
console.log('  Dites-le si vous la voulez.');
console.log('\n  A verifier sur telephone, cache vide : /calendrier.html');
console.log('  bhVerifEnteteCal()  — « ca_lu » et « sous_titre » doivent');
console.log('  porter le montant. S\'il manque, la carte CA n\'etait pas encore');
console.log('  remplie : collez-moi la sortie.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
