#!/usr/bin/env node
'use strict';
/**
 * Tests for eval set builder v1.3
 * Covers: classifier, language detection, dataset invariants, pipeline constraints.
 * Run: node tests/eval_set_builder.test.js
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const { classifyMessage, detectLanguage } = require('../scripts/build-eval-set.js');

let pass = 0; let fail = 0;
function t(label, fn) {
  try {
    fn();
    pass++;
    process.stdout.write(`  ✅ ${label}\n`);
  } catch (e) {
    fail++;
    process.stdout.write(`  ❌ ${label}: ${e.message}\n`);
  }
}

// ─── Classifier tests ─────────────────────────────────────────────────────────

console.log('\n── Classifier ───────────────────────────────────────────────────────────');

t('EMERGENCY: bloqué devant porte',    () => assert.strictEqual(classifyMessage('Je suis bloqué devant la porte'), 'EMERGENCY'));
t('EMERGENCY: porte ne s\'ouvre pas',  () => assert.strictEqual(classifyMessage("La porte ne s'ouvre pas"), 'EMERGENCY'));
t('EMERGENCY: locked out EN',           () => assert.strictEqual(classifyMessage('I am locked out of the apartment'), 'EMERGENCY'));
t('EMERGENCY: fuite d\'eau',            () => assert.strictEqual(classifyMessage("Il y a une fuite d'eau dans la salle de bain"), 'EMERGENCY'));
t('NOT EMERGENCY: caution débloquée',   () => assert.strictEqual(classifyMessage('Quand la caution de 300 € sera-t-elle débloquée ?'), 'PAYMENT'));
t('NOT EMERGENCY: même immeuble',       () => assert.strictEqual(classifyMessage('Le logement est dans le même immeuble, à quel étage ?'), 'PRACTICAL'));

t('DISPUTE: annuler FR',                () => assert.strictEqual(classifyMessage('Je souhaite annuler ma réservation'), 'DISPUTE'));
t('DISPUTE: pas indiqué + déçu',        () => assert.strictEqual(classifyMessage("Ce n'était pas indiqué dans l'annonce, je suis déçu"), 'DISPUTE'));
t('DISPUTE: cancelacion ES',            () => assert.strictEqual(classifyMessage('Cancelacion del alojamiento, no indicaron las condiciones'), 'DISPUTE'));

// A) PAYMENT conjugated stem — "remboursés"
t('PAYMENT: rembourses (stem)',         () => assert.strictEqual(classifyMessage("Bonjour, merci pour votre réponse, mais je voudrais savoir quand les 300 euros seront remboursés s'il vous plaît."), 'PAYMENT'));
t('PAYMENT: facture',                   () => assert.strictEqual(classifyMessage("Pouvez-vous m'envoyer une facture ?"), 'PAYMENT'));
t('PAYMENT: caution quand',             () => assert.strictEqual(classifyMessage('Quand récupère-t-on la caution ?'), 'PAYMENT'));
t('PAYMENT: deposit EN',                () => assert.strictEqual(classifyMessage('When will my deposit be returned?'), 'PAYMENT'));

t('ACCESS: code de la porte',           () => assert.strictEqual(classifyMessage('Quel est le code de la porte ?'), 'ACCESS'));
t('ACCESS: boîte aux clés',             () => assert.strictEqual(classifyMessage('Où est la boîte aux clés ?'), 'ACCESS'));
t('ACCESS: comment entrer',             () => assert.strictEqual(classifyMessage("Comment faire pour entrer dans le logement ?"), 'ACCESS'));

t('TIMING: arriver plus tôt',           () => assert.strictEqual(classifyMessage('Puis-je arriver plus tôt que prévu ?'), 'TIMING'));
t('TIMING: what time EN',               () => assert.strictEqual(classifyMessage('What time is check in?'), 'TIMING'));
t('TIMING: heure arrivée',              () => assert.strictEqual(classifyMessage("Bonjour, à quelle heure est l'arrivée ?"), 'TIMING'));
// C) TIMING with "22h30" time notation
t('TIMING: arriver avant 22h30',        () => assert.strictEqual(classifyMessage("Je devrais arriver avant 22h30, je vous préviens en cas de problème. Bonne soirée"), 'TIMING'));

t('EQUIPMENT: covers pillows EN',       () => assert.strictEqual(classifyMessage('Are covers pillows and towels provided?'), 'EQUIPMENT'));
t('EQUIPMENT: machine à laver',         () => assert.strictEqual(classifyMessage('Y a-t-il une machine à laver ?'), 'EQUIPMENT'));
t('EQUIPMENT: draps',                   () => assert.strictEqual(classifyMessage('Est-ce que les draps sont fournis ?'), 'EQUIPMENT'));
t('EQUIPMENT: sèche-cheveux',           () => assert.strictEqual(classifyMessage('Y a-t-il un sèche-cheveux ?'), 'EQUIPMENT'));

t('RULES: visite amie (confirm first)', () => assert.strictEqual(classifyMessage('Je voudrais confirmer la visite de cette amie ce soir'), 'RULES'));
t('RULES: animaux de compagnie',        () => assert.strictEqual(classifyMessage('Les animaux de compagnie sont-ils autorisés ?'), 'RULES'));
t('RULES: fumer',                       () => assert.strictEqual(classifyMessage('Est-il possible de fumer sur le balcon ?'), 'RULES'));
// B) "bonne soirée" in farewell must NOT trigger RULES
t('NOT RULES: bonne soirée in thanks',  () => assert.strictEqual(classifyMessage("Thank you so much for your understanding and your kind words. I really appreciate it. Merci et bonne soirée!"), 'SIMPLE'));
t('NOT RULES: invitation dans merci',   () => assert.strictEqual(classifyMessage('Merci pour votre invitation, nous étions très bien reçus'), 'SIMPLE'));

t('PRACTICAL: parking',                 () => assert.strictEqual(classifyMessage('Où puis-je me garer à proximité ?'), 'PRACTICAL'));
t('PRACTICAL: adresse exacte',          () => assert.strictEqual(classifyMessage("Quelle est l'adresse exacte de l'appartement ?"), 'PRACTICAL'));
t('PRACTICAL: wifi',                    () => assert.strictEqual(classifyMessage('Quel est le mot de passe wifi ?'), 'PRACTICAL'));

t('AMBIGUOUS: ça marche toujours pas',  () => assert.strictEqual(classifyMessage('Ça ne marche toujours pas'), 'AMBIGUOUS'));
t('AMBIGUOUS: des nouvelles',           () => assert.strictEqual(classifyMessage('Vous avez des nouvelles de ma demande ?'), 'AMBIGUOUS'));
t('AMBIGUOUS: comme convenu',           () => assert.strictEqual(classifyMessage('Comme convenu, nous arrivons à 15h'), 'AMBIGUOUS'));

t('SIMPLE: merci beaucoup',             () => assert.strictEqual(classifyMessage('Merci beaucoup, tout était parfait !'), 'SIMPLE'));
t('SIMPLE: bonsoir',                    () => assert.strictEqual(classifyMessage('Bonsoir, bonne nuit'), 'SIMPLE'));

// ─── Language tests ───────────────────────────────────────────────────────────

console.log('\n── Language ─────────────────────────────────────────────────────────────');

t('FR: heure d\'arrivée (short)',        () => assert.strictEqual(detectLanguage(null, "heure d'arrivée ?"), 'FR'));
t('FR: code d\'accès appartement',       () => assert.strictEqual(detectLanguage(null, "Le code d'accès de l'appartement"), 'FR'));
t('FR: avant 22h30',                     () => assert.strictEqual(detectLanguage(null, "Je devrais arriver avant 22h30, est-ce possible ?"), 'FR'));
t('FR: envoyer facture',                 () => assert.strictEqual(detectLanguage(null, "Envoyer facture s'il vous plaît"), 'FR'));
t('ES: cancelacion alojamiento',         () => assert.strictEqual(detectLanguage(null, 'Cancelacion del alojamiento'), 'ES'));
t('EN: Where is the key box',            () => assert.strictEqual(detectLanguage(null, 'Where is the key box?'), 'EN'));
t('EN: We need Blanket',                 () => assert.strictEqual(detectLanguage(null, 'We need Blanket'), 'EN'));
t('PT: obrigado pela resposta',          () => assert.strictEqual(detectLanguage(null, 'Obrigado pela resposta, a chegada está confirmada'), 'PT'));
t('OTHER: Buongiorno (Italian)',         () => assert.strictEqual(detectLanguage(null, 'Buongiorno, io dovrei arrivare nel pomeriggio'), 'OTHER'));
t('FR: stored=fr overrides',             () => assert.strictEqual(detectLanguage('fr', 'Hello where is key'), 'FR'));
t('EN: stored=en overrides',             () => assert.strictEqual(detectLanguage('en', 'Bonjour merci pour le code'), 'EN'));

// ─── Dataset invariants (if JSON exists) ──────────────────────────────────────

console.log('\n── Dataset invariants ───────────────────────────────────────────────────');

const datasetPath = path.join(__dirname, '..', 'benchmarks', 'traveler-v2-eval-set.json');

if (!fs.existsSync(datasetPath)) {
  console.log('  ⏭  Dataset not yet generated — skipping invariant checks');
} else {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const cases   = dataset.cases;

  t('total_cases = 40',                  () => assert.strictEqual(cases.length, 40));
  t('dev_count = 25',                    () => assert.strictEqual(cases.filter(c => c.split === 'DEV').length, 25));
  t('holdout_count = 15',                () => assert.strictEqual(cases.filter(c => c.split === 'HOLDOUT').length, 15));
  t('sum of all categories = 40',        () => assert.strictEqual(cases.length, 40));
  t('message_id unique',                 () => {
    const ids = cases.map(c => c.message_id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate message_id');
  });
  t('conversation_id unique',            () => {
    const ids = cases.map(c => c.conversation_id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate conversation_id');
  });
  t('no golden IDs',                     () => {
    const GOLDEN = [3139, 8786, 6072, 2592, 3749, 6913];
    const ids    = cases.map(c => c.message_id);
    assert.ok(!GOLDEN.some(id => ids.includes(id)), 'golden ID found');
  });
  t('no regression IDs',                 () => {
    const REGRESSION = [4626, 9410, 7297, 3259];
    const ids         = cases.map(c => c.message_id);
    assert.ok(!REGRESSION.some(id => ids.includes(id)), 'regression ID found');
  });
  t('all splits DEV or HOLDOUT',         () => assert.ok(cases.every(c => c.split === 'DEV' || c.split === 'HOLDOUT')));
  t('all categories known',              () => {
    const VALID = new Set(['EMERGENCY','DISPUTE','PAYMENT','ACCESS','TIMING',
                           'EQUIPMENT','RULES','PRACTICAL','AMBIGUOUS','SIMPLE']);
    assert.ok(cases.every(c => VALID.has(c.category)), 'unknown category found');
  });
  t('no random at runtime in method',    () => {
    assert.ok(dataset.selection_method.includes('no random at runtime'), 'selection_method should say "no random at runtime"');
  });
  t('fingerprint is sha256 hex',         () => assert.match(dataset.dataset_fingerprint, /^[0-9a-f]{64}$/));
  t('version is 1.x',                    () => assert.match(dataset.version, /^1\./));
  t('max property count ≤ 6',            () => {
    const propCounts = {};
    for (const c of cases) propCounts[c.property_id] = (propCounts[c.property_id] || 0) + 1;
    const max = Math.max(...Object.values(propCounts));
    assert.ok(max <= 6, `max per property is ${max} > 6`);
  });
}

// ─── Pipeline / source checks ─────────────────────────────────────────────────

console.log('\n── Pipeline / source checks ─────────────────────────────────────────────');

const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-eval-set.js'), 'utf8');

t('No ORDER BY RANDOM in SQL',          () => assert.ok(!/ORDER BY random\(\)/i.test(src), 'ORDER BY RANDOM() in SQL'));
t('No Groq SDK import',                 () => assert.ok(!src.includes("require('groq") && !src.includes('groq-sdk'), 'Groq SDK imported'));
t('No "tools" param in source',         () => assert.ok(!src.includes('"tools"'), '"tools" param found'));
t('module.exports present',             () => assert.ok(src.includes('module.exports')));
t('CLASSIFY FIRST comment present',     () => assert.ok(src.includes('CLASSIFY FIRST')));
t('BACKFILL section present',           () => assert.ok(src.includes('BACKFILL'), 'BACKFILL section missing'));
t('V2 file not imported',               () => assert.ok(!src.includes('traveler-ai-v2'), 'V2 imported unexpectedly'));
t('version 1.3 in source',             () => assert.ok(src.includes("'1.3'"), "version '1.3' not found in source"));

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════════════');
const total = pass + fail;
console.log(`  ${pass}/${total} tests passed  (${fail} failed)`);
console.log('═══════════════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);
