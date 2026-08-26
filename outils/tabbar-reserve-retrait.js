#!/usr/bin/env node
/* ============================================================
   outils/tabbar-reserve-retrait.js
   Retour en arrière : ma réserve n'a rien résolu
   ============================================================
   Cible : public/js/bh-layout.js

   ── POURQUOI JE LA RETIRE ────────────────────────────────────────
   J'ai pose une reserve de place en bas de page, en croyant que le
   contenu passait sous la barre. Deux faits l'ont dementie :

     · le defaut que vous voyez est toujours la ;
     · le haut de la barre est passe de 800 a 766 px — un decalage de
       34 px, soit exactement la hauteur de la zone sure, introduit par
       ma correction.

   Une correction qui ne resout pas le defaut ET deplace autre chose
   n'a pas a rester : elle rend le diagnostic suivant plus difficile.

   L'ancrage « bottom:0 », lui, reste : la mesure a confirme qu'il place
   la barre au bas de la fenetre sur toutes les pages.

   Usage :
     node outils/tabbar-reserve-retrait.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('reserverPlaceTabbar') === -1) {
  console.log('\n  La reserve n\'est pas presente — rien a faire.\n');
  process.exit(0);
}

/* L'appel */
const A_APPEL = `
    reserverPlaceTabbar();
  }`;
if (src.split(A_APPEL).length - 1 === 1) src = src.split(A_APPEL).join(`
  }`);

/* La fonction : du commentaire d'ouverture jusqu'a l'accolade equilibree. */
const debutC = src.indexOf('  /* La barre flotte au-dessus du contenu');
const debutF = src.indexOf('  function reserverPlaceTabbar()');
if (debutF === -1) echec('Fonction reserverPlaceTabbar introuvable.');

let prof = 0, fin = -1;
for (let k = src.indexOf('{', debutF); k < src.length; k++) {
  if (src[k] === '{') prof++;
  else if (src[k] === '}') { prof--; if (prof === 0) { fin = k; break; } }
}
if (fin === -1) echec('Fin de la fonction introuvable.');

const depart = debutC !== -1 && debutC < debutF ? debutC : debutF;
src = src.slice(0, depart) + src.slice(fin + 1).replace(/^\s*\n/, '\n');

try { new Function(src); }
catch (e) { echec('JavaScript invalide — ' + e.message); }

if (src.indexOf('reserverPlaceTabbar') !== -1) echec('Une reference subsiste.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('reserverPlaceTabbar') !== -1) {
    echec('Le retrait n\'est pas effectif apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI —' : '— RETIRE ET VERIFIE —'));
console.log('  La reserve est retiree. L\'ancrage bottom:0 reste en place.\n');
console.log('  Pensez a supprimer la regle residuelle dans le navigateur :');
console.log('    document.getElementById(\'lg-tabbar-reserve\')?.remove()');
console.log('  ou rechargez avec Cmd+Maj+R.\n');
