/**
 * MIDDLEWARE DE VÉRIFICATION D'ABONNEMENT
 * 
 * Ce middleware vérifie si l'utilisateur a un abonnement actif
 * et bloque l'accès si :
 * - La période d'essai est expirée
 * - L'abonnement est expiré
 * - L'abonnement est annulé
 */

const { Pool } = require('pg');

// Connexion PostgreSQL (utilise la même config que server-3.js)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

/**
 * Statuts d'abonnement autorisés
 */
const ALLOWED_STATUSES = ['trial', 'active'];
const BLOCKED_STATUSES = ['expired', 'canceled', 'past_due'];

/**
 * Vérifier le statut d'abonnement de l'utilisateur
 */
async function checkSubscription(req, res, next) {
  try {
    // Récupérer l'utilisateur depuis le token (défini par getUserFromRequest dans server-3.js)
    const user = req.user;
    
    if (!user || !user.id) {
      return res.status(401).json({
        error: 'Non autorisé',
        code: 'UNAUTHORIZED'
      });
    }

    // Récupérer l'abonnement de l'utilisateur
    const result = await pool.query(
      `SELECT 
        id,
        status,
        trial_start_date,
        trial_end_date,
        is_trial_used,
        subscription_end_date,
        current_period_end,
        plan_type
      FROM subscriptions
      WHERE user_id = $1`,
      [user.id]
    );

    // Cas 1 : Pas d'abonnement trouvé (ne devrait jamais arriver grâce au trigger)
    if (result.rows.length === 0) {
      console.error(`❌ Utilisateur ${user.id} sans abonnement`);
      return res.status(403).json({
        error: 'Aucun abonnement trouvé',
        code: 'NO_SUBSCRIPTION',
        message: 'Veuillez contacter le support'
      });
    }

    const subscription = result.rows[0];
    const now = new Date();

    // Cas 2 : Période d'essai (trial)
    if (subscription.status === 'trial') {
      const trialEndDate = new Date(subscription.trial_end_date);
      
      // Trial expiré
      if (now > trialEndDate) {
        // Mettre à jour le statut en "expired"
        await pool.query(
          `UPDATE subscriptions 
           SET status = 'expired', updated_at = NOW()
           WHERE id = $1`,
          [subscription.id]
        );

        // Enregistrer l'événement
        await pool.query(
          `INSERT INTO billing_events (id, user_id, subscription_id, event_type, event_data, created_at)
           VALUES ($1, $2, $3, 'trial_ended', $4, NOW())`,
          [
            `evt_${user.id}_${Date.now()}`,
            user.id,
            subscription.id,
            JSON.stringify({ expired_at: now })
          ]
        );

        return res.status(402).json({
          error: 'Période d\'essai expirée',
          code: 'TRIAL_EXPIRED',
          message: 'Votre période d\'essai de 14 jours est terminée. Veuillez souscrire à un abonnement pour continuer.',
          trial_end_date: subscription.trial_end_date,
          redirect: '/subscription-checkout.html'
        });
      }

      // Trial actif - calculer les jours restants
      const daysRemaining = Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24));
      
      // Ajouter les infos d'abonnement à la requête
      req.subscription = {
        status: 'trial',
        days_remaining: daysRemaining,
        trial_end_date: subscription.trial_end_date
      };

      return next();
    }

    // Cas 3 : Abonnement actif (active)
    if (subscription.status === 'active') {
      const periodEnd = subscription.current_period_end 
        ? new Date(subscription.current_period_end)
        : null;

      req.subscription = {
        status: 'active',
        plan_type: subscription.plan_type,
        period_end: periodEnd
      };

      return next();
    }

    // Cas 4 : Abonnement en retard de paiement (past_due)
    if (subscription.status === 'past_due') {
      return res.status(402).json({
        error: 'Paiement en retard',
        code: 'PAYMENT_PAST_DUE',
        message: 'Votre dernier paiement a échoué. Veuillez mettre à jour vos informations de paiement.',
        redirect: '/subscription-manage.html'
      });
    }

    // Cas 5 : Abonnement expiré ou annulé
    if (subscription.status === 'expired' || subscription.status === 'canceled') {
      return res.status(402).json({
        error: 'Abonnement inactif',
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'Votre abonnement est inactif. Veuillez souscrire à un nouvel abonnement pour continuer.',
        status: subscription.status,
        redirect: '/subscription-checkout.html'
      });
    }

    // Cas 6 : Statut inconnu (ne devrait pas arriver)
    console.error(`❌ Statut d'abonnement inconnu: ${subscription.status}`);
    return res.status(500).json({
      error: 'Erreur système',
      code: 'UNKNOWN_STATUS'
    });

  } catch (error) {
    console.error('❌ Erreur dans checkSubscription:', error);
    return res.status(500).json({
      error: 'Erreur serveur',
      code: 'INTERNAL_ERROR'
    });
  }
}

/**
 * Version optionnelle du middleware qui ajoute juste les infos sans bloquer
 * Utile pour les pages qui doivent afficher l'état de l'abonnement
 */
async function getSubscriptionInfo(req, res, next) {
  try {
    const user = req.user;
    
    if (!user || !user.id) {
      req.subscription = null;
      return next();
    }

    const result = await pool.query(
      `SELECT 
        id,
        status,
        trial_end_date,
        current_period_end,
        plan_type,
        plan_amount
      FROM subscriptions
      WHERE user_id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      req.subscription = null;
      return next();
    }

    const subscription = result.rows[0];
    const now = new Date();

    // Calculer les jours restants si en trial
    let daysRemaining = null;
    if (subscription.status === 'trial') {
      const trialEndDate = new Date(subscription.trial_end_date);
      daysRemaining = Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24));
    }

    req.subscription = {
      status: subscription.status,
      trial_end_date: subscription.trial_end_date,
      current_period_end: subscription.current_period_end,
      plan_type: subscription.plan_type,
      plan_amount: subscription.plan_amount,
      days_remaining: daysRemaining
    };

    next();
  } catch (error) {
    console.error('❌ Erreur dans getSubscriptionInfo:', error);
    req.subscription = null;
    next();
  }
}

/**
 * Middleware pour les routes publiques (ne nécessitent pas de vérification)
 * Mais ajoute les infos si l'utilisateur est connecté
 */
function publicRoute(req, res, next) {
  // Les routes publiques passent toujours
  next();
}

module.exports = {
  checkSubscription,
  getSubscriptionInfo,
  publicRoute,
  ALLOWED_STATUSES,
  BLOCKED_STATUSES
};
