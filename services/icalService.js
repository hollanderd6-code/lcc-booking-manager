// services/icalService.js
const ical = require('node-ical');
const moment = require('moment-timezone');

const DEFAULT_TZ = process.env.APP_TIMEZONE || 'Europe/Paris';

/**
 * Devine la plateforme en fonction de l'URL iCal
 */
function detectSourceFromUrl(url) {
  const lower = (url || '').toLowerCase();
  if (lower.includes('airbnb')) return 'AIRBNB';
  if (lower.includes('booking')) return 'BOOKING';
  return 'ICAL';
}

/**
 * Extraire la plateforme depuis un objet ou string
 */
function extractSource(item) {
  if (!item) return 'ICAL';
  
  if (typeof item === 'object' && item.platform) {
    return item.platform.toUpperCase();
  }
  
  if (typeof item === 'object' && item.url) {
    return detectSourceFromUrl(item.url);
  }
  
  if (typeof item === 'string') {
    return detectSourceFromUrl(item);
  }
  
  return 'ICAL';
}

function extractGuestName(ev) {
  const summary = (ev.summary || '').toString();
  const description = (ev.description || '').toString();

  let guestName = null;

  let m = summary.match(/Réservation\s*:\s*(.+)$/i);
  if (m) {
    guestName = m[1].trim();
  }

  if (!guestName) {
    m = description.match(/Guest:\s*([^\n]+)/i);
    if (m) {
      guestName = m[1].trim();
    }
  }

  if (!guestName && summary) {
    guestName = summary.trim();
  }

  return guestName;
}

function mapEventToReservation(ev, source) {
  if (!ev.start || !ev.end) return null;

  const summary = (ev.summary || '').toString();
  const summaryLower = summary.toLowerCase();
  
  let guestName = extractGuestName(ev);
  
  if (source === 'BOOKING' && (summaryLower.includes('closed') || summaryLower.includes('not available'))) {
    guestName = 'Voyageur Booking';
  }

  const start = moment(ev.start).tz(DEFAULT_TZ).toISOString();
  const end   = moment(ev.end).tz(DEFAULT_TZ).toISOString();

  return {
    uid: ev.uid || ev.id || `${source}_${start}_${end}`,
    start,
    end,
    source,
    platform: source,
    type: 'ical',
    guestName,
    rawSummary: ev.summary || '',
    rawDescription: ev.description || ''
  };
}

function normalizeIcalUrls(icalUrls) {
  console.log('🔍🔍🔍 normalizeIcalUrls APPELÉE avec:', typeof icalUrls, Array.isArray(icalUrls));
  console.log('🔍🔍🔍 Contenu brut:', JSON.stringify(icalUrls));
  
  if (!Array.isArray(icalUrls)) {
    console.log('❌ icalUrls n\'est PAS un array ! Type:', typeof icalUrls);
    return [];
  }
  
  const result = icalUrls
    .map((item, index) => {
      console.log(`🔍 Item ${index}:`, typeof item, JSON.stringify(item));
      
      if (!item) {
        console.log(`  → Item ${index} est null/undefined`);
        return null;
      }
      
      if (typeof item === 'object' && item.url) {
        console.log(`  → Item ${index} est un OBJET avec url:`, item.url);
        return {
          url: item.url,
          platform: item.platform || detectSourceFromUrl(item.url)
        };
      }
      
      if (typeof item === 'string') {
        console.log(`  → Item ${index} est une STRING:`, item);
        return {
          url: item,
          platform: detectSourceFromUrl(item)
        };
      }
      
      console.log(`  → Item ${index} format inconnu !`);
      return null;
    })
    .filter(Boolean);
  
  console.log('🔍🔍🔍 normalizeIcalUrls RÉSULTAT:', JSON.stringify(result));
  return result;
}

async function fetchReservations(property) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔵 fetchReservations pour: ${property?.name || 'INCONNU'}`);
  console.log(`🔵 property.icalUrls TYPE:`, typeof property?.icalUrls);
  console.log(`🔵 property.icalUrls IS ARRAY:`, Array.isArray(property?.icalUrls));
  console.log(`🔵 property.icalUrls CONTENU:`, JSON.stringify(property?.icalUrls));
  
  const results = [];

  if (!property || !Array.isArray(property.icalUrls) || property.icalUrls.length === 0) {
    console.log(`⚠️ ${property?.name || 'Inconnu'}: Pas d'icalUrls valide`);
    return results;
  }

  const normalizedUrls = normalizeIcalUrls(property.icalUrls);
  
  console.log(`🔵 URLs normalisées (${normalizedUrls.length}):`, JSON.stringify(normalizedUrls));

  for (const item of normalizedUrls) {
    if (!item || !item.url) {
      console.log(`⚠️ Item invalide:`, item);
      continue;
    }
    
    const url = item.url;
    const source = item.platform || 'ICAL';

    console.log(`🔵 Fetch ${source}:`, url.substring(0, 80));

    try {
      const data = await ical.async.fromURL(url);
      
      console.log(`✅ Fetch OK pour ${source}`);
      
      Object.values(data).forEach(ev => {
        if (!ev || ev.type !== 'VEVENT') return;
        
        const res = mapEventToReservation(ev, source);
        if (res) {
          results.push(res);
        }
      });
    } catch (err) {
      console.error(`❌ Erreur iCal pour ${property.name}:`, err.message);
      console.error(`   URL problématique:`, url);
    }
  }

  console.log(`🎯 ${property.name} - TOTAL: ${results.length} réservations`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return results;
}

module.exports = {
  fetchReservations,
  extractSource
};
