// ============================================
// 📝 SYSTÈME D'ONBOARDING CLIENT
// ============================================

/**
 * État de l'onboarding
 */
const ONBOARDING_STEPS = {
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  PHONE: 'phone',
  LANGUAGE: 'language',
  COMPLETED: 'completed'
};

/**
 * Messages d'onboarding multilingues
 */
const ONBOARDING_MESSAGES = {
  fr: {
    welcome: `Bienvenue ! 👋

Pour mieux vous accompagner, j'ai besoin de quelques informations.

Quel est votre prénom ?`,
    
    last_name: `Merci {firstName} ! 😊

Et votre nom de famille ?`,
    
    phone: `Parfait !

Pouvez-vous me donner votre numéro de téléphone ? (Pour vous joindre en cas d'urgence)`,
    
    language: `Merci !

Dans quelle langue souhaitez-vous communiquer ?

🇫🇷 Français → Tapez "fr"
🇬🇧 English → Tapez "en"
🇪🇸 Español → Tapez "es"
🇩🇪 Deutsch → Tapez "de"
🇮🇹 Italiano → Tapez "it"`,
    
    completed: `Merci {firstName} ! Votre profil est maintenant configuré. 🎉

Je suis à votre disposition pour répondre à vos questions ! N'hésitez pas à me demander :

• Code d'accès et informations d'arrivée
• WiFi et équipements
• Recommandations locales
• Toute autre question

Comment puis-je vous aider ? 😊`
  },
  
  en: {
    welcome: `Welcome! 👋

To better assist you, I need some information.

What is your first name?`,
    
    last_name: `Thank you {firstName}! 😊

And your last name?`,
    
    phone: `Perfect!

Can you provide your phone number? (To reach you in case of emergency)`,
    
    language: `Thank you!

In which language would you like to communicate?

🇫🇷 Français
🇬🇧 English
🇪🇸 Español
🇩🇪 Deutsch
🇮🇹 Italiano

Reply with the code: fr, en, es, de, or it`,
    
    completed: `Thank you {firstName}! Your profile is now set up. 🎉

I'm here to answer your questions! Feel free to ask me about:

• Access code and arrival information
• WiFi and amenities
• Local recommendations
• Any other question

How can I help you? 😊`
  },
  
  es: {
    welcome: `¡Bienvenido! 👋

Para ayudarte mejor, necesito información.

¿Cuál es tu nombre?`,
    
    last_name: `¡Gracias {firstName}! 😊

¿Y tu apellido?`,
    
    phone: `¡Perfecto!

¿Puedes darme tu número de teléfono? (Para contactarte en caso de emergencia)`,
    
    language: `¡Gracias!

¿En qué idioma te gustaría comunicarte?

🇫🇷 Français
🇬🇧 English
🇪🇸 Español
🇩🇪 Deutsch
🇮🇹 Italiano

Responde con el código: fr, en, es, de, o it`,
    
    completed: `¡Gracias {firstName}! Tu perfil está configurado. 🎉

Estoy aquí para responder tus preguntas! No dudes en preguntarme sobre:

• Código de acceso e información de llegada
• WiFi y equipamiento
• Recomendaciones locales
• Cualquier otra pregunta

¿Cómo puedo ayudarte? 😊`
  }
};

/**
 * Valider un numéro de téléphone
 */
function isValidPhone(phone) {
  // Accepter formats internationaux basiques
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  return /^[\+]?[0-9]{8,15}$/.test(cleaned);
}

/**
 * Valider un code langue
 */
function isValidLanguage(lang) {
  const validLangs = ['fr', 'en', 'es', 'de', 'it'];
  return validLangs.includes(lang.toLowerCase());
}

/**
 * Déterminer la prochaine étape d'onboarding
 */
function getNextOnboardingStep(conversation) {
  if (!conversation.guest_first_name) return ONBOARDING_STEPS.FIRST_NAME;
  if (!conversation.guest_last_name) return ONBOARDING_STEPS.LAST_NAME;
  if (!conversation.guest_phone) return ONBOARDING_STEPS.PHONE;
  if (!conversation.language) return ONBOARDING_STEPS.LANGUAGE;
  return ONBOARDING_STEPS.COMPLETED;
}

/**
 * Obtenir le message d'onboarding approprié
 */
function getOnboardingMessage(step, language = 'fr', context = {}) {
  const messages = ONBOARDING_MESSAGES[language] || ONBOARDING_MESSAGES.fr;
  let message = messages[step] || messages.welcome;
  
  // Remplacer les placeholders
  Object.keys(context).forEach(key => {
    message = message.replace(`{${key}}`, context[key]);
  });
  
  return message;
}

/**
 * Traiter une réponse d'onboarding
 */
async function processOnboardingResponse(message, conversation, pool) {
  const currentStep = getNextOnboardingStep(conversation);
  const userMessage = message.message.trim();
  const conversationId = conversation.id;
  
  let updateQuery = '';
  let updateParams = [];
  let nextMessage = '';
  let currentLanguage = conversation.language || 'fr';

  switch (currentStep) {
    case ONBOARDING_STEPS.FIRST_NAME:
      // Enregistrer le prénom
      updateQuery = 'UPDATE conversations SET guest_first_name = $1, updated_at = NOW() WHERE id = $2';
      updateParams = [userMessage, conversationId];
      await pool.query(updateQuery, updateParams);
      
      // Message suivant
      nextMessage = getOnboardingMessage('last_name', currentLanguage, { firstName: userMessage });
      conversation.guest_first_name = userMessage;
      break;

    case ONBOARDING_STEPS.LAST_NAME:
      // Enregistrer le nom
      updateQuery = 'UPDATE conversations SET guest_last_name = $1, updated_at = NOW() WHERE id = $2';
      updateParams = [userMessage, conversationId];
      await pool.query(updateQuery, updateParams);
      
      // Message suivant
      nextMessage = getOnboardingMessage('phone', currentLanguage);
      conversation.guest_last_name = userMessage;
      break;

    case ONBOARDING_STEPS.PHONE:
      // Valider et enregistrer le téléphone
      if (!isValidPhone(userMessage)) {
        return {
          shouldRespond: true,
          message: currentLanguage === 'fr' 
            ? `⚠️ Format de téléphone invalide. Merci d'entrer un numéro valide (ex: +33612345678 ou 0612345678)`
            : `⚠️ Invalid phone format. Please enter a valid number (e.g., +33612345678 or 0612345678)`,
          completed: false
        };
      }
      
      updateQuery = 'UPDATE conversations SET guest_phone = $1, updated_at = NOW() WHERE id = $2';
      updateParams = [userMessage, conversationId];
      await pool.query(updateQuery, updateParams);
      
      // Message suivant
      nextMessage = getOnboardingMessage('language', currentLanguage);
      conversation.guest_phone = userMessage;
      break;

    case ONBOARDING_STEPS.LANGUAGE:
      // Valider et enregistrer la langue
      const langCode = userMessage.toLowerCase().trim();
      if (!isValidLanguage(langCode)) {
        return {
          shouldRespond: true,
          message: currentLanguage === 'fr'
            ? `⚠️ Langue non reconnue. Répondez avec : fr, en, es, de, ou it`
            : `⚠️ Language not recognized. Reply with: fr, en, es, de, or it`,
          completed: false
        };
      }
      
      updateQuery = 'UPDATE conversations SET language = $1, onboarding_completed = TRUE, updated_at = NOW() WHERE id = $2';
      updateParams = [langCode, conversationId];
      await pool.query(updateQuery, updateParams);
      
      // Message de complétion dans la langue choisie
      nextMessage = getOnboardingMessage('completed', langCode, { 
        firstName: conversation.guest_first_name 
      });
      conversation.language = langCode;
      conversation.onboarding_completed = true;
      break;

    case ONBOARDING_STEPS.COMPLETED:
      // Onboarding déjà complété, ne rien faire
      return {
        shouldRespond: false,
        message: null,
        completed: true
      };
  }

  return {
    shouldRespond: true,
    message: nextMessage,
    completed: currentStep === ONBOARDING_STEPS.LANGUAGE
  };
}

/**
 * Démarrer l'onboarding pour une nouvelle conversation
 */
async function startOnboarding(conversationId, pool, io, initialLanguage = 'fr') {
  try {
    const welcomeMessage = getOnboardingMessage('welcome', initialLanguage);
    
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_name, message, is_read, is_bot_response)
       VALUES ($1, 'bot', 'Assistant', $2, FALSE, TRUE)
       RETURNING id, conversation_id, sender_type, sender_name, message, is_read, is_bot_response, created_at`,
      [conversationId, welcomeMessage]
    );

    const savedMessage = messageResult.rows[0];

    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', savedMessage);
    }

    console.log(`✅ Onboarding démarré pour conversation ${conversationId}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur startOnboarding:', error);
    return false;
  }
}

module.exports = {
  ONBOARDING_STEPS,
  getNextOnboardingStep,
  processOnboardingResponse,
  startOnboarding,
  getOnboardingMessage
};
