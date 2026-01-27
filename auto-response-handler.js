// ============================================
// 🤖 SYSTÈME HYBRIDE RÉPONSES AUTOMATIQUES
// ============================================

const { findKeywordMatch } = require('./auto-responses-config');
const { getGroqResponse, requiresHumanIntervention } = require('./groq-ai');

/**
 * Processeur principal de réponses automatiques (hybride)
 * 
 * @param {string} userMessage - Message du client
 * @param {object} conversation - Objet conversation avec property info
 * @param {object} pool - Pool PostgreSQL
 * @returns {object} { shouldRespond: boolean, response: string, notifyOwner: boolean }
 */
async function processAutoResponse(userMessage, conversation, pool) {
  try {
    console.log(`🤖 Analyse message: "${userMessage.substring(0, 50)}..."`);

    // ========================================
    // ÉTAPE 1: Vérifier si intervention humaine urgente
    // ========================================
    if (requiresHumanIntervention(userMessage)) {
      console.log('🚨 Intervention humaine urgente requise');
      return {
        shouldRespond: true,
        response: `🚨 Votre message urgent a été transmis au propriétaire qui vous contactera immédiatement.

Merci de patienter, nous faisons le nécessaire ! 🙏`,
        notifyOwner: true,
        method: 'urgent'
      };
    }

    // ========================================
    // ÉTAPE 2: Récupérer infos du logement
    // ========================================
    let property = null;
    if (conversation.property_id) {
      const propertyResult = await pool.query(
        'SELECT * FROM properties WHERE id = $1',
        [conversation.property_id]
      );
      property = propertyResult.rows[0] || null;
    }

    // ========================================
    // ÉTAPE 3: Essayer réponse par mots-clés (GRATUIT)
    // ========================================
    const keywordMatch = findKeywordMatch(userMessage);
    
    if (keywordMatch) {
      console.log(`✅ Match mot-clé trouvé: ${keywordMatch.category}`);
      
      let response;
      if (keywordMatch.requiresProperty && property) {
        response = keywordMatch.response(property);
      } else if (!keywordMatch.requiresProperty) {
        response = keywordMatch.response();
      } else {
        // Property requis mais pas dispo, on passe à Groq
        console.log('⚠️ Property requis mais non disponible, passage à Groq');
        response = null;
      }

      if (response) {
        return {
          shouldRespond: true,
          response,
          notifyOwner: keywordMatch.notifyOwner || false,
          method: 'keyword'
        };
      }
    }

    // ========================================
    // ÉTAPE 4: Fallback sur Groq AI (PAYANT mais cheap)
    // ========================================
    console.log('🚀 Passage à Groq AI pour réponse intelligente...');
    
    const conversationContext = property ? {
      propertyName: property.name,
      welcomeBookUrl: property.welcome_book_url,
      wifiName: property.wifi_name,
      wifiPassword: property.wifi_password,
      arrivalTime: property.arrival_time,
      departureTime: property.departure_time
    } : {};

    const aiResponse = await getGroqResponse(userMessage, conversationContext);

    if (aiResponse) {
      return {
        shouldRespond: true,
        response: aiResponse,
        notifyOwner: false,
        method: 'groq-ai'
      };
    }

    // ========================================
    // ÉTAPE 5: Aucune réponse auto possible
    // ========================================
    console.log('⚠️ Aucune réponse automatique possible, notifier propriétaire');
    return {
      shouldRespond: false,
      response: null,
      notifyOwner: true,
      method: 'none'
    };

  } catch (error) {
    console.error('❌ Erreur processAutoResponse:', error);
    return {
      shouldRespond: false,
      response: null,
      notifyOwner: true,
      method: 'error'
    };
  }
}

/**
 * Envoyer une réponse automatique dans une conversation
 */
async function sendAutoResponseIfNeeded(message, conversation, pool, io) {
  try {
    // Ne pas répondre aux messages du bot ou du propriétaire
    if (message.sender_type !== 'guest') {
      return false;
    }

    // Analyser et générer réponse
    const result = await processAutoResponse(message.message, conversation, pool);

    // Envoyer la réponse si nécessaire
    if (result.shouldRespond && result.response) {
      const messageResult = await pool.query(
        `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, is_bot_response)
         VALUES ($1, 'bot', 'Assistant automatique', $2, FALSE, TRUE)
         RETURNING id, conversation_id, sender_type, sender_name, message, is_read, is_bot_response, created_at`,
        [conversation.id, result.response]
      );

      const botMessage = messageResult.rows[0];

      // Émettre via Socket.io
      if (io) {
        io.to(`conversation_${conversation.id}`).emit('new_message', botMessage);
      }

      console.log(`✅ Réponse auto envoyée (${result.method}): ${conversation.id}`);
    }

    // Notifier propriétaire si nécessaire
    if (result.notifyOwner) {
      console.log(`📧 Notification propriétaire requise pour: ${conversation.id}`);
      // TODO: Ajouter notification email/push au propriétaire
    }

    return result.shouldRespond;

  } catch (error) {
    console.error('❌ Erreur sendAutoResponseIfNeeded:', error);
    return false;
  }
}

module.exports = {
  processAutoResponse,
  sendAutoResponseIfNeeded
};
