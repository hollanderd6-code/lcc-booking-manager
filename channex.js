// ============================================================
// channex.js — Module d'intégration Channex pour Boostinghost
// ============================================================

const axios = require('axios');

const CHANNEX_API_URL = 'https://staging.channex.io/api/v1'; // à changer en prod
const CHANNEX_API_KEY = process.env.CHANNEX_API_KEY;

const channexAPI = axios.create({
  baseURL: CHANNEX_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'user-api-key': CHANNEX_API_KEY
  }
});

// ── Helpers ──────────────────────────────────────────────────

async function logChannex(supabase, { user_id, property_id, channex_property_id, event_type, direction, payload, status = 'success', error_message = null }) {
  try {
    await supabase.from('channex_logs').insert({
      user_id, property_id, channex_property_id,
      event_type, direction, payload, status, error_message
    });
  } catch (e) {
    console.error('❌ [CHANNEX LOG ERROR]', e.message);
  }
}

// ── 1. Créer une propriété dans Channex ──────────────────────

async function createChannexProperty(supabase, { user_id, property_id, name, address, city }) {
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
        property_type: 'VacationRental',
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
        occ_children: 0
      }
    });

    const channex_room_type_id = rtRes.data.data.attributes.id;

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

    // Sauvegarder les IDs dans Supabase
    await supabase.from('properties').update({
      channex_property_id,
      channex_room_type_id,
      channex_rate_plan_id,
      channex_enabled: true
    }).eq('id', property_id);

    await logChannex(supabase, {
      user_id, property_id, channex_property_id,
      event_type: 'create_property',
      direction: 'outbound',
      payload: { channex_property_id, channex_room_type_id, channex_rate_plan_id }
    });

    return { channex_property_id, channex_room_type_id, channex_rate_plan_id };

  } catch (e) {
    console.error('❌ [CHANNEX] Erreur création propriété:', e.response?.data || e.message);
    await logChannex(supabase, {
      user_id, property_id,
      event_type: 'create_property',
      direction: 'outbound',
      payload: null,
      status: 'error',
      error_message: e.message
    });
    throw e;
  }
}

// ── 2. Pousser les disponibilités vers Channex ────────────────

async function pushAvailability(supabase, { property_id, channex_property_id, channex_room_type_id, dates_blocked = [] }) {
  try {
    console.log(`📅 [CHANNEX] Push disponibilités pour ${channex_property_id}`);

    // Générer 365 jours de disponibilité
    const values = [];
    const today = new Date();

    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const isBlocked = dates_blocked.includes(dateStr);

      values.push({
        property_id: channex_property_id,
        room_type_id: channex_room_type_id,
        date: dateStr,
        availability: isBlocked ? 0 : 1
      });
    }

    await channexAPI.post('/availability', { values });

    await logChannex(supabase, {
      property_id, channex_property_id,
      event_type: 'push_availability',
      direction: 'outbound',
      payload: { dates_count: values.length, blocked_count: dates_blocked.length }
    });

    console.log(`✅ [CHANNEX] Disponibilités poussées`);

  } catch (e) {
    console.error('❌ [CHANNEX] Erreur push availability:', e.response?.data || e.message);
    await logChannex(supabase, {
      property_id, channex_property_id,
      event_type: 'push_availability',
      direction: 'outbound',
      status: 'error',
      error_message: e.message
    });
    throw e;
  }
}

// ── 3. Recevoir une réservation de Channex (webhook) ─────────

async function processChannexBooking(supabase, bookingData) {
  try {
    const { id: channex_booking_id, attributes } = bookingData;
    const {
      property_id: channex_property_id,
      arrival_date,
      departure_date,
      guest_name,
      guest_email,
      guest_phone,
      ota_name,
      ota_reservation_id,
      revision_id
    } = attributes;

    console.log(`📥 [CHANNEX] Nouvelle réservation: ${channex_booking_id} (${ota_name})`);

    // Trouver le property_id Boostinghost
    const { data: prop } = await supabase
      .from('properties')
      .select('id, user_id')
      .eq('channex_property_id', channex_property_id)
      .single();

    if (!prop) {
      console.warn(`⚠️ [CHANNEX] Propriété non trouvée pour channex_id: ${channex_property_id}`);
      return null;
    }

    // Vérifier si réservation déjà existante
    const { data: existing } = await supabase
      .from('reservations')
      .select('id')
      .eq('channex_booking_id', channex_booking_id)
      .single();

    if (existing) {
      console.log(`ℹ️ [CHANNEX] Réservation déjà existante, skip`);
      return existing;
    }

    // Créer la réservation
    const uid = `channex_${channex_booking_id}`;
    const { data: reservation, error } = await supabase
      .from('reservations')
      .insert({
        uid,
        property_id: prop.id,
        user_id: prop.user_id,
        start_date: arrival_date,
        end_date: departure_date,
        guest_name: guest_name || 'Voyageur',
        guest_email: guest_email || null,
        guest_phone: guest_phone || null,
        platform: ota_name || 'channex',
        source: 'channex',
        status: 'confirmed',
        channex_booking_id,
        channex_revision_id: revision_id,
        ota_name,
        ota_reservation_id
      })
      .select()
      .single();

    if (error) throw error;

    await logChannex(supabase, {
      user_id: prop.user_id,
      property_id: prop.id,
      channex_property_id,
      event_type: 'receive_booking',
      direction: 'inbound',
      payload: { channex_booking_id, ota_name, arrival_date, departure_date }
    });

    console.log(`✅ [CHANNEX] Réservation créée: ${uid}`);
    return reservation;

  } catch (e) {
    console.error('❌ [CHANNEX] Erreur traitement réservation:', e.message);
    throw e;
  }
}

module.exports = {
  createChannexProperty,
  pushAvailability,
  processChannexBooking,
  logChannex,
  channexAPI
};
