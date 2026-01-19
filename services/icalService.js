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

/**
 * ✅ NOUVEAU : Détecter si un événement est un blocage automatique
 */
function isBlockedEvent(ev, source) {
  const summary = (ev.summary || '').toString().toLowerCase();
  const description = (ev.description || '').toString().toLowerCase();
  
  // Mots-clés indiquant un blocage
  const blockKeywords = [
    'blocked',
    'not available',
    'unavailable',
    'closed',
    'bloqué',
    'indisponible',
    'maintenance',
    'owner block',
    'propriétaire'
  ];
  
  // Vérifier si le résumé ou la description contient un mot-clé de blocage
  const hasBlockKeyword = blockKeywords.some(keyword => 
    summary.includes(keyword) || description.includes(keyword)
  );
  
  // Pour Airbnb : "Not available" est toujours un blocage
  if (source === 'AIRBNB' && (summary.includes('not available') || summary === 'busy')) {
    return true;
  }
  
  // Pour Booking : "Closed to arrival" ou "Not available" sans info voyageur
  if (source === 'BOOKING' && (
    summary.includes('closed') || 
    summary.includes('not available') ||
    summary === 'unavailable'
  )) {
    return true;
  }
  
  return hasBlockKeyword;
}

/**
 * ✅ AMÉLIORÉ : Extraire le nom du voyageur selon la plateforme
 */
function extractGuestName(ev, source) {
  const summary = (ev.summary || '').toString();
  const description = (ev.description || '').toString();

  let guestName = null;

  // ============================================
  // AIRBNB : Format "Réservation : Nom du voyageur"
  // ============================================
  if (source === 'AIRBNB') {
    let m = summary.match(/Réservation\s*:\s*(.+)$/i);
    if (m) {
      guestName = m[1].trim();
      return guestName;
    }
    
    // Autre format Airbnb : "Reserved - Nom"
    m = summary.match(/Reserved\s*-\s*(.+)$/i);
    if (m) {
      guestName = m[1].trim();
      return guestName;
    }
  }
  
  // ============================================
  // BOOKING.COM : Plusieurs formats possibles
  // ============================================
  if (source === 'BOOKING') {
    // Format 1 : Dans la description "Guest: Nom du voyageur"
    let m = description.match(/Guest:\s*([^\n]+)/i);
    if (m) {
      guestName = m[1].trim();
      return guestName;
    }
    
    // Format 2 : Dans la description "Guest name: Nom"
    m = description.match(/Guest\s*name:\s*([^\n]+)/i);
    if (m) {
      guestName = m[1].trim();
      return guestName;
    }
    
    // Format 3 : Dans le résumé, après le numéro de réservation
    // Ex: "Booking.com - 123456789 - John Doe"
    m = summary.match(/booking\.com\s*-\s*\d+\s*-\s*(.+)$/i);
    if (m) {
      guestName = m[1].trim();
      return guestName;
    }
    
    // Format 4 : Le résumé contient directement le nom (si pas "closed" ou "not available")
    if (!summary.toLowerCase().includes('closed') && 
        !summary.toLowerCase().includes('not available') &&
        summary.length > 0) {
      guestName = summary.trim();
      return guestName;
    }
  }

  // ============================================
  // AUTRES SOURCES : Chercher dans description ou résumé
  // ============================================
  
  // Dans la description : "Guest: ..."
  if (!guestName) {
    const m = description.match(/Guest:\s*([^\n]+)/i);
    if (m) {
      guestName = m[1].trim();
    }
  }

  // Par défaut : utiliser le résumé si disponible
  if (!guestName && summary) {
    guestName = summary.trim();
  }

  return guestName;
}

/**
 * ✅ AMÉLIORÉ : Mapper un événement iCal vers une réservation
 */
function mapEventToReservation(ev, source) {
  if (!ev.start || !ev.end) return null;

  const summary = (ev.summary || '').toString();
  
  // ============================================
  // 🚫 DÉTECTER LES BLOCAGES
  // ============================================
  const isBlocked = isBlockedEvent(ev, source);
  
  // Extraire le nom du voyageur
  let guestName = extractGuestName(ev, source);
  
  // Si c'est un blocage et qu'on n'a pas de nom, mettre un indicateur
  if (isBlocked && !guestName) {
    guestName = 'Bloqué';
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
    isBlocked,  // ✅ NOUVEAU : Flag pour identifier les blocages
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
      console.log(`🔎 Item ${index}:`, typeof item, JSON.stringify(item));
      
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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
      
      let blockedCount = 0;
      let reservationCount = 0;
      
      Object.values(data).forEach(ev => {
        if (!ev || ev.type !== 'VEVENT') return;
        
        const res = mapEventToReservation(ev, source);
        if (res) {
          results.push(res);
          
          // Compter les blocages vs vraies réservations
          if (res.isBlocked) {
            blockedCount++;
          } else {
            reservationCount++;
          }
        }
      });
      
      console.log(`  📊 ${source}: ${reservationCount} réservations, ${blockedCount} blocages`);
      
    } catch (err) {
      console.error(`❌ Erreur iCal pour ${property.name}:`, err.message);
      console.error(`   URL problématique:`, url);
    }
  }

  console.log(`🎯 ${property.name} - TOTAL: ${results.length} événements (réservations + blocages)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return results;
}

module.exports = {
  fetchReservations,
  extractSource,
  isBlockedEvent  // ✅ Exporter pour utilisation ailleurs
};
