'use strict';
/**
 * IOS-INVOICE-SEND-CONVERSATION-1B — invoice send-to-conversation lookup
 *
 * Suite E : conversationId direct path (no regression)
 * Suite F : reservationUid dual-lookup (Channex bridge)
 * Suite G : Channex conversation creation backfill
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

function extractBlock(marker, content, limit = 3000) {
  const idx = content.indexOf(marker);
  if (idx === -1) return '';
  return content.slice(idx, idx + limit);
}

// Anchor on the route handler body
const sendToConvBlock = extractBlock("conversationId ou reservationUid requis", serverSrc, 4000);
const convIdBlock     = extractBlock("if (conversationId)", serverSrc, 600);
const dualLookupBlock = extractBlock("Dual lookup: exact reservation_uid match", serverSrc, 1200);
const channexInsert   = extractBlock("// 2. Créer la conversation", serverSrc, 1200);
const channexBackfill = extractBlock("Backfill reservation_uid on existing conversations", serverSrc, 300);

// ─── Suite E : conversationId direct path ────────────────────────────────────

describe('E — conversationId direct path (no regression)', () => {

  test('E-01: 400 when neither conversationId nor reservationUid provided', () => {
    expect(sendToConvBlock).toContain("conversationId ou reservationUid requis");
  });

  test('E-02: conversationId path queries by c.id = $1', () => {
    expect(convIdBlock).toContain('c.id = $1');
  });

  test('E-03: conversationId path scoped to c.user_id = ANY($2::text[])', () => {
    expect(convIdBlock).toContain('c.user_id = ANY($2::text[])');
  });

  test('E-04: 404 emitted when no conversation found', () => {
    expect(sendToConvBlock).toContain("Conversation introuvable");
    expect(sendToConvBlock).toContain('status(404)');
  });

  test('E-05: conversationId path does NOT use the dual-lookup JOIN', () => {
    // The direct path must not contain the channex bridge JOIN
    expect(convIdBlock).not.toContain('LEFT JOIN reservations r');
  });
});

// ─── Suite F : reservationUid dual-lookup ────────────────────────────────────

describe('F — reservationUid dual-lookup (Channex bridge)', () => {

  test('F-01: dual-lookup block is present (marker comment exists)', () => {
    expect(dualLookupBlock).not.toHaveLength(0);
  });

  test('F-02: dual-lookup JOINs reservations on r.uid = $1', () => {
    expect(dualLookupBlock).toContain('LEFT JOIN reservations r ON r.uid = $1');
  });

  test('F-03: account isolation on JOIN: r.user_id = ANY($2::text[])', () => {
    expect(dualLookupBlock).toContain('r.user_id = ANY($2::text[])');
  });

  test('F-04: direct arm matches c.reservation_uid = $1', () => {
    expect(dualLookupBlock).toContain('c.reservation_uid = $1');
  });

  test('F-05: Channex bridge arm matches c.channex_booking_id = r.channex_booking_id', () => {
    expect(dualLookupBlock).toContain('c.channex_booking_id = r.channex_booking_id');
  });

  test('F-06: bridge arm guards both sides non-null', () => {
    expect(dualLookupBlock).toContain('r.channex_booking_id IS NOT NULL');
    expect(dualLookupBlock).toContain('c.channex_booking_id IS NOT NULL');
  });

  test('F-07: result scoped to conversation owner: AND c.user_id = ANY($2::text[])', () => {
    expect(dualLookupBlock).toContain('AND c.user_id = ANY($2::text[])');
  });

  test('F-08: exact uid match ordered first (ORDER BY reservation_uid = $1 DESC)', () => {
    expect(dualLookupBlock).toContain('ORDER BY (c.reservation_uid = $1) DESC');
  });

  test('F-09: LIMIT 1 present on dual-lookup', () => {
    const limitIdx = dualLookupBlock.indexOf('LIMIT 1');
    expect(limitIdx).toBeGreaterThan(-1);
  });

  test('F-10: post-lookup resUid falls back to conversation.reservation_uid', () => {
    // After the conversation is found, resUid = reservationUid || conversation.reservation_uid
    expect(serverSrc).toContain('reservationUid || conversation.reservation_uid');
  });
});

// ─── Suite G : Channex conversation creation backfill ────────────────────────

describe('G — Channex conversation creation backfill', () => {

  test('G-01: new Channex conversation INSERT includes reservation_uid column', () => {
    expect(channexInsert).toContain('reservation_uid');
  });

  test('G-02: new Channex conversation INSERT uses $12 for reservation_uid', () => {
    expect(channexInsert).toContain('$12');
  });

  test('G-03: new Channex conversation INSERT passes result.uid as 12th param', () => {
    expect(channexInsert).toContain('result.uid || null');
  });

  test('G-04: existing Channex conversation backfill UPDATE is present', () => {
    expect(channexBackfill).not.toHaveLength(0);
  });

  test('G-05: backfill UPDATE sets reservation_uid = $1 only when IS NULL', () => {
    expect(channexBackfill).toContain('reservation_uid = $1');
    expect(channexBackfill).toContain('reservation_uid IS NULL');
  });

  test('G-06: backfill UPDATE scoped to the correct conversation id = $2', () => {
    expect(channexBackfill).toContain('id = $2');
  });

  test('G-07: backfill only runs when result.uid is truthy', () => {
    // Guard: if (result.uid) { ... UPDATE ... }
    const guardIdx  = serverSrc.indexOf('if (result.uid)');
    const updateIdx = serverSrc.indexOf('UPDATE conversations SET reservation_uid');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(guardIdx);
  });
});
