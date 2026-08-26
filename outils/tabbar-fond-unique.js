#!/usr/bin/env node
/* ============================================================
   outils/tabbar-fond-unique.js
   La barre avait un fond différent selon la page
   ============================================================
   Cible : public/js/bh-layout.js

   ── CE QUE LES MESURES ONT FINI PAR MONTRER ──────────────────────
   Le fond de la barre n'est pas le meme partout :

       app.html        rgba(251, 251, 250, 0.92)
       messages.html   rgba(245, 242, 236, 0.97)

   Chaque page definit le sien. Deux consequences se combinent :

   1. Sur app.html, la barre est franchement translucide et le contenu
      defile dessous : les 34 px de zone sure laissent voir la page, et
      rien ne ressemble a une bande vide.

   2. Sur messages.html, la liste s'arrete a sa propre hauteur et la
      barre est presque opaque : la zone sure devient une bande unie.
      Le menu parait « leve », alors qu'il est au meme endroit — les
      mesures donnaient bottom:0 et rectBas:0 sur les deux pages.

   C'est ce qui m'a egare : le defaut se voit sur la barre, mais ne
   vient pas de sa position. J'ai corrige son ancrage, puis pose une
   reserve de place, avant de mesurer la seule chose qui differait.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Le fond est defini UNE FOIS, dans le composant partage, et l'emporte
   sur celui des pages. La valeur retenue est celle d'app.html — la page
   que vous jugez correcte.

   La zone sure recoit le meme fond que la barre, en degrade vers
   l'opaque : la bande cesse d'etre une rupture et devient le pied de la
   barre. C'est ce que fait iOS sur ses propres barres d'onglets.

   Je ne touche pas au fond des PAGES : uniformiser la barre suffit, et
   modifier vingt pages pour un defaut visible sur la barre serait
   disproportionne.

   Usage :
     node outils/tabbar-fond-unique.js --essai
     node outils/tabbar-fond-unique.js
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

if (src.indexOf('fond unique de la barre') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCRE = `      '.mobile-tabs{position:fixed!important;z-index:10001!important;pointer-events:auto!important;touch-action:none!important;}' +`;

if (src.split(ANCRE).length - 1 !== 1) {
  echec('Regle .mobile-tabs introuvable. Appliquez d\'abord outils/tabbar-ancrage.js.');
}

const NOUVEAU = ANCRE + `
      /* Fond unique de la barre. Chaque page definissait le sien : le plus
         opaque transformait les 34 px de zone sure en bande unie, et le menu
         paraissait leve alors qu'il etait au meme endroit. La valeur retenue
         est celle d'app.html. */
      '.mobile-tabs{' +
        'background:rgba(251,251,250,.92)!important;' +
        '-webkit-backdrop-filter:saturate(1.8) blur(14px)!important;' +
        'backdrop-filter:saturate(1.8) blur(14px)!important;' +
        'border-top:1px solid rgba(200,184,154,.28)!important;' +
      '}' +
      /* La zone sure prend le fond de la barre, en fondu vers l'opaque :
         elle devient le pied de la barre au lieu d'une rupture. C'est le
         traitement qu'iOS applique a ses propres barres d'onglets. */
      '.mobile-tabs::after{' +
        'content:""!important;display:block!important;position:absolute!important;' +
        'left:0!important;right:0!important;top:100%!important;' +
        'height:env(safe-area-inset-bottom,0px)!important;' +
        'background:linear-gradient(rgba(251,251,250,.92),rgba(251,251,250,1))!important;' +
        'pointer-events:none!important;' +
      '}' +`;

src = src.split(ANCRE).join(NOUVEAU);

try { new Function(src); }
catch (e) { echec('JavaScript invalide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('fond unique de la barre') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Fond de la barre defini une fois, pour toutes les pages.');
console.log('  La zone sure devient le pied de la barre, en fondu.\n');
console.log('  Une reserve : bh-layout.js masque deja « .mobile-tabs::after »');
console.log('  sur les ecrans etroits. Si la bande reste visible, c\'est cette');
console.log('  regle qui gagne — dites-le-moi, le pseudo-element devra passer');
console.log('  sur un enfant reel de la barre.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
