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
// ⏳ DEBOUNCE — Grouper les messages rapprochés
// Si plusieurs messages arrivent en moins de DEBOUNCE_DELAY ms,
// ils sont fusionnés et traités ensemble en un seul appel Groq.
// ============================================

const DEBOUNCE_DELAY = 90 * 1000; // 90 secondes

// Map conversationId → { timer, messages: [], conversation, pool, io }
const _debounceMap = new Map();

/**
 * Point d'entrée public — appelé à chaque message entrant.
 * Si un timer est déjà en cours pour cette conv, on ajoute le message et on repart.
 * Sinon on démarre un nouveau timer.
 */
async function handleIncomingMessageDebounced(message, conversation, pool, io) {
  const convId = conversation.id;

  // ── Cas où on NE debounce PAS ──────────────────────────────────────────
  // 1. Urgences → répondre immédiatement
  // 2. Messages système OTA → ignorer immédiatement
  // 3. Sender non-guest → ignorer immédiatement
  if (message.sender_type !== 'guest') {
    return handleIncomingMessage(message, conversation, pool, io);
  }
  const msgText = message.message || '';
  const isOtaSystem = (
    msgText.includes('THIS RESERVATION HAS BEEN PRE-PAID') ||
    msgText.includes('BOOKING NOTE :') ||
    msgText.includes('BOOKING NOTE:') ||
    msgText.includes('Imported Booking') ||
    msgText.toLowerCase().startsWith('imported booking') ||
    msgText.includes('Demande(s) du voyageur') ||
    msgText.includes('Request(s) from guest') ||
    msgText.includes('OTA Commission:') ||
    msgText.includes('Payment Collect:')
  );
  if (isOtaSystem) {
    return handleIncomingMessage(message, conversation, pool, io);
  }
  if (requiresHumanIntervention(msgText)) {
    // Urgence → pas de délai
    console.log(`⚡ [DEBOUNCE] Urgence conv ${convId} → traitement immédiat`);
    return handleIncomingMessage(message, conversation, pool, io);
  }

  // Conv escaladée → pas de debounce, traitement immédiat pour envoyer la notif
  if (conversation.escalated) {
    console.log(`🔔 [DEBOUNCE] Conv ${convId} escaladée → traitement immédiat (notif propriétaire)`);
    return handleIncomingMessage(message, conversation, pool, io);
  }

  // ── Debounce normal ─────────────────────────────────────────────────────
  if (_debounceMap.has(convId)) {
    // Timer existant → on ajoute le message et on repart à zéro
    const state = _debounceMap.get(convId);
    state.messages.push(message);
    state.conversation = conversation; // mettre à jour au cas où
    clearTimeout(state.timer);
    console.log(`⏳ [DEBOUNCE] Conv ${convId} — ${state.messages.length} message(s) en attente, timer reset`);
    state.timer = setTimeout(() => _flushDebounce(convId, pool, io), DEBOUNCE_DELAY);
  } else {
    // Nouveau timer
    console.log(`⏳ [DEBOUNCE] Conv ${convId} — démarrage timer (${DEBOUNCE_DELAY/1000}s)`);
    const timer = setTimeout(() => _flushDebounce(convId, pool, io), DEBOUNCE_DELAY);
    _debounceMap.set(convId, {
      timer,
      messages: [message],
      conversation,
    });
  }
  // Retourner true = 'pris en charge par le debounce' pour bloquer la notif immédiate
  // La notif sera envoyée par _flushDebounce si l'IA ne répond pas (escalade)
  return true;
}

/**
 * Déclenché après le délai de silence.
 * Fusionne tous les messages en attente et appelle handleIncomingMessage une seule fois.
 */
async function _flushDebounce(convId, pool, io) {
  const state = _debounceMap.get(convId);
  _debounceMap.delete(convId);
  if (!state || state.messages.length === 0) return;

  const { messages, conversation } = state;

  // Verifier si la conv a ete escaladee entre-temps
  try {
    const freshConv = await pool.query('SELECT escalated FROM conversations WHERE id = $1', [convId]);
    if (freshConv.rows[0]?.escalated) {
      console.log(`⏭️ [DEBOUNCE] Conv ${convId} deja escaladee — skip flush`);
      return;
    }
  } catch(e) { /* non bloquant */ }

  if (messages.length === 1) {
    // Un seul message → comportement normal
    console.log(`⏳ [DEBOUNCE] Conv ${convId} — 1 message → traitement normal`);
    const r1 = await handleIncomingMessage(messages[0], conversation, pool, io);
    // Si l'IA n'a pas répondu (escalade), émettre un event pour que le server envoie la notif
    if (!r1 && io) io.emit('_debounce_notif_needed', { conversation_id: convId, user_id: conversation.user_id, message: messages[0].message, guest_name: messages[0].sender_name || conversation.guest_name });
    return;
  }

  // Plusieurs messages → passer comme contexte multi-lignes
  // On garde les métadonnées du dernier message mais on enrichit le contenu
  // avec tous les messages pour que Groq comprenne le contexte complet
  console.log(`⏳ [DEBOUNCE] Conv ${convId} — ${messages.length} messages fusionnés → 1 appel Groq`);

  const lastMsg = messages[messages.length - 1];

  // Format : chaque message sur une ligne préfixée par un numéro
  // Groq comprendra qu'il s'agit de plusieurs messages successifs
  const combinedText = messages.length > 1
    ? messages.map((m, i) => `[Message ${i + 1}] ${m.message}`).join('\n')
    : messages[0].message;

  const combinedMessage = {
    ...lastMsg,
    message: combinedText,
    _debounced: true,
    _messageCount: messages.length,
  };

  const r2 = await handleIncomingMessage(combinedMessage, conversation, pool, io);
  if (!r2 && io) io.emit('_debounce_notif_needed', { conversation_id: convId, user_id: conversation.user_id, message: lastMsg.message, guest_name: lastMsg.sender_name || conversation.guest_name });
}

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
      msgText.includes('Imported Booking') ||
      msgText.toLowerCase().startsWith('imported booking') ||
      msgText.includes('Demande(s) du voyageur') ||
      msgText.includes('Request(s) from guest') ||
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
    // Recharger l'état escalade depuis la DB (l'objet mémoire peut être périmé)
    try {
      const freshConv = await pool.query(
        'SELECT escalated FROM conversations WHERE id = $1',
        [conversation.id]
      );
      if (freshConv.rows[0]?.escalated) {
        console.log('ℹ️ [HANDLER] Conversation escaladée (DB) → bot silencieux');
        // Notifier le proprio que le voyageur a envoyé un nouveau message
        try {
          const tokens = await pool.query(
            'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
            [conversation.user_id]
          );
          if (tokens.rows.length > 0) {
            const { sendNotification } = require('./firebase');
            for (const tok of tokens.rows) {
              await sendNotification(
                tok.fcm_token,
                `💬 ${conversation.guest_name || 'Voyageur'} a répondu`,
                `Nouveau message dans une conversation en attente de votre réponse.`,
                { type: 'new_guest_message', conversation_id: String(conversation.id) }
              );
              console.log(`📱 [HANDLER] Notif escalade envoyée: ${tok.fcm_token.substring(0,20)}`);
            }
          } else {
            console.warn('⚠️ [HANDLER] Aucun token FCM pour conv escaladée id=', conversation.id);
          }
        } catch(e) { console.error('❌ [HANDLER] Erreur notif escalade:', e.message); }
        // Retourner true : la notif a ete envoyee ici, le server ne doit pas en envoyer une 2e
        return true;
      }
    } catch(e) {
      // Si DB echoue, fallback sur l'objet memoire
      if (conversation.escalated) {
        console.log('ℹ️ [HANDLER] Conversation deja escaladee (memoire) → bot silencieux');
        return true; // notif deja envoyee ou non disponible
      }
    }

    if (requiresHumanIntervention(message.message)) {
      console.log('🚨 [HANDLER] Urgence → escalade directe');
      const lang = conversation.language || 'fr';
      const urgentMessages = {
        fr: `🚨 Votre message urgent a été transmis au responsable qui vous contactera immédiatement.\n\nMerci de patienter ! 🙏`,
        en: `🚨 Your urgent message has been forwarded to the owner who will contact you immediately.\n\nThank you for your patience! 🙏`,
        es: `🚨 Su mensaje urgente ha sido transmitido al propietario.\n\n¡Gracias por su paciencia! 🙏`,
        pt: `🚨 A sua mensagem urgente foi transmitida ao responsável que o contactará imediatamente.\n\nObrigado pela sua paciência! 🙏`,
        de: `🚨 Ihre dringende Nachricht wurde an den Verantwortlichen weitergeleitet, der Sie sofort kontaktieren wird.\n\nVielen Dank für Ihre Geduld! 🙏`,
        it: `🚨 Il suo messaggio urgente è stato trasmesso al responsabile che la contatterà immediatamente.\n\nGrazie per la pazienza! 🙏`,
        nl: `🚨 Uw dringende bericht is doorgestuurd naar de verantwoordelijke die u onmiddellijk zal contacteren.\n\nBedankt voor uw geduld! 🙏`,
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

    // Détecter la langue depuis le message, puis fallback sur la langue de la conversation/réservation
    const _msgLower = message.message.toLowerCase();
    let language = 'auto'; // défaut : Groq détecte automatiquement

    if (conversation.language && ['fr','en','es','de','it','pt','nl','ru','zh','ja','ko'].includes(conversation.language)) {
      // Langue explicite connue depuis la plateforme → priorité absolue
      language = conversation.language;
      console.log('🌍 [HANDLER] Langue depuis conversation.language:', language);
    } else {
      // Détection locale rapide pour les 7 langues principales
      const enP = /\b(hello|hi|hey|thanks|thank you|thank|please|what|where|when|how|can|could|would|i need|i want|wifi|password|check.in|check.out|address|arrival|departure|ok|okay|yes|no|sure|great|perfect|good|nice|fine|got it|sounds good|understood|of course|no problem|is that|exact|location)\b/gi;
      const esP = /\b(hola|gracias|por favor|dónde|cuándo|puedo|quiero|necesito|contraseña|llegada|salida)\b/gi;
      const deP = /\b(hallo|danke|bitte|wo|wann|wie|was|ich|können|möchte|passwort|ankunft|abreise)\b/gi;
      const itP = /\b(ciao|grazie|dove|quando|posso|vorrei|ho bisogno|indirizzo|arrivo|partenza)\b/gi;
      const frP = /\b(bonjour|bonsoir|merci|où|quand|comment|puis-je|voudrais|besoin|arrivée|départ|avez-vous|est-ce|nous|vous|je)\b/gi;
      const ptP = /\b(olá|ola|obrigado|obrigada|por favor|onde|quando|posso|quero|preciso|senha|chegada|saída|entrada|como|bom dia|boa tarde)\b/gi;
      const nlP = /\b(hallo|hoi|bedankt|dank|alsjeblieft|waar|wanneer|kan|wil|nodig|wachtwoord|aankomst|vertrek)\b/gi;

      const scores = {
        en: (message.message.match(enP) || []).length,
        es: (message.message.match(esP) || []).length,
        de: (message.message.match(deP) || []).length,
        it: (message.message.match(itP) || []).length,
        fr: (message.message.match(frP) || []).length,
        pt: (message.message.match(ptP) || []).length,
        nl: (message.message.match(nlP) || []).length,
      };

      const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      if (best[1] >= 1) {
        language = best[0];
        console.log('🌍 [HANDLER] Langue détectée localement:', language, '(scores:', scores, ')');
        // Memoriser en DB pour les prochains messages de cette conv
        if (language !== 'fr') {
          pool.query('UPDATE conversations SET language = $1 WHERE id = $2 AND (language IS NULL OR language = $3)', [language, conversation.id, 'auto']).catch(() => {});
        }
      } else {
        // Pas assez de mots → utiliser la langue de la réservation si disponible
        const convLang = conversation.guest_language || conversation.language || null;
        if (convLang) {
          const l = convLang.toLowerCase().split('-')[0];
          if (['en','es','de','it','pt','nl','ru','zh','ja','ko'].includes(l)) {
            language = l;
            console.log('🌍 [HANDLER] Langue depuis réservation/conv:', language);
          }
        }
        // Sinon language reste 'auto' → Groq détecte
        if (language === 'auto') console.log('🌍 [HANDLER] Langue: auto (Groq détecte)');
      }
    }

    // ========================================
    // ÉTAPE 2.2 : CAS SPÉCIAUX — CAUTION & HEURE D'ARRIVÉE
    // Traités avant Groq car réponses fixes, pas besoin d'IA
    // ========================================
    {
      const msgLow = message.message.toLowerCase();

      // ── CAS A : Caution — contestation / refus / incompréhension ───
      // "je n'ai pas l'argent", "je savais pas", "c'est quoi cette caution",
      // "je veux pas payer la caution", "j'annule à cause de la caution"
      const depositComplaintPattern = /(?<!\p{L})(caution|dépôt de garantie|deposit|garantie|je n'?ai pas|pas l'argent|pas assez|je savais pas|je ne savais pas|savais pas qu|je comprends pas|c'est quoi|pourquoi une caution|annul.*caution|caution.*annul|refus.*caution|caution.*refus|je veux pas payer|je ne veux pas payer|je peux pas payer|impossible de payer)(?!\p{L})/iu;

      if (depositComplaintPattern.test(msgLow) && msgLow.includes('caution') || 
          (msgLow.includes('caution') && (msgLow.includes('annul') || msgLow.includes("pas l'argent") || msgLow.includes('je n') || msgLow.includes('savais') || msgLow.includes('refus') || msgLow.includes('comprends')))) {
        
        const depositReplies = {
          fr: `Bonjour 😊

Merci de nous avoir contactés. Nous comprenons que cette information puisse parfois surprendre.

La caution fait partie intégrante de nos conditions de réservation — elle est mentionnée dans l'annonce et est malheureusement obligatoire pour confirmer votre séjour. Elle vous sera intégralement restituée après votre départ, dès lors qu'aucun dommage n'est constaté. 🏠✨

Si vous souhaitez annuler votre réservation, vous pouvez en faire la demande directement via la plateforme. Sachez cependant que selon nos conditions d'annulation, des frais peuvent s'appliquer — nous ne sommes pas en mesure de garantir une annulation gratuite.

N'hésitez pas si vous avez des questions, nous sommes là pour vous aider ! 🙏`,
          en: `Hello 😊

Thank you for reaching out. We understand this may come as a surprise.

The security deposit is a mandatory part of our booking conditions — it is mentioned in the listing and is required to confirm your stay. It will be fully refunded after your check-out, provided no damages are found. 🏠✨

If you'd like to cancel your reservation, you can do so directly through the platform. Please note that cancellation fees may apply depending on our cancellation policy — we cannot guarantee a free cancellation.

Feel free to reach out if you have any questions! 🙏`,
          es: `¡Hola! 😊

Gracias por contactarnos. Entendemos que esta información pueda sorprenderle.

El depósito de seguridad forma parte de nuestras condiciones de reserva — está indicado en el anuncio y es obligatorio para confirmar su estancia. Le será devuelto íntegramente tras su salida, siempre que no haya daños. 🏠✨

Si desea cancelar su reserva, puede hacerlo directamente desde la plataforma. Tenga en cuenta que pueden aplicarse gastos de cancelación según nuestras condiciones — no podemos garantizar una cancelación gratuita.

¡No dude en contactarnos si tiene alguna pregunta! 🙏`
        };

        const reply = depositReplies[language] || depositReplies.fr;
        console.log(`💰 [HANDLER] Contestation caution → réponse automatique (lang: ${language})`);
        await sendBotMessage(conversation.id, reply, pool, io, channexId);
        return true;
      }

      // ── CAS B-bis : Retard au départ (checkout) ───────────────────
      // "on aura 20 minutes de retard", "we'll be 30 minutes late", "slight delay"
      // Si retard <= 60 min → confirmer. Si > 60 min ou non précisé → escalader.
      {
        const nowCo = new Date();
        const checkoutDtCo = conversation.reservation_end_date ? new Date(conversation.reservation_end_date) : null;
        const checkinDtCo  = conversation.reservation_start_date ? new Date(conversation.reservation_start_date) : null;
        // On n'active ce cas que si on est en cours de séjour ET que c'est le jour du checkout
        const isDuringCo = checkinDtCo && checkoutDtCo && nowCo >= checkinDtCo && nowCo <= checkoutDtCo;
        const isCheckoutDay = checkoutDtCo &&
          nowCo.getFullYear() === checkoutDtCo.getFullYear() &&
          nowCo.getMonth()    === checkoutDtCo.getMonth()    &&
          nowCo.getDate()     === checkoutDtCo.getDate();

        const checkoutDelayPattern = /(?:retard|en retard|late|delay(?:ed)?|we.?ll be late|aura.*retard|aurons.*retard|on sera en retard|désolé.*retard|retard.*départ|retard.*checkout|retard.*sortie|minutes? de retard|minutes? late|slight delay|un peu de retard|petit retard)/i;

        if ((isDuringCo || isCheckoutDay) && checkoutDelayPattern.test(msgLow)) {
          // Extraire le nombre de minutes si présent (ex: "20 minutes", "30 min", "une heure")
          const minMatch = msgLow.match(/(\d+)\s*(?:minute|min|mn)/i);
          const hrMatch  = msgLow.match(/(\d+)\s*(?:heure|hour|h\b)/i);
          let delayMinutes = null;
          if (minMatch)      delayMinutes = parseInt(minMatch[1]);
          else if (hrMatch)  delayMinutes = parseInt(hrMatch[1]) * 60;

          const departureTime = property?.departure_time || null; // ex: "11:00"

          if (delayMinutes !== null && delayMinutes <= 60) {
            // Retard raisonnable → confirmer
            const checkoutDelayOkReplies = {
              fr: `Pas de problème, nous comprenons que les retards peuvent arriver. ${departureTime ? `Vous devriez partir vers ${departureTime.replace(':','h')} + ${delayMinutes} min — ` : ''}Prenez votre temps et bon retour ! 😊`,
              en: `No problem at all, we understand delays happen. ${departureTime ? `You should be checking out around ${delayMinutes} minutes after ${departureTime} — ` : ''}Take your time and safe travels! 😊`,
              es: `¡No hay problema, entendemos que los retrasos ocurren! ${departureTime ? `Debería salir unos ${delayMinutes} minutos después de las ${departureTime} — ` : ''}¡Tómese su tiempo y buen viaje! 😊`,
            };
            const reply = checkoutDelayOkReplies[language] || checkoutDelayOkReplies.fr;
            console.log(`🚪 [HANDLER] Retard checkout ${delayMinutes} min (<=60) → confirmation auto`);
            await sendBotMessage(conversation.id, reply, pool, io, channexId);
            return true;
          } else {
            // Retard > 60 min, ou pas de durée précisée → escalader
            console.log(`🚪 [HANDLER] Retard checkout ${delayMinutes !== null ? delayMinutes + ' min' : 'non précisé'} (>60 ou indéfini) → escalade`);
            await escalateToOwner(conversation, pool, io, language, channexId);
            return false;
          }
        }
      }

      // ── CAS B : Heure d'arrivée — le voyageur INFORME de son heure ───
      // "j'arrive à 19h", "je serai là vers 18h", "on arrive vers 20h"
      // Distinguer "informer" (→ confirmer) de "demander" (→ Groq/escalade)
      const arrivalInfoPattern = /(?:je serai|j'arrive|j'arriverai|j'arriverais|on arrive|nous arriverons|nous arrivons|on sera|we.ll arrive|we.?re arriving|i.?ll be there|i arrive|arriving around|arriving at)\s+(?:vers?|around|at|à)?\s*(\d{1,2})[h:]\s*(\d{0,2})/i;
      const arrivalMatch = message.message.match(arrivalInfoPattern);

      if (arrivalMatch) {
        const hour = parseInt(arrivalMatch[1]);
        const checkinHour = property?.arrival_time
          ? parseInt(property.arrival_time.split(':')[0] || property.arrival_time.split('h')[0])
          : 15; // fallback 15h si pas défini

        if (hour >= checkinHour) {
          // Heure OK — confirmer simplement
          const arrivalReplies = {
            fr: `Parfait, pas de problème ! 😊 On vous attend vers ${arrivalMatch[1]}h, à tout à l'heure ! 🏠`,
            en: `Perfect, no problem! 😊 We'll be expecting you around ${arrivalMatch[1]}:00, see you soon! 🏠`,
            es: `¡Perfecto, no hay problema! 😊 Le esperamos alrededor de las ${arrivalMatch[1]}h, ¡hasta pronto! 🏠`
          };
          const reply = arrivalReplies[language] || arrivalReplies.fr;
          console.log(`🕐 [HANDLER] Heure d'arrivée OK (${hour}h >= check-in ${checkinHour}h) → confirmation`);
          await sendBotMessage(conversation.id, reply, pool, io, channexId);
          return true;
        } else {
          // Arrivée avant le check-in → escalader
          console.log(`🕐 [HANDLER] Arrivée anticipée (${hour}h < check-in ${checkinHour}h) → escalade`);
          await escalateToOwner(conversation, pool, io, language, channexId);
          return false;
        }
      }
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

      // Patterns qui indiquent que le "merci" est de politesse, pas un retour de séjour
      // Ex: "merci bonne journée", "merci j'annule", "merci je serai là à 19h"
      const practicalPatterns = /(?<!\p{L})(caution|annul|arriver|arrive|arrival|heure|time|tonight|ce soir|demain|demain|tomorrow|annulerai|annulation|cancel|check.in|check.out|je serai|j'arrive|j'arriverai|on arrive|we.ll arrive|arriving|code|wifi|access|clé|key|parking)(?!\p{L})/iu;
      const hasPractical = practicalPatterns.test(msgLow);

      // Ne répondre "ravi de votre séjour" QUE si :
      // - Message de remerciement pur (pas de pratique, pas de problème)
      // - Voyageur est en cours de séjour (check-in passé et check-out pas encore passé)
      const now = new Date();
      const checkinDate = conversation.reservation_start_date ? new Date(conversation.reservation_start_date) : null;
      const checkoutDate = conversation.reservation_end_date ? new Date(conversation.reservation_end_date) : null;
      const isDuringStay = checkinDate && checkoutDate
        ? now >= checkinDate && now <= checkoutDate
        : false;

      if (hasThanks && !hasProblem && !hasPractical && wordCount < 25) {
        // Adapter la réponse selon la phase du séjour
        const nowThanks = new Date();
        const ciDt = conversation.reservation_start_date ? new Date(conversation.reservation_start_date) : null;
        const coDt = conversation.reservation_end_date   ? new Date(conversation.reservation_end_date)   : null;
        let phase = 'before';
        if (ciDt && coDt && nowThanks >= coDt) phase = 'after';
        else if (ciDt && nowThanks >= ciDt)     phase = 'during';

        const thanksReplies = {
          before: {
            fr: "De rien ! 😊 N'hésitez pas si vous avez d'autres questions avant votre arrivée.",
            en: "You're welcome! 😊 Don't hesitate if you have any questions before your arrival.",
            es: '¡De nada! 😊 No dude en preguntar si tiene alguna pregunta antes de su llegada.',
            de: 'Gern geschehen! 😊 Zögern Sie nicht, wenn Sie vor Ihrer Ankunft Fragen haben.',
            it: 'Prego! 😊 Non esiti a chiedere se ha domande prima del suo arrivo.',
          },
          during: {
            fr: "Avec plaisir ! 😊 N'hésitez pas si vous avez besoin de quoi que ce soit.",
            en: "With pleasure! 😊 Don't hesitate if you need anything.",
            es: '¡Con gusto! 😊 No dude en pedir lo que necesite.',
            de: 'Gerne! 😊 Zögern Sie nicht, wenn Sie etwas benötigen.',
            it: 'Con piacere! 😊 Non esiti a chiedere se ha bisogno di qualcosa.',
          },
          after: {
            fr: 'Merci à vous ! 😊 Ce fut un plaisir. À une prochaine fois peut-être !',
            en: "Thank you! 😊 It was a pleasure. Hope to see you again!",
            es: '¡Gracias a usted! 😊 Fue un placer. ¡Hasta la próxima!',
            de: 'Vielen Dank! 😊 Es war uns ein Vergnügen. Bis zum nächsten Mal!',
            it: 'Grazie a lei! 😊 È stato un piacere. A presto!',
          },
        };
        const phaseReplies = thanksReplies[phase] || thanksReplies.before;
        const reply = phaseReplies[language] || phaseReplies.fr;
        console.log(`🙏 [HANDLER] Remerciement détecté (phase=${phase}) → réponse courte en ${language}`);
        await sendBotMessage(conversation.id, reply, pool, io, channexId);
        return true;
      }

      if (hasThanks && hasProblem) {
        console.log(`⚠️ [HANDLER] Remerciement + problème détectés → escalade (plainte/oubli)`);
        await escalateToOwner(conversation, pool, io, language, channexId);
        return false; // escalade → notif push propriétaire requise
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

    // ── Statut de la caution ────────────────────────────────────
    let depositStatus = null;
    let depositAmount = null;
    try {
      const depResult = await pool.query(
        `SELECT d.status, d.amount_cents, p.deposit_amount
         FROM conversations c
         LEFT JOIN properties p ON p.id = c.property_id
         LEFT JOIN reservations r ON (
           (r.channex_booking_id = c.channex_booking_id AND c.channex_booking_id IS NOT NULL)
           OR (r.property_id = c.property_id AND DATE(r.start_date) = DATE(c.reservation_start_date))
         )
         LEFT JOIN deposits d ON d.reservation_uid = r.uid
         WHERE c.id = $1
         ORDER BY d.created_at DESC LIMIT 1`,
        [conversation.id]
      );
      if (depResult.rows[0]) {
        depositStatus = depResult.rows[0].status || null; // authorized | captured | pending | expired | null
        depositAmount = depResult.rows[0].deposit_amount || depResult.rows[0].amount_cents
          ? (depResult.rows[0].amount_cents ? depResult.rows[0].amount_cents / 100 : depResult.rows[0].deposit_amount)
          : null;
      }
    } catch(e) {
      console.warn('⚠️ [HANDLER] Erreur récupération caution:', e.message);
    }

    // ── Phase du séjour ──────────────────────────────────────────
    const nowForPhase = new Date();
    const checkinDt  = conversation.reservation_start_date ? new Date(conversation.reservation_start_date) : null;
    const checkoutDt = conversation.reservation_end_date   ? new Date(conversation.reservation_end_date)   : null;
    let stayPhase = 'before'; // default
    if (checkinDt && checkoutDt) {
      if (nowForPhase >= checkoutDt) stayPhase = 'after';
      else if (nowForPhase >= checkinDt) stayPhase = 'during';
    } else if (checkinDt && nowForPhase >= checkinDt) {
      stayPhase = 'during';
    }
    const checkinDateStr  = checkinDt  ? checkinDt.toLocaleDateString('fr-FR')  : null;
    const checkoutDateStr = checkoutDt ? checkoutDt.toLocaleDateString('fr-FR') : null;

    // ── Bonjour unique par jour ──────────────────────────────────
    let alreadyGreetedToday = false;
    try {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const greetCheck = await pool.query(
        `SELECT COUNT(*) as c FROM messages
         WHERE conversation_id = $1
         AND sender_type IN ('property','system','bot')
         AND created_at >= $2`,
        [conversation.id, todayStart]
      );
      alreadyGreetedToday = parseInt(greetCheck.rows[0].c) > 0;
    } catch(e) {}

    const context = property ? {
      propertyName: property.name,
      welcomeBookUrl: property.welcome_book_url,
      stayPhase,
      checkinDate: checkinDateStr,
      checkoutDate: checkoutDateStr,
      alreadyGreetedToday,
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
      language,
      // Caution
      depositAmount: depositAmount || null,
      depositStatus: depositStatus || null, // authorized | captured | pending | expired | null
    } : { language };

    // ── Détection sentiment négatif → notifier propriétaire même sans escalade ──
    function detectNegativeSentiment(text) {
      const t = text.toLowerCase();
      const negativePatterns = [
        // FR
        'pas content', 'pas satisfait', 'déçu', 'décevant', 'inacceptable',
        'honteux', 'scandaleux', 'nul', 'catastrophe', 'horrible', 'terrible',
        'mauvais', 'sale', 'dégoût', 'dégueulasse', 'arnaque', 'escroquerie',
        'remboursement', 'plainte', 'signaler', 'mauvais avis', 'mauvaise note',
        'pas propre', 'pas clean',
        // EN
        'not happy', 'disappointed', 'unacceptable', 'terrible', 'awful',
        'disgusting', 'dirty', 'scam', 'refund', 'complaint', 'report',
        'bad review', 'negative review', 'not clean', 'not satisfied',
        // PT
        'não estou satisfeito', 'decepcionado', 'inaceitável', 'terrível',
        'horrível', 'sujo', 'reembolso', 'reclamação', 'avaliação negativa',
        // ES
        'no estoy contento', 'decepcionado', 'inaceptable', 'terrible',
        'horrible', 'sucio', 'reembolso', 'queja', 'mala reseña',
        // DE
        'nicht zufrieden', 'enttäuscht', 'inakzeptabel', 'schrecklich',
        'schmutzig', 'erstattung', 'beschwerde', 'schlechte bewertung',
        // IT
        'non sono soddisfatto', 'deluso', 'inaccettabile', 'terribile',
        'sporco', 'rimborso', 'reclamo', 'recensione negativa',
      ];
      return negativePatterns.some(p => t.includes(p));
    }

    const isNegative = detectNegativeSentiment(message.message);
    if (isNegative) {
      console.log(`😠 [HANDLER] Sentiment négatif détecté — conv ${conversation.id} → push propriétaire`);
      try {
        const tokensRes = await pool.query(
          `SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL`,
          [conversation.user_id]
        );
        const { sendNotification } = require('./firebase');
        const guestName = conversation.guest_name || 'Un voyageur';
        for (const tok of tokensRes.rows) {
          await sendNotification(
            tok.fcm_token,
            `😠 Message négatif — ${guestName}`,
            `Un voyageur semble insatisfait. Vérifiez la conversation.`,
            { type: 'negative_sentiment', conversationId: String(conversation.id), screen: 'messages' }
          );
        }
      } catch(e) {
        console.warn('⚠️ [HANDLER] Erreur push sentiment négatif:', e.message);
      }
    }

    // ── Récupérer l'historique des derniers messages pour le contexte Groq ──
    let messageHistory = [];
    try {
      const histResult = await pool.query(
        `SELECT sender_type, message FROM messages
         WHERE conversation_id = $1
         AND created_at > NOW() - INTERVAL '7 days'
         AND message NOT ILIKE '%THIS RESERVATION HAS BEEN PRE-PAID%'
         AND message NOT ILIKE '%BOOKING NOTE%'
         AND message NOT ILIKE '%OTA Commission%'
         AND message NOT ILIKE '%Payment Collect%'
         AND message NOT ILIKE '%Meal Plan%'
         AND message NOT ILIKE '%Smoking Preference%'
         AND LENGTH(message) > 3
         ORDER BY created_at ASC
         LIMIT 20`,
        [conversation.id]
      );
      messageHistory = histResult.rows.map(m => ({
        role: (m.sender_type === 'guest') ? 'user' : 'assistant',
        content: m.message
      }));
      // Retirer le dernier message s'il est identique au message courant (évite doublon)
      if (messageHistory.length > 0 &&
          messageHistory[messageHistory.length - 1].content === message.message) {
        messageHistory.pop();
      }
    } catch(e) {
      console.warn('⚠️ [HANDLER] Erreur récupération historique:', e.message);
    }

    const aiResponse = await getGroqResponse(message.message, context, messageHistory);

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
    return false; // escalade → notif push propriétaire requise

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
      es: `👋 Le pongo en contacto con el propietario.\n\nSu mensaje ha sido transmitido. ¡Gracias por su paciencia! 🙏`,
      pt: `👋 Estou a colocá-lo em contacto com o responsável que poderá ajudá-lo melhor.\n\nA sua mensagem foi transmitida, ele responderá o mais brevemente possível. Obrigado pela sua paciência! 🙏`,
      de: `👋 Ich verbinde Sie mit dem Verantwortlichen, der Ihnen besser helfen kann.\n\nIhre Nachricht wurde weitergeleitet. Vielen Dank für Ihre Geduld! 🙏`,
      it: `👋 La metto in contatto con il responsabile che potrà aiutarla meglio.\n\nIl suo messaggio è stato trasmesso. Grazie per la pazienza! 🙏`,
      nl: `👋 Ik verbind u door met de verantwoordelijke die u beter kan helpen.\n\nUw bericht is doorgestuurd. Bedankt voor uw geduld! 🙏`,
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
  handleIncomingMessageDebounced,
  sendBotMessage,
  sendAutoMessage
};
