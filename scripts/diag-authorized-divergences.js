/**
 * Diagnostic READ-ONLY — divergences entre statut DB (authorized) et statut Stripe.
 *
 * Usage :
 *   STRIPE_SECRET_KEY=sk_live_... DATABASE_URL=postgres://... node scripts/diag-authorized-divergences.js
 *
 * Ne modifie rien. Affiche le compte par catégorie et le détail des cas anormaux.
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const Stripe    = require('stripe');

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) { console.error('❌  STRIPE_SECRET_KEY manquante.'); process.exit(1); }
  if (!process.env.DATABASE_URL)      { console.error('❌  DATABASE_URL manquante.');      process.exit(1); }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
  const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const { rows } = await pool.query(`
    SELECT d.id, d.stripe_payment_intent_id, d.amount_cents, d.authorized_at,
           d.captured_amount, d.user_id, d.reservation_uid,
           u.stripe_account_id,
           r.guest_name,
           p.name AS property_name
    FROM deposits d
    LEFT JOIN users       u ON u.id  = d.user_id
    LEFT JOIN reservations r ON r.uid = d.reservation_uid
    LEFT JOIN properties  p ON p.id  = d.property_id
    WHERE d.status = 'authorized'
      AND d.stripe_payment_intent_id IS NOT NULL
    ORDER BY d.authorized_at
  `);

  console.log(`\n${rows.length} dépôt(s) authorized avec PI Stripe en base.\n`);
  if (rows.length === 0) { await pool.end(); return; }

  const counts = { ok: 0, succeeded: 0, canceled: 0, other: 0, error_both: 0 };
  const details = { succeeded: [], canceled: [], other: [], error_both: [] };

  for (const dep of rows) {
    const result = await retrieveBothPaths(stripe, dep.stripe_payment_intent_id, dep.stripe_account_id);

    const row = {
      id:            dep.id,
      pi:            dep.stripe_payment_intent_id,
      amount:        dep.amount_cents != null ? (dep.amount_cents / 100).toFixed(2) + ' €' : '?',
      authorized_at: dep.authorized_at ? dep.authorized_at.toISOString().slice(0, 10) : '?',
      guest:         dep.guest_name     || '—',
      property:      dep.property_name  || '—',
      account_db:    dep.stripe_account_id || '(plateforme)',
      account_used:  result.accountUsed  || '—',
      pi_status:     result.pi?.status   || '—',
      pi_amount:     result.pi ? (result.pi.amount / 100).toFixed(2) + ' €' : '—',
      pi_captured:   result.pi?.amount_received != null ? (result.pi.amount_received / 100).toFixed(2) + ' €' : '—',
      error:         result.error || null,
    };

    if (result.error) {
      counts.error_both++;
      details.error_both.push(row);
    } else if (result.pi.status === 'requires_capture') {
      counts.ok++;
    } else if (result.pi.status === 'succeeded') {
      counts.succeeded++;
      details.succeeded.push(row);
    } else if (result.pi.status === 'canceled') {
      counts.canceled++;
      details.canceled.push(row);
    } else {
      counts.other++;
      details.other.push(row);
    }

    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log('\n');
  console.log('══════════════════════════════════════════════════');
  console.log('RÉSUMÉ');
  console.log('══════════════════════════════════════════════════');
  console.log(`  requires_capture (OK — toujours actif) : ${counts.ok}`);
  console.log(`  succeeded  → doit passer à captured    : ${counts.succeeded}`);
  console.log(`  canceled   → doit passer à auth_expired: ${counts.canceled}`);
  console.log(`  autre statut Stripe                     : ${counts.other}`);
  console.log(`  retrieve échoue des deux côtés          : ${counts.error_both}`);
  console.log('──────────────────────────────────────────────────');

  printSection('CAPTURES NON ENREGISTRÉES (succeeded en attente)', details.succeeded, true);
  printSection('EXPIRATIONS NON ENREGISTRÉES (canceled en attente)', details.canceled, false);
  printSection('STATUT INATTENDU', details.other, false);
  printSection('RETRIEVE IMPOSSIBLE DES DEUX CÔTÉS', details.error_both, false);

  await pool.end();
}

function printSection(title, rows, showCapture) {
  if (rows.length === 0) return;
  console.log(`\n── ${title} (${rows.length}) ──`);
  for (const r of rows) {
    console.log(`  ${r.id}  ${r.pi}`);
    console.log(`    statut Stripe : ${r.pi_status}   montant PI : ${r.pi_amount}${showCapture ? '  capturé Stripe : ' + r.pi_captured : ''}`);
    console.log(`    autorisé le   : ${r.authorized_at}   ${r.guest} — ${r.property}`);
    console.log(`    compte DB     : ${r.account_db}   compte utilisé : ${r.account_used}`);
    if (r.error) console.log(`    erreur        : ${r.error}`);
  }
}

async function retrieveBothPaths(stripe, piId, stripeAccountId) {
  // Essai 1 : chemin que le cron utilise aujourd'hui
  const opts1 = stripeAccountId ? { stripeAccount: stripeAccountId } : {};
  const r1 = await tryRetrieve(stripe, piId, opts1);
  if (r1.pi) return { pi: r1.pi, accountUsed: stripeAccountId || '(plateforme)' };

  // Essai 2 : l'autre chemin
  const opts2 = stripeAccountId ? {} : (() => {
    const guessed = guessAccountFromPiId(piId);
    return guessed ? { stripeAccount: guessed } : null;
  })();

  if (!opts2) return { error: r1.error };

  const r2 = await tryRetrieve(stripe, piId, opts2);
  if (r2.pi) {
    const usedAccount = opts2.stripeAccount || '(plateforme)';
    return { pi: r2.pi, accountUsed: usedAccount + ' [compte DB incorrect]' };
  }

  return { error: `[chemin1] ${r1.error} | [chemin2] ${r2.error}` };
}

async function tryRetrieve(stripe, piId, opts) {
  try {
    const pi = await stripe.paymentIntents.retrieve(piId, opts);
    return { pi };
  } catch (err) {
    const detail = [err.type, err.code].filter(Boolean).join('/') || 'unknown';
    return { error: `${detail}: ${err.message}` };
  }
}

function guessAccountFromPiId(piId) {
  const m = piId.match(/^pi_3([A-Za-z0-9]{14})/);
  return m ? `acct_1${m[1]}` : null;
}

main().catch((err) => { console.error('Erreur inattendue :', err); process.exit(1); });
