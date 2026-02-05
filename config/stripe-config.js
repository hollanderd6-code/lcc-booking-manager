// ============================================
// CONFIGURATION STRIPE - VERSION PROPRE
// Fichier : config/stripe-config.js
// ============================================

module.exports = {
  // ============================================
  // PRICE IDs STRIPE
  // ============================================
  STRIPE_PRICES: {
    // Plan Solo (15€/mois - 149€/an)
    solo_monthly: process.env.STRIPE_PRICE_SOLO_MONTHLY,
    solo_annual: process.env.STRIPE_PRICE_SOLO_ANNUAL,
    
    // Plan Standard (29€/mois - 289€/an)
    standard_monthly: process.env.STRIPE_PRICE_STANDARD_MONTHLY,
    standard_annual: process.env.STRIPE_PRICE_STANDARD_ANNUAL,
    standard_extra_monthly: process.env.STRIPE_PRICE_STANDARD_EXTRA_MONTHLY,
    standard_extra_annual: process.env.STRIPE_PRICE_STANDARD_EXTRA_ANNUAL,
    
    // Plan Pro (49€/mois - 489€/an)
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
    pro_extra_monthly: process.env.STRIPE_PRICE_PRO_EXTRA_MONTHLY,
    pro_extra_annual: process.env.STRIPE_PRICE_PRO_EXTRA_ANNUAL
  },
  
  // ============================================
  // LIMITES ET TARIFS DES PLANS
  // ============================================
  PLAN_LIMITS: {
    solo: { 
      included: 1,
      extraPrice: null,  // Pas de logements supplémentaires
      monthlyPrice: 15,
      annualPrice: 149,
      name: 'Solo',
      description: 'Pour les propriétaires avec 1 logement'
    },
    
    standard: { 
      included: 3,
      extraPrice: 7,
      extraPriceAnnual: 70,
      monthlyPrice: 29,
      annualPrice: 289,
      name: 'Standard',
      description: 'Pour gérer plusieurs logements simplement'
    },
    
    pro: { 
      included: 6,
      extraPrice: 5,
      extraPriceAnnual: 50,
      monthlyPrice: 49,
      annualPrice: 489,
      name: 'Pro',
      description: 'Pour conciergeries & gestionnaires'
    }
  },
  
  // ============================================
  // FONCTIONS HELPER
  // ============================================
  
  /**
   * Calculer le coût mensuel total
   */
  calculateMonthlyCost(plan, propertyCount) {
    const config = this.PLAN_LIMITS[plan];
    if (!config) return 0;
    
    const basePrice = config.monthlyPrice;
    const extraCount = Math.max(0, propertyCount - config.included);
    const extraPrice = config.extraPrice ? extraCount * config.extraPrice : 0;
    
    return basePrice + extraPrice;
  },
  
  /**
   * Calculer le coût annuel total
   */
  calculateAnnualCost(plan, propertyCount) {
    const config = this.PLAN_LIMITS[plan];
    if (!config) return 0;
    
    const basePrice = config.annualPrice;
    const extraCount = Math.max(0, propertyCount - config.included);
    const extraPrice = config.extraPriceAnnual ? extraCount * config.extraPriceAnnual : 0;
    
    return basePrice + extraPrice;
  },
  
  /**
   * Vérifier si un utilisateur peut ajouter un logement
   */
  canAddProperty(plan, currentCount) {
    const config = this.PLAN_LIMITS[plan];
    
    if (!config) {
      return { canAdd: false, reason: 'Plan invalide', upgradeTo: null };
    }
    
    // Plan Solo : limité à 1 logement
    if (plan === 'solo' && currentCount >= 1) {
      return { 
        canAdd: false, 
        reason: 'Le plan Solo est limité à 1 logement',
        upgradeTo: 'standard',
        upgradeMessage: 'Passez au plan Standard (29€/mois) pour gérer jusqu\'à 3 logements'
      };
    }
    
    // Plans Standard et Pro : logements supplémentaires autorisés
    const newCount = currentCount + 1;
    const willHaveExtra = newCount > config.included;
    
    return {
      canAdd: true,
      reason: willHaveExtra 
        ? `Coût supplémentaire : +${config.extraPrice}€/mois`
        : 'Inclus dans votre plan',
      upgradeTo: null,
      extraCost: willHaveExtra ? config.extraPrice : 0
    };
  },
  
  /**
   * Obtenir le price ID Stripe approprié
   */
  getPriceId(plan, period = 'monthly', isExtra = false) {
    if (isExtra) {
      return this.STRIPE_PRICES[`${plan}_extra_${period}`];
    }
    return this.STRIPE_PRICES[`${plan}_${period}`];
  }
};
