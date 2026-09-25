#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-A3 Bright Data Airbnb Controlled Diagnostic
 *
 * Verifies:
 *   BD-01 : previewMode makes zero network calls
 *   BD-02 : executeMode without API key aborts before any network call
 *   BD-03 : executeMode makes exactly one trigger POST
 *   BD-04 : trigger URL contains correct dataset_id
 *   BD-05 : trigger URL contains discover_new + discover_by=location
 *   BD-06 : trigger body contains exactly one input object
 *   BD-07 : EUR currency sent correctly in request body
 *   BD-08 : limit_per_input=10 in trigger URL
 *   BD-09 : snapshot_id captured from trigger response
 *   BD-10 : polling ready path → success with records
 *   BD-11 : polling failed path → abort, no second trigger
 *   BD-12 : polling timeout → abort with poll_timeout
 *   BD-13 : no second trigger on failure (no retry)
 *   BD-14 : API token never appears in tool source (static)
 *   BD-15 : pricingDetailsFields populated when pricing_details is object
 *   BD-16 : null pricing_details reported as null
 *   BD-17 : all EUR currencies → allCurrencyMatch=true
 *   BD-18 : currency mismatch → allCurrencyMatch=false
 *   BD-19 : availability field present in at least one record → availPresent > 0
 *   BD-20 : available_dates array → availDatesSampleLen reflects array length
 *   BD-21 : parseBedrooms("2 bedrooms" entry in details) → 2
 *   BD-22 : parseBedrooms("Studio" entry) → 0
 *   BD-23 : analyzeRecords inspects at most 3 records (sampledInspections.length <= 3)
 *   BD-24 : inspectRecord output contains no raw URL/host/address/description fields
 *   BD-25 : tool source imports no pg / Pool (no DB modules)
 *   BD-26 : tool source imports no channex modules
 *   BD-27 : tool source imports no dynamic-pricing or pricing execution modules
 *
 * Run: node tests/p1_2b5a3_brightdata_diag.test.js
 * No real Bright Data / DB / Channex calls.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ── Load tool ─────────────────────────────────────────────────────────────────
const TOOL_PATH = path.resolve(__dirname, '../outils/diag-brightdata-airbnb.js');
const TOOL_SRC  = fs.readFileSync(TOOL_PATH, 'utf8');
const {
  previewMode,
  executeMode,
  parseBedrooms,
  analyzeRecords,
  inspectRecord,
  DATASET_ID,
  MAX_RETURNED_RECORDS,
  MAX_WAIT_MS,
} = require(TOOL_PATH);

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeTriggerResponse(snapshotId) {
  return { ok: true, json: async () => ({ snapshot_id: snapshotId }) };
}

function makeProgressResponse(status) {
  return { ok: true, json: async () => ({ status }) };
}

function makeSnapshotResponse(records) {
  return { ok: true, json: async () => records, text: async () => '' };
}

/**
 * Build a mock fetchFn that records calls and returns scripted responses.
 * sequences: array of response factories called in order.
 */
function makeMockFetch(sequences) {
  const calls = [];
  let idx = 0;

  const fetchFn = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body, headers: options.headers });
    const respFactory = sequences[idx] ?? sequences[sequences.length - 1];
    idx++;
    return respFactory(url, options);
  };

  fetchFn.calls = calls;
  return fetchFn;
}

const SAMPLE_RECORDS_WITH_PRICE = [
  {
    property_id:     'abc123',
    currency:        'EUR',
    pricing_details: { rate_per_night: 85, service_fee: 12, total: 97 },
    total_price:     97,
    availability:    true,
    available_dates: ['2026-10-01', '2026-10-02'],
    details:         ['4 guests', '2 bedrooms', '3 beds', '1 bath'],
    ratings:         4.8,
    lat:             48.73,
    long:            2.29,
  },
  {
    property_id:     'def456',
    currency:        'EUR',
    pricing_details: { rate_per_night: 60, service_fee: 8, total: 68 },
    total_price:     68,
    availability:    true,
    available_dates: [],
    details:         ['2 guests', 'Studio', '1 bed', '1 bath'],
    ratings:         4.5,
    lat:             48.72,
    long:            2.31,
  },
];

const SAMPLE_RECORDS_NULL_PRICE = [
  {
    property_id:     'ghi789',
    currency:        'EUR',
    pricing_details: null,
    total_price:     null,
    availability:    null,
    available_dates: null,
    details:         ['3 guests', '1 bedroom', '2 beds'],
    ratings:         null,
    lat:             null,
    long:            null,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── BD-01 : previewMode makes zero network calls ──────────────────────────────
console.log('\n── BD-01 : previewMode makes zero network calls ──');

await test('BD-01 previewMode completes with keyPresent=false without any network IO', async () => {
  // Call previewMode without a key — should never touch network
  const saved = process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_API_KEY;
  try {
    const result = await previewMode({ location: 'Massy, France', currency: 'EUR' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.keyPresent, false);
    assert.strictEqual(result.location, 'Massy, France');
    assert.strictEqual(result.currency, 'EUR');
  } finally {
    if (saved !== undefined) process.env.BRIGHTDATA_API_KEY = saved;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-02 : executeMode without API key aborts before network ─────────────────
console.log('\n── BD-02 : executeMode without API key aborts before network ──');

await test('BD-02 executeMode returns abort=missing_api_key and calls no fetch', async () => {
  const saved = process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_API_KEY;
  let fetchCalled = false;
  const fetchFn = async () => { fetchCalled = true; };
  try {
    const result = await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn,
      pollIntervalMs: 1,
      maxWaitMs:      100,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.abort, 'missing_api_key');
    assert.strictEqual(fetchCalled, false, 'fetchFn must not have been called');
  } finally {
    if (saved !== undefined) process.env.BRIGHTDATA_API_KEY = saved;
    else delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-03 : exactly one trigger POST ─────────────────────────────────────────
console.log('\n── BD-03 : exactly one trigger POST ──');

await test('BD-03 executeMode issues exactly one POST (trigger) then only GETs', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd03';
  const responses = [
    () => makeTriggerResponse('snap-bd03'),              // trigger
    () => makeProgressResponse('ready'),                 // poll 1
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE), // snapshot
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const posts = fetchFn.calls.filter(c => c.method === 'POST');
    assert.strictEqual(posts.length, 1, `expected 1 POST, got ${posts.length}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-04 : correct dataset_id in trigger URL ─────────────────────────────────
console.log('\n── BD-04 : correct dataset_id in trigger URL ──');

await test('BD-04 trigger URL contains dataset_id=gd_ld7ll037kqy322v05', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd04';
  const responses = [
    () => makeTriggerResponse('snap-bd04'),
    () => makeProgressResponse('ready'),
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const triggerCall = fetchFn.calls[0];
    assert.ok(triggerCall.url.includes(`dataset_id=${DATASET_ID}`),
      `trigger URL must contain dataset_id=${DATASET_ID}, got: ${triggerCall.url}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-05 : discover_new + discover_by=location ───────────────────────────────
console.log('\n── BD-05 : discover_new + discover_by=location ──');

await test('BD-05 trigger URL contains type=discover_new and discover_by=location', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd05';
  const responses = [
    () => makeTriggerResponse('snap-bd05'),
    () => makeProgressResponse('ready'),
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const triggerUrl = fetchFn.calls[0].url;
    assert.ok(triggerUrl.includes('type=discover_new'),      `URL missing type=discover_new: ${triggerUrl}`);
    assert.ok(triggerUrl.includes('discover_by=location'),   `URL missing discover_by=location: ${triggerUrl}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-06 : exactly one input object in body ──────────────────────────────────
console.log('\n── BD-06 : exactly one input object in body ──');

await test('BD-06 trigger body is an array of exactly one object', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd06';
  const responses = [
    () => makeTriggerResponse('snap-bd06'),
    () => makeProgressResponse('ready'),
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const triggerCall = fetchFn.calls[0];
    const body = JSON.parse(triggerCall.body);
    assert.ok(Array.isArray(body),         'trigger body must be array');
    assert.strictEqual(body.length, 1,     `trigger body must have 1 element, got ${body.length}`);
    assert.strictEqual(typeof body[0], 'object', 'trigger body[0] must be object');
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-07 : EUR currency sent correctly ──────────────────────────────────────
console.log('\n── BD-07 : EUR currency sent correctly ──');

await test('BD-07 trigger body[0].currency === "EUR" when currency=EUR', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd07';
  const responses = [
    () => makeTriggerResponse('snap-bd07'),
    () => makeProgressResponse('ready'),
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const body = JSON.parse(fetchFn.calls[0].body);
    assert.strictEqual(body[0].currency, 'EUR', `expected currency EUR, got ${body[0].currency}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-08 : limit_per_input=10 in trigger URL ─────────────────────────────────
console.log('\n── BD-08 : limit_per_input=10 in trigger URL ──');

await test('BD-08 trigger URL contains limit_per_input=10', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd08';
  const responses = [
    () => makeTriggerResponse('snap-bd08'),
    () => makeProgressResponse('ready'),
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const triggerUrl = fetchFn.calls[0].url;
    assert.ok(
      triggerUrl.includes(`limit_per_input=${MAX_RETURNED_RECORDS}`),
      `URL must include limit_per_input=${MAX_RETURNED_RECORDS}, got: ${triggerUrl}`
    );
    assert.strictEqual(MAX_RETURNED_RECORDS, 10, 'MAX_RETURNED_RECORDS must be 10');
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-09 : snapshot_id captured from trigger ─────────────────────────────────
console.log('\n── BD-09 : snapshot_id captured from trigger ──');

await test('BD-09 result includes snapshotId from trigger response', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd09';
  const snapshotId = 'snap-unique-bd09';
  const responses = [
    () => makeTriggerResponse(snapshotId),
    () => makeProgressResponse('ready'),
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    const result = await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    assert.strictEqual(result.snapshotId, snapshotId, `expected snapshotId=${snapshotId}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-10 : polling ready path → success ─────────────────────────────────────
console.log('\n── BD-10 : polling ready path → success ──');

await test('BD-10 polling status=ready → ok=true with recordCount', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd10';
  const responses = [
    () => makeTriggerResponse('snap-bd10'),
    () => makeProgressResponse('running'),  // poll 1: still running
    () => makeProgressResponse('ready'),    // poll 2: ready
    () => makeSnapshotResponse(SAMPLE_RECORDS_WITH_PRICE),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    const result = await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.recordCount, SAMPLE_RECORDS_WITH_PRICE.length);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-11 : polling failed path → abort ──────────────────────────────────────
console.log('\n── BD-11 : polling failed path → abort ──');

await test('BD-11 polling status=failed → ok=false abort=job_failed', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd11';
  const responses = [
    () => makeTriggerResponse('snap-bd11'),
    () => makeProgressResponse('failed'),   // poll 1: failed
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    const result = await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.abort.startsWith('job_'), `abort must start with job_, got ${result.abort}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-12 : polling timeout ───────────────────────────────────────────────────
console.log('\n── BD-12 : polling timeout ──');

await test('BD-12 deadline exceeded → ok=false abort=poll_timeout', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd12';
  let pollCount = 0;
  const fetchFn = async (url, opts) => {
    if ((opts?.method || 'GET') === 'POST') {
      return makeTriggerResponse('snap-bd12');
    }
    pollCount++;
    // Always return running — we want timeout
    return makeProgressResponse('running');
  };
  try {
    // maxWaitMs=50ms, pollIntervalMs=1ms — will timeout quickly
    const result = await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 50,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.abort, 'poll_timeout');
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-13 : no second trigger on failure ─────────────────────────────────────
console.log('\n── BD-13 : no second trigger on failure ──');

await test('BD-13 no second POST even when job fails', async () => {
  process.env.BRIGHTDATA_API_KEY = 'test-token-bd13';
  const responses = [
    () => makeTriggerResponse('snap-bd13'),
    () => makeProgressResponse('aborted'),
  ];
  const fetchFn = makeMockFetch(responses);
  try {
    await executeMode({ location: 'Massy, France', currency: 'EUR' }, {
      fetchFn, pollIntervalMs: 1, maxWaitMs: 5000,
    });
    const posts = fetchFn.calls.filter(c => c.method === 'POST');
    assert.strictEqual(posts.length, 1, `must have exactly 1 POST even after failure, got ${posts.length}`);
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
  }
});

// ── BD-14 : API token never hardcoded in source ───────────────────────────────
console.log('\n── BD-14 : API token never hardcoded in source ──');

await test('BD-14 tool source does not hardcode any BRIGHTDATA_API_KEY value', async () => {
  // Must read key ONLY from process.env — not hardcoded
  assert.ok(!TOOL_SRC.includes('Bearer bd_'),          'must not contain hardcoded Bearer bd_ token');
  assert.ok(!TOOL_SRC.includes("BRIGHTDATA_API_KEY = '"), 'must not assign a hardcoded key value (single-quote)');
  assert.ok(!TOOL_SRC.includes('BRIGHTDATA_API_KEY = "'),  'must not assign a hardcoded key value (double-quote)');
  // The Authorization header value (token variable) must never be passed to any console call
  const nonCommentLines = TOOL_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const nonCommentSrc = nonCommentLines.join('\n');
  assert.ok(
    !/console\.\w+\s*\([^)]*Authorization/s.test(nonCommentSrc),
    'Authorization header value must never appear inside a console.* call'
  );
  assert.ok(
    !/console\.\w+\s*\([^)]*\$\{token\}/s.test(nonCommentSrc),
    'API token variable must never be passed directly to console output'
  );
});

// ── BD-15 : pricingDetailsFields populated when pricing_details is object ─────
console.log('\n── BD-15 : pricingDetailsFields populated ──');

await test('BD-15 analyzeRecords reports pricingDetailsFields when pricing_details is object', async () => {
  const result = analyzeRecords(SAMPLE_RECORDS_WITH_PRICE, 'EUR');
  assert.ok(result.pricePresent > 0,               'pricePresent should be > 0');
  assert.ok(Array.isArray(result.pricingDetailsFields), 'pricingDetailsFields must be array');
  assert.ok(result.pricingDetailsFields.length > 0, 'pricingDetailsFields must have entries');
  assert.ok(result.pricingDetailsFields.includes('rate_per_night'), 'must include rate_per_night');
});

// ── BD-16 : null pricing_details reported as null ─────────────────────────────
console.log('\n── BD-16 : null pricing_details reported ──');

await test('BD-16 analyzeRecords reports priceNull=count when pricing_details is null', async () => {
  const result = analyzeRecords(SAMPLE_RECORDS_NULL_PRICE, 'EUR');
  assert.strictEqual(result.pricePresent, 0,                    'pricePresent must be 0');
  assert.strictEqual(result.priceNull,    SAMPLE_RECORDS_NULL_PRICE.length, 'priceNull must match record count');
  assert.strictEqual(result.pricingDetailsFields, null,         'pricingDetailsFields must be null');
  assert.ok(result.pricingDetailsType.includes('null'),         'pricingDetailsType must indicate null');
});

// ── BD-17 : all EUR → allCurrencyMatch=true ───────────────────────────────────
console.log('\n── BD-17 : all EUR → allCurrencyMatch=true ──');

await test('BD-17 analyzeRecords allCurrencyMatch=true when all records return EUR', async () => {
  const result = analyzeRecords(SAMPLE_RECORDS_WITH_PRICE, 'EUR');
  assert.strictEqual(result.allCurrencyMatch, true, 'allCurrencyMatch must be true for all-EUR records');
  assert.deepStrictEqual(result.currencyValues, ['EUR'], 'currencyValues must be ["EUR"]');
});

// ── BD-18 : currency mismatch → allCurrencyMatch=false ───────────────────────
console.log('\n── BD-18 : currency mismatch → allCurrencyMatch=false ──');

await test('BD-18 analyzeRecords allCurrencyMatch=false when a record returns wrong currency', async () => {
  const mixed = [
    { ...SAMPLE_RECORDS_WITH_PRICE[0], currency: 'USD' },
    { ...SAMPLE_RECORDS_WITH_PRICE[1], currency: 'EUR' },
  ];
  const result = analyzeRecords(mixed, 'EUR');
  assert.strictEqual(result.allCurrencyMatch, false, 'allCurrencyMatch must be false when currencies differ');
});

// ── BD-19 : availability field present ───────────────────────────────────────
console.log('\n── BD-19 : availability field ──');

await test('BD-19 analyzeRecords reports availPresent > 0 when availability is set', async () => {
  const result = analyzeRecords(SAMPLE_RECORDS_WITH_PRICE, 'EUR');
  assert.ok(result.availPresent > 0, 'availPresent must be > 0 when records have availability field');
});

// ── BD-20 : available_dates inspection ───────────────────────────────────────
console.log('\n── BD-20 : available_dates inspection ──');

await test('BD-20 analyzeRecords reports availDatesSampleLen when available_dates present', async () => {
  const result = analyzeRecords(SAMPLE_RECORDS_WITH_PRICE, 'EUR');
  // First record has 2 available_dates
  assert.ok(result.availDatesSampleLen !== null,  'availDatesSampleLen must not be null');
  assert.strictEqual(result.availDatesSampleLen, 2, 'availDatesSampleLen must be 2');
});

// ── BD-21 : parseBedrooms → 2 ────────────────────────────────────────────────
console.log('\n── BD-21 : parseBedrooms "2 bedrooms" → 2 ──');

await test('BD-21 parseBedrooms returns 2 for details containing "2 bedrooms"', async () => {
  assert.strictEqual(parseBedrooms(['4 guests', '2 bedrooms', '3 beds', '1 bath']), 2);
  assert.strictEqual(parseBedrooms(['2 guests', '1 bedroom', '1 bed']), 1);
  assert.strictEqual(parseBedrooms(['8 guests', '3 bedrooms', '5 beds']), 3);
  assert.strictEqual(parseBedrooms(null), null);
  assert.strictEqual(parseBedrooms([]), null);
  assert.strictEqual(parseBedrooms(['4 guests', '2 beds', '1 bath']), null);
});

// ── BD-22 : parseBedrooms studio → 0 ─────────────────────────────────────────
console.log('\n── BD-22 : parseBedrooms "Studio" → 0 ──');

await test('BD-22 parseBedrooms returns 0 for details containing "Studio"', async () => {
  assert.strictEqual(parseBedrooms(['2 guests', 'Studio', '1 bed', '1 bath']), 0);
  assert.strictEqual(parseBedrooms(['studio loft', '1 bed']), 0);
  // Non-studio, non-bedroom entry → null
  assert.strictEqual(parseBedrooms(['4 guests', '2 beds']), null);
});

// ── BD-23 : max 3 sampled inspections ────────────────────────────────────────
console.log('\n── BD-23 : max 3 sampled inspections ──');

await test('BD-23 analyzeRecords sampledInspections has at most 3 entries even with 10 records', async () => {
  const tenRecords = Array.from({ length: 10 }, (_, i) => ({
    property_id:     `prop-${i}`,
    currency:        'EUR',
    pricing_details: null,
    total_price:     null,
    availability:    true,
    available_dates: [],
    details:         [`${i + 1} bedrooms`],
    ratings:         4.0,
    lat:             48.0 + i * 0.01,
    long:            2.0 + i * 0.01,
  }));
  const result = analyzeRecords(tenRecords, 'EUR');
  assert.ok(result.sampledInspections.length <= 3,
    `sampledInspections must be ≤ 3, got ${result.sampledInspections.length}`);
  assert.strictEqual(result.total, 10, 'total must still be 10');
});

// ── BD-24 : no raw PII in inspectRecord ──────────────────────────────────────
console.log('\n── BD-24 : no raw URL/host/address/description in inspectRecord ──');

await test('BD-24 inspectRecord output topLevelFields excludes all REDACTED_FIELDS', async () => {
  const piiRecord = {
    url:               'https://www.airbnb.com/rooms/123',
    final_url:         'https://www.airbnb.com/rooms/123?foo=bar',
    listing_name:      'Beautiful Flat in Massy',
    host_details:      { name: 'Jean-Pierre', id: 99 },
    description:       'A lovely place to stay.',
    images:            ['https://cdn.airbnb.com/img/1.jpg'],
    reviews:           [{ text: 'Great stay!', author: 'Anna' }],
    address:           '18 rue Gambetta',
    amenities:         ['WiFi', 'Parking'],
    property_id:       'prop-pii-test',
    currency:          'EUR',
    pricing_details:   null,
    availability:      true,
    available_dates:   [],
    details:           ['2 guests', '1 bedroom'],
    ratings:           4.7,
    lat:               48.73,
    long:              2.29,
  };
  const result = inspectRecord(piiRecord, 0);
  const piiKeys = ['url', 'final_url', 'listing_name', 'host_details',
                   'description', 'images', 'reviews', 'address', 'amenities'];
  piiKeys.forEach(k => {
    assert.ok(!result.topLevelFields.includes(k),
      `topLevelFields must NOT include "${k}" (redacted field)`);
  });
  // Non-PII fields should still be present in topLevelFields
  assert.ok(result.topLevelFields.includes('currency') || result.topLevelFields.includes('ratings') ||
    result.topLevelFields.includes('availability'),
    'topLevelFields must include safe non-redacted fields');
});

// ── BD-25 : no pg / Pool imports ─────────────────────────────────────────────
console.log('\n── BD-25 : no DB module imports ──');

await test('BD-25 tool source does not import pg, Pool, or any DB connection module', async () => {
  assert.ok(!TOOL_SRC.includes("require('pg')"),            'must not import pg');
  assert.ok(!TOOL_SRC.includes('require("pg")'),            'must not import pg (double quotes)');
  assert.ok(!TOOL_SRC.includes("new Pool("),                'must not instantiate Pool');
  assert.ok(!TOOL_SRC.includes("new Client("),              'must not instantiate pg Client');
  assert.ok(!TOOL_SRC.includes('DATABASE_URL'),             'must not reference DATABASE_URL');
});

// ── BD-26 : no channex imports ────────────────────────────────────────────────
console.log('\n── BD-26 : no Channex module imports ──');

await test('BD-26 tool source does not import channex or call channex functions', async () => {
  assert.ok(!TOOL_SRC.includes("require('../channex')"),   'must not import ../channex');
  assert.ok(!TOOL_SRC.includes("require('./channex')"),    'must not import ./channex');
  // Check non-comment lines only — the prohibited list appears in the docblock comment
  const nonCommentSrc = TOOL_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  assert.ok(!/ triggerChannexRatesSync\s*\(/.test(nonCommentSrc), 'must not call triggerChannexRatesSync()');
  assert.ok(!/ sendBookingMessage\s*\(/.test(nonCommentSrc),      'must not call sendBookingMessage()');
});

// ── BD-27 : no pricing execution imports ─────────────────────────────────────
console.log('\n── BD-27 : no pricing execution module imports ──');

await test('BD-27 tool source does not import dynamic-pricing or pricing execution modules', async () => {
  assert.ok(!TOOL_SRC.includes("require('../routes/dynamic-pricing-cron')"), 'must not import dynamic-pricing-cron');
  assert.ok(!TOOL_SRC.includes("require('./dynamic-pricing-cron')"),          'must not import dynamic-pricing-cron');
  // Check non-comment lines only — the prohibited list appears in the docblock comment
  const nonCommentSrc = TOOL_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  assert.ok(!/ runDynamicPricingForOneProperty\s*\(/.test(nonCommentSrc),  'must not call runDynamicPricingForOneProperty()');
  assert.ok(!/ applyDynamicPricingForProperty\s*\(/.test(nonCommentSrc),   'must not call applyDynamicPricingForProperty()');
  assert.ok(!/ publishEffectivePricing\s*\(/.test(nonCommentSrc),          'must not call publishEffectivePricing()');
  assert.ok(!/ writeScrapeResult\s*\(/.test(nonCommentSrc),                'must not call writeScrapeResult()');
  assert.ok(!/ scheduleMarketRefresh\s*\(/.test(nonCommentSrc),            'must not call scheduleMarketRefresh()');
  assert.ok(!/ priceProperty\s*\(/.test(nonCommentSrc),                    'must not call priceProperty()');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();
