#!/usr/bin/env node
/* ============================================================
   outils/tabbar-reserve.js
   Ce n'était pas la barre, c'était le contenu sous la barre
   ============================================================
   Cible : public/js/bh-layout.js

   ── CE QUE LA MESURE A DIT ───────────────────────────────────────
   Relevé sur les deux pages, celle qui va et celle qui ne va pas :

       height 102px · paddingTop 8px · paddingBottom 34px
       5 boutons de 57px · bottom 0 · rectBas 0

   Identique au pixel. La barre est donc bien ancrée partout, et mon
   correctif d'ancrage etait juste — mais il ne corrigeait pas le defaut
   que vous voyiez.

   ── LE VRAI DEFAUT ───────────────────────────────────────────────
   app.html reserve la hauteur de la barre sur ses conteneurs :

       padding-bottom: calc(74px + env(safe-area-inset-bottom)) !important

   neuf regles de ce genre. Aucune autre page ne le fait. Sur celles-la,
   le contenu passe SOUS la barre : les 34px de zone sure apparaissent
   comme une bande ivoire vide, et la barre semble flotter plus haut.

   Ce n'est pas la barre qui bouge, c'est le contenu qui ne s'arrete pas
   au bon endroit. J'ai passe trois echanges a mesurer la barre parce que
   c'est ce que la capture montrait — le symptome n'etait pas la cause.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   La reserve est posee une fois, dans le composant partage, pour toutes
   les pages qui n'en ont pas.

   Elle est CALCULEE, non ecrite en dur : la barre est mesuree au
   chargement. Les 74px d'app.html sont deja faux — la barre en fait 68
   hors zone sure. Une valeur figee se demode au premier bouton ajoute.

   app.html est exclue : ses regles portent !important sur des conteneurs
   internes, et ajouter une reserve sur body creerait un double vide en
   bas de page. Mieux vaut une exception nommee qu'un conflit silencieux.

   Usage :
     node outils/tabbar-reserve.js --essai
     node outils/tabbar-reserve.js
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

if (src.indexOf('reserverPlaceTabbar') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCRE = `    s.id = 'lg-tabbar-style';
    s.textContent = css;
    document.head.appendChild(s);
  }`;

const NOUVEAU = `    s.id = 'lg-tabbar-style';
    s.textContent = css;
    document.head.appendChild(s);

    reserverPlaceTabbar();
  }

  /* La barre flotte au-dessus du contenu : sans reserve en bas de page, les
     dernieres lignes passent dessous et la zone sure apparait comme une bande
     vide. app.html reserve 74px + zone sure sur ses conteneurs ; aucune autre
     page ne le faisait.

     La hauteur est MESUREE, pas ecrite : la barre fait 102px dont 34 de zone
     sure, et les 74px codes dans app.html sont deja faux. Une valeur figee se
     demode au premier bouton ajoute au menu. */
  function reserverPlaceTabbar() {
    /* app.html porte ses propres regles en !important sur des conteneurs
       internes. Y ajouter une reserve sur body creerait un double vide en bas
       de page : une exception nommee vaut mieux qu'un conflit silencieux. */
    var page = (location.pathname.split('/').pop() || '').toLowerCase();
    if (page === 'app.html' || page === '' || page === 'app') return;

    function poser() {
      var bar = document.querySelector('.mobile-tabs');
      if (!bar) return;
      // Barre masquee (bureau, ou page sans menu) : rien a reserver.
      if (!bar.offsetHeight || getComputedStyle(bar).display === 'none') {
        document.documentElement.style.removeProperty('--bh-tabbar-h');
        return;
      }
      /* La zone sure est deja dans offsetHeight : on ajoute seulement une
         respiration, pour que la derniere ligne ne colle pas a la barre. */
      document.documentElement.style.setProperty('--bh-tabbar-h', (bar.offsetHeight + 12) + 'px');
    }

    var st = document.getElementById('lg-tabbar-reserve');
    if (!st) {
      st = document.createElement('style');
      st.id = 'lg-tabbar-reserve';
      st.textContent =
        '@media (max-width:1366px){' +
          'body{padding-bottom:var(--bh-tabbar-h, 0px)!important;}' +
          /* Un conteneur qui defile seul ne recoit pas le padding du body :
             on l'ecourte pour que sa fin reste au-dessus de la barre. */
          '.page-scroll,.main-scroll,#mainScroll{padding-bottom:var(--bh-tabbar-h, 0px)!important;}' +
        '}';
      document.head.appendChild(st);
    }

    poser();
    /* La hauteur change avec l'orientation, et la barre peut etre construite
       apres ce script. On repose plutot que de deviner le bon instant. */
    window.addEventListener('resize', poser);
    window.addEventListener('orientationchange', function () { setTimeout(poser, 250); });
    setTimeout(poser, 400);
    setTimeout(poser, 1200);
  }`;

if (src.split(ANCRE).length - 1 !== 1) {
  echec('Ancre introuvable dans bh-layout.js. Appliquez d\'abord outils/tabbar-ancrage.js.');
}
src = src.split(ANCRE).join(NOUVEAU);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('reserverPlaceTabbar') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Reserve posee sur toutes les pages sauf app.html.');
console.log('  Hauteur mesuree au chargement, non ecrite en dur.\n');
console.log('  Verification, dans la console d\'une page corrigee :');
console.log('    getComputedStyle(document.documentElement).getPropertyValue(\'--bh-tabbar-h\')');
console.log('  Doit valoir 114px environ.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
