#!/usr/bin/env node
/* ============================================================
   outils/tabbar-retour-au-net.js
   Retire mes trois ajouts et pose une seule correction
   ============================================================
   Cible : public/js/bh-layout.js

   ── CE QUI S'EST PASSE ───────────────────────────────────────────
   J'ai empile trois correctifs sur un diagnostic qui n'etait juste
   qu'au troisieme. Les deux premiers ont laisse des degats :

   1. tabbar-fond-et-reserve.js posait une « reserve de place » sur un
      conteneur choisi par tatonnement. Sur cleaning.html elle tombe sur
      un element qui ne defile pas : d'ou le vide creme sous le
      formulaire, coupe en pleine hauteur.

   2. Le meme script ecrivait le fond en CSS. Inutile : bh-v3-mobile.css
      cible « html[data-theme-v3="1"] .mobile-tabs », plus specifique.

   3. tabbar-marge-reelle.js a bien trouve la cause — la barre se
      reservait une zone sure deja retiree du viewport — mais en passant
      la marge a 0 la barre tombe a 68 px, tandis que la capsule et les
      boutons restaient calcules sur 102. D'ou la capsule qui deborde
      par le haut.

   Les mesures qui restent vraies, et sur lesquelles repose la suite :

       clientHeight ....... 860   sur toutes les pages
       env(...-top) ....... 8px   sur toutes les pages
       env(...-bottom) .... 34px  sur toutes les pages
       innerHeight ........ 902 sur app.html, 868 sur messages.html

   868 = 860 + 8 : la zone sure du bas est deja hors du viewport sur
   certaines pages, et env() l'annonce quand meme.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   A. Il RETIRE mes trois ajouts (bloc de fond CSS, reserve de place,
      normalisation de marge). bh-layout.js revient a l'etat laisse par
      tabbar-ancrage.js, qui etait juste.

   B. Il pose UN bloc unique qui, a chaque changement de viewport :

      - mesure la zone sure reellement presente :
            marge = innerHeight - clientHeight - insetHaut
      - garde une HAUTEUR DE CONTENU CONSTANTE de 68 px, quelle que
        soit la page : la barre fait 102 px la ou la zone sure est
        incluse, 68 la ou elle ne l'est pas, et les onglets tombent au
        meme endroit par rapport au bas de l'ecran dans les deux cas ;
      - accorde la capsule glissante a la boite reelle de la barre,
        au lieu de la laisser sur un calcul en env() ;
      - pose le fond en inline, seul moyen de passer devant
        bh-v3-mobile.css.

      Aucune reserve de place sur le contenu : c'etait mon erreur, et
      les pages qui en ont besoin la definissent deja elles-memes.

   Usage :
     node outils/tabbar-retour-au-net.js --essai
     node outils/tabbar-retour-au-net.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const MARQUE = 'barre d\'onglets : une seule correction';

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');
const avant = src.length;

if (src.indexOf(MARQUE) !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── A. Retirer mes ajouts ───────────────────────────────────────
   Les deux IIFE ont ete ajoutees en fin de fichier, dans cet ordre.
   On coupe a la premiere des deux : tout ce qui suit est de moi. */

const DEBUT_IIFE = [
  '\n\n/* ── Reserve de place sous la barre d\'onglets ──',
  '\n\n/* ── Barre d\'onglets : marge du bas mesuree'
];
let coupe = -1;
for (const d of DEBUT_IIFE) {
  const i = src.indexOf(d);
  if (i !== -1 && (coupe === -1 || i < coupe)) coupe = i;
}
if (coupe !== -1) src = src.slice(0, coupe);

// Le bloc de fond CSS, insere dans la feuille injectee.
const FOND_CSS = `
      /* fond unique + reserve de la barre — chaque page definissait son fond :
         le plus opaque (rgba(245,242,236,.97)) transformait les 34 px de zone
         sure en bande unie et le menu paraissait leve, alors qu'il etait au
         meme endroit. Valeur retenue : celle d'app.html. Le fond de la barre
         couvre deja la zone sure, via son padding-bottom pose juste au-dessus. */
      '.mobile-tabs{' +
        'background:rgba(251,251,250,.92)!important;' +
        '-webkit-backdrop-filter:saturate(1.8) blur(14px)!important;' +
        'backdrop-filter:saturate(1.8) blur(14px)!important;' +
        'border-top:1px solid rgba(200,184,154,.28)!important;' +
      '}' +`;

if (src.indexOf(FOND_CSS) !== -1) {
  src = src.split(FOND_CSS).join('');
} else {
  console.log('  Note : bloc de fond CSS deja absent — je continue.');
}

// Garde-fou : l'ancrage, qui etait juste, doit toujours etre la.
if (src.indexOf('bottom:0!important;left:0!important;right:0!important;') === -1) {
  echec('La regle d\'ancrage a disparu — le fichier n\'est pas dans l\'etat attendu.\n      Restaurez-le (git checkout public/js/bh-layout.js) et relancez.');
}

/* ── B. Une seule correction ─────────────────────────────────── */

const BLOC = `

/* ── ` + MARQUE + ` ───────────────────────────
   La barre se reservait une zone sure deja retiree du viewport sur une
   partie des pages :

       clientHeight ....... 860   partout
       env(...-bottom) .... 34px  partout
       innerHeight ........ 902 sur app.html, 868 sur messages.html

   868 = 860 + 8 (inset haut) : le bas n'y est pas, mais env() l'annonce.
   La barre gardait donc 34 px de vide en bas — c'etait la « bande », et
   non un espace sous la barre.

   On mesure la zone sure REELLEMENT presente, et on garde une hauteur de
   CONTENU constante : les onglets tombent au meme endroit par rapport au
   bas de l'ecran sur toutes les pages, que la marge vaille 34 ou 0.

   Tout est pose en inline : bh-v3-mobile.css cible
   « html[data-theme-v3="1"] .mobile-tabs », plus specifique que la feuille
   injectee — un !important n'y suffit pas. Meme choix que pour l'en-tete
   mobile dans normalizeBranding(). */
(function () {
  'use strict';

  var CONTENU = 68;                             // hauteur des onglets, hors zone sure
  var CAPSULE_H = 44;                           // hauteur de la capsule (valeur retenue a l'essai)
  var CAPSULE_HAUT = 12;                        // son decalage depuis le haut de la barre
  var FOND = 'rgba(251,251,250,.92)';           // valeur d'app.html, jugee correcte
  var FLOU = 'saturate(1.8) blur(14px)';
  var FILET = '1px solid rgba(200,184,154,.28)';

  function insetHaut() {
    // env() n'est pas lisible en JS : on le fait resoudre sur une sonde.
    var sonde = document.createElement('div');
    sonde.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:env(safe-area-inset-top,0px);';
    document.body.appendChild(sonde);
    var v = parseFloat(getComputedStyle(sonde).top);
    sonde.remove();
    return isNaN(v) ? 0 : v;
  }

  function normaliser() {
    var barre = document.querySelector('.mobile-tabs');
    if (!barre) return;

    var marge = Math.max(0, Math.round(
      window.innerHeight - document.documentElement.clientHeight - insetHaut()
    ));

    var s = barre.style;
    s.setProperty('box-sizing', 'border-box', 'important');
    s.setProperty('height', (CONTENU + marge) + 'px', 'important');
    s.setProperty('min-height', (CONTENU + marge) + 'px', 'important');
    s.setProperty('padding-top', '8px', 'important');
    s.setProperty('padding-bottom', marge + 'px', 'important');
    s.setProperty('background', FOND, 'important');
    s.setProperty('-webkit-backdrop-filter', FLOU, 'important');
    s.setProperty('backdrop-filter', FLOU, 'important');
    s.setProperty('border-top', FILET, 'important');

    // La capsule etait calculee en env() : sur les pages ou la marge vaut 0
    // elle depassait par le haut. On l'accorde a la boite reelle.
    var cap = barre.querySelector('.lg-capsule');
    if (cap) {
      cap.style.setProperty('top', CAPSULE_HAUT + 'px', 'important');
      cap.style.setProperty('height', CAPSULE_H + 'px', 'important');
    }
    if (barre.__lgSync) barre.__lgSync(false);
  }

  function demarrer() {
    if (document.querySelector('.mobile-tabs')) { normaliser(); return; }
    // La barre est creee par mobile-native-experience.js, apres bh-layout.
    var obs = new MutationObserver(function () {
      if (document.querySelector('.mobile-tabs')) { obs.disconnect(); normaliser(); }
    });
    obs.observe(document.body, { childList: true });
    setTimeout(function () { obs.disconnect(); normaliser(); }, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }

  window.addEventListener('resize', normaliser);
  window.addEventListener('pageshow', normaliser);
  window.addEventListener('orientationchange', function () { setTimeout(normaliser, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', normaliser);

  window.bhDiagBarre = function () {
    var b = document.querySelector('.mobile-tabs');
    if (!b) return console.log('[BH] barre absente');
    var r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    var client = document.documentElement.clientHeight, haut = insetHaut();
    console.log('[BH]', location.pathname);
    console.log('[BH] viewport : innerHeight', window.innerHeight, '| clientHeight', client, '| inset haut', haut);
    console.log('[BH] marge bas: mesuree', Math.max(0, Math.round(window.innerHeight - client - haut)),
      '| appliquee', b.style.paddingBottom, '| env() annoncait 34px');
    console.log('[BH] barre    : hauteur', Math.round(r.height), '| bas', Math.round(window.innerHeight - r.bottom),
      '| fond', cs.backgroundColor);
  };
})();
`;

src = src.replace(/\s*$/, '\n') + BLOC;

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf(MARQUE) === -1) echec('La correction n\'est pas dans le fichier apres ecriture.');
  if (relu.indexOf('Reserve de place sous la barre') !== -1) echec('La reserve de place est toujours presente.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Mes trois ajouts retires (' + (avant - src.length + BLOC.length) + ' caracteres nets).');
console.log('  Une seule correction : hauteur de contenu constante, marge mesuree,');
console.log('  capsule accordee a la boite reelle, fond en inline.');
console.log('  Plus aucune reserve de place posee sur le contenu des pages.\n');
console.log('  App Capacitor : npx cap sync ios, puis reconstruire depuis Xcode.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
