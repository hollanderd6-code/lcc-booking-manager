#!/usr/bin/env node
/* ============================================================
   outils/tabbar-minimal.js
   Retire tous mes ajouts et n'en garde qu'un seul, minimal
   ============================================================
   Cible : public/js/bh-layout.js

   ── POURQUOI CE SCRIPT ───────────────────────────────────────────
   J'ai empile des correctifs, et chacun a ajoute un probleme :

   - forcer height et min-height a 68 + marge : la hauteur de contenu
     n'est pas la meme sur toutes les pages, d'ou le decalage leger
     apparu PARTOUT, y compris sur app.html et reservations.html qui
     etaient corrects ;
   - imposer top et height a la capsule : elle ne suivait plus la
     boite reelle des boutons, d'ou « trop grand », puis « trop
     petit », puis le clignotement quand la barre la reecrivait.

   Rien de tout cela n'etait necessaire. Le seul defaut reel, mesure
   et confirme, est celui-ci :

       clientHeight ....... 860   sur toutes les pages
       env(...-bottom) .... 34px  sur toutes les pages
       innerHeight ........ 902 sur app.html, 868 sur messages.html

   868 = 860 + 8 : sur une partie des pages, WKWebView a DEJA retire la
   zone sure du viewport, alors qu'env() continue d'annoncer 34 px. La
   barre se reservait donc 34 px de vide en bas. C'etait la « bande ».

   ── CE QUI RESTE ─────────────────────────────────────────────────
   Une seule propriete est ecrite : padding-bottom, avec la marge
   REELLEMENT presente. La hauteur de la barre reste calculee par le
   navigateur (contenu + padding), la capsule garde son propre calcul
   en pourcentage, qui etait juste. Le fond n'est plus touche non plus :
   il ne differait que parce que la marge vide le rendait visible.

   Sur Android, innerHeight - clientHeight - insetHaut vaut toujours 0 :
   le calcul ne change rien et ne peut rien y casser.

   Usage :
     node outils/tabbar-minimal.js --essai
     node outils/tabbar-minimal.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const MARQUE = 'zone sure du bas : marge mesuree, rien d\'autre';

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');
const avant = src.length;

/* ── A. Couper tous mes ajouts ───────────────────────────────────
   Ils ont tous ete ajoutes en fin de fichier. On coupe au premier. */

const DEBUTS = [
  '\n\n/* ── Reserve de place sous la barre d\'onglets ──',
  '\n\n/* ── Barre d\'onglets : marge du bas mesuree',
  '\n\n/* ── barre d\'onglets : une seule correction',
  '\n\n/* ── ' + MARQUE
];
let coupe = -1;
for (const d of DEBUTS) {
  const i = src.indexOf(d);
  if (i !== -1 && (coupe === -1 || i < coupe)) coupe = i;
}
if (coupe === -1) {
  console.log('  Note : aucun ajout precedent trouve en fin de fichier.');
} else {
  src = src.slice(0, coupe);
}

// Le bloc de fond CSS, s'il traine encore dans la feuille injectee.
const FOND_CSS_DEBUT = `
      /* fond unique + reserve de la barre`;
if (src.indexOf(FOND_CSS_DEBUT) !== -1) {
  const i = src.indexOf(FOND_CSS_DEBUT);
  const fin = src.indexOf(`'}' +`, i);
  if (fin !== -1) src = src.slice(0, i) + src.slice(fin + 5);
}

// Garde-fou : l'ancrage, qui etait juste, doit rester.
if (src.indexOf('bottom:0!important;left:0!important;right:0!important;') === -1) {
  echec('La regle d\'ancrage a disparu — le fichier n\'est pas dans l\'etat attendu.\n      git checkout public/js/bh-layout.js puis relancez.');
}

/* ── B. Le minimum ───────────────────────────────────────────── */

const BLOC = `

/* ── ` + MARQUE + ` ────────────────
   Sur une partie des pages, WKWebView retire deja la zone sure du bas du
   viewport, mais env(safe-area-inset-bottom) annonce toujours 34 px :

       clientHeight ....... 860   partout
       innerHeight ........ 902 sur app.html, 868 sur messages.html
       868 = 860 + 8 (inset haut) : le bas n'y est pas.

   La barre gardait donc 34 px de vide en bas — c'etait la bande unie, et
   la raison pour laquelle le menu paraissait leve.

   On ecrit UNE seule propriete : padding-bottom, avec la marge reellement
   presente. La hauteur de la barre reste calculee par le navigateur et la
   capsule garde son propre calcul : y toucher decalait la mise en page sur
   les pages qui etaient correctes.

   L'inline est necessaire : bh-v3-mobile.css cible
   « html[data-theme-v3="1"] .mobile-tabs », plus specifique qu'une feuille
   injectee. Meme choix que normalizeBranding() pour l'en-tete. */
(function () {
  'use strict';

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
    if (barre.__bhMarge === marge) return;         // rien a faire, on ne remue pas la mise en page
    barre.__bhMarge = marge;
    barre.style.setProperty('padding-bottom', marge + 'px', 'important');
    if (barre.__lgSync) barre.__lgSync(false);     // la capsule se repositionne elle-meme
  }

  function demarrer() {
    if (document.querySelector('.mobile-tabs')) { normaliser(); return; }
    // La barre est creee par mobile-native-experience.js, plus profond que
    // body : subtree est indispensable, sinon rien n'est vu.
    var obs = new MutationObserver(function () {
      if (document.querySelector('.mobile-tabs')) { obs.disconnect(); normaliser(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); normaliser(); }, 1500);
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
    console.log('[BH] innerHeight', window.innerHeight, '| clientHeight', client, '| inset haut', haut);
    console.log('[BH] marge mesuree', Math.max(0, Math.round(window.innerHeight - client - haut)),
      '| appliquee', b.style.paddingBottom, '| env() annonce 34px');
    console.log('[BH] barre hauteur', Math.round(r.height), '| bas', Math.round(window.innerHeight - r.bottom),
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
  if (relu.indexOf('CAPSULE_INSET') !== -1) echec('Un ancien bloc capsule est toujours present.');
  if (relu.indexOf('__bhCapsuleSurveillee') !== -1) echec('L\'observateur de capsule est toujours present.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Tous mes ajouts precedents retires.');
console.log('  Il ne reste que padding-bottom, avec la marge mesuree.');
console.log('  Ni height, ni min-height, ni fond, ni geometrie de capsule :');
console.log('  c\'est ce qui decalait les pages deja correctes.\n');
console.log('  npx cap sync ios, puis reconstruire depuis Xcode.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
