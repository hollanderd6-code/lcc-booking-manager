/**
 * ═══════════════════════════════════════════════════════════════════
 *  PoC Pricing Dynamique — Boostinghost
 *  Script standalone pour valider la faisabilité du scraping Airbnb
 *  via Apify et l'analyse de marché en zone réelle.
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Usage :
 *    1. npm install node-fetch@2 dotenv
 *    2. cp .env.example .env puis ajoute ton APIFY_API_TOKEN
 *    3. Configure les infos de ton logement dans CONFIG ci-dessous
 *    4. node poc-apify.js
 *
 *  Ce script :
 *    - Géocode ton adresse (Nominatim OSM, gratuit)
 *    - Lance un scraping Apify sur Airbnb (rayon 1.5km, 90j)
 *    - Filtre les comparables pertinents
 *    - Calcule médiane, P25/P75, tension du marché
 *    - Écrit un rapport console + un poc-result.json
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Node 18+ a fetch natif. Sinon on utilise node-fetch.
const fetch = global.fetch || require('node-fetch');

// ═══════════════════════════════════════════════════════════════════
//   🏠 CONFIG — à modifier pour ton logement de test
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  // Informations du logement à tester
  property: {
    name: 'Studio Gare RDC',
    address: 'Cergy, France',              // ← adresse à géocoder
    type: 'studio',                         // studio / apartment / house
    bedrooms: 0,                            // 0 = studio
    maxGuests: 2,
    currentPrice: 65,                       // € par nuit actuel
    priceMin: 60,                           // fourchette hôte
    priceMax: 150,
  },

  // Paramètres de scraping
  scraping: {
    radiusKm: 1.5,                          // rayon autour du logement
    maxListings: 150,                       // cap pour limiter le coût
    daysAhead: 90,                          // horizon de collecte
  },

  // Apify — actor choisi
  apify: {
    actorId: 'tri-angle~airbnb-scraper',   // tilde = séparateur user/actor
    timeoutSec: 180,
  },
};

// ═══════════════════════════════════════════════════════════════════
//   🎨 Helpers console — couleurs ANSI (pas de dépendance)
// ═══════════════════════════════════════════════════════════════════
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};
const log = {
  header: (t) => console.log(`\n${c.bold}${c.cyan}${t}${c.reset}`),
  info: (t) => console.log(`   ${c.gray}└─ ${c.reset}${t}`),
  ok: (t) => console.log(`${c.green}✓${c.reset} ${t}`),
  warn: (t) => console.log(`${c.yellow}⚠${c.reset}  ${t}`),
  err: (t) => console.log(`${c.red}✗${c.reset} ${t}`),
  section: (icon, t) => console.log(`\n${icon}  ${c.bold}${t}${c.reset}`),
};

// ═══════════════════════════════════════════════════════════════════
//   1️⃣  GÉOCODAGE via Nominatim OSM (gratuit, pas de clé)
// ═══════════════════════════════════════════════════════════════════
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Boostinghost-PoC/1.0 (contact@boostinghost.fr)' }
  });
  if (!res.ok) throw new Error(`Nominatim error ${res.status}`);
  const data = await res.json();
  if (!data.length) throw new Error(`Aucun résultat pour "${address}"`);
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  };
}

// ═══════════════════════════════════════════════════════════════════
//   2️⃣  SCRAPING APIFY — mode synchrone (run-sync-get-dataset-items)
// ═══════════════════════════════════════════════════════════════════
async function scrapeAirbnb(lat, lng, startDate, endDate) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN manquant dans .env');

  // Construction de l'input pour l'actor tri-angle~airbnb-scraper.
  // Cet actor accepte une recherche par coordonnées + rayon (en km).
  const input = {
    locationQueries: [],                     // on utilise les coords, pas le nom
    latitude: lat,
    longitude: lng,
    rangeInKm: CONFIG.scraping.radiusKm,
    maxListings: CONFIG.scraping.maxListings,
    checkIn: startDate,
    checkOut: endDate,
    currency: 'EUR',
    locale: 'fr',
    // Paramètres de limitation (sinon il scrape à fond)
    priceMin: 10,
    priceMax: 500,
  };

  const url = `https://api.apify.com/v2/acts/${CONFIG.apify.actorId}/run-sync-get-dataset-items?token=${token}&timeout=${CONFIG.apify.timeoutSec}`;

  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const durationSec = (Date.now() - started) / 1000;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Apify ${res.status}: ${errText.slice(0, 500)}`);
  }

  const items = await res.json();

  // Coût estimé (compute units). Données réelles via l'API runs, ici on estime.
  // Un scraping Airbnb ~150 listings coûte typiquement 0.01–0.03$ en compute.
  const costEstimate = 0.02 + (items.length * 0.0001);

  return { items, durationSec, costEstimate };
}

// ═══════════════════════════════════════════════════════════════════
//   3️⃣  FILTRAGE DES COMPARABLES
// ═══════════════════════════════════════════════════════════════════
function filterComparables(listings, target) {
  const kept = [];
  const rejected = { type: 0, bedrooms: 0, noPrice: 0, other: 0 };

  for (const item of listings) {
    // Garde-fou : pas de prix utilisable = on skip
    const price = extractPrice(item);
    if (!price || price < 10 || price > 1000) {
      rejected.noPrice++;
      continue;
    }

    // Type de logement : tolérant
    const roomType = (item.roomType || item.propertyType || '').toLowerCase();
    if (target.type === 'studio') {
      // Pour un studio, on accepte "studio" et "entire place" petit (≤1 chambre)
      const bedrooms = parseInt(item.bedrooms ?? item.numberOfBedrooms ?? 0, 10);
      if (bedrooms > 1) {
        rejected.bedrooms++;
        continue;
      }
    } else {
      const bedrooms = parseInt(item.bedrooms ?? item.numberOfBedrooms ?? 0, 10);
      if (Math.abs(bedrooms - target.bedrooms) > 1) {
        rejected.bedrooms++;
        continue;
      }
    }

    kept.push({
      price,
      bedrooms: item.bedrooms,
      roomType: item.roomType,
      rating: item.rating?.guestSatisfaction || item.rating,
      // On stocke UNIQUEMENT des données anonymes/agrégées (RGPD-safe)
      // Pas de nom d'hôte, pas d'URL, pas de photo
    });
  }

  return { kept, rejected };
}

function extractPrice(item) {
  // Les actors Apify ne normalisent pas toujours le prix de la même façon.
  // On tente plusieurs chemins dans l'objet.
  const candidates = [
    item.price?.rate,                        // tri-angle
    item.price?.total,
    item.pricing?.rate?.amount,
    item.pricingQuote?.rate?.amount,
    item.pricing?.priceString && parseFloat(item.pricing.priceString.replace(/[^\d.]/g, '')),
    typeof item.price === 'number' ? item.price : null,
    typeof item.price === 'string' ? parseFloat(item.price.replace(/[^\d.]/g, '')) : null,
  ];
  for (const v of candidates) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//   4️⃣  STATS — médiane, percentiles
// ═══════════════════════════════════════════════════════════════════
function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function analyzeMarket(comparables) {
  if (!comparables.length) return null;
  const prices = comparables.map(c => c.price).sort((a, b) => a - b);
  return {
    count: prices.length,
    min: prices[0],
    max: prices[prices.length - 1],
    median: percentile(prices, 0.5),
    p25: percentile(prices, 0.25),
    p75: percentile(prices, 0.75),
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
  };
}

// ═══════════════════════════════════════════════════════════════════
//   5️⃣  PRIX RECOMMANDÉ (algo simplifié — PoC)
//   Pour le PoC, on ne calcule PAS encore la tension réelle (dispo
//   des concurrents). On se base uniquement sur le prix médian.
//   La tension viendra en Phase 2 avec le scraping du calendrier.
// ═══════════════════════════════════════════════════════════════════
function recommendPrice(market, target) {
  if (!market) return null;
  const raw = Math.round(market.median);
  // Clamp dans la fourchette hôte
  const clamped = Math.max(target.priceMin, Math.min(target.priceMax, raw));
  return {
    raw,
    clamped,
    wasClamped: raw !== clamped,
    deltaVsCurrent: clamped - target.currentPrice,
    deltaPct: Math.round(((clamped - target.currentPrice) / target.currentPrice) * 100),
  };
}

// ═══════════════════════════════════════════════════════════════════
//   MAIN
// ═══════════════════════════════════════════════════════════════════
(async function main() {
  console.log(`\n${c.bold}${c.magenta}╔═══════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║     PoC Pricing Dynamique — Boostinghost          ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚═══════════════════════════════════════════════════╝${c.reset}`);

  try {
    // ─── 1. Logement ciblé ─────────────────────────────────────────
    log.section('🏠', 'Logement testé');
    log.info(`${c.bold}${CONFIG.property.name}${c.reset}`);
    log.info(`Adresse : ${CONFIG.property.address}`);
    log.info(`Type : ${CONFIG.property.type} · ${CONFIG.property.bedrooms} ch · ${CONFIG.property.maxGuests} pers`);
    log.info(`Prix actuel : ${c.bold}${CONFIG.property.currentPrice}€/nuit${c.reset}`);
    log.info(`Fourchette hôte : ${CONFIG.property.priceMin}€ – ${CONFIG.property.priceMax}€`);

    // ─── 2. Géocodage ──────────────────────────────────────────────
    log.section('🗺️ ', 'Géocodage via Nominatim');
    const geo = await geocode(CONFIG.property.address);
    log.info(`Lat/Lng : ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`);
    log.info(`Adresse résolue : ${c.dim}${geo.displayName.slice(0, 80)}${c.reset}`);

    // ─── 3. Dates (90 jours à partir d'aujourd'hui) ────────────────
    const today = new Date();
    const in90 = new Date(today.getTime() + CONFIG.scraping.daysAhead * 24 * 60 * 60 * 1000);
    const startDate = today.toISOString().slice(0, 10);
    const endDate = in90.toISOString().slice(0, 10);

    // ─── 4. Scraping Apify ─────────────────────────────────────────
    log.section('🔍', 'Scraping Apify en cours...');
    log.info(`Actor : ${c.cyan}${CONFIG.apify.actorId}${c.reset}`);
    log.info(`Rayon : ${CONFIG.scraping.radiusKm} km autour du logement`);
    log.info(`Période : ${startDate} → ${endDate}`);
    log.info(`Max listings : ${CONFIG.scraping.maxListings}`);
    log.info(`${c.dim}(Patience : environ 30-90 secondes...)${c.reset}`);

    const { items, durationSec, costEstimate } = await scrapeAirbnb(
      geo.lat, geo.lng, startDate, endDate
    );

    log.ok(`${c.bold}${items.length}${c.reset} annonces récupérées en ${c.bold}${durationSec.toFixed(1)}s${c.reset}`);
    log.info(`Coût estimé : ~${costEstimate.toFixed(3)}$ (environ ${(costEstimate * 0.93).toFixed(3)}€)`);

    if (items.length === 0) {
      log.err('Aucune annonce trouvée. Vérifie la zone ou l\'actor.');
      process.exit(1);
    }

    // ─── 5. Filtrage des comparables ───────────────────────────────
    log.section('🎯', 'Filtrage des comparables');
    const { kept, rejected } = filterComparables(items, CONFIG.property);
    log.info(`${c.bold}${c.green}${kept.length}${c.reset} comparables retenus`);
    log.info(`Exclus : ${rejected.bedrooms} (mauvais nb chambres) · ${rejected.noPrice} (prix manquant) · ${rejected.other} (autres)`);

    if (kept.length < 10) {
      log.warn(`Trop peu de comparables (${kept.length}). Élargis le rayon ou teste une autre zone.`);
    }

    // ─── 6. Analyse de marché ──────────────────────────────────────
    log.section('📊', 'Analyse de marché');
    const market = analyzeMarket(kept);
    if (market) {
      log.info(`Prix médian : ${c.bold}${c.green}${Math.round(market.median)}€${c.reset}/nuit`);
      log.info(`P25 (entrée de gamme) : ${Math.round(market.p25)}€`);
      log.info(`P75 (haut de gamme) : ${Math.round(market.p75)}€`);
      log.info(`Min / Max : ${Math.round(market.min)}€ – ${Math.round(market.max)}€`);
      log.info(`Moyenne : ${Math.round(market.avg)}€`);

      const diffPct = Math.round(((CONFIG.property.currentPrice - market.median) / market.median) * 100);
      const diffSign = diffPct >= 0 ? '+' : '';
      const diffColor = Math.abs(diffPct) > 15 ? c.yellow : c.gray;
      log.info(`Ton prix : ${c.bold}${CONFIG.property.currentPrice}€${c.reset} (${diffColor}${diffSign}${diffPct}%${c.reset} vs médiane)`);
    }

    // ─── 7. Prix recommandé ────────────────────────────────────────
    log.section('💡', 'Prix recommandé (PoC, basé sur médiane)');
    const reco = recommendPrice(market, CONFIG.property);
    if (reco) {
      log.info(`Prix brut calculé : ${reco.raw}€`);
      log.info(`Prix final (après fourchette) : ${c.bold}${c.green}${reco.clamped}€/nuit${c.reset}`);
      if (reco.wasClamped) {
        log.warn(`Limité par la fourchette (${CONFIG.property.priceMin}€ – ${CONFIG.property.priceMax}€)`);
      }
      const deltaSign = reco.deltaVsCurrent >= 0 ? '+' : '';
      log.info(`Delta vs actuel : ${deltaSign}${reco.deltaVsCurrent}€ (${deltaSign}${reco.deltaPct}%)`);
      log.info(`${c.dim}⚠  La tension (occupation concurrents) sera ajoutée en Phase 2${c.reset}`);
    }

    // ─── 8. Export JSON ────────────────────────────────────────────
    const output = {
      timestamp: new Date().toISOString(),
      config: CONFIG,
      geocoding: geo,
      scraping: {
        totalListings: items.length,
        durationSec,
        costEstimateUSD: costEstimate,
        dateRange: { start: startDate, end: endDate },
      },
      filtering: {
        keptCount: kept.length,
        rejected,
      },
      market,
      recommendation: reco,
      samples: kept.slice(0, 5).map(k => ({
        price: k.price,
        bedrooms: k.bedrooms,
        roomType: k.roomType,
        rating: k.rating,
      })),
    };

    const outPath = path.join(__dirname, 'poc-result.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    log.section('💾', 'Export');
    log.info(`Résultats complets : ${c.cyan}${outPath}${c.reset}`);

    // ─── 9. Verdict Go/No-Go ───────────────────────────────────────
    log.section('🎬', 'Verdict PoC');
    const issues = [];
    if (kept.length < 20) issues.push(`Peu de comparables (${kept.length}, < 20 recommandés)`);
    if (costEstimate > 0.10) issues.push(`Coût par run élevé (${costEstimate.toFixed(3)}$, > 0.10$)`);
    if (durationSec > 120) issues.push(`Trop lent (${durationSec.toFixed(0)}s, > 120s)`);

    if (issues.length === 0) {
      console.log(`   ${c.green}${c.bold}✓ GO${c.reset} — Le scraping est viable, on peut passer à la Phase 2`);
      console.log(`   ${c.dim}Coût mensuel estimé pour 13 logements en quotidien : ~${(costEstimate * 13 * 30).toFixed(2)}$${c.reset}`);
    } else {
      console.log(`   ${c.yellow}${c.bold}⚠  À DISCUTER${c.reset} — Points à valider :`);
      issues.forEach(i => console.log(`     · ${i}`));
    }

    console.log();

  } catch (err) {
    console.log(`\n${c.red}${c.bold}✗ ERREUR${c.reset}`);
    console.log(`${c.red}${err.message}${c.reset}`);
    if (err.stack) console.log(`${c.dim}${err.stack.split('\n').slice(1, 4).join('\n')}${c.reset}`);
    process.exit(1);
  }
})();
