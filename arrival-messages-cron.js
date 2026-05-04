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
  // ── Cron 7h00 : messages d'arrivée du jour ──
  cron.schedule('0 7 * * *', async () => {
    console.log('\n⏰ CRON 7h00 — Messages arrivée du jour');
    try {
      await processTodayArrivals(pool, io);
    } catch (error) {
      console.error('❌ Erreur cron 7h00 arrivée:', error);
    }
  }, { timezone: 'Europe/Paris' });

  // ── Cron 8h00 : rattrapage réservations last-minute (réservées aujourd'hui) ──
  // Pour les voyageurs qui réservent le matin même de leur arrivée
  // et pour qui le cron 7h est passé avant la réservation
  cron.schedule('0 8 * * *', async () => {
    console.log('\n⏰ CRON 8h00 — Rattrapage réservations last-minute');
    try {
      await processLastMinuteArrivals(pool, io);
    } catch (error) {
      console.error('❌ Erreur cron 8h00 last-minute:', error);
    }
  }, { timezone: 'Europe/Paris' });

  // ── Cron toutes les 2h entre 9h et 23h : rattrapage continu ──
  // Au cas où une réservation arriverait en journée pour le même jour
  cron.schedule('0 9-23/2 * * *', async () => {
    console.log('\n⏰ CRON 2h — Rattrapage arrivées journée');
    try {
      await processLastMinuteArrivals(pool, io);
    } catch (error) {
      console.error('❌ Erreur cron 2h last-minute:', error);
    }
  }, { timezone: 'Europe/Paris' });

  console.log('✅ Crons arrivée initialisés : 7h00 + 8h00 + toutes les 2h (Europe/Paris)');

  // ⚠️ PAS de setTimeout au démarrage — risque de doubler avec runTemplatesCron
  // Les réservations du jour seront rattrapées par le cron 8h ou le webhook on_booking
}

// Traitement spécifique réservations last-minute (réservées aujourd'hui pour aujourd'hui)
async function processLastMinuteArrivals(pool, io) {
  const { processTodayArrivals } = require('./arrival-messages-scheduler');
  // Même fonction — elle vérifie les doublons en interne
  // On lui passe juste un flag pour qu'elle loggue différemment
  try {
    const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const todayStr = nowParis.toISOString().split('T')[0];

    // Chercher les conversations arrivées aujourd'hui SANS message d'arrivée envoyé
    const result = await pool.query(
      `SELECT c.id
       FROM conversations c
       WHERE DATE(c.reservation_start_date) = $1
       AND c.status != 'cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         WHERE m.conversation_id = c.id
         AND m.sender_type IN ('property','system','bot')
         AND (
           m.message ILIKE '%instructions pour votre arrivée%'
           OR m.message ILIKE '%Bienvenue à%'
           OR m.message ILIKE '%Welcome to%'
           OR m.message ILIKE '%boîte à clés%'
           OR m.message ILIKE '%Il ne vous reste plus qu%'
         )
         AND m.created_at > NOW() - INTERVAL '24 hours'
       )
       AND NOT EXISTS (
         SELECT 1 FROM message_template_logs tl
         WHERE tl.conversation_id = c.id
         AND tl.trigger_type IN ('on_arrival','before_arrival')
         AND tl.status = 'sent'
         AND tl.sent_at > NOW() - INTERVAL '24 hours'
       )`,
      [todayStr]
    );

    if (result.rows.length === 0) {
      console.log('✅ [LAST-MINUTE] Aucune conversation sans message d\'arrivée');
      return;
    }

    console.log(`⚠️ [LAST-MINUTE] ${result.rows.length} conversation(s) sans message d\'arrivée → rattrapage`);
    await processTodayArrivals(pool, io);
  } catch (e) {
    console.error('❌ [LAST-MINUTE] Erreur:', e.message);
  }
}

module.exports = {
  initArrivalMessagesCron
};
