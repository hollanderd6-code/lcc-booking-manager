'use strict';
/**
 * PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1B
 *
 * Static source analysis verifying that every Stripe checkout session creation
 * that involves a deposit or payment uses the property / record currency
 * rather than a hardcoded "eur".
 *
 * Rules:
 *   Rule A (new creation): authority = property.currency
 *   Rule B (modification/regen): authority = existing deposits.currency / payments.currency
 *   Rule C (legacy / absent source): || 'EUR' fallback
 *   Rule D: no FX conversion, no silent retry in another currency
 *
 * Suites:
 *   A — POST /api/deposits: new deposit uses property currency (rule A)
 *   B — POST /api/payments: new payment uses property currency (rule A)
 *   C — PUT /api/deposits/:id: modification preserves existing currency (rule B)
 *   D — PUT /api/payments/:id: modification preserves existing currency (rule B)
 *   E — regenStripeSession(): regeneration preserves record currency (rule B)
 *   F — quick-context auto-deposit uses property currency (rule A)
 *   G — sendDepositRequestMessages(): uses property currency (rule A)
 *   H — sendTemplateMessage {caution_url}: uses property currency (rule A)
 *   I — Cron template {caution_url}: uses property currency (rule A)
 *   J — integrated-chat-handler ensureDepositExists: uses property currency (rule A)
 *   K — Webhook: currency synced from Stripe session to DB (mismatch detection)
 *   L — No FX conversion
 *   M — Legacy / NULL currency → EUR fallback (only when source is absent)
 *   N — Isolation: upsell INTENTIONALLY_EUR unchanged
 *   O — Isolation: SaaS billing unchanged (priceIds, no explicit currency field)
 *   P — DB migration: deposits.currency column with DEFAULT 'eur'
 *   Q — saveDepositToDB / savePaymentToDB preserve currency
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../server.js'), 'utf8'
);

const icdSrc = fs.readFileSync(
  path.join(__dirname, '../integrated-chat-handler.js'), 'utf8'
);

// ── Locate blocks via unique INTL-DEPOSIT-STRIPE comment anchors ─────────────
// Each anchor is the unique INTL comment added exactly at the relevant code site.

// POST /api/deposits — unique INTL comment at the property-currency derivation
const postDepIntlIdx = serverSrc.indexOf(
  '// INTL-DEPOSIT-STRIPE — rule A: new deposit takes its currency from the property'
);
// 2300 chars: price_data is 1912 chars after the anchor + 200 chars for the block
const postDepBlock = postDepIntlIdx !== -1
  ? serverSrc.slice(postDepIntlIdx, postDepIntlIdx + 2300)
  : '';

// POST /api/payments — unique INTL comment
const postPayIntlIdx = serverSrc.indexOf(
  '// INTL-DEPOSIT-STRIPE — rule A: new payment takes its currency from the property'
);
// 2400 chars: price_data is 2053 chars after the anchor
const postPayBlock = postPayIntlIdx !== -1
  ? serverSrc.slice(postPayIntlIdx, postPayIntlIdx + 2400)
  : '';

// PUT /api/deposits — unique INTL comment (mentions "never re-reads property")
const putDepIntlIdx = serverSrc.indexOf(
  '// INTL-DEPOSIT-STRIPE — rule B: modification uses the currency already on the record, never re-reads property'
);
const putDepBlock = putDepIntlIdx !== -1
  ? serverSrc.slice(putDepIntlIdx, putDepIntlIdx + 500)
  : '';

// PUT /api/payments — unique INTL comment (shorter — no "never re-reads property")
const putPayIntlIdx = serverSrc.indexOf(
  '// INTL-DEPOSIT-STRIPE — rule B: modification uses the currency already on the record\n'
);
// 600 chars: paymentCurr.toLowerCase() is at 426 chars
const putPayBlock = putPayIntlIdx !== -1
  ? serverSrc.slice(putPayIntlIdx, putPayIntlIdx + 600)
  : '';

// regenStripeSession — unique INTL comment
const regenIntlIdx = serverSrc.indexOf(
  '// INTL-DEPOSIT-STRIPE — rule B: regeneration uses the currency stored on the record'
);
// 2100 chars: payment branch starts at 1505 chars + 400 chars for the branch content
const regenBlock = regenIntlIdx !== -1
  ? serverSrc.slice(regenIntlIdx, regenIntlIdx + 2100)
  : '';

// quick-context auto-deposit — unique variable name anchor
const qcCurrIdx = serverSrc.indexOf(
  'const qcDepositCurrency = normalizeCurrency(row.property_currency)'
);
// 200 chars back + 2600 forward: INSERT is 1754 chars after anchor, response is 2225 chars after
const qcBlock = qcCurrIdx !== -1
  ? serverSrc.slice(qcCurrIdx - 200, qcCurrIdx + 2600)
  : '';
// Handler start for the SELECT check
const qcHandlerIdx = serverSrc.indexOf("app.get('/api/chat/conversations/:convId/quick-context'");
const qcSelectBlock = qcHandlerIdx !== -1
  ? serverSrc.slice(qcHandlerIdx, qcHandlerIdx + 1000)
  : '';

// sendDepositRequestMessages — unique variable name anchor
const sdrCurrIdx = serverSrc.indexOf(
  'const sdrDepositCurrency = normalizeCurrency(conv.property_currency)'
);
// 300 chars back + 2600 forward: INSERT is 1948 chars after anchor
const sdrBlock = sdrCurrIdx !== -1
  ? serverSrc.slice(sdrCurrIdx - 300, sdrCurrIdx + 2600)
  : '';
// Function declaration as SELECT anchor (not the first mention which is a comment)
const sdrFnIdx = serverSrc.indexOf('async function sendDepositRequestMessages');
// 700 chars: p.currency AS property_currency is 520 chars from fn start
const sdrSelectBlock = sdrFnIdx !== -1
  ? serverSrc.slice(sdrFnIdx, sdrFnIdx + 700)
  : '';

// sendTemplateMessage — unique variable name anchor
const tplCurrIdx = serverSrc.indexOf(
  'const tplDepositCurrency = normalizeCurrency(propD.rows[0]?.currency)'
);
// 2100 chars: INSERT is 1291 chars after anchor; array ends ~1700 chars after anchor
const tplBlock = tplCurrIdx !== -1
  ? serverSrc.slice(tplCurrIdx, tplCurrIdx + 2100)
  : '';

// Cron template — unique variable name anchor
const cronCurrIdx = serverSrc.indexOf(
  'const cronDepositCurrency = normalizeCurrency(propD.rows[0]?.currency)'
);
// 2100 chars: INSERT is 1314 chars after anchor; array ends ~1800 chars after anchor
const cronBlock = cronCurrIdx !== -1
  ? serverSrc.slice(cronCurrIdx, cronCurrIdx + 2100)
  : '';

// Webhook deposit sync — unique anchor
const webhookDepIdx = serverSrc.indexOf(
  '// INTL-DEPOSIT-STRIPE — sync currency from Stripe session to DB'
);
// 1000 chars: UPDATE is 813 chars after anchor
const webhookDepBlock = webhookDepIdx !== -1
  ? serverSrc.slice(webhookDepIdx, webhookDepIdx + 1000)
  : '';

// ── A: POST /api/deposits ────────────────────────────────────────────────────

describe('A — POST /api/deposits: new deposit uses property currency (rule A)', () => {
  test('A-01 INTL comment anchor present in server.js', () => {
    expect(postDepIntlIdx).not.toBe(-1);
  });

  test('A-02 depositCurrency derived from normalizeCurrency(depositPropertyCurrency) || "EUR"', () => {
    expect(postDepBlock).toMatch(/normalizeCurrency\(depositPropertyCurrency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-03 depositPropertyCurrency sourced from property?.currency', () => {
    expect(postDepBlock).toMatch(/depositPropertyCurrency\s*=\s*property\?\.currency/);
  });

  test('A-04 freeMode fallback queries DB for property currency', () => {
    expect(postDepBlock).toMatch(/SELECT currency FROM properties WHERE id/);
  });

  test('A-05 deposit object currency uses depositCurrency.toLowerCase()', () => {
    expect(postDepBlock).toMatch(/currency:\s*depositCurrency\.toLowerCase\(\)/);
  });

  test('A-06 Stripe session price_data currency uses depositCurrency.toLowerCase()', () => {
    const pdIdx = postDepBlock.indexOf('price_data');
    expect(pdIdx).not.toBe(-1);
    const pdBlock = postDepBlock.slice(pdIdx, pdIdx + 200);
    expect(pdBlock).toMatch(/currency:\s*depositCurrency\.toLowerCase\(\)/);
  });

  test('A-07 no hardcoded price_data currency "eur" in POST deposits block', () => {
    const pdIdx = postDepBlock.indexOf('price_data');
    expect(pdIdx).not.toBe(-1);
    const pdBlock = postDepBlock.slice(pdIdx, pdIdx + 200);
    expect(pdBlock).not.toMatch(/currency:\s*['"]eur['"]/);
  });
});

// ── B: POST /api/payments ────────────────────────────────────────────────────

describe('B — POST /api/payments: new payment uses property currency (rule A)', () => {
  test('B-01 INTL comment anchor present', () => {
    expect(postPayIntlIdx).not.toBe(-1);
  });

  test('B-02 paymentCurrencyNew derived from normalizeCurrency(paymentPropertyCurrency) || "EUR"', () => {
    expect(postPayBlock).toMatch(/normalizeCurrency\(paymentPropertyCurrency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-03 paymentPropertyCurrency sourced from property?.currency', () => {
    expect(postPayBlock).toMatch(/paymentPropertyCurrency\s*=\s*property\?\.currency/);
  });

  test('B-04 payment object currency uses paymentCurrencyNew.toLowerCase()', () => {
    expect(postPayBlock).toMatch(/currency:\s*paymentCurrencyNew\.toLowerCase\(\)/);
  });

  test('B-05 Stripe session price_data currency uses paymentCurrencyNew.toLowerCase()', () => {
    const pdIdx = postPayBlock.indexOf('price_data');
    expect(pdIdx).not.toBe(-1);
    const pdBlock = postPayBlock.slice(pdIdx, pdIdx + 200);
    expect(pdBlock).toMatch(/currency:\s*paymentCurrencyNew\.toLowerCase\(\)/);
  });

  test('B-06 no hardcoded price_data currency "eur" in POST payments block', () => {
    const pdIdx = postPayBlock.indexOf('price_data');
    expect(pdIdx).not.toBe(-1);
    const pdBlock = postPayBlock.slice(pdIdx, pdIdx + 200);
    expect(pdBlock).not.toMatch(/currency:\s*['"]eur['"]/);
  });
});

// ── C: PUT /api/deposits/:id ─────────────────────────────────────────────────

describe('C — PUT /api/deposits/:id: modification preserves existing currency (rule B)', () => {
  test('C-01 INTL comment anchor present', () => {
    expect(putDepIntlIdx).not.toBe(-1);
  });

  test('C-02 depositCurr = normalizeCurrency(existing.currency) || "EUR"', () => {
    expect(putDepBlock).toMatch(/normalizeCurrency\(existing\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('C-03 Stripe session uses depositCurr.toLowerCase()', () => {
    expect(putDepBlock).toMatch(/currency:\s*depositCurr\.toLowerCase\(\)/);
  });

  test('C-04 authority is existing.currency (record), not property.currency (re-read)', () => {
    // The block must NOT re-read property.currency as authority
    expect(putDepBlock).not.toMatch(/normalizeCurrency\(.*property.*currency/);
  });
});

// ── D: PUT /api/payments/:id ─────────────────────────────────────────────────

describe('D — PUT /api/payments/:id: modification preserves existing currency (rule B)', () => {
  test('D-01 INTL comment anchor present', () => {
    expect(putPayIntlIdx).not.toBe(-1);
  });

  test('D-02 paymentCurr = normalizeCurrency(existing.currency) || "EUR"', () => {
    expect(putPayBlock).toMatch(/normalizeCurrency\(existing\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('D-03 Stripe session uses paymentCurr.toLowerCase()', () => {
    expect(putPayBlock).toMatch(/currency:\s*paymentCurr\.toLowerCase\(\)/);
  });
});

// ── E: regenStripeSession() ──────────────────────────────────────────────────

describe('E — regenStripeSession(): regeneration preserves record currency (rule B)', () => {
  test('E-01 INTL comment anchor present', () => {
    expect(regenIntlIdx).not.toBe(-1);
  });

  test('E-02 recordCurrency = normalizeCurrency(record.currency) || "EUR"', () => {
    expect(regenBlock).toMatch(/normalizeCurrency\(record\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('E-03 deposit branch uses recordCurrency.toLowerCase()', () => {
    const depositBranchIdx = regenBlock.indexOf("type === 'deposit'");
    expect(depositBranchIdx).not.toBe(-1);
    const depositBranchBlock = regenBlock.slice(depositBranchIdx, depositBranchIdx + 400);
    expect(depositBranchBlock).toMatch(/currency:\s*recordCurrency\.toLowerCase\(\)/);
  });

  test('E-04 payment branch uses recordCurrency.toLowerCase()', () => {
    const payBranchIdx = regenBlock.indexOf("type === 'payment'");
    expect(payBranchIdx).not.toBe(-1);
    const payBranchBlock = regenBlock.slice(payBranchIdx, payBranchIdx + 400);
    expect(payBranchBlock).toMatch(/currency:\s*recordCurrency\.toLowerCase\(\)/);
  });

  test('E-05 no hardcoded "eur" in price_data after recordCurrency declaration', () => {
    const afterIdx = regenBlock.indexOf('recordCurrency');
    const afterBlock = regenBlock.slice(afterIdx);
    expect(afterBlock).not.toMatch(/price_data[\s\S]{0,200}currency:\s*['"]eur['"]/);
  });
});

// ── F: quick-context ─────────────────────────────────────────────────────────

describe('F — quick-context auto-deposit uses property currency (rule A)', () => {
  test('F-01 qcDepositCurrency anchor present', () => {
    expect(qcCurrIdx).not.toBe(-1);
  });

  test('F-02 SELECT includes p.currency AS property_currency', () => {
    expect(qcSelectBlock).toMatch(/p\.currency\s+AS\s+property_currency/);
  });

  test('F-03 qcDepositCurrency = normalizeCurrency(row.property_currency) || "EUR"', () => {
    expect(qcBlock).toMatch(/normalizeCurrency\(row\.property_currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('F-04 Stripe session uses qcDepositCurrency.toLowerCase()', () => {
    expect(qcBlock).toMatch(/currency:\s*qcDepositCurrency\.toLowerCase\(\)/);
  });

  test('F-05 INSERT uses qcDepositCurrency.toLowerCase() (not hardcoded "eur")', () => {
    const insertIdx = qcBlock.indexOf('INSERT INTO deposits');
    expect(insertIdx).not.toBe(-1);
    const insertBlock = qcBlock.slice(insertIdx, insertIdx + 700);
    expect(insertBlock).toMatch(/qcDepositCurrency\.toLowerCase\(\)/);
    expect(insertBlock).not.toMatch(/'eur'/);
  });

  test('F-06 depositCurrency in response assigned from qcDepositCurrency', () => {
    expect(qcBlock).toMatch(/depositCurrency\s*=\s*qcDepositCurrency/);
  });
});

// ── G: sendDepositRequestMessages ────────────────────────────────────────────

describe('G — sendDepositRequestMessages(): uses property currency (rule A)', () => {
  test('G-01 sdrDepositCurrency anchor present', () => {
    expect(sdrCurrIdx).not.toBe(-1);
  });

  test('G-02 SELECT in function includes p.currency AS property_currency', () => {
    expect(sdrSelectBlock).toMatch(/p\.currency\s+AS\s+property_currency/);
  });

  test('G-03 sdrDepositCurrency = normalizeCurrency(conv.property_currency) || "EUR"', () => {
    expect(sdrBlock).toMatch(/normalizeCurrency\(conv\.property_currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('G-04 Stripe session uses sdrDepositCurrency.toLowerCase()', () => {
    expect(sdrBlock).toMatch(/currency:\s*sdrDepositCurrency\.toLowerCase\(\)/);
  });

  test('G-05 INSERT includes sdrDepositCurrency.toLowerCase()', () => {
    const insertIdx = sdrBlock.indexOf('INSERT INTO deposits');
    expect(insertIdx).not.toBe(-1);
    const insertBlock = sdrBlock.slice(insertIdx, insertIdx + 700);
    expect(insertBlock).toMatch(/sdrDepositCurrency\.toLowerCase\(\)/);
  });
});

// ── H: sendTemplateMessage {caution_url} ─────────────────────────────────────

describe('H — sendTemplateMessage {caution_url}: uses property currency (rule A)', () => {
  test('H-01 tplDepositCurrency anchor present', () => {
    expect(tplCurrIdx).not.toBe(-1);
  });

  test('H-02 tplDepositCurrency = normalizeCurrency(propD.rows[0]?.currency) || "EUR"', () => {
    expect(tplBlock).toMatch(/normalizeCurrency\(propD\.rows\[0\]\?\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('H-03 Stripe session uses tplDepositCurrency.toLowerCase()', () => {
    expect(tplBlock).toMatch(/currency:\s*tplDepositCurrency\.toLowerCase\(\)/);
  });

  test('H-04 INSERT includes tplDepositCurrency.toLowerCase()', () => {
    const insertIdx = tplBlock.indexOf('INSERT INTO deposits');
    expect(insertIdx).not.toBe(-1);
    // Search to end of block — SQL string + VALUES array spans ~400 chars after INSERT
    const insertBlock = tplBlock.slice(insertIdx);
    expect(insertBlock).toMatch(/tplDepositCurrency\.toLowerCase\(\)/);
  });
});

// ── I: Cron template {caution_url} ───────────────────────────────────────────

describe('I — Cron template {caution_url}: uses property currency (rule A)', () => {
  test('I-01 cronDepositCurrency anchor present', () => {
    expect(cronCurrIdx).not.toBe(-1);
  });

  test('I-02 cronDepositCurrency = normalizeCurrency(propD.rows[0]?.currency) || "EUR"', () => {
    expect(cronBlock).toMatch(/normalizeCurrency\(propD\.rows\[0\]\?\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('I-03 Stripe session uses cronDepositCurrency.toLowerCase()', () => {
    expect(cronBlock).toMatch(/currency:\s*cronDepositCurrency\.toLowerCase\(\)/);
  });

  test('I-04 INSERT includes cronDepositCurrency.toLowerCase()', () => {
    const insertIdx = cronBlock.indexOf('INSERT INTO deposits');
    expect(insertIdx).not.toBe(-1);
    const insertBlock = cronBlock.slice(insertIdx);
    expect(insertBlock).toMatch(/cronDepositCurrency\.toLowerCase\(\)/);
  });
});

// ── J: integrated-chat-handler ───────────────────────────────────────────────

describe('J — integrated-chat-handler ensureDepositExists: uses property currency (rule A)', () => {
  test('J-01 integrated-chat-handler.js present and non-empty', () => {
    expect(icdSrc.length).toBeGreaterThan(100);
  });

  test('J-02 SELECT includes currency column', () => {
    expect(icdSrc).toMatch(/SELECT id, name, deposit_amount, currency FROM properties WHERE id/);
  });

  test('J-03 normalizeCurrency imported from market-data-resolver', () => {
    expect(icdSrc).toMatch(/normalizeCurrency.*require.*market-data-resolver/s);
  });

  test('J-04 icdDepositCurrency derived from normalizeCurrency(property.currency) || "EUR"', () => {
    expect(icdSrc).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('J-05 Stripe session uses icdDepositCurrency', () => {
    expect(icdSrc).toMatch(/currency:\s*icdDepositCurrency/);
  });

  test('J-06 INSERT includes currency column with icdDepositCurrency', () => {
    const insertIdx = icdSrc.indexOf('INSERT INTO deposits');
    expect(insertIdx).not.toBe(-1);
    const insertBlock = icdSrc.slice(insertIdx, insertIdx + 700);
    expect(insertBlock).toMatch(/icdDepositCurrency/);
  });
});

// ── K: Webhook deposit currency sync ─────────────────────────────────────────

describe('K — Webhook: currency synced from Stripe session to DB (mismatch detection)', () => {
  test('K-01 webhook deposit currency sync block present', () => {
    expect(webhookDepIdx).not.toBe(-1);
  });

  test('K-02 reads session.currency from Stripe', () => {
    expect(webhookDepBlock).toMatch(/session\.currency/);
  });

  test('K-03 logs CURRENCY_MISMATCH warning when DB ≠ Stripe', () => {
    expect(webhookDepBlock).toMatch(/CURRENCY_MISMATCH/);
    expect(webhookDepBlock).toMatch(/console\.warn/);
  });

  test('K-04 UPDATE deposits SET currency = $1 to persist Stripe-authoritative value', () => {
    expect(webhookDepBlock).toMatch(/UPDATE deposits SET currency\s*=\s*\$1/);
  });

  test('K-05 uses normalizeCurrency on session.currency before storing', () => {
    expect(webhookDepBlock).toMatch(/normalizeCurrency\(session\.currency\./);
  });
});

// ── L: No FX conversion ───────────────────────────────────────────────────────

describe('L — No FX conversion: no implicit currency change for known currencies', () => {
  test('L-01 POST deposits: no exchangeRate/fxRate/convertCurrency', () => {
    expect(postDepBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/i);
  });

  test('L-02 PUT deposits: no FX', () => {
    expect(putDepBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/i);
  });

  test('L-03 regenStripeSession: no FX', () => {
    expect(regenBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/i);
  });

  test('L-04 quick-context: no FX', () => {
    expect(qcBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/i);
  });

  test('L-05 sendDepositRequestMessages: no FX', () => {
    expect(sdrBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/i);
  });
});

// ── M: Legacy / NULL currency → EUR fallback ─────────────────────────────────

describe('M — Legacy / NULL currency → EUR fallback when source is absent', () => {
  test('M-01 POST deposits uses || "EUR" fallback (rule C: genuinely absent source)', () => {
    expect(postDepBlock).toMatch(/normalizeCurrency\(depositPropertyCurrency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('M-02 POST payments uses || "EUR" fallback', () => {
    expect(postPayBlock).toMatch(/normalizeCurrency\(paymentPropertyCurrency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('M-03 regenStripeSession uses || "EUR" fallback for absent record.currency', () => {
    expect(regenBlock).toMatch(/normalizeCurrency\(record\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('M-04 quick-context uses || "EUR" fallback for absent property_currency', () => {
    expect(qcBlock).toMatch(/normalizeCurrency\(row\.property_currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('M-05 deposits.currency DB column DEFAULT "eur" covers legacy rows', () => {
    expect(serverSrc).toMatch(/ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'eur'/);
  });
});

// ── N: Isolation: upsell INTENTIONALLY_EUR unchanged ─────────────────────────

describe('N — Isolation: upsell INTENTIONALLY_EUR unchanged', () => {
  test('N-01 upsell-service.js uses upsellCurrency.toLowerCase() (P2 multi-currency fix)', () => {
    const upsellSrc = fs.readFileSync(path.join(__dirname, '../upsell-service.js'), 'utf8');
    // P2 fix: currency is now per-reservation/property, not hardcoded "eur"
    expect(upsellSrc).toMatch(/currency:\s*upsellCurrency\.toLowerCase\(\)/);
    expect(upsellSrc).not.toMatch(/currency:\s*['"]eur['"]/);
  });
});

// ── O: Isolation: SaaS billing ───────────────────────────────────────────────

describe('O — Isolation: SaaS billing unchanged (uses priceIds, EUR encoded in price)', () => {
  test('O-01 billing subscription routes use mode: "subscription"', () => {
    expect(serverSrc).toMatch(/mode:\s*['"]subscription['"]/);
  });

  test('O-02 billing uses price: priceId (no explicit currency field needed)', () => {
    expect(serverSrc).toMatch(/price:\s*\w*[Pp]rice[Ii]d/);
  });
});

// ── P: DB migration ──────────────────────────────────────────────────────────

describe('P — DB migration: deposits.currency column', () => {
  test('P-01 ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT "eur"', () => {
    expect(serverSrc).toMatch(/ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'eur'/);
  });

  test('P-02 payments table has currency VARCHAR(10) DEFAULT "eur"', () => {
    expect(serverSrc).toMatch(/currency VARCHAR\(10\) DEFAULT 'eur'/);
  });
});

// ── Q: saveDepositToDB / savePaymentToDB ─────────────────────────────────────

describe('Q — saveDepositToDB / savePaymentToDB preserve stored currency', () => {
  test('Q-01 saveDepositToDB uses deposit.currency || "eur"', () => {
    const idx = serverSrc.indexOf('async function saveDepositToDB');
    expect(idx).not.toBe(-1);
    const block = serverSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/deposit\.currency\s*\|\|\s*['"]eur['"]/);
  });

  test('Q-02 savePaymentToDB uses payment.currency || "eur"', () => {
    const idx = serverSrc.indexOf('async function savePaymentToDB');
    expect(idx).not.toBe(-1);
    const block = serverSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/payment\.currency\s*\|\|\s*['"]eur['"]/);
  });

  test('Q-03 loadDepositsFromDB still selects currency column', () => {
    const idx = serverSrc.indexOf('async function loadDepositsFromDB');
    expect(idx).not.toBe(-1);
    const block = serverSrc.slice(idx, idx + 400);
    expect(block).toMatch(/amount_cents,\s*currency/);
  });
});
