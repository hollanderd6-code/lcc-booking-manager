#!/usr/bin/env node
/* ============================================================
   outils/stripe-comptes-sans-nom.js
   Quels comptes Stripe bloquent les cautions ?
   ============================================================
   LECTURE SEULE. Ce script n'ecrit rien, ni en base, ni chez Stripe.

   ── LE PROBLEME ─────────────────────────────────────────────────
   Les journaux du serveur sont remplis de :

     ❌ [REGEN CRON] Caution dep_xxxx: In order to use Checkout, you
        must set an account or business name at
        https://dashboard.stripe.com/account.

   Les sessions de paiement sont creees SUR LE COMPTE STRIPE du
   proprietaire (option { stripeAccount }), pas sur le votre. Or Stripe
   refuse d'ouvrir une page Checkout tant que le compte n'a pas de nom
   d'entreprise. Consequence : toutes les cautions de ce proprietaire
   echouent, le cron reessaie a chaque passage, et personne n'est
   prevenu — ni lui, ni le voyageur, ni vous.

   ── CE QUE FAIT CE SCRIPT ───────────────────────────────────────
   Il liste les comptes Stripe connectes et signale ceux auxquels il
   manque un nom, en indiquant a quel proprietaire ou utilisateur ils
   appartiennent. Vous saurez qui appeler.

   Il verifie aussi les charges_enabled / payouts_enabled : un compte
   sans nom n'est souvent qu'un compte d'inscription inachevee.

   ── AVANT DE LANCER ─────────────────────────────────────────────
   Depuis la racine du projet, avec le .env qui contient
   STRIPE_SECRET_KEY et DATABASE_URL. Si DATABASE_URL pointe sur la base
   de production (Render), le script ne fera que LIRE la table
   owner_clients et users pour mettre un nom sur chaque compte.

     node outils/stripe-comptes-sans-nom.js
   ============================================================ */

require('dotenv').config();

const CLE = process.env.STRIPE_SECRET_KEY;
if (!CLE) {
  console.error('\n  \u2717 STRIPE_SECRET_KEY absente du .env.\n');
  process.exit(1);
}
if (!/^sk_(test|live)_/.test(CLE)) {
  console.error('\n  \u2717 STRIPE_SECRET_KEY ne ressemble pas a une cle secrete Stripe.\n');
  process.exit(1);
}
console.log('\n  Mode : ' + (CLE.startsWith('sk_live_') ? 'PRODUCTION (live)' : 'test'));

const stripe = require('stripe')(CLE);

/* La base sert uniquement a nommer les comptes. Sans elle, le script
   fonctionne quand meme, avec les identifiants Stripe bruts. */
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  } catch (e) {
    console.warn('  (base indisponible : les comptes seront affiches sans leur proprietaire)');
  }
}

async function proprietaires() {
  const carte = new Map();
  if (!pool) return carte;
  try {
    const oc = await pool.query(
      `SELECT stripe_account_id, company_name, first_name, last_name, email, use_bh_stripe
         FROM owner_clients WHERE stripe_account_id IS NOT NULL`
    );
    for (const r of oc.rows) {
      const nom = r.company_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
      carte.set(r.stripe_account_id, { nom: nom || '(sans nom)', type: 'propriétaire', bh: r.use_bh_stripe });
    }
  } catch (e) { console.warn('  (owner_clients illisible : ' + e.message + ')'); }
  try {
    const us = await pool.query(
      `SELECT stripe_account_id, company, first_name, last_name, email
         FROM users WHERE stripe_account_id IS NOT NULL`
    );
    for (const r of us.rows) {
      if (carte.has(r.stripe_account_id)) continue;
      const nom = r.company || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
      carte.set(r.stripe_account_id, { nom: nom || '(sans nom)', type: 'compte BH' });
    }
  } catch (e) { console.warn('  (users illisible : ' + e.message + ')'); }
  return carte;
}

(async () => {
  const carte = await proprietaires();
  console.log('  Comptes connectes references en base : ' + carte.size);

  const comptes = [];
  try {
    /* auto-pagination : la liste peut depasser une page. */
    for await (const c of stripe.accounts.list({ limit: 100 })) comptes.push(c);
  } catch (e) {
    console.error('\n  \u2717 Stripe a refuse la liste des comptes — ' + e.message);
    console.error('    (une cle restreinte peut ne pas avoir le droit « Connect : lecture »)\n');
    if (pool) await pool.end();
    process.exit(1);
  }

  const nomDe = (c) => (c.business_profile && c.business_profile.name)
    || (c.settings && c.settings.dashboard && c.settings.dashboard.display_name)
    || null;

  const sansNom = [];
  const ok = [];
  for (const c of comptes) {
    (nomDe(c) ? ok : sansNom).push(c);
  }

  console.log('  Comptes Stripe connectes trouves    : ' + comptes.length);
  console.log('  Avec un nom d\'entreprise            : ' + ok.length);
  console.log('  SANS nom — cautions bloquees        : ' + sansNom.length);

  if (!sansNom.length) {
    console.log('\n  Aucun compte sans nom. La cause des echecs est ailleurs :');
    console.log('  relevez un identifiant dep_… dans les journaux et cherchez sur quel');
    console.log('  compte sa session est creee.\n');
    if (pool) await pool.end();
    return;
  }

  console.log('\n  ── Comptes a corriger ────────────────────────────────────────');
  for (const c of sansNom) {
    const info = carte.get(c.id);
    const qui = info ? info.nom + '  (' + info.type + ')' : '(inconnu en base)';
    const etat = [
      c.charges_enabled ? 'paiements OK' : 'PAIEMENTS DESACTIVES',
      c.payouts_enabled ? 'virements OK' : 'virements desactives',
      c.details_submitted ? null : 'inscription inachevee',
    ].filter(Boolean).join(' · ');
    console.log('');
    console.log('  ' + c.id);
    console.log('    ' + qui);
    console.log('    ' + etat);
    if (c.email) console.log('    ' + c.email);
    if (info && info.bh === true) {
      console.log('    ⚠️  use_bh_stripe = true : ce compte encaisse via VOTRE Stripe,');
      console.log('       le nom manquant ne devrait donc pas bloquer ses cautions.');
    }
  }

  console.log('\n  ── Ce qu\'il faut faire ───────────────────────────────────────');
  console.log('  Chaque proprietaire doit renseigner le nom de son activite :');
  console.log('    dashboard.stripe.com > Parametres > Informations sur l\'entreprise');
  console.log('    (champ « Nom de l\'entreprise » ou « Nom public »)');
  console.log('  Vous ne pouvez pas le faire a leur place : ce champ appartient a');
  console.log('  leur compte, pas au votre.');
  console.log('');
  console.log('  Une fois le nom renseigne, le cron de regeneration reprendra ces');
  console.log('  cautions au passage suivant, sans intervention.');
  console.log('');
  console.log('  Les comptes marques « inscription inachevee » ont un probleme plus');
  console.log('  large : le proprietaire n\'a pas termine son inscription Stripe, et');
  console.log('  aucun paiement ne lui parviendra.\n');

  if (pool) await pool.end();
})().catch(async (e) => {
  console.error('\n  \u2717 ' + e.message + '\n');
  if (pool) await pool.end();
  process.exit(1);
});
