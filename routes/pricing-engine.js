// ============================================================
// 🎯 PRICING ENGINE — Tarification dynamique par NUIT
// ------------------------------------------------------------
// Moteur "top du top" : déterministe, explicable, par nuit.
//
//   prixNuit = clamp(
//       base_price
//       × saison(date)         (courbe mensuelle + vacances scolaires)
//       × jourSemaine(dow)
//       × leadTime(joursAvant)
//       × pacing(ton occupation réelle par fenêtre)   ← cœur yield
//       × marché(médiane comps, BORNÉ ±15%)
//       × événements(date)
//       × gapFill,
//     price_min, price_max
//   ) → lissage anti-yo-yo → min-stay dynamique
//
// Chaque nuit renvoie le DÉTAIL de ses facteurs (→ "pourquoi ce prix").
//
// Deux niveaux :
//   1. Moteur PUR (aucune DB)  → testable, déterministe : buildSchedule()
//   2. Adaptateur DB           → priceProperty(pool, {...}) : lit
//      reservations + market_data + pricing_config et appelle le moteur.
//
// Lancer la démo :  node routes/pricing-engine.js
// ============================================================

'use strict';

// ────────────────────────────────────────────────────────────
// CONFIG PAR DÉFAUT (tout est surchargeable par logement)
// ────────────────────────────────────────────────────────────
const DEFAULTS = {
  horizonDays: 365,        // nombre de nuits calculées à partir d'aujourd'hui
  aggressiveness: 0.85,    // 0 = prudent (faibles écarts) … 1 = agressif

  // Courbe de saisonnalité : 12 ancres mensuelles (Île-de-France / Paris).
  // Interpolées en continu jour par jour. À ajuster par zone.
  seasonByMonth: [
    0.88, // Jan
    0.90, // Fév
    0.94, // Mar
    1.00, // Avr
    1.06, // Mai
    1.10, // Juin
    1.12, // Juil
    1.08, // Août
    1.10, // Sep
    1.02, // Oct
    0.90, // Nov
    0.96, // Déc
  ],

  // Multiplicateur par jour de semaine (0=dim … 6=sam).
  // Si weekend_price est fourni, ven/sam sont recalculés depuis ce ratio.
  dow: [0.96, 0.92, 0.92, 0.94, 1.00, 1.16, 1.18],

  // Lead-time : prix élevé loin, décroissance, last-minute.
  // Ancres { jours_avant : multiplicateur } interpolées.
  leadCurve: [
    [365, 1.05], [180, 1.04], [120, 1.03], [60, 1.01],
    [30, 1.00], [14, 0.99], [7, 0.97], [3, 0.93], [1, 0.90], [0, 0.88],
  ],

  // Pacing : courbe de remplissage IDÉAL (fraction de nuits déjà réservées
  // attendue à ce lead-time). On compare ta vraie occupation à ça.
  idealPickup: [
    [365, 0.06], [180, 0.12], [90, 0.25], [60, 0.38],
    [30, 0.55], [14, 0.72], [7, 0.85], [1, 0.93],
  ],
  pacingWindowDays: 12,    // fenêtre ± autour de la date pour mesurer l'occupation
  pacingGain: 0.30,        // sensibilité au pacing
  pacingClamp: 0.14,       // ± max du facteur pacing

  // Marché : correcteur BORNÉ (jamais la base).
  marketWeight: 0.50,      // 0 = ignore le marché … 1 = colle au marché
  marketMaxShift: 0.15,    // ±15% max d'influence marché
  marketTensionNudge: 0.04,// petit bonus/malus selon tension marché (±4%)
  marketMinComps: 8,       // en dessous → confiance faible (influence réduite)
  marketFullComps: 40,     // au dessus → pleine confiance

  // Gap-fill : trous courts entre 2 résas → on remplit.
  gapFillMult: 0.88,       // remise sur une nuit "orpheline"
  gapMaxNights: 2,         // taille max d'un trou considéré comme orphelin

  // Min-stay dynamique (séjour minimum selon le lead-time)
  minStayFar: 3,           // > minStayFarDays jours avant
  minStayFarDays: 45,
  minStayMid: 2,           // entre minStayNearDays et minStayFarDays
  minStayNearDays: 10,     // < ce seuil → 1 nuit
  minStayNear: 1,

  // Lissage anti-yo-yo : variation max d'une nuit à la suivante.
  maxDailyJump: 0.18,
};

// ────────────────────────────────────────────────────────────
// HELPERS DATE (UTC, sans dérive de fuseau)
// ────────────────────────────────────────────────────────────
const MS_DAY = 86400000;
function toUTC(d) {
  if (d instanceof Date) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fmt(d) { return toUTC(d).toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(toUTC(d).getTime() + n * MS_DAY); }
function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / MS_DAY); }
function dayOfYear(d) {
  const u = toUTC(d);
  return Math.floor((u - Date.UTC(u.getUTCFullYear(), 0, 0)) / MS_DAY);
}

// Interpolation linéaire sur une table d'ancres [[x,y],…] (x décroissants ou croissants)
function interp(table, x, ascending) {
  const t = ascending ? table : [...table].reverse(); // garantir x croissants
  if (x <= t[0][0]) return t[0][1];
  if (x >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      const r = (x - x0) / (x1 - x0);
      return y0 + r * (y1 - y0);
    }
  }
  return t[t.length - 1][1];
}

// Applique l'agressivité : ramène un multiplicateur vers 1 si prudent.
function applyAggr(mult, aggr) { return 1 + (mult - 1) * aggr; }

// ────────────────────────────────────────────────────────────
// COUCHES DE PRIX (chacune renvoie un multiplicateur)
// ────────────────────────────────────────────────────────────

// 1) Saisonnalité : courbe mensuelle continue × boost vacances scolaires
function seasonMult(date, cfg, schoolHolidays) {
  const u = toUTC(date);
  const doy = dayOfYear(u);
  const yearLen = ((u.getUTCFullYear() % 4 === 0 && u.getUTCFullYear() % 100 !== 0) || u.getUTCFullYear() % 400 === 0) ? 366 : 365;
  // position continue sur les 12 ancres (milieu de mois ≈ ancre)
  const monthMid = []; // jour-de-l'année du milieu de chaque mois
  let acc = 0;
  const dim = [31, (yearLen === 366 ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 0; m < 12; m++) { monthMid.push(acc + dim[m] / 2); acc += dim[m]; }
  // trouver l'intervalle d'ancres qui encadre doy (cyclique)
  let lo = 11, hi = 0;
  for (let m = 0; m < 12; m++) {
    if (doy >= monthMid[m]) lo = m;
  }
  hi = (lo + 1) % 12;
  const x0 = monthMid[lo];
  let x1 = monthMid[hi]; if (hi === 0) x1 += yearLen; // wrap déc→jan
  let xx = doy; if (doy < x0 && hi === 0) xx += yearLen;
  const r = Math.max(0, Math.min(1, (xx - x0) / (x1 - x0)));
  let mult = cfg.seasonByMonth[lo] + r * (cfg.seasonByMonth[hi] - cfg.seasonByMonth[lo]);

  // Vacances scolaires → boost (multiplié, borné)
  const ds = fmt(u);
  for (const h of (schoolHolidays || [])) {
    if (ds >= h.start && ds <= h.end) { mult *= (h.mult || 1.06); break; }
  }
  return mult;
}

// 2) Jour de semaine
function dowMult(date, cfg, dowOverride) {
  const dow = toUTC(date).getUTCDay();
  return (dowOverride || cfg.dow)[dow];
}

// 3) Lead-time
function leadMult(daysUntil, cfg) {
  return interp(cfg.leadCurve, Math.max(0, daysUntil), false);
}

// 4) Pacing : ta vraie occupation vs courbe idéale, sur une fenêtre glissante
function pacingMult(date, today, bookedSet, cfg) {
  const daysUntil = daysBetween(today, date);
  if (daysUntil < 0) return 1;
  const w = cfg.pacingWindowDays;
  let total = 0, booked = 0;
  for (let k = -w; k <= w; k++) {
    const dd = addDays(date, k);
    if (daysBetween(today, dd) < 0) continue; // ignore le passé
    total++;
    if (bookedSet.has(fmt(dd))) booked++;
  }
  if (total === 0) return 1;
  const localOcc = booked / total;
  const expected = interp(cfg.idealPickup, Math.max(1, daysUntil), false);
  // ratio > 1 = en avance (on monte), < 1 = en retard (on baisse)
  const ratio = expected > 0 ? localOcc / expected : 1;
  let mult = 1 + cfg.pacingGain * (ratio - 1);
  return Math.max(1 - cfg.pacingClamp, Math.min(1 + cfg.pacingClamp, mult));
}

// 5) Marché : correcteur borné vers la médiane des comparables
function marketMult(priceSoFar, market, cfg) {
  if (!market || !market.median || priceSoFar <= 0) return { mult: 1, applied: false };
  const comps = market.comparable_count || market.count || 0;
  const confidence = Math.max(0, Math.min(1,
    (comps - cfg.marketMinComps) / Math.max(1, cfg.marketFullComps - cfg.marketMinComps)
  ));
  if (confidence <= 0) return { mult: 1, applied: false };
  // écart relatif entre notre prix et la médiane marché
  let shift = (market.median / priceSoFar) - 1;
  shift = Math.max(-cfg.marketMaxShift, Math.min(cfg.marketMaxShift, shift));
  let mult = 1 + cfg.marketWeight * confidence * shift;
  // petit nudge selon la tension marché
  const tension = market.tension_level || market.tensionLevel;
  const nudge = { high: 1, elevated: 0.5, medium: 0, low: -0.5, very_low: -1 }[tension] ?? 0;
  mult *= 1 + nudge * cfg.marketTensionNudge;
  return { mult, applied: true, confidence: Math.round(confidence * 100) / 100 };
}

// 6) Événements : prend le boost max parmi les événements couvrant la date
function eventMult(date, events) {
  const ds = fmt(date);
  let best = 1, label = null;
  for (const e of (events || [])) {
    if (ds >= e.start && ds <= e.end && (e.mult || 1) > best) { best = e.mult; label = e.label; }
  }
  return { mult: best, label };
}

// 7) Gap-fill : détecte une nuit orpheline (trou court entre 2 résas)
function isOrphanGap(date, bookedSet, cfg) {
  if (bookedSet.has(fmt(date))) return false; // déjà réservée
  // longueur du trou libre autour de la date
  let left = 0, right = 0;
  for (let k = 1; k <= cfg.gapMaxNights + 1; k++) {
    if (!bookedSet.has(fmt(addDays(date, -k)))) left++; else break;
  }
  for (let k = 1; k <= cfg.gapMaxNights + 1; k++) {
    if (!bookedSet.has(fmt(addDays(date, k)))) right++; else break;
  }
  const gapLen = left + right + 1;
  const boundedLeft  = bookedSet.has(fmt(addDays(date, -(left + 1))));
  const boundedRight = bookedSet.has(fmt(addDays(date, (right + 1))));
  return gapLen <= cfg.gapMaxNights && boundedLeft && boundedRight;
}

// Min-stay dynamique
function minStayFor(daysUntil, orphan, cfg) {
  if (orphan) return 1;
  if (daysUntil >= cfg.minStayFarDays) return cfg.minStayFar;
  if (daysUntil >= cfg.minStayNearDays) return cfg.minStayMid;
  return cfg.minStayNear;
}

// ────────────────────────────────────────────────────────────
// PRIX D'UNE NUIT (avec breakdown complet)
// ────────────────────────────────────────────────────────────
function computeNightPrice(date, ctx) {
  const cfg = ctx.cfg;
  const aggr = cfg.aggressiveness;
  const daysUntil = daysBetween(ctx.today, date);

  const base = ctx.basePrice;

  // jour de semaine (avec ven/sam dérivés de weekend_price si fourni)
  let dowArr = cfg.dow;
  if (ctx.weekendPrice && ctx.basePrice) {
    const wr = ctx.weekendPrice / ctx.basePrice;
    dowArr = [...cfg.dow]; dowArr[5] = wr; dowArr[6] = wr;
  }

  const fSeasonRaw = seasonMult(date, cfg, ctx.schoolHolidays);
  const fDow       = dowMult(date, cfg, dowArr);
  const fLeadRaw   = leadMult(daysUntil, cfg);
  const fPaceRaw   = pacingMult(date, ctx.today, ctx.bookedSet, cfg);
  const evt        = eventMult(date, ctx.events);
  const orphan     = isOrphanGap(date, ctx.bookedSet, cfg);

  // structurels (saison/dow) à plein, dynamiques modulés par l'agressivité
  const fSeason = fSeasonRaw;
  const fLead   = applyAggr(fLeadRaw, aggr);
  const fPace   = applyAggr(fPaceRaw, aggr);
  const fEvent  = applyAggr(evt.mult, aggr);

  // prix avant marché
  let price = base * fSeason * fDow * fLead * fPace * fEvent;

  // correcteur marché (borné), appliqué sur le prix déjà construit
  const mk = marketMult(price, ctx.market, cfg);
  const fMarket = applyAggr(mk.mult, aggr);
  price *= fMarket;

  // gap-fill
  const fGap = orphan ? cfg.gapFillMult : 1;
  price *= fGap;

  const rawBeforeClamp = price;
  const clamped = Math.min(ctx.priceMax, Math.max(ctx.priceMin, price));
  const finalPrice = Math.round(clamped);

  const minStay = minStayFor(daysUntil, orphan, cfg);

  // raison lisible (le facteur le plus marquant)
  const reason = pickReason({ fSeason, fDow, fLead, fPace, fMarket, fEvent, fGap, evt, orphan });

  return {
    date: fmt(date),
    dow: toUTC(date).getUTCDay(),
    daysUntil,
    price: finalPrice,
    minStay,
    booked: ctx.bookedSet.has(fmt(date)),
    reason,
    breakdown: {
      base,
      season:  round3(fSeason),
      dow:     round3(fDow),
      lead:    round3(fLead),
      pacing:  round3(fPace),
      market:  round3(fMarket),
      event:   round3(fEvent),
      gap:     round3(fGap),
      rawBeforeClamp: Math.round(rawBeforeClamp),
      clampedToMin: clamped !== rawBeforeClamp && clamped === ctx.priceMin,
      clampedToMax: clamped !== rawBeforeClamp && clamped === ctx.priceMax,
      marketConfidence: mk.confidence ?? null,
      eventLabel: evt.label || null,
    },
  };
}

function round3(x) { return Math.round(x * 1000) / 1000; }

function pickReason({ fSeason, fDow, fLead, fPace, fMarket, fEvent, fGap, evt, orphan }) {
  if (orphan) return 'Nuit orpheline — remise pour combler le trou';
  if (evt.label && fEvent > 1.03) return `Événement : ${evt.label}`;
  const cands = [
    ['Forte demande sur tes dates (pacing)', fPace],
    ['Faible demande — incitation', 2 - fPace],
    ['Haute saison', fSeason],
    ['Premium week-end', fDow],
    ['Marché tendu', fMarket],
    ['Last-minute', 2 - fLead],
    ['Réservation lointaine', fLead],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][0];
}

// ────────────────────────────────────────────────────────────
// PLANNING COMPLET (J → J+horizon) + lissage anti-yo-yo
// ────────────────────────────────────────────────────────────
function buildSchedule(rawCtx) {
  const cfg = { ...DEFAULTS, ...(rawCtx.cfg || {}) };
  const ctx = {
    ...rawCtx,
    cfg,
    today: toUTC(rawCtx.today || new Date()),
    bookedSet: rawCtx.bookedSet instanceof Set ? rawCtx.bookedSet : new Set(rawCtx.bookedDates || []),
    priceMin: rawCtx.priceMin ?? 30,
    priceMax: rawCtx.priceMax ?? 1000,
    events: rawCtx.events || [],
    schoolHolidays: rawCtx.schoolHolidays || [],
  };

  const out = [];
  for (let i = 0; i < cfg.horizonDays; i++) {
    const date = addDays(ctx.today, i);
    out.push(computeNightPrice(date, ctx));
  }

  // Lissage : limite la variation d'une nuit à la suivante (hors nuits booké/orphelines)
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1], cur = out[i];
    if (cur.booked || cur.breakdown.gap < 1) continue;
    const maxUp = prev.price * (1 + cfg.maxDailyJump);
    const maxDn = prev.price * (1 - cfg.maxDailyJump);
    if (cur.price > maxUp) cur.price = Math.round(Math.min(ctx.priceMax, maxUp));
    else if (cur.price < maxDn) cur.price = Math.round(Math.max(ctx.priceMin, maxDn));
  }

  return out;
}

// ────────────────────────────────────────────────────────────
// ADAPTATEUR DB : lit reservations + market_data + pricing_config
// et renvoie le planning par nuit prêt à pousser vers Channex.
// ────────────────────────────────────────────────────────────
async function buildBookedSet(pool, propertyId, today, horizonDays) {
  const end = addDays(today, horizonDays);
  const res = await pool.query(
    `SELECT TO_CHAR(start_date,'YYYY-MM-DD') AS s, TO_CHAR(end_date,'YYYY-MM-DD') AS e
       FROM reservations
      WHERE property_id = $1
        AND status NOT IN ('cancelled','canceled')
        AND end_date   > $2::date
        AND start_date < $3::date`,
    [propertyId, fmt(today), fmt(end)]
  );
  const set = new Set();
  for (const r of res.rows) {
    let d = toUTC(r.s);
    const stop = toUTC(r.e); // end exclusif (nuit de départ libre)
    while (d < stop) { set.add(fmt(d)); d = addDays(d, 1); }
  }
  return set;
}

async function priceProperty(pool, { userId, property, today, configOverride, events, schoolHolidays }) {
  today = toUTC(today || new Date());

  // base price + min/max
  const basePrice    = property.base_price != null ? parseFloat(property.base_price) : null;
  const weekendPrice = property.weekend_price != null ? parseFloat(property.weekend_price) : null;
  if (basePrice == null) throw new Error(`base_price manquant pour ${property.id}`);

  // config logement
  const cfgRow = (await pool.query(
    `SELECT * FROM pricing_config WHERE user_id = $1 AND property_id = $2`,
    [userId, property.id]
  )).rows[0] || {};
  const priceMin = cfgRow.price_min != null ? parseFloat(cfgRow.price_min) : 30;
  const priceMax = cfgRow.price_max != null ? parseFloat(cfgRow.price_max) : 1000;

  // dernier snapshot marché
  const market = (await pool.query(
    `SELECT median_price AS median, occupancy_rate, comparable_count, tension_level
       FROM market_data
      WHERE property_id = $1
      ORDER BY week_start DESC LIMIT 1`,
    [property.id]
  )).rows[0] || null;
  if (market && market.median != null) market.median = parseFloat(market.median);

  const horizonDays = (configOverride?.horizonDays) || DEFAULTS.horizonDays;
  const bookedSet = await buildBookedSet(pool, property.id, today, horizonDays);

  const schedule = buildSchedule({
    today, basePrice, weekendPrice, priceMin, priceMax,
    bookedSet, market,
    events: events || [],
    schoolHolidays: schoolHolidays || [],
    cfg: { ...(configOverride || {}) },
  });

  return {
    propertyId: property.id,
    mode: cfgRow.mode || 'manual',
    isActive: cfgRow.is_active !== false,
    market,
    // nuits non réservées uniquement (les booké ne se repricent pas)
    rates: schedule.filter(n => !n.booked).map(n => ({ date: n.date, price: n.price })),
    restrictions: schedule.filter(n => !n.booked).map(n => ({ date: n.date, min_stay: n.minStay })),
    schedule, // détail complet (breakdown) pour l'UI "pourquoi ce prix"
  };
}

// ────────────────────────────────────────────────────────────
// EXEMPLES de données calendrier (À REMPLACER par tes vraies dates).
// Vacances scolaires zone C (IDF) + quelques événements parisiens.
// ────────────────────────────────────────────────────────────
const SCHOOL_HOLIDAYS_IDF_2025_2026 = [
  { start: '2025-10-18', end: '2025-11-02', mult: 1.05, label: 'Toussaint' },
  { start: '2025-12-20', end: '2026-01-04', mult: 1.10, label: 'Noël' },
  { start: '2026-02-14', end: '2026-03-01', mult: 1.06, label: 'Hiver C' },
  { start: '2026-04-11', end: '2026-04-26', mult: 1.06, label: 'Printemps C' },
  { start: '2026-07-04', end: '2026-08-31', mult: 1.08, label: 'Été' },
];
const EVENTS_PARIS_2026 = [
  { start: '2026-05-24', end: '2026-06-07', mult: 1.18, label: 'Roland-Garros' },
  { start: '2026-09-26', end: '2026-10-04', mult: 1.15, label: 'Fashion Week' },
  // ➕ Ajoute ici tes salons Villepinte / concerts La Défense Arena, etc.
];

// ────────────────────────────────────────────────────────────
// DÉMO (node routes/pricing-engine.js)
// ────────────────────────────────────────────────────────────
if (require.main === module) {
  const today = new Date('2026-06-22');
  // simule quelques réservations existantes
  const bookedDates = [];
  const push = (s, n) => { for (let k = 0; k < n; k++) bookedDates.push(fmt(addDays(s, k))); };
  push('2026-06-26', 3);   // un week-end proche déjà pris
  push('2026-07-10', 5);   // un séjour en juillet
  push('2026-06-24', 1); push('2026-06-23', 1); // crée une nuit orpheline le 25 ? non : 25 libre entre 24 et 26 → orphelin

  const sched = buildSchedule({
    today,
    basePrice: 90,
    weekendPrice: 115,
    priceMin: 60,
    priceMax: 260,
    bookedDates,
    market: { median: 104, comparable_count: 52, tension_level: 'elevated', occupancy_rate: 71 },
    events: EVENTS_PARIS_2026,
    schoolHolidays: SCHOOL_HOLIDAYS_IDF_2025_2026,
    cfg: { aggressiveness: 0.85 },
  });

  console.log('\n=== 16 prochaines nuits ===');
  console.log('date       j  €    minN  statut   raison');
  for (const n of sched.slice(0, 16)) {
    const tag = n.booked ? 'BOOKÉ ' : (n.breakdown.gap < 1 ? 'GAP   ' : '      ');
    console.log(
      `${n.date}  ${String(n.dow)}  ${String(n.price).padStart(3)}€  ${n.minStay}     ${tag}  ${n.reason}`
    );
  }

  console.log('\n=== détail d\'une nuit (pourquoi ce prix) ===');
  const sample = sched.find(n => !n.booked && n.breakdown.event > 1.03) || sched[5];
  console.log(sample.date, '→', sample.price + '€');
  console.log(sample.breakdown);

  console.log('\n=== moyenne mensuelle sur 1 an ===');
  const byMonth = {};
  for (const n of sched) {
    if (n.booked) continue;
    const m = n.date.slice(0, 7);
    (byMonth[m] = byMonth[m] || []).push(n.price);
  }
  for (const m of Object.keys(byMonth).sort()) {
    const arr = byMonth[m];
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const min = Math.min(...arr), max = Math.max(...arr);
    console.log(`${m}  moy ${String(avg).padStart(3)}€   (min ${min} / max ${max})`);
  }
  console.log('');
}

module.exports = {
  DEFAULTS,
  buildSchedule,
  computeNightPrice,
  priceProperty,
  buildBookedSet,
  // couches exposées pour tests unitaires
  seasonMult, dowMult, leadMult, pacingMult, marketMult, eventMult, isOrphanGap, minStayFor,
  SCHOOL_HOLIDAYS_IDF_2025_2026, EVENTS_PARIS_2026,
};
