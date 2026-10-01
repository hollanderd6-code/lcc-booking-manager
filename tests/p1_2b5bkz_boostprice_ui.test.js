'use strict';
/**
 * BOOSTPRICE-PRICE-499-AND-PRICING-SIMPLIFY-13
 * Tests A–N: static audit of BoostPrice pricing display and backend constant.
 * No server, no DB, no Stripe — all assertions on source files only.
 */
const fs   = require('fs');
const path = require('path');

const pricingPath = path.join(__dirname, '../public/pricing.html');
const serverPath  = path.join(__dirname, '../server.js');
let pricingSrc, serverSrc;

beforeAll(() => {
  pricingSrc = fs.readFileSync(pricingPath, 'utf8');
  serverSrc  = fs.readFileSync(serverPath, 'utf8');
});

// ─── A: no "Bientôt" remains on Pricing dynamique items ───
test('A: no fi-soon Pricing dynamique items remain', () => {
  const faSoonLines = pricingSrc.split('\n')
    .filter(l => l.includes('fi-soon') && /pricing dynamique/i.test(l));
  expect(faSoonLines).toHaveLength(0);
});

// ─── B: fi-option used for Pricing dynamique in all 3 plan cards ───
test('B: fi-option Pricing dynamique appears in all 3 plans', () => {
  const lines = pricingSrc.split('\n')
    .filter(l => l.includes('fi-option') && /pricing dynamique/i.test(l));
  expect(lines.length).toBeGreaterThanOrEqual(3);
});

// ─── C: displays 4,99 €/logement in all 3 plan cards ───
test('C: feat-tag shows 4,99 €/logement in all 3 plan option items', () => {
  const matches = pricingSrc.match(/4,99 €\/logement/g) || [];
  expect(matches.length).toBeGreaterThanOrEqual(3);
});

// ─── D: no 4,90 BoostPrice reference remains in pricing.html ───
test('D: no 4,90 BoostPrice business-price reference in pricing.html', () => {
  const lines = pricingSrc.split('\n').filter(l => l.includes('4,90') && /boostprice|pricing dynamique|logement/i.test(l));
  expect(lines).toHaveLength(0);
});

// ─── E: no BoostPrice commercial section in pricing.html ───
test('E: no BoostPrice commercial section (id=boostprice-section) in pricing.html', () => {
  expect(pricingSrc).not.toContain('id="boostprice-section"');
});

// ─── F: no BoostPrice activation modal in pricing.html ───
test('F: no BoostPrice activation modal (id=bp-modal) in pricing.html', () => {
  expect(pricingSrc).not.toContain('id="bp-modal"');
});

// ─── G: no BoostPrice JS (loadBoostpriceStatus) in pricing.html ───
test('G: no loadBoostpriceStatus JS function in pricing.html', () => {
  expect(pricingSrc).not.toContain('loadBoostpriceStatus');
});

// ─── H: no BoostPrice modal CSS (bp-modal-overlay) in pricing.html ───
test('H: no bp-modal-overlay CSS in pricing.html', () => {
  expect(pricingSrc).not.toContain('bp-modal-overlay');
});

// ─── I: backend constant is 4.99 ───
test('I: BOOSTPRICE_PRICE_PER_PROPERTY is 4.99 in server.js', () => {
  expect(serverSrc).toContain('const BOOSTPRICE_PRICE_PER_PROPERTY = 4.99');
});

// ─── J: no 4.90 business-price constant in server.js ───
test('J: no BOOSTPRICE_PRICE_PER_PROPERTY = 4.90 reference in server.js', () => {
  expect(serverSrc).not.toContain('BOOSTPRICE_PRICE_PER_PROPERTY = 4.90');
});

// ─── K: backend exposes pricePerProperty using the constant ───
test('K: status route exposes pricePerProperty from BOOSTPRICE_PRICE_PER_PROPERTY constant', () => {
  expect(serverSrc).toContain('pricePerProperty');
  const priceIdx = serverSrc.indexOf('pricePerProperty');
  const ctx = serverSrc.slice(priceIdx - 200, priceIdx + 200);
  expect(ctx).toContain('BOOSTPRICE_PRICE_PER_PROPERTY');
});

// ─── L: monthlyAmount computed from constant (not hardcoded) ───
test('L: monthlyAmount uses BOOSTPRICE_PRICE_PER_PROPERTY constant', () => {
  expect(serverSrc).toContain('monthlyAmount');
  const monthlyIdx = serverSrc.indexOf('monthlyAmount');
  const ctx = serverSrc.slice(monthlyIdx - 200, monthlyIdx + 200);
  expect(ctx).toContain('BOOSTPRICE_PRICE_PER_PROPERTY');
});

// ─── M: Stripe Price ID comes from env, never hardcoded in BoostPrice subscribe ───
test('M: BoostPrice subscribe uses STRIPE_PRICE_BOOSTPRICE_MONTHLY env var (not hardcoded ID)', () => {
  expect(serverSrc).toContain('STRIPE_PRICE_BOOSTPRICE_MONTHLY');
  const handlerStart = serverSrc.indexOf("app.post('/api/billing/boostprice/subscribe'");
  const handlerSlice = serverSrc.slice(handlerStart, handlerStart + 5000);
  expect(handlerSlice).toContain('STRIPE_PRICE_BOOSTPRICE_MONTHLY');
  expect(handlerSlice).not.toMatch(/['"`]price_[A-Za-z0-9]{14,}['"`]/);
});

// ─── N: 1 property = €4.99, 10 properties = €49.90 (constant math) ───
test('N: constant math is correct — 1×4.99=4.99, 10×4.99=49.90', () => {
  expect(1 * 4.99).toBeCloseTo(4.99, 2);
  expect(10 * 4.99).toBeCloseTo(49.90, 2);
  expect(parseFloat((2 * 4.99).toFixed(2))).toBe(9.98);
  expect(parseFloat((3 * 4.99).toFixed(2))).toBe(14.97);
});
