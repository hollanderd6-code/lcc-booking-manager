// ============================================
// ROUTES API - ABONNEMENTS STRIPE
// À COPIER-COLLER DANS server.js APRÈS LES AUTRES ROUTES
// ============================================

// Helper : Récupérer le Price ID selon le plan
function getPriceIdForPlan(plan) {
  if (plan === 'pro') {
    return process.env.STRIPE_PRICE_PRO || null;
  }
  // Par défaut : basic
  return process.env.STRIPE_PRICE_BASIC || null;
}

// POST - Créer une session de paiement Stripe
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configure' });
    }

    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Plan requis (basic ou pro)' });
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(400).json({ error: 'Plan inconnu ou non configure' });
    }

    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          userId: user.id,
          plan: plan
        }
      },
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${appUrl}/settings-account.html?tab=subscription&success=true`,
      cancel_url: `${appUrl}/pricing.html?cancelled=true`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur create-checkout-session:', err);
    res.status(500).json({ error: 'Impossible de creer la session de paiement' });
  }
});

// GET - Récupérer le statut d'abonnement de l'utilisateur
app.get('/api/subscription/status', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    const result = await pool.query(
      `SELECT 
        id, status, plan_type, plan_amount,
        trial_start_date, trial_end_date, 
        current_period_end, stripe_subscription_id
      FROM subscriptions 
      WHERE user_id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Aucun abonnement trouve',
        hasSubscription: false
      });
    }

    const subscription = result.rows[0];
    const now = new Date();

    let daysRemaining = null;
    let isExpiringSoon = false;

    if (subscription.status === 'trial') {
      const trialEnd = new Date(subscription.trial_end_date);
      daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      isExpiringSoon = daysRemaining <= 3 && daysRemaining > 0;
    }

    let displayMessage = '';
    if (subscription.status === 'trial') {
      if (daysRemaining > 0) {
        displayMessage = `${daysRemaining} jour${daysRemaining > 1 ? 's' : ''} d'essai restant${daysRemaining > 1 ? 's' : ''}`;
      } else {
        displayMessage = 'Periode essai expiree';
      }
    } else if (subscription.status === 'active') {
      displayMessage = `Abonnement ${subscription.plan_type === 'pro' ? 'Pro' : 'Basic'} actif`;
    } else if (subscription.status === 'expired') {
      displayMessage = 'Abonnement expire';
    } else if (subscription.status === 'canceled') {
      displayMessage = 'Abonnement annule';
    }

    res.json({
      hasSubscription: true,
      status: subscription.status,
      planType: subscription.plan_type,
      planAmount: subscription.plan_amount,
      trialEndDate: subscription.trial_end_date,
      currentPeriodEnd: subscription.current_period_end,
      daysRemaining: daysRemaining,
      isExpiringSoon: isExpiringSoon,
      displayMessage: displayMessage,
      stripeSubscriptionId: subscription.stripe_subscription_id
    });

  } catch (err) {
    console.error('Erreur subscription/status:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST - Créer un lien vers le portail client Stripe
app.post('/api/billing/create-portal-session', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorise' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configure' });
    }

    // Récupérer l'abonnement Stripe
    const result = await pool.query(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun client Stripe trouve' });
    }

    const customerId = result.rows[0].stripe_customer_id;
    const appUrl = process.env.APP_URL || 'https://lcc-booking-manager.onrender.com';

    // Créer la session du portail
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings-account.html?tab=subscription`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Erreur create-portal-session:', err);
    res.status(500).json({ error: 'Impossible de creer la session portail' });
  }
});

// POST - Webhook Stripe (événements de paiement)
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET manquant');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Erreur verification webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Webhook Stripe recu:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.userId;
        const plan = session.metadata?.plan || 'basic';

        if (!userId) {
          console.error('userId manquant dans checkout.session.completed');
          break;
        }

        // Récupérer la subscription Stripe
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        // Mettre à jour la base de données
        await pool.query(
          `UPDATE subscriptions 
           SET 
             stripe_subscription_id = $1,
             stripe_customer_id = $2,
             plan_type = $3,
             status = 'trial',
             updated_at = NOW()
           WHERE user_id = $4`,
          [subscriptionId, customerId, plan, userId]
        );

        console.log(`Abonnement cree pour user ${userId} (plan: ${plan})`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        // Déterminer le statut
        let status = 'active';
        if (subscription.status === 'trialing') status = 'trial';
        else if (subscription.status === 'canceled') status = 'canceled';
        else if (subscription.status === 'past_due') status = 'past_due';

        // Mettre à jour en base
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = $1,
             current_period_end = to_timestamp($2),
             updated_at = NOW()
           WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscriptionId]
        );

        console.log(`Abonnement ${subscriptionId} mis a jour: ${status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        await pool.query(
          `UPDATE subscriptions 
           SET status = 'canceled', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`Abonnement ${subscriptionId} annule`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        // Passer de trial à active si c'était le premier paiement
        await pool.query(
          `UPDATE subscriptions 
           SET 
             status = 'active',
             updated_at = NOW()
           WHERE stripe_subscription_id = $1 AND status = 'trial'`,
          [subscriptionId]
        );

        // Enregistrer l'événement de paiement
        const userId = await pool.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1',
          [subscriptionId]
        );

        if (userId.rows.length > 0) {
          await pool.query(
            `INSERT INTO billing_events (id, user_id, subscription_id, event_type, event_data, created_at)
             VALUES ($1, $2, $3, 'payment_succeeded', $4, NOW())`,
            [
              `evt_${Date.now()}`,
              userId.rows[0].user_id,
              subscriptionId,
              JSON.stringify({
                amount: invoice.amount_paid,
                currency: invoice.currency,
                invoice_id: invoice.id
              })
            ]
          );
        }

        console.log(`Paiement reussi pour subscription ${subscriptionId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        await pool.query(
          `UPDATE subscriptions 
           SET status = 'past_due', updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscriptionId]
        );

        console.log(`Paiement echoue pour subscription ${subscriptionId}`);
        break;
      }

      default:
        console.log(`Evenement non gere: ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Erreur traitement webhook:', err);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});
