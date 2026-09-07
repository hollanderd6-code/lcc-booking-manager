#!/usr/bin/env node
/**
 * Réconciliation des statuts de cautions Stripe
 *
 * Pour chaque dépôt `authorized` avec un stripe_payment_intent_id, interroge
 * Stripe et met à jour le statut local si le PI est expiré/annulé.
 *
 * Usage :
 *   node scripts/reconcile-deposits.js            # dry-run (rien n'est écrit)
 *   node scripts/reconcile-deposits.js --execute  # mise à jour réelle
 */

'use strict';
require('dotenv').config();

const { Pool } = require('pg');
const Stripe = require('stripe');

// ─── Configuration ────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--execute');
const DELAY_MS = 120; // pause entre appels Stripe pour rester sous les rate limits

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31.basil',
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(cents) {
  return (cents / 100).toFixed(2) + ' €';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Réconciliation cautions Stripe — ${DRY_RUN ? 'DRY-RUN (lecture seule)' : '*** EXÉCUTION RÉELLE ***'}`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. Charger tous les dépôts authorized avec un PI Stripe
  const { rows: deposits } = await pool.query(`
    SELECT
      d.id,
      d.stripe_payment_intent_id,
      d.amount_cents,
      d.authorized_at,
      d.user_id,
      d.reservation_uid,
      u.stripe_account_id
    FROM deposits d
    LEFT JOIN users u ON u.id = d.user_id
    WHERE d.status = 'authorized'
      AND d.stripe_payment_intent_id IS NOT NULL
    ORDER BY d.authorized_at ASC NULLS LAST
  `);

  console.log(`Dépôts à vérifier : ${deposits.length}\n`);

  const counts = { ok: 0, expired: 0, other: 0, error: 0 };
  const toUpdate = [];

  // 2. Interroger Stripe pour chaque PI
  for (const dep of deposits) {
    const stripeOpts = dep.stripe_account_id
      ? { stripeAccount: dep.stripe_account_id }
      : {};

    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(dep.stripe_payment_intent_id, stripeOpts);
      await sleep(DELAY_MS);
    } catch (err) {
      // PI introuvable sur ce compte (compte Connect désactivé, PI supprimé…)
      const msg = err.message || String(err);
      console.error(`  ❌ ERREUR retrieve ${dep.stripe_payment_intent_id} : ${msg}`);
      counts.error++;
      continue;
    }

    const age = dep.authorized_at
      ? Math.round((Date.now() - new Date(dep.authorized_at)) / 86400000) + 'j'
      : '(authorized_at manquant)';

    if (pi.status === 'requires_capture') {
      console.log(`  ✅ OK        ${dep.id}  ${fmt(dep.amount_cents)}  âge:${age}  — encore capturable`);
      counts.ok++;
    } else if (pi.status === 'canceled') {
      // Expiré automatiquement par Stripe (7 jours sans capture) OU annulé explicitement.
      // La cancellation_reason 'expired' confirme l'expiration automatique, mais on
      // traite les deux de la même façon : l'empreinte n'existe plus.
      const reason = pi.cancellation_reason || 'unknown';
      console.log(`  ⏰ EXPIRÉ    ${dep.id}  ${fmt(dep.amount_cents)}  âge:${age}  reason:${reason}`);
      counts.expired++;
      toUpdate.push(dep.id);
    } else {
      // Statuts inattendus : requires_payment_method, processing, succeeded…
      console.log(`  ❓ AUTRE     ${dep.id}  ${fmt(dep.amount_cents)}  âge:${age}  status Stripe:${pi.status}`);
      counts.other++;
    }
  }

  // 3. Résumé avant écriture
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Résumé :`);
  console.log(`  Encore capturables (requires_capture) : ${counts.ok}`);
  console.log(`  À passer en auth_expired              : ${counts.expired}`);
  console.log(`  Statut Stripe inattendu               : ${counts.other}`);
  console.log(`  Erreurs retrieve                      : ${counts.error}`);
  console.log(`${'─'.repeat(60)}\n`);

  if (toUpdate.length === 0) {
    console.log('Rien à mettre à jour.');
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log(`DRY-RUN : ${toUpdate.length} dépôt(s) seraient passés à auth_expired.`);
    console.log('Relancez avec --execute pour appliquer.\n');
    await pool.end();
    return;
  }

  // 4. Mise à jour réelle
  console.log(`Mise à jour de ${toUpdate.length} dépôt(s) → auth_expired…`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE deposits
       SET status = 'auth_expired',
           updated_at = NOW()
       WHERE id = ANY($1::text[])
         AND status = 'authorized'`,
      [toUpdate]
    );

    await client.query('COMMIT');
    console.log(`✅ ${result.rowCount} ligne(s) mise(s) à jour.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur pendant la mise à jour, rollback effectué :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exitCode = 1;
  pool.end();
});
