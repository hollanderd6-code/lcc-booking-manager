// ============================================
// 💰 SYSTÈME DE MESSAGES AUTOMATIQUES POUR LES CAUTIONS
// Tous les messages passent via Channex si dispo
// ============================================

const { sendAutoMessage } = require('./integrated-chat-handler');

// 🌍 Traduction DeepL (même logique que server.js)
const COUNTRY_TO_LANG = {
  'GB':'EN-GB','US':'EN-US','AU':'EN-GB','CA':'EN-GB','IE':'EN-GB','NZ':'EN-GB',
  'ZA':'EN-GB','SG':'EN-GB','GY':'EN-GB','JM':'EN-GB','TT':'EN-GB','IN':'EN-GB',
  'PK':'EN-GB','PH':'EN-GB','MY':'EN-GB','HK':'EN-GB','NG':'EN-GB','KE':'EN-GB',
  'DE':'DE','AT':'DE','ES':'ES','MX':'ES','AR':'ES','IT':'IT','NL':'NL',
  'PT':'PT-PT','BR':'PT-BR','PL':'PL','RU':'RU','JP':'JA','CN':'ZH','KR':'KO',
  'DK':'DA','SE':'SV','NO':'NB','FI':'FI','CZ':'CS','RO':'RO','HU':'HU',
  'GR':'EL','TR':'TR','UA':'UK','BG':'BG',
  'FR':null,'LU':null,'MC':null,'CI':null,'SN':null,'TN':null,'MA':null,'DZ':null,
};

async function translateDepositMessage(text, guestCountry, guestLanguage) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey || !text) return text;
  let target = null;
  if (guestLanguage) {
    const lang = guestLanguage.toUpperCase().split('-')[0];
    const LANG_MAP = { 'EN':'EN-GB','DE':'DE','ES':'ES','IT':'IT','NL':'NL','PT':'PT-PT',
      'PL':'PL','RU':'RU','JA':'JA','ZH':'ZH','KO':'KO','DA':'DA','SV':'SV','NB':'NB',
      'FI':'FI','CS':'CS','RO':'RO','HU':'HU','EL':'EL','TR':'TR','UK':'UK','BG':'BG' };
    if (lang === 'FR') return text;
    target = LANG_MAP[lang] || null;
  }
  if (!target && guestCountry) {
    const c = guestCountry.toUpperCase().trim();
    if (COUNTRY_TO_LANG[c] === null) return text;
    target = COUNTRY_TO_LANG[c] || 'EN-GB';
  }
  if (!target) target = 'EN-GB'; // fallback anglais
  try {
    const axios = require('axios');
    const response = await axios.post(
      'https://api-free.deepl.com/v2/translate',
      new URLSearchParams({ auth_key: apiKey, text, target_lang: target, source_lang: 'FR', preserve_formatting: '1' }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
    );
    const translated = response.data?.translations?.[0]?.text;
    if (translated) {
      console.log(`🌍 [DEPOSIT] Traduit vers ${target}`);
      return translated;
    }
    return text;
  } catch (err) {
    console.warn(`⚠️ [DEPOSIT] DeepL erreur (${target}):`, err.message);
    return text;
  }
}

/**
 * Récupérer les infos de la propriété pour le message
 */
async function getPropertyInfo(pool, propertyId) {
  try {
    const result = await pool.query(
      'SELECT name, address FROM properties WHERE id = $1',
      [propertyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Erreur récupération propriété:', error);
    return null;
  }
}

/**
 * Récupérer la conversation liée à une réservation
 */
async function getConversationFromReservation(pool, reservationUid) {
  try {
    const resResult = await pool.query(
      'SELECT id, property_id, start_date, channex_booking_id, guest_country, guest_language FROM reservations WHERE uid = $1',
      [reservationUid]
    );
    if (resResult.rows.length === 0) return null;
    const res = resResult.rows[0];

    // Chercher par channex_booking_id si dispo
    if (res.channex_booking_id) {
      const byChannex = await pool.query(
        'SELECT id, channex_booking_id FROM conversations WHERE channex_booking_id = $1 LIMIT 1',
        [res.channex_booking_id]
      );
      if (byChannex.rows.length > 0) {
        console.log(`✅ Conversation trouvée par channex_booking_id pour ${reservationUid}`);
        return { id: byChannex.rows[0].id, channexId: byChannex.rows[0].channex_booking_id, guestCountry: res.guest_country || null, guestLanguage: res.guest_language || null };
      }
    }

    // Fallback : property + date
    const byDate = await pool.query(
      `SELECT id, channex_booking_id FROM conversations
       WHERE property_id = $1 AND DATE(reservation_start_date) = DATE($2)
       ORDER BY created_at DESC LIMIT 1`,
      [res.property_id, res.start_date]
    );
    if (byDate.rows.length > 0) {
      console.log(`🔄 Conversation trouvée par property+date pour ${reservationUid}`);
      return { id: byDate.rows[0].id, channexId: byDate.rows[0].channex_booking_id || null, guestCountry: res.guest_country || null, guestLanguage: res.guest_language || null };
    }
    return null;
  } catch (error) {
    console.error('❌ Erreur getConversationFromReservation:', error);
    return null;
  }
}

/**
 * Envoyer un message dans le chat
 */
async function sendDepositMessage(pool, io, conversationId, message, channexId = null) {
  const result = await sendAutoMessage(pool, io, conversationId, message, channexId);
  return result !== null;
}

/**
 * MESSAGE J-2 : Rappel caution obligatoire
 */
async function sendDepositReminderJ2(pool, io) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Date J+2 (dans 2 jours)
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 2);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    console.log(`\n💰 ============================================`);
    console.log(`💰 RAPPELS CAUTION J-2 (arrivées du ${targetDateStr})`);
    console.log(`💰 ============================================\n`);

    // Récupérer toutes les cautions avec arrivée J+2, status pending, et reminder non envoyé
    const depositsResult = await pool.query(
      `SELECT 
        d.id, d.property_id, d.reservation_uid, d.amount_cents, d.checkout_url, d.status,
        r.start_date as check_in_date, r.guest_name, r.guest_first_name, r.channex_booking_id
       FROM deposits d
       LEFT JOIN reservations r ON d.reservation_uid = r.uid
       WHERE DATE(r.start_date) = $1
         AND d.status = 'pending'
         AND (d.reminder_sent IS NULL OR d.reminder_sent = FALSE)
       ORDER BY d.id`,
      [targetDateStr]
    );

    const deposits = depositsResult.rows;
    console.log(`📊 ${deposits.length} caution(s) en attente de rappel`);

    if (deposits.length === 0) {
      console.log('✅ Aucun rappel à envoyer\n');
      return { total: 0, sent: 0, errors: 0 };
    }

    let sent = 0;
    let errors = 0;

    for (const deposit of deposits) {
      try {
        // Récupérer la conversation
        const conv = await getConversationFromReservation(pool, deposit.reservation_uid);
        const conversationId = conv?.id || null;
        const channexId = conv?.channexId || deposit.channex_booking_id || null;
        
        if (!conversationId) {
          console.log(`⚠️ Pas de conversation pour réservation ${deposit.reservation_uid}`);
          errors++;
          continue;
        }

        const property = await getPropertyInfo(pool, deposit.property_id);
        const propertyName = property?.name || 'votre logement';

        // Construire le message
        const amountEuros = (deposit.amount_cents / 100).toFixed(2);

        // Raccourcir l'URL Stripe via TinyURL
        let depositUrl = deposit.checkout_url;
        try {
          const https = require('https');
          const shortUrl = await new Promise((resolve) => {
            const req = https.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(depositUrl)}`, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => resolve(data.trim()));
            });
            req.on('error', () => resolve(depositUrl));
            req.setTimeout(3000, () => { req.destroy(); resolve(depositUrl); });
          });
          if (shortUrl && shortUrl.startsWith('http')) depositUrl = shortUrl;
        } catch(e) {
          console.warn('⚠️ TinyURL failed, using full URL');
        }

        const guestFirst = deposit.guest_first_name || '';
        const message = `⚠️ Caution obligatoire

Bonjour${guestFirst ? ' ' + guestFirst : ''} !

Une caution de ${amountEuros}€ est requise pour votre séjour à ${propertyName}.

👉 Cliquez ici pour autoriser la caution :
${depositUrl}

⚠️ Sans cette autorisation, vous ne pourrez pas recevoir les informations d'arrivée.

L'autorisation ne débite généralement pas votre carte immédiatement : le montant est bloqué temporairement.

Merci ! 😊`;

        const translatedMsg = await translateDepositMessage(message, conv?.guestCountry || null, conv?.guestLanguage || null);
        const success = await sendDepositMessage(pool, io, conversationId, translatedMsg, channexId);

        if (success) {
          // Marquer le reminder comme envoyé
          await pool.query(
            'UPDATE deposits SET reminder_sent = TRUE, updated_at = NOW() WHERE id = $1',
            [deposit.id]
          );
          
          console.log(`✅ Rappel envoyé pour ${deposit.guest_name} - ${propertyName}`);
          sent++;
        } else {
          errors++;
        }

        // Petite pause entre chaque envoi
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`❌ Erreur traitement caution ${deposit.id}:`, error);
        errors++;
      }
    }

    console.log(`\n📊 RÉSUMÉ RAPPELS J-2:`);
    console.log(`   ✅ Envoyés: ${sent}`);
    console.log(`   ❌ Erreurs: ${errors}`);
    console.log(`   📦 Total: ${deposits.length}\n`);

    return { total: deposits.length, sent, errors };

  } catch (error) {
    console.error('❌ Erreur sendDepositReminderJ2:', error);
    return { total: 0, sent: 0, errors: 0 };
  }
}

/**
 * MESSAGE : Caution autorisée
 */
async function sendDepositAuthorizedMessage(pool, io, depositId) {
  try {
    console.log(`💳 Envoi message autorisation pour caution ${depositId}`);

    // Récupérer les infos de la caution
    const depositResult = await pool.query(
      `SELECT 
        d.id,
        d.property_id,
        d.reservation_uid,
        d.amount_cents,
        r.guest_name
      FROM deposits d
      LEFT JOIN reservations r ON d.reservation_uid = r.uid
      WHERE d.id = $1`,
      [depositId]
    );

    if (depositResult.rows.length === 0) {
      console.log(`⚠️ Caution ${depositId} introuvable`);
      return false;
    }

    const deposit = depositResult.rows[0];

    const conv = await getConversationFromReservation(pool, deposit.reservation_uid);
    if (!conv) { console.log(`⚠️ Pas de conversation pour réservation ${deposit.reservation_uid}`); return false; }
    const conversationId = conv.id;

    // Récupérer les infos de la propriété
    const property = await getPropertyInfo(pool, deposit.property_id);
    const propertyName = property?.name || 'votre logement';

    // Récupérer la date d'arrivée
    const reservationInfo = await pool.query(
      'SELECT start_date FROM reservations WHERE uid = $1',
      [deposit.reservation_uid]
    );
    const arrivalDate = reservationInfo.rows[0]?.start_date ? new Date(reservationInfo.rows[0].start_date) : null;

    // Vérifier si c'est le jour J et après 7h
    const now = new Date();
    const nowParis = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const currentHour = nowParis.getHours();
    
    const todayParis = new Date(nowParis);
    todayParis.setHours(0, 0, 0, 0);
    
    let isArrivalToday = false;
    if (arrivalDate) {
      const arrivalDay = new Date(arrivalDate);
      arrivalDay.setHours(0, 0, 0, 0);
      isArrivalToday = arrivalDay.getTime() === todayParis.getTime();
    }
    
    const isAfter7am = currentHour >= 7;
    const shouldSendNow = isArrivalToday && isAfter7am;

    // Construire le message de confirmation
    const amountEuros = (deposit.amount_cents / 100).toFixed(2);
    
    let confirmMessage;
    if (shouldSendNow) {
      confirmMessage = `✅ Caution autorisée

Parfait ! Votre caution de ${amountEuros}€ a bien été autorisée.

Vous allez recevoir les informations d'arrivée pour ${propertyName} dans quelques instants. 😊`;
    } else if (isArrivalToday && !isAfter7am) {
      confirmMessage = `✅ Caution autorisée

Parfait ! Votre caution de ${amountEuros}€ a bien été autorisée.

Vous recevrez les informations d'arrivée pour ${propertyName} à 7h00 ce matin. 😊`;
    } else {
      confirmMessage = `✅ Caution autorisée

Parfait ! Votre caution de ${amountEuros}€ a bien été autorisée.

Vous recevrez les informations d'arrivée pour ${propertyName} le jour de votre arrivée à 7h00. 😊`;
    }

    // Envoyer le message de confirmation
    const tConfirm = await translateDepositMessage(confirmMessage, conv?.guestCountry || null, conv?.guestLanguage || null);
    await sendDepositMessage(pool, io, conversationId, tConfirm, conv?.channexId || null);

    // ✅ ENVOYER LE MESSAGE D'ARRIVÉE SI JOUR J APRÈS 7H
    if (shouldSendNow) {
      try {
        const { sendImmediateArrivalMessage } = require('./arrival-messages-scheduler');
        console.log(`📨 [DEPOSIT] Jour J après 7h → envoi immédiat du message d'arrivée`);
        await sendImmediateArrivalMessage(pool, io, conversationId);
      } catch (arrivalError) {
        console.error('⚠️ Erreur envoi message d\'arrivée après caution:', arrivalError);
      }
    } else {
      console.log(`⏰ [DEPOSIT] Pas encore le moment → le cron enverra le jour J à 7h`);
    }

    return true;

  } catch (error) {
    console.error(`❌ Erreur sendDepositAuthorizedMessage:`, error);
    return false;
  }
}

/**
 * MESSAGE : Caution libérée
 */
async function sendDepositReleasedMessage(pool, io, depositId) {
  try {
    console.log(`🎉 Envoi message libération pour caution ${depositId}`);

    // Récupérer les infos de la caution
    const depositResult = await pool.query(
      `SELECT 
        d.id,
        d.property_id,
        d.reservation_uid,
        d.amount_cents,
        r.guest_name
      FROM deposits d
      LEFT JOIN reservations r ON d.reservation_uid = r.uid
      WHERE d.id = $1`,
      [depositId]
    );

    if (depositResult.rows.length === 0) {
      console.log(`⚠️ Caution ${depositId} introuvable`);
      return false;
    }

    const deposit = depositResult.rows[0];

    const conv = await getConversationFromReservation(pool, deposit.reservation_uid);
    if (!conv) { console.log(`⚠️ Pas de conversation pour réservation ${deposit.reservation_uid}`); return false; }
    const conversationId = conv.id;

    // Récupérer les infos de la propriété
    const property = await getPropertyInfo(pool, deposit.property_id);
    const propertyName = property?.name || 'votre logement';

    // Construire le message
    const amountEuros = (deposit.amount_cents / 100).toFixed(2);
    const message = `🎉 Caution libérée

Bonne nouvelle ! Votre caution de ${amountEuros}€ pour ${propertyName} a été libérée.

Merci pour votre séjour et à très bientôt ! 😊`;

    // Envoyer le message
    const tMsg1 = await translateDepositMessage(message, conv?.guestCountry || null, conv?.guestLanguage || null);
    return await sendDepositMessage(pool, io, conversationId, tMsg1, conv?.channexId || null);

  } catch (error) {
    console.error(`❌ Erreur sendDepositReleasedMessage:`, error);
    return false;
  }
}

/**
 * MESSAGE : Échec autorisation caution
 */
async function sendDepositFailedMessage(pool, io, depositId) {
  try {
    console.log(`❌ Envoi message échec pour caution ${depositId}`);

    // Récupérer les infos de la caution
    const depositResult = await pool.query(
      `SELECT 
        d.id,
        d.property_id,
        d.reservation_uid,
        d.amount_cents,
        d.checkout_url,
        r.guest_name
      FROM deposits d
      LEFT JOIN reservations r ON d.reservation_uid = r.uid
      WHERE d.id = $1`,
      [depositId]
    );

    if (depositResult.rows.length === 0) {
      console.log(`⚠️ Caution ${depositId} introuvable`);
      return false;
    }

    const deposit = depositResult.rows[0];

    const conv = await getConversationFromReservation(pool, deposit.reservation_uid);
    if (!conv) { console.log(`⚠️ Pas de conversation pour réservation ${deposit.reservation_uid}`); return false; }
    const conversationId = conv.id;

    // Récupérer les infos de la propriété
    const property = await getPropertyInfo(pool, deposit.property_id);
    const propertyName = property?.name || 'votre logement';

    // Construire le message
    const amountEuros = (deposit.amount_cents / 100).toFixed(2);

    // Raccourcir l'URL Stripe via TinyURL
    let depositUrlFailed = deposit.checkout_url;
    try {
      const https = require('https');
      const shortUrl = await new Promise((resolve) => {
        const req = https.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(depositUrlFailed)}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data.trim()));
        });
        req.on('error', () => resolve(depositUrlFailed));
        req.setTimeout(3000, () => { req.destroy(); resolve(depositUrlFailed); });
      });
      if (shortUrl && shortUrl.startsWith('http')) depositUrlFailed = shortUrl;
    } catch(e) {
      console.warn('⚠️ TinyURL failed, using full URL');
    }

    const message = `❌ Échec de l'autorisation

L'autorisation de la caution de ${amountEuros}€ a échoué.

👉 Veuillez réessayer en cliquant ici :
${depositUrlFailed}

⚠️ Sans cette autorisation, vous ne pourrez pas accéder à ${propertyName}.

Si le problème persiste, contactez votre banque ou utilisez une autre carte.

Merci ! 😊`;

    // Envoyer le message
    const tMsg1 = await translateDepositMessage(message, conv?.guestCountry || null, conv?.guestLanguage || null);
    return await sendDepositMessage(pool, io, conversationId, tMsg1, conv?.channexId || null);

  } catch (error) {
    console.error(`❌ Erreur sendDepositFailedMessage:`, error);
    return false;
  }
}

/**
 * Vérifier si une caution bloque l'envoi des infos d'arrivée
 */
async function hasValidDeposit(pool, reservationUid) {
  try {
    const result = await pool.query(
      `SELECT status 
       FROM deposits 
       WHERE reservation_uid = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [reservationUid]
    );

    if (result.rows.length === 0) {
      // Pas de caution = OK, on peut envoyer les infos
      return true;
    }

    const status = result.rows[0].status;

    // Les infos d'arrivée peuvent être envoyées si :
    // - La caution est autorisée (authorized)
    // - La caution est capturée (captured)
    // - La caution est libérée (released)
    const validStatuses = ['authorized', 'captured', 'released'];

    if (validStatuses.includes(status)) {
      return true;
    }

    console.log(`⏭️ Caution en attente (status: ${status}), infos d'arrivée bloquées`);
    return false;

  } catch (error) {
    console.error('❌ Erreur hasValidDeposit:', error);
    // En cas d'erreur, on autorise l'envoi (fail-safe)
    return true;
  }
}

module.exports = {
  sendDepositReminderJ2,
  sendDepositAuthorizedMessage,
  sendDepositReleasedMessage,
  sendDepositFailedMessage,
  hasValidDeposit
};
