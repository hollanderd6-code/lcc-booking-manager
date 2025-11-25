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
 */
function mapEventToReservation(ev, source) {
  if (!ev.start || !ev.end) return null;

  const start = moment(ev.start).tz(DEFAULT_TZ).toISOString();
  const end   = moment(ev.end).tz(DEFAULT_TZ).toISOString();
  const guestName = extractGuestName(ev);

  return {
    uid: ev.uid || ev.id || `${source}_${start}_${end}`,
    start,
    end,
    source,                // 'AIRBNB' / 'BOOKING' / 'ICAL'
    platform: source,
    type: 'ical',          // pour distinguer des MANUEL / BLOCK
    guestName,             // 👈 c'est ce champ qui nous intéresse
    rawSummary: ev.summary || '',
    rawDescription: ev.description || ''
  };
}

/**
 * Récupère toutes les réservations iCal d'un logement
 * en parcourant toutes ses URLs iCal.
 */
async function fetchReservations(property) {
  const results = [];

  if (!property || !Array.isArray(property.icalUrls) || property.icalUrls.length === 0) {
    return results;
  }

  for (const url of property.icalUrls) {
    if (!url) continue;

    const source = detectSourceFromUrl(url);

    try {
      const data = await ical.async.fromURL(url);

      Object.values(data).forEach(ev => {
        if (!ev || ev.type !== 'VEVENT') return;
        const res = mapEventToReservation(ev, source);
        if (res) {
          results.push(res);
        }
      });
    } catch (err) {
      console.error(`❌ Erreur iCal pour ${property.name} (${url}):`, err.message);
    }
  }

  return results;
}

module.exports = {
  fetchReservations
};
