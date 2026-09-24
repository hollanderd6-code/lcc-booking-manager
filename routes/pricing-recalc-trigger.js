// ============================================================
// 🔁 PRICING RECALC TRIGGER — recalcul ciblé à la réservation
// ------------------------------------------------------------
// Quand une nouvelle réservation arrive (webhook OTA, iCal, …),
// l'occupation des dates concernées change → le pacing aussi.
// On reprice CE logement, sans attendre le cron quotidien.
//
// Débouncé par logement : si plusieurs résas tombent en rafale
// (sync iCal, import batch), on ne recalcule qu'UNE fois ~45s
// après la dernière. No-op si le pricing n'est pas actif.
// ============================================================

'use strict';

const { applyDynamicPricingForProperty } = require('./pricing-apply');
const { resolveMarketData } = require('./market-data-resolver');
const { computeMarketContextKey } = require('./market-context-key');

const _timers = new Map();      // propertyId -> timeout
const DEBOUNCE_MS = 45000;      // 45 s

function schedulePricingRecalc(pool, propertyId, userId, opts = {}) {
  if (!pool || !propertyId) return;
  const delay = opts.delayMs != null ? opts.delayMs : DEBOUNCE_MS;
  if (_timers.has(propertyId)) clearTimeout(_timers.get(propertyId));
  const t = setTimeout(() => {
    _timers.delete(propertyId);
    runRecalc(pool, propertyId, userId).catch(e =>
      console.error('⚠️ [DP-TRIGGER] recalc', propertyId, e.message));
  }, delay);
  if (t.unref) t.unref();           // ne bloque pas l'arrêt du process
  _timers.set(propertyId, t);
}

async function runRecalc(pool, propertyId, userId) {
  // Ne recalcule que si le pricing dynamique est ACTIF sur ce logement
  // Config canonique : pc.user_id = p.user_id (exclut les configs delegate orphelines)
  const cfg = (await pool.query(
    `SELECT pc.*, p.name AS property_name,
            p.latitude, p.longitude, p.country_code
       FROM pricing_config pc
       JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE pc.property_id = $1 AND pc.is_active = TRUE`,
    [propertyId]
  )).rows[0];
  if (!cfg) return; // pricing non activé → on ne fait rien

  const propertyContextKey = computeMarketContextKey({
    countryCode: cfg.country_code,
    latitude:    cfg.latitude,
    longitude:   cfg.longitude,
  });
  const resolution = await resolveMarketData(pool, { propertyId, propertyContextKey });
  const isMock = !resolution.trusted && resolution.status !== 'missing';

  const marketStats = resolution.row ? {
    median: resolution.row.median_price,
    occupancy: resolution.row.occupancy_rate,
    tensionLevel: resolution.row.tension_level,
  } : null;

  const r = await applyDynamicPricingForProperty(pool, {
    cfg,
    marketStats,
    isMock,
    marketOverride: resolution.market,   // null when stale/untrusted/missing
    sendPushNotification: null,          // silencieux
  });
  console.log(`🔁 [DP-TRIGGER] ${cfg.property_name} repricé (nouvelle résa) — ${r.nights || 0} nuits, ${r.status} [market:${resolution.status}]`);
}

module.exports = { schedulePricingRecalc };
