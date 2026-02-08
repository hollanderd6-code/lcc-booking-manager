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
  
  cron.schedule('0 9 * * *', async () => {
    console.log('\n⏰ ============================================');
    console.log('⏰ CRON JOB : Rappels caution J-2 - 9h00');
    console.log('⏰ ============================================\n');
    
    try {
      await sendDepositReminderJ2(pool, io);
    } catch (error) {
      console.error('❌ Erreur cron job rappels caution:', error);
    }
  }, {
    timezone: "Europe/Paris"  // Heure de Paris
  });

  console.log('✅ Cron job initialisé : Rappels caution J-2 quotidiens à 9h00 (Europe/Paris)');
  
  // Optionnel : Exécuter immédiatement au démarrage du serveur
  // pour traiter les rappels du jour si le serveur redémarre
  setTimeout(async () => {
    console.log('🚀 Vérification des rappels caution au démarrage du serveur...');
    try {
      await sendDepositReminderJ2(pool, io);
    } catch (error) {
      console.error('❌ Erreur vérification au démarrage:', error);
    }
  }, 5000); // Attendre 5 secondes après le démarrage
}

module.exports = {
  initDepositRemindersCron
};
