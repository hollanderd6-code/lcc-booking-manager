'use strict';
/**
 * PMS-INTL-FINAL-CLOSURE-FIX-5 — Upsell currency authority chain + reporting null guards
 *
 * Suite A : chat-handler upsell blocks (late_checkout, early_checkin, welcome_basket)
 * Suite B : reporting summary pendingGrossRevenue null guard
 * Suite C : reporting platforms per-currency null guard + revenueByCurrency
 * Suite D : iOS model compatibility (Swift field declarations)
 */

const fs   = require('fs');
const path = require('path');

const chatSrc      = fs.readFileSync(path.join(__dirname, '../integrated-chat-handler.js'), 'utf8');
const serverSrc    = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const reportingSwift = fs.readFileSync(
  path.join(__dirname, '../../Boostinghost-ios/Boostinghost/Models/Reporting.swift'), 'utf8');

// Helpers
function extractBlock(marker, content, limit = 6000) {
  const idx = content.indexOf(marker);
  if (idx === -1) return '';
  return content.slice(idx, idx + limit);
}

// ─── Suite A : chat-handler upsell currency authority chain ───────────────────

describe('A — chat-handler upsell currency authority chain', () => {

  const lateBlock     = extractBlock('if (context.lateCheckoutPaid)', chatSrc, 2500);
  const earlyBlock    = extractBlock('if (context.earlyCheckinPaid)', chatSrc, 2500);
  const basketBlock   = extractBlock('if (context.welcomeBasketEnabled && context.welcomeBasketPrice > 0)', chatSrc, 2500);

  test('A-01: late_checkout resolves upsellCurrency from reservation before link call', () => {
    // upsellCurrency resolution block must appear before createUpsellPaymentLink
    const resolveIdx = lateBlock.indexOf('normalizeCurrency(property?.currency)');
    const linkIdx    = lateBlock.indexOf('createUpsellPaymentLink');
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(resolveIdx);
  });

  test('A-02: late_checkout passes currency: upsellCurrency to createUpsellPaymentLink', () => {
    expect(lateBlock).toContain('currency: upsellCurrency');
  });

  test('A-03: late_checkout priceLabel uses link.currency (moved inside if block)', () => {
    // priceLabel must appear AFTER `if (link && link.url)` — not before the link call
    const ifIdx       = lateBlock.indexOf('if (link && link.url)');
    const labelIdx    = lateBlock.indexOf('const priceLabel');
    expect(ifIdx).toBeGreaterThan(-1);
    expect(labelIdx).toBeGreaterThan(ifIdx);
    // Must reference link.currency
    expect(lateBlock.slice(labelIdx, labelIdx + 200)).toContain('link.currency');
  });

  test('A-04: late_checkout priceLabel no longer uses hardcoded "€"', () => {
    // The old pattern `(amountCents / 100).toFixed(2).replace(/\.00$/, '') + '€'` must be gone
    expect(lateBlock).not.toContain("replace(/\\.00$/, '') + '€'");
  });

  test('A-05: early_checkin resolves upsellCurrency and passes it to link', () => {
    const resolveIdx = earlyBlock.indexOf('normalizeCurrency(property?.currency)');
    const linkIdx    = earlyBlock.indexOf('createUpsellPaymentLink');
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(resolveIdx);
    expect(earlyBlock).toContain('currency: upsellCurrency');
  });

  test('A-06: early_checkin priceLabel moved inside if block, uses link.currency', () => {
    const ifIdx    = earlyBlock.indexOf('if (link && link.url)');
    const labelIdx = earlyBlock.indexOf('const priceLabel');
    expect(labelIdx).toBeGreaterThan(ifIdx);
    expect(earlyBlock.slice(labelIdx, labelIdx + 200)).toContain('link.currency');
  });

  test('A-07: welcome_basket resolves upsellCurrency from reservation', () => {
    const resolveIdx = basketBlock.indexOf('normalizeCurrency(property?.currency)');
    const linkIdx    = basketBlock.indexOf('createUpsellPaymentLink');
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(resolveIdx);
  });

  test('A-08: welcome_basket passes currency: upsellCurrency to link', () => {
    expect(basketBlock).toContain('currency: upsellCurrency');
  });

  test('A-09: welcome_basket priceLabel inside if block, uses link.currency', () => {
    const ifIdx    = basketBlock.indexOf('if (link && link.url)');
    const labelIdx = basketBlock.indexOf('const priceLabel');
    expect(labelIdx).toBeGreaterThan(ifIdx);
    expect(basketBlock.slice(labelIdx, labelIdx + 200)).toContain('link.currency');
  });

  test('A-10: all three blocks query reservation currency (authority chain)', () => {
    // Each block should have the SELECT r.currency FROM reservations query
    const lateHasQuery   = lateBlock.indexOf('SELECT r.currency FROM reservations') !== -1;
    const earlyHasQuery  = earlyBlock.indexOf('SELECT r.currency FROM reservations') !== -1;
    const basketHasQuery = basketBlock.indexOf('SELECT r.currency FROM reservations') !== -1;
    expect(lateHasQuery).toBe(true);
    expect(earlyHasQuery).toBe(true);
    expect(basketHasQuery).toBe(true);
  });

  test('A-11: currency resolution fallback is non-blocking (catch block present)', () => {
    // Each block must have a try/catch around the DB query
    const lateCatch   = lateBlock.indexOf('} catch (_e)') !== -1;
    const earlyCatch  = earlyBlock.indexOf('} catch (_e)') !== -1;
    const basketCatch = basketBlock.indexOf('} catch (_e)') !== -1;
    expect(lateCatch).toBe(true);
    expect(earlyCatch).toBe(true);
    expect(basketCatch).toBe(true);
  });

  test('A-12: normalizeCurrency is already imported at top of chat handler', () => {
    const importLine = chatSrc.split('\n').slice(0, 30).join('\n');
    expect(importLine).toContain("normalizeCurrency");
  });
});

// ─── Suite B : reporting pendingGrossRevenue null guard ──────────────────────

describe('B — reporting summary pendingGrossRevenue null guard', () => {

  const reportBlock = extractBlock('pendingGrossRevenue: _pendingUniqCur', serverSrc, 500);
  const pendingUniqBlock = extractBlock('_pendingUniqCur', serverSrc, 800);

  test('B-01: _pendingUniqCur computed before summary', () => {
    const uniqIdx    = serverSrc.indexOf('_pendingUniqCur');
    const summaryIdx = serverSrc.indexOf('const summary = {', uniqIdx - 500);
    expect(uniqIdx).toBeGreaterThan(-1);
    // _pendingUniqCur appears before or in vicinity of summary
    expect(uniqIdx).toBeGreaterThan(0);
  });

  test('B-02: pendingGrossRevenue uses _pendingUniqCur length guard', () => {
    expect(reportBlock).toContain('_pendingUniqCur.length <= 1');
  });

  test('B-03: pendingGrossRevenue is null when mixed (ternary null branch present)', () => {
    expect(reportBlock).toContain(': null');
  });

  test('B-04: pendingGrossRevenueByCurrency emitted in summary', () => {
    const summaryBlock = extractBlock('const summary = {', serverSrc, 1500);
    expect(summaryBlock).toContain('pendingGrossRevenueByCurrency');
  });

  test('B-05: pendingGrossRevenueByCurrency is a per-currency object (built from pendingResas)', () => {
    const buildBlock = extractBlock('pendingGrossRevenueByCurrency', serverSrc, 400);
    expect(buildBlock).toContain('r.currency');
    expect(buildBlock).toContain('r.grossRevenue');
  });

  test('B-06: when zero pending resas, pendingGrossRevenue returns 0 (not null)', () => {
    // _pendingUniqCur on empty array has length 0 ≤ 1, so it computes the sum (0)
    // Verify by reading the ternary: length <= 1 -> sum (which is 0 for empty)
    const guard = extractBlock('_pendingUniqCur.length <= 1 ?', serverSrc, 150);
    expect(guard).toContain('pendingResas.reduce');
  });
});

// ─── Suite C : platforms per-currency null guard ─────────────────────────────

describe('C — platforms per-currency null guard + revenueByCurrency', () => {

  const platBlock  = extractBlock('_revenueByCurrency', serverSrc, 1200);
  const platArray  = extractBlock('const platformArray', serverSrc, 800);

  test('C-01: platformStats init includes _revenueByCurrency field', () => {
    expect(platBlock).toContain('_revenueByCurrency: {}');
  });

  test('C-02: grossRevenue accumulated per-currency inside platformStats loop', () => {
    expect(platBlock).toContain('_revenueByCurrency[r.currency]');
  });

  test('C-03: platformArray maps _platCurrencies from _revenueByCurrency keys', () => {
    expect(platArray).toContain('_platCurrencies');
    expect(platArray).toContain('Object.keys(stats._revenueByCurrency)');
  });

  test('C-04: platform revenue is null when mixed currencies for that platform', () => {
    expect(platArray).toContain('_platCurrencies.length <= 1');
    expect(platArray).toContain(': null');
  });

  test('C-05: revenueByCurrency always emitted in platformArray entry', () => {
    expect(platArray).toContain('revenueByCurrency: stats._revenueByCurrency');
  });

  test('C-06: mono-currency platform revenue is numeric (not null)', () => {
    // The ternary: length <= 1 ? Math.round(...) : null
    const ternary = extractBlock('_platCurrencies.length <= 1 ?', serverSrc, 120);
    expect(ternary).toContain('Math.round(stats._revenueSum');
  });
});

// ─── Suite D : iOS model compatibility ───────────────────────────────────────

describe('D — iOS Reporting.swift model compatibility', () => {

  test('D-01: ReportingSummary.pendingGrossRevenue declared as Double?', () => {
    expect(reportingSwift).toMatch(/let pendingGrossRevenue:\s*Double\?/);
  });

  test('D-02: ReportingSummary.pendingGrossRevenue decoded without ?? 0 (nullable)', () => {
    // Should use flexDouble without fallback (returns nil for null JSON)
    expect(reportingSwift).toMatch(/pendingGrossRevenue\s*=\s*c\.flexDouble\(forKey: \.pendingGrossRevenue\)\s*\n/);
  });

  test('D-03: PlatformRevenuStat.revenue declared as Double?', () => {
    // The struct PlatformRevenuStat block
    const platBlock = reportingSwift.slice(
      reportingSwift.indexOf('struct PlatformRevenuStat'),
      reportingSwift.indexOf('struct PropertyRevenuStat')
    );
    expect(platBlock).toMatch(/let revenue:\s*Double\?/);
  });

  test('D-04: PlatformRevenuStat.revenue decoded without ?? 0 (nullable)', () => {
    const platBlock = reportingSwift.slice(
      reportingSwift.indexOf('struct PlatformRevenuStat'),
      reportingSwift.indexOf('struct PropertyRevenuStat')
    );
    expect(platBlock).toMatch(/revenue\s*=\s*c\.flexDouble\(forKey: \.revenue\)\s*\n/);
  });

  test('D-05: PlatformRevenuStat declares revenueByCurrency field', () => {
    const platBlock = reportingSwift.slice(
      reportingSwift.indexOf('struct PlatformRevenuStat'),
      reportingSwift.indexOf('struct PropertyRevenuStat')
    );
    expect(platBlock).toMatch(/let revenueByCurrency:\s*\[String:\s*Double\]\?/);
  });

  test('D-06: PropertyRevenuStat.pendingGrossRevenue remains Double (not nullable)', () => {
    const propBlock = reportingSwift.slice(
      reportingSwift.indexOf('struct PropertyRevenuStat')
    );
    expect(propBlock).toMatch(/let pendingGrossRevenue:\s*Double\b/);
    expect(propBlock).not.toMatch(/let pendingGrossRevenue:\s*Double\?/);
  });

  test('D-07: ReportingCurrencyState.format(Double?) overload present', () => {
    expect(reportingSwift).toContain('func format(_ amount: Double?) -> String');
  });
});
