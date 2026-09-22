'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { guestAuth, issueGuestToken, resolveHostAccess, resolveSocketAccess, createPinRateLimiter } = require('../utils/chat-utils');

// ── Mock pool builder ──────────────────────────────────────────────────────────

function makeHashPool(hash) {
  return {
    async query(sql, params) {
      const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (n.startsWith('update')) return { rows: [] };
      return { rows: hash ? [{ guest_token_hash: hash }] : [] };
    }
  };
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function main() {

  // TC-GT01 : sans token → refus
  {
    const pool = makeHashPool('some-hash');
    assert.strictEqual(await guestAuth(pool, null, '1'), false, 'TC-GT01a: null → false');
    assert.strictEqual(await guestAuth(pool, '',   '1'), false, 'TC-GT01b: vide → false');
    assert.strictEqual(await guestAuth(pool, 'tok', null), false, 'TC-GT01c: convId null → false');
    console.log('✅  TC-GT01 — sans token → refus');
  }

  // TC-GT02 : token d'une autre conversation → refus
  {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const correctHash = sha256hex(rawToken);
    // Pool simulant conversation 10 (bonne hash) — on demande conv 99 (hash différente)
    const pool = {
      async query(sql, params) {
        const convId = params[0];
        return { rows: convId === '10' ? [{ guest_token_hash: correctHash }] : [] };
      }
    };
    assert.strictEqual(await guestAuth(pool, rawToken, '99'), false, 'TC-GT02: mauvaise conv → false');
    assert.strictEqual(await guestAuth(pool, rawToken, '10'), true,  'TC-GT02: bonne conv → true');
    console.log('✅  TC-GT02 — token d\'une autre conversation refusé');
  }

  // TC-GT03 : token révoqué par réémission → refus de l'ancien
  {
    let storedHash = null;
    const pool = {
      async query(sql, params) {
        const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (n.startsWith('update')) {
          storedHash = params[0]; // params: [hash, convId]
          return { rows: [] };
        }
        return { rows: storedHash ? [{ guest_token_hash: storedHash }] : [] };
      }
    };
    const oldToken = await issueGuestToken(pool, '5');
    const newToken = await issueGuestToken(pool, '5'); // révoque l'ancien
    assert.strictEqual(await guestAuth(pool, oldToken, '5'), false, 'TC-GT03: ancien token refusé');
    assert.strictEqual(await guestAuth(pool, newToken, '5'), true,  'TC-GT03: nouveau token accepté');
    console.log('✅  TC-GT03 — réémission révoque l\'ancien token');
  }

  // TC-GT04 : voyageur légitime → true
  {
    let storedHash = null;
    const pool = {
      async query(sql, params) {
        const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (n.startsWith('update')) { storedHash = params[0]; return { rows: [] }; }
        return { rows: storedHash ? [{ guest_token_hash: storedHash }] : [] };
      }
    };
    const token = await issueGuestToken(pool, '42');
    assert.strictEqual(await guestAuth(pool, token, '42'), true, 'TC-GT04: token valide → true');
    console.log('✅  TC-GT04 — voyageur légitime accepté');
  }

  // TC-GT05 : sous-compte d'un autre hôte avec liste vide → toujours 403
  {
    // Sous-compte d'un AUTRE hôte avec liste vide → 403 (était 200 avant le fix)
    assert.strictEqual(resolveHostAccess({ comptes: ['other-host'], convUserId: 'my-host', convPropertyId: 'prop-1', isSubAccount: true, accessibleIds: [] }).ok, false, 'TC-GT05a: autre hôte, liste vide → 403');
    // Sous-compte du BON hôte avec liste vide → 200 (liste vide = pas de restriction)
    assert.strictEqual(resolveHostAccess({ comptes: ['my-host'], convUserId: 'my-host', convPropertyId: 'prop-1', isSubAccount: true, accessibleIds: [] }).ok, true, 'TC-GT05b: bon hôte, liste vide → 200');
    // Sous-compte du BON hôte avec liste non-vide excluant la propriété → 403
    assert.strictEqual(resolveHostAccess({ comptes: ['my-host'], convUserId: 'my-host', convPropertyId: 'prop-1', isSubAccount: true, accessibleIds: ['prop-2'] }).ok, false, 'TC-GT05c: bon hôte, propriété exclue → 403');
    console.log('✅  TC-GT05 — contrôle d\'accès sous-compte corrigé');
  }

  // TC-GT06 : room socket refusée sans token
  {
    const pool2 = makeHashPool(null); // aucun hash → guestAuth toujours false

    // Sans rien → refus
    const r1 = await resolveSocketAccess(pool2, { conversationId: '7', guestToken: null, hostToken: null });
    assert.strictEqual(r1.ok, false, 'TC-GT06a: sans token → refus');
    assert.ok(r1.reason && r1.reason.length > 0, 'TC-GT06b: raison non vide');

    // Avec mauvais guestToken → refus
    const r2 = await resolveSocketAccess(pool2, { conversationId: '7', guestToken: 'bad-token', hostToken: null });
    assert.strictEqual(r2.ok, false, 'TC-GT06c: mauvais token → refus');
    assert.strictEqual(r2.reason, 'Token voyageur invalide', 'TC-GT06d: raison correcte');

    console.log('✅  TC-GT06 — room socket refusée sans token valide');
  }

  // TC-GT07 : rate limiter (logique seule, sans Express)
  {
    const check = createPinRateLimiter();
    for (let i = 0; i < 10; i++) check('ip:1.2.3.4', 10, 60000);
    const blocked = check('ip:1.2.3.4', 10, 60000);
    assert.ok(blocked !== null && blocked > 0, 'TC-GT07: 11e tentative bloquée');
    assert.strictEqual(check('ip:9.9.9.9', 10, 60000), null, 'TC-GT07: autre IP non bloquée');
    console.log('✅  TC-GT07 — rate limiter par IP fonctionne');
  }

  const total = 7;
  console.log(`\n───────────────────────────────────────────────────────`);
  console.log(`  Résultats : ${total} passed, 0 failed`);
}

main().catch(e => {
  console.error('❌ TEST FAILED:', e.message);
  process.exit(1);
});
