// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ - VERSION SIMPLIFIÉE
// Onboarding uniquement (sans Groq AI ni réponses auto complexes)
// ============================================

const { processOnboardingResponse } = require('./onboarding-system');

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
    console.log(`📩 [HANDLER] Message reçu pour conversation ${conversation.id}`);
    console.log(`📩 [HANDLER] Sender: ${message.sender_type}, Message: "${message.message.substring(0, 50)}"`);
    console.log(`📩 [HANDLER] Onboarding complété ? ${conversation.onboarding_completed}`);

    // Ne pas traiter les messages du bot ou du propriétaire
    if (message.sender_type !== 'guest') {
      console.log(`ℹ️ [HANDLER] Message ignoré (sender_type = ${message.sender_type})`);
      return false;
    }

    // ========================================
    // ONBOARDING (si pas complété)
    // ========================================
    if (needsOnboarding(conversation)) {
      console.log('🎯 [HANDLER] Traitement onboarding en cours...');
      
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
      
      // Si l'onboarding vient de se terminer
      if (onboardingResult && onboardingResult.completed) {
        console.log('🎉 [HANDLER] Onboarding terminé pour conversation ' + conversation.id);
        conversation.onboarding_completed = true;
      }
      
      return true;
    }

    // ========================================
    // MESSAGE NORMAL (après onboarding)
    // ========================================
    console.log(`💬 [HANDLER] Onboarding déjà complété, message normal traité`);
    // Le message est juste sauvegardé, pas de réponse auto pour l'instant
    
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
    
    // ✅ CORRECTION : Utiliser chat_messages au lieu de messages
    const messageResult = await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_type, message, is_read, created_at)
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
