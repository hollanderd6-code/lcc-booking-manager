// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ
// Onboarding + Réponses Auto Multilingues + Groq AI
// ============================================

const { getNextOnboardingStep, processOnboardingResponse } = require('./onboarding-system');
const { detectCategory, getAutoResponse, needsOwnerNotification } = require('./auto-responses-config-multilang');
const { getGroqResponse, requiresHumanIntervention } = require('./groq-ai');

// Stripe (pour création auto de caution)
const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

/**
 * Vérifier si l'onboarding est nécessaire
 */
function needsOnboarding(conversation) {
  return !conversation.onboarding_completed;
}

/**
 * Créer une caution Stripe et l'enregistrer en DB si elle n'existe pas encore.
 * Retourne { depositExists, checkout_url, amount_cents } ou null
 */
async function ensureDepositExists(pool, conversation) {
  try {
    const propertyId = conversation.property_id;
    const startDate = conversation.reservation_start_date;

    // 1. Récupérer la propriété avec deposit_amount
    const propResult = await pool.query(
      'SELECT id, name, deposit_amount FROM properties WHERE id = $1',
      [propertyId]
    );
    const property = propResult.rows[0];
    if (!property || !property.deposit_amount || parseFloat(property.deposit_amount) <= 0) {
      return null; // Pas de caution configurée
    }

    // 2. Récupérer la réservation correspondante
    const resResult = await pool.query(
      `SELECT uid, start_date, end_date, source FROM reservations 
       WHERE property_id = $1 AND DATE(start_date) = DATE($2)
       ORDER BY created_at DESC LIMIT 1`,
      [propertyId, startDate]
    );
    if (resResult.rows.length === 0) {
      console.log(`⚠️ [DEPOSIT-AUTO] Pas de réservation trouvée pour property=${propertyId}, date=${startDate}`);
      return null;
    }
    const reservation = resResult.rows[0];

    // 3. Vérifier si un deposit existe déjà
    const existingDeposit = await pool.query(
      `SELECT id, status, checkout_url, amount_cents FROM deposits 
       WHERE reservation_uid = $1 
       ORDER BY created_at DESC LIMIT 1`,
      [reservation.uid]
    );

    if (existingDeposit.rows.length > 0) {
      const dep = existingDeposit.rows[0];
      // Si déjà autorisée/capturée/released → pas besoin de caution
      if (['authorized', 'captured', 'released'].includes(dep.status)) {
        return { depositExists: true, alreadyValid: true };
      }
      // Si pending → retourner l'URL existante
      if (dep.status === 'pending') {
        return {
          depositExists: true,
          alreadyValid: false,
          checkout_url: dep.checkout_url,
          amount_cents: dep.amount_cents
        };
      }
    }

    // 4. Créer la session Stripe
    if (!stripe) {
      console.error('❌ [DEPOSIT-AUTO] Stripe non configuré');
      return null;
    }

    // Récupérer le user_id et stripe_account_id du propriétaire
    const userResult = await pool.query(
      `SELECT u.id as user_id, u.stripe_account_id 
       FROM users u 
       JOIN properties p ON p.user_id = u.id 
       WHERE p.id = $1`,
      [propertyId]
    );
    if (userResult.rows.length === 0) {
      console.error('❌ [DEPOSIT-AUTO] Propriétaire introuvable');
      return null;
    }
    const user = userResult.rows[0];

    const depositId = 'dep_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const amountCents = Math.round(parseFloat(property.deposit_amount) * 100);
    const appUrl = (process.env.APP_URL || 'https://lcc-booking-manager.onrender.com').replace(/\/$/, '');

    const endDateStr = reservation.end_date 
      ? new Date(reservation.end_date).toISOString().split('T')[0] 
      : '';
    const startDateStr = new Date(reservation.start_date).toISOString().split('T')[0];

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `Caution - ${property.name}`,
            description: `Réservation du ${startDateStr} au ${endDateStr}`
          }
        },
        quantity: 1
      }],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: {
          deposit_id: depositId,
          reservation_uid: reservation.uid
        }
      },
      metadata: {
        deposit_id: depositId,
        reservation_uid: reservation.uid,
        user_id: user.user_id
      },
      success_url: `${appUrl}/caution-success.html?depositId=${depositId}`,
      cancel_url: `${appUrl}/caution-cancel.html?depositId=${depositId}`
    };

    let session;
    if (user.stripe_account_id) {
      session = await stripe.checkout.sessions.create(sessionParams, { stripeAccount: user.stripe_account_id });
    } else {
      session = await stripe.checkout.sessions.create(sessionParams);
    }

    // 5. Sauvegarder en DB
    await pool.query(`
      INSERT INTO deposits (id, user_id, reservation_uid, property_id, amount_cents, status, stripe_session_id, checkout_url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW(), NOW())
    `, [depositId, user.user_id, reservation.uid, propertyId, amountCents, session.id, session.url]);

    console.log(`✅ [DEPOSIT-AUTO] Caution Stripe créée: ${depositId} (${amountCents/100}€) pour ${property.name}`);

    return {
      depositExists: true,
      alreadyValid: false,
      checkout_url: session.url,
      amount_cents: amountCents
    };

  } catch (error) {
    console.error('❌ [DEPOSIT-AUTO] Erreur ensureDepositExists:', error);
    return null;
  }
}

/**
 * Traiter un message entrant du client
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
          const platform = (conversation.platform || '').toLowerCase();
          const isAirbnb = platform.includes('airbnb');
          
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
          
          console.log(`📅 [HANDLER] Arrivée dans ${diffDays} jour(s), heure Paris: ${currentHour}h, platform: ${platform}`);
          
          // ========================================
          // ÉTAPE A : CAUTION (Booking / Direct, pas Airbnb)
          // ========================================
          if (!isAirbnb) {
            // Créer la caution Stripe si elle n'existe pas + vérifier son statut
            const depositInfo = await ensureDepositExists(pool, conversation);
            
            if (depositInfo && depositInfo.depositExists && !depositInfo.alreadyValid) {
              // Caution pending → faut que le voyageur paie
              
              if (isWithin2Days) {
                // ✅ Arrivée dans ≤ 2 jours → envoyer le message caution immédiatement
                const amountEuros = (depositInfo.amount_cents / 100).toFixed(2);
                const lang = conversation.language || 'fr';
                
                // Récupérer le nom du logement
                const propResult = await pool.query('SELECT name FROM properties WHERE id = $1', [conversation.property_id]);
                const propertyName = propResult.rows[0]?.name || 'votre logement';
                
                const depositMessages = {
                  fr: `⚠️ Caution obligatoire

Bonjour ${conversation.guest_first_name || ''} !

Une caution de ${amountEuros}€ est requise pour votre séjour à ${propertyName}.

👉 Cliquez ici pour autoriser la caution :
${depositInfo.checkout_url}

⚠️ Sans cette autorisation, vous ne pourrez pas recevoir les informations d'arrivée (code d'accès, WiFi, etc.).

L'autorisation ne débite pas votre carte immédiatement. Le montant sera juste bloqué temporairement.

Merci ! 😊`,
                  en: `⚠️ Security deposit required

Hello ${conversation.guest_first_name || ''} !

A security deposit of €${amountEuros} is required for your stay at ${propertyName}.

👉 Click here to authorize the deposit:
${depositInfo.checkout_url}

⚠️ Without this authorization, you will not receive the arrival information (access code, WiFi, etc.).

The authorization does not charge your card immediately. The amount will just be temporarily held.

Thank you! 😊`,
                  es: `⚠️ Fianza obligatoria

¡Hola ${conversation.guest_first_name || ''} !

Se requiere una fianza de ${amountEuros}€ para su estancia en ${propertyName}.

👉 Haga clic aquí para autorizar la fianza:
${depositInfo.checkout_url}

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
                
                console.log(`💰 [HANDLER] Message caution envoyé (arrivée dans ${diffDays}j)`);
              } else {
                // 📅 Arrivée dans > 2 jours → le cron J-2 enverra le message caution
                console.log(`📅 [HANDLER] Arrivée dans ${diffDays}j, caution créée en DB → le cron J-2 enverra la demande`);
              }
              
              // STOP — infos d'arrivée bloquées tant que caution pas validée
              return true;
            }
            
            if (depositInfo && depositInfo.alreadyValid) {
              console.log(`✅ [HANDLER] Caution déjà validée → on continue vers les infos d'arrivée`);
            }
            // Si depositInfo === null → pas de caution configurée → on continue
          } else {
            console.log(`ℹ️ [HANDLER] Airbnb → pas de caution via notre système`);
          }
          
          // ========================================
          // ÉTAPE B : INFOS D'ARRIVÉE
          // Règle : seulement le jour J à partir de 7h (heure Paris)
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
        
        // ✅ STOP — Ne PAS passer à Groq
        return true;
      } else {
        // Onboarding pas encore terminé
        return true;
      }
    }

    // ========================================
    // ÉTAPE 1.5: SI DÉJÀ ESCALADÉ → NE PAS TRAITER
    // ========================================
    if (conversation.escalated) {
      console.log('ℹ️ [HANDLER] Conversation déjà escaladée → pas de traitement auto');
      return false; // false = le propriétaire doit recevoir la notification
    }

    // ========================================
    // ÉTAPE 2: INTERVENTION URGENTE
    // ========================================
    if (requiresHumanIntervention(message.message)) {
      console.log('🚨 [HANDLER] Intervention humaine urgente → escalade directe !');
      
      const urgentMessages = {
        fr: `🚨 Votre message urgent a été transmis au propriétaire qui vous contactera immédiatement.\n\nMerci de patienter, nous faisons le nécessaire ! 🙏`,
        en: `🚨 Your urgent message has been forwarded to the owner who will contact you immediately.\n\nPlease wait, we're taking care of it! 🙏`,
        es: `🚨 Su mensaje urgente ha sido transmitido al propietario que le contactará inmediatamente.\n\n¡Gracias por su paciencia! 🙏`
      };

      await sendBotMessage(
        conversation.id,
        urgentMessages[conversation.language] || urgentMessages.fr,
        pool,
        io
      );

      // Escalader immédiatement
      await pool.query(
        `UPDATE conversations SET escalated = TRUE, pending_escalation = FALSE, escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [conversation.id]
      );

      console.log('🔔 [HANDLER] Conversation escaladée (urgence)');
      return false; // false → déclencher la notification au propriétaire
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
      // Vérifier si Groq demande une escalade
      const cleanResponse = aiResponse.trim();
      
      if (cleanResponse === '[ESCALADE]' || cleanResponse.includes('[ESCALADE]')) {
        console.log('🔄 [HANDLER] Groq demande une escalade → passage au propriétaire');
        await escalateToOwner(conversation, pool, io, language);
        return false; // false → déclencher notification propriétaire
      }
      
      await sendBotMessage(conversation.id, aiResponse, pool, io);
      return true;
    }

    // ========================================
    // ÉTAPE 6: AUCUNE RÉPONSE AUTO POSSIBLE → ESCALADE DIRECTE
    // ========================================
    console.log('⚠️ [HANDLER] Aucune réponse auto → escalade directe vers propriétaire');
    
    await escalateToOwner(conversation, pool, io, language);
    return true;

  } catch (error) {
    console.error('❌ [HANDLER] Erreur handleIncomingMessage:', error);
    return false;
  }
}

/**
 * Escalader la conversation vers le propriétaire
 */
async function escalateToOwner(conversation, pool, io, language) {
  try {
    const lang = language || conversation.language || 'fr';
    
    const escaladeMessages = {
      fr: `👋 Je vous mets en relation avec le propriétaire qui pourra mieux vous aider.\n\nVotre message lui a été transmis, il vous répondra dès que possible. Merci de votre patience ! 🙏`,
      en: `👋 I'm putting you in touch with the owner who can better assist you.\n\nYour message has been forwarded, they'll reply as soon as possible. Thank you for your patience! 🙏`,
      es: `👋 Le pongo en contacto con el propietario que podrá ayudarle mejor.\n\nSu mensaje ha sido transmitido, le responderá lo antes posible. ¡Gracias por su paciencia! 🙏`
    };
    
    await sendBotMessage(
      conversation.id,
      escaladeMessages[lang] || escaladeMessages.fr,
      pool, io
    );
    
    // Marquer la conversation comme escaladée
    await pool.query(
      `UPDATE conversations SET escalated = TRUE, pending_escalation = FALSE, escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );
    
    console.log(`🔔 [HANDLER] Conversation ${conversation.id} escaladée vers propriétaire`);
    
    // Émettre un événement spécial pour notifier le propriétaire
    if (io) {
      io.to(`user_${conversation.user_id}`).emit('conversation_escalated', {
        conversationId: conversation.id,
        guestName: conversation.guest_first_name || conversation.guest_name || 'Voyageur'
      });
    }
    
  } catch (error) {
    console.error('❌ [HANDLER] Erreur escalateToOwner:', error);
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
