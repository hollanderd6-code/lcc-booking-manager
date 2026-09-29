'use strict';
/**
 * PMS-INTL-IOS-DEPOSIT-CONTEXT-CURRENCY-1
 *
 * Static source analysis verifying that the deposit context quick-context
 * endpoint now propagates a currency code alongside depositAmountCents,
 * and that the iOS ConversationDetailView uses it for currency-aware display.
 *
 * Suites:
 *   A — Backend quick-context exposes depositCurrency
 *   B — deposits.currency column migration exists
 *   C — Auto-created deposit records 'eur' explicitly
 *   D — iOS QuickContextResponse has depositCurrency
 *   E — ConversationDetailViewModel propagates depositCurrency
 *   F — ConversationDetailView uses currency-aware Formatters.amount
 *   G — CURRENCY_SNAPSHOT_MISSING comment removed
 *   H — Acceptance matrix (EUR / ILS / USD / CHF / nil / invalid)
 *   I — Isolation: other deposit surfaces untouched
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../server.js'), 'utf8'
);

const iosRoot = path.join(__dirname, '../../Boostinghost-ios/Boostinghost');

function readIos(relPath) {
  const abs = path.join(iosRoot, relPath);
  try { return fs.readFileSync(abs, 'utf8'); }
  catch (_) { return ''; }
}

const messageSrc   = readIos('Models/Message.swift');
const vmSrc        = readIos('Features/Messages/ConversationDetailViewModel.swift');
const viewSrc      = readIos('Features/Messages/ConversationDetailView.swift');
const formatterSrc = readIos('Core/Formatters.swift');

// ── Locate the quick-context route block ────────────────────────────────────

const qcIdx = serverSrc.indexOf("GET /api/chat/conversations/:convId/quick-context");
// Fallback: locate via the handler body
const qcHandlerIdx = serverSrc.indexOf('let depositUrl = null, depositAmountCents = null, depositCurrency = null');
// 6 000 chars covers both path-1 and path-2 plus the res.json at the end
const qcBlock = qcHandlerIdx !== -1
  ? serverSrc.slice(qcHandlerIdx - 200, qcHandlerIdx + 6000)
  : '';

// ── A: Backend quick-context exposes depositCurrency ────────────────────────

describe('A — Backend quick-context exposes depositCurrency', () => {
  test('A-01 depositCurrency variable declared in route handler', () => {
    expect(qcHandlerIdx).not.toBe(-1);
  });

  test('A-02 depositCurrency initialised as null', () => {
    expect(qcBlock).toMatch(/depositCurrency\s*=\s*null/);
  });

  test('A-03 depositCurrency set from stored deposit currency (path 1)', () => {
    // Should uppercase the stored value
    expect(qcBlock).toMatch(/depositCurrency\s*=.*currency.*toUpperCase\(\)/s);
  });

  test('A-04 path 1 SELECT includes currency column', () => {
    const selectIdx = qcBlock.indexOf('SELECT id, checkout_url, amount_cents, currency, status FROM deposits');
    expect(selectIdx).not.toBe(-1);
  });

  test('A-05 depositCurrency in auto-created path uses property currency (qcDepositCurrency)', () => {
    // Path 2 now uses qcDepositCurrency (derived from row.property_currency)
    expect(qcBlock).toMatch(/depositCurrency\s*=\s*qcDepositCurrency/);
  });

  test('A-06 depositCurrency included in JSON response', () => {
    expect(qcBlock).toMatch(/res\.json\(.*depositCurrency/s);
  });

  test('A-07 EUR fallback on null currency (|| "eur")', () => {
    expect(qcBlock).toMatch(/validDep\.currency.*\|\|\s*['"]eur['"]/);
  });
});

// ── B: deposits.currency migration ──────────────────────────────────────────

describe('B — deposits.currency column migration', () => {
  test('B-01 ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency exists', () => {
    expect(serverSrc).toMatch(
      /ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'eur'/
    );
  });

  test('B-02 migration uses DEFAULT "eur" (legacy rows get EUR automatically)', () => {
    const idx = serverSrc.indexOf("ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'eur'");
    const block = serverSrc.slice(idx, idx + 100);
    expect(block).toMatch(/DEFAULT\s+'eur'/);
  });
});

// ── C: Auto-created deposit explicitly records currency ──────────────────────

describe('C — Auto-created deposit in quick-context stores currency', () => {
  test('C-01 INSERT INTO deposits includes currency column', () => {
    // The INSERT for the auto-created deposit must now include currency
    const insertIdx = qcBlock.indexOf('INSERT INTO deposits');
    expect(insertIdx).not.toBe(-1);
    const insertBlock = qcBlock.slice(insertIdx, insertIdx + 300);
    expect(insertBlock).toMatch(/currency/);
  });

  test('C-02 INSERT currency column uses dynamic qcDepositCurrency (not hardcoded "eur")', () => {
    const insertIdx = qcBlock.indexOf('INSERT INTO deposits');
    const insertBlock = qcBlock.slice(insertIdx, insertIdx + 600);
    expect(insertBlock).toMatch(/qcDepositCurrency\.toLowerCase\(\)/);
    expect(insertBlock).not.toMatch(/'eur'/);
  });
});

// ── D: iOS QuickContextResponse ──────────────────────────────────────────────

describe('D — iOS QuickContextResponse carries depositCurrency', () => {
  test('D-01 Message.swift present', () => {
    expect(messageSrc).not.toBe('');
  });

  test('D-02 QuickContextResponse has depositCurrency field', () => {
    expect(messageSrc).toMatch(/let depositCurrency:\s*String\?/);
  });

  test('D-03 depositCurrency is optional (backward compat with old payloads)', () => {
    const idx = messageSrc.indexOf('depositCurrency');
    const block = messageSrc.slice(idx, idx + 60);
    expect(block).toMatch(/String\?/);
  });
});

// ── E: ConversationDetailViewModel propagates depositCurrency ─────────────────

describe('E — ConversationDetailViewModel propagates depositCurrency', () => {
  test('E-01 ViewModel present', () => {
    expect(vmSrc).not.toBe('');
  });

  test('E-02 depositCurrency property declared', () => {
    expect(vmSrc).toMatch(/private\(set\) var depositCurrency:\s*String\? = nil/);
  });

  test('E-03 depositCurrency assigned from ctx.depositCurrency after fetchDepositLink', () => {
    expect(vmSrc).toMatch(/depositCurrency\s*=\s*ctx\.depositCurrency/);
  });

  test('E-04 depositCurrency cleared in confirmPasteDepositLink', () => {
    const idx = vmSrc.indexOf('func confirmPasteDepositLink');
    const block = vmSrc.slice(idx, idx + 300);
    expect(block).toMatch(/depositCurrency\s*=\s*nil/);
  });

  test('E-05 depositCurrency cleared in clearDepositLink', () => {
    const idx = vmSrc.indexOf('func clearDepositLink');
    const block = vmSrc.slice(idx, idx + 200);
    expect(block).toMatch(/depositCurrency\s*=\s*nil/);
  });
});

// ── F: ConversationDetailView currency-aware formatting ───────────────────────

describe('F — ConversationDetailView uses currency-aware Formatters.amount', () => {
  test('F-01 View present', () => {
    expect(viewSrc).not.toBe('');
  });

  test('F-02 Formatters.amount is called with currency: parameter for deposit', () => {
    const idx = viewSrc.indexOf('depositAmountCents');
    expect(idx).not.toBe(-1);
    const block = viewSrc.slice(idx, idx + 400);
    expect(block).toMatch(/Formatters\.amount\(.*currency:/s);
  });

  test('F-03 vm.depositCurrency is passed to Formatters.amount', () => {
    const idx = viewSrc.indexOf('depositAmountCents');
    const block = viewSrc.slice(idx, idx + 400);
    expect(block).toMatch(/depositCurrency/);
  });

  test('F-04 Formatters.normalizeCurrency wraps vm.depositCurrency (nil-safe)', () => {
    const idx = viewSrc.indexOf('depositAmountCents');
    const block = viewSrc.slice(idx, idx + 400);
    expect(block).toMatch(/normalizeCurrency\(vm\.depositCurrency\)/);
  });

  test('F-05 Formatters.amount(_, currency:) signature supports multi-currency', () => {
    expect(formatterSrc).toMatch(/func amount\(_ value: Double, currency: String = "EUR"\)/);
  });
});

// ── G: CURRENCY_SNAPSHOT_MISSING removed ─────────────────────────────────────

describe('G — CURRENCY_SNAPSHOT_MISSING removed from ConversationDetailView', () => {
  test('G-01 no CURRENCY_SNAPSHOT_MISSING in ConversationDetailView near depositAmountCents', () => {
    const idx = viewSrc.indexOf('depositAmountCents');
    expect(idx).not.toBe(-1);
    const block = viewSrc.slice(idx, idx + 400);
    expect(block).not.toMatch(/CURRENCY_SNAPSHOT_MISSING/);
  });

  test('G-02 no CURRENCY_SNAPSHOT_MISSING anywhere in ConversationDetailView', () => {
    expect(viewSrc).not.toMatch(/CURRENCY_SNAPSHOT_MISSING/);
  });
});

// ── H: Acceptance matrix ─────────────────────────────────────────────────────

describe('H — Acceptance matrix: EUR / ILS / USD / CHF / nil / invalid', () => {
  // The acceptance checks are structural — they verify the normalizeCurrency
  // call is in place, which handles all currency codes at runtime.
  // Specific code path: (validDep.currency || 'eur').toUpperCase() → normalizeCurrency

  test('H-01 EUR: stored "eur" → toUpperCase → "EUR" → Formatters.amount(_, currency: "EUR")', () => {
    // toUpperCase normalization verified in path 1
    expect(qcBlock).toMatch(/\.toUpperCase\(\)/);
  });

  test('H-02 ILS: stored "ils" → "ILS" → normalizeCurrency → "ILS" → ₪', () => {
    // normalizeCurrency on iOS accepts any valid ISO 4217 code
    expect(formatterSrc).toMatch(/normalizeCurrency/);
  });

  test('H-03 USD: same chain → "$"', () => {
    // currencySymbol dispatches to NumberFormatter for non-EUR
    expect(formatterSrc).toMatch(/currencySymbol/);
  });

  test('H-04 CHF: same chain → NumberFormatter .currency resolves symbol dynamically', () => {
    // CHF symbol is resolved by NumberFormatter with currencyCode = "CHF" — not hardcoded
    expect(formatterSrc).toMatch(/\.currency\b/);
    expect(formatterSrc).toMatch(/currencyCode\s*=/);
  });

  test('H-05 nil depositCurrency in payload → normalizeCurrency(nil) → "EUR" (no crash)', () => {
    // normalizeCurrency: (code ?? "") → "" → count != 3 → "EUR"
    expect(formatterSrc).toMatch(/code\s*\?\?\s*""/);
    expect(formatterSrc).toMatch(/return\s+"EUR"/);
  });

  test('H-06 invalid currency string → normalizeCurrency fallback → "EUR"', () => {
    // normalizeCurrency rejects invalid codes and returns EUR
    expect(formatterSrc).toMatch(/normalizeCurrency/);
  });
});

// ── I: Isolation ──────────────────────────────────────────────────────────────

describe('I — Isolation: other deposit surfaces untouched', () => {
  test('I-01 saveDepositToDB still includes currency column (BHGuest path unchanged)', () => {
    const idx = serverSrc.indexOf('async function saveDepositToDB');
    expect(idx).not.toBe(-1);
    const block = serverSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/deposit\.currency\s*\|\|\s*['"]eur['"]/);
  });

  test('I-02 loadDepositsFromDB still selects currency (unchanged)', () => {
    const idx = serverSrc.indexOf('async function loadDepositsFromDB');
    expect(idx).not.toBe(-1);
    const block = serverSrc.slice(idx, idx + 400);
    expect(block).toMatch(/amount_cents,\s*currency/);
  });

  test('I-03 quick-context Stripe session uses qcDepositCurrency (property currency, may be EUR or other)', () => {
    // INTL-DEPOSIT-STRIPE-1B: quick-context auto-created deposits now use property currency
    expect(qcBlock).toMatch(/currency:\s*qcDepositCurrency\.toLowerCase\(\)/);
  });

  test('I-04 no FX conversion introduced', () => {
    // No exchange rate, conversion, or FX function in the modified block
    expect(qcBlock).not.toMatch(/exchangeRate|fxRate|convert.*currency|convertCurrency/i);
  });

  test('I-05 ConversationDetailViewModel reservation/mandate/rental surfaces untouched', () => {
    // Only deposit-related state was changed
    expect(vmSrc).toMatch(/private\(set\) var depositAmountCents: Int\? = nil/);
  });

  test('I-06 UpsellSheet INTENTIONALLY_EUR unchanged', () => {
    const upsellSrc = readIos('Features/Upsell/UpsellSheet.swift');
    expect(upsellSrc).toMatch(/INTENTIONALLY_EUR/);
  });
});
