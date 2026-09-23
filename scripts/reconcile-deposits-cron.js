/**
 * Cron de réconciliation quotidienne des cautions Stripe
 *
 * Activation dans server.js (après initDb) :
 *   const { initDepositReconcileCron } = require('./scripts/reconcile-deposits-cron');
 *   initDepositReconcileCron(pool, stripe, sendNotificationToMultipleLogged);
 *
 * Deux tâches quotidiennes :
 *   08h00 — Réconciliation complète (tous statuts Stripe traités, double chemin Connect/plateforme)
 *   08h05 — Alerte J+5 : push sur les cautions qui expirent dans < 48h
 *
 * Statuts Stripe → DB :
 *   requires_capture → rien (caution toujours valide)
 *   succeeded        → captured  (captured_amount et captured_at depuis Stripe)
 *   canceled         → auth_expired
 *   autre            → loggué, pas touché
 *   retrieve échoue des deux côtés 5 fois → unresolved
 */

'use strict';

const cron = require('node-cron');

// ─── Initialisation ────────────────────────────────────────────────────────────

function initDepositReconcileCron(pool, stripe, sendPush) {

  // Migration idempotente appliquée au démarrage du serveur, pas à 8h00.
  pool.query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS reconcile_errors INTEGER NOT NULL DEFAULT 0`)
    .catch(err => console.error('[reconcile] Migration reconcile_errors :', err.message));

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
           d.reconcile_errors,
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
  let nCaptured = 0, nExpired = 0, nUnresolved = 0, nErrTemp = 0;

  for (const dep of rows) {
    const { pi, accountUsed, accountCorrected, errorDetail } = await retrieveBothPaths(
      stripe, dep.stripe_payment_intent_id, dep.stripe_account_id
    );

    // ── Retrieve impossible des deux côtés ──────────────────────────────────
    if (!pi) {
      const newErrors = (dep.reconcile_errors || 0) + 1;
      if (newErrors >= 5) {
        await pool.query(
          `UPDATE deposits
           SET status = 'unresolved', reconcile_errors = $2, updated_at = NOW()
           WHERE id = $1 AND status = 'authorized'`,
          [dep.id, newErrors]
        );
        console.warn(`[reconcile] ${dep.id} → unresolved après ${newErrors} échecs. [${errorDetail}]`);
        nUnresolved++;
      } else {
        await pool.query(
          `UPDATE deposits SET reconcile_errors = $2, updated_at = NOW() WHERE id = $1`,
          [dep.id, newErrors]
        );
        console.warn(`[reconcile] ${dep.id} retrieve impossible des deux côtés [${errorDetail}] — échec ${newErrors}/5`);
        nErrTemp++;
      }
      await sleep(120);
      continue;
    }

    // ── Retrieve OK ─────────────────────────────────────────────────────────

    // Remettre le compteur à zéro si des erreurs antérieures avaient été comptées
    if ((dep.reconcile_errors || 0) > 0) {
      await pool.query(`UPDATE deposits SET reconcile_errors = 0 WHERE id = $1`, [dep.id]);
    }

    // Corriger stripe_account_id sur l'utilisateur si le bon chemin différait du chemin DB
    if (accountCorrected !== undefined) {
      const newAccountId = accountCorrected === null ? null : accountCorrected;
      await pool.query(
        `UPDATE users SET stripe_account_id = $2 WHERE id = $1`,
        [dep.user_id, newAccountId]
      );
      console.log(
        `[reconcile] user ${dep.user_id} stripe_account_id corrigé : ` +
        `${dep.stripe_account_id || '(plateforme)'} → ${newAccountId || '(plateforme)'} ` +
        `(déduit de ${dep.id})`
      );
    }

    // ── Traitement selon le statut Stripe ───────────────────────────────────
    if (pi.status === 'requires_capture') {
      // Caution toujours valide, rien à faire.

    } else if (pi.status === 'succeeded') {
      // La caution a été capturée (depuis le dashboard Stripe ou une ancienne version).
      // amount_received = montant réellement prélevé (capture partielle possible).
      const capturedAmount = pi.amount_received;

      // captured_at = date de la capture depuis la charge associée au PI.
      const charge = pi.latest_charge;
      const capturedAt = (charge && charge.created)
        ? new Date(charge.created * 1000).toISOString()
        : new Date().toISOString();

      await pool.query(
        `UPDATE deposits
         SET status = 'captured', captured_amount = $2, captured_at = $3,
             reconcile_errors = 0, updated_at = NOW()
         WHERE id = $1 AND status = 'authorized'`,
        [dep.id, capturedAmount, capturedAt]
      );
      console.log(
        `[reconcile] ${dep.id} → captured  montant=${capturedAmount} cts` +
        `  capturé le ${capturedAt.slice(0, 10)}  compte=${accountUsed}`
      );
      nCaptured++;

    } else if (pi.status === 'canceled') {
      await pool.query(
        `UPDATE deposits
         SET status = 'auth_expired', reconcile_errors = 0, updated_at = NOW()
         WHERE id = $1 AND status = 'authorized'`,
        [dep.id]
      );
      console.log(`[reconcile] ${dep.id} → auth_expired  compte=${accountUsed}`);
      nExpired++;

    } else {
      // Statut inattendu (processing, payment_failed…) — ne pas toucher, alerter.
      console.warn(
        `[reconcile] ${dep.id} statut Stripe inattendu : ${pi.status}` +
        `  compte=${accountUsed} — aucun traitement automatique, vérification manuelle requise.`
      );
    }

    await sleep(120);
  }

  console.log(
    `[reconcile] Terminé — captured=${nCaptured} auth_expired=${nExpired}` +
    ` unresolved=${nUnresolved} erreurs_temp=${nErrTemp}`
  );
}

// ─── Double chemin Connect / plateforme ────────────────────────────────────────

async function retrieveBothPaths(stripe, piId, stripeAccountId) {
  // Chemin 1 : ce que le cron utilise aujourd'hui (Connect si défini, plateforme sinon)
  const opts1 = stripeAccountId ? { stripeAccount: stripeAccountId } : {};
  const r1 = await tryRetrieve(stripe, piId, opts1);
  if (r1.pi) return { pi: r1.pi, accountUsed: stripeAccountId || '(plateforme)' };

  // Chemin 2 : l'inverse
  let opts2, accountCorrected;
  if (stripeAccountId) {
    // La DB dit Connect, on essaie la plateforme
    opts2 = {};
    accountCorrected = null; // correction : stripe_account_id → NULL
  } else {
    // La DB dit plateforme, on tente le compte déduit de l'ID du PI
    const guessed = guessAccountFromPiId(piId);
    if (!guessed) {
      return { errorDetail: r1.errorDetail };
    }
    opts2 = { stripeAccount: guessed };
    accountCorrected = guessed; // correction : stripe_account_id → guessed
  }

  const r2 = await tryRetrieve(stripe, piId, opts2);
  if (r2.pi) {
    const accountUsed = accountCorrected || '(plateforme)';
    return { pi: r2.pi, accountUsed, accountCorrected };
  }

  return { errorDetail: `[c1] ${r1.errorDetail} | [c2] ${r2.errorDetail}` };
}

async function tryRetrieve(stripe, piId, stripeOpts) {
  try {
    // Tout dans le deuxième argument : le SDK déplace stripeAccount en options lui-même.
    const pi = await stripe.paymentIntents.retrieve(
      piId,
      { expand: ['latest_charge'], ...stripeOpts }
    );
    return { pi };
  } catch (err) {
    const detail = [err.type, err.code].filter(Boolean).join('/') || 'unknown';
    return { errorDetail: `${detail}: ${err.message}` };
  }
}

// Les 14 premiers caractères après "pi_3" encodent le suffixe du compte Connect.
function guessAccountFromPiId(piId) {
  const m = piId.match(/^pi_3([A-Za-z0-9]{14})/);
  return m ? `acct_1${m[1]}` : null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Alerte J+5 ───────────────────────────────────────────────────────────────

async function alertExpiringAuthorizations(pool, sendPush) {
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
    LEFT JOIN properties  p  ON p.id  = d.property_id
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
    const guest   = dep.guest_name    || 'Voyageur';
    const prop    = dep.property_name || '';
    console.warn(`  → ${dep.id}  ${amount} €  ${guest}  ${prop}  (${dep.age_days}j)`);

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
