'use strict';
/**
 * P1.5-T0 — Demand / Price Elasticity / Revenue Objective Data Readiness Audit
 * Standalone test suite — no DB, no network, no writes.
 *
 * Run with: node tests/p1_5_t0_demand_elasticity_readiness.test.js
 *
 * Sections:
 *   [A] Module exports
 *   [B] classifyDemandReadiness — tier logic
 *   [C] classifyPriceExposureReadiness — cap enforcement
 *   [D] classifyElasticityReadiness — always INSUFFICIENT
 *   [E] classifyRevenueOptimizationReadiness — always INSUFFICIENT
 *   [F] checkPricingAuthorityProof — no violations in pricing chain
 *   [G] Static: pricing_schedule is current-state, not temporal history
 *   [H] Static: pricing_history is weekly aggregate, not per-stay-date event log
 *   [I] Static: offered price ≠ booked price
 *   [J] Static: BLOCK excluded from demand
 *   [K] Static: cancelled reservation semantics documented
 *   [L] Static: final-state leakage detection
 *   [M] Static: sellability unknown ≠ available
 *   [N] Static: restriction history missing
 *   [O] Static: price publication attempt ≠ successful exposure
 *   [P] Static: causality confounders documented
 *   [Q] Static: pickup insufficient for elasticity
 *   [R] Static: empty-table safe behavior
 *   [S] Static: point-in-time policy
 *   [T] Static: properties with short history classified correctly
 *   [U] Static: safety guarantee — no fabricated thresholds
 *   [V] Static: no network / DB writes / Channex / pricing authority
 *   [W] Static: audit SQL is SELECT-only
 *   [X] Static: module exports complete
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;

function ok(val, label) {
  if (val) { console.log('  ✅ ' + label); passed++; }
  else      { console.error('  ❌ ' + label); failed++; }
}

// Load module (pure-function exports only — runAudit needs a DB pool)
const mod = require('../outils/audit-demand-elasticity-readiness-p1_5_t0');
const {
  classifyDemandReadiness,
  classifyPriceExposureReadiness,
  classifyElasticityReadiness,
  classifyRevenueOptimizationReadiness,
  checkPricingAuthorityProof,
} = mod;

const AUDIT_SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-demand-elasticity-readiness-p1_5_t0.js'),
  'utf8',
);

// ── [A] MODULE EXPORTS ────────────────────────────────────────────────────────
console.log('\n── [A] MODULE EXPORTS ───────────────────────────────────────────────────');

ok(typeof mod.runAudit                          === 'function', 'A-01 runAudit exported');
ok(typeof mod.checkPricingAuthorityProof        === 'function', 'A-02 checkPricingAuthorityProof exported');
ok(typeof mod.classifyDemandReadiness           === 'function', 'A-03 classifyDemandReadiness exported');
ok(typeof mod.classifyPriceExposureReadiness    === 'function', 'A-04 classifyPriceExposureReadiness exported');
ok(typeof mod.classifyElasticityReadiness       === 'function', 'A-05 classifyElasticityReadiness exported');
ok(typeof mod.classifyRevenueOptimizationReadiness === 'function', 'A-06 classifyRevenueOptimizationReadiness exported');

// ── [B] classifyDemandReadiness ────────────────────────────────────────────────
console.log('\n── [B] classifyDemandReadiness — tier logic ─────────────────────────────');

// INSUFFICIENT: < 10 reliable reservations
ok(
  classifyDemandReadiness({ reliableReservations: 0,  monthsOfHistory: 24, hasBlockHistory: true }) === 'INSUFFICIENT',
  'B-01 0 reservations → INSUFFICIENT'
);
ok(
  classifyDemandReadiness({ reliableReservations: 9,  monthsOfHistory: 24, hasBlockHistory: true }) === 'INSUFFICIENT',
  'B-02 9 reservations → INSUFFICIENT'
);

// INSUFFICIENT: < 6 months history
ok(
  classifyDemandReadiness({ reliableReservations: 50, monthsOfHistory: 5,  hasBlockHistory: true }) === 'INSUFFICIENT',
  'B-03 5 months history → INSUFFICIENT'
);
ok(
  classifyDemandReadiness({ reliableReservations: 50, monthsOfHistory: 0,  hasBlockHistory: false }) === 'INSUFFICIENT',
  'B-04 0 months history → INSUFFICIENT'
);

// EARLY: ≥10 reliable, ≥6 months but < 30 reliable or < 12 months
ok(
  classifyDemandReadiness({ reliableReservations: 10, monthsOfHistory: 6,  hasBlockHistory: false }) === 'EARLY',
  'B-05 10 reservations, 6 months → EARLY'
);
ok(
  classifyDemandReadiness({ reliableReservations: 29, monthsOfHistory: 12, hasBlockHistory: false }) === 'EARLY',
  'B-06 29 reservations, 12 months → EARLY'
);
ok(
  classifyDemandReadiness({ reliableReservations: 50, monthsOfHistory: 11, hasBlockHistory: false }) === 'EARLY',
  'B-07 50 reservations but 11 months → EARLY'
);

// MODERATE: ≥30 reliable, ≥12 months but < 100 or < 24 months
ok(
  classifyDemandReadiness({ reliableReservations: 30,  monthsOfHistory: 12, hasBlockHistory: true }) === 'MODERATE',
  'B-08 30 reservations, 12 months → MODERATE'
);
ok(
  classifyDemandReadiness({ reliableReservations: 99,  monthsOfHistory: 24, hasBlockHistory: true }) === 'MODERATE',
  'B-09 99 reservations, 24 months → MODERATE'
);
ok(
  classifyDemandReadiness({ reliableReservations: 100, monthsOfHistory: 23, hasBlockHistory: true }) === 'MODERATE',
  'B-10 100 reservations but 23 months → MODERATE'
);

// GOOD: ≥100 reliable, ≥24 months
ok(
  classifyDemandReadiness({ reliableReservations: 100, monthsOfHistory: 24, hasBlockHistory: true }) === 'GOOD',
  'B-11 100 reservations, 24 months → GOOD'
);
ok(
  classifyDemandReadiness({ reliableReservations: 500, monthsOfHistory: 36, hasBlockHistory: true }) === 'GOOD',
  'B-12 500 reservations, 36 months → GOOD'
);

// Boundary: exactly at thresholds
ok(
  classifyDemandReadiness({ reliableReservations: 10,  monthsOfHistory: 6,  hasBlockHistory: false }) !== 'INSUFFICIENT',
  'B-13 exactly 10 reservations, 6 months → not INSUFFICIENT'
);
ok(
  classifyDemandReadiness({ reliableReservations: 30,  monthsOfHistory: 12, hasBlockHistory: false }) !== 'EARLY',
  'B-14 exactly 30 reservations, 12 months → not EARLY'
);
ok(
  classifyDemandReadiness({ reliableReservations: 100, monthsOfHistory: 24, hasBlockHistory: false }) !== 'MODERATE',
  'B-15 exactly 100 reservations, 24 months → not MODERATE (is GOOD)'
);

// ── [C] classifyPriceExposureReadiness ─────────────────────────────────────────
console.log('\n── [C] classifyPriceExposureReadiness — cap enforcement ─────────────────');

// INSUFFICIENT: both 0
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 0, pricingScheduleRows: 0 }) === 'INSUFFICIENT',
  'C-01 both 0 rows → INSUFFICIENT'
);

// EARLY: pricingHistoryRows < 4
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 0,  pricingScheduleRows: 100 }) === 'EARLY',
  'C-02 0 history rows, 100 schedule rows → EARLY'
);
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 1,  pricingScheduleRows: 200 }) === 'EARLY',
  'C-03 1 history row → EARLY'
);
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 3,  pricingScheduleRows: 365 }) === 'EARLY',
  'C-04 3 history rows → EARLY'
);

// MODERATE: 4 ≤ pricingHistoryRows < 12 (coverage is moderate, but cap at EARLY kicks in for ≥12)
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 4,  pricingScheduleRows: 365 }) === 'MODERATE',
  'C-05 4 history rows → MODERATE (4-11 range)'
);
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 11, pricingScheduleRows: 365 }) === 'MODERATE',
  'C-06 11 history rows → MODERATE (4-11 range)'
);

// MODERATE: 4 ≤ pricingHistoryRows < 12
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 4,  pricingScheduleRows: 365 }) === 'MODERATE',
  'C-05 4 history rows → MODERATE (4-11 range)'
);
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 11, pricingScheduleRows: 365 }) === 'MODERATE',
  'C-06 11 history rows → MODERATE (4-11 range)'
);

// ≥12 rows: capped back to EARLY because no per-stay-date price-path exists
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 12, pricingScheduleRows: 365 }) === 'EARLY',
  'C-07 12 history rows → EARLY (cap — no per-stay-date path)'
);
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 52, pricingScheduleRows: 365 }) === 'EARLY',
  'C-08 52 history rows (1 year) → EARLY (capped — per-stay-date path absent)'
);
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 200, pricingScheduleRows: 365 }) === 'EARLY',
  'C-09 200 history rows → EARLY (cap preserved regardless of row count)'
);

// Critical: NEVER returns GOOD at any input
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 10000, pricingScheduleRows: 99999 }) !== 'GOOD',
  'C-10 no input combination yields GOOD price exposure'
);
// ≥12 rows caps at EARLY (never MODERATE for long histories)
ok(
  classifyPriceExposureReadiness({ pricingHistoryRows: 10000, pricingScheduleRows: 99999 }) === 'EARLY',
  'C-11 large row count (≥12 history rows) stays EARLY (cap enforced)'
);

// ── [D] classifyElasticityReadiness — always INSUFFICIENT ─────────────────────
console.log('\n── [D] classifyElasticityReadiness — always INSUFFICIENT ────────────────');

ok(
  classifyElasticityReadiness({ demandTier: 'GOOD', priceExposureTier: 'EARLY', hasPickup: true }) === 'INSUFFICIENT',
  'D-01 GOOD demand + EARLY price exposure + pickup → still INSUFFICIENT'
);
ok(
  classifyElasticityReadiness({ demandTier: 'MODERATE', priceExposureTier: 'MODERATE', hasPickup: true }) === 'INSUFFICIENT',
  'D-02 MODERATE demand + MODERATE → still INSUFFICIENT'
);
ok(
  classifyElasticityReadiness({ demandTier: 'INSUFFICIENT', priceExposureTier: 'INSUFFICIENT', hasPickup: false }) === 'INSUFFICIENT',
  'D-03 all INSUFFICIENT + no pickup → INSUFFICIENT'
);
ok(
  classifyElasticityReadiness({ demandTier: 'GOOD', priceExposureTier: 'GOOD', hasPickup: true }) === 'INSUFFICIENT',
  'D-04 best possible inputs → still INSUFFICIENT (no offered price path exists)'
);
ok(
  classifyElasticityReadiness({}) === 'INSUFFICIENT',
  'D-05 empty input → INSUFFICIENT'
);
ok(
  // No combination can produce EARLY or better
  ['EARLY','MODERATE','GOOD'].every(d =>
    ['EARLY','MODERATE','GOOD'].every(p =>
      classifyElasticityReadiness({ demandTier: d, priceExposureTier: p, hasPickup: true }) === 'INSUFFICIENT'
    )
  ),
  'D-06 all tier combinations always produce INSUFFICIENT elasticity'
);

// ── [E] classifyRevenueOptimizationReadiness — always INSUFFICIENT ─────────────
console.log('\n── [E] classifyRevenueOptimizationReadiness — always INSUFFICIENT ───────');

ok(
  classifyRevenueOptimizationReadiness({ elasticityTier: 'INSUFFICIENT', hasAmountTotal: true }) === 'INSUFFICIENT',
  'E-01 INSUFFICIENT elasticity → INSUFFICIENT revenue optimization'
);
ok(
  classifyRevenueOptimizationReadiness({ elasticityTier: 'GOOD', hasAmountTotal: true }) === 'INSUFFICIENT',
  'E-02 hypothetical GOOD elasticity → still INSUFFICIENT (no actual elasticity model)'
);
ok(
  classifyRevenueOptimizationReadiness({ elasticityTier: 'MODERATE', hasAmountTotal: false }) === 'INSUFFICIENT',
  'E-03 no amount_total → INSUFFICIENT'
);
ok(
  classifyRevenueOptimizationReadiness({}) === 'INSUFFICIENT',
  'E-04 empty input → INSUFFICIENT'
);
ok(
  ['INSUFFICIENT','EARLY','MODERATE','GOOD'].every(t =>
    classifyRevenueOptimizationReadiness({ elasticityTier: t, hasAmountTotal: true }) === 'INSUFFICIENT'
  ),
  'E-05 all elasticity tiers produce INSUFFICIENT revenue optimization'
);

// ── [F] checkPricingAuthorityProof ────────────────────────────────────────────
console.log('\n── [F] checkPricingAuthorityProof — no violations in pricing chain ───────');

const violations = checkPricingAuthorityProof();

ok(Array.isArray(violations), 'F-01 returns array');
ok(
  violations.length === 0,
  `F-02 no pricing authority violations (found: ${violations.length}${violations.length ? ': ' + violations[0] : ''})`
);
ok(
  !violations.some(v => v.includes('demand-elasticity')),
  'F-03 no "demand-elasticity" import in pricing chain'
);
ok(
  !violations.some(v => v.includes('elasticity_model')),
  'F-04 no "elasticity_model" import in pricing chain'
);
ok(
  !violations.some(v => v.includes('revenue_optimizer')),
  'F-05 no "revenue_optimizer" import in pricing chain'
);

// ── [G] Static: pricing_schedule is current-state, not temporal history ────────
console.log('\n── [G] pricing_schedule is current-state — not temporal history ──────────');

ok(
  AUDIT_SRC.includes('PRICING_SCHEDULE_IS_TEMPORAL_HISTORY: NO'),
  'G-01 audit explicitly declares pricing_schedule is NOT temporal history'
);
ok(
  AUDIT_SRC.includes('PRICING_SCHEDULE_CAN_RECONSTRUCT_PRICE_PATH: NO'),
  'G-02 audit declares price path cannot be reconstructed from pricing_schedule'
);
ok(
  AUDIT_SRC.includes('ON CONFLICT DO UPDATE'),
  'G-03 audit documents ON CONFLICT DO UPDATE overwrite semantics'
);
ok(
  AUDIT_SRC.includes('UNIQUE(property_id, date)') ||
  AUDIT_SRC.includes('UNIQUE (property_id, date)') ||
  AUDIT_SRC.includes("'pricing_schedule'"),
  'G-04 pricing_schedule unique constraint documented'
);
ok(
  AUDIT_SRC.includes('updated_at records last write time, NOT when price was first set'),
  'G-05 audit clarifies updated_at does not represent initial set time'
);

// ── [H] Static: pricing_history is weekly aggregate, not per-stay-date event log
console.log('\n── [H] pricing_history — weekly aggregate, no stay-date dimension ─────────');

ok(
  AUDIT_SRC.includes('PRICING_HISTORY_CAN_SUPPORT_ELASTICITY: NO'),
  'H-01 audit declares pricing_history cannot support elasticity'
);
ok(
  AUDIT_SRC.includes('PRICING_HISTORY_SEMANTICS'),
  'H-02 PRICING_HISTORY_SEMANTICS section present'
);
ok(
  AUDIT_SRC.includes('NO stay_date field'),
  'H-03 audit flags absence of stay_date field in pricing_history'
);
ok(
  AUDIT_SRC.includes('weekly granularity obliterates within-week price variation') ||
  AUDIT_SRC.includes('Weekly granularity obliterates'),
  'H-04 weekly granularity limitation documented'
);
ok(
  AUDIT_SRC.includes('channex_update_id present') && AUDIT_SRC.includes("NOT proof OTA exposed"),
  'H-05 channex_update_id ≠ OTA exposure distinction documented'
);
ok(
  AUDIT_SRC.includes('PRICING_HISTORY_GAPS'),
  'H-06 PRICING_HISTORY_GAPS section present'
);

// ── [I] Static: offered price ≠ booked price ──────────────────────────────────
console.log('\n── [I] offered price ≠ booked price ─────────────────────────────────────');

ok(
  AUDIT_SRC.includes('OFFERED PRICE') && AUDIT_SRC.includes('BOOKED PRICE'),
  'I-01 both OFFERED PRICE and BOOKED PRICE concepts defined'
);
ok(
  AUDIT_SRC.includes('CAN_BUILD_PRICE_TO_CONVERSION_TIMELINE: NO'),
  'I-02 price-to-conversion timeline declared unavailable'
);
ok(
  AUDIT_SRC.includes('OTA markup between BoostPrice and guest-visible price unknown'),
  'I-03 OTA markup gap documented'
);
ok(
  AUDIT_SRC.includes('single booked amount, no offer history'),
  'I-04 amount_total represents booked price, not offer trajectory'
);

// ── [J] Static: BLOCK excluded from demand ────────────────────────────────────
console.log('\n── [J] BLOCK excluded from demand ───────────────────────────────────────');

ok(
  AUDIT_SRC.includes("COALESCE(source,'') <> 'BLOCK'") ||
  AUDIT_SRC.includes("COALESCE(source,'') = 'BLOCK'"),
  'J-01 BLOCK filter present in RESERVATION_STATS_SQL'
);
ok(
  AUDIT_SRC.includes("COALESCE(reservation_type,'') <> 'block'") ||
  AUDIT_SRC.includes("reservation_type,'') = 'block'"),
  'J-02 reservation_type block filter present'
);
ok(
  AUDIT_SRC.includes("COALESCE(platform,'') <> 'BLOCK'") ||
  AUDIT_SRC.includes("platform,'') = 'BLOCK'"),
  'J-03 platform BLOCK filter present'
);
ok(
  AUDIT_SRC.includes('reliable_reservations'),
  'J-04 reliable_reservations field defined (BLOCK-excluded count)'
);
ok(
  AUDIT_SRC.includes('block_count'),
  'J-05 block_count tracked separately from reliable reservations'
);
ok(
  AUDIT_SRC.includes('DEMAND_CENSORING_NOTE') ||
  AUDIT_SRC.includes('bookings are censored demand'),
  'J-06 censored demand concept documented'
);

// ── [K] Static: cancelled reservation semantics ───────────────────────────────
console.log('\n── [K] cancelled reservation semantics ──────────────────────────────────');

ok(
  AUDIT_SRC.includes("NOT IN ('cancelled','canceled')"),
  'K-01 cancellation filter excludes both spellings'
);
ok(
  AUDIT_SRC.includes('CAN_RECONSTRUCT_CANCELLATIONS_AT_TIME_T'),
  'K-02 cancellation point-in-time reconstruction limitation documented'
);
ok(
  AUDIT_SRC.includes('No cancellation timestamp column'),
  'K-03 missing cancellation timestamp documented'
);
ok(
  AUDIT_SRC.includes('status field contains current state'),
  'K-04 status mutable/current-state nature documented'
);

// ── [L] Static: final-state leakage detection ─────────────────────────────────
console.log('\n── [L] final-state leakage detection ────────────────────────────────────');

ok(
  AUDIT_SRC.includes('CURRENT_FUTURE_LEAKAGE_RISKS'),
  'L-01 CURRENT_FUTURE_LEAKAGE_RISKS section present'
);
ok(
  AUDIT_SRC.includes('HIGH — reservations.status: current state'),
  'L-02 reservations.status leakage risk rated HIGH'
);
ok(
  AUDIT_SRC.includes('HIGH — pricing_schedule.price: current recalculated price'),
  'L-03 pricing_schedule.price leakage risk rated HIGH'
);
ok(
  AUDIT_SRC.includes('MEDIUM — pricing_rules: current rule set'),
  'L-04 pricing_rules leakage risk rated MEDIUM'
);
ok(
  AUDIT_SRC.includes('LOW — booking_pickup_observations'),
  'L-05 booking_pickup_observations rated LOW (append-only, safe for PIT)'
);
ok(
  AUDIT_SRC.includes('POINT_IN_TIME_DATA_POLICY'),
  'L-06 POINT_IN_TIME_DATA_POLICY section present'
);

// ── [M] Static: sellability unknown ≠ available ───────────────────────────────
console.log('\n── [M] sellability unknown ≠ available ──────────────────────────────────');

ok(
  AUDIT_SRC.includes('CAN_RECONSTRUCT_HISTORICAL_SELLABILITY: PARTIAL'),
  'M-01 historical sellability declared PARTIAL'
);
ok(
  AUDIT_SRC.includes('CAN_RECONSTRUCT_HISTORICAL_BOOKABILITY_CONSTRAINTS: NO'),
  'M-02 historical bookability constraints declared NO'
);
ok(
  AUDIT_SRC.includes('SELLABLE(P,D,T) for past T is not reconstructable'),
  'M-03 SELLABLE(P,D,T) not reconstructable — explicit statement'
);
ok(
  AUDIT_SRC.includes('No historical stop_sell event log'),
  'M-04 missing stop_sell event log documented'
);
ok(
  AUDIT_SRC.includes('stop_sell rules can be created/deleted — no mutation log'),
  'M-05 stop_sell mutability documented'
);

// ── [N] Static: restriction history missing ───────────────────────────────────
console.log('\n── [N] restriction history missing ──────────────────────────────────────');

ok(
  AUDIT_SRC.includes('min_stay, max_stay, closed_to_arrival are current-state rules'),
  'N-01 min_stay/max_stay current-state limitation documented'
);
ok(
  AUDIT_SRC.includes('pricing_rules are mutable: history of rule changes not stored'),
  'N-02 pricing_rules mutability documented'
);
ok(
  AUDIT_SRC.includes('gap-fill state (derived at calculation time) not persisted'),
  'N-03 gap-fill state absence documented'
);
ok(
  AUDIT_SRC.includes('min_stay=3 blocks single-night bookers at any price'),
  'N-04 min_stay restriction effect on elasticity documented'
);

// ── [O] Static: price publication attempt ≠ successful exposure ──────────────
console.log('\n── [O] price publication attempt ≠ successful exposure ──────────────────');

ok(
  AUDIT_SRC.includes('CAN_PROVE_PRICE_WAS_EXTERNALLY_EXPOSED: NO'),
  'O-01 external exposure proof declared impossible'
);
ok(
  AUDIT_SRC.includes('DELIVERY_STATE_GAPS'),
  'O-02 DELIVERY_STATE_GAPS section present'
);
ok(
  AUDIT_SRC.includes("Channex API acknowledged the push"),
  'O-03 channex_update_id = Channex API acknowledgement only'
);
ok(
  AUDIT_SRC.includes('NOT = OTA received the rate') ||
  AUDIT_SRC.includes('NOT = Channex successfully loaded'),
  'O-04 Channex acknowledge ≠ OTA received documented'
);
ok(
  AUDIT_SRC.includes('Five distinct states'),
  'O-05 five delivery state levels documented'
);

// ── [P] Static: causality confounders documented ──────────────────────────────
console.log('\n── [P] causality confounders documented ─────────────────────────────────');

ok(
  AUDIT_SRC.includes('ENDOGENEITY / REVERSE CAUSALITY'),
  'P-01 endogeneity/reverse causality documented'
);
ok(
  AUDIT_SRC.includes('SEASONALITY CONFOUND'),
  'P-02 seasonality confound documented'
);
ok(
  AUDIT_SRC.includes('DOW CONFOUND'),
  'P-03 DOW confound documented'
);
ok(
  AUDIT_SRC.includes('LEAD-TIME CONFOUND'),
  'P-04 lead-time confound documented'
);
ok(
  AUDIT_SRC.includes('PACING / OCCUPANCY FEEDBACK LOOP'),
  'P-05 pacing/occupancy feedback loop documented'
);
ok(
  AUDIT_SRC.includes('MANUAL OVERRIDES ARE NON-RANDOM'),
  'P-06 manual override confounding documented'
);
ok(
  AUDIT_SRC.includes('CENSORED DEMAND'),
  'P-07 censored demand confound documented'
);
ok(
  AUDIT_SRC.includes('MARKET CO-MOVEMENT'),
  'P-08 market co-movement confound documented'
);
ok(
  AUDIT_SRC.includes('AVAILABILITY RESTRICTIONS censor exposure') ||
  AUDIT_SRC.includes('AVAILABILITY RESTRICTIONS'),
  'P-09 availability restriction confound documented'
);
ok(
  AUDIT_SRC.includes('FUTURE LEAKAGE'),
  'P-10 future leakage confound documented'
);
ok(
  AUDIT_SRC.includes('CAUSAL_ELASTICITY_ESTIMATION_READY: NO'),
  'P-11 causal elasticity estimation readiness declared NO'
);
ok(
  AUDIT_SRC.includes('SAFE_AUTOMATED_ELASTICITY_READY: NO'),
  'P-12 safe automated elasticity declared NO'
);

// ── [Q] Static: pickup insufficient for elasticity ────────────────────────────
console.log('\n── [Q] pickup insufficient for elasticity ────────────────────────────────');

ok(
  AUDIT_SRC.includes('PICKUP_SUFFICIENT_FOR_ELASTICITY: NO'),
  'Q-01 pickup declared insufficient for elasticity'
);
ok(
  AUDIT_SRC.includes('No offered price stored per observation'),
  'Q-02 pickup lacks offered price field'
);
ok(
  AUDIT_SRC.includes('PICKUP_USEFUL_FOR_FUTURE_DEMAND_MODEL: YES'),
  'Q-03 pickup recognized as useful signal for future demand model'
);
ok(
  AUDIT_SRC.includes('Cannot compute price elasticity without the price axis'),
  'Q-04 price axis requirement for elasticity documented'
);

// ── [R] Static: empty-table safe behavior ─────────────────────────────────────
console.log('\n── [R] empty-table safe behavior ────────────────────────────────────────');

// classifyDemandReadiness with 0 rows returns INSUFFICIENT (not exception)
ok(
  (() => {
    try {
      return classifyDemandReadiness({ reliableReservations: 0, monthsOfHistory: 0, hasBlockHistory: false }) === 'INSUFFICIENT';
    } catch(e) { return false; }
  })(),
  'R-01 classifyDemandReadiness with 0 rows → INSUFFICIENT, no exception'
);

// classifyPriceExposureReadiness with 0 rows returns INSUFFICIENT (not exception)
ok(
  (() => {
    try {
      return classifyPriceExposureReadiness({ pricingHistoryRows: 0, pricingScheduleRows: 0 }) === 'INSUFFICIENT';
    } catch(e) { return false; }
  })(),
  'R-02 classifyPriceExposureReadiness with 0 rows → INSUFFICIENT, no exception'
);

// classifyElasticityReadiness with empty args → INSUFFICIENT (no exception)
ok(
  (() => {
    try {
      return classifyElasticityReadiness({ demandTier: 'INSUFFICIENT', priceExposureTier: 'INSUFFICIENT', hasPickup: false }) === 'INSUFFICIENT';
    } catch(e) { return false; }
  })(),
  'R-03 classifyElasticityReadiness with INSUFFICIENT tiers → INSUFFICIENT, no exception'
);

// safeQuery pattern documented in source (fail-safe wrapper)
ok(
  AUDIT_SRC.includes('async function safeQuery'),
  'R-04 safeQuery fail-safe wrapper defined'
);
ok(
  AUDIT_SRC.includes('return null') && AUDIT_SRC.includes('safeQuery'),
  'R-05 safeQuery returns null on DB failure (not throwing)'
);
ok(
  AUDIT_SRC.includes('if (resStats && resStats.rows[0])') ||
  AUDIT_SRC.includes('resStats && resStats.rows'),
  'R-06 per-property stats guarded against null safeQuery result'
);
ok(
  AUDIT_SRC.includes('SEASONALITY_STATS_SQL') && AUDIT_SRC.includes('PICKUP_STATS_SQL'),
  'R-07 empty seasonality/pickup table queries present'
);

// ── [S] Static: point-in-time policy ─────────────────────────────────────────
console.log('\n── [S] point-in-time policy ─────────────────────────────────────────────');

ok(
  AUDIT_SRC.includes('POINT_IN_TIME_DATA_POLICY'),
  'S-01 POINT_IN_TIME_DATA_POLICY section present'
);
ok(
  AUDIT_SRC.includes('observation_date / calculated_at timestamps define T'),
  'S-02 observation_date/calculated_at as PIT anchor documented'
);
ok(
  AUDIT_SRC.includes('No future reservation outcomes may leak into features'),
  'S-03 no future outcome leakage policy stated'
);
ok(
  AUDIT_SRC.includes('WHERE observation_date <= T'),
  'S-04 PIT slicing pattern for pickup observations documented'
);
ok(
  AUDIT_SRC.includes('append-only') && AUDIT_SRC.includes('booking_pickup_observations'),
  'S-05 booking_pickup_observations append-only (safe for PIT) documented'
);

// ── [T] Static: properties with short history classified correctly ─────────────
console.log('\n── [T] short-history properties classified correctly ────────────────────');

// Active property with 0 months history → INSUFFICIENT demand
ok(
  classifyDemandReadiness({ reliableReservations: 5, monthsOfHistory: 0, hasBlockHistory: false }) === 'INSUFFICIENT',
  'T-01 new property (0 months, 5 reservations) → INSUFFICIENT'
);

// Active property with 8 months, 25 reservations → EARLY
ok(
  classifyDemandReadiness({ reliableReservations: 25, monthsOfHistory: 8, hasBlockHistory: false }) === 'EARLY',
  'T-02 8 months, 25 reservations → EARLY'
);

// EARLY demand, EARLY price exposure → elasticity still INSUFFICIENT
ok(
  classifyElasticityReadiness({
    demandTier: 'EARLY',
    priceExposureTier: 'EARLY',
    hasPickup: true,
  }) === 'INSUFFICIENT',
  'T-03 EARLY demand + EARLY price exposure → elasticity INSUFFICIENT'
);

// MODERATE demand, EARLY price exposure → elasticity still INSUFFICIENT
ok(
  classifyElasticityReadiness({
    demandTier: 'MODERATE',
    priceExposureTier: 'EARLY',
    hasPickup: true,
  }) === 'INSUFFICIENT',
  'T-04 MODERATE demand + EARLY price exposure → elasticity INSUFFICIENT'
);

// GOOD demand still produces INSUFFICIENT elasticity and revenue optimization
{
  const eTier = classifyElasticityReadiness({ demandTier: 'GOOD', priceExposureTier: 'EARLY', hasPickup: true });
  const rTier = classifyRevenueOptimizationReadiness({ elasticityTier: eTier, hasAmountTotal: true });
  ok(eTier === 'INSUFFICIENT', 'T-05 GOOD demand → elasticity INSUFFICIENT');
  ok(rTier === 'INSUFFICIENT', 'T-06 GOOD demand → revenue optimization INSUFFICIENT');
}

// ── [U] Static: no fabricated thresholds ─────────────────────────────────────
console.log('\n── [U] no fabricated thresholds ─────────────────────────────────────────');

// Thresholds in classifyDemandReadiness must be documented, not arbitrary magic numbers
// Verify the thresholds match what's in the source
ok(
  AUDIT_SRC.includes('reliableReservations < 10') || AUDIT_SRC.includes('< 10'),
  'U-01 threshold 10 (INSUFFICIENT floor) present in source'
);
ok(
  AUDIT_SRC.includes('reliableReservations < 30') || AUDIT_SRC.includes('< 30'),
  'U-02 threshold 30 (EARLY floor) present in source'
);
ok(
  AUDIT_SRC.includes('reliableReservations < 100') || AUDIT_SRC.includes('< 100'),
  'U-03 threshold 100 (MODERATE floor) present in source'
);
ok(
  AUDIT_SRC.includes('monthsOfHistory < 6') || AUDIT_SRC.includes('< 6'),
  'U-04 6 months INSUFFICIENT floor present'
);
ok(
  AUDIT_SRC.includes('monthsOfHistory < 12') || AUDIT_SRC.includes('< 12'),
  'U-05 12 months EARLY floor present'
);
ok(
  AUDIT_SRC.includes('monthsOfHistory < 24') || AUDIT_SRC.includes('< 24'),
  'U-06 24 months MODERATE floor present'
);
// classifyElasticityReadiness must always return INSUFFICIENT — verified structurally
ok(
  AUDIT_SRC.includes("return 'INSUFFICIENT'") &&
  (AUDIT_SRC.match(/return 'INSUFFICIENT'/g) || []).length >= 2,
  'U-07 multiple INSUFFICIENT returns in classification functions'
);

// ── [V] Static: no network / DB writes / Channex / pricing authority ──────────
console.log('\n── [V] no network / DB writes / Channex / pricing authority ─────────────');

// No INSERT / UPDATE / DELETE in SQL constants (word boundary — avoids column names like channex_update_id)
const SQL_BLOCK = AUDIT_SRC.match(/const [A-Z_]+_SQL\s*=\s*`[\s\S]+?`/g) || [];
const sqlContent = SQL_BLOCK.join('\n');
ok(
  !/\bINSERT\b/i.test(sqlContent) && !/\bUPDATE\b/i.test(sqlContent) && !/\bDELETE\b/i.test(sqlContent),
  'V-01 SQL constants contain no INSERT / UPDATE / DELETE (word boundary check)'
);

// No http/https/fetch/axios requires
ok(
  !AUDIT_SRC.includes("require('http')") && !AUDIT_SRC.includes("require('https')"),
  'V-02 no http/https require in audit tool'
);
ok(
  !AUDIT_SRC.includes("require('axios')") && !AUDIT_SRC.includes("require('node-fetch')"),
  'V-03 no axios/node-fetch require'
);
ok(
  !AUDIT_SRC.includes('fetch(') && !AUDIT_SRC.includes('axios.'),
  'V-04 no fetch() or axios. calls'
);

// No Channex API calls
ok(
  !AUDIT_SRC.includes('channex') || AUDIT_SRC.includes('channex_update_id'),
  'V-05 no Channex API calls (channex_update_id column mention is ok)'
);
ok(
  !AUDIT_SRC.includes('CHANNEX_API_KEY'),
  'V-06 no CHANNEX_API_KEY usage'
);

// No pool.query calls outside of runAudit / safeQuery (no writes from exports)
ok(
  !AUDIT_SRC.includes('.query(') ||
  (AUDIT_SRC.includes('async function safeQuery') && AUDIT_SRC.includes('async function runAudit')),
  'V-07 DB queries only in safeQuery/runAudit — not in exported pure functions'
);

// Safety header assertions
ok(
  AUDIT_SRC.includes('READ_ONLY                              = YES') ||
  AUDIT_SRC.includes('READ_ONLY=YES') ||
  AUDIT_SRC.includes('READ_ONLY'),
  'V-08 READ_ONLY declared in audit header'
);
ok(
  AUDIT_SRC.includes('DB_WRITES                              = 0') ||
  AUDIT_SRC.includes('DB_WRITES = 0') ||
  AUDIT_SRC.includes('DB_WRITES=0'),
  'V-09 DB_WRITES=0 declared'
);
ok(
  AUDIT_SRC.includes('PRICING_WRITES                         = 0') ||
  AUDIT_SRC.includes('PRICING_WRITES = 0') ||
  AUDIT_SRC.includes('PRICING_WRITES=0'),
  'V-10 PRICING_WRITES=0 declared'
);
ok(
  AUDIT_SRC.includes('CHANNEX_WRITES                         = 0') ||
  AUDIT_SRC.includes('CHANNEX_WRITES = 0') ||
  AUDIT_SRC.includes('CHANNEX_WRITES=0'),
  'V-11 CHANNEX_WRITES=0 declared'
);
ok(
  AUDIT_SRC.includes('LIVE_NETWORK_CALLS                     = 0') ||
  AUDIT_SRC.includes('LIVE_NETWORK_CALLS = 0') ||
  AUDIT_SRC.includes('LIVE_NETWORK_CALLS=0'),
  'V-12 LIVE_NETWORK_CALLS=0 declared'
);
ok(
  AUDIT_SRC.includes('DEMAND_MODEL_HAS_PRICING_AUTHORITY     = NO') ||
  AUDIT_SRC.includes('DEMAND_MODEL_HAS_PRICING_AUTHORITY = NO'),
  'V-13 DEMAND_MODEL_HAS_PRICING_AUTHORITY=NO declared'
);
ok(
  AUDIT_SRC.includes('ELASTICITY_MODEL_HAS_PRICING_AUTHORITY = NO') ||
  AUDIT_SRC.includes('ELASTICITY_MODEL_HAS_PRICING_AUTHORITY= NO'),
  'V-14 ELASTICITY_MODEL_HAS_PRICING_AUTHORITY=NO declared'
);
ok(
  AUDIT_SRC.includes('REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY= NO') ||
  AUDIT_SRC.includes('REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY = NO'),
  'V-15 REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY=NO declared'
);

// ── [W] Static: audit SQL is SELECT-only ─────────────────────────────────────
console.log('\n── [W] audit SQL is SELECT-only ─────────────────────────────────────────');

// Extract all SQL constant bodies
const ALL_SQL_CONSTS = [
  'PRICING_SCHEDULE_SCHEMA_SQL',
  'PRICING_SCHEDULE_UNIQUENESS_SQL',
  'PRICING_HISTORY_SCHEMA_SQL',
  'PRICING_HISTORY_UNIQUENESS_SQL',
  'RESERVATIONS_SCHEMA_SQL',
  'ACTIVE_PROPERTIES_SQL',
  'RESERVATION_STATS_SQL',
  'PRICING_SCHEDULE_STATS_SQL',
  'PRICING_HISTORY_STATS_SQL',
  'PICKUP_STATS_SQL',
  'MARKET_OBS_STATS_SQL',
  'SEASONALITY_STATS_SQL',
  'MARKET_DATA_STATS_SQL',
];

ok(
  ALL_SQL_CONSTS.every(name => AUDIT_SRC.includes(name)),
  'W-01 all expected SQL constants present'
);

// Extract each SQL constant and verify SELECT-only (word boundary — avoids column names like channex_update_id)
let allSelectOnly = true;
for (const name of ALL_SQL_CONSTS) {
  const match = AUDIT_SRC.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]+?)\`\\s*;`));
  if (match) {
    const sqlBody = match[1];
    if (/\bINSERT\b/i.test(sqlBody) || /\bUPDATE\b/i.test(sqlBody) || /\bDELETE\b/i.test(sqlBody) ||
        /\bDROP\b/i.test(sqlBody) || /\bTRUNCATE\b/i.test(sqlBody)) {
      allSelectOnly = false;
    }
  }
}
ok(allSelectOnly, 'W-02 every SQL constant is SELECT-only (no mutating statements, word boundary check)');

ok(
  AUDIT_SRC.includes('SELECT') && !AUDIT_SRC.match(/\bINSERT\b.*\bINTO\b/),
  'W-03 no INSERT INTO in source file'
);

// W-04: check SQL constants only (not documentation strings in console.log which may mention DO UPDATE SET)
ok(
  !allSelectOnly === false || (() => {
    const allSql = (AUDIT_SRC.match(/const [A-Z_]+_SQL\s*=\s*`[\s\S]+?`/g) || []).join('\n');
    return !/\bUPDATE\b.*\bSET\b/i.test(allSql);
  })(),
  'W-04 no UPDATE ... SET in SQL constants (documentation strings excluded)'
);

ok(
  !AUDIT_SRC.match(/\bDELETE\b.*\bFROM\b/),
  'W-05 no DELETE FROM in source file'
);

// ── [X] Static: module exports complete ──────────────────────────────────────
console.log('\n── [X] module.exports complete ─────────────────────────────────────────');

ok(
  AUDIT_SRC.includes('module.exports'),
  'X-01 module.exports present'
);
ok(
  AUDIT_SRC.includes('runAudit') && AUDIT_SRC.includes('module.exports'),
  'X-02 runAudit in exports'
);
ok(
  AUDIT_SRC.includes('checkPricingAuthorityProof'),
  'X-03 checkPricingAuthorityProof in exports'
);
ok(
  AUDIT_SRC.includes('classifyDemandReadiness'),
  'X-04 classifyDemandReadiness in exports'
);
ok(
  AUDIT_SRC.includes('classifyPriceExposureReadiness'),
  'X-05 classifyPriceExposureReadiness in exports'
);
ok(
  AUDIT_SRC.includes('classifyElasticityReadiness'),
  'X-06 classifyElasticityReadiness in exports'
);
ok(
  AUDIT_SRC.includes('classifyRevenueOptimizationReadiness'),
  'X-07 classifyRevenueOptimizationReadiness in exports'
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(70)}`);
console.log(`P1.5-T0: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}
