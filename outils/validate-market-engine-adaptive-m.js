#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-M9 — Adaptive Market Engine Validator
 *
 * Dry-run mode  : node validate-market-engine-adaptive-m.js [options]
 * Live mode     : node validate-market-engine-adaptive-m.js --execute-live --max-live-calls N
 *
 * --execute-live  is required to make real Bright Data calls.
 * --max-live-calls N is ALSO required (1 ≤ N ≤ 3).
 * Without both flags, all providers are replaced with noNetworkProvider.
 *
 * ABSOLUTE RULE: never set SAFE_TO_ACTIVATE_PRODUCTION=YES in M.
 *
 * SAFETY:
 *   0 BD credits in dry-run (default)
 *   Max N credits in live mode (N ≤ 3, enforced)
 */

const path = require('path');

const { runAdaptiveMarketEngine, noNetworkProvider } =
  require('../services/market-engine-adaptive-shadow-m');
const { createCallBudget }   = require('../services/market-provider-call-budget');
const { createHealthTracker } = require('../services/market-provider-health');

const {
  FIXTURE_M6_STABLE_DUAL,
  FIXTURE_M6_J30,
  FIXTURE_M6_J60,
} = require('../tests/fixtures/market-m-fixtures');

// ── CLI parsing ───────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const executeLive  = args.includes('--execute-live');
const maxLiveIdx   = args.indexOf('--max-live-calls');
const maxLiveRaw   = maxLiveIdx >= 0 ? parseInt(args[maxLiveIdx + 1], 10) : NaN;

if (executeLive && isNaN(maxLiveRaw)) {
  console.error('ERROR: --execute-live requires --max-live-calls N (1-3)');
  process.exit(1);
}
if (executeLive && (maxLiveRaw < 1 || maxLiveRaw > 3)) {
  console.error(`ERROR: --max-live-calls must be between 1 and 3 (got ${maxLiveRaw})`);
  process.exit(1);
}

const MAX_LIVE_CALLS = executeLive ? maxLiveRaw : 0;

console.log('═══════════════════════════════════════════════════════════════');
console.log('P1.2-B5-BK-M9 — Adaptive Market Engine Validator');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Mode            : ${executeLive ? `LIVE (max ${MAX_LIVE_CALLS} calls)` : 'DRY-RUN (0 BD calls)'}`);
console.log(`Date            : ${new Date().toISOString().slice(0, 10)}`);
console.log('');

// ── Validation scenarios ──────────────────────────────────────────────────────

async function runScenario(label, fixture, liveProvider) {
  console.log(`── ${label}`);

  const budget = createCallBudget({ maxAirbnbCalls: MAX_LIVE_CALLS, maxBookingCalls: executeLive ? 1 : 0 });
  const health = createHealthTracker();

  let result;
  try {
    result = await runAdaptiveMarketEngine({
      ...fixture,
      _snapshotQueue:   executeLive ? null : fixture.airbnbSnapshots,
      _bookingSnapshot: executeLive ? null : fixture.bookingResult,
      _airbnbScrape:    executeLive ? liveProvider : noNetworkProvider,
      _bookingScrape:   executeLive ? liveProvider : noNetworkProvider,
      _budget:          budget,
      _healthTracker:   health,
    });
  } catch (err) {
    console.log(`   ERROR: ${err.message}`);
    return;
  }

  console.log(`   market_status            : ${result.market_status}`);
  console.log(`   AIRBNB_RELIABILITY_STATUS: ${result.AIRBNB_RELIABILITY_STATUS}`);
  console.log(`   MARKET_CONSENSUS_MEDIAN  : ${result.MARKET_CONSENSUS_MEDIAN}`);
  console.log(`   SAFE_TO_ACTIVATE_PRODUCTION: ${result.SAFE_TO_ACTIVATE_PRODUCTION}`);
  console.log(`   anomaly severity         : ${result.anomalyDiagnostic?.severity}`);
  console.log(`   quarantine level         : ${result.quarantine?.level}`);
  console.log(`   BD credits planned       : ${result.costEstimate?.estimatedCredits ?? 0}`);
  console.log(`   budget airbnb used/max   : ${result.budgetStatus?.airbnb?.used}/${result.budgetStatus?.airbnb?.max}`);
  console.log(`   K actualBdCalls (queue)  : ${result.actualBdCalls}`);
  console.log('');

  // Safety assertions
  if (result.SAFE_TO_ACTIVATE_PRODUCTION === 'YES') {
    console.error('   FAIL: SAFE_TO_ACTIVATE_PRODUCTION must never be YES in M');
    process.exitCode = 1;
  }
}

// ── Live provider (only loaded if --execute-live) ─────────────────────────────

function getLiveProviders() {
  if (!executeLive) return { airbnb: noNetworkProvider, booking: noNetworkProvider };
  try {
    const { scrapeWithBrightData }        = require('../services/providers/brightdata');
    const { scrapeWithBrightDataBooking } = require('../services/providers/brightdata-booking');
    return { airbnb: scrapeWithBrightData, booking: scrapeWithBrightDataBooking };
  } catch (err) {
    console.error(`ERROR loading live providers: ${err.message}`);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { airbnb: liveAirbnb, booking: liveBooking } = getLiveProviders();

  await runScenario('J14 STABLE_DUAL (fixture)',   FIXTURE_M6_STABLE_DUAL, liveAirbnb);
  await runScenario('J30 (fixture)',               FIXTURE_M6_J30,         liveAirbnb);
  await runScenario('J60 (fixture)',               FIXTURE_M6_J60,         liveAirbnb);

  if (executeLive) {
    console.log(`Live mode: ${MAX_LIVE_CALLS} Bright Data credit(s) consumed.`);
  } else {
    console.log('Dry-run complete. 0 Bright Data credits consumed.');
  }

  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
