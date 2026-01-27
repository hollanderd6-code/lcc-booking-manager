// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ
// Onboarding + Réponses Auto Multilingues
// ============================================

const { needsOnboarding, processOnboardingResponse } = require('./onboarding-system');
const { detectCategory, getAutoResponse, needsOwnerNotification } = require('./auto-responses-config-multilang');
const { getGroqResponse, requiresHumanIntervention } = require('./groq-ai');

/**
 * Traiter un message entrant du client
 * C'est la fonction principale à appeler depuis votre endpoint
 */
async function handleIncomingMessage(message, conversation, pool, io) {
  try {
    console.log(`📨 Message reçu de ${conversation.guest_name || 'client'}: "${message.message.substring(0, 50)}..."`);

    // Ne pas traiter les messages du bot ou du propriétaire
    if (message.sender_type !== 'guest') {
      return false;
    }

    // ========================================
    // ÉTAPE 1: ONBOARDING (si pas complété)
    // ========================================
    if (needsOnboarding(conversation)) {
      console.log('🎯 Onboarding en cours...');
      return await processOnboardingResponse(conversation, message.message, pool, io);
    }

    // ========================================
    // ÉTAPE 2: INTERVENTION URGENTE
    // ========================================
    if (requiresHumanIntervention(message.message)) {
      console.log('🚨 Intervention humaine urgente !');
      
      const urgentMessages = {
        fr: `🚨 Votre message urgent a été transmis au propriétaire qui vous contactera immédiatement.\n\nMerci de patienter, nous faisons le nécessaire ! 🙏`,
        en: `🚨 Your urgent message has been forwarded to the owner who will contact you immediately.\n\nPlease wait, we're taking care of it! 🙏`,
        es: `🚨 Su mensaje urgente ha sido transmitido al propietario que le contactará inmediatamente.\n\n¡Gracias por su paciencia! 🙏`,
        de: `🚨 Ihre dringende Nachricht wurde an den Eigentümer weitergeleitet, der Sie umgehend kontaktieren wird.\n\nBitte warten Sie! 🙏`,
        it: `🚨 Il tuo messaggio urgente è stato inoltrato al proprietario che ti contatterà immediatamente.\n\nGrazie per la pazienza! 🙏`
      };

      await sendBotMessage(
        conversation.id,
        urgentMessages[conversation.language] || urgentMessages.fr,
        pool,
        io
      );

      // TODO: Notification propriétaire
      return true;
    }

    // ========================================
    // ÉTAPE 3: RÉCUPÉRER INFOS PROPRIÉTÉ
    // ========================================
    let property = null;
    if (conversation.property_id) {
      const propertyResult = await pool.query(
        'SELECT * FROM properties WHERE id = $1',
        [conversation.property_id]
      );
      property = propertyResult.rows[0] || null;
    }

    const language = conversation.language || 'fr';

    // ========================================
    // ÉTAPE 4: RÉPONSE PAR MOTS-CLÉS (GRATUIT)
    // ========================================
    const categoryMatch = detectCategory(message.message, language);
    
    if (categoryMatch && property) {
      console.log(`✅ Match mot-clé: ${categoryMatch.category} (${language})`);
      
      const response = getAutoResponse(categoryMatch.category, language, property);
      
      if (response) {
        await sendBotMessage(conversation.id, response, pool, io);
        
        // Notifier propriétaire si problème
        if (needsOwnerNotification(categoryMatch.category)) {
          // TODO: Notification propriétaire
          console.log('📧 Notification propriétaire requise');
        }
        
        return true;
      }
    }

    // ========================================
    // ÉTAPE 5: GROQ AI (INTELLIGENT, CHEAP)
    // ========================================
    console.log('🚀 Passage à Groq AI...');
    
    const conversationContext = property ? {
      propertyName: property.name,
      welcomeBookUrl: property.welcome_book_url,
      wifiName: property.wifi_name,
      wifiPassword: property.wifi_password,
      arrivalTime: property.arrival_time,
      departureTime: property.departure_time,
      language: language
    } : { language };

    const aiResponse = await getGroqResponse(message.message, conversationContext);

    if (aiResponse) {
      await sendBotMessage(conversation.id, aiResponse, pool, io);
      return true;
    }

    // ========================================
    // ÉTAPE 6: AUCUNE RÉPONSE AUTO POSSIBLE
    // ========================================
    console.log('⚠️ Aucune réponse auto, notification propriétaire');
    // TODO: Notification propriétaire
    
    return false;

  } catch (error) {
    console.error('❌ Erreur handleIncomingMessage:', error);
    return false;
  }
}

/**
 * Envoyer un message bot
 */
async function sendBotMessage(conversationId, message, pool, io) {
  try {
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, is_bot_response)
       VALUES ($1, 'bot', 'Assistant automatique', $2, FALSE, TRUE)
       RETURNING id, conversation_id, sender_type, sender_name, message, is_read, is_bot_response, created_at`,
      [conversationId, message]
    );

    const botMessage = messageResult.rows[0];

    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', botMessage);
    }

    console.log(`✅ Message bot envoyé: conversation ${conversationId}`);
    return botMessage;

  } catch (error) {
    console.error('❌ Erreur sendBotMessage:', error);
    return null;
  }
}

module.exports = {
  handleIncomingMessage,
  sendBotMessage
};
