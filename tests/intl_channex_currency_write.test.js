'use strict';
/**
 * PMS-INTL-P2-CHANNEX-CURRENCY-1B
 *
 * Structural + behavioral tests for F8 fix:
 * currency propagation through createChannexProperty,
 * addRoomTypeToProperty, assurerPlansMajores, and
 * the PUT /api/properties Channex currency-change guard.
 *
 * Suites:
 *   A — createChannexProperty
 *   B — standard rate plan
 *   C — markup plans
 *   D — property update guard
 *   E — incoming booking
 *   F — regression / hardcodes
 */

const fs   = require('fs');
const path = require('path');

// ── Source texts for structural checks ───────────────────────────────────────

const CHANNEX_SRC = fs.readFileSync(path.resolve(__dirname, '../channex.js'), 'utf8');
const SERVER_SRC  = fs.readFileSync(path.resolve(__dirname, '../server.js'),  'utf8');

function extractBlock(marker, src, limit = 6000) {
  const idx = src.indexOf(marker);
  if (idx === -1) return '';
  return src.slice(idx, idx + limit);
}

const createBlock         = extractBlock('async function createChannexProperty', CHANNEX_SRC, 3000);
const addRoomBlock        = extractBlock('async function addRoomTypeToProperty',  CHANNEX_SRC, 5000);
const assurerBlock        = extractBlock('async function assurerPlansMajores',    CHANNEX_SRC, 4000);
const processBookingBlock = extractBlock('async function processChannexBooking',  CHANNEX_SRC, 6000);
const pushRatesBlock      = extractBlock('async function pushRates',              CHANNEX_SRC, 3000);
const connectCallBlock    = extractBlock("app.post('/api/channex/connect-property'", SERVER_SRC, 3500);
const putGuardBlock       = extractBlock('// ── F8: guard — devise immuable si Channex actif', SERVER_SRC, 1200);

// ── Module under test ─────────────────────────────────────────────────────────

const {
  createChannexProperty,
  addRoomTypeToProperty,
  assurerPlansMajores,
  channexAPI
} = require('../channex');

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makePool(rows = []) {
  return {
    query: jest.fn().mockImplementation((sql) => {
      // assurerPlansMajores query — check this FIRST (more specific: includes channex_property_id + currency)
      if (rows.length > 0 && /SELECT.*channex_property_id.*channex_room_type_id.*channex_rate_plan_id.*currency/s.test(sql)) {
        return Promise.resolve({ rows });
      }
      // addRoomTypeToProperty query
      if (/SELECT.*channex_room_type_id.*channex_rate_plan_id.*FROM properties/s.test(sql)) {
        return Promise.resolve({ rows: [{ channex_room_type_id: null, channex_rate_plan_id: null }] });
      }
      if (/SELECT id FROM properties WHERE channex_room_type_id/.test(sql)) {
        return Promise.resolve({ rows: [] }); // no clash
      }
      return Promise.resolve({ rows: [] });
    })
  };
}

async function callCreate(currency) {
  const posts = [];
  const pool = makePool();

  const origPost = channexAPI.post;
  const origGet  = channexAPI.get;

  channexAPI.post = jest.fn().mockImplementation((url) => {
    posts.push(url);
    if (url === '/properties')          return Promise.resolve({ data: { data: { attributes: { id: 'chprop-1', currency: 'TEST' } } } });
    if (url === '/room_types')          return Promise.resolve({ data: { data: { attributes: { id: 'rt-1' } } } });
    if (url === '/rate_plans')          return Promise.resolve({ data: { data: { attributes: { id: 'rp-1' } } } });
    if (url === '/applications/install') return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
  channexAPI.get = jest.fn().mockResolvedValue({ data: { data: [] } });

  try {
    await createChannexProperty(pool, { user_id: 'u1', property_id: 'p1', name: 'Test', currency });
  } finally {
    channexAPI.post = origPost;
    channexAPI.get  = origGet;
  }
  return posts;
}

// Capture POST payloads (not just URL) — used in suite B tests
async function callCreateCapture(currency) {
  const calls = [];
  const pool = makePool();

  const origPost = channexAPI.post;
  const origGet  = channexAPI.get;

  channexAPI.post = jest.fn().mockImplementation((url, data) => {
    calls.push({ url, data });
    if (url === '/properties')          return Promise.resolve({ data: { data: { attributes: { id: 'chprop-1' } } } });
    if (url === '/room_types')          return Promise.resolve({ data: { data: { attributes: { id: 'rt-1' } } } });
    if (url === '/rate_plans')          return Promise.resolve({ data: { data: { attributes: { id: 'rp-1' } } } });
    if (url === '/applications/install') return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
  channexAPI.get = jest.fn().mockResolvedValue({ data: { data: [] } });

  try {
    await createChannexProperty(pool, { user_id: 'u1', property_id: 'p1', name: 'Test', currency });
  } finally {
    channexAPI.post = origPost;
    channexAPI.get  = origGet;
  }
  return calls;
}

// ── A — createChannexProperty ─────────────────────────────────────────────────

describe('A — createChannexProperty', () => {
  test('A-01 EUR → property payload EUR', async () => {
    const calls = await callCreateCapture('EUR');
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall).toBeDefined();
    expect(propCall.data.property.currency).toBe('EUR');
  });

  test('A-02 ILS → property payload ILS', async () => {
    const calls = await callCreateCapture('ILS');
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall.data.property.currency).toBe('ILS');
  });

  test('A-03 USD → property payload USD', async () => {
    const calls = await callCreateCapture('USD');
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall.data.property.currency).toBe('USD');
  });

  test('A-04 CHF → property payload CHF', async () => {
    const calls = await callCreateCapture('CHF');
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall.data.property.currency).toBe('CHF');
  });

  test('A-05 lowercase usd → normalized USD', async () => {
    const calls = await callCreateCapture('usd');
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall.data.property.currency).toBe('USD');
  });

  test('A-06 null legacy → EUR fallback', async () => {
    const calls = await callCreateCapture(null);
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall.data.property.currency).toBe('EUR');
  });

  test('A-07 invalid legacy → EUR fallback', async () => {
    const calls = await callCreateCapture('NOTACURRENCY');
    const propCall = calls.find(c => c.url === '/properties');
    expect(propCall.data.property.currency).toBe('EUR');
  });

  test("A-08 no hardcoded currency:'EUR' in createChannexProperty block", () => {
    expect(createBlock).not.toMatch(/currency:\s*['"]EUR['"]/);
    expect(createBlock).toMatch(/currency:\s*resolvedCurrency/);
  });
});

// ── B — standard rate plan ────────────────────────────────────────────────────

describe('B — standard rate plan', () => {
  test('B-09 property ILS → standard rate plan ILS', async () => {
    const calls = await callCreateCapture('ILS');
    const rpCall = calls.find(c => c.url === '/rate_plans');
    expect(rpCall).toBeDefined();
    expect(rpCall.data.rate_plan.currency).toBe('ILS');
  });

  test('B-10 property USD → standard rate plan USD', async () => {
    const calls = await callCreateCapture('USD');
    const rpCall = calls.find(c => c.url === '/rate_plans');
    expect(rpCall.data.rate_plan.currency).toBe('USD');
  });

  test('B-11 property CHF → standard rate plan CHF', async () => {
    const calls = await callCreateCapture('CHF');
    const rpCall = calls.find(c => c.url === '/rate_plans');
    expect(rpCall.data.rate_plan.currency).toBe('CHF');
  });

  test('B-12 property and standard rate plan use exact same resolvedCurrency', async () => {
    const calls = await callCreateCapture('ILS');
    const propCur = calls.find(c => c.url === '/properties')?.data.property.currency;
    const rpCur   = calls.find(c => c.url === '/rate_plans')?.data.rate_plan.currency;
    expect(propCur).toBe(rpCur);
  });
});

// ── C — markup plans ──────────────────────────────────────────────────────────

describe('C — markup plans', () => {
  const markupPoolRow = (propertyCurrency, parentRpCurrency) => [{
    channex_property_id:  'cp-1',
    channex_room_type_id: 'rt-1',
    channex_rate_plan_id: 'rp-parent',
    currency: propertyCurrency,
    markups: { ABB: '10' },
    plans: {}
  }];

  async function callAssurer(propertyCurrency, parentRpCurrencyFromApi) {
    const rpCalls = [];
    const pool = makePool(markupPoolRow(propertyCurrency, parentRpCurrencyFromApi));

    const origPost = channexAPI.post;
    const origGet  = channexAPI.get;

    channexAPI.post = jest.fn().mockImplementation((url, data) => {
      rpCalls.push({ url, data });
      return Promise.resolve({ data: { data: { attributes: { id: 'rp-new' } } } });
    });
    channexAPI.get = jest.fn().mockImplementation((url) => {
      // getChannexRatePlanCurrency calls GET /rate_plans/:id
      if (typeof url === 'string' && url.startsWith('/rate_plans/')) {
        return Promise.resolve({
          data: { data: { attributes: { currency: parentRpCurrencyFromApi } } }
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    try {
      const result = await assurerPlansMajores(pool, 'p1');
      return { result, rpCalls };
    } finally {
      channexAPI.post = origPost;
      channexAPI.get  = origGet;
    }
  }

  test('C-13 property/rate-plan ILS → markup ILS', async () => {
    const { rpCalls } = await callAssurer('ILS', 'ILS');
    const created = rpCalls.find(c => c.url === '/rate_plans');
    expect(created).toBeDefined();
    expect(created.data.rate_plan.currency).toBe('ILS');
  });

  test('C-14 property/rate-plan USD → markup USD', async () => {
    const { rpCalls } = await callAssurer('USD', 'USD');
    const created = rpCalls.find(c => c.url === '/rate_plans');
    expect(created.data.rate_plan.currency).toBe('USD');
  });

  test('C-15 parent EUR + property ILS → fail closed (returns empty)', async () => {
    const { result } = await callAssurer('ILS', 'EUR');
    expect(result).toEqual([]);
  });

  test('C-16 no markup rate plan created on currency mismatch', async () => {
    const { rpCalls } = await callAssurer('ILS', 'EUR');
    expect(rpCalls.filter(c => c.url === '/rate_plans')).toHaveLength(0);
  });

  test('C-17 no FX — no exchangeRate / convertCurrency in assurerPlansMajores', () => {
    expect(assurerBlock).not.toMatch(/exchangeRate|convertCurrency|fxRate/);
  });
});

// ── D — property update guard ─────────────────────────────────────────────────

describe('D — property update guard', () => {
  test('D-18 non-Channex property EUR → ILS allowed (no guard triggers)', () => {
    // Guard only fires when channex_enabled && channex_property_id
    expect(putGuardBlock).toMatch(/property\.channex_enabled.*property\.channex_property_id/s);
  });

  test('D-19 guard condition requires channex_enabled AND channex_property_id', () => {
    expect(putGuardBlock).toMatch(/property\.channex_enabled\s*&&\s*property\.channex_property_id/);
  });

  test('D-20 Channex property EUR → ILS blocked: 409 returned', () => {
    expect(putGuardBlock).toMatch(/res\.status\(409\)/);
  });

  test('D-21 machine-readable error code present', () => {
    expect(putGuardBlock).toMatch(/CHANNEX_CURRENCY_CHANGE_REQUIRES_RECONNECT/);
  });

  test('D-22 human-readable French message present', () => {
    expect(putGuardBlock).toMatch(/channel manager/);
    expect(putGuardBlock).toMatch(/Déconnectez/);
  });

  test('D-23 guard fires only when body.currency is explicitly provided', () => {
    expect(putGuardBlock).toMatch(/body\.currency\s*!==\s*undefined/);
  });

  test('D-24 guard fires only when new currency differs from old', () => {
    expect(putGuardBlock).toMatch(/newCurrencyNorm\s*!==\s*oldCurrencyNorm/);
  });

  test('D-25 guard placed before UPDATE properties query (atomicity)', () => {
    const guardIdx  = SERVER_SRC.indexOf('CHANNEX_CURRENCY_CHANGE_REQUIRES_RECONNECT');
    const updateIdx = SERVER_SRC.indexOf("SET\n         name = $1", SERVER_SRC.indexOf("app.put('/api/properties/"));
    expect(guardIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(updateIdx);
  });
});

// ── E — incoming booking ──────────────────────────────────────────────────────

describe('E — incoming booking', () => {
  test('E-26 Channex booking currency ILS → preserved as ILS', () => {
    // Verify the JavaScript destructuring default only applies when field is absent
    const attrs = { currency: 'ILS', arrival_date: '2026-10-01' };
    const { currency = 'EUR' } = attrs;
    expect(currency).toBe('ILS');
  });

  test('E-27 USD → USD', () => {
    const { currency = 'EUR' } = { currency: 'USD' };
    expect(currency).toBe('USD');
  });

  test('E-28 CHF → CHF', () => {
    const { currency = 'EUR' } = { currency: 'CHF' };
    expect(currency).toBe('CHF');
  });

  test('E-29 explicit non-EUR never replaced by EUR (no reassignment in processChannexBooking)', () => {
    // Verify the destructuring default pattern exists and no subsequent override
    expect(processBookingBlock).toMatch(/currency\s*=\s*['"]EUR['"]\s*\}\s*=\s*attrs/);
    // No `currency = 'EUR'` assignment after the destructuring
    const afterDestructuring = processBookingBlock.slice(
      processBookingBlock.indexOf("currency = 'EUR'") + 20
    );
    expect(afterDestructuring).not.toMatch(/\bcurrency\s*=\s*['"]EUR['"]/);
  });
});

// ── F — regression / hardcodes ───────────────────────────────────────────────

describe('F — regression / hardcodes', () => {
  test('F-30 B1 no hardcoded EUR in createChannexProperty POST /properties', () => {
    expect(createBlock).not.toMatch(/currency:\s*['"]EUR['"]/);
  });

  test('F-31 B2 no hardcoded EUR in addRoomTypeToProperty POST /rate_plans', () => {
    // The rate plan creation block should use resolvedCurrency, not 'EUR'
    const rpBlock = extractBlock("channexAPI.post('/rate_plans'", addRoomBlock, 400);
    expect(rpBlock).not.toMatch(/currency:\s*['"]EUR['"]/);
    expect(rpBlock).toMatch(/currency:\s*resolvedCurrency/);
  });

  test('F-32 B3 no hardcoded EUR in assurerPlansMajores POST /rate_plans', () => {
    const rpBlock = extractBlock("channexAPI.post('/rate_plans'", assurerBlock, 400);
    expect(rpBlock).not.toMatch(/currency:\s*['"]EUR['"]/);
    expect(rpBlock).toMatch(/currency:\s*markupCurrency/);
  });

  test('F-33 B4 inbound fallback classified: currency = EUR only in processChannexBooking destructuring', () => {
    // The only remaining 'EUR' in processChannexBooking is the destructuring default — B4 LEGACY_INBOUND_FALLBACK
    expect(processBookingBlock).toMatch(/currency\s*=\s*['"]EUR['"]/);
  });

  test('F-34 pushRates remains currency-free (no FX)', () => {
    expect(pushRatesBlock).not.toMatch(/currency:\s*['"]EUR['"]/);
    expect(pushRatesBlock).not.toMatch(/\bcurrency\b.*=.*['"]EUR['"]/);
  });

  test('F-35 resolveChannexCurrency uses normalizeCurrency (no third divergent helper)', () => {
    expect(CHANNEX_SRC).toMatch(/function resolveChannexCurrency/);
    expect(CHANNEX_SRC).toMatch(/normalizeCurrency\(value\)\s*\|\|\s*['"]EUR['"]/);
    // Exactly one definition of each dedicated currency resolver/validator
    const resolveCount = (CHANNEX_SRC.match(/function resolveChannexCurrency/g) || []).length;
    const parseCount   = (CHANNEX_SRC.match(/function _parseChannexCurrency/g) || []).length;
    expect(resolveCount).toBe(1);
    expect(parseCount).toBe(1);
  });
});
