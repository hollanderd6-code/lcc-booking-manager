// ============================================================
// channex.js — Module d'intégration Channex pour Boostinghost
// ============================================================

const axios = require('axios');

const CHANNEX_API_URL = process.env.CHANNEX_ENV === 'production'
  ? 'https://app.channex.io/api/v1'
  : 'https://staging.channex.io/api/v1';

const CHANNEX_API_KEY = process.env.CHANNEX_API_KEY;

const channexAPI = axios.create({
  baseURL: CHANNEX_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'user-api-key': CHANNEX_API_KEY
  }
});

// ── Rate limiter simple (test 12 certification Channex) ──────
// Channex limite à ~40 req/min sur les restrictions et ~10 req/s global.
// On impose un délai minimum entre chaque appel outbound pour rester safe.
let _lastChannexCallAt = 0;
const CHANNEX_MIN_INTERVAL_MS = 150; // ~6-7 req/s max

channexAPI.interceptors.request.use(async (config) => {
  const now = Date.now();
  const elapsed = now - _lastChannexCallAt;
  if (elapsed < CHANNEX_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, CHANNEX_MIN_INTERVAL_MS - elapsed));
  }
  _lastChannexCallAt = Date.now();
  return config;
});

// ── Helper log ───────────────────────────────────────────────

async function logChannex(pool, { user_id, property_id, channex_property_id, event_type, direction, payload, status = 'success', error_message = null }) {
  try {
    await pool.query(
      `INSERT INTO channex_logs (user_id, property_id, channex_property_id, event_type, direction, payload, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user_id, property_id, channex_property_id, event_type, direction, JSON.stringify(payload), status, error_message]
    );
  } catch (e) {
    console.error('❌ [CHANNEX LOG ERROR]', e.message);
  }
}

// ── 1. Créer une propriété dans Channex ──────────────────────

async function createChannexProperty(pool, { user_id, property_id, name, address, city }) {
  try {
    console.log(`🏠 [CHANNEX] Création propriété: ${name}`);

    const res = await channexAPI.post('/properties', {
      property: {
        title: name,
        address: address || '',
        city: city || '',
        country_code: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        property_type: 'apartment',
        email: 'contact@boostinghost.fr'
      }
    });

    const channex_property_id = res.data.data.attributes.id;
    console.log(`✅ [CHANNEX] Propriété créée: ${channex_property_id}`);

    // Déléguer la création du room type + rate plan + mise à jour DB
    return await addRoomTypeToProperty(pool, { user_id, property_id, channex_property_id, name });

  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur création propriété:', errDetail);
    await logChannex(pool, {
      user_id, property_id,
      event_type: 'create_property',
      direction: 'outbound',
      payload: null,
      status: 'error',
      error_message: typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail)
    });
    throw e;
  }
}

// ── 1b. Rattacher un logement BH à une Channex property existante ──
// Crée un nouveau room type + rate plan sur la property, met à jour la DB.

async function addRoomTypeToProperty(pool, { user_id, property_id, channex_property_id, name }) {
  try {
    console.log(`🏠 [CHANNEX] Ajout room type "${name}" sur property ${channex_property_id}`);

    // Créer le Room Type
    const rtRes = await channexAPI.post('/room_types', {
      room_type: {
        property_id: channex_property_id,
        title: name,
        count_of_rooms: 1,
        occ_adults: 2,
        occ_children: 0,
        occ_infants: 0,
        default_occupancy: 2
      }
    });

    const channex_room_type_id = rtRes.data.data.attributes.id;
    console.log(`✅ [CHANNEX] Room Type créé: ${channex_room_type_id}`);

    // Créer le Rate Plan
    const rpRes = await channexAPI.post('/rate_plans', {
      rate_plan: {
        property_id: channex_property_id,
        room_type_id: channex_room_type_id,
        title: 'Tarif standard',
        sell_mode: 'per_room',
        rate_mode: 'manual',
        currency: 'EUR',
        options: [{ occupancy: 2, is_primary: true, rate: 0 }]
      }
    });

    const channex_rate_plan_id = rpRes.data.data.attributes.id;
    console.log(`✅ [CHANNEX] Rate Plan créé: ${channex_rate_plan_id}`);

    // Sauvegarder les IDs dans la DB
    await pool.query(
      `UPDATE properties
       SET channex_property_id = $1, channex_room_type_id = $2, channex_rate_plan_id = $3, channex_enabled = true
       WHERE id = $4`,
      [channex_property_id, channex_room_type_id, channex_rate_plan_id, property_id]
    );

    await logChannex(pool, {
      user_id, property_id, channex_property_id,
      event_type: 'add_room_type',
      direction: 'outbound',
      payload: { channex_property_id, channex_room_type_id, channex_rate_plan_id }
    });

    // ✅ Créer automatiquement les webhooks pour ce logement
    try {
      await channexAPI.post('/webhooks', {
        webhook: {
          property_id: channex_property_id,
          callback_url: 'https://www.boostinghost.fr/api/channex/webhook',
          event_mask: 'booking',
          is_active: true,
          send_data: true
        }
      });
      await channexAPI.post('/webhooks', {
        webhook: {
          property_id: channex_property_id,
          callback_url: 'https://www.boostinghost.fr/api/channex/webhook-message',
          event_mask: 'message',
          is_active: true,
          send_data: true
        }
      });
      console.log(`✅ [CHANNEX] Webhooks créés pour property ${channex_property_id}`);
    } catch (webhookErr) {
      // Non bloquant — les webhooks peuvent être créés manuellement si besoin
      console.warn(`⚠️ [CHANNEX] Erreur création webhooks (non bloquant):`, webhookErr.response?.data || webhookErr.message);
    }

    return { channex_property_id, channex_room_type_id, channex_rate_plan_id };

  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur addRoomTypeToProperty:', errDetail);
    await logChannex(pool, {
      user_id, property_id, channex_property_id,
      event_type: 'add_room_type',
      direction: 'outbound',
      payload: null,
      status: 'error',
      error_message: typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail)
    });
    throw e;
  }
}

// ── 2. Pousser les disponibilités vers Channex ────────────────

async function pushAvailability(pool, { property_id, channex_property_id, channex_room_type_id, dates_blocked = [], dates_to_update = null }) {
  try {
    console.log(`📅 [CHANNEX] Push disponibilités pour ${channex_property_id} (${dates_blocked.length} dates bloquées)`);

    const blockedSet = new Set(dates_blocked);
    const values = [];
    const today = new Date();

    if (dates_to_update && dates_to_update.length > 0) {
      // Mode partiel : envoyer seulement les dates concernées
      for (const dateStr of dates_to_update) {
        values.push({
          property_id: channex_property_id,
          room_type_id: channex_room_type_id,
          date: dateStr,
          availability: blockedSet.has(dateStr) ? 0 : 1
        });
      }
    } else {
      // Mode full sync : 500 jours
      for (let i = 0; i < 500; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        values.push({
          property_id: channex_property_id,
          room_type_id: channex_room_type_id,
          date: dateStr,
          availability: blockedSet.has(dateStr) ? 0 : 1
        });
      }
    }

    await channexAPI.post('/availability', { values });

    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'push_availability',
      direction: 'outbound',
      payload: { dates_count: values.length, blocked_count: dates_blocked.length }
    });

    console.log(`✅ [CHANNEX] Disponibilités poussées (${values.length} jours)`);

  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur push availability:', errDetail);
    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'push_availability',
      direction: 'outbound',
      status: 'error',
      error_message: typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail)
    });
    throw e;
  }
}

// ── 2b. Pousser les prix vers Channex ────────────────────────
async function pushRates(pool, { property_id, channex_property_id, channex_rate_plan_id, rates }) {
  // rates = [{ date: 'YYYY-MM-DD', price: 90 }, ...]
  try {
    console.log(`💰 [CHANNEX] Push tarifs pour ${channex_property_id} (${rates.length} jours)`);

    const values = rates.map(r => ({
      property_id: channex_property_id,
      rate_plan_id: channex_rate_plan_id,
      date: r.date,
      rate: Math.round(parseFloat(r.price) * 100) // centimes (ex: 70€ → 7000)
    }));

    // ✅ Channex utilise /restrictions pour pousser rates ET restrictions
    await channexAPI.post('/restrictions', { values });

    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'push_rates',
      direction: 'outbound',
      payload: { rates_count: values.length }
    });

    console.log(`✅ [CHANNEX] Tarifs poussés (${values.length} jours)`);
    return { success: true, count: values.length };

  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur push rates:', errDetail);
    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'push_rates',
      direction: 'outbound',
      status: 'error',
      error_message: typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail)
    });
    throw e;
  }
}



// ── 2c. Pousser les restrictions vers Channex (min_stay) ─────
async function pushRestrictions(pool, { property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id, restrictions }) {
  // restrictions = [{ date: 'YYYY-MM-DD', min_stay: 3 }, ...]
  try {
    console.log(`🔒 [CHANNEX] Push restrictions pour ${channex_property_id} (${restrictions.length} jours)`);

    const values = restrictions.map(r => ({
      property_id: channex_property_id,
      rate_plan_id: channex_rate_plan_id,
      date: r.date,
      ...(r.rate            != null ? { rate: Math.round(r.rate * 100) }     : {}),
      ...(r.min_stay        != null ? { min_stay_arrival: r.min_stay, min_stay_through: r.min_stay } : {}),
      ...(r.max_stay        != null ? { max_stay: r.max_stay }               : {}),
      ...(r.stop_sell       != null ? { stop_sell: r.stop_sell }             : {}),
      ...(r.closed_to_arrival   != null ? { closed_to_arrival: r.closed_to_arrival }   : {}),
      ...(r.closed_to_departure != null ? { closed_to_departure: r.closed_to_departure } : {})
    }));

    await channexAPI.post('/restrictions', { values });

    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'push_restrictions',
      direction: 'outbound',
      payload: { restrictions_count: values.length }
    });

    console.log(`✅ [CHANNEX] Restrictions poussées (${values.length} jours)`);
    return { success: true, count: values.length };

  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur push restrictions:', errDetail);
    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'push_restrictions',
      direction: 'outbound',
      status: 'error',
      error_message: typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail)
    });
    throw e;
  }
}

// ── Parser les notes Airbnb pour extraire les montants ──────
function parseAirbnbNotes(notes) {
  if (!notes) return {};
  const result = {};
  const lines = notes.split(/\r?\n/);
  for (const line of lines) {
    const [key, val] = line.split(':').map(s => s.trim());
    if (!key || !val) continue;
    const num = parseFloat(val);
    if (isNaN(num)) continue;
    // Mapping des clés Airbnb → noms BH
    if (/Listing Base Price/i.test(key))           result.airbnb_base_price      = num;
    if (/Total Paid Amount/i.test(key))             result.airbnb_total_paid      = num;
    if (/Transient Occupancy Tax/i.test(key))       result.airbnb_occupancy_tax   = num;
    if (/Listing Security Price/i.test(key))        result.airbnb_security_deposit= num;
    if (/Listing Cancellation Payout/i.test(key))   result.airbnb_host_payout     = num;
    if (/Listing Cancellation Host Fee/i.test(key)) result.airbnb_host_fee        = num;
    if (/Occupancy Tax Amount Paid To Host/i.test(key)) result.airbnb_tax_to_host = num;
    if (/Cleaning Fee/i.test(key))                  result.airbnb_cleaning_fee    = num;
    if (/Guest Service Fee/i.test(key))             result.airbnb_guest_fee       = num;
    if (/Host Service Fee/i.test(key))              result.airbnb_service_fee     = num;
  }
  return result;
}

async function processChannexBooking(pool, bookingData) {
  try {
    const attrs = bookingData.attributes || bookingData;
    // booking_id = le vrai ID du booking (pas de la revision)
    const booking_id = attrs.booking_id || bookingData.id || bookingData.attributes?.id;

    const {
      property_id: channex_property_id,
      arrival_date,
      departure_date,
      status: booking_status,
      ota_name,
      ota_reservation_code,
      revision_id,
      currency = 'EUR'
    } = attrs;

    // Extraire le room_type_id depuis le premier room du booking
    // (nécessaire pour résoudre le bon logement BH dans un scénario multi-appartements)
    const booking_room_type_id = (attrs.rooms || [])[0]?.room_type_id || null;

    // ── Données voyageur ──────────────────────────────────────
    const guest = attrs.customer || {};
    const guest_name = [guest.name, guest.surname].filter(Boolean).join(' ') || 'Voyageur';
    const guest_first_name = guest.name || null;
    const guest_last_name = guest.surname || null;
    const guest_email = guest.mail || guest.email || null;
    const guest_phone = guest.phone || null;
    const guest_country = guest.country || null; // code ISO ex: "FR"
    const guest_language = guest.language || null;
    const guest_city = guest.city || null;
    const guest_address = guest.address || null;
    const guest_zip = guest.zip || null;

    // ── Occupation ────────────────────────────────────────────
    const occupancy = attrs.occupancy || {};
    const occupancy_adults = occupancy.adults || 1;
    const occupancy_children = occupancy.children || 0;

    // ── Demandes spéciales / notes voyageur ───────────────────
    const arrival_hour = attrs.arrival_hour || null; // ex: "18:00"
    // Pour Airbnb les notes encodent les montants — pas des demandes textuelles
    const guest_special_request = (ota_name || '').toLowerCase().includes('airbnb')
      ? null
      : (attrs.notes || null);

    // ── Montants ─────────────────────────────────────────────
    const amount_total = parseFloat(attrs.amount || 0);
    const ota_commission = parseFloat(attrs.ota_commission || 0);

    // Rooms : prix par nuit, taxes, services
    const room = (attrs.rooms || [])[0] || {};
    const amount_rooms = parseFloat(room.amount || amount_total);
    const days_breakdown = room.days || {}; // { "2024-06-01": "120.00", ... }

    // Taxes (ex: taxe de séjour)
    const taxes = room.taxes || [];
    const amount_taxes = taxes.reduce((sum, t) => sum + parseFloat(t.total_price || 0), 0);

    // Services au niveau room (ex: ménage Airbnb)
    const room_services = room.services || [];
    // Services au niveau booking (ex: petit-déjeuner Booking.com)
    const booking_services = attrs.services || [];
    const all_services = [...room_services, ...booking_services];

    // Chercher le ménage dans tous les services (room + booking)
    const cleaning_service = all_services.find(s =>
      /clean|ménage|menage|cleaning|nettoyage/i.test(s.name || '')
    );
    const amount_cleaning = cleaning_service ? parseFloat(cleaning_service.total_price || 0) : 0;

    // 🔍 Log détaillé pour debug Booking.com
    const isBookingCom = (ota_name || '').toLowerCase().includes('booking');
    if (isBookingCom) {
      console.log(`🔍 [BDC] room.taxes:`, JSON.stringify(room.taxes || []));
      console.log(`🔍 [BDC] room.services:`, JSON.stringify(room_services));
      console.log(`🔍 [BDC] booking.services:`, JSON.stringify(booking_services));
      console.log(`🔍 [BDC] attrs.ota_commission:`, attrs.ota_commission);
      console.log(`🔍 [BDC] amount_total:`, amount_total, '| amount_rooms:', amount_rooms);
    }

    // Pour Airbnb : les montants détaillés sont dans notes
    const notes = attrs.notes || '';
    const airbnbData = (ota_name || '').toLowerCase().includes('airbnb')
      ? parseAirbnbNotes(notes)
      : {};

    // ── Booking.com : extraire taxe de séjour depuis taxes room ──────────────
    // Booking.com envoie city_tax / CITYTAX dans room.taxes
    let bdc_city_tax = 0;
    if (isBookingCom && room.taxes && room.taxes.length > 0) {
      const cityTax = room.taxes.find(t =>
        /city.?tax|taxe.?s.?jour|citytax|tourist/i.test(t.name || t.type || '')
      );
      if (cityTax) bdc_city_tax = parseFloat(cityTax.total_price || 0);
      else {
        // Si une seule taxe non-inclusive, c'est probablement la taxe de séjour
        const nonInclusive = room.taxes.filter(t => !t.is_inclusive);
        if (nonInclusive.length === 1) bdc_city_tax = parseFloat(nonInclusive[0].total_price || 0);
      }
    }

    // ── Booking.com : commission = différence total - rooms si ota_commission = 0 ──
    // Booking.com ne communique pas toujours la commission dans le booking
    let bdc_commission = parseFloat(attrs.ota_commission || 0);
    if (isBookingCom && bdc_commission === 0 && amount_total > 0 && amount_rooms > 0 && amount_rooms > amount_total) {
      // cas rare où amount_rooms inclut tout
    }

    // Enrichir les montants avec les données Airbnb si disponibles
    const final_amount_cleaning = airbnbData.airbnb_cleaning_fee  || amount_cleaning || null;
    const final_ota_commission   = airbnbData.airbnb_service_fee  || (isBookingCom ? bdc_commission : ota_commission) || null;
    const final_amount_taxes     = airbnbData.airbnb_occupancy_tax || (isBookingCom ? bdc_city_tax : amount_taxes) || null;
    const final_host_payout      = airbnbData.airbnb_host_payout  || null;

    console.log(`📥 [CHANNEX] Booking reçu: ${booking_id} | ${ota_name} | ${arrival_date} → ${departure_date} | ${guest_name} | ${guest_country || '?'}`);

    // Trouver le logement Boostinghost correspondant
    // Priorité : room_type_id (précis, indispensable en multi-appartements)
    // Fallback  : channex_property_id seul (cas 1 logement = 1 property)
    let propResult;
    if (booking_room_type_id) {
      propResult = await pool.query(
        'SELECT id, user_id FROM properties WHERE channex_room_type_id = $1 AND channex_property_id = $2',
        [booking_room_type_id, channex_property_id]
      );
      if (propResult.rows.length === 0) {
        // Fallback au cas où le room_type_id ne matche pas (migration, ancien logement)
        console.warn(`⚠️ [CHANNEX] room_type_id ${booking_room_type_id} non trouvé, fallback sur property_id`);
        propResult = await pool.query(
          'SELECT id, user_id FROM properties WHERE channex_property_id = $1 LIMIT 1',
          [channex_property_id]
        );
      }
    } else {
      propResult = await pool.query(
        'SELECT id, user_id FROM properties WHERE channex_property_id = $1 LIMIT 1',
        [channex_property_id]
      );
    }

    if (propResult.rows.length === 0) {
      console.warn(`⚠️ [CHANNEX] Propriété non trouvée pour channex_id: ${channex_property_id} / room_type: ${booking_room_type_id}`);
      return null;
    }

    const { id: property_id, user_id } = propResult.rows[0];

    // Vérifier si réservation déjà existante
    // 1. Par channex_booking_id exact
    let existing = await pool.query(
      'SELECT id, uid FROM reservations WHERE channex_booking_id = $1',
      [booking_id]
    );

    // 2. Fallback : même logement + mêmes dates + même voyageur (Channex peut changer le booking_id lors d'une modif)
    if (existing.rows.length === 0 && arrival_date && departure_date && property_id) {
      const dupCheck = await pool.query(
        `SELECT id, uid FROM reservations
         WHERE property_id = $1
           AND start_date = $2
           AND end_date = $3
           AND status != 'cancelled'
           AND source = 'channex'
         ORDER BY created_at DESC LIMIT 1`,
        [property_id, arrival_date, departure_date]
      );
      if (dupCheck.rows.length > 0) {
        console.log(`⚠️ [CHANNEX] Doublon détecté par dates: booking_id=${booking_id} correspond à ${dupCheck.rows[0].uid} → mise à jour au lieu de créer`);
        // Mettre à jour le channex_booking_id pour pointer vers le nouveau booking_id
        await pool.query(
          'UPDATE reservations SET channex_booking_id = $1, updated_at = NOW() WHERE id = $2',
          [booking_id, dupCheck.rows[0].id]
        );
        existing = dupCheck;
      }
    }

    // Annulation
    if (booking_status === 'cancelled' || booking_status === 'canceled') {
      if (existing.rows.length > 0) {
        await pool.query(
          "UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE channex_booking_id = $1",
          [booking_id]
        );
        console.log(`🚫 [CHANNEX] Réservation annulée: ${booking_id}`);
        // Retourner la réservation pour déclencher notif + mise à jour store
        const cancelledRow = await pool.query(
          'SELECT * FROM reservations WHERE channex_booking_id = $1',
          [booking_id]
        );
        return cancelledRow.rows[0] || null;
      }
      return null;
    }

    if (existing.rows.length > 0) {
      // Mettre à jour dates + données enrichies (modification)
      await pool.query(
        `UPDATE reservations SET
          start_date = $1, end_date = $2,
          guest_first_name = $3, guest_last_name = $4, guest_country = $5,
          guest_language = $6, guest_city = $7, guest_address = $8, guest_zip = $9,
          occupancy_adults = $10, occupancy_children = $11,
          amount_total = $12, amount_rooms = $13, amount_taxes = $14,
          amount_cleaning = $15, ota_commission = $16,
          days_breakdown = $17, services_raw = $18,
          currency = $19, host_payout = $20, airbnb_data = $21,
          notes = COALESCE($22, notes),
          status = CASE WHEN status = 'cancelled' THEN 'confirmed' ELSE status END,
          updated_at = NOW()
         WHERE channex_booking_id = $23`,
        [
          arrival_date, departure_date,
          guest_first_name, guest_last_name, guest_country,
          guest_language, guest_city, guest_address, guest_zip,
          occupancy_adults, occupancy_children,
          amount_total, amount_rooms, final_amount_taxes,
          final_amount_cleaning, final_ota_commission,
          JSON.stringify(days_breakdown), JSON.stringify(all_services),
          currency, final_host_payout,
          Object.keys(airbnbData).length ? JSON.stringify(airbnbData) : null,
          guest_special_request,
          booking_id
        ]
      );
      // Récupérer la ligne complète pour avoir property_id, user_id, etc.
      const fullRow = await pool.query(
        'SELECT * FROM reservations WHERE channex_booking_id = $1',
        [booking_id]
      );
      console.log(`ℹ️ [CHANNEX] Réservation mise à jour: ${existing.rows[0].uid}`);
      return fullRow.rows[0] || existing.rows[0];
    }

    // Créer la réservation avec toutes les données
    const uid = `CHX_${booking_id}`;
    const result = await pool.query(
      `INSERT INTO reservations 
        (uid, property_id, user_id, start_date, end_date,
         guest_name, guest_first_name, guest_last_name, guest_email, guest_phone,
         guest_country, guest_language, guest_city, guest_address, guest_zip,
         occupancy_adults, occupancy_children,
         amount_total, amount_rooms, amount_taxes, amount_cleaning, ota_commission,
         days_breakdown, services_raw, currency,
         host_payout, airbnb_data,
         platform, source, status,
         channex_booking_id, channex_revision_id, ota_name, ota_reservation_id,
         notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       RETURNING *`,
      [
        uid, property_id, user_id,
        arrival_date, departure_date,
        guest_name, guest_first_name, guest_last_name, guest_email, guest_phone,
        guest_country, guest_language, guest_city, guest_address, guest_zip,
        occupancy_adults, occupancy_children,
        amount_total, amount_rooms, final_amount_taxes, final_amount_cleaning, final_ota_commission,
        JSON.stringify(days_breakdown), JSON.stringify(all_services), currency,
        final_host_payout,
        Object.keys(airbnbData).length ? JSON.stringify(airbnbData) : null,
        ota_name || 'channex', 'channex', 'confirmed',
        booking_id, revision_id || null,
        ota_name || null, ota_reservation_code || null,
        guest_special_request || null
      ]
    );

    await logChannex(pool, {
      user_id, property_id, channex_property_id,
      event_type: 'receive_booking',
      direction: 'inbound',
      payload: { booking_id, ota_name, arrival_date, departure_date, guest_country, amount_total }
    });

    console.log(`✅ [CHANNEX] Réservation créée: ${uid} | ${guest_name} | ${guest_country} | ${amount_total}${currency}`);
    return result.rows[0];

  } catch (e) {
    console.error('❌ [CHANNEX] Erreur traitement réservation:', e.message);
    throw e;
  }
}


// ── Accusé de réception d'une réservation (requis par Channex) ──
// ── Créer un booking dans Channex (résa créée manuellement dans BH) ──
async function createChannexBooking(pool, {
  property_id, channex_property_id, channex_room_type_id, channex_rate_plan_id,
  arrival_date, departure_date, guest_name, guest_email, amount_total, currency = 'EUR', source = 'direct'
}) {
  try {
    console.log(`📤 [CHANNEX] Création booking pour ${channex_property_id} (${arrival_date} → ${departure_date})`);

    // Channex ne supporte pas la création de booking via API publique
    // On bloque les dates via availability (already done via triggerChannexAvailabilitySync)
    // et on log l'événement pour traçabilité
    await logChannex(pool, {
      property_id, channex_property_id,
      event_type: 'create_booking_bh',
      direction: 'outbound',
      payload: { arrival_date, departure_date, guest_name, amount_total, source }
    });

    console.log(`✅ [CHANNEX] Dates bloquées pour booking BH (${arrival_date} → ${departure_date})`);
    return { success: true };

  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur création booking BH:', errDetail);
    return { success: false, error: errDetail };
  }
}


async function bookingAcknowledge(revision_id) {
  try {
    await channexAPI.post(`/booking_revisions/${revision_id}/ack`);
    console.log(`✅ [CHANNEX] Acknowledge envoyé pour revision ${revision_id}`);
    return true;
  } catch (e) {
    // Ne pas bloquer le traitement si l'acknowledge échoue
    console.error(`⚠️ [CHANNEX] Erreur acknowledge revision ${revision_id}:`, e.response?.data || e.message);
    return false;
  }
}

// ── 5. Récupérer les messages d'une réservation ──────────────
async function getBookingMessages(channex_booking_id) {
  try {
    const res = await channexAPI.get(`/bookings/${channex_booking_id}/messages`);
    const messages = res.data.data || [];
    return messages.map(m => {
      const attrs = m.attributes || m;
      return {
        id: m.id,
        message: attrs.message || '',
        sender: attrs.sender || 'guest',
        attachments: attrs.attachments || [],
        inserted_at: attrs.inserted_at || null
      };
    });
  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur get messages:', errDetail);
    throw e;
  }
}

// ── 6. Envoyer un message vers la plateforme via Channex ─────
async function sendBookingMessage(channex_booking_id, message) {
  try {
    console.log(`📤 [CHANNEX] Envoi message booking ${channex_booking_id}`);
    const res = await channexAPI.post(`/bookings/${channex_booking_id}/messages`, {
      message: { message }
    });
    console.log(`✅ [CHANNEX] Message envoyé`);
    return res.data.data;
  } catch (e) {
    const errDetail = e.response?.data || e.message;
    console.error('❌ [CHANNEX] Erreur envoi message:', errDetail);
    throw e;
  }
}

// ── Lister les propriétés existantes dans Channex ────────────
async function listChannexProperties() {
  try {
    const res = await channexAPI.get('/properties', {
      params: { 'pagination[page_size]': 100, 'pagination[page]': 1 }
    });
    const data = res.data?.data || res.data || [];
    return Array.isArray(data) ? data.map(p => ({
      id: p.id,
      name: p.attributes?.title || p.attributes?.name || p.id,
      city: p.attributes?.city || '',
      rooms: p.attributes?.rooms_count || null
    })) : [];
  } catch (e) {
    console.error('❌ [CHANNEX] listChannexProperties:', e.message);
    return [];
  }
}

// ── Lister les room_types d'une propriété Channex ────────────
async function listChannexRoomTypes(channex_property_id) {
  try {
    const res = await channexAPI.get('/room_types', {
      params: { property_id: channex_property_id, 'pagination[page_size]': 100, 'pagination[page]': 1 }
    });
    const data = res.data?.data || res.data || [];
    return Array.isArray(data) ? data.map(rt => ({
      id: rt.id,
      name: rt.attributes?.title || rt.attributes?.name || rt.id
    })) : [];
  } catch (e) {
    console.error('❌ [CHANNEX] listChannexRoomTypes:', e.message);
    return [];
  }
}

// ── Lister les rate_plans d'un room_type Channex ────────────
async function listChannexRatePlans(channex_room_type_id) {
  try {
    const res = await channexAPI.get('/rate_plans', {
      params: { room_type_id: channex_room_type_id, 'pagination[page_size]': 100, 'pagination[page]': 1 }
    });
    const data = res.data?.data || res.data || [];
    return Array.isArray(data) ? data.map(rp => ({
      id: rp.id,
      name: rp.attributes?.title || rp.attributes?.name || rp.id
    })) : [];
  } catch (e) {
    console.error('❌ [CHANNEX] listChannexRatePlans:', e.message);
    return [];
  }
}

module.exports = {
  createChannexProperty,
  addRoomTypeToProperty,
  listChannexProperties,
  listChannexRoomTypes,
  listChannexRatePlans,
  pushAvailability,
  pushRates,
  pushRestrictions,
  createChannexBooking,
  bookingAcknowledge,
  processChannexBooking,
  getBookingMessages,
  sendBookingMessage,
  logChannex,
  channexAPI
};
