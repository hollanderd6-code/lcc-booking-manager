// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ
// Architecture : Groq-first + few-shot learning depuis réponses manuelles
// ============================================

const { getGroqResponse, getOwnerDraftResponse, requiresHumanIntervention } = require('./groq-ai');
const { getProximityContext } = require('./geo-proximity');
const { createUpsellPaymentLink } = require('./upsell-service');

const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ============================================
// ⏳ DEBOUNCE — Grouper les messages rapprochés
// ============================================

const DEBOUNCE_DELAY = 90 * 1000; // 90 secondes
const _debounceMap = new Map();

async function handleIncomingMessageDebounced(message, conversation, pool, io) {
  const convId = conversation.id;

  if (message.sender_type !== 'guest') return false;

  const existing = _debounceMap.get(convId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(message);
    existing.timer = setTimeout(() => _flushDebounce(convId, pool, io), DEBOUNCE_DELAY);
    console.log(`⏳ [DEBOUNCE] Conv ${convId} — message ajouté (total: ${existing.messages.length})`);
    return true;
  }

  const entry = {
    messages: [message],
    conversation,
    timer: setTimeout(() => _flushDebounce(convId, pool, io), DEBOUNCE_DELAY)
  };
  _debounceMap.set(convId, entry);

  // Vérif rapide : si l'IA est désactivée ou conv escaladée récemment
  try {
    const freshConv = await pool.query('SELECT escalated, escalated_at, ai_disabled FROM conversations WHERE id = $1', [convId]);
    const conv = freshConv.rows[0];
    if (conv?.ai_disabled) {
      clearTimeout(entry.timer);
      _debounceMap.delete(convId);
      console.log(`🔇 [DEBOUNCE] IA désactivée pour conv ${convId}`);
      return true;
    }
    if (conv?.escalated) {
      // Auto-reprise après 4h
      const hoursAgo = conv.escalated_at ? (Date.now() - new Date(conv.escalated_at).getTime()) / 3600000 : 999;
      if (hoursAgo < 4) {
        clearTimeout(entry.timer);
        _debounceMap.delete(convId);
        console.log(`ℹ️ [DEBOUNCE] Conv escaladée il y a ${hoursAgo.toFixed(1)}h → bot silencieux`);
        return true;
      } else {
        // Reset escalade — l'IA reprend la main
        await pool.query('UPDATE conversations SET escalated = FALSE, escalated_at = NULL WHERE id = $1', [convId]);
        console.log(`🔄 [DEBOUNCE] Conv ${convId} : escalade expirée (${hoursAgo.toFixed(1)}h) → IA reprend`);
      }
    }
  } catch {}

  return true;
}

async function _flushDebounce(convId, pool, io) {
  const entry = _debounceMap.get(convId);
  if (!entry) return;
  _debounceMap.delete(convId);

  const { messages, conversation } = entry;

  let combinedMessage;
  if (messages.length === 1) {
    combinedMessage = messages[0];
  } else {
    const combined = messages.map((m, i) => `[Message ${i+1}] ${m.message}`).join('\n');
    // _rawMessage = dernier message brut, pour les notifs push (sans préfixe [Message N])
    combinedMessage = { ...messages[messages.length - 1], message: combined, _rawMessage: messages[messages.length - 1].message };
    console.log(`⏳ [DEBOUNCE] Conv ${convId} — ${messages.length} messages fusionnés → 1 appel Groq`);
  }

  await handleIncomingMessage(combinedMessage, conversation, pool, io);
}

// ============================================
// 📤 ENVOI DE MESSAGES
// ============================================

async function sendAutoMessage(pool, io, conversationId, message, channexBookingId = null) {
  try {
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, message, is_read, created_at)
       VALUES ($1, 'system', $2, FALSE, NOW())
       RETURNING id, conversation_id, sender_type, message, is_read, created_at`,
      [conversationId, message]
    );
    const savedMessage = messageResult.rows[0];

    if (io) {
      io.to(`conversation_${conversationId}`).emit('new_message', savedMessage);
    }

    if (channexBookingId) {
      try {
        const { sendBookingMessage } = require('./channex');
        await sendBookingMessage(channexBookingId, message);
        console.log(`✅ [AUTO-MSG] Message envoyé via Channex (booking ${channexBookingId})`);
      } catch (channexErr) {
        console.error(`⚠️ [AUTO-MSG] Erreur envoi Channex (non bloquant):`, channexErr.message);
      }
    }

    return savedMessage;
  } catch (error) {
    console.error('❌ [AUTO-MSG] Erreur sendAutoMessage:', error);
    return null;
  }
}

async function sendBotMessage(conversationId, message, pool, io, channexBookingId = null) {
  return sendAutoMessage(pool, io, conversationId, message, channexBookingId);
}

// ============================================
// 🗒️ NOTE INTERNE dans la conversation (visible hôte uniquement)
// Insérée en DB avec sender_type='internal_note' et JAMAIS envoyée à Channex.
// ============================================
async function addInternalNote(conversationId, note, pool, io) {
  try {
    // Préfixe sentinelle : permet au front (messages.html) de détecter et styliser
    // ces notes en orange, puis de le retirer à l'affichage. Invisible côté voyageur.
    const stored = `⟦NOTE_INTERNE⟧ ${note}`;
    const messageResult = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, message, is_read, created_at)
       VALUES ($1, 'internal_note', $2, TRUE, NOW())
       RETURNING id, conversation_id, sender_type, message, is_read, created_at`,
      [conversationId, stored]
    );
    const saved = messageResult.rows[0];
    if (io) io.to(`conversation_${conversationId}`).emit('new_message', saved);
    console.log(`🗒️ [NOTE INTERNE] conv ${conversationId} : ${note}`);
    return saved;
  } catch (e) {
    console.error('❌ [NOTE INTERNE] Erreur:', e.message);
    return null;
  }
}

// ============================================
// 🏦 CAUTION : Créer si elle n'existe pas
// ============================================

async function ensureDepositExists(pool, conversation) {
  try {
    const propertyId = conversation.property_id;
    const startDate  = conversation.reservation_start_date;

    const propResult = await pool.query(
      'SELECT id, name, deposit_amount FROM properties WHERE id = $1', [propertyId]
    );
    const property = propResult.rows[0];
    if (!property || !property.deposit_amount || parseFloat(property.deposit_amount) <= 0) return null;

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
      if (['authorized','captured','released'].includes(dep.status)) return { depositExists: true, alreadyValid: true };
      if (dep.status === 'pending') return { depositExists: true, alreadyValid: false, checkout_url: dep.checkout_url, amount_cents: dep.amount_cents };
    }

    if (!stripe) return null;

    const userResult = await pool.query(
      `SELECT u.id as user_id, u.stripe_account_id
       FROM users u JOIN properties p ON p.user_id = u.id WHERE p.id = $1`,
      [propertyId]
    );
    if (userResult.rows.length === 0) return null;
    const user = userResult.rows[0];

    const depositId   = 'dep_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const amountCents = Math.round(parseFloat(property.deposit_amount) * 100);
    const appUrl      = (process.env.APP_URL || 'https://lcc-booking-manager.onrender.com').replace(/\/$/, '');
    const startDateStr = new Date(reservation.start_date).toISOString().split('T')[0];
    const endDateStr   = reservation.end_date ? new Date(reservation.end_date).toISOString().split('T')[0] : '';

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price_data: { currency: 'eur', unit_amount: amountCents, product_data: { name: `Caution - ${property.name}`, description: `Réservation du ${startDateStr} au ${endDateStr}` } }, quantity: 1 }],
      payment_intent_data: { capture_method: 'manual', metadata: { deposit_id: depositId, reservation_uid: reservation.uid } },
      metadata: { deposit_id: depositId, reservation_uid: reservation.uid, user_id: user.user_id },
      success_url: `${appUrl}/caution-success.html?depositId=${depositId}`,
      cancel_url:  `${appUrl}/caution-cancel.html?depositId=${depositId}`
    };

    const session = user.stripe_account_id
      ? await stripe.checkout.sessions.create(sessionParams, { stripeAccount: user.stripe_account_id })
      : await stripe.checkout.sessions.create(sessionParams);

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
// 🧠 FEW-SHOT : Apprendre depuis les réponses manuelles de l'hôte
// Récupère les paires (message voyageur → réponse manuelle hôte)
// pour cette conversation ET pour le même logement (30 derniers jours)
// ============================================

async function loadFewShotExamples(pool, conversationId, propertyId) {
  const examples = [];
  try {
    // 1. Réponses manuelles dans CETTE conversation (les plus pertinentes)
    const thisConv = await pool.query(
      `SELECT
         (SELECT m2.message FROM messages m2
          WHERE m2.conversation_id = m.conversation_id
          AND m2.sender_type = 'guest'
          AND m2.created_at < m.created_at
          ORDER BY m2.created_at DESC LIMIT 1) AS guest_msg,
         m.message AS host_msg
       FROM messages m
       WHERE m.conversation_id = $1
       AND m.sender_type IN ('owner', 'property')
       AND m.sender_name NOT IN ('bot', 'system', 'auto', 'IA', 'Boostinghost')
       AND LENGTH(m.message) > 10
       AND LENGTH(m.message) < 500
       ORDER BY m.created_at DESC
       LIMIT 6`,
      [conversationId]
    );

    for (const row of thisConv.rows) {
      if (row.guest_msg && row.host_msg) {
        examples.push({ guest: row.guest_msg.trim(), host: row.host_msg.trim() });
      }
    }

    // 2. Réponses manuelles sur le MÊME LOGEMENT (autres conversations, 30 derniers jours)
    if (propertyId && examples.length < 8) {
      const otherConvs = await pool.query(
        `SELECT
           (SELECT m2.message FROM messages m2
            WHERE m2.conversation_id = m.conversation_id
            AND m2.sender_type = 'guest'
            AND m2.created_at < m.created_at
            ORDER BY m2.created_at DESC LIMIT 1) AS guest_msg,
           m.message AS host_msg
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.property_id = $1
         AND m.conversation_id != $2
         AND m.sender_type IN ('owner', 'property')
         AND m.sender_name NOT IN ('bot', 'system', 'auto', 'IA', 'Boostinghost')
         AND m.created_at > NOW() - INTERVAL '30 days'
         AND LENGTH(m.message) > 10
         AND LENGTH(m.message) < 500
         ORDER BY m.created_at DESC
         LIMIT 8`,
        [propertyId, conversationId]
      );

      for (const row of otherConvs.rows) {
        if (row.guest_msg && row.host_msg && examples.length < 10) {
          examples.push({ guest: row.guest_msg.trim(), host: row.host_msg.trim() });
        }
      }
    }

    if (examples.length > 0) {
      console.log(`🧠 [FEW-SHOT] ${examples.length} exemples chargés pour conv ${conversationId}`);
    }
  } catch (e) {
    console.warn('⚠️ [FEW-SHOT] Erreur chargement exemples:', e.message);
  }
  return examples;
}

// ============================================
// 📩 HANDLER PRINCIPAL
// ============================================

async function handleIncomingMessage(message, conversation, pool, io) {
  try {
    const channexId = conversation.channex_booking_id || null;
    console.log(`📩 [HANDLER] Message de ${conversation.guest_name || 'client'}: "${message.message.substring(0, 60)}"`);

    if (message.sender_type !== 'guest') return false;

    // ─── Nom du logement (pour les notifs push) ────────────────────
    let _propName = null;
    if (conversation.property_id) {
      try {
        const _pr = await pool.query('SELECT internal_name, name FROM properties WHERE id = $1', [conversation.property_id]);
        const _p = _pr.rows[0];
        if (_p) _propName = _p.internal_name || _p.name || null;
      } catch(e) {}
    }

    // ─── Filtre messages système OTA ───────────────────────────────
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
      /^\*\*.*\*\*\s*\n/.test(msgText)
    );
    if (isOtaSystemMessage) {
      console.log(`ℹ️ [HANDLER] Message système OTA ignoré`);
      return false;
    }

    // ─── IA désactivée manuellement ─────────────────────────────
    try {
      const aiCheck = await pool.query('SELECT ai_disabled FROM conversations WHERE id = $1', [conversation.id]);
      if (aiCheck.rows[0]?.ai_disabled) {
        console.log(`🔇 [HANDLER] IA désactivée pour conv ${conversation.id}`);
        return false;
      }
    } catch(e) {}

    // ─── Conversation déjà escaladée (auto-reprise après 4h) ──
    try {
      const freshConv = await pool.query('SELECT escalated, escalated_at FROM conversations WHERE id = $1', [conversation.id]);
      if (freshConv.rows[0]?.escalated) {
        const hoursAgo = freshConv.rows[0].escalated_at 
          ? (Date.now() - new Date(freshConv.rows[0].escalated_at).getTime()) / 3600000 
          : 999;
        if (hoursAgo < 4) {
          console.log(`ℹ️ [HANDLER] Conv escaladée il y a ${hoursAgo.toFixed(1)}h → bot silencieux, notif proprio`);
          try {
            const tokens = await pool.query(
              'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
              [conversation.user_id]
            );
            const { sendNotification } = require('./services/notifications-service');
            for (const tok of tokens.rows) {
              await sendNotification(
                tok.fcm_token,
                `💬 ${conversation.guest_name || 'Voyageur'}${_propName ? ' — ' + _propName : ''} a répondu`,
                `Nouveau message dans une conversation en attente.`,
                { type: 'new_guest_message', conversation_id: String(conversation.id) }
              );
            }
          } catch(e) { console.error('❌ [HANDLER] Erreur notif escalade:', e.message); }
          return true;
        } else {
          // Reset escalade — l'IA reprend
          await pool.query('UPDATE conversations SET escalated = FALSE, escalated_at = NULL WHERE id = $1', [conversation.id]);
          console.log(`🔄 [HANDLER] Conv ${conversation.id} : escalade expirée → IA reprend la main`);
        }
      }
    } catch(e) {
      if (conversation.escalated) return true;
    }

    // ─── Pause 2h après réponse manuelle de l'hôte ────────────────
    try {
      const ownerRecentReply = await pool.query(
        `SELECT 1 FROM messages
         WHERE conversation_id = $1
         AND sender_type IN ('owner', 'property')
         AND (is_bot_response IS NULL OR is_bot_response = FALSE)
         AND sender_name NOT IN ('bot', 'system', 'auto', 'IA', 'Boostinghost', 'Assistant automatique')
         AND (sender_name IS NULL OR sender_name NOT LIKE 'tpl_%')
         AND created_at > NOW() - INTERVAL '2 hours'
         LIMIT 1`,
        [conversation.id]
      );
      if (ownerRecentReply.rows.length > 0) {
        console.log(`🤫 [HANDLER] Pause 2h active → bot silencieux, notif proprio`);
        try {
          const tokensRes = await pool.query(
            'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL AND sub_account_id IS NULL',
            [conversation.user_id]
          );
          const { sendNotification } = require('./services/notifications-service');
          for (const tok of tokensRes.rows) {
            await sendNotification(
              tok.fcm_token,
              `💬 ${conversation.guest_name || 'Voyageur'}${_propName ? ' — ' + _propName : ''}`,
              (message._rawMessage || message.message || '').substring(0, 80),
              { type: 'new_guest_message', conversation_id: String(conversation.id) }
            );
          }
        } catch(e) { console.warn('⚠️ [HANDLER] Erreur notif pause owner:', e.message); }
        return false;
      }
    } catch(e) { console.warn('⚠️ [HANDLER] Erreur vérif pause owner:', e.message); }

    // ─── Urgence directe (garde-fou rapide) ───────────────────────
    if (requiresHumanIntervention(message.message)) {
      console.log('🚨 [HANDLER] Urgence → escalade directe');
      const lang = conversation.language || 'fr';
      const urgentMessages = {
        fr: `🚨 Votre message urgent a été transmis au responsable qui vous contactera immédiatement.\n\nMerci de patienter ! 🙏`,
        en: `🚨 Your urgent message has been forwarded to the owner who will contact you immediately.\n\nThank you for your patience! 🙏`,
        es: `🚨 Su mensaje urgente ha sido transmitido al propietario.\n\n¡Gracias por su paciencia! 🙏`,
        pt: `🚨 A sua mensagem urgente foi transmitida ao responsável.\n\nObrigado pela sua paciência! 🙏`,
        de: `🚨 Ihre dringende Nachricht wurde weitergeleitet.\n\nVielen Dank für Ihre Geduld! 🙏`,
        it: `🚨 Il suo messaggio urgente è stato trasmesso al responsabile.\n\nGrazie per la pazienza! 🙏`,
        nl: `🚨 Uw dringende bericht is doorgestuurd.\n\nBedankt voor uw geduld! 🙏`,
      };
      await sendBotMessage(conversation.id, urgentMessages[lang] || urgentMessages.fr, pool, io, channexId);
      await pool.query(
        `UPDATE conversations SET escalated = TRUE, escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
      generateOwnerSuggestion(conversation.id, pool, io, {}).catch(e =>
        console.warn('⚠️ [HANDLER] Suggestion (urgence):', e.message));
      return false;
    }

    // ─── Infos logement ───────────────────────────────────────────
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

    // ─── Détection langue ──────────────────────────────────────────
    let language = 'auto';
    if (conversation.language && ['fr','en','es','de','it','pt','nl','ru','zh','ja','ko'].includes(conversation.language)) {
      language = conversation.language;
    } else {
      const scores = {
        en: (message.message.match(/\b(hello|hi|hey|thanks|thank you|please|what|where|when|how|can|could|would|wifi|password|check.in|check.out|address|arrival|departure|yes|no|perfect|good|got it)\b/gi) || []).length,
        es: (message.message.match(/\b(hola|gracias|por favor|dónde|cuándo|puedo|quiero|necesito|contraseña|llegada|salida)\b/gi) || []).length,
        de: (message.message.match(/\b(hallo|danke|bitte|wo|wann|wie|was|können|möchte|passwort|ankunft|abreise)\b/gi) || []).length,
        it: (message.message.match(/\b(ciao|grazie|dove|quando|posso|vorrei|ho bisogno|indirizzo|arrivo|partenza)\b/gi) || []).length,
        fr: (message.message.match(/\b(bonjour|bonsoir|merci|où|quand|comment|puis-je|voudrais|besoin|arrivée|départ|avez-vous|est-ce|nous|vous|je)\b/gi) || []).length,
        pt: (message.message.match(/\b(olá|ola|obrigado|obrigada|por favor|onde|quando|posso|quero|preciso|senha|chegada|saída)\b/gi) || []).length,
        nl: (message.message.match(/\b(hallo|hoi|bedankt|dank|alsjeblieft|waar|wanneer|kan|wil|nodig|wachtwoord|aankomst|vertrek)\b/gi) || []).length,
      };
      const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      if (best[1] >= 1) {
        language = best[0];
        if (language !== 'fr') {
          pool.query('UPDATE conversations SET language = $1 WHERE id = $2 AND (language IS NULL OR language = $3)', [language, conversation.id, 'auto']).catch(() => {});
        }
      }
    }
    console.log(`🌍 [HANDLER] Langue: ${language}`);

    // ─── Plateforme ───────────────────────────────────────────────
    const platformRaw = (conversation.platform || '').toLowerCase().replace(/[_\-\s]/g, '');
    const isAirbnbPlatform = ['airbnb','abb','airbnbofficial'].includes(platformRaw) || platformRaw.includes('airbnb');

    // ─── Caution ──────────────────────────────────────────────────
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
      if (depResult.rows[0] && !isAirbnbPlatform) {
        depositStatus = depResult.rows[0].status || null;
        depositAmount = depResult.rows[0].amount_cents
          ? depResult.rows[0].amount_cents / 100
          : depResult.rows[0].deposit_amount || null;
      }
    } catch(e) { console.warn('⚠️ [HANDLER] Erreur récupération caution:', e.message); }

    // ─── Phase du séjour ──────────────────────────────────────────
    const nowForPhase  = new Date();
    const checkinDt    = conversation.reservation_start_date ? new Date(conversation.reservation_start_date) : null;
    const checkoutDt   = conversation.reservation_end_date   ? new Date(conversation.reservation_end_date)   : null;
    let stayPhase = 'before';
    if (checkinDt && checkoutDt) {
      if (nowForPhase >= checkoutDt) stayPhase = 'after';
      else if (nowForPhase >= checkinDt) stayPhase = 'during';
    }

    // ─── Déjà salué aujourd'hui ? ─────────────────────────────────
    let alreadyGreetedToday = false;
    try {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const greetCheck = await pool.query(
        `SELECT COUNT(*) as c FROM messages
         WHERE conversation_id = $1 AND sender_type IN ('property','system','bot') AND created_at >= $2`,
        [conversation.id, todayStart]
      );
      alreadyGreetedToday = parseInt(greetCheck.rows[0].c) > 0;
    } catch(e) {}

    // ─── Livret d'accueil ─────────────────────────────────────────
    let welcomeBookData = null;
    if (property?.welcome_book_url) {
      try {
        const urlMatch = property.welcome_book_url.match(/\/welcome\/([a-zA-Z0-9_-]+)/);
        const uniqueId = urlMatch ? urlMatch[1] : null;
        if (uniqueId) {
          const bookResult = await pool.query(
            'SELECT data FROM welcome_books_v2 WHERE unique_id = $1', [uniqueId]
          );
          if (bookResult.rows.length > 0) {
            welcomeBookData = bookResult.rows[0].data || null;
            console.log(`📖 [HANDLER] Livret d'accueil chargé`);
          }
        }
      } catch(e) { console.warn('⚠️ [HANDLER] Erreur livret:', e.message); }
    }

    // ─── Q/R personnalisées ───────────────────────────────────────
    let customQRSummary = null;
    if (property) {
      try {
        const rawQR = property.custom_auto_responses || property.customAutoResponses;
        const customQR = Array.isArray(rawQR) ? rawQR : (typeof rawQR === 'string' ? JSON.parse(rawQR) : []);
        if (customQR.length > 0) {
          customQRSummary = customQR
            .filter(qr => qr.keywords && qr.response)
            .map(qr => `- "${qr.keywords}" → ${qr.response}`)
            .join('\n');
        }
      } catch(e) {}
    }

    // ─── Faits mémorisés (réponses passées de l'hôte, par logement) ──
    let propertyFacts = [];
    if (property) {
      try {
        const factsRes = await pool.query(
          `SELECT question, answer, detail FROM property_facts
           WHERE property_id = $1 ORDER BY updated_at DESC LIMIT 50`,
          [property.id]
        );
        propertyFacts = factsRes.rows;
      } catch(e) { /* table absente au tout premier démarrage : ignorer */ }
    }

    // ─── URL et statut lien caution ───────────────────────────────
    let depositLinkAlreadySent = false;
    let depositUrl = null;
    try {
      const r = await pool.query(
        `SELECT message FROM messages
         WHERE conversation_id = $1 AND sender_type IN ('property','system','bot')
         AND message ILIKE '%boostinghost.fr/c/%'
         ORDER BY created_at ASC LIMIT 1`,
        [conversation.id]
      );
      if (r.rows.length > 0) {
        depositLinkAlreadySent = true;
        const match = r.rows[0].message.match(/https:\/\/boostinghost\.fr\/c\/[a-zA-Z0-9]+/);
        depositUrl = match ? match[0] : null;
      }
    } catch(e) {}

    const depositRequired = !isAirbnbPlatform && property?.deposit_amount && parseFloat(property.deposit_amount) > 0;
    const depositPaid     = depositStatus && ['authorized', 'captured'].includes(depositStatus);
    const depositBlocksAccess = depositRequired && !depositPaid;

    // ─── Sentiment négatif → notif proprio (sans bloquer la réponse IA) ─
    const negativePatterns = [
      'pas content','pas satisfait','déçu','décevant','inacceptable','honteux',
      'scandaleux','nul','catastrophe','horrible','terrible','mauvais','sale',
      'dégoût','dégueulasse','arnaque','escroquerie','remboursement','plainte',
      'signaler','mauvais avis','mauvaise note','pas propre',
      'not happy','disappointed','unacceptable','awful','disgusting','dirty',
      'scam','refund','complaint','bad review','negative review','not clean',
    ];
    if (negativePatterns.some(p => message.message.toLowerCase().includes(p))) {
      console.log(`😠 [HANDLER] Sentiment négatif → notif proprio (conv ${conversation.id})`);
      try {
        const tokensRes = await pool.query(
          `SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL`,
          [conversation.user_id]
        );
        const { sendNotification } = require('./firebase');
        for (const tok of tokensRes.rows) {
          await sendNotification(
            tok.fcm_token,
            `😠 ${conversation.guest_name || 'Voyageur'}${_propName ? ' — ' + _propName : ''} — Message négatif`,
            `Un voyageur semble insatisfait. Vérifiez la conversation.`,
            { type: 'negative_sentiment', conversationId: String(conversation.id), screen: 'messages' }
          );
        }
      } catch(e) { console.warn('⚠️ [HANDLER] Erreur push sentiment négatif:', e.message); }
    }

    // ─── Contexte complet pour Groq ───────────────────────────────
    const context = property ? {
      propertyName:      property.name,
      language,
      stayPhase,
      checkinDt:         conversation.reservation_start_date,
      checkoutDt:        conversation.reservation_end_date,
      checkinDate:       checkinDt  ? checkinDt.toLocaleDateString('fr-FR')  : null,
      checkoutDate:      checkoutDt ? checkoutDt.toLocaleDateString('fr-FR') : null,
      alreadyGreetedToday,
      // Séjour
      arrivalTime:       property.arrival_time,
      departureTime:     property.departure_time || welcomeBookData?.checkoutTime,
      checkoutInstructions: welcomeBookData?.checkoutInstructions,
      // Départ tardif (late checkout) : tolérance en minutes (défaut 120 = 2h)
      lateCheckoutToleranceMin: (property.late_checkout_tolerance_minutes != null
        ? parseInt(property.late_checkout_tolerance_minutes) : 120),
      // Arrivée anticipée (early check-in) : tolérance en minutes (défaut 60 = 1h)
      earlyCheckinToleranceMin: (property.early_checkin_tolerance_minutes != null
        ? parseInt(property.early_checkin_tolerance_minutes) : 60),
      // ── Upsell payant (configuré par logement) ──
      lateCheckoutPaid:   property.late_checkout_enabled === true && parseFloat(property.late_checkout_price_per_hour) > 0,
      earlyCheckinPaid:   property.early_checkin_enabled === true && parseFloat(property.early_checkin_price_per_hour) > 0,
      welcomeBasketEnabled: property.welcome_basket_enabled === true && parseFloat(property.welcome_basket_price) > 0,
      welcomeBasketPrice:   parseFloat(property.welcome_basket_price) || null,
      welcomeBasketDescription: property.welcome_basket_description || null,
      // WiFi
      wifiName:          property.wifi_name     || welcomeBookData?.wifiSSID,
      wifiPassword:      property.wifi_password || welcomeBookData?.wifiPassword,
      // Accès (masqué si caution non payée)
      accessCode: (() => {
        if (isAirbnbPlatform) return property.access_code || welcomeBookData?.keyboxCode;
        if (depositBlocksAccess) return null;
        return property.access_code || welcomeBookData?.keyboxCode;
      })(),
      accessInstructions: (() => {
        if (isAirbnbPlatform) return property.access_instructions || welcomeBookData?.accessInstructions;
        if (depositBlocksAccess) return null;
        return property.access_instructions || welcomeBookData?.accessInstructions;
      })(),
      // Adresse
      address: (() => {
        const parts = [
          property.address || welcomeBookData?.address,
          welcomeBookData?.postalCode,
          welcomeBookData?.city,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
      })(),
      // Logement
      parkingInfo:       welcomeBookData?.parkingInfo,
      extraNotesAccess:  welcomeBookData?.extraNotesAccess,
      equipmentList:     welcomeBookData?.equipmentList,
      importantRules:    welcomeBookData?.importantRules,
      transportInfo:     welcomeBookData?.transportInfo,
      extraNotesPractical: welcomeBookData?.extraNotesPractical,
      welcomeDescription: welcomeBookData?.welcomeDescription,
      contactPhone:      welcomeBookData?.contactPhone,
      restaurants:       welcomeBookData?.restaurants,
      places:            welcomeBookData?.places,
      shopsList:         welcomeBookData?.shopsList,
      extraNotesAround:  welcomeBookData?.extraNotesAround,
      rooms:             welcomeBookData?.rooms,
      extraNotesLogement: welcomeBookData?.extraNotesLogement,
      practicalInfo:     property.practical_info,
      customQRSummary,
      propertyFacts,
      // Caution
      depositAmount:      isAirbnbPlatform ? null : depositAmount,
      depositStatus:      isAirbnbPlatform ? 'not_applicable' : depositStatus,
      depositBlocksAccess,
      depositLinkAlreadySent,
      depositUrl,
      isAirbnb:           isAirbnbPlatform,
    } : { language };

    // ─── Historique de la conversation (contexte Groq) ────────────
    let messageHistory = [];
    try {
      const histResult = await pool.query(
        `SELECT sender_type, sender_name, message FROM messages
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
         LIMIT 30`,
        [conversation.id]
      );
      messageHistory = histResult.rows.map(m => ({
        role:    m.sender_type === 'guest' ? 'user' : 'assistant',
        content: m.message
      }));
      // Éviter doublon avec le message courant
      if (messageHistory.length > 0 &&
          messageHistory[messageHistory.length - 1].content === message.message) {
        messageHistory.pop();
      }
    } catch(e) { console.warn('⚠️ [HANDLER] Erreur historique:', e.message); }

    // ─── Few-shot : apprendre des réponses manuelles de l'hôte ────
    const fewShotExamples = await loadFewShotExamples(pool, conversation.id, conversation.property_id);

    // ─── Recherche de proximité en temps réel (Google Places) ─────
    // Si le voyageur demande un commerce/lieu proche, on récupère de
    // VRAIES données au lieu de laisser l'IA inventer.
    try {
      if (context.address) {
        const proximityBlock = await getProximityContext(message.message, context.address);
        if (proximityBlock) {
          context.proximityResults = proximityBlock;
          console.log('📍 [HANDLER] Contexte proximité injecté');
        }
      }
    } catch(e) { console.warn('⚠️ [HANDLER] Proximité:', e.message); }

    // ─── Appel Groq ───────────────────────────────────────────────
    console.log('🚀 [HANDLER] → Groq AI');
    const aiResponse = await getGroqResponse(message.message, context, messageHistory, fewShotExamples);

    if (aiResponse) {
      if (aiResponse.trim() === '[ESCALADE]' || aiResponse.includes('[ESCALADE]')) {
        console.log('🔄 [HANDLER] Groq → escalade');
        await escalateToOwner(conversation, pool, io, language, channexId);
        return false;
      }

      // ─── Détection tag [QUESTION_HOTE:...] ────────────────────
      const questionMatch = aiResponse.match(/\[QUESTION_HOTE:([^\]]+)\]/);
      if (questionMatch) {
        try {
          const hostQuestion = questionMatch[1].trim();
          const cleanMsg = aiResponse.replace(/\[QUESTION_HOTE:[^\]]+\]/, '').trim();

          // Message neutre au voyageur (l'IA a déjà rédigé un texte chaleureux avant le tag)
          const fallbackMsg = {
            fr: `Je vérifie ce point avec l'hôte et reviens vers vous très vite 😊`,
            en: `I'm checking this with the host and will get back to you very soon 😊`,
            it: `Verifico questo punto con l'host e la ricontatto al più presto 😊`,
            es: `Estoy verificando este punto con el anfitrión y le responderé muy pronto 😊`,
            de: `Ich kläre das mit dem Gastgeber und melde mich sehr bald bei Ihnen 😊`,
          };
          await sendBotMessage(conversation.id, cleanMsg || (fallbackMsg[language] || fallbackMsg.fr), pool, io, channexId);

          // Créer la question + notifier l'hôte (sans escalader : l'IA reprendra dès la réponse)
          await createHostQuestion(conversation, pool, io, {
            question: hostQuestion,
            guestMessage: message.message,
            language
          });
          console.log(`❓ [HANDLER] Question à l'hôte créée : "${hostQuestion}"`);
          return true;
        } catch(e) {
          console.error('❌ [HANDLER] Erreur question hôte:', e.message);
          await escalateToOwner(conversation, pool, io, language, channexId);
          return false;
        }
      }

      // ─── Détection tag [LATE_CHECKOUT:HH:MM] ──────────────────
      const lateMatch = aiResponse.match(/\[LATE_CHECKOUT:(\d{1,2}):(\d{2})\]/);
      if (lateMatch) {
        try {
          const reqH = parseInt(lateMatch[1]);
          const reqMin = parseInt(lateMatch[2]);
          // Heure de départ prévue (ex "10:00", "10h", "11h00")
          const depStr = String(context.departureTime || '11:00');
          const depMatch = depStr.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/);
          const depH = depMatch ? parseInt(depMatch[1]) : 11;
          const depM = depMatch && depMatch[2] != null ? parseInt(depMatch[2]) : 0;

          const requestedTotal = reqH * 60 + reqMin;
          const departureTotal = depH * 60 + depM;
          const delayMin = requestedTotal - departureTotal;
          const toleranceMin = context.lateCheckoutToleranceMin != null
            ? context.lateCheckoutToleranceMin : 120;

          const reqLabel = `${String(reqH).padStart(2,'0')}h${String(reqMin).padStart(2,'0')}`;
          const depLabel = `${String(depH).padStart(2,'0')}h${String(depM).padStart(2,'0')}`;
          const cleanMsg = aiResponse.replace(/\[LATE_CHECKOUT:\d{1,2}:\d{2}\]/, '').trim();

          // Cas 1 : heure demandée <= heure de départ → c'est dans les clous, pas un "late checkout"
          if (delayMin <= 0) {
            const okMsg = {
              fr: `Pas de problème, le départ à ${reqLabel} est tout à fait dans les temps. Bon voyage ! 😊`,
              en: `No problem, leaving at ${reqLabel} is perfectly fine. Safe travels! 😊`,
              it: `Nessun problema, partire alle ${reqLabel} va benissimo. Buon viaggio! 😊`,
              es: `Sin problema, salir a las ${reqLabel} está perfecto. ¡Buen viaje! 😊`,
              de: `Kein Problem, Abreise um ${reqLabel} ist völlig in Ordnung. Gute Reise! 😊`,
            };
            await sendBotMessage(conversation.id, okMsg[language] || okMsg.fr, pool, io, channexId);
            return true;
          }

          // Cas 2 : dans la tolérance → ACCEPTER + note auto + notif proprio
          if (delayMin <= toleranceMin) {
            const okMsg = {
              fr: `C'est noté, vous pouvez partir jusqu'à ${reqLabel} sans souci 😊 Merci de laisser le logement bien fermé en partant. Bon voyage !`,
              en: `All set, you can leave by ${reqLabel} without any issue 😊 Please make sure to lock up when you leave. Safe travels!`,
              it: `Perfetto, può partire entro le ${reqLabel} senza problemi 😊 Mi raccomando di chiudere bene l'alloggio. Buon viaggio!`,
              es: `Perfecto, puede salir hasta las ${reqLabel} sin problema 😊 Por favor cierre bien el alojamiento al salir. ¡Buen viaje!`,
              de: `Alles klar, Sie können bis ${reqLabel} auschecken 😊 Bitte schließen Sie die Unterkunft gut ab. Gute Reise!`,
            };
            await sendBotMessage(conversation.id, okMsg[language] || okMsg.fr, pool, io, channexId);

            // Note auto sur la réservation
            await addLateCheckoutNote(conversation, pool, reqLabel);
            // Note interne dans la conversation (visible hôte uniquement)
            await addInternalNote(conversation.id,
              `🕐 Départ tardif autorisé automatiquement : ${reqLabel} (prévu ${depLabel}). Note ajoutée à la réservation.`,
              pool, io);
            // Notification au proprio
            await notifyLateCheckout(conversation, pool, reqLabel, depLabel, true);
            console.log(`✅ [HANDLER] Late checkout accepté à ${reqLabel} (tolérance ${toleranceMin}min)`);
            return true;
          }

          // Cas 2bis : au-delà de la tolérance MAIS départ tardif PAYANT activé → lien de paiement
          if (context.lateCheckoutPaid) {
            const pricePerHour = parseFloat(property.late_checkout_price_per_hour) || 0;
            const maxMin = property.late_checkout_max_minutes != null
              ? parseInt(property.late_checkout_max_minutes) : null;
            // Plafond : si demande au-delà du max autorisé → on bascule sur validation manuelle (Cas 3)
            if (pricePerHour > 0 && (maxMin == null || delayMin <= maxMin)) {
              const billedMin = Math.max(0, delayMin - toleranceMin);
              const billedHours = Math.max(1, Math.ceil(billedMin / 60));
              const amountCents = Math.round(billedHours * pricePerHour * 100);
              const priceLabel = (amountCents / 100).toFixed(2).replace(/\.00$/, '') + '€';

              const link = await createUpsellPaymentLink({
                pool, stripe, conversation, property,
                kind: 'late_checkout',
                label: `Départ tardif jusqu'à ${reqLabel}`,
                description: `${property.name || 'Logement'} — ${billedHours}h après ${depLabel}`,
                amountCents,
                extraMeta: { req_label: reqLabel, ref_label: depLabel, billed_hours: String(billedHours) },
              });

              if (link && link.url) {
                const payMsg = {
                  fr: `Un départ tardif jusqu'à ${reqLabel} est possible ! 😊\n\nCette prestation est à ${priceLabel} (${billedHours}h après l'heure de départ habituelle de ${depLabel}). Pour la réserver, il vous suffit de régler ici :\n\n${link.url}\n\nDès le paiement validé, c'est confirmé et noté pour le ménage. À très vite !`,
                  en: `A late checkout until ${reqLabel} is possible! 😊\n\nThis option costs ${priceLabel} (${billedHours}h after the usual ${depLabel} checkout). To book it, simply pay here:\n\n${link.url}\n\nOnce payment is confirmed, you're all set. See you soon!`,
                  it: `È possibile una partenza posticipata fino alle ${reqLabel}! 😊\n\nQuesta opzione costa ${priceLabel} (${billedHours}h dopo le ${depLabel}). Per prenotarla, paghi qui:\n\n${link.url}\n\nDopo il pagamento è tutto confermato. A presto!`,
                  es: `¡Una salida tardía hasta las ${reqLabel} es posible! 😊\n\nEsta opción cuesta ${priceLabel} (${billedHours}h después de las ${depLabel}). Para reservarla, pague aquí:\n\n${link.url}\n\nUna vez confirmado el pago, queda reservado. ¡Hasta pronto!`,
                  de: `Ein spätes Auschecken bis ${reqLabel} ist möglich! 😊\n\nDiese Option kostet ${priceLabel} (${billedHours}h nach ${depLabel}). Zum Buchen zahlen Sie bitte hier:\n\n${link.url}\n\nNach Zahlungseingang ist alles bestätigt. Bis bald!`,
                };
                await sendBotMessage(conversation.id, payMsg[language] || payMsg.fr, pool, io, channexId);
                await addInternalNote(conversation.id,
                  `💸 Départ tardif PAYANT proposé : ${reqLabel} (prévu ${depLabel}) — ${priceLabel} pour ${billedHours}h. Lien de paiement envoyé, en attente de règlement.`,
                  pool, io);
                console.log(`💸 [HANDLER] Late checkout payant proposé à ${reqLabel} (${priceLabel})`);
                return true;
              }
              // Si la création du lien échoue → on retombe sur la validation manuelle ci-dessous
              console.warn('⚠️ [HANDLER] Lien late checkout non créé → fallback question hôte');
            }
          }

          // Cas 3 : au-delà de la tolérance → refuser poliment + escalade
          const tooLateMsg = {
            fr: `Je comprends votre demande de partir à ${reqLabel}. Je dois vérifier ce point avec l'hôte, qui reviendra vers vous rapidement pour confirmer. Merci de votre patience ! 🙏`,
            en: `I understand you'd like to leave at ${reqLabel}. I need to check this with the host, who'll get back to you shortly to confirm. Thank you for your patience! 🙏`,
            it: `Capisco che vorrebbe partire alle ${reqLabel}. Devo verificare con l'host, che la ricontatterà a breve per confermare. Grazie per la pazienza! 🙏`,
            es: `Entiendo que quiere salir a las ${reqLabel}. Debo verificarlo con el anfitrión, que le responderá pronto para confirmar. ¡Gracias por su paciencia! 🙏`,
            de: `Ich verstehe, dass Sie um ${reqLabel} abreisen möchten. Ich muss das mit dem Gastgeber klären, der sich in Kürze bei Ihnen meldet. Vielen Dank für Ihre Geduld! 🙏`,
          };
          await sendBotMessage(conversation.id, tooLateMsg[language] || tooLateMsg.fr, pool, io, channexId);
          // Note interne orange : demande en attente de validation
          await addInternalNote(conversation.id,
            `⏳ Départ tardif à ${reqLabel} demandé (prévu ${depLabel}) — HORS tolérance. En attente de votre validation (Oui/Non).`,
            pool, io);
          // Question Oui/Non à l'hôte (modal + notif) ; sur Oui → note réservation auto
          await createHostQuestion(conversation, pool, io, {
            question: `Autoriser un départ tardif à ${reqLabel} ? (prévu ${depLabel})`,
            guestMessage: message.message,
            language,
            kind: 'schedule',
            meta: { type: 'late', reqLabel, refLabel: depLabel }
          });
          console.log(`🔄 [HANDLER] Late checkout ${reqLabel} > tolérance → question Oui/Non à l'hôte`);
          return false;
        } catch(e) {
          console.error('❌ [HANDLER] Erreur late checkout:', e.message);
          await escalateToOwner(conversation, pool, io, language, channexId);
          return false;
        }
      }

      // ─── Détection tag [EARLY_CHECKIN:HH:MM] ──────────────────
      const earlyMatch = aiResponse.match(/\[EARLY_CHECKIN:(\d{1,2}):(\d{2})\]/);
      if (earlyMatch) {
        try {
          const reqH = parseInt(earlyMatch[1]);
          const reqMin = parseInt(earlyMatch[2]);
          // Heure d'arrivée prévue (check-in)
          const arrStr = String(context.arrivalTime || '15:00');
          const arrMatch = arrStr.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/);
          const arrH = arrMatch ? parseInt(arrMatch[1]) : 15;
          const arrM = arrMatch && arrMatch[2] != null ? parseInt(arrMatch[2]) : 0;

          const requestedTotal = reqH * 60 + reqMin;
          const arrivalTotal = arrH * 60 + arrM;
          const earlyMin = arrivalTotal - requestedTotal; // minutes AVANT le check-in
          const toleranceMin = context.earlyCheckinToleranceMin != null
            ? context.earlyCheckinToleranceMin : 60;

          const reqLabel = `${String(reqH).padStart(2,'0')}h${String(reqMin).padStart(2,'0')}`;
          const arrLabel = `${String(arrH).padStart(2,'0')}h${String(arrM).padStart(2,'0')}`;

          // Cas 1 : heure demandée >= check-in → pas une arrivée anticipée, c'est OK
          if (earlyMin <= 0) {
            const okMsg = {
              fr: `Pas de problème, une arrivée à ${reqLabel} est tout à fait possible. À très bientôt ! 😊`,
              en: `No problem, arriving at ${reqLabel} works perfectly. See you soon! 😊`,
              it: `Nessun problema, arrivare alle ${reqLabel} va benissimo. A presto! 😊`,
              es: `Sin problema, llegar a las ${reqLabel} está perfecto. ¡Hasta pronto! 😊`,
              de: `Kein Problem, Ankunft um ${reqLabel} ist völlig in Ordnung. Bis bald! 😊`,
            };
            await sendBotMessage(conversation.id, okMsg[language] || okMsg.fr, pool, io, channexId);
            return true;
          }

          // Cas 1bis : arrivée la NUIT (minuit / petit matin) avec check-in l'après-midi
          // → ce n'est PAS une arrivée anticipée mais une arrivée TARDIVE. On rassure, pas de question hôte.
          const isLateNightArrival = (reqH < 7 && arrH >= 11) || earlyMin > 600;
          if (isLateNightArrival) {
            const lateMsg = {
              fr: `Pas de souci pour une arrivée vers ${reqLabel} ! Le logement est en accès autonome, vous pourrez entrer à votre arrivée même tard dans la nuit. Les informations d'accès vous parviennent le jour de votre arrivée. Bon voyage et à très vite ! 😊`,
              en: `No problem arriving around ${reqLabel}! The place has self check-in, so you can get in even late at night. Access details are sent to you on the day of your arrival. Safe travels, see you soon! 😊`,
              it: `Nessun problema per un arrivo verso le ${reqLabel}! L'alloggio ha l'accesso autonomo, potrà entrare anche a notte fonda. Le info di accesso arrivano il giorno dell'arrivo. Buon viaggio, a presto! 😊`,
              es: `¡Sin problema para llegar hacia las ${reqLabel}! El alojamiento tiene acceso autónomo, podrá entrar incluso de madrugada. La info de acceso se envía el día de su llegada. ¡Buen viaje, hasta pronto! 😊`,
              de: `Kein Problem für eine Ankunft gegen ${reqLabel}! Die Unterkunft hat Self-Check-in, Sie kommen auch spät nachts rein. Die Zugangsdaten erhalten Sie am Anreisetag. Gute Reise, bis bald! 😊`,
            };
            await sendBotMessage(conversation.id, lateMsg[language] || lateMsg.fr, pool, io, channexId);
            await addInternalNote(conversation.id,
              `🌙 Arrivée tardive annoncée vers ${reqLabel} (check-in ${arrLabel}) — traitée comme arrivée de nuit, pas comme arrivée anticipée.`,
              pool, io);
            console.log(`🌙 [HANDLER] Arrivée tardive ${reqLabel} (≠ early check-in) — rassurance auto`);
            return true;
          }

          // Cas 2 : dans la tolérance → ACCEPTER + note auto + notif proprio
          if (earlyMin <= toleranceMin) {
            const okMsg = {
              fr: `C'est noté, vous pourrez accéder au logement dès ${reqLabel} 😊 Les informations d'accès vous parviendront le matin de votre arrivée. À très bientôt !`,
              en: `All set, you'll be able to access the place from ${reqLabel} 😊 Access details will be sent to you the morning of your arrival. See you soon!`,
              it: `Perfetto, potrà accedere all'alloggio dalle ${reqLabel} 😊 Le informazioni di accesso le arriveranno la mattina dell'arrivo. A presto!`,
              es: `Perfecto, podrá acceder al alojamiento desde las ${reqLabel} 😊 La información de acceso le llegará la mañana de su llegada. ¡Hasta pronto!`,
              de: `Alles klar, Sie können die Unterkunft ab ${reqLabel} betreten 😊 Die Zugangsdaten erhalten Sie am Morgen Ihrer Ankunft. Bis bald!`,
            };
            await sendBotMessage(conversation.id, okMsg[language] || okMsg.fr, pool, io, channexId);
            await addArrivalNote(conversation, pool, reqLabel, 'early');
            await addInternalNote(conversation.id,
              `🕐 Arrivée anticipée autorisée automatiquement : ${reqLabel} (prévu ${arrLabel}). Note ajoutée à la réservation.`,
              pool, io);
            await notifyEarlyCheckin(conversation, pool, reqLabel, arrLabel, true);
            console.log(`✅ [HANDLER] Early check-in accepté à ${reqLabel} (tolérance ${toleranceMin}min)`);
            return true;
          }

          // Cas 2bis : au-delà de la tolérance MAIS arrivée anticipée PAYANTE activée → lien de paiement
          if (context.earlyCheckinPaid) {
            const pricePerHour = parseFloat(property.early_checkin_price_per_hour) || 0;
            const maxMin = property.early_checkin_max_minutes != null
              ? parseInt(property.early_checkin_max_minutes) : null;
            if (pricePerHour > 0 && (maxMin == null || earlyMin <= maxMin)) {
              const billedMin = Math.max(0, earlyMin - toleranceMin);
              const billedHours = Math.max(1, Math.ceil(billedMin / 60));
              const amountCents = Math.round(billedHours * pricePerHour * 100);
              const priceLabel = (amountCents / 100).toFixed(2).replace(/\.00$/, '') + '€';

              const link = await createUpsellPaymentLink({
                pool, stripe, conversation, property,
                kind: 'early_checkin',
                label: `Arrivée anticipée dès ${reqLabel}`,
                description: `${property.name || 'Logement'} — ${billedHours}h avant ${arrLabel}`,
                amountCents,
                extraMeta: { req_label: reqLabel, ref_label: arrLabel, billed_hours: String(billedHours) },
              });

              if (link && link.url) {
                const payMsg = {
                  fr: `Une arrivée anticipée dès ${reqLabel} est possible ! 😊\n\nCette prestation est à ${priceLabel} (${billedHours}h avant l'heure d'arrivée habituelle de ${arrLabel}). Pour la réserver, réglez simplement ici :\n\n${link.url}\n\nDès le paiement validé, c'est confirmé. À très vite !`,
                  en: `An early check-in from ${reqLabel} is possible! 😊\n\nThis option costs ${priceLabel} (${billedHours}h before the usual ${arrLabel} check-in). To book it, simply pay here:\n\n${link.url}\n\nOnce payment is confirmed, you're all set. See you soon!`,
                  it: `È possibile un check-in anticipato dalle ${reqLabel}! 😊\n\nQuesta opzione costa ${priceLabel} (${billedHours}h prima delle ${arrLabel}). Per prenotarla, paghi qui:\n\n${link.url}\n\nDopo il pagamento è tutto confermato. A presto!`,
                  es: `¡Una entrada anticipada desde las ${reqLabel} es posible! 😊\n\nEsta opción cuesta ${priceLabel} (${billedHours}h antes de las ${arrLabel}). Para reservarla, pague aquí:\n\n${link.url}\n\nUna vez confirmado el pago, queda reservado. ¡Hasta pronto!`,
                  de: `Ein früher Check-in ab ${reqLabel} ist möglich! 😊\n\nDiese Option kostet ${priceLabel} (${billedHours}h vor ${arrLabel}). Zum Buchen zahlen Sie bitte hier:\n\n${link.url}\n\nNach Zahlungseingang ist alles bestätigt. Bis bald!`,
                };
                await sendBotMessage(conversation.id, payMsg[language] || payMsg.fr, pool, io, channexId);
                await addInternalNote(conversation.id,
                  `💸 Arrivée anticipée PAYANTE proposée : ${reqLabel} (prévu ${arrLabel}) — ${priceLabel} pour ${billedHours}h. Lien de paiement envoyé, en attente de règlement.`,
                  pool, io);
                console.log(`💸 [HANDLER] Early check-in payant proposé à ${reqLabel} (${priceLabel})`);
                return true;
              }
              console.warn('⚠️ [HANDLER] Lien early check-in non créé → fallback question hôte');
            }
          }

          // Cas 3 : trop tôt → refuser poliment + escalade
          const tooEarlyMsg = {
            fr: `Je comprends votre souhait d'arriver à ${reqLabel}. L'arrivée est normalement prévue à partir de ${arrLabel}. Je vérifie avec l'hôte si une arrivée plus tôt est possible et reviens vers vous rapidement. Merci ! 🙏`,
            en: `I understand you'd like to arrive at ${reqLabel}. Check-in is normally from ${arrLabel}. I'll check with the host whether an earlier arrival is possible and get back to you shortly. Thank you! 🙏`,
            it: `Capisco che vorrebbe arrivare alle ${reqLabel}. Il check-in è normalmente dalle ${arrLabel}. Verifico con l'host se è possibile un arrivo anticipato e la ricontatto a breve. Grazie! 🙏`,
            es: `Entiendo que quiere llegar a las ${reqLabel}. La entrada es normalmente a partir de las ${arrLabel}. Verifico con el anfitrión si es posible una llegada anticipada y le respondo pronto. ¡Gracias! 🙏`,
            de: `Ich verstehe, dass Sie um ${reqLabel} ankommen möchten. Der Check-in ist normalerweise ab ${arrLabel}. Ich kläre mit dem Gastgeber, ob eine frühere Ankunft möglich ist, und melde mich bald. Danke! 🙏`,
          };
          await sendBotMessage(conversation.id, tooEarlyMsg[language] || tooEarlyMsg.fr, pool, io, channexId);
          // Note interne orange : demande en attente de validation
          await addInternalNote(conversation.id,
            `⏳ Arrivée anticipée à ${reqLabel} demandée (prévu ${arrLabel}) — HORS tolérance. En attente de votre validation (Oui/Non).`,
            pool, io);
          // Question Oui/Non à l'hôte (modal + notif) ; sur Oui → note réservation auto
          await createHostQuestion(conversation, pool, io, {
            question: `Autoriser une arrivée anticipée à ${reqLabel} ? (prévu ${arrLabel})`,
            guestMessage: message.message,
            language,
            kind: 'schedule',
            meta: { type: 'early', reqLabel, refLabel: arrLabel }
          });
          console.log(`🔄 [HANDLER] Early check-in ${reqLabel} > tolérance → question Oui/Non à l'hôte`);
          return false;
        } catch(e) {
          console.error('❌ [HANDLER] Erreur early check-in:', e.message);
          await escalateToOwner(conversation, pool, io, language, channexId);
          return false;
        }
      }

      // ─── Détection tag [FACTURE] ──────────────────────────────
      const factureMatch = aiResponse.match(/\[FACTURE(?::([^\]]*))?\]/);
      if (factureMatch) {
        const cleanMsg = aiResponse.replace(/\[FACTURE(?:[^\]]*)\]/, '').trim();
        try {
          // Parser les infos éventuelles (siret=XXX,company=YYY,address=ZZZ)
          const params = {};
          if (factureMatch[1]) {
            factureMatch[1].split(',').forEach(pair => {
              const [k, ...v] = pair.split('=');
              if (k && v.length) params[k.trim()] = v.join('=').trim();
            });
          }
          // Récupérer la réservation liée
          const resRow = await pool.query(
            `SELECT r.uid, r.guest_name, r.guest_email, r.start_date, r.end_date,
                    r.amount_total, r.amount_rooms, r.amount_cleaning, r.amount_taxes
             FROM reservations r
             WHERE (r.channex_booking_id = $1 AND $1 IS NOT NULL)
                OR (r.property_id = $2 AND DATE(r.start_date) = DATE($3) AND r.status != 'cancelled')
             ORDER BY (r.channex_booking_id = $1) DESC NULLS LAST, r.created_at DESC LIMIT 1`,
            [conversation.channex_booking_id || null, conversation.property_id, conversation.reservation_start_date]
          );
          const res = resRow.rows[0];
          // Vérifier si une demande existe déjà pour cette conv
          const existing = await pool.query(
            `SELECT id FROM invoice_requests WHERE conversation_id = $1 AND status = 'pending' LIMIT 1`,
            [conversation.id]
          );
          if (existing.rows.length > 0) {
            // Mettre à jour les infos si fournies
            if (Object.keys(params).length > 0) {
              const updates = [];
              const vals = [];
              let i = 1;
              if (params.siret)   { updates.push(`client_siret = $${i++}`);   vals.push(params.siret); }
              if (params.company) { updates.push(`client_company = $${i++}`); vals.push(params.company); }
              if (params.address) { updates.push(`client_address = $${i++}`); vals.push(params.address); }
              if (params.name)    { updates.push(`client_name = $${i++}`);    vals.push(params.name); }
              if (params.email)   { updates.push(`client_email = $${i++}`);   vals.push(params.email); }
              if (updates.length) {
                vals.push(existing.rows[0].id);
                await pool.query(`UPDATE invoice_requests SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
                console.log(`🧾 [FACTURE] Demande ${existing.rows[0].id} mise à jour:`, params);
              }
            }
          } else {
            // Créer la demande
            await pool.query(
              `INSERT INTO invoice_requests
               (conversation_id, reservation_uid, user_id, property_id,
                client_name, client_email, client_siret, client_company, client_address,
                rent_amount, cleaning_fee, tourist_tax, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',NOW(),NOW())`,
              [
                conversation.id,
                res?.uid || null,
                conversation.user_id,
                conversation.property_id,
                params.name    || res?.guest_name  || conversation.guest_name  || null,
                params.email   || res?.guest_email || conversation.guest_email || null,
                params.siret   || null,
                params.company || null,
                params.address || null,
                res?.amount_rooms  || res?.amount_total || null,
                res?.amount_cleaning || null,
                res?.amount_taxes  || null,
              ]
            );
            console.log(`🧾 [FACTURE] Demande créée pour conv ${conversation.id}`);
          }
        } catch(fErr) {
          console.warn('⚠️ [FACTURE] Erreur création demande:', fErr.message);
        }
        if (cleanMsg) await sendBotMessage(conversation.id, cleanMsg, pool, io, channexId);
        return true;
      }

      // ─── Détection tag [WELCOME_BASKET] (panier d'accueil payant) ──
      const basketMatch = aiResponse.match(/\[WELCOME_BASKET\]/i);
      if (basketMatch) {
        const cleanMsg = aiResponse.replace(/\[WELCOME_BASKET\]/i, '').trim();
        try {
          if (context.welcomeBasketEnabled && context.welcomeBasketPrice > 0) {
            const amountCents = Math.round(context.welcomeBasketPrice * 100);
            const priceLabel = (amountCents / 100).toFixed(2).replace(/\.00$/, '') + '€';
            const desc = context.welcomeBasketDescription
              ? context.welcomeBasketDescription
              : (language === 'en' ? 'Welcome basket' : 'Panier d\'accueil');

            const link = await createUpsellPaymentLink({
              pool, stripe, conversation, property,
              kind: 'welcome_basket',
              label: (language === 'en' ? 'Welcome basket' : "Panier d'accueil") + ` — ${property.name || ''}`.trim(),
              description: desc,
              amountCents,
              extraMeta: {},
            });

            if (link && link.url) {
              const payMsg = {
                fr: `${cleanMsg ? cleanMsg + '\n\n' : ''}Avec plaisir ! Notre panier d'accueil (${desc}) est à ${priceLabel}. Pour en profiter, réglez simplement ici :\n\n${link.url}\n\nDès le paiement validé, nous le préparons pour votre arrivée 😊`,
                en: `${cleanMsg ? cleanMsg + '\n\n' : ''}With pleasure! Our welcome basket (${desc}) costs ${priceLabel}. To enjoy it, simply pay here:\n\n${link.url}\n\nOnce payment is confirmed, we'll prepare it for your arrival 😊`,
                it: `${cleanMsg ? cleanMsg + '\n\n' : ''}Con piacere! Il nostro cesto di benvenuto (${desc}) costa ${priceLabel}. Per averlo, paghi qui:\n\n${link.url}\n\nDopo il pagamento lo prepariamo per il suo arrivo 😊`,
                es: `${cleanMsg ? cleanMsg + '\n\n' : ''}¡Con gusto! Nuestra cesta de bienvenida (${desc}) cuesta ${priceLabel}. Para disfrutarla, pague aquí:\n\n${link.url}\n\nUna vez confirmado el pago, la preparamos para su llegada 😊`,
                de: `${cleanMsg ? cleanMsg + '\n\n' : ''}Gerne! Unser Willkommenskorb (${desc}) kostet ${priceLabel}. Zum Buchen zahlen Sie bitte hier:\n\n${link.url}\n\nNach Zahlungseingang bereiten wir ihn für Ihre Ankunft vor 😊`,
              };
              await sendBotMessage(conversation.id, payMsg[language] || payMsg.fr, pool, io, channexId);
              await addInternalNote(conversation.id,
                `💸 Panier d'accueil PAYANT proposé — ${priceLabel}. Lien de paiement envoyé, en attente de règlement.`,
                pool, io);
              console.log(`💸 [HANDLER] Panier d'accueil payant proposé (${priceLabel})`);
              return true;
            }
          }
          // Pas activé ou lien KO → message neutre sans inventer de prix
          const fallback = {
            fr: `Je vérifie ce point avec l'hôte et reviens vers vous très vite 😊`,
            en: `I'm checking this with the host and will get back to you very soon 😊`,
          };
          await sendBotMessage(conversation.id, cleanMsg || (fallback[language] || fallback.fr), pool, io, channexId);
          return true;
        } catch(bErr) {
          console.error('❌ [HANDLER] Erreur panier d\'accueil:', bErr.message);
          if (cleanMsg) await sendBotMessage(conversation.id, cleanMsg, pool, io, channexId);
          return true;
        }
      }

      await sendBotMessage(conversation.id, aiResponse, pool, io, channexId);
      return true;
    }

    // ─── Fallback : escalade si Groq ne répond pas ────────────────
    console.log('⚠️ [HANDLER] Groq sans réponse → escalade');
    await escalateToOwner(conversation, pool, io, language, channexId);
    return false;

  } catch (error) {
    console.error('❌ [HANDLER] Erreur handleIncomingMessage:', error);
    return false;
  }
}

// ============================================
// 🕐 LATE CHECKOUT — note auto + notification
// ============================================

// Ajoute/complète la note interne de la réservation liée à la conversation.
// kind = 'late' (départ tardif) ou 'early' (arrivée anticipée).
async function addArrivalNote(conversation, pool, reqLabel, kind) {
  try {
    const resRow = await pool.query(
      `SELECT uid, notes FROM reservations
       WHERE (channex_booking_id = $1 AND $1 IS NOT NULL)
          OR (property_id = $2 AND DATE(start_date) = DATE($3) AND status != 'cancelled')
       ORDER BY (channex_booking_id = $1) DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [conversation.channex_booking_id || null, conversation.property_id, conversation.reservation_start_date]
    );
    const resa = resRow.rows[0];
    if (!resa) { console.warn('⚠️ [ARR] Réservation introuvable pour note'); return; }

    const tag = kind === 'early'
      ? `Arrivée anticipée à ${reqLabel} autorisée`
      : `Checkout tardif à ${reqLabel} autorisé`;
    const dedupeRegex = kind === 'early'
      ? /Arrivée anticipée à \d{1,2}h\d{2} autorisée/
      : /Checkout tardif à \d{1,2}h\d{2} autorisé/;
    const dedupeWord = kind === 'early' ? 'Arrivée anticipée' : 'Checkout tardif';

    let newNotes;
    if (resa.notes && resa.notes.includes(dedupeWord)) {
      newNotes = resa.notes.replace(dedupeRegex, tag);
    } else if (resa.notes && resa.notes.trim().length > 0) {
      newNotes = `${resa.notes.trim()}\n🕐 ${tag}`;
    } else {
      newNotes = `🕐 ${tag}`;
    }

    await pool.query(
      `UPDATE reservations SET notes = $1, updated_at = NOW()
       WHERE uid = $2 OR channex_booking_id = $2`,
      [newNotes, resa.uid]
    );
    console.log(`📝 [ARR] Note réservation mise à jour : ${tag}`);
  } catch(e) {
    console.error('❌ [ARR] Erreur note réservation:', e.message);
  }
}

// Conserve l'ancien nom pour le late checkout (compat) → délègue au générique.
async function addLateCheckoutNote(conversation, pool, reqLabel) {
  return addArrivalNote(conversation, pool, reqLabel, 'late');
}

// Notifie le propriétaire (push) d'une demande d'arrivée anticipée.
async function notifyEarlyCheckin(conversation, pool, reqLabel, arrLabel, accepted) {
  try {
    const { sendNotification } = require('./services/notifications-service');
    let propName = null;
    if (conversation.property_id) {
      try {
        const pr = await pool.query('SELECT internal_name, name FROM properties WHERE id = $1', [conversation.property_id]);
        const p = pr.rows[0];
        if (p) propName = p.internal_name || p.name || null;
      } catch(e) {}
    }
    const guest = conversation.guest_name || 'Voyageur';
    const title = accepted
      ? `🕐 Arrivée anticipée autorisée — ${guest}${propName ? ' · ' + propName : ''}`
      : `⚠️ Demande d'arrivée anticipée — ${guest}${propName ? ' · ' + propName : ''}`;
    const body = accepted
      ? `Arrivée à ${reqLabel} acceptée automatiquement (prévu ${arrLabel}). Note ajoutée à la réservation.`
      : `Le voyageur demande à arriver à ${reqLabel} (prévu ${arrLabel}) — au-delà de la tolérance. À valider manuellement.`;

    const tokens = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [conversation.user_id]
    );
    for (const tok of tokens.rows) {
      await sendNotification(tok.fcm_token, title, body, {
        type: accepted ? 'early_checkin_ok' : 'early_checkin_review',
        conversation_id: String(conversation.id),
        screen: 'messages'
      });
    }
  } catch(e) {
    console.error('❌ [ARR] Erreur notification early:', e.message);
  }
}

// Notifie le propriétaire (push) d'une demande de départ tardif.
async function notifyLateCheckout(conversation, pool, reqLabel, depLabel, accepted) {
  try {
    const { sendNotification } = require('./services/notifications-service');
    let propName = null;
    if (conversation.property_id) {
      try {
        const pr = await pool.query('SELECT internal_name, name FROM properties WHERE id = $1', [conversation.property_id]);
        const p = pr.rows[0];
        if (p) propName = p.internal_name || p.name || null;
      } catch(e) {}
    }
    const guest = conversation.guest_name || 'Voyageur';
    const title = accepted
      ? `🕐 Checkout tardif autorisé — ${guest}${propName ? ' · ' + propName : ''}`
      : `⚠️ Demande de checkout tardif — ${guest}${propName ? ' · ' + propName : ''}`;
    const body = accepted
      ? `Départ à ${reqLabel} accepté automatiquement (prévu ${depLabel}). Note ajoutée à la réservation.`
      : `Le voyageur demande à partir à ${reqLabel} (prévu ${depLabel}) — au-delà de la tolérance. À valider manuellement.`;

    const tokens = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [conversation.user_id]
    );
    for (const tok of tokens.rows) {
      await sendNotification(tok.fcm_token, title, body, {
        type: accepted ? 'late_checkout_ok' : 'late_checkout_review',
        conversation_id: String(conversation.id),
        screen: 'messages'
      });
    }
  } catch(e) {
    console.error('❌ [LATE] Erreur notification:', e.message);
  }
}

// ============================================
// ✍️ SUGGESTION DE RÉPONSE POUR L'HÔTE
// Génère un brouillon (Groq, mode ownerDraft) à partir du dernier
// message du voyageur + tout le contexte logement, le stocke sur la
// conversation et notifie le front via socket. Réutilisé par
// l'escalade (auto) ET l'endpoint "Régénérer".
// ============================================

async function generateOwnerSuggestion(conversationId, pool, io, opts = {}) {
  try {
    // ─── Conversation ───────────────────────────────────────────
    const convRes = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    const conversation = convRes.rows[0];
    if (!conversation) return null;

    // ─── Dernier message du voyageur ────────────────────────────
    const lastGuestRes = await pool.query(
      `SELECT message FROM messages
       WHERE conversation_id = $1 AND sender_type = 'guest'
       AND LENGTH(message) > 1
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    );
    const lastGuestMessage = lastGuestRes.rows[0]?.message || '';

    // ─── Logement ───────────────────────────────────────────────
    let property = null;
    if (conversation.property_id) {
      const pr = await pool.query('SELECT * FROM properties WHERE id = $1', [conversation.property_id]);
      property = pr.rows[0] || null;
    }

    // ─── Langue / phase / plateforme ────────────────────────────
    const language = (conversation.language && conversation.language !== 'auto')
      ? conversation.language : 'auto';
    const platformRaw = (conversation.platform || '').toLowerCase().replace(/[_\-\s]/g, '');
    const isAirbnbPlatform = ['airbnb','abb','airbnbofficial'].includes(platformRaw) || platformRaw.includes('airbnb');

    const checkinDt  = conversation.reservation_start_date ? new Date(conversation.reservation_start_date) : null;
    const checkoutDt = conversation.reservation_end_date   ? new Date(conversation.reservation_end_date)   : null;
    const nowPhase = new Date();
    let stayPhase = 'before';
    if (checkinDt && checkoutDt) {
      if (nowPhase >= checkoutDt) stayPhase = 'after';
      else if (nowPhase >= checkinDt) stayPhase = 'during';
    }

    // ─── Livret d'accueil ───────────────────────────────────────
    let welcomeBookData = null;
    if (property?.welcome_book_url) {
      try {
        const m = property.welcome_book_url.match(/\/welcome\/([a-zA-Z0-9_-]+)/);
        const uniqueId = m ? m[1] : null;
        if (uniqueId) {
          const b = await pool.query('SELECT data FROM welcome_books_v2 WHERE unique_id = $1', [uniqueId]);
          welcomeBookData = b.rows[0]?.data || null;
        }
      } catch(e) {}
    }

    // ─── Q/R personnalisées ─────────────────────────────────────
    let customQRSummary = null;
    if (property) {
      try {
        const raw = property.custom_auto_responses || property.customAutoResponses;
        const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
        if (arr.length) {
          customQRSummary = arr.filter(q => q.keywords && q.response)
            .map(q => `- "${q.keywords}" → ${q.response}`).join('\n');
        }
      } catch(e) {}
    }

    // ─── Faits mémorisés ────────────────────────────────────────
    let propertyFacts = [];
    if (property) {
      try {
        const f = await pool.query(
          `SELECT question, answer, detail FROM property_facts
           WHERE property_id = $1 ORDER BY updated_at DESC LIMIT 50`,
          [property.id]
        );
        propertyFacts = f.rows;
      } catch(e) {}
    }

    // ─── Contexte (mode brouillon : on inclut codes/accès, l'hôte relit) ─
    const context = property ? {
      propertyName:  property.name,
      language, stayPhase,
      checkinDt:     conversation.reservation_start_date,
      checkoutDt:    conversation.reservation_end_date,
      checkinDate:   checkinDt  ? checkinDt.toLocaleDateString('fr-FR')  : null,
      checkoutDate:  checkoutDt ? checkoutDt.toLocaleDateString('fr-FR') : null,
      alreadyGreetedToday: true, // brouillon hôte : pas de salutation auto imposée
      arrivalTime:   property.arrival_time,
      departureTime: property.departure_time || welcomeBookData?.checkoutTime,
      checkoutInstructions: welcomeBookData?.checkoutInstructions,
      wifiName:      property.wifi_name     || welcomeBookData?.wifiSSID,
      wifiPassword:  property.wifi_password || welcomeBookData?.wifiPassword,
      accessCode:    property.access_code || welcomeBookData?.keyboxCode,
      accessInstructions: property.access_instructions || welcomeBookData?.accessInstructions,
      address: (() => {
        const parts = [property.address || welcomeBookData?.address, welcomeBookData?.postalCode, welcomeBookData?.city].filter(Boolean);
        return parts.length ? parts.join(', ') : null;
      })(),
      parkingInfo:        welcomeBookData?.parkingInfo,
      extraNotesAccess:   welcomeBookData?.extraNotesAccess,
      equipmentList:      welcomeBookData?.equipmentList,
      importantRules:     welcomeBookData?.importantRules,
      transportInfo:      welcomeBookData?.transportInfo,
      extraNotesPractical: welcomeBookData?.extraNotesPractical,
      welcomeDescription: welcomeBookData?.welcomeDescription,
      contactPhone:       welcomeBookData?.contactPhone,
      restaurants:        welcomeBookData?.restaurants,
      places:             welcomeBookData?.places,
      shopsList:          welcomeBookData?.shopsList,
      extraNotesAround:   welcomeBookData?.extraNotesAround,
      rooms:              welcomeBookData?.rooms,
      extraNotesLogement: welcomeBookData?.extraNotesLogement,
      practicalInfo:      property.practical_info,
      customQRSummary, propertyFacts,
      isAirbnb: isAirbnbPlatform,
    } : { language };

    // ─── Historique ─────────────────────────────────────────────
    let messageHistory = [];
    try {
      const h = await pool.query(
        `SELECT sender_type, message FROM messages
         WHERE conversation_id = $1
         AND created_at > NOW() - INTERVAL '7 days'
         AND message NOT ILIKE '%THIS RESERVATION HAS BEEN PRE-PAID%'
         AND message NOT ILIKE '%BOOKING NOTE%'
         AND message NOT ILIKE '%OTA Commission%'
         AND sender_type != 'internal_note'
         AND LENGTH(message) > 3
         ORDER BY created_at ASC LIMIT 30`,
        [conversationId]
      );
      messageHistory = h.rows.map(m => ({
        role: m.sender_type === 'guest' ? 'user' : 'assistant',
        content: m.message
      }));
      // éviter doublon avec le dernier message voyageur (envoyé séparément)
      if (messageHistory.length && messageHistory[messageHistory.length - 1].content === lastGuestMessage) {
        messageHistory.pop();
      }
    } catch(e) {}

    // ─── Few-shot (style de l'hôte) ─────────────────────────────
    const fewShotExamples = await loadFewShotExamples(pool, conversationId, conversation.property_id);

    // ─── Proximité temps réel si pertinent ──────────────────────
    try {
      if (context.address && lastGuestMessage) {
        const prox = await getProximityContext(lastGuestMessage, context.address);
        if (prox) context.proximityResults = prox;
      }
    } catch(e) {}

    // ─── Génération du brouillon ────────────────────────────────
    const draft = await getOwnerDraftResponse(
      lastGuestMessage, context, messageHistory, fewShotExamples,
      { regenerate: !!opts.regenerate }
    );
    if (!draft) {
      console.warn(`⚠️ [SUGGESTION] Pas de brouillon généré pour conv ${conversationId}`);
      return null;
    }

    // ─── Stockage + notif socket ────────────────────────────────
    await pool.query(
      `UPDATE conversations
       SET owner_suggestion = $2, owner_suggestion_at = NOW(), owner_suggestion_status = 'pending', updated_at = NOW()
       WHERE id = $1`,
      [conversationId, draft]
    );
    if (io) {
      io.to(`user_${conversation.user_id}`).emit('owner_suggestion_ready', {
        conversationId,
        suggestion: draft,
        guestName: conversation.guest_name || 'Voyageur'
      });
    }
    console.log(`✍️ [SUGGESTION] Brouillon ${opts.regenerate ? '(régénéré) ' : ''}prêt pour conv ${conversationId}`);
    return draft;
  } catch (error) {
    console.error('❌ [SUGGESTION] Erreur generateOwnerSuggestion:', error.message);
    return null;
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
      pt: `👋 Estou a colocá-lo em contacto com o responsável.\n\nA sua mensagem foi transmitida. Obrigado pela sua paciência! 🙏`,
      de: `👋 Ich verbinde Sie mit dem Verantwortlichen.\n\nIhre Nachricht wurde weitergeleitet. Vielen Dank für Ihre Geduld! 🙏`,
      it: `👋 La metto in contatto con il responsabile.\n\nIl suo messaggio è stato trasmesso. Grazie per la pazienza! 🙏`,
      nl: `👋 Ik verbind u door met de verantwoordelijke.\n\nUw bericht is doorgestuurd. Bedankt voor uw geduld! 🙏`,
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
    try {
      const { sendNotification } = require('./services/notifications-service');
      let _propName = null;
      if (conversation.property_id) {
        try {
          const _pr = await pool.query('SELECT internal_name, name FROM properties WHERE id = $1', [conversation.property_id]);
          const _p = _pr.rows[0];
          if (_p) _propName = _p.internal_name || _p.name || null;
        } catch(e) {}
      }
      const tokens = await pool.query(
        'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
        [conversation.user_id]
      );
      for (const tok of tokens.rows) {
        await sendNotification(
          tok.fcm_token,
          `🤝 ${conversation.guest_name || 'Voyageur'}${_propName ? ' — ' + _propName : ''} — Prise en charge requise`,
          `L'IA a passé la main. Répondez dès que possible.`,
          { type: 'escalation', conversation_id: String(conversation.id), screen: 'messages' }
        );
      }
    } catch(nErr) { console.error('❌ [HANDLER] Erreur notif escalade:', nErr.message); }

    // ── Brouillon de réponse pour l'hôte (asynchrone, ne bloque pas l'escalade) ──
    generateOwnerSuggestion(conversation.id, pool, io, {}).catch(e =>
      console.warn('⚠️ [HANDLER] Suggestion à l\'escalade:', e.message));
  } catch (error) {
    console.error('❌ [HANDLER] Erreur escalateToOwner:', error);
  }
}

// ============================================
// ❓ QUESTION FACTUELLE À L'HÔTE (réponse 1 clic)
// ============================================

// Crée une question en attente + notifie l'hôte. Met l'IA en pause sur la conv
// le temps de la réponse (réutilise le mécanisme d'escalade existant).
async function createHostQuestion(conversation, pool, io, { question, guestMessage, language, kind, meta }) {
  kind = kind || 'factual';
  // Nom du logement (pour la notif)
  let propName = null;
  if (conversation.property_id) {
    try {
      const pr = await pool.query('SELECT internal_name, name FROM properties WHERE id = $1', [conversation.property_id]);
      const p = pr.rows[0];
      if (p) propName = p.internal_name || p.name || null;
    } catch(e) {}
  }

  // Enregistrer la question (status pending). Une seule question pending par conv : on remplace l'ancienne.
  let questionId = null;
  try {
    await pool.query(
      `UPDATE ai_host_questions SET status = 'cancelled', updated_at = NOW()
       WHERE conversation_id = $1 AND status = 'pending'`,
      [conversation.id]
    );
    const ins = await pool.query(
      `INSERT INTO ai_host_questions
         (user_id, conversation_id, property_id, guest_name, question, guest_message, language, kind, meta, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), NOW())
       RETURNING id`,
      [conversation.user_id, conversation.id, conversation.property_id || null,
       conversation.guest_name || 'Voyageur', question, guestMessage || '', language || 'fr',
       kind, meta ? JSON.stringify(meta) : null]
    );
    questionId = ins.rows[0].id;
  } catch(e) {
    console.error('❌ [QHOTE] Erreur insertion question:', e.message);
    return;
  }

  // Mettre l'IA en pause (bot silencieux) en attendant la réponse — réutilise le flag escalated
  try {
    await pool.query(
      `UPDATE conversations SET escalated = TRUE, escalated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversation.id]
    );
  } catch(e) {}

  // Notifier l'hôte (push) + temps réel
  try {
    const { sendNotification } = require('./services/notifications-service');
    const guest = conversation.guest_name || 'Voyageur';
    const emoji = kind === 'schedule' ? '🕐' : '❓';
    const label = kind === 'schedule' ? 'Demande horaire' : 'Question voyageur';
    const title = `${emoji} ${label} — ${guest}${propName ? ' · ' + propName : ''}`;
    const body = question;
    const tokens = await pool.query(
      'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
      [conversation.user_id]
    );
    for (const tok of tokens.rows) {
      await sendNotification(tok.fcm_token, title, body, {
        type: 'host_question',
        question_id: String(questionId),
        conversation_id: String(conversation.id),
        screen: 'messages'
      });
    }
  } catch(e) {
    console.error('❌ [QHOTE] Erreur notification:', e.message);
  }

  if (io) {
    io.to(`user_${conversation.user_id}`).emit('host_question_pending', {
      questionId, conversationId: conversation.id,
      guestName: conversation.guest_name || 'Voyageur', question
    });
  }
}

// Quand l'hôte a répondu (oui/non/texte) : l'IA reformule et envoie au voyageur,
// puis l'IA reprend la main sur la conversation. Appelée depuis server.js.
async function relayHostAnswer(pool, io, { questionRow, answerType, freeText }) {
  const channexId = null; // résolu via sendBotMessage si besoin
  const lang = questionRow.language || 'fr';

  // Construire la réponse au voyageur
  let guestReply;
  if (answerType === 'self') {
    // L'hôte répond lui-même → on n'envoie rien automatiquement, il écrit dans la conv.
    // On clôt juste la question et on laisse la conv escaladée (l'hôte prend la main).
    await pool.query(
      `UPDATE ai_host_questions SET status = 'answered_self', answered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [questionRow.id]
    );
    await addInternalNote(questionRow.conversation_id,
      `📝 Demande prise en charge manuellement par l'hôte.`, pool, io);
    return { sent: false };
  }

  // Reformuler via Groq pour une réponse naturelle dans la langue du voyageur
  const positive = answerType === 'yes';
  try {
    const { getGroqResponse } = require('./groq-ai');
    const synthPrompt = `Le voyageur a demandé : "${questionRow.guest_message || questionRow.question}". `
      + `L'hôte vient de confirmer que la réponse est : ${positive ? 'OUI' : 'NON'}`
      + (freeText ? ` (précision de l'hôte : "${freeText}")` : '')
      + `. Rédige UNE réponse courte, chaleureuse et naturelle au voyageur dans sa langue (${lang}), `
      + `qui transmet cette information. 1-2 phrases, 1 emoji max. Ne mentionne pas que tu as demandé à l'hôte. Réponds UNIQUEMENT le message au voyageur, sans tag ni guillemets.`;
    guestReply = await getGroqResponse(synthPrompt, { language: lang }, [], []);
    if (guestReply) guestReply = guestReply.replace(/\[[^\]]+\]/g, '').trim();
  } catch(e) {
    console.error('❌ [QHOTE] Erreur reformulation Groq:', e.message);
  }

  // Fallback si Groq échoue
  if (!guestReply) {
    const yes = { fr: `Bonne nouvelle, c'est bien le cas 😊`, en: `Good news, yes it is 😊`, it: `Buone notizie, sì 😊`, es: `Buenas noticias, sí 😊`, de: `Gute Nachrichten, ja 😊` };
    const no  = { fr: `Après vérification, ce n'est malheureusement pas le cas.`, en: `After checking, unfortunately that's not the case.`, it: `Dopo verifica, purtroppo no.`, es: `Tras verificar, lamentablemente no.`, de: `Nach Prüfung leider nicht.` };
    const base = positive ? (yes[lang] || yes.fr) : (no[lang] || no.fr);
    guestReply = freeText ? `${base} ${freeText}` : base;
  }

  await sendBotMessage(questionRow.conversation_id, guestReply, pool, io, channexId);

  // Cas demande horaire acceptée → écrire la note de réservation + note interne orange
  let meta = questionRow.meta;
  if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = null; } }
  if (questionRow.kind === 'schedule' && positive && meta) {
    try {
      // Reconstituer un objet conversation minimal pour addArrivalNote
      const convRow = await pool.query(
        `SELECT id, user_id, property_id, channex_booking_id, reservation_start_date, guest_name
         FROM conversations WHERE id = $1`,
        [questionRow.conversation_id]
      );
      const conv = convRow.rows[0];
      if (conv) {
        const noteKind = meta.type === 'early' ? 'early' : 'late';
        await addArrivalNote(conv, pool, meta.reqLabel, noteKind);
        const txt = meta.type === 'early'
          ? `🕐 Arrivée anticipée à ${meta.reqLabel} VALIDÉE par l'hôte (prévu ${meta.refLabel}, hors tolérance). Note ajoutée à la réservation.`
          : `🕐 Départ tardif à ${meta.reqLabel} VALIDÉ par l'hôte (prévu ${meta.refLabel}, hors tolérance). Note ajoutée à la réservation.`;
        await addInternalNote(questionRow.conversation_id, txt, pool, io);
      }
    } catch(e) {
      console.error('❌ [QHOTE] Erreur note horaire:', e.message);
    }
  } else if (questionRow.kind === 'schedule' && !positive) {
    // Refus → note interne pour traçabilité
    const m = meta || {};
    await addInternalNote(questionRow.conversation_id,
      `🕐 Demande horaire (${m.reqLabel || '?'}) REFUSÉE par l'hôte.`, pool, io);
  }

  // ── Auto-apprentissage : mémoriser la réponse comme fait du logement ──
  // Uniquement pour les questions FACTUELLES (équipement, animaux...), pas les horaires.
  if (questionRow.kind !== 'schedule' && questionRow.property_id) {
    try {
      await pool.query(
        `INSERT INTO property_facts (property_id, question, answer, detail, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (property_id, question)
         DO UPDATE SET answer = EXCLUDED.answer, detail = EXCLUDED.detail, updated_at = NOW()`,
        [questionRow.property_id, questionRow.question, positive, freeText || null]
      );
      await addInternalNote(questionRow.conversation_id,
        `🧠 Réponse mémorisée pour ce logement : « ${questionRow.question} » → ${positive ? 'Oui' : 'Non'}${freeText ? ' (' + freeText + ')' : ''}. L'IA répondra seule la prochaine fois.`,
        pool, io);
      console.log(`🧠 [FAIT] Mémorisé pour ${questionRow.property_id} : "${questionRow.question}" → ${positive}`);
    } catch(e) {
      console.error('❌ [FAIT] Erreur mémorisation:', e.message);
    }
  }

  // Clore la question + l'IA reprend la main sur la conv
  await pool.query(
    `UPDATE ai_host_questions SET status = $2, answer_text = $3, answered_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [questionRow.id, positive ? 'answered_yes' : 'answered_no', freeText || null]
  );
  await pool.query(
    `UPDATE conversations SET escalated = FALSE, escalated_at = NULL, updated_at = NOW() WHERE id = $1`,
    [questionRow.conversation_id]
  );
  if (io) io.to(`user_${questionRow.user_id}`).emit('host_question_answered', { questionId: questionRow.id });

  return { sent: true, message: guestReply };
}

// ============================================
// 💸 CONFIRMATION APRÈS PAIEMENT D'UN UPSELL
// Appelé par le webhook Stripe (checkout.session.completed,
// payment_type='upsell'). Effectue les actions post-paiement :
// note réservation + note interne + notif proprio + confirmation voyageur.
// ============================================

async function confirmUpsellPaid({ paymentRow, pool, io }) {
  try {
    let meta = paymentRow.metadata;
    if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
    meta = meta || {};
    const kind = meta.upsell_kind;
    const convId = meta.conversation_id;
    if (!convId) { console.warn('⚠️ [UPSELL] confirmUpsellPaid sans conversation_id'); return; }

    const cRes = await pool.query('SELECT * FROM conversations WHERE id = $1', [convId]);
    const conversation = cRes.rows[0];
    if (!conversation) { console.warn(`⚠️ [UPSELL] Conversation ${convId} introuvable`); return; }

    const channexId = conversation.channex_booking_id || null;
    const language = (conversation.language && conversation.language !== 'auto') ? conversation.language : 'fr';
    const reqLabel = meta.req_label || '';
    const refLabel = meta.ref_label || '';

    if (kind === 'late_checkout') {
      const msg = {
        fr: `C'est confirmé ✅ Votre départ tardif jusqu'à ${reqLabel} est bien réservé. Profitez de votre matinée — pensez juste à bien fermer en partant. Merci et bon voyage !`,
        en: `Confirmed ✅ Your late checkout until ${reqLabel} is booked. Enjoy your morning — just remember to lock up when you leave. Safe travels!`,
        it: `Confermato ✅ La partenza posticipata fino alle ${reqLabel} è prenotata. Si goda la mattinata e chiuda bene l'alloggio. Buon viaggio!`,
        es: `¡Confirmado ✅ Su salida tardía hasta las ${reqLabel} está reservada. Disfrute la mañana y cierre bien al salir. ¡Buen viaje!`,
        de: `Bestätigt ✅ Ihr spätes Auschecken bis ${reqLabel} ist gebucht. Bitte gut abschließen. Gute Reise!`,
      };
      await sendBotMessage(conversation.id, msg[language] || msg.fr, pool, io, channexId);
      try { await addLateCheckoutNote(conversation, pool, reqLabel); } catch(e) {}
      await addInternalNote(conversation.id,
        `✅💸 Départ tardif PAYÉ : ${reqLabel} (prévu ${refLabel}). Note ajoutée à la réservation.`, pool, io);
      try { await notifyLateCheckout(conversation, pool, reqLabel, refLabel, true); } catch(e) {}

    } else if (kind === 'early_checkin') {
      const msg = {
        fr: `C'est confirmé ✅ Votre arrivée anticipée dès ${reqLabel} est bien réservée. Les informations d'accès vous parviendront le matin de votre arrivée. À très vite !`,
        en: `Confirmed ✅ Your early check-in from ${reqLabel} is booked. Access details will reach you the morning of your arrival. See you soon!`,
        it: `Confermato ✅ Il check-in anticipato dalle ${reqLabel} è prenotato. Le info di accesso arriveranno la mattina dell'arrivo. A presto!`,
        es: `¡Confirmado ✅ Su entrada anticipada desde las ${reqLabel} está reservada. La info de acceso le llegará la mañana de su llegada. ¡Hasta pronto!`,
        de: `Bestätigt ✅ Ihr früher Check-in ab ${reqLabel} ist gebucht. Die Zugangsdaten erhalten Sie am Morgen Ihrer Ankunft. Bis bald!`,
      };
      await sendBotMessage(conversation.id, msg[language] || msg.fr, pool, io, channexId);
      try { await addArrivalNote(conversation, pool, reqLabel, 'early'); } catch(e) {}
      await addInternalNote(conversation.id,
        `✅💸 Arrivée anticipée PAYÉE : ${reqLabel} (prévu ${refLabel}). Note ajoutée à la réservation.`, pool, io);
      try { await notifyEarlyCheckin(conversation, pool, reqLabel, refLabel, true); } catch(e) {}

    } else if (kind === 'welcome_basket') {
      const msg = {
        fr: `Merci ! ✅ Votre panier d'accueil est réservé, nous le préparons pour votre arrivée 😊`,
        en: `Thank you! ✅ Your welcome basket is booked, we'll have it ready for your arrival 😊`,
        it: `Grazie! ✅ Il cesto di benvenuto è prenotato, lo prepareremo per il suo arrivo 😊`,
        es: `¡Gracias! ✅ Su cesta de bienvenida está reservada, la prepararemos para su llegada 😊`,
        de: `Danke! ✅ Ihr Willkommenskorb ist gebucht, wir bereiten ihn für Ihre Ankunft vor 😊`,
      };
      await sendBotMessage(conversation.id, msg[language] || msg.fr, pool, io, channexId);
      await addInternalNote(conversation.id,
        `✅💸 Panier d'accueil PAYÉ — à préparer pour l'arrivée.`, pool, io);
      // Notif proprio
      try {
        const { sendNotification } = require('./services/notifications-service');
        const tokens = await pool.query(
          'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL',
          [conversation.user_id]
        );
        for (const tok of tokens.rows) {
          await sendNotification(
            tok.fcm_token,
            `🧺 Panier d'accueil payé — ${conversation.guest_name || 'Voyageur'}`,
            `Pensez à le préparer pour l'arrivée.`,
            { type: 'upsell_paid', conversation_id: String(conversation.id), screen: 'messages' }
          );
        }
      } catch(e) {}
    } else {
      console.warn(`⚠️ [UPSELL] kind inconnu: ${kind}`);
    }

    console.log(`✅💸 [UPSELL] Paiement confirmé et traité (${kind}) pour conv ${convId}`);
  } catch (error) {
    console.error('❌ [UPSELL] Erreur confirmUpsellPaid:', error.message);
  }
}

module.exports = {
  handleIncomingMessage,
  handleIncomingMessageDebounced,
  sendBotMessage,
  sendAutoMessage,
  addInternalNote,
  createHostQuestion,
  relayHostAnswer,
  generateOwnerSuggestion,
  confirmUpsellPaid
};
