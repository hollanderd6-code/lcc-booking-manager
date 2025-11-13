const ical = require('node-ical');
const axios = require('axios');
const moment = require('moment-timezone');

const timezone = process.env.TIMEZONE || 'Europe/Paris';

/**
 * Récupère et parse les réservations depuis les URLs iCal
 */
async function fetchReservations(property) {
  const allReservations = [];
  const seenUids = new Set();
  
  for (const icalUrl of property.icalUrls) {
    if (!icalUrl) continue;
    
    try {
      // Télécharger le fichier iCal
      const response = await axios.get(icalUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'LCC-Booking-Manager/1.0'
        }
      });
      
      // Parser le contenu iCal
      const events = await ical.async.parseICS(response.data);
      
      // Convertir en format exploitable
      for (const event of Object.values(events)) {
        if (event.type === 'VEVENT') {
          const uid = event.uid || `${event.start.toISOString()}-${event.summary}`;
          
          // Éviter les doublons
          if (seenUids.has(uid)) continue;
          seenUids.add(uid);
          
          const reservation = {
            uid,
            title: event.summary || 'Réservation',
            start: moment(event.start).tz(timezone).format(),
            end: moment(event.end).tz(timezone).format(),
            description: event.description || '',
            location: event.location || '',
            status: event.status || 'CONFIRMED',
            created: event.created ? moment(event.created).format() : moment().format(),
            source: extractSource(icalUrl),
            nights: calculateNights(event.start, event.end),
            propertyId: property.id,
            propertyName: property.name,
            propertyColor: property.color
          };
          
          // Extraire des informations supplémentaires
          reservation.guestName = extractGuestName(event.summary, event.description);
          reservation.guestEmail = extractEmail(event.description);
          reservation.guestPhone = extractPhone(event.description);
          reservation.bookingId = extractBookingId(event.description, event.uid);
          
          allReservations.push(reservation);
        }
      }
      
    } catch (error) {
      console.error(`Erreur lors de la récupération de ${icalUrl}:`, error.message);
    }
  }
  
  // Trier par date de début
  allReservations.sort((a, b) => new Date(a.start) - new Date(b.start));
  
  return allReservations;
}

/**
 * Calcule le nombre de nuits
 */
function calculateNights(start, end) {
  const startDate = moment(start).startOf('day');
  const endDate = moment(end).startOf('day');
  return endDate.diff(startDate, 'days');
}

/**
 * Extrait la source de la réservation depuis l'URL
 */
function extractSource(url) {
  if (url.includes('airbnb')) return 'Airbnb';
  if (url.includes('booking')) return 'Booking.com';
  if (url.includes('vrbo')) return 'VRBO';
  if (url.includes('abritel')) return 'Abritel';
  return 'Autre';
}

/**
 * Extrait le nom du voyageur
 */
function extractGuestName(summary, description) {
  // Airbnb format: "Réservation Airbnb (John Doe)"
  const airbnbMatch = summary.match(/\(([^)]+)\)/);
  if (airbnbMatch) return airbnbMatch[1];
  
  // Booking format: chercher dans la description
  const bookingMatch = description.match(/Guest name[:\s]+([^\n]+)/i);
  if (bookingMatch) return bookingMatch[1].trim();
  
  // Format générique
  const genericMatch = description.match(/Name[:\s]+([^\n]+)/i);
  if (genericMatch) return genericMatch[1].trim();
  
  return 'Voyageur';
}

/**
 * Extrait l'email du voyageur
 */
function extractEmail(description) {
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const match = description.match(emailRegex);
  return match ? match[0] : null;
}

/**
 * Extrait le téléphone du voyageur
 */
function extractPhone(description) {
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,4}[-.\s]?\d{2,4}/;
  const match = description.match(phoneRegex);
  return match ? match[0] : null;
}

/**
 * Extrait l'ID de réservation
 */
function extractBookingId(description, uid) {
  // Vérifier que description et uid existent
  if (!description) description = '';
  if (!uid) uid = '';
  
  // Airbnb
  const airbnbMatch = description.match(/Confirmation code[:\s]+([A-Z0-9]+)/i);
  if (airbnbMatch) return airbnbMatch[1];
  
  // Booking.com
  const bookingMatch = description.match(/Booking ID[:\s]+([0-9]+)/i);
  if (bookingMatch) return bookingMatch[1];
  
  // ID générique depuis l'UID
  const uidMatch = uid.match(/[A-Z0-9]{8,}/);
  if (uidMatch) return uidMatch[0];
  
  return null;
}

/**
 * Récupère les réservations à venir
 */
function getUpcomingReservations(reservations, days = 30) {
  const now = moment();
  const futureDate = moment().add(days, 'days');
  
  return reservations.filter(r => {
    const start = moment(r.start);
    return start.isAfter(now) && start.isBefore(futureDate);
  });
}

/**
 * Récupère les réservations en cours
 */
function getCurrentReservations(reservations) {
  const now = moment();
  
  return reservations.filter(r => {
    const start = moment(r.start);
    const end = moment(r.end);
    return start.isSameOrBefore(now) && end.isSameOrAfter(now);
  });
}

/**
 * Vérifie la disponibilité pour une période donnée
 */
function checkAvailability(reservations, startDate, endDate) {
  const start = moment(startDate);
  const end = moment(endDate);
  
  const conflicts = reservations.filter(r => {
    const rStart = moment(r.start);
    const rEnd = moment(r.end);
    
    // Chevauchement si:
    // - La réservation commence pendant la période
    // - La réservation se termine pendant la période
    // - La réservation englobe toute la période
    return (
      (rStart.isBetween(start, end, null, '[)')) ||
      (rEnd.isBetween(start, end, null, '(]')) ||
      (rStart.isSameOrBefore(start) && rEnd.isSameOrAfter(end))
    );
  });
  
  return {
    available: conflicts.length === 0,
    conflicts
  };
}

module.exports = {
  fetchReservations,
  getUpcomingReservations,
  getCurrentReservations,
  checkAvailability,
  calculateNights
};
