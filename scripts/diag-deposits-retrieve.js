/**
 * Diagnostic READ-ONLY — retrieve Stripe des deux PI bloqués en authorized.
 *
 * Usage :
 *   STRIPE_SECRET_KEY=sk_live_... DATABASE_URL=postgres://... node scripts/diag-deposits-retrieve.js
 *
 * Ne modifie rien en base ni chez Stripe.
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const Stripe    = require('stripe');

const TARGETS = [
  { depositId: 'dep_mppzx8z5nbl3f', piId: 'pi_3TcBaWFT0WaR8aHH1SClJbZn' },
  { depositId: 'dep_mpqoq26p',      piId: 'pi_3Tcra6FDAmyxvgFK1kMtPs9c'  },
];

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌  STRIPE_SECRET_KEY manquante.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌  DATABASE_URL manquante.');
    process.exit(1);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
  const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  for (const { depositId, piId } of TARGETS) {
    console.log('\n' + '─'.repeat(60));
    console.log(`Dépôt   : ${depositId}`);
    console.log(`PI      : ${piId}`);

    // Lire le dépôt + stripe_account_id du user propriétaire
    const { rows } = await pool.query(`
      SELECT d.id, d.status, d.user_id, d.amount_cents,
             u.stripe_account_id
      FROM deposits d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE d.id = $1
    `, [depositId]);

    if (rows.length === 0) {
      console.warn('  ⚠️  Dépôt introuvable en base.');
      continue;
    }

    const dep = rows[0];
    console.log(`Statut  : ${dep.status}`);
    console.log(`User    : ${dep.user_id}`);
    console.log(`Montant : ${(dep.amount_cents / 100).toFixed(2)} €`);
    console.log(`stripe_account_id en base : ${dep.stripe_account_id ?? '(null — compte plateforme)'}`);

    // ── Tentative 1 : exactement comme le cron ──────────────────────────────
    const stripeOpts = dep.stripe_account_id ? { stripeAccount: dep.stripe_account_id } : {};
    console.log(`\n[1/2] retrieve avec ${dep.stripe_account_id ? `stripeAccount=${dep.stripe_account_id}` : 'compte plateforme (pas de stripeAccount)'}`);
    await tryRetrieve(stripe, piId, stripeOpts);

    // ── Tentative 2 : l'inverse de ce que le cron fait ──────────────────────
    if (dep.stripe_account_id) {
      console.log(`\n[2/2] retrieve sans stripeAccount (compte plateforme)`);
      await tryRetrieve(stripe, piId, {});
    } else {
      // Extraire le suffixe du compte Connect depuis l'ID du PI
      // Format Stripe Connect : pi_3<accountSuffix><random>
      // acct_ suivi des 14 premiers caractères après "pi_3"
      const guessedAccount = guessAccountFromPiId(piId);
      if (guessedAccount) {
        console.log(`\n[2/2] retrieve avec compte déduit de l'ID du PI : ${guessedAccount}`);
        await tryRetrieve(stripe, piId, { stripeAccount: guessedAccount });
      } else {
        console.log('\n[2/2] Impossible de déduire un compte depuis l\'ID du PI.');
      }
    }
  }

  await pool.end();
  console.log('\n' + '─'.repeat(60));
  console.log('Diagnostic terminé.');
}

async function tryRetrieve(stripe, piId, opts) {
  try {
    const pi = await stripe.paymentIntents.retrieve(piId, opts);
    console.log(`  ✅  Retrieve OK`);
    console.log(`      status          : ${pi.status}`);
    console.log(`      amount          : ${(pi.amount / 100).toFixed(2)} €`);
    console.log(`      created         : ${new Date(pi.created * 1000).toISOString()}`);
    console.log(`      livemode        : ${pi.livemode}`);
    if (pi.on_behalf_of) console.log(`      on_behalf_of    : ${pi.on_behalf_of}`);
    if (pi.transfer_data) console.log(`      transfer_data   : ${JSON.stringify(pi.transfer_data)}`);
  } catch (err) {
    console.log(`  ❌  Erreur Stripe`);
    console.log(`      type    : ${err.type    ?? '(absent)'}`);
    console.log(`      code    : ${err.code    ?? '(absent)'}`);
    console.log(`      param   : ${err.param   ?? '(absent)'}`);
    console.log(`      message : ${err.message}`);
    if (err.raw) {
      console.log(`      raw.status        : ${err.raw.statusCode ?? err.raw.status ?? '(absent)'}`);
      console.log(`      raw.decline_code  : ${err.raw.decline_code ?? '(absent)'}`);
    }
  }
}

// Heuristique : dans un PI Connect, l'ID encode le compte source.
// pi_3<14 chars account suffix><...>  →  acct_1<14 chars>
// Exemple : pi_3TcBaWFT0WaR8aHH1... → acct_1TcBaWFT0WaR8aHH
function guessAccountFromPiId(piId) {
  const m = piId.match(/^pi_3([A-Za-z0-9]{14})/);
  return m ? `acct_1${m[1]}` : null;
}

main().catch((err) => {
  console.error('Erreur inattendue :', err);
  process.exit(1);
});
