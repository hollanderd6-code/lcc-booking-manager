/**
 * Cron de réconciliation quotidienne des cautions Stripe
 *
 * Activation dans server.js (après initDb) :
 *   const { initDepositReconcileCron } = require('./scripts/reconcile-deposits-cron');
 *   initDepositReconcileCron(pool, stripe, sendNotificationToMultipleLogged);
 *
 * Deux tâches quotidiennes :
 *   08h00 — Réconciliation : authorized → auth_expired si le PI Stripe est canceled
 *   08h05 — Alerte J+5    : push sur les cautions qui expirent dans < 48h
 */

'use strict';

const cron = require('node-cron');

function initDepositReconcileCron(pool, stripe, sendPush) {

  cron.schedule('0 8 * * *', async () => {
    console.log('[cron reconcile-deposits] Démarrage réconciliation…');
    try {
      await reconcileAuthorized(pool, stripe);
    } catch (err) {
      console.error('[cron reconcile-deposits] Erreur fatale :', err.message);
    }
  }, { timezone: 'Europe/Paris' });

  cron.schedule('5 8 * * *', async () => {
    console.log('[cron deposit-expiry-alert] Vérification cautions proches expiration…');
    try {
      await alertExpiringAuthorizations(pool, sendPush);
    } catch (err) {
      console.error('[cron deposit-expiry-alert] Erreur :', err.message);
    }
  }, { timezone: 'Europe/Paris' });

  console.log('✅ Crons réconciliation cautions initialisés (08h00 et 08h05 Europe/Paris)');
}

// ─── Réconciliation ────────────────────────────────────────────────────────────

async function reconcileAuthorized(pool, stripe) {
  const { rows } = await pool.query(`
    SELECT d.id, d.stripe_payment_intent_id, d.amount_cents, d.user_id,
           u.stripe_account_id
    FROM deposits d
    LEFT JOIN users u ON u.id = d.user_id
    WHERE d.status = 'authorized'
      AND d.stripe_payment_intent_id IS NOT NULL
  `);

  if (rows.length === 0) {
    console.log('[reconcile] Aucun dépôt authorized avec PI Stripe.');
    return;
  }

  console.log(`[reconcile] ${rows.length} dépôt(s) à vérifier…`);
  const toExpire = [];

  for (const dep of rows) {
    const stripeOpts = dep.stripe_account_id
      ? { stripeAccount: dep.stripe_account_id }
      : {};
    try {
      const pi = await stripe.paymentIntents.retrieve(dep.stripe_payment_intent_id, stripeOpts);
      if (pi.status === 'canceled') {
        toExpire.push(dep.id);
      }
    } catch (err) {
      // Erreur isolée (mauvais compte Connect, PI supprimé…) — on continue.
      console.warn(`[reconcile] Impossible de récupérer ${dep.stripe_payment_intent_id} (${dep.id}) : ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  if (toExpire.length === 0) {
    console.log('[reconcile] Aucun dépôt à passer en auth_expired.');
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE deposits
       SET status = 'auth_expired', updated_at = NOW()
       WHERE id = ANY($1::text[]) AND status = 'authorized'`,
      [toExpire]
    );
    console.log(`[reconcile] ${result.rowCount} caution(s) passée(s) en auth_expired.`);
  } catch (err) {
    console.error('[reconcile] Erreur lors de la mise à jour en base :', err.message);
  }
}

// ─── Alerte J+5 ───────────────────────────────────────────────────────────────

async function alertExpiringAuthorizations(pool, sendPush) {
  // Autorisations entre J+5 et J+6 : expiration Stripe dans < 48h
  const { rows } = await pool.query(`
    SELECT
      d.id,
      d.amount_cents,
      d.authorized_at,
      d.reservation_uid,
      d.user_id,
      r.guest_name,
      p.name AS property_name,
      ROUND(EXTRACT(EPOCH FROM (NOW() - d.authorized_at)) / 86400, 1) AS age_days
    FROM deposits d
    LEFT JOIN reservations r ON r.uid = d.reservation_uid
    LEFT JOIN properties p   ON p.id  = d.property_id
    WHERE d.status = 'authorized'
      AND d.stripe_payment_intent_id IS NOT NULL
      AND d.authorized_at >= NOW() - INTERVAL '6 days'
      AND d.authorized_at <  NOW() - INTERVAL '5 days'
    ORDER BY d.authorized_at
  `);

  if (rows.length === 0) {
    console.log('[deposit-expiry-alert] Aucune caution proche de l\'expiration.');
    return;
  }

  console.warn(`[deposit-expiry-alert] ⚠️  ${rows.length} caution(s) expirent dans < 48h`);

  for (const dep of rows) {
    const amount  = (dep.amount_cents / 100).toFixed(2);
    const guest   = dep.guest_name   || 'Voyageur';
    const prop    = dep.property_name || '';
    const logLine = `${dep.id}  ${amount} €  ${guest}  ${prop}  (${dep.age_days}j)`;

    console.warn(`  → ${logLine}`);

    if (typeof sendPush !== 'function') continue;

    try {
      const tokensRes = await pool.query(
        'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
        [dep.user_id]
      );
      if (tokensRes.rows.length === 0) {
        console.warn(`[deposit-expiry-alert] Aucun token FCM pour user ${dep.user_id}`);
        continue;
      }
      const tokens = tokensRes.rows.map((r) => r.fcm_token);
      const body   = [guest, prop, amount + ' €'].filter(Boolean).join(' · ');

      await sendPush(
        tokens,
        '⏰ Caution expire dans 48h',
        body,
        {
          type:           'deposit_expiry_alert',
          depositId:      String(dep.id),
          reservationUid: String(dep.reservation_uid || ''),
          userId:         String(dep.user_id),
          _group:         'type_deposit_expiry_alert'
        }
      );
    } catch (err) {
      console.error(`[deposit-expiry-alert] Erreur push pour ${dep.id} : ${err.message}`);
    }
  }
}

module.exports = { initDepositReconcileCron };
