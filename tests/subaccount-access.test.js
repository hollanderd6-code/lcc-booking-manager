'use strict';

const assert = require('assert');
const { resolveHostAccess } = require('../utils/chat-utils');

async function main() {

  // TC-SA01 : sous-compte d'un AUTRE hôte, liste vide → 403 (était 200 avant le fix)
  {
    const r = resolveHostAccess({
      comptes: ['other-host'],
      convUserId: 'my-host',
      convPropertyId: 'prop-1',
      isSubAccount: true,
      accessibleIds: []
    });
    assert.strictEqual(r.ok, false, 'TC-SA01: autre hôte + liste vide → 403');
    assert.strictEqual(r.reason, 'Accès refusé', 'TC-SA01: raison = Accès refusé');
    console.log('✅  TC-SA01 — sous-compte autre hôte, liste vide → 403 (Faille 2 corrigée)');
  }

  // TC-SA02 : sous-compte du BON hôte, liste vide → 200 (pas de restriction)
  {
    const r = resolveHostAccess({
      comptes: ['my-host'],
      convUserId: 'my-host',
      convPropertyId: 'prop-1',
      isSubAccount: true,
      accessibleIds: []
    });
    assert.strictEqual(r.ok, true, 'TC-SA02: bon hôte + liste vide → 200');
    console.log('✅  TC-SA02 — sous-compte bon hôte, liste vide → 200');
  }

  // TC-SA03 : sous-compte du bon hôte, propriété dans la liste → 200
  {
    const r = resolveHostAccess({
      comptes: ['my-host'],
      convUserId: 'my-host',
      convPropertyId: 'prop-1',
      isSubAccount: true,
      accessibleIds: ['prop-1', 'prop-2']
    });
    assert.strictEqual(r.ok, true, 'TC-SA03: bon hôte + propriété incluse → 200');
    console.log('✅  TC-SA03 — sous-compte bon hôte, propriété incluse → 200');
  }

  // TC-SA04 : sous-compte du bon hôte, propriété HORS liste → 403
  {
    const r = resolveHostAccess({
      comptes: ['my-host'],
      convUserId: 'my-host',
      convPropertyId: 'prop-3',
      isSubAccount: true,
      accessibleIds: ['prop-1', 'prop-2']
    });
    assert.strictEqual(r.ok, false, 'TC-SA04: bon hôte + propriété exclue → 403');
    assert.strictEqual(r.reason, 'Accès refusé à cette propriété', 'TC-SA04: raison');
    console.log('✅  TC-SA04 — sous-compte bon hôte, propriété exclue → 403');
  }

  // TC-SA05 : compte principal (non sous-compte) hors comptesAutorises → 403
  {
    const r = resolveHostAccess({
      comptes: ['other-host'],
      convUserId: 'my-host',
      convPropertyId: 'prop-1',
      isSubAccount: false,
      accessibleIds: []
    });
    assert.strictEqual(r.ok, false, 'TC-SA05: compte principal autre hôte → 403');
    console.log('✅  TC-SA05 — compte principal autre hôte → 403');
  }

  // TC-SA06 : compte principal dans comptesAutorises → 200
  {
    const r = resolveHostAccess({
      comptes: ['my-host'],
      convUserId: 'my-host',
      convPropertyId: 'prop-1',
      isSubAccount: false,
      accessibleIds: []
    });
    assert.strictEqual(r.ok, true, 'TC-SA06: compte principal propriétaire → 200');
    console.log('✅  TC-SA06 — compte principal propriétaire → 200');
  }

  // TC-SA07 : agence (délégation) → comptesAutorises inclut les deux → 200
  {
    const r = resolveHostAccess({
      comptes: ['my-host', 'delegator-host'],
      convUserId: 'delegator-host',
      convPropertyId: 'prop-deleguee',
      isSubAccount: false,
      accessibleIds: []
    });
    assert.strictEqual(r.ok, true, 'TC-SA07: gestionnaire délégué → 200');
    console.log('✅  TC-SA07 — compte délégué (agence) → 200');
  }

  const total = 7;
  console.log(`\n───────────────────────────────────────────────────────`);
  console.log(`  Résultats : ${total} passed, 0 failed`);
}

main().catch(e => {
  console.error('❌ TEST FAILED:', e.message);
  process.exit(1);
});
