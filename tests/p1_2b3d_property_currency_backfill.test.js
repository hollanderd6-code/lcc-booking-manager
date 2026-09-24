#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B3D Property Currency Backfill
 *
 * B3D-01–03 : eligibility SELECT — all three WHERE conditions
 * B3D-04–07 : CAS UPDATE WHERE — all five guard conditions
 * B3D-08–09 : dry-run produces no UPDATE calls
 * B3D-10–12 : apply mode — CAS outcomes (applied, race, race-enabled)
 * B3D-13–15 : Channex error handling — no UPDATE attempted
 * B3D-16–18 : mutation scope — only currency mutated; channex_* untouched
 *
 * Run: node tests/p1_2b3d_property_currency_backfill.test.js
 * No real DB. No real Channex. No writes.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Runner ─────────────────────────────────────────────────────────────────────
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

// ── Module under test ──────────────────────────────────────────────────────────
const {
  fetchEligibleProperties,
  applyPropertyCurrency,
  processProperty,
} = require('../outils/backfill-property-currency');

// ── Source check ───────────────────────────────────────────────────────────────
const B3D_SRC = fs.readFileSync(
  path.resolve(__dirname, '../outils/backfill-property-currency.js'),
  'utf8'
);

// ── Mock helpers ───────────────────────────────────────────────────────────────
function makeProperty(overrides = {}) {
  return {
    id:                  'prop-aaaabbbbccccdddd',
    user_id:             'user-11112222',
    channex_rate_plan_id:'rp-11223344-aabb-ccdd',
    display_name:        'Test Property',
    ...overrides,
  };
}

function makeMockPool({ rowCount = 1, rows = [] } = {}) {
  const queries = [];
  const pool = {
    _queries: queries,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: s, params });
      if (/^SELECT/i.test(s)) return { rows, rowCount: rows.length };
      if (/^UPDATE/i.test(s)) return { rows: rowCount > 0 ? [{ id: 'prop-id' }] : [], rowCount };
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
  return pool;
}

function okCurrency(currency = 'EUR') {
  return async () => ({ ok: true, currency });
}

function failCurrency(error = 'api_error') {
  return async () => ({ ok: false, error });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B3D-01–03 : eligibility SELECT conditions ──');

await test('B3D-01 eligibility query requires channex_enabled = true', async () => {
  const pool = makeMockPool({ rows: [] });
  await fetchEligibleProperties(pool);
  const q = pool._queries[0];
  assert.ok(q, 'No query was executed');
  assert.ok(
    /channex_enabled\s*=\s*true/i.test(q.sql),
    'channex_enabled = true not found in eligibility SELECT'
  );
});

await test('B3D-02 eligibility query requires currency IS NULL', async () => {
  const pool = makeMockPool({ rows: [] });
  await fetchEligibleProperties(pool);
  const q = pool._queries[0];
  assert.ok(
    /currency\s+IS\s+NULL/i.test(q.sql),
    'currency IS NULL not found in eligibility SELECT'
  );
});

await test('B3D-03 eligibility query requires channex_rate_plan_id IS NOT NULL', async () => {
  const pool = makeMockPool({ rows: [] });
  await fetchEligibleProperties(pool);
  const q = pool._queries[0];
  assert.ok(
    /channex_rate_plan_id\s+IS\s+NOT\s+NULL/i.test(q.sql),
    'channex_rate_plan_id IS NOT NULL not found in eligibility SELECT'
  );
});

console.log('\n── B3D-04–07 : CAS UPDATE WHERE conditions ──');

await test('B3D-04 CAS UPDATE WHERE includes currency IS NULL', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  await applyPropertyCurrency(pool, {
    propertyId: 'p1', userId: 'u1', capturedRatePlanId: 'rp1', currency: 'EUR'
  });
  const q = pool._queries[0];
  assert.ok(q && /UPDATE/i.test(q.sql), 'UPDATE not executed');
  assert.ok(
    /currency\s+IS\s+NULL/i.test(q.sql),
    'currency IS NULL not in CAS UPDATE WHERE'
  );
});

await test('B3D-05 CAS UPDATE WHERE includes channex_enabled = true', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  await applyPropertyCurrency(pool, {
    propertyId: 'p1', userId: 'u1', capturedRatePlanId: 'rp1', currency: 'EUR'
  });
  const q = pool._queries[0];
  assert.ok(
    /channex_enabled\s*=\s*true/i.test(q.sql),
    'channex_enabled = true not in CAS UPDATE WHERE'
  );
});

await test('B3D-06 CAS UPDATE WHERE includes channex_rate_plan_id = $capturedRatePlanId', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  await applyPropertyCurrency(pool, {
    propertyId: 'p1', userId: 'u1', capturedRatePlanId: 'rp-captured', currency: 'EUR'
  });
  const q = pool._queries[0];
  assert.ok(
    /channex_rate_plan_id\s*=\s*\$\d/i.test(q.sql),
    'channex_rate_plan_id = $n not in CAS UPDATE WHERE'
  );
  assert.ok(
    q.params.includes('rp-captured'),
    `capturedRatePlanId 'rp-captured' not in query params: ${JSON.stringify(q.params)}`
  );
});

await test('B3D-07 CAS UPDATE WHERE includes user_id = $userId', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  await applyPropertyCurrency(pool, {
    propertyId: 'p1', userId: 'user-xyz', capturedRatePlanId: 'rp1', currency: 'EUR'
  });
  const q = pool._queries[0];
  assert.ok(
    /user_id\s*=\s*\$\d/i.test(q.sql),
    'user_id = $n not in CAS UPDATE WHERE'
  );
  assert.ok(
    q.params.includes('user-xyz'),
    `userId 'user-xyz' not in query params: ${JSON.stringify(q.params)}`
  );
});

console.log('\n── B3D-08–09 : dry-run produces no writes ──');

await test('B3D-08 dry-run: no UPDATE executed even when Channex returns ok', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: true,
    getCurrency: okCurrency('EUR'),
  });
  const updateCalls = pool._queries.filter(q => /UPDATE/i.test(q.sql));
  assert.strictEqual(updateCalls.length, 0,
    `Dry-run must not call UPDATE, but ${updateCalls.length} UPDATE call(s) were made`
  );
  assert.strictEqual(result.outcome, 'WOULD_SET', `Expected WOULD_SET, got ${result.outcome}`);
});

await test('B3D-09 dry-run: WOULD_SET reports correct currency', async () => {
  const pool = makeMockPool({ rowCount: 0 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: true,
    getCurrency: okCurrency('GBP'),
  });
  assert.strictEqual(result.outcome, 'WOULD_SET');
  assert.strictEqual(result.currency, 'GBP', `Expected GBP, got ${result.currency}`);
});

console.log('\n── B3D-10–12 : apply mode — CAS outcomes ──');

await test('B3D-10 apply + CAS returns 1 row → APPLIED', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: false,
    getCurrency: okCurrency('EUR'),
  });
  assert.strictEqual(result.outcome, 'APPLIED', `Expected APPLIED, got ${result.outcome}`);
  assert.strictEqual(result.currency, 'EUR');
});

await test('B3D-11 apply + CAS returns 0 rows → SKIPPED_RACE_OR_CHANGED_STATE', async () => {
  const pool = makeMockPool({ rowCount: 0 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: false,
    getCurrency: okCurrency('EUR'),
  });
  assert.strictEqual(result.outcome, 'SKIPPED_RACE_OR_CHANGED_STATE',
    `Expected SKIPPED_RACE_OR_CHANGED_STATE, got ${result.outcome}`
  );
});

await test('B3D-12 race: channex_enabled flips false between GET and UPDATE → CAS 0 rows → SKIPPED', async () => {
  // Simulates: between GET (ok) and UPDATE, channex_enabled was set to false.
  // The CAS WHERE channex_enabled = true returns 0 rows.
  const pool = makeMockPool({ rowCount: 0 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: false,
    getCurrency: okCurrency('EUR'),
  });
  // CAS returning 0 rows is the only observable outcome regardless of which condition failed
  assert.strictEqual(result.outcome, 'SKIPPED_RACE_OR_CHANGED_STATE');
  // Verify an UPDATE was actually attempted (not silently swallowed)
  const updateCalls = pool._queries.filter(q => /UPDATE/i.test(q.sql));
  assert.ok(updateCalls.length > 0, 'UPDATE must be attempted in apply mode even if it returns 0 rows');
});

console.log('\n── B3D-13–15 : Channex error handling — no UPDATE attempted ──');

await test('B3D-13 api_error → SKIPPED_CHANNEX_ERROR, no UPDATE', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: false,
    getCurrency: failCurrency('api_error'),
  });
  assert.strictEqual(result.outcome, 'SKIPPED_CHANNEX_ERROR');
  assert.strictEqual(result.errorCode, 'api_error');
  const updateCalls = pool._queries.filter(q => /UPDATE/i.test(q.sql));
  assert.strictEqual(updateCalls.length, 0, 'No UPDATE must be called after Channex error');
});

await test('B3D-14 not_found → SKIPPED_CHANNEX_ERROR, no UPDATE', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: false,
    getCurrency: failCurrency('not_found'),
  });
  assert.strictEqual(result.outcome, 'SKIPPED_CHANNEX_ERROR');
  assert.strictEqual(result.errorCode, 'not_found');
  const updateCalls = pool._queries.filter(q => /UPDATE/i.test(q.sql));
  assert.strictEqual(updateCalls.length, 0, 'No UPDATE must be called on not_found');
});

await test('B3D-15 invalid_currency → SKIPPED_CHANNEX_ERROR, no UPDATE', async () => {
  const pool = makeMockPool({ rowCount: 1 });
  const result = await processProperty(pool, makeProperty(), {
    dryRun: false,
    getCurrency: failCurrency('invalid_currency'),
  });
  assert.strictEqual(result.outcome, 'SKIPPED_CHANNEX_ERROR');
  const updateCalls = pool._queries.filter(q => /UPDATE/i.test(q.sql));
  assert.strictEqual(updateCalls.length, 0);
});

console.log('\n── B3D-16–18 : mutation scope ──');

await test('B3D-16 CAS UPDATE mutates only currency and updated_at — no other column', async () => {
  const fetchFn = B3D_SRC.match(/async function applyPropertyCurrency[\s\S]+?\n\}/);
  assert.ok(fetchFn, 'applyPropertyCurrency not found in source');
  const body = fetchFn[0];
  // SET clause must contain currency = and updated_at =
  assert.ok(/SET\s[\s\S]*currency\s*=/.test(body), 'currency = missing from SET');
  assert.ok(/updated_at\s*=\s*NOW\(\)/.test(body), 'updated_at = NOW() missing from SET');
  // Must NOT mention channex_* columns in SET
  const forbiddenInSet = [
    'channex_enabled', 'channex_property_id', 'channex_room_type_id',
    'channex_rate_plan_id', 'channex_markup_rate_plans', 'platform_markups',
  ];
  const setBlock = body.match(/SET([\s\S]+?)WHERE/i)?.[1] || '';
  for (const col of forbiddenInSet) {
    assert.ok(
      !setBlock.includes(col),
      `Forbidden column '${col}' found in SET clause of applyPropertyCurrency`
    );
  }
});

await test('B3D-17 channex_* and markup columns never appear in any UPDATE statement in B3D source', () => {
  const updateBlocks = B3D_SRC.match(/UPDATE[\s\S]+?RETURNING/gi) || [];
  const forbidden = [
    'channex_enabled', 'channex_property_id', 'channex_room_type_id',
    'channex_rate_plan_id', 'channex_markup_rate_plans', 'platform_markups',
  ];
  for (const block of updateBlocks) {
    const setSection = block.match(/SET([\s\S]+?)WHERE/i)?.[1] || '';
    for (const col of forbidden) {
      assert.ok(
        !setSection.includes(col),
        `Forbidden column '${col}' found in a SET clause: …${setSection.slice(0, 80)}…`
      );
    }
  }
});

await test('B3D-18 --apply required for writes; dry-run is default (source check)', () => {
  // dryRun = !applyMode, where applyMode = args.includes('--apply')
  assert.ok(
    /applyMode\s*=\s*args\.includes\s*\(\s*['"]--apply['"]\s*\)/.test(B3D_SRC),
    "applyMode = args.includes('--apply') not found — dry-run must be default"
  );
  assert.ok(
    /dryRun\s*=\s*!applyMode/.test(B3D_SRC),
    'dryRun = !applyMode not found — ensure dry-run is the default mode'
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  18 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 18) {
  console.error(`⚠️  Expected 18 tests, ${passed + failed} ran`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();
