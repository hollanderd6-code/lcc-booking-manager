/**
 * Rattrapage des deux cautions stuck en `authorized`.
 *
 * Mode simulation (défaut) — affiche ce qui serait fait, ne touche rien :
 *   STRIPE_SECRET_KEY=sk_live_... DATABASE_URL=postgres://... node scripts/backfill-deposits-fix.js
 *
 * Mode exécution — applique les changements :
 *   STRIPE_SECRET_KEY=sk_live_... DATABASE_URL=postgres://... node scripts/backfill-deposits-fix.js --execute
 *
 * dep_mppzx8z5nbl3f  PI succeeded  → captured  (captured_amount et captured_at depuis Stripe)
 * dep_mpqoq26p       PI canceled   → auth_expired
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const Stripe    = require('stripe');

const DRY_RUN = !process.argv.includes('--execute');

const FIXES = [
  {
    depositId:         'dep_mppzx8z5nbl3f',
    piId:              'pi_3TcBaWFT0WaR8aHH1SClJbZn',
    useConnectAccount: true,   // PI créé sur le compte Connect de l'utilisateur
  },
  {
    depositId:         'dep_mpqoq26p',
    piId:              'pi_3Tcra6FDAmyxvgFK1kMtPs9c',
    useConnectAccount: false,  // PI créé sur le compte plateforme
  },
];

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) { console.error('❌  STRIPE_SECRET_KEY manquante.'); process.exit(1); }
  if (!process.env.DATABASE_URL)      { console.error('❌  DATABASE_URL manquante.');      process.exit(1); }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
  const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  console.log(DRY_RUN
    ? '\n⚠️  MODE SIMULATION — aucune modification. Relancez avec --execute pour appliquer.\n'
    : '\n🔴 MODE EXÉCUTION — les changements seront écrits en base.\n'
  );

  for (const fix of FIXES) {
    console.log('─'.repeat(60));
    console.log(`Dépôt : ${fix.depositId}   PI : ${fix.piId}`);

    // ── Lire le dépôt en base ──────────────────────────────────────────────
    const { rows } = await pool.query(`
      SELECT d.id, d.status, d.amount_cents, d.user_id,
             d.captured_amount, d.captured_at,
             u.stripe_account_id,
             u.email AS user_email
      FROM deposits d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE d.id = $1
    `, [fix.depositId]);

    if (rows.length === 0) {
      console.warn('  ⚠️  Dépôt introuvable en base — ignoré.');
      continue;
    }

    const dep = rows[0];
    console.log(`  Statut actuel     : ${dep.status}`);
    console.log(`  User              : ${dep.user_id} (${dep.user_email || '?'})`);
    console.log(`  stripe_account_id : ${dep.stripe_account_id || '(null — plateforme)'}`);

    // ── Retrieve Stripe ────────────────────────────────────────────────────
    // 2e arg = params (expand), 3e arg = options (stripeAccount) — ne passer
    // le 3e argument QUE si stripeAccount est défini ({}  vide → "Unknown arguments").
    let pi;
    try {
      pi = fix.useConnectAccount && dep.stripe_account_id
        ? await stripe.paymentIntents.retrieve(fix.piId, { expand: ['latest_charge'] }, { stripeAccount: dep.stripe_account_id })
        : await stripe.paymentIntents.retrieve(fix.piId, { expand: ['latest_charge'] });
    } catch (err) {
      console.error(`  ❌  Retrieve échoué : [${err.type}/${err.code}] ${err.message}`);
      console.error('  Abandon de ce dépôt.');
      continue;
    }

    console.log(`  Statut Stripe     : ${pi.status}`);
    console.log(`  amount            : ${(pi.amount / 100).toFixed(2)} €`);
    console.log(`  amount_received   : ${(pi.amount_received / 100).toFixed(2)} €`);

    // ── Traitement selon le statut ─────────────────────────────────────────
    if (pi.status === 'succeeded') {
      const capturedAmount = pi.amount_received;
      const charge         = pi.latest_charge;
      const capturedAt     = (charge && charge.created)
        ? new Date(charge.created * 1000).toISOString()
        : null;

      console.log('\n  Changement prévu sur deposits :');
      console.log(`    status          : '${dep.status}' → 'captured'`);
      console.log(`    captured_amount : ${dep.captured_amount ?? '(null)'} → ${capturedAmount} cts (${(capturedAmount / 100).toFixed(2)} €)`);
      console.log(`    captured_at     : ${dep.captured_at ?? '(null)'} → ${capturedAt ?? 'NOW() (charge.created absent)'}`);

      if (!DRY_RUN) {
        await pool.query(
          `UPDATE deposits
           SET status = 'captured', captured_amount = $2, captured_at = $3, updated_at = NOW()
           WHERE id = $1 AND status = 'authorized'`,
          [fix.depositId, capturedAmount, capturedAt ?? new Date().toISOString()]
        );
        console.log('  ✅  UPDATE appliqué.');
      }

    } else if (pi.status === 'canceled') {
      console.log('\n  Changement prévu sur deposits :');
      console.log(`    status : '${dep.status}' → 'auth_expired'`);

      if (!DRY_RUN) {
        await pool.query(
          `UPDATE deposits SET status = 'auth_expired', updated_at = NOW()
           WHERE id = $1 AND status = 'authorized'`,
          [fix.depositId]
        );
        console.log('  ✅  UPDATE appliqué.');
      }

    } else {
      console.warn(`  ⚠️  Statut Stripe inattendu : ${pi.status} — aucun changement prévu.`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(DRY_RUN
    ? 'Simulation terminée. Relancez avec --execute pour appliquer.'
    : 'Rattrapage terminé.'
  );

  await pool.end();
}

main().catch((err) => { console.error('Erreur inattendue :', err); process.exit(1); });
