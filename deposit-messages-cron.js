// ============================================
// ⏰ CRON JOB : RAPPELS CAUTION J-2
// Exécuté chaque jour à 9h00
// ============================================

const cron = require('node-cron');
const { sendDepositReminderJ2 } = require('./deposit-messages-scheduler');

/**
 * Initialiser le cron job pour les rappels de caution
 */
function initDepositRemindersCron(pool, io) {
  // Cron job : Tous les jours à 9h00
  // Format : minute heure jour mois jour-semaine
  // '0 9 * * *' = 0 minutes, 9 heures, tous les jours
  
  // ⚠️ Cron J-2 désactivé — remplacé par le système de templates (messages.html)
  // Les templates avec {caution_url} gèrent l'envoi et la création du lien Stripe
  // cron.schedule('0 9 * * *', async () => { await sendDepositReminderJ2(pool, io); }, { timezone: "Europe/Paris" });
  console.log('ℹ️ Cron caution J-2 legacy désactivé — géré par runTemplatesCron');
}

module.exports = {
  initDepositRemindersCron
};
