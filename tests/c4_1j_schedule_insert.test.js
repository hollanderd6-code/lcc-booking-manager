#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1j — pricing_schedule INSERT status fix
 *
 * Vérifie que upsertSchedule écrit explicitement status et pushed_at
 * dans la liste INSERT, de sorte qu'une nouvelle ligne (pas de conflit)
 * reçoit le même status qu'une ligne existante (ON CONFLICT).
 *
 * Bug d'origine : status et pushed_at étaient UNIQUEMENT dans DO UPDATE.
 * Une nouvelle nuit (ex. dernière nuit de l'horizon glissant) recevait
 * le DEFAULT DB 'pending' même pendant un run AUTO.
 *
 * Couverture :
 *   J01 : nouvelle nuit AUTO → INSERT status=applied pushed_at=NOW()
 *   J02 : nuit existante AUTO → ON CONFLICT status=applied pushed_at≠NULL
 *   J03 : nouvelle nuit MANUAL → INSERT status=pending pushed_at=NULL
 *   J04 : nuit existante MANUAL → ON CONFLICT status=pending pushed_at=NULL
 *   J05 : horizon glissant — 365 nuits toutes applied (dont la dernière)
 *   J06 : user_id réaligné sur canonical owner via EXCLUDED.user_id
 *   J07 : 201 nuits — offsets corrects, 2e chunk reçoit le même status
 *   J08 : status invalide → erreur avant toute requête DB
 *
 * Exécution : node tests/c4_1j_schedule_insert.test.js
 * Aucun appel DB réel.
 */

const assert = require('assert');
const { upsertSchedule } = require('../routes/pricing-apply');

// ── Test runner ────────────────────────────────────────────────────────────────

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

// ── Pool capturant ─────────────────────────────────────────────────────────────

function makeCapturePool() {
  const queries = [];
  return {
    async query(sql, params = []) {
      queries.push({ sql, params: params.slice() });
      return { rows: [], rowCount: 0 };
    },
    queries,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNight(date, price = 75) {
  return { date, price, minStay: 1, reason: 'test', breakdown: { base: price } };
}

// Retourne la partie SQL avant ON CONFLICT (INSERT ... VALUES ...)
function insertPart(sql) {
  const idx = sql.toUpperCase().indexOf('ON CONFLICT');
  return idx >= 0 ? sql.slice(0, idx) : sql;
}

// Retourne la partie SQL DO UPDATE SET ...
function doUpdatePart(sql) {
  const idx = sql.toUpperCase().indexOf('DO UPDATE SET');
  return idx >= 0 ? sql.slice(idx) : '';
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── J01 ──────────────────────────────────────────────────────────────────────

await test('J01 NEW ROW AUTO — INSERT transmet status=applied et pushed_at=NOW()', async () => {
  const pool = makeCapturePool();
  await upsertSchedule(pool, 'u_owner', 'prop-m7', [makeNight('2027-09-22')], 'applied');

  assert.strictEqual(pool.queries.length, 1);
  const { sql, params } = pool.queries[0];
  const ins = insertPart(sql);

  // status et pushed_at présents dans la liste INSERT
  assert.ok(ins.toLowerCase().includes('status'),
    'INSERT : colonne status absente de la liste de colonnes');
  assert.ok(ins.toLowerCase().includes('pushed_at'),
    'INSERT : colonne pushed_at absente de la liste de colonnes');

  // pushed_at = NOW() dans les VALUES (run applied)
  assert.ok(ins.includes('NOW()'),
    'INSERT VALUES : NOW() attendu pour pushed_at en mode applied');
  assert.ok(!ins.toUpperCase().includes('NULL'),
    'INSERT VALUES : NULL inattendu pour pushed_at en mode applied');

  // status transmis comme paramètre
  assert.ok(params.includes('applied'),
    'params doit contenir la valeur "applied"');
  assert.strictEqual(params[7], 'applied',
    'Le 8e param (index 7) doit être le status');

  // DO UPDATE utilise EXCLUDED.status et EXCLUDED.pushed_at
  const upd = doUpdatePart(sql);
  assert.ok(upd.toLowerCase().includes('excluded.status'),
    'DO UPDATE doit référencer EXCLUDED.status');
  assert.ok(upd.toLowerCase().includes('excluded.pushed_at'),
    'DO UPDATE doit référencer EXCLUDED.pushed_at');
});

// ── J02 ──────────────────────────────────────────────────────────────────────

await test('J02 EXISTING ROW AUTO — ON CONFLICT propage status=applied pushed_at=NOW()', async () => {
  const pool = makeCapturePool();
  await upsertSchedule(pool, 'u_owner', 'prop-m7', [makeNight('2027-09-21')], 'applied');

  const { sql, params } = pool.queries[0];
  const ins = insertPart(sql);
  const upd = doUpdatePart(sql);

  // DO UPDATE utilise EXCLUDED (même valeurs que INSERT)
  assert.ok(upd.toLowerCase().includes('excluded.status'),
    'DO UPDATE doit utiliser EXCLUDED.status (= applied)');
  assert.ok(upd.toLowerCase().includes('excluded.pushed_at'),
    'DO UPDATE doit utiliser EXCLUDED.pushed_at (= NOW())');

  // La valeur applied est dans les params → EXCLUDED.status = applied
  assert.ok(params.includes('applied'));

  // NOW() dans les VALUES → EXCLUDED.pushed_at sera non NULL
  assert.ok(ins.includes('NOW()'),
    'pushed_at doit être NOW() pour applied → EXCLUDED.pushed_at non NULL');
});

// ── J03 ──────────────────────────────────────────────────────────────────────

await test('J03 NEW ROW MANUAL — INSERT transmet status=pending et pushed_at=NULL', async () => {
  const pool = makeCapturePool();
  await upsertSchedule(pool, 'u_owner', 'prop-m7', [makeNight('2027-09-22')], 'pending');

  const { sql, params } = pool.queries[0];
  const ins = insertPart(sql);

  assert.ok(ins.toLowerCase().includes('status'),
    'INSERT : colonne status absente');
  assert.ok(ins.toLowerCase().includes('pushed_at'),
    'INSERT : colonne pushed_at absente');

  // pushed_at = NULL dans les VALUES (run pending)
  assert.ok(ins.toUpperCase().includes('NULL'),
    'INSERT VALUES : NULL attendu pour pushed_at en mode pending');
  assert.ok(!ins.includes('NOW()'),
    'INSERT VALUES : NOW() inattendu en mode pending');

  // status param = pending
  assert.ok(params.includes('pending'));
  assert.strictEqual(params[7], 'pending',
    'Le 8e param (index 7) doit être "pending"');
});

// ── J04 ──────────────────────────────────────────────────────────────────────

await test('J04 EXISTING ROW MANUAL — ON CONFLICT produit status=pending pushed_at=NULL', async () => {
  const pool = makeCapturePool();
  await upsertSchedule(pool, 'u_owner', 'prop-m7', [makeNight('2026-12-04')], 'pending');

  const { sql, params } = pool.queries[0];
  const ins = insertPart(sql);
  const upd = doUpdatePart(sql);

  assert.ok(upd.toLowerCase().includes('excluded.status'));
  assert.ok(upd.toLowerCase().includes('excluded.pushed_at'));
  assert.ok(params.includes('pending'));

  // EXCLUDED.pushed_at sera NULL car INSERT VALUES contient NULL
  assert.ok(ins.toUpperCase().includes('NULL'),
    'NULL attendu dans INSERT pour pushed_at pending');
  assert.ok(!ins.includes('NOW()'),
    'NOW() inattendu dans INSERT pour pending');
});

// ── J05 ──────────────────────────────────────────────────────────────────────

await test('J05 ROLLING HORIZON — toutes les 365 nuits (nouvelle + existantes) = applied', async () => {
  const pool = makeCapturePool();

  // 365 nuits → 2 chunks (200 + 165)
  const nights = [];
  for (let i = 0; i < 365; i++) {
    const ms = Date.UTC(2026, 8, 23) + i * 86400000; // 2026-09-23 + i jours
    nights.push(makeNight(new Date(ms).toISOString().slice(0, 10)));
  }
  await upsertSchedule(pool, 'u_owner', 'prop-m7', nights, 'applied');

  assert.strictEqual(pool.queries.length, 2, '365 nuits doivent produire 2 chunks (200+165)');

  for (const [ci, { sql, params }] of pool.queries.entries()) {
    const ins = insertPart(sql);

    assert.ok(ins.toLowerCase().includes('status'),
      `Chunk ${ci + 1} : status absent de INSERT`);
    assert.ok(ins.includes('NOW()'),
      `Chunk ${ci + 1} : NOW() attendu pour pushed_at applied`);

    // Tous les params de status (index 7, 15, 23, ...) = 'applied'
    const nightsInChunk = params.length / 8;
    for (let n = 0; n < nightsInChunk; n++) {
      const statusIdx = n * 8 + 7;
      assert.strictEqual(params[statusIdx], 'applied',
        `Chunk ${ci + 1}, nuit ${n + 1} : status params[${statusIdx}] devrait être "applied", reçu "${params[statusIdx]}"`);
    }
  }

  // Vérification explicite du 2e chunk (nuits 201-365, incluant J+364)
  const chunk2 = pool.queries[1];
  assert.strictEqual(chunk2.params[7], 'applied',
    'Dernière nuit du 2e chunk (horizon glissant) doit recevoir status=applied');
  assert.ok(insertPart(chunk2.sql).includes('NOW()'),
    'Dernière nuit : pushed_at=NOW() attendu, pas NULL');
});

// ── J06 ──────────────────────────────────────────────────────────────────────

await test('J06 USER_ID REALIGNMENT — DO UPDATE réaligne user_id vers canonical_owner', async () => {
  const pool = makeCapturePool();
  await upsertSchedule(pool, 'u_canonical_owner', 'prop-m7', [makeNight('2026-12-04')], 'applied');

  const { sql } = pool.queries[0];
  const upd = doUpdatePart(sql);

  assert.ok(
    upd.toLowerCase().includes('user_id') && upd.toLowerCase().includes('excluded.user_id'),
    'DO UPDATE doit contenir "user_id = EXCLUDED.user_id" pour réaligner les anciennes lignes delegate'
  );
  // user_id ne doit PAS être dans property_id ou date (colonnes de conflit)
  const conflictClause = sql.toUpperCase().slice(
    sql.toUpperCase().indexOf('ON CONFLICT'),
    sql.toUpperCase().indexOf('DO UPDATE')
  );
  assert.ok(!conflictClause.includes('USER_ID'),
    'user_id ne doit pas faire partie du prédicat ON CONFLICT');
});

// ── J07 ──────────────────────────────────────────────────────────────────────

await test('J07 CHUNK > 200 — offsets corrects, 2e chunk reçoit le même status', async () => {
  const pool = makeCapturePool();

  const nights = [];
  for (let i = 0; i < 201; i++) {
    const ms = Date.UTC(2026, 8, 23) + i * 86400000;
    nights.push(makeNight(new Date(ms).toISOString().slice(0, 10)));
  }
  await upsertSchedule(pool, 'u_owner', 'prop-m7', nights, 'applied');

  assert.strictEqual(pool.queries.length, 2, '201 nuits = 2 chunks');

  const chunk1 = pool.queries[0];
  const chunk2 = pool.queries[1];

  // Chunk 1 : 200 nuits × 8 params = 1600
  assert.strictEqual(chunk1.params.length, 1600,
    `Chunk 1 : attendu 1600 params, reçu ${chunk1.params.length}`);

  // Chunk 2 : 1 nuit × 8 params = 8
  assert.strictEqual(chunk2.params.length, 8,
    `Chunk 2 : attendu 8 params, reçu ${chunk2.params.length}`);

  // Les deux chunks ont status=applied dans les params de status
  assert.strictEqual(chunk1.params[7], 'applied', 'chunk1 : premier status param');
  assert.strictEqual(chunk1.params[1599], 'applied', 'chunk1 : dernier status param');
  assert.strictEqual(chunk2.params[7], 'applied', 'chunk2 : status de la 201e nuit');

  // Chunk 2 repart de $1 (pas de continuation des numéros de params)
  assert.ok(chunk2.sql.includes('$1,'), 'Chunk 2 doit repartir des paramètres $1');
  assert.ok(!chunk2.sql.includes('$1601'), 'Chunk 2 ne doit pas utiliser $1601');

  // Les deux chunks ont NOW() pour pushed_at applied
  assert.ok(insertPart(chunk1.sql).includes('NOW()'), 'Chunk 1 : NOW() pour pushed_at');
  assert.ok(insertPart(chunk2.sql).includes('NOW()'), 'Chunk 2 : NOW() pour pushed_at');
});

// ── J08 ──────────────────────────────────────────────────────────────────────

await test('J08 INVALID STATUS — erreur levée avant toute requête DB', async () => {
  const pool = makeCapturePool();
  let threw = false;
  try {
    await upsertSchedule(pool, 'u_owner', 'prop-m7', [makeNight('2026-12-04')], 'declined');
  } catch (err) {
    threw = true;
    assert.ok(
      err.message.toLowerCase().includes('statut') ||
      err.message.toLowerCase().includes('status') ||
      err.message.toLowerCase().includes('invalid') ||
      err.message.toLowerCase().includes('invalide'),
      `Message d'erreur inattendu : ${err.message}`
    );
  }
  assert.ok(threw, 'Doit lever une erreur pour un status invalide');
  assert.strictEqual(pool.queries.length, 0,
    'Aucune requête DB ne doit être émise avant la validation');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  Tous les tests passent (${passed}/${passed + failed})`);
} else {
  console.log(`❌  ${failed} test(s) en échec sur ${passed + failed}`);
  for (const f of failures) {
    console.log(`   • ${f.name}`);
    console.log(`     ${f.message}`);
  }
  process.exit(1);
}

})();
