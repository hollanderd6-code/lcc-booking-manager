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
      
      // Si l'onboarding vient de se terminer
      if (onboardingResult && onboardingResult.completed) {
        console.log('🎉 [HANDLER] Onboarding terminé !');
        conversation.onboarding_completed = true;
        
        // ========================================
        // 🔒 LOGIQUE POST-ONBOARDING : CAUTION + INFOS D'ARRIVÉE
        // ========================================
        try {
          // Récupérer la propriété
          let property = null;
          if (conversation.property_id) {
            const propResult = await pool.query(
              'SELECT id, name, deposit_amount FROM properties WHERE id = $1',
              [conversation.property_id]
            );
            property = propResult.rows[0] || null;
          }
          
          // ⏰ Calcul des dates (timezone Paris)
          const now = new Date();
          const nowParis = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
          const currentHour = nowParis.getHours();
          
          const todayParis = new Date(nowParis);
          todayParis.setHours(0, 0, 0, 0);
          
          const arrivalDate = new Date(conversation.reservation_start_date);
          arrivalDate.setHours(0, 0, 0, 0);
          
          const diffDays = Math.round((arrivalDate.getTime() - todayParis.getTime()) / (1000 * 60 * 60 * 24));
          const isArrivalToday = diffDays === 0;
          const isAfter7am = currentHour >= 7;
          const isWithin2Days = diffDays <= 2;
          
          const platform = (conversation.platform || '').toLowerCase();
          const isAirbnb = platform.includes('airbnb');
          
          console.log(`📅 [HANDLER] Arrivée dans ${diffDays} jour(s), heure Paris: ${currentHour}h, platform: ${platform}`);
          
          // ========================================
          // ÉTAPE A : CAUTION (Booking / Direct uniquement, pas Airbnb)
          // ========================================
          // Règle : le message caution est normalement envoyé par le cron J-2 à 9h.
          // Mais si l'arrivée est dans ≤ 2 jours (cron déjà passé), on l'envoie maintenant.
          // Si arrivée dans > 2 jours, on ne fait rien ici, le cron J-2 s'en chargera.
          // ========================================
          if (!isAirbnb) {
            const depositResult = await pool.query(
              `SELECT d.id, d.amount_cents, d.checkout_url, d.status
               FROM deposits d
               JOIN reservations r ON d.reservation_uid = r.uid
               WHERE r.property_id = $1
                 AND DATE(r.start_date) = DATE($2)
                 AND d.status = 'pending'
               ORDER BY d.created_at DESC
               LIMIT 1`,
              [conversation.property_id, conversation.reservation_start_date]
            );
            
            if (depositResult.rows.length > 0) {
              const deposit = depositResult.rows[0];
              
              if (isWithin2Days) {
                // ✅ Arrivée dans ≤ 2 jours → envoyer le message caution maintenant
                const amountEuros = (deposit.amount_cents / 100).toFixed(2);
                const propertyName = property?.name || 'votre logement';
                const lang = conversation.language || 'fr';
                
                const depositMessages = {
                  fr: `⚠️ Caution obligatoire

Bonjour ${conversation.guest_first_name || ''} !

Une caution de ${amountEuros}€ est requise pour votre séjour à ${propertyName}.

👉 Cliquez ici pour autoriser la caution :
${deposit.checkout_url}

⚠️ Sans cette autorisation, vous ne pourrez pas recevoir les informations d'arrivée (code d'accès, WiFi, etc.).

L'autorisation ne débite pas votre carte immédiatement. Le montant sera juste bloqué temporairement.

Merci ! 😊`,
                  en: `⚠️ Security deposit required

Hello ${conversation.guest_first_name || ''} !

A security deposit of €${amountEuros} is required for your stay at ${propertyName}.

👉 Click here to authorize the deposit:
${deposit.checkout_url}

⚠️ Without this authorization, you will not receive the arrival information (access code, WiFi, etc.).

The authorization does not charge your card immediately. The amount will just be temporarily held.

Thank you! 😊`,
                  es: `⚠️ Fianza obligatoria

¡Hola ${conversation.guest_first_name || ''} !

Se requiere una fianza de ${amountEuros}€ para su estancia en ${propertyName}.

👉 Haga clic aquí para autorizar la fianza:
${deposit.checkout_url}

⚠️ Sin esta autorización, no recibirá la información de llegada (código de acceso, WiFi, etc.).

La autorización no cobra su tarjeta inmediatamente. El importe solo se bloqueará temporalmente.

¡Gracias! 😊`
                };
                
                await sendBotMessage(
                  conversation.id, 
                  depositMessages[lang] || depositMessages.fr, 
                  pool, 
                  io
                );
                
                console.log(`💰 [HANDLER] Message caution envoyé immédiatement (arrivée dans ${diffDays}j)`);
              } else {
                // 📅 Arrivée dans > 2 jours → le cron J-2 enverra le message caution à 9h
                console.log(`📅 [HANDLER] Arrivée dans ${diffDays}j → le cron J-2 enverra la demande de caution`);
              }
              
              // STOP dans les 2 cas — infos d'arrivée bloquées tant que caution pas validée
              return true;
            }
            // Pas de caution pending trouvée → continuer vers envoi infos d'arrivée
          } else {
            console.log(`ℹ️ [HANDLER] Airbnb → pas de caution via notre système`);
          }
          
          // ========================================
          // ÉTAPE B : INFOS D'ARRIVÉE
          // Règle : seulement le jour J à partir de 7h (heure Paris)
          // Si pas encore le moment, le cron du jour J à 7h s'en charge.
          // ========================================
          if (isArrivalToday && isAfter7am) {
            console.log('📨 [HANDLER] Jour J après 7h → envoi immédiat du message d\'arrivée');
            const { sendImmediateArrivalMessage } = require('./arrival-messages-scheduler');
            await sendImmediateArrivalMessage(pool, io, conversation.id);
          } else if (isArrivalToday && !isAfter7am) {
            console.log(`⏰ [HANDLER] Jour J mais ${currentHour}h < 7h → le cron enverra à 7h`);
          } else {
            console.log(`📅 [HANDLER] Arrivée dans ${diffDays}j → le cron enverra le jour J à 7h`);
          }
          
        } catch (error) {
          console.error('❌ Erreur logique post-onboarding:', error);
        }
        
        // ✅ STOP ICI — Ne PAS envoyer le message d'onboarding (ex: numéro de tel) à Groq
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
