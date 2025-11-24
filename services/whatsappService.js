// services/whatsappService.js
// Version "stub" : ne fait rien, mais évite de casser le serveur.

function isConfigured() {
  // Pour l'instant, on désactive WhatsApp
  return false;
}

/**
 * Simule l'envoi d'un message WhatsApp
 * @param {string} toPhone
 * @param {string} body
 */
async function sendWhatsAppText(toPhone, body) {
  console.log('WhatsApp désactivé (stub). Message NON envoyé.', { toPhone, body });
}

module.exports = {
  isConfigured,
  sendWhatsAppText
};
