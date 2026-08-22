#!/usr/bin/env node
/* ============================================================
   outils/majoration-champ-largeur.js
   Le champ de majoration coupait « 15 » à l'affichage
   ============================================================
   Cible : public/js/bh-ota-connect.js

   Le champ fait 54 px de large, avec 7 px de marge intérieure de
   chaque côté. Un type="number" réserve en plus la place des flèches
   de réglage : il reste une dizaine de pixels utiles, assez pour un
   chiffre, pas pour deux. « 15 » apparaissait tronqué.

   Deux corrections :
     — largeur portée à 68 px, marge intérieure resserrée ;
     — flèches de réglage supprimées. Elles ne servent à rien pour un
       pourcentage saisi au clavier, et c'est elles qui mangeaient la
       place. La saisie reste numérique (inputmode="decimal"), donc le
       pavé numérique sort toujours sur mobile.

   Usage :
     node outils/majoration-champ-largeur.js --essai
     node outils/majoration-champ-largeur.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable. Lancez depuis la racine.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('bhMajChamp') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. La largeur du champ ──────────────────────────────────────── */
edits.push([
  'largeur du champ',
  `'style="width:54px;padding:7px;border:1px solid '`,
  `'class="bhMajChamp" style="width:68px;padding:7px 6px;border:1px solid '`
]);

/* ── 2. Les fleches de reglage, dans le bloc de styles deja injecte ── */
edits.push([
  'suppression des fleches',
  `st.textContent = '@keyframes bhspin{to{transform:rotate(360deg)}}';`,
  `st.textContent = '@keyframes bhspin{to{transform:rotate(360deg)}}' +
      /* Les fleches d'un input number mangent la moitie de la largeur
         utile : sans elles, « 15 » tient sans etre coupe. */
      '.bhMajChamp{-moz-appearance:textfield;appearance:textfield;}' +
      '.bhMajChamp::-webkit-outer-spin-button,.bhMajChamp::-webkit-inner-spin-button' +
      '{-webkit-appearance:none;appearance:none;margin:0;}';`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Champ elargi a 68 px, fleches de reglage supprimees.');
console.log('  « 15 » s\'affiche en entier.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
