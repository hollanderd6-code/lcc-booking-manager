#!/usr/bin/env node
/* ============================================================
   outils/tabbar-sans-clignotement.js
   La correction arrivait 4 s trop tard
   ============================================================
   Cible : public/js/bh-layout.js  (bloc deja pose)

   ── LE SYMPTOME ──────────────────────────────────────────────────
   La petite capsule s'affiche, puis la bonne la remplace quelques
   secondes plus tard.

   ── LA CAUSE ─────────────────────────────────────────────────────
   Deux defauts de mon bloc :

   1. L'observateur ecoutait « document.body, { childList: true } »,
      donc les enfants DIRECTS de body uniquement. La barre est
      inseree plus profond : l'observateur ne la voit jamais, et
      c'est le repli « setTimeout(..., 4000) » qui finit par agir.
      D'ou l'attente de plusieurs secondes, exactement.

   2. Meme apres coup, la barre reecrit le style de sa capsule
      (transform, width, et parfois top/height) a chaque changement
      d'onglet. Notre mesure etait alors perdue jusqu'au prochain
      resize.

   ── LA CORRECTION ────────────────────────────────────────────────
   - subtree: true sur l'observateur : la barre est vue des son
     insertion, quel que soit son parent.
   - Un second observateur sur la capsule : des qu'un autre code
     reecrit son attribut style, on remet notre mesure. Un drapeau
     evite la boucle.
   - Le repli passe de 4 s a 1,5 s, et n'est plus le chemin normal.

   Usage :
     node outils/tabbar-sans-clignotement.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-layout.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-layout.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('__bhCapsuleSurveillee') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Observateur en profondeur, repli raccourci ────────────── */

const ANCIEN_DEMARRAGE = `  function demarrer() {
    if (document.querySelector('.mobile-tabs')) { normaliser(); return; }
    // La barre est creee par mobile-native-experience.js, apres bh-layout.
    var obs = new MutationObserver(function () {
      if (document.querySelector('.mobile-tabs')) { obs.disconnect(); normaliser(); }
    });
    obs.observe(document.body, { childList: true });
    setTimeout(function () { obs.disconnect(); normaliser(); }, 4000);
  }`;

if (src.indexOf(ANCIEN_DEMARRAGE) === -1) {
  echec('Bloc « demarrer() » introuvable — le fichier n\'est pas dans l\'etat attendu.\n      Envoyez : grep -n "function demarrer" public/js/bh-layout.js');
}

const NOUVEAU_DEMARRAGE = `  // La capsule est reecrite par la barre a chaque changement d'onglet
  // (transform, width, parfois top/height). On remet notre mesure des
  // qu'elle est touchee, sinon elle est perdue jusqu'au prochain resize.
  var enCours = false;
  function surveillerCapsule(barre) {
    var cap = barre.querySelector('.lg-capsule');
    if (!cap || cap.__bhCapsuleSurveillee) return;
    cap.__bhCapsuleSurveillee = true;
    new MutationObserver(function () {
      if (enCours) return;
      enCours = true;
      normaliser();
      enCours = false;
    }).observe(cap, { attributes: true, attributeFilter: ['style'] });
  }

  function demarrer() {
    var barre = document.querySelector('.mobile-tabs');
    if (barre) { normaliser(); surveillerCapsule(barre); return; }

    // La barre est creee par mobile-native-experience.js, apres bh-layout,
    // et pas en enfant direct de body : sans subtree l'observateur ne la
    // voyait jamais et seul le repli agissait — d'ou les secondes d'attente.
    var obs = new MutationObserver(function () {
      var b = document.querySelector('.mobile-tabs');
      if (b) { obs.disconnect(); normaliser(); surveillerCapsule(b); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () {
      obs.disconnect();
      var b = document.querySelector('.mobile-tabs');
      if (b) { normaliser(); surveillerCapsule(b); }
    }, 1500);
  }`;

src = src.split(ANCIEN_DEMARRAGE).join(NOUVEAU_DEMARRAGE);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

fs.writeFileSync(CIBLE, src, 'utf8');
if (fs.readFileSync(CIBLE, 'utf8').indexOf('__bhCapsuleSurveillee') === -1) {
  echec('La correction n\'est pas dans le fichier apres ecriture.');
}

console.log('\n— APPLIQUE ET VERIFIE —');
console.log('  Observateur en profondeur : la barre est vue des son insertion.');
console.log('  Capsule surveillee : la mesure survit aux changements d\'onglet.');
console.log('  Repli ramene de 4 s a 1,5 s.\n');
console.log('  npx cap sync ios, puis reconstruire depuis Xcode.\n');
