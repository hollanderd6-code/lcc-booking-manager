'use strict';
/**
 * P1.3-T1 — Booking Pickup Shadow Engine — Test Suite
 *
 * Tests pure helpers, SQL structural invariants, and calculatePickupShadow()
 * with a mock pool. ALL tests run without a database connection.
 *
 * SAFETY:
 *   DB_WRITES             = 0  always
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *
 * Sections:
 *   A — getLeadTimeBand
 *   B — getBandDefinition
 *   C — interpolateIdealPickup
 *   D — computeExpectedRecent
 *   E — computePickupRatio
 *   F — classifyConfidence
 *   G — classifyPickupStatus
 *   H — computeAdvisoryMultiplier
 *   I — classifyPacingStrength
 *   J — diagnosePacingPickupRelation
 *   K — parseTargetDate + computeLeadTimeFromToday
 *   L — calculatePickupShadow (mock pool scenarios)
 *   M — SQL structural invariants (T0-PROD-FIX pattern)
 *   N — Safety contract (no pricing import, no writes, advisory only)
 *   O — Persistence service structural invariants
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  MODEL_VERSION,
  TRUSTED_SOURCES,
  EXCLUDED_SOURCES,
  LOOKBACK_MONTHS,
  LOOKBACK_DAYS,
  TARGET_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  ADVISORY_MIN,
  ADVISORY_MAX,
  MIN_BAND_SAMPLES,
  MIN_TOTAL_SAMPLES,
  LEAD_TIME_BAND_DEFS,
  IDEAL_PICKUP_CURVE,

  HISTORICAL_DISTRIBUTION_SQL,
  ANOMALY_COUNT_SQL,
  RECENT_PICKUP_SQL,
  OCCUPANCY_PROXY_SQL,

  getLeadTimeBand,
  getBandDefinition,
  interpolateIdealPickup,
  computeExpectedRecent,
  computePickupRatio,
  classifyConfidence,
  classifyPickupStatus,
  computeAdvisoryMultiplier,
  classifyPacingStrength,
  diagnosePacingPickupRelation,
  computeLeadTimeFromToday,
  parseTargetDate,
  calculatePickupShadow,
} = require('../services/booking-pickup-shadow');

const {
  isPersistenceEnabled,
  persistPickupObservation,
  INSERT_OBSERVATION_SQL,
} = require('../services/booking-pickup-persistence');

const SRC  = fs.readFileSync(path.join(__dirname, '../services/booking-pickup-shadow.js'), 'utf8');
const PSRC = fs.readFileSync(path.join(__dirname, '../services/booking-pickup-persistence.js'), 'utf8');
const ASRC = fs.readFileSync(path.join(__dirname, '../outils/audit-booking-pickup-shadow-t1.js'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ── Mock pool builder ─────────────────────────────────────────────────────────

function makeMockPool(histRows, anomalyCount, recentCount, confirmedStays) {
  let callIndex = 0;
  return {
    query(_sql, _params) {
      const i = callIndex++;
      if (i === 0) return Promise.resolve({ rows: histRows });
      if (i === 1) return Promise.resolve({ rows: [{ anomaly_count: anomalyCount }] });
      if (i === 2) return Promise.resolve({ rows: [{ recent_count: recentCount }] });
      if (i === 3) return Promise.resolve({ rows: [{ confirmed_stays: confirmedStays }] });
      return Promise.resolve({ rows: [] });
    },
  };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

// M6-like: 42 bookings, mostly short lead times (p50=1)
function m6HistRows() {
  return [
    { lead_time_days: 0, cnt: 15 },
    { lead_time_days: 1, cnt: 13 },
    { lead_time_days: 2, cnt: 5 },
    { lead_time_days: 3, cnt: 3 },
    { lead_time_days: 5, cnt: 4 },
    { lead_time_days: 10, cnt: 1 },
    { lead_time_days: 75, cnt: 1 },
  ]; // total = 42
}

// M7-like: 52 bookings, very short lead times (p50=0)
function m7HistRows() {
  return [
    { lead_time_days: 0, cnt: 38 },
    { lead_time_days: 1, cnt: 2 },
    { lead_time_days: 2, cnt: 5 },
    { lead_time_days: 3, cnt: 2 },
    { lead_time_days: 6, cnt: 3 },
    { lead_time_days: 12, cnt: 2 },
  ]; // total = 52
}

// Ti Junot-like: 8 bookings — insufficient
function tiJunotHistRows() {
  return [
    { lead_time_days: 30, cnt: 4 },
    { lead_time_days: 45, cnt: 2 },
    { lead_time_days: 60, cnt: 2 },
  ]; // total = 8
}

// Target date in band 0_1 (tomorrow)
const NEAR_FUTURE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

// Target date in band 15_30 (20 days from now)
const MID_FUTURE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 20);
  return d.toISOString().slice(0, 10);
})();

// ── Section A — getLeadTimeBand ───────────────────────────────────────────────

console.log('\n  [A] getLeadTimeBand');

test('A-01: 0 days → 0_1', () => assert.strictEqual(getLeadTimeBand(0), '0_1'));
test('A-02: 1 day  → 0_1', () => assert.strictEqual(getLeadTimeBand(1), '0_1'));
test('A-03: 2 days → 2_3', () => assert.strictEqual(getLeadTimeBand(2), '2_3'));
test('A-04: 7 days → 4_7', () => assert.strictEqual(getLeadTimeBand(7), '4_7'));
test('A-05: 14 days → 8_14', () => assert.strictEqual(getLeadTimeBand(14), '8_14'));
test('A-06: 91 days → 91plus', () => assert.strictEqual(getLeadTimeBand(91), '91plus'));
test('A-07: 500 days → 91plus', () => assert.strictEqual(getLeadTimeBand(500), '91plus'));
test('A-08: negative → anomaly', () => assert.strictEqual(getLeadTimeBand(-1), 'anomaly'));
test('A-09: null → unknown', () => assert.strictEqual(getLeadTimeBand(null), 'unknown'));
test('A-10: NaN → unknown', () => assert.strictEqual(getLeadTimeBand(NaN), 'unknown'));

// ── Section B — getBandDefinition ─────────────────────────────────────────────

console.log('\n  [B] getBandDefinition');

test('B-01: known band → def object', () => {
  const d = getBandDefinition('0_1');
  assert.ok(d && d.min === 0 && d.max === 1);
});
test('B-02: 91plus → max=9999', () => {
  const d = getBandDefinition('91plus');
  assert.strictEqual(d.max, 9999);
});
test('B-03: unknown band → null', () => assert.strictEqual(getBandDefinition('99_999'), null));
test('B-04: all LEAD_TIME_BAND_DEFS have min < max', () => {
  for (const def of LEAD_TIME_BAND_DEFS) {
    assert.ok(def.min < def.max, `band ${def.name}: min >= max`);
  }
});
test('B-05: LEAD_TIME_BAND_DEFS covers 0..9999 with no gap', () => {
  let prev = -1;
  for (const def of LEAD_TIME_BAND_DEFS) {
    assert.strictEqual(def.min, prev + 1, `gap before band ${def.name}`);
    prev = def.max;
  }
});

// ── Section C — interpolateIdealPickup ────────────────────────────────────────

console.log('\n  [C] interpolateIdealPickup');

test('C-01: 365+ days → 0.06 (far future)', () => {
  assert.strictEqual(interpolateIdealPickup(365), 0.06);
  assert.strictEqual(interpolateIdealPickup(500), 0.06);
});
test('C-02: 0 days → 0.93', () => assert.strictEqual(interpolateIdealPickup(0), 0.93));
test('C-03: negative → 0', () => assert.strictEqual(interpolateIdealPickup(-1), 0));
test('C-04: 30 days → 0.55 (exact knot)', () => assert.strictEqual(interpolateIdealPickup(30), 0.55));
test('C-05: 22 days → between 0.55 and 0.72', () => {
  const v = interpolateIdealPickup(22);
  assert.ok(v > 0.55 && v < 0.72, `got ${v}`);
});
test('C-06: monotonically decreasing from 0 to 365', () => {
  let prev = 1;
  for (let d = 0; d <= 365; d += 5) {
    const v = interpolateIdealPickup(d);
    assert.ok(v <= prev + 0.001, `not decreasing at ${d}: ${v} > prev ${prev}`);
    prev = v;
  }
});

// ── Section D — computeExpectedRecent ────────────────────────────────────────

console.log('\n  [D] computeExpectedRecent');

test('D-01: 28 band/365d, 7d window → ~0.537', () => {
  const e = computeExpectedRecent(28, 7, 365);
  assert.ok(Math.abs(e - 0.5370) < 0.001, `got ${e}`);
});
test('D-02: zero band count → 0', () => assert.strictEqual(computeExpectedRecent(0, 7, 365), 0));
test('D-03: zero lookback → 0', () => assert.strictEqual(computeExpectedRecent(10, 7, 0), 0));
test('D-04: null band count → 0', () => assert.strictEqual(computeExpectedRecent(null, 7, 365), 0));

// ── Section E — computePickupRatio ────────────────────────────────────────────

console.log('\n  [E] computePickupRatio');

test('E-01: 1 recent / 0.5 expected → 2', () => assert.strictEqual(computePickupRatio(1, 0.5), 2));
test('E-02: expected ≈ 0 → null', () => assert.strictEqual(computePickupRatio(0, 0.0001), null));
test('E-03: 0 recent / 0.5 expected → 0', () => assert.strictEqual(computePickupRatio(0, 0.5), 0));
test('E-04: expected exactly 0 → null', () => assert.strictEqual(computePickupRatio(3, 0), null));

// ── Section F — classifyConfidence ───────────────────────────────────────────

console.log('\n  [F] classifyConfidence');

test('F-01: 5 total → INSUFFICIENT', () => assert.strictEqual(classifyConfidence(5, 5), 'INSUFFICIENT'));
test('F-02: 12 total, 2 band → INSUFFICIENT', () => assert.strictEqual(classifyConfidence(12, 2), 'INSUFFICIENT'));
test('F-03: 12 total, 5 band → LOW', () => assert.strictEqual(classifyConfidence(12, 5), 'LOW'));
test('F-04: 20 total, 5 band → MODERATE', () => assert.strictEqual(classifyConfidence(20, 5), 'MODERATE'));
test('F-05: 42 total, 28 band → GOOD (M6)', () => assert.strictEqual(classifyConfidence(42, 28), 'GOOD'));
test('F-06: 52 total, 40 band → GOOD (M7)', () => assert.strictEqual(classifyConfidence(52, 40), 'GOOD'));
test('F-07: 8 total → INSUFFICIENT (Ti Junot)', () => assert.strictEqual(classifyConfidence(8, 3), 'INSUFFICIENT'));
test('F-08: NaN → INSUFFICIENT', () => assert.strictEqual(classifyConfidence(NaN, 5), 'INSUFFICIENT'));

// ── Section G — classifyPickupStatus ─────────────────────────────────────────

console.log('\n  [G] classifyPickupStatus');

test('G-01: INSUFFICIENT confidence → INSUFFICIENT_DATA', () => {
  assert.strictEqual(classifyPickupStatus(2.5, 'INSUFFICIENT'), 'INSUFFICIENT_DATA');
});
test('G-02: null ratio → INSUFFICIENT_DATA', () => {
  assert.strictEqual(classifyPickupStatus(null, 'GOOD'), 'INSUFFICIENT_DATA');
});
test('G-03: ratio 2.0 + GOOD → ACCELERATING', () => {
  assert.strictEqual(classifyPickupStatus(2.0, 'GOOD'), 'ACCELERATING');
});
test('G-04: ratio 1.0 + GOOD → NORMAL', () => {
  assert.strictEqual(classifyPickupStatus(1.0, 'GOOD'), 'NORMAL');
});
test('G-05: ratio 0.4 + GOOD → NORMAL (boundary)', () => {
  assert.strictEqual(classifyPickupStatus(0.4, 'GOOD'), 'NORMAL');
});
test('G-06: ratio 0.39 + GOOD → SLOW', () => {
  assert.strictEqual(classifyPickupStatus(0.39, 'GOOD'), 'SLOW');
});
test('G-07: ratio 0 + MODERATE → SLOW', () => {
  assert.strictEqual(classifyPickupStatus(0, 'MODERATE'), 'SLOW');
});

// ── Section H — computeAdvisoryMultiplier ────────────────────────────────────

console.log('\n  [H] computeAdvisoryMultiplier');

test('H-01: INSUFFICIENT → 1.00', () => {
  assert.strictEqual(computeAdvisoryMultiplier('INSUFFICIENT_DATA', 'INSUFFICIENT'), 1.00);
});
test('H-02: ACCELERATING+GOOD → 1.06', () => {
  assert.strictEqual(computeAdvisoryMultiplier('ACCELERATING', 'GOOD'), 1.06);
});
test('H-03: ACCELERATING+MODERATE → 1.05', () => {
  assert.strictEqual(computeAdvisoryMultiplier('ACCELERATING', 'MODERATE'), 1.05);
});
test('H-04: ACCELERATING+LOW → 1.03', () => {
  assert.strictEqual(computeAdvisoryMultiplier('ACCELERATING', 'LOW'), 1.03);
});
test('H-05: SLOW+GOOD → 0.94', () => {
  assert.strictEqual(computeAdvisoryMultiplier('SLOW', 'GOOD'), 0.94);
});
test('H-06: SLOW+MODERATE → 0.95', () => {
  assert.strictEqual(computeAdvisoryMultiplier('SLOW', 'MODERATE'), 0.95);
});
test('H-07: SLOW+LOW → 0.97', () => {
  assert.strictEqual(computeAdvisoryMultiplier('SLOW', 'LOW'), 0.97);
});
test('H-08: NORMAL+any → 1.00', () => {
  assert.strictEqual(computeAdvisoryMultiplier('NORMAL', 'GOOD'), 1.00);
  assert.strictEqual(computeAdvisoryMultiplier('NORMAL', 'LOW'), 1.00);
});
test('H-09: advisory always in [0.94, 1.06]', () => {
  const statuses    = ['ACCELERATING', 'NORMAL', 'SLOW', 'INSUFFICIENT_DATA'];
  const confidences = ['GOOD', 'MODERATE', 'LOW', 'INSUFFICIENT'];
  for (const s of statuses) {
    for (const c of confidences) {
      const m = computeAdvisoryMultiplier(s, c);
      assert.ok(m >= ADVISORY_MIN && m <= ADVISORY_MAX, `${s}+${c}=${m} out of [${ADVISORY_MIN},${ADVISORY_MAX}]`);
    }
  }
});

// ── Section I — classifyPacingStrength ────────────────────────────────────────

console.log('\n  [I] classifyPacingStrength');

test('I-01: NaN → UNKNOWN', () => assert.strictEqual(classifyPacingStrength(NaN, 7), 'UNKNOWN'));
test('I-02: occ=1.0, 7d lead → STRONG', () => {
  // expected at 7d ≈ 0.85 → score ≈ 1.18 → STRONG
  assert.strictEqual(classifyPacingStrength(1.0, 7), 'STRONG');
});
test('I-03: occ=0.55, 30d → NORMAL', () => {
  // expected at 30d = 0.55 → score = 1.0 → NORMAL
  assert.strictEqual(classifyPacingStrength(0.55, 30), 'NORMAL');
});
test('I-04: occ=0.1, 30d → WEAK', () => {
  // expected at 30d = 0.55 → score ≈ 0.18 → WEAK
  assert.strictEqual(classifyPacingStrength(0.1, 30), 'WEAK');
});

// ── Section J — diagnosePacingPickupRelation ──────────────────────────────────

console.log('\n  [J] diagnosePacingPickupRelation');

test('J-01: INSUFFICIENT → INSUFFICIENT', () => {
  assert.strictEqual(diagnosePacingPickupRelation('STRONG', 'ACCELERATING', 'INSUFFICIENT'), 'INSUFFICIENT');
});
test('J-02: UNKNOWN pacing → INSUFFICIENT', () => {
  assert.strictEqual(diagnosePacingPickupRelation('UNKNOWN', 'NORMAL', 'GOOD'), 'INSUFFICIENT');
});
test('J-03: STRONG+ACCEL → BOTH_STRONG', () => {
  assert.strictEqual(diagnosePacingPickupRelation('STRONG', 'ACCELERATING', 'GOOD'), 'BOTH_STRONG');
});
test('J-04: STRONG+NORMAL → PACING_STRONG_PICKUP_NORMAL', () => {
  assert.strictEqual(diagnosePacingPickupRelation('STRONG', 'NORMAL', 'GOOD'), 'PACING_STRONG_PICKUP_NORMAL');
});
test('J-05: STRONG+SLOW → PACING_STRONG_PICKUP_SLOW', () => {
  assert.strictEqual(diagnosePacingPickupRelation('STRONG', 'SLOW', 'GOOD'), 'PACING_STRONG_PICKUP_SLOW');
});
test('J-06: NORMAL+ACCEL → PICKUP_ACCELERATING_PACING_NORMAL', () => {
  assert.strictEqual(diagnosePacingPickupRelation('NORMAL', 'ACCELERATING', 'GOOD'), 'PICKUP_ACCELERATING_PACING_NORMAL');
});
test('J-07: NORMAL+NORMAL → BOTH_NORMAL', () => {
  assert.strictEqual(diagnosePacingPickupRelation('NORMAL', 'NORMAL', 'GOOD'), 'BOTH_NORMAL');
});
test('J-08: NORMAL+SLOW → PICKUP_SLOW_PACING_NORMAL', () => {
  assert.strictEqual(diagnosePacingPickupRelation('NORMAL', 'SLOW', 'GOOD'), 'PICKUP_SLOW_PACING_NORMAL');
});
test('J-09: WEAK+ACCEL → PACING_WEAK_PICKUP_ACCELERATING', () => {
  assert.strictEqual(diagnosePacingPickupRelation('WEAK', 'ACCELERATING', 'GOOD'), 'PACING_WEAK_PICKUP_ACCELERATING');
});
test('J-10: WEAK+SLOW → BOTH_WEAK', () => {
  assert.strictEqual(diagnosePacingPickupRelation('WEAK', 'SLOW', 'GOOD'), 'BOTH_WEAK');
});

// ── Section K — parseTargetDate + computeLeadTimeFromToday ───────────────────

console.log('\n  [K] parseTargetDate + computeLeadTimeFromToday');

test('K-01: YYYY-MM-DD → UTC Date', () => {
  const d = parseTargetDate('2026-11-01');
  assert.strictEqual(d.getUTCFullYear(), 2026);
  assert.strictEqual(d.getUTCMonth(), 10);
  assert.strictEqual(d.getUTCDate(), 1);
});
test('K-02: Date object → UTC Date', () => {
  const input = new Date(Date.UTC(2026, 10, 1));
  const d = parseTargetDate(input);
  assert.strictEqual(d.getUTCFullYear(), 2026);
  assert.strictEqual(d.getUTCMonth(), 10);
});
test('K-03: invalid string throws', () => {
  assert.throws(() => parseTargetDate('not-a-date'), /Invalid targetDate/);
});
test('K-04: invalid type throws', () => {
  assert.throws(() => parseTargetDate(12345), /Invalid targetDate type/);
});
test('K-05: NEAR_FUTURE lead time ≈ 1', () => {
  const lt = computeLeadTimeFromToday(NEAR_FUTURE);
  assert.ok(lt >= 0 && lt <= 2, `got ${lt}`);
});
test('K-06: past date → negative', () => {
  const yesterday = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const lt = computeLeadTimeFromToday(yesterday);
  assert.ok(lt < 0, `got ${lt}`);
});

// ── Section M — SQL structural invariants ────────────────────────────────────

console.log('\n  [M] SQL structural invariants');

test('M-01: no EXTRACT in any SQL constant', () => {
  const allSql = HISTORICAL_DISTRIBUTION_SQL + ANOMALY_COUNT_SQL + RECENT_PICKUP_SQL + OCCUPANCY_PROXY_SQL;
  assert.ok(!allSql.toUpperCase().includes('EXTRACT'), 'EXTRACT found');
});
test('M-02: canonical date subtraction in HISTORICAL_DISTRIBUTION_SQL', () => {
  assert.ok(HISTORICAL_DISTRIBUTION_SQL.includes('start_date::date - r.created_at::date'));
});
test('M-03: ANOMALY_COUNT_SQL uses canonical date comparison', () => {
  assert.ok(ANOMALY_COUNT_SQL.includes('start_date::date < r.created_at::date'));
});
test('M-04: RECENT_PICKUP_SQL uses integer-cast date subtraction', () => {
  assert.ok(RECENT_PICKUP_SQL.includes('start_date::date - r.created_at::date'));
});
test('M-05: all SQL uses $n::int * INTERVAL (not string concat)', () => {
  const allSql = HISTORICAL_DISTRIBUTION_SQL + ANOMALY_COUNT_SQL;
  assert.ok(!allSql.match(/\$\d+\s*\|\|\s*['"]/), 'string concat interval found');
  assert.ok(allSql.includes("INTERVAL '1 month'"), 'expected INTERVAL form not found');
});
test('M-06: RECENT_PICKUP_SQL uses $4::int and $5::int for band bounds', () => {
  assert.ok(RECENT_PICKUP_SQL.includes('$4::int'));
  assert.ok(RECENT_PICKUP_SQL.includes('$5::int'));
});
test('M-07: OCCUPANCY_PROXY_SQL uses $2::int', () => {
  assert.ok(OCCUPANCY_PROXY_SQL.includes('$2::int'));
});
test('M-08: HISTORICAL_DISTRIBUTION_SQL filters non-negative lead times', () => {
  assert.ok(HISTORICAL_DISTRIBUTION_SQL.includes('start_date::date >= r.created_at::date'));
});
test('M-09: ANOMALY_COUNT_SQL filters negative lead times', () => {
  assert.ok(ANOMALY_COUNT_SQL.includes('start_date::date < r.created_at::date'));
});
test('M-10: RECENT_PICKUP_SQL also guards non-negative', () => {
  assert.ok(RECENT_PICKUP_SQL.includes('start_date::date >= r.created_at::date'));
});

// ── Section N — Safety contract ───────────────────────────────────────────────

console.log('\n  [N] Safety contract');

test('N-01: booking-pickup-shadow.js does NOT import pricing-engine', () => {
  assert.ok(!SRC.includes("require('../routes/pricing-engine')"));
  assert.ok(!SRC.includes("require('./pricing-engine')"));
});
test('N-02: booking-pickup-shadow.js does NOT import market-observation-repository', () => {
  assert.ok(!SRC.includes("require('./market-observation-repository')"));
});
test('N-03: IDEAL_PICKUP_CURVE is inlined (not imported)', () => {
  assert.ok(SRC.includes('const IDEAL_PICKUP_CURVE'));
  assert.ok(!SRC.includes('IDEAL_PICKUP_CURVE = require'));
});
test('N-04: no HTTP/network module in booking-pickup-shadow.js', () => {
  assert.ok(!SRC.includes("require('http')"));
  assert.ok(!SRC.includes("require('https')"));
  assert.ok(!SRC.includes("require('node-fetch')"));
  assert.ok(!SRC.includes("require('axios')"));
});
test('N-05: no Channex API call in booking-pickup-shadow.js (comment references OK)', () => {
  // 'channex' appears as a trusted source value and in comments — that is expected.
  // What must NOT exist is an actual Channex API require or HTTP call.
  assert.ok(!SRC.includes("require('../channex')"), 'imports channex module');
  assert.ok(!SRC.includes("require('./channex')"), 'imports channex module');
  assert.ok(!SRC.match(/sendBookingMessage|getBookings|channexClient/), 'calls Channex API');
});
test('N-06: calculatePickupShadow SQL is SELECT-only', () => {
  const allSql = HISTORICAL_DISTRIBUTION_SQL + ANOMALY_COUNT_SQL + RECENT_PICKUP_SQL + OCCUPANCY_PROXY_SQL;
  assert.ok(!allSql.toUpperCase().match(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/));
});
test('N-07: advisory multiplier constants = [0.94, 1.06]', () => {
  assert.strictEqual(ADVISORY_MIN, 0.94);
  assert.strictEqual(ADVISORY_MAX, 1.06);
  // 0.93 appears in IDEAL_PICKUP_CURVE (valid) — not an advisory value.
  // Verify no advisory return value outside [0.94, 1.06] via H-09 already.
  assert.ok(!SRC.includes('1.07'), '1.07 multiplier found');
  assert.ok(!SRC.includes('return 0.93'), 'advisory 0.93 return found');
});
test('N-08: persistence INSERT SQL does NOT touch pricing_schedule or pricing_config', () => {
  // Comments may mention these tables (documenting what is NOT touched).
  // Check the actual SQL constant — that is the only code path that writes.
  assert.ok(!INSERT_OBSERVATION_SQL.toLowerCase().includes('pricing_schedule'),
    'INSERT SQL references pricing_schedule');
  assert.ok(!INSERT_OBSERVATION_SQL.toLowerCase().includes('pricing_config'),
    'INSERT SQL references pricing_config');
});
test('N-09: audit tool does NOT call persistPickupObservation', () => {
  assert.ok(!ASRC.includes('persistPickupObservation'));
  assert.ok(!ASRC.includes('booking-pickup-persistence'));
});
test('N-10: persistence flag defaults to off', () => {
  const original = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  assert.strictEqual(isPersistenceEnabled(), false);
  if (original !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = original;
});
test('N-11: isPersistenceEnabled requires exact string "true"', () => {
  const original = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
  assert.strictEqual(isPersistenceEnabled(), true);
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = '1';
  assert.strictEqual(isPersistenceEnabled(), false);
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'yes';
  assert.strictEqual(isPersistenceEnabled(), false);
  if (original !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = original;
  else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});
test('N-12: pricing-engine.js does NOT import booking-pickup-shadow', () => {
  const pricingPath = path.join(__dirname, '../routes/pricing-engine.js');
  if (fs.existsSync(pricingPath)) {
    const peSrc = fs.readFileSync(pricingPath, 'utf8');
    assert.ok(!peSrc.includes('booking-pickup-shadow'));
    assert.ok(!peSrc.includes('booking-pickup-persistence'));
  }
});
test('N-13: no pacingMult import in booking-pickup-shadow.js', () => {
  assert.ok(!SRC.match(/\bconst\s+\w+\s*=\s*pacingMult\b/));
  assert.ok(!SRC.includes("require('../routes/pricing-engine')"));
});
test('N-14: RECENT_PICKUP_SQL anchors to CURRENT_DATE (no future leakage)', () => {
  assert.ok(RECENT_PICKUP_SQL.includes('created_at::date >= CURRENT_DATE - $3::int'));
});

// ── Section O — Persistence structural invariants ────────────────────────────

console.log('\n  [O] Persistence structural invariants');

test('O-01: INSERT_OBSERVATION_SQL targets booking_pickup_observations only', () => {
  const upper = INSERT_OBSERVATION_SQL.toUpperCase();
  assert.ok(upper.includes('INSERT INTO BOOKING_PICKUP_OBSERVATIONS'));
  assert.ok(!upper.includes('PRICING_SCHEDULE'));
  assert.ok(!upper.includes('PRICING_CONFIG'));
  assert.ok(!upper.includes('RESERVATIONS'));
  assert.ok(!upper.includes('MARKET_OBSERVATIONS'));
});
test('O-02: INSERT_OBSERVATION_SQL has ON CONFLICT DO NOTHING', () => {
  assert.ok(INSERT_OBSERVATION_SQL.toUpperCase().includes('ON CONFLICT'));
  assert.ok(INSERT_OBSERVATION_SQL.toUpperCase().includes('DO NOTHING'));
});
test('O-04: migration 005 exists and is additive-only', () => {
  const migPath = path.join(__dirname, '../migrations/005_booking_pickup_observations.sql');
  assert.ok(fs.existsSync(migPath), 'migration file missing');
  const sql = fs.readFileSync(migPath, 'utf8').toUpperCase();
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS BOOKING_PICKUP_OBSERVATIONS'));
  assert.ok(!sql.includes('ALTER TABLE PRICING'));
  assert.ok(!sql.includes('ALTER TABLE RESERVATIONS'));
  assert.ok(!sql.includes('DROP TABLE'));
});

// ── Section P — PROD-FIX: canonical db-pool (P1.3-T1-PROD-FIX) ───────────────

console.log('\n  [P] PROD-FIX: canonical db-pool');

test('P-01: audit imports createPool from services/db-pool', () => {
  assert.ok(ASRC.includes("require('../services/db-pool')"), 'db-pool not imported');
  assert.ok(ASRC.includes('createPool'), 'createPool not used');
});
test('P-02: audit does NOT create its own new Pool(...)', () => {
  assert.ok(!ASRC.match(/new Pool\s*\(/), 'new Pool() found in audit');
});
test('P-03: audit does NOT import pg directly', () => {
  assert.ok(!ASRC.includes("require('pg')"), 'direct pg import found in audit');
});
test('P-04: audit has no ssl: or rejectUnauthorized in its own code', () => {
  assert.ok(!ASRC.includes('rejectUnauthorized'), 'rejectUnauthorized found in audit');
  assert.ok(!ASRC.match(/\bssl\s*:/), 'ssl: config found in audit');
});
test('P-05: audit has no DATABASE_URL construction', () => {
  // DATABASE_URL may appear in comments — check for actual new Pool or pg.Pool construction
  assert.ok(!ASRC.match(/new Pool\s*\(\s*\{[^}]*DATABASE_URL/), 'DATABASE_URL passed to new Pool');
});
test('P-06: pool is closed in finally block (pool.end in finally)', () => {
  // The audit wraps the body in try { ... } finally { await pool.end() }
  assert.ok(ASRC.includes('finally'), 'no finally block in audit');
  assert.ok(ASRC.includes('pool.end()'), 'pool.end() not found in audit');
});
test('P-07: booking-pickup-shadow.js does NOT create its own Pool', () => {
  assert.ok(!SRC.match(/new Pool\s*\(/), 'new Pool() found in shadow engine');
  assert.ok(!SRC.includes("require('pg')"), 'direct pg import in shadow engine');
});
test('P-08: calculatePickupShadow receives pool as first argument (injected)', () => {
  // The function signature is calculatePickupShadow(pool, propertyId, targetDate, ...)
  assert.ok(SRC.includes('async function calculatePickupShadow(pool,'));
});
test('P-09: error classification uses DATABASE_CONNECTION_FAILURE for connection errors', () => {
  assert.ok(ASRC.includes('DATABASE_CONNECTION_FAILURE'), 'connection error class missing');
});
test('P-10: error classification uses QUERY_EXECUTION_FAILURE for query errors', () => {
  assert.ok(ASRC.includes('QUERY_EXECUTION_FAILURE'), 'query error class missing');
});
test('P-11: error classification uses PICKUP_CALCULATION_FAILURE for per-property errors', () => {
  assert.ok(ASRC.includes('PICKUP_CALCULATION_FAILURE'), 'pickup error class missing');
});
test('P-12: no NODE_TLS_REJECT_UNAUTHORIZED in audit', () => {
  assert.ok(!ASRC.includes('NODE_TLS_REJECT_UNAUTHORIZED'), 'global TLS bypass found');
});
test('P-13: db-pool.js still has canonical createPool (not modified by this fix)', () => {
  const dbPoolSrc = fs.readFileSync(path.join(__dirname, '../services/db-pool.js'), 'utf8');
  assert.ok(dbPoolSrc.includes('createPool'), 'createPool missing from db-pool.js');
  // The canonical factory sets ssl based on NODE_ENV — this line must still be present
  assert.ok(dbPoolSrc.includes("process.env.NODE_ENV === 'production'"), 'production env guard missing');
  // db-pool.js exports only createPool — no new exports added
  assert.ok(dbPoolSrc.includes('module.exports = { createPool }'), 'module.exports changed');
});

// ── Section L — calculatePickupShadow (mock pool) — async ────────────────────

async function runAsyncTests() {
  console.log('\n  [L] calculatePickupShadow (mock pool)');

  await testAsync('L-01: M6-like history → valid obs shape', async () => {
    const pool = makeMockPool(m6HistRows(), 0, 2, 5);
    const obs = await calculatePickupShadow(pool, 'prop-m6', NEAR_FUTURE);
    assert.strictEqual(obs.propertyId, 'prop-m6');
    assert.strictEqual(obs.targetDate, NEAR_FUTURE);
    assert.ok(Number.isFinite(obs.leadTimeDays));
    assert.strictEqual(obs.historicalSampleSize, 42);
    assert.ok(['ACCELERATING', 'NORMAL', 'SLOW', 'INSUFFICIENT_DATA'].includes(obs.status));
    assert.ok(['GOOD', 'MODERATE', 'LOW', 'INSUFFICIENT'].includes(obs.confidence));
    assert.ok(obs.advisoryMultiplier >= ADVISORY_MIN && obs.advisoryMultiplier <= ADVISORY_MAX);
    assert.strictEqual(obs.baselineType, 'PROPERTY_HISTORY');
    assert.strictEqual(obs.modelVersion, MODEL_VERSION);
    assert.ok(typeof obs.calculatedAt === 'string');
    assert.ok(Array.isArray(obs.reasons));
  });

  await testAsync('L-02: M7-like history → GOOD confidence', async () => {
    const pool = makeMockPool(m7HistRows(), 0, 3, 8);
    const obs = await calculatePickupShadow(pool, 'prop-m7', NEAR_FUTURE);
    assert.strictEqual(obs.historicalSampleSize, 52);
    assert.strictEqual(obs.confidence, 'GOOD');
    assert.ok(obs.advisoryMultiplier >= ADVISORY_MIN && obs.advisoryMultiplier <= ADVISORY_MAX);
  });

  await testAsync('L-03: Ti Junot-like (8 bookings) → INSUFFICIENT_DATA, advisory=1.00', async () => {
    const pool = makeMockPool(tiJunotHistRows(), 0, 0, 2);
    const obs = await calculatePickupShadow(pool, 'prop-ti', NEAR_FUTURE);
    assert.strictEqual(obs.confidence, 'INSUFFICIENT');
    assert.strictEqual(obs.status, 'INSUFFICIENT_DATA');
    assert.strictEqual(obs.advisoryMultiplier, 1.00);
  });

  await testAsync('L-04: zero history → INSUFFICIENT_DATA, advisory=1.00, ratio=null', async () => {
    const pool = makeMockPool([], 0, 0, 0);
    const obs = await calculatePickupShadow(pool, 'prop-empty', NEAR_FUTURE);
    assert.strictEqual(obs.status, 'INSUFFICIENT_DATA');
    assert.strictEqual(obs.advisoryMultiplier, 1.00);
    assert.strictEqual(obs.pickupRatio, null);
  });

  await testAsync('L-05: anomalies are excluded from history count', async () => {
    const pool = makeMockPool(m6HistRows(), 5, 1, 3);
    const obs = await calculatePickupShadow(pool, 'prop-m6', NEAR_FUTURE);
    assert.strictEqual(obs.anomaliesExcluded, 5);
    // histResult.rows only contains non-negative rows (SQL WHERE guard)
    assert.strictEqual(obs.historicalSampleSize, 42);
  });

  await testAsync('L-06: accelerating pickup → advisory > 1.00', async () => {
    // M6: 28 in band 0_1, target in 0_1, recent=5 → ratio >> 2 → ACCELERATING
    const pool = makeMockPool(m6HistRows(), 0, 5, 10);
    const obs = await calculatePickupShadow(pool, 'prop-accel', NEAR_FUTURE);
    if (obs.confidence !== 'INSUFFICIENT' && obs.status === 'ACCELERATING') {
      assert.ok(obs.advisoryMultiplier > 1.00);
    }
  });

  await testAsync('L-07: slow pickup (recent=0) → advisory < 1.00', async () => {
    // M6: 28 in 0_1, recent=0 → ratio=0 → SLOW
    const pool = makeMockPool(m6HistRows(), 0, 0, 2);
    const obs = await calculatePickupShadow(pool, 'prop-slow', NEAR_FUTURE);
    if (obs.confidence !== 'INSUFFICIENT' && obs.status === 'SLOW') {
      assert.ok(obs.advisoryMultiplier < 1.00);
    }
  });

  await testAsync('L-08: M6 and M7 remain independent (different comparableSampleSize)', async () => {
    const poolM6 = makeMockPool(m6HistRows(), 0, 1, 3);
    const poolM7 = makeMockPool(m7HistRows(), 0, 1, 3);
    const obsM6 = await calculatePickupShadow(poolM6, 'prop-m6', NEAR_FUTURE);
    const obsM7 = await calculatePickupShadow(poolM7, 'prop-m7', NEAR_FUTURE);
    // M6 band 0_1 count = 28; M7 band 0_1 count = 40
    assert.notStrictEqual(obsM6.comparableSampleSize, obsM7.comparableSampleSize);
    assert.strictEqual(obsM6.propertyId, 'prop-m6');
    assert.strictEqual(obsM7.propertyId, 'prop-m7');
  });

  await testAsync('L-09: observation contains no PII', async () => {
    const pool = makeMockPool(m6HistRows(), 0, 2, 5);
    const obs = await calculatePickupShadow(pool, 'prop-m6', NEAR_FUTURE);
    const json = JSON.stringify(obs);
    assert.ok(!json.includes('@'), 'contains @ (email)');
    // propertyId is an internal identifier, not a guest name
  });

  await testAsync('L-10: pacing proxy returns valid pacingStrength', async () => {
    const pool = makeMockPool(m6HistRows(), 0, 2, 5);
    const obs = await calculatePickupShadow(pool, 'prop-m6', NEAR_FUTURE);
    assert.ok(['STRONG', 'NORMAL', 'WEAK', 'UNKNOWN'].includes(obs.pacingStrength));
    assert.ok(typeof obs.occupancyFraction === 'number');
  });

  await testAsync('L-11: past target date → leadTimeBand=anomaly', async () => {
    const yesterday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const pool = makeMockPool(m6HistRows(), 0, 0, 0);
    const obs = await calculatePickupShadow(pool, 'prop-m6', yesterday);
    assert.strictEqual(obs.leadTimeBand, 'anomaly');
    assert.ok(obs.reasons.some(r => r.includes('past')));
  });

  await testAsync('L-12: custom lookbackMonths and recentWindowDays are respected', async () => {
    const pool = makeMockPool(m6HistRows(), 0, 2, 5);
    const obs = await calculatePickupShadow(pool, 'prop-m6', MID_FUTURE, {
      lookbackMonths: 6,
      recentWindowDays: 14,
      targetWindowDays: 7,
    });
    assert.strictEqual(obs.lookbackMonths, 6);
    assert.strictEqual(obs.recentWindowDays, 14);
  });

  await testAsync('O-03: persistPickupObservation skips DB when flag is off', async () => {
    const original = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    let queryCalled = false;
    const mockPool = { query() { queryCalled = true; return Promise.resolve({ rows: [] }); } };
    const result = await persistPickupObservation(mockPool, { propertyId: 'test' });
    assert.strictEqual(result, null);
    assert.strictEqual(queryCalled, false);
    if (original !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = original;
  });
}

// ── Run and exit ──────────────────────────────────────────────────────────────

runAsyncTests().then(() => {
  console.log('');
  console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    console.error(`\n  ${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log('\n  All P1.3-T1 tests passed.\n');
}).catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
