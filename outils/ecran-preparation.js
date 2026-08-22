#!/usr/bin/env node
/* ============================================================
   Ecran de preparation groupee : dire la verite
   ============================================================
   Cible : public/js/bh-ota-connect.js

   ── CE QUE L'ECRAN AFFICHE AUJOURD'HUI ───────────────────────────
       Tout est déjà prêt
       0 logements dans Channex
       Chaque logement a son établissement. Il ne reste qu'à autoriser
       les plateformes, logement par logement ou établissement par
       établissement.

   Trois defauts dans quatre lignes :

   1. « Channex » est le nom de notre prestataire. Le client achete
      BoostingHost ; savoir par quel intermediaire passe la
      synchronisation ne l'aide pas, et le perd.

   2. « Tout est déjà prêt » avec « 0 logements » se contredit. Le test
      etait « la liste a preparer est vide », vrai dans DEUX situations
      opposees : tout est fait, ou rien n'a ete lu. Un zero n'est jamais
      une reussite.

   3. Le texte affirme « Chaque logement a son établissement » alors que
      le compteur dit zero. Sur cette capture le panneau affiche
      Airbnb 2/3 : il y a bien des logements connectes, mais la lecture
      groupee renvoie 0. L'ecran affirmait donc quelque chose de faux.

   ── CE QUE FAIT CE PATCH ────────────────────────────────────────
   Les deux situations sont separees, et celle a zero dit ce qu'il faut
   faire — connecter depuis la fiche d'un logement — au lieu de
   feliciter. Elle signale aussi que la preparation groupee semble
   indisponible, ce qui est l'information utile : le client sait qu'il
   n'a pas mal manipule.

   ── CE QUI RESTE A CORRIGER, CETTE FOIS COTE SERVEUR ────────────
   /api/channex/bulk-status renvoie total: 0 alors que 3 logements
   existent et que 2 sont connectes a Airbnb. L'ecran ne mentira plus,
   mais le compte restera faux jusqu'a ce que cette route soit corrigee
   (routes/channex-bulk-routes.js).

   Usage :
     node outils/ecran-preparation.js --essai
     node outils/ecran-preparation.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('rienDeLu') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const A1 = `      modal.innerHTML = carte(460,
        entete(null, 'Tout est déjà prêt', etat.total + ' logements dans Channex') +
        '<div style="padding:22px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.55;">' +
        'Chaque logement a son établissement. Il ne reste qu\\'à autoriser les plateformes, logement par logement ou établissement par établissement.</div>' +`;

const N1 = `      /* Deux situations tombaient ici : « tout est pret » et « rien n'a ete lu ».
         Le test « la liste a preparer est vide » est vrai dans les deux, d'ou
         l'ecran contradictoire « Tout est déjà prêt · 0 logements ». Un zero
         n'est pas une reussite : on distingue, et on dit quoi faire. */
      var rienDeLu = !etat.total;
      var n = etat.total || 0;
      modal.innerHTML = carte(460,
        entete(null,
          rienDeLu ? 'Préparation groupée indisponible' : 'Tout est déjà prêt',
          rienDeLu ? null : n + (n > 1 ? ' logements prêts' : ' logement prêt')) +
        '<div style="padding:22px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.6;">' +
        (rienDeLu
          ? 'Vos logements n\\'ont pas pu être relevés ici — ce n\\'est pas une erreur de votre part. ' +
            'Connectez vos plateformes depuis la fiche de chaque logement : le résultat est le même, ' +
            'cela demande simplement un passage par logement.'
          : 'Chaque logement est prêt. Il ne reste qu\\'à autoriser les plateformes, ' +
            'logement par logement ou immeuble par immeuble.') +
        '</div>' +`;

const A2 = `        aPreparer.length + ' logements sur ' + etat.total + ' ne sont pas encore dans Channex') +`;
const N2 = `        aPreparer.length + (aPreparer.length > 1 ? ' logements' : ' logement') + ' à préparer sur ' + etat.total) +`;

/* ── Les mentions du prestataire dans l'ecran Booking ────────────── */
const A3 = `      entete('Étape 1 sur 2 · une seule fois', 'Autoriser Channex chez Booking.com',`;
const N3 = `      entete('Étape 1 sur 2 · une seule fois', 'Autoriser la connexion chez Booking.com',`;

const A4 = `>C\\'est fait — Channex est accepté dans mon extranet.</span>' +`;
const N4 = `>C\\'est fait — la connexion est autorisée dans mon extranet.</span>' +`;

/* Celle-ci CONSERVE le mot, et c'est deliberе : dans l'extranet Booking.com,
   le client doit taper « Channex » dans la liste des fournisseurs de
   connectivite. C'est le nom que Booking affiche dans SA propre interface —
   le masquer rendrait l'etape infaisable. On l'annonce comme tel. */
const A5 = `      'Cherchez « Channex » et cliquez sur <strong style="font-weight:500;">Accepter</strong>.',`;
const N5 = `      'Cherchez <strong style="font-weight:500;">Channex</strong> — le nom de notre fournisseur de connectivité chez Booking.com — puis cliquez sur <strong style="font-weight:500;">Accepter</strong>.',`;

const edits = [
  ['ecran « tout est deja pret »', A1, N1],
  ['sous-titre de la liste', A2, N2],
  ['titre de l\'ecran Booking', A3, N3],
  ['case a cocher de l\'extranet', A4, N4],
  ['etape « chercher le fournisseur »', A5, N5]
];

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

/* Controle : plus aucun « Channex » dans un texte affiche. On ignore les
   commentaires, les identifiants techniques et les routes d'API. */
const restantes = [];
let dansCommentaire = false;
src.split('\n').forEach(function (l, i) {
  const ouvre = l.lastIndexOf('/*');
  const ferme = l.lastIndexOf('*/');
  const etait = dansCommentaire;
  if (ouvre !== -1 && ouvre > ferme) dansCommentaire = true;
  else if (ferme !== -1 && ferme > ouvre) dansCommentaire = false;
  if (l.indexOf('Channex') === -1) return;
  if (etait || dansCommentaire || /^\s*\/\//.test(l)) return;
  if (/channexModal|channex_property_id|channexPropertyId|channexEnabled|api\/channex|channexDisconnect|openChannexModal|bh_property_id/.test(l)) return;
  restantes.push((i + 1) + ' : ' + l.trim().slice(0, 88));
});

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Resultat invalide : ' + e.message + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Syntaxe verifiee.');
console.log('\n  MENTIONS DE « CHANNEX » ENCORE AFFICHEES : ' + restantes.length);
restantes.forEach(function (r) { console.log('    ligne ' + r); });
if (restantes.length === 1) {
  console.log('\n  Si c\'est l\'etape de l\'extranet Booking.com, elle est voulue :');
  console.log('  le client doit taper ce nom dans l\'interface de Booking.');
}
console.log('\n  A VOIR A L\'ECRAN');
console.log('    Le bouton « Connecter » d\'une ligne plateforme ne doit plus');
console.log('    afficher « Tout est déjà prêt · 0 logements » mais');
console.log('    « Préparation groupée indisponible », avec la marche a suivre.');
console.log('\n  RESTE A CORRIGER — cote serveur');
console.log('    /api/channex/bulk-status renvoie total: 0 alors que le panneau');
console.log('    affiche Airbnb 2/3. L\'ecran ne mentira plus, mais le compte');
console.log('    restera faux : routes/channex-bulk-routes.js ne voit pas vos');
console.log('    logements.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');
