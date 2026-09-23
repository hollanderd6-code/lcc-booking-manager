'use strict';
/**
 * Trigger Sync — P0-C2
 *
 * Computes [today, today+500) and delegates entirely to publishEffectivePricing.
 * Replaces the legacy pricing-loop that lived inside triggerChannexRatesSync.
 *
 * Invariants:
 *   • Prices resolved just-in-time by the publisher — no schedule injected here.
 *   • external_pricing / channex_enabled / missing-IDs guards enforced by publisher.
 *   • Errors are caught and logged; they never propagate to callers.
 *
 * Testable via createTriggerSync({ publishEffectivePricing }) — inject a mock dep.
 */

const { addDays } = require('./effective-pricing-resolver');

function createTriggerSync(deps = {}) {
  function _publish() {
    return deps.publishEffectivePricing || require('./pricing-publisher').publishEffectivePricing;
  }

  async function triggerSync(pool, propertyId, userId) {
    try {
      const startDate = new Date().toISOString().split('T')[0];
      const endDate   = addDays(startDate, 500);

      const result = await _publish()(pool, {
        propertyId,
        userId,
        startDate,
        endDate,
        reason: 'trigger_sync',
      });

      console.log(
        `[TRIGGER SYNC] ${propertyId} — ${result.status}` +
        ` — rates:${result.rates.count} restr:${result.restrictions.count}`
      );
    } catch (e) {
      console.error('⚠️ [CHANNEX RATES SYNC] Erreur (non bloquante):', e.message);
    }
  }

  return triggerSync;
}

const triggerSync = createTriggerSync();
module.exports = { createTriggerSync, triggerSync };
