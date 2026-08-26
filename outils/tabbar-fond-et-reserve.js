#!/usr/bin/env node
/* ============================================================
   outils/tabbar-fond-et-reserve.js
   Reprise de tabbar-fond-unique.js, qui n'avait rien ecrit
   ============================================================
   Cible : public/js/bh-layout.js

   ── POURQUOI LA BANDE EST TOUJOURS LA ────────────────────────────
   tabbar-fond-unique.js s'accroche a cette regle :

       '.mobile-tabs{position:fixed!important;z-index:10001!important;
                     pointer-events:auto!important;touch-action:none!important;}'

   Or tabbar-ancrage.js l'avait deja remplacee la veille par la version
   ancree (bottom:0, padding-bottom:env(...)). L'ancre n'existait donc
   plus : le script est sorti en echec et n'a rien ecrit. Le fond est
   reste defini page par page. Le commit ne portait que l'outil.

   Deux details releves au passage, pour memoire :

   1. tabbar-ancrage.js verifie son travail en cherchant un commentaire
      « ancrage bas » ferme aussitot, alors qu'il ecrit « ancrage bas — ... ».
      Il annonce un echec apres une ecriture reussie. L'ancrage est en place.

   2. Le ::after en degrade etait inutile. La barre porte deja
      padding-bottom:env(safe-area-inset-bottom) : son propre fond peint
      la zone sure. Un ::after pose a top:100% se placait SOUS bottom:0,
      donc hors ecran. Il n'est pas repris ici.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   A. Le fond de la barre est defini UNE FOIS, dans la feuille injectee,
      avec la valeur d'app.html — la page que vous jugez correcte. La
      regle vit dans une feuille ajoutee au head a l'execution : a
      specificite egale, elle passe apres celle des pages.

   B. La reserve de place, annoncee comme « second sujet » par
      tabbar-ancrage.js, est posee pour toutes les pages. C'est elle qui
      manquait : app.html reserve 74 px a ses conteneurs, messages.html
      rien. La liste s'arretait a sa propre hauteur, et les 34 px de zone
      sure devenaient une bande unie sous un menu qui paraissait leve.

      La reserve est MESUREE sur la barre, pas ecrite en dur, et n'est
      appliquee que si le conteneur en a moins : les pages deja reglees
      (app.html et ses 74 px) ne sont pas doublees.

   Usage :
     node outils/tabbar-fond-et-reserve.js --essai
     node outils/tabbar-fond-et-reserve.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const MARQUE = 'fond unique + reserve de la barre';

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

/* ── A. Fond unique ──────────────────────────────────────────────
   L'ancre est la regle ANCREE, celle que tabbar-ancrage.js a laissee.
   C'est le point exact ou tabbar-fond-unique.js s'etait trompe. */

const ANCRE = `      '.mobile-tabs{position:fixed!important;bottom:0!important;left:0!important;right:0!important;' +
        'padding-bottom:env(safe-area-inset-bottom,0px)!important;' +
        'z-index:10001!important;pointer-events:auto!important;touch-action:none!important;}' +`;

if (src.split(ANCRE).length - 1 !== 1) {
  echec('Regle .mobile-tabs ancree introuvable — appliquez d\'abord outils/tabbar-ancrage.js,\n      ou le bloc a change depuis. Verifiez public/js/bh-layout.js vers la ligne 1456.');
}

const FOND = ANCRE + `
      /* ` + MARQUE + ` — chaque page definissait son fond :
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

src = src.split(ANCRE).join(FOND);

/* ── B. Reserve de place, mesuree ────────────────────────────────
   Ajoute en fin de fichier : aucun bloc existant n'a besoin d'etre
   retouche, donc aucune ancre supplementaire a maintenir. */

const RESERVE = `

/* ── Reserve de place sous la barre d'onglets ──────────────────────────
   app.html reservait 74 px a ses conteneurs, messages.html rien : la liste
   s'arretait a sa propre hauteur et la zone sure devenait une bande unie.
   La reserve est posee ici une fois pour toutes les pages.

   Elle est MESUREE sur la barre (hauteur + zone sure, deja dans son
   padding) plutot qu'ecrite en dur : une barre de 70 ou de 90 px, avec ou
   sans encoche, donne la bonne valeur sans table de correspondance.

   Elle n'est appliquee que si le conteneur reserve MOINS : les pages deja
   reglees gardent leur valeur, rien n'est double. */
(function () {
  'use strict';

  function conteneurQuiDefile() {
    var candidats = ['.main-content', '.app-container', 'main'];
    for (var i = 0; i < candidats.length; i++) {
      var el = document.querySelector(candidats[i]);
      if (!el) continue;
      var ov = getComputedStyle(el).overflowY;
      if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
    }
    // Sinon c'est la page entiere qui defile : la reserve va sur le premier
    // conteneur present, a defaut sur body.
    return document.querySelector('.main-content')
        || document.querySelector('.app-container')
        || document.body;
  }

  function reserver() {
    var barre = document.querySelector('.mobile-tabs');
    if (!barre) return;
    var cs = getComputedStyle(barre);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;

    var hauteur = Math.round(barre.getBoundingClientRect().height);
    if (!hauteur) return;                     // pas encore mise en page
    var voulu = hauteur + 12;                 // 12 px d'air sous le dernier element

    var cible = conteneurQuiDefile();
    if (!cible) return;
    var actuel = parseFloat(getComputedStyle(cible).paddingBottom) || 0;
    if (actuel >= voulu - 2) return;          // deja reserve : on ne touche pas
    cible.style.setProperty('padding-bottom', voulu + 'px', 'important');
  }

  // La barre est injectee par mobile-native-experience.js apres bh-layout :
  // on repasse quand elle existe, puis au resize et au retour de page.
  function suivre() {
    reserver();
    setTimeout(reserver, 200);
    setTimeout(reserver, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', suivre);
  } else {
    suivre();
  }
  window.addEventListener('resize', reserver);
  window.addEventListener('pageshow', reserver);
  window.addEventListener('orientationchange', function () { setTimeout(reserver, 250); });

  // bhDiagBarre() en console : dit ce qui est mesure et ce qui est applique.
  window.bhDiagBarre = function () {
    var b = document.querySelector('.mobile-tabs');
    if (!b) return console.log('[BH] barre absente');
    var r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    var c = conteneurQuiDefile();
    console.log('[BH] barre  : hauteur', Math.round(r.height),
      '| bas', Math.round(window.innerHeight - r.bottom),
      '| fond', cs.backgroundColor,
      '| padding-bottom', cs.paddingBottom);
    console.log('[BH] reserve:', c ? (c.className || c.tagName) : '(aucun)',
      '->', c ? getComputedStyle(c).paddingBottom : '-');
  };
})();
`;

src = src.replace(/\s*$/, '\n') + RESERVE;

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf(MARQUE) === -1 || relu.indexOf('bhDiagBarre') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Fond de la barre defini une fois, valeur d\'app.html.');
console.log('  Reserve de place mesuree, posee sur toutes les pages, sans doublon.\n');
console.log('  Rechargez avec Cmd+Maj+R : bh-layout.js est mis en cache.');
console.log('  Puis bhDiagBarre() en console pour lire ce qui est applique.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
