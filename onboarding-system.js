// ============================================
// 🎯 SYSTÈME D'ONBOARDING CLIENT
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

Dans quelle langue souhaitez-vous communiquer ?

🇫🇷 Français → Tapez "fr"
🇬🇧 English → Tapez "en"
🇪🇸 Español → Tapez "es"
🇩🇪 Deutsch → Tapez "de"
🇮🇹 Italiano → Tapez "it"`,
    
    first_name: `Merci ! 😊

Quel est votre prénom ?`,
    
    last_name: `Merci {firstName} !

Et votre nom de famille ?`,
    
    phone: `Parfait !

Pouvez-vous me donner votre numéro de téléphone ? (Pour vous joindre en cas d'urgence)`,
    
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

In which language would you like to communicate?

🇫🇷 Français → Type "fr"
🇬🇧 English → Type "en"
🇪🇸 Español → Type "es"
🇩🇪 Deutsch → Type "de"
🇮🇹 Italiano → Type "it"`,
    
    first_name: `Thank you! 😊

What is your first name?`,
    
    last_name: `Thank you {firstName}!

And your last name?`,
    
    phone: `Perfect!

Can you provide your phone number? (To reach you in case of emergency)`,
    
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

¿En qué idioma te gustaría comunicarte?

🇫🇷 Français → Escribe "fr"
🇬🇧 English → Escribe "en"
🇪🇸 Español → Escribe "es"
🇩🇪 Deutsch → Escribe "de"
🇮🇹 Italiano → Escribe "it"`,
    
    first_name: `¡Gracias! 😊

¿Cuál es tu nombre?`,
    
    last_name: `¡Gracias {firstName}!

¿Y tu apellido?`,
    
    phone: `¡Perfecto!

¿Puedes darme tu número de teléfono? (Para contactarte en caso de emergencia)`,
    
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
 * ✅ ORDRE MODIFIÉ : Langue → Prénom → Nom → Téléphone
 */
function getNextOnboardingStep(conversation) {
  if (!conversation.language) return ONBOARDING_STEPS.LANGUAGE;        // ✅ LANGUE EN PREMIER !
  if (!conversation.guest_first_name) return ONBOARDING_STEPS.FIRST_NAME;
  if (!conversation.guest_last_name) return ONBOARDING_STEPS.LAST_NAME;
  if (!conversation.guest_phone) return ONBOARDING_STEPS.PHONE;
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

  console.log(`🎯 [ONBOARDING] Conversation ${conversationId}, étape: ${currentStep}, message: "${userMessage}"`);

  switch (currentStep) {
    case ONBOARDING_STEPS.LANGUAGE:
      // ✅ ÉTAPE 1 : Valider et enregistrer la langue EN PREMIER
      const langCode = userMessage.toLowerCase().trim();
      if (!isValidLanguage(langCode)) {
        console.log(`❌ [ONBOARDING] Langue invalide: ${langCode}`);
        return {
          shouldRespond: true,
          message: `⚠️ Langue non reconnue / Language not recognized / Idioma no reconocido

Répondez avec / Reply with / Responde con: fr, en, es, de, ou/or/o it`,
          completed: false
        };
      }
      
      updateQuery = 'UPDATE conversations SET language = $1, updated_at = NOW() WHERE id = $2';
      updateParams = [langCode, conversationId];
      await pool.query(updateQuery, updateParams);
      
      console.log(`✅ [ONBOARDING] Langue enregistrée: ${langCode}`);
      
      // Message suivant dans la langue choisie
      nextMessage = getOnboardingMessage('first_name', langCode);
      conversation.language = langCode;
      currentLanguage = langCode;  // Mettre à jour pour les messages suivants
      break;

    case ONBOARDING_STEPS.FIRST_NAME:
      // ✅ ÉTAPE 2 : Enregistrer le prénom (dans la langue choisie)
      updateQuery = 'UPDATE conversations SET guest_first_name = $1, updated_at = NOW() WHERE id = $2';
      updateParams = [userMessage, conversationId];
      await pool.query(updateQuery, updateParams);
      
      console.log(`✅ [ONBOARDING] Prénom enregistré: ${userMessage}`);
      
      // Message suivant
      nextMessage = getOnboardingMessage('last_name', currentLanguage, { firstName: userMessage });
      conversation.guest_first_name = userMessage;
      break;

    case ONBOARDING_STEPS.LAST_NAME:
      // ✅ ÉTAPE 3 : Enregistrer le nom
      updateQuery = 'UPDATE conversations SET guest_last_name = $1, updated_at = NOW() WHERE id = $2';
      updateParams = [userMessage, conversationId];
      await pool.query(updateQuery, updateParams);
      
      console.log(`✅ [ONBOARDING] Nom enregistré: ${userMessage}`);
      
      // Message suivant
      nextMessage = getOnboardingMessage('phone', currentLanguage);
      conversation.guest_last_name = userMessage;
      break;

    case ONBOARDING_STEPS.PHONE:
      // ✅ ÉTAPE 4 : Valider et enregistrer le téléphone (dernière étape)
      if (!isValidPhone(userMessage)) {
        console.log(`❌ [ONBOARDING] Format téléphone invalide: ${userMessage}`);
        const errorMessages = {
          fr: `⚠️ Format de téléphone invalide. Merci d'entrer un numéro valide (ex: +33612345678 ou 0612345678)`,
          en: `⚠️ Invalid phone format. Please enter a valid number (e.g., +33612345678 or 0612345678)`,
          es: `⚠️ Formato de teléfono inválido. Por favor ingresa un número válido (ej: +33612345678 o 0612345678)`,
          de: `⚠️ Ungültiges Telefonformat. Bitte geben Sie eine gültige Nummer ein (z.B.: +33612345678 oder 0612345678)`,
          it: `⚠️ Formato telefono non valido. Per favore inserisci un numero valido (es: +33612345678 o 0612345678)`
        };
        return {
          shouldRespond: true,
          message: errorMessages[currentLanguage] || errorMessages.fr,
          completed: false
        };
      }
      
      updateQuery = 'UPDATE conversations SET guest_phone = $1, onboarding_completed = TRUE, onboarding_completed_at = NOW(), updated_at = NOW() WHERE id = $2';
      updateParams = [userMessage, conversationId];
      await pool.query(updateQuery, updateParams);
      
      console.log(`✅ [ONBOARDING] Téléphone enregistré: ${userMessage}, onboarding complété !`);
      
      // 🎯 METTRE À JOUR LA RÉSERVATION avec les infos collectées
      conversation.guest_phone = userMessage;
      await updateReservationWithGuestInfo(conversation, pool);
      
      // Message de complétion dans la langue choisie
      nextMessage = getOnboardingMessage('completed', currentLanguage, { 
        firstName: conversation.guest_first_name 
      });
      conversation.onboarding_completed = true;
      break;
      nextMessage = getOnboardingMessage('completed', langCode, { 
        firstName: conversation.guest_first_name 
      });
      conversation.language = langCode;
      conversation.onboarding_completed = true;
      break;

    case ONBOARDING_STEPS.COMPLETED:
      // Onboarding déjà complété, ne rien faire
      console.log(`ℹ️ [ONBOARDING] Onboarding déjà complété pour conversation ${conversationId}`);
      return {
        shouldRespond: false,
        message: null,
        completed: true
      };
  }

  return {
    shouldRespond: true,
    message: nextMessage,
    completed: currentStep === ONBOARDING_STEPS.PHONE  // ✅ PHONE est maintenant la dernière étape
  };
}

/**
 * Mettre à jour la réservation avec les infos du voyageur
 */
async function updateReservationWithGuestInfo(conversation, pool) {
  try {
    if (!conversation.property_id || !conversation.reservation_start_date) {
      console.log('⚠️ [ONBOARDING] Pas assez d\'infos pour mettre à jour la réservation');
      return;
    }

    const fullName = `${conversation.guest_first_name || ''} ${conversation.guest_last_name || ''}`.trim();
    const guestPhone = conversation.guest_phone || null;

    if (!fullName && !guestPhone) {
      console.log('⚠️ [ONBOARDING] Aucune info à mettre à jour dans la réservation');
      return;
    }

    console.log(`📝 [ONBOARDING] Mise à jour réservation: property=${conversation.property_id}, date=${conversation.reservation_start_date}, platform=${conversation.platform}`);
    console.log(`📝 [ONBOARDING] Données: ${fullName} - ${guestPhone}`);

    // Mettre à jour la réservation correspondante
    const updateResult = await pool.query(
      `UPDATE reservations 
       SET guest_name = COALESCE($1, guest_name),
           guest_phone = COALESCE($2, guest_phone),
           updated_at = NOW()
       WHERE property_id = $3 
       AND DATE(start_date) = DATE($4)
       AND LOWER(source) = LOWER($5)
       RETURNING id, uid, guest_name, guest_phone`,
      [fullName || null, guestPhone, conversation.property_id, conversation.reservation_start_date, conversation.platform]
    );

    if (updateResult.rows.length > 0) {
      const updated = updateResult.rows[0];
      console.log(`✅ [ONBOARDING] Réservation ${updated.uid} mise à jour avec : ${updated.guest_name} - ${updated.guest_phone}`);
    } else {
      console.log(`⚠️ [ONBOARDING] Aucune réservation trouvée pour property_id=${conversation.property_id}, date=${conversation.reservation_start_date}, platform=${conversation.platform}`);
    }

  } catch (error) {
    console.error('❌ [ONBOARDING] Erreur updateReservationWithGuestInfo:', error);
    // Ne pas bloquer l'onboarding même si la mise à jour échoue
  }
}

/**
 * Démarrer l'onboarding pour une nouvelle conversation
 */
async function startOnboarding(conversationId, pool, io, initialLanguage = 'fr') {
  try {
    console.log(`🚀 [ONBOARDING] Démarrage onboarding pour conversation ${conversationId}`);
    
    const welcomeMessage = getOnboardingMessage('welcome', initialLanguage);
    
    // ✅ CORRECTION : Utiliser chat_messages au lieu de messages
    const messageResult = await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_type, message, is_read, created_at)
       VALUES ($1, 'system', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, message, is_read, created_at`,
      [conversationId, welcomeMessage]
    );

    const savedMessage = messageResult.rows[0];

    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', savedMessage);
    }

    console.log(`✅ [ONBOARDING] Onboarding démarré pour conversation ${conversationId}`);
    return true;
  } catch (error) {
    console.error('❌ [ONBOARDING] Erreur startOnboarding:', error);
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
