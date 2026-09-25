#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-G Production Activation & Controlled Rollout
 *
 * B5G-01: MARKET_PRIMARY_PROVIDER=brightdata → resolveProvider()='brightdata'
 * B5G-02: MARKET_PRIMARY_PROVIDER missing → resolveProvider()='apify'
 * B5G-03: MARKET_PRIMARY_PROVIDER=invalid_value → resolveProvider()='apify' (safe)
 * B5G-04: BRIGHTDATA_API_KEY alone does NOT activate BD
 * B5G-05: allowlist set + propertyId in list → resolveProviderForProperty='brightdata'
 * B5G-06: allowlist set + propertyId NOT in list → resolveProviderForProperty='apify'
 * B5G-07: no allowlist + GLOBAL_ENABLED=true → brightdata for all
 * B5G-08: no allowlist + no GLOBAL_ENABLED → apify (safe explicit-opt-in default)
 * B5G-09: MARKET_PRIMARY_PROVIDER=apify + allowlist set → apify (flag wins)
 * B5G-10: null propertyId + allowlist set → apify (unknown ≠ listed)
 * B5G-11: J+14/J+15 date generation correct (timezone-aware)
 * B5G-12: missing dates fail before BD network call
 * B5G-13: BD success → Apify NOT called (Case A)
 * B5G-14: BD network failure → Apify called (Case B)
 * B5G-15: BD timeout → Apify called (Case C)
 * B5G-16: BD zero accepted listings → Apify called (Case D)
 * B5G-17: insufficient BD comparables → quality gate null, no write (Case E)
 * B5G-18: BD currency mismatch → 0 accepted → fallback (Case F)
 * B5G-19: BD invalid stats (p25 > median) → validateBDStats=false (Case G)
 * B5G-20: non-allowlisted property → zero BD calls (Case I)
 * B5G-21: BRIGHTDATA_API_KEY exists + primary=apify → zero BD calls (Case J)
 * B5G-22: primary=brightdata + no allowlist + no GLOBAL → zero BD calls (Case K)
 * B5G-23: pilot tool never imports applyDynamicPricingForProperty (no pricing writes)
 * B5G-24: pilot tool never imports channex (CHANNEX_WRITES=0)
 * B5G-25: BRIGHTDATA_API_KEY value never interpolated in log statements
 *
 * Run: node tests/p1_2b5g_production_activation.test.js
 * LIVE_BRIGHTDATA_CALLS=0  LIVE_APIFY_CALLS=0  DB_WRITES=0  PRICING_WRITES=0  CHANNEX_WRITES=0
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

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
    failed++;
    failures.push({ name, message: err.message });
  }
}

// ── Modules ───────────────────────────────────────────────────

const PROVIDER_PATH = path.join(__dirname, '../services/market-provider.js');
const CRON_PATH     = path.join(__dirname, '../routes/dynamic-pricing-cron.js');
const TOOL_PATH     = path.join(__dirname, '../outils/validate-brightdata-production-rollout.js');
const TOOL_SRC      = fs.readFileSync(TOOL_PATH, 'utf8');
const BD_PROV_PATH  = path.join(__dirname, '../services/providers/brightdata.js');
const BD_PROV_SRC   = fs.readFileSync(BD_PROV_PATH, 'utf8');

const {
  resolveProvider, resolveProviderForProperty, getBrightDataMarketDates, scrape,
} = require(PROVIDER_PATH);

const { validateBDStats, calcProviderMarketStats } = require(CRON_PATH);
const { scrapeWithBrightData }                      = require(BD_PROV_PATH);
const { MIN_COMPARABLES_FALLBACK }                  = require('../services/brightdata-comparable-filter');

// ── Helpers ───────────────────────────────────────────────────

function withEnv(envObj, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(envObj)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(v => { restore(); return v; }, e => { restore(); throw e; });
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

const REF_LAT = 48.5, REF_LON = 2.3;
function degPerKm(km) { return km / 111.2; }
function nAt(n, distKm, opts = {}) {
  return Array.from({ length: n }, (_, i) => ({
    price:             opts.price ?? 200,
    isBooked:          false,
    bedrooms:          null,
    stars:             4.5,
    latitude:          REF_LAT + degPerKm(distKm * 0.95) + i * 0.0001,
    longitude:         REF_LON,
    providerListingId: `id-${distKm}-${i}`,
    guests:            null,
    category:          null,
    availableDates:    null,
  }));
}

// Minimal BD response fixture (EUR, all accepted)
const BD_ITEMS_EUR = Array.from({ length: 10 }, (_, i) => ({
  property_id:     `pid-${i}`,
  currency:        'EUR',
  availability:    true,
  ratings:         4.5,
  lat:             REF_LAT + degPerKm(1) + i * 0.001,
  long:            REF_LON,
  guests:          null,
  category:        null,
  available_dates: null,
  pricing_details: { price_per_night: 200 + i * 10 },
}));

function makeBdFetch(snapshotData) {
  return async (url) => {
    if (url.includes('/trigger'))   return { ok: true, json: async () => ({ snapshot_id: 'snap-b5g' }) };
    if (url.includes('/progress/')) return { ok: true, json: async () => ({ status: 'ready' }) };
    if (url.includes('/snapshot/')) return { ok: true, json: async () => snapshotData };
    throw new Error(`Unexpected BD URL: ${url}`);
  };
}

// ── Main ──────────────────────────────────────────────────────

(async () => {

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  P1.2-B5-G — Production Activation & Controlled Rollout');
console.log('══════════════════════════════════════════════════════════════════════\n');

// ── Phase 1 — Provider flag behavior ─────────────────────────

console.log('── Phase 1: Provider flag behavior ──');

await test('B5G-01: MARKET_PRIMARY_PROVIDER=brightdata → resolveProvider()=brightdata', () => {
  withEnv({ MARKET_PRIMARY_PROVIDER: 'brightdata' }, () => {
    assert.strictEqual(resolveProvider(), 'brightdata');
  });
});

await test('B5G-02: MARKET_PRIMARY_PROVIDER missing → resolveProvider()=apify', () => {
  withEnv({ MARKET_PRIMARY_PROVIDER: undefined }, () => {
    assert.strictEqual(resolveProvider(), 'apify');
  });
});

await test('B5G-03: MARKET_PRIMARY_PROVIDER=invalid_value → resolveProvider()=apify (safe)', () => {
  withEnv({ MARKET_PRIMARY_PROVIDER: 'unknown_provider' }, () => {
    assert.strictEqual(resolveProvider(), 'apify',
      'unknown MARKET_PRIMARY_PROVIDER must default to apify');
  });
});

await test('B5G-04: BRIGHTDATA_API_KEY alone does NOT activate BD', () => {
  withEnv({ MARKET_PRIMARY_PROVIDER: undefined, BRIGHTDATA_API_KEY: 'some-key' }, () => {
    assert.strictEqual(resolveProvider(), 'apify', 'API key alone must not activate BD via resolveProvider');
    assert.strictEqual(resolveProviderForProperty('any-id'), 'apify',
      'API key alone must not activate BD via resolveProviderForProperty');
  });
});

// ── Phase 4 — Pilot allowlist routing ────────────────────────

console.log('\n── Phase 4: Pilot allowlist routing ──');

await test('B5G-05: allowlist set + propertyId in list → brightdata', () => {
  withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: 'u_mmj5c6hq-m6,other-prop',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: undefined,
  }, () => {
    assert.strictEqual(resolveProviderForProperty('u_mmj5c6hq-m6'), 'brightdata');
  });
});

await test('B5G-06: allowlist set + propertyId NOT in list → apify (no BD call)', () => {
  withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: 'u_mmj5c6hq-m6',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: undefined,
  }, () => {
    assert.strictEqual(resolveProviderForProperty('some-other-property'), 'apify',
      'non-listed property must route to apify, not brightdata');
  });
});

await test('B5G-07: no allowlist + GLOBAL_ENABLED=true → brightdata for all', () => {
  withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: 'true',
  }, () => {
    assert.strictEqual(resolveProviderForProperty('any-property-id'), 'brightdata');
    assert.strictEqual(resolveProviderForProperty('another-property'), 'brightdata');
  });
});

await test('B5G-08: no allowlist + no GLOBAL_ENABLED → apify (safe default, global rollout cannot happen accidentally)', () => {
  withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: undefined,
  }, () => {
    assert.strictEqual(resolveProviderForProperty('any-property-id'), 'apify',
      'forgot allowlist + no global flag → must default to apify');
    assert.strictEqual(resolveProviderForProperty('another-property'), 'apify',
      'global rollout cannot happen merely because allowlist was forgotten');
  });
});

await test('B5G-09: MARKET_PRIMARY_PROVIDER=apify + allowlist set → apify (flag wins)', () => {
  withEnv({
    MARKET_PRIMARY_PROVIDER: 'apify',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: 'u_mmj5c6hq-m6',
  }, () => {
    assert.strictEqual(resolveProviderForProperty('u_mmj5c6hq-m6'), 'apify',
      'apify flag must win even if property is in allowlist');
  });
});

await test('B5G-10: null propertyId + allowlist set → apify (unknown ≠ listed)', () => {
  withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: 'u_mmj5c6hq-m6',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: undefined,
  }, () => {
    assert.strictEqual(resolveProviderForProperty(null), 'apify',
      'null propertyId must not be treated as in allowlist');
    assert.strictEqual(resolveProviderForProperty(undefined), 'apify',
      'undefined propertyId must not be treated as in allowlist');
  });
});

// ── Phase 2 — Date generation ─────────────────────────────────

console.log('\n── Phase 2: Date generation ──');

await test('B5G-11: J+14/J+15 dates are correct (Europe/Paris timezone-aware)', () => {
  const result = getBrightDataMarketDates({
    timezone: 'Europe/Paris',
    now: new Date('2026-10-01T10:00:00Z'),
  });
  assert.strictEqual(result.checkIn,  '2026-10-15', `checkIn must be J+14, got ${result.checkIn}`);
  assert.strictEqual(result.checkOut, '2026-10-16', `checkOut must be J+15, got ${result.checkOut}`);
  assert.ok(result.checkOut > result.checkIn, 'checkOut must be strictly after checkIn');
});

await test('B5G-12: missing checkIn fails before BD network call (fail closed before any I/O)', async () => {
  let networkCalled = false;
  const blockingFetch = async () => { networkCalled = true; return {}; };
  await assert.rejects(
    () => scrapeWithBrightData('Paris, France', 10, 'EUR', {
      checkIn:   null,
      checkOut:  null,
      apiKey:    'fake-key-b5g12',
      fetchImpl: blockingFetch,
    }),
    /checkIn requis/
  );
  assert.strictEqual(networkCalled, false, 'no network call must be made when dates are missing');
});

// ── Phase 8 — Fallback test matrix ───────────────────────────

console.log('\n── Phase 8: Fallback test matrix ──');

await test('B5G-13: BD success → Apify NOT called (Case A)', async () => {
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: 'true',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    APIFY_TOKEN: undefined,
  }, async () => {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: makeBdFetch(BD_ITEMS_EUR),
      bdApiKey: 'test-key-b5g13',
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(result.provider, 'brightdata', 'BD success must not invoke Apify');
    assert.strictEqual(result.dataSource, 'brightdata_live');
    assert.strictEqual(result.isMock, false);
    assert.ok(result.listings.length > 0, 'BD must return listings');
  });
});

await test('B5G-14: BD network failure → Apify called (Case B)', async () => {
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: 'true',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    APIFY_TOKEN: undefined,  // forces Apify mock
  }, async () => {
    const failFetch = async () => { throw new Error('Network error B5G14'); };
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: failFetch,
      bdApiKey: 'test-key-b5g14',
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(result.provider, 'apify', 'BD failure must fall back to apify');
    assert.ok(result.isMock === true, 'Apify mock must be used when APIFY_TOKEN absent');
  });
});

await test('B5G-15: BD timeout → Apify called (Case C)', async () => {
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: 'true',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    APIFY_TOKEN: undefined,
  }, async () => {
    // Poll always returns 'running' — with maxWaitMs=20/pollIntervalMs=5 this resolves in ~20ms
    const timeoutFetch = async (url) => {
      if (url.includes('/trigger'))   return { ok: true, json: async () => ({ snapshot_id: 'snap-timeout' }) };
      if (url.includes('/progress/')) return { ok: true, json: async () => ({ status: 'running' }) };
      throw new Error('Unexpected call B5G15');
    };
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl:   timeoutFetch,
      bdApiKey:      'test-key-b5g15',
      maxWaitMs:     20,    // tiny deadline so the poll loop exits fast
      pollIntervalMs: 5,
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(result.provider, 'apify', 'BD timeout must fall back to apify');
  });
});

await test('B5G-16: BD returns 0 accepted listings → Apify called (Case D)', async () => {
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: 'true',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    APIFY_TOKEN: undefined,
  }, async () => {
    // All items have null pricing_details → all rejected → 0 accepted
    const zeroFetch = makeBdFetch([{
      property_id: 'p1', currency: 'EUR', availability: true, ratings: 4,
      lat: 48.5, long: 2.3, pricing_details: null,
    }]);
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: zeroFetch,
      bdApiKey: 'test-key-b5g16',
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(result.provider, 'apify', '0 accepted BD listings must fall back to apify');
  });
});

await test('B5G-17: insufficient BD comparables → quality gate returns null (Case E)', () => {
  // 3 listings within 2km of target — below FALLBACK=5 across all radii → insufficient_comparables
  const threeListings = nAt(3, 2);
  const cfg = {
    latitude:   REF_LAT,
    longitude:  REF_LON,
    max_guests: null,
    timezone:   'Europe/Paris',
    bedrooms:   null,
  };
  const stats = calcProviderMarketStats(threeListings, cfg, 'brightdata_live');
  assert.strictEqual(stats, null,
    `insufficient comparables must return null (quality gate), got ${JSON.stringify(stats)}`);
});

await test('B5G-18: BD currency mismatch → 0 accepted → apify fallback (Case F)', async () => {
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: 'true',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    APIFY_TOKEN: undefined,
  }, async () => {
    // BD returns USD items, we request EUR
    const usdFetch = makeBdFetch([{
      property_id: 'p1', currency: 'USD',  // mismatch
      availability: true, ratings: 4, lat: 48.5, long: 2.3,
      pricing_details: { price_per_night: 150 },
    }]);
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: usdFetch,
      bdApiKey: 'test-key-b5g18',
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(result.provider, 'apify', 'currency mismatch → 0 accepted → apify fallback');
  });
});

await test('B5G-19: BD invalid stats (p25 > median) → validateBDStats=false (Case G)', () => {
  const badStats = { median: 100, p25: 150, p75: 200, occupancy: 50, tensionLevel: 'low', count: 8 };
  assert.strictEqual(validateBDStats(badStats), false, 'p25 > median must fail gate');

  // Confirm valid stats pass
  const goodStats = { median: 200, p25: 150, p75: 250, occupancy: 50, tensionLevel: 'medium', count: 10 };
  assert.strictEqual(validateBDStats(goodStats), true, 'valid stats must pass gate');

  // Confirm median=0 fails
  const zeroMedian = { median: 0, p25: 0, p75: 100, occupancy: 50, tensionLevel: 'low', count: 5 };
  assert.strictEqual(validateBDStats(zeroMedian), false, 'zero median must fail gate');
});

await test('B5G-20: non-allowlisted property → zero BD calls (Case I)', async () => {
  let bdCalled = false;
  const bdSpy = async () => { bdCalled = true; return {}; };
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: 'u_mmj5c6hq-m6',  // only M6
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: undefined,
    APIFY_TOKEN: undefined,
  }, async () => {
    await scrape('Massy, France', 10, 'EUR', {
      propertyId: 'some-other-property',
      bdFetchImpl: bdSpy,
      bdApiKey: 'test-key-b5g20',
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(bdCalled, false, 'BD must not be called for non-allowlisted property');
  });
});

await test('B5G-21: BRIGHTDATA_API_KEY exists + primary=apify → zero BD calls (Case J)', async () => {
  let bdCalled = false;
  const bdSpy = async () => { bdCalled = true; return {}; };
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'apify',
    BRIGHTDATA_API_KEY: 'key-should-not-activate',
    APIFY_TOKEN: undefined,
  }, async () => {
    await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: bdSpy,
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(bdCalled, false, 'API key + primary=apify must not trigger BD');
  });
});

await test('B5G-22: primary=brightdata + no allowlist + no GLOBAL → zero BD calls for any property (Case K)', async () => {
  let bdCalled = false;
  const bdSpy = async () => { bdCalled = true; return {}; };
  await withEnv({
    MARKET_PRIMARY_PROVIDER: 'brightdata',
    MARKET_BRIGHTDATA_PROPERTY_ALLOWLIST: '',
    MARKET_BRIGHTDATA_GLOBAL_ENABLED: undefined,
    APIFY_TOKEN: undefined,
  }, async () => {
    await scrape('Massy, France', 10, 'EUR', {
      propertyId: 'any-property-id',
      bdFetchImpl: bdSpy,
      bdApiKey: 'test-key-b5g22',
      now: new Date('2026-10-01T10:00:00Z'),
    });
    assert.strictEqual(bdCalled, false,
      'without allowlist or global flag, BD must not be called even if primary=brightdata');
  });
});

// ── Phase 5/7 — Pilot tool safety ────────────────────────────

console.log('\n── Phase 5/7: Pilot tool safety ──');

await test('B5G-23: pilot tool never imports applyDynamicPricingForProperty (no pricing writes)', () => {
  assert.ok(
    !TOOL_SRC.includes('applyDynamicPricingForProperty'),
    'pilot tool must never reference applyDynamicPricingForProperty'
  );
  assert.ok(
    !TOOL_SRC.includes('pricing-apply'),
    'pilot tool must not import pricing-apply module'
  );
});

await test('B5G-24: pilot tool never imports channex (CHANNEX_WRITES=0)', () => {
  assert.ok(
    !TOOL_SRC.includes("require('../channex')") &&
    !TOOL_SRC.includes('require("../channex")'),
    'pilot tool must not import channex'
  );
  assert.ok(
    !TOOL_SRC.includes('sendBookingMessage') && !TOOL_SRC.includes('syncRatePlan'),
    'pilot tool must not call Channex APIs'
  );
});

await test('B5G-25: BRIGHTDATA_API_KEY value never interpolated in log statements', () => {
  // Pilot tool must not reference the env var (it never reads it directly)
  assert.ok(
    !TOOL_SRC.includes('process.env.BRIGHTDATA_API_KEY'),
    'pilot tool must not reference BRIGHTDATA_API_KEY'
  );
  // BD provider may read the key but must never log it
  const bdLines = BD_PROV_SRC.split('\n').filter(l => l.includes('BRIGHTDATA_API_KEY'));
  for (const line of bdLines) {
    assert.ok(
      !line.includes('console.log') &&
      !line.includes('console.error') &&
      !line.includes('console.warn'),
      `BRIGHTDATA_API_KEY must not appear in a console statement: ${line.trim()}`
    );
  }
  // Cron observability log must not reference API key
  const CRON_SRC = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
  assert.ok(
    !CRON_SRC.includes('BRIGHTDATA_API_KEY'),
    'cron observability log must not reference BRIGHTDATA_API_KEY'
  );
});

// ── Summary ───────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  Failures:');
  for (const f of failures) console.error(`    ❌  ${f.name}: ${f.message}`);
}
console.log('══════════════════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);

})();
