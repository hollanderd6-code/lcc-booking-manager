const twilio = require('twilio');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM
} = process.env;

let client = null;

function isConfigured() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
}

function getClient() {
  if (!isConfigured()) {
    return null;
  }
  if (!client) {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return client;
}

/**
 * Envoie un message texte WhatsApp simple via Twilio.
 * @param {string} toPhone - Numéro du destinataire au format E.164 (+336...)
 * @param {string} body - Texte du message
 */
async function sendWhatsAppText(toPhone, body) {
  const client = getClient();
  if (!client) {
    console.log('ℹ️ WhatsApp (Twilio) non configuré, message non envoyé.');
    return;
  }

  if (!toPhone) {
    console.log('ℹ️ Numéro destinataire WhatsApp vide, message ignoré.');
    return;
  }

  const from = TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')
    ? TWILIO_WHATSAPP_FROM
    : 'whatsapp:' + TWILIO_WHATSAPP_FROM;

  const to = toPhone.startsWith('whatsapp:')
    ? toPhone
    : 'whatsapp:' + toPhone;

  return client.messages.create({
    from,
    to,
    body
  });
}

module.exports = {
  isConfigured,
  sendWhatsAppText
};
