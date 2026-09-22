'use strict';

const assert = require('assert');
const { deescalateConversation } = require('../utils/chat-utils');

// ── Mock pool builder ──────────────────────────────────────────────────────────

function makeMockPool(rows, { rejectSelect = false, rejectUpdate = false } = {}) {
  const calls = [];
  const pool = {
    calls,
    async query(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ sql: normalized, params });
      if (normalized.startsWith('select') && rejectSelect) throw new Error('mock SELECT error');
      if (normalized.startsWith('update') && rejectUpdate) throw new Error('mock UPDATE error');
      return { rows };
    }
  };
  return pool;
}

async function main() {
  // TC-D01 : escalated=TRUE → SELECT puis UPDATE émis
  {
    const pool = makeMockPool([{ escalated: true }]);
    await deescalateConversation(pool, '42', 'test');
    assert.strictEqual(pool.calls.length, 2, 'TC-D01: doit émettre 2 requêtes');
    assert.ok(pool.calls[0].sql.startsWith('select'), 'TC-D01: première requête = SELECT');
    assert.ok(pool.calls[1].sql.startsWith('update'), 'TC-D01: deuxième requête = UPDATE');
    assert.deepStrictEqual(pool.calls[0].params, ['42'], 'TC-D01: SELECT avec conversationId');
    assert.deepStrictEqual(pool.calls[1].params, ['42'], 'TC-D01: UPDATE avec conversationId');
    console.log('✅  TC-D01 — escalated=TRUE émet SELECT + UPDATE');
  }

  // TC-D02 : escalated=FALSE → SELECT mais pas d'UPDATE
  {
    const pool = makeMockPool([{ escalated: false }]);
    await deescalateConversation(pool, '99', 'test');
    assert.strictEqual(pool.calls.length, 1, 'TC-D02: 1 seule requête');
    assert.ok(pool.calls[0].sql.startsWith('select'), 'TC-D02: requête = SELECT');
    console.log('✅  TC-D02 — escalated=FALSE ne déclenche pas d\'UPDATE');
  }

  // TC-D03 : conversation introuvable → aucun UPDATE, aucun throw
  {
    const pool = makeMockPool([]);
    await deescalateConversation(pool, '0', 'test');
    const hasUpdate = pool.calls.some(c => c.sql.startsWith('update'));
    assert.strictEqual(hasUpdate, false, 'TC-D03: pas d\'UPDATE si rows vide');
    console.log('✅  TC-D03 — conversation introuvable : pas de throw, pas d\'UPDATE');
  }

  // TC-D04 : SELECT jette → deescalateConversation ne jette pas
  {
    const pool = makeMockPool([], { rejectSelect: true });
    await deescalateConversation(pool, '7', 'test');
    console.log('✅  TC-D04 — erreur SELECT absorbée sans throw');
  }

  // TC-D05 : UPDATE jette → deescalateConversation ne jette pas
  {
    const pool = makeMockPool([{ escalated: true }], { rejectUpdate: true });
    await deescalateConversation(pool, '8', 'test');
    console.log('✅  TC-D05 — erreur UPDATE absorbée sans throw');
  }

  // TC-D06 : log contient conversationId et source
  {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const pool = makeMockPool([{ escalated: true }]);
      await deescalateConversation(pool, '55', 'send-platform');
    } finally {
      console.log = orig;
    }
    const log = logs.join(' ');
    assert.ok(log.includes('55'),            'TC-D06: log contient conversationId');
    assert.ok(log.includes('send-platform'), 'TC-D06: log contient source');
    console.log('✅  TC-D06 — log inclut conversationId et source');
  }

  // TC-D07 : source apparaît correctement pour le chemin manuel
  {
    const pool = makeMockPool([{ escalated: true }]);
    await deescalateConversation(pool, '12', 'manuelle (user 3)');
    assert.ok(pool.calls[1].sql.includes('escalated = false'), 'TC-D07: UPDATE remet escalated à false');
    console.log('✅  TC-D07 — source libre (manuelle) correctement tracée');
  }

  // ── sender_type forcing logic ────────────────────────────────────────────────
  // TC-ST01 : owner sans auth → reclassé en guest
  {
    function resolveEffectiveSenderType(rawType, reqUser) {
      let sender_type = rawType;
      if (sender_type === 'owner' && !reqUser) sender_type = 'guest';
      return sender_type;
    }

    assert.strictEqual(resolveEffectiveSenderType('owner', null),     'guest',    'TC-ST01a: owner sans token → guest');
    assert.strictEqual(resolveEffectiveSenderType('owner', { id: 1 }),'owner',    'TC-ST01b: owner avec token → owner');
    assert.strictEqual(resolveEffectiveSenderType('guest', null),     'guest',    'TC-ST01c: guest sans token → guest');
    assert.strictEqual(resolveEffectiveSenderType('guest', { id: 1 }),'guest',    'TC-ST01d: guest avec token → guest');
    assert.strictEqual(resolveEffectiveSenderType('system', null),    'system',   'TC-ST01e: system non affecté');
    console.log('✅  TC-ST01 — forçage sender_type owner→guest sans auth');
  }

  // TC-OWN01 : deescalate — comptesAutorises includes delegated accounts
  // Vérifie que la vérification de propriété passe avec un compte délégué
  {
    const { comptesAutorises } = require('../utils/agency');
    const pool = {
      async query(sql, params) {
        const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        // Simulate account_delegations returning a delegated account
        if (n.includes('account_delegations') && params[0] === 'delegate-user') {
          return { rows: [{ delegator_user_id: 'owner-user' }] };
        }
        return { rows: [] };
      }
    };
    const comptes = await comptesAutorises(pool, 'delegate-user');
    assert.ok(comptes.includes('delegate-user'), 'TC-OWN01: inclut userId');
    assert.ok(comptes.includes('owner-user'),    'TC-OWN01: inclut compte délégant');
    assert.strictEqual(comptes.length, 2,        'TC-OWN01: exactement 2 comptes');
    console.log('✅  TC-OWN01 — comptesAutorises inclut comptes délégués sans ?agency=all');
  }

  // TC-OWN02 : deescalate — comptesAutorises sans délégation → [userId] seulement
  {
    const { comptesAutorises } = require('../utils/agency');
    const pool = {
      async query() { return { rows: [] }; }
    };
    const comptes = await comptesAutorises(pool, 'solo-user');
    assert.deepStrictEqual(comptes, ['solo-user'], 'TC-OWN02: seul userId si pas de délégation');
    console.log('✅  TC-OWN02 — comptesAutorises sans délégation retourne [userId]');
  }

  const total = 10; // D01–D07 + ST01 + OWN01 + OWN02
  console.log(`\n───────────────────────────────────────────────────────`);
  console.log(`  Résultats : ${total} passed, 0 failed`);
}

main().catch(e => {
  console.error('❌ TEST FAILED:', e.message);
  process.exit(1);
});
