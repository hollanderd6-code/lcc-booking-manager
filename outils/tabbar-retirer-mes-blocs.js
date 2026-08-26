#!/usr/bin/env node
/* ============================================================
   outils/tabbar-retirer-mes-blocs.js
   La correction native rend mon JS inutile
   ============================================================
   Cible : public/js/bh-layout.js

   ── POURQUOI ─────────────────────────────────────────────────────
   Le defaut n'etait ni dans le meta, ni dans le fond, ni dans la
   capsule : c'etait « contentInset: automatic » dans
   capacitor.config.json. WKWebView retirait lui-meme la zone sure du
   viewport pendant qu'env(safe-area-inset-bottom) annoncait toujours
   34 px — d'ou le double comptage, la bande, et le menu qui paraissait
   leve. Corrige en natif par « contentInset: never ».

   Depuis ce changement, env() est exact et le CSS d'origine se suffit.
   Mon bloc JS continue pourtant d'ecrire padding-bottom en inline
   par-dessus : c'est lui qui decale desormais les icones vers le bas,
   alors que la capsule, elle, est bien placee.

   On le retire donc entierement. La barre revient a son CSS d'origine
   — celui qui etait juste — avec un viewport qui, cette fois, dit la
   verite.

   Usage :
     node outils/tabbar-retirer-mes-blocs.js --essai
     node outils/tabbar-retirer-mes-blocs.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');
const avant = src.length;

/* Tous mes ajouts ont ete mis en fin de fichier. On coupe au premier
   d'entre eux, quel qu'il soit. */
const DEBUTS = [
  '\n\n/* ── Reserve de place sous la barre d\'onglets ──',
  '\n\n/* ── Barre d\'onglets : marge du bas mesuree',
  '\n\n/* ── barre d\'onglets : une seule correction',
  '\n\n/* ── zone sure du bas : marge mesuree, rien d\'autre'
];

let coupe = -1;
for (const d of DEBUTS) {
  const i = src.indexOf(d);
  if (i !== -1 && (coupe === -1 || i < coupe)) coupe = i;
}

if (coupe === -1) {
  echec('Aucun de mes blocs trouve en fin de fichier — rien a retirer.\n      Envoyez : tail -40 public/js/bh-layout.js');
}

src = src.slice(0, coupe).replace(/\s*$/, '\n');

/* Le bloc de fond CSS, s'il traine encore dans la feuille injectee. */
const FOND_DEBUT = `
      /* fond unique + reserve de la barre`;
if (src.indexOf(FOND_DEBUT) !== -1) {
  const i = src.indexOf(FOND_DEBUT);
  const fin = src.indexOf(`'}' +`, i);
  if (fin !== -1) src = src.slice(0, i) + src.slice(fin + 5);
}

/* Garde-fous : ce qui doit rester. */
if (src.indexOf('bottom:0!important;left:0!important;right:0!important;') === -1) {
  echec('La regle d\'ancrage a disparu — le fichier n\'est pas dans l\'etat attendu.\n      git checkout public/js/bh-layout.js puis relancez.');
}
if (src.indexOf('.mobile-tabs .lg-capsule{') === -1) {
  echec('Le CSS de la capsule a disparu — arret.');
}

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('bhDiagBarre') !== -1) echec('Un de mes blocs est toujours present.');
  if (relu.indexOf('CAPSULE_INSET') !== -1) echec('Un ancien bloc capsule est toujours present.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  ' + (avant - src.length) + ' caracteres retires : tous mes ajouts JS.');
console.log('  La barre revient a son CSS d\'origine.');
console.log('  La correction reelle est en natif : contentInset never.\n');
console.log('  npx cap sync ios, puis reconstruire depuis Xcode.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
