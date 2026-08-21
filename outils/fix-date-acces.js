#!/usr/bin/env node
/* ============================================================
   « Accès depuis 01/01/1970 » — Équipe & Accès
   ============================================================
   ── LA CAUSE ────────────────────────────────────────────────────────
   settings-account.html ligne 3328 :

       ${d.propertyCount} logement(s) · Accès depuis
       ${new Date(d.acceptedAt).toLocaleDateString('fr-FR')}

   Le serveur envoie bien le champ sous le bon nom (server.js:42248,
   « acceptedAt: r.accepted_at »). Mais pour ces deux delegations,
   accepted_at vaut NULL en base — elles existaient avant que la route
   d'acceptation ne pose « accepted_at = NOW() » (server.js:42170), ou
   ont ete creees sans passer par elle.

   Et new Date(null) ne vaut pas « date invalide » : il vaut ZERO, donc
   le 1er janvier 1970. C'est pour cela que les deux comptes affichent la
   meme date, a la seconde pres. Rien n'a ete invente : une valeur
   absente a ete formatee comme si elle existait.

   ── LE CORRECTIF ────────────────────────────────────────────────────
   Une date absente ne s'affiche pas. « 22 logement(s) » tout court est
   exact ; « 22 logement(s) · Acces depuis 01/01/1970 » est faux, et
   pire : il a l'air verifiable.

   Le garde-fou refuse aussi toute annee anterieure a 2020 — cela attrape
   le 0, la chaine vide et les dates aberrantes, pas seulement le NULL.

   ── CE QU'IL RESTE A FAIRE, ET QUI N'EST PAS ICI ────────────────────
   La donnee manque toujours en base. Deux options :

     1. la laisser manquer — l'ecran n'affichera pas de date pour ces
        deux comptes, et l'affichera pour tous les suivants ;
     2. la reconstituer depuis invited_at, ce qui est une APPROXIMATION :
        la date d'invitation n'est pas la date d'acces. A ne faire que si
        vous assumez l'ecart, et alors le libelle devrait dire
        « Invite le » et non « Acces depuis ».

   Je n'ai pas ecrit la seconde : remplir une colonne avec une valeur
   approchante recree exactement le probleme qu'on vient de corriger.

   Au passage, server.js:42214 trie par « accepted_at DESC » : avec des
   NULL, l'ordre des comptes n'est pas garanti. Un « NULLS LAST » reglerait
   cela — hors perimetre de ce correctif, qui reste en client.

   Usage :  node outils/fix-date-acces.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'settings-account.html');
if (!fs.existsSync(CIBLE)) {
  console.error('\n  public/settings-account.html introuvable.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');
const avant = src;

/* 1. L'affichage : on delegue a une fonction qui sait se taire. */
const ANCIEN = "${d.propertyCount} logement(s) · Accès depuis ${new Date(d.acceptedAt).toLocaleDateString('fr-FR')}";
const NOUVEAU = "${d.propertyCount} logement(s)${bhDateAcces(d)}";

let n = 0;
while (src.indexOf(ANCIEN) !== -1) { src = src.replace(ANCIEN, NOUVEAU); n++; }

if (!n) {
  console.error('\n  La ligne d\'affichage n\'a pas ete trouvee telle quelle.');
  console.error('  Elle a peut-etre deja ete corrigee : verifiez avec');
  console.error('      grep -n "bhDateAcces" public/settings-account.html\n');
  process.exit(1);
}

/* 2. La fonction, posee une seule fois dans le premier <script> de la page. */
const FONCTION = `
// Une date absente ne s'affiche pas. new Date(null) vaut le 1er janvier
// 1970 : formater un champ vide donnait « Acces depuis 01/01/1970 » a
// tous les comptes dont accepted_at est NULL en base.
function bhDateAcces(d) {
  var brut = d && (d.acceptedAt || d.accepted_at);
  if (!brut) return '';
  var dt = new Date(brut);
  // Ecarte aussi le 0, la chaine vide et les dates aberrantes.
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2020) return '';
  return ' \\u00b7 Acc\\u00e8s depuis ' + dt.toLocaleDateString('fr-FR');
}
`;

if (src.indexOf('function bhDateAcces') === -1) {
  const i = src.indexOf('<script>');
  if (i === -1) {
    console.error('\n  Aucun <script> trouve pour y poser la fonction.\n');
    process.exit(1);
  }
  src = src.slice(0, i + 8) + FONCTION + src.slice(i + 8);
}

if (src === avant) { console.log('Rien a changer.'); process.exit(0); }

fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n  public/settings-account.html');
console.log('    ' + n + ' affichage(s) de date corrige(s)');
console.log('    fonction bhDateAcces posee');
console.log('\n  A VERIFIER : dans Parametres > Equipe & Acces, les deux comptes');
console.log('  doivent afficher « 22 logement(s) » sans date. Un compte lie');
console.log('  APRES ce correctif affichera bien sa vraie date.\n');
