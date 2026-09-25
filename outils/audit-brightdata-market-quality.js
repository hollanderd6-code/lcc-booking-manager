#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B5-F0 — Bright Data Market Quality Audit
 *
 * Preview (0 BD calls, 0 DB writes):
 *   node outils/audit-brightdata-market-quality.js --name "M6"
 *
 * Execute (BD call + analysis, 0 DB writes, 0 pricing writes):
 *   node outils/audit-brightdata-market-quality.js --name "M6" --execute
 *
 * SAFETY CONTRACT:
 *   DB_WRITES            = 0
 *   CHANNEX_CALLS        = 0
 *   PRICING_WRITES       = 0
 *   PROPERTIES_WRITES    = 0
 *   MARKET_DATA_WRITES   = 0
 *   PRICING_APPLY        = 0
 *
 * AUDIT ONLY — does not activate Bright Data in production.
 * Does not change MARKET_PRIMARY_PROVIDER.
 */

// ── Safe imports only ────────────────────────────────────────────────────────
const { BD_TRIGGER_BASE, BD_PROGRESS_BASE, BD_SNAPSHOT_BASE, DATASET_ID,
        parseBrightDataItem } = require('../services/providers/brightdata');
const { getBrightDataMarketDates } = require('../services/market-provider');
const { computeMarketContextKey, } = require('../routes/market-context-key');
const { normalizeCurrency }        = require('../routes/market-data-resolver');
const { getFallbackZones }         = require('../routes/dynamic-pricing-cron');
const { Pool }                     = require('pg');

const MAX_LISTINGS    = 100;
const RADIUS_BANDS_KM = [1, 2, 3, 5, 10, 20];
const MIN_COMPARABLES = 8;

// ── Pure math helpers ────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Standard interpolated percentile (0–100) on pre-sorted array
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// current calcMarketStats formula: prices[floor(n/2)]
function currentCalcMedian(sorted) {
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

// True (standard) median — averages two middle values for even n
function standardMedian(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n) { return Math.round(n * 100) / 100; }

// Parse numeric guest count from raw BD item
function parseGuests(raw) {
  if (typeof raw.guests === 'number' && raw.guests > 0) return raw.guests;
  if (typeof raw.guests === 'string') {
    const n = parseInt(raw.guests, 10);
    if (n > 0) return n;
  }
  if (Array.isArray(raw.details)) {
    for (const s of raw.details) {
      const m = String(s).match(/^(\d+)\s+guest/i);
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

// Parse available_dates — validate ISO format, dedupe, sort, filter future only
function parseAvailableDates(raw, refDate) {
  if (!Array.isArray(raw.available_dates)) return null;
  const today = refDate || new Date().toISOString().slice(0, 10);
  const valid = [...new Set(
    raw.available_dates
      .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
  )].sort();
  return valid;
}

// ── Property lookup ──────────────────────────────────────────────────────────

async function resolvePropByName(pool, name) {
  // zone_label lives in market_data, NOT pricing_config — do not select pc.zone_label.
  const rows = (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.channex_enabled,
            p.max_guests, p.bedrooms, p.beds,
            pc.is_active, pc.mode, pc.bedrooms AS config_bedrooms
       FROM properties p
       LEFT JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
  return rows;
}

// ── Raw BD scrape (returns raw JSON items, no normalization) ─────────────────

async function scrapeRaw(location, maxListings, currency, opts = {}) {
  const { checkIn, checkOut, _fetchImpl, pollIntervalMs = 10_000, maxWaitMs = 600_000 } = opts;
  const _fetch  = _fetchImpl || fetch;
  const key     = process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error('BRIGHTDATA_API_KEY non défini');

  const safeMax    = Math.min(Math.max(1, Math.floor(maxListings || 1)), 1000);
  const triggerUrl = `${BD_TRIGGER_BASE}?dataset_id=${DATASET_ID}&format=json&type=discover_new&discover_by=location&limit_per_input=${safeMax}`;

  const triggerRes = await _fetch(triggerUrl, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([{ location, currency, check_in: checkIn, check_out: checkOut }]),
  });
  if (!triggerRes.ok) throw new Error(`BD trigger failed: ${triggerRes.status}`);
  const { snapshot_id: snapshotId } = await triggerRes.json();
  if (!snapshotId) throw new Error('BD trigger: no snapshot_id');

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const prog = await _fetch(`${BD_PROGRESS_BASE}/${snapshotId}`,
      { headers: { Authorization: `Bearer ${key}` } });
    if (!prog.ok) throw new Error(`BD progress failed: ${prog.status}`);
    const { status } = await prog.json();
    if (status === 'ready')  break;
    if (status === 'failed') throw new Error('BD snapshot failed');
    if (Date.now() >= deadline) throw new Error('BD timeout');
  }

  const snap = await _fetch(`${BD_SNAPSHOT_BASE}/${snapshotId}?format=json`,
    { headers: { Authorization: `Bearer ${key}` } });
  if (!snap.ok) throw new Error(`BD snapshot fetch failed: ${snap.status}`);
  const items = await snap.json();
  if (!Array.isArray(items)) throw new Error('BD snapshot: not array');
  return items;
}

// ── Enrich raw items: combine normalization with extended field extraction ───

function enrichItems(rawItems, requestedCurrency, refDate) {
  let rejPrice = 0, rejCurrency = 0, rejAvailability = 0;
  const enriched = rawItems.map(raw => {
    const { listing, reason } = parseBrightDataItem(raw, requestedCurrency);
    if (!listing) {
      if (reason === 'currency')     rejCurrency++;
      else if (reason === 'availability') rejAvailability++;
      else                           rejPrice++;
    }
    return {
      listing,                             // null if rejected
      reason,
      price:          listing ? listing.price : null,
      isBooked:       listing ? listing.isBooked : null,
      lat:            typeof raw.lat  === 'number' ? raw.lat  : null,
      lon:            typeof raw.long === 'number' ? raw.long : null,
      propertyId:     raw.property_id || null,
      guests:         parseGuests(raw),
      category:       raw.category || null,
      availDates:     parseAvailableDates(raw, refDate),
      ratings:        typeof raw.ratings === 'number' ? raw.ratings : null,
    };
  });
  return {
    enriched,
    accepted:      enriched.filter(e => e.listing),
    rejPrice, rejCurrency, rejAvailability,
  };
}

// ── Analysis: price percentiles & buckets ────────────────────────────────────

const PRICE_BUCKETS = [
  { label: '< 75',     min: 0,   max: 75   },
  { label: '75–99',    min: 75,  max: 100  },
  { label: '100–149',  min: 100, max: 150  },
  { label: '150–199',  min: 150, max: 200  },
  { label: '200–249',  min: 200, max: 250  },
  { label: '250–299',  min: 250, max: 300  },
  { label: '300–399',  min: 300, max: 400  },
  { label: '400–499',  min: 400, max: 500  },
  { label: '500+',     min: 500, max: Infinity },
];

function analyzePrices(sortedPrices) {
  if (!sortedPrices.length) return null;
  const n     = sortedPrices.length;
  const mean  = round2(sortedPrices.reduce((s, v) => s + v, 0) / n);
  const min   = sortedPrices[0];
  const max   = sortedPrices[n - 1];
  const p10   = round2(percentile(sortedPrices, 10));
  const p25   = round2(percentile(sortedPrices, 25));
  const med   = round2(standardMedian(sortedPrices));
  const p75   = round2(percentile(sortedPrices, 75));
  const p90   = round2(percentile(sortedPrices, 90));
  const calcMed = round2(currentCalcMedian(sortedPrices));
  const buckets = PRICE_BUCKETS.map(b => ({
    label: b.label,
    count: sortedPrices.filter(p => p >= b.min && p < b.max).length,
  }));
  return { n, min, p10, p25, median: med, p75, p90, max, mean, calcMedian: calcMed, buckets };
}

// ── Analysis: geographic distance ───────────────────────────────────────────

function analyzeGeo(accepted, refLat, refLon) {
  const withGeo = accepted.filter(e => e.lat != null && e.lon != null);
  const missing = accepted.length - withGeo.length;

  const distances = withGeo.map(e => ({
    km:    round2(haversineKm(refLat, refLon, e.lat, e.lon)),
    price: e.price,
  })).sort((a, b) => a.km - b.km);

  const kms = distances.map(d => d.km);
  const distStats = kms.length ? {
    min:    kms[0],
    p25:    round2(percentile(kms, 25)),
    median: round2(standardMedian(kms)),
    p75:    round2(percentile(kms, 75)),
    p90:    round2(percentile(kms, 90)),
    max:    kms[kms.length - 1],
  } : null;

  const bands = RADIUS_BANDS_KM.map(r => {
    const inBand = distances.filter(d => d.km <= r);
    const prices = inBand.map(d => d.price).sort((a, b) => a - b);
    return {
      radiusKm: r,
      count:    inBand.length,
      p25:    prices.length ? round2(percentile(prices, 25)) : null,
      median: prices.length ? round2(standardMedian(prices)) : null,
      p75:    prices.length ? round2(percentile(prices, 75)) : null,
    };
  });

  return { withGeoCount: withGeo.length, missingGeoCount: missing, distStats, bands };
}

// ── Analysis: capacity / category ───────────────────────────────────────────

function analyzeCapacity(accepted) {
  const guests = accepted.map(e => e.guests).filter(g => g != null);
  const categories = {};
  for (const e of accepted) {
    const c = e.category || 'ABSENT';
    categories[c] = (categories[c] || 0) + 1;
  }
  const guestDist = {};
  for (const g of guests) {
    const k = g <= 2 ? '1–2' : g <= 4 ? '3–4' : g <= 6 ? '5–6' : g <= 8 ? '7–8' : '9+';
    guestDist[k] = (guestDist[k] || 0) + 1;
  }
  return {
    guestFieldPresent: guests.length,
    guestFieldMissing: accepted.length - guests.length,
    guestDist,
    categoryDist: categories,
  };
}

// ── Analysis: duplicates ─────────────────────────────────────────────────────

function analyzeDuplicates(accepted) {
  const byId = {};
  let noIdCount = 0;
  for (const e of accepted) {
    if (!e.propertyId) { noIdCount++; continue; }
    if (!byId[e.propertyId]) byId[e.propertyId] = [];
    byId[e.propertyId].push(e.price);
  }
  const dupGroups = Object.values(byId).filter(g => g.length > 1);
  const dupRecords  = dupGroups.reduce((s, g) => s + g.length - 1, 0);
  const uniqueCount = Object.keys(byId).length;
  const dupRate     = accepted.length ? round2(dupRecords / accepted.length * 100) : 0;
  const priceVar    = dupGroups.map(g => {
    const sorted = [...g].sort((a, b) => a - b);
    return { count: g.length, min: sorted[0], max: sorted[sorted.length - 1] };
  });
  return { total: accepted.length, uniqueIds: uniqueCount, noIdCount,
           dupRecords, dupRate, dupGroups: priceVar.slice(0, 5) };
}

// ── Analysis: IQR outliers ───────────────────────────────────────────────────

function analyzeOutliers(sortedPrices) {
  if (sortedPrices.length < 4) return null;
  const q1 = round2(percentile(sortedPrices, 25));
  const q3 = round2(percentile(sortedPrices, 75));
  const iqr = round2(q3 - q1);
  const lo  = round2(q1 - 1.5 * iqr);
  const hi  = round2(q3 + 1.5 * iqr);
  const lowCount  = sortedPrices.filter(p => p < lo).length;
  const highCount = sortedPrices.filter(p => p > hi).length;
  const cleanPrices = sortedPrices.filter(p => p >= lo && p <= hi);
  const cleanStats  = analyzePrices(cleanPrices);
  return { q1, q3, iqr, lowerFence: lo, upperFence: hi,
           outliersLow: lowCount, outliersHigh: highCount,
           cleanCount: cleanPrices.length, cleanMedian: cleanStats?.median ?? null };
}

// ── Analysis: calendar occupancy proxy ──────────────────────────────────────

function analyzeCalendars(accepted, refDate) {
  const today = refDate || new Date().toISOString().slice(0, 10);
  const windows = [30, 60, 90];

  function windowEnd(days) {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const results = windows.map(days => {
    const endDate = windowEnd(days);
    const proxies = [];
    let noCalCount = 0;
    let shortCalCount = 0;

    for (const e of accepted) {
      if (!e.availDates) { noCalCount++; continue; }
      const datesInWindow = e.availDates.filter(d => d >= today && d < endDate);
      const proxy = (days - datesInWindow.length) / days;  // unavailability fraction
      proxies.push(proxy);
    }

    const validCount = proxies.length;
    if (!validCount) return { days, noCalCount, validCount: 0, mean: null, median: null, p25: null, p75: null };

    const sorted = [...proxies].sort((a, b) => a - b);
    return {
      days, noCalCount, validCount,
      mean:   round2(sorted.reduce((s, v) => s + v, 0) / validCount * 100),
      p25:    round2(percentile(sorted, 25) * 100),
      median: round2(standardMedian(sorted) * 100),
      p75:    round2(percentile(sorted, 75) * 100),
    };
  });

  // Calendar reliability check
  const calLengths = accepted.filter(e => e.availDates).map(e => e.availDates.length);
  const minCal = calLengths.length ? Math.min(...calLengths) : null;
  const maxCal = calLengths.length ? Math.max(...calLengths) : null;
  const medCal = calLengths.length ? round2(standardMedian([...calLengths].sort((a,b) => a-b))) : null;
  const calPresent = accepted.filter(e => e.availDates).length;
  const calAbsent  = accepted.length - calPresent;

  return { windows: results, calPresent, calAbsent, minCalLen: minCal, maxCalLen: maxCal, medCalLen: medCal };
}

// ── Multi-scenario comparison ────────────────────────────────────────────────

function buildScenarios(accepted, refLat, refLon, geoAnalysis, outlierAnalysis, calAnalysis, propCapacity) {
  function statsFor(subset) {
    const prices = subset.map(e => e.price).sort((a, b) => a - b);
    if (!prices.length) return { count: 0, p25: null, median: null, p75: null, occupancy: 0 };
    const booked = subset.filter(e => e.isBooked).length;
    return {
      count:     prices.length,
      p25:       round2(percentile(prices, 25)),
      median:    round2(standardMedian(prices)),
      p75:       round2(percentile(prices, 75)),
      occupancy: Math.round(booked / subset.length * 100),
    };
  }

  // Current: all accepted, isBooked from availability
  const current = statsFor(accepted);

  // Choose recommended radius (first band with >= MIN_COMPARABLES)
  const recBand = geoAnalysis.bands.find(b => b.count >= MIN_COMPARABLES) || geoAnalysis.bands[geoAnalysis.bands.length - 1];
  const recRadius = recBand.radiusKm;

  // Candidate A: geo-filtered, calendar 30d occupancy proxy
  const geoFiltered = accepted.filter(e => {
    if (e.lat == null || e.lon == null) return false;
    return haversineKm(refLat, refLon, e.lat, e.lon) <= recRadius;
  });
  const calA = analyzeCalendars(geoFiltered, null);
  const candidateA = {
    ...statsFor(geoFiltered),
    radius:         recRadius,
    occupancyProxy: calA.windows.find(w => w.days === 30)?.median ?? null,
    label:          'geo-filtered + cal30d',
  };

  // Candidate B: geo + dedup, calendar 60d
  const seenB = new Set();
  const geoDedup = geoFiltered.filter(e => {
    if (!e.propertyId) return true;
    if (seenB.has(e.propertyId)) return false;
    seenB.add(e.propertyId);
    return true;
  });
  const calB = analyzeCalendars(geoDedup, null);
  const candidateB = {
    ...statsFor(geoDedup),
    radius:         recRadius,
    occupancyProxy: calB.windows.find(w => w.days === 60)?.median ?? null,
    label:          'geo-filtered + dedup + cal60d',
  };

  // Candidate C: geo + dedup + capacity, calendar 60d (only if guests field reliable)
  let candidateC = null;
  if (propCapacity && geoDedup.filter(e => e.guests != null).length >= MIN_COMPARABLES) {
    const capFiltered = geoDedup.filter(e => {
      if (e.guests == null) return true; // keep when unknown (same as bedroom policy)
      return Math.abs(e.guests - propCapacity) <= 2;
    });
    const calC = analyzeCalendars(capFiltered, null);
    candidateC = {
      ...statsFor(capFiltered),
      radius:         recRadius,
      occupancyProxy: calC.windows.find(w => w.days === 60)?.median ?? null,
      label:          'geo + dedup + capacity(±2) + cal60d',
    };
  }

  return { current, candidateA, candidateB, candidateC, recommendedRadius: recRadius };
}

// ── Print helpers ────────────────────────────────────────────────────────────

function printPriceStats(label, s, indent = '  ') {
  if (!s) { console.log(`${indent}${label}: NO DATA`); return; }
  console.log(`${indent}${label} (n=${s.n}):`);
  console.log(`${indent}  min=${s.min}  p10=${s.p10}  p25=${s.p25}  median=${s.median}  p75=${s.p75}  p90=${s.p90}  max=${s.max}  mean=${s.mean}`);
  console.log(`${indent}  current_calc_median=${s.calcMedian}  diff=${round2(s.median - s.calcMedian)}`);
}

function printBuckets(buckets) {
  for (const b of buckets) {
    const bar = '█'.repeat(Math.min(30, b.count));
    console.log(`    ${b.label.padEnd(10)} ${String(b.count).padStart(3)}  ${bar}`);
  }
}

// ── Preview mode ─────────────────────────────────────────────────────────────
// DB_WRITES = 0   BRIGHTDATA_CALLS = 0

async function previewMode(pool, { name, _now } = {}) {
  console.log('\n' + '═'.repeat(64));
  console.log('  B5-F0 MARKET QUALITY AUDIT — PREVIEW');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | CHANNEX_CALLS=0 | PRICING_WRITES=0');
  console.log('═'.repeat(64));

  const rows = await resolvePropByName(pool, name);
  if (rows.length === 0) {
    console.log(`\n  ⛔  No property: "${name}"`);
    return { ok: false };
  }
  if (rows.length > 1) {
    console.log(`  ⛔  Ambiguous: ${rows.length} matches for "${name}"`);
    return { ok: false };
  }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const lat      = parseFloat(prop.latitude);
  const lon      = parseFloat(prop.longitude);
  const ctxKey   = computeMarketContextKey({ countryCode: prop.country_code, latitude: lat, longitude: lon });
  const zones    = getFallbackZones(prop.address, null);
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });

  console.log('\n  PROPERTY:');
  console.log(`    id:             ${prop.id}`);
  console.log(`    name:           ${prop.internal_name || prop.name}`);
  console.log(`    lat/lon:        ${lat} / ${lon}`);
  console.log(`    country_code:   ${prop.country_code}`);
  console.log(`    timezone:       ${timezone}`);
  console.log(`    currency:       ${currency}`);
  console.log(`    context_key:    ${ctxKey}`);
  console.log(`    max_guests:     ${prop.max_guests ?? 'NULL'}`);
  console.log(`    bedrooms (prop): ${prop.bedrooms ?? 'NULL'}`);
  console.log(`    bedrooms (cfg): ${prop.config_bedrooms ?? 'NULL'}`);

  console.log('\n  PLANNED AUDIT:');
  console.log(`    location:       ${zones[0]}  (fallbacks: ${zones.slice(1).join(' → ')})`);
  console.log(`    checkIn:        ${checkIn}`);
  console.log(`    checkOut:       ${checkOut}`);
  console.log(`    maxListings:    ${MAX_LISTINGS}`);
  console.log(`    radiusBands:    ${RADIUS_BANDS_KM.join(', ')} km`);
  console.log(`    calWindows:     30 / 60 / 90 days`);
  console.log(`    API key:        ${process.env.BRIGHTDATA_API_KEY ? 'PRESENT' : 'ABSENT'}`);
  console.log(`\n  Run with --execute to perform the audit.`);
  console.log('═'.repeat(64));

  return { ok: true, propertyId: prop.id, currency, lat, lon, ctxKey, zones, checkIn, checkOut };
}

// ── Execute mode ─────────────────────────────────────────────────────────────
// BD_CALLS = 1 | DB_WRITES = 0 | CHANNEX_CALLS = 0 | PRICING_WRITES = 0

async function executeMode(pool, { name, _now, _fetchImpl } = {}) {
  console.log('\n' + '═'.repeat(64));
  console.log('  B5-F0 MARKET QUALITY AUDIT — EXECUTE');
  console.log('  DB_WRITES=0 | CHANNEX_CALLS=0 | PRICING_WRITES=0 | MARKET_DATA_WRITES=0');
  console.log('═'.repeat(64));

  // 1. Resolve property
  const rows = await resolvePropByName(pool, name);
  if (rows.length === 0) throw new Error(`No property: "${name}"`);
  if (rows.length > 1)  throw new Error(`${rows.length} matches for "${name}" — refine --name`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Invalid currency on property');

  const lat = parseFloat(prop.latitude);
  const lon = parseFloat(prop.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Missing lat/lon on property');
  if (!prop.country_code) throw new Error('Missing country_code');

  const ctxKey  = computeMarketContextKey({ countryCode: prop.country_code, latitude: lat, longitude: lon });
  const zones   = getFallbackZones(prop.address, null);
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });
  const today   = (typeof _now === 'string' ? _now : null) || new Date().toISOString().slice(0, 10);

  console.log(`\n  Target: ${prop.internal_name || prop.name} [${prop.id.slice(-8)}]`);
  console.log(`  Location: ${zones[0]}  currency=${currency}  dates=${checkIn}→${checkOut}`);
  console.log(`  Ref coords: ${lat} / ${lon}  (context_key: ${ctxKey})`);
  if (prop.max_guests) console.log(`  Capacity: ${prop.max_guests} guests, ${prop.bedrooms ?? '?'} bedrooms`);

  // 2. Raw BD call
  console.log(`\n  🔍 Calling Bright Data (${MAX_LISTINGS} records max)…`);
  const rawItems = await scrapeRaw(zones[0], MAX_LISTINGS, currency, {
    checkIn, checkOut, _fetchImpl,
    pollIntervalMs: _fetchImpl ? 1 : 10_000,
  });
  console.log(`  Returned: ${rawItems.length} raw items`);

  // 3. Enrich + normalize
  const { enriched, accepted, rejPrice, rejCurrency, rejAvailability } =
    enrichItems(rawItems, currency, today);

  console.log(`  Accepted: ${accepted.length}  (rej_price=${rejPrice} rej_curr=${rejCurrency} rej_avail=${rejAvailability})`);
  if (accepted.length < MIN_COMPARABLES) throw new Error(`Only ${accepted.length} accepted — below MIN_COMPARABLES (${MIN_COMPARABLES})`);

  const sortedPrices = accepted.map(e => e.price).sort((a, b) => a - b);

  // 4. Analysis
  const priceStats  = analyzePrices(sortedPrices);
  const geoAnalysis = analyzeGeo(accepted, lat, lon);
  const capAnalysis = analyzeCapacity(accepted);
  const dupAnalysis = analyzeDuplicates(accepted);
  const iqrAnalysis = analyzeOutliers(sortedPrices);
  const calAnalysis = analyzeCalendars(accepted, today);
  const scenarios   = buildScenarios(accepted, lat, lon, geoAnalysis, iqrAnalysis, calAnalysis, prop.max_guests);

  // ── Print Phase 3: Price Distribution ──────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 3 — PRICE DISTRIBUTION');
  console.log('─'.repeat(64));
  printPriceStats('RAW (all accepted)', priceStats);
  console.log('\n  Buckets:');
  printBuckets(priceStats.buckets);
  console.log(`\n  Standard median vs currentCalcMedian: ${priceStats.median} vs ${priceStats.calcMedian} (diff=${round2(priceStats.median - priceStats.calcMedian)})`);

  // ── Print Phase 4: Geographic Quality ──────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 4 — GEOGRAPHIC QUALITY');
  console.log('─'.repeat(64));
  console.log(`  Geolocated: ${geoAnalysis.withGeoCount} / ${accepted.length}  (missing: ${geoAnalysis.missingGeoCount})`);
  if (geoAnalysis.distStats) {
    const ds = geoAnalysis.distStats;
    console.log(`  Distance (km): min=${ds.min}  p25=${ds.p25}  median=${ds.median}  p75=${ds.p75}  p90=${ds.p90}  max=${ds.max}`);
  }
  console.log('\n  Per-radius price stats:');
  console.log('  Radius  Count  P25      Median   P75');
  for (const b of geoAnalysis.bands) {
    console.log(`  ${String(b.radiusKm+'km').padEnd(7)} ${String(b.count).padStart(5)}  ${String(b.p25??'N/A').padStart(7)}  ${String(b.median??'N/A').padStart(7)}  ${String(b.p75??'N/A').padStart(7)}`);
  }

  // ── Print Phase 5: Capacity ──────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 5 — CAPACITY / CATEGORY');
  console.log('─'.repeat(64));
  console.log(`  Guests field: ${capAnalysis.guestFieldPresent} present / ${capAnalysis.guestFieldMissing} absent`);
  if (Object.keys(capAnalysis.guestDist).length) {
    console.log('  Guest distribution: ' + Object.entries(capAnalysis.guestDist).map(([k,v]) => `${k}:${v}`).join('  '));
  }
  console.log('  Category distribution: ' + Object.entries(capAnalysis.categoryDist).map(([k,v]) => `${k}:${v}`).join('  '));

  // ── Print Phase 6: Duplicates ────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 6 — DUPLICATES');
  console.log('─'.repeat(64));
  console.log(`  Total: ${dupAnalysis.total}  UniqueIDs: ${dupAnalysis.uniqueIds}  NoID: ${dupAnalysis.noIdCount}`);
  console.log(`  Duplicate records: ${dupAnalysis.dupRecords}  Rate: ${dupAnalysis.dupRate}%`);

  // ── Print Phase 7: Outliers ──────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 7 — OUTLIER ANALYSIS (IQR)');
  console.log('─'.repeat(64));
  if (iqrAnalysis) {
    console.log(`  Q1=${iqrAnalysis.q1}  Q3=${iqrAnalysis.q3}  IQR=${iqrAnalysis.iqr}`);
    console.log(`  Fences: [${iqrAnalysis.lowerFence}, ${iqrAnalysis.upperFence}]`);
    console.log(`  Outliers: low=${iqrAnalysis.outliersLow}  high=${iqrAnalysis.outliersHigh}`);
    console.log(`  After IQR removal: n=${iqrAnalysis.cleanCount}  median=${iqrAnalysis.cleanMedian}`);
  }

  // ── Print Phase 8/9: Calendar / Occupancy ────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 8–9 — OCCUPANCY / CALENDAR AUDIT');
  console.log('─'.repeat(64));
  console.log(`  WHY CURRENT OCCUPANCY=0%: availability=true on discovery = available for`);
  console.log(`    requested dates ONLY. isBooked = !availability is structurally 0% for`);
  console.log(`    discovery results. Cannot measure market occupancy this way.`);
  console.log(`\n  available_dates: ${calAnalysis.calPresent} records with calendar / ${calAnalysis.calAbsent} absent`);
  if (calAnalysis.calPresent) {
    console.log(`  Calendar lengths: min=${calAnalysis.minCalLen}  median=${calAnalysis.medCalLen}  max=${calAnalysis.maxCalLen} dates`);
    console.log('\n  Occupancy PROXY (calendar_unavailability_rate — NOT factual occupancy):');
    console.log('  CAVEAT: absent date may mean booked OR blocked OR outside host calendar rules.');
    for (const w of calAnalysis.windows) {
      if (!w.validCount) { console.log(`  next_${w.days}d: no calendar data`); continue; }
      console.log(`  next_${w.days}d: n=${w.validCount}  mean=${w.mean}%  p25=${w.p25}%  median=${w.median}%  p75=${w.p75}%`);
    }
  }

  // ── Print Phase 10: Scenarios ────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  console.log('  PHASE 10 — SCENARIO COMPARISON');
  console.log('─'.repeat(64));
  console.log(`  Recommended radius: ${scenarios.recommendedRadius} km (first with ≥${MIN_COMPARABLES} geolocated comparables)\n`);

  function printScenario(label, s) {
    if (!s) return;
    const occ = s.occupancyProxy != null
      ? `occupancy_proxy=${s.occupancyProxy}% (${label.includes('30d') ? '30d' : '60d'} calendar)`
      : `occupancy=!availability → ${s.occupancy}%`;
    console.log(`  [${s.label || label}]  n=${s.count}  p25=${s.p25}  median=${s.median}  p75=${s.p75}  ${occ}`);
  }
  printScenario('CURRENT',      { ...scenarios.current,    label: 'CURRENT (all accepted, occ=!avail)' });
  printScenario('CANDIDATE_A',  scenarios.candidateA);
  printScenario('CANDIDATE_B',  scenarios.candidateB);
  if (scenarios.candidateC) printScenario('CANDIDATE_C', scenarios.candidateC);
  else console.log('  [CANDIDATE_C]: guests field insufficient — skipped');

  console.log('\n' + '═'.repeat(64));
  console.log('  AUDIT COMPLETE — 0 DB writes, 0 market_data writes, 0 pricing writes');
  console.log('═'.repeat(64) + '\n');

  return {
    propertyId:    prop.id,
    currency,
    returnedCount: rawItems.length,
    acceptedCount: accepted.length,
    rejPrice, rejCurrency, rejAvailability,
    priceStats,
    geoAnalysis,
    capAnalysis,
    dupAnalysis,
    iqrAnalysis,
    calAnalysis,
    scenarios,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  previewMode,
  executeMode,
  haversineKm,
  percentile,
  standardMedian,
  currentCalcMedian,
  analyzePrices,
  analyzeGeo,
  analyzeCapacity,
  analyzeDuplicates,
  analyzeOutliers,
  analyzeCalendars,
  buildScenarios,
  enrichItems,
  parseGuests,
  parseAvailableDates,
  scrapeRaw,
  PRICE_BUCKETS,
  MIN_COMPARABLES,
  RADIUS_BANDS_KM,
};

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/audit-brightdata-market-quality.js --name <nom> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const run = execute
    ? executeMode(pool, { name })
    : previewMode(pool, { name });

  run
    .then(() => pool.end())
    .catch(err => {
      const msg = (err.message || '').toLowerCase();
      const code = (err.code || '').toUpperCase();
      let errType = 'FATAL_ERROR';
      if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) errType = 'DB_TLS_ERROR';
      else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') errType = 'DB_CONNECTION_ERROR';
      else if (msg.includes('column') || msg.includes('does not exist') || code === '42703') errType = 'DB_SCHEMA_ERROR';
      else if (msg.includes('brightdata') || msg.includes('bright data')) errType = 'BRIGHTDATA_ERROR';
      console.error(`\n  ❌ ${errType}: ${err.message}`);
      pool.end().catch(() => {});
      process.exit(1);
    });
}
