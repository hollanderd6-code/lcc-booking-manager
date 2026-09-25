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
 *   node outils/diag-brightdata-airbnb.js --snapshot-id <id>        (resume existing snapshot)
 *
 * SNAPSHOT RESUME MODE (--snapshot-id):
 *   BRIGHTDATA_TRIGGER_POSTS = 0  — never calls POST /trigger
 *   NEW_JOBS_CREATED         = 0
 *   DB_WRITES                = 0
 *   CHANNEX_CALLS            = 0
 *   PRICING_WRITES           = 0
 *   --location is NOT required; --execute is NOT required
 *   BRIGHTDATA_API_KEY is still required for GET /progress and GET /snapshot
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

// Fields that match /night/ but are NOT prices — must NEVER become price candidates
const NON_PRICE_FIELDS = new Set([
  'minimum_nights', 'minimum_stay', 'min_nights', 'minimum_night',
  'max_nights', 'maximum_nights', 'max_stay',
  'nights',             // number of nights booked, not a monetary value
  'num_of_nights', 'number_of_nights', 'nb_nights', 'n_nights',  // duration count, not a price
  'checkin_time', 'checkout_time',
  'guests', 'guest_count', 'min_guests', 'max_guests',
  'ratings', 'rating', 'review_count', 'reviews_count',
  'bedrooms', 'beds', 'bathrooms', 'rooms',
]);

/**
 * Classify a pricing_details key into a price category.
 * Returns one of: BASE_NIGHTLY | CLEANING_FEE | SERVICE_FEE | TAX | TOTAL | OTHER
 */
function classifyPricingField(key) {
  const k = key.toLowerCase();
  if (/\btotal\b|grand_total/.test(k))                                   return 'TOTAL';
  if (/base|accommodation|room_rate|rate_per|per_night|nightly_rate|per_day/.test(k)) return 'BASE_NIGHTLY';
  if (/clean/.test(k))                                                    return 'CLEANING_FEE';
  if (/service|host_fee|guest_fee/.test(k))                               return 'SERVICE_FEE';
  if (/\btax\b|vat|tva|gst/.test(k))                                     return 'TAX';
  return 'OTHER';
}

/**
 * Validate an optional check-in / check-out pair.
 * Both must be present together, YYYY-MM-DD, check-out > check-in, future dates.
 * Returns { ok: true, checkIn, checkOut, nights } or { ok: false, error: '...' }
 */
function validateDates(checkIn, checkOut) {
  if (!checkIn && !checkOut) return { ok: true, checkIn: null, checkOut: null, nights: null };
  if (checkIn  && !checkOut) return { ok: false, error: '--check-in requires --check-out' };
  if (!checkIn && checkOut)  return { ok: false, error: '--check-out requires --check-in' };

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO_DATE.test(checkIn))  return { ok: false, error: `--check-in format must be YYYY-MM-DD, got: "${checkIn}"` };
  if (!ISO_DATE.test(checkOut)) return { ok: false, error: `--check-out format must be YYYY-MM-DD, got: "${checkOut}"` };

  const inDate  = new Date(checkIn  + 'T00:00:00Z');
  const outDate = new Date(checkOut + 'T00:00:00Z');

  if (isNaN(inDate.getTime()))  return { ok: false, error: `--check-in is not a valid date: "${checkIn}"` };
  if (isNaN(outDate.getTime())) return { ok: false, error: `--check-out is not a valid date: "${checkOut}"` };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (inDate < today)    return { ok: false, error: `--check-in must be a future date, got: "${checkIn}"` };
  if (outDate <= inDate) return { ok: false, error: `--check-out must be after --check-in (${checkIn} → ${checkOut})` };

  const nights = Math.round((outDate - inDate) / (1000 * 60 * 60 * 24));
  return { ok: true, checkIn, checkOut, nights };
}

// ── Error sanitization ────────────────────────────────────────────────────────

const ERROR_BODY_MAX_CHARS = 4000;
const ERROR_USEFUL_KEYS    = ['error', 'message', 'code', 'details', 'errors',
                               'description', 'reason', 'status', 'statusCode', 'type'];

function redactSecrets(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/Bearer\s+\S+/gi,                       'Bearer [REDACTED]')
    .replace(/"[Aa]uthorization"\s*:\s*"[^"]*"/g,    '"authorization": "[REDACTED]"')
    .replace(/"[Aa]pi_?[Kk]ey"\s*:\s*"[^"]*"/g,      '"api_key": "[REDACTED]"')
    .replace(/"[Aa]pikey"\s*:\s*"[^"]*"/g,            '"apikey": "[REDACTED]"')
    .replace(/"[Tt]oken"\s*:\s*"[^"]*"/g,             '"token": "[REDACTED]"')
    .replace(/\bapi_?key=[^&\s"'<>]*/gi,              'api_key=[REDACTED]')
    .replace(/\btoken=[^&\s"'<>]*/gi,                 'token=[REDACTED]');
}

/**
 * Sanitize a Bright Data error response body for safe console display.
 * Parses JSON when possible, redacts all secret patterns, truncates to maxLen.
 */
function sanitizeErrorBody(rawText, contentType, maxLen) {
  if (maxLen === undefined) maxLen = ERROR_BODY_MAX_CHARS;
  if (!rawText) return '(empty response body)';

  // Always try JSON parse — Bright Data may not set content-type correctly
  let jsonObj = null;
  try { jsonObj = JSON.parse(rawText); } catch {}

  if (jsonObj !== null && typeof jsonObj === 'object') {
    const useful = {};
    ERROR_USEFUL_KEYS.forEach(k => { if (jsonObj[k] !== undefined) useful[k] = jsonObj[k]; });
    const pretty = JSON.stringify(Object.keys(useful).length > 0 ? useful : jsonObj, null, 2);
    return redactSecrets(pretty).slice(0, maxLen);
  }

  return redactSecrets(rawText).slice(0, maxLen);
}

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
      category:  classifyPricingField(k),
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
 * Per-record numeric price analysis from pricing_details + top-level fields.
 * Returns: perRecord[], aggregates{}, oneNightWarning, oneNightRecords.
 * Numeric price values are intentionally shown (not redacted).
 */
function analyzePriceStructure(records) {
  const emptyAgg = {
    COUNT_PRICE_PER_NIGHT_PRESENT: 0, COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT: 0,
    COUNT_PRICE_EQUALS_PRICE_PER_NIGHT: 0, COUNT_INITIAL_EQUALS_PRICE_PER_NIGHT: 0,
    COUNT_PRICE_WITHOUT_FEES_EQUALS_PRICE_PER_NIGHT: 0, COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT: 0,
  };
  if (!Array.isArray(records) || records.length === 0) {
    return { perRecord: [], aggregates: emptyAgg, oneNightWarning: false, oneNightRecords: 0 };
  }

  const extractNum = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const extractFee = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'object') return `[OBJ:${JSON.stringify(v).slice(0, 40)}]`;
    return null;
  };

  const perRecord = records.map((r, idx) => {
    const pd = r.pricing_details && typeof r.pricing_details === 'object' ? r.pricing_details : null;
    return {
      idx,
      currency:                r.currency                              ?? null,
      num_of_nights:           pd ? extractNum(pd.num_of_nights)           : null,
      price:                   extractNum(r.price),
      initial_price_per_night: pd ? extractNum(pd.initial_price_per_night) : null,
      price_per_night:         pd ? extractNum(pd.price_per_night)         : null,
      price_without_fees:      pd ? extractNum(pd.price_without_fees)      : null,
      total_price:             extractNum(r.total_price),
      cleaning_fee:            pd ? extractFee(pd.cleaning_fee)            : null,
      airbnb_service_fee:      pd ? extractFee(pd.airbnb_service_fee)      : null,
      taxes:                   pd ? extractFee(pd.taxes)                   : null,
      special_offer:           pd ? extractFee(pd.special_offer)           : null,
    };
  });

  let COUNT_PRICE_PER_NIGHT_PRESENT                    = 0;
  let COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT            = 0;
  let COUNT_PRICE_EQUALS_PRICE_PER_NIGHT               = 0;
  let COUNT_INITIAL_EQUALS_PRICE_PER_NIGHT             = 0;
  let COUNT_PRICE_WITHOUT_FEES_EQUALS_PRICE_PER_NIGHT  = 0;
  let COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT               = 0;
  let oneNightRecords                                  = 0;

  perRecord.forEach(r => {
    if (r.price_per_night         !== null) COUNT_PRICE_PER_NIGHT_PRESENT++;
    if (r.initial_price_per_night !== null) COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT++;
    if (r.num_of_nights === 1) oneNightRecords++;
    if (r.price !== null && r.price_per_night !== null && r.price === r.price_per_night)
      COUNT_PRICE_EQUALS_PRICE_PER_NIGHT++;
    if (r.initial_price_per_night !== null && r.price_per_night !== null
        && r.initial_price_per_night === r.price_per_night)
      COUNT_INITIAL_EQUALS_PRICE_PER_NIGHT++;
    if (r.price_without_fees !== null && r.price_per_night !== null
        && r.price_without_fees === r.price_per_night)
      COUNT_PRICE_WITHOUT_FEES_EQUALS_PRICE_PER_NIGHT++;
    if (r.total_price !== null && r.price_per_night !== null
        && r.total_price === r.price_per_night)
      COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT++;
  });

  return {
    perRecord,
    aggregates: {
      COUNT_PRICE_PER_NIGHT_PRESENT,
      COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT,
      COUNT_PRICE_EQUALS_PRICE_PER_NIGHT,
      COUNT_INITIAL_EQUALS_PRICE_PER_NIGHT,
      COUNT_PRICE_WITHOUT_FEES_EQUALS_PRICE_PER_NIGHT,
      COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT,
    },
    oneNightWarning: oneNightRecords > 0,
    oneNightRecords,
  };
}

/**
 * Scan all field names across records for bedroom/bed/guest/category sources.
 * Returns: structuredFields, bedFields, guestFields, categoryFields, detailsTextFound, bestSource.
 */
function analyzeBedroomSources(records) {
  const empty = { structuredFields: [], bedFields: [], guestFields: [], categoryFields: [], detailsTextFound: false, bestSource: 'UNAVAILABLE' };
  if (!Array.isArray(records) || records.length === 0) return empty;

  const structuredFields = [];
  const bedFields        = [];
  const guestFields      = [];
  const categoryFields   = [];

  const allKeys = new Set();
  records.forEach(r => {
    Object.keys(r).forEach(k => allKeys.add(k));
    if (r.pricing_details && typeof r.pricing_details === 'object') {
      Object.keys(r.pricing_details).forEach(k => allKeys.add(`pricing_details.${k}`));
    }
  });

  allKeys.forEach(key => {
    if (REDACTED_FIELDS.has(key)) return;
    const k = key.toLowerCase();
    if (/bedroom|num_bed|number_of_bed/.test(k)) {
      if (!structuredFields.includes(key)) structuredFields.push(key);
    } else if (/^beds?$|^num_beds?$|^number_of_beds?$/.test(k)) {
      if (!bedFields.includes(key)) bedFields.push(key);
    } else if (/\bguest|\bperson|\bpeople|\boccupan/.test(k) && !/check/.test(k) && !/guest_fee/.test(k)) {
      if (!guestFields.includes(key)) guestFields.push(key);
    } else if (/\bcategory\b|\broom_type\b|\bunit_type\b|\bproperty_type\b/.test(k)) {
      if (!categoryFields.includes(key)) categoryFields.push(key);
    }
  });

  const detailsTextFound = records.some(r => parseBedrooms(r.details) !== null);

  let bestSource = 'UNAVAILABLE';
  if (structuredFields.length > 0) bestSource = structuredFields[0];
  else if (detailsTextFound)        bestSource = 'details[].bedroom_text';

  return { structuredFields, bedFields, guestFields, categoryFields, detailsTextFound, bestSource };
}

/**
 * Build a concise adapter decision from aggregated analysis results.
 * Returns: RECOMMENDED_NIGHTLY_PRICE_FIELD, INITIAL_PRICE_FIELD, PRICE_WITHOUT_FEES_SEMANTICS,
 *          TOTAL_PRICE_SEMANTICS, CURRENCY_VALIDATED, BEDROOM_SOURCE,
 *          CAN_NORMALIZE_PRICE, CAN_NORMALIZE_BEDROOMS, CAN_BUILD_BRIGHTDATA_ADAPTER.
 */
function buildAdapterDecision(priceStructure, bedroomSources, currencyValues, requestedCurrency) {
  const agg = priceStructure?.aggregates ?? {};
  const pr  = priceStructure?.perRecord  ?? [];

  let RECOMMENDED_NIGHTLY_PRICE_FIELD = 'NOT_FOUND';
  if ((agg.COUNT_PRICE_PER_NIGHT_PRESENT ?? 0) > 0) {
    RECOMMENDED_NIGHTLY_PRICE_FIELD = 'pricing_details.price_per_night';
  } else if ((agg.COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT ?? 0) > 0) {
    RECOMMENDED_NIGHTLY_PRICE_FIELD = 'pricing_details.initial_price_per_night';
  }

  const INITIAL_PRICE_FIELD = (agg.COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT ?? 0) > 0
    ? 'pricing_details.initial_price_per_night' : 'ABSENT';

  let PRICE_WITHOUT_FEES_SEMANTICS = 'ABSENT';
  if (pr.some(r => r.price_without_fees !== null)) {
    PRICE_WITHOUT_FEES_SEMANTICS = (agg.COUNT_PRICE_WITHOUT_FEES_EQUALS_PRICE_PER_NIGHT ?? 0) > 0
      ? 'EQUALS_PRICE_PER_NIGHT_FOR_SOME_RECORDS'
      : 'PRESENT_DIFFERS_FROM_PRICE_PER_NIGHT';
  }

  let TOTAL_PRICE_SEMANTICS = 'ABSENT';
  if (pr.some(r => r.total_price !== null)) {
    TOTAL_PRICE_SEMANTICS = (agg.COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT ?? 0) > 0
      ? 'SOMETIMES_EQUALS_PRICE_PER_NIGHT'
      : 'LIKELY_TOTAL_WITH_FEES';
  }

  const CURRENCY_VALIDATED = (requestedCurrency && Array.isArray(currencyValues) && currencyValues.length > 0)
    ? (currencyValues.every(c => c === requestedCurrency) ? 'YES' : 'MISMATCH')
    : 'UNKNOWN';

  const BEDROOM_SOURCE             = bedroomSources?.bestSource ?? 'UNAVAILABLE';
  const CAN_NORMALIZE_PRICE        = RECOMMENDED_NIGHTLY_PRICE_FIELD !== 'NOT_FOUND' ? 'YES' : 'NO';
  const CAN_NORMALIZE_BEDROOMS     = BEDROOM_SOURCE !== 'UNAVAILABLE' ? 'YES' : 'NO';
  const CAN_BUILD_BRIGHTDATA_ADAPTER = CAN_NORMALIZE_PRICE === 'YES' ? 'YES' : 'NO_NEED_MORE_DATA';

  return {
    RECOMMENDED_NIGHTLY_PRICE_FIELD,
    INITIAL_PRICE_FIELD,
    PRICE_WITHOUT_FEES_SEMANTICS,
    TOTAL_PRICE_SEMANTICS,
    CURRENCY_VALIDATED,
    BEDROOM_SOURCE,
    CAN_NORMALIZE_PRICE,
    CAN_NORMALIZE_BEDROOMS,
    CAN_BUILD_BRIGHTDATA_ADAPTER,
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

  // Nightly price candidates — numeric monetary values only.
  // NON_PRICE_FIELDS explicitly excluded: minimum_nights, guests, ratings, etc.
  const nightlyCandidates = new Set();
  records.forEach(r => {
    Object.keys(r).forEach(k => {
      if (/night|nightly|per_night/i.test(k)
          && !NON_PRICE_FIELDS.has(k)
          && typeof r[k] === 'number'
          && r[k] > 0) {
        nightlyCandidates.add(k);
      }
    });
    if (r.pricing_details && typeof r.pricing_details === 'object') {
      Object.keys(r.pricing_details).forEach(k => {
        if (/night|nightly|per_night|rate/i.test(k) && !NON_PRICE_FIELDS.has(k))
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

  // Price decomposition — classify each pricing_details key into a fee category
  const priceDecomposition = { BASE_NIGHTLY: [], CLEANING_FEE: [], SERVICE_FEE: [], TAX: [], TOTAL: [], OTHER: [] };
  records.forEach(r => {
    if (r.pricing_details && typeof r.pricing_details === 'object') {
      Object.keys(r.pricing_details).forEach(k => {
        const cat = classifyPricingField(k);
        if (!priceDecomposition[cat].includes(k)) priceDecomposition[cat].push(k);
      });
    }
  });
  // Warn: if total + at least one fee type → total_price ≠ nightly rate
  const activeDecompCats = Object.entries(priceDecomposition).filter(([, v]) => v.length > 0).map(([k]) => k);
  const totalPriceWarnMultiFee = totalPricePresent > 0
    && activeDecompCats.length > 1
    && activeDecompCats.includes('TOTAL')
    && activeDecompCats.some(c => ['CLEANING_FEE', 'SERVICE_FEE', 'TAX'].includes(c));

  // Bedroom alternative fields — scan top-level keys beyond details[] in case dates add a bedrooms field
  const bedroomAltFields = [];
  if (records.length > 0) {
    const sample = records[0];
    Object.keys(sample).filter(k => !REDACTED_FIELDS.has(k)).forEach(k => {
      if (/bedroom|^beds?$|num_bed/i.test(k) && sample[k] != null) {
        bedroomAltFields.push({ key: k, sampleValue: sample[k] });
      }
    });
  }

  // Inspect up to first 3 records only
  const sampledInspections = records.slice(0, 3).map((r, i) => inspectRecord(r, i));

  // Extended analysis
  const priceStructure  = analyzePriceStructure(records);
  const bedroomSources  = analyzeBedroomSources(records);
  const adapterDecision = buildAdapterDecision(priceStructure, bedroomSources, currencyValues, requestedCurrency);

  return {
    total:               records.length,
    pricePresent,
    priceNull,
    totalPricePresent,
    pricingDetailsType,
    pricingDetailsFields,
    priceDecomposition,
    totalPriceWarnMultiFee,
    currencyValues,
    allCurrencyMatch,
    nightlyCandidates: [...nightlyCandidates],
    availPresent,
    availValues,
    availDatesPresent,
    availDatesSampleLen,
    bedroomsParseable,
    bedroomExamples,
    bedroomAltFields,
    ratingsPresent,
    sampledInspections,  // capped at 3
    priceStructure,
    bedroomSources,
    adapterDecision,
  };
}

// ── previewMode — ZERO network calls ─────────────────────────────────────────

async function previewMode({ location, currency, checkIn = null, checkOut = null }) {
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
  if (checkIn && checkOut) {
    const dv = validateDates(checkIn, checkOut);
    console.log(`  check_in             : ${checkIn}`);
    console.log(`  check_out            : ${checkOut}`);
    console.log(`  nights               : ${dv.ok ? dv.nights : '(validation error)'}`);
  } else {
    console.log(`  check_in / check_out : NOT SENT (location+currency only mode)`);
  }

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
  const triggerUrl  = `${BD_TRIGGER_BASE}?dataset_id=${DATASET_ID}&format=json&type=discover_new&discover_by=location&limit_per_input=${MAX_RETURNED_RECORDS}`;
  const previewBody = checkIn && checkOut
    ? [{ location, currency, check_in: checkIn, check_out: checkOut }]
    : [{ location, currency }];
  console.log(`  1. POST ${triggerUrl}`);
  console.log(`     EXACT BODY (sanitized):`);
  JSON.stringify(previewBody, null, 2).split('\n').forEach(l => console.log(`       ${l}`));
  console.log(`  2. Poll: GET ${BD_PROGRESS_BASE}/<snapshot_id> (max ${MAX_WAIT_MS / 1000}s)`);
  console.log(`  3. Download: GET ${BD_SNAPSHOT_BASE}/<snapshot_id>?format=json`);
  console.log(`  4. Analyze first 3 records — zero writes`);
  console.log('═'.repeat(70) + '\n');

  return { ok: true, keyPresent, location, currency, checkIn, checkOut };
}

// ── Shared analysis print (used by executeMode and snapshotResumeMode) ───────

function printSchemaAnalysisAndVerdict(records, currency, analysis) {
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

  // Price decomposition
  if (analysis.priceDecomposition) {
    const d = analysis.priceDecomposition;
    const hasDecomp = Object.values(d).some(v => v.length > 0);
    if (hasDecomp) {
      console.log('\n  ── PRICE DECOMPOSITION (pricing_details fields by category) ─');
      console.log(`  BASE_NIGHTLY             : ${JSON.stringify(d.BASE_NIGHTLY)}`);
      console.log(`  CLEANING_FEE             : ${JSON.stringify(d.CLEANING_FEE)}`);
      console.log(`  SERVICE_FEE              : ${JSON.stringify(d.SERVICE_FEE)}`);
      console.log(`  TAX                      : ${JSON.stringify(d.TAX)}`);
      console.log(`  TOTAL                    : ${JSON.stringify(d.TOTAL)}`);
      console.log(`  OTHER                    : ${JSON.stringify(d.OTHER)}`);
    }
    if (analysis.totalPriceWarnMultiFee) {
      console.log('\n  ⚠️  WARNING: total_price includes multiple fee types.');
      console.log('      total_price ≠ nightly_rate. Use BASE_NIGHTLY field for the accommodation rate.');
    }
  }

  // Detailed per-record price analysis
  if (analysis.priceStructure && analysis.priceStructure.perRecord.length > 0) {
    const ps = analysis.priceStructure;
    console.log('\n  ── DETAILED PRICE ANALYSIS (per record, no PII) ─────────────');
    const hdrs = ['#', 'curr', 'nights', 'price', 'init_ppn', 'ppn', 'pwf', 'total', 'clean', 'svc', 'tax', 'offer'];
    console.log('  ' + hdrs.map(h => h.padEnd(9)).join(' '));
    ps.perRecord.forEach(r => {
      const fmt = v => (v === null ? 'null' : String(v).slice(0, 9)).padEnd(9);
      console.log('  ' + [
        String(r.idx).padEnd(9), (r.currency || 'null').padEnd(9),
        fmt(r.num_of_nights), fmt(r.price), fmt(r.initial_price_per_night),
        fmt(r.price_per_night), fmt(r.price_without_fees), fmt(r.total_price),
        fmt(r.cleaning_fee), fmt(r.airbnb_service_fee), fmt(r.taxes), fmt(r.special_offer),
      ].join(' '));
    });
    const a = ps.aggregates;
    console.log('\n  Aggregates:');
    console.log(`  COUNT_PRICE_PER_NIGHT_PRESENT              : ${a.COUNT_PRICE_PER_NIGHT_PRESENT}`);
    console.log(`  COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT      : ${a.COUNT_INITIAL_PRICE_PER_NIGHT_PRESENT}`);
    console.log(`  COUNT_PRICE_EQUALS_PRICE_PER_NIGHT         : ${a.COUNT_PRICE_EQUALS_PRICE_PER_NIGHT}`);
    console.log(`  COUNT_INITIAL_EQUALS_PRICE_PER_NIGHT       : ${a.COUNT_INITIAL_EQUALS_PRICE_PER_NIGHT}`);
    console.log(`  COUNT_PRICE_WITHOUT_FEES_EQ_PRICE_PER_NIGHT: ${a.COUNT_PRICE_WITHOUT_FEES_EQUALS_PRICE_PER_NIGHT}`);
    console.log(`  COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT         : ${a.COUNT_TOTAL_EQUALS_PRICE_PER_NIGHT}`);
    if (ps.oneNightWarning) {
      console.log(`\n  ⚠️  WARNING: ${ps.oneNightRecords} record(s) have num_of_nights=1.`);
      console.log('      price_per_night may accidentally equal total_price for 1-night stays.');
    }
  }

  console.log('\n  ── CURRENCY ─────────────────────────────────────────────────');
  console.log(`  REQUESTED_CURRENCY           : ${currency ?? '(none)'}`);
  console.log(`  CURRENCY_VALUES_SEEN         : ${JSON.stringify(analysis.currencyValues)}`);
  console.log(`  ALL_RETURNED_CURRENCIES_MATCH: ${analysis.allCurrencyMatch ?? 'UNKNOWN'}`);

  console.log('\n  ── AVAILABILITY ─────────────────────────────────────────────');
  console.log(`  AVAILABILITY_FIELD_PRESENT   : ${analysis.availPresent > 0}`);
  console.log(`  AVAILABILITY_VALUES_SEEN     : ${JSON.stringify(analysis.availValues)}`);
  console.log(`  AVAILABLE_DATES_PRESENT      : ${analysis.availDatesPresent > 0}`);
  console.log(`  AVAILABLE_DATES_SAMPLE_LENGTH: ${analysis.availDatesSampleLen ?? 'N/A'}`);

  console.log('\n  ── BEDROOMS ─────────────────────────────────────────────────');
  console.log(`  BEDROOMS_PARSEABLE (details[]): ${analysis.bedroomsParseable}/${analysis.total}`);
  analysis.bedroomExamples.forEach((ex, i) => {
    console.log(`  Example ${i}: ${JSON.stringify(ex.raw)} → ${ex.parsed}`);
  });
  if (analysis.bedroomAltFields && analysis.bedroomAltFields.length > 0) {
    console.log('  BEDROOM_ALT_FIELDS:');
    analysis.bedroomAltFields.forEach(f => {
      console.log(`    ${f.key} : ${JSON.stringify(f.sampleValue)}`);
    });
  } else {
    console.log('  BEDROOM_ALT_FIELDS           : none found outside details[]');
  }

  if (analysis.bedroomSources) {
    const bs = analysis.bedroomSources;
    console.log('\n  ── BEDROOM SOURCE ANALYSIS ──────────────────────────────────');
    console.log(`  STRUCTURED_BEDROOM_FIELDS    : ${JSON.stringify(bs.structuredFields)}`);
    console.log(`  BED_FIELDS (not bedrooms)    : ${JSON.stringify(bs.bedFields)}`);
    console.log(`  GUEST_FIELDS (not bedrooms)  : ${JSON.stringify(bs.guestFields)}`);
    console.log(`  CATEGORY_FIELDS              : ${JSON.stringify(bs.categoryFields)}`);
    console.log(`  DETAILS_TEXT_FOUND           : ${bs.detailsTextFound}`);
    console.log(`  BEST_BEDROOM_SOURCE          : ${bs.bestSource}`);
  }

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
        console.log(`      .${f.key} [${f.category}] (${f.type}): ${f.sanitized}`)
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

  const pricePopulated  = analysis.pricePresent > 0;
  const canBuildAdapter = analysis.adapterDecision?.CAN_BUILD_BRIGHTDATA_ADAPTER
    ?? (pricePopulated ? 'YES' : records.length === 0 ? 'UNKNOWN_NO_RECORDS' : 'NO — NEED_DATE_TEST');

  console.log('\n' + '═'.repeat(70));
  console.log('  DIAGNOSTIC VERDICT');
  console.log('═'.repeat(70));
  console.log(`  LOCATION_ONLY_REQUEST_ACCEPTED : ${records.length > 0}`);
  console.log(`  RECORDS_RETURNED               : ${records.length}`);
  console.log(`  PRICE_POPULATED                : ${pricePopulated}`);
  console.log(`  PRICING_DETAILS_TYPE           : ${analysis.pricingDetailsType}`);
  console.log(`  NIGHTLY_PRICE_FIELD            : ${analysis.nightlyCandidates[0] ?? 'NOT_FOUND'}`);
  if (analysis.totalPriceWarnMultiFee) {
    console.log(`  TOTAL_PRICE_WARN_MULTI_FEE     : true — inspect BASE_NIGHTLY, not total_price`);
  }
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

  if (analysis.adapterDecision) {
    const ad = analysis.adapterDecision;
    console.log('\n' + '═'.repeat(70));
    console.log('  ADAPTER DECISION');
    console.log('═'.repeat(70));
    console.log(`  RECOMMENDED_NIGHTLY_PRICE_FIELD   : ${ad.RECOMMENDED_NIGHTLY_PRICE_FIELD}`);
    console.log(`  INITIAL_PRICE_FIELD               : ${ad.INITIAL_PRICE_FIELD}`);
    console.log(`  PRICE_WITHOUT_FEES_SEMANTICS       : ${ad.PRICE_WITHOUT_FEES_SEMANTICS}`);
    console.log(`  TOTAL_PRICE_SEMANTICS              : ${ad.TOTAL_PRICE_SEMANTICS}`);
    console.log(`  CURRENCY_VALIDATED                 : ${ad.CURRENCY_VALIDATED}`);
    console.log(`  BEDROOM_SOURCE                     : ${ad.BEDROOM_SOURCE}`);
    console.log(`  CAN_NORMALIZE_PRICE                : ${ad.CAN_NORMALIZE_PRICE}`);
    console.log(`  CAN_NORMALIZE_BEDROOMS             : ${ad.CAN_NORMALIZE_BEDROOMS}`);
    console.log(`  CAN_BUILD_BRIGHTDATA_ADAPTER       : ${ad.CAN_BUILD_BRIGHTDATA_ADAPTER}`);
  }

  return { priceIsNightly, pricePopulated, canBuildAdapter, adapterDecision: analysis.adapterDecision };
}

// ── executeMode — exactly ONE Bright Data discovery job ───────────────────────
// deps = { fetchFn, pollIntervalMs, maxWaitMs } — all injectable for tests

async function executeMode({ location, currency, checkIn = null, checkOut = null }, deps = {}) {
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
  if (checkIn && checkOut) {
    const dv = validateDates(checkIn, checkOut);
    console.log(`  check_in         : ${checkIn}`);
    console.log(`  check_out        : ${checkOut}`);
    console.log(`  nights           : ${dv.ok ? dv.nights : '(validation error)'}`);
  } else {
    console.log(`  dates            : NOT SENT (location+currency only)`);
  }

  // ── Step 1: Trigger ONE discovery job ─────────────────────────────────────
  const triggerUrl = `${BD_TRIGGER_BASE}?dataset_id=${DATASET_ID}&format=json&type=discover_new&discover_by=location&limit_per_input=${MAX_RETURNED_RECORDS}`;
  const inputBody  = checkIn && checkOut
    ? [{ location, currency, check_in: checkIn, check_out: checkOut }]
    : [{ location, currency }];

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
      const errText  = await triggerRes.text();
      const ctHeader = (triggerRes.headers && typeof triggerRes.headers.get === 'function')
        ? (triggerRes.headers.get('content-type') || '')
        : '';
      let sanitized  = sanitizeErrorBody(errText, ctHeader);
      // Final safety net: if the actual token value somehow appears, redact it
      if (token) sanitized = sanitized.split(token).join('[REDACTED]');

      console.error('⛔  Trigger failed');
      console.error(`  HTTP_STATUS              : ${triggerRes.status}`);
      console.error(`  HTTP_STATUS_TEXT         : ${triggerRes.statusText || '(none)'}`);
      console.error(`  RESPONSE_CONTENT_TYPE    : ${ctHeader || '(none)'}`);
      console.error(`\n  SANITIZED_ERROR_BODY:\n${sanitized}`);
      console.error('\n  BRIGHTDATA_JOB_CREATED   : false');
      console.error('  SNAPSHOT_ID              : NONE');
      console.error('  RECORDS_CONSUMED         : 0');

      return { ok: false, abort: `trigger_failed:${triggerRes.status}`, httpStatus: triggerRes.status, sanitizedError: sanitized };
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
  const { pricePopulated, canBuildAdapter } = printSchemaAnalysisAndVerdict(records, currency, analysis);

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

// ── snapshotResumeMode — resume an existing Bright Data snapshot ──────────────
// deps = { fetchFn, pollIntervalMs, maxWaitMs, currency }
// BRIGHTDATA_TRIGGER_POSTS = 0  — never calls POST /trigger

async function snapshotResumeMode(snapshotId, deps = {}) {
  const fetchFn        = deps.fetchFn        || fetch;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const maxWaitMs      = deps.maxWaitMs      ?? MAX_WAIT_MS;
  const currency       = deps.currency       ?? null;

  const token = process.env.BRIGHTDATA_API_KEY;
  if (!token) {
    console.error('⛔  ABORT: BRIGHTDATA_API_KEY not set — no network call made');
    return { ok: false, abort: 'missing_api_key' };
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  B5-A3 BRIGHT DATA DIAGNOSTIC — SNAPSHOT RESUME MODE');
  console.log('  BRIGHTDATA_TRIGGER_POSTS = 0');
  console.log('  NEW_JOBS_CREATED         = 0');
  console.log('  DB_WRITES                = 0');
  console.log('  CHANNEX_CALLS            = 0');
  console.log('  PRICING_WRITES           = 0');
  console.log('═'.repeat(70));
  console.log(`\n  snapshot_id : ${snapshotId}`);
  console.log(`  max_wait    : ${maxWaitMs / 1000}s`);

  // ── Poll for status ────────────────────────────────────────────────────────
  console.log('\n  Checking snapshot status...');

  const deadline   = Date.now() + maxWaitMs;
  let   lastStatus = 'unknown';

  while (true) {
    let progressData;
    try {
      const progressRes = await fetchFn(`${BD_PROGRESS_BASE}/${snapshotId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (progressRes.status === 404) {
        const errText  = await progressRes.text();
        const ctHeader = (progressRes.headers && typeof progressRes.headers.get === 'function')
          ? (progressRes.headers.get('content-type') || '') : '';
        let sanitized = sanitizeErrorBody(errText, ctHeader);
        if (token) sanitized = sanitized.split(token).join('[REDACTED]');
        console.error('⛔  Snapshot not found (404)');
        console.error(`  SANITIZED_ERROR_BODY:\n${sanitized}`);
        return { ok: false, abort: 'snapshot_not_found', snapshotId };
      }

      progressData = await progressRes.json();
    } catch (err) {
      console.warn(`  ⚠️   Poll network error: ${err.message}`);
      if (Date.now() >= deadline) {
        console.error(`⛔  TIMEOUT after network errors (${maxWaitMs / 1000}s)`);
        return { ok: false, abort: 'poll_timeout', snapshotId, lastStatus };
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
      continue;
    }

    lastStatus = progressData?.status ?? 'unknown';
    console.log(`  ⏳  status: ${lastStatus}`);

    if (lastStatus === 'ready') break;

    if (['failed', 'error', 'aborted'].includes(lastStatus)) {
      console.error(`⛔  Snapshot ended in error state: ${lastStatus}`);
      return { ok: false, abort: `job_${lastStatus}`, snapshotId };
    }

    // running / pending — keep polling within deadline
    if (Date.now() >= deadline) {
      console.error(`⛔  TIMEOUT: snapshot not ready within ${maxWaitMs / 1000}s (last: ${lastStatus})`);
      console.log(`\n  Snapshot is still processing. Resume with the same command when ready:`);
      console.log(`    node outils/diag-brightdata-airbnb.js --snapshot-id ${snapshotId}`);
      return { ok: false, abort: 'poll_timeout', snapshotId, lastStatus };
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  // ── Download snapshot ──────────────────────────────────────────────────────
  console.log('\n  Downloading snapshot...');

  let records;
  try {
    const snapshotRes = await fetchFn(`${BD_SNAPSHOT_BASE}/${snapshotId}?format=json`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!snapshotRes.ok) {
      const errText  = await snapshotRes.text();
      const ctHeader = (snapshotRes.headers && typeof snapshotRes.headers.get === 'function')
        ? (snapshotRes.headers.get('content-type') || '') : '';
      let sanitized = sanitizeErrorBody(errText, ctHeader);
      if (token) sanitized = sanitized.split(token).join('[REDACTED]');
      console.error(`⛔  Snapshot download failed: HTTP ${snapshotRes.status}`);
      console.error(`  SANITIZED_ERROR_BODY:\n${sanitized}`);
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

  // ── Analyze ────────────────────────────────────────────────────────────────
  const analysis = analyzeRecords(records, currency);
  const { pricePopulated, canBuildAdapter } = printSchemaAnalysisAndVerdict(records, currency, analysis);

  console.log('\n  DB_WRITES = 0 | CHANNEX_CALLS = 0 | PRICING_WRITES = 0');
  console.log('  BRIGHTDATA_TRIGGER_POSTS = 0 | NEW_JOBS_CREATED = 0');
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
  let location   = null;
  let currency   = 'EUR';
  let execute    = false;
  let snapshotId = null;
  let checkIn    = null;
  let checkOut   = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--location'    && args[i + 1]) location   = args[++i];
    if (args[i] === '--currency'    && args[i + 1]) currency   = args[++i].toUpperCase();
    if (args[i] === '--execute')                    execute    = true;
    if (args[i] === '--snapshot-id' && args[i + 1]) snapshotId = args[++i];
    if (args[i] === '--check-in'    && args[i + 1]) checkIn    = args[++i];
    if (args[i] === '--check-out'   && args[i + 1]) checkOut   = args[++i];
  }

  // Validate dates when provided (applies to both preview and execute)
  if (!snapshotId && (checkIn || checkOut)) {
    const dv = validateDates(checkIn, checkOut);
    if (!dv.ok) {
      console.error(`Error: ${dv.error}`);
      process.exit(1);
    }
  }

  let run;
  if (snapshotId) {
    run = snapshotResumeMode(snapshotId, { currency });
  } else if (!location) {
    console.error('Usage:');
    console.error('  node outils/diag-brightdata-airbnb.js --location "<loc>" [--currency EUR] [--check-in YYYY-MM-DD --check-out YYYY-MM-DD] [--execute]');
    console.error('  node outils/diag-brightdata-airbnb.js --snapshot-id <id>');
    console.error('--location is mandatory unless --snapshot-id is given');
    console.error('--check-in and --check-out must be provided together');
    process.exit(1);
  } else {
    run = execute
      ? executeMode({ location, currency, checkIn, checkOut })
      : previewMode({ location, currency, checkIn, checkOut });
  }

  run.catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = {
  previewMode,
  executeMode,
  snapshotResumeMode,
  parseBedrooms,
  analyzeRecords,
  analyzePriceStructure,
  analyzeBedroomSources,
  buildAdapterDecision,
  inspectRecord,
  sanitizeErrorBody,
  redactSecrets,
  validateDates,
  classifyPricingField,
  DATASET_ID,
  MAX_RETURNED_RECORDS,
  MAX_WAIT_MS,
};
