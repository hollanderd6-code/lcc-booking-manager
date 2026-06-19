// ============================================
// 💸 UPSELL SERVICE
// Création de liens de paiement pour les prestations payantes
// (départ tardif, arrivée anticipée, panier d'accueil).
// Réutilise la mécanique des cautions : Stripe Connect sur le
// compte du proprio + commission BHGuest 3% (application_fee) +
// lien court privé boostinghost.fr/c/<code>.
//
// Module volontairement autonome (pas de dépendance au handler
// ni au serveur) : il reçoit pool + stripe en paramètres.
// ============================================

const UPSELL_COMMISSION_PCT = 0.03; // 3% commission BHGuest

// ── Choix du compte Stripe (proprio → user → plateforme BH) ──
// Aligné sur getStripeForProperty() de server.js.
async function _resolveStripeTarget(pool, propertyId, userId) {
  if (propertyId) {
    try {
      const r = await pool.query(
        `SELECT oc.stripe_account_id, oc.use_bh_stripe
         FROM properties p
         LEFT JOIN owner_clients oc ON oc.id = p.owner_id
         WHERE p.id = $1`, [propertyId]
      );
      const owner = r.rows[0];
      if (owner?.stripe_account_id && !owner?.use_bh_stripe) {
        return { stripeAccountId: owner.stripe_account_id };
      }
    } catch(e) {}
  }
  if (userId) {
    try {
      const r = await pool.query(
        'SELECT stripe_account_id, use_bh_stripe FROM users WHERE id = $1', [userId]
      );
      const u = r.rows[0];
      if (u?.stripe_account_id && !u?.use_bh_stripe) {
        return { stripeAccountId: u.stripe_account_id };
      }
    } catch(e) {}
  }
  return { stripeAccountId: null }; // compte plateforme BH
}

// ── Lien court boostinghost.fr/c/<code> pour un paymentId ──
async function _makeShortLink(pool, longUrl, userId, paymentId) {
  const appUrl = (process.env.APP_URL || 'https://boostinghost.fr').replace(/\/$/, '');
  if (!longUrl || !longUrl.startsWith('http')) return longUrl || '';
  try {
    const ex = await pool.query('SELECT code FROM short_links WHERE payment_id = $1 LIMIT 1', [paymentId]).catch(() => ({ rows: [] }));
    if (ex.rows[0]) {
      await pool.query('UPDATE short_links SET url = $1, updated_at = NOW() WHERE payment_id = $2', [longUrl, paymentId]).catch(() => {});
      return `${appUrl}/c/${ex.rows[0].code}`;
    }
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let code; let tries = 0;
    do {
      code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const chk = await pool.query('SELECT id FROM short_links WHERE code = $1', [code]).catch(() => ({ rows: [1] }));
      if (chk.rows.length === 0) break;
      tries++;
    } while (tries < 10);
    await pool.query(
      'INSERT INTO short_links (code, url, user_id, payment_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [code, longUrl, userId || null, paymentId]
    ).catch(() => {});
    return `${appUrl}/c/${code}`;
  } catch(e) {
    return longUrl;
  }
}

// ── Création d'un lien de paiement upsell ──
// Params :
//   pool, stripe        : instances
//   conversation        : { id, user_id, property_id, channex_booking_id, reservation_uid, reservation_start_date, reservation_end_date, guest_name }
//   property            : { id, name }
//   kind                : 'late_checkout' | 'early_checkin' | 'welcome_basket'
//   label               : nom produit affiché au paiement (ex "Départ tardif jusqu'à 14h00")
//   description         : sous-texte
//   amountCents         : montant total TTC payé par le voyageur (entier)
//   extraMeta           : objet additionnel stocké dans metadata
// Retour : { url, paymentId, feeCents } ou null
async function createUpsellPaymentLink({ pool, stripe, conversation, property, kind, label, description, amountCents, extraMeta = {} }) {
  if (!stripe) { console.warn('⚠️ [UPSELL] Stripe non configuré'); return null; }
  if (!amountCents || amountCents < 50) { console.warn('⚠️ [UPSELL] Montant invalide:', amountCents); return null; }

  const appUrl = (process.env.APP_URL || 'https://boostinghost.fr').replace(/\/$/, '');
  const paymentId = 'pay_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

  const target = await _resolveStripeTarget(pool, conversation.property_id, conversation.user_id);
  const isConnected = !!target.stripeAccountId;
  const feeCents = isConnected ? Math.round(amountCents * UPSELL_COMMISSION_PCT) : 0;

  const metadata = {
    payment_type: 'upsell',
    upsell_kind: kind,
    conversation_id: String(conversation.id),
    property_id: conversation.property_id ? String(conversation.property_id) : '',
    reservation_uid: conversation.reservation_uid || '',
    user_id: conversation.user_id || '',
    ...extraMeta,
  };

  // ── Enregistrer le paiement (status pending) ──
  try {
    await pool.query(`
      INSERT INTO payments (
        id, user_id, reservation_uid, property_id,
        amount_cents, platform_fee_cents, currency,
        status, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,'eur','pending',$7)
      ON CONFLICT (id) DO NOTHING
    `, [
      paymentId,
      conversation.user_id || null,
      conversation.reservation_uid || '',
      conversation.property_id || null,
      amountCents,
      feeCents,
      JSON.stringify(metadata),
    ]);
  } catch(e) {
    console.error('❌ [UPSELL] Erreur INSERT payment:', e.message);
    return null;
  }

  // ── Session Stripe Checkout (capture immédiate) ──
  const sessionParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: amountCents,
        product_data: {
          name: label || 'Prestation',
          description: description || (property?.name ? `${property.name}` : undefined),
        },
      },
      quantity: 1,
    }],
    payment_intent_data: {
      metadata,
      ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
    },
    metadata,
    success_url: `${appUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/caution-cancel.html`,
  };
  const sessionOptions = isConnected ? { stripeAccount: target.stripeAccountId } : {};

  let session;
  try {
    session = await stripe.checkout.sessions.create(sessionParams, sessionOptions);
  } catch(e) {
    console.error('❌ [UPSELL] Erreur création session Stripe:', e.message);
    return null;
  }

  try {
    await pool.query(
      'UPDATE payments SET stripe_session_id = $1, checkout_url = $2, updated_at = NOW() WHERE id = $3',
      [session.id, session.url, paymentId]
    );
  } catch(e) {}

  const shortUrl = await _makeShortLink(pool, session.url, conversation.user_id, paymentId);
  console.log(`💸 [UPSELL] Lien ${kind} créé (${(amountCents/100).toFixed(2)}€, commission ${(feeCents/100).toFixed(2)}€, ${isConnected ? 'Connect' : 'plateforme'}) → ${shortUrl}`);

  return { url: shortUrl, paymentId, feeCents };
}

module.exports = {
  createUpsellPaymentLink,
  UPSELL_COMMISSION_PCT,
};
