'use strict';
/**
 * ATTACHMENTS-8 — OWNERSHIP + COMPTES AGENCE + E2E SIMULÉ
 *
 * O. Vérification logique d'accès à la conversation (ownership)
 *    — extrait de la logique réelle de POST /api/chat/conversations/:id/attachments
 *
 * P. resolveOutboundOta — contextes agence
 *
 * Q. sendOutboundAttachment E2E — owner + agence + OTA combinés
 */

// ── Mocks top-level ───────────────────────────────────────────────────────────
jest.mock('axios');
jest.mock('../channex', () => ({
  uploadChannexAttachment: jest.fn(),
  sendBookingAttachment:   jest.fn(),
}));
jest.mock('cloudinary', () => ({
  v2: { url: jest.fn().mockReturnValue('https://signed.cloudinary.example/img') },
}), { virtual: false });

const axios   = require('axios');
const channex = require('../channex');

const {
  resolveOutboundOta,
  supportsOutboundImage,
  sendOutboundAttachment,
} = require('../services/channex-attachment-sender');

// JPEG valide pour validateOutboundImageBuffer
const VALID_JPEG = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
  Buffer.alloc(200),
]);

// ── Helper : logique ownership extraite du handler ───────────────────────────
// Reflète exactement la vérification dans routes/chat_routes.js :
//   if (!comptes.includes(String(conv.user_id))) { sub-account fallback; else 403 }
//
// Returns true si l'accès est accordé, false sinon.
function canAccessConversation(reqUser, comptes, conv, subAccountData = null) {
  if (comptes.includes(String(conv.user_id))) return true;

  // Fallback sous-compte : logements accessibles
  if (reqUser && reqUser.isSubAccount) {
    const ids = subAccountData?.accessible_property_ids || [];
    return ids.length === 0 || ids.includes(conv.property_id);
  }

  return false;
}

// ── O. Logique d'accès à la conversation ──────────────────────────────────────
describe('O. PROD-FIX-8 — Ownership + accès agence (logique handler)', () => {

  // conv appartient à userId=1, property_id=10
  const conv = { user_id: '1', property_id: 10 };

  // O-01 : owner possède la conversation → autorisé
  test('O-01 : owner avec user_id dans comptes → autorisé', () => {
    const reqUser = { isSubAccount: false };
    const comptes = ['1'];
    expect(canAccessConversation(reqUser, comptes, conv)).toBe(true);
  });

  // O-02 : user sans lien avec la conversation → refusé
  test('O-02 : user différent, conv non dans comptes → 403', () => {
    const reqUser = { isSubAccount: false };
    const comptes = ['99'];
    expect(canAccessConversation(reqUser, comptes, conv)).toBe(false);
  });

  // O-03 : compte agence (agency_access) : req.user.id = managedUserId = conv.user_id
  // getRealUserId() → managedUserId, comptesAutorises() → [managedUserId, ...] → passes
  test('O-03 : agency_access dont req.user.id = managedUserId = conv.user_id → autorisé', () => {
    const reqUser = { isSubAccount: false, isAgencyAccess: true, id: 1 };
    const comptes = ['1']; // getRealUserId() retourne managed=1, comptesAutorises → [1]
    expect(canAccessConversation(reqUser, comptes, conv)).toBe(true);
  });

  // O-04 : agence délégation classique : agent A manage owner B → conv appartient à B
  test('O-04 : délégation classique agentId=2 managedId=1 → conv appartient à 1 → autorisé', () => {
    const reqUser = { isSubAccount: false, isAgencyAccess: false, id: 2 };
    // comptesAutorises(pool, 2) → [2, 1] (B a délégué à A)
    const comptes = ['2', '1'];
    expect(canAccessConversation(reqUser, comptes, conv)).toBe(true);
  });

  // O-05 : agence A tente conv appartenant à C (non délégué) → refusé
  test('O-05 : délégation agentId=2 → comptes=[2,1], conv appartient à 3 → 403', () => {
    const reqUser = { isSubAccount: false, id: 2 };
    const comptes = ['2', '1'];
    const convC = { user_id: '3', property_id: 20 };
    expect(canAccessConversation(reqUser, comptes, convC)).toBe(false);
  });

  // O-06 : sous-compte avec logements accessibles dont le property_id → autorisé
  test('O-06 : sous-compte, property_id dans accessible_property_ids → autorisé', () => {
    const reqUser = { isSubAccount: true, subAccountId: 42 };
    const comptes = ['99']; // parent_user_id=99 ≠ conv.user_id=1 → fallback
    const subData = { accessible_property_ids: [10, 20] };
    expect(canAccessConversation(reqUser, comptes, conv, subData)).toBe(true);
  });

  // O-07 : sous-compte avec liste vide (accès tous logements) → autorisé
  test('O-07 : sous-compte, accessible_property_ids=[] (tous logements) → autorisé', () => {
    const reqUser = { isSubAccount: true, subAccountId: 42 };
    const comptes = ['99'];
    const subData = { accessible_property_ids: [] };
    expect(canAccessConversation(reqUser, comptes, conv, subData)).toBe(true);
  });

  // O-08 : sous-compte, property_id absent de sa liste → refusé
  test('O-08 : sous-compte, property_id non dans accessible_property_ids → 403', () => {
    const reqUser = { isSubAccount: true, subAccountId: 42 };
    const comptes = ['99'];
    const subData = { accessible_property_ids: [20, 30] }; // pas 10
    expect(canAccessConversation(reqUser, comptes, conv, subData)).toBe(false);
  });

  // O-09 : agence A1 tente conv agence A2 (même propriétaire) → refusé
  test('O-09 : agence A1 (comptes=[5,1]) tente conv agence A2 (user_id=6) → 403', () => {
    const reqUser = { isSubAccount: false, id: 5 };
    const comptes = ['5', '1'];
    const convA2 = { user_id: '6', property_id: 30 };
    expect(canAccessConversation(reqUser, comptes, convA2)).toBe(false);
  });
});

// ── P. resolveOutboundOta — contextes agence ──────────────────────────────────
describe('P. PROD-FIX-8 — resolveOutboundOta contextes agence', () => {

  // P-01 : agency + platform='channex' + ota_name='Airbnb' → airbnb, supporté
  test('P-01 : agency + channex + Airbnb → résolu airbnb, supporté', () => {
    const resolved = resolveOutboundOta('channex', 'Airbnb');
    expect(resolved).toBe('airbnb');
    expect(supportsOutboundImage(resolved)).toBe(true);
  });

  // P-02 : agency + channex + BookingCom → supporté
  test('P-02 : agency + channex + BookingCom → supporté', () => {
    const resolved = resolveOutboundOta('channex', 'BookingCom');
    expect(supportsOutboundImage(resolved)).toBe(true);
  });

  // P-03 : agency + channex + Expedia → supporté
  test('P-03 : agency + channex + Expedia → supporté', () => {
    const resolved = resolveOutboundOta('channex', 'Expedia');
    expect(supportsOutboundImage(resolved)).toBe(true);
  });

  // P-04 : agency + channex + null → fail-closed même pour compte agence
  test('P-04 : agency + channex + null → fail-closed (pas de supposition OTA)', () => {
    const resolved = resolveOutboundOta('channex', null);
    expect(resolved).toBe('');
    expect(supportsOutboundImage(resolved)).toBe(false);
  });

  // P-05 : agency + platform='airbnb' direct (pas channex) + ota_name=null → supporté
  test('P-05 : agency + airbnb + null → supporté (chemin direct)', () => {
    expect(supportsOutboundImage(resolveOutboundOta('airbnb', null))).toBe(true);
  });
});

// ── Q. sendOutboundAttachment E2E — owner + agence + OTA ─────────────────────
describe('Q. PROD-FIX-8 — sendOutboundAttachment E2E simulé', () => {

  // Factory pool avec support de deux types de lignes
  function makePool(attRow) {
    return {
      query: jest.fn().mockImplementation(async (sql) => {
        if (typeof sql === 'string' && sql.includes('FROM message_attachments ma')) {
          return { rows: [attRow] };
        }
        return { rows: [] };
      }),
    };
  }

  const baseAtt = {
    id: 1, message_id: 10, conversation_id: 100,
    type: 'image', mime_type: 'image/jpeg', filename: 'photo.jpg',
    size_bytes: 50000, cloudinary_public_id: 'test/pub',
    provider_attachment_id: null, processing_attempts: 0,
    direction: 'outbound', status: 'stored',
    channex_booking_id: 'bk-xyz', platform: 'channex', user_id: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: VALID_JPEG });
    channex.uploadChannexAttachment.mockResolvedValue('cx-att-id');
    channex.sendBookingAttachment.mockResolvedValue({ success: true });
  });

  // Q-01 : owner + airbnb → pipeline complet, status sent
  test('Q-01 : owner + channex + Airbnb → pipeline ok, status sent', async () => {
    const pool = makePool({ ...baseAtt, ota_name: 'Airbnb' });
    const r = await sendOutboundAttachment(1, pool, null);
    expect(r.ok).toBe(true);
    expect(channex.uploadChannexAttachment).toHaveBeenCalledTimes(1);
    expect(channex.sendBookingAttachment).toHaveBeenCalledWith('bk-xyz', 'cx-att-id');
    const sentCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes("status='sent'")
    );
    expect(sentCall).toBeTruthy();
  });

  // Q-02 : agence + channex + Airbnb → même pipeline (resolveOutboundOta côté sender)
  test('Q-02 : agency + channex + Airbnb → pipeline identique à owner', async () => {
    // Le sender ne connaît pas le type de compte — seul ota_name compte
    const pool = makePool({ ...baseAtt, id: 2, ota_name: 'Airbnb', user_id: 99 });
    const r = await sendOutboundAttachment(2, pool, null);
    expect(r.ok).toBe(true);
    expect(channex.uploadChannexAttachment).toHaveBeenCalledTimes(1);
    const failCalls = pool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('CHANNEL_NOT_SUPPORTED')
    );
    expect(failCalls).toHaveLength(0);
  });

  // Q-03 : agence + channex + BookingCom → ok
  test('Q-03 : agency + channex + BookingCom → ok', async () => {
    const pool = makePool({ ...baseAtt, id: 3, ota_name: 'BookingCom' });
    const r = await sendOutboundAttachment(3, pool, null);
    expect(r.ok).toBe(true);
  });

  // Q-04 : agence + channex + Expedia → ok
  test('Q-04 : agency + channex + Expedia → ok', async () => {
    const pool = makePool({ ...baseAtt, id: 4, ota_name: 'Expedia' });
    const r = await sendOutboundAttachment(4, pool, null);
    expect(r.ok).toBe(true);
  });

  // Q-05 : channex + ota_name null → fail-closed même avec compte valide
  test('Q-05 : channex + null ota_name → CHANNEL_NOT_SUPPORTED, aucun appel Channex', async () => {
    const pool = makePool({ ...baseAtt, id: 5, ota_name: null });
    const r = await sendOutboundAttachment(5, pool, null);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CHANNEL_NOT_SUPPORTED');
    expect(channex.uploadChannexAttachment).not.toHaveBeenCalled();
    expect(channex.sendBookingAttachment).not.toHaveBeenCalled();
  });

  // Q-06 : platform='airbnb' direct (sans channex), ota_name=null → autorisé
  test('Q-06 : platform=airbnb direct + ota_name=null → pipeline ok', async () => {
    const pool = makePool({ ...baseAtt, id: 6, platform: 'airbnb', ota_name: null });
    const r = await sendOutboundAttachment(6, pool, null);
    expect(r.ok).toBe(true);
  });

  // Q-07 : platform='direct' → fail-closed, aucun appel Channex
  test('Q-07 : platform=direct → CHANNEL_NOT_SUPPORTED', async () => {
    const pool = makePool({ ...baseAtt, id: 7, platform: 'direct', ota_name: 'Airbnb' });
    const r = await sendOutboundAttachment(7, pool, null);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CHANNEL_NOT_SUPPORTED');
    expect(channex.uploadChannexAttachment).not.toHaveBeenCalled();
  });

  // Q-08 : idempotence — provider_attachment_id déjà renseigné → skip upload, envoie message
  test('Q-08 : provider_attachment_id déjà renseigné → skip Cloudinary+upload, envoie message', async () => {
    const pool = makePool({
      ...baseAtt, id: 8, ota_name: 'Airbnb',
      provider_attachment_id: 'already-uploaded-id',
    });
    const r = await sendOutboundAttachment(8, pool, null);
    expect(r.ok).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
    expect(channex.uploadChannexAttachment).not.toHaveBeenCalled();
    expect(channex.sendBookingAttachment).toHaveBeenCalledWith('bk-xyz', 'already-uploaded-id');
  });

  // Q-09 : direction inbound → ignoré
  test('Q-09 : direction=inbound → skipped (not_outbound)', async () => {
    const pool = makePool({ ...baseAtt, id: 9, ota_name: 'Airbnb', direction: 'inbound' });
    const r = await sendOutboundAttachment(9, pool, null);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('not_outbound');
  });

  // Q-10 : status=sent → déjà traité, ignoré
  test('Q-10 : status=sent → skipped (already_sent)', async () => {
    const pool = makePool({ ...baseAtt, id: 10, ota_name: 'Airbnb', status: 'sent' });
    const r = await sendOutboundAttachment(10, pool, null);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('already_sent');
  });
});
