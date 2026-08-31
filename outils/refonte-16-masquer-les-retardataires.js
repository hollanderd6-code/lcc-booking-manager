#!/usr/bin/env node
/* ============================================================
   outils/refonte-16-masquer-les-retardataires.js
   Lot 16 : masquer aussi ce qui arrive apres
   ============================================================

   ── OU NOUS EN SOMMES ────────────────────────────────────────────
   Sur /calendrier.html, bhVerifVueCalendrier() repond enfin :

       conteneur_rempli : bhMonthOuter
       section_visible  : true

   Le calendrier est la, rempli, visible. Le lot 15 a corrige la bonne
   erreur.

   ── CE QUI RESTE ─────────────────────────────────────────────────
   « A traiter maintenant » et ses cartes s'affichent encore au-dessus.
   La raison n'est pas un oubli de cible : bh-liste-unifiee.js construit
   son bloc une seconde apres mon passage, et mon module ne masquait
   qu'une seule fois — « si rien n'est encore masque, masquer ». Tout ce
   qui arrive ensuite passe au travers.

   C'est le defaut classique d'un masquage a un seul coup dans une page
   qui se construit par vagues.

   ── LA CORRECTION ────────────────────────────────────────────────
   1. Le masquage repasse a chaque tour. Il est deja idempotent : un
      noeud porte data-bh-vue-masque une fois masque, et n'est jamais
      compte deux fois.

   2. Un observateur du DOM le declenche aussi sur toute insertion,
      pendant trente secondes. Passe ce delai il se debranche : une page
      n'a pas besoin d'un surveillant permanent, et un observateur
      oublie coute plus qu'il ne rapporte.

   3. Au premier masquage reussi, la page remonte en haut. Sans cela on
      arrive au milieu de l'ancien defilement, devant du vide.

   Les memorisations de style de la section ne sont plus reempilees a
   chaque passage — sinon bhAnnulerVueCalendrier() aurait eu des
   centaines d'entrees a defaire.

   Usage :
     node outils/refonte-16-masquer-les-retardataires.js --essai
     node outils/refonte-16-masquer-les-retardataires.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE = path.join(process.cwd(), 'public', 'js', 'bh-vue-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(MODULE)) echec('bh-vue-calendrier.js absent.');

let src = fs.readFileSync(MODULE, 'utf8');
if (src.indexOf('MutationObserver') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (src.indexOf('conteneurRempli') === -1) echec('Le lot 15 n\'est pas applique. Lancez-le d\'abord.');

function remplacer(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. Repasser a chaque tour ────────────────────────────────── */

remplacer(
`    if (!diag.masques) masquer();`,
`    masquer();`,
  'le tour'
);

/* ── 2. Ne pas reempiler les styles de la section ─────────────── */

remplacer(
`    memoriser(section, 'margin', '0');
    if (section.parentElement) memoriser(section.parentElement, 'padding-top', '8px');
    diag.raison = '';
    return true;`,
`    if (!diag.pose) {
      diag.pose = true;
      memoriser(section, 'margin', '0');
      if (section.parentElement) memoriser(section.parentElement, 'padding-top', '8px');
      /* On arrive sinon au milieu de l'ancien defilement, devant du vide. */
      try { window.scrollTo(0, 0); } catch (e) {}
    }
    diag.raison = '';
    return true;`,
  'la pose de la section'
);

/* ── 3. L'observateur ─────────────────────────────────────────── */

remplacer(
`  setTimeout(filet, 18000);`,
`  setTimeout(filet, 18000);

  /* La page se construit par vagues : la liste du jour arrive une
     seconde apres nous, les cartes plus tard encore. On repasse a
     chaque insertion — puis on se debranche. Un observateur oublie
     coute plus qu'il ne rapporte. */
  if (window.MutationObserver) {
    var enAttente = null;
    var obs = new MutationObserver(function () {
      if (enAttente) return;
      enAttente = setTimeout(function () { enAttente = null; tour(); }, 250);
    });
    try {
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); }, 30000);
    } catch (e) {}
  }`,
  'l\'observateur'
);

[
  ['le tour repete', '    masquer();'],
  ['la pose unique', 'if (!diag.pose)'],
  ['l\'observateur', 'new MutationObserver'],
  ['le debranchement', 'obs.disconnect()'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

try { new Function(src); } catch (e) { echec('Le module ne serait plus valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, src, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('MutationObserver') === -1) echec("La correction n'est pas dans le fichier apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-vue-calendrier.js  masquage repete + observateur');
console.log('\n  Le masquage repasse a chaque tour et a chaque insertion dans le');
console.log('  DOM, pendant trente secondes. « A traiter maintenant », qui se');
console.log('  construisait apres mon passage, sera masque comme le reste.');
console.log('\n  La page remonte en haut au premier masquage reussi.');
console.log('\n  A verifier, cache vide, sur /calendrier.html :');
console.log('    le calendrier seul, en haut de page');
console.log('    bhVerifVueCalendrier()  ->  voisins_masques en hausse');
console.log('    onglet Aujourd\'hui      ->  la page du matin, complete');
console.log('\n  Annulation : bhAnnulerVueCalendrier()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
