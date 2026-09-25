#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B5-A3 — Bright Data Airbnb Controlled Diagnostic
 *
 * Diagnoses the exact response schema of the Bright Data
 * "Airbnb Properties Information — Search Airbnb by location" scraper
 * for a single test location, resolving the last open question from B5-A2:
 *   → Does a location+currency request (no dates) return usable nightly prices?
 *
 * PREVIEW (default):
 *   BRIGHTDATA_CALLS = 0
 *   DB_READS         = 0
 *   DB_WRITES        = 0
 *   CHANNEX_CALLS    = 0
 *   PRICING_WRITES   = 0
 *   MARKET_DATA_WRITES = 0
 *
 * EXECUTE (--execute):
 *   BRIGHTDATA_JOBS_CREATED <= 1  (exactly one)
 *   DB_WRITES               = 0
 *   MARKET_DATA_WRITES      = 0
 *   CHANNEX_CALLS           = 0
 *   PRICING_WRITES          = 0
 *   APIFY_CALLS             = 0
 *   GEOAPIFY_CALLS          = 0
 *
 * PROHIBITED — this tool MUST NOT import or call:
 *   runDynamicPricingForOneProperty
 *   applyDynamicPricingForProperty
 *   priceProperty
 *   publishEffectivePricing
 *   writeScrapeResult
 *   scheduleMarketRefresh
 *   triggerChannexRatesSync
 *   pg / Pool (no DB connection)
 *
 * Usage:
 *   node outils/diag-brightdata-airbnb.js --location "Massy, France" --currency EUR
 *   node outils/diag-brightdata-airbnb.js --location "Massy, France" --currency EUR --execute
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const DATASET_ID           = 'gd_ld7ll037kqy322v05';
const BD_TRIGGER_BASE      = 'https://api.brightdata.com/datasets/v3/trigger';
const BD_PROGRESS_BASE     = 'https://api.brightdata.com/datasets/v3/progress';
const BD_SNAPSHOT_BASE     = 'https://api.brightdata.com/datasets/v3/snapshot';

// limit_per_input — documented Bright Data query parameter for controlling records
// returned per input object.  Confirmed in B5-A2 research from Bright Data API docs.
const MAX_RETURNED_RECORDS = 10;

const MAX_WAIT_MS          = 120_000;  // 2 minutes total
const POLL_INTERVAL_MS     = 5_000;   // 5-second poll interval

// Fields that must NEVER appear in diagnostic output (privacy / data protection)
const REDACTED_FIELDS = new Set([
  'url', 'final_url', 'listing_url',
  'name', 'listing_name', 'listing_title',
  'host_details', 'seller_info',
  'description', 'description_items', 'description_by_sections',
  'images', 'image',
  'reviews', 'reviews_details',
  'address',
  'location_details', 'breadcrumbs',
  'amenities', 'house_rules', 'highlights',
  'arrangement_details',
  'host_rating', 'hosts_year', 'host_response_rate',
  'host_number_of_reviews', 'is_superhost',
  'category_rating', 'travel_details',
]);

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Parse bedroom count from Bright Data's "details" string array.
 *   ["5 guests", "2 bedrooms", "4 beds", "1 bath"] → 2
 *   ["2 guests", "Studio", "1 bed"]                → 0
 *   null / missing / unparseable                   → null
 */
function parseBedrooms(details) {
  if (!Array.isArray(details)) return null;
  for (const s of details) {
    if (typeof s !== 'string') continue;
    if (/studio/i.test(s)) return 0;
    const m = s.match(/(\d+)\s+bedroom/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Sanitize a value from a pricing object for safe display.
 * Numbers → presence flag only; strings → truncated; objects → key list.
 */
function sanitizePricingValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number')  return `[NUMBER:${isFinite(v) ? v > 0 ? 'positive' : 'zero' : 'non-finite'}]`;
  if (typeof v === 'string')  return `[STRING:"${v.slice(0, 10)}${v.length > 10 ? '…' : ''}"]`;
  if (typeof v === 'boolean') return `[BOOL:${v}]`;
  if (typeof v === 'object')  return `[OBJECT:keys=${JSON.stringify(Object.keys(v || {}))}]`;
  return `[${typeof v}]`;
}

/**
 * Inspect one record's structural shape.
 * Returns only safe, non-PII fields.  Redacted fields are excluded from topLevelFields.
 */
function inspectRecord(record, index) {
  if (!record || typeof record !== 'object') {
    return { index, error: 'non-object record' };
  }

  const topLevelFields = Object.keys(record).sort().filter(f => !REDACTED_FIELDS.has(f));

  // Pricing details
  const pd = record.pricing_details;
  const pdPresent = pd !== null && pd !== undefined;
  let pricingDetailsFields = null;
  if (pdPresent && typeof pd === 'object') {
    pricingDetailsFields = Object.entries(pd).map(([k, v]) => ({
      key:       k,
      type:      typeof v,
      sanitized: sanitizePricingValue(v),
    }));
  }

  return {
    index,
    topLevelFieldCount:    Object.keys(record).length,
    topLevelFields,                              // redacted fields excluded
    property_id:           record.property_id   != null ? '[PRESENT]' : 'ABSENT',
    currency:              record.currency       ?? 'ABSENT',
    pricingDetailsPresent: pdPresent,
    pricingDetailsType:    pdPresent ? typeof pd : 'null',
    pricingDetailsFields,
    totalPrice:            record.total_price    != null ? '[PRESENT]' : 'ABSENT',
    availability:          record.availability   ?? 'ABSENT',
    availableDatesCount:   Array.isArray(record.available_dates) ? record.available_dates.length : null,
    detailsArray:          Array.isArray(record.details) ? record.details.slice(0, 6) : 'ABSENT',
    bedroomsParsed:        parseBedrooms(record.details),
    ratings:               record.ratings        ?? 'ABSENT',
    latPresent:            record.lat            != null,
    longPresent:           record.long           != null,
  };
}

/**
 * Analyze a full records array — price, currency, availability, bedrooms.
 * Only inspects up to 3 records structurally.
 */
function analyzeRecords(records, requestedCurrency) {
  if (!Array.isArray(records)) return { error: 'non-array records' };

  const pricePresent       = records.filter(r => r.pricing_details != null).length;
  const priceNull          = records.filter(r => r.pricing_details == null).length;
  const totalPricePresent  = records.filter(r => r.total_price      != null).length;

  // Currency
  const currencyValues    = [...new Set(records.map(r => r.currency).filter(Boolean))];
  const allCurrencyMatch  = (requestedCurrency && currencyValues.length > 0)
    ? currencyValues.every(c => c === requestedCurrency)
    : null;

  // Nightly price candidates (top-level + inside pricing_details)
  const nightlyCandidates = new Set();
  records.forEach(r => {
    Object.keys(r).forEach(k => {
      if (/night|nightly|per_night/i.test(k) && r[k] != null) nightlyCandidates.add(k);
    });
    if (r.pricing_details && typeof r.pricing_details === 'object') {
      Object.keys(r.pricing_details).forEach(k => {
        if (/night|nightly|per_night|rate/i.test(k))
          nightlyCandidates.add(`pricing_details.${k}`);
      });
    }
  });

  // Pricing details type and fields from first non-null
  const pdTypes = [...new Set(
    records.filter(r => r.pricing_details != null).map(r => typeof r.pricing_details))];
  const pricingDetailsType   = pdTypes.length === 0 ? 'null (all records)' : pdTypes.join(',');
  const firstPd = records.find(r => r.pricing_details != null && typeof r.pricing_details === 'object');
  const pricingDetailsFields = firstPd ? Object.keys(firstPd.pricing_details) : null;

  // Availability
  const availPresent      = records.filter(r => r.availability != null).length;
  const availValues       = [...new Set(records.map(r => r.availability).filter(v => v != null))];
  const availDatesPresent = records.filter(r => Array.isArray(r.available_dates) && r.available_dates.length > 0).length;
  const firstAvailDates   = records.find(r => Array.isArray(r.available_dates));
  const availDatesSampleLen = firstAvailDates ? firstAvailDates.available_dates.length : null;

  // Bedrooms
  const bedroomsParseable = records.filter(r => parseBedrooms(r.details) !== null).length;
  const bedroomExamples   = records.slice(0, 3).map(r => ({
    raw:    Array.isArray(r.details) ? r.details.slice(0, 6) : null,
    parsed: parseBedrooms(r.details),
  }));

  // Ratings
  const ratingsPresent = records.filter(r => r.ratings != null).length;

  // Inspect up to first 3 records only
  const sampledInspections = records.slice(0, 3).map((r, i) => inspectRecord(r, i));

  return {
    total:               records.length,
    pricePresent,
    priceNull,
    totalPricePresent,
    pricingDetailsType,
    pricingDetailsFields,
    currencyValues,
    allCurrencyMatch,
    nightlyCandidates: [...nightlyCandidates],
    availPresent,
    availValues,
    availDatesPresent,
    availDatesSampleLen,
    bedroomsParseable,
    bedroomExamples,
    ratingsPresent,
    sampledInspections,  // capped at 3
  };
}

// ── previewMode — ZERO network calls ─────────────────────────────────────────

async function previewMode({ location, currency }) {
  const keyPresent = !!process.env.BRIGHTDATA_API_KEY;

  console.log('\n' + '═'.repeat(70));
  console.log('  B5-A3 BRIGHT DATA DIAGNOSTIC — PREVIEW MODE');
  console.log('  BRIGHTDATA_CALLS   = 0');
  console.log('  DB_WRITES          = 0');
  console.log('  CHANNEX_CALLS      = 0');
  console.log('  PRICING_WRITES     = 0');
  console.log('  MARKET_DATA_WRITES = 0');
  console.log('═'.repeat(70));

  console.log('\n  ── REQUEST PLAN ─────────────────────────────────────────────');
  console.log(`  dataset_id           : ${DATASET_ID}`);
  console.log(`  type                 : discover_new`);
  console.log(`  discover_by          : location`);
  console.log(`  limit_per_input      : ${MAX_RETURNED_RECORDS}`);
  console.log(`  location             : "${location}"`);
  console.log(`  currency             : ${currency}`);
  console.log(`  check_in / check_out : NOT SENT (deliberate — testing price without dates)`);

  console.log('\n  ── READINESS ────────────────────────────────────────────────');
  console.log(`  BRIGHTDATA_API_KEY_PRESENT : ${keyPresent}`);
  console.log(`  MAX_RETURNED_RECORDS       : ${MAX_RETURNED_RECORDS}`);
  console.log(`  MAX_WAIT_SECONDS           : ${MAX_WAIT_MS / 1000}`);
  console.log(`  POLL_INTERVAL_SECONDS      : ${POLL_INTERVAL_MS / 1000}`);

  if (!keyPresent) {
    console.log('\n  ⚠️   BRIGHTDATA_API_KEY absent — --execute would abort immediately');
    console.log('       1. Create account: brightdata.com (no credit card needed)');
    console.log('       2. Navigate to: brightdata.com/cp/scrapers/browse');
    console.log(`       3. Find "Airbnb Properties Information" (dataset_id: ${DATASET_ID})`);
    console.log('       4. Copy your API token and set: BRIGHTDATA_API_KEY=<token>');
  } else {
    console.log('\n  ✅  Ready for --execute');
    console.log(`       Will consume up to ${MAX_RETURNED_RECORDS} free-tier records ($0.015 at PAYG).`);
  }

  console.log('\n  ── EXECUTE PLAN ─────────────────────────────────────────────');
  const triggerUrl = `${BD_TRIGGER_BASE}?dataset_id=${DATASET_ID}&format=json&type=discover_new&discover_by=location&limit_per_input=${MAX_RETURNED_RECORDS}`;
  console.log(`  1. POST ${triggerUrl}`);
  console.log(`     body: [{ "location": "${location}", "currency": "${currency}" }]`);
  console.log(`  2. Poll: GET ${BD_PROGRESS_BASE}/<snapshot_id> (max ${MAX_WAIT_MS / 1000}s)`);
  console.log(`  3. Download: GET ${BD_SNAPSHOT_BASE}/<snapshot_id>?format=json`);
  console.log(`  4. Analyze first 3 records — zero writes`);
  console.log('═'.repeat(70) + '\n');

  return { ok: true, keyPresent, location, currency };
}

// ── executeMode — exactly ONE Bright Data discovery job ───────────────────────
// deps = { fetchFn, pollIntervalMs, maxWaitMs } — all injectable for tests

async function executeMode({ location, currency }, deps = {}) {
  const fetchFn        = deps.fetchFn        || fetch;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const maxWaitMs      = deps.maxWaitMs      ?? MAX_WAIT_MS;

  // Guard: API key required before any network call
  const token = process.env.BRIGHTDATA_API_KEY;
  if (!token) {
    console.error('⛔  ABORT: BRIGHTDATA_API_KEY not set — no network call made');
    return { ok: false, abort: 'missing_api_key' };
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  B5-A3 BRIGHT DATA DIAGNOSTIC — EXECUTE MODE');
  console.log('  BRIGHTDATA_JOBS_CREATED <= 1');
  console.log('  DB_WRITES = 0 | CHANNEX_CALLS = 0 | PRICING_WRITES = 0');
  console.log('═'.repeat(70));
  console.log(`\n  location         : "${location}"`);
  console.log(`  currency         : ${currency}`);
  console.log(`  max_results      : ${MAX_RETURNED_RECORDS}`);
  console.log(`  dates            : NOT SENT (deliberate diagnostic for location+currency only)`);

  // ── Step 1: Trigger ONE discovery job ─────────────────────────────────────
  const triggerUrl = `${BD_TRIGGER_BASE}?dataset_id=${DATASET_ID}&format=json&type=discover_new&discover_by=location&limit_per_input=${MAX_RETURNED_RECORDS}`;
  const inputBody  = [{ location, currency }];

  console.log('\n  Triggering Bright Data discovery job...');

  let triggerData;
  try {
    const triggerRes = await fetchFn(triggerUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(inputBody),
    });

    if (!triggerRes.ok) {
      const errText = await triggerRes.text();
      // Never log the response body directly — may contain partial auth info
      console.error(`⛔  Trigger failed: HTTP ${triggerRes.status}`);
      return { ok: false, abort: `trigger_failed:${triggerRes.status}` };
    }
    triggerData = await triggerRes.json();
  } catch (err) {
    console.error(`⛔  Trigger network error: ${err.message}`);
    return { ok: false, abort: `trigger_network_error` };
  }

  const snapshotId = triggerData?.snapshot_id;
  if (!snapshotId) {
    console.error('⛔  No snapshot_id in trigger response');
    return { ok: false, abort: 'no_snapshot_id' };
  }
  console.log(`  ✅  BRIGHTDATA_JOB_CREATED = 1`);
  console.log(`  SNAPSHOT_ID: ${snapshotId}`);

  // ── Step 2: Bounded polling — NO retry that creates another job ───────────
  console.log(`\n  Polling (max ${maxWaitMs / 1000}s, every ${pollIntervalMs / 1000}s)...`);

  const deadline = Date.now() + maxWaitMs;
  let lastStatus = 'unknown';

  while (true) {
    if (Date.now() >= deadline) {
      console.error(`⛔  TIMEOUT: not ready within ${maxWaitMs / 1000}s (last: ${lastStatus})`);
      return { ok: false, abort: 'poll_timeout', snapshotId, lastStatus };
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));

    let progressData;
    try {
      const progressRes = await fetchFn(`${BD_PROGRESS_BASE}/${snapshotId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      progressData = await progressRes.json();
    } catch (err) {
      console.warn(`  ⚠️   Poll network error: ${err.message} — retrying`);
      continue;
    }

    lastStatus = progressData?.status ?? 'unknown';
    console.log(`  ⏳  status: ${lastStatus}`);

    if (lastStatus === 'ready') break;
    if (['failed', 'error', 'aborted'].includes(lastStatus)) {
      console.error(`⛔  Job ended in error state: ${lastStatus}`);
      return { ok: false, abort: `job_${lastStatus}`, snapshotId };
    }
    // Any other status (running, pending, etc.) → keep polling
  }

  // ── Step 3: Download snapshot ──────────────────────────────────────────────
  console.log('\n  Downloading snapshot...');

  let records;
  try {
    const snapshotRes = await fetchFn(`${BD_SNAPSHOT_BASE}/${snapshotId}?format=json`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!snapshotRes.ok) {
      console.error(`⛔  Snapshot download failed: HTTP ${snapshotRes.status}`);
      return { ok: false, abort: `snapshot_failed:${snapshotRes.status}`, snapshotId };
    }
    records = await snapshotRes.json();
  } catch (err) {
    console.error(`⛔  Snapshot network error: ${err.message}`);
    return { ok: false, abort: 'snapshot_network_error', snapshotId };
  }

  if (!Array.isArray(records)) {
    console.error('⛔  Snapshot response is not an array');
    return { ok: false, abort: 'snapshot_not_array', snapshotId };
  }

  console.log(`  ✅  ${records.length} record(s) returned`);
  console.log(`  RETURNED_RECORD_COUNT = ${records.length}`);

  // ── Step 4: Analyze ────────────────────────────────────────────────────────
  const analysis = analyzeRecords(records, currency);

  // Print schema analysis — sanitized, no PII
  console.log('\n' + '═'.repeat(70));
  console.log('  SCHEMA ANALYSIS');
  console.log('═'.repeat(70));

  console.log('\n  ── PRICE ────────────────────────────────────────────────────');
  console.log(`  PRICE_PRESENT_COUNT          : ${analysis.pricePresent}`);
  console.log(`  PRICE_NULL_COUNT             : ${analysis.priceNull}`);
  console.log(`  TOTAL_PRICE_PRESENT_COUNT    : ${analysis.totalPricePresent}`);
  console.log(`  PRICING_DETAILS_TYPE         : ${analysis.pricingDetailsType}`);
  if (analysis.pricingDetailsFields) {
    console.log(`  PRICING_DETAILS_FIELDS       : ${JSON.stringify(analysis.pricingDetailsFields)}`);
  }
  console.log(`  NIGHTLY_PRICE_CANDIDATES     : ${JSON.stringify(analysis.nightlyCandidates)}`);
  const priceIsNightly = analysis.nightlyCandidates.length > 0 ? 'CANDIDATE_FOUND_IN_STRUCTURE'
    : analysis.pricePresent > 0 ? 'UNKNOWN_STRUCTURE' : 'UNKNOWN_PRICE_NULL';
  console.log(`  PRICE_IS_NIGHTLY             : ${priceIsNightly}`);

  console.log('\n  ── CURRENCY ─────────────────────────────────────────────────');
  console.log(`  REQUESTED_CURRENCY           : ${currency}`);
  console.log(`  CURRENCY_VALUES_SEEN         : ${JSON.stringify(analysis.currencyValues)}`);
  console.log(`  ALL_RETURNED_CURRENCIES_MATCH: ${analysis.allCurrencyMatch ?? 'UNKNOWN'}`);

  console.log('\n  ── AVAILABILITY ─────────────────────────────────────────────');
  console.log(`  AVAILABILITY_FIELD_PRESENT   : ${analysis.availPresent > 0}`);
  console.log(`  AVAILABILITY_VALUES_SEEN     : ${JSON.stringify(analysis.availValues)}`);
  console.log(`  AVAILABLE_DATES_PRESENT      : ${analysis.availDatesPresent > 0}`);
  console.log(`  AVAILABLE_DATES_SAMPLE_LENGTH: ${analysis.availDatesSampleLen ?? 'N/A'}`);

  console.log('\n  ── BEDROOMS ─────────────────────────────────────────────────');
  console.log(`  BEDROOMS_PARSEABLE           : ${analysis.bedroomsParseable}/${analysis.total}`);
  analysis.bedroomExamples.forEach((ex, i) => {
    console.log(`  Example ${i}: ${JSON.stringify(ex.raw)} → ${ex.parsed}`);
  });

  console.log('\n  ── SAMPLED RECORDS (first 3, no PII) ────────────────────────');
  analysis.sampledInspections.forEach(r => {
    if (r.error) { console.log(`  Record #${r.index}: ${r.error}`); return; }
    console.log(`\n  Record #${r.index} (${r.topLevelFieldCount} fields total, ${r.topLevelFields.length} shown):`);
    console.log(`    fields         : ${r.topLevelFields.join(', ')}`);
    console.log(`    property_id    : ${r.property_id}`);
    console.log(`    currency       : ${r.currency}`);
    console.log(`    pricing_details: ${r.pricingDetailsPresent ? r.pricingDetailsType : 'NULL'}`);
    if (r.pricingDetailsFields) {
      r.pricingDetailsFields.forEach(f =>
        console.log(`      .${f.key} (${f.type}): ${f.sanitized}`)
      );
    }
    console.log(`    total_price    : ${r.totalPrice}`);
    console.log(`    availability   : ${r.availability}`);
    console.log(`    available_dates: ${r.availableDatesCount !== null ? `[${r.availableDatesCount} dates]` : 'ABSENT'}`);
    console.log(`    details        : ${JSON.stringify(r.detailsArray)}`);
    console.log(`    bedrooms_parsed: ${r.bedroomsParsed}`);
    console.log(`    ratings        : ${r.ratings}`);
    console.log(`    lat/long       : ${r.latPresent ? '[PRESENT]' : 'ABSENT'} / ${r.longPresent ? '[PRESENT]' : 'ABSENT'}`);
  });

  // ── Final diagnostic verdict ───────────────────────────────────────────────
  const pricePopulated     = analysis.pricePresent > 0;
  const canBuildAdapter    = pricePopulated        ? 'YES'
    : records.length === 0 ? 'UNKNOWN_NO_RECORDS'
    : 'NO — NEED_DATE_TEST';

  console.log('\n' + '═'.repeat(70));
  console.log('  DIAGNOSTIC VERDICT');
  console.log('═'.repeat(70));
  console.log(`  LOCATION_ONLY_REQUEST_ACCEPTED : ${records.length > 0}`);
  console.log(`  RECORDS_RETURNED               : ${records.length}`);
  console.log(`  PRICE_POPULATED_WITHOUT_DATES  : ${pricePopulated}`);
  console.log(`  PRICING_DETAILS_TYPE           : ${analysis.pricingDetailsType}`);
  console.log(`  NIGHTLY_PRICE_FIELD            : ${analysis.nightlyCandidates[0] ?? 'NOT_FOUND'}`);
  console.log(`  PRICE_IS_NIGHTLY               : ${priceIsNightly}`);
  console.log(`  CURRENCY_FIELD_PRESENT         : ${analysis.currencyValues.length > 0}`);
  console.log(`  CURRENCY_MATCH                 : ${analysis.allCurrencyMatch ?? 'UNKNOWN'}`);
  console.log(`  AVAILABILITY_FIELD_PRESENT     : ${analysis.availPresent > 0}`);
  console.log(`  AVAILABLE_DATES_PRESENT        : ${analysis.availDatesPresent > 0}`);
  console.log(`  BEDROOMS_PARSEABLE             : ${analysis.bedroomsParseable}/${analysis.total}`);
  console.log(`  RATING_FIELD_PRESENT           : ${analysis.ratingsPresent > 0}`);
  console.log(`  CAN_BUILD_BRIGHTDATA_ADAPTER   : ${canBuildAdapter}`);

  if (!pricePopulated && records.length > 0) {
    console.log('\n  NEXT_REQUIRED_TEST =');
    console.log('    "Controlled location + currency + future dates diagnostic"');
    console.log('    Add --check-in and --check-out to next diagnostic run.');
  }

  console.log('\n  DB_WRITES = 0 | CHANNEX_CALLS = 0 | PRICING_WRITES = 0');
  console.log('  BRIGHTDATA_JOBS_CREATED = 1');
  console.log('═'.repeat(70) + '\n');

  return {
    ok:            true,
    snapshotId,
    recordCount:   records.length,
    analysis,
    pricePopulated,
    canBuildAdapter,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  let location = null;
  let currency = 'EUR';
  let execute  = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--location' && args[i + 1]) location = args[++i];
    if (args[i] === '--currency' && args[i + 1]) currency = args[++i].toUpperCase();
    if (args[i] === '--execute')                 execute  = true;
  }

  if (!location) {
    console.error('Usage: node outils/diag-brightdata-airbnb.js --location "<location>" [--currency EUR] [--execute]');
    console.error('  --location is mandatory');
    console.error('  --execute requires BRIGHTDATA_API_KEY in environment');
    process.exit(1);
  }

  const run = execute
    ? executeMode({ location, currency })
    : previewMode({ location, currency });

  run.catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = {
  previewMode,
  executeMode,
  parseBedrooms,
  analyzeRecords,
  inspectRecord,
  DATASET_ID,
  MAX_RETURNED_RECORDS,
  MAX_WAIT_MS,
};
