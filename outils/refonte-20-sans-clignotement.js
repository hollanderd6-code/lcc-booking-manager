#!/usr/bin/env node
/* ============================================================
   outils/refonte-20-sans-clignotement.js
   Lot 20 : ne plus montrer l'ancienne version au chargement
   ============================================================

   ── LE DEFAUT ────────────────────────────────────────────────────
   Sur Aujourd'hui, Calendrier et Messages, l'ancienne mise en page
   apparait une seconde avant que la nouvelle ne la remplace. C'est
   structurel : mes modules sont des scripts qui s'executent APRES le
   premier affichage, avec en plus un delai de 900 a 1400 millisecondes
   pour laisser les donnees arriver. La page a donc tout le temps de
   peindre l'ancienne version.

   Le voir clignoter donne l'impression que l'application hesite.

   ── LA CORRECTION ────────────────────────────────────────────────
   Une regle CSS posee dans le <head>, donc AVANT le premier affichage,
   masque les blocs que l'on sait remplacer :

       #conversationsList     la liste d'origine des messages
       #bhListesJour          l'ancien bloc de la journee

   Ils ne sont jamais montres, meme une image. Les modules n'ont plus
   qu'a construire par-dessus.

   ── LE FILET, PARCE QU'UN MODULE PEUT ECHOUER ────────────────────
   Masquer en CSS ce qu'un script doit remplacer, c'est parier sur le
   script. S'il ne se charge pas, l'ecran reste vide — exactement la
   page blanche du calendrier.

   Donc : la meme regle porte une classe de secours sur <html>, et un
   compte a rebours de quatre secondes la retire si les modules n'ont
   pas signale leur presence. L'ancienne version revient alors,
   entiere. Un clignotement vaut mieux qu'un ecran vide.

   Les modules signalent en posant html.bh-refonte-prete. Aucun code
   existant n'est modifie : la classe est posee par la regle elle-meme.

   ── CE QUE CE LOT NE FAIT PAS ────────────────────────────────────
   Il ne touche pas au delai des modules. Les faire courir plus tot
   les ferait travailler sur des donnees absentes — c'est ce qui a
   produit les listes vides du calendrier. On cache l'attente, on ne
   la supprime pas.

   Usage :
     node outils/refonte-20-sans-clignotement.js --essai
     node outils/refonte-20-sans-clignotement.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const PAGES = [
  ['app.html', ['#bhListesJour']],
  ['messages.html', ['#conversationsList']]
];
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

const MARQUE = 'bh-anti-clignotement';

function bloc(selecteurs) {
  return `<!-- ${MARQUE} : ne pas montrer ce que les modules remplacent -->
<style id="${MARQUE}">
  html.bh-refonte-attente ${selecteurs.join(',\n  html.bh-refonte-attente ')} { display: none !important; }
</style>
<script>
  /* Pose avant le premier affichage : l'ancienne version n'est jamais
     peinte, meme une image. */
  document.documentElement.classList.add('bh-refonte-attente');
  /* Filet : si les modules ne se signalent pas en quatre secondes,
     l'ancienne version revient entiere. Un clignotement vaut mieux
     qu'un ecran vide. */
  setTimeout(function () {
    if (!document.documentElement.classList.contains('bh-refonte-prete')) {
      document.documentElement.classList.remove('bh-refonte-attente');
      console.warn('[anti-clignotement] Les modules ne se sont pas signales : '
        + 'ancienne version rendue.');
    }
  }, 4000);
</script>
`;
}

const ecritures = [];
const etats = {};

PAGES.forEach(function (p) {
  const fichier = path.join(PUBLIC, p[0]);
  if (!fs.existsSync(fichier)) { etats[p[0]] = 'absent — ignore'; return; }
  let html = fs.readFileSync(fichier, 'utf8');

  if (html.indexOf(MARQUE) !== -1) { etats[p[0]] = 'deja applique'; return; }

  const i = html.indexOf('<head>');
  if (i === -1) { etats[p[0]] = 'pas de <head> — ignore'; return; }
  const pos = i + '<head>'.length;
  html = html.slice(0, pos) + '\n' + bloc(p[1]) + html.slice(pos);
  etats[p[0]] = 'regle posee dans <head> (' + p[1].join(', ') + ')';
  ecritures.push([fichier, html]);
});

/* ── Les modules doivent se signaler ──────────────────────────── */

const SIGNAL = `
  /* Anti-clignotement : la page masque l'ancienne version jusqu'a ce
     signal. Pose des que notre bloc est en place — pas avant, sinon on
     revelerait un ecran vide. */
  function signalerPret() {
    document.documentElement.classList.add('bh-refonte-prete');
    document.documentElement.classList.remove('bh-refonte-attente');
  }
`;

const MODULES = [
  ['bh-messages-liste.js', '    etat.pose = true;\n    return true;', '    etat.pose = true;\n    signalerPret();\n    return true;'],
  ['bh-liste-unifiee.js', '    endormirAncien();', '    endormirAncien();\n    signalerPret();']
];

MODULES.forEach(function (m) {
  const fichier = path.join(PUBLIC, 'js', m[0]);
  if (!fs.existsSync(fichier)) { etats[m[0]] = 'absent — ignore'; return; }
  let src = fs.readFileSync(fichier, 'utf8');
  if (src.indexOf('signalerPret') !== -1) { etats[m[0]] = 'deja applique'; return; }

  const n = src.split(m[1]).length - 1;
  if (n !== 1) {
    etats[m[0]] = 'ancre trouvee ' + n + ' fois — module non modifie';
    return;
  }
  src = src.split(m[1]).join(m[2]);

  /* La fonction, juste avant la premiere accolade du module. */
  const iUse = src.indexOf("  'use strict';");
  if (iUse === -1) { etats[m[0]] = "pas de 'use strict' — module non modifie"; return; }
  const pos = iUse + "  'use strict';".length;
  src = src.slice(0, pos) + '\n' + SIGNAL + src.slice(pos);

  try { new Function(src); }
  catch (e) { echec(m[0] + ' ne serait plus du JavaScript valide — ' + e.message); }

  etats[m[0]] = 'signale sa presence';
  ecritures.push([fichier, src]);
});

if (!ecritures.length) {
  console.log('\n  Rien a faire — tout est deja en place.\n');
  Object.keys(etats).forEach(function (k) { console.log('  ' + k + '  ' + etats[k]); });
  console.log('');
  process.exit(0);
}

if (!ESSAI) {
  ecritures.forEach(function (e) { fs.writeFileSync(e[0], e[1], 'utf8'); });
  const verif = path.join(PUBLIC, 'messages.html');
  if (fs.existsSync(verif) && fs.readFileSync(verif, 'utf8').indexOf(MARQUE) === -1
      && etats['messages.html'] !== 'deja applique') {
    echec('La regle n\'est pas dans messages.html apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
Object.keys(etats).forEach(function (k) {
  console.log('  ' + k + (k.length < 22 ? new Array(24 - k.length).join(' ') : '  ') + etats[k]);
});
console.log('\n  La regle est posee dans le <head>, donc avant le premier');
console.log('  affichage : l\'ancienne liste n\'est jamais peinte.');
console.log('\n  Filet de quatre secondes : si aucun module ne se signale,');
console.log('  l\'ancienne version revient entiere et la console le dit. Un');
console.log('  clignotement vaut mieux qu\'un ecran vide — c\'est la lecon du');
console.log('  calendrier.');
console.log('\n  Je ne touche pas au delai des modules : les faire courir plus');
console.log('  tot les ferait travailler sur des donnees absentes. On cache');
console.log('  l\'attente, on ne la supprime pas.');
console.log('\n  A verifier, cache vide, sur les trois pages :');
console.log('    au chargement, plus d\'ancienne mise en page qui passe');
console.log('    en cas de coupure reseau, la page reste utilisable');
console.log('    document.documentElement.className  ->  bh-refonte-prete\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
