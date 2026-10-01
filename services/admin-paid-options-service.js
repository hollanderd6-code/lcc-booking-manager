'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Admin-granted paid options: SMS and BoostPrice
//
// Business rule: admin entitlements are APPLICATION grants.  They must never
// create or cancel Stripe objects, change Stripe quantities, or alter any
// customer Stripe IDs.  Paid and admin-granted access coexist safely.
//
// Exported functions receive `pool` as first argument so they can be unit-
// tested against mock pools without booting the full server.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grant admin SMS access to a user.
 * Sets sms_admin_granted=TRUE and sms_enabled=TRUE.
 * Never touches sms_stripe_subscription_id.
 * Idempotent.
 */
async function grantSmsAdmin(pool, targetUserId) {
  await pool.query(
    `UPDATE subscriptions
     SET sms_admin_granted = TRUE,
         sms_enabled       = TRUE,
         updated_at        = NOW()
     WHERE user_id = $1`,
    [targetUserId]
  );
  return { smsAdminGranted: true, smsEnabled: true };
}

/**
 * Revoke admin SMS access.
 * Sets sms_admin_granted=FALSE.
 * Sets sms_enabled to whether paid SMS (stripe sub ID) still exists.
 * Never calls Stripe.  Never removes a paid SMS subscription.
 *
 * Atomic: a single UPDATE expression computes the new sms_enabled value so
 * there is no window where sms_enabled disagrees with the paid state.
 */
async function revokeSmsAdmin(pool, targetUserId) {
  const result = await pool.query(
    `UPDATE subscriptions
     SET sms_admin_granted = FALSE,
         sms_enabled       = (sms_stripe_subscription_id IS NOT NULL),
         updated_at        = NOW()
     WHERE user_id = $1
     RETURNING sms_enabled, sms_stripe_subscription_id`,
    [targetUserId]
  );
  const row = result.rows[0];
  return {
    smsAdminGranted: false,
    smsEnabled:      row?.sms_enabled ?? false,
    hadPaidSms:      !!(row?.sms_stripe_subscription_id),
  };
}

/**
 * Handle a Stripe SMS subscription deletion event.
 * Called from the customer.subscription.deleted webhook when the deleted sub
 * matches a user's sms_stripe_subscription_id.
 *
 * Sets sms_enabled = sms_admin_granted (preserves admin grant if present).
 * Clears sms_stripe_subscription_id.
 * Never modifies sms_admin_granted.
 */
async function handleStripeSmsCancellation(pool, subscriptionId) {
  const found = await pool.query(
    `SELECT user_id FROM subscriptions
     WHERE sms_stripe_subscription_id = $1 LIMIT 1`,
    [subscriptionId]
  );
  if (found.rows.length === 0) return;
  const userId = found.rows[0].user_id;
  await pool.query(
    `UPDATE subscriptions
     SET sms_enabled                = sms_admin_granted,
         sms_stripe_subscription_id = NULL,
         updated_at                 = NOW()
     WHERE user_id = $1`,
    [userId]
  );
  console.log(`[ADMIN-SMS] Stripe SMS sub deleted for user ${userId} — admin grant preserved`);
}

// ─────────────────────────────────────────────────────────────────────────────
// BoostPrice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return properties owned directly by targetUserId with their BoostPrice state.
 * Does NOT expand agency delegation.
 * boostPriceStatus values: 'paid' | 'admin' | 'inactive'
 */
async function getAdminClientProperties(pool, targetUserId) {
  const result = await pool.query(
    `SELECT
       p.id,
       p.name,
       p.internal_name              AS "internalName",
       bpe.status                   AS entitlement_status,
       bpe.source                   AS entitlement_source
     FROM properties p
     LEFT JOIN boostprice_property_entitlements bpe
       ON bpe.property_id = p.id AND bpe.user_id = p.user_id
     WHERE p.user_id = $1
     ORDER BY p.internal_name NULLS LAST, p.name`,
    [targetUserId]
  );

  return result.rows.map(r => {
    let boostPriceStatus = 'inactive';
    if (r.entitlement_status === 'active') {
      boostPriceStatus = r.entitlement_source === 'stripe' ? 'paid' : 'admin';
    }
    return {
      id:             r.id,
      name:           r.name,
      internalName:   r['internalName'],
      boostPriceStatus,
    };
  });
}

/**
 * Grant admin BoostPrice access for a set of properties.
 *
 * Rules (per property):
 *   active + source='stripe'  → alreadyPaid   — DO NOT overwrite paid entitlement
 *   active + source='admin'   → alreadyAdmin   — idempotent
 *   inactive (any source)     → reactivate as source='admin'
 *   no row                    → INSERT as source='admin'
 *
 * Wrapped in a DB transaction.  Never touches boostprice_stripe_subscription_id.
 * Never calls Stripe.
 *
 * Caller must have already validated that all propertyIds belong to targetUserId.
 *
 * Returns { grantedIds, alreadyAdminIds, alreadyPaidIds }
 */
async function grantBoostpriceAdmin(pool, targetUserId, propertyIds) {
  const client = await pool.connect();
  const grantedIds      = [];
  const alreadyAdminIds = [];
  const alreadyPaidIds  = [];

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT property_id, status, source
       FROM boostprice_property_entitlements
       WHERE property_id = ANY($1::text[]) AND user_id = $2`,
      [propertyIds, targetUserId]
    );
    const existingMap = new Map(existing.rows.map(r => [r.property_id, r]));

    for (const pid of propertyIds) {
      const row = existingMap.get(pid);

      if (row?.status === 'active' && row?.source === 'stripe') {
        // Paid entitlement — do not convert, report
        alreadyPaidIds.push(pid);
        continue;
      }

      if (row?.status === 'active' && row?.source === 'admin') {
        // Already admin-granted — idempotent
        alreadyAdminIds.push(pid);
        continue;
      }

      if (row) {
        // Inactive (any source) — reactivate as admin
        await client.query(
          `UPDATE boostprice_property_entitlements
           SET status = 'active', source = 'admin', updated_at = NOW()
           WHERE property_id = $1`,
          [pid]
        );
      } else {
        // No row — create
        await client.query(
          `INSERT INTO boostprice_property_entitlements (user_id, property_id, status, source, updated_at)
           VALUES ($1, $2, 'active', 'admin', NOW())`,
          [targetUserId, pid]
        );
      }
      grantedIds.push(pid);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { grantedIds, alreadyAdminIds, alreadyPaidIds };
}

/**
 * Revoke admin BoostPrice access for a set of properties.
 *
 * Rules (per property):
 *   active + source='admin'   → status='canceled'
 *   active + source='stripe'  → paidProtected — DO NOT touch
 *   inactive                  → no-op
 *
 * Wrapped in a DB transaction.
 * Never cancels Stripe subscriptions.  Never changes Stripe quantities.
 * Never clears boostprice_stripe_subscription_id.
 *
 * Caller must have already validated ownership.
 *
 * Returns { revokedIds, paidProtectedIds }
 */
async function revokeBoostpriceAdmin(pool, targetUserId, propertyIds) {
  const client = await pool.connect();
  const revokedIds        = [];
  const paidProtectedIds  = [];

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT property_id, status, source
       FROM boostprice_property_entitlements
       WHERE property_id = ANY($1::text[]) AND user_id = $2`,
      [propertyIds, targetUserId]
    );
    const existingMap = new Map(existing.rows.map(r => [r.property_id, r]));

    for (const pid of propertyIds) {
      const row = existingMap.get(pid);
      if (!row || row.status !== 'active') continue; // already inactive

      if (row.source === 'stripe') {
        paidProtectedIds.push(pid);
        continue;
      }

      // source='admin' and status='active' → cancel
      await client.query(
        `UPDATE boostprice_property_entitlements
         SET status = 'canceled', updated_at = NOW()
         WHERE property_id = $1 AND source = 'admin'`,
        [pid]
      );
      revokedIds.push(pid);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { revokedIds, paidProtectedIds };
}

module.exports = {
  grantSmsAdmin,
  revokeSmsAdmin,
  handleStripeSmsCancellation,
  getAdminClientProperties,
  grantBoostpriceAdmin,
  revokeBoostpriceAdmin,
};
