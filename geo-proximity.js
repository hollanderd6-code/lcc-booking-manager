// ============================================================
// 📍 GEO-PROXIMITY — Recherche de lieux proches via Google Places
// Donne à l'IA de VRAIES données de proximité (supermarché,
// pharmacie, gare, parc, restaurant...) au lieu d'inventer.
// Utilise l'endpoint Text Search (1 appel, pas besoin de géocoder).
// ============================================================

const fetch = require('node-fetch');

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || null;

// ── Détection d'intention de proximité ───────────────────────
// Renvoie { isProximity: bool, query: string|null } à partir du
// message du voyageur. On reste large (sport, parc, gare, etc.).
const PROXIMITY_TERMS = [
  // FR
  'supermarché','supermarche','épicerie','epicerie','superette','supérette',
  'pharmacie','boulangerie','distributeur','dab','retrait','cash',
  'restaurant','resto','manger','bar','café','cafe','boire',
  'gare','métro','metro','tram','bus','arrêt','arret','station',
  'parc','jardin','plage','piscine','salle de sport','gym','fitness',
  'hôpital','hopital','médecin','medecin','clinique','urgences','laverie','pressing',
  'tabac','bureau de tabac','poste','banque','centre commercial','commerce','magasin',
  'à proximité','a proximite','proche','près d','pres d','près de','pres de',
  'aux alentours','dans le coin','le plus proche','la plus proche','où trouver',
  'ou trouver','où acheter','ou acheter','où est','ou est',
  // EN
  'supermarket','grocery','pharmacy','bakery','atm','restaurant','where to eat',
  'station','metro','subway','park','gym','swimming','hospital','laundry',
  'nearby','closest','nearest','close to','where can i',
  // IT
  'supermercato','farmacia','panetteria','ristorante','stazione','parco','vicino','più vicino',
  // ES
  'supermercado','farmacia','panadería','panaderia','restaurante','estación','estacion','cerca','más cercano','mas cercano',
  // DE
  'supermarkt','apotheke','bäckerei','baeckerei','restaurant','bahnhof','park','nähe','naehe','nächste','naechste',
];

function detectProximityIntent(message) {
  if (!message || typeof message !== 'string') return { isProximity: false, query: null };
  const lower = message.toLowerCase();
  const hit = PROXIMITY_TERMS.some(t => lower.includes(t));
  return { isProximity: hit, query: hit ? message.trim() : null };
}

// ── Recherche Google Places (Text Search) ────────────────────
// Renvoie une liste compacte [{ name, address, rating, openNow }]
async function searchNearby(addressText, userQuery, maxResults = 3) {
  if (!PLACES_KEY) {
    console.warn('⚠️ [GEO] GOOGLE_PLACES_API_KEY absente — recherche proximité désactivée');
    return null;
  }
  if (!addressText) return null;

  // Construire une requête textuelle : "<demande voyageur> près de <adresse>"
  // Text Search comprend le langage naturel, on lui passe la demande + l'ancrage géographique.
  const q = `${userQuery} près de ${addressText}`;
  const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
    + `?query=${encodeURIComponent(q)}`
    + `&language=fr`
    + `&key=${PLACES_KEY}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('⚠️ [GEO] Places status:', data.status, data.error_message || '');
      return null;
    }
    const results = (data.results || []).slice(0, maxResults).map(r => ({
      name:    r.name,
      address: r.formatted_address || r.vicinity || null,
      rating:  r.rating || null,
      openNow: r.opening_hours?.open_now,
    }));
    return results;
  } catch (e) {
    console.warn('⚠️ [GEO] Erreur Places:', e.message);
    return null;
  }
}

// ── Formatage pour injection dans le prompt IA ───────────────
function formatForPrompt(results, userQuery) {
  if (!results || results.length === 0) {
    return `RÉSULTATS PROXIMITÉ (recherche en temps réel) : aucun lieu trouvé pour "${userQuery}". Indique au voyageur que tu n'as pas trouvé de résultat fiable et propose de vérifier avec l'hôte.`;
  }
  const lines = results.map((r, i) => {
    let line = `${i + 1}. ${r.name}`;
    if (r.address) line += ` — ${r.address}`;
    if (r.rating)  line += ` (note ${r.rating}/5)`;
    if (r.openNow === true)  line += ' — ouvert actuellement';
    if (r.openNow === false) line += ' — fermé actuellement';
    return line;
  });
  return `RÉSULTATS PROXIMITÉ (recherche Google en temps réel — données FIABLES, tu peux les communiquer) :
${lines.join('\n')}

Consigne : présente ces lieux au voyageur de façon naturelle et concise. Tu peux donner les noms et adresses car ils sont réels. N'invente PAS de distance ou de temps de trajet précis (Google ne nous les donne pas ici) — dis simplement qu'ils sont à proximité, ou donne l'adresse pour qu'il s'y repère.`;
}

// ── Point d'entrée principal ─────────────────────────────────
// Appelé par le handler. Renvoie un bloc texte à injecter dans
// le contexte, ou null si pas pertinent / indisponible.
async function getProximityContext(message, addressText) {
  const { isProximity, query } = detectProximityIntent(message);
  if (!isProximity) return null;
  if (!addressText) return null; // pas d'adresse → on ne peut pas localiser
  const results = await searchNearby(addressText, query, 3);
  if (results === null) return null; // erreur/clé absente → ne rien injecter
  return formatForPrompt(results, query);
}

module.exports = {
  detectProximityIntent,
  searchNearby,
  getProximityContext,
};
