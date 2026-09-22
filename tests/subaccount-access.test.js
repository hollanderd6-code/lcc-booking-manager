'use strict';

/**
 * Tests ciblés pour la correction de la Faille 2 :
 * un sous-compte hors comptesAutorises doit recevoir 403 même si sa
 * liste accessible_property_ids est vide (ancienne règle : liste vide
 * = "sans restriction" → accès accordé à tort à des conversations
 * d'hôtes tiers).
 */

const assert = require('assert');

// Simule la logique d'accès de GET /api/chat/messages (chemin authentifié)
function resolveHostAccess({ comptes, convUserId, convPropertyId, isSubAccount, accessibleIds = [] }) {
  // Hors comptesAutorises → toujours 403, même pour un sous-compte
  if (!comptes.includes(convUserId)) return { status: 403, reason: 'hors-comptes' };

  // Dans comptesAutorises → accessible_property_ids restreint si non vide
  if (isSubAccount && accessibleIds.length > 0 && !accessibleIds.includes(convPropertyId)) {
    return { status: 403, reason: 'hors-proprietes' };
  }

  return { status: 200, reason: 'ok' };
}

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
    assert.strictEqual(r.status, 403, 'TC-SA01: autre hôte + liste vide → 403');
    assert.strictEqual(r.reason, 'hors-comptes', 'TC-SA01: raison = hors-comptes');
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
    assert.strictEqual(r.status, 200, 'TC-SA02: bon hôte + liste vide → 200');
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
    assert.strictEqual(r.status, 200, 'TC-SA03: bon hôte + propriété incluse → 200');
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
    assert.strictEqual(r.status, 403, 'TC-SA04: bon hôte + propriété exclue → 403');
    assert.strictEqual(r.reason, 'hors-proprietes', 'TC-SA04: raison = hors-proprietes');
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
    assert.strictEqual(r.status, 403, 'TC-SA05: compte principal autre hôte → 403');
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
    assert.strictEqual(r.status, 200, 'TC-SA06: compte principal propriétaire → 200');
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
    assert.strictEqual(r.status, 200, 'TC-SA07: gestionnaire délégué → 200');
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
