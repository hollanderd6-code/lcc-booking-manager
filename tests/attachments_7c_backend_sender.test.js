'use strict';
/**
 * ATTACHMENTS-7C-BACKEND-SENDER
 *
 * Tests unitaires / comportementaux pour :
 *   services/channex-attachment-sender.js
 *
 * G. resolveOutboundOta + supportsOutboundImage — 13 cas comportementaux
 * H. sendOutboundAttachment — pipeline complet avec mocks
 */

// ── Mocks top-level (hoistés par Jest avant l'import du module) ───────────────
jest.mock('axios');
jest.mock('../channex', () => ({
  uploadChannexAttachment: jest.fn(),
  sendBookingAttachment:   jest.fn(),
}));
// cloudinary.url() est appelé dans downloadFromCloudinary — retourner n'importe quelle URL
jest.mock('cloudinary', () => ({
  v2: {
    url: jest.fn().mockReturnValue('https://signed.cloudinary.example/img'),
  },
}), { virtual: false });

const axios   = require('axios');
const channex = require('../channex');

const {
  resolveOutboundOta,
  supportsOutboundImage,
  sendOutboundAttachment,
} = require('../services/channex-attachment-sender');

// JPEG magic bytes valides pour validateOutboundImageBuffer
const VALID_JPEG = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
  Buffer.alloc(200), // padding > 12 bytes
]);

// ── G. resolveOutboundOta + supportsOutboundImage ────────────────────────────
describe('G. PROD-FIX-7 — resolveOutboundOta + supportsOutboundImage (backend)', () => {
  const supports = (platform, otaName) =>
    supportsOutboundImage(resolveOutboundOta(platform, otaName));

  test('G-01 : platform="channex" + ota_name="Airbnb" → resolved="airbnb", autorisé', () => {
    expect(resolveOutboundOta('channex', 'Airbnb')).toBe('airbnb');
    expect(supports('channex', 'Airbnb')).toBe(true);
  });

  test('G-02 : platform="channex" + ota_name="AirBNB" → autorisé', () => {
    expect(supports('channex', 'AirBNB')).toBe(true);
  });

  test('G-03 : platform="channex" + ota_name="Abb" → autorisé', () => {
    expect(supports('channex', 'Abb')).toBe(true);
  });

  test('G-04 : platform="channex" + ota_name="BookingCom" → autorisé', () => {
    expect(supports('channex', 'BookingCom')).toBe(true);
  });

  test('G-05 : platform="channex" + ota_name="Bdc" → autorisé', () => {
    expect(supports('channex', 'Bdc')).toBe(true);
  });

  test('G-06 : platform="channex" + ota_name="Expedia" → autorisé', () => {
    expect(supports('channex', 'Expedia')).toBe(true);
  });

  test('G-07 : platform="channex" + ota_name="Exp" → resolved="exp", autorisé', () => {
    expect(resolveOutboundOta('channex', 'Exp')).toBe('exp');
    expect(supports('channex', 'Exp')).toBe(true);
  });

  test('G-08 : platform="channex" + ota_name=null → resolved="", refusé (fail-closed)', () => {
    expect(resolveOutboundOta('channex', null)).toBe('');
    expect(supports('channex', null)).toBe(false);
  });

  test('G-09 : platform="direct" + ota_name="Airbnb" → resolved="direct", refusé', () => {
    expect(resolveOutboundOta('direct', 'Airbnb')).toBe('direct');
    expect(supports('direct', 'Airbnb')).toBe(false);
  });

  test('G-10 : platform="ical" + ota_name="BookingCom" → resolved="ical", refusé', () => {
    expect(resolveOutboundOta('ical', 'BookingCom')).toBe('ical');
    expect(supports('ical', 'BookingCom')).toBe(false);
  });

  test('G-11 : platform="airbnb" + ota_name=null → autorisé (chemin direct sans fallback)', () => {
    expect(supports('airbnb', null)).toBe(true);
  });

  test('G-12 : platform="booking" + ota_name=null → autorisé', () => {
    expect(supports('booking', null)).toBe(true);
  });

  test('G-13 : platform="expedia" + ota_name=null → autorisé', () => {
    expect(supports('expedia', null)).toBe(true);
  });
});

// ── H. sendOutboundAttachment — pipeline complet ─────────────────────────────
describe('H. PROD-FIX-7 — sendOutboundAttachment pipeline (mocks)', () => {

  // Factory pool : retourne attRow pour le SELECT initial, {} pour les UPDATE
  const makePool = (attRow) => ({
    query: jest.fn().mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('FROM message_attachments ma')) {
        return { rows: [attRow] };
      }
      return { rows: [] };
    }),
  });

  const attAirbnbChannex = {
    id: 1,
    message_id: 10,
    conversation_id: 100,
    type: 'image',
    mime_type: 'image/jpeg',
    filename: 'test.jpg',
    size_bytes: 50000,
    cloudinary_public_id: 'test/public_id',
    provider_attachment_id: null,
    processing_attempts: 0,
    direction: 'outbound',
    status: 'stored',
    channex_booking_id: 'booking-abc',
    platform: 'channex',
    ota_name: 'Airbnb',
    user_id: 999,
  };

  const attChannexNoOta = {
    ...attAirbnbChannex,
    id: 2,
    ota_name: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Cloudinary download → JPEG valide
    axios.get.mockResolvedValue({ data: VALID_JPEG });
    // Channex API success par défaut
    channex.uploadChannexAttachment.mockResolvedValue('channex-att-id-123');
    channex.sendBookingAttachment.mockResolvedValue({ success: true });
  });

  // H-01 : platform='channex' + ota_name='Airbnb' → pipeline complet, PAS de CHANNEL_NOT_SUPPORTED
  test('H-01 : channex+Airbnb → uploadChannexAttachment appelé, status=sent', async () => {
    const pool = makePool(attAirbnbChannex);

    const result = await sendOutboundAttachment(1, pool, null);

    expect(result.ok).toBe(true);

    // CHANNEL_NOT_SUPPORTED ne doit pas avoir été écrit en DB
    const failCalls = pool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('CHANNEL_NOT_SUPPORTED')
    );
    expect(failCalls).toHaveLength(0);

    // Cloudinary téléchargé
    expect(axios.get).toHaveBeenCalledTimes(1);

    // Channex upload + message appelés
    expect(channex.uploadChannexAttachment).toHaveBeenCalledTimes(1);
    expect(channex.sendBookingAttachment).toHaveBeenCalledWith(
      'booking-abc', 'channex-att-id-123'
    );

    // status = 'sent' écrit en DB
    const sentCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes("status='sent'")
    );
    expect(sentCall).toBeTruthy();
  });

  // H-02 : platform='channex' + ota_name=null → fail-closed, aucun appel Channex
  test('H-02 : channex+null → CHANNEL_NOT_SUPPORTED, aucun appel Channex ni Cloudinary', async () => {
    const pool = makePool(attChannexNoOta);

    const result = await sendOutboundAttachment(2, pool, null);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('CHANNEL_NOT_SUPPORTED');

    // Aucun appel Cloudinary ni Channex
    expect(axios.get).not.toHaveBeenCalled();
    expect(channex.uploadChannexAttachment).not.toHaveBeenCalled();
    expect(channex.sendBookingAttachment).not.toHaveBeenCalled();

    // status='failed' + last_error_code='CHANNEL_NOT_SUPPORTED' en DB
    const failCall = pool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('CHANNEL_NOT_SUPPORTED')
    );
    expect(failCall).toBeTruthy();
  });
});
