'use strict';
// Rapport lecture seule : abonnements Stripe BH par statut et par plan
// Usage : STRIPE_SUBSCRIPTION_SECRET_KEY="sk_live_..." node scripts/stripe-billing-report.js

const Stripe = require('stripe');

const key = process.env.STRIPE_SUBSCRIPTION_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Fournir STRIPE_SUBSCRIPTION_SECRET_KEY ou STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2025-03-31.basil' });

// Price IDs BH (fallbacks identiques à server.js)
const PRICE_MAP = {
  'price_1T7HULFDAmyxvgFKj5pVnkbs': 'Starter mensuel',
  'price_1T7HURFDAmyxvgFKCMsOZHFP': 'Starter annuel',
  'price_1TbQ0hFDAmyxvgFKqMS4QUNV': 'Starter logement extra mensuel',
  'price_1TbQ1zFDAmyxvgFK89R0shfR': 'Starter logement extra annuel',
  'price_1TbPyvFDAmyxvgFKjIjF0EpS': 'Pro mensuel',
  'price_1T7HUnFDAmyxvgFKdfjMJiLe': 'Pro annuel',
  'price_1T7HUsFDAmyxvgFKFaAzzTht': 'Pro logement extra mensuel',
  'price_1T7HUwFDAmyxvgFKnEdRoAWh': 'Pro logement extra annuel',
  'price_1TbPzhFDAmyxvgFKhWSHzBUu': 'Agence mensuel',
  'price_1T7HToFDAmyxvgFKZtsSaEui': 'Agence annuel',
  'price_1T7HTlFDAmyxvgFKLKmRpP51': 'Agence logement extra mensuel',
  'price_1T7HTiFDAmyxvgFKWR5EwhbH': 'Agence logement extra annuel',
  'price_1TbR8cFDAmyxvgFKyJkpmWFk': 'Option SMS Starter',
  'price_1TbRBrFDAmyxvgFKqmlSIhze': 'Option SMS Pro',
  'price_1TbRCJFDAmyxvgFKrzzmBuon': 'Option SMS Agence',
  'price_1TbRgXFDAmyxvgFKYcAOyaZK': 'Droits par profil',
};

async function run() {
  const byStatus = {};
  const byPrice  = {};
  let totalSubs  = 0;
  let hasMore    = true;
  let startingAfter;

  process.stdout.write('Chargement des abonnements');
  while (hasMore) {
    const params = { limit: 100, expand: ['data.items'] };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripe.subscriptions.list(params);

    for (const sub of page.data) {
      totalSubs++;
      byStatus[sub.status] = (byStatus[sub.status] || 0) + 1;
      for (const item of sub.items.data) {
        const pid = item.price.id;
        const label = PRICE_MAP[pid] || pid;
        byPrice[label] = (byPrice[label] || 0) + 1;
      }
    }
    process.stdout.write('.');
    hasMore = page.has_more;
    if (hasMore) startingAfter = page.data[page.data.length - 1].id;
  }
  console.log(' OK\n');

  console.log('══════════════════════════════════════════════════');
  console.log('  ABONNEMENTS PAR STATUT');
  console.log('══════════════════════════════════════════════════');
  for (const [status, count] of Object.entries(byStatus).sort()) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${totalSubs}`);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  ABONNEMENTS PAR PLAN (items actifs)');
  console.log('══════════════════════════════════════════════════');
  for (const [label, count] of Object.entries(byPrice).sort()) {
    console.log(`  ${label.padEnd(40)} ${count}`);
  }
}

run().catch(e => { console.error('\nERREUR:', e.message); process.exit(1); });
