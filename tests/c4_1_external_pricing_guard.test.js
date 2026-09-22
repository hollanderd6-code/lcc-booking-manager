#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1 — Hard guard external_pricing dans triggerChannexRatesSync
 *
 * triggerChannexRatesSync est une fonction interne de server.js (non exportée).
 * Require('server.js') démarrerait le serveur réel (DB, crons, listen) → hors scope
 * d'un test unitaire sans refactoring de server.js.
 *
 * Stratégie : inspection structurelle du source.
 *   1. Extraire le corps de triggerChannexRatesSync.
 *   2. Vérifier que la branche external_pricing contient un return.
 *   3. Vérifier que ce return précède les appels pushRates et pushRestrictions.
 *
 * Exécution : node tests/c4_1_external_pricing_guard.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const src = fs.readFileSync(
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

// Localise la déclaration de la fonction puis extrait jusqu'à sa fermeture
// (première accolade fermante au même niveau d'imbrication que l'ouverture de la fonction).
function extractFunctionBody(source, fnName) {
  const declRe = new RegExp(`async function ${fnName}\\s*\\(`);
  const startIdx = source.search(declRe);
  assert.ok(startIdx >= 0, `Fonction ${fnName} introuvable dans server.js`);

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

const fnBody = extractFunctionBody(src, 'triggerChannexRatesSync');

// ── TC-G01 : la fonction existe et est bien trouvée ───────────────────────────
test('TC-G01 triggerChannexRatesSync est présente dans server.js', () => {
  assert.ok(fnBody.length > 200, 'Corps trop court — extraction incorrecte');
});

// ── TC-G02 : le bloc external_pricing contient un return ─────────────────────
test('TC-G02 external_pricing → return dans le corps de la fonction', () => {
  // Localise le guard puis cherche un 'return;' dans les 5 lignes qui suivent.
  const guardIdx = fnBody.indexOf('if (prop.external_pricing)');
  assert.ok(guardIdx >= 0, 'Guard if (prop.external_pricing) introuvable');

  // Extrait les 400 caractères suivant le guard (couvre largement le bloc + return)
  const snippet = fnBody.slice(guardIdx, guardIdx + 400);
  assert.ok(
    /\breturn\s*;/.test(snippet),
    'Aucun return trouvé dans les 400 caractères après if (prop.external_pricing)'
  );
});

// ── TC-G03 : pushRates apparaît APRÈS le garde external_pricing ───────────────
test('TC-G03 pushRates est positionné après le guard external_pricing', () => {
  const guardIdx     = fnBody.indexOf('if (prop.external_pricing)');
  const returnIdx    = fnBody.indexOf('return;', guardIdx);
  const pushRatesIdx = fnBody.indexOf('pushRates(', returnIdx);

  assert.ok(guardIdx     >= 0, 'Guard external_pricing introuvable');
  assert.ok(returnIdx    >  guardIdx, 'return introuvable après le guard');
  assert.ok(pushRatesIdx >  returnIdx,
    `pushRates (pos ${pushRatesIdx}) devrait être après le return du guard (pos ${returnIdx})`);
});

// ── TC-G04 : pushRestrictions apparaît APRÈS le garde ────────────────────────
test('TC-G04 pushRestrictions est positionné après le guard external_pricing', () => {
  const guardIdx          = fnBody.indexOf('if (prop.external_pricing)');
  const returnIdx         = fnBody.indexOf('return;', guardIdx);
  const pushRestrictionsIdx = fnBody.indexOf('pushRestrictions(', returnIdx);

  assert.ok(guardIdx            >= 0, 'Guard external_pricing introuvable');
  assert.ok(returnIdx           >  guardIdx,  'return introuvable après le guard');
  assert.ok(pushRestrictionsIdx >  returnIdx,
    `pushRestrictions (pos ${pushRestrictionsIdx}) devrait être après le return du guard (pos ${returnIdx})`);
});

// ── TC-G05 : le guard précède le calcul 500 jours (pas seulement avant pushRates) ──
test('TC-G05 le guard précède la boucle de calcul des 500 nuits', () => {
  const guardIdx = fnBody.indexOf('if (prop.external_pricing)');
  const loopIdx  = fnBody.indexOf('for (let i = 0; i < 500; i++)');

  assert.ok(guardIdx >= 0, 'Guard introuvable');
  assert.ok(loopIdx  >= 0, 'Boucle 500 nuits introuvable');
  // Le guard doit être AVANT la boucle (early return évite les calculs inutiles).
  assert.ok(guardIdx < loopIdx,
    `Guard (pos ${guardIdx}) devrait précéder la boucle de calcul (pos ${loopIdx})`);
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
