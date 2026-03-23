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

    // Créer la propriété
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
      event_type: 'create_property',
      direction: 'outbound',
      payload: { channex_property_id, channex_room_type_id, channex_rate_plan_id }
    });

    return { channex_property_id, channex_room_type_id, channex_rate_plan_id };

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

// ── 2. Pousser les disponibilités vers Channex ────────────────

async function pushAvailability(pool, { property_id, channex_property_id, channex_room_type_id, dates_blocked = [] }) {
  try {
    console.log(`📅 [CHANNEX] Push disponibilités pour ${channex_property_id} (${dates_blocked.length} dates bloquées)`);

    const blockedSet = new Set(dates_blocked);
    const values = [];
    const today = new Date();

    for (let i = 0; i < 365; i++) {
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
      rate_plan_id: channex_rate_plan_id,
      date: r.date,
      rate: parseFloat(r.price).toFixed(2)
    }));

    await channexAPI.post('/rates', { values });

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
      rate_plan_id: channex_rate_plan_id,
      date: r.date,
      ...(r.min_stay != null ? { min_stay: r.min_stay } : {}),
      ...(r.max_stay != null ? { max_stay: r.max_stay } : {}),
      ...(r.closed_to_arrival != null ? { closed_to_arrival: r.closed_to_arrival } : {}),
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

async function processChannexBooking(pool, bookingData) {
  try {
    const booking_id = bookingData.id || bookingData.attributes?.id;
    const attrs = bookingData.attributes || bookingData;

    const {
      property_id: channex_property_id,
      arrival_date,
      departure_date,
      status: booking_status,
      ota_name,
      ota_reservation_id,
      revision_id
    } = attrs;

    const guest = attrs.customer || {};
    const guest_name = [guest.name, guest.surname].filter(Boolean).join(' ') || 'Voyageur';
    const guest_email = guest.email || null;
    const guest_phone = guest.phone || null;

    console.log(`📥 [CHANNEX] Booking reçu: ${booking_id} | ${ota_name} | ${arrival_date} → ${departure_date}`);

    // Trouver le logement Boostinghost correspondant
    const propResult = await pool.query(
      'SELECT id, user_id FROM properties WHERE channex_property_id = $1',
      [channex_property_id]
    );

    if (propResult.rows.length === 0) {
      console.warn(`⚠️ [CHANNEX] Propriété non trouvée pour channex_id: ${channex_property_id}`);
      return null;
    }

    const { id: property_id, user_id } = propResult.rows[0];

    // Vérifier si réservation déjà existante
    const existing = await pool.query(
      'SELECT id, uid FROM reservations WHERE channex_booking_id = $1',
      [booking_id]
    );

    // Annulation
    if (booking_status === 'cancelled' || booking_status === 'canceled') {
      if (existing.rows.length > 0) {
        await pool.query(
          "UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE channex_booking_id = $1",
          [booking_id]
        );
        console.log(`🚫 [CHANNEX] Réservation annulée: ${booking_id}`);
      }
      return null;
    }

    if (existing.rows.length > 0) {
      console.log(`ℹ️ [CHANNEX] Réservation déjà existante: ${existing.rows[0].uid}`);
      return existing.rows[0];
    }

    // Créer la réservation
    const uid = `CHX_${booking_id}`;
    const result = await pool.query(
      `INSERT INTO reservations 
        (uid, property_id, user_id, start_date, end_date, guest_name, guest_email, guest_phone,
         platform, source, status, channex_booking_id, channex_revision_id, ota_name, ota_reservation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        uid, property_id, user_id,
        arrival_date, departure_date,
        guest_name, guest_email, guest_phone,
        ota_name || 'channex', 'channex', 'confirmed',
        booking_id, revision_id || null,
        ota_name || null, ota_reservation_id || null
      ]
    );

    await logChannex(pool, {
      user_id, property_id, channex_property_id,
      event_type: 'receive_booking',
      direction: 'inbound',
      payload: { booking_id, ota_name, arrival_date, departure_date }
    });

    console.log(`✅ [CHANNEX] Réservation créée: ${uid}`);
    return result.rows[0];

  } catch (e) {
    console.error('❌ [CHANNEX] Erreur traitement réservation:', e.message);
    throw e;
  }
}

module.exports = {
  createChannexProperty,
  pushAvailability,
  pushRates,
  pushRestrictions,
  processChannexBooking,
  logChannex,
  channexAPI
};
