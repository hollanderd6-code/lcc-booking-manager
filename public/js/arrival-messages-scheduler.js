// ============================================
// 📨 SYSTÈME D'ENVOI AUTOMATIQUE DES MESSAGES D'ARRIVÉE
// ============================================

/**
 * Remplacer les variables dans le template de message
 */
function replaceMessageVariables(template, data) {
  if (!template) return '';
  
  return template
    .replace(/{guestName}/g, data.guestName || 'Voyageur')
    .replace(/{propertyName}/g, data.propertyName || '')
    .replace(/{address}/g, data.address || '')
    .replace(/{arrivalTime}/g, data.arrivalTime || '')
    .replace(/{departureTime}/g, data.departureTime || '')
    .replace(/{accessCode}/g, data.accessCode || '')
    .replace(/{wifiName}/g, data.wifiName || '')
    .replace(/{wifiPassword}/g, data.wifiPassword || '')
    .replace(/{accessInstructions}/g, data.accessInstructions || '')
    .replace(/{welcomeBookUrl}/g, data.welcomeBookUrl || '');
}

/**
 * Vérifier si le message d'arrivée a déjà été envoyé
 */
async function hasArrivalMessageBeenSent(pool, conversationId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM messages 
       WHERE conversation_id = $1 
       AND sender_type = 'system' 
       AND message LIKE '%informations pour votre arrivée%'`,
      [conversationId]
    );
    
    return result.rows[0].count > 0;
  } catch (error) {
    console.error('❌ Erreur vérification message envoyé:', error);
    return false;
  }
}

/**
 * Envoyer le message d'arrivée pour une conversation
 */
async function sendArrivalMessage(pool, io, conversation, property) {
  try {
    // Vérifier si déjà envoyé
    const alreadySent = await hasArrivalMessageBeenSent(pool, conversation.id);
    if (alreadySent) {
      console.log(`⏭️ Message d'arrivée déjà envoyé pour conversation ${conversation.id}`);
      return false;
    }

    // Récupérer le template de message
    const messageTemplate = property.arrival_message;
    if (!messageTemplate) {
      console.log(`⚠️ Pas de template de message pour ${property.name}`);
      return false;
    }

    // Construire le nom du voyageur
    const guestName = conversation.guest_first_name 
      ? `${conversation.guest_first_name} ${conversation.guest_last_name || ''}`.trim()
      : 'Voyageur';

    // Préparer les données pour le remplacement
    const messageData = {
      guestName: guestName,
      propertyName: property.name,
      address: property.address,
      arrivalTime: property.arrival_time,
      departureTime: property.departure_time,
      accessCode: property.access_code,
      wifiName: property.wifi_name,
      wifiPassword: property.wifi_password,
      accessInstructions: property.access_instructions,
      welcomeBookUrl: property.welcome_book_url
    };

    // Remplacer les variables
    const finalMessage = replaceMessageVariables(messageTemplate, messageData);

    // Insérer le message dans la base
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, message, is_read, created_at)
       VALUES ($1, 'system', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, message, is_read, created_at`,
      [conversation.id, finalMessage]
    );

    const savedMessage = messageResult.rows[0];

    // Émettre via Socket.io si disponible
    if (io) {
      io.to(`conversation_${conversation.id}`).emit('new_message', savedMessage);
    }

    console.log(`✅ Message d'arrivée envoyé pour ${property.name} - ${guestName} (conversation ${conversation.id})`);
    return true;

  } catch (error) {
    console.error(`❌ Erreur envoi message d'arrivée (conversation ${conversation.id}):`, error);
    return false;
  }
}

/**
 * Traiter tous les arrivées du jour
 */
async function processTodayArrivals(pool, io) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    console.log(`\n📅 ============================================`);
    console.log(`📅 TRAITEMENT DES ARRIVÉES DU ${todayStr}`);
    console.log(`📅 ============================================\n`);

    // Récupérer toutes les conversations avec arrivée aujourd'hui
    const conversationsResult = await pool.query(
      `SELECT 
        c.id,
        c.property_id,
        c.guest_first_name,
        c.guest_last_name,
        c.guest_phone,
        c.onboarding_completed,
        c.reservation_start_date,
        p.name as property_name,
        p.address,
        p.arrival_time,
        p.departure_time,
        p.access_code,
        p.access_instructions,
        p.wifi_name,
        p.wifi_password,
        p.welcome_book_url,
        p.arrival_message
      FROM conversations c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE DATE(c.reservation_start_date) = $1
      AND c.onboarding_completed = TRUE
      ORDER BY c.id`,
      [todayStr]
    );

    const conversations = conversationsResult.rows;
    console.log(`📊 ${conversations.length} conversation(s) avec arrivée aujourd'hui`);

    if (conversations.length === 0) {
      console.log('✅ Aucune arrivée aujourd\'hui');
      return { total: 0, sent: 0, skipped: 0, errors: 0 };
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const conversation of conversations) {
      const property = {
        name: conversation.property_name,
        address: conversation.address,
        arrival_time: conversation.arrival_time,
        departure_time: conversation.departure_time,
        access_code: conversation.access_code,
        access_instructions: conversation.access_instructions,
        wifi_name: conversation.wifi_name,
        wifi_password: conversation.wifi_password,
        welcome_book_url: conversation.welcome_book_url,
        arrival_message: conversation.arrival_message
      };

      const success = await sendArrivalMessage(pool, io, conversation, property);
      
      if (success) {
        sent++;
      } else {
        const alreadySent = await hasArrivalMessageBeenSent(pool, conversation.id);
        if (alreadySent) {
          skipped++;
        } else {
          errors++;
        }
      }

      // Petite pause entre chaque envoi
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n📊 RÉSUMÉ:`);
    console.log(`   ✅ Envoyés: ${sent}`);
    console.log(`   ⏭️ Déjà envoyés: ${skipped}`);
    console.log(`   ❌ Erreurs: ${errors}`);
    console.log(`   📦 Total: ${conversations.length}\n`);

    return { total: conversations.length, sent, skipped, errors };

  } catch (error) {
    console.error('❌ Erreur processTodayArrivals:', error);
    return { total: 0, sent: 0, skipped: 0, errors: 0 };
  }
}

/**
 * Envoyer immédiatement le message d'arrivée après onboarding
 * (si la réservation arrive aujourd'hui)
 */
async function sendImmediateArrivalMessage(pool, io, conversationId) {
  try {
    console.log(`🚀 Vérification envoi immédiat pour conversation ${conversationId}`);

    const conversationResult = await pool.query(
      `SELECT 
        c.*,
        p.name as property_name,
        p.address,
        p.arrival_time,
        p.departure_time,
        p.access_code,
        p.access_instructions,
        p.wifi_name,
        p.wifi_password,
        p.welcome_book_url,
        p.arrival_message
      FROM conversations c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.id = $1`,
      [conversationId]
    );

    if (conversationResult.rows.length === 0) {
      console.log(`⚠️ Conversation ${conversationId} introuvable`);
      return false;
    }

    const conversation = conversationResult.rows[0];

    // Vérifier si l'arrivée est aujourd'hui
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arrivalDate = new Date(conversation.reservation_start_date);
    arrivalDate.setHours(0, 0, 0, 0);

    if (arrivalDate.getTime() !== today.getTime()) {
      console.log(`⏰ Arrivée prévue le ${arrivalDate.toISOString().split('T')[0]}, pas aujourd'hui`);
      return false;
    }

    // Vérifier si l'onboarding est complété
    if (!conversation.onboarding_completed) {
      console.log(`⚠️ Onboarding non complété pour conversation ${conversationId}`);
      return false;
    }

    const property = {
      name: conversation.property_name,
      address: conversation.address,
      arrival_time: conversation.arrival_time,
      departure_time: conversation.departure_time,
      access_code: conversation.access_code,
      access_instructions: conversation.access_instructions,
      wifi_name: conversation.wifi_name,
      wifi_password: conversation.wifi_password,
      welcome_book_url: conversation.welcome_book_url,
      arrival_message: conversation.arrival_message
    };

    return await sendArrivalMessage(pool, io, conversation, property);

  } catch (error) {
    console.error(`❌ Erreur sendImmediateArrivalMessage:`, error);
    return false;
  }
}

module.exports = {
  processTodayArrivals,
  sendImmediateArrivalMessage,
  replaceMessageVariables
};
