#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B4-H3 — Controlled Property Geo Repair Tool
 *
 * Establishes structured geo metadata (latitude, longitude, country_code, timezone)
 * for exactly ONE explicitly targeted property, using the canonical Geoapify geocoder.
 *
 * SAFETY CONTRACT — EXECUTE mode mutates ONLY:
 *   properties.latitude
 *   properties.longitude
 *   properties.country_code
 *   properties.timezone
 *
 * ABSOLUTELY NO:
 *   scheduleMarketRefresh             PROHIBITED
 *   runDynamicPricingForOneProperty   PROHIBITED
 *   applyDynamicPricingForProperty    PROHIBITED
 *   triggerChannexRatesSync           PROHIBITED
 *   publishEffectivePricing           PROHIBITED
 *   market_data writes                PROHIBITED
 *   pricing_schedule writes           PROHIBITED
 *   pricing_history writes            PROHIBITED
 *   pricing_config writes             PROHIBITED
 *   Channex API calls                 PROHIBITED
 *
 *   CHANNEX_WRITES  = 0
 *   PRICING_WRITES  = 0
 *   APIFY_CALLS     = 0
 *
 * Usage:
 *   DATABASE_URL=... node outils/repair-property-geo.js --name M6
 *     → PREVIEW: read-only inspection, 0 writes, 0 Geoapify calls
 *
 *   DATABASE_URL=... GEOAPIFY_API_KEY=... node outils/repair-property-geo.js --name M6 --execute
 *     → EXECUTE: one Geoapify call, CAS write of geo columns only
 *
 * After geo repair, run separately:
 *   node outils/validate-market-currency-runtime.js --name M6
 *   node outils/validate-market-currency-runtime.js --name M6 --execute
 */

// ── Safe imports — no pricing, no channex, no apify, no market refresh ─────────
// geocodeAddress is imported at module level — it is a pure async function that
// makes a single HTTP request. No side effects on import.
const { geocodeAddress }          = require('../services/property-geocoder');
const { computeMarketContextKey } = require('../routes/market-context-key');
const { Pool }                    = require('pg');

// DB_WRITES (PREVIEW) = 0
// GEOAPIFY_CALLS (PREVIEW) = 0
// APIFY_CALLS = 0
// CHANNEX_WRITES = 0
// PRICING_WRITES = 0
// EXECUTE: one GEOAPIFY_CALL, one properties row updated (lat/lng/cc/tz only)

// ── SQL fragment — no pc.zone_label (not in pricing_config schema) ─────────────
const PROP_SELECT = `
  SELECT p.id, p.name, p.internal_name, p.address, p.city, p.postal_code,
         p.country_code, p.latitude, p.longitude, p.timezone, p.currency,
         p.channex_enabled, p.channex_rate_plan_id, p.user_id,
         pc.is_active, pc.mode
  FROM properties p
  LEFT JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
`;

// ── resolveTarget ──────────────────────────────────────────────────────────────
async function resolveTarget(pool, { name }) {
  const rows = (await pool.query(
    PROP_SELECT + `WHERE (p.internal_name ILIKE $1 OR p.name ILIKE $1)`,
    [`%${name}%`]
  )).rows;
  return rows;
}

// ── validateGeoResult — pure, reuses P1.1 rules from property-geocoder.js ──────
// Mirrors the status/range/regex checks in geocodeAddress output format.
function validateGeoResult(result) {
  if (!result || result.status !== 'resolved') {
    return `geocoder status=${result?.status ?? 'null'} reason=${result?.reason ?? '?'}`;
  }
  const { latitude, longitude, countryCode, timezone } = result;
  if (typeof latitude !== 'number' || !isFinite(latitude) || latitude < -90 || latitude > 90) {
    return `invalid latitude: ${latitude}`;
  }
  if (typeof longitude !== 'number' || !isFinite(longitude) || longitude < -180 || longitude > 180) {
    return `invalid longitude: ${longitude}`;
  }
  // P1.1 canonical: country_code must be exactly 2 uppercase letters
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    return `invalid country_code: ${JSON.stringify(countryCode)}`;
  }
  if (!timezone) {
    return `timezone missing`;
  }
  return null; // passes all checks
}

// ── writeGeoResult — guarded atomic write with CAS ────────────────────────────
// Mirrors P1.1 geocodePropertyAsync CAS (WHERE id AND address) but wraps it in a
// transaction + FOR UPDATE to prevent concurrent partial writes.
//
// Only mutates: latitude, longitude, country_code, timezone
// Does NOT touch: address, currency, channex_*, pricing_config, market_data
// Does NOT call: scheduleMarketRefresh, loadProperties, triggerChannexRatesSync
async function writeGeoResult(pool, { propertyId, capturedAddress, capturedLat, geocodeResult }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row before writing
    const lockRes = await client.query(
      `SELECT id, address, latitude, longitude, country_code, timezone
       FROM properties WHERE id = $1 FOR UPDATE`,
      [propertyId]
    );

    if (lockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'property_not_found' };
    }

    const current = lockRes.rows[0];

    // CAS guard 1: address must not have changed while Geoapify HTTP call was in flight
    if (current.address !== capturedAddress) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'address_stale',
               capturedAddress, currentAddress: current.address };
    }

    // CAS guard 2: if geo was absent at T0 but another process filled it, do not overwrite
    if (capturedLat == null && current.latitude != null) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'geo_changed' };
    }

    // Write ONLY the 4 geo columns — canonical P1.1 column set, no extras
    const updateRes = await client.query(
      `UPDATE properties
       SET latitude = $1, longitude = $2, country_code = $3, timezone = $4
       WHERE id = $5 AND address = $6`,
      [geocodeResult.latitude, geocodeResult.longitude,
       geocodeResult.countryCode, geocodeResult.timezone,
       propertyId, capturedAddress]
    );

    if (updateRes.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'rowcount_mismatch', rowCount: updateRes.rowCount };
    }

    await client.query('COMMIT');
    return { written: true };

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── previewMode: READ-ONLY ─────────────────────────────────────────────────────
// DB_WRITES = 0, GEOAPIFY_CALLS = 0, APIFY_CALLS = 0, CHANNEX_WRITES = 0
async function previewMode(pool, { name }) {
  console.log('\n' + '═'.repeat(70));
  console.log('  B4-H3 GEO REPAIR — PREVIEW MODE');
  console.log('  MODE: PREVIEW — READ ONLY');
  console.log('  DB_WRITES = 0');
  console.log('  GEOAPIFY_CALLS = 0');
  console.log('  APIFY_CALLS = 0');
  console.log('  CHANNEX_WRITES = 0');
  console.log('  PRICING_WRITES = 0');
  console.log('═'.repeat(70));

  const targets = await resolveTarget(pool, { name });
  console.log(`\n  TARGET_PROPERTY_COUNT = ${targets.length}`);

  if (targets.length === 0) {
    console.log(`  ⛔  No property matching "${name}"`);
    return { ok: false, abort: 'no_target' };
  }
  if (targets.length > 1) {
    console.log(`  ⛔  Ambiguous: ${targets.length} properties match "${name}" — refine --name`);
    targets.forEach(t => console.log(`       - ${t.id}  ${t.internal_name || t.name}`));
    return { ok: false, abort: `ambiguous: ${targets.length} matches` };
  }

  const prop    = targets[0];
  const propName = prop.internal_name || prop.name || prop.id;
  const ctxKey  = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude,
    longitude:   prop.longitude,
  });

  console.log('\n  ── PROPERTY ─────────────────────────────────────────────────');
  console.log(`  id                   : ${prop.id}`);
  console.log(`  name                 : ${propName}`);
  console.log(`  address              : ${prop.address ?? 'NULL'}`);
  console.log(`  current latitude     : ${prop.latitude ?? 'NULL'}`);
  console.log(`  current longitude    : ${prop.longitude ?? 'NULL'}`);
  console.log(`  current country_code : ${prop.country_code ?? 'NULL'}`);
  console.log(`  current timezone     : ${prop.timezone ?? 'NULL'}`);
  console.log(`  current ctx_key      : ${ctxKey ?? 'NULL (geo incomplete)'}`);
  console.log(`  currency             : ${prop.currency ?? 'NULL'}`);
  console.log(`  bp_active            : ${prop.is_active}`);
  console.log(`  mode                 : ${prop.mode}`);
  console.log(`  channex_enabled      : ${prop.channex_enabled}`);

  const geoapifyPresent = !!process.env.GEOAPIFY_API_KEY;
  const hasAddress      = !!(prop.address && String(prop.address).trim());
  const geoComplete     = ctxKey !== null;

  console.log('\n  ── EXECUTE READINESS ────────────────────────────────────────');
  console.log(`  GEO_COMPLETE         : ${geoComplete}`);
  console.log(`  ADDRESS_PRESENT      : ${hasAddress}`);
  console.log(`  GEOAPIFY_KEY_PRESENT : ${geoapifyPresent}`);

  if (geoComplete) {
    console.log('\n  ✅  Geo already complete — no remediation needed');
    return { ok: true, geoComplete: true, targets: 1, propertyId: prop.id };
  }
  if (!hasAddress) {
    console.log('\n  ⛔  CANNOT EXECUTE: no address on property — geocoding requires an address');
    return { ok: false, abort: 'no_address', targets: 1 };
  }
  if (!geoapifyPresent) {
    console.log('\n  ⚠️  GEOAPIFY_API_KEY absent — --execute would abort');
  } else {
    console.log('\n  ✅  Ready for --execute (add --execute flag to proceed)');
  }
  console.log('═'.repeat(70) + '\n');

  return { ok: true, targets: 1, propertyId: prop.id, geoComplete: false, hasAddress, geoapifyPresent };
}

// ── executeMode: one Geoapify call → CAS write → post-write verification ───────
// deps = { geocodeFn, writeFn } — injectable for tests; production uses real functions
async function executeMode(pool, { name }, deps = {}) {
  // deps injected here only; geocodeAddress is the real geocodeFn in production
  const geocodeFn = deps.geocodeFn || geocodeAddress;
  const writeFn   = deps.writeFn   || writeGeoResult;

  console.log('\n' + '═'.repeat(70));
  console.log('  B4-H3 GEO REPAIR — EXECUTE MODE');
  console.log('');
  console.log('  SAFETY CONTRACT:');
  console.log('    scheduleMarketRefresh            NOT CALLED');
  console.log('    runDynamicPricingForOneProperty   NOT CALLED');
  console.log('    applyDynamicPricingForProperty    NOT CALLED');
  console.log('    triggerChannexRatesSync           NOT CALLED');
  console.log('    CHANNEX_WRITES  = 0');
  console.log('    PRICING_WRITES  = 0');
  console.log('    APIFY_CALLS     = 0');
  console.log('    Allowed write: properties.latitude/longitude/country_code/timezone');
  console.log('═'.repeat(70));

  // 1. Resolve — must match exactly one property
  const targets = await resolveTarget(pool, { name });
  if (targets.length !== 1) {
    console.log(`\n  ⛔  ABORT: TARGET_COUNT=${targets.length} — must be exactly 1`);
    return { ok: false, abort: `TARGET_COUNT=${targets.length}` };
  }

  const prop     = targets[0];
  const propName = prop.internal_name || prop.name || prop.id;
  console.log(`\n  Target confirmed: ${propName} [${String(prop.id).slice(-8)}]`);

  // 2. Guard: address required for geocoding
  if (!prop.address || !String(prop.address).trim()) {
    console.log('\n  ⛔  ABORT: no address on property — cannot geocode');
    return { ok: false, abort: 'no_address' };
  }

  // 3. Guard: abort if geo already complete (do not silently overwrite existing data)
  const existingCtxKey = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude,
    longitude:   prop.longitude,
  });
  if (existingCtxKey !== null) {
    console.log(`\n  ⚠️  ABORT: geo already complete (ctx_key=${existingCtxKey}) — nothing to repair`);
    return { ok: false, abort: 'geo_already_complete', existingCtxKey };
  }

  // 4. T0 captures — taken BEFORE the Geoapify HTTP call
  const capturedAddress = prop.address;
  const capturedLat     = prop.latitude;   // null = geo absent at T0

  console.log(`\n  T0 capturedAddress = "${capturedAddress}"`);
  console.log(`  T0 capturedLat     = ${capturedLat ?? 'NULL'}`);
  console.log(`  T0 currency        = ${prop.currency}`);
  console.log(`  T0 channex_enabled = ${prop.channex_enabled}`);

  // 5. One Geoapify call — uses properties.address, no hardcoded values
  console.log('\n  Calling Geoapify geocoder...');
  const geocodeResult = await geocodeFn(capturedAddress);

  // 6. Validate result before any write
  const validationError = validateGeoResult(geocodeResult);
  if (validationError) {
    console.log(`\n  ⛔  ABORT: geocoder result invalid — ${validationError}`);
    console.log('       DB_WRITES = 0');
    return { ok: false, abort: `geocode_invalid: ${validationError}`, geocodeResult };
  }

  const { latitude, longitude, countryCode, timezone, confidence, resultType } = geocodeResult;
  console.log(`  geocoder: lat=${latitude} lng=${longitude} cc=${countryCode} tz=${timezone}`);
  console.log(`  geocoder: confidence=${confidence} type=${resultType}`);

  // 7. Verify projected context key is non-null before writing
  const projectedCtxKey = computeMarketContextKey({ countryCode, latitude, longitude });
  if (!projectedCtxKey) {
    console.log('\n  ⛔  ABORT: geocoder result would not produce valid market_context_key');
    return { ok: false, abort: 'projected_ctx_key_null' };
  }
  console.log(`  projected_ctx_key = ${projectedCtxKey}`);

  // 8. Guarded atomic write — CAS: address + no concurrent geo fill
  console.log('\n  Writing geo to properties (CAS transaction)...');
  const writeResult = await writeFn(pool, { propertyId: prop.id, capturedAddress, capturedLat, geocodeResult });

  if (!writeResult.written) {
    const { reason } = writeResult;
    console.log(`\n  ⛔  ABORT: write rejected — reason=${reason}`);
    if (reason === 'address_stale') {
      console.log('       Address changed during Geoapify HTTP call — CAS protected the write.');
    } else if (reason === 'geo_changed') {
      console.log('       Another process completed geo during this call — CAS protected the write.');
    }
    console.log('       DB_WRITES = 0');
    return { ok: false, abort: `write_rejected: ${reason}`, writeResult };
  }

  console.log('  ✅  properties geo updated (latitude/longitude/country_code/timezone).');

  // 9. Post-write verification — fresh SELECT of target row only
  const postRows = (await pool.query(
    `SELECT id, address, latitude, longitude, country_code, timezone, currency,
            channex_enabled, channex_rate_plan_id
     FROM properties WHERE id = $1`,
    [prop.id]
  )).rows;

  const post = postRows[0] || null;
  if (!post) {
    return { ok: false, abort: 'post_select_empty' };
  }

  const postCtxKey      = computeMarketContextKey({
    countryCode: post.country_code,
    latitude:    post.latitude,
    longitude:   post.longitude,
  });
  const geoComplete       = postCtxKey !== null;
  const addressUnchanged  = post.address === capturedAddress;
  const currencyUnchanged = (post.currency ?? null) === (prop.currency ?? null);

  console.log('\n  ── POST-WRITE VERIFICATION ──────────────────────────────────');
  console.log(`  latitude             : ${post.latitude}`);
  console.log(`  longitude            : ${post.longitude}`);
  console.log(`  country_code         : ${post.country_code}`);
  console.log(`  timezone             : ${post.timezone}`);
  console.log(`  market_context_key   : ${postCtxKey}`);
  console.log(`  address              : ${post.address}`);
  console.log(`  currency             : ${post.currency}`);
  console.log(`  channex_enabled      : ${post.channex_enabled}`);

  const checks = {
    GEO_COMPLETE:        geoComplete,
    MARKET_CONTEXT_KEY:  postCtxKey !== null,
    ADDRESS_UNCHANGED:   addressUnchanged,
    CURRENCY_UNCHANGED:  currencyUnchanged,
  };

  console.log('\n  ── RESULT ───────────────────────────────────────────────────');
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? '✅' : '❌'}  ${k.padEnd(26)} = ${v}`);
  }

  const allPass = Object.values(checks).every(Boolean);
  console.log(`\n  GEO_REPAIR_RESULT = ${allPass ? 'PASS' : 'FAIL'}`);
  console.log('  TARGET_PROPERTY_UPDATED = 1');
  console.log('  OTHER_PROPERTIES_CHANGED = 0 (write scoped to id+address CAS)');
  console.log('═'.repeat(70) + '\n');

  return { ok: allPass, postCtxKey, geoComplete, addressUnchanged, currencyUnchanged, checks, post, projectedCtxKey, geocodeResult };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  let name    = null;
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) { name = args[++i]; }
    if (args[i] === '--execute')             { execute = true; }
  }

  if (!name) {
    console.error('Usage: node outils/repair-property-geo.js --name <property-name> [--execute]');
    console.error('  --name is mandatory. --all / wildcard / multi-property execution not allowed.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable required');
    process.exit(1);
  }
  if (execute && !process.env.GEOAPIFY_API_KEY) {
    console.error('GEOAPIFY_API_KEY environment variable required for --execute mode');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const run = execute
    ? executeMode(pool, { name })
    : previewMode(pool, { name });

  run
    .then(result => {
      pool.end().catch(() => {});
      if (!result.ok && result.abort) process.exit(1);
    })
    .catch(err => {
      console.error('Fatal:', err.message);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { resolveTarget, previewMode, executeMode, writeGeoResult, validateGeoResult };
