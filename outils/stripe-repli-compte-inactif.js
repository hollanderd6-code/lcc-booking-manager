#!/usr/bin/env node
/* ============================================================
   outils/stripe-repli-compte-inactif.js
   Un compte proprietaire non valide ne doit plus bloquer les paiements
   ============================================================
   Cible : server.js  (fonction getStripeForProperty)

   ── CE QUI S'EST PASSE ──────────────────────────────────────────
   Des dizaines de cautions echouaient en boucle :

     ❌ [REGEN CRON] Caution dep_xxxx: In order to use Checkout, you
        must set an account or business name at
        https://dashboard.stripe.com/account.

   Le proprietaire Tchuenkam Teto portait un compte Stripe
   (acct_1TFcaSF…) dont l'inscription n'a jamais ete terminee :
   pas de nom d'entreprise, paiements desactives, virements desactives.
   BH creait pourtant les sessions dessus, et Stripe les refusait.

   Le code n'etait pas en faute : getStripeForProperty teste bien
   use_bh_stripe. Simplement, le drapeau valait false pour ce
   proprietaire, et rien ne verifiait que son compte etait exploitable.

   Cinq comptes connectes sont dans cet etat — des inscriptions
   commencees puis abandonnees. Chacun est une panne en attente.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Avant d'encaisser sur le compte d'un proprietaire, on verifie qu'il
   accepte les paiements (charges_enabled). Sinon, on retombe sur le
   compte Boostinghost : le voyageur paie, la caution part.

   Le principe qui gouverne le repli : on ne bascule QUE sur preuve.
   Si Stripe ne repond pas — panne, delai, cle restreinte — on garde le
   compte du proprietaire, comme aujourd'hui. Detourner des fonds vers
   la tresorerie de la plateforme sur un simple doute serait pire que
   l'erreur qu'on corrige.

   Le resultat est mis en cache dix minutes : sans cela, chaque paiement
   ajouterait un aller-retour Stripe. Un compte qui vient d'etre valide
   est donc pris en compte au bout de dix minutes au plus.

   Chaque repli laisse une trace explicite dans les journaux, avec le
   compte concerne et la raison — c'est ce qui manquait le plus : la
   panne etait totalement muette.

   ── CE QUI N'EST PAS TOUCHE ─────────────────────────────────────
   · use_bh_stripe : un proprietaire qui choisit d'encaisser via BH
     continue de le faire, sans aucune verification.
   · Les frais de 3 % : inchanges dans tous les cas.
   · Le compte plateforme : il reste le dernier recours, comme avant.

   ── CE QUE CE CORRECTIF NE FAIT PAS ─────────────────────────────
   Il ne previent pas le proprietaire que son compte est inutilisable.
   Ses paiements arrivent desormais chez vous, et il faudra les lui
   reverser. C'est mieux qu'un paiement impossible, mais ce n'est pas
   un etat souhaitable : l'ecran de connexion Stripe devrait afficher
   « inscription inachevee » et le relancer. A faire ensuite.

   Usage :
     node outils/stripe-repli-compte-inactif.js --essai
     node outils/stripe-repli-compte-inactif.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('compteStripeUtilisable') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

function unique(aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + ' occurrence(s) au lieu d\'une. server.js a change.');
}

/* ── 1. Le verificateur, pose juste avant getStripeForProperty ── */
const A_FN = 'async function getStripeForProperty(pool, propertyId, userId) {';
unique(A_FN, 'Declaration de getStripeForProperty');

const VERIF = `/* ── Ce compte Stripe peut-il encaisser ? ────────────────────────
   Un proprietaire peut avoir commence une connexion Stripe sans jamais
   la terminer : le compte existe, son identifiant est enregistre chez
   nous, mais Stripe refuse toute page de paiement (« you must set an
   account or business name »). Les cautions echouaient alors en boucle,
   sans que personne ne soit prevenu.

   La reponse est mise en cache : sans cela, chaque paiement ajouterait
   un aller-retour vers Stripe. Dix minutes — un compte fraichement
   valide est donc pris en compte au bout de dix minutes au plus. */
const _cacheComptesStripe = new Map();   // acct_… -> { utilisable, jusqua }
const CACHE_COMPTE_MS = 10 * 60 * 1000;

async function compteStripeUtilisable(accountId) {
  if (!accountId) return false;
  if (!stripe) return true;              // pas de Stripe configure : on ne juge pas

  const enCache = _cacheComptesStripe.get(accountId);
  if (enCache && enCache.jusqua > Date.now()) return enCache.utilisable;

  try {
    const compte = await stripe.accounts.retrieve(accountId);
    const nom = (compte.business_profile && compte.business_profile.name)
      || (compte.settings && compte.settings.dashboard && compte.settings.dashboard.display_name)
      || null;
    // Les deux conditions que Stripe exige pour ouvrir une page Checkout.
    const utilisable = !!compte.charges_enabled && !!nom;
    _cacheComptesStripe.set(accountId, { utilisable, jusqua: Date.now() + CACHE_COMPTE_MS });
    if (!utilisable) {
      const raisons = [];
      if (!compte.charges_enabled) raisons.push('paiements desactives');
      if (!nom) raisons.push('nom d\\'entreprise absent');
      if (!compte.details_submitted) raisons.push('inscription inachevee');
      console.warn(\`⚠️ [STRIPE] \${accountId} inutilisable (\${raisons.join(', ')}) — encaissement bascule sur le compte Boostinghost\`);
    }
    return utilisable;
  } catch (e) {
    /* Stripe injoignable, compte supprime, cle restreinte… On ne SAIT pas.
       On garde alors le compte du proprietaire : basculer les fonds vers la
       tresorerie de la plateforme sur un doute serait pire que l'erreur
       qu'on cherche a eviter. */
    console.warn(\`⚠️ [STRIPE] verification de \${accountId} impossible (\${e.message}) — compte conserve\`);
    return true;
  }
}

`;
src = src.split(A_FN).join(VERIF + A_FN);

/* ── 2. Le compte du proprietaire ── */
const A_OWNER = `    if (owner?.stripe_account_id && !owner?.use_bh_stripe) {
      return { stripeAccountId: owner.stripe_account_id, applyFee: true }; // ✅ 3% même sur compte connecté
    }`;
unique(A_OWNER, 'Choix du compte proprietaire');
src = src.split(A_OWNER).join(`    if (owner?.stripe_account_id && !owner?.use_bh_stripe) {
      // Un compte connecte mais non valide ferait echouer le paiement :
      // on ne l'utilise que s'il peut reellement encaisser.
      if (await compteStripeUtilisable(owner.stripe_account_id)) {
        return { stripeAccountId: owner.stripe_account_id, applyFee: true }; // ✅ 3% même sur compte connecté
      }
    }`);

/* ── 3. Le compte de l'utilisateur ── */
const A_USER = `    if (user?.stripe_account_id && !user?.use_bh_stripe) {
      return { stripeAccountId: user.stripe_account_id, applyFee: true }; // ✅ 3% même sur compte connecté
    }`;
unique(A_USER, 'Choix du compte utilisateur');
src = src.split(A_USER).join(`    if (user?.stripe_account_id && !user?.use_bh_stripe) {
      if (await compteStripeUtilisable(user.stripe_account_id)) {
        return { stripeAccountId: user.stripe_account_id, applyFee: true }; // ✅ 3% même sur compte connecté
      }
    }`);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('server.js n\'est plus du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['le verificateur', 'async function compteStripeUtilisable(accountId) {'],
  ['le cache', 'const _cacheComptesStripe = new Map();'],
  ['la verification du proprietaire', 'if (await compteStripeUtilisable(owner.stripe_account_id))'],
  ['la verification de l\'utilisateur', 'if (await compteStripeUtilisable(user.stripe_account_id))'],
  ['le repli prudent en cas d\'erreur', 'compte conserve'],
]) if (src.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');

if (src.split('async function compteStripeUtilisable').length - 1 !== 1) echec('Le verificateur est defini deux fois.');
/* Le dernier recours doit rester le compte plateforme. */
if (src.indexOf('return { stripeAccountId: null, applyFee: true };') === -1) {
  echec('Le repli sur le compte Boostinghost a disparu.');
}
/* use_bh_stripe doit continuer d'etre respecte sans verification. */
if (src.indexOf('!owner?.use_bh_stripe') === -1 || src.indexOf('!user?.use_bh_stripe') === -1) {
  echec('Le respect de use_bh_stripe a ete perdu.');
}
/* Le verificateur doit etre defini AVANT son premier usage. */
if (src.indexOf('async function compteStripeUtilisable') > src.indexOf('if (await compteStripeUtilisable(owner')) {
  echec('Le verificateur est defini apres son premier appel.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('compteStripeUtilisable') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Un compte proprietaire qui ne peut pas encaisser (paiements desactives');
console.log('  ou nom d\'entreprise absent) n\'est plus utilise : l\'encaissement passe');
console.log('  par le compte Boostinghost, et le journal le dit.');
console.log('');
console.log('  Si Stripe ne repond pas, le compte du proprietaire est CONSERVE :');
console.log('  on ne detourne pas des fonds sur un doute.');
console.log('');
console.log('  Redemarrez le serveur, puis surveillez :');
console.log('    ⚠️ [STRIPE] acct_… inutilisable (…) — encaissement bascule');
console.log('');
console.log('  A FAIRE ENSUITE : prevenir le proprietaire. Ses paiements arrivent');
console.log('  desormais chez vous et devront lui etre reverses — l\'ecran de');
console.log('  connexion Stripe devrait afficher « inscription inachevee ».\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
