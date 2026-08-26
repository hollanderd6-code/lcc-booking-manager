#!/usr/bin/env node
/* ============================================================
   outils/tabbar-marge-reelle.js
   La barre se reservait une zone sure deja retiree du viewport
   ============================================================
   Cible : public/js/bh-layout.js

   ── CE QUE LES MESURES ONT MONTRE ────────────────────────────────
   Meme barre sur les deux pages : hauteur 102, padding-bottom 34,
   bottom 0. Elle est correctement ancree. Ce qui differe, c'est ce
   que le viewport inclut :

       document.documentElement.clientHeight ... 860   (les deux)
       env(safe-area-inset-top) ................ 8px   (les deux)
       env(safe-area-inset-bottom) ............. 34px  (les deux)

       app.html       innerHeight 902 = 860 + 8 + 34
       messages.html  innerHeight 868 = 860 + 8

   Sur messages.html la zone sure du bas est DEJA retiree du viewport.
   env() renvoie pourtant 34 px. La barre se reserve donc une marge
   pour une zone qui n'existe pas sur cette page : ses 102 px
   contiennent 34 px de vide en bas.

   La « bande » n'etait pas SOUS la barre : c'etait la barre. Sur
   app.html la meme marge existe, mais son fond est presque blanc et
   elle se confond avec le bas de l'ecran ; sur messages.html le fond
   est creme et la marge se lit comme une rupture.

   Trois de mes corrections precedentes visaient donc a cote : la
   position etait juste depuis l'ancrage, et la reserve de contenu ne
   changeait rien a une marge interieure a la barre.

   ── LA CORRECTION ────────────────────────────────────────────────
   1. La marge du bas est MESUREE, pas lue dans env() :

          reelle = innerHeight - clientHeight - envHaut

      app.html      902 - 860 - 8 = 34  -> marge 34
      messages.html 868 - 860 - 8 =  0  -> marge 0

      Aucune table de correspondance par page : la formule donne la
      bonne valeur partout, y compris sur les pages non testees et sur
      les modeles sans encoche (ou tout vaut 0).

   2. Le fond est pose en INLINE sur l'element. La feuille injectee
      etait bien presente, mais bh-v3-mobile.css cible
      « html[data-theme-v3="1"] .mobile-tabs » : specificite superieure,
      qu'aucun !important sur « .mobile-tabs » ne rattrape. Le style
      inline, lui, ne peut pas etre battu par une feuille. C'est deja
      le choix fait pour l'en-tete mobile dans normalizeBranding().

   Usage :
     node outils/tabbar-marge-reelle.js --essai
     node outils/tabbar-marge-reelle.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const MARQUE = 'marge du bas mesuree, pas lue dans env()';

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf(MARQUE) !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* La reserve de contenu posee par tabbar-fond-et-reserve.js reste : elle est
   juste, et elle mesure la barre — donc elle suivra la nouvelle hauteur.
   Seul le bloc de fond CSS devient inutile, la version inline le remplace.
   Je le laisse en place plutot que de le retirer : il ne nuit pas, et une
   suppression demanderait une ancre de plus a maintenir. */

const NORMALISE = `

/* ── Barre d'onglets : ` + MARQUE + ` ──────────
   Mesures relevees sur iPhone, application installee :

       clientHeight ........... 860   sur les deux pages
       env(...-top) ........... 8px   sur les deux pages
       env(...-bottom) ........ 34px  sur les deux pages
       innerHeight ............ 902 sur app.html, 868 sur messages.html

   868 = 860 + 8 : sur messages.html la zone sure du bas est deja retiree
   du viewport, alors qu'env() annonce toujours 34 px. La barre se
   reservait donc 34 px de vide en bas — c'etait cela, la « bande », et
   non un espace sous la barre. D'ou aussi le menu qui paraissait leve.

   On mesure la marge reellement necessaire au lieu de croire env(), et on
   pose le resultat en inline : bh-v3-mobile.css cible
   « html[data-theme-v3="1"] .mobile-tabs », plus specifique que la feuille
   injectee — seul l'inline l'emporte a coup sur. */
(function () {
  'use strict';

  var FOND = 'rgba(251,251,250,.92)';          // valeur d'app.html, jugee correcte
  var FLOU = 'saturate(1.8) blur(14px)';
  var FILET = '1px solid rgba(200,184,154,.28)';

  function nombre(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // env(safe-area-inset-top) n'est pas lisible directement : on le fait
  // resoudre par le moteur sur une sonde hors ecran.
  function insetHaut() {
    var sonde = document.createElement('div');
    sonde.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:env(safe-area-inset-top,0px);';
    document.body.appendChild(sonde);
    var v = nombre(getComputedStyle(sonde).top);
    sonde.remove();
    return v;
  }

  function normaliser() {
    var barre = document.querySelector('.mobile-tabs');
    if (!barre) return;

    var client = document.documentElement.clientHeight;
    var marge = Math.max(0, Math.round(window.innerHeight - client - insetHaut()));

    var s = barre.style;
    s.setProperty('padding-bottom', marge + 'px', 'important');
    s.setProperty('background', FOND, 'important');
    s.setProperty('-webkit-backdrop-filter', FLOU, 'important');
    s.setProperty('backdrop-filter', FLOU, 'important');
    s.setProperty('border-top', FILET, 'important');

    // La capsule glissante se dimensionne sur env() dans la feuille injectee.
    // Elle doit suivre la marge reelle, sinon elle depasse de la barre.
    var cap = barre.querySelector('.lg-capsule');
    if (cap) cap.style.setProperty('height', 'calc(100% - 12px - ' + marge + 'px)', 'important');

    if (barre.__lgSync) barre.__lgSync(false);   // repositionne la capsule
  }

  // La barre est creee par mobile-native-experience.js, apres bh-layout :
  // on attend qu'elle apparaisse, puis on suit les changements de viewport.
  function suivre() {
    if (document.querySelector('.mobile-tabs')) { normaliser(); return true; }
    return false;
  }

  function demarrer() {
    if (suivre()) return;
    var obs = new MutationObserver(function () { if (suivre()) obs.disconnect(); });
    obs.observe(document.body, { childList: true });
    setTimeout(function () { obs.disconnect(); suivre(); }, 4000);
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

  // bhDiagBarre() : les chiffres qui ont servi a la correction, relisibles
  // sur n'importe quelle page.
  window.bhDiagBarre = function () {
    var b = document.querySelector('.mobile-tabs');
    if (!b) return console.log('[BH] barre absente');
    var r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    var client = document.documentElement.clientHeight, haut = insetHaut();
    console.log('[BH]', location.pathname);
    console.log('[BH] viewport : innerHeight', window.innerHeight, '| clientHeight', client, '| inset haut', haut);
    console.log('[BH] marge bas: mesuree', Math.max(0, Math.round(window.innerHeight - client - haut)),
      '| env() annonce', cs.getPropertyValue('padding-bottom'), '| appliquee', b.style.paddingBottom);
    console.log('[BH] barre    : hauteur', Math.round(r.height), '| bas', Math.round(window.innerHeight - r.bottom),
      '| fond', cs.backgroundColor);
  };
})();
`;

src = src.replace(/\s*$/, '\n') + NORMALISE;

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf(MARQUE) === -1) echec('La correction n\'est pas dans le fichier apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Marge du bas mesuree : 34 px sur app.html, 0 sur messages.html.');
console.log('  Fond pose en inline, au-dessus de bh-v3-mobile.css.\n');
console.log('  C\'est une app Capacitor : le JS est empaquete dans l\'app.');
console.log('  git push ne suffit pas. Il faut :');
console.log('      npx cap sync ios   puis reconstruire depuis Xcode\n');
console.log('  Puis bhDiagBarre() en console sur les deux pages.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
