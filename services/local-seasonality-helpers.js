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

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  classifyReservationSource,
  isReliableForStayOccurrence,
  isReliableForBookingTiming,
  splitNightsByMonth,
  computeMonthlyBookedNights,
  detectYoYPairs,
  computeSampleTier,
  hasNoFutureLeakage,
  computePropertyReadinessSnapshot,
};
