// ============================================
// 🎯 GESTIONNAIRE DE CHAT INTÉGRÉ
// Architecture : Groq-first + few-shot learning depuis réponses manuelles
// ============================================

const { getGroqResponse, requiresHumanIntervention } = require('./groq-ai');

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

  // Vérif rapide : si la conv est déjà escaladée, notifier et sortir
  try {
    const freshConv = await pool.query('SELECT escalated FROM conversations WHERE id = $1', [convId]);
    if (freshConv.rows[0]?.escalated) {
      clearTimeout(entry.timer);
      _debounceMap.delete(convId);
      console.log(`ℹ️ [DEBOUNCE] Message OTA système ignoré (conv ${convId}) — pas de réponse Groq`);
      return true;
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

    // ─── Conversation déjà escaladée ──────────────────────────────
    try {
      const freshConv = await pool.query('SELECT escalated FROM conversations WHERE id = $1', [conversation.id]);
      if (freshConv.rows[0]?.escalated) {
        console.log(`ℹ️ [HANDLER] Conv escaladée → bot silencieux, notif proprio`);
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

    // ─── Appel Groq ───────────────────────────────────────────────
    console.log('🚀 [HANDLER] → Groq AI');
    const aiResponse = await getGroqResponse(message.message, context, messageHistory, fewShotExamples);

    if (aiResponse) {
      if (aiResponse.trim() === '[ESCALADE]' || aiResponse.includes('[ESCALADE]')) {
        console.log('🔄 [HANDLER] Groq → escalade');
        await escalateToOwner(conversation, pool, io, language, channexId);
        return false;
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
