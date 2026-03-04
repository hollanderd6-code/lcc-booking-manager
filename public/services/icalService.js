// services/icalService.js
const ical = require('node-ical');
const moment = require('moment-timezone');

const DEFAULT_TZ = process.env.APP_TIMEZONE || 'Europe/Paris';

/**
 * Devine la plateforme en fonction de l'URL iCal
 * (c'est juste pour afficher AIRBNB / BOOKING / ICAL)
 */
function detectSourceFromUrl(url) {
  const lower = (url || '').toLowerCase();
  if (lower.includes('airbnb')) return 'AIRBNB';
  if (lower.includes('booking')) return 'BOOKING';
  return 'ICAL';
}

/**
 * ✅ NOUVEAU : Extraire la plateforme depuis un objet ou string
 */
function extractSource(item) {
  if (!item) return 'ICAL';
  
  // Si c'est un objet avec platform
  if (typeof item === 'object' && item.platform) {
    return item.platform.toUpperCase();
  }
  
  // Si c'est un objet avec url
  if (typeof item === 'object' && item.url) {
    return detectSourceFromUrl(item.url);
  }
  
  // Si c'est une string
  if (typeof item === 'string') {
    return detectSourceFromUrl(item);
  }
  
  return 'ICAL';
}

/**
 * Essaie d'extraire le nom du voyageur à partir
 * du SUMMARY / DESCRIPTION de l'événement iCal.
 */
function extractGuestName(ev) {
  const summary = (ev.summary || '').toString();
  const description = (ev.description || '').toString();

  let guestName = null;

  // Exemple Booking : "Réservation : Jane Dupont"
  let m = summary.match(/Réservation\s*:\s*(.+)$/i);
  if (m) {
    guestName = m[1].trim();
  }

  // Exemple dans la description : "Guest: John Doe"
  if (!guestName) {
    m = description.match(/Guest:\s*([^\n]+)/i);
    if (m) {
      guestName = m[1].trim();
    }
  }

  // Si vraiment rien, on peut mettre le summary brut
  if (!guestName && summary) {
    guestName = summary.trim();
  }

  return guestName;
}

/**
 * Transforme un VEVENT iCal en "réservation" pour ton système.
 * Retourne null si l'événement doit être ignoré.
 */
function mapEventToReservation(ev, source) {
  if (!ev.start || !ev.end) return null;

  const summary = (ev.summary || '').toString();
  const summaryLower = summary.toLowerCase();

  // ⚠️ AIRBNB "Not available" : blocages automatiques (pas de vraies résas voyageurs)
  // On les GARDE dans le flux iCal pour que la détection d'annulation fonctionne
  // (quand une vraie résa disparaît du flux, cancelledForProperty la détecte)
  // mais on les marque isBlock=true pour ne PAS les insérer en DB comme résas voyageurs
  // Durée de l'événement en jours
  const startMoment = moment(ev.start);
  const endMoment = moment(ev.end);
  const durationDays = endMoment.diff(startMoment, 'days');

  // Blocage Airbnb si : 'not available' OU durée > 60 jours (bloc de disponibilité)
  const isAirbnbBlock = source === 'AIRBNB' && (
    summaryLower.includes('not available') ||
    durationDays > 60
  );
  if (isAirbnbBlock && durationDays > 60) {
    console.log("⚠️ Bloc Airbnb longue durée détecté (" + durationDays + "j): " + summary);
  }
  
  // ✅ Pour Booking : "CLOSED - Not available" = vraie réservation
  // On garde ces événements et on les marque comme réservations Booking
  let guestName = extractGuestName(ev);
  
  // Si c'est un blocage Booking, on met un nom générique
  if (source === 'BOOKING' && (summaryLower.includes('closed') || summaryLower.includes('not available'))) {
    guestName = 'Voyageur Booking';  // Nom générique car Booking cache les infos
  }

  const start = moment(ev.start).tz(DEFAULT_TZ).toISOString();
  const end   = moment(ev.end).tz(DEFAULT_TZ).toISOString();

  return {
    uid: ev.uid || ev.id || `${source}_${start}_${end}`,
    start,
    end,
    source,                // 'AIRBNB' / 'BOOKING' / 'ICAL'
    platform: source,
    type: 'ical',          // pour distinguer des MANUEL / BLOCK
    guestName,
    isBlock: isAirbnbBlock || false,  // true = blocage automatique, ne pas sauver en DB
    rawSummary: ev.summary || '',
    rawDescription: ev.description || ''
  };
}

/**
 * ✅ CORRIGÉ : Normaliser les URLs iCal (gérer objets ET strings)
 */
function normalizeIcalUrls(icalUrls) {
  if (!Array.isArray(icalUrls)) return [];
  
  return icalUrls
    .map(item => {
      if (!item) return null;
      
      // ✅ Cas 1 : Objet {url: "...", platform: "..."}
      if (typeof item === 'object' && item.url) {
        return {
          url: item.url,
          platform: item.platform || detectSourceFromUrl(item.url)
        };
      }
      
      // ✅ Cas 2 : String simple "https://..."
      if (typeof item === 'string') {
        return {
          url: item,
          platform: detectSourceFromUrl(item)
        };
      }
      
      return null;
    })
    .filter(Boolean);
}

/**
 * Récupère toutes les réservations iCal d'un logement
 * en parcourant toutes ses URLs iCal.
 */
async function fetchReservations(property, pool = null) {
  const results = [];

  if (!property || !Array.isArray(property.icalUrls) || property.icalUrls.length === 0) {
    return results;
  }

  // Charger les UIDs bloqués depuis la DB (si pool pg fourni)
  const blockedUids = new Set();
  if (pool) {
    try {
      const result = await pool.query(
        'SELECT uid FROM ical_blocked_uids WHERE property_id = $1 OR property_id IS NULL',
        [property.id]
      );
      if (result.rows) {
        result.rows.forEach(row => blockedUids.add(row.uid));
      }
      if (blockedUids.size > 0) {
        console.log(`🚫 ${blockedUids.size} UID(s) bloqué(s) pour ${property.name}`);
      }
    } catch (e) {
      console.warn('⚠️ Impossible de charger ical_blocked_uids:', e.message);
    }
  }

  // ✅ Normaliser les URLs (gérer objets ET strings)
  const normalizedUrls = normalizeIcalUrls(property.icalUrls);

  for (const item of normalizedUrls) {
    if (!item || !item.url) continue;
    
    const url = item.url;
    const source = item.platform || 'ICAL';

    try {
      const data = await ical.async.fromURL(url);
      
      Object.values(data).forEach(ev => {
        if (!ev || ev.type !== 'VEVENT') return;

        // Vérifier si l'UID est bloqué
        if (ev.uid && blockedUids.has(ev.uid)) {
          console.log(`🚫 UID bloqué ignoré : ${ev.uid}`);
          return;
        }
        
        const res = mapEventToReservation(ev, source);
        if (res) {
          results.push(res);
        }
      });
    } catch (err) {
      console.error(`❌ Erreur iCal pour ${property.name} (${url}):`, err.message);
    }
  }

  // ✅ Filtrer les blocs iCal qui chevauchent des résas manuelles/directes en DB
  // Evite les faux blocs Airbnb générés quand une résa directe est détectée
  if (pool && results.length > 0) {
    try {
      const manualRes = await pool.query(
        "SELECT start_date, end_date FROM reservations WHERE property_id = \$1 AND source IN ('MANUEL', 'DIRECT') AND status != 'cancelled'",
        [property.id]
      );
      if (manualRes.rows.length > 0) {
        const before = results.length;
        results.forEach(r => {
          if (r.isBlock) return; // déjà marqué
          const rStart = new Date(r.start);
          const rEnd   = new Date(r.end);
          for (const m of manualRes.rows) {
            const mStart = new Date(m.start_date);
            const mEnd   = new Date(m.end_date);
            // Chevauchement : le bloc iCal est entièrement contenu dans la résa manuelle
            if (rStart >= mStart && rEnd <= mEnd && r.source === 'AIRBNB') {
              r.isBlock = true;
              console.log('⚠️ Bloc Airbnb chevauche résa directe, ignoré : ' + r.uid);
              // Auto-bloquer en DB pour éviter les rechargements
              try {
                await pool.query(
                  "INSERT INTO ical_blocked_uids (uid, property_id, reason) VALUES (, , ) ON CONFLICT (uid) DO NOTHING",
                  [r.uid, property.id, 'Bloc Airbnb auto-détecté (chevauchement résa directe)']
                );
              } catch(_e) {}
              break;
            }
          }
        });
        const filtered = results.filter(r => !r.isBlock).length;
        if (filtered < before) console.log('🚫 ' + (before - filtered) + ' bloc(s) Airbnb filtrés (chevauchement résa directe)');
      }
    } catch(e) {
      console.warn('⚠️ Erreur filtre chevauchement:', e.message);
    }
  }

  return results;
}

module.exports = {
  fetchReservations,
  extractSource  // ✅ Exporter pour utilisation dans server.js
};
