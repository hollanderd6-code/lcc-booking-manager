'use strict';
/**
 * P1.2-B5-BK-M10F — Historical Anomaly Classification Tests
 *
 * Sections A–Q (17 sections):
 *   A  buildHistoricalBaseline: known M6 case (345.45€ vs 132–145€ history)
 *   B  buildHistoricalBaseline: stable history + normal latest → NONE
 *   C  buildHistoricalBaseline: insufficient history → INCONCLUSIVE
 *   D  classifyHistoricalAnomaly: progressive change → LOW
 *   E  buildHistoricalBaseline: single outlier in history
 *   F  classifyHistoricalAnomaly: sudden drop → CRITICAL
 *   G  checkStayWindowCompatibility: matching windows → SAME_WINDOW
 *   H  checkStayWindowCompatibility: absent metadata → UNKNOWN_WINDOW
 *   I  Module isolation — M10F modules do not import M6/M7/M8/K
 *   J  classifyHistoricalAnomaly: candidate signal present (M10F-5)
 *   K  classifyHistoricalAnomaly: no candidate signal → metrics unchanged
 *   L  buildHistoricalBaseline: no historical data → INSUFFICIENT_HISTORY
 *   M  No DB writes — all pure functions
 *   N  No BD (network) calls — all pure functions
 *   O  No pricing writes
 *   P  No Channex calls
 *   Q  deriveQuarantineRecommendation: severity → recommendation mapping
 *
 * SAFETY: 0 BD credits consumed, 0 DB writes, 0 pricing writes.
 */

const {
  buildHistoricalBaseline,
  MIN_HISTORY_ROWS,
  MIN_ROBUST_ROWS,
  HISTORY_WINDOW_ROWS,
} = require('../services/market-historical-baseline');

const {
  checkStayWindowCompatibility,
  MAX_NIGHTS_DELTA,
} = require('../services/market-stay-window-compatibility');

const {
  classifyHistoricalAnomaly,
  CRITICAL_SPIKE_RATIO,
  HIGH_SPIKE_RATIO,
  LOW_SPIKE_RATIO,
  CRITICAL_DROP_RATIO,
  HIGH_DROP_RATIO,
  LOW_DROP_RATIO,
  COUNT_SPIKE_RATIO,
  COUNT_DROP_RATIO,
} = require('../services/market-historical-anomaly-classifier');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(median_price, scraped_at_offset_h = 0, overrides = {}) {
  return {
    id:               Math.floor(Math.random() * 100_000),
    property_id:      'prop-test',
    median_price,
    comparable_count: overrides.comparable_count ?? 45,
    scraped_at:       new Date(Date.now() - scraped_at_offset_h * 3_600_000).toISOString(),
    raw_data:         overrides.raw_data ?? {},
    week_start:       overrides.week_start ?? null,
    ...overrides,
  };
}

// Historical rows for M6 scenario: 4 rows at ~132–145€
const M6_HISTORICAL = [
  makeRow(136, 321),
  makeRow(132, 489),
  makeRow(145, 657),
  makeRow(132, 825),
];
const M6_LATEST = makeRow(345.45, 46, { comparable_count: 93 });

// ── Section A: buildHistoricalBaseline — M6 known case ───────────────────────

describe('A — buildHistoricalBaseline: M6 known spike case', () => {
  let baseline;
  beforeAll(() => {
    baseline = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
  });

  test('A-01 status is OK', () => {
    expect(baseline.status).toBe('OK');
  });

  test('A-02 historyCount = 4', () => {
    expect(baseline.historyCount).toBe(4);
  });

  test('A-03 historyMedian is between 132 and 145', () => {
    expect(baseline.historyMedian).toBeGreaterThanOrEqual(132);
    expect(baseline.historyMedian).toBeLessThanOrEqual(145);
  });

  test('A-04 latestMedian = 345.45', () => {
    expect(baseline.latestMedian).toBeCloseTo(345.45, 1);
  });

  test('A-05 ratioVsHistoryMedian >= CRITICAL_SPIKE_RATIO (2.0)', () => {
    expect(baseline.ratioVsHistoryMedian).toBeGreaterThanOrEqual(CRITICAL_SPIKE_RATIO);
  });

  test('A-06 deltaVsHistoryMedianPct > 100%', () => {
    expect(baseline.deltaVsHistoryMedianPct).toBeGreaterThan(100);
  });

  test('A-07 historyMin and historyMax are correct', () => {
    expect(baseline.historyMin).toBe(132);
    expect(baseline.historyMax).toBe(145);
  });

  test('A-08 mad is non-null (>= MIN_ROBUST_ROWS)', () => {
    expect(baseline.mad).not.toBeNull();
  });

  test('A-09 iqrLow and iqrHigh are within [historyMin, historyMax]', () => {
    expect(baseline.iqrLow).toBeGreaterThanOrEqual(baseline.historyMin);
    expect(baseline.iqrHigh).toBeLessThanOrEqual(baseline.historyMax);
  });

  test('A-10 robustBaselineMethod is median_iqr (4 rows >= MIN_ROBUST_ROWS)', () => {
    expect(baseline.robustBaselineMethod).toBe('median_iqr');
  });

  test('A-11 historyCountMedian reflects history comparable counts', () => {
    expect(baseline.historyCountMedian).toBeGreaterThan(0);
  });

  test('A-12 latestCount = 93', () => {
    expect(baseline.latestCount).toBe(93);
  });
});

// ── Section B: buildHistoricalBaseline — stable history ──────────────────────

describe('B — buildHistoricalBaseline: stable history + normal latest → NONE', () => {
  const historyStable = [
    makeRow(118, 200),
    makeRow(120, 400),
    makeRow(115, 600),
    makeRow(122, 800),
  ];
  const latestNormal = makeRow(119, 10);

  test('B-01 status is OK', () => {
    const b = buildHistoricalBaseline(latestNormal, historyStable);
    expect(b.status).toBe('OK');
  });

  test('B-02 ratio close to 1.0', () => {
    const b = buildHistoricalBaseline(latestNormal, historyStable);
    expect(b.ratioVsHistoryMedian).toBeGreaterThan(0.9);
    expect(b.ratioVsHistoryMedian).toBeLessThan(1.1);
  });

  test('B-03 classifyHistoricalAnomaly returns NONE severity', () => {
    const b = buildHistoricalBaseline(latestNormal, historyStable);
    const w = checkStayWindowCompatibility(latestNormal, historyStable);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('NONE');
  });

  test('B-04 reasons array is empty', () => {
    const b = buildHistoricalBaseline(latestNormal, historyStable);
    const w = checkStayWindowCompatibility(latestNormal, historyStable);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.reasons).toHaveLength(0);
  });
});

// ── Section C: buildHistoricalBaseline — insufficient history ─────────────────

describe('C — buildHistoricalBaseline: insufficient history → INCONCLUSIVE', () => {
  test('C-01 0 history rows → INSUFFICIENT_HISTORY', () => {
    const b = buildHistoricalBaseline(M6_LATEST, []);
    expect(b.status).toBe('INSUFFICIENT_HISTORY');
  });

  test('C-02 1 history row → INSUFFICIENT_HISTORY', () => {
    const b = buildHistoricalBaseline(M6_LATEST, [makeRow(130, 200)]);
    expect(b.status).toBe('INSUFFICIENT_HISTORY');
  });

  test('C-03 classifyHistoricalAnomaly with INSUFFICIENT_HISTORY baseline → INCONCLUSIVE', () => {
    const b = buildHistoricalBaseline(M6_LATEST, [makeRow(130, 200)]);
    const w = checkStayWindowCompatibility(M6_LATEST, [makeRow(130, 200)]);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('INCONCLUSIVE');
  });

  test('C-04 INSUFFICIENT_HISTORY historyMedian is null', () => {
    const b = buildHistoricalBaseline(M6_LATEST, []);
    expect(b.historyMedian).toBeNull();
  });

  test('C-05 exactly MIN_HISTORY_ROWS rows → OK (boundary)', () => {
    const hist = Array.from({ length: MIN_HISTORY_ROWS }, (_, i) => makeRow(130, 200 + i * 100));
    const b = buildHistoricalBaseline(M6_LATEST, hist);
    expect(b.status).toBe('OK');
  });
});

// ── Section D: classifyHistoricalAnomaly — progressive change ─────────────────

describe('D — classifyHistoricalAnomaly: progressive change → LOW', () => {
  // Latest is 23% above history (between LOW_SPIKE and HIGH_SPIKE)
  const histProg = [
    makeRow(100, 200),
    makeRow(102, 400),
    makeRow(98,  600),
    makeRow(100, 800),
  ];
  const latestProg = makeRow(123, 10);

  test('D-01 ratio ~1.23 → LOW severity', () => {
    const b = buildHistoricalBaseline(latestProg, histProg);
    const w = checkStayWindowCompatibility(latestProg, histProg);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('LOW');
  });

  test('D-02 reasons contains price_spike_low', () => {
    const b = buildHistoricalBaseline(latestProg, histProg);
    const w = checkStayWindowCompatibility(latestProg, histProg);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.reasons.some(r => r.startsWith('price_spike_low'))).toBe(true);
  });

  test('D-03 ratio at exactly HIGH_SPIKE_RATIO boundary → HIGH', () => {
    const latestHigh = makeRow(150, 10); // 150/100 = 1.5
    const b = buildHistoricalBaseline(latestHigh, histProg);
    const w = checkStayWindowCompatibility(latestHigh, histProg);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('HIGH');
  });

  test('D-04 ratio at exactly CRITICAL_SPIKE_RATIO boundary → CRITICAL', () => {
    const latestCritical = makeRow(200, 10); // 200/100 = 2.0
    const b = buildHistoricalBaseline(latestCritical, histProg);
    const w = checkStayWindowCompatibility(latestCritical, histProg);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('CRITICAL');
  });
});

// ── Section E: buildHistoricalBaseline — outlier in history ──────────────────

describe('E — buildHistoricalBaseline: single outlier in history', () => {
  // One row 3× median — median should resist it
  const histWithOutlier = [
    makeRow(130, 200),
    makeRow(132, 400),
    makeRow(390, 600),   // outlier
    makeRow(128, 800),
  ];
  const latestE = makeRow(131, 10);

  test('E-01 historyMedian is near 130–132 (outlier-resistant)', () => {
    const b = buildHistoricalBaseline(latestE, histWithOutlier);
    // median of [128, 130, 132, 390] = (130+132)/2 = 131
    expect(b.historyMedian).toBeCloseTo(131, 0);
  });

  test('E-02 HISTORY_WINDOW_ROWS caps rows at 8', () => {
    const many = Array.from({ length: 15 }, (_, i) => makeRow(100 + i, (i + 1) * 100));
    const b = buildHistoricalBaseline(makeRow(105, 10), many);
    expect(b.historyCount).toBeLessThanOrEqual(HISTORY_WINDOW_ROWS);
  });
});

// ── Section F: classifyHistoricalAnomaly — sudden drop ───────────────────────

describe('F — classifyHistoricalAnomaly: sudden drop', () => {
  const histF = [
    makeRow(200, 200),
    makeRow(205, 400),
    makeRow(195, 600),
    makeRow(200, 800),
  ];

  test('F-01 drop to 50% of history → CRITICAL', () => {
    const latestDrop = makeRow(100, 10); // 100/200 = 0.5
    const b = buildHistoricalBaseline(latestDrop, histF);
    const w = checkStayWindowCompatibility(latestDrop, histF);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('CRITICAL');
  });

  test('F-02 drop to 60% → HIGH', () => {
    const latestDrop = makeRow(120, 10); // 120/200 = 0.6
    const b = buildHistoricalBaseline(latestDrop, histF);
    const w = checkStayWindowCompatibility(latestDrop, histF);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('HIGH');
  });

  test('F-03 drop to 80% → LOW', () => {
    const latestDrop = makeRow(160, 10); // 160/200 = 0.8
    const b = buildHistoricalBaseline(latestDrop, histF);
    const w = checkStayWindowCompatibility(latestDrop, histF);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('LOW');
  });

  test('F-04 reasons contain price_drop for critical drop', () => {
    const latestDrop = makeRow(100, 10);
    const b = buildHistoricalBaseline(latestDrop, histF);
    const w = checkStayWindowCompatibility(latestDrop, histF);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.reasons.some(r => r.startsWith('price_drop'))).toBe(true);
  });
});

// ── Section G: checkStayWindowCompatibility — matching windows ───────────────

describe('G — checkStayWindowCompatibility: window metadata present', () => {
  function makeRowWithWindow(nights, offset_h = 0) {
    return makeRow(130, offset_h, {
      raw_data: { nights, checkIn: '2026-10-11', checkOut: '2026-10-14' },
    });
  }

  test('G-01 same nights → SAME_WINDOW', () => {
    const latest = makeRowWithWindow(3, 10);
    const hist   = [makeRowWithWindow(3, 200), makeRowWithWindow(3, 400)];
    const result = checkStayWindowCompatibility(latest, hist);
    expect(result.status).toBe('SAME_WINDOW');
  });

  test('G-02 1-night delta → COMPATIBLE_WINDOW', () => {
    const latest = makeRowWithWindow(3, 10);
    const hist   = [makeRowWithWindow(4, 200), makeRowWithWindow(3, 400)];
    const result = checkStayWindowCompatibility(latest, hist);
    expect(result.status).toBe('COMPATIBLE_WINDOW');
  });

  test('G-03 2-night delta exceeds MAX_NIGHTS_DELTA → UNKNOWN_WINDOW', () => {
    const latest = makeRowWithWindow(3, 10);
    const hist   = [makeRowWithWindow(5, 200), makeRowWithWindow(3, 400)];
    const result = checkStayWindowCompatibility(latest, hist);
    expect(result.status).toBe('UNKNOWN_WINDOW');
  });

  test('G-04 details.maxDelta is present for COMPATIBLE_WINDOW', () => {
    const latest = makeRowWithWindow(3, 10);
    const hist   = [makeRowWithWindow(4, 200), makeRowWithWindow(3, 400)];
    const result = checkStayWindowCompatibility(latest, hist);
    expect(result.details.maxDelta).toBe(1);
  });
});

// ── Section H: checkStayWindowCompatibility — absent metadata ────────────────

describe('H — checkStayWindowCompatibility: absent metadata → UNKNOWN_WINDOW', () => {
  test('H-01 no raw_data → UNKNOWN_WINDOW', () => {
    const latest = makeRow(345.45, 46);
    const hist   = M6_HISTORICAL;
    const result = checkStayWindowCompatibility(latest, hist);
    expect(result.status).toBe('UNKNOWN_WINDOW');
  });

  test('H-02 fewer than MIN_HISTORY_ROWS → INSUFFICIENT_HISTORY', () => {
    const result = checkStayWindowCompatibility(makeRow(130, 10), [makeRow(130, 200)]);
    expect(result.status).toBe('INSUFFICIENT_HISTORY');
  });

  test('H-03 classifyHistoricalAnomaly adds window_comparability_unknown warning', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.warnings).toContain('window_comparability_unknown');
  });

  test('H-04 UNKNOWN_WINDOW does not block severity classification', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    // Should still be CRITICAL despite UNKNOWN_WINDOW
    expect(a.severity).toBe('CRITICAL');
  });
});

// ── Section I: Module isolation ───────────────────────────────────────────────

describe('I — Module isolation: M10F does not import M6/M7/M8/K', () => {
  const prohibited = [
    'airbnb-snapshot-anomaly-diagnostic',
    'market-collection-cost-estimator',
    'market-engine-adaptive-shadow-m',
    'market-engine-shadow-k',
  ];

  function getRequires(modulePath) {
    const fs  = require('fs');
    const src = fs.readFileSync(modulePath, 'utf8');
    return src.match(/require\(['"][^'"]+['"]\)/g) || [];
  }

  test('I-01 market-historical-baseline imports no prohibited modules', () => {
    const reqs = getRequires(require.resolve('../services/market-historical-baseline'));
    for (const p of prohibited) {
      expect(reqs.some(r => r.includes(p))).toBe(false);
    }
  });

  test('I-02 market-stay-window-compatibility imports no prohibited modules', () => {
    const reqs = getRequires(require.resolve('../services/market-stay-window-compatibility'));
    for (const p of prohibited) {
      expect(reqs.some(r => r.includes(p))).toBe(false);
    }
  });

  test('I-03 market-historical-anomaly-classifier imports no prohibited modules', () => {
    const reqs = getRequires(require.resolve('../services/market-historical-anomaly-classifier'));
    for (const p of prohibited) {
      expect(reqs.some(r => r.includes(p))).toBe(false);
    }
  });
});

// ── Section J: Candidate signal comparison (M10F-5) ───────────────────────────

describe('J — Candidate signal comparison metrics', () => {
  test('J-01 M6 case: candidate 125.61 is much lower than production 345.45', () => {
    const prodMedian     = 345.45;
    const candidateMedian = 125.61;
    const delta = Math.round((candidateMedian - prodMedian) / prodMedian * 100 * 100) / 100;
    expect(delta).toBeLessThan(-50);
  });

  test('J-02 candidate vs history: 125.61 is close to M6 history median', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const candidateMedian = 125.61;
    // candidate should be within 10% of history median
    expect(Math.abs(candidateMedian - b.historyMedian) / b.historyMedian).toBeLessThan(0.10);
  });

  test('J-03 baseline metrics object always contains windowCompatStatus', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.metrics).toHaveProperty('windowCompatStatus');
  });
});

// ── Section K: No candidate signal → metrics unchanged ───────────────────────

describe('K — No candidate signal present', () => {
  test('K-01 classifyHistoricalAnomaly with null baseline returns INCONCLUSIVE', () => {
    const a = classifyHistoricalAnomaly(null, null);
    expect(a.severity).toBe('INCONCLUSIVE');
  });

  test('K-02 latestMedian null → INCONCLUSIVE', () => {
    const b = buildHistoricalBaseline({ median_price: null }, M6_HISTORICAL);
    // latestMedian is null → baseline still OK (latest is not part of validation)
    // classify should handle null latestMedian
    const w = checkStayWindowCompatibility({ median_price: null }, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('INCONCLUSIVE');
  });
});

// ── Section L: No historical data ────────────────────────────────────────────

describe('L — No historical data', () => {
  test('L-01 empty historicalRows → INSUFFICIENT_HISTORY', () => {
    const b = buildHistoricalBaseline(M6_LATEST, []);
    expect(b.status).toBe('INSUFFICIENT_HISTORY');
    expect(b.historyCount).toBe(0);
  });

  test('L-02 null historicalRows treated as empty', () => {
    const b = buildHistoricalBaseline(M6_LATEST, null);
    expect(b.status).toBe('INSUFFICIENT_HISTORY');
  });

  test('L-03 rows with median_price = 0 are filtered out', () => {
    const hist = [makeRow(0, 200), makeRow(0, 400)];
    const b = buildHistoricalBaseline(M6_LATEST, hist);
    expect(b.status).toBe('INSUFFICIENT_HISTORY');
  });
});

// ── Section M: No DB writes ───────────────────────────────────────────────────

describe('M — No DB writes (pure functions)', () => {
  test('M-01 buildHistoricalBaseline returns a plain object (no Pool/query)', () => {
    const result = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    expect(result).toBeInstanceOf(Object);
    expect(result.query).toBeUndefined();
  });

  test('M-02 classifyHistoricalAnomaly returns a plain object (no Pool/query)', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const result = classifyHistoricalAnomaly(b, w);
    expect(result).toBeInstanceOf(Object);
    expect(result.query).toBeUndefined();
  });

  test('M-03 checkStayWindowCompatibility returns a plain object (no Pool/query)', () => {
    const result = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    expect(result).toBeInstanceOf(Object);
    expect(result.query).toBeUndefined();
  });
});

// ── Section N: No BD calls ────────────────────────────────────────────────────

describe('N — No Bright Data / network calls', () => {
  test('N-01 buildHistoricalBaseline is synchronous (no Promise)', () => {
    const result = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    expect(result).not.toBeInstanceOf(Promise);
  });

  test('N-02 classifyHistoricalAnomaly is synchronous', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const result = classifyHistoricalAnomaly(b, w);
    expect(result).not.toBeInstanceOf(Promise);
  });

  test('N-03 checkStayWindowCompatibility is synchronous', () => {
    const result = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

// ── Section O: No pricing writes ─────────────────────────────────────────────

describe('O — No pricing writes', () => {
  test('O-01 classifyHistoricalAnomaly result has no pricing fields', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.price).toBeUndefined();
    expect(a.newPrice).toBeUndefined();
    expect(a.priceOverride).toBeUndefined();
  });

  test('O-02 buildHistoricalBaseline result has no pricing write fields', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    expect(b.price).toBeUndefined();
    expect(b.channex).toBeUndefined();
  });
});

// ── Section P: No Channex calls ───────────────────────────────────────────────

describe('P — No Channex calls', () => {
  test('P-01 no channex property in classifyHistoricalAnomaly result', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    expect(JSON.stringify(a)).not.toContain('channex');
  });

  test('P-02 no channex property in buildHistoricalBaseline result', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    expect(JSON.stringify(b)).not.toContain('channex');
  });
});

// ── Section Q: deriveQuarantineRecommendation ─────────────────────────────────

describe('Q — QUARANTINE_RECOMMENDATION derivation', () => {
  // Inline derivation function (mirrors what M10 audit tool uses)
  const SEVERITY_TO_RECOMMENDATION = {
    NONE:         'NONE',
    LOW:          'CAUTION',
    HIGH:         'QUARANTINE',
    CRITICAL:     'QUARANTINE',
    INCONCLUSIVE: 'INCONCLUSIVE',
  };
  const derive = s => SEVERITY_TO_RECOMMENDATION[s] ?? 'INCONCLUSIVE';

  test('Q-01 NONE → NONE', ()         => expect(derive('NONE')).toBe('NONE'));
  test('Q-02 LOW → CAUTION', ()        => expect(derive('LOW')).toBe('CAUTION'));
  test('Q-03 HIGH → QUARANTINE', ()    => expect(derive('HIGH')).toBe('QUARANTINE'));
  test('Q-04 CRITICAL → QUARANTINE', ()=> expect(derive('CRITICAL')).toBe('QUARANTINE'));
  test('Q-05 INCONCLUSIVE → INCONCLUSIVE', () => expect(derive('INCONCLUSIVE')).toBe('INCONCLUSIVE'));
  test('Q-06 unknown severity → INCONCLUSIVE', () => expect(derive('UNKNOWN')).toBe('INCONCLUSIVE'));

  test('Q-07 M6 case end-to-end: severity=CRITICAL → recommendation=QUARANTINE', () => {
    const b = buildHistoricalBaseline(M6_LATEST, M6_HISTORICAL);
    const w = checkStayWindowCompatibility(M6_LATEST, M6_HISTORICAL);
    const a = classifyHistoricalAnomaly(b, w);
    expect(a.severity).toBe('CRITICAL');
    expect(derive(a.severity)).toBe('QUARANTINE');
  });

  test('Q-08 stable case end-to-end → recommendation=NONE', () => {
    const histStable = [
      makeRow(118, 200),
      makeRow(120, 400),
      makeRow(115, 600),
      makeRow(122, 800),
    ];
    const latestStable = makeRow(119, 10);
    const b = buildHistoricalBaseline(latestStable, histStable);
    const w = checkStayWindowCompatibility(latestStable, histStable);
    const a = classifyHistoricalAnomaly(b, w);
    expect(derive(a.severity)).toBe('NONE');
  });

  test('Q-09 constants are exported and match expected values', () => {
    expect(CRITICAL_SPIKE_RATIO).toBe(2.0);
    expect(HIGH_SPIKE_RATIO).toBe(1.5);
    expect(LOW_SPIKE_RATIO).toBe(1.2);
    expect(CRITICAL_DROP_RATIO).toBe(0.5);
    expect(HIGH_DROP_RATIO).toBe(0.67);
    expect(LOW_DROP_RATIO).toBe(0.85);
    expect(COUNT_SPIKE_RATIO).toBe(2.5);
    expect(COUNT_DROP_RATIO).toBe(0.4);
    expect(MIN_HISTORY_ROWS).toBe(2);
    expect(MIN_ROBUST_ROWS).toBe(4);
    expect(HISTORY_WINDOW_ROWS).toBe(8);
    expect(MAX_NIGHTS_DELTA).toBe(1);
  });
});
