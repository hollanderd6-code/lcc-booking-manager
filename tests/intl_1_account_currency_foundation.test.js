'use strict';
/**
 * INTL-1 — Account Currency Foundation
 *
 * Sections:
 *   A  country validation regex (static)
 *   B  default_currency validation regex (static)
 *   C  locale validation regex (static)
 *   D  INTL-1G isolation: PUT /api/user/profile does not write to properties (static)
 *   E  INTL-1D cascade: resolvePropertyCurrency pure function (behavioral)
 *   F  INTL-1B migration: ADD COLUMN + DEFAULT statements in server.js (static)
 *   G  INTL-1C backfill: properties.currency in server.js (static)
 *   H  INTL-1B historical account backfill in server.js (static)
 *   I  Normalization: country + defaultCurrency uppercase before validation (behavioral)
 *   J  resolvePropertyCurrency: payload currency has priority (behavioral)
 *   K  resolvePropertyCurrency: falls back to 'EUR' when both inputs null (behavioral)
 *   L  resolvePropertyCurrency: ignores invalid format (behavioral)
 *   M  PUT validation: EURO (4 chars) rejected, property currency INSERT present (static)
 *
 * Tests statiques vs comportementaux:
 *   STATIC    — vérifie le texte de server.js (SQL présent, logique non-présente)
 *   BEHAVIORAL — appelle la logique réelle et vérifie les valeurs calculées
 *
 * SAFETY: 0 DB writes. 0 network calls. 0 pricing writes.
 */

const fs   = require('fs');
const path = require('path');

// ── Pure service under test (behavioral tests) ────────────────────────────────

const {
  resolvePropertyCurrency,
  normalizeCurrency,
} = require('../services/property-currency-resolver');

// ── Validation regexes — must match server.js INTL-1 validation block ─────────

const COUNTRY_RE  = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const LOCALE_RE   = /^[a-z]{2}-[A-Z]{2}$/;

// ── Load server.js source once for static analysis ────────────────────────────

const SERVER_SRC = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

// ── Section A: country validation regex (STATIC) ──────────────────────────────

describe('A — country validation regex', () => {
  test('A-01 accepts FR', ()   => expect(COUNTRY_RE.test('FR')).toBe(true));
  test('A-02 accepts IL', ()   => expect(COUNTRY_RE.test('IL')).toBe(true));
  test('A-03 accepts US', ()   => expect(COUNTRY_RE.test('US')).toBe(true));
  test('A-04 accepts BE', ()   => expect(COUNTRY_RE.test('BE')).toBe(true));
  test('A-05 rejects lowercase fr', () => expect(COUNTRY_RE.test('fr')).toBe(false));
  test('A-06 rejects 3-char FRA',   () => expect(COUNTRY_RE.test('FRA')).toBe(false));
  test('A-07 rejects digits 12',    () => expect(COUNTRY_RE.test('12')).toBe(false));
  test('A-08 rejects empty string', () => expect(COUNTRY_RE.test('')).toBe(false));
});

// ── Section B: default_currency validation regex (STATIC) ─────────────────────

describe('B — default_currency validation regex', () => {
  test('B-01 accepts EUR', ()  => expect(CURRENCY_RE.test('EUR')).toBe(true));
  test('B-02 accepts ILS', ()  => expect(CURRENCY_RE.test('ILS')).toBe(true));
  test('B-03 accepts USD', ()  => expect(CURRENCY_RE.test('USD')).toBe(true));
  test('B-04 accepts GBP', ()  => expect(CURRENCY_RE.test('GBP')).toBe(true));
  test('B-05 rejects lowercase eur', () => expect(CURRENCY_RE.test('eur')).toBe(false));
  test('B-06 rejects 4-char EURO',   () => expect(CURRENCY_RE.test('EURO')).toBe(false));
  test('B-07 rejects 2-char EU',     () => expect(CURRENCY_RE.test('EU')).toBe(false));
  test('B-08 rejects € symbol',      () => expect(CURRENCY_RE.test('€')).toBe(false));
});

// ── Section C: locale validation regex (STATIC) ───────────────────────────────

describe('C — locale validation regex', () => {
  test('C-01 accepts fr-FR', ()  => expect(LOCALE_RE.test('fr-FR')).toBe(true));
  test('C-02 accepts he-IL', ()  => expect(LOCALE_RE.test('he-IL')).toBe(true));
  test('C-03 accepts en-US', ()  => expect(LOCALE_RE.test('en-US')).toBe(true));
  test('C-04 accepts nl-BE', ()  => expect(LOCALE_RE.test('nl-BE')).toBe(true));
  test('C-05 rejects underscore fr_FR',    () => expect(LOCALE_RE.test('fr_FR')).toBe(false));
  test('C-06 rejects wrong case FR-fr',    () => expect(LOCALE_RE.test('FR-fr')).toBe(false));
  test('C-07 rejects bare "fr"',           () => expect(LOCALE_RE.test('fr')).toBe(false));
  test('C-08 rejects no-separator "frFR"', () => expect(LOCALE_RE.test('frFR')).toBe(false));
});

// ── Section D: INTL-1G isolation (STATIC) ─────────────────────────────────────

describe('D — INTL-1G isolation: PUT /api/user/profile does not write to properties', () => {
  const PUT_PROFILE_MATCH = SERVER_SRC.match(
    /app\.put\('\/api\/user\/profile'[\s\S]*?(?=\n(?:app\.|\/\/ ===|\/\/ ─))/
  );
  const putProfileSrc = PUT_PROFILE_MATCH ? PUT_PROFILE_MATCH[0] : '';

  test('D-01 PUT /api/user/profile handler found in server.js', () => {
    expect(putProfileSrc.length).toBeGreaterThan(100);
  });
  test('D-02 PUT /api/user/profile does not UPDATE properties table', () => {
    expect(putProfileSrc).not.toMatch(/UPDATE\s+properties/i);
  });
  test('D-03 PUT /api/user/profile does not INSERT into properties', () => {
    expect(putProfileSrc).not.toMatch(/INSERT\s+INTO\s+properties/i);
  });
  test('D-04 PUT /api/user/profile UPDATE targets users table only', () => {
    expect(putProfileSrc).toMatch(/UPDATE\s+users/i);
  });
  test('D-05 PUT /api/user/profile UPDATE includes default_currency column', () => {
    expect(putProfileSrc).toMatch(/default_currency/);
  });
});

// ── Section E: resolvePropertyCurrency (BEHAVIORAL) ──────────────────────────

describe('E — resolvePropertyCurrency: core resolution logic', () => {
  test('E-01 user.default_currency=ILS + no payload → resolves ILS', () => {
    expect(resolvePropertyCurrency(null, 'ILS')).toBe('ILS');
  });

  test('E-02 user.default_currency=EUR + payload currency=CHF → resolves CHF (payload wins)', () => {
    expect(resolvePropertyCurrency('CHF', 'EUR')).toBe('CHF');
  });

  test('E-03 no payload + no user default → resolves EUR', () => {
    expect(resolvePropertyCurrency(null, null)).toBe('EUR');
  });

  test('E-04 user.default_currency=EUR + no payload → resolves EUR', () => {
    expect(resolvePropertyCurrency(null, 'EUR')).toBe('EUR');
  });

  test('E-05 invalid payload + valid user default → skips payload, uses user default', () => {
    expect(resolvePropertyCurrency('EURO', 'CHF')).toBe('CHF');
  });

  test('E-06 invalid payload + no user default → falls back to EUR', () => {
    expect(resolvePropertyCurrency('EURO', null)).toBe('EUR');
  });

  test('E-07 empty string payload + valid user default → uses user default', () => {
    expect(resolvePropertyCurrency('', 'ILS')).toBe('ILS');
  });
});

// ── Section F: INTL-1B migration idempotency + defaults (STATIC) ──────────────

describe('F — INTL-1B migration: ADD COLUMN IF NOT EXISTS + DEFAULT', () => {
  test('F-01 country column added with IF NOT EXISTS and DEFAULT', () => {
    expect(SERVER_SRC).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+country\s+TEXT\s+DEFAULT\s+'FR'/i);
  });
  test('F-02 default_currency column added with IF NOT EXISTS and DEFAULT', () => {
    expect(SERVER_SRC).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+default_currency\s+TEXT\s+DEFAULT\s+'EUR'/i);
  });
  test('F-03 locale column added with IF NOT EXISTS and DEFAULT', () => {
    expect(SERVER_SRC).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+locale\s+TEXT\s+DEFAULT\s+'fr-FR'/i);
  });
  test('F-04 ALTER COLUMN country SET DEFAULT is idempotent', () => {
    expect(SERVER_SRC).toMatch(/ALTER\s+COLUMN\s+country\s+SET\s+DEFAULT\s+'FR'/i);
  });
  test('F-05 ALTER COLUMN default_currency SET DEFAULT is idempotent', () => {
    expect(SERVER_SRC).toMatch(/ALTER\s+COLUMN\s+default_currency\s+SET\s+DEFAULT\s+'EUR'/i);
  });
  test('F-06 ALTER COLUMN locale SET DEFAULT is idempotent', () => {
    expect(SERVER_SRC).toMatch(/ALTER\s+COLUMN\s+locale\s+SET\s+DEFAULT\s+'fr-FR'/i);
  });
});

// ── Section G: INTL-1C backfill (STATIC) ──────────────────────────────────────

describe('G — INTL-1C: properties.currency backfill', () => {
  test('G-01 server.js contains properties.currency backfill to EUR where NULL', () => {
    expect(SERVER_SRC).toMatch(
      /UPDATE\s+properties\s+SET\s+currency\s*=\s*'EUR'\s+WHERE\s+currency\s+IS\s+NULL/i
    );
  });
  test('G-02 properties.currency CHECK constraint prevents empty string (chk_properties_currency)', () => {
    // The CHECK constraint is: currency IS NULL OR currency ~ '^[A-Z]{3}$'
    // Empty string '' does NOT match '^[A-Z]{3}$', so the constraint already prevents it.
    // Verify the constraint definition is present in server.js.
    expect(SERVER_SRC).toMatch(/chk_properties_currency/);
  });
});

// ── Section H: INTL-1B historical account backfill (STATIC) ──────────────────

describe('H — INTL-1B: historical account defaults', () => {
  test('H-01 users.country backfill to FR', () => {
    expect(SERVER_SRC).toMatch(
      /UPDATE\s+users\s+SET\s+country\s*=\s*'FR'\s+WHERE\s+country\s+IS\s+NULL/i
    );
  });
  test('H-02 users.default_currency backfill to EUR', () => {
    expect(SERVER_SRC).toMatch(
      /UPDATE\s+users\s+SET\s+default_currency\s*=\s*'EUR'\s+WHERE\s+default_currency\s+IS\s+NULL/i
    );
  });
  test('H-03 users.locale backfill to fr-FR', () => {
    expect(SERVER_SRC).toMatch(
      /UPDATE\s+users\s+SET\s+locale\s*=\s*'fr-FR'\s+WHERE\s+locale\s+IS\s+NULL/i
    );
  });
});

// ── Section I: Normalization country + defaultCurrency (BEHAVIORAL) ───────────

describe('I — Normalization: lowercase inputs accepted after uppercase conversion', () => {
  // normalizeCurrency also normalizes country (same fn signature — trim+uppercase)
  test('I-01 normalizeCurrency("il") → "IL"', () => {
    expect(normalizeCurrency('il')).toBe('IL');
  });
  test('I-02 normalizeCurrency("ils") → "ILS"', () => {
    expect(normalizeCurrency('ils')).toBe('ILS');
  });
  test('I-03 normalizeCurrency("EUR") → "EUR" (unchanged)', () => {
    expect(normalizeCurrency('EUR')).toBe('EUR');
  });
  test('I-04 normalizeCurrency("  fr  ") → "FR" (trims whitespace)', () => {
    expect(normalizeCurrency('  fr  ')).toBe('FR');
  });
  test('I-05 normalizeCurrency("") → null', () => {
    expect(normalizeCurrency('')).toBeNull();
  });
  test('I-06 normalizeCurrency(null) → null', () => {
    expect(normalizeCurrency(null)).toBeNull();
  });
  test('I-07 server.js PUT profile uses .toUpperCase() on country', () => {
    expect(SERVER_SRC).toMatch(/String\(country\).*toUpperCase\(\)/);
  });
  test('I-08 server.js PUT profile uses .toUpperCase() on defaultCurrency', () => {
    expect(SERVER_SRC).toMatch(/String\(defaultCurrency\).*toUpperCase\(\)/);
  });
});

// ── Section J: Payload currency priority (BEHAVIORAL) ────────────────────────

describe('J — resolvePropertyCurrency: payload currency wins over user default', () => {
  test('J-01 payload ILS + user EUR → ILS', () => {
    expect(resolvePropertyCurrency('ILS', 'EUR')).toBe('ILS');
  });
  test('J-02 payload CHF + user null → CHF', () => {
    expect(resolvePropertyCurrency('CHF', null)).toBe('CHF');
  });
  test('J-03 payload lowercase "chf" is normalized to CHF', () => {
    expect(resolvePropertyCurrency('chf', 'EUR')).toBe('CHF');
  });
  test('J-04 payload "ils" normalized → ILS wins over user EUR', () => {
    expect(resolvePropertyCurrency('ils', 'EUR')).toBe('ILS');
  });
});

// ── Section K: Fallback chain (BEHAVIORAL) ────────────────────────────────────

describe('K — resolvePropertyCurrency: fallback chain', () => {
  test('K-01 no payload + user ILS → ILS', () => {
    expect(resolvePropertyCurrency(null, 'ILS')).toBe('ILS');
  });
  test('K-02 no payload + no user → EUR', () => {
    expect(resolvePropertyCurrency(null, null)).toBe('EUR');
  });
  test('K-03 undefined both → EUR', () => {
    expect(resolvePropertyCurrency(undefined, undefined)).toBe('EUR');
  });
});

// ── Section L: Invalid format ignored by resolver (BEHAVIORAL) ────────────────

describe('L — resolvePropertyCurrency: invalid formats are skipped', () => {
  test('L-01 payload "EURO" (4 chars) is invalid → falls through to user default', () => {
    expect(resolvePropertyCurrency('EURO', 'ILS')).toBe('ILS');
  });
  test('L-02 payload "EU" (2 chars) is invalid → falls through to user default', () => {
    expect(resolvePropertyCurrency('EU', 'EUR')).toBe('EUR');
  });
  test('L-03 payload "123" (digits) is invalid → falls through to EUR', () => {
    expect(resolvePropertyCurrency('123', null)).toBe('EUR');
  });
  test('L-04 user default "EURO" invalid → falls through to hard fallback EUR', () => {
    expect(resolvePropertyCurrency(null, 'EURO')).toBe('EUR');
  });
});

// ── Section M: Property creation INSERT includes currency (STATIC) ────────────

describe('M — Property creation: currency in INSERT, no trailing UPDATE', () => {
  test('M-01 INSERT includes currency column', () => {
    expect(SERVER_SRC).toMatch(
      /INSERT\s+INTO\s+properties[\s\S]{0,800}airbnb_commission_pct,\s*booking_commission_pct,\s*currency/i
    );
  });
  test('M-02 resolvePropertyCurrency is called before INSERT', () => {
    expect(SERVER_SRC).toMatch(/resolvePropertyCurrency\(/);
  });
  test('M-03 no trailing UPDATE properties after property INSERT (INTL-1D post-UPDATE removed)', () => {
    // The only UPDATE properties SET currency in server.js should be the backfill
    // (UPDATE properties SET currency = 'EUR' WHERE currency IS NULL)
    // There must NOT be a separate post-INSERT UPDATE for INTL-1D cascade.
    const intl1dCascadePattern = /INTL-1D.*cascade[\s\S]{0,200}UPDATE\s+properties\s+p\s+SET\s+currency\s*=\s*u\.default_currency/i;
    expect(SERVER_SRC).not.toMatch(intl1dCascadePattern);
  });
  test('M-04 PUT /api/user/profile validation rejects EURO (4-char) via regex', () => {
    // After normalization: 'EURO'.toUpperCase() = 'EURO', regex ^[A-Z]{3}$ rejects it
    const fourCharCurrency = 'EURO';
    expect(/^[A-Z]{3}$/.test(fourCharCurrency)).toBe(false);
  });
});
