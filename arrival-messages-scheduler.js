// ============================================
// 📨 MESSAGES AUTOMATIQUES D'ARRIVÉE
// Envoyés le jour J à 7h via Channex + DB
// (Onboarding supprimé — données voyageur via Channex)
// ============================================

const { sendAutoMessage } = require('./integrated-chat-handler');

function replaceMessageVariables(template, data) {
  if (!template) return '';
  return template
    .replace(/{guestName}/g,            data.guestName            || 'Voyageur')
    .replace(/{propertyName}/g,         data.propertyName         || '')
    .replace(/{address}/g,              data.address              || '')
    .replace(/{arrivalTime}/g,          data.arrivalTime          || '')
    .replace(/{departureTime}/g,        data.departureTime        || '')
    .replace(/{accessCode}/g,           data.accessCode           || '')
    .replace(/{wifiName}/g,             data.wifiName             || '')
    .replace(/{wifiPassword}/g,         data.wifiPassword         || '')
    .replace(/{accessInstructions}/g,   data.accessInstructions   || '')
    .replace(/{welcomeBookUrl}/g,       data.welcomeBookUrl       || '');
}

async function hasArrivalMessageBeenSent(pool, conversationId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM messages
       WHERE conversation_id = $1 AND sender_type = 'system'
       AND message LIKE '%informations pour votre arrivée%'`,
      [conversationId]
    );
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('❌ Erreur vérification message envoyé:', error);
    return false;
  }
}

async function sendArrivalMessage(pool, io, conversation, property) {
  try {
    const alreadySent = await hasArrivalMessageBeenSent(pool, conversation.id);
    if (alreadySent) {
      console.log(`⏭️ Message d'arrivée déjà envoyé pour conv ${conversation.id}`);
      return false;
    }

    const platform = (conversation.platform || '').toLowerCase();
    const isAirbnb = platform.includes('airbnb') || platform === 'abb';

    if (!isAirbnb) {
      const { hasValidDeposit } = require('./deposit-messages-scheduler');
      let reservationUid = conversation.reservation_uid || null;

      if (!reservationUid && conversation.property_id && conversation.reservation_start_date) {
        const res = await pool.query(
          `SELECT uid FROM reservations WHERE property_id = $1 AND DATE(start_date) = DATE($2) ORDER BY created_at DESC LIMIT 1`,
          [conversation.property_id, conversation.reservation_start_date]
        );
        if (res.rows.length > 0) reservationUid = res.rows[0].uid;
      }

      if (reservationUid) {
        const depositValid = await hasValidDeposit(pool, reservationUid);
        if (!depositValid) {
          console.log(`⏭️ Caution en attente pour conv ${conversation.id} → infos bloquées`);
          return false;
        }
      }
    }

    if (!property.arrival_message) {
      console.log(`⚠️ Pas de template d'arrivée pour ${property.name}`);
      return false;
    }

    const guestName = [conversation.guest_first_name, conversation.guest_last_name]
      .filter(Boolean).join(' ').trim() || conversation.guest_name || 'Voyageur';

    const finalMessage = replaceMessageVariables(property.arrival_message, {
      guestName, propertyName: property.name, address: property.address,
      arrivalTime: property.arrival_time, departureTime: property.departure_time,
      accessCode: property.access_code, wifiName: property.wifi_name,
      wifiPassword: property.wifi_password, accessInstructions: property.access_instructions,
      welcomeBookUrl: property.welcome_book_url
    });

    const channexId = conversation.channex_booking_id || null;
    await sendAutoMessage(pool, io, conversation.id, finalMessage, channexId);

    console.log(`✅ Message d'arrivée envoyé — ${property.name} — ${guestName} (conv ${conversation.id}) | Channex: ${channexId || 'non'}`);
    return true;

  } catch (error) {
    console.error(`❌ Erreur sendArrivalMessage (conv ${conversation.id}):`, error);
    return false;
  }
}

async function processTodayArrivals(pool, io) {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    console.log(`\n📅 MESSAGES D'ARRIVÉE DU ${todayStr}\n`);

    const result = await pool.query(
      `SELECT
        c.id, c.property_id, c.platform, c.channex_booking_id,
        c.guest_first_name, c.guest_last_name, c.guest_name, c.reservation_start_date,
        r.uid as reservation_uid,
        r.guest_first_name as r_guest_first_name,
        r.guest_last_name  as r_guest_last_name,
        r.guest_name       as r_guest_name,
        p.name as property_name, p.address, p.arrival_time, p.departure_time,
        p.access_code, p.access_instructions, p.wifi_name, p.wifi_password,
        p.welcome_book_url, p.arrival_message
       FROM conversations c
       LEFT JOIN properties p ON c.property_id = p.id
       LEFT JOIN reservations r ON (r.channex_booking_id = c.channex_booking_id AND c.channex_booking_id IS NOT NULL)
                                OR (r.property_id = c.property_id AND DATE(r.start_date) = DATE(c.reservation_start_date) AND c.channex_booking_id IS NULL)
       WHERE DATE(c.reservation_start_date) = $1
       ORDER BY c.id`,
      [todayStr]
    );

    const conversations = result.rows;
    console.log(`📊 ${conversations.length} conversation(s) avec arrivée aujourd'hui`);
    if (conversations.length === 0) return { total: 0, sent: 0, skipped: 0, errors: 0 };

    let sent = 0, skipped = 0, errors = 0;

    for (const conv of conversations) {
      const enriched = {
        ...conv,
        guest_first_name: conv.guest_first_name || conv.r_guest_first_name,
        guest_last_name:  conv.guest_last_name  || conv.r_guest_last_name,
        guest_name:       conv.guest_name       || conv.r_guest_name
      };
      const property = {
        name: conv.property_name, address: conv.address,
        arrival_time: conv.arrival_time, departure_time: conv.departure_time,
        access_code: conv.access_code, access_instructions: conv.access_instructions,
        wifi_name: conv.wifi_name, wifi_password: conv.wifi_password,
        welcome_book_url: conv.welcome_book_url, arrival_message: conv.arrival_message
      };

      const success = await sendArrivalMessage(pool, io, enriched, property);
      if (success) { sent++; } else {
        (await hasArrivalMessageBeenSent(pool, conv.id)) ? skipped++ : errors++;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n📊 RÉSUMÉ: ✅${sent} envoyés | ⏭️${skipped} déjà envoyés | ❌${errors} erreurs | 📦${conversations.length} total\n`);
    return { total: conversations.length, sent, skipped, errors };

  } catch (error) {
    console.error('❌ Erreur processTodayArrivals:', error);
    return { total: 0, sent: 0, skipped: 0, errors: 0 };
  }
}

async function sendImmediateArrivalMessage(pool, io, conversationId) {
  try {
    const result = await pool.query(
      `SELECT c.*,
        r.uid as reservation_uid,
        r.guest_first_name as r_first, r.guest_last_name as r_last, r.guest_name as r_name,
        p.name as property_name, p.address, p.arrival_time, p.departure_time,
        p.access_code, p.access_instructions, p.wifi_name, p.wifi_password,
        p.welcome_book_url, p.arrival_message
       FROM conversations c
       LEFT JOIN properties p ON c.property_id = p.id
       LEFT JOIN reservations r ON (r.channex_booking_id = c.channex_booking_id AND c.channex_booking_id IS NOT NULL)
                                OR (r.property_id = c.property_id AND DATE(r.start_date) = DATE(c.reservation_start_date) AND c.channex_booking_id IS NULL)
       WHERE c.id = $1 LIMIT 1`,
      [conversationId]
    );
    if (result.rows.length === 0) return false;
    const conv = result.rows[0];

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const arrival = new Date(conv.reservation_start_date); arrival.setHours(0, 0, 0, 0);
    if (arrival.getTime() !== today.getTime()) return false;

    const enriched = {
      ...conv,
      guest_first_name: conv.guest_first_name || conv.r_first,
      guest_last_name:  conv.guest_last_name  || conv.r_last,
      guest_name:       conv.guest_name       || conv.r_name
    };
    const property = {
      name: conv.property_name, address: conv.address,
      arrival_time: conv.arrival_time, departure_time: conv.departure_time,
      access_code: conv.access_code, access_instructions: conv.access_instructions,
      wifi_name: conv.wifi_name, wifi_password: conv.wifi_password,
      welcome_book_url: conv.welcome_book_url, arrival_message: conv.arrival_message
    };

    return await sendArrivalMessage(pool, io, enriched, property);
  } catch (error) {
    console.error('❌ Erreur sendImmediateArrivalMessage:', error);
    return false;
  }
}

module.exports = { processTodayArrivals, sendImmediateArrivalMessage, replaceMessageVariables, sendArrivalMessage };
