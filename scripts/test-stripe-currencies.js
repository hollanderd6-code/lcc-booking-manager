'use strict';
/**
 * PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1D/1E
 * Diagnostic ISOLÉ — vérifie l'acceptation des devises EUR/ILS/USD/CHF
 * par le compte Stripe plateforme ou un compte Connect TEST.
 *
 * Garanties :
 *   - Clé TEST uniquement (sk_test_…) — refuse et sort si LIVE ou absente
 *   - STRIPE_CONNECT_ACCOUNT_ID facultatif — doit commencer par acct_ si fourni
 *   - Aucune DB, aucune route Express, aucune table modifiée
 *   - Aucun paiement réel, aucune carte, aucun webhook déclenché
 *   - Chaque session créée est immédiatement expirée dans le même contexte Connect
 *   - La valeur de la clé n'est jamais affichée
 *   - Pas de retry EUR sur refus d'une devise — fail-closed
 *
 * Usage plateforme :
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/test-stripe-currencies.js
 *
 * Usage Connect :
 *   STRIPE_SECRET_KEY=sk_test_... STRIPE_CONNECT_ACCOUNT_ID=acct_... node scripts/test-stripe-currencies.js
 */

// ── GUARDRAIL 1 : clé Stripe TEST obligatoire (avant tout autre import) ───

const rawKey = process.env.STRIPE_SECRET_KEY || '';

if (!rawKey) {
  console.error('BLOCKED: STRIPE_SECRET_KEY is not set');
  process.exit(2);
}

if (!rawKey.startsWith('sk_test_')) {
  console.error('BLOCKED: STRIPE_SECRET_KEY is not a Stripe TEST key');
  process.exit(2);
}

// ── GUARDRAIL 2 : format du compte Connect (si fourni) ────────────────────

const rawConnectId = process.env.STRIPE_CONNECT_ACCOUNT_ID || '';

if (rawConnectId && !rawConnectId.startsWith('acct_')) {
  console.error('BLOCKED: STRIPE_CONNECT_ACCOUNT_ID must start with acct_');
  process.exit(2);
}

const connectAccountId = rawConnectId || null;
const MODE = connectAccountId ? 'CONNECT' : 'PLATFORM';

// ── Imports (uniquement Stripe — pas de DB, pas de routes) ───────────────

const Stripe = require('stripe');

// ── Init Stripe ───────────────────────────────────────────────────────────

const stripe = new Stripe(rawKey, { apiVersion: '2025-03-31.basil' });

// ── Request options (dérivé une seule fois, utilisé pour create et expire) ─

const sessionOptions = connectAccountId ? { stripeAccount: connectAccountId } : {};

// ── Expiration helper — même contexte Connect que la création ─────────────

function expireSession(sessionId) {
  if (connectAccountId) {
    return stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: connectAccountId });
  }
  return stripe.checkout.sessions.expire(sessionId);
}

// ── Devises à tester ──────────────────────────────────────────────────────

const CURRENCIES = [
  { code: 'eur', amount: 500 },  // 5,00 €   (min 0,50 €)
  { code: 'ils', amount: 500 },  // 5,00 ₪   (min ~0,50 ₪)
  { code: 'usd', amount: 500 },  // $5.00     (min $0.50)
  { code: 'chf', amount: 500 },  // CHF 5.00  (min CHF 0.50)
];

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const acctDisplay = connectAccountId
    ? connectAccountId.slice(0, 9) + '…'
    : 'platform (no stripeAccount)';

  console.log('');
  console.log('PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1E — Currency acceptance test');
  console.log(`Account  : ${acctDisplay}`);
  console.log(`Mode     : ${MODE}`);
  console.log('API ver  : 2025-03-31.basil');
  console.log('Sessions : created then immediately expired');
  console.log('');

  // ── Vérifier l'accessibilité du compte Connect avec la clé test ─────────
  if (connectAccountId) {
    try {
      await stripe.accounts.retrieve(connectAccountId);
      console.log('Connect account verified: accessible with test key');
      console.log('');
    } catch (err) {
      const safeMsg = String(err.message || '').substring(0, 200);
      console.error(`BLOCKED_CONNECT_ACCOUNT_NOT_TEST_ACCESSIBLE: ${safeMsg}`);
      process.exit(2);
    }
  }

  let aborted = false;

  for (const { code, amount } of CURRENCIES) {
    const label = code.toUpperCase().padEnd(4);
    let session = null;

    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: code,
            unit_amount: amount,
            product_data: { name: `INTL-1E currency test ${code.toUpperCase()}` },
          },
          quantity: 1,
        }],
        success_url: 'https://example.com/intl-1e-success',
        cancel_url:  'https://example.com/intl-1e-cancel',
      }, sessionOptions);

      // Sécurité : abort si Stripe retourne une session live
      if (session.livemode === true) {
        console.error(`\nABORTED: session ${session.id} has livemode=true — key must be LIVE, not TEST`);
        try { await expireSession(session.id); } catch (_) {}
        aborted = true;
        break;
      }

      // Expiration immédiate — même contexte Connect que la création
      await expireSession(session.id);

      console.log(
        `${label}: PASS` +
        `  livemode=${session.livemode}` +
        `  mode=${session.mode}` +
        `  currency=${session.currency}` +
        `  id=${session.id}`
      );

    } catch (err) {
      const type    = err.type    || 'unknown_type';
      const code_   = err.code    || 'unknown_code';
      const rawMsg  = String(err.message || '');
      // Fail-closed : aucun retry EUR, aucune conversion FX
      const safeMsg = rawMsg.substring(0, 200);
      console.log(`${label}: REJECTED  type=${type}  code=${code_}  message="${safeMsg}"`);
    }
  }

  console.log('');
  if (aborted) {
    console.error('Run aborted — live session detected.');
    process.exit(1);
  }
  console.log('Done.');
}

main().catch(err => {
  // Ne jamais logger err.message — peut contenir des fragments de clé
  console.error('Unexpected error:', err.type || err.name || 'Error');
  process.exit(1);
});
