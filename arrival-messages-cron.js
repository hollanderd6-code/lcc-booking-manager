// ============================================
// ⏰ CRON JOB : ENVOI AUTOMATIQUE DES MESSAGES D'ARRIVÉE
// Exécuté chaque jour à 7h00
// ============================================

const cron = require('node-cron');
const { processTodayArrivals } = require('./arrival-messages-scheduler');

/**
 * Initialiser le cron job pour les messages d'arrivée
 */
function initArrivalMessagesCron(pool, io) {
  // Cron job : Tous les jours à 7h00
  // Format : minute heure jour mois jour-semaine
  // '0 7 * * *' = 0 minutes, 7 heures, tous les jours
  
  cron.schedule('0 7 * * *', async () => {
    console.log('\n⏰ ============================================');
    console.log('⏰ CRON JOB : Messages d\'arrivée - 7h00');
    console.log('⏰ ============================================\n');
    
    try {
      await processTodayArrivals(pool, io);
    } catch (error) {
      console.error('❌ Erreur cron job messages d\'arrivée:', error);
    }
  }, {
    timezone: "Europe/Paris"  // Heure de Paris
  });

  console.log('✅ Cron job initialisé : Messages d\'arrivée quotidiens à 7h00 (Europe/Paris)');
  
  // Optionnel : Exécuter immédiatement au démarrage du serveur
  // pour traiter les arrivées du jour si le serveur redémarre
  setTimeout(async () => {
    console.log('🚀 Vérification des arrivées du jour au démarrage du serveur...');
    try {
      await processTodayArrivals(pool, io);
    } catch (error) {
      console.error('❌ Erreur vérification au démarrage:', error);
    }
  }, 5000); // Attendre 5 secondes après le démarrage
}

module.exports = {
  initArrivalMessagesCron
};
