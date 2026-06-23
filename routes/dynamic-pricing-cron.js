// ============================================================
// DYNAMIC PRICING — Cron Apify
// Tourne chaque lundi à 6h00 (Europe/Paris)
// ============================================================
// Export :
//   initDynamicPricingCron(pool, sendEmail, sendPushNotification)
//
// Flux :
//   Pour chaque pricing_config active :
//     1. Scraper Apify (ou mock si APIFY_TOKEN absent)
//     2. Calculer médiane, taux d'occupation, tension
//     3. INSERT market_data (upsert)
//     4. Calculer le prix recommandé (algo 4 signaux)
//     5. INSERT pricing_history
//     6. Si mode=auto  → push Channex + notif push
//     7. Si mode=manual → notif push "Suggestion disponible"
//     8. Email récap hebdo
// ============================================================

'use strict';

const {
  calcRecommendedPrice,
  calcTensionLevel,
  tensionLabel,
  getSelfOccupancy,
} = require('./dynamic-pricing-routes');
const { applyDynamicPricingForProperty } = require('./pricing-apply');

// ── Constantes ───────────────────────────────────────────────
const APIFY_ACTOR_ID  = 'tri_angle~airbnb-scraper';
const APIFY_BASE_URL  = 'https://api.apify.com/v2';
const MAX_LISTINGS    = 100;   // concurrents max à scraper par zone
const ZONE_RADIUS_KM  = 1.5;   // rayon de recherche autour du logement
const MOCK_MODE       = !process.env.APIFY_TOKEN; // mode mock si pas de token

// ── Extrait une ZONE DE RECHERCHE exploitable (ville) depuis une adresse ──
// "18 bis rue Gambetta 91300 Massy" → "Massy, France"
function extractSearchZone(address, zoneLabel) {
  if (zoneLabel && zoneLabel.trim()) return zoneLabel.trim();
  const addr = (address || '').trim();
  if (!addr) return 'France';

  // 1) Code postal FR (5 chiffres) suivi de la ville → on prend la ville
  const m = addr.match(/\b\d{5}\b[\s,]+([A-Za-zÀ-ÿ'’.\- ]+?)(?:,|$)/);
  if (m && m[1]) {
    const city = m[1].replace(/\b(france|fr)\b/i, '').trim();
    if (city) return city + ', France';
  }

  // 2) Sinon, dernier segment après virgule (hors "France")
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    let last = parts[parts.length - 1];
    if (/^france$/i.test(last) && parts.length >= 2) last = parts[parts.length - 2];
    if (last && !/^\d/.test(last)) return last + ', France';
  }

  // 3) Dernier mot « propre » (souvent la ville si pas de virgule ni CP)
  const words = addr.split(/\s+/).filter(w => !/^\d/.test(w));
  if (words.length) return words[words.length - 1] + ', France';

  return 'France';
}

// ── Préfecture + région par département (pour élargir la recherche) ──
const DEPT_INFO = {
  '01':['Bourg-en-Bresse','Auvergne-Rhône-Alpes'],'02':['Laon','Hauts-de-France'],'03':['Moulins','Auvergne-Rhône-Alpes'],
  '04':['Digne-les-Bains',"Provence-Alpes-Côte d'Azur"],'05':['Gap',"Provence-Alpes-Côte d'Azur"],'06':['Nice',"Provence-Alpes-Côte d'Azur"],
  '07':['Privas','Auvergne-Rhône-Alpes'],'08':['Charleville-Mézières','Grand Est'],'09':['Foix','Occitanie'],
  '10':['Troyes','Grand Est'],'11':['Carcassonne','Occitanie'],'12':['Rodez','Occitanie'],'13':['Marseille',"Provence-Alpes-Côte d'Azur"],
  '14':['Caen','Normandie'],'15':['Aurillac','Auvergne-Rhône-Alpes'],'16':['Angoulême','Nouvelle-Aquitaine'],
  '17':['La Rochelle','Nouvelle-Aquitaine'],'18':['Bourges','Centre-Val de Loire'],'19':['Tulle','Nouvelle-Aquitaine'],
  '2A':['Ajaccio','Corse'],'2B':['Bastia','Corse'],'21':['Dijon','Bourgogne-Franche-Comté'],'22':['Saint-Brieuc','Bretagne'],
  '23':['Guéret','Nouvelle-Aquitaine'],'24':['Périgueux','Nouvelle-Aquitaine'],'25':['Besançon','Bourgogne-Franche-Comté'],
  '26':['Valence','Auvergne-Rhône-Alpes'],'27':['Évreux','Normandie'],'28':['Chartres','Centre-Val de Loire'],
  '29':['Quimper','Bretagne'],'30':['Nîmes','Occitanie'],'31':['Toulouse','Occitanie'],'32':['Auch','Occitanie'],
  '33':['Bordeaux','Nouvelle-Aquitaine'],'34':['Montpellier','Occitanie'],'35':['Rennes','Bretagne'],'36':['Châteauroux','Centre-Val de Loire'],
  '37':['Tours','Centre-Val de Loire'],'38':['Grenoble','Auvergne-Rhône-Alpes'],'39':['Lons-le-Saunier','Bourgogne-Franche-Comté'],
  '40':['Mont-de-Marsan','Nouvelle-Aquitaine'],'41':['Blois','Centre-Val de Loire'],'42':['Saint-Étienne','Auvergne-Rhône-Alpes'],
  '43':['Le Puy-en-Velay','Auvergne-Rhône-Alpes'],'44':['Nantes','Pays de la Loire'],'45':['Orléans','Centre-Val de Loire'],
  '46':['Cahors','Occitanie'],'47':['Agen','Nouvelle-Aquitaine'],'48':['Mende','Occitanie'],'49':['Angers','Pays de la Loire'],
  '50':['Saint-Lô','Normandie'],'51':['Châlons-en-Champagne','Grand Est'],'52':['Chaumont','Grand Est'],'53':['Laval','Pays de la Loire'],
  '54':['Nancy','Grand Est'],'55':['Bar-le-Duc','Grand Est'],'56':['Vannes','Bretagne'],'57':['Metz','Grand Est'],
  '58':['Nevers','Bourgogne-Franche-Comté'],'59':['Lille','Hauts-de-France'],'60':['Beauvais','Hauts-de-France'],
  '61':['Alençon','Normandie'],'62':['Arras','Hauts-de-France'],'63':['Clermont-Ferrand','Auvergne-Rhône-Alpes'],
  '64':['Pau','Nouvelle-Aquitaine'],'65':['Tarbes','Occitanie'],'66':['Perpignan','Occitanie'],'67':['Strasbourg','Grand Est'],
  '68':['Colmar','Grand Est'],'69':['Lyon','Auvergne-Rhône-Alpes'],'70':['Vesoul','Bourgogne-Franche-Comté'],'71':['Mâcon','Bourgogne-Franche-Comté'],
  '72':['Le Mans','Pays de la Loire'],'73':['Chambéry','Auvergne-Rhône-Alpes'],'74':['Annecy','Auvergne-Rhône-Alpes'],
  '75':['Paris','Île-de-France'],'76':['Rouen','Normandie'],'77':['Melun','Île-de-France'],'78':['Versailles','Île-de-France'],
  '79':['Niort','Nouvelle-Aquitaine'],'80':['Amiens','Hauts-de-France'],'81':['Albi','Occitanie'],'82':['Montauban','Occitanie'],
  '83':['Toulon',"Provence-Alpes-Côte d'Azur"],'84':['Avignon',"Provence-Alpes-Côte d'Azur"],'85':['La Roche-sur-Yon','Pays de la Loire'],
  '86':['Poitiers','Nouvelle-Aquitaine'],'87':['Limoges','Nouvelle-Aquitaine'],'88':['Épinal','Grand Est'],'89':['Auxerre','Bourgogne-Franche-Comté'],
  '90':['Belfort','Bourgogne-Franche-Comté'],'91':['Évry','Île-de-France'],'92':['Nanterre','Île-de-France'],'93':['Bobigny','Île-de-France'],
  '94':['Créteil','Île-de-France'],'95':['Pontoise','Île-de-France'],
  '971':['Pointe-à-Pitre','Guadeloupe'],'972':['Fort-de-France','Martinique'],'973':['Cayenne','Guyane'],
  '974':['Saint-Denis','La Réunion'],'976':['Mamoudzou','Mayotte'],
};

// Seuil de comparables jugé « suffisant » pour une médiane fiable
const MIN_COMPARABLES = 8;

// Renvoie la liste ORDONNÉE des zones à essayer : ville → préfecture → région → France
function getFallbackZones(address, zoneLabel) {
  if (zoneLabel && zoneLabel.trim()) return [zoneLabel.trim()];
  const zones = [];
  const city = extractSearchZone(address, null);
  if (city && city !== 'France') zones.push(city);

  const pcMatch = (address || '').match(/\b(\d{5})\b/);
  if (pcMatch) {
    const pc = pcMatch[1];
    let dept = pc.slice(0, 2);
    if (dept === '97' || dept === '98') dept = pc.slice(0, 3);
    if (dept === '20') dept = (parseInt(pc.slice(2,3),10) >= 2) ? '2B' : '2A'; // Corse
    const info = DEPT_INFO[dept];
    if (info) {
      const pref = info[0] + ', France';
      const reg  = info[1] + ', France';
      if (!zones.includes(pref)) zones.push(pref);
      if (!zones.includes(reg))  zones.push(reg);
    }
  }
  if (zones.length === 0) zones.push('France');
  return zones;
}

// Scrape en élargissant progressivement jusqu'à atteindre MIN_COMPARABLES.
// Retourne le meilleur résultat (zone la plus dense si aucune n'atteint le seuil).
async function scrapeBestZone(zones, medianFallback, maxListings, bedrooms) {
  let best = { listings: [], isMock: false, zoneUsed: zones[zones.length - 1] || 'France' };
  for (const zone of zones) {
    let res;
    try {
      res = await scrapeZone(zone, medianFallback, maxListings);
    } catch (e) {
      console.warn(`⚠️ [DP] Scrape "${zone}" échoué: ${e.message}`);
      continue;
    }
    const listings = res.listings || [];
    const filtered = bedrooms ? listings.filter(l => Math.abs((l.bedrooms || 1) - bedrooms) <= 1) : listings;
    const usable = filtered.length >= 5 ? filtered.length : listings.length;
    console.log(`🔎 [DP] Zone "${zone}": ${listings.length} listings (${usable} exploitables, seuil ${MIN_COMPARABLES})`);

    if (listings.length > best.listings.length) {
      best = { listings, isMock: res.isMock, zoneUsed: zone };
    }
    if (usable >= MIN_COMPARABLES) {
      return { listings, isMock: res.isMock, zoneUsed: zone };
    }
  }
  if (best.zoneUsed) console.log(`ℹ️ [DP] Aucune zone ≥ seuil — on garde la plus dense: "${best.zoneUsed}" (${best.listings.length})`);
  return best;
}

// ── Lundi de la semaine courante ─────────────────────────────
function getCurrentWeekStart() {
  const d = new Date();
  const day = d.getDay(); // 0=dim
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ── Données mockées réalistes (utilisées si APIFY_TOKEN absent) ──
function getMockListings(propertyName, medianBase) {
  const count = 40 + Math.floor(Math.random() * 30); // 40-70 concurrents
  const occ   = 40 + Math.floor(Math.random() * 45); // 40-85% occupation
  const spread = 0.3; // ±30% autour de la médiane

  return {
    listings: Array.from({ length: count }, (_, i) => ({
      price: Math.round(medianBase * (1 - spread + Math.random() * spread * 2)),
      isBooked: Math.random() * 100 < occ,
      bedrooms: 1 + Math.floor(Math.random() * 2),
      stars: 3.5 + Math.random() * 1.5,
    })),
    isMock: true,
  };
}

// ── Parser output Apify (tri_angle/airbnb-scraper) ───────────
// Structure réelle de l'actor tri_angle~airbnb-scraper :
// {
//   url, name, stars, reviewsCount,
//   price: { rate: { amount, currency } },
//   roomType, bedrooms, beds,
//   lat, lng,
//   isAvailable, bookingDates: [...]
// }
// On normalise tout en objets plats { price, isBooked, bedrooms, stars }
function parseApifyItem(item) {
  // Prix — plusieurs formats possibles selon la version de l'actor
  let price = null;
  if (typeof item.price === 'number') {
    price = item.price;
  } else if (item.price?.rate?.amount) {
    price = parseFloat(item.price.rate.amount);
  } else if (item.price?.total?.amount) {
    price = parseFloat(item.price.total.amount);
  } else if (item.pricing?.rate) {
    price = parseFloat(item.pricing.rate);
  } else if (item.nightly_price) {
    price = parseFloat(item.nightly_price);
  }

  if (!price || price <= 0) return null;

  // Disponibilité — true = logement libre (non réservé)
  const isBooked = item.isAvailable === false
    || item.available === false
    || (item.bookingDates && item.bookingDates.length > 20); // heuristique

  return {
    price,
    isBooked,
    bedrooms: parseInt(item.bedrooms || item.bedroomsCount || 1),
    stars: parseFloat(item.stars || item.rating || 0),
  };
}

// ── Calcul des stats de marché depuis une liste de logements ─
function calcMarketStats(listings) {
  const prices = listings
    .map(l => l.price)
    .filter(p => p > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const median = prices[Math.floor(prices.length / 2)];
  const p25    = prices[Math.floor(prices.length * 0.25)];
  const p75    = prices[Math.floor(prices.length * 0.75)];

  const bookedCount  = listings.filter(l => l.isBooked).length;
  const occupancy    = Math.round((bookedCount / listings.length) * 100);
  const tensionLevel = calcTensionLevel(occupancy);

  return { median, p25, p75, occupancy, tensionLevel, count: listings.length };
}

// ── Appel Apify ──────────────────────────────────────────────
async function scrapeWithApify(location, maxListings) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN non défini');

  console.log(`🔍 [DP-CRON] Apify scraping: "${location}" max=${maxListings}`);

  // 1. Démarrer le run
  const startRes = await fetch(
    `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationQueries: [location],
        currency:        'EUR',
        locale:          'fr-FR',
        maxListings,
        enrichUserProfiles: false,
        startUrls: [],
      }),
    }
  );

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Apify start failed: ${startRes.status} — ${err}`);
  }

  const { data: runData } = await startRes.json();
  const runId      = runData.id;
  const datasetId  = runData.defaultDatasetId;
  console.log(`✅ [DP-CRON] Run démarré: ${runId} (dataset: ${datasetId})`);

  // 2. Attendre la fin du run (polling toutes les 10s, max 10 min)
  const maxWait = 60; // 60 × 10s = 10 min
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 10_000));

    const statusRes = await fetch(
      `${APIFY_BASE_URL}/actor-runs/${runId}?token=${token}`
    );
    const { data: status } = await statusRes.json();

    console.log(`⏳ [DP-CRON] Run status: ${status.status} (${i + 1}/${maxWait})`);

    if (status.status === 'SUCCEEDED') break;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status.status)) {
      throw new Error(`Run Apify terminé en erreur: ${status.status}`);
    }
  }

  // 3. Récupérer les résultats
  const itemsRes = await fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${token}&format=json&limit=${maxListings}`
  );

  if (!itemsRes.ok) throw new Error(`Apify dataset fetch failed: ${itemsRes.status}`);

  const items = await itemsRes.json();
  console.log(`📦 [DP-CRON] ${items.length} logements récupérés depuis Apify`);

  return items.map(parseApifyItem).filter(Boolean);
}

// ── Scraping avec fallback mock ──────────────────────────────
async function scrapeZone(location, medianFallback, maxListings) {
  if (MOCK_MODE) {
    console.log(`🎭 [DP-CRON] Mode MOCK pour "${location}" (APIFY_TOKEN absent)`);
    const mock = getMockListings(location, medianFallback);
    return { listings: mock.listings, isMock: true };
  }

  try {
    const listings = await scrapeWithApify(location, maxListings);
    return { listings, isMock: false };
  } catch (err) {
    console.error(`❌ [DP-CRON] Apify error pour "${location}":`, err.message);
    console.log(`🎭 [DP-CRON] Fallback mock pour "${location}"`);
    const mock = getMockListings(location, medianFallback);
    return { listings: mock.listings, isMock: true };
  }
}

// ── Notification push ────────────────────────────────────────
async function sendPricingPush(pool, userId, propertyName, message, type) {
  try {
    // Récupérer les tokens FCM de l'user
    const tokens = await pool.query(
      `SELECT fcm_token FROM user_devices WHERE user_id = $1 AND fcm_token IS NOT NULL`,
      [userId]
    );
    if (tokens.rows.length === 0) return;

    // On utilise le même pattern que les autres notifs push dans server.js
    // sendPushNotification est injecté depuis server.js
    console.log(`📱 [DP-CRON] Push → ${propertyName}: ${message}`);
  } catch (err) {
    console.error('❌ [DP-CRON] Push error:', err.message);
  }
}

// ── Job principal ────────────────────────────────────────────
async function runDynamicPricingJob(pool, sendEmail, sendPushNotification) {
  const weekStart = getCurrentWeekStart();
  console.log(`\n🚀 [DP-CRON] === Démarrage job pricing dynamique — semaine du ${weekStart} ===`);

  // 1. Toutes les configs actives
  let configs;
  try {
    const result = await pool.query(
      `SELECT pc.*,
              p.name    AS property_name,
              p.address AS property_address,
              u.email   AS user_email,
              u.first_name AS user_first_name
       FROM pricing_config pc
       JOIN users       u ON u.id = pc.user_id
       JOIN properties  p ON p.id = pc.property_id
       WHERE pc.is_active = TRUE
       ORDER BY pc.user_id, pc.created_at`
    );
    configs = result.rows;
  } catch (err) {
    console.error('❌ [DP-CRON] Impossible de charger les configs:', err.message);
    return;
  }

  if (configs.length === 0) {
    console.log('ℹ️ [DP-CRON] Aucune config active — rien à faire');
    return;
  }

  console.log(`📋 [DP-CRON] ${configs.length} logement(s) à traiter`);

  // Cache zones déjà scrapées (évite de scraper 2× la même ville)
  const zoneCache = {};
  const results   = [];

  for (const cfg of configs) {
    try {
      console.log(`\n🏠 [DP-CRON] Traitement: ${cfg.property_name} (${cfg.property_id})`);

      // 2. Zones de recherche ordonnées (ville → préfecture → région)
      const zones = getFallbackZones(cfg.property_address, cfg.zone_label);
      const cacheKey = zones.join('|');

      // 3. Scraping avec élargissement progressif (cache par jeu de zones)
      if (!zoneCache[cacheKey]) {
        zoneCache[cacheKey] = await scrapeBestZone(
          zones,
          (parseFloat(cfg.price_min) + parseFloat(cfg.price_max)) / 2,
          MAX_LISTINGS,
          cfg.bedrooms
        );
      }

      const { listings, isMock, zoneUsed } = zoneCache[cacheKey];
      const zoneLabel = zoneUsed;

      // Filtrer par nombre de chambres si renseigné
      const filtered = cfg.bedrooms
        ? listings.filter(l => Math.abs((l.bedrooms || 1) - cfg.bedrooms) <= 1)
        : listings;

      const marketStats = calcMarketStats(filtered.length >= 5 ? filtered : listings);
      if (!marketStats) {
        console.warn(`⚠️ [DP-CRON] Pas assez de données pour ${cfg.property_name}`);
        continue;
      }

      // 4. INSERT market_data (upsert)
      await pool.query(
        `INSERT INTO market_data (
           user_id, property_id, week_start,
           median_price, price_p25, price_p75,
           occupancy_rate, comparable_count, tension_level,
           zone_label, scraped_at, created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
         ON CONFLICT (property_id, week_start) DO UPDATE SET
           median_price     = EXCLUDED.median_price,
           price_p25        = EXCLUDED.price_p25,
           price_p75        = EXCLUDED.price_p75,
           occupancy_rate   = EXCLUDED.occupancy_rate,
           comparable_count = EXCLUDED.comparable_count,
           tension_level    = EXCLUDED.tension_level,
           zone_label       = EXCLUDED.zone_label,
           scraped_at       = NOW()`,
        [
          cfg.user_id, cfg.property_id, weekStart,
          marketStats.median, marketStats.p25, marketStats.p75,
          marketStats.occupancy, marketStats.count, marketStats.tensionLevel,
          zoneLabel,
        ]
      );

      console.log(`✅ [DP-CRON] market_data inséré: médiane=${marketStats.median}€ occ=${marketStats.occupancy}% tension=${marketStats.tensionLevel}`);

      // 5-8. Moteur per-night : calcul, stockage planning, push Channex, notif
      const apply = await applyDynamicPricingForProperty(pool, {
        cfg, marketStats, isMock, sendPushNotification,
      });

      results.push({
        userId:       cfg.user_id,
        userEmail:    cfg.user_email,
        firstName:    cfg.user_first_name,
        propertyId:   cfg.property_id,
        propertyName: cfg.property_name,
        status:       apply.status,
        priceBefore:  apply.priceBefore,
        priceApplied: apply.priceApplied,
        priceCalculated: apply.priceCalculated,
        tensionLevel: marketStats.tensionLevel,
        nights:       apply.nights,
        isMock,
      });

    } catch (err) {
      console.error(`❌ [DP-CRON] Erreur sur ${cfg.property_name}:`, err.message);
      results.push({
        userId:       cfg.user_id,
        propertyName: cfg.property_name,
        status: 'error',
        error:  err.message,
      });
    }
  }

  // 9. Email récap par user
  const userIds = [...new Set(results.map(r => r.userId).filter(Boolean))];
  for (const userId of userIds) {
    const userResults = results.filter(r => r.userId === userId && r.status !== 'error');
    if (!userResults.length) continue;

    const user = configs.find(c => c.user_id === userId);
    if (!user?.notify_email || !user?.user_email) continue;

    try {
      const weekLabel = new Date(weekStart).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

      // Récupérer l'historique de la semaine pour l'email
      const histResult = await pool.query(
        `SELECT ph.*, p.name AS property_name
         FROM pricing_history ph
         LEFT JOIN properties p ON p.id = ph.property_id
         WHERE ph.user_id = $1 AND ph.week_start = $2
         ORDER BY ph.created_at ASC`,
        [userId, weekStart]
      );

      if (histResult.rows.length === 0) continue;

      const { buildWeeklyEmailHtml } = require('./dynamic-pricing-routes');
      const html = buildWeeklyEmailHtml(user.user_first_name || 'Bonjour', histResult.rows, weekLabel);

      await sendEmail({
        from: '"Boostinghost" <noreply@boostinghost.fr>',
        to: user.user_email,
        subject: `📊 Votre marché cette semaine — ${histResult.rows.length} logement${histResult.rows.length > 1 ? 's' : ''}`,
        html,
      });

      console.log(`📧 [DP-CRON] Email récap envoyé à ${user.user_email}`);
    } catch (emailErr) {
      console.error(`❌ [DP-CRON] Email error for ${user.user_email}:`, emailErr.message);
    }
  }

  const applied = results.filter(r => r.status === 'applied').length;
  const pending = results.filter(r => r.status === 'pending').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors  = results.filter(r => r.status === 'error').length;
  const mocks   = results.filter(r => r.isMock).length;

  console.log(`\n✅ [DP-CRON] === Job terminé ===`);
  console.log(`   Appliqués : ${applied} | En attente : ${pending} | Stables : ${skipped} | Erreurs : ${errors}`);
  if (mocks > 0) console.log(`   ⚠️  ${mocks} logement(s) en mode MOCK (données simulées)`);
  console.log(`   Semaine : ${weekStart}\n`);

  return results;
}

// ── Refresh QUOTIDIEN : recalcul + push SANS scrape (réutilise le dernier market_data) ──
async function runDailyPricingRefresh(pool, sendPushNotification = null) {
  console.log('\n🔄 [DP-CRON] === Refresh quotidien des prix (sans scrape marché) ===');
  let configs;
  try {
    configs = (await pool.query(
      `SELECT pc.*, p.name AS property_name
         FROM pricing_config pc
         JOIN properties p ON p.id = pc.property_id
        WHERE pc.is_active = TRUE
        ORDER BY pc.user_id, pc.created_at`
    )).rows;
  } catch (err) {
    console.error('❌ [DP-CRON] Configs (refresh quotidien):', err.message);
    return;
  }
  if (configs.length === 0) { console.log('ℹ️ [DP-CRON] Aucune config active — rien à faire'); return; }

  let done = 0, pushed = 0;
  for (const cfg of configs) {
    try {
      const md = (await pool.query(
        `SELECT median_price, occupancy_rate, tension_level
           FROM market_data WHERE property_id = $1 ORDER BY week_start DESC LIMIT 1`,
        [cfg.property_id]
      )).rows[0] || {};
      const marketStats = { median: md.median_price, occupancy: md.occupancy_rate, tensionLevel: md.tension_level };
      const apply = await applyDynamicPricingForProperty(pool, {
        cfg, marketStats, isMock: false, sendPushNotification,
      });
      done++;
      if (apply.status === 'applied') pushed += (apply.pushed || 0);
    } catch (e) {
      console.error(`⚠️ [DP-CRON] refresh ${cfg.property_name}:`, e.message);
    }
  }
  console.log(`✅ [DP-CRON] Refresh quotidien terminé — ${done} logements, ${pushed} nuits poussées sur Channex`);
  return { done, pushed };
}

// ── Init (appelée depuis server.js) ─────────────────────────
function initDynamicPricingCron(pool, sendEmail, sendPushNotification) {
  const cron = require('node-cron');

  // Cron principal : chaque lundi à 6h00
  cron.schedule('0 6 * * 1', async () => {
    console.log('\n⏰ [DP-CRON] Déclenchement automatique (lundi 6h00)');
    await runDynamicPricingJob(pool, sendEmail, sendPushNotification);
  }, {
    timezone: 'Europe/Paris',
  });

  // Refresh quotidien (mardi → dimanche, 6h00) : recalcul + push, sans scrape, silencieux
  cron.schedule('0 6 * * 2,3,4,5,6,0', async () => {
    console.log('\n⏰ [DP-CRON] Refresh quotidien (6h00)');
    await runDailyPricingRefresh(pool);
  }, {
    timezone: 'Europe/Paris',
  });

  if (MOCK_MODE) {
    console.log('⚠️  [DP-CRON] Mode MOCK actif — APIFY_TOKEN non défini');
    console.log('   → Données simulées utilisées lors du scraping');
    console.log('   → Ajoutez APIFY_TOKEN dans les env vars Render pour activer le mode live');
  } else {
    console.log('✅ [DP-CRON] Mode LIVE actif — Apify activé');
  }

  console.log('✅ [DP-CRON] Crons initialisés — Hebdo lundi 6h (scrape+recalcul) + Quotidien mar→dim 6h (recalcul+push) — Europe/Paris');
}

// ============================================================
// 🎯 ANALYSE À LA DEMANDE — UN SEUL LOGEMENT
// Utilisé quand on active un nouveau logement : scrape ciblé +
// market_data immédiat, sans attendre le cron du lundi.
// ============================================================
async function runDynamicPricingForOneProperty(pool, { userId, propertyId, sendPushNotification = null, force = false }) {
  const weekStart = getCurrentWeekStart();

  const cfg = (await pool.query(
    `SELECT pc.*, p.name AS property_name, p.address AS property_address
       FROM pricing_config pc
       JOIN properties p ON p.id = pc.property_id
      WHERE pc.user_id = $1 AND pc.property_id = $2`,
    [userId, propertyId]
  )).rows[0];

  if (!cfg) return { ok: false, error: 'Config pricing introuvable pour ce logement' };

  // Évite de re-scraper si l'analyse de la semaine existe déjà (sauf force)
  if (!force) {
    const existing = await pool.query(
      `SELECT 1 FROM market_data WHERE property_id = $1 AND week_start = $2 LIMIT 1`,
      [propertyId, weekStart]
    );
    if (existing.rows.length > 0) {
      return { ok: true, skipped: true, reason: 'Analyse marché déjà présente cette semaine' };
    }
  }

  const zones = getFallbackZones(cfg.property_address, cfg.zone_label);
  console.log(`🎯 [DP-ONE] Analyse à la demande: ${cfg.property_name} (${propertyId}) — zones: ${zones.join(' → ')}`);

  const { listings, isMock, zoneUsed } = await scrapeBestZone(
    zones,
    (parseFloat(cfg.price_min) + parseFloat(cfg.price_max)) / 2,
    MAX_LISTINGS,
    cfg.bedrooms
  );
  const zoneLabel = zoneUsed;

  const filtered = cfg.bedrooms
    ? listings.filter(l => Math.abs((l.bedrooms || 1) - cfg.bedrooms) <= 1)
    : listings;

  const marketStats = calcMarketStats(filtered.length >= 5 ? filtered : listings);
  if (!marketStats) return { ok: false, error: 'Pas assez de données marché pour ce logement' };

  await pool.query(
    `INSERT INTO market_data (
       user_id, property_id, week_start,
       median_price, price_p25, price_p75,
       occupancy_rate, comparable_count, tension_level,
       zone_label, scraped_at, created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
     ON CONFLICT (property_id, week_start) DO UPDATE SET
       median_price     = EXCLUDED.median_price,
       price_p25        = EXCLUDED.price_p25,
       price_p75        = EXCLUDED.price_p75,
       occupancy_rate   = EXCLUDED.occupancy_rate,
       comparable_count = EXCLUDED.comparable_count,
       tension_level    = EXCLUDED.tension_level,
       zone_label       = EXCLUDED.zone_label,
       scraped_at       = NOW()`,
    [
      cfg.user_id, cfg.property_id, weekStart,
      marketStats.median, marketStats.p25, marketStats.p75,
      marketStats.occupancy, marketStats.count, marketStats.tensionLevel,
      zoneLabel,
    ]
  );

  console.log(`✅ [DP-ONE] market_data: médiane=${marketStats.median}€ occ=${marketStats.occupancy}% tension=${marketStats.tensionLevel}`);

  const apply = await applyDynamicPricingForProperty(pool, {
    cfg, marketStats, isMock, sendPushNotification,
  });

  return { ok: true, isMock, marketStats, apply };
}

module.exports = { initDynamicPricingCron, runDynamicPricingJob, runDailyPricingRefresh, runDynamicPricingForOneProperty };
