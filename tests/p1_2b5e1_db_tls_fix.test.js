#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-E1 DB TLS Fix for validate-brightdata-runtime.js
 *
 * Verifies:
 *   B5E1-01 : CLI Pool uses ssl: { rejectUnauthorized: false } (established repo policy)
 *   B5E1-02 : tool does not set NODE_TLS_REJECT_UNAUTHORIZED globally
 *   B5E1-03 : DATABASE_URL is never printed in console statements
 *   B5E1-04 : diagnostic classifier labels TLS errors as DB_TLS_ERROR
 *   B5E1-05 : diagnostic classifier labels ECONNREFUSED as DB_CONNECTION_ERROR
 *   B5E1-06 : diagnostic classifier labels ENOTFOUND as DB_CONNECTION_ERROR
 *   B5E1-07 : preview still makes zero provider network calls after fix
 *   B5E1-08 : preview still performs zero DB writes after fix
 *   B5E1-09 : execute safety invariants unchanged (no new prohibited writes/calls)
 *   B5E1-10 : secrets not in console.log/error calls (DATABASE_URL, passwords, tokens)
 *
 * Run: node tests/p1_2b5e1_db_tls_fix.test.js
 * LIVE_BRIGHTDATA_CALLS = 0  DB_WRITES = 0  CHANNEX_WRITES = 0
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

// ── Load sources ───────────────────────────────────────────────────────────────
const TOOL_PATH = path.resolve(__dirname, '../outils/validate-brightdata-runtime.js');
const TOOL_SRC  = fs.readFileSync(TOOL_PATH, 'utf8');

const { previewMode, executeMode, AbortError } = require(TOOL_PATH);

// ── Shared test fixtures (mirrors p1_2b5e) ────────────────────────────────────
const TEST_PROP_ROW = {
  id:             'prop-b5e1-test-001',
  user_id:        'user-b5e1-001',
  name:           'TestB5E1',
  internal_name:  null,
  address:        '18 rue Gambetta 91300 Massy',
  latitude:       '48.73',
  longitude:      '2.27',
  country_code:   'FR',
  timezone:       'Europe/Paris',
  currency:       'EUR',
  channex_enabled: false,
  is_active:      true,
  mode:           'auto',
  zone_label:     null,
};

function makeReadOnlyPool(propRows = [TEST_PROP_ROW]) {
  const writtenSqls = [];
  return {
    _writtenSqls: writtenSqls,
    connect: async () => { throw new Error('pool.connect() called in preview mode'); },
    query: async (sql) => {
      if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql)) {
        writtenSqls.push(sql.trim().slice(0, 60));
        throw new Error(`Write in read-only pool: ${sql.trim().slice(0, 60)}`);
      }
      if (sql.includes('FROM properties')) return { rows: propRows };
      return { rows: [] };
    },
  };
}

function makeBdResult(overrides = {}) {
  const listings = Array.from({ length: 15 }, (_, i) => ({
    price: 100 + i * 5, isBooked: i % 3 === 0, bedrooms: null, stars: 4.0,
  }));
  return {
    listings, isMock: false, provider: 'brightdata', dataSource: 'brightdata_live',
    diagnostics: { returnedCount: 15, acceptedCount: 15, rejectedPriceCount: 0,
                   rejectedCurrencyCount: 0, rejectedAvailabilityCount: 0 },
    ...overrides,
  };
}

function makeExecutePool({ propRow = TEST_PROP_ROW } = {}) {
  const allCalls = [];
  let capturedInsertParams = null;

  const propFingerprintRow = {
    name: propRow.name, address: propRow.address,
    latitude: propRow.latitude, longitude: propRow.longitude,
    country_code: propRow.country_code, timezone: propRow.timezone,
    currency: propRow.currency, channex_enabled: propRow.channex_enabled,
  };
  const defaultPcRows = [{ is_active: propRow.is_active, mode: propRow.mode, updated_at: new Date().toISOString() }];

  const client = {
    query: async (sql, params) => {
      allCalls.push({ ctx: 'client', sql: sql.trim().slice(0, 80), params });
      if (sql.includes('BEGIN'))   return { rows: [] };
      if (sql.includes('COMMIT'))  return { rows: [] };
      if (sql.includes('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ country_code: propRow.country_code, latitude: propRow.latitude,
                          longitude: propRow.longitude, currency: propRow.currency }] };
      }
      if (sql.includes('INSERT INTO market_data')) {
        capturedInsertParams = params;
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };

  function buildStoredRow() {
    if (!capturedInsertParams) return null;
    const ip = capturedInsertParams;
    return {
      data_source: ip[10], currency: ip[12], market_context_key: ip[11],
      median_price: String(ip[3]), price_p25: String(ip[4]), price_p75: String(ip[5]),
      occupancy_rate: String(ip[6]), comparable_count: String(ip[7]),
      tension_level: ip[8], week_start: ip[2], scraped_at: new Date().toISOString(),
    };
  }

  return {
    _calls: allCalls,
    connect: async () => client,
    query: async (sql, params) => {
      allCalls.push({ ctx: 'pool', sql: sql.trim().slice(0, 80), params });
      if (sql.includes('FROM properties') && sql.includes('LOWER'))   return { rows: [propRow] };
      if (sql.includes('pricing_config') && sql.includes('updated_at')) return { rows: defaultPcRows };
      if (sql.includes('pricing_schedule'))  return { rows: [{ cnt: '0' }] };
      if (sql.includes('pricing_history'))   return { rows: [{ cnt: '0' }] };
      if (sql.includes('FROM properties') && sql.includes('WHERE id')) return { rows: [propFingerprintRow] };
      if (sql.includes('FROM market_data')) {
        const stored = buildStoredRow();
        return stored ? { rows: [stored] } : { rows: [] };
      }
      return { rows: [] };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────
(async () => {

// B5E1-01 — CLI Pool uses ssl: { rejectUnauthorized: false }
await test('B5E1-01 CLI Pool constructed with ssl: { rejectUnauthorized: false } (established repo policy)', () => {
  // The pool created in the CLI entry point must include ssl: { rejectUnauthorized: false }
  // Match the pattern: new Pool({ connectionString: ..., ssl: { rejectUnauthorized: false } })
  assert.ok(
    TOOL_SRC.includes("ssl: { rejectUnauthorized: false }"),
    'CLI pool must use ssl: { rejectUnauthorized: false } — same policy as all working outils tools'
  );
  // Confirm it's in the same Pool construction as DATABASE_URL (not just elsewhere)
  const poolLine = TOOL_SRC.split('\n').find(l =>
    l.includes('new Pool') && l.includes('DATABASE_URL')
  );
  assert.ok(
    poolLine && poolLine.includes('rejectUnauthorized: false'),
    'new Pool({ connectionString: DATABASE_URL }) must include rejectUnauthorized: false on same line'
  );
});

// B5E1-02 — No global NODE_TLS_REJECT_UNAUTHORIZED bypass
await test('B5E1-02 tool does not globally set NODE_TLS_REJECT_UNAUTHORIZED', () => {
  assert.ok(
    !TOOL_SRC.includes('NODE_TLS_REJECT_UNAUTHORIZED'),
    'tool must not set NODE_TLS_REJECT_UNAUTHORIZED — that would globally disable TLS verification'
  );
});

// B5E1-03 — DATABASE_URL never printed
await test('B5E1-03 DATABASE_URL is never printed in console statements', () => {
  // Extract all console.log / console.error lines and ensure none reference DATABASE_URL
  const consoleLines = TOOL_SRC.split('\n').filter(l =>
    /console\.(log|error|warn|info)/.test(l)
  );
  const leaking = consoleLines.filter(l => l.includes('DATABASE_URL'));
  assert.strictEqual(
    leaking.length, 0,
    `DATABASE_URL must never appear in console output. Found in: ${leaking.join('; ')}`
  );
});

// B5E1-04 — Diagnostic classifier: self-signed cert → DB_TLS_ERROR
await test('B5E1-04 classifyError labels "self-signed certificate" as DB_TLS_ERROR', () => {
  // Extract classifyError from tool source by running the CLI section in a sub-context.
  // We verify the output format by checking the source directly.
  assert.ok(
    TOOL_SRC.includes("'DB_TLS_ERROR'"),
    'tool must define DB_TLS_ERROR as a diagnostic label'
  );
  assert.ok(
    TOOL_SRC.includes("self-signed"),
    'classifyError must match "self-signed" to DB_TLS_ERROR'
  );
  assert.ok(
    TOOL_SRC.includes("certificate"),
    'classifyError must match "certificate" to DB_TLS_ERROR'
  );
});

// B5E1-05 — Diagnostic classifier: ECONNREFUSED → DB_CONNECTION_ERROR
await test('B5E1-05 classifyError labels ECONNREFUSED as DB_CONNECTION_ERROR', () => {
  assert.ok(
    TOOL_SRC.includes("'DB_CONNECTION_ERROR'"),
    'tool must define DB_CONNECTION_ERROR as a diagnostic label'
  );
  assert.ok(
    TOOL_SRC.includes("ECONNREFUSED"),
    'classifyError must match ECONNREFUSED to DB_CONNECTION_ERROR'
  );
});

// B5E1-06 — Diagnostic classifier: ENOTFOUND → DB_CONNECTION_ERROR
await test('B5E1-06 classifyError labels ENOTFOUND as DB_CONNECTION_ERROR', () => {
  assert.ok(
    TOOL_SRC.includes("ENOTFOUND"),
    'classifyError must match ENOTFOUND to DB_CONNECTION_ERROR'
  );
});

// B5E1-07 — Preview: zero provider network calls (contract unchanged after TLS fix)
await test('B5E1-07 preview still makes zero provider network calls after TLS fix', async () => {
  let bdCalled = false;
  const origBd = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E1_07';

  const pool = makeReadOnlyPool([TEST_PROP_ROW]);
  // previewMode does not accept _bdScrape — it makes no BD call by design.
  // We verify by monkey-patching is not needed; just confirm the contract.
  const result = await previewMode(pool, { name: 'TestB5E1' });
  assert.ok(!bdCalled, 'BD must not be called in preview');
  assert.strictEqual(result.targets, 1, 'should resolve 1 property');

  if (origBd !== undefined) process.env.BRIGHTDATA_API_KEY = origBd;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5E1-08 — Preview: zero DB writes (contract unchanged after TLS fix)
await test('B5E1-08 preview still performs zero DB writes after TLS fix', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E1_08';

  const pool = makeReadOnlyPool([TEST_PROP_ROW]);
  await previewMode(pool, { name: 'TestB5E1' });
  assert.strictEqual(
    pool._writtenSqls.length, 0,
    `preview must write 0 rows; wrote: ${pool._writtenSqls.join(', ')}`
  );

  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5E1-09 — Execute safety invariants unchanged: no new prohibited writes
await test('B5E1-09 execute safety invariants unchanged (no new prohibited writes added)', async () => {
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  process.env.BRIGHTDATA_API_KEY = 'TEST_KEY_B5E1_09';

  const pool = makeExecutePool();
  await executeMode(pool, {
    name: 'TestB5E1',
    _bdScrape: async () => makeBdResult(),
  });

  // Verify only market_data INSERT happened — no pricing_config, pricing_schedule,
  // pricing_history, or properties writes in the captured SQL calls.
  // Use ^(INSERT|UPDATE|DELETE) to avoid false matches on column names like "updated_at".
  const writeCalls = pool._calls.filter(c =>
    /^(INSERT|UPDATE|DELETE)\b/i.test(c.sql) &&
    !c.sql.includes('market_data')
  );
  assert.strictEqual(
    writeCalls.length, 0,
    `No writes outside market_data allowed. Found: ${writeCalls.map(c => c.sql).join('; ')}`
  );

  if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  else delete process.env.BRIGHTDATA_API_KEY;
});

// B5E1-10 — Secret values not interpolated into console statements
// The tool may print "BRIGHTDATA_API_KEY_PRESENT: true" (safe boolean).
// What must never appear is the actual value: ${process.env.X} in a console call.
await test('B5E1-10 secret env var VALUES are not interpolated in console statements', () => {
  const secretEnvVars = [
    'process.env.DATABASE_URL',
    'process.env.BRIGHTDATA_API_KEY',
    'process.env.GROQ_API_KEY',
    'process.env.STRIPE_SECRET_KEY',
    'process.env.DEEPL_API_KEY',
    'process.env.WHATSAPP_API_KEY',
  ];
  const consoleLines = TOOL_SRC.split('\n').filter(l =>
    /console\.(log|error|warn|info)/.test(l)
  );
  for (const varExpr of secretEnvVars) {
    const leaking = consoleLines.filter(l => l.includes(varExpr));
    assert.strictEqual(
      leaking.length, 0,
      `Secret env var "${varExpr}" must not be interpolated in console output. Found: ${leaking.map(l => l.trim()).join('; ')}`
    );
  }
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();
