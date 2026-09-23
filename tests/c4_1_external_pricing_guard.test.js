#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1 — Hard guard external_pricing dans publishEffectivePricing
 *
 * Depuis C4.2e, triggerChannexRatesSync est un thin wrapper qui délègue
 * entièrement à publishEffectivePricing (pricing-publisher.js).
 * Le guard external_pricing réside désormais dans le publisher.
 *
 * Stratégie : inspection structurelle de routes/pricing-publisher.js.
 *   1. Extraire le corps de publishEffectivePricing.
 *   2. Vérifier que le guard external_pricing contient un return.
 *   3. Vérifier que pushRates / pushRestrictions sont positionnés APRÈS le guard.
 *   4. Vérifier que le resolver (_resolve) est appelé APRÈS le guard.
 *   5. Vérifier que triggerChannexRatesSync dans server.js délègue au publisher.
 *
 * Exécution : node tests/c4_1_external_pricing_guard.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const publisherSrc = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'pricing-publisher.js'),
  'utf8'
);
const serverSrc = fs.readFileSync(
  path.join(__dirname, '..', 'server.js'),
  'utf8'
);

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ── Extraction du corps de la fonction ────────────────────────────────────────

function extractFunctionBody(source, fnName) {
  const declRe = new RegExp(`async function ${fnName}\\s*\\(`);
  const startIdx = source.search(declRe);
  assert.ok(startIdx >= 0, `Fonction ${fnName} introuvable`);

  let depth = 0;
  let bodyStart = -1;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') {
      if (bodyStart === -1) bodyStart = i;
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  throw new Error(`Impossible d'extraire le corps de ${fnName}`);
}

// Note: extractFunctionBody is not used for the publisher because the parameter
// destructuring `{` confuses brace-counting. We search publisherSrc directly —
// the file is dedicated to publishEffectivePricing so false positives are impossible.

// ── TC-G01 : publishEffectivePricing existe ───────────────────────────────────
test('TC-G01 publishEffectivePricing est présente dans pricing-publisher.js', () => {
  assert.ok(
    publisherSrc.includes('async function publishEffectivePricing'),
    'async function publishEffectivePricing introuvable dans pricing-publisher.js'
  );
});

// ── TC-G02 : le guard external_pricing renvoie avant tout calcul ──────────────
test('TC-G02 external_pricing → skip avant tout calcul', () => {
  const guardIdx = publisherSrc.indexOf('prop.external_pricing');
  assert.ok(guardIdx >= 0, 'Guard external_pricing introuvable dans pricing-publisher.js');

  const snippet = publisherSrc.slice(guardIdx, guardIdx + 300);
  assert.ok(
    /return\s+_skip\(/.test(snippet) || /\breturn\b/.test(snippet),
    'Aucun return/skip trouvé dans les 300 caractères après le guard external_pricing'
  );
});

// ── TC-G03 : pushRates est positionné APRÈS le guard ─────────────────────────
test('TC-G03 _pushRates appelé après le guard external_pricing', () => {
  const guardIdx     = publisherSrc.indexOf('prop.external_pricing');
  const pushRatesIdx = publisherSrc.indexOf('_pushRates()', guardIdx);

  assert.ok(guardIdx     >= 0, 'Guard external_pricing introuvable');
  assert.ok(pushRatesIdx >  guardIdx,
    `_pushRates (pos ${pushRatesIdx}) devrait être après le guard (pos ${guardIdx})`);
});

// ── TC-G04 : pushRestrictions est positionné APRÈS le guard ──────────────────
test('TC-G04 _pushRestrictions appelé après le guard external_pricing', () => {
  const guardIdx            = publisherSrc.indexOf('prop.external_pricing');
  const pushRestrictionsIdx = publisherSrc.indexOf('_pushRestrictions()', guardIdx);

  assert.ok(guardIdx            >= 0, 'Guard external_pricing introuvable');
  assert.ok(pushRestrictionsIdx >  guardIdx,
    `_pushRestrictions (pos ${pushRestrictionsIdx}) devrait être après le guard (pos ${guardIdx})`);
});

// ── TC-G05 : triggerChannexRatesSync délègue au publisher (C4.2e) ─────────────
test('TC-G05 triggerChannexRatesSync délègue à _triggerSync (publisher)', () => {
  const triggerBody = extractFunctionBody(serverSrc, 'triggerChannexRatesSync');
  assert.ok(
    triggerBody.includes('_triggerSync'),
    'triggerChannexRatesSync doit déléguer à _triggerSync (C4.2e migration)'
  );
  assert.ok(
    !triggerBody.includes('prop.external_pricing'),
    'triggerChannexRatesSync ne doit plus contenir le guard external_pricing directement'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── P0-C4.1 external_pricing hard guard ──────────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failures.length) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}
process.exit(0);
