'use strict';
/**
 * P1.4-T1 — Local Seasonality Helpers
 *
 * Pure functions for classifying reservations and computing seasonality
 * readiness tiers.  No DB dependency — safe to require without a pool.
 *
 * SAFETY:
 *   DB_WRITES             = 0  always
 *   NETWORK_CALLS         = 0  always
 *   PRICING_AUTHORITY     = NO
 *   PRODUCTION_SEASONALITY_CHANGED = NO
 */

// ── Source classification ────────────────────────────────────────────────────

/**
 * Classify a reservation row's source for seasonality analysis.
 *
 * BLOCK = source='BLOCK' | reservation_type='block' | platform='BLOCK'.
 * This covers all known patterns for admin/owner/manual blocks.
 *
 * @param {{ source?: string, reservation_type?: string, platform?: string }} r
 * @returns {'BLOCK'|'ICAL'|'OTA_CONFIRMED'|'DIRECT'|'GUEST_APP'|'UNKNOWN'}
 */
function classifyReservationSource(r) {
  const src  = String(r.source            || '').toUpperCase();
  const rtyp = String(r.reservation_type  || '').toLowerCase();
  const plat = String(r.platform          || '').toUpperCase();
  if (src === 'BLOCK' || rtyp === 'block' || plat === 'BLOCK') return 'BLOCK';
  if (src === 'ICAL')                                           return 'ICAL';
  if (src === 'CHANNEX')                                        return 'OTA_CONFIRMED';
  if (src === 'GUEST_APP')                                      return 'GUEST_APP';
  if (src === 'DIRECT' || plat === 'DIRECT')                    return 'DIRECT';
  return 'UNKNOWN';
}

/**
 * True for reservations reliable as STAY OCCURRENCE data.
 *
 * iCal is included (dates are real stays even if booking-timestamp is a sync time).
 * BLOCK rows and cancelled reservations are excluded.
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
 * True for reservations reliable as BOOKING TIMING data.
 *
 * iCal is excluded — the sync timestamp is the server-side import time,
 * not the actual booking creation time.
 *
 * @param {{ source?: string, reservation_type?: string, platform?: string,
 *            status?: string, start_date?: string, end_date?: string }} r
 * @returns {boolean}
 */
function isReliableForBookingTiming(r) {
  const cls = classifyReservationSource(r);
  return isReliableForStayOccurrence(r) && cls !== 'ICAL';
}

// ── Night accounting ─────────────────────────────────────────────────────────

/**
 * Split a stay into per-calendar-month night counts.
 * end_date is exclusive (checkout day = not a booked night).
 *
 * Handles: leap-year February, year boundaries, same-month stays.
 *
 * @param {string|null} startStr — YYYY-MM-DD check-in date
 * @param {string|null} endStr   — YYYY-MM-DD checkout date (exclusive)
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
    const ym      = cur.toISOString().slice(0, 7);
    const nextMon = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const segEnd  = nextMon < end ? nextMon : end;
    const nights  = Math.round((segEnd - cur) / MS_DAY);
    result[ym]    = (result[ym] || 0) + nights;
    cur = nextMon;
  }
  return result;
}

/**
 * Aggregate reservation rows into monthly booked nights.
 * Only rows where isReliableForStayOccurrence = true are counted.
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
 * Find calendar months (1–12) that have booking data in 2+ distinct years.
 * Returns year-over-year comparison pairs, sorted by calendar month.
 *
 * @param {Object.<string, number>} monthlyBookedNights  { 'YYYY-MM': nights }
 * @returns {{ month: number, years: number[], nights: number[] }[]}
 */
function detectYoYPairs(monthlyBookedNights) {
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
        month:  Number(mon),
        years:  sorted.map(e => e.year),
        nights: sorted.map(e => e.nights),
      });
    }
  }
  return pairs.sort((a, b) => a.month - b.month);
}

// ── Sample tier ──────────────────────────────────────────────────────────────

/**
 * Compute sample sufficiency tier for structural seasonality learning.
 *
 * Thresholds are deliberately conservative.
 *
 *   INSUFFICIENT  < 12 distinct calendar months, OR < 30 booked nights
 *   EARLY         12 months covered, < 2 distinct years, or < 3 YoY pairs
 *   MODERATE      2+ years, all 12 months, 3–8 YoY pairs, 150+ nights
 *   GOOD          3+ years, all 12 months, 12 YoY pairs, 300+ nights,
 *                 partial or full exposure reconstruction
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
  if (distinctYears < 2 || yoyPairCount < 3)                return 'EARLY';
  if (distinctYears < 3 || yoyPairCount < 9 || totalBookedNights < 150) return 'MODERATE';
  if (distinctYears >= 3 && yoyPairCount >= 12 && totalBookedNights >= 300 &&
      (exposureConfidence === 'FULL' || exposureConfidence === 'PARTIAL')) {
    return 'GOOD';
  }
  return 'MODERATE';
}

/**
 * True if dataTimestamp does not leak beyond referenceDate.
 * referenceDate = the date at which a pricing decision is being made.
 * dataTimestamp = when the data was finalized / the stay completed.
 *
 * @param {string} referenceDate  — YYYY-MM-DD
 * @param {string} dataTimestamp  — YYYY-MM-DD
 * @returns {boolean}
 */
function hasNoFutureLeakage(referenceDate, dataTimestamp) {
  return String(dataTimestamp).slice(0, 10) <= String(referenceDate).slice(0, 10);
}

// ── Snapshot aggregation ─────────────────────────────────────────────────────

/**
 * Compute a complete readiness snapshot for one property from its reservation rows.
 * Pure: no DB calls.  Suitable for unit testing without a database.
 *
 * reservations are raw DB rows: { start_date, end_date, source, reservation_type,
 * platform, status, ... }
 *
 * @param {Array<object>} reservations
 * @param {string} _today — YYYY-MM-DD (reserved for future partial-month exclusion)
 * @returns {{
 *   tier: 'INSUFFICIENT'|'EARLY'|'MODERATE'|'GOOD',
 *   distinctCalendarMonths: number,
 *   distinctYears: number,
 *   totalBookedNights: number,
 *   yoyPairCount: number,
 *   exposureConfidence: 'FULL'|'PARTIAL'|'NONE',
 *   firstStayDate: string|null,
 *   lastStayDate:  string|null,
 *   monthlyNights: Object.<string, number>,
 *   blockCount: number,
 * }}
 */
function computePropertyReadinessSnapshot(reservations, _today) {
  const reliable = reservations
    .filter(isReliableForStayOccurrence)
    .sort((a, b) => String(a.start_date).slice(0, 10).localeCompare(String(b.start_date).slice(0, 10)));
  const monthly  = computeMonthlyBookedNights(reliable);
  const yoyPairs = detectYoYPairs(monthly);

  const allYMs    = Object.keys(monthly).sort();
  const calMonths = new Set(allYMs.map(ym => Number(ym.split('-')[1])));
  const allYears  = new Set(allYMs.map(ym => Number(ym.split('-')[0])));
  const totalBookedNights = Object.values(monthly).reduce((s, n) => s + n, 0);

  const blockCount = reservations.filter(r => classifyReservationSource(r) === 'BLOCK').length;
  const exposureConfidence = blockCount > 0 ? 'PARTIAL' : 'NONE';

  const firstStayDate = reliable.length > 0
    ? String(reliable[0].start_date).slice(0, 10)
    : null;
  const lastStayDate = reliable.length > 0
    ? String(reliable[reliable.length - 1].end_date).slice(0, 10)
    : null;

  const tier = computeSampleTier({
    distinctCalendarMonths: calMonths.size,
    distinctYears:          allYears.size,
    totalBookedNights,
    yoyPairCount:           yoyPairs.length,
    exposureConfidence,
  });

  return {
    tier,
    distinctCalendarMonths: calMonths.size,
    distinctYears:          allYears.size,
    totalBookedNights,
    yoyPairCount:           yoyPairs.length,
    exposureConfidence,
    firstStayDate,
    lastStayDate,
    monthlyNights: monthly,
    blockCount,
  };
}

// ── Generic seasonality curve (IDF reference — informational only) ────────────

// Mirror of pricing-engine.js DEFAULTS.seasonByMonth.
// Stored here as a reference so target-month observations can record
// what the generic curve says about that month.
// AUTHORITY: NONE — never read by pricing-engine as an alternative source.
const SEASON_BY_MONTH = [
  0.88, // Jan
  0.90, // Fév
  0.94, // Mar
  1.00, // Avr
  1.06, // Mai
  1.10, // Juin
  1.12, // Juil
  1.08, // Août
  1.10, // Sep
  1.02, // Oct
  0.90, // Nov
  0.96, // Déc
];

/**
 * Return the generic IDF seasonality reference factor for a calendar month.
 * Informational only — NOT a pricing authority.
 *
 * @param {string} targetMonthStr — 'YYYY-MM-01'
 * @returns {number|null}
 */
function computeGenericSeasonalityFactor(targetMonthStr) {
  const month0 = Number(String(targetMonthStr).slice(5, 7)) - 1; // 0-indexed
  return Number.isInteger(month0) && month0 >= 0 && month0 <= 11
    ? SEASON_BY_MONTH[month0]
    : null;
}

// ── Horizon constant ──────────────────────────────────────────────────────────

// Rationale: current month + 8 forward = 9 target months per collection.
//   Month+6 is first observed ≈180 days before its start → captures D180.
//   Month+8 is first observed ≈240 days before its start → good buffer for D180+.
//   12 months would add D360 at marginal storage cost, but 9 is the principled
//   minimum to guarantee the full D7/D14/D30/D60/D90/D120/D180 ladder.
const HORIZON_MONTHS = 9;

// ── Property-local date ───────────────────────────────────────────────────────

/**
 * Convert a UTC wall-clock timestamp to the property's local calendar date.
 * Uses the Intl API (no external deps).  Falls back to UTC when timezone is
 * null, empty, or unrecognised.
 *
 * @param {string|Date} isoTimestampOrDate
 * @param {string|null|undefined} timezone — IANA tz string e.g. 'Europe/Paris'
 * @returns {string} — YYYY-MM-DD in the property's local timezone
 */
function propertyLocalDate(isoTimestampOrDate, timezone) {
  const dt = isoTimestampOrDate instanceof Date
    ? isoTimestampOrDate
    : new Date(isoTimestampOrDate);
  if (!timezone) return dt.toISOString().slice(0, 10);
  try {
    // sv-SE locale produces YYYY-MM-DD output reliably
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(dt);
  } catch (_) {
    return dt.toISOString().slice(0, 10); // UTC fallback for invalid tz
  }
}

// ── Target month generation ───────────────────────────────────────────────────

/**
 * Generate a list of target-month start dates (YYYY-MM-01) beginning with
 * the calendar month containing localTodayStr and extending horizonMonths forward.
 *
 * Safe across December → January boundaries; uses UTC calendar arithmetic.
 *
 * @param {string} localTodayStr — YYYY-MM-DD property-local today
 * @param {number} horizonMonths — total months to generate (default HORIZON_MONTHS)
 * @returns {string[]} — array of 'YYYY-MM-01' strings, length = horizonMonths
 */
function generateTargetMonths(localTodayStr, horizonMonths) {
  const [yr, mon] = String(localTodayStr).split('-').map(Number);
  const months = [];
  for (let i = 0; i < horizonMonths; i++) {
    // Date.UTC handles month overflow: month 12 becomes month 0 of next year
    const d = new Date(Date.UTC(yr, mon - 1 + i, 1));
    months.push(d.toISOString().slice(0, 10)); // 'YYYY-MM-01'
  }
  return months;
}

// ── Month calendar info ───────────────────────────────────────────────────────

/**
 * Compute calendar metadata for a target month relative to an observation date.
 *
 * @param {string} targetMonthStr   — 'YYYY-MM-01'
 * @param {string} observationDateStr — 'YYYY-MM-DD'
 * @returns {{
 *   calendarNights: number,
 *   elapsedCalendarNights: number,
 *   remainingCalendarNights: number,
 *   daysUntilMonthStart: number,   — positive=future, 0=today, negative=started
 *   monthComplete: boolean,
 * }}
 */
function computeMonthCalendarInfo(targetMonthStr, observationDateStr) {
  const MS_DAY   = 86400000;
  const mStart   = new Date(String(targetMonthStr).slice(0, 10)     + 'T00:00:00Z');
  const yr       = mStart.getUTCFullYear();
  const mon      = mStart.getUTCMonth(); // 0-indexed
  const mEnd     = new Date(Date.UTC(yr, mon + 1, 1));
  const calNights = Math.round((mEnd - mStart) / MS_DAY);

  const obsDate  = new Date(String(observationDateStr).slice(0, 10) + 'T00:00:00Z');
  const daysUntilMonthStart = Math.round((mStart - obsDate) / MS_DAY);

  let elapsed;
  if (obsDate <= mStart)     elapsed = 0;
  else if (obsDate >= mEnd)  elapsed = calNights;
  else                       elapsed = Math.round((obsDate - mStart) / MS_DAY);

  return {
    calendarNights:           calNights,
    elapsedCalendarNights:    elapsed,
    remainingCalendarNights:  calNights - elapsed,
    daysUntilMonthStart,
    monthComplete:            obsDate >= mEnd,
  };
}

// ── Target-month booking evidence ────────────────────────────────────────────

/**
 * Compute booking evidence for a single target month from the property's
 * full reservation history.
 *
 * Rules:
 *   - Checkout date is exclusive (not a booked night).
 *   - BLOCK rows contribute to knownBlockedNights, not bookedNights.
 *   - Cancelled reservations are excluded entirely.
 *   - UNKNOWN source is treated as a bookable stay (not a block).
 *
 * @param {Array<object>} reservations — all rows from the reservations table
 * @param {string} targetMonthStr — 'YYYY-MM-01'
 * @returns {{
 *   bookedNights: number,
 *   knownBlockedNights: number,
 *   reliableReservationCount: number,
 *   sourceDistribution: Object.<string, number>,
 * }}
 */
function computeTargetMonthBookings(reservations, targetMonthStr) {
  const targetYM = String(targetMonthStr).slice(0, 7); // 'YYYY-MM'
  let bookedNights = 0;
  let knownBlockedNights = 0;
  let reliableReservationCount = 0;
  const sourceDistribution = {};

  for (const r of reservations) {
    const status = String(r.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled') continue;
    if (!r.start_date || !r.end_date) continue;

    const split = splitNightsByMonth(
      String(r.start_date).slice(0, 10),
      String(r.end_date).slice(0, 10),
    );
    const nightsInMonth = split[targetYM] || 0;
    if (!nightsInMonth) continue;

    const cls = classifyReservationSource(r);
    if (cls === 'BLOCK') {
      knownBlockedNights += nightsInMonth;
    } else {
      bookedNights += nightsInMonth;
      reliableReservationCount++;
      sourceDistribution[cls] = (sourceDistribution[cls] || 0) + 1;
    }
  }

  return { bookedNights, knownBlockedNights, reliableReservationCount, sourceDistribution };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // ── Existing helpers (used by T0 audit + T1 shadow) ──────────────────────
  classifyReservationSource,
  isReliableForStayOccurrence,
  isReliableForBookingTiming,
  splitNightsByMonth,
  computeMonthlyBookedNights,
  detectYoYPairs,
  computeSampleTier,
  hasNoFutureLeakage,
  computePropertyReadinessSnapshot,
  // ── T1-FIX helpers ───────────────────────────────────────────────────────
  SEASON_BY_MONTH,
  HORIZON_MONTHS,
  computeGenericSeasonalityFactor,
  propertyLocalDate,
  generateTargetMonths,
  computeMonthCalendarInfo,
  computeTargetMonthBookings,
};
