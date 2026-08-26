#!/usr/bin/env node
/* ============================================================
   outils/tabbar-ancrage.js
   La barre d'onglets flottait au lieu d'être ancrée en bas
   ============================================================
   Cible : public/js/bh-layout.js  (ligne ~1452)

   ── LA CAUSE ─────────────────────────────────────────────────────
   La seule regle qui positionne la barre est celle-ci :

       .mobile-tabs{position:fixed!important;z-index:10001!important;
                    pointer-events:auto!important;touch-action:none!important;}

   « position:fixed » SANS « bottom » ni « top ». Un element fixe sans
   point d'ancrage reste a la place qu'il occupait dans le flux du
   document — il ne descend pas au bas de l'ecran.

   D'ou la difference entre les pages : sur app.html, le contenu est
   assez long pour pousser la barre jusqu'en bas, et elle parait juste.
   Sur messages.html, elle se figeait la ou le flux l'avait laissee,
   c'est-a-dire quarante pixels trop haut, avec une bande ivoire dessous.

   Le meme symptome sur toutes les pages sauf deux n'etait donc pas un
   defaut de ces pages-la : c'etait l'absence d'ancrage, revelee par la
   longueur du contenu.

   ── LA CORRECTION ────────────────────────────────────────────────
       bottom:0; left:0; right:0;
       padding-bottom:env(safe-area-inset-bottom,0px);

   La barre s'ancre au bas de la fenetre, et la zone sure de l'iPhone
   entre dans sa marge interieure au lieu de la repousser. C'est la meme
   correction qu'hier sur le portail Locamp — pour la meme raison.

   « bottom » et « padding-bottom » sont poses en !important, comme les
   autres declarations du bloc : la regle vit dans une feuille injectee
   qui doit l'emporter sur les styles de page.

   ── CE QUI N'EST PAS TOUCHE ──────────────────────────────────────
   La reserve de 74 px que app.html applique a ses conteneurs reste :
   elle empeche le contenu de finir sous la barre, et c'est correct. Les
   autres pages en auraient besoin aussi — mais c'est un second sujet,
   qui se verra une fois la barre a sa place.

   Usage :
     node outils/tabbar-ancrage.js --essai
     node outils/tabbar-ancrage.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('/* ancrage bas */') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `      '.mobile-tabs{position:fixed!important;z-index:10001!important;pointer-events:auto!important;touch-action:none!important;}' +`;

const NOUVEAU = `      /* ancrage bas — « position:fixed » sans « bottom » laisse l'element a sa
         place dans le flux : la barre se figeait ou le contenu l'avait laissee,
         d'ou une bande vide dessous sur les pages courtes. La zone sure entre
         dans la marge interieure plutot que de repousser la barre. */
      '.mobile-tabs{position:fixed!important;bottom:0!important;left:0!important;right:0!important;' +
        'padding-bottom:env(safe-area-inset-bottom,0px)!important;' +
        'z-index:10001!important;pointer-events:auto!important;touch-action:none!important;}' +`;

if (src.split(ANCIEN).length - 1 !== 1) {
  echec('Regle .mobile-tabs introuvable. Le fichier a change.');
}
src = src.split(ANCIEN).join(NOUVEAU);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('/* ancrage bas */') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  La barre s\'ancre en bas de la fenetre sur toutes les pages.');
console.log('  La zone sure de l\'iPhone entre dans sa marge interieure.\n');
console.log('  Rechargez avec Cmd+Maj+R : bh-layout.js est mis en cache.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
