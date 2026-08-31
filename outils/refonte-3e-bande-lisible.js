#!/usr/bin/env node
/* ============================================================
   outils/refonte-3e-bande-lisible.js
   Lot 3e : deux defauts de rendu
   ============================================================

   La bande dit enfin quelque chose : 7, 7, 8, 14, 15, 18, 15. Le trou
   de vendredi-samedi se voit sans reflechir. Restent deux defauts.

   ── 1. LA JAUGE DE FOND EST AMBIGUE ──────────────────────────────
   Un fond partiellement teinte ne dit pas de quel cote lire. Sur votre
   capture, impossible de savoir si le vert clair represente la part
   occupee ou la part libre — et une jauge qu'on doit interpreter ne
   vaut pas mieux que pas de jauge.

   Elle est remplacee par une barre explicite sous le chiffre, dont la
   LARGEUR est la part occupee. Une barre pleine a droite, un vide a
   gauche : le sens de lecture est celui de l'ecriture, il n'y a plus
   rien a deviner.

   ── 2. LE TRAIT DE DEPART FLOTTE ─────────────────────────────────
   Pose en haut avec un coin arrondi et un debordement masque, il
   ressemble a une pastille detachee, coupee par le bord. Il descend en
   bas de case, sur toute la largeur : une soulignure, pas un objet.

   Aucun chiffre ne change. C'est du rendu, rien d'autre.

   Usage :
     node outils/refonte-3e-bande-lisible.js --essai
     node outils/refonte-3e-bande-lisible.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-bande-jours.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-bande-jours.js introuvable.');

let src = fs.readFileSync(CIBLE, 'utf8');
if (src.indexOf('parcTotal') === -1) echec('Lancez d\'abord refonte-3d-bande-utile.js.');

if (src.indexOf('barreOccup') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. La jauge de fond disparait ───────────────────────────── */

remplacer(
`      if (parc) {
        var jauge = document.createElement('div');
        jauge.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:' + Math.round(part * 100) + '%'
          + ';background:' + (estAuj ? 'rgba(143,211,180,.20)' : 'rgba(46,139,98,.13)')
          + ';pointer-events:none';
        cell.insertBefore(jauge, cell.firstChild);
      }`,
`      /* Une barre explicite, sous le chiffre : sa LARGEUR est la part
         occupee. Le sens de lecture est celui de l'ecriture — plus rien
         a interpreter, contrairement a un fond teinte. */
      if (parc) {
        var rail = document.createElement('div');
        rail.style.cssText = 'margin:5px auto 0;width:24px;height:3px;border-radius:2px'
          + ';background:' + (estAuj ? 'rgba(255,255,255,.22)' : '#E4E1D8') + ';overflow:hidden';
        var barreOccup = document.createElement('div');
        barreOccup.style.cssText = 'height:100%;width:' + Math.round(part * 100) + '%'
          + ';border-radius:2px;background:' + (estAuj ? '#8FD3B4' : VERT_CLAIR);
        rail.appendChild(barreOccup);
        cell.appendChild(rail);
      }`,
  'la jauge de fond'
);

/* ── 2. Le trait de depart devient une soulignure ───────────── */

remplacer(
`      if (depart) {
        var trait = document.createElement('div');
        trait.style.cssText = 'position:absolute;top:0;left:50%;transform:translateX(-50%)'
          + ';width:16px;height:3px;border-radius:0 0 3px 3px;background:' + AMBRE;
        cell.appendChild(trait);
      }`,
`      if (depart) {
        var trait = document.createElement('div');
        trait.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:3px;background:' + AMBRE;
        cell.appendChild(trait);
      }`,
  'le trait de depart'
);

/* ── 3. La place du chiffre et de la barre ───────────────────── */
/* La case gagne 3 px en bas pour que la soulignure ne touche pas la
   barre d'occupation. */

remplacer(
  "      cell.style.cssText = 'position:relative;overflow:hidden;text-align:center;padding:7px 0 8px'",
  "      cell.style.cssText = 'position:relative;overflow:hidden;text-align:center;padding:7px 0 11px'",
  'le padding de la case'
);

/* ── 4. La legende decrit la barre ───────────────────────────── */

remplacer(
  "      + '<span style=\"width:11px;height:3px;border-radius:2px;background:' + AMBRE + '\"></span>départ ce jour-là</span>'",
  "      + '<span style=\"width:11px;height:3px;border-radius:2px;background:' + AMBRE + '\"></span>départ ce jour-là</span>'\n"
  + "      + (parcConnu ? '<span style=\"display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '\">'\n"
  + "          + '<span style=\"width:11px;height:3px;border-radius:2px;background:' + VERT_CLAIR + '\"></span>part occupée</span>' : '')",
  'la legende'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la barre d\'occupation', 'var barreOccup = document.createElement'],
  ['sa largeur proportionnelle', "';border-radius:2px;background:'"],
  ['le rail', "rail.style.cssText = 'margin:5px auto 0"],
  ['la soulignure de depart', "'position:absolute;left:0;right:0;bottom:0;height:3px;background:'"],
  ['la legende de la barre', 'part occupée</span>'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

if (src.indexOf('rgba(46,139,98,.13)') !== -1) echec('La jauge de fond subsiste. Refus.');
if (src.indexOf("border-radius:0 0 3px 3px") !== -1) echec('L\'ancien trait de depart subsiste. Refus.');

try {
  new Function(src);
} catch (e) {
  echec('Le module ne serait plus du JavaScript valide — ' + e.message);
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('barreOccup') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  La jauge de fond devient une barre sous le chiffre : sa LARGEUR');
console.log('  est la part occupee. Plein a gauche, vide a droite.');
console.log('  Le trait de depart devient une soulignure en bas de case.');
console.log('\n  Aucun chiffre ne change : 7, 7, 8, 14, 15, 18, 15.');
console.log('\n  A verifier : la barre de samedi doit etre visiblement plus courte');
console.log('  que celle de lundi — 8 logements pris sur 26 contre 19.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
