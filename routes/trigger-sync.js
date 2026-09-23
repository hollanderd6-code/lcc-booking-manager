'use strict';
/**
 * Trigger Sync — P0-C2 / C4.8-B
 *
 * Computes [today, today+500) and delegates entirely to publishEffectivePricing.
 * Replaces the legacy pricing-loop that lived inside triggerChannexRatesSync.
 *
 * Invariants:
 *   • Prices resolved just-in-time by the publisher — no schedule injected here.
 *   • external_pricing / channex_enabled / missing-IDs guards enforced by publisher.
 *   • Errors are caught and logged; they never propagate to callers.
 *   • stopSellMode default is 'none' (C4.8-B): a pricing-only trigger must NOT
 *     touch stop_sell state. Pass { stopSellMode: 'authoritative' } only when the
 *     caller has explicit stop_sell mutation intent (create/update/delete stop_sell rule).
 *
 * Testable via createTriggerSync({ publishEffectivePricing }) — inject a mock dep.
 */

const { addDays } = require('./effective-pricing-resolver');

function createTriggerSync(deps = {}) {
  function _publish() {
    return deps.publishEffectivePricing || require('./pricing-publisher').publishEffectivePricing;
  }

  /**
   * @param {object} pool
   * @param {string} propertyId
   * @param {string} userId
   * @param {object} [options]
   * @param {string} [options.stopSellMode]  'none' (default) | 'authoritative'
   *   'none'          — stop_sell field absent from restrictions (price-only mutations)
   *   'authoritative' — stop_sell true|false always sent (stop_sell mutations only)
   *   Any other value silently falls back to 'none' (fail-safe).
   */
  async function triggerSync(pool, propertyId, userId, options = {}) {
    // Fail-safe default: only 'authoritative' is opt-in; everything else → 'none'.
    const stopSellMode = (options && options.stopSellMode === 'authoritative')
      ? 'authoritative'
      : 'none';

    try {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate   = addDays(startDate, 500);

      const result = await _publish()(pool, {
        propertyId,
        userId,
        startDate,
        endDate,
        reason: 'trigger_sync',
        stopSellMode,
      });

      console.log(
        `[TRIGGER SYNC] ${propertyId} — ${result.status}` +
        ` — rates:${result.rates.count} restr:${result.restrictions.count}` +
        ` — stopSellMode:${stopSellMode}`
      );
    } catch (e) {
      console.error('⚠️ [CHANNEX RATES SYNC] Erreur (non bloquante):', e.message);
    }
  }

  return triggerSync;
}

const triggerSync = createTriggerSync();
module.exports = { createTriggerSync, triggerSync };
