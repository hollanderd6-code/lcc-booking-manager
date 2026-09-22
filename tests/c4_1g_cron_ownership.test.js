#!/usr/bin/env node
'use strict';
/**
 * P0-C4.1g — Canonical cron / recalc ownership
 *
 * Vérifie que le moteur automatique (cron, recalc, one-property) ne sélectionne
 * que la config CANONIQUE : pricing_config.user_id = properties.user_id.
 * Les configs delegate orphelines sont exclues structurellement.
 *
 * Couverture :
 *   TC-G01 : 1 config owner active → 1 traitement
 *   TC-G02 : owner active + delegate active → uniquement owner
 *   TC-G03 : owner active + 2 delegates actifs → uniquement owner (cas M7)
 *   TC-G04 : owner inactive + delegate active → AUCUN traitement
 *   TC-G05 : owner inexistant + delegate active → AUCUN traitement
 *   TC-G06 : runRecalc owner + delegate → owner sélectionné
 *   TC-G07 : runRecalc seulement delegate active → aucun recalcul
 *   TC-G08 : runDynamicPricingForOneProperty → résout owner depuis properties
 *   TC-G09 : apply reçoit pricingOwnerId, jamais delegate userId
 *   TC-G10 : cas M7 exact — une seule passe owner auto/min75
 *   TC-G11 : aucune modification pricing_schedule/pricing_history schema
 *   TC-G12 : guard external_pricing inchangé dans pricing-apply
 *
 * Exécution : node tests/c4_1g_cron_ownership.test.js
 * Aucun appel DB réel, aucun cron déclenché.
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

// ── Test runner ────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ── Mock pool factory ──────────────────────────────────────────────────────────
//
// properties   : { [propId]: { user_id, name, address?, base_price? } }
// pricingConfigs : [{ user_id, property_id, is_active, mode, price_min, price_max, ... }]
// users        : { [userId]: { email?, first_name? } }
// onHistoryInsert : cb({ userId, propertyId }) appelé à chaque INSERT pricing_history

function makeCronPool({ properties = {}, pricingConfigs = [], users = {}, onHistoryInsert = null } = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.toLowerCase().replace(/\s+/g, ' ').trim();

      // ── CREATE TABLE / INDEX ──────────────────────────────────
      if (s.startsWith('create table') || s.startsWith('create index')) return { rows: [] };

      // ── Canonical config queries (cron + recalc + one-property)
      // Toutes ces queries utilisent le pattern : JOIN properties p AND p.user_id = pc.user_id
      if (s.includes('from pricing_config pc') && s.includes('p.user_id = pc.user_id')) {
        const propId       = params[0] || null;            // null = requête globale (cron)
        const requireActive = s.includes('is_active = true');
        const filtered = pricingConfigs.filter(pc => {
          const prop = properties[pc.property_id];
          if (!prop || prop.user_id !== pc.user_id) return false; // filtre canonique
          if (requireActive && !pc.is_active) return false;
          if (propId && pc.property_id !== propId) return false;
          return true;
        });
        return { rows: filtered.map(pc => ({
          ...pc,
          property_name:    properties[pc.property_id]?.name    || pc.property_id,
          property_address: properties[pc.property_id]?.address || '',
          zone_label:       null,
          bedrooms:         pc.bedrooms || 1,
          user_email:       users[pc.user_id]?.email       || null,
          user_first_name:  users[pc.user_id]?.first_name  || null,
          notify_email:     false,  // désactive l'email dans les tests
          notify_push:      false,
        })) };
      }

      // ── priceProperty : SELECT * FROM pricing_config WHERE user_id = $1 AND property_id = $2
      if (s.includes('from pricing_config where user_id =')) {
        const userId = params[0];
        const propId = params[1];
        const pc = pricingConfigs.find(c => c.user_id === userId && c.property_id === propId);
        return { rows: pc ? [pc] : [] };
      }

      // ── Properties lookup (applyDynamicPricingForProperty) ────
      if (s.includes('from properties where id =')) {
        const propId = params[0];
        const prop   = properties[propId];
        if (!prop) return { rows: [] };
        return { rows: [{
          id: propId, name: prop.name || propId,
          base_price:         prop.base_price != null ? prop.base_price : 100,
          weekend_price:      null,
          channex_enabled:    false,
          channex_property_id:  null,
          channex_room_type_id: null,
          channex_rate_plan_id: null,
          external_pricing:   false,
        }] };
      }

      // ── market_data (toutes variantes) ────────────────────────
      if (s.includes('insert into market_data'))  return { rows: [] };
      if (s.includes('from market_data'))          return { rows: [] };

      // ── reservations ─────────────────────────────────────────
      if (s.includes('from reservations'))         return { rows: [] };

      // ── pricing_schedule INSERT ───────────────────────────────
      if (s.includes('insert into pricing_schedule')) return { rows: [] };

      // ── pricing_history: toutes les lectures ─────────────────
      if (s.includes('from pricing_history') && !s.includes('insert into pricing_history')) {
        return { rows: [] };
      }

      // ── pricing_history INSERT (point de tracking) ────────────
      if (s.includes('insert into pricing_history')) {
        if (onHistoryInsert) onHistoryInsert({ userId: params[0], propertyId: params[1] });
        return { rows: [] };
      }

      // ── FCM tokens ───────────────────────────────────────────
      if (s.includes('from user_devices')) return { rows: [] };

      throw new Error('MockPool unexpected SQL: ' + sql.slice(0, 100));
    },
  };
}

// ── Modules sous test ─────────────────────────────────────────────────────────

const {
  runDynamicPricingJob,
  runDailyPricingRefresh,
  runDynamicPricingForOneProperty,
} = require('../routes/dynamic-pricing-cron');

const { schedulePricingRecalc } = require('../routes/pricing-recalc-trigger');

// runRecalc est interne — on passe par schedulePricingRecalc avec delayMs=0
function runRecalcDirect(pool, propertyId, userId) {
  return new Promise((resolve) => {
    schedulePricingRecalc(pool, propertyId, userId, { delayMs: 0 });
    // Attendre que le debounce s'exécute
    setTimeout(resolve, 50);
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER_ID    = 'u_owner';
const DELEGATE_1  = 'u_delegate_1';
const DELEGATE_2  = 'u_delegate_2';
const PROP_ID     = 'prop-m7';

const BASE_PROPS = {
  [PROP_ID]: { user_id: OWNER_ID, name: 'M7', address: 'Paris, France', base_price: 100 },
};

const OWNER_CFG = {
  id: 3, user_id: OWNER_ID, property_id: PROP_ID,
  mode: 'auto', is_active: true, price_min: 75, price_max: 200,
  strategy: 50, bedrooms: 1,
};

const DELEGATE_1_CFG = {
  id: 1, user_id: DELEGATE_1, property_id: PROP_ID,
  mode: 'manual', is_active: false, price_min: 40, price_max: 180,
  strategy: 50, bedrooms: 1,
};

const DELEGATE_2_CFG = {
  id: 9, user_id: DELEGATE_2, property_id: PROP_ID,
  mode: 'manual', is_active: true, price_min: 40, price_max: 180,
  strategy: 50, bedrooms: 1,
};

const BASE_USERS = {
  [OWNER_ID]: { email: 'owner@test.com', first_name: 'Owner' },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── G01 : 1 config owner active → 1 traitement ───────────────────────────────

await test('TC-G01 cron — 1 config owner active → 1 passe owner', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  assert.strictEqual(calls.length, 1, `attendu 1 appel INSERT history, reçu ${calls.length}`);
  assert.strictEqual(calls[0].userId, OWNER_ID, `user_id attendu ${OWNER_ID}, reçu ${calls[0].userId}`);
  assert.strictEqual(calls[0].propertyId, PROP_ID);
});

// ── G02 : owner active + delegate active → uniquement owner ──────────────────

await test('TC-G02 cron — owner + delegate actif → uniquement owner traité', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_CFG, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  assert.strictEqual(calls.length, 1, `attendu 1 appel, reçu ${calls.length}`);
  assert.strictEqual(calls[0].userId, OWNER_ID,
    `user_id INSERT doit être owner ${OWNER_ID}, reçu ${calls[0].userId}`);
  const delegateCalls = calls.filter(c => c.userId === DELEGATE_2);
  assert.strictEqual(delegateCalls.length, 0, 'delegate ne doit jamais être écrit en DB');
});

// ── G03 : owner + 2 delegates actifs → uniquement owner ──────────────────────

await test('TC-G03 cron — owner + 2 delegates actifs → uniquement owner (cas M7)', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [DELEGATE_1_CFG, OWNER_CFG, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  assert.strictEqual(calls.length, 1, `attendu 1 passe, reçu ${calls.length} (race condition!)`);
  assert.strictEqual(calls[0].userId, OWNER_ID, `pricingOwnerId attendu ${OWNER_ID}`);
  assert.strictEqual(calls[0].propertyId, PROP_ID);
});

// ── G04 : owner inactive + delegate active → AUCUN traitement ────────────────

await test('TC-G04 cron — owner inactive + delegate active → 0 traitement', async () => {
  const calls = [];
  const OWNER_INACTIVE = { ...OWNER_CFG, is_active: false };
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_INACTIVE, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  assert.strictEqual(calls.length, 0,
    `delegate actif NE DOIT PAS réactiver le pricing owner désactivé — ${calls.length} passe(s) trouvée(s)`);
});

// ── G05 : owner inexistant + delegate active → 0 traitement ──────────────────

await test('TC-G05 cron — owner config inexistante + delegate active → 0 traitement', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [DELEGATE_2_CFG],  // pas de config owner
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  assert.strictEqual(calls.length, 0, 'sans config canonique, 0 traitement attendu');
});

// ── G06 : runRecalc owner + delegate → owner sélectionné ─────────────────────

await test('TC-G06 runRecalc — owner + delegate actif → owner sélectionné', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_CFG, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runRecalcDirect(pool, PROP_ID, DELEGATE_2);

  assert.strictEqual(calls.length, 1, `attendu 1 passe, reçu ${calls.length}`);
  assert.strictEqual(calls[0].userId, OWNER_ID,
    `runRecalc doit utiliser owner ${OWNER_ID}, reçu ${calls[0].userId}`);
});

// ── G07 : runRecalc seulement delegate active → aucun recalcul ───────────────

await test('TC-G07 runRecalc — seule config delegate active → aucun recalcul', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [DELEGATE_2_CFG],  // pas de config owner active
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runRecalcDirect(pool, PROP_ID, DELEGATE_2);

  assert.strictEqual(calls.length, 0, 'config delegate non canonique → 0 recalcul');
});

// ── G08 : runDynamicPricingForOneProperty résout owner depuis properties ──────

await test('TC-G08 runDynamicPricingForOneProperty — résout config via properties (pas userId caller)', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_CFG, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  // Appeler avec userId = DELEGATE_2 (un delegate) — la config résolue doit être owner
  const result = await runDynamicPricingForOneProperty(pool, {
    userId: DELEGATE_2, propertyId: PROP_ID, force: true,
  });

  assert.ok(result.ok !== false || result.error !== 'Config pricing introuvable pour ce logement',
    `config canonique non trouvée: ${result.error}`);
  assert.strictEqual(calls.length, 1, `attendu 1 appel INSERT history, reçu ${calls.length}`);
  assert.strictEqual(calls[0].userId, OWNER_ID,
    `runDynamicPricingForOneProperty doit écrire sous owner ${OWNER_ID}, reçu ${calls[0].userId}`);
});

// ── G09 : apply reçoit pricingOwnerId, jamais delegate userId ─────────────────

await test('TC-G09 apply — INSERT pricing_history.user_id = pricingOwnerId jamais delegate', async () => {
  const historyUserIds = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_CFG, DELEGATE_1_CFG, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => historyUserIds.push(c.userId),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  const delegateWrites = historyUserIds.filter(id => id === DELEGATE_1 || id === DELEGATE_2);
  assert.strictEqual(delegateWrites.length, 0,
    `userId delegate trouvé dans pricing_history : ${delegateWrites}`);
  assert.ok(historyUserIds.every(id => id === OWNER_ID),
    `Tous les user_id doivent être owner — trouvé : ${[...new Set(historyUserIds)]}`);
});

// ── G10 : cas M7 exact ────────────────────────────────────────────────────────

await test('TC-G10 cas M7 exact — une seule passe owner auto/min75', async () => {
  const calls = [];
  // Réplique exacte des 3 configs M7 production
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [
      { id: 1, user_id: DELEGATE_1, property_id: PROP_ID, mode: 'manual', is_active: false,  price_min: 40, price_max: 200, bedrooms: 1, strategy: 50 },
      { id: 3, user_id: OWNER_ID,   property_id: PROP_ID, mode: 'auto',   is_active: true,   price_min: 75, price_max: 200, bedrooms: 1, strategy: 50 },
      { id: 9, user_id: DELEGATE_2, property_id: PROP_ID, mode: 'manual', is_active: true,   price_min: 40, price_max: 200, bedrooms: 1, strategy: 50 },
    ],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDynamicPricingJob(pool, async () => {}, null);

  // Vérifications strictes
  assert.strictEqual(calls.length, 1, `attendu exactement 1 passe, reçu ${calls.length}`);
  assert.strictEqual(calls[0].userId, OWNER_ID, `owner attendu, reçu ${calls[0].userId}`);
  assert.strictEqual(calls[0].propertyId, PROP_ID);

  // Vérifier que le cfg utilisé est bien la config owner (price_min=75, mode=auto)
  // Via la query priceProperty : SELECT * FROM pricing_config WHERE user_id = OWNER_ID
  // (indirectement vérifié par le fait que seul owner est traité)
});

// ── G11 : schema pricing_schedule / pricing_history inchangé ─────────────────

await test('TC-G11 schema pricing_schedule/pricing_history inchangé', () => {
  const applySrc = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'pricing-apply.js'), 'utf8'
  );

  // pricing_schedule CREATE TABLE inchangé
  assert.ok(
    /unique\s*\(\s*property_id\s*,\s*date\s*\)/i.test(applySrc),
    'UNIQUE(property_id, date) absent de pricing_schedule'
  );
  assert.ok(
    /user_id\s+text\s+not\s+null/i.test(applySrc),
    'user_id TEXT NOT NULL absent de pricing_schedule CREATE TABLE'
  );

  // pricing_history ON CONFLICT inchangé
  assert.ok(
    /on conflict\s*\(\s*property_id\s*,\s*week_start\s*\)/i.test(applySrc),
    'ON CONFLICT (property_id, week_start) absent de pricing_history'
  );
  assert.ok(
    applySrc.includes('user_id, property_id, week_start'),
    'user_id absent des colonnes pricing_history INSERT'
  );
});

// ── G12 : guard external_pricing inchangé dans pricing-apply ─────────────────

await test('TC-G12 guard external_pricing inchangé dans pricing-apply', () => {
  const applySrc = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'pricing-apply.js'), 'utf8'
  );
  assert.ok(
    /const canPush\s*=.*!prop\.external_pricing/.test(applySrc),
    'Guard !prop.external_pricing absent de canPush dans pricing-apply'
  );
});

// ── Vérification structurelle des queries ─────────────────────────────────────

await test('TC-G13 queries cron utilisent le JOIN canonique p.user_id = pc.user_id', () => {
  const cronSrc = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'dynamic-pricing-cron.js'), 'utf8'
  );
  const recalcSrc = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'pricing-recalc-trigger.js'), 'utf8'
  );

  // runDynamicPricingJob
  const jobIdx = cronSrc.indexOf('async function runDynamicPricingJob');
  assert.ok(jobIdx >= 0, 'runDynamicPricingJob introuvable');
  const jobSnippet = cronSrc.slice(jobIdx, jobIdx + 1000);
  assert.ok(
    /join properties\s+p\s+on\s+p\.id\s*=\s*pc\.property_id\s+and\s+p\.user_id\s*=\s*pc\.user_id/i.test(jobSnippet),
    'JOIN canonique absent de runDynamicPricingJob'
  );
  assert.ok(
    !/order by pc\.user_id/i.test(jobSnippet),
    'ORDER BY pc.user_id ne doit plus être présent dans runDynamicPricingJob'
  );

  // runDailyPricingRefresh
  const refreshIdx = cronSrc.indexOf('async function runDailyPricingRefresh');
  assert.ok(refreshIdx >= 0, 'runDailyPricingRefresh introuvable');
  const refreshSnippet = cronSrc.slice(refreshIdx, refreshIdx + 500);
  assert.ok(
    /join properties\s+p\s+on\s+p\.id\s*=\s*pc\.property_id\s+and\s+p\.user_id\s*=\s*pc\.user_id/i.test(refreshSnippet),
    'JOIN canonique absent de runDailyPricingRefresh'
  );

  // runDynamicPricingForOneProperty
  const oneIdx = cronSrc.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(oneIdx >= 0, 'runDynamicPricingForOneProperty introuvable');
  const oneSnippet = cronSrc.slice(oneIdx, oneIdx + 600);
  assert.ok(
    /join properties\s+p\s+on\s+p\.id\s*=\s*pc\.property_id\s+and\s+p\.user_id\s*=\s*pc\.user_id/i.test(oneSnippet),
    'JOIN canonique absent de runDynamicPricingForOneProperty'
  );
  assert.ok(
    !/where pc\.user_id\s*=\s*\$1/i.test(oneSnippet),
    'WHERE pc.user_id = $1 (caller userId) ne doit plus être présent'
  );

  // runRecalc : JOIN canonique + pas de LIMIT 1
  assert.ok(
    /join properties\s+p\s+on\s+p\.id\s*=\s*pc\.property_id\s+and\s+p\.user_id\s*=\s*pc\.user_id/i.test(recalcSrc),
    'JOIN canonique absent de runRecalc'
  );
  assert.ok(
    !/limit 1/i.test(recalcSrc.slice(recalcSrc.indexOf('async function runRecalc'), recalcSrc.indexOf('async function runRecalc') + 500)),
    'LIMIT 1 doit être supprimé de runRecalc'
  );
});

// ── runDailyPricingRefresh : même sélection canonique ────────────────────────

await test('TC-G14 runDailyPricingRefresh — même filtre canonique que le cron hebdo', async () => {
  const calls = [];
  const pool = makeCronPool({
    properties: BASE_PROPS,
    pricingConfigs: [OWNER_CFG, DELEGATE_2_CFG],
    users: BASE_USERS,
    onHistoryInsert: (c) => calls.push(c),
  });

  await runDailyPricingRefresh(pool, null);

  assert.strictEqual(calls.length, 1, `attendu 1 passe, reçu ${calls.length}`);
  assert.strictEqual(calls[0].userId, OWNER_ID, `pricingOwnerId attendu`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── P0-C4.1g cron ownership ──────────────────────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failures.length) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}
process.exit(0);

})();
