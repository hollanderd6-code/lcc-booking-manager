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
const { resolveMarketData } = require('./market-data-resolver');
const { computeMarketContextKey } = require('./market-context-key');
const marketProvider = require('../services/market-provider');
const { selectComparables, calcBrightDataMarketStats } = require('../services/brightdata-comparable-filter');
const { hasValidCoordinates } = require('../services/market-geo-validator');
const { hasBoostPriceEntitlement } = require('../services/boostprice-entitlement');

// P15/P16: Shadow market observation collection — lazy require to avoid circular deps at startup
// Both flags default to OFF. Import is deferred so the module is only loaded when flags are live.
let _shadowCoordinator = null;
function _getShadowCoordinator() {
  if (!_shadowCoordinator) {
    _shadowCoordinator = require('../services/market-shared-collection-coordinator');
  }
  return _shadowCoordinator;
}

// R: Persistence bridge — lazy require; flag defaults to OFF (0 BD credits until enabled)
let _persistenceBridge = null;
function _getBridge() {
  if (!_persistenceBridge) {
    _persistenceBridge = require('../services/market-observation-persistence-bridge');
  }
  return _persistenceBridge;
}

// ── Constantes ───────────────────────────────────────────────
const APIFY_ACTOR_ID  = 'tri_angle~airbnb-scraper';
const APIFY_BASE_URL  = 'https://api.apify.com/v2';
const MAX_LISTINGS    = 100;   // concurrents max à scraper par zone
const ZONE_RADIUS_KM  = 1.5;   // rayon de recherche autour du logement
const MOCK_MODE       = !process.env.APIFY_TOKEN; // mode mock si pas de token
// MARKET_REQUEST_CURRENCY supprimé en B4-C — chaque propriété utilise sa propre devise

const DP_DAILY_JOB_ADVISORY_LOCK_KEY = 7684392; // unique pg advisory lock for BoostPrice daily cron job

// Normalise une valeur en code devise ISO 4217 à 3 lettres majuscules, ou null.
function normalizeMarketCurrency(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

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
// B5-G: propertyId enables allowlist routing and limits BD to first zone only
//        (BD's selectComparables radius expansion already handles wider areas).
// budgetOpts: { canAttemptProvider, consumeProviderAttempt } — forwarded to marketProvider.scrape()
async function scrapeBestZone(zones, medianFallback, maxListings, bedrooms, requestedCurrency, propertyId, budgetOpts = {}) {
  const provider = (propertyId != null)
    ? marketProvider.resolveProviderForProperty(propertyId)
    : marketProvider.resolveProvider();

  // BD handles geographic radius expansion via selectComparables — only try the most-specific zone.
  // Iterating fallback zones for BD would trigger up to N separate paid API calls.
  const zonesToTry = (provider === 'brightdata') ? zones.slice(0, 1) : zones;

  let best = { listings: [], isMock: true, dataSource: 'mock', zoneUsed: zonesToTry[zonesToTry.length - 1] || 'France', diagnostics: null, providerAttempts: 0 };
  for (const zone of zonesToTry) {
    let res;
    try {
      res = await scrapeZone(zone, medianFallback, maxListings, requestedCurrency, propertyId, budgetOpts);
    } catch (e) {
      console.warn(`⚠️ [DP] Scrape "${zone}" échoué: ${e.message}`);
      continue;
    }
    const listings = res.listings || [];
    // B5-D: bedrooms:null (Bright Data) must not be rejected — keep listing when bedrooms unknown.
    const filtered = bedrooms
      ? listings.filter(l => l.bedrooms == null || Math.abs(l.bedrooms - bedrooms) <= 1)
      : listings;
    const usable = filtered.length >= 5 ? filtered.length : listings.length;
    console.log(`🔎 [DP] Zone "${zone}": ${listings.length} listings (${usable} exploitables, seuil ${MIN_COMPARABLES}, source: ${res.dataSource})`);

    if (listings.length > best.listings.length) {
      best = { listings, isMock: res.isMock, dataSource: res.dataSource, zoneUsed: zone, diagnostics: res.diagnostics, providerAttempts: res.providerAttempts ?? 1 };
    }
    if (usable >= MIN_COMPARABLES) {
      return { listings, isMock: res.isMock, dataSource: res.dataSource, zoneUsed: zone, diagnostics: res.diagnostics, providerAttempts: res.providerAttempts ?? 1 };
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

// ── Today's date in Europe/Paris timezone (YYYY-MM-DD) ───────
function getCurrentParisDayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
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
async function scrapeWithApify(location, maxListings, requestedCurrency) {
  if (!requestedCurrency) throw new Error('requestedCurrency requis — aucun fallback EUR autorisé');
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN non défini');

  console.log(`🔍 [DP-CRON] Apify scraping: "${location}" max=${maxListings} currency=${requestedCurrency}`);

  // 1. Démarrer le run
  const startRes = await fetch(
    `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationQueries: [location],
        currency:        requestedCurrency,
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

// ── Scraping via market provider abstraction (B5-D/G) ────────
// Provider selection, Bright Data ↔ Apify fallback, and mock fallback are
// all handled inside marketProvider.scrape(). scrapeWithApify remains
// available as a legacy reference (source-analysis tests require it).
async function scrapeZone(location, medianFallback, maxListings, requestedCurrency, propertyId, budgetOpts = {}) {
  const result = await marketProvider.scrape(location, maxListings, requestedCurrency, {
    medianFallback,
    propertyId,
    canAttemptProvider:     budgetOpts.canAttemptProvider,
    consumeProviderAttempt: budgetOpts.consumeProviderAttempt,
  });
  return {
    listings:         result.listings,
    isMock:           result.isMock,
    dataSource:       result.dataSource,
    provider:         result.provider,
    diagnostics:      result.diagnostics,
    providerAttempts: result.providerAttempts ?? 1,
  };
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

// ── B5-G quality gate for BD stats before market_data write ──
// Returns true only when all numeric stats are structurally sound.
// A failing gate returns null from calcProviderMarketStats → property is skipped this week.
function validateBDStats(stats) {
  if (!stats) return false;
  if (!Number.isFinite(stats.median)    || stats.median    <= 0) return false;
  if (!Number.isFinite(stats.p25)       || stats.p25       <= 0) return false;
  if (!Number.isFinite(stats.p75)       || stats.p75       <= 0) return false;
  if (stats.p25 > stats.median || stats.median > stats.p75)      return false;
  if (!Number.isFinite(stats.occupancy) || stats.occupancy < 0 || stats.occupancy > 100) return false;
  return true;
}

// ── Provider-aware market stats (B5-F1/G) ────────────────────
// Dispatches to calcBrightDataMarketStats+selectComparables for brightdata_live,
// or to the shared bedroom-filtered calcMarketStats for all other providers.
// B5-G quality gate: insufficient_comparables or invalid stats → null (fail closed, no DB write).
function calcProviderMarketStats(listings, cfg, dataSource) {
  if (dataSource === 'brightdata_live') {
    const tLat = cfg.latitude   != null ? parseFloat(cfg.latitude)   : null;
    const tLon = cfg.longitude  != null ? parseFloat(cfg.longitude)  : null;
    const tG   = cfg.max_guests != null ? parseInt(cfg.max_guests, 10) : null;
    const selResult = selectComparables(listings, { targetLat: tLat, targetLon: tLon, targetGuests: tG });
    // Quality gate 1: comparable selection must succeed
    if (selResult.status !== 'ok') {
      console.warn(`⚠️ [BD-QUALITY] selectComparables status=${selResult.status} comparableCount=${selResult.listings?.length ?? 0} — skip write`);
      return null;
    }
    const today = (cfg.timezone
      ? new Date().toLocaleString('sv-SE', { timeZone: cfg.timezone })
      : new Date().toISOString()).slice(0, 10);
    const stats = calcBrightDataMarketStats(selResult.listings, { today });
    // Quality gate 2: stats must be structurally valid before write
    if (!validateBDStats(stats)) {
      console.warn(`⚠️ [BD-QUALITY] stats invalides (median=${stats?.median} p25=${stats?.p25} p75=${stats?.p75} occ=${stats?.occupancy}) — skip write`);
      return null;
    }
    // Attach selection diagnostics for observability (not written to DB)
    stats._bdSelectionDiag = {
      selectedRadiusKm: selResult.selectedRadiusKm,
      comparableCount:  selResult.listings.length,
      selectionStatus:  selResult.status,
    };
    return stats;
  }
  const f = cfg.bedrooms
    ? listings.filter(l => l.bedrooms == null || Math.abs(l.bedrooms - cfg.bedrooms) <= 1)
    : listings;
  return calcMarketStats(f.length >= 5 ? f : listings);
}

// ── P15: Shadow collection phase ─────────────────────────────
// Runs AFTER the production market_data loop completes.
// Groups properties by market profile, calls the coordinator once per profile.
// MARKET_DATA_WRITES = 0  PRICING_WRITES = 0  CHANNEX_CALLS = 0
async function _runShadowCollectionPhase(pool, configs) {
  const { coordinateCollection, generateCollectionRunId } = _getShadowCoordinator();
  const { getBrightDataMarketDates } = marketProvider;
  const { checkIn, checkOut } = getBrightDataMarketDates();
  const collectionRunId = generateCollectionRunId();
  const { buildMarketProfileIdentity } = require('../services/market-search-identity');

  // Group properties by market profile (shared geo bucket + currency + capacity)
  const profileGroups = new Map(); // profileId → { cfg, propertyLinks }[]
  for (const cfg of configs) {
    if (!hasValidCoordinates(cfg.latitude, cfg.longitude) || !cfg.currency) continue;
    const identity = buildMarketProfileIdentity({
      latitude:          cfg.latitude,
      longitude:         cfg.longitude,
      currency:          cfg.currency,
      targetGuests:      cfg.max_guests    ?? null,
      targetBedrooms:    cfg.bedrooms      ?? null,
      targetPropertyType:cfg.property_type ?? null,
    });
    if (!identity.valid) continue;
    const key = identity.profileId;
    if (!profileGroups.has(key)) profileGroups.set(key, { cfg, propertyLinks: [] });
    profileGroups.get(key).propertyLinks.push({
      property_id: String(cfg.property_id),
      user_id:     cfg.user_id ? String(cfg.user_id) : null,
    });
  }

  console.log(`[P-SHADOW] ${profileGroups.size} profil(s) marché — shadow collection`);

  for (const [, { cfg, propertyLinks }] of profileGroups) {
    try {
      const zones    = getFallbackZones(cfg.property_address, cfg.zone_label);
      const location = zones[0] || 'France';

      const result = await coordinateCollection(pool, {
        cfg,
        location,
        checkIn,
        checkOut,
        collectionRunId,
        maxListings: 100,
        propertyLinks,
      });

      if (result.ok && !result.reused && !result.skipped) {
        console.log(`[P-SHADOW] wrote profileId=${cfg.latitude?.toString().slice(0,6)}… status=${result.market_status}`);
      }
    } catch (err) {
      console.error(`[P-SHADOW] erreur profil property=${cfg.property_id}:`, err.message);
    }
  }
}

// ── Job principal ────────────────────────────────────────────
async function runDynamicPricingJob(pool, sendEmail, sendPushNotification, opts = {}) {
  const weekStart = getCurrentWeekStart();
  const todayParis = getCurrentParisDayISO();
  console.log(`\n🚀 [DP-CRON] === Démarrage job pricing dynamique — semaine du ${weekStart} ===`);

  // Advisory lock: dedicated connection — pg session-scoped lock and unlock must use the same conn.
  // pool.query() may borrow any connection; pool.connect() holds one for the duration.
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const _lockRes = await lockClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [DP_DAILY_JOB_ADVISORY_LOCK_KEY]);
    lockAcquired = _lockRes.rows[0].acquired;
    if (!lockAcquired) {
      console.log('[DP-CRON] BOOSTPRICE_DAILY_JOB_ALREADY_RUNNING — advisory lock held, skip');
      return;
    }
    // Persisted daily deduplication: one full collection per Europe/Paris calendar day (survives restart)
    const _dedupe = await pool.query(
      `INSERT INTO dp_daily_collection_run (run_date, job_status) VALUES ($1::date, 'running')
       ON CONFLICT (run_date) DO UPDATE
         SET started_at = NOW(), job_status = 'running'
         WHERE dp_daily_collection_run.job_status != 'completed'
       RETURNING run_date`,
      [todayParis]
    );
    if (_dedupe.rowCount === 0) {
      console.log(`[DP-CRON] Daily job already completed for ${todayParis} (Europe/Paris) — skip`);
      return;
    }

  // 1. Toutes les configs actives
  let configs;
  try {
    const result = await pool.query(
      `SELECT pc.*,
              p.name    AS property_name,
              p.address AS property_address,
              p.latitude, p.longitude, p.country_code, p.currency,
              p.max_guests, p.timezone,
              u.email   AS user_email,
              u.first_name AS user_first_name
       FROM pricing_config pc
       JOIN properties  p ON p.id = pc.property_id AND p.user_id = pc.user_id
       JOIN users       u ON u.id = pc.user_id
       WHERE pc.is_active = TRUE
         AND EXISTS (
           SELECT 1 FROM boostprice_property_entitlements bpe
           WHERE bpe.property_id = pc.property_id
             AND bpe.user_id     = pc.user_id
             AND bpe.status      = 'active'
         )
         AND EXISTS (
           SELECT 1 FROM subscriptions s
           WHERE s.user_id = pc.user_id
             AND (
               s.status IN ('active', 'trialing')
               OR (s.status = 'trial' AND s.trial_end_date > NOW())
             )
         )
       ORDER BY pc.created_at`
    );
    configs = result.rows;
  } catch (err) {
    console.error('❌ [DP-CRON] Impossible de charger les configs:', err.message);
    return;
  }

  const requestedPropertyIds = Array.isArray(opts.propertyIds)
    ? opts.propertyIds.map(String)
    : [];
  if (requestedPropertyIds.length > 0) {
    const before  = configs.length;
    const allowed = new Set(requestedPropertyIds);
    configs = configs.filter(cfg => allowed.has(String(cfg.property_id)));
    console.log(`[DP-CRON] propertyIds filter: ${requestedPropertyIds.length} requested, ${configs.length}/${before} retained`);
  }

  if (configs.length === 0) {
    console.log('ℹ️ [DP-CRON] Aucune config active — rien à faire');
    return;
  }

  console.log(`📋 [DP-CRON] ${configs.length} logement(s) à traiter`);

  // R: Persistence bridge — capture run ID and stay dates once for the whole job
  // BRIGHT_DATA_CALLS = 0  MARKET_DATA_WRITES = 0  PRICING_WRITES = 0
  const _br = _getBridge();
  const bridgePersistenceEnabled = _br.isPersistenceEnabled();
  let bridgeRunId   = null;
  let bridgeCheckIn  = null;
  let bridgeCheckOut = null;
  if (bridgePersistenceEnabled) {
    bridgeRunId   = _br.generateBridgeRunId();
    const dates   = marketProvider.getBrightDataMarketDates();
    bridgeCheckIn  = dates.checkIn;
    bridgeCheckOut = dates.checkOut;
  }

  // S: Shared production collection flag (MARKET_SHARED_COLLECTION_ENABLED)
  const sharedEnabled = _getShadowCoordinator().isSharedProductionEnabled();

  // S3/S10: Pre-collect grouped evidence before property loop (one call per fingerprint)
  let sharedEvidence    = null; // Map<fingerprint, scrapeResult | { error }>
  let propToFingerprint = null; // Map<property_id, fingerprint>
  const maxProviderCalls = parseInt(process.env.MARKET_MAX_DAILY_PROVIDER_CALLS || '10', 10);
  let providerCallsThisRun = 0;

  if (sharedEnabled) {
    const sharedDates = marketProvider.getBrightDataMarketDates();
    const preResult = await _getShadowCoordinator().runSharedPreCollection(configs, {
      checkIn:                sharedDates.checkIn,
      checkOut:               sharedDates.checkOut,
      resolveProvider:        marketProvider.resolveProviderForProperty,
      scrapeFn:               scrapeBestZone,
      getFallbackZonesFn:     getFallbackZones,
      priceFallbackFn:        cfg => (parseFloat(cfg.price_min) + parseFloat(cfg.price_max)) / 2,
      maxListings:            MAX_LISTINGS,
      // FIX 4: same hard budget covers shared + legacy paths; callbacks update providerCallsThisRun
      canAttemptProvider:     () => providerCallsThisRun < maxProviderCalls,
      consumeProviderAttempt: () => { providerCallsThisRun++; },
    });
    sharedEvidence    = preResult.sharedEvidence;
    propToFingerprint = preResult.propToFingerprint;
    // providerCallsThisRun already updated via consumeProviderAttempt callbacks
    console.log(`[MARKET_SHARED_COLLECTION] pre-collection done groups=${preResult.groupCount} calls=${preResult.callCount}`);
  }

  // Cache zones déjà scrapées — used only in legacy path (sharedEnabled=false)
  const zoneCache = {};
  const results   = [];

  for (const cfg of configs) {
    try {
      console.log(`\n🏠 [DP-CRON] Traitement: ${cfg.property_name} (${cfg.property_id})`);

      // 2. Zones de recherche ordonnées (ville → préfecture → région)
      const zones = getFallbackZones(cfg.property_address, cfg.zone_label);

      // Snapshot T0 : capturer avant le scrape — la clé et la devise doivent refléter
      // l'état de la propriété au moment du scrape, pas après une éventuelle mise à jour.
      const marketContextKey = computeMarketContextKey({
        countryCode: cfg.country_code,
        latitude:  cfg.latitude  != null ? parseFloat(cfg.latitude)  : null,
        longitude: cfg.longitude != null ? parseFloat(cfg.longitude) : null,
      });
      const capturedPropertyCurrency = normalizeMarketCurrency(cfg.currency);

      // Unknown currency → skip market scrape entirely; BoostPrice still runs
      if (!capturedPropertyCurrency) {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: devise inconnue — scrape marché ignoré, BoostPrice sans signal marché`);
        const apply = await applyDynamicPricingForProperty(pool, {
          cfg, marketStats: null, isMock: false, marketOverride: null,
          sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
          suppressExternalPush: opts.suppressExternalPush === true,
        });
        results.push({
          userId:          cfg.user_id,
          userEmail:       cfg.user_email,
          firstName:       cfg.user_first_name,
          propertyId:      cfg.property_id,
          propertyName:    cfg.property_name,
          status:          apply.status,
          priceBefore:     apply.priceBefore,
          priceApplied:    apply.priceApplied,
          priceCalculated: apply.priceCalculated,
          tensionLevel:    null,
          nights:          apply.nights,
          isMock:          false,
        });
        continue;
      }

      // 3. Provider evidence: shared production (S active) or per-property zone cache (legacy)
      let listings, isMock, zoneUsed, dataSource, diagnostics;

      if (sharedEnabled) {
        // S3/S10: reuse pre-collected group evidence — no per-property provider call
        const pid = String(cfg.property_id);
        const fp  = propToFingerprint?.get(pid);
        if (!fp) {
          // S11: profile incomplete (Ti Junot) — excluded from shared collection
          console.log(`[MARKET_PROVIDER_CALL_SKIP] prop=${pid} reason=profile_incomplete shared=true`);
          const apply = await applyDynamicPricingForProperty(pool, {
            cfg, marketStats: null, isMock: false, marketOverride: null,
            sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
            suppressExternalPush: opts.suppressExternalPush === true,
          });
          results.push({
            userId: cfg.user_id, userEmail: cfg.user_email, firstName: cfg.user_first_name,
            propertyId: cfg.property_id, propertyName: cfg.property_name,
            status: apply.status, priceBefore: apply.priceBefore, priceApplied: apply.priceApplied,
            priceCalculated: apply.priceCalculated, tensionLevel: null, nights: apply.nights, isMock: false,
          });
          continue;
        }
        const ev = sharedEvidence?.get(fp);
        if (!ev || ev.error) {
          // S12: provider failure — no per-property fallback call
          console.log(`[MARKET_PROVIDER_CALL_SKIP] prop=${pid} reason=${ev?.error ?? 'no_shared_evidence'} shared=true`);
          const apply = await applyDynamicPricingForProperty(pool, {
            cfg, marketStats: null, isMock: false, marketOverride: null,
            sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
            suppressExternalPush: opts.suppressExternalPush === true,
          });
          results.push({
            userId: cfg.user_id, userEmail: cfg.user_email, firstName: cfg.user_first_name,
            propertyId: cfg.property_id, propertyName: cfg.property_name,
            status: apply.status, priceBefore: apply.priceBefore, priceApplied: apply.priceApplied,
            priceCalculated: apply.priceCalculated, tensionLevel: null, nights: apply.nights, isMock: false,
          });
          continue;
        }
        ({ listings, isMock, zoneUsed, dataSource, diagnostics } = ev);
      } else {
        // Legacy path: per-property zone cache (unchanged behavior when flag off)
        // Provider is part of the key so BD and Apify results for the same zone/currency
        // never share a cache entry.
        const providerForCache = marketProvider.resolveProviderForProperty(cfg.property_id);
        const cacheKey = zones.join('|') + ':' + capturedPropertyCurrency + ':' + providerForCache;
        if (!zoneCache[cacheKey]) {
          if (providerCallsThisRun >= maxProviderCalls) {
            console.warn(`[MARKET_BUDGET_EXHAUSTED] prop=${cfg.property_id} provider=${providerForCache} budget=${maxProviderCalls} — skip provider call, recalculate from existing DB data`);
            const _budgetResolution = await resolveMarketData(pool, {
              propertyId: cfg.property_id, propertyContextKey: marketContextKey, propertyCurrency: cfg.currency,
            });
            const _budgetStats = (_budgetResolution.trusted && _budgetResolution.row) ? {
              median: _budgetResolution.row.median_price,
              occupancy: _budgetResolution.row.occupancy_rate,
              tensionLevel: _budgetResolution.row.tension_level,
            } : null;
            const _budgetApply = await applyDynamicPricingForProperty(pool, {
              cfg, marketStats: _budgetStats, isMock: false,
              marketOverride: _budgetResolution.market ?? null,
              sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
              suppressExternalPush: opts.suppressExternalPush === true,
            });
            results.push({
              userId: cfg.user_id, userEmail: cfg.user_email, firstName: cfg.user_first_name,
              propertyId: cfg.property_id, propertyName: cfg.property_name,
              status: _budgetApply.status, priceBefore: _budgetApply.priceBefore,
              priceApplied: _budgetApply.priceApplied, priceCalculated: _budgetApply.priceCalculated,
              tensionLevel: _budgetStats?.tensionLevel ?? null, nights: _budgetApply.nights, isMock: false,
            });
            continue;
          }
          // Budget increments via consumeProviderAttempt callback inside marketProvider.scrape()
          // (each external call — BD trigger or Apify run — debits one slot independently)
          const _legacyRunId = `legacy_${cfg.property_id}`;
          const _budgetOpts = {
            canAttemptProvider:     () => providerCallsThisRun < maxProviderCalls,
            consumeProviderAttempt: (name) => { providerCallsThisRun++; },
          };
          // S15: telemetry on cache miss (actual provider call) — not emitted on cache hit (reuse)
          console.log(`[MARKET_PROVIDER_CALL_ATTEMPT] provider=${providerForCache} collection_run_id=${_legacyRunId} shared_group_size=1 reason=legacy_zone_cache`);
          try {
            zoneCache[cacheKey] = await scrapeBestZone(
              zones,
              (parseFloat(cfg.price_min) + parseFloat(cfg.price_max)) / 2,
              MAX_LISTINGS,
              cfg.bedrooms,
              capturedPropertyCurrency,
              cfg.property_id,
              _budgetOpts
            );
            console.log(`[MARKET_PROVIDER_CALL_SUCCESS] provider=${providerForCache} dataSource=${zoneCache[cacheKey].dataSource} collection_run_id=${_legacyRunId}`);
          } catch (err) {
            console.log(`[MARKET_PROVIDER_CALL_FAILURE] provider=${providerForCache} collection_run_id=${_legacyRunId} reason=${err.message}`);
            throw err;
          }
        }
        ({ listings, isMock, zoneUsed, dataSource, diagnostics } = zoneCache[cacheKey]);
      }

      const zoneLabel = zoneUsed;

      // B15: Never persist mock as fresh market authority — reuse last valid live data
      if (isMock) {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: provider returned mock — skip market write, reuse last live data`);
        const _mockResolution = await resolveMarketData(pool, {
          propertyId: cfg.property_id, propertyContextKey: marketContextKey, propertyCurrency: cfg.currency,
        });
        const _prevMarketStats = (_mockResolution.trusted && _mockResolution.row) ? {
          median: _mockResolution.row.median_price,
          occupancy: _mockResolution.row.occupancy_rate,
          tensionLevel: _mockResolution.row.tension_level,
        } : null;
        const _mockApply = await applyDynamicPricingForProperty(pool, {
          cfg, marketStats: _prevMarketStats, isMock: false,
          marketOverride: _mockResolution.market ?? null,
          sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
          suppressExternalPush: opts.suppressExternalPush === true,
        });
        results.push({
          userId: cfg.user_id, userEmail: cfg.user_email, firstName: cfg.user_first_name,
          propertyId: cfg.property_id, propertyName: cfg.property_name,
          status: _mockApply.status, priceBefore: _mockApply.priceBefore,
          priceApplied: _mockApply.priceApplied, priceCalculated: _mockApply.priceCalculated,
          tensionLevel: _prevMarketStats?.tensionLevel ?? null, nights: _mockApply.nights, isMock: false,
        });
        continue;
      }

      const marketStats = calcProviderMarketStats(listings, cfg, dataSource);
      if (!marketStats) {
        console.warn(`⚠️ [DP-CRON] Pas assez de données pour ${cfg.property_name}`);
        continue;
      }

      // Observability: log sanitized BD market scrape fields (Phase 10, B5-G)
      if (dataSource === 'brightdata_live') {
        const pid  = String(cfg.property_id || '').slice(-8);
        const diag = diagnostics || {};
        const sel  = marketStats._bdSelectionDiag || {};
        console.log(
          `📊 [BD-MARKET] prop=…${pid} zone="${zoneLabel}" ` +
          `raw=${diag.returnedCount ?? '?'} acc=${diag.acceptedCount ?? '?'} ` +
          `cmp=${sel.comparableCount ?? '?'} radius=${sel.selectedRadiusKm ?? '?'}km ` +
          `median=${marketStats.median} proxy=${marketStats.occupancy}% ` +
          `source=${dataSource} currency=${capturedPropertyCurrency}`
        );
      }

      // 4. INSERT market_data (upsert atomique avec vérification de contexte)
      // dataSource comes from the provider result (apify_live / brightdata_live / mock).
      const writeResult = await writeScrapeResult(pool, {
        userId: cfg.user_id, propertyId: cfg.property_id, weekStart,
        marketStats, zoneLabel, dataSource, capturedContextKey: marketContextKey,
        capturedPropertyCurrency,
      });

      if (!writeResult.written) {
        if (writeResult.reason === 'currency_stale') {
          console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: devise changée pendant scrape — snapshot ignoré (captured:${writeResult.capturedCurrency} current:${writeResult.currentCurrency}), BoostPrice sans signal marché`);
          const apply = await applyDynamicPricingForProperty(pool, {
            cfg, marketStats: null, isMock: false, marketOverride: null,
            sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
            suppressExternalPush: opts.suppressExternalPush === true,
          });
          results.push({
            userId:          cfg.user_id,
            userEmail:       cfg.user_email,
            firstName:       cfg.user_first_name,
            propertyId:      cfg.property_id,
            propertyName:    cfg.property_name,
            status:          apply.status,
            priceBefore:     apply.priceBefore,
            priceApplied:    apply.priceApplied,
            priceCalculated: apply.priceCalculated,
            tensionLevel:    null,
            nights:          apply.nights,
            isMock:          false,
          });
        } else {
          console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: contexte géo changé pendant le scrape — snapshot obsolète ignoré`);
        }
        continue;
      }

      console.log(`✅ [DP-CRON] market_data inséré: médiane=${marketStats.median}€ occ=${marketStats.occupancy}% tension=${marketStats.tensionLevel}`);

      // R: Persistence bridge — persist production evidence without additional BD calls
      // Fire-and-forget: failure never breaks pricing (R7). Both flags gate this path.
      if (bridgePersistenceEnabled) {
        _br.bridgePersistProductionEvidence(pool, {
          cfg, listings, marketStats, dataSource,
          collectionRunId: bridgeRunId,
          checkIn:  bridgeCheckIn,
          checkOut: bridgeCheckOut,
          propertyLinks: [{
            property_id: String(cfg.property_id),
            user_id:     cfg.user_id ? String(cfg.user_id) : null,
          }],
        }).catch(err => console.error(`[OBS_PERSIST_FAILURE] unhandled: ${err.message}`));
      }

      // Résolution trust+freshness : le résultat du scrape courant est déjà connu.
      // isMock vient directement du scraper → pas de requête DB supplémentaire.
      // Live fresh : market utilisable ; mock : market neutralisé.
      const marketOverride = isMock ? null : {
        median:           marketStats.median,
        occupancy_rate:   marketStats.occupancy,
        comparable_count: marketStats.count,
        tension_level:    marketStats.tensionLevel,
        tensionLevel:     marketStats.tensionLevel,
      };
      if (isMock) {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: market mock — signal neutralisé, auto-push bloqué`);
      }

      // 5-8. Moteur per-night : calcul, stockage planning, push Channex, notif
      const apply = await applyDynamicPricingForProperty(pool, {
        cfg, marketStats, isMock, marketOverride,
        sendPushNotification: opts.suppressNotifications ? null : sendPushNotification,
        suppressExternalPush: opts.suppressExternalPush === true,
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

  // P15/P16: Shadow K-engine phase — suppressed when S shared production is active.
  // When sharedEnabled=true, the production loop already handles dedup + bridge persistence.
  // Running the shadow phase in addition would make duplicate provider calls.
  // MARKET_DATA_WRITES = 0 — only writes to shadow observation tables.
  {
    const coord = _getShadowCoordinator();
    if (!sharedEnabled && coord.isShadowCollectionEnabled()) {
      _runShadowCollectionPhase(pool, configs)
        .catch(err => console.error('[P-SHADOW] erreur phase shadow:', err.message));
    }
  }

  // 9. Email récap par user (skipped when suppressNotifications=true)
  if (opts.suppressNotifications) {
    console.log('[DP-CRON] suppressNotifications=true — email récap ignoré');
  }
  const userIds = opts.suppressNotifications
    ? []
    : [...new Set(results.map(r => r.userId).filter(Boolean))];
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

  await pool.query(
    `UPDATE dp_daily_collection_run SET completed_at = NOW(), job_status = 'completed' WHERE run_date = $1::date`,
    [todayParis]
  );

  // FIX 6: prune rows older than 90 days — fire-and-forget, failure must not fail the job
  pool.query(
    `DELETE FROM dp_daily_collection_run WHERE run_date < CURRENT_DATE - INTERVAL '90 days'`
  ).catch(err => console.warn('[DP-CRON] dp_daily_collection_run cleanup error (non-fatal):', err.message));

  return results;
  } finally {
    if (lockAcquired) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [DP_DAILY_JOB_ADVISORY_LOCK_KEY]).catch(() => {});
    }
    lockClient.release();
  }
}

// ── Refresh QUOTIDIEN : recalcul + push SANS scrape (réutilise le dernier market_data) ──
async function runDailyPricingRefresh(pool, sendPushNotification = null) {
  console.log('\n🔄 [DP-CRON] === Refresh quotidien des prix (sans scrape marché) ===');
  let configs;
  try {
    configs = (await pool.query(
      `SELECT pc.*, p.name AS property_name,
              p.latitude, p.longitude, p.country_code, p.currency
         FROM pricing_config pc
         JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
        WHERE pc.is_active = TRUE
          AND EXISTS (
            SELECT 1 FROM boostprice_property_entitlements bpe
            WHERE bpe.property_id = pc.property_id
              AND bpe.user_id     = pc.user_id
              AND bpe.status      = 'active'
          )
          AND EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = pc.user_id
              AND (
                s.status IN ('active', 'trialing')
                OR (s.status = 'trial' AND s.trial_end_date > NOW())
              )
          )
        ORDER BY pc.created_at`
    )).rows;
  } catch (err) {
    console.error('❌ [DP-CRON] Configs (refresh quotidien):', err.message);
    return;
  }
  if (configs.length === 0) { console.log('ℹ️ [DP-CRON] Aucune config active — rien à faire'); return; }

  let done = 0, pushed = 0;
  for (const cfg of configs) {
    try {
      const propertyContextKey = computeMarketContextKey({
        countryCode: cfg.country_code,
        latitude:    cfg.latitude,
        longitude:   cfg.longitude,
      });
      const resolution = await resolveMarketData(pool, { propertyId: cfg.property_id, propertyContextKey, propertyCurrency: cfg.currency });
      const isMock = !resolution.trusted && resolution.status !== 'missing';

      if (resolution.status === 'live_wrong_location') {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: market mauvaise localisation — signal neutralisé, auto-push maintenu`);
      } else if (resolution.status === 'legacy_unverified_location') {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: market legacy (contexte non vérifié) — signal neutralisé, auto-push maintenu`);
      } else if (resolution.status === 'context_unavailable') {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: market contexte indisponible — signal neutralisé, auto-push maintenu`);
      } else if (resolution.status === 'live_stale') {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: market stale (${resolution.ageDays?.toFixed(1)}j) — signal neutralisé, auto-push maintenu`);
      } else if (isMock) {
        console.log(`ℹ️ [DP-CRON] ${cfg.property_name}: market ${resolution.status} — signal neutralisé, auto-push bloqué`);
      }

      const marketStats = resolution.row ? {
        median: resolution.row.median_price,
        occupancy: resolution.row.occupancy_rate,
        tensionLevel: resolution.row.tension_level,
      } : null;

      const apply = await applyDynamicPricingForProperty(pool, {
        cfg, marketStats, isMock,
        marketOverride: resolution.market,   // null when stale/untrusted, object when usable
        sendPushNotification,
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
async function initDynamicPricingCron(pool, sendEmail, sendPushNotification) {
  const cron = require('node-cron');

  // Await table creation before registering crons — prevents INSERT failure if 06:00 fires immediately
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dp_daily_collection_run (
      run_date     DATE        PRIMARY KEY,
      started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      job_status   TEXT        NOT NULL DEFAULT 'running'
    )
  `).catch(err => console.error('[DP-CRON] dp_daily_collection_run table init error:', err.message));

  // Daily 06:00 Europe/Paris — full market cycle (scrape + recalculation + publication) every day
  cron.schedule('0 6 * * *', async () => {
    console.log('\n⏰ [DP-CRON] Déclenchement automatique quotidien (6h00)');
    await runDynamicPricingJob(pool, sendEmail, sendPushNotification);
  }, { timezone: 'Europe/Paris' });

  // P1.3-T2-FIX: Pickup shadow — daily 06:05 Europe/Paris, independent of market provider.
  // Reads reservation DB only (no APIFY/BrightData calls). Runs every day including Monday.
  // PICKUP_HAS_PRICING_AUTHORITY=NO — results never flow into priceProperty or pricing_schedule.
  // SCHEDULER_TZ_DEBT: cron fires in Europe/Paris time. For FR properties the observation_date
  // is correct. Properties in distant timezones (e.g. US West) will still get a correct
  // property-local observation_date because the job uses properties.timezone per property.
  // FLAG_OFF: when BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED != 'true', job returns immediately
  // with zero calculations and zero writes.
  cron.schedule('5 6 * * *', () => {
    const { isPersistenceEnabled: _pu } = require('../services/booking-pickup-persistence');
    if (!_pu()) return;  // FLAG_OFF_CALCULATIONS=0  FLAG_OFF_WRITES=0
    require('../services/booking-pickup-shadow-job')
      .runPickupShadowJob(pool)
      .then(s => {
        console.log(
          `[PICKUP_SHADOW] done — props=${s.propertiesProcessed}/${s.propertiesEligible}` +
          ` dates=${s.targetDatesAttempted} calc=${s.observationsCalculated}` +
          ` persisted=${s.observationsPersisted} dupes=${s.duplicatesSkipped}` +
          ` errors=${s.errors.length}`
        );
      })
      .catch(err => console.error('[PICKUP_SHADOW_FAILURE]', err.message));
  }, { timezone: 'Europe/Paris' });

  // P1.4-T1-FIX: Local seasonality shadow — weekly Monday 03:15 Europe/Paris.
  // Produces HORIZON_MONTHS (9) target-month rows per property per run.
  // Writes to local_seasonality_observations (when flag ON).  DO NOTHING on duplicate.
  // SEASONALITY_HAS_PRICING_AUTHORITY=NO — results never flow into pricing calculations.
  // SCHEDULER_TZ_DEBT: job fires at Europe/Paris time; each property uses its own timezone
  // for observation_date, so stored dates are property-local-correct regardless.
  // FLAG_OFF: when LOCAL_SEASONALITY_SHADOW_ENABLED != 'true', returns immediately with zero reads/writes.
  cron.schedule('15 3 * * 1', () => {
    const { isShadowEnabled } = require('../services/local-seasonality-shadow');
    if (!isShadowEnabled()) return;  // FLAG_OFF_CALCULATIONS=0  FLAG_OFF_WRITES=0
    require('../services/local-seasonality-shadow-job')
      .runLocalSeasonalityJob(pool)
      .then(s => {
        console.log(
          `[SEASONALITY_SHADOW] done — props=${s.propertiesProcessed}/${s.propertiesEligible}` +
          ` attempted=${s.observationsAttempted} inserted=${s.observationsInserted}` +
          ` dupes=${s.observationsDuplicate} errors=${s.errors.length}`,
        );
      })
      .catch(err => console.error('[SEASONALITY_SHADOW_FAILURE]', err.message));
  }, { timezone: 'Europe/Paris' });

  if (MOCK_MODE) {
    console.log('⚠️  [DP-CRON] Mode MOCK actif — APIFY_TOKEN non défini');
    console.log('   → Données simulées utilisées lors du scraping');
    console.log('   → Ajoutez APIFY_TOKEN dans les env vars Render pour activer le mode live');
  } else {
    console.log('✅ [DP-CRON] Mode LIVE actif — Apify activé');
  }

  console.log('✅ [DP-CRON] Crons initialisés — Quotidien 6h00 (scrape+recalcul+push, cycle complet) — Europe/Paris');
}

// ============================================================
// 🎯 ANALYSE À LA DEMANDE — UN SEUL LOGEMENT
// Utilisé quand on active un nouveau logement : scrape ciblé +
// market_data immédiat, sans attendre le cron du lundi.
// ============================================================
async function runDynamicPricingForOneProperty(pool, { userId, propertyId, sendPushNotification = null, force = false }) {
  const weekStart = getCurrentWeekStart();

  // Sélectionner la config canonique via properties.user_id (jamais via le caller userId)
  const cfg = (await pool.query(
    `SELECT pc.*, p.name AS property_name, p.address AS property_address,
            p.latitude, p.longitude, p.country_code, p.currency,
            p.max_guests, p.timezone
       FROM pricing_config pc
       JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE pc.property_id = $1`,
    [propertyId]
  )).rows[0];

  if (!cfg) return { ok: false, error: 'Config pricing introuvable pour ce logement' };

  // Commercial entitlement gate — fail closed if not entitled
  const entitled = await hasBoostPriceEntitlement(pool, cfg.user_id, propertyId);
  if (!entitled) {
    console.warn(`[DP-ONE] no_boostprice_entitlement for property ${propertyId} (user ${cfg.user_id}) — skip`);
    return { ok: false, error: 'no_boostprice_entitlement', propertyId };
  }

  // Évite de re-scraper si des données live existent déjà aujourd'hui (sauf force)
  if (!force) {
    const todayParis = getCurrentParisDayISO();
    const existing = await pool.query(
      `SELECT 1 FROM market_data
       WHERE property_id = $1
         AND data_source != 'mock'
         AND scraped_at >= ($2::date AT TIME ZONE 'Europe/Paris')
       LIMIT 1`,
      [propertyId, todayParis]
    );
    if (existing.rows.length > 0) {
      return { ok: true, skipped: true, reason: "Données marché live déjà présentes aujourd'hui" };
    }
  }

  const zones = getFallbackZones(cfg.property_address, cfg.zone_label);
  console.log(`🎯 [DP-ONE] Analyse à la demande: ${cfg.property_name} (${propertyId}) — zones: ${zones.join(' → ')}`);

  const marketContextKey = computeMarketContextKey({
    countryCode: cfg.country_code,
    latitude:  cfg.latitude  != null ? parseFloat(cfg.latitude)  : null,
    longitude: cfg.longitude != null ? parseFloat(cfg.longitude) : null,
  });
  const capturedPropertyCurrency = normalizeMarketCurrency(cfg.currency);

  // Unknown currency → skip scrape and writeScrapeResult; BoostPrice still runs
  if (!capturedPropertyCurrency) {
    console.log(`ℹ️ [DP-ONE] ${cfg.property_name}: devise inconnue — scrape marché ignoré, BoostPrice sans signal marché`);
    const apply = await applyDynamicPricingForProperty(pool, {
      cfg, marketStats: null, isMock: false, marketOverride: null, sendPushNotification,
    });
    return { ok: true, isMock: false, marketStats: null, apply };
  }

  // S15: Provider call telemetry (single-property path — always per-property, no sharing)
  const _providerTel = marketProvider.resolveProviderForProperty(propertyId);
  const _singleRunId = `single_${propertyId}`;
  console.log(`[MARKET_PROVIDER_CALL_ATTEMPT] provider=${_providerTel} collection_run_id=${_singleRunId} shared_group_size=1 reason=single_property`);
  let _singleScrape;
  try {
    _singleScrape = await scrapeBestZone(
      zones,
      (parseFloat(cfg.price_min) + parseFloat(cfg.price_max)) / 2,
      MAX_LISTINGS,
      cfg.bedrooms,
      capturedPropertyCurrency,
      propertyId
    );
  } catch (err) {
    console.log(`[MARKET_PROVIDER_CALL_FAILURE] provider=${_providerTel} collection_run_id=${_singleRunId} reason=${err.message}`);
    throw err;
  }
  const { listings, isMock, zoneUsed, dataSource, diagnostics } = _singleScrape;
  console.log(`[MARKET_PROVIDER_CALL_SUCCESS] provider=${_providerTel} dataSource=${dataSource} collection_run_id=${_singleRunId}`);
  const zoneLabel = zoneUsed;

  const marketStats = calcProviderMarketStats(listings, cfg, dataSource);
  if (!marketStats) return { ok: false, error: 'Pas assez de données marché pour ce logement' };

  const writeResultOne = await writeScrapeResult(pool, {
    userId: cfg.user_id, propertyId, weekStart,
    marketStats, zoneLabel, dataSource, capturedContextKey: marketContextKey,
    capturedPropertyCurrency,
  });

  if (!writeResultOne.written) {
    if (writeResultOne.reason === 'currency_stale') {
      console.log(`ℹ️ [DP-ONE] ${cfg.property_name}: devise changée pendant scrape — snapshot ignoré (captured:${writeResultOne.capturedCurrency} current:${writeResultOne.currentCurrency}), BoostPrice sans signal marché`);
      const apply = await applyDynamicPricingForProperty(pool, {
        cfg, marketStats: null, isMock: false, marketOverride: null, sendPushNotification,
      });
      return { ok: true, isMock: false, marketStats: null, apply };
    }
    console.log(`ℹ️ [DP-ONE] ${cfg.property_name}: contexte géo changé pendant le scrape — snapshot obsolète ignoré`);
    return { ok: false, error: 'context_stale', propertyId };
  }

  console.log(`✅ [DP-ONE] market_data: médiane=${marketStats.median}€ occ=${marketStats.occupancy}% tension=${marketStats.tensionLevel}`);

  // R: Persistence bridge — fire-and-forget single-property run (R7 failure isolation)
  {
    const _br = _getBridge();
    if (_br.isPersistenceEnabled()) {
      const dates = marketProvider.getBrightDataMarketDates();
      _br.bridgePersistProductionEvidence(pool, {
        cfg, listings, marketStats, dataSource,
        collectionRunId: _br.generateBridgeRunId(),
        checkIn:  dates.checkIn,
        checkOut: dates.checkOut,
        propertyLinks: [{
          property_id: String(cfg.property_id),
          user_id:     cfg.user_id ? String(cfg.user_id) : null,
        }],
      }).catch(err => console.error(`[OBS_PERSIST_FAILURE] unhandled: ${err.message}`));
    }
  }

  // Observability for one-property BD path (logged after confirmed write)
  if (dataSource === 'brightdata_live') {
    const pid  = String(propertyId || '').slice(-8);
    const diag = diagnostics || {};
    const sel  = marketStats._bdSelectionDiag || {};
    console.log(
      `📊 [BD-MARKET] prop=…${pid} zone="${zoneLabel}" ` +
      `raw=${diag.returnedCount ?? '?'} acc=${diag.acceptedCount ?? '?'} ` +
      `cmp=${sel.comparableCount ?? '?'} radius=${sel.selectedRadiusKm ?? '?'}km ` +
      `median=${marketStats.median} proxy=${marketStats.occupancy}% ` +
      `source=${dataSource} currency=${capturedPropertyCurrency}`
    );
  }

  // Trust comes directly from the scrape result — no redundant DB read.
  const marketOverride = isMock ? null : {
    median:           marketStats.median,
    occupancy_rate:   marketStats.occupancy,
    comparable_count: marketStats.count,
    tension_level:    marketStats.tensionLevel,
    tensionLevel:     marketStats.tensionLevel,
  };
  if (isMock) {
    console.log(`ℹ️ [DP-ONE] ${cfg.property_name}: market mock — signal neutralisé, auto-push bloqué`);
  }

  const apply = await applyDynamicPricingForProperty(pool, {
    cfg, marketStats, isMock, marketOverride, sendPushNotification,
  });

  return { ok: true, isMock, marketStats, apply };
}

// ── Écriture atomique du snapshot marché avec vérification de contexte + devise (CAS) ──
//
// Séquence après la fin du scrape HTTP (aucune transaction pendant Apify) :
//   BEGIN
//   SELECT country_code, latitude, longitude, currency FROM properties WHERE id=$1 FOR UPDATE
//   computeMarketContextKey() → currentContextKey   ← implémentation canonique JS
//   1. Geographic CAS : if capturedContextKey !== currentContextKey → ROLLBACK → context_stale
//   2. Currency CAS   : if capturedPropertyCurrency ≠ currentCurrency  → ROLLBACK → currency_stale
//   3. INSERT/UPSERT market_data
//   COMMIT
//
// Le FOR UPDATE empêche physiquement un UPDATE concurrent sur la row properties
// entre la vérification de contexte et l'écriture du snapshot.
// Durée du verrou : SELECT + compares (µs) + UPSERT — aucun appel HTTP.
//
// Geographic CAS :
//   null === null : autorisé (legacy sans géo).
//   null !== 'CC:X:Y' : bloqué (propriété géocodée pendant le scrape).
//   'CC:X:Y' !== 'CC:A:B' : bloqué (propriété déplacée).
//   'CC:X:Y' === 'CC:X:Y' : autorisé (contexte stable).
//
// Currency CAS (B4-D) — activé quand capturedPropertyCurrency !== undefined :
//   capturedPropertyCurrency null   → FAIL CLOSED (invariant B4-C : jamais censé scraper sans devise).
//   captured ≠ current             → currency_stale (race gagnée par le changement de devise).
//   captured = current             → PASS, écriture autorisée.
//   capturedPropertyCurrency undefined → check inactif (callers pré-B4-D, backward-compat).
async function writeScrapeResult(pool, {
  userId, propertyId, weekStart,
  marketStats, zoneLabel, dataSource, capturedContextKey,
  capturedPropertyCurrency = undefined,   // B4-D: undefined=legacy; null=fail-closed; valid ISO-4217=compare
  currency = capturedPropertyCurrency,    // legacy alias — prefer capturedPropertyCurrency for new callers
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const propRes = await client.query(
      `SELECT country_code, latitude, longitude, currency
         FROM properties WHERE id = $1 FOR UPDATE`,
      [propertyId]
    );

    if (propRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'property_not_found' };
    }

    const prop = propRes.rows[0];
    const currentContextKey = computeMarketContextKey({
      countryCode: prop.country_code,
      latitude:    prop.latitude,
      longitude:   prop.longitude,
    });

    // 1. Geographic CAS (runs first — §6 ordering)
    if (capturedContextKey !== currentContextKey) {
      await client.query('ROLLBACK');
      return { written: false, reason: 'context_stale' };
    }

    // 2. Currency CAS (B4-D) — only when capturedPropertyCurrency was explicitly provided
    if (capturedPropertyCurrency !== undefined) {
      const currentCurrency = normalizeMarketCurrency(prop.currency);
      if (!capturedPropertyCurrency || currentCurrency !== capturedPropertyCurrency) {
        await client.query('ROLLBACK');
        return { written: false, reason: 'currency_stale',
                 capturedCurrency: capturedPropertyCurrency, currentCurrency };
      }
    }

    await client.query(
      `INSERT INTO market_data (
         user_id, property_id, week_start,
         median_price, price_p25, price_p75,
         occupancy_rate, comparable_count, tension_level,
         zone_label, data_source, market_context_key, currency, scraped_at, created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
       ON CONFLICT (property_id, week_start) DO UPDATE SET
         median_price       = EXCLUDED.median_price,
         price_p25          = EXCLUDED.price_p25,
         price_p75          = EXCLUDED.price_p75,
         occupancy_rate     = EXCLUDED.occupancy_rate,
         comparable_count   = EXCLUDED.comparable_count,
         tension_level      = EXCLUDED.tension_level,
         zone_label         = EXCLUDED.zone_label,
         data_source        = EXCLUDED.data_source,
         market_context_key = EXCLUDED.market_context_key,
         currency           = EXCLUDED.currency,
         scraped_at         = NOW()`,
      [
        userId, propertyId, weekStart,
        marketStats.median, marketStats.p25, marketStats.p75,
        marketStats.occupancy, marketStats.count, marketStats.tensionLevel,
        zoneLabel, dataSource, capturedContextKey, currency,
      ]
    );

    await client.query('COMMIT');
    return { written: true };

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDynamicPricingCron, runDynamicPricingJob, runDailyPricingRefresh, runDynamicPricingForOneProperty, writeScrapeResult, scrapeBestZone, getFallbackZones, getCurrentWeekStart, getCurrentParisDayISO, calcMarketStats, validateBDStats, calcProviderMarketStats };
