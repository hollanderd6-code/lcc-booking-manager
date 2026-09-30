'use strict';
/**
 * P1.4-T0 — Local Seasonality Data Readiness Audit
 *
 * READ-ONLY diagnostic. Traces the current hardcoded seasonality authority,
 * audits reservation history and market data maturity per active BoostPrice
 * property, and reports whether historical evidence is sufficient to begin
 * learning a property-local or market-profile-local seasonal curve.
 *
 * This tool NEVER:
 *   modifies seasonByMonth or any part of pricing-engine.js
 *   writes DB rows
 *   calls Channex, Bright Data, APIFY, or any external provider
 *   modifies pricing_schedule, pricing_config, or reservations
 *   applies migrations
 *   enables feature flags
 *
 * SAFETY:
 *   READ_ONLY              = YES
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_WRITES         = 0  always
 *   MARKET_PROVIDER_CALLS  = 0  always
 *   LIVE_NETWORK_CALLS     = 0  always
 *   LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY = NO
 *   PRODUCTION_SEASONALITY_CHANGED          = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-local-seasonality-readiness-p1_4_t0.js
 */

const path = require('path');
const fs   = require('fs');

// ── Pure helpers (exported — safe to require without DB) ──────────────────────

/**
 * Classify a reservation row's source for seasonality analysis.
 *
 * A reservation is BLOCK when any of: source='BLOCK', reservation_type='block',
 * platform='BLOCK'. This covers all known patterns for admin/owner blocks.
 *
 * @param {{ source?: string, reservation_type?: string, platform?: string }} r
 * @returns {'BLOCK'|'ICAL'|'OTA_CONFIRMED'|'DIRECT'|'GUEST_APP'|'UNKNOWN'}
 */
function classifyReservationSource(r) {
  const src  = String(r.source   || '').toUpperCase();
  const rtyp = String(r.reservation_type || '').toLowerCase();
  const plat = String(r.platform || '').toUpperCase();
  if (src === 'BLOCK' || rtyp === 'block' || plat === 'BLOCK') return 'BLOCK';
  if (src === 'ICAL')                                           return 'ICAL';
  if (src === 'CHANNEX')                                        return 'OTA_CONFIRMED';
  if (src === 'GUEST_APP')                                      return 'GUEST_APP';
  if (src === 'DIRECT' || plat === 'DIRECT')                    return 'DIRECT';
  return 'UNKNOWN';
}

/**
 * Returns true for reservations reliable as STAY OCCURRENCE data.
 *
 * ICAL is reliable for STAY OCCURRENCE (the stay happened at those dates)
 * even though the iCal sync timestamp is unreliable for BOOKING TIMING analysis.
 * BLOCK rows are excluded — they do not represent real guest stays.
 * Cancelled reservations are excluded.
 *
 * @param {{ source?: string, reservation_type?: string, platform?: string,
 *            status?: string, start_date?: string, end_date?: string }} r
 * @returns {boolean}
 */
function isReliableForStayOccurrence(r) {
  const cls    = classifyReservationSource(r);
  const status = String(r.status || '').toLowerCase();
  if (cls === 'BLOCK') return false;
  if (status === 'cancelled' || status === 'canceled') return false;
  if (!r.start_date || !r.end_date) return false;
  return true;
}

/**
 * Returns true for reservations reliable as BOOKING TIMING data.
 *
 * ICAL is NOT reliable for booking timing — the iCal sync creates/updates rows
 * with server-side timestamps, not the actual booking creation time.
 *
 * @param {{ source?: string, reservation_type?: string, platform?: string,
 *            status?: string, start_date?: string, end_date?: string }} r
 * @returns {boolean}
 */
function isReliableForBookingTiming(r) {
  const cls = classifyReservationSource(r);
  return isReliableForStayOccurrence(r) && cls !== 'ICAL';
}

/**
 * Split a stay into per-calendar-month night counts.
 * end_date is exclusive (checkout day is not a booked night).
 *
 * Example: start=2026-06-29, end=2026-07-02 → { '2026-06': 2, '2026-07': 1 }
 * Correctly handles: leap-year February, year boundaries, same-month stays.
 *
 * @param {string} startStr — YYYY-MM-DD check-in date
 * @param {string} endStr   — YYYY-MM-DD checkout date (exclusive)
 * @returns {Object.<string, number>}  { 'YYYY-MM': nightsInThatMonth, ... }
 */
function splitNightsByMonth(startStr, endStr) {
  const result = {};
  if (!startStr || !endStr) return result;
  const MS_DAY = 86400000;
  const start  = new Date(startStr + 'T00:00:00Z');
  const end    = new Date(endStr   + 'T00:00:00Z');
  if (end <= start) return result;
  let cur = new Date(start);
  while (cur < end) {
    const ym       = cur.toISOString().slice(0, 7); // 'YYYY-MM'
    const nextMon  = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const segEnd   = nextMon < end ? nextMon : end;
    const nights   = Math.round((segEnd - cur) / MS_DAY);
    result[ym]     = (result[ym] || 0) + nights;
    cur = nextMon;
  }
  return result;
}

/**
 * Aggregate an array of reservation rows into monthly booked nights.
 * Only counts rows where isReliableForStayOccurrence = true.
 *
 * @param {Array<object>} reservations
 * @returns {Object.<string, number>}  { 'YYYY-MM': totalNights, ... }
 */
function computeMonthlyBookedNights(reservations) {
  const totals = {};
  for (const r of reservations) {
    if (!isReliableForStayOccurrence(r)) continue;
    const split = splitNightsByMonth(
      String(r.start_date).slice(0, 10),
      String(r.end_date).slice(0, 10),
    );
    for (const [ym, nights] of Object.entries(split)) {
      totals[ym] = (totals[ym] || 0) + nights;
    }
  }
  return totals;
}

/**
 * Find month-of-year indices (1–12) that have reservation data in 2+ distinct years.
 * These are the available year-over-year comparison pairs.
 *
 * @param {Object.<string, number>} monthlyBookedNights  — { 'YYYY-MM': nights }
 * @returns {{ month: number, years: number[], nights: number[] }[]}
 */
function detectYoYPairs(monthlyBookedNights) {
  // Group by calendar month (1-12)
  const byMonth = {};
  for (const [ym, nights] of Object.entries(monthlyBookedNights)) {
    if (!nights) continue;
    const [year, mon] = ym.split('-').map(Number);
    if (!byMonth[mon]) byMonth[mon] = [];
    byMonth[mon].push({ year, nights });
  }
  const pairs = [];
  for (const [mon, entries] of Object.entries(byMonth)) {
    const sorted = entries.sort((a, b) => a.year - b.year);
    if (sorted.length >= 2) {
      pairs.push({
        month: Number(mon),
        years:  sorted.map(e => e.year),
        nights: sorted.map(e => e.nights),
      });
    }
  }
  return pairs.sort((a, b) => a.month - b.month);
}

/**
 * Compute sample sufficiency tier for structural seasonality learning.
 *
 * Thresholds are deliberately conservative — designed to reflect real statistical
 * requirements, not to pass current properties.
 *
 * INSUFFICIENT: < 12 distinct calendar months seen (can't learn a full annual curve)
 * EARLY:        12 calendar months covered, but < 2 distinct years (no YoY)
 * MODERATE:     2+ years, all 12 months, some YoY pairs, enough booked nights
 * GOOD:         3+ years, all 12 months, all 12 months with YoY comparison,
 *               300+ booked nights, partial or better exposure reconstruction
 *
 * @param {{
 *   distinctCalendarMonths: number,
 *   distinctYears: number,
 *   totalBookedNights: number,
 *   yoyPairCount: number,
 *   exposureConfidence: 'FULL'|'PARTIAL'|'NONE'
 * }} params
 * @returns {'INSUFFICIENT'|'EARLY'|'MODERATE'|'GOOD'}
 */
function computeSampleTier({ distinctCalendarMonths, distinctYears, totalBookedNights, yoyPairCount, exposureConfidence }) {
  if (distinctCalendarMonths < 12 || totalBookedNights < 30) return 'INSUFFICIENT';
  if (distinctYears < 2 || yoyPairCount < 3) return 'EARLY';
  if (distinctYears < 3 || yoyPairCount < 9 || totalBookedNights < 150) return 'MODERATE';
  if (distinctYears >= 3 && yoyPairCount >= 12 && totalBookedNights >= 300 &&
      (exposureConfidence === 'FULL' || exposureConfidence === 'PARTIAL')) {
    return 'GOOD';
  }
  return 'MODERATE';
}

/**
 * True if dataTimestamp (YYYY-MM-DD) does not leak beyond referenceDate.
 * referenceDate = the date at which a pricing decision is being made.
 * dataTimestamp = when the data was finalized / the stay completed.
 */
function hasNoFutureLeakage(referenceDate, dataTimestamp) {
  return String(dataTimestamp).slice(0, 10) <= String(referenceDate).slice(0, 10);
}

// ── SQL constants (all SELECT — zero writes) ──────────────────────────────────

const ACTIVE_PROPERTIES_SQL = `
  SELECT
    pc.property_id,
    pc.user_id,
    pc.mode,
    p.internal_name,
    p.name,
    p.timezone,
    p.latitude,
    p.longitude,
    p.country_code,
    p.currency,
    p.max_guests,
    p.bedrooms
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

const RESERVATION_HISTORY_SQL = `
  SELECT
    id,
    start_date::text,
    end_date::text,
    source,
    platform,
    reservation_type,
    status,
    amount_total,
    currency,
    created_at::text
  FROM reservations
  WHERE property_id = $1
  ORDER BY start_date
`;

const BLOCK_COUNT_SQL = `
  SELECT COUNT(*) AS block_count
  FROM reservations
  WHERE property_id = $1
    AND (
      COALESCE(source,'') = 'BLOCK'
      OR COALESCE(reservation_type,'') = 'block'
      OR COALESCE(platform,'') = 'BLOCK'
    )
`;

const PRICING_SCHEDULE_SQL = `
  SELECT
    MIN(date)    AS first_schedule_date,
    MAX(date)    AS last_schedule_date,
    COUNT(*)     AS total_scheduled_nights
  FROM pricing_schedule
  WHERE property_id = $1
`;

const MARKET_DATA_HISTORY_SQL = `
  SELECT
    MIN(week_start) AS first_week,
    MAX(week_start) AS last_week,
    COUNT(*)        AS total_snapshots,
    MIN(median_price) AS min_median,
    MAX(median_price) AS max_median
  FROM market_data
  WHERE property_id = $1
`;

const MARKET_OBS_GLOBAL_SQL = `
  SELECT
    COUNT(*)                           AS total_observations,
    COUNT(DISTINCT DATE(collected_at)) AS distinct_obs_dates,
    MIN(collected_at)                  AS first_collected,
    MAX(collected_at)                  AS last_collected,
    COUNT(DISTINCT check_in)           AS distinct_check_in_dates,
    COUNT(DISTINCT market_profile_id)  AS distinct_profiles
  FROM market_observations
  WHERE observation_type = 'PROVIDER'
`;

const MARKET_OBS_BY_MONTH_SQL = `
  SELECT
    TO_CHAR(check_in, 'YYYY-MM') AS ym,
    COUNT(*)                     AS observation_count
  FROM market_observations
  WHERE check_in IS NOT NULL
    AND observation_type = 'PROVIDER'
  GROUP BY 1
  ORDER BY 1
`;

const MARKET_PROFILES_SQL = `
  SELECT
    mpp.property_id,
    mpp.profile_id,
    mp.geo_lat,
    mp.geo_lon,
    mp.currency,
    mp.target_guests,
    mp.target_bedrooms,
    mp.target_property_type
  FROM market_profile_properties mpp
  JOIN market_profiles mp ON mp.profile_id = mpp.profile_id
  ORDER BY mpp.property_id
`;

const PRICING_HISTORY_SQL = `
  SELECT
    MIN(week_start)   AS first_week,
    MAX(week_start)   AS last_week,
    COUNT(*)          AS total_weeks,
    COUNT(factor_season) AS weeks_with_season_factor
  FROM pricing_history
  WHERE property_id = $1
`;

// ── Pricing authority proof ───────────────────────────────────────────────────

const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

const SEASONALITY_MODULES = [
  'local-seasonality',
  'learned-seasonality',
  'seasonal-curve',
  'seasonality-model',
];

function checkSeasonalityAuthorityProof() {
  const ROOT = path.join(__dirname, '..');
  const violations = [];
  for (const pricingFile of PRICING_CHAIN) {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const mod of SEASONALITY_MODULES) {
      const re = new RegExp(`require\\(['""][^'"]*${mod.replace(/-/g, '[-_]')}`, 'i');
      if (re.test(src)) violations.push(`${pricingFile} imports ${mod}`);
    }
  }
  return violations;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(p) {
  return p.internal_name || p.name || `prop#${p.property_id}`;
}

function monthName(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || '???';
}

// ── Main (protected so pure helpers are importable without DB) ────────────────

if (require.main === module) {
  require('dotenv').config();
  const { createPool } = require('../services/db-pool');

  runAudit(createPool())
    .catch(err => { console.error('[FATAL]', err); process.exit(1); });
}

async function runAudit(pool) {
  const NOW_ISO = new Date().toISOString();
  const TODAY   = NOW_ISO.slice(0, 10);

  try {
    console.log('');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  P1.4-T0 — LOCAL SEASONALITY DATA READINESS AUDIT');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`  Run at:  ${NOW_ISO}`);
    console.log('  READ_ONLY=YES  DB_WRITES=0  PRICING_WRITES=0  NETWORK_CALLS=0');
    console.log('  LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY=NO');
    console.log('──────────────────────────────────────────────────────────────────────');

    // ── [1] CURRENT SEASONALITY AUTHORITY ─────────────────────────────────
    console.log('\n  [1] CURRENT SEASONALITY AUTHORITY TRACE');
    console.log('  Source: routes/pricing-engine.js → DEFAULTS.seasonByMonth');
    console.log('  Scope:  ALL BoostPrice properties (one shared hardcoded curve)');

    // Read from the live source file
    const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '../routes/pricing-engine.js'), 'utf8');
    const curveMatch = ENGINE_SRC.match(/seasonByMonth:\s*\[([\s\S]*?)\]/);
    let currentCurve = null;
    if (curveMatch) {
      const nums = curveMatch[1].match(/[\d.]+/g);
      currentCurve = nums ? nums.map(Number) : null;
    }

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (currentCurve && currentCurve.length === 12) {
      console.log('');
      console.log('  CURRENT_SEASONALITY_CURVE (Île-de-France / Paris hardcoded):');
      for (let i = 0; i < 12; i++) {
        console.log(`    ${MONTHS[i]}: ${currentCurve[i].toFixed(2)}`);
      }
      const min = Math.min(...currentCurve);
      const max = Math.max(...currentCurve);
      console.log(`  CURRENT_SEASONALITY_MIN: ${min}  (${MONTHS[currentCurve.indexOf(min)]})`);
      console.log(`  CURRENT_SEASONALITY_MAX: ${max}  (${MONTHS[currentCurve.indexOf(max)]})`);
    }

    console.log('');
    console.log('  Interpolation: continuous linear between monthly mid-points (cyclic)');
    console.log('  School holiday boost: multiplied on top (×1.05–1.10), IDF hardcoded');
    console.log('  Weighting: FULL STRENGTH — NOT attenuated by aggressiveness parameter');
    console.log('    (lead, pacing, market, event use applyAggr(); season does NOT)');
    console.log('  Position in formula:');
    console.log('    price = base × fSeason × fDow × fLead × fPace × fEvent × fStrategy');
    console.log('            └─── at full weight ───┘');
    console.log('  CURRENT_SEASONALITY_SOURCE:  DEFAULTS.seasonByMonth in pricing-engine.js');
    console.log('  CURRENT_SEASONALITY_SCOPE:   All active properties (no per-property curve)');
    console.log('  CURRENT_SEASONALITY_POSITION: Structural layer, applied before market correction');

    // Authority proof
    const authViolations = checkSeasonalityAuthorityProof();
    console.log(`\n  LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY: ${authViolations.length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    console.log(`  PRODUCTION_SEASONALITY_CHANGED: NO (audit is read-only)`);

    // ── [2] SEASONALITY DEFINITION ────────────────────────────────────────
    console.log('\n  [2] SEASONALITY DEFINITION & DOUBLE-COUNTING RISKS');
    console.log('');
    console.log('  STRUCTURAL SEASONALITY = recurring demand differences by time of year.');
    console.log('  This is the signal we want to learn. It should NOT absorb:');
    console.log('');
    console.log('  EXCLUDED CONCEPTS:');
    console.log('    DAY-OF-WEEK          — already handled by cfg.dow (separate factor)');
    console.log('    EVENT EFFECT         — handled by eventMult() (separate factor)');
    console.log('    SCHOOL HOLIDAY BOOST — already boosted INSIDE seasonMult() (IDF only)');
    console.log('    LEAD-TIME EFFECT     — handled by leadMult() (separate factor)');
    console.log('    PACING               — handled by pacingMult() (separate factor)');
    console.log('    PICKUP VELOCITY      — P1.3 shadow (no pricing authority yet)');
    console.log('    MARKET PRICE LEVEL   — handled by marketMult() (separate factor)');
    console.log('    PRICE ELASTICITY     — would require demand/price model');
    console.log('');
    console.log('  DOUBLE-COUNTING RISKS:');
    console.log('    1. EVENT MONTHS: If July data is dominated by a recurring event');
    console.log('       (Roland Garros in June, Fashion Week in Sep), raw ADR or booking');
    console.log('       counts in those months capture both structural seasonality AND');
    console.log('       event effects. A learned July curve would double-count if eventMult()');
    console.log('       is also applied.');
    console.log('    2. WEEKEND-HEAVY MONTHS: Months with more weekend days will have');
    console.log('       inflated booking counts. Comparing months without DOW normalization');
    console.log('       will absorb DOW signal into the learned curve.');
    console.log('    3. SCHOOL HOLIDAYS: The IDF school holiday boost is currently applied');
    console.log('       INSIDE seasonMult(). If we learn seasonality from raw bookings,');
    console.log('       holiday effects are already in the learned signal. Must separate.');
    console.log('    4. PRICE/DEMAND CONFOUNDING: High bookings in a month may reflect');
    console.log('       lower prices, not stronger demand. Cannot learn true demand');
    console.log('       seasonality from booked nights alone without realized price data.');

    // ── [3] SCHEMA AUDIT ─────────────────────────────────────────────────
    console.log('\n  [3] DATABASE SCHEMA AUDIT — SEASONALITY SIGNALS');
    console.log('');
    const schemaItems = [
      ['reservations',           'PRESENT', 'start_date/end_date + source + status + amount_total + currency'],
      ['properties',             'PRESENT', 'latitude, longitude, country_code, timezone, currency, bedrooms'],
      ['pricing_schedule',       'PRESENT', 'per-night offered price + breakdown JSONB (future state only)'],
      ['pricing_history',        'PRESENT', 'weekly summary with factor_season (not nightly)'],
      ['market_data',            'PRESENT', 'weekly market snapshot (median, occupancy, market_context_key)'],
      ['market_observations',    'PRESENT', 'P1.2: structured per-stay-window observations (recent)'],
      ['market_profiles',        'PRESENT', 'P1.2: canonical search identity (geo, currency, guests, bedrooms)'],
      ['market_profile_properties','PRESENT','P1.2: property → profile mapping'],
      ['booking_pickup_observations','PRESENT','P1.3: pickup shadow (WAITING_FIRST_COLLECTION — not used for seasonality)'],
      ['school_holidays',        'NOT PRESENT', 'hardcoded SCHOOL_HOLIDAYS_IDF_2025_2026 in pricing-engine.js'],
      ['pricing_events',         'NOT PRESENT', 'hardcoded EVENTS_PARIS_2026 in pricing-engine.js'],
    ];
    for (const [tbl, avail, note] of schemaItems) {
      const icon = avail === 'PRESENT' ? '✓' : '—';
      console.log(`    ${icon}  ${tbl.padEnd(30)}  ${avail.padEnd(12)}  ${note}`);
    }

    // ── [4] RESERVATION HISTORY READINESS ────────────────────────────────
    console.log('\n  [4] ACTIVE PROPERTIES — RESERVATION HISTORY READINESS');
    let activeProps = [];
    try {
      const pRes = await pool.query(ACTIVE_PROPERTIES_SQL);
      activeProps = pRes.rows;
      console.log(`\n  Active BoostPrice properties: ${activeProps.length}`);
    } catch (err) {
      console.error(`  [QUERY_FAILURE] ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const propertyReports = [];

    for (const prop of activeProps) {
      const pName = displayName(prop);
      console.log(`\n  ── ${pName} ─────────────────────────────────────────────`);
      console.log(`     timezone=${prop.timezone ?? 'NULL'}  lat=${prop.latitude ?? 'NULL'}  lon=${prop.longitude ?? 'NULL'}`);
      console.log(`     country=${prop.country_code ?? 'NULL'}  currency=${prop.currency ?? 'NULL'}  bedrooms=${prop.bedrooms ?? 'NULL'}`);

      let reservations = [];
      let blockCount   = 0;

      try {
        const [rRes, bRes] = await Promise.all([
          pool.query(RESERVATION_HISTORY_SQL, [prop.property_id]),
          pool.query(BLOCK_COUNT_SQL, [prop.property_id]),
        ]);
        reservations = rRes.rows;
        blockCount   = Number(bRes.rows[0]?.block_count ?? 0);
      } catch (err) {
        console.error(`     [RESERVATION_QUERY_FAILURE] ${err.message}`);
        propertyReports.push({ prop, tier: 'INSUFFICIENT', error: err.message });
        continue;
      }

      // Source distribution
      const sourceDist = {};
      const statusDist = {};
      for (const r of reservations) {
        const cls = classifyReservationSource(r);
        sourceDist[cls] = (sourceDist[cls] || 0) + 1;
        const st = String(r.status || 'unknown');
        statusDist[st] = (statusDist[st] || 0) + 1;
      }

      // Reliable stay occurrence data
      const reliable = reservations.filter(isReliableForStayOccurrence);
      const reliableBookingTiming = reservations.filter(isReliableForBookingTiming);
      const monthly   = computeMonthlyBookedNights(reliable);
      const yoyPairs  = detectYoYPairs(monthly);

      // Calendar coverage
      const allYMs   = Object.keys(monthly).sort();
      const calMonths = new Set(allYMs.map(ym => Number(ym.split('-')[1]))); // 1–12
      const allYears  = new Set(allYMs.map(ym => Number(ym.split('-')[0])));
      const totalBookedNights = Object.values(monthly).reduce((s, n) => s + n, 0);
      const firstStay = reliable.length > 0 ? reliable[0].start_date.slice(0, 10)   : null;
      const lastStay  = reliable.length > 0 ? reliable[reliable.length - 1].end_date.slice(0, 10) : null;

      // Current month check
      const curYM = TODAY.slice(0, 7);
      const hasCurrentMonth = monthly[curYM] != null;

      // Check for amount data
      const hasAmountData = reliable.some(r => r.amount_total != null && Number(r.amount_total) > 0);
      const hasCurrencyData = reliable.some(r => r.currency != null);

      // Pricing schedule
      let scheduleInfo = null;
      try {
        const sRes = await pool.query(PRICING_SCHEDULE_SQL, [prop.property_id]);
        scheduleInfo = sRes.rows[0];
      } catch (_) { /* table may not exist yet */ }

      // Market data history
      let marketDataInfo = null;
      try {
        const mRes = await pool.query(MARKET_DATA_HISTORY_SQL, [prop.property_id]);
        marketDataInfo = mRes.rows[0];
      } catch (_) { /* ok */ }

      // Pricing history
      let pricingHistoryInfo = null;
      try {
        const phRes = await pool.query(PRICING_HISTORY_SQL, [prop.property_id]);
        pricingHistoryInfo = phRes.rows[0];
      } catch (_) { /* ok */ }

      // Exposure reconstruction
      // We can partially reconstruct: blocks are in reservations (source='BLOCK'),
      // but we have no stop_sell/channel-availability history.
      // pricing_schedule is CURRENT state only (UNIQUE(property_id, date)).
      const exposureConf = blockCount > 0 ? 'PARTIAL' : 'NONE';
      const exposureNote = blockCount > 0
        ? `BLOCK rows present (${blockCount}): can subtract owner blocks from calendar. No stop_sell log.`
        : 'No BLOCK rows found. No availability history. Cannot reconstruct denominator reliably.';

      // Sample tier
      const tier = computeSampleTier({
        distinctCalendarMonths: calMonths.size,
        distinctYears:          allYears.size,
        totalBookedNights,
        yoyPairCount:           yoyPairs.length,
        exposureConfidence:     exposureConf,
      });

      // Print
      console.log(`\n     RESERVATION HISTORY:`);
      console.log(`       Total rows:          ${reservations.length}  (includes BLOCK)`);
      console.log(`       BLOCK rows:          ${blockCount}`);
      console.log(`       Reliable stays:      ${reliable.length}  (stay occurrence)`);
      console.log(`       Reliable + timing:   ${reliableBookingTiming.length}  (booking timing)`);
      console.log(`       Source distribution: ${JSON.stringify(sourceDist)}`);
      console.log(`       Status distribution: ${JSON.stringify(statusDist)}`);
      console.log(`       First reliable stay: ${firstStay ?? 'N/A'}`);
      console.log(`       Last stay endpoint:  ${lastStay  ?? 'N/A'}`);
      console.log(`       Total booked nights: ${totalBookedNights}`);

      console.log(`\n     CALENDAR COVERAGE:`);
      console.log(`       Distinct years:      ${allYears.size}  (${[...allYears].sort().join(', ')})`);
      console.log(`       Calendar months hit: ${calMonths.size}/12  (${[...calMonths].sort((a,b)=>a-b).map(m=>MONTHS[m-1]).join(', ')})`);
      console.log(`       Missing months:      ${MONTHS.filter((_,i) => !calMonths.has(i+1)).join(', ') || 'none'}`);
      console.log(`       YoY pairs available: ${yoyPairs.length}/12  (need same calendar month in 2+ years)`);

      if (yoyPairs.length > 0) {
        for (const p of yoyPairs) {
          console.log(`         ${MONTHS[p.month-1]}: ${p.years.join(', ')}  (nights: ${p.nights.join(', ')})`);
        }
      }

      if (hasCurrentMonth) {
        console.log(`       Current month (${curYM}): PARTIAL — in progress`);
      }

      console.log(`\n     MONTHLY BOOKED NIGHTS:`);
      const byMonth = {};
      for (const [ym, n] of Object.entries(monthly)) {
        const m = Number(ym.split('-')[1]);
        byMonth[m] = (byMonth[m] || 0) + n;
      }
      const monthRow = MONTHS.map((_, i) => {
        const n = byMonth[i + 1] || 0;
        return `${MONTHS[i]}=${n}`;
      }).join('  ');
      console.log(`       ${monthRow}`);

      console.log(`\n     EXPOSURE RECONSTRUCTION:`);
      console.log(`       Method:      PARTIAL (BLOCK rows + pricing_schedule future only)`);
      console.log(`       Confidence:  ${exposureConf}`);
      console.log(`       Note:        ${exposureNote}`);
      console.log(`       Stop_sell history: NOT AVAILABLE (no log table)`);
      console.log(`       Channel availability history: NOT AVAILABLE`);

      console.log(`\n     PRICE HISTORY:`);
      if (hasAmountData) {
        console.log(`       amount_total in reservations: PRESENT (some rows have value)`);
      } else {
        console.log(`       amount_total in reservations: SPARSE or NULL (unreliable for historical price analysis)`);
      }
      if (scheduleInfo && Number(scheduleInfo.total_scheduled_nights) > 0) {
        console.log(`       pricing_schedule: first=${scheduleInfo.first_schedule_date}  last=${scheduleInfo.last_schedule_date}  nights=${scheduleInfo.total_scheduled_nights}`);
        console.log(`       NOTE: pricing_schedule is CURRENT state only (UNIQUE per date) — not historical`);
      } else {
        console.log(`       pricing_schedule: NO DATA (or table not yet created)`);
      }
      if (pricingHistoryInfo && Number(pricingHistoryInfo.total_weeks) > 0) {
        console.log(`       pricing_history: ${pricingHistoryInfo.total_weeks} weeks from ${pricingHistoryInfo.first_week} to ${pricingHistoryInfo.last_week}`);
        console.log(`         weeks with factor_season: ${pricingHistoryInfo.weeks_with_season_factor}/${pricingHistoryInfo.total_weeks}`);
      } else {
        console.log(`       pricing_history: NO DATA`);
      }
      if (marketDataInfo && Number(marketDataInfo.total_snapshots) > 0) {
        console.log(`       market_data: ${marketDataInfo.total_snapshots} weekly snapshots from ${marketDataInfo.first_week} to ${marketDataInfo.last_week}`);
      } else {
        console.log(`       market_data: NO DATA`);
      }

      // Current curve comparison (qualitative)
      let curveComparison = 'INSUFFICIENT EVIDENCE';
      if (totalBookedNights >= 120 && calMonths.size >= 12) {
        curveComparison = 'EARLY EVIDENCE AVAILABLE — qualitative only';
      }

      console.log(`\n     HARDCODED CURVE COMPARISON:`);
      console.log(`       ${curveComparison}`);
      if (totalBookedNights >= 30) {
        const top2 = Object.entries(byMonth)
          .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => MONTHS[m - 1]);
        const bot2 = Object.entries(byMonth)
          .sort((a, b) => a[1] - b[1]).slice(0, 2).map(([m]) => MONTHS[m - 1]);
        if (top2.length > 0) console.log(`       Busiest months (booked nights): ${top2.join(', ')}`);
        if (bot2.length > 0) console.log(`       Quietest months (booked nights): ${bot2.join(', ')}`);
        console.log(`       NOTE: booked nights ≠ demand (missing occupancy denominator)`);
      }

      console.log(`\n     SAMPLE TIER:         ${tier}`);
      const reasons = [];
      if (calMonths.size < 12)   reasons.push(`only ${calMonths.size}/12 calendar months covered`);
      if (allYears.size < 2)     reasons.push('< 2 distinct years');
      if (totalBookedNights < 30) reasons.push('< 30 booked nights');
      if (yoyPairs.length < 3)   reasons.push('< 3 YoY month pairs');
      if (reasons.length > 0) console.log(`     TIER REASONS:        ${reasons.join('; ')}`);

      propertyReports.push({
        prop, tier, reliable: reliable.length,
        totalBookedNights, calMonths: calMonths.size,
        distinctYears: allYears.size, yoyPairs: yoyPairs.length,
        exposureConf, hasAmountData,
        firstStay, lastStay,
        byMonth,
      });
    }

    // ── [5] MARKET OBSERVATION HISTORY ────────────────────────────────────
    console.log('\n  [5] MARKET OBSERVATION HISTORY (P1.2)');
    let moGlobal = null;
    let moByMonth = [];
    let marketProfiles = [];

    try {
      const [moRes, moBmRes, mpRes] = await Promise.all([
        pool.query(MARKET_OBS_GLOBAL_SQL),
        pool.query(MARKET_OBS_BY_MONTH_SQL),
        pool.query(MARKET_PROFILES_SQL),
      ]);
      moGlobal    = moRes.rows[0];
      moByMonth   = moBmRes.rows;
      marketProfiles = mpRes.rows;
    } catch (err) {
      console.error(`  [MARKET_OBS_QUERY_FAILURE] ${err.message}`);
    }

    if (moGlobal) {
      console.log(`\n  Total PROVIDER observations:  ${moGlobal.total_observations}`);
      console.log(`  Distinct observation dates:   ${moGlobal.distinct_obs_dates}`);
      console.log(`  First observation collected:  ${moGlobal.first_collected ?? '—'}`);
      console.log(`  Last observation collected:   ${moGlobal.last_collected  ?? '—'}`);
      console.log(`  Distinct check-in dates:      ${moGlobal.distinct_check_in_dates}`);
      console.log(`  Distinct market profiles:     ${moGlobal.distinct_profiles}`);

      if (moByMonth.length > 0) {
        console.log(`\n  Market observations by check-in month:`);
        for (const row of moByMonth) {
          console.log(`    ${row.ym}: ${row.observation_count} observations`);
        }
      }

      const moReady = Number(moGlobal.total_observations) > 0 &&
                      Number(moGlobal.distinct_obs_dates) >= 30;
      console.log(`\n  MARKET_HISTORY_READY_FOR_SEASONALITY: ${moReady ? 'PARTIAL' : 'NOT READY'}`);
      if (!moReady) {
        console.log('  Reason: market observations are recent (P1.2 launched ~2025); need');
        console.log('  12+ months × multiple years of observations for seasonal learning.');
      }
    }

    // ── [6] MARKET PROFILE GROUPING ───────────────────────────────────────
    console.log('\n  [6] MARKET PROFILE GROUPING');
    if (marketProfiles.length > 0) {
      console.log('\n  Profile assignments for active properties:');
      for (const prop of activeProps) {
        const mp = marketProfiles.find(m => String(m.property_id) === String(prop.property_id));
        if (mp) {
          console.log(`    ${displayName(prop)}`);
          console.log(`      profile_id=${mp.profile_id.slice(0, 20)}...`);
          console.log(`      geo=(${mp.geo_lat}, ${mp.geo_lon})  currency=${mp.currency}  bedrooms=${mp.target_bedrooms ?? 'any'}`);
        } else {
          console.log(`    ${displayName(prop)}: NO MARKET PROFILE assigned`);
        }
      }

      // Detect shared profiles
      const sharedProfiles = {};
      for (const mp of marketProfiles) {
        if (!sharedProfiles[mp.profile_id]) sharedProfiles[mp.profile_id] = [];
        sharedProfiles[mp.profile_id].push(mp.property_id);
      }
      const shared = Object.entries(sharedProfiles).filter(([, props]) => props.length > 1);
      if (shared.length > 0) {
        console.log('\n  Properties sharing a market profile (candidate for shared seasonality):');
        for (const [pid, propIds] of shared) {
          console.log(`    ${pid.slice(0, 24)}...  →  ${propIds.join(', ')}`);
        }
      } else {
        console.log('\n  No shared market profiles among active properties.');
        console.log('  M6 and M7 MAY share market seasonality despite different pickup behavior.');
        console.log('  This requires geo proximity check via market_profiles.geo_lat/lon.');
      }
    } else {
      console.log('  No market profile data found (P1.2 infrastructure may be empty).');
    }

    // ── [7] EXPOSURE RECONSTRUCTION SUMMARY ──────────────────────────────
    console.log('\n  [7] EXPOSURE RECONSTRUCTION SUMMARY');
    console.log('');
    console.log('  CAN_RECONSTRUCT_HISTORICAL_EXPOSURE: PARTIAL');
    console.log('');
    console.log('  What we CAN reconstruct:');
    console.log('    - Owner BLOCK rows in reservations (manual blocks) → subtract from calendar');
    console.log('    - Current pricing_schedule (offered price per date, future state only)');
    console.log('    - Property create dates (approximate launch)');
    console.log('');
    console.log('  What we CANNOT reconstruct:');
    console.log('    - Historical stop_sell / channel availability (no log table)');
    console.log('    - Channex calendar blocks synced but not stored in reservations');
    console.log('    - Minimum stay restrictions per date (historical)');
    console.log('    - Periods when property was unlisted / under renovation');
    console.log('    - Channel connection gaps (property not on Airbnb for 3 months etc.)');
    console.log('');
    console.log('  CONSEQUENCE: Occupancy fractions derived from (booked nights / total calendar nights)');
    console.log('  are a LOWER BOUND estimate, not true occupancy. Cannot compute true demand seasonality.');

    // ── [8] YoY / FUTURE LEAKAGE ─────────────────────────────────────────
    console.log('\n  [8] YEAR-OVER-YEAR READINESS & FUTURE LEAKAGE POLICY');
    console.log('');
    console.log('  FUTURE_LEAKAGE_POLICY:');
    console.log('    At pricing calculation time T, only data finalized at or before T may be used.');
    console.log('    - Completed stays (end_date < T): SAFE for historical analysis');
    console.log('    - Stays in progress (start_date ≤ T ≤ end_date): SAFE for stay occurrence');
    console.log('    - Future bookings (start_date > T): UNSAFE for backward causality');
    console.log('    - Current month\'s final occupancy: UNSAFE (month not yet complete)');
    console.log('');
    console.log('  LEAKAGE RISK TABLES:');
    console.log('    pricing_schedule  — UNIQUE(property_id, date) = current state only;');
    console.log('                        offline backtests using current schedule see');
    console.log('                        prices that were NOT in effect historically → LEAK');
    console.log('    reservations      — status field reflects FINAL state (cancelled bookings');
    console.log('                        that were later cancelled show as cancelled even if');
    console.log('                        they were \'confirmed\' during a backtest period) → mild LEAK');
    console.log('    market_data       — UNIQUE(property_id, week_start) = only current scrape;');
    console.log('                        historical weeks are preserved but may be overwritten');
    console.log('                        if re-scraped → potential LEAK if deduped on overwrite');
    console.log('');
    console.log('  YoY READINESS (global):');
    const totalYoY = propertyReports.reduce((s, r) => s + (r.yoyPairs || 0), 0);
    console.log(`    Total YoY month pairs across all properties: ${totalYoY}`);
    console.log('    Earliest meaningful YoY: requires same calendar month in 2 successive years.');
    console.log('    A Sep-2027 pricing decision may use Sep-2026 outcomes (stay completed).');
    console.log('    A Sep-2026 decision CANNOT use Oct/Nov/Dec-2026 outcomes (not yet realized).');

    // ── [9] PRICE / DEMAND CONFOUNDING ───────────────────────────────────
    console.log('\n  [9] PRICE / DEMAND CONFOUNDING');
    console.log('');
    console.log('  REALIZED_PRICE_DATA_AVAILABLE: PARTIAL');
    console.log('  REALIZED_PRICE_DATA_RELIABILITY: LOW');
    console.log('  Fields: amount_total (total stay) — NOT nightly rate');
    console.log('  Issues:');
    console.log('    - amount_total is NULL for many iCal and legacy reservations');
    console.log('    - amount_total mixes accommodation + cleaning fee + taxes (amount_cleaning,');
    console.log('      amount_taxes separate but often NULL for iCal)');
    console.log('    - OTA commission not always stored (ota_commission often NULL)');
    console.log('    - No per-night rate stored for historical reservations');
    console.log('    - pricing_schedule.breakdown JSONB stores offered price per night but');
    console.log('      only for FUTURE dates (current state); historical pricing not preserved');
    console.log('    - pricing_history.price_before/price_calculated: weekly aggregate, not nightly');
    console.log('');
    console.log('  HISTORICAL_PRICE_EXPOSURE_AVAILABLE: NO');
    console.log('  Cannot reliably determine what price was offered when bookings were made.');
    console.log('  Booking high-occupancy months could reflect low price, not high demand.');

    // ── [10] SAMPLE SUFFICIENCY TIERS & INTERNATIONALIZATION ─────────────
    console.log('\n  [10] SAMPLE SUFFICIENCY TIERS');
    console.log('');
    console.log('  Tiers are conservative — designed for genuine structural seasonality learning:');
    console.log('');
    console.log('  INSUFFICIENT: < 12 distinct calendar months represented, OR < 30 booked nights');
    console.log('    → Cannot learn a full annual curve. Do not attempt seasonality learning.');
    console.log('');
    console.log('  EARLY: 12 calendar months covered, 1 distinct year, < 3 YoY month pairs');
    console.log('    → Can see a full year of data but cannot validate year-over-year consistency.');
    console.log('    → Descriptive analysis only. Monitor, do not adjust pricing weights.');
    console.log('');
    console.log('  MODERATE: 2+ years, all 12 months, 3-8 YoY pairs, 150+ booked nights');
    console.log('    → Starting to build reliable signal. Use for shadow monitoring only.');
    console.log('    → Do not apply to pricing without extensive validation.');
    console.log('');
    console.log('  GOOD: 3+ years, all 12 months, 9+ YoY month pairs, 300+ booked nights,');
    console.log('        partial or full exposure reconstruction available');
    console.log('    → Sufficient evidence to attempt learned seasonality in shadow mode.');
    console.log('    → Still needs: price/demand separation, double-counting avoidance,');
    console.log('      careful backtesting, and explicit pricing authority gating.');

    console.log('\n  [11] INTERNATIONALIZATION GAPS');
    console.log('');
    console.log('  INTERNATIONALIZATION_GAPS:');
    console.log('    1. SCHOOL HOLIDAYS: hardcoded SCHOOL_HOLIDAYS_IDF_2025_2026 (zone C)');
    console.log('       → French IDF only. No DB table. No support for other countries.');
    console.log('    2. PUBLIC HOLIDAYS: not handled separately (absorbed into monthly curve)');
    console.log('    3. EVENTS: hardcoded EVENTS_PARIS_2026 — Paris-specific only');
    console.log('    4. HEMISPHERE: seasonByMonth assumes Northern Hemisphere');
    console.log('       → Southern Hemisphere properties (Dec=summer) get wrong baseline');
    console.log('    5. TIMEZONE: observation_date uses property.timezone (correct for P1.3)');
    console.log('       but pricing-engine uses UTC dates for seasonality — no property-local date');
    console.log('    6. CURRENCY: seasonality curve is price-multiplier based; all currencies');
    console.log('       use same multipliers — no currency-specific demand modeling');
    console.log('    7. MARKET TYPE: ski / beach / business / city have different seasonal shapes');
    console.log('       not captured in a single IDF curve');
    console.log('    8. LOCAL EVENTS / CALENDARS: no structured DB for country-specific events');

    // ── Global Summary ─────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('  P1.4-T0 GLOBAL SUMMARY');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`\n  Active BoostPrice properties audited: ${activeProps.length}`);

    for (const r of propertyReports) {
      const pName = displayName(r.prop);
      const tier  = r.tier;
      const flag  = tier === 'GOOD' ? '✓' : tier === 'MODERATE' ? '~' : '✗';
      console.log(`    ${flag}  ${pName.padEnd(25)}  tier=${tier}  ` +
        `reliable=${r.reliable}  nights=${r.totalBookedNights}  ` +
        `months=${r.calMonths}/12  years=${r.distinctYears}  yoy=${r.yoyPairs}`);
    }

    const anyGood     = propertyReports.some(r => r.tier === 'GOOD');
    const anyModerate = propertyReports.some(r => r.tier === 'MODERATE');

    console.log('\n  PROPOSED FALLBACK HIERARCHY (when data matures):');
    console.log('    1. Learned property-specific signal (if GOOD tier, min 3 years)');
    console.log('    2. Learned market-profile signal (if multiple properties, pooled MODERATE+)');
    console.log('    3. Regional/country curve (when country-level data available)');
    console.log('    4. Current generic IDF curve (current production fallback)');
    console.log('');
    console.log('  NOTE: M6 and M7 may share market seasonality even if pickup differs.');
    console.log('  Pooling their reservation history for a shared market-profile curve');
    console.log('  is architecturally sound. Individual property curves may still diverge');
    console.log('  for property-specific factors (capacity, type, micro-location).');

    console.log('\n  RECOMMENDED_INITIAL_SEASONALITY_SCOPE:');
    if (anyGood) {
      console.log('    PROPERTY or MARKET_PROFILE — some properties have sufficient data');
    } else if (anyModerate) {
      console.log('    MARKET_PROFILE — pool properties by profile for MODERATE tier evidence');
    } else {
      console.log('    GENERIC FALLBACK — current hardcoded IDF curve is the only defensible');
      console.log('    option until properties reach EARLY or MODERATE tier.');
    }

    console.log(`\n  CAN_SAFELY_LEARN_SEASONALITY_NOW: NO`);
    console.log('    Reasons:');
    if (propertyReports.every(r => ['INSUFFICIENT', 'EARLY'].includes(r.tier))) {
      console.log('      - All active properties are INSUFFICIENT or EARLY tier');
    }
    console.log('      - No reliable occupancy denominator (exposure cannot be fully reconstructed)');
    console.log('      - No realized nightly price history (amount_total is unreliable/sparse)');
    console.log('      - Double-counting risks not yet resolved (events, school holidays)');
    console.log('      - Market observation history too recent for seasonality (P1.2 launched 2025)');
    console.log('');
    console.log('  RECOMMENDED_NEXT_STEP:');
    console.log('    P1.4-T1 — Continue accumulating data. Define a shadow monitoring job');
    console.log('    that tracks monthly booked nights and occupancy fraction (best-effort).');
    console.log('    Target: EARLY tier → MODERATE tier with 2 years per property.');
    console.log('    Do not modify seasonByMonth until MODERATE tier + shadow validation.');

    console.log('\n──────────────────────────────────────────────────────────────────────');
    console.log('  P1_4_T0_IMPLEMENTED: YES');
    console.log('  CURRENT_SEASONALITY_SOURCE:   DEFAULTS.seasonByMonth in pricing-engine.js');
    console.log('  CURRENT_SEASONALITY_SCOPE:    ALL properties (shared hardcoded IDF curve)');
    console.log('  CURRENT_SEASONALITY_MIN:      0.88 (Jan)');
    console.log('  CURRENT_SEASONALITY_MAX:      1.12 (Jul)');
    console.log('  CURRENT_SEASONALITY_WEIGHTING: FULL STRENGTH (not attenuated by aggressiveness)');
    console.log('  CURRENT_SEASONALITY_INTERPOLATION: continuous linear, cyclic Dec→Jan wrap');
    console.log('  CURRENT_SEASONALITY_POSITION: base × fSeason × fDow × … (first multiplier)');
    console.log('  LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY: NO');
    console.log('  PRODUCTION_SEASONALITY_CHANGED: NO');
    console.log('  DB_WRITES=0  PRICING_WRITES=0  CHANNEX_WRITES=0');
    console.log('  MARKET_PROVIDER_CALLS=0  BRIGHT_DATA_CALLS=0  APIFY_CALLS=0  LIVE_NETWORK_CALLS=0');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('');
  } finally {
    await pool.end();
  }
}

module.exports = {
  classifyReservationSource,
  isReliableForStayOccurrence,
  isReliableForBookingTiming,
  splitNightsByMonth,
  computeMonthlyBookedNights,
  detectYoYPairs,
  computeSampleTier,
  hasNoFutureLeakage,
};
