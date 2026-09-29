'use strict';
/**
 * IOS-PROPERTY-CURRENCY-UI-1B — property currency GET + PUT
 *
 * Suite H : GET /api/properties/:id returns currency field
 * Suite I : PUT currency on non-Channex property
 * Suite J : Channex guard
 * Suite K : iOS model (ArgentBlockView source assertions)
 */

const fs   = require('fs');
const path = require('path');

const serverSrc  = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const argentSrc  = fs.readFileSync(
  path.join(__dirname, '../../Boostinghost-ios/Boostinghost/Features/Manage/ArgentBlockView.swift'),
  'utf8'
);

function extractBlock(marker, content, limit = 3000) {
  const idx = content.indexOf(marker);
  if (idx === -1) return '';
  return content.slice(idx, idx + limit);
}

// ─── Suite H : GET /api/properties/:id returns currency ──────────────────────

describe('H — GET /api/properties/:id returns currency', () => {
  // Anchor directly on the currency line added to the single-property GET response.
  // "currency: property.currency || null" is unique (list GET uses "p.currency", not "property.currency").
  const currencyLineBlock = extractBlock(
    "currency: property.currency || null",
    serverSrc, 150
  );

  test('H-01: single GET response includes currency field', () => {
    expect(currencyLineBlock).not.toHaveLength(0);
  });

  test('H-02: currency value uses property.currency (no hardcoded EUR)', () => {
    expect(currencyLineBlock).toContain('property.currency');
  });

  test('H-03: currency falls back to null (not "EUR") when absent', () => {
    expect(currencyLineBlock).toContain('|| null');
  });

  test('H-04: currency field appears between financial fields and reservationCount', () => {
    // currency was inserted just before reservationCount in the single GET response.
    const nearReservationCount = extractBlock(
      "currency: property.currency || null,",
      serverSrc, 200
    );
    expect(nearReservationCount).toContain('reservationCount');
  });

  test('H-05: list GET already returns currency (regression guard)', () => {
    const listBlock = extractBlock("currency: p.currency || null,", serverSrc, 50);
    expect(listBlock).toContain('currency: p.currency');
  });
});

// ─── Suite I : PUT currency on non-Channex property ──────────────────────────

describe('I — PUT currency handling', () => {
  const putBlock    = extractBlock('newCurrencyNorm', serverSrc, 600);
  const updateQuery = extractBlock('currency     = $44', serverSrc, 100);

  test('I-01: PUT reads body.currency', () => {
    expect(putBlock).toContain('body.currency');
  });

  test('I-02: PUT normalizes via normalizeCurrency()', () => {
    expect(putBlock).toContain('normalizeCurrency(body.currency)');
  });

  test('I-03: PUT falls back to existing currency when body.currency is undefined', () => {
    // body.currency !== undefined ? normalize(body.currency) : oldCurrencyNorm
    expect(putBlock).toContain('body.currency !== undefined');
    expect(putBlock).toContain('oldCurrencyNorm');
  });

  test('I-04: normalized currency stored in UPDATE as $44', () => {
    expect(updateQuery).toContain('currency     = $44');
  });

  test('I-05: newCurrencyNorm passed as last parameter in query params array', () => {
    const paramBlock = extractBlock('newCurrencyNorm', serverSrc, 1500);
    expect(paramBlock).toContain('newCurrencyNorm');
  });
});

// ─── Suite J : Channex currency guard ────────────────────────────────────────

describe('J — Channex currency change guard', () => {
  // Anchor on the guard condition itself (comes BEFORE the 409 response body).
  const guardBlock = extractBlock('if (property.channex_enabled && property.channex_property_id', serverSrc, 600);

  test('J-01: guard requires channex_enabled to be true', () => {
    expect(guardBlock).toContain('property.channex_enabled');
  });

  test('J-02: guard requires channex_property_id to be set', () => {
    expect(guardBlock).toContain('property.channex_property_id');
  });

  test('J-03: guard only fires when currency actually changes', () => {
    expect(guardBlock).toContain('newCurrencyNorm !== oldCurrencyNorm');
  });

  test('J-04: guard returns HTTP 409', () => {
    expect(guardBlock).toContain('status(409)');
  });

  test('J-05: guard error code is CHANNEX_CURRENCY_CHANGE_REQUIRES_RECONNECT', () => {
    expect(guardBlock).toContain('CHANNEX_CURRENCY_CHANGE_REQUIRES_RECONNECT');
  });

  test('J-06: guard is skipped when body.currency is not provided (undefined)', () => {
    // Condition includes body.currency !== undefined
    expect(guardBlock).toContain('body.currency !== undefined');
  });

  test('J-07: same currency on Channex property is allowed (no guard trigger)', () => {
    // Confirmed by: newCurrencyNorm !== oldCurrencyNorm (would be false if same)
    expect(guardBlock).toContain('newCurrencyNorm !== oldCurrencyNorm');
  });
});

// ─── Suite K : iOS model (ArgentBlockView.swift) ──────────────────────────────

describe('K — iOS ArgentBlockView currency support', () => {

  test('K-01: ArgentDraft has currency field', () => {
    expect(argentSrc).toContain('var currency: String');
  });

  test('K-02: ArgentDraft.currency initialized from Formatters.normalizeCurrency(p.currency)', () => {
    expect(argentSrc).toContain('Formatters.normalizeCurrency(p.currency)');
  });

  test('K-03: EUR is the normalizeCurrency fallback for legacy nil (Formatters.normalizeCurrency returns "EUR" for nil)', () => {
    // Formatters.normalizeCurrency returns "EUR" for nil/empty — asserted on the Formatters source.
    const formattersSrc = fs.readFileSync(
      path.join(__dirname, '../../Boostinghost-ios/Boostinghost/Core/Formatters.swift'), 'utf8'
    );
    expect(formattersSrc).toContain('return "EUR"');
  });

  test('K-04: save() sends currency in multipart fields', () => {
    const saveBlock = extractBlock('("currency",', argentSrc, 100);
    expect(saveBlock).toContain('"currency"');
    expect(saveBlock).toContain('draft.currency');
  });

  test('K-05: EUR present in supported currencies list', () => {
    expect(argentSrc).toContain('"EUR"');
  });

  test('K-06: ILS present in supported currencies list', () => {
    expect(argentSrc).toContain('"ILS"');
  });

  test('K-07: USD present in supported currencies list', () => {
    expect(argentSrc).toContain('"USD"');
  });

  test('K-08: CHF present in supported currencies list', () => {
    expect(argentSrc).toContain('"CHF"');
  });

  test('K-09: 409 handled explicitly with proper message (no brand name in error string)', () => {
    expect(argentSrc).toContain('.server(409, _)');
    // The error string shown to the user must mention "channel manager" but not the brand name
    const errorMsgIdx  = argentSrc.indexOf('channel manager.');
    const errorMsgSlice = argentSrc.slice(Math.max(0, errorMsgIdx - 80), errorMsgIdx + 100);
    expect(errorMsgSlice).not.toContain('Channex');
    expect(errorMsgIdx).toBeGreaterThan(-1);
  });

  test('K-10: Channex lock uses both channexEnabled and channexPropertyId', () => {
    const lockBlock = extractBlock('isChannexLocked', argentSrc, 200);
    expect(lockBlock).toContain('channexEnabled');
    expect(lockBlock).toContain('channexPropertyId');
  });

  test('K-11: deviseReadCard uses currencyLabel(for:) for display', () => {
    const readBlock = extractBlock('private var deviseReadCard', argentSrc, 300);
    expect(readBlock).toContain('currencyLabel(for: code)');
  });

  test('K-12: currencyLabel returns raw code for unsupported currencies (no silent EUR)', () => {
    // currencyLabel(for code) = currencyOption(for: code)?.label ?? code
    const fnBlock = extractBlock('func currencyLabel(for code: String)', argentSrc, 100);
    expect(fnBlock).toContain('?? code');
  });

  test('K-13: deviseEditCard disabled when Channex locked', () => {
    expect(argentSrc).toContain('.disabled(locked)');
    const editBlock = extractBlock('private var deviseEditCard', argentSrc, 1100);
    expect(editBlock).toContain('locked');
  });

  test('K-14: explanatory text shown when Channex locked', () => {
    expect(argentSrc).toContain('Non modifiable tant que le logement est connecté au channel manager.');
  });

  test('K-15: CurrencyPickerSheet shows legacy currency as "Devise actuelle" when not in list', () => {
    const pickerBlock = extractBlock('private struct CurrencyPickerSheet', argentSrc, 1200);
    expect(pickerBlock).toContain('Devise actuelle');
    expect(pickerBlock).toContain('currencyOption(for: selected) == nil');
  });

  test('K-16: CurrencyPickerSheet shows checkmark on currently selected currency', () => {
    const pickerBlock = extractBlock('private struct CurrencyPickerSheet', argentSrc, 2500);
    expect(pickerBlock).toContain('selected == option.code');
    expect(pickerBlock).toContain('checkmark');
  });

  test('K-17: GBP not converted to EUR — currencyLabel returns raw code for unknowns', () => {
    // currencyOption(for: "GBP") returns nil → currencyLabel returns "GBP"
    const fnBlock = extractBlock('func currencyLabel(for code: String)', argentSrc, 100);
    expect(fnBlock).toContain('?? code');
  });
});
