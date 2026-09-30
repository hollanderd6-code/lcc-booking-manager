'use strict';
/**
 * P1.5-T0 — Demand / Price Elasticity / Revenue Objective Data Readiness Audit
 *
 * READ-ONLY audit.  No writes, no network calls, no provider calls.
 *
 * SAFETY:
 *   READ_ONLY                              = YES
 *   DB_WRITES                              = 0  always
 *   PRICING_WRITES                         = 0  always
 *   CHANNEX_WRITES                         = 0  always
 *   MARKET_PROVIDER_CALLS                  = 0  always
 *   LIVE_NETWORK_CALLS                     = 0  always
 *   DEMAND_MODEL_HAS_PRICING_AUTHORITY     = NO
 *   ELASTICITY_MODEL_HAS_PRICING_AUTHORITY = NO
 *   REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY= NO
 *   PRODUCTION_PRICING_CHANGED             = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-demand-elasticity-readiness-p1_5_t0.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── SQL constants (SELECT-only) ───────────────────────────────────────────────

// Pricing schedule: schema and uniqueness
const PRICING_SCHEDULE_SCHEMA_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'pricing_schedule'
  ORDER BY ordinal_position
`;

const PRICING_SCHEDULE_UNIQUENESS_SQL = `
  SELECT pg_get_constraintdef(c.oid) AS constraint_def, c.conname
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'pricing_schedule'
    AND c.contype = 'u'
`;

// pricing_history: schema, uniqueness
const PRICING_HISTORY_SCHEMA_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'pricing_history'
  ORDER BY ordinal_position
`;

const PRICING_HISTORY_UNIQUENESS_SQL = `
  SELECT pg_get_constraintdef(c.oid) AS constraint_def, c.conname
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'pricing_history'
    AND c.contype = 'u'
`;

// Reservations: schema
const RESERVATIONS_SCHEMA_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'reservations'
  ORDER BY ordinal_position
`;

// Active BoostPrice properties
const ACTIVE_PROPERTIES_SQL = `
  SELECT DISTINCT ON (pc.property_id)
    pc.property_id,
    p.internal_name,
    p.name,
    p.timezone,
    p.country_code,
    p.currency,
    p.base_price,
    p.weekend_price,
    p.latitude,
    p.longitude,
    p.bedrooms,
    p.max_guests,
    pc.price_min,
    pc.price_max,
    pc.mode,
    pc.is_active,
    mpp.profile_id AS market_profile_id
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  LEFT JOIN market_profile_properties mpp ON mpp.property_id = pc.property_id
  WHERE pc.is_active = TRUE
  ORDER BY pc.property_id
`;

// Per-property: reliable reservation count, date range
const RESERVATION_STATS_SQL = `
  SELECT
    COUNT(*)                           AS total_reservations,
    COUNT(*) FILTER (
      WHERE COALESCE(source,'') <> 'BLOCK'
        AND COALESCE(reservation_type,'') <> 'block'
        AND COALESCE(platform,'') <> 'BLOCK'
        AND COALESCE(status,'confirmed') NOT IN ('cancelled','canceled')
        AND start_date IS NOT NULL
        AND end_date   IS NOT NULL
    )                                  AS reliable_reservations,
    MIN(start_date) FILTER (
      WHERE COALESCE(source,'') <> 'BLOCK'
        AND COALESCE(reservation_type,'') <> 'block'
        AND COALESCE(platform,'') <> 'BLOCK'
        AND COALESCE(status,'confirmed') NOT IN ('cancelled','canceled')
    )                                  AS first_reliable_start,
    MAX(end_date)   FILTER (
      WHERE COALESCE(source,'') <> 'BLOCK'
        AND COALESCE(reservation_type,'') <> 'block'
        AND COALESCE(platform,'') <> 'BLOCK'
        AND COALESCE(status,'confirmed') NOT IN ('cancelled','canceled')
    )                                  AS last_reliable_end,
    COUNT(*) FILTER (
      WHERE COALESCE(source,'') = 'BLOCK'
         OR COALESCE(reservation_type,'') = 'block'
         OR COALESCE(platform,'') = 'BLOCK'
    )                                  AS block_count,
    COUNT(DISTINCT COALESCE(currency,'EUR'))   AS distinct_currencies,
    COUNT(*) FILTER (WHERE amount_total IS NOT NULL)     AS has_amount_total,
    COUNT(*) FILTER (WHERE amount_rooms IS NOT NULL)     AS has_amount_rooms,
    COUNT(*) FILTER (WHERE amount_cleaning IS NOT NULL)  AS has_amount_cleaning,
    COUNT(*) FILTER (WHERE ota_commission IS NOT NULL)   AS has_ota_commission,
    COUNT(*) FILTER (WHERE host_payout IS NOT NULL)      AS has_host_payout,
    COUNT(*) FILTER (WHERE created_at IS NOT NULL)       AS has_created_at
  FROM reservations
  WHERE property_id = $1
`;

// Per-property: pricing_schedule rows and distinct prices
const PRICING_SCHEDULE_STATS_SQL = `
  SELECT
    COUNT(*)                        AS total_rows,
    COUNT(DISTINCT price)           AS distinct_prices,
    COUNT(*) FILTER (WHERE status = 'applied')  AS applied_count,
    COUNT(*) FILTER (WHERE status = 'pending')  AS pending_count,
    MIN(date)                       AS min_date,
    MAX(date)                       AS max_date,
    MIN(updated_at)                 AS first_updated,
    MAX(updated_at)                 AS last_updated
  FROM pricing_schedule
  WHERE property_id = $1
`;

// Per-property: pricing_history rows
const PRICING_HISTORY_STATS_SQL = `
  SELECT
    COUNT(*)                        AS total_rows,
    MIN(week_start)                 AS first_week,
    MAX(week_start)                 AS last_week,
    COUNT(*) FILTER (WHERE status = 'applied')  AS applied_count,
    COUNT(*) FILTER (WHERE status = 'declined') AS declined_count,
    COUNT(*) FILTER (WHERE status = 'pending')  AS pending_count,
    COUNT(*) FILTER (WHERE channex_update_id IS NOT NULL) AS channex_confirmed
  FROM pricing_history
  WHERE property_id = $1
`;

// Per-property: pickup observations
const PICKUP_STATS_SQL = `
  SELECT
    COUNT(*)                                    AS total_rows,
    COUNT(DISTINCT target_date)                 AS distinct_target_dates,
    COUNT(DISTINCT observation_date)            AS distinct_observation_dates,
    MIN(calculated_at)                          AS first_calculated,
    MAX(calculated_at)                          AS last_calculated
  FROM booking_pickup_observations
  WHERE property_id = $1
`;

// Per-property: market observations
const MARKET_OBS_STATS_SQL = `
  SELECT
    COUNT(*)                              AS total_rows,
    COUNT(DISTINCT market_profile_id)     AS distinct_profiles,
    MIN(collected_at)                     AS first_collected,
    MAX(collected_at)                     AS last_collected,
    COUNT(DISTINCT currency)              AS distinct_currencies
  FROM market_observations
  WHERE market_profile_id IN (
    SELECT profile_id FROM market_profile_properties WHERE property_id = $1
  )
`;

// Per-property: seasonality observations
const SEASONALITY_STATS_SQL = `
  SELECT
    COUNT(*)                              AS total_rows,
    COUNT(DISTINCT target_month)          AS distinct_target_months,
    COUNT(DISTINCT observation_date)      AS distinct_observation_dates,
    MIN(calculated_at)                    AS first_calculated,
    MAX(calculated_at)                    AS last_calculated
  FROM local_seasonality_observations
  WHERE property_id = $1
`;

// Per-property: market_data (legacy weekly snapshots)
const MARKET_DATA_STATS_SQL = `
  SELECT
    COUNT(*)                              AS total_rows,
    MIN(week_start)                       AS first_week,
    MAX(week_start)                       AS last_week,
    COUNT(DISTINCT week_start)            AS distinct_weeks
  FROM market_data
  WHERE property_id = $1
`;

// Pricing chain authority check (file-based, no SQL needed)
const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

function checkPricingAuthorityProof() {
  const ROOT = path.join(__dirname, '..');
  const violations = [];
  const terms = [
    'demand-elasticity',
    'demand_elasticity',
    'elasticity_model',
    'revenue_optimizer',
    'audit-demand',
  ];
  for (const f of PRICING_CHAIN) {
    const fpath = path.join(ROOT, f);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const term of terms) {
      if (src.includes(term)) violations.push(`${f}: contains "${term}"`);
    }
  }
  return violations;
}

// ── Tier classification ───────────────────────────────────────────────────────

function classifyDemandReadiness({ reliableReservations, monthsOfHistory, hasBlockHistory }) {
  if (reliableReservations < 10 || monthsOfHistory < 6)   return 'INSUFFICIENT';
  if (reliableReservations < 30 || monthsOfHistory < 12)  return 'EARLY';
  if (reliableReservations < 100 || monthsOfHistory < 24) return 'MODERATE';
  return 'GOOD';
}

function classifyPriceExposureReadiness({ pricingHistoryRows, pricingScheduleRows }) {
  // pricing_schedule is CURRENT STATE, not history. pricing_history is weekly aggregate.
  // Neither provides a point-in-time price path per stay date.
  if (pricingHistoryRows === 0 && pricingScheduleRows === 0) return 'INSUFFICIENT';
  if (pricingHistoryRows < 4)   return 'EARLY';
  if (pricingHistoryRows < 12)  return 'MODERATE';
  return 'EARLY'; // capped at EARLY because no per-stay-date price-path exists
}

function classifyElasticityReadiness({ demandTier, priceExposureTier, hasPickup }) {
  // Elasticity requires: offered price path + sellability + booking outcome + controls
  // Current DB cannot reconstruct offered price at arbitrary T for a stay date D.
  // Therefore elasticity readiness is always INSUFFICIENT until prospective logs exist.
  return 'INSUFFICIENT';
}

function classifyRevenueOptimizationReadiness({ elasticityTier, hasAmountTotal }) {
  // Revenue optimization requires elasticity + defensible denominator.
  // Since elasticity is INSUFFICIENT, so is revenue optimization.
  return 'INSUFFICIENT';
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  require('dotenv').config();
  const { createPool } = require('../services/db-pool');
  runAudit(createPool())
    .catch(err => { console.error('[FATAL]', err); process.exit(1); });
}

async function safeQuery(pool, sql, params, label) {
  try {
    return await pool.query(sql, params || []);
  } catch (err) {
    console.error(`  [${label}_FAILURE] ${err.message}`);
    return null;
  }
}

async function runAudit(pool) {
  const NOW_ISO = new Date().toISOString();

  try {
    console.log('');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  P1.5-T0 — DEMAND / ELASTICITY / REVENUE DATA READINESS AUDIT');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`  Run at:  ${NOW_ISO}`);
    console.log('  READ_ONLY=YES  DB_WRITES=0  PRICING_WRITES=0  NETWORK_CALLS=0');
    console.log('  DEMAND_MODEL_HAS_PRICING_AUTHORITY     = NO');
    console.log('  ELASTICITY_MODEL_HAS_PRICING_AUTHORITY = NO');
    console.log('  REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY= NO');
    console.log('  PRODUCTION_PRICING_CHANGED             = NO');
    console.log('──────────────────────────────────────────────────────────────────────');

    // ── [1] PROBLEM DEFINITIONS ───────────────────────────────────────────────
    console.log('\n  [1] THREE PROBLEM DEFINITIONS');
    console.log('');
    console.log('  A. DEMAND LEVEL');
    console.log('     "How much demand exists for a stay date / market / property?"');
    console.log('     Requires: booking counts, inquiry/view volume, market occupancy,');
    console.log('               pacing relative to historical baseline, block state.');
    console.log('     IMPORTANT: bookings are censored demand — once booked, additional');
    console.log('     demand for that night is unobservable.');
    console.log('');
    console.log('  B. PRICE ELASTICITY');
    console.log('     "How does booking probability change when offered price changes?"');
    console.log('     Requires: offered price path over time PER STAY DATE, sellability');
    console.log('     trajectory, booking conversion timestamp, variation in prices,');
    console.log('     controls for seasonality/DOW/events/lead-time/pacing,');
    console.log('     counterfactual comparisons. NOT derivable from bookings alone.');
    console.log('');
    console.log('  C. REVENUE OPTIMIZATION');
    console.log('     "Which price maximizes expected revenue given demand, availability');
    console.log('     and constraints?"');
    console.log('     Requires: demand estimate + price-response model + sellability');
    console.log('     + objective function (ADR? RevPAR? Net accommodation revenue?).');
    console.log('     Cannot be built before (A) and (B) are addressed.');
    console.log('');
    console.log('  CRITICAL DISTINCTION:');
    console.log('    Correlation: high prices coincide with high bookings because demand');
    console.log('    is high (events, holidays, peak season). This is POSITIVE correlation,');
    console.log('    NOT evidence of positive elasticity. Naive regression of bookings~price');
    console.log('    will produce upward bias — see section [10] for full causality audit.');

    // ── [2] PRICING_SCHEDULE AUDIT ────────────────────────────────────────────
    console.log('\n  [2] PRICING_SCHEDULE SCHEMA AUDIT');

    const psSchema = await safeQuery(pool, PRICING_SCHEDULE_SCHEMA_SQL, [], 'PS_SCHEMA');
    const psUniq   = await safeQuery(pool, PRICING_SCHEDULE_UNIQUENESS_SQL, [], 'PS_UNIQ');

    if (psSchema) {
      const cols = psSchema.rows.map(r => r.column_name);
      console.log(`  Columns (${cols.length}): ${cols.join(', ')}`);
    }
    if (psUniq && psUniq.rows.length > 0) {
      console.log('  Unique constraints:');
      for (const uc of psUniq.rows) {
        console.log(`    ${uc.conname}: ${uc.constraint_def}`);
      }
    }
    console.log('');
    console.log('  PRICING_SCHEDULE_IS_TEMPORAL_HISTORY: NO');
    console.log('    — UNIQUE(property_id, date): one row per stay date per property.');
    console.log('    — ON CONFLICT DO UPDATE SET price = EXCLUDED.price — overwrites.');
    console.log('    — Recalculation replaces prior price. No archive of previous values.');
    console.log('    — updated_at records last write time, NOT when price was first set.');
    console.log('    — pushed_at records when Channex publication was attempted for');
    console.log('      THIS row value — but previous publication states are gone.');
    console.log('    — breakdown JSONB: factors at last calculation only.');
    console.log('');
    console.log('  PRICING_SCHEDULE_CAN_RECONSTRUCT_PRICE_PATH: NO');
    console.log('    — Once overwritten, the previous price for that stay date is gone.');

    // ── [3] PRICING_HISTORY AUDIT ─────────────────────────────────────────────
    console.log('\n  [3] PRICING_HISTORY SCHEMA AUDIT');

    const phSchema = await safeQuery(pool, PRICING_HISTORY_SCHEMA_SQL, [], 'PH_SCHEMA');
    const phUniq   = await safeQuery(pool, PRICING_HISTORY_UNIQUENESS_SQL, [], 'PH_UNIQ');

    if (phSchema) {
      const cols = phSchema.rows.map(r => r.column_name);
      console.log(`  Columns (${cols.length}): ${cols.join(', ')}`);
    }
    if (phUniq && phUniq.rows.length > 0) {
      console.log('  Unique constraints:');
      for (const uc of phUniq.rows) {
        console.log(`    ${uc.conname}: ${uc.constraint_def}`);
      }
    }
    console.log('');
    console.log('  PRICING_HISTORY_SEMANTICS:');
    console.log('    — Weekly aggregate recommendation, NOT a per-stay-date event log.');
    console.log('    — UNIQUE(property_id, week_start) — one row per property per WEEK.');
    console.log('    — ON CONFLICT DO UPDATE — weekly row is overwritten when re-run.');
    console.log('    — price_before = last price_applied from previous week (approximate).');
    console.log('    — price_calculated = engine output for "representative night" of week.');
    console.log('    — price_applied = price eventually applied (null if declined).');
    console.log('    — status: pending|applied|declined|skipped|error.');
    console.log('    — channex_update_id: present if Channex returned a confirmation ID.');
    console.log('      DOES NOT prove OTA actually exposed the price to guests.');
    console.log('    — factor_market/factor_self/factor_season: snapshot of calculation');
    console.log('      factors at calculation time — NOT per stay date.');
    console.log('    — week_start links to a Monday, NOT to a specific stay date.');
    console.log('    — NO stay_date field. Cannot join to a reservation by stay date.');
    console.log('');
    console.log('  PRICING_HISTORY_CAN_SUPPORT_ELASTICITY: NO');
    console.log('    — No stay-date dimension. Cannot answer "what was offered for date D".');
    console.log('    — Weekly granularity obliterates within-week price variation.');
    console.log('    — Overwrite semantics destroy intra-week price-change history.');
    console.log('    — channex_update_id present → Channex accepted the push attempt.');
    console.log('      NOT proof OTA exposed it. Not proof it reached guests.');
    console.log('');
    console.log('  PRICING_HISTORY_GAPS:');
    console.log('    — No per stay-date price: cannot reconstruct price(P,D,T).');
    console.log('    — No booking_conversion linkage: cannot join offer to outcome.');
    console.log('    — No OTA delivery state: channel_accepted ≠ guest_exposed.');
    console.log('    — No price-change event: no T1→T2 price transition per stay date.');
    console.log('    — No sellability state: stop_sell / min_stay not recorded per row.');

    // ── [4] RESERVATION REVENUE AUDIT ────────────────────────────────────────
    console.log('\n  [4] RESERVATION SCHEMA AUDIT');

    const resSchema = await safeQuery(pool, RESERVATIONS_SCHEMA_SQL, [], 'RES_SCHEMA');
    if (resSchema) {
      const cols = resSchema.rows.map(r => r.column_name);
      console.log(`  Columns (${cols.length}): ${cols.join(', ')}`);
    }
    console.log('');
    console.log('  REVENUE FIELDS PRESENT: amount_total, amount_rooms, amount_taxes,');
    console.log('    amount_cleaning, ota_commission, host_payout, currency,');
    console.log('    days_breakdown (JSONB).');
    console.log('');
    console.log('  BOOKING TIMESTAMP:');
    console.log('    — created_at = row insertion time (iCal sync, Channex webhook, etc.).');
    console.log('      For Channex reservations this is webhook receipt time, which is');
    console.log('      close to booking placement time but NOT the OTA booking timestamp.');
    console.log('      For iCal: created_at = import time, NOT booking time.');
    console.log('    — No "booking_placed_at" or "ota_booking_timestamp" field.');
    console.log('    — synced_at: iCal sync time (NOT booking time).');
    console.log('');
    console.log('  CAN_RECONSTRUCT_BOOKED_NIGHT_REVENUE:');
    console.log('    PARTIAL — amount_total present for guest_app and Channex bookings.');
    console.log('    amount_rooms separates accommodation from taxes/cleaning when populated.');
    console.log('    iCal reservations: amount fields typically NULL (not provided by iCal).');
    console.log('    BLOCK rows: no amount (not a booking).');
    console.log('');
    console.log('  CAN_RECONSTRUCT_BOOKING_PRICE_AT_CONVERSION:');
    console.log('    PARTIAL — amount_total exists for some sources but:');
    console.log('      1. iCal: no financial data');
    console.log('      2. booking modification history absent (no snapshots of changes)');
    console.log('      3. amount_total includes or excludes OTA fees depending on source');
    console.log('');
    console.log('  CAN_DISTINGUISH_ACCOMMODATION_REVENUE_FROM_FEES:');
    console.log('    PARTIAL — amount_rooms vs amount_taxes vs amount_cleaning when');
    console.log('    populated by Channex. Not populated for iCal or BLOCK rows.');
    console.log('');
    console.log('  CAN_DISTINGUISH_GROSS_FROM_NET:');
    console.log('    PARTIAL — ota_commission and host_payout present for some Channex');
    console.log('    bookings but not all sources. OTA commission may be absent for');
    console.log('    direct/guest_app bookings (no OTA involved).');
    console.log('');
    console.log('  CAN_RECONSTRUCT_MODIFICATIONS:');
    console.log('    NO — reservations table is mutable. No modification history,');
    console.log('    no old/new price capture on update, no event log.');
    console.log('');
    console.log('  CAN_RECONSTRUCT_CANCELLATIONS_AT_TIME_T:');
    console.log('    PARTIAL — status field contains current state (cancelled/canceled/');
    console.log('    confirmed). No cancellation timestamp column, no cancellation event');
    console.log('    log. created_at is row creation time, not cancellation time.');

    // ── [5] OFFERED PRICE vs BOOKED PRICE ─────────────────────────────────────
    console.log('\n  [5] OFFERED PRICE vs BOOKED PRICE');
    console.log('');
    console.log('  These are fundamentally different concepts:');
    console.log('  OFFERED PRICE = price displayed to a potential guest at time T for date D');
    console.log('  BOOKED PRICE  = amount a guest agreed to pay at booking time');
    console.log('');
    console.log('  Example: a property offered €150 for Oct 15 from Sep 1 to Oct 8,');
    console.log('  then reduced to €120 on Oct 9. A guest booked on Oct 11 at €120.');
    console.log('  The booked price (€120) tells us nothing about the offer trajectory.');
    console.log('  The offer at €150 for 37 days with no conversion is the elasticity signal.');
    console.log('');
    console.log('  CAN_BUILD_PRICE_TO_CONVERSION_TIMELINE: NO');
    console.log('    — pricing_schedule: current state only, no historical price path.');
    console.log('    — pricing_history: weekly aggregate, no stay-date dimension.');
    console.log('    — reservations.amount_total: single booked amount, no offer history.');
    console.log('    — No join between offer sequence and booking conversion exists.');
    console.log('    — OTA markup between BoostPrice and guest-visible price unknown.');

    // ── [6] HISTORICAL SELLABILITY AUDIT ──────────────────────────────────────
    console.log('\n  [6] HISTORICAL SELLABILITY AUDIT');
    console.log('');
    console.log('  CAN_RECONSTRUCT_HISTORICAL_SELLABILITY: PARTIAL');
    console.log('    What is available:');
    console.log('    — reservations (BLOCK rows): calendar blocks at time of creation.');
    console.log('      Current BLOCK state reflects today, not past sell state.');
    console.log('    — pricing_rules with rule_type=stop_sell: current state (mutable).');
    console.log('      stop_sell rules can be created/deleted — no mutation log.');
    console.log('    — pricing_schedule.status=applied indicates pricing was pushed');
    console.log('      for that date, NOT that it was actually sellable (min_stay,');
    console.log('      closed_to_arrival, property enabled/disabled all affect this).');
    console.log('    What is missing:');
    console.log('    — No historical stop_sell event log (when stop_sell was activated,');
    console.log('      deactivated for a specific date at time T).');
    console.log('    — No property availability timeline (was property active at T?).');
    console.log('    — No min_stay history (min_stay can change, no log).');
    console.log('    — Channex availability state not stored locally with timestamp.');
    console.log('    — SELLABLE(P,D,T) for past T is not reconstructable.');
    console.log('');
    console.log('  CAN_RECONSTRUCT_HISTORICAL_BOOKABILITY_CONSTRAINTS: NO');
    console.log('    — min_stay, max_stay, closed_to_arrival are current-state rules.');
    console.log('    — pricing_rules are mutable: history of rule changes not stored.');
    console.log('    — gap-fill state (derived at calculation time) not persisted.');
    console.log('    — LOS discount history absent.');
    console.log('    — A night offered at €100 but impossible to book for a 1-night LOS');
    console.log('      at a min_stay=2 rule is NOT equivalent to a freely offered night.');

    // ── [7] PRICE PUBLICATION / DELIVERY STATE ────────────────────────────────
    console.log('\n  [7] PRICE PUBLICATION / DELIVERY STATE');
    console.log('');
    console.log('  Five distinct states (only some are currently observable):');
    console.log('  1. CALCULATED: pricing_schedule row written / pricing_history created ✓');
    console.log('  2. ACCEPTED:   pricing_history.status=applied ✓ (also: mode=auto auto-accepts)');
    console.log('  3. EFFECTIVE_INTERNALLY: effective_pricing_resolver resolves it ✓');
    console.log('  4. ATTEMPTED_CHANNEX:    pricing_history.channex_update_id is non-null ✓');
    console.log('     BUT: channex_update_id present = Channex API acknowledged the push.');
    console.log('     NOT = Channex successfully loaded the rate into its inventory.');
    console.log('     NOT = OTA received the rate.');
    console.log('     NOT = OTA displayed the rate to guests.');
    console.log('  5. EXTERNALLY_EXPOSED: UNKNOWN — no OTA feedback stored.');
    console.log('');
    console.log('  CAN_PROVE_PRICE_WAS_EXTERNALLY_EXPOSED: NO');
    console.log('    — No OTA confirmation callback stored per stay date per price.');
    console.log('    — Channex webhook receipts for rate updates not stored.');
    console.log('    — OTA listing scrape history not correlated to sent prices.');
    console.log('');
    console.log('  DELIVERY_STATE_GAPS:');
    console.log('    — Cannot distinguish "Channex accepted" from "OTA displayed".');
    console.log('    — No per-stay-date publication state history.');
    console.log('    — Failed Channex pushes: pricing_history.status=error captures the');
    console.log('      weekly roll-up error, not which specific stay dates failed.');

    // ── [8] PRICE CHANGE SEQUENCE ─────────────────────────────────────────────
    console.log('\n  [8] PRICE CHANGE SEQUENCE');
    console.log('');
    console.log('  CAN_RECONSTRUCT_PRICE_CHANGE_SEQUENCE: NO');
    console.log('    — pricing_schedule UNIQUE(property_id, date) + DO UPDATE:');
    console.log('      Each recalculation overwrites. No archive.');
    console.log('    — pricing_history UNIQUE(property_id, week_start) + DO UPDATE:');
    console.log('      One weekly row, overwritten. No per-stay-date sequence.');
    console.log('    — pricing_overrides: UNIQUE(user_id,property_id,date) + updated_at.');
    console.log('      One row per date. Override history lost on update.');
    console.log('    — No price change event table exists anywhere in the schema.');
    console.log('    — Cannot answer: for stay date D, what were the prices at T1, T2, T3?');

    // ── [9] CURRENCY / OTA MARKUP ─────────────────────────────────────────────
    console.log('\n  [9] CURRENCY / OTA MARKUP AUDIT');
    console.log('');
    console.log('  PRICE_CURRENCY_PROVENANCE_READY: PARTIAL');
    console.log('    — properties.currency: canonical property currency (P1.2 work).');
    console.log('    — pricing_schedule: no currency column — inherits property currency.');
    console.log('    — pricing_history: no currency column — inherits property currency.');
    console.log('    — reservations.currency: booking currency (may differ from property).');
    console.log('    — market_observations.currency: market currency per profile.');
    console.log('    — FX conversion between currencies not stored historically.');
    console.log('');
    console.log('  OTA_MARKUP_HISTORY_READY: NO');
    console.log('    — Channex rate plans can include markup/commission fields.');
    console.log('      These are configuration-time values, not per-booking historical.');
    console.log('    — No stored sequence of OTA-displayed prices per stay date.');
    console.log('    — BoostPrice canonical price ≠ OTA-displayed price when markup exists.');
    console.log('    — Comparing reservation.amount_total to pricing_schedule.price');
    console.log('      conflates BoostPrice recommendation with OTA-net payout.');

    // ── [10] CAUSALITY AUDIT ──────────────────────────────────────────────────
    console.log('\n  [10] CAUSALITY AUDIT — WHY naive regression fails');
    console.log('');
    console.log('  Naive: bookings ~ price. This is BIASED because:');
    console.log('');
    console.log('  1. ENDOGENEITY / REVERSE CAUSALITY:');
    console.log('     BoostPrice uses pacing/market signals → raises price when demand is');
    console.log('     high. High demand predicts BOTH higher prices AND more bookings.');
    console.log('     Naive OLS would find positive price~bookings: confounded.');
    console.log('');
    console.log('  2. SEASONALITY CONFOUND:');
    console.log('     July/August → high price AND high demand. Any model without explicit');
    console.log('     seasonality controls will attribute seasonal bookings to price.');
    console.log('');
    console.log('  3. DOW CONFOUND:');
    console.log('     Weekends: higher price AND higher bookings. Same bias.');
    console.log('');
    console.log('  4. LEAD-TIME CONFOUND:');
    console.log('     Prices change by lead time (BoostPrice curve). Booking rates also');
    console.log('     change by lead time. Without controlling for lead time, we see');
    console.log('     last-minute discounts coinciding with last-minute bookings.');
    console.log('');
    console.log('  5. PACING / OCCUPANCY FEEDBACK LOOP:');
    console.log('     BoostPrice pacing multiplier raises price as occupancy fills.');
    console.log('     High occupancy → high prices → fewer remaining bookings needed.');
    console.log('     This creates a mechanical correlation that is not elasticity.');
    console.log('');
    console.log('  6. MANUAL OVERRIDES ARE NON-RANDOM:');
    console.log('     Hosts raise prices around events they know about. These override');
    console.log('     events are high-demand periods → upward bias again.');
    console.log('');
    console.log('  7. CENSORED DEMAND:');
    console.log('     Once a night is booked, no further demand is observable. A property');
    console.log('     sold out at €100 might have sold 3x at €80 had supply existed.');
    console.log('');
    console.log('  8. MARKET CO-MOVEMENT:');
    console.log('     Competitor prices and bookings co-move with demand. Cannot use');
    console.log('     market median as an instrument without exogeneity proof.');
    console.log('');
    console.log('  9. AVAILABILITY RESTRICTIONS censor exposure:');
    console.log('     min_stay=3 blocks single-night bookers at any price.');
    console.log('     Comparing booked nights across different min_stay regimes is invalid.');
    console.log('');
    console.log('  10. FUTURE LEAKAGE:');
    console.log('     Current DB final state (current pricing_schedule.price, current');
    console.log('     reservation.status) is not the state at observation time T.');
    console.log('');
    console.log('  DESCRIPTIVE_PRICE_RESPONSE_READY: PARTIAL');
    console.log('    — Can produce descriptive statistics: ADR by season/DOW/source.');
    console.log('    — Cannot control for simultaneous confounders systematically.');
    console.log('');
    console.log('  CAUSAL_ELASTICITY_ESTIMATION_READY: NO');
    console.log('    — Missing offered price path per stay date.');
    console.log('    — Missing sellability trajectory.');
    console.log('    — Missing booking conversion timestamp (real OTA booking time).');
    console.log('    — Cannot construct valid instruments without exogenous variation.');
    console.log('');
    console.log('  SAFE_AUTOMATED_ELASTICITY_READY: NO');
    console.log('    — Would require all of the above + validation on holdout data.');
    console.log('    — Premature automated elasticity risks systematic mispricing.');

    // ── [11] DEMAND SIGNAL MATRIX ─────────────────────────────────────────────
    console.log('\n  [11] DEMAND SIGNAL MATRIX');
    console.log('');
    console.log('  Signal                   Available  Source                  Historical  Prop-scoped  Date-scoped  Reliability');
    console.log('  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────');
    console.log('  Booking count            YES        reservations            YES         YES          YES          MODERATE');
    console.log('    (CENSORED — further demand after booking is unobservable)');
    console.log('  Booked nights            YES        reservations            YES         YES          YES          MODERATE');
    console.log('  Pickup velocity          YES        booking_pickup_obs.     YES(shadow) YES          YES          EARLY');
    console.log('  Market comp price        YES        market_data/obs.        YES(~1yr)   PROFILE      NO           MODERATE');
    console.log('  Market occupancy         YES        market_data             YES(~1yr)   PROFILE      NO           LOW');
    console.log('  Market comparable count  YES        market_observations     YES(~1yr)   PROFILE      NO           MODERATE');
    console.log('  Block/BLOCK rows         YES        reservations            PARTIAL     YES          YES          LOW');
    console.log('    (partial: only if host actively uses blocking)');
    console.log('  Seasonality obs.         YES        local_season.obs.       NEW         YES          MONTH        EARLY');
    console.log('  Search impressions       NO         —                       —           —            —            N/A');
    console.log('  Listing views            NO         —                       —           —            —            N/A');
    console.log('  Conversion rate          NO         —                       —           —            —            N/A');
    console.log('  Inquiries/messages       PARTIAL    conversations/messages  PARTIAL     YES          NO           LOW');
    console.log('  Wishlists                NO         —                       —           —            —            N/A');
    console.log('  Lost bookings            NO         —                       —           —            —            N/A');
    console.log('  Competitor availability  NO         —                       —           —            —            N/A');
    console.log('');
    console.log('  DEMAND_CENSORING_NOTE: Bookings are right-censored demand observations.');
    console.log('  After a night is booked, any subsequent willingness-to-pay at that price');
    console.log('  is unobservable. Elasticity cannot be estimated from booked prices alone.');

    // ── [12] PICKUP CONTRIBUTION ──────────────────────────────────────────────
    console.log('\n  [12] PICKUP OBSERVATIONS — FUTURE DEMAND MODEL POTENTIAL');
    console.log('');
    console.log('  PICKUP MEASURES:');
    console.log('    — Booking velocity: recent_booking_count in a lead-time band');
    console.log('      relative to historical baseline for that date/band combination.');
    console.log('    — Pickup ratio (raw and Laplace-stabilized): ACCELERATING/NORMAL/SLOW.');
    console.log('    — Advisory multiplier (shadow only — never applied to pricing).');
    console.log('    — Pacing occupancy fraction for the target date.');
    console.log('');
    console.log('  PICKUP DOES NOT MEASURE:');
    console.log('    — Offered price at each observation time (no price field in BPO table).');
    console.log('    — Sellability state at observation time.');
    console.log('    — OTA-specific demand vs property-level demand.');
    console.log('    — Unconverted demand (guests who viewed but did not book).');
    console.log('');
    console.log('  PICKUP_USEFUL_FOR_FUTURE_DEMAND_MODEL: YES');
    console.log('    — Longitudinal pickup history per (property, stay_date) is exactly the');
    console.log('      demand signal needed for lead-time-stratified demand models.');
    console.log('    — Combined with offered price at each observation, pickup becomes a');
    console.log('      demand rate estimator at a given price/lead-time combination.');
    console.log('');
    console.log('  PICKUP_SUFFICIENT_FOR_ELASTICITY: NO');
    console.log('    — No offered price stored per observation.');
    console.log('    — No price variation embedded: all pickup at market-clearing prices.');
    console.log('    — Cannot compute price elasticity without the price axis.');
    console.log('    — To become useful for elasticity: join bpo.observation_date to');
    console.log('      a future price_observation table for (property, date, observation_date).');

    // ── [13] MARKET OBSERVATIONS CONTRIBUTION ─────────────────────────────────
    console.log('\n  [13] MARKET OBSERVATIONS — FUTURE DEMAND MODEL POTENTIAL');
    console.log('');
    console.log('  PROVIDES: competitor median price, P25/P75, comparable count, quality,');
    console.log('    currency, check_in/check_out dates, market_profile_id, collected_at.');
    console.log('');
    console.log('  MARKET_HISTORY_USEFUL_FOR_DEMAND_MODEL: YES');
    console.log('    — Market price level controls for external demand pressure.');
    console.log('    — Comparable count proxies market supply (higher supply → lower margin).');
    console.log('    — Time-series of median price provides demand pressure indicator.');
    console.log('    — Collected per stay window, not per stay date: can be joined to');
    console.log('      stay dates within the check_in/check_out window.');
    console.log('');
    console.log('  MARKET_HISTORY_SUFFICIENT_NOW: NO');
    console.log('    — ~1 year of history: too short for YoY seasonality correction.');
    console.log('    — No property-level (vs market-level) demand signal.');
    console.log('    — No availability-count metric (how many competitors had rooms).');
    console.log('    — Market tension is derived from occupancy_rate which is estimated.');

    // ── [14] SEASONALITY OBSERVATIONS ────────────────────────────────────────
    console.log('\n  [14] LOCAL SEASONALITY OBSERVATIONS');
    console.log('');
    console.log('  SEASONALITY_HISTORY_USEFUL_FOR_DEMAND_MODEL: YES (prospectively)');
    console.log('    — Longitudinal target-month observations: booking build-up curve');
    console.log('      at D180/D120/D90/D60/D30/D14/D7 per property per month.');
    console.log('    — generic_reference_factor: IDF seasonal anchor for comparison.');
    console.log('    — exposure_confidence: tracks whether occupancy denominator is known.');
    console.log('    — After 52 weeks: one full year of weekly snapshots per month.');
    console.log('    — After 104 weeks: year-over-year comparison first becomes possible.');
    console.log('');
    console.log('  SEASONALITY_HISTORY_SUFFICIENT_NOW: NO');
    console.log('    — Shadow just activated. May contain 0 rows currently.');
    console.log('    — Minimum useful threshold: 9+ months of observations per property.');
    console.log('    — Full YoY potential: 24+ months (104+ weekly runs).');

    // ── [15] EVENT / HOLIDAY CONTEXT ──────────────────────────────────────────
    console.log('\n  [15] EVENT / HOLIDAY CONTEXT');
    console.log('');
    console.log('  EVENT_HISTORY_READY_FOR_CAUSAL_ANALYSIS: NO');
    console.log('    — EVENTS_PARIS_2026 and SCHOOL_HOLIDAYS_IDF_2025_2026 are static arrays');
    console.log('      hardcoded in pricing-engine.js. No DB storage of event history.');
    console.log('    — Events are mutable (updated by code deployment), not point-in-time.');
    console.log('    — Cannot reconstruct "what did BoostPrice believe about events at T?"');
    console.log('    — No event_log table: event effect on prices is not recoverable.');
    console.log('    — IDF-only: Paris/Île-de-France events only. No other regions.');
    console.log('    — Controlling for events in elasticity estimation requires knowing');
    console.log('      the exact event definition at decision time T — not available.');

    // ── [16] PROPERTY HETEROGENEITY ───────────────────────────────────────────
    console.log('\n  [16] PROPERTY DIMENSIONS AVAILABLE');
    console.log('');
    console.log('  PROPERTY_FEATURES_AVAILABLE:');
    console.log('    — location: latitude, longitude, country_code (present for geo-enriched properties)');
    console.log('    — timezone (present where set)');
    console.log('    — currency (after P1.2)');
    console.log('    — bedrooms (INTEGER — where set)');
    console.log('    — max_guests (INTEGER — where set)');
    console.log('    — base_price, weekend_price (current, not historical)');
    console.log('    — pricing_config: price_min, price_max, mode (manual/auto), strategy');
    console.log('    — market_profile_id: links to shared geo/type search identity');
    console.log('    ABSENT:');
    console.log('    — property_type (pricing_config has it; properties may not)');
    console.log('    — review score / review count');
    console.log('    — amenities (structured field)');
    console.log('    — cancellation policy');
    console.log('    — OTA-specific listing ID correlation');
    console.log('');
    console.log('  FUTURE_ELASTICITY_SCOPE_CANDIDATES:');
    console.log('    — property-specific: one coefficient per property');
    console.log('      Requires: 200+ bookings, multi-year history, price variation');
    console.log('    — market-profile pooled: shared coefficient within profile');
    console.log('      Requires: many properties in profile with sufficient history');
    console.log('    — Hierarchical: property draws from profile prior');
    console.log('      Most principled; requires Bayesian or multilevel framework');
    console.log('    — Country/region archetype: broadest generalization, weakest identification');

    // ── [17] POINT-IN-TIME POLICY ─────────────────────────────────────────────
    console.log('\n  [17] POINT-IN-TIME POLICY & LEAKAGE RISKS');
    console.log('');
    console.log('  POINT_IN_TIME_DATA_POLICY:');
    console.log('    At decision time T, any training row must only use information known');
    console.log('    at or before T. Specifically:');
    console.log('    — observation_date / calculated_at timestamps define T.');
    console.log('    — No future reservation outcomes may leak into features for time ≤T.');
    console.log('    — No final status fields (current cancellation state) may substitute');
    console.log('      for point-in-time reservation state.');
    console.log('');
    console.log('  CURRENT_FUTURE_LEAKAGE_RISKS:');
    console.log('    HIGH — reservations.status: current state (cancelled/confirmed) used');
    console.log('      naively would leak future cancellations into past features.');
    console.log('    HIGH — pricing_schedule.price: current recalculated price, not the');
    console.log('      price at any historical observation time T.');
    console.log('    MEDIUM — pricing_rules: current rule set, not historical.');
    console.log('    MEDIUM — pricing_config: current min/max/mode, not historical.');
    console.log('    LOW — booking_pickup_observations: append-only + observation_date key.');
    console.log('      Point-in-time slicing IS possible: WHERE observation_date <= T.');
    console.log('    LOW — market_observations: append-only + collected_at. Safe for PIT.');
    console.log('    LOW — local_seasonality_observations: append-only + observation_date.');

    // ── [18] RECOMMENDED PROSPECTIVE DATA MODEL ───────────────────────────────
    console.log('\n  [18] RECOMMENDED PROSPECTIVE DATA MODEL (design only — no migration)');
    console.log('');
    console.log('  To enable future elasticity estimation, prospective logging of:');
    console.log('');
    console.log('  price_observations (per stay date, append-only):');
    console.log('    (property_id, stay_date, observation_date, calculated_at,');
    console.log('     canonical_price, price_source, currency,');
    console.log('     min_stay, stop_sell, is_sellable,');
    console.log('     lead_time_days, occupancy_fraction, market_context_key,');
    console.log('     breakdown_json, model_version)');
    console.log('    UNIQUE(property_id, stay_date, observation_date, model_version)');
    console.log('    — Append-only: one row per (property, stay_date, weekly_observation)');
    console.log('    — Enables: price path reconstruction, PIT slicing, offer-to-booking join');
    console.log('');
    console.log('  booking_events (immutable, on creation/modification/cancellation):');
    console.log('    (reservation_uid, event_type, event_at, stay_date_start, stay_date_end,');
    console.log('     offered_price_at_booking, booked_currency, amount_total, source,');
    console.log('     lead_time_days_at_booking)');
    console.log('    — Event_type: CREATED | MODIFIED | CANCELLED');
    console.log('    — Enables: booking conversion with exact lead-time and price-at-booking');
    console.log('');
    console.log('  MINIMAL VIABLE CAPABILITY:');
    console.log('    price_observations + booking_events, both append-only.');
    console.log('    After 6 months: first descriptive price response curves.');
    console.log('    After 12 months: first controlled elasticity estimates (noisy).');
    console.log('    After 24 months: YoY validation of seasonal controls possible.');

    // ── [19] PRICE HISTORY SCALE ──────────────────────────────────────────────
    console.log('\n  [19] PRICE HISTORY SCALE ESTIMATES');
    console.log('');
    console.log('  Assumption: weekly recalculation, 365-day horizon per property.');
    console.log('');
    console.log('  Strategy A — Full daily snapshot of all future stay dates:');
    console.log('  Properties  Rows/run    Rows/year    Storage/year (est.)');
    console.log('      30       10,950      569,400      ~200 MB');
    console.log('     100       36,500    1,898,000      ~650 MB');
    console.log('     500      182,500    9,490,000      ~3.2 GB');
    console.log('   1,000      365,000   18,980,000      ~6.5 GB');
    console.log('  (assuming ~350 bytes/row average with breakdown JSONB trimmed)');
    console.log('');
    console.log('  Strategy B — Append-only only-when-changed events:');
    console.log('    Requires a diff against previous snapshot. Storage ≈ 10-20% of A');
    console.log('    when prices change weekly for ~half the horizon dates.');
    console.log('    Complexity: must store previous state to compute diff.');
    console.log('');
    console.log('  Strategy C — Hybrid periodic snapshot + change events (RECOMMENDED):');
    console.log('    Weekly snapshot of next 90 days (capture short-term pacing effects).');
    console.log('    Change events for 91–365 days (sparse, most prices stable far out).');
    console.log('    Rows/run: ~90 × N_props (snapshot) + ~few_hundred (changes).');
    console.log('    Storage/year at 100 props: ~100 MB — very manageable.');

    // ── [20] REVENUE METRICS ──────────────────────────────────────────────────
    console.log('\n  [20] REVENUE METRICS');
    console.log('');
    console.log('  REVENUE_METRICS_CURRENTLY_RELIABLE:');
    console.log('    — ADR (Average Daily Rate): PARTIAL');
    console.log('      Computable from Channex/guest_app reservations that have amount_rooms.');
    console.log('      Unreliable for iCal (no financial data) and some direct bookings.');
    console.log('    — Occupancy: PARTIAL (requires reliable sellability denominator).');
    console.log('      Without block history, calendar exposure is unknown for many properties.');
    console.log('    — RevPAR: PARTIAL — product of ADR × occupancy: inherits both limitations.');
    console.log('    — Net accommodation revenue: PARTIAL — amount_rooms minus OTA commission.');
    console.log('      ota_commission present for Channex only, inconsistently.');
    console.log('    — Gross booking revenue: PARTIAL — amount_total for non-iCal sources.');
    console.log('    — Expected revenue: NOT COMPUTABLE — requires demand probability model.');
    console.log('    — Owner payout: PARTIAL — host_payout for Channex bookings only.');
    console.log('');
    console.log('  REVENUE_OBJECTIVE_READY: NO');
    console.log('    — No objective can be reliably maximized without:');
    console.log('       1. Defensible sellability denominator (BLOCK coverage insufficient).');
    console.log('       2. Price-response model (no elasticity data yet).');
    console.log('       3. Consistent financial data across all sources.');

    // ── [21] INTERNATIONALIZATION GAPS ───────────────────────────────────────
    console.log('\n  [21] INTERNATIONALIZATION GAPS');
    console.log('');
    console.log('  INTERNATIONALIZATION_GAPS:');
    console.log('    — seasonByMonth curve: hardcoded for Île-de-France / Paris.');
    console.log('      Properties outside IDF may have structurally different seasonal curves.');
    console.log('    — EVENTS_PARIS_2026 and school holidays: IDF-only. No other regions.');
    console.log('    — Lead-time curve: assumed similar across markets. Southern EU, Asia,');
    console.log('      North America often have different booking windows.');
    console.log('    — DOW weights: IDF leisure-market assumption. Business markets differ.');
    console.log('    — Currency: P1.2 work addressed property-level currency provenance.');
    console.log('      Cross-currency comparison still requires FX rates at time T.');
    console.log('    — Hemisphere: seasonByMonth assumes Northern Hemisphere.');
    console.log('      December=low, July=peak. Southern hemisphere inverts this.');
    console.log('    — Any future demand model must be parameterized by market_context_key');
    console.log('      or market_profile_id, NOT applied globally.');

    // ── [22] MIN/MAX SAFETY STATEMENT ─────────────────────────────────────────
    console.log('\n  [22] MIN/MAX SAFETY — FUTURE MODEL SUBORDINATION');
    console.log('');
    console.log('  Any future demand / elasticity / revenue model MUST remain subordinate to:');
    console.log('    — properties.price_min / price_max (hard bounds)');
    console.log('    — manual overrides (pricing_overrides: highest precedence)');
    console.log('    — external_pricing=true (disables BoostPrice entirely)');
    console.log('    — stop_sell rules (pricing_rules.rule_type=stop_sell)');
    console.log('    — effective_pricing_resolver precedence chain');
    console.log('    — pricing_publisher safety guards');
    console.log('  These constraints are NEVER bypassed. No code change in T0.');

    // ── [23] PRICING AUTHORITY PROOF ──────────────────────────────────────────
    console.log('\n  [23] PRICING AUTHORITY PROOF (file-based, no DB)');
    const authViolations = checkPricingAuthorityProof();
    console.log(`\n  DEMAND_MODEL_HAS_PRICING_AUTHORITY:     ${authViolations.length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    console.log(`  ELASTICITY_MODEL_HAS_PRICING_AUTHORITY: ${authViolations.length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    console.log(`  REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY:${authViolations.length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    if (authViolations.length > 0) {
      console.log('  VIOLATIONS:');
      for (const v of authViolations) console.log(`    ${v}`);
    }
    console.log('  PRODUCTION_PRICING_CHANGED: NO (audit is read-only)');

    // ── [24] PER-PROPERTY SECTION ─────────────────────────────────────────────
    console.log('\n  [24] PER-ACTIVE-PROPERTY READINESS');

    const propsRes = await safeQuery(pool, ACTIVE_PROPERTIES_SQL, [], 'ACTIVE_PROPS');
    const activeProps = propsRes ? propsRes.rows : [];
    console.log(`\n  Active BoostPrice properties: ${activeProps.length}`);

    const propertyResults = [];

    for (const prop of activeProps) {
      const pName = prop.internal_name || prop.name || `prop#${prop.property_id}`;
      console.log(`\n  ── Property: ${pName} (id=${prop.property_id}) ──`);

      // Context
      console.log(`  timezone=${prop.timezone ?? 'NULL'}  country=${prop.country_code ?? 'NULL'}  currency=${prop.currency ?? 'NULL'}`);
      console.log(`  base_price=${prop.base_price ?? 'NULL'}  mode=${prop.mode}  market_profile=${prop.market_profile_id ?? 'none'}`);

      // Reservation stats
      const resStats = await safeQuery(pool, RESERVATION_STATS_SQL, [prop.property_id], 'RES_STATS');
      let reliableReservations = 0, monthsOfHistory = 0, hasAmountTotal = false, hasBlockHistory = false;
      if (resStats && resStats.rows[0]) {
        const s = resStats.rows[0];
        reliableReservations = parseInt(s.reliable_reservations) || 0;
        hasAmountTotal = parseInt(s.has_amount_total) > 0;
        hasBlockHistory = parseInt(s.block_count) > 0;
        const firstDate = s.first_reliable_start ? String(s.first_reliable_start).slice(0,10) : null;
        const lastDate  = s.last_reliable_end    ? String(s.last_reliable_end).slice(0,10) : null;
        if (firstDate && lastDate) {
          monthsOfHistory = Math.round((new Date(lastDate) - new Date(firstDate)) / (30 * 86400000));
        }
        console.log(`  Reservations: total=${s.total_reservations}  reliable=${s.reliable_reservations}  blocks=${s.block_count}`);
        console.log(`  History: ${firstDate ?? 'none'} → ${lastDate ?? 'none'} (~${monthsOfHistory} months)`);
        console.log(`  Financial: amount_total=${s.has_amount_total}/${s.total_reservations}  ota_comm=${s.has_ota_commission}  host_payout=${s.has_host_payout}`);
        console.log(`  Currencies: ${s.distinct_currencies}  has_block_history=${hasBlockHistory}`);
      }

      // Pricing schedule stats
      const psStats = await safeQuery(pool, PRICING_SCHEDULE_STATS_SQL, [prop.property_id], 'PS_STATS');
      let pricingHistoryRows = 0, pricingScheduleRows = 0;
      if (psStats && psStats.rows[0]) {
        const s = psStats.rows[0];
        pricingScheduleRows = parseInt(s.total_rows) || 0;
        console.log(`  pricing_schedule: rows=${s.total_rows}  distinct_prices=${s.distinct_prices}  applied=${s.applied_count}  pending=${s.pending_count}`);
        console.log(`    date range: ${s.min_date ?? 'none'} → ${s.max_date ?? 'none'}`);
        console.log(`    NOTE: current state only — price history NOT reconstructable from this table.`);
      }

      // Pricing history stats
      const phStats = await safeQuery(pool, PRICING_HISTORY_STATS_SQL, [prop.property_id], 'PH_STATS');
      if (phStats && phStats.rows[0]) {
        const s = phStats.rows[0];
        pricingHistoryRows = parseInt(s.total_rows) || 0;
        console.log(`  pricing_history: rows=${s.total_rows}  first=${s.first_week ?? 'none'}  last=${s.last_week ?? 'none'}`);
        console.log(`    applied=${s.applied_count}  declined=${s.declined_count}  channex_confirmed=${s.channex_confirmed}`);
        console.log(`    NOTE: weekly granularity, no stay-date dimension, overwritten on recalc.`);
      }

      // Pickup observations
      let pickupRows = 0;
      const bpoStats = await safeQuery(pool, PICKUP_STATS_SQL, [prop.property_id], 'BPO_STATS');
      if (bpoStats && bpoStats.rows[0]) {
        const s = bpoStats.rows[0];
        pickupRows = parseInt(s.total_rows) || 0;
        console.log(`  pickup_observations: rows=${s.total_rows}  target_dates=${s.distinct_target_dates}  obs_dates=${s.distinct_observation_dates}`);
      }

      // Market observations
      let marketObsRows = 0;
      if (prop.market_profile_id) {
        const moStats = await safeQuery(pool, MARKET_OBS_STATS_SQL, [prop.property_id], 'MO_STATS');
        if (moStats && moStats.rows[0]) {
          const s = moStats.rows[0];
          marketObsRows = parseInt(s.total_rows) || 0;
          console.log(`  market_observations: rows=${s.total_rows}  profiles=${s.distinct_profiles}  first=${s.first_collected?.toISOString().slice(0,10) ?? 'none'}`);
        }
      } else {
        console.log(`  market_observations: 0 (no market_profile assigned)`);
      }

      // Seasonality observations
      let seasonRows = 0;
      const seasonStats = await safeQuery(pool, SEASONALITY_STATS_SQL, [prop.property_id], 'SEASON_STATS');
      if (seasonStats && seasonStats.rows[0]) {
        const s = seasonStats.rows[0];
        seasonRows = parseInt(s.total_rows) || 0;
        console.log(`  seasonality_observations: rows=${s.total_rows}  target_months=${s.distinct_target_months}  obs_dates=${s.distinct_observation_dates}`);
      }

      // Market data (legacy)
      const mdStats = await safeQuery(pool, MARKET_DATA_STATS_SQL, [prop.property_id], 'MD_STATS');
      if (mdStats && mdStats.rows[0]) {
        const s = mdStats.rows[0];
        console.log(`  market_data (legacy): rows=${s.total_rows}  weeks=${s.distinct_weeks}  first=${s.first_week ?? 'none'}  last=${s.last_week ?? 'none'}`);
      }

      // Readiness tiers
      const demandTier = classifyDemandReadiness({ reliableReservations, monthsOfHistory, hasBlockHistory });
      const priceExpTier = classifyPriceExposureReadiness({ pricingHistoryRows, pricingScheduleRows });
      const elasticityTier = classifyElasticityReadiness({ demandTier, priceExposureTier: priceExpTier, hasPickup: pickupRows > 0 });
      const revOptTier = classifyRevenueOptimizationReadiness({ elasticityTier, hasAmountTotal });

      console.log('');
      console.log(`  DEMAND_HISTORY_READINESS:         ${demandTier}`);
      console.log(`  PRICE_EXPOSURE_READINESS:         ${priceExpTier}`);
      console.log(`  ELASTICITY_READINESS:             ${elasticityTier}`);
      console.log(`  REVENUE_OPTIMIZATION_READINESS:   ${revOptTier}`);

      const blockers = [];
      if (!prop.timezone) blockers.push('timezone_missing');
      if (!prop.country_code) blockers.push('country_code_missing');
      if (!prop.currency) blockers.push('currency_missing');
      if (!prop.market_profile_id) blockers.push('no_market_profile');
      if (reliableReservations < 10) blockers.push('insufficient_reservations(<10)');
      blockers.push('no_offered_price_path');
      blockers.push('no_sellability_history');
      blockers.push('no_booking_conversion_timestamp');
      console.log(`  BLOCKERS: ${blockers.join(', ')}`);

      propertyResults.push({
        propertyId: prop.property_id,
        name: pName,
        demandTier,
        priceExpTier,
        elasticityTier,
        revOptTier,
        reliableReservations,
        monthsOfHistory,
        pickupRows,
        marketObsRows,
        seasonRows,
      });
    }

    // ── [25] GLOBAL SUMMARY ───────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('  P1.5-T0 GLOBAL READINESS SUMMARY');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log('');
    console.log('  CAN_RECONSTRUCT_HISTORICAL_OFFERED_PRICE:   NO (PARTIAL for current week)');
    console.log('  CAN_BUILD_PRICE_TO_CONVERSION_TIMELINE:     NO');
    console.log('  CAN_RECONSTRUCT_HISTORICAL_SELLABILITY:     PARTIAL (BLOCK only)');
    console.log('  CAN_RECONSTRUCT_HISTORICAL_BOOKABILITY_CONSTRAINTS: NO');
    console.log('  CAN_PROVE_PRICE_WAS_EXTERNALLY_EXPOSED:     NO');
    console.log('  CAN_RECONSTRUCT_PRICE_CHANGE_SEQUENCE:      NO');
    console.log('  PRICE_CURRENCY_PROVENANCE_READY:            PARTIAL');
    console.log('  OTA_MARKUP_HISTORY_READY:                   NO');
    console.log('  CAN_RECONSTRUCT_BOOKED_NIGHT_REVENUE:       PARTIAL');
    console.log('  CAN_DISTINGUISH_ACCOMMODATION_FROM_FEES:    PARTIAL (Channex only)');
    console.log('  CAN_DISTINGUISH_GROSS_FROM_NET:             PARTIAL (Channex only)');
    console.log('  CAN_RECONSTRUCT_MODIFICATIONS:              NO');
    console.log('  DESCRIPTIVE_PRICE_RESPONSE_READY:           PARTIAL');
    console.log('  CAUSAL_ELASTICITY_ESTIMATION_READY:         NO');
    console.log('  SAFE_AUTOMATED_ELASTICITY_READY:            NO');
    console.log('  EVENT_HISTORY_READY_FOR_CAUSAL_ANALYSIS:    NO');
    console.log('  REVENUE_OBJECTIVE_READY:                    NO');
    console.log('');

    if (activeProps.length > 0) {
      console.log('  PER-PROPERTY READINESS SUMMARY:');
      for (const r of propertyResults) {
        console.log(`    ${r.name.padEnd(30)} demand=${r.demandTier.padEnd(12)} elasticity=${r.elasticityTier}`);
      }
      console.log('');
    }

    console.log('  CRITICAL PATH TO ELASTICITY:');
    console.log('  1. Design + migrate price_observations table (append-only, per stay date)');
    console.log('  2. Design + migrate booking_events table (CREATED/MODIFIED/CANCELLED)');
    console.log('  3. Collect ≥12 months of prospective price observations');
    console.log('  4. Accumulate ≥6 months of enriched booking_events');
    console.log('  5. Run descriptive analysis with confound controls');
    console.log('  6. Only then evaluate causal identification strategy');
    console.log('');
    console.log('  RECOMMENDED_NEXT_STEP: Begin design of price_observations schema (T1).');
    console.log('    No migration or pricing change in T0. Confirm readiness findings first.');
    console.log('');
    console.log('  DEMAND_MODEL_HAS_PRICING_AUTHORITY     = NO');
    console.log('  ELASTICITY_MODEL_HAS_PRICING_AUTHORITY = NO');
    console.log('  REVENUE_OPTIMIZER_HAS_PRICING_AUTHORITY= NO');
    console.log('  PRODUCTION_PRICING_CHANGED             = NO');
    console.log('  DB_WRITES_THIS_RUN                     = 0');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log('  P1_5_T0_AUDIT_READ_ONLY: YES');
    console.log('  P1_5_T0_IMPLEMENTED: YES');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('');

  } finally {
    await pool.end();
  }
}

module.exports = { runAudit, checkPricingAuthorityProof, classifyDemandReadiness,
                   classifyPriceExposureReadiness, classifyElasticityReadiness,
                   classifyRevenueOptimizationReadiness };
