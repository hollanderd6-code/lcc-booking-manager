// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ
// Réponses Auto Multilingues + Groq AI + Channex
// (Onboarding supprimé — données voyageur via Channex)
// ============================================

const { getGroqResponse, requiresHumanIntervention } = require('./groq-ai');

// Stripe (pour création auto de caution)
const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ============================================
// 🔧 UTILITAIRE : Envoyer un message (DB + Channex si dispo)
// ============================================

/**
 * Envoyer un message automatique :
 * - Toujours sauvegardé en DB
 * - Envoyé via Channex si la conversation a un channex_booking_id
 */
async function sendAutoMessage(pool, io, conversationId, message, channexBookingId = null) {
  try {
    // 1. Sauvegarder en DB
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, message, is_read, created_at)
       VALUES ($1, 'system', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, message, is_read, created_at`,
      [conversationId, message]
    );
    const savedMessage = messageResult.rows[0];

    // 2. Émettre via Socket.io
    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', savedMessage);
    }

    // 3. Envoyer via Channex si channex_booking_id disponible
    if (channexBookingId) {
      try {
        const { sendBookingMessage } = require('./channex');
        await sendBookingMessage(channexBookingId, message);
        console.log(`✅ [AUTO-MSG] Message envoyé via Channex (booking ${channexBookingId})`);
      } catch (channexErr) {
        // Non bloquant — le message est déjà en DB
        console.error(`⚠️ [AUTO-MSG] Erreur envoi Channex (non bloquant):`, channexErr.message);
      }
    }

    return savedMessage;
  } catch (error) {
    console.error('❌ [AUTO-MSG] Erreur sendAutoMessage:', error);
    return null;
  }
}

// Alias pour la compatibilité avec l'ancien code
async function sendBotMessage(conversationId, message, pool, io, channexBookingId = null) {
  return sendAutoMessage(pool, io, conversationId, message, channexBookingId);
}

// ============================================
// 🏦 CAUTION : Créer si elle n'existe pas encore
// ============================================

async function ensureDepositExists(pool, conversation) {
  try {
    const propertyId = conversation.property_id;
    const startDate = conversation.reservation_start_date;

    const propResult = await pool.query(
      'SELECT id, name, deposit_amount FROM properties WHERE id = $1',
      [propertyId]
    );
    const property = propResult.rows[0];
    if (!property || !property.deposit_amount || parseFloat(property.deposit_amount) <= 0) {
      return null;
    }

    const resResult = await pool.query(
      `SELECT uid, start_date, end_date, source FROM reservations 
       WHERE property_id = $1 AND DATE(start_date) = DATE($2)
       ORDER BY created_at DESC LIMIT 1`,
      [propertyId, startDate]
    );
    if (resResult.rows.length === 0) return null;
    const reservation = resResult.rows[0];

    const existingDeposit = await pool.query(
      `SELECT id, status, checkout_url, amount_cents FROM deposits 
       WHERE reservation_uid = $1 ORDER BY created_at DESC LIMIT 1`,
      [reservation.uid]
    );

    if (existingDeposit.rows.length > 0) {
      const dep = existingDeposit.rows[0];
      if (['authorized', 'captured', 'released'].includes(dep.status)) {
        return { depositExists: true, alreadyValid: true };
      }
      if (dep.status === 'pending') {
        return { depositExists: true, alreadyValid: false, checkout_url: dep.checkout_url, amount_cents: dep.amount_cents };
      }
    }

    if (!stripe) return null;

    const userResult = await pool.query(
      `SELECT u.id as user_id, u.stripe_account_id 
       FROM users u JOIN properties p ON p.user_id = u.id WHERE p.id = $1`,
      [propertyId]
    );
    if (userResult.rows.length === 0) return null;
    const user = userResult.rows[0];

    const depositId = 'dep_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const amountCents = Math.round(parseFloat(property.deposit_amount) * 100);
    const appUrl = (process.env.APP_URL || 'https://lcc-booking-manager.onrender.com').replace(/\/$/, '');
    const endDateStr = reservation.end_date ? new Date(reservation.end_date).toISOString().split('T')[0] : '';
    const startDateStr = new Date(reservation.start_date).toISOString().split('T')[0];

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price_data: { currency: 'eur', unit_amount: amountCents, product_data: { name: `Caution - ${property.name}`, description: `Réservation du ${startDateStr} au ${endDateStr}` } }, quantity: 1 }],
      payment_intent_data: { capture_method: 'manual', metadata: { deposit_id: depositId, reservation_uid: reservation.uid } },
      metadata: { deposit_id: depositId, reservation_uid: reservation.uid, user_id: user.user_id },
      success_url: `${appUrl}/caution-success.html?depositId=${depositId}`,
      cancel_url: `${appUrl}/caution-cancel.html?depositId=${depositId}`
    };

    let session;
    if (user.stripe_account_id) {
      session = await stripe.checkout.sessions.create(sessionParams, { stripeAccount: user.stripe_account_id });
    } else {
      session = await stripe.checkout.sessions.create(sessionParams);
    }

    await pool.query(
      `INSERT INTO deposits (id, user_id, reservation_uid, property_id, amount_cents, status, stripe_session_id, checkout_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW(), NOW())`,
      [depositId, user.user_id, reservation.uid, propertyId, amountCents, session.id, session.url]
    );

    console.log(`✅ [DEPOSIT-AUTO] Caution créée: ${depositId} (${amountCents/100}€)`);
    return { depositExists: true, alreadyValid: false, checkout_url: session.url, amount_cents: amountCents };

  } catch (error) {
    console.error('❌ [DEPOSIT-AUTO] Erreur:', error);
    return null;
  }
}

// ============================================
// 📩 HANDLER PRINCIPAL : Message entrant du voyageur
// ============================================

async function handleIncomingMessage(message, conversation, pool, io) {
  try {
    const channexId = conversation.channex_booking_id || null;
    
    console.log(`📩 [HANDLER] Message de ${conversation.guest_name || 'client'}: "${message.message.substring(0, 50)}"`);
    console.log(`📩 [HANDLER] Conv ${conversation.id} | Channex: ${channexId || 'non'} | Platform: ${conversation.platform || '?'}`);

    if (message.sender_type !== 'guest') {
      console.log(`ℹ️ [HANDLER] Message ignoré (sender_type = ${message.sender_type})`);
      return false;
    }

    // ========================================
    // FILTRE : Messages système Booking/OTA
    // Ces messages ne sont pas de vrais messages voyageur
    // ========================================
    const msgText = message.message || '';
    const isOtaSystemMessage = (
      msgText.includes('THIS RESERVATION HAS BEEN PRE-PAID') ||
      msgText.includes('BOOKING NOTE :') ||
      msgText.includes('BOOKING NOTE:') ||
      msgText.includes('OTA Commission:') ||
      msgText.includes('Payment Collect:') ||
      msgText.includes('Meal Plan:') ||
      msgText.includes('Smoking Preference:') ||
      /^\*\*.*\*\*\s*\n/.test(msgText) // message qui commence par **...**
    );
    if (isOtaSystemMessage) {
      console.log(`ℹ️ [HANDLER] Message système OTA ignoré (notes de réservation Booking)`);
      return false;
    }

    // ========================================
    // ÉTAPE 1 : INTERVENTION URGENTE
    // ========================================
    if (conversation.escalated) {
      console.log('ℹ️ [HANDLER] Conversation déjà escaladée → notification proprio');
      return false;
    }

    if (requiresHumanIntervention(message.message)) {
      console.log('🚨 [HANDLER] Urgence → escalade directe');
      const lang = conversation.language || 'fr';
      const urgentMessages = {
        fr: `🚨 Votre message urgent a été transmis au responsable qui vous contactera immédiatement.\n\nMerci de patienter ! 🙏`,
        en: `🚨 Your urgent message has been forwarded to the owner who will contact you immediately.\n\nThank you for your patience! 🙏`,
        es: `🚨 Su mensaje urgente ha sido transmitido al propietario.\n\n¡Gracias por su paciencia! 🙏`
      };
      await sendBotMessage(conversation.id, urgentMessages[lang] || urgentMessages.fr, pool, io, channexId);
      await pool.query(
        `UPDATE conversations SET escalated = TRUE, escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
      return false;
    }

    // ========================================
    // ÉTAPE 2 : RÉCUPÉRER INFOS PROPRIÉTÉ
    // ========================================
    let property = null;
    if (conversation.property_id) {
      const propResult = await pool.query('SELECT * FROM properties WHERE id = $1', [conversation.property_id]);
      property = propResult.rows[0] || null;
    }

    const autoEnabled = property?.auto_responses_enabled !== false;
    if (!autoEnabled) {
      console.log('ℹ️ [HANDLER] Réponses auto désactivées pour ce logement');
      return false;
    }

    // Détecter la langue depuis le message plutôt que conversation.language
    // car conversation.language peut être null ou mal renseigné
    const _msgLower = message.message.toLowerCase();
    let language = 'fr'; // défaut français
    if (conversation.language && ['fr','en','es','de','it'].includes(conversation.language)) {
      language = conversation.language;
    } else {
      // Détection élargie : compte les mots ou patterns caractéristiques de chaque langue
      const enPatterns = /\b(hello|hi|hey|thanks|thank you|please|what|where|when|how|who|can|could|would|should|is there|are there|do you|could you|i need|i want|i have|my|your|the|is|are|and|but|or|with|for|from|to|at|on|wifi|password|check[\s-]?in|check[\s-]?out|address|arrival|departure)\b/gi;
      const esPatterns = /\b(hola|gracias|por favor|dónde|cuándo|cómo|qué|puedo|quiero|tengo|necesito|dirección|contraseña|llegada|salida)\b/gi;
      const dePatterns = /\b(hallo|guten tag|danke|bitte|wo|wann|wie|was|ich|können|möchte|brauche|adresse|passwort|ankunft|abreise)\b/gi;
      const itPatterns = /\b(ciao|grazie|per favore|dove|quando|come|cosa|posso|vorrei|ho bisogno|indirizzo|password|arrivo|partenza)\b/gi;
      const frPatterns = /\b(bonjour|bonsoir|merci|s'il vous plaît|où|quand|comment|puis-je|voudrais|besoin|adresse|code|arrivée|départ|avez-vous|est-ce|nous|vous|je)\b/gi;

      const scores = {
        en: (message.message.match(enPatterns) || []).length,
        es: (message.message.match(esPatterns) || []).length,
        de: (message.message.match(dePatterns) || []).length,
        it: (message.message.match(itPatterns) || []).length,
        fr: (message.message.match(frPatterns) || []).length,
      };

      // Trouver la langue avec le plus de matches
      const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      if (best[1] > 0) {
        language = best[0];
      }
      // Sinon on garde 'fr' par défaut

      console.log(`🌍 [HANDLER] Langue détectée: ${language} (scores:`, scores, ')');
    }

    // ========================================
    // ÉTAPE 2.3 : DÉTECTION REMERCIEMENT / FIN DE SÉJOUR
    // On répond brièvement SAUF si le message contient aussi une plainte/oubli
    // ========================================
    {
      const msgLow = message.message.toLowerCase();

      // Patterns de remerciement par langue
      const thanksPatterns = /(?<!\p{L})(merci|thanks|thank you|gracias|danke|grazie|cheers|ty|tks|thx|super séjour|bon séjour|agréable séjour|great stay|lovely stay|bonne journée|have a nice|enjoyed|appreciated)(?!\p{L})/iu;
      // Patterns de plainte/problème qui doivent escalader malgré le "merci"
      const problemPatterns = /(?<!\p{L})(oublié|laissé|perdu|cassé|problème|souci|plainte|broken|lost|forgot|left behind|complaint|issue|damaged|stolen|dispute|remboursement|refund|not working|ne fonctionne|ne marche)(?!\p{L})/iu;

      const hasThanks = thanksPatterns.test(msgLow);
      const hasProblem = problemPatterns.test(msgLow);
      // Message court (< 25 mots) ET contient un remerciement ET ne contient PAS de problème
      const wordCount = msgLow.split(/\s+/).filter(Boolean).length;

      if (hasThanks && !hasProblem && wordCount < 25) {
        const thanksReplies = {
          fr: "Merci beaucoup ! 😊 Nous sommes ravis que vous appréciez votre séjour. N'hésitez pas si vous avez d'autres questions !",
          en: "Thank you so much! 😊 We're delighted you're enjoying your stay. Don't hesitate if you have any other questions!",
          es: "¡Muchas gracias! 😊 Nos alegra que esté disfrutando de su estancia. ¡No dude en preguntar si necesita algo más!",
          de: "Vielen Dank! 😊 Es freut uns, dass Sie Ihren Aufenthalt genießen. Zögern Sie nicht, wenn Sie weitere Fragen haben!",
          it: "Grazie mille! 😊 Siamo contenti che stia godendo del suo soggiorno. Non esiti a chiederci se ha altre domande!",
        };
        const reply = thanksReplies[language] || thanksReplies.fr;
        console.log(`🙏 [HANDLER] Remerciement détecté → réponse courte en ${language}`);
        await sendBotMessage(conversation.id, reply, pool, io, channexId);
        return true;
      }

      if (hasThanks && hasProblem) {
        console.log(`⚠️ [HANDLER] Remerciement + problème détectés → escalade (plainte/oubli)`);
        await escalateToOwner(conversation, pool, io, language, channexId);
        return true;
      }
    }

    // ========================================
    // ÉTAPE 2.5 : RÉPONSES PERSONNALISÉES EN PRIORITÉ
    // ========================================
    if (property) {
      try {
        const rawQR = property.custom_auto_responses || property.customAutoResponses;
        const customQR = Array.isArray(rawQR) ? rawQR
          : (typeof rawQR === 'string' ? JSON.parse(rawQR) : []);

        if (customQR.length > 0) {
          const msgLower = message.message.toLowerCase();

          // 1. Match exact d'abord (rapide, gratuit)
          let matched = customQR.find(qr => {
            if (!qr.keywords || !qr.response) return false;
            const entries = qr.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            return entries.some(entry => {
              if (msgLower.includes(entry)) return true;
              const words = entry.split(/\s+/).filter(w => w.length >= 4);
              return words.length > 0 && words.some(w => msgLower.includes(w));
            });
          });

          // 2. Si pas de match exact → matching sémantique via Groq
          if (!matched && customQR.length > 0) {
            try {
              const topicsList = customQR
                .filter(qr => qr.keywords && qr.response)
                .map((qr, i) => `${i}: ${qr.keywords}`)
                .join('\n');

              const semanticPrompt = `You are a topic matcher. Given a guest message and a list of topics, return ONLY the number of the matching topic, or -1 if none match.

Guest message: "${message.message}"

Topics:
${topicsList}

Rules:
- Return ONLY a single integer (e.g. 0, 1, 2... or -1)
- Match if the guest is asking about the same subject, even in a different language
- Be strict: only match if clearly related
- No explanation, just the number`;

              const semanticResult = await getGroqResponse(semanticPrompt, { language: 'en' });
              const idx = semanticResult ? parseInt(semanticResult.trim()) : -1;
              if (!isNaN(idx) && idx >= 0 && idx < customQR.length) {
                matched = customQR[idx];
                console.log(`🧠 [HANDLER] Match sémantique Groq: topic ${idx} ("${matched.keywords}")`);
              }
            } catch(e) {
              console.warn('⚠️ [HANDLER] Erreur matching sémantique:', e.message);
            }
          }
          if (matched) {
            console.log(`✅ [HANDLER] Match Q/R personnalisée: "${matched.keywords}"`);
            let finalResponse = matched.response;

            // Traduire automatiquement si la langue n'est pas le français
            if (language !== 'fr' && matched.response) {
              try {
                const translated = await getGroqResponse(
                  `Translate the following text to ${language === 'en' ? 'English' : language === 'es' ? 'Spanish' : language === 'de' ? 'German' : language === 'it' ? 'Italian' : 'English'}. Return ONLY the translated text, nothing else:\n\n${matched.response}`,
                  { language: 'en' } // contexte neutre pour la traduction
                );
                if (translated && !translated.includes('[ESCALADE]')) {
                  finalResponse = translated;
                  console.log(`🌍 [HANDLER] Réponse traduite en ${language}`);
                }
              } catch(e) {
                console.warn('⚠️ [HANDLER] Erreur traduction:', e.message);
                // Fallback sur la réponse originale
              }
            }

            await sendBotMessage(conversation.id, finalResponse, pool, io, channexId);
            return true;
          }
        }
      } catch(e) {
        console.warn('⚠️ [HANDLER] Erreur matching custom QR:', e.message);
      }
    }

    // ========================================
    // ÉTAPE 3 : GROQ AI (tous les messages non matchés en amont)
    // Note: l'ancien matching mots-clés (detectCategory) a été supprimé
    // car trop imprécis (ex: "address" matchait "access"). Groq fait tout
    // le travail avec le contexte complet du livret d'accueil.
    // ========================================
    console.log('🚀 [HANDLER] Groq AI...');

    // Récupérer le contenu du livret d'accueil si une URL est disponible
    let welcomeBookData = null;
    if (property?.welcome_book_url) {
      try {
        // Extraire le unique_id depuis l'URL (ex: /welcome/abc123 ou ?id=abc123)
        const urlMatch = property.welcome_book_url.match(/\/welcome\/([a-zA-Z0-9_-]+)/);
        const uniqueId = urlMatch ? urlMatch[1] : null;
        if (uniqueId) {
          const bookResult = await pool.query(
            'SELECT data FROM welcome_books_v2 WHERE unique_id = $1',
            [uniqueId]
          );
          if (bookResult.rows.length > 0) {
            welcomeBookData = bookResult.rows[0].data || null;
            console.log(`📖 [HANDLER] Livret d'accueil chargé pour Groq (unique_id: ${uniqueId})`);
          }
        }
      } catch(e) {
        console.warn('⚠️ [HANDLER] Erreur chargement livret pour Groq:', e.message);
      }
    }

    // Récupérer les Q/R personnalisées pour les passer à Groq comme référence
    let customQRSummary = null;
    if (property) {
      try {
        const rawQR = property.custom_auto_responses || property.customAutoResponses;
        const customQR = Array.isArray(rawQR) ? rawQR
          : (typeof rawQR === 'string' ? JSON.parse(rawQR) : []);
        if (customQR.length > 0) {
          customQRSummary = customQR
            .filter(qr => qr.keywords && qr.response)
            .map(qr => `- Mots-clés: "${qr.keywords}" → Réponse: "${qr.response}"`)
            .join('\n');
        }
      } catch(e) {
        console.warn('⚠️ [HANDLER] Erreur lecture Q/R pour Groq:', e.message);
      }
    }

    const context = property ? {
      propertyName: property.name,
      welcomeBookUrl: property.welcome_book_url,
      wifiName: property.wifi_name || welcomeBookData?.wifiSSID,
      wifiPassword: property.wifi_password || welcomeBookData?.wifiPassword,
      arrivalTime: property.arrival_time,
      departureTime: property.departure_time || welcomeBookData?.checkoutTime,
      // Concaténer l'adresse complète (rue + code postal + ville) pour que l'IA
      // puisse répondre à "what's the complete address with postal code and city"
      address: (() => {
        const parts = [
          property.address || welcomeBookData?.address,
          welcomeBookData?.postalCode,
          welcomeBookData?.city,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
      })(),
      accessCode: property.access_code || welcomeBookData?.keyboxCode,
      accessInstructions: property.access_instructions || welcomeBookData?.accessInstructions,
      parkingInfo: welcomeBookData?.parkingInfo,
      extraNotesAccess: welcomeBookData?.extraNotesAccess,
      checkoutInstructions: welcomeBookData?.checkoutInstructions,
      equipmentList: welcomeBookData?.equipmentList,
      importantRules: welcomeBookData?.importantRules,
      transportInfo: welcomeBookData?.transportInfo,
      extraNotesPractical: welcomeBookData?.extraNotesPractical,
      welcomeDescription: welcomeBookData?.welcomeDescription,
      contactPhone: welcomeBookData?.contactPhone,
      restaurants: welcomeBookData?.restaurants,
      places: welcomeBookData?.places,
      shopsList: welcomeBookData?.shopsList,
      extraNotesAround: welcomeBookData?.extraNotesAround,
      rooms: welcomeBookData?.rooms,
      extraNotesLogement: welcomeBookData?.extraNotesLogement,
      practicalInfo: property.practical_info,
      customQRSummary,
      language
    } : { language };

    const aiResponse = await getGroqResponse(message.message, context);

    if (aiResponse) {
      if (aiResponse.trim() === '[ESCALADE]' || aiResponse.includes('[ESCALADE]')) {
        console.log('🔄 [HANDLER] Groq → escalade');
        await escalateToOwner(conversation, pool, io, language, channexId);
        return false;
      }
      await sendBotMessage(conversation.id, aiResponse, pool, io, channexId);
      return true;
    }

    // ========================================
    // ÉTAPE 5 : ESCALADE DIRECTE
    // ========================================
    console.log('⚠️ [HANDLER] Aucune réponse → escalade');
    await escalateToOwner(conversation, pool, io, language, channexId);
    return true;

  } catch (error) {
    console.error('❌ [HANDLER] Erreur handleIncomingMessage:', error);
    return false;
  }
}

// ============================================
// 🔔 ESCALADE VERS PROPRIÉTAIRE
// ============================================

async function escalateToOwner(conversation, pool, io, language, channexId = null) {
  try {
    const lang = language || conversation.language || 'fr';
    const msgs = {
      fr: `👋 Je vous mets en relation avec le responsable qui pourra mieux vous aider.\n\nVotre message lui a été transmis, il vous répondra dès que possible. Merci de votre patience ! 🙏`,
      en: `👋 I'm connecting you with the owner who can better assist you.\n\nYour message has been forwarded, they'll reply as soon as possible. Thank you! 🙏`,
      es: `👋 Le pongo en contacto con el propietario.\n\nSu mensaje ha sido transmitido. ¡Gracias por su paciencia! 🙏`
    };
    await sendBotMessage(conversation.id, msgs[lang] || msgs.fr, pool, io, channexId);
    await pool.query(
      `UPDATE conversations SET escalated = TRUE, escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );
    if (io) {
      io.to(`user_${conversation.user_id}`).emit('conversation_escalated', {
        conversationId: conversation.id,
        guestName: conversation.guest_name || 'Voyageur'
      });
    }
  } catch (error) {
    console.error('❌ [HANDLER] Erreur escalateToOwner:', error);
  }
}

module.exports = {
  handleIncomingMessage,
  sendBotMessage,
  sendAutoMessage
};
