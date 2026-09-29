'use strict';
/**
 * P1.2-B5-BK-Q — BoostPrice Geo Readiness Audit (READ ONLY unless --execute-geocode)
 *
 * READ-ONLY mode (default):
 *   Lists all active BoostPrice properties with:
 *     - geo readiness status (valid coords / missing coords)
 *     - address availability (has address / no address)
 *     - currency status
 *     - profile-ready flag
 *   No coordinates, no addresses, no API keys are printed.
 *
 * --execute-geocode mode (explicit flag required):
 *   For each active BoostPrice property with missing/invalid coordinates
 *   AND a valid address, calls Geoapify geocode API (EXISTING service),
 *   then performs a CAS (compare-and-set) write:
 *     UPDATE properties SET lat/lon/cc/tz WHERE id=$1 AND address=$2
 *   If the address changed between read and write: skipped (no write).
 *   Does NOT trigger market refresh (no scheduleMarketRefresh call).
 *   BRIGHT_DATA_CALLS_FROM_Q = 0
 *
 * SAFETY:
 *   DB_WRITES              = 0 (read-only mode) / guarded CAS writes (--execute-geocode)
 *   NETWORK_CALLS          = 0 (read-only mode) / Geoapify API only (--execute-geocode)
 *   BRIGHT_DATA_CALLS      = 0 always
 *   MARKET_REFRESH_CALLS   = 0 always (no scheduleMarketRefresh)
 *   PRICING_WRITES         = 0 always
 *   CHANNEX_CALLS          = 0 always
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-boostprice-geo-readiness-q.js
 *   NODE_ENV=production node outils/audit-boostprice-geo-readiness-q.js --execute-geocode
 *
 * Q9 CONSTRAINT: DO NOT run --execute-geocode automatically. Review read-only audit first.
 */

const { createPool }          = require('../services/db-pool');
const { hasValidCoordinates } = require('../services/market-geo-validator');
const { buildMarketProfileIdentity } = require('../services/market-search-identity');
const { geocodeAddress }      = require('../services/property-geocoder');

const EXECUTE_GEOCODE = process.argv.includes('--execute-geocode');

const pool = createPool();

// Display name — mirrors server.js displayName() helper
function displayName(p) {
  return p.internal_name || p.name || `property_${p.id}`;
}

// ── Q7: Verify no market refresh is triggered ─────────────────────────────────
// This tool calls geocodeAddress() directly — bypasses the server.js wrapper
// that also invokes scheduleMarketRefresh. BRIGHT_DATA_CALLS_FROM_Q = 0.

async function geocodeOneProperty(pool, prop) {
  const { id, address } = prop;
  if (!address || !String(address).trim()) {
    return { status: 'skipped', reason: 'no_address' };
  }

  // Step 1: call geocoder (NETWORK — Geoapify API)
  let geoResult;
  try {
    geoResult = await geocodeAddress(address);
  } catch (err) {
    return { status: 'error', reason: `geocode_exception: ${err.message}` };
  }

  if (!geoResult || geoResult.status !== 'resolved') {
    return { status: 'skipped', reason: `geocode_${geoResult?.status ?? 'null'}: ${geoResult?.reason ?? ''}` };
  }

  // Step 2: CAS write — only update if property address still matches the one we read
  // Q6: read current address to confirm it hasn't changed between our read and now
  let writeResult;
  try {
    writeResult = await pool.query(
      `UPDATE properties
       SET latitude = $1, longitude = $2, country_code = $3, timezone = $4
       WHERE id = $5 AND address = $6`,
      [geoResult.latitude, geoResult.longitude, geoResult.countryCode, geoResult.timezone, id, address]
    );
  } catch (err) {
    return { status: 'error', reason: `write_exception: ${err.message}` };
  }

  if (writeResult.rowCount === 0) {
    return { status: 'skipped', reason: 'cas_miss_address_changed' };
  }

  return {
    status: 'resolved',
    resultType: geoResult.resultType,
    confidence: geoResult.confidence,
    countryCode: geoResult.countryCode,
  };
}

async function runAudit() {
  const SEP = '═'.repeat(70);
  console.log(SEP);
  console.log('  P1.2-B5-BK-Q — BoostPrice Geo Readiness Audit');
  if (EXECUTE_GEOCODE) {
    console.log('  MODE: --execute-geocode  (writes enabled — CAS guarded)');
    console.log('  MARKET_REFRESH_CALLS=0  BRIGHT_DATA_CALLS=0  PRICING_WRITES=0');
  } else {
    console.log('  MODE: read-only (default)');
    console.log('  DB_WRITES=0  NETWORK_CALLS=0  BRIGHT_DATA_CALLS=0');
  }
  console.log(SEP);
  console.log();

  // ── Fetch active BoostPrice properties ────────────────────────────────────────
  const result = await pool.query(`
    SELECT
      p.id,
      p.internal_name,
      p.name,
      p.address IS NOT NULL AND p.address != '' AS has_address,
      p.latitude,
      p.longitude,
      p.country_code,
      p.timezone IS NOT NULL AS has_timezone,
      pc.currency,
      pc.max_guests,
      pc.bedrooms,
      pc.property_type
    FROM properties p
    JOIN pricing_config pc ON pc.property_id = p.id
    WHERE pc.is_active = TRUE AND pc.boostprice_active = TRUE
    ORDER BY p.internal_name, p.name
  `);

  // For --execute-geocode we need the raw address
  let rawAddressMap = new Map();
  if (EXECUTE_GEOCODE) {
    const addrResult = await pool.query(`
      SELECT p.id, p.address
      FROM properties p
      JOIN pricing_config pc ON pc.property_id = p.id
      WHERE pc.is_active = TRUE AND pc.boostprice_active = TRUE
        AND (p.latitude IS NULL OR p.longitude IS NULL)
    `);
    for (const row of addrResult.rows) {
      rawAddressMap.set(row.id, row.address);
    }
  }

  const props = result.rows;
  console.log(`Active BoostPrice properties: ${props.length}`);
  console.log();

  // ── Classify each property ────────────────────────────────────────────────────
  const geoReady    = [];
  const geoMissing  = [];
  const currencyMissing = [];

  for (const p of props) {
    const name      = displayName(p);
    const validGeo  = hasValidCoordinates(p.latitude, p.longitude);
    const hasCur    = !!(p.currency && /^[A-Z]{3}$/.test(p.currency));

    let profileReady = false;
    let profileReason = null;
    if (validGeo && hasCur) {
      const id = buildMarketProfileIdentity({
        latitude:           p.latitude,
        longitude:          p.longitude,
        currency:           p.currency,
        targetGuests:       p.max_guests    ?? null,
        targetBedrooms:     p.bedrooms      ?? null,
        targetPropertyType: p.property_type ?? null,
      });
      profileReady   = id.valid;
      profileReason  = id.reason;
    }

    const entry = {
      id:           p.id,
      name,
      hasAddress:   p.has_address,
      validGeo,
      hasCurrency:  hasCur,
      currency:     p.currency,
      hasTimezone:  p.has_timezone,
      hasCountryCode: !!p.country_code,
      profileReady,
      profileReason,
    };

    if (!hasCur)       currencyMissing.push(entry);
    else if (!validGeo) geoMissing.push(entry);
    else               geoReady.push(entry);
  }

  // ── A: Geo-ready properties ───────────────────────────────────────────────────
  console.log(`── A: GEO-READY (${geoReady.length}) ──────────────────────────────`);
  if (geoReady.length === 0) {
    console.log('  (none)');
  }
  for (const p of geoReady) {
    const flags = [
      p.profileReady   ? '✅ profile-ready' : `⚠️  profile-invalid(${p.profileReason})`,
      p.hasAddress     ? 'address:✓' : 'address:✗',
      p.hasTimezone    ? 'tz:✓' : 'tz:✗',
      p.hasCountryCode ? 'cc:✓' : 'cc:✗',
      `cur:${p.currency ?? '—'}`,
    ].join('  ');
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`         ${flags}`);
  }
  console.log();

  // ── B: Geo-missing properties (candidates for geocoding) ─────────────────────
  console.log(`── B: GEO-MISSING (${geoMissing.length}) — candidates for --execute-geocode ──`);
  if (geoMissing.length === 0) {
    console.log('  (none)');
  }
  for (const p of geoMissing) {
    const flags = [
      p.hasAddress  ? '📍 has-address' : '❌ no-address (cannot geocode)',
      `cur:${p.currency ?? '—'}`,
    ].join('  ');
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`         ${flags}`);
  }
  console.log();

  // ── C: Currency missing ───────────────────────────────────────────────────────
  if (currencyMissing.length > 0) {
    console.log(`── C: CURRENCY-MISSING (${currencyMissing.length}) ──────────────────────────`);
    for (const p of currencyMissing) {
      console.log(`  [${p.id}] ${p.name}  — currency: ${p.currency ?? 'NULL'}`);
    }
    console.log();
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  const profileReadyCount = geoReady.filter(p => p.profileReady).length;
  console.log('── SUMMARY ──────────────────────────────────────────────────────');
  console.log(`  Total active BoostPrice    = ${props.length}`);
  console.log(`  Geo-ready                  = ${geoReady.length}`);
  console.log(`  Profile-ready              = ${profileReadyCount}`);
  console.log(`  Geo-missing                = ${geoMissing.length}`);
  console.log(`    of which has-address     = ${geoMissing.filter(p => p.hasAddress).length}  (geocodable with --execute-geocode)`);
  console.log(`    of which no-address      = ${geoMissing.filter(p => !p.hasAddress).length}  (needs manual address entry first)`);
  if (currencyMissing.length > 0) {
    console.log(`  Currency-missing           = ${currencyMissing.length}`);
  }

  // ── D: --execute-geocode mode ─────────────────────────────────────────────────
  if (!EXECUTE_GEOCODE) {
    console.log();
    console.log('  (read-only mode — rerun with --execute-geocode to resolve missing coords)');
    console.log('  Q9 CONSTRAINT: DO NOT run --execute-geocode until audit is reviewed.');
    return;
  }

  console.log();
  console.log('── D: EXECUTE-GEOCODE ───────────────────────────────────────────');
  console.log('  BRIGHT_DATA_CALLS_FROM_Q = 0  (Geoapify only, no market collection)');
  console.log('  MARKET_REFRESH_CALLS     = 0  (no scheduleMarketRefresh called)');
  console.log();

  const candidates = geoMissing.filter(p => p.hasAddress);
  if (candidates.length === 0) {
    console.log('  No geocodable candidates — all geo-missing properties lack an address.');
    return;
  }

  let resolved = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const p of candidates) {
    const address = rawAddressMap.get(p.id);
    if (!address) {
      console.log(`  [${p.id}] ${p.name} — SKIP: address disappeared`);
      skipped++;
      continue;
    }

    console.log(`  [${p.id}] ${p.name} — geocoding…`);
    const geo = await geocodeOneProperty(pool, { id: p.id, address });

    if (geo.status === 'resolved') {
      console.log(`    ✅ resolved — cc=${geo.countryCode} confidence=${geo.confidence?.toFixed(2)} type=${geo.resultType}`);
      resolved++;
    } else if (geo.status === 'error') {
      console.log(`    ❌ error — ${geo.reason}`);
      errors++;
    } else {
      console.log(`    ⏭  skipped — ${geo.reason}`);
      skipped++;
    }
  }

  console.log();
  console.log(`  Geocode results: resolved=${resolved}  skipped=${skipped}  errors=${errors}`);
  if (errors > 0) {
    console.log('  ⚠️  Some properties had errors — rerun to retry.');
  }
}

runAudit()
  .catch(err => {
    console.error('\nAudit error:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
