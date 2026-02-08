// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ
// Onboarding + Réponses Auto Multilingues + Groq AI
// ============================================

const { getNextOnboardingStep, processOnboardingResponse } = require('./onboarding-system');
const { detectCategory, getAutoResponse, needsOwnerNotification } = require('./auto-responses-config-multilang');
const { getGroqResponse, requiresHumanIntervention } = require('./groq-ai');

/**
 * Vérifier si l'onboarding est nécessaire
 */
function needsOnboarding(conversation) {
  return !conversation.onboarding_completed;
}

/**
 * Traiter un message entrant du client
 * C'est la fonction principale à appeler depuis votre endpoint
 */
async function handleIncomingMessage(message, conversation, pool, io) {
  try {
    console.log(`📩 [HANDLER] Message reçu de ${conversation.guest_name || 'client'}: "${message.message.substring(0, 50)}..."`);
    console.log(`📩 [HANDLER] Conversation ${conversation.id}, sender_type: ${message.sender_type}`);
    console.log(`📩 [HANDLER] Onboarding complété ? ${conversation.onboarding_completed}`);

    // Ne pas traiter les messages du bot ou du propriétaire
    if (message.sender_type !== 'guest') {
      console.log(`ℹ️ [HANDLER] Message ignoré (sender_type = ${message.sender_type})`);
      return false;
    }

    // ========================================
    // ÉTAPE 1: ONBOARDING (si pas complété)
    // ========================================
    if (needsOnboarding(conversation)) {
      console.log('🎯 [HANDLER] Onboarding en cours...');
      const onboardingResult = await processOnboardingResponse(message, conversation, pool);
      
      console.log(`🎯 [HANDLER] Résultat onboarding:`, {
        shouldRespond: onboardingResult.shouldRespond,
        completed: onboardingResult.completed,
        hasMessage: !!onboardingResult.message
      });
      
      // Envoyer la réponse d'onboarding
      if (onboardingResult && onboardingResult.shouldRespond && onboardingResult.message) {
        console.log(`💬 [HANDLER] Envoi réponse onboarding`);
        await sendBotMessage(conversation.id, onboardingResult.message, pool, io);
      }
      
      // Si l'onboarding vient de se terminer, mettre à jour la conversation
      if (onboardingResult && onboardingResult.completed) {
        console.log('🎉 [HANDLER] Onboarding terminé !');
        conversation.onboarding_completed = true;
        
        // 📨 ENVOYER LE MESSAGE D'ARRIVÉE SI ARRIVÉE AUJOURD'HUI
        try {
          const { sendImmediateArrivalMessage } = require('./arrival-messages-scheduler');
          await sendImmediateArrivalMessage(pool, io, conversation.id);
        } catch (error) {
          console.error('❌ Erreur envoi message d\'arrivée immédiat:', error);
        }
        
        // ✅ STOP ICI — Ne PAS envoyer le dernier message (ex: numéro de tel) à Groq
        return true;
      } else {
        // Onboarding pas encore terminé, on s'arrête ici
        return true;
      }
    }

    // ========================================
    // ÉTAPE 2: INTERVENTION URGENTE
    // ========================================
    if (requiresHumanIntervention(message.message)) {
      console.log('🚨 [HANDLER] Intervention humaine urgente !');
      
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
      console.log('📧 [HANDLER] Notification propriétaire requise');
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

    // ✅ Ne pas forcer de langue par défaut si onboarding en cours
    const language = conversation.language || (conversation.onboarding_completed ? 'fr' : null);

    // ========================================
    // ÉTAPE 4: RÉPONSE PAR MOTS-CLÉS (GRATUIT)
    // ========================================
    const categoryMatch = detectCategory(message.message, language);
    
    if (categoryMatch && property) {
      console.log(`✅ [HANDLER] Match mot-clé: ${categoryMatch.category} (${language})`);
      
      const response = getAutoResponse(categoryMatch.category, language, property);
      
      if (response) {
        await sendBotMessage(conversation.id, response, pool, io);
        
        // Notifier propriétaire si problème
        if (needsOwnerNotification(categoryMatch.category)) {
          console.log('📧 [HANDLER] Notification propriétaire requise');
        }
        
        return true;
      }
    }

    // ========================================
    // ÉTAPE 5: GROQ AI (INTELLIGENT, CHEAP)
    // ========================================
    console.log('🚀 [HANDLER] Passage à Groq AI...');
    
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
    console.log('⚠️ [HANDLER] Aucune réponse auto, notification propriétaire');
    // TODO: Notification propriétaire
    
    return false;

  } catch (error) {
    console.error('❌ [HANDLER] Erreur handleIncomingMessage:', error);
    return false;
  }
}

/**
 * Envoyer un message bot
 */
async function sendBotMessage(conversationId, message, pool, io) {
  try {
    console.log(`📤 [HANDLER] Envoi message bot pour conversation ${conversationId}`);
    
    // ✅ Utiliser la table messages (cohérence avec chat_routes)
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, message, is_read, created_at)
       VALUES ($1, 'system', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, message, is_read, created_at`,
      [conversationId, message]
    );

    const botMessage = messageResult.rows[0];

    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', botMessage);
    }

    console.log(`✅ [HANDLER] Message bot envoyé: conversation ${conversationId}`);
    return botMessage;

  } catch (error) {
    console.error('❌ [HANDLER] Erreur sendBotMessage:', error);
    return null;
  }
}

module.exports = {
  handleIncomingMessage,
  sendBotMessage
};
