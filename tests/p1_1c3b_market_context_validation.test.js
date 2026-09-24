#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.1-C3B Market Context Validation + Stale Scrape Protection
 *
 * Groupes :
 *   MC-01–MC-05  : live_wrong_location — comportement et sémantique
 *   MC-06–MC-08  : legacy_unverified_location — comportement et sémantique
 *   MC-09–MC-11  : context_unavailable — comportement et sémantique
 *   MC-12–MC-15  : provenance toujours prioritaire (B11) + missing
 *   MC-16–MC-18  : marketOverride explicitement null pour les statuts non-usable
 *   MC-19–MC-20  : source checks — callers passent le propertyContextKey
 *   MC-21–MC-30  : writeScrapeResult — protection contre le scrape obsolète
 *   MC-31–MC-35  : invariants de régression (TTL, clock skew, latest row, no WHERE filter)
 *   MC-36–MC-43  : parité JS/SQL, atomicité transaction, sécurité I/O
 *
 * Exécution : node tests/p1_1c3b_market_context_validation.test.js
 * Aucun appel DB réel. Aucun appel Apify. Aucun appel Channex.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); console.log(`  ✅  ${name}`); passed++; }
  catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message }); failed++;
  }
}

// ── Modules ───────────────────────────────────────────────────────────────────
const { resolveMarketData }    = require('../routes/market-data-resolver');
const { writeScrapeResult }    = require('../routes/dynamic-pricing-cron');
const { computeMarketContextKey } = require('../routes/market-context-key');

// ── Source text ───────────────────────────────────────────────────────────────
const CRON_SRC    = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
const TRIGGER_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-recalc-trigger.js'), 'utf8');

// ── Helpers ───────────────────────────────────────────────────────────────────
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const NOW    = new Date('2026-09-24T10:00:00.000Z');

function scrapedAtAge(ageMs) {
  return new Date(NOW.getTime() - ageMs).toISOString();
}

function makeResolverPool(row) {
  return {
    async query(sql) {
      if (/from market_data/i.test(sql)) return { rows: row ? [row] : [] };
      throw new Error('Unexpected query: ' + sql.slice(0, 80));
    },
  };
}

// writeScrapeResult mock pool — transaction-based (R3 refactor)
// propRow = null → property not found; selectFails/upsertFails → throw on those ops
function makeTxPool({ propRow, selectFails = false, upsertFails = false } = {}) {
  let lastClient = null;
  const pool = {
    async connect() {
      let released = false;
      const calls = [];
      const client = {
        async query(sql) {
          const t = sql.trim();
          calls.push(t.slice(0, 30));
          if (/^BEGIN$/i.test(t))    return {};
          if (/^ROLLBACK$/i.test(t)) return {};
          if (/^COMMIT$/i.test(t))   return {};
          if (/SELECT.*FROM properties.*FOR UPDATE/is.test(sql)) {
            if (selectFails) throw new Error('simulated SELECT failure');
            return { rows: propRow ? [propRow] : [] };
          }
          if (/INSERT INTO market_data/i.test(sql)) {
            if (upsertFails) throw new Error('simulated UPSERT failure');
            return { rowCount: 1 };
          }
          throw new Error('Unexpected query: ' + sql.slice(0, 50));
        },
        release() { released = true; },
        get released() { return released; },
        get calls() { return [...calls]; },
      };
      lastClient = client;
      return client;
    },
  };
  return { pool, getLastClient: () => lastClient };
}

// Property rows that produce known context keys via computeMarketContextKey
const PROP_FR  = { country_code: 'FR', latitude: '48.856600', longitude: '2.352200' };   // → KEY_FR
const PROP_FR2 = { country_code: 'FR', latitude: '43.296300', longitude: '5.369800' };   // → KEY_FR2
const PROP_NULL = { country_code: null, latitude: null, longitude: null };                 // → null

const KEY_FR  = 'FR:48.86:2.35';
const KEY_FR2 = 'FR:43.30:5.37';  // different French city (Marseille)
const FRESH_ROW = {
  data_source: 'apify_live',
  scraped_at:  scrapedAtAge(7 * 24 * 60 * 60 * 1000),
  median_price: 120, occupancy_rate: 0.7, comparable_count: 15, tension_level: 'medium',
  week_start: '2026-09-22',
};

// ── MC-01–MC-05 : live_wrong_location ─────────────────────────────────────────
(async () => {

console.log('\n── MC-01–MC-05 : live_wrong_location ──');

await test('MC-01 current geo + different key + apify_live → live_wrong_location + usable=false', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR2 };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'live_wrong_location');
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
});

await test('MC-02 current geo + matching fresh key → live_fresh', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'live_fresh');
  assert.strictEqual(r.usable, true);
  assert.ok(r.market !== null);
});

await test('MC-03 current geo + matching stale key → live_stale', async () => {
  const row = { ...FRESH_ROW,
    market_context_key: KEY_FR,
    scraped_at: scrapedAtAge(15 * 24 * 60 * 60 * 1000),
  };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'live_stale');
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
});

await test('MC-04 live_wrong_location trusted=true (provenance préservée)', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR2 };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.trusted, true, 'wrong_location doit être trusted=true (apify_live)');
});

await test('MC-05 live_wrong_location isMock=false (auto-push non bloqué)', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR2 };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false, 'wrong_location ne doit pas bloquer auto-push');
});

console.log('\n── MC-06–MC-08 : legacy_unverified_location ──');

await test('MC-06 current geo + legacy NULL row → legacy_unverified_location + usable=false', async () => {
  const row = { ...FRESH_ROW, market_context_key: null };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'legacy_unverified_location');
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
});

await test('MC-07 legacy_unverified_location trusted=true', async () => {
  const row = { ...FRESH_ROW, market_context_key: null };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.trusted, true);
});

await test('MC-08 legacy_unverified_location isMock=false (auto-push non bloqué)', async () => {
  const row = { ...FRESH_ROW, market_context_key: null };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false);
});

console.log('\n── MC-09–MC-11 : context_unavailable ──');

await test('MC-09 pas de geo property + row NULL → live_fresh (comportement legacy P1.0-B)', async () => {
  const row = { ...FRESH_ROW, market_context_key: null };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: null, now: NOW,
  });
  assert.strictEqual(r.status, 'live_fresh', 'Legacy null/null doit conserver live_fresh');
  assert.strictEqual(r.usable, true);
});

await test('MC-10 pas de geo property + row avec clé → context_unavailable + usable=false', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: null, now: NOW,
  });
  assert.strictEqual(r.status, 'context_unavailable');
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
});

await test('MC-11 context_unavailable trusted=true pour apify_live + isMock=false', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: null, now: NOW,
  });
  assert.strictEqual(r.trusted, true);
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false, 'context_unavailable ne doit pas bloquer auto-push');
});

console.log('\n── MC-12–MC-15 : provenance prioritaire + missing ──');

await test('MC-12 mock + matching location → toujours mock / bloqué', async () => {
  const row = { ...FRESH_ROW, data_source: 'mock', market_context_key: KEY_FR };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'mock', 'Mock ne devient pas live_fresh même si clé correspondante');
  assert.strictEqual(r.trusted, false);
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, true);
});

await test('MC-13 mock + wrong location → toujours mock (pas live_wrong_location)', async () => {
  const row = { ...FRESH_ROW, data_source: 'mock', market_context_key: KEY_FR2 };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'mock', 'Mock + mauvaise localisation doit rester mock');
  assert.strictEqual(r.trusted, false);
});

await test('MC-14 unknown + wrong location → toujours unknown / bloqué', async () => {
  const row = { ...FRESH_ROW, data_source: 'unknown', market_context_key: KEY_FR2 };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'unknown');
  assert.strictEqual(r.trusted, false);
});

await test('MC-15 missing → status=missing, market=null, isMock=false, push autorisé', async () => {
  const r = await resolveMarketData(makeResolverPool(null), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.status, 'missing');
  assert.strictEqual(r.market, null);
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false);
});

console.log('\n── MC-16–MC-18 : marketOverride explicitement null pour statuts non-usable ──');

await test('MC-16 wrong_location marketOverride = null (resolution.market === null)', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR2 };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.market, null, 'resolution.market doit être null pour wrong_location');
  assert.strictEqual(r.usable, false);
});

await test('MC-17 legacy_unverified_location marketOverride = null', async () => {
  const row = { ...FRESH_ROW, market_context_key: null };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW,
  });
  assert.strictEqual(r.market, null);
  assert.strictEqual(r.usable, false);
});

await test('MC-18 context_unavailable marketOverride = null', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR };
  const r = await resolveMarketData(makeResolverPool(row), {
    propertyId: 'p1', propertyContextKey: null, now: NOW,
  });
  assert.strictEqual(r.market, null);
  assert.strictEqual(r.usable, false);
});

console.log('\n── MC-19–MC-20 : source checks callers ──');

await test('MC-19 daily refresh (runDailyPricingRefresh) lit le geo et appelle computeMarketContextKey', async () => {
  const dailySelect = CRON_SRC.match(
    /SELECT pc\.\*,\s*p\.name AS property_name[\s\S]*?FROM pricing_config pc[\s\S]*?WHERE pc\.is_active = TRUE/
  )?.[0] || '';
  assert.ok(/p\.latitude/.test(dailySelect),  'latitude absent du SELECT daily refresh');
  assert.ok(/p\.longitude/.test(dailySelect), 'longitude absent du SELECT daily refresh');
  assert.ok(/p\.country_code/.test(dailySelect), 'country_code absent du SELECT daily refresh');
  assert.ok(/computeMarketContextKey/.test(CRON_SRC), 'computeMarketContextKey non appelé dans cron');
  assert.ok(/propertyContextKey/.test(CRON_SRC), 'propertyContextKey non passé au resolver dans cron');
});

await test('MC-20 booking recalc (runRecalc) lit le geo et passe propertyContextKey au resolver', async () => {
  assert.ok(/p\.latitude/.test(TRIGGER_SRC),    'latitude absent du SELECT recalc trigger');
  assert.ok(/p\.longitude/.test(TRIGGER_SRC),   'longitude absent du SELECT recalc trigger');
  assert.ok(/p\.country_code/.test(TRIGGER_SRC),'country_code absent du SELECT recalc trigger');
  assert.ok(/computeMarketContextKey/.test(TRIGGER_SRC), 'computeMarketContextKey absent de pricing-recalc-trigger.js');
  assert.ok(/propertyContextKey/.test(TRIGGER_SRC), 'propertyContextKey non passé au resolver dans trigger');
});

console.log('\n── MC-21–MC-30 : writeScrapeResult — protection stale scrape ──');

const BASE_WRITE_ARGS = {
  userId: 'u1', propertyId: 'p1', weekStart: '2026-09-22',
  marketStats: { median: 120, p25: 90, p75: 150, occupancy: 0.7, count: 15, tensionLevel: 'medium' },
  zoneLabel: 'Paris', dataSource: 'apify_live',
};

await test('MC-21 scrape B, propriété reste B → écriture acceptée (written=true)', async () => {
  const { pool } = makeTxPool({ propRow: PROP_FR });
  const result = await writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR });
  assert.strictEqual(result.written, true);
});

await test('MC-22 scrape B, propriété devient C avant écriture → écriture refusée (written=false)', async () => {
  const { pool } = makeTxPool({ propRow: PROP_FR2 }); // current geo = FR2 ≠ captured FR
  const result = await writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR });
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.reason, 'context_stale');
});

await test('MC-23 après refus, written=false empêche applyDynamicPricingForProperty (vérif source)', async () => {
  assert.ok(
    /writeResult\.written[\s\S]{0,200}continue/.test(CRON_SRC) ||
    /writeResult\.written[\s\S]{0,200}return/.test(CRON_SRC),
    'runDynamicPricingJob ne branche pas sur writeResult.written avant continue'
  );
  assert.ok(
    /writeResultOne\.written[\s\S]{0,200}return/.test(CRON_SRC),
    'runDynamicPricingForOneProperty ne branche pas sur writeResultOne.written avant return'
  );
});

await test('MC-24 captured null + current null → écriture autorisée (legacy)', async () => {
  const { pool } = makeTxPool({ propRow: PROP_NULL });
  const result = await writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: null });
  assert.strictEqual(result.written, true);
});

await test('MC-25 captured null + current devient non-null → écriture refusée', async () => {
  const { pool } = makeTxPool({ propRow: PROP_FR }); // property gained geo during scrape
  const result = await writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: null });
  assert.strictEqual(result.written, false, 'null captured ≠ KEY_FR current → doit être refusé');
  assert.strictEqual(result.reason, 'context_stale');
});

await test('MC-26 mock B + propriété passe à C → mock B refusé', async () => {
  const { pool } = makeTxPool({ propRow: PROP_FR2 }); // current = FR2, captured = FR
  const result = await writeScrapeResult(pool, {
    ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR, dataSource: 'mock',
  });
  assert.strictEqual(result.written, false, 'Un snapshot mock obsolète ne doit pas écrire');
});

await test('MC-27 force=true non présent dans writeScrapeResult (contexte non bypassable)', async () => {
  const fnStart = CRON_SRC.indexOf('async function writeScrapeResult');
  const fnEnd   = CRON_SRC.indexOf('\nmodule.exports', fnStart);
  const fnSrc   = CRON_SRC.slice(fnStart, fnEnd);
  assert.ok(!/\bforce\b/.test(fnSrc), 'writeScrapeResult ne doit pas accepter de paramètre force');
});

await test('MC-28 stale context weekly — guard writeResult.written précède applyDynamicPricingForProperty (ordre source)', async () => {
  const idxGuard = CRON_SRC.indexOf('!writeResult.written');
  const idxApply = CRON_SRC.indexOf('applyDynamicPricingForProperty', idxGuard);
  assert.ok(idxGuard > 0, '!writeResult.written introuvable dans cron');
  assert.ok(idxApply > idxGuard, 'applyDynamicPricingForProperty doit apparaître APRÈS la guard writeResult.written');
});

await test('MC-29 stale context one-property — guard writeResultOne.written précède applyDynamicPricingForProperty', async () => {
  const idxGuard = CRON_SRC.indexOf('!writeResultOne.written');
  const idxApply = CRON_SRC.indexOf('applyDynamicPricingForProperty', idxGuard);
  assert.ok(idxGuard > 0, '!writeResultOne.written introuvable dans cron');
  assert.ok(idxApply > idxGuard, 'applyDynamicPricingForProperty doit apparaître APRÈS la guard writeResultOne.written');
});

await test('MC-30 mêmes contextes concurrents → last-writer-wins (les deux retournent written=true)', async () => {
  const { pool: p1 } = makeTxPool({ propRow: PROP_FR });
  const { pool: p2 } = makeTxPool({ propRow: PROP_FR });
  const r1 = await writeScrapeResult(p1, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR });
  const r2 = await writeScrapeResult(p2, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR });
  assert.strictEqual(r1.written, true);
  assert.strictEqual(r2.written, true);
});

console.log('\n── MC-31–MC-35 : invariants de régression ──');

await test('MC-31 TTL 14j inchangé — live_fresh à 13j, live_stale à 15j', async () => {
  const freshRow = { ...FRESH_ROW, market_context_key: KEY_FR,
    scraped_at: scrapedAtAge(13 * 24 * 60 * 60 * 1000) };
  const staleRow = { ...FRESH_ROW, market_context_key: KEY_FR,
    scraped_at: scrapedAtAge(15 * 24 * 60 * 60 * 1000) };
  const rf = await resolveMarketData(makeResolverPool(freshRow), { propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW });
  const rs = await resolveMarketData(makeResolverPool(staleRow), { propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW });
  assert.strictEqual(rf.status, 'live_fresh');
  assert.strictEqual(rs.status, 'live_stale');
});

await test('MC-32 clock skew — scraped_at 4min dans le futur → fresh (dans tolérance)', async () => {
  const row = { ...FRESH_ROW, market_context_key: KEY_FR,
    scraped_at: new Date(NOW.getTime() + 4 * 60 * 1000).toISOString() };
  const r = await resolveMarketData(makeResolverPool(row), { propertyId: 'p1', propertyContextKey: KEY_FR, now: NOW });
  assert.strictEqual(r.status, 'live_fresh', '4 min de dérive → fresh (dans tolérance 5 min)');
});

await test('MC-33 invariant latest collected state — ORDER BY week_start DESC, scraped_at DESC (source)', async () => {
  const resolverSrc = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');
  assert.ok(/ORDER BY week_start DESC.*scraped_at DESC/s.test(resolverSrc),
    'Le SELECT market_data doit trier par week_start DESC, scraped_at DESC');
});

await test('MC-34 pas de WHERE data_source avant LIMIT dans le resolver (aucun pré-filtre)', async () => {
  const resolverSrc = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');
  const selectBlock = resolverSrc.match(/SELECT[\s\S]*?LIMIT 1/)?.[0] || '';
  assert.ok(!/WHERE.*data_source/.test(selectBlock),
    'Le SELECT market_data ne doit pas filtrer data_source avant le LIMIT');
  assert.ok(!/WHERE.*market_context_key/.test(selectBlock),
    'Le SELECT market_data ne doit pas filtrer market_context_key avant le LIMIT');
});

await test('MC-35 aucun trigger Geoapify→market ajouté (geocodePropertyAsync non modifié pour lancer Apify)', async () => {
  const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const geoAsyncFn = serverSrc.slice(
    serverSrc.indexOf('async function geocodePropertyAsync'),
    serverSrc.indexOf('\n}', serverSrc.indexOf('async function geocodePropertyAsync')) + 2
  );
  assert.ok(!/apify/i.test(geoAsyncFn), 'geocodePropertyAsync ne doit pas appeler Apify (C3C uniquement)');
  assert.ok(!/scheduleMarketRefresh/.test(geoAsyncFn), 'scheduleMarketRefresh absent de geocodePropertyAsync (C3C)');
  assert.ok(!/runDynamicPricing/.test(geoAsyncFn), 'runDynamicPricing absent de geocodePropertyAsync');
});

console.log('\n── MC-36–MC-43 : parité JS/SQL, atomicité, sécurité transaction ──');

await test('MC-36 writeScrapeResult appelle computeMarketContextKey (pas de SQL ROUND)', async () => {
  const fnStart = CRON_SRC.indexOf('async function writeScrapeResult');
  const fnEnd   = CRON_SRC.indexOf('\nmodule.exports', fnStart);
  const fnSrc   = CRON_SRC.slice(fnStart, fnEnd);
  assert.ok(/computeMarketContextKey/.test(fnSrc),
    'writeScrapeResult doit utiliser computeMarketContextKey pour la comparaison');
});

await test('MC-37 writeScrapeResult n\'utilise pas ROUND(latitude ni ROUND(longitude (pas de SQL fingerprint)', async () => {
  const fnStart = CRON_SRC.indexOf('async function writeScrapeResult');
  const fnEnd   = CRON_SRC.indexOf('\nmodule.exports', fnStart);
  const fnSrc   = CRON_SRC.slice(fnStart, fnEnd);
  assert.ok(!/ROUND\s*\(\s*latitude/i.test(fnSrc),
    'writeScrapeResult ne doit pas utiliser ROUND(latitude — SQL fingerprint interdit');
  assert.ok(!/ROUND\s*\(\s*longitude/i.test(fnSrc),
    'writeScrapeResult ne doit pas utiliser ROUND(longitude — SQL fingerprint interdit');
});

await test('MC-38 borne 48.855 — helper JS → "48.85" (IEEE 754, ≠ "48.86" PostgreSQL)', async () => {
  const key = computeMarketContextKey({ countryCode: 'XX', latitude: 48.855, longitude: 0 });
  assert.strictEqual(key, 'XX:48.85:0.00',
    `IEEE 754 : 48.855 doit donner 48.85 (pas 48.86) — obtenu : "${key}"`);
});

await test('MC-39 borne -48.855 — helper JS → "-48.85" (IEEE 754)', async () => {
  const key = computeMarketContextKey({ countryCode: 'XX', latitude: -48.855, longitude: 0 });
  assert.strictEqual(key, 'XX:-48.85:0.00',
    `IEEE 754 : -48.855 doit donner -48.85 — obtenu : "${key}"`);
});

await test('MC-40 propriété change de contexte pendant le scrape → écriture refusée (verrou FOR UPDATE)', async () => {
  const { pool } = makeTxPool({ propRow: PROP_FR2 }); // current = FR2, captured = FR
  const result = await writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR });
  assert.strictEqual(result.written, false, 'Changement de contexte après capture doit être rejeté');
  assert.strictEqual(result.reason, 'context_stale');
});

await test('MC-41 échec SELECT → rollback garanti + client relâché', async () => {
  const { pool, getLastClient } = makeTxPool({ propRow: PROP_FR, selectFails: true });
  await assert.rejects(
    () => writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR }),
    /simulated SELECT failure/
  );
  assert.strictEqual(getLastClient().released, true,
    'client.release() doit être appelé même après une erreur SELECT');
});

await test('MC-42 échec UPSERT → rollback garanti + client relâché', async () => {
  const { pool, getLastClient } = makeTxPool({ propRow: PROP_FR, upsertFails: true });
  await assert.rejects(
    () => writeScrapeResult(pool, { ...BASE_WRITE_ARGS, capturedContextKey: KEY_FR }),
    /simulated UPSERT failure/
  );
  assert.strictEqual(getLastClient().released, true,
    'client.release() doit être appelé même après une erreur UPSERT');
});

await test('MC-43 aucun appel HTTP dans writeScrapeResult (transaction courte, aucun I/O externe)', async () => {
  const fnStart = CRON_SRC.indexOf('async function writeScrapeResult');
  const fnEnd   = CRON_SRC.indexOf('\nmodule.exports', fnStart);
  const fnSrc   = CRON_SRC.slice(fnStart, fnEnd);
  assert.ok(!/\bfetch\b/.test(fnSrc),  'writeScrapeResult ne doit pas utiliser fetch');
  assert.ok(!/\baxios\b/.test(fnSrc),  'writeScrapeResult ne doit pas utiliser axios');
  assert.ok(!/https?\./.test(fnSrc),   'writeScrapeResult ne doit pas appeler https/http');
  assert.ok(!/apify/i.test(fnSrc),     'writeScrapeResult ne doit pas appeler Apify');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  43 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 43) {
  console.error(`⚠️  Attendu 43 tests, ${passed + failed} exécutés`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();
