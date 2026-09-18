'use strict';

const assert = require('assert');
const path   = require('path');

const T          = require('../services/email/emailTokens');
const {
  escapeHtml,
  emailButton,
  emailCTABlock,
  emailCard,
  emailDivider,
  emailBookingSummary,
} = require('../services/email/emailComponents');
const bhEmailTemplate = require('../services/email/emailLayout');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ── emailTokens ──────────────────────────────────────────────────────────────

test('T.vert800 is the correct brand green', () => {
  assert.strictEqual(T.vert800, '#0E3B2E');
});

test('T.terra is the correct terracotta red', () => {
  assert.strictEqual(T.terra, '#B4470F');
});

// ── escapeHtml ───────────────────────────────────────────────────────────────

test('escapeHtml neutralises < > & " \'', () => {
  assert.strictEqual(escapeHtml('<b>it\'s "fine" & dandy</b>'), '&lt;b&gt;it&#39;s &quot;fine&quot; &amp; dandy&lt;/b&gt;');
});

test('escapeHtml returns empty string for null / undefined', () => {
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

test('escapeHtml coerces numbers to string', () => {
  assert.strictEqual(escapeHtml(42), '42');
});

// ── emailButton ──────────────────────────────────────────────────────────────

test('emailButton contains the href', () => {
  const html = emailButton('https://example.com/verify?t=abc', 'Confirm');
  assert.ok(html.includes('https://example.com/verify?t=abc'), 'href missing');
});

test('emailButton escapes the label', () => {
  const html = emailButton('https://x.com', '<script>');
  assert.ok(!html.includes('<script>'), 'unescaped label found');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped label missing');
});

test('emailButton uses custom color', () => {
  const html = emailButton('https://x.com', 'Click', { color: '#B4470F' });
  assert.ok(html.includes('#B4470F'), 'custom color missing');
});

// ── emailCard ────────────────────────────────────────────────────────────────

test('emailCard(info) uses vert800 border', () => {
  const html = emailCard('info', 'Hello');
  assert.ok(html.includes(T.vert800), 'vert800 border missing');
});

test('emailCard(danger) uses terra color', () => {
  const html = emailCard('danger', 'Error');
  assert.ok(html.includes(T.terra), 'terra color missing');
});

// ── bhEmailTemplate ──────────────────────────────────────────────────────────

test('bhEmailTemplate returns a full HTML document', () => {
  const html = bhEmailTemplate({ title: 'Test', bodyHtml: '<p>Body</p>' });
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'missing DOCTYPE');
  assert.ok(html.includes('</html>'), 'missing closing html tag');
});

test('bhEmailTemplate does NOT contain platform badges (Airbnb/BDC/Expedia)', () => {
  const html = bhEmailTemplate({ title: 'Test', bodyHtml: '' });
  assert.ok(!html.includes('FF5A5F'), 'Airbnb red found');
  assert.ok(!html.includes('003580'), 'Booking.com blue found');
  assert.ok(!html.includes('F5A623'), 'Expedia orange found');
});

test('bhEmailTemplate uses max-width:600px (not width="580")', () => {
  const html = bhEmailTemplate({ title: 'Test', bodyHtml: '' });
  assert.ok(!html.includes('width="580"'), 'width="580" HTML attribute found');
  assert.ok(html.includes('max-width:600px'), 'max-width:600px missing');
});

test('bhEmailTemplate header uses vert900 background', () => {
  const html = bhEmailTemplate({ title: 'Test', bodyHtml: '' });
  assert.ok(html.includes(T.vert900), 'vert900 header bg missing');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Email Design System Tests ===');
// tests run above; summary at end
console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
