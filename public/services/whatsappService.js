// services/whatsappService.js
// Intégration WhatsApp via Twilio (API HTTP)

const axios = require('axios');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappFrom = process.env.WHATSAPP_FROM; // ex: "whatsapp:+14155238886"

/**
 * Indique si WhatsApp est correctement configuré
 */
function isConfigured() {
  return !!(accountSid && authToken && whatsappFrom);
}

/**
 * Normalise un numéro en format WhatsApp Twilio :
 *  - entrée possible : "06...", "+336...", "whatsapp:+336..."
 *  - sortie : "whatsapp:+336..."
 *
 * Par défaut on considère que c'est un numéro FR si rien n'est précisé.
 */
function normalizeToWhatsApp(toPhone) {
  if (!toPhone) return null;

  let to = String(toPhone).trim();

  // Déjà au bon format
  if (to.startsWith('whatsapp:')) {
    return to;
  }

  // On enlève espaces, tirets, points, etc.
  let digits = to.replace(/[^0-9+]/g, '');

  // Si ça ne commence pas par +, on suppose un numéro FR
  if (!digits.startsWith('+')) {
    if (digits.startsWith('0')) {
      digits = digits.slice(1); // on enlève le 0
    }
    digits = '+33' + digits; // France
  }

  return 'whatsapp:' + digits;
}

/**
 * Envoie un texte WhatsApp via Twilio
 * @param {string} toPhone  Numéro du destinataire (06..., +33..., whatsapp:+33...)
 * @param {string} body     Message texte
 */
async function sendWhatsAppText(toPhone, body) {
  if (!isConfigured()) {
    console.log(
      'WhatsApp non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / WHATSAPP_FROM manquants). Message NON envoyé.',
      { toPhone, body }
    );
    return;
  }

  const to = normalizeToWhatsApp(toPhone);
  if (!to) {
    console.warn('sendWhatsAppText appelé sans numéro valide', { toPhone });
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append('From', whatsappFrom);
  params.append('To', to);
  params.append('Body', body);

  try {
    const response = await axios.post(url, params, {
      auth: {
        username: accountSid,
        password: authToken
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    console.log('✅ WhatsApp envoyé via Twilio', {
      to,
      sid: response.data.sid
    });

    return response.data;
  } catch (err) {
    const details = err.response?.data || err.message || err;
    console.error('❌ Erreur envoi WhatsApp via Twilio :', details);
    throw err;
  }
}

module.exports = {
  isConfigured,
  sendWhatsAppText
};
