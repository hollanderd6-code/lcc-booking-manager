// services/reservationDiff.js

function getReservationKey(res) {
  if (!res) return '';

  // 1) si l’API a un id, on l’utilise
  if (res.id || res._id) {
    return String(res.id || res._id);
  }

  // 2) fallback : concat de propriétés pour identifier une resa
  const propertyId =
    (res.property && (res.property.id || res.property._id)) ||
    res.propertyId ||
    res.property_id ||
    '';
  const source = res.source || res.channel || '';
  const start =
    res.start ||
    res.checkIn ||
    res.checkin ||
    res.startDate ||
    res.start_date ||
    '';
  const end =
    res.end ||
    res.checkOut ||
    res.checkout ||
    res.endDate ||
    res.end_date ||
    '';
  const guest =
    (res.guestName ||
      res.guest_name ||
      res.guest ||
      res.name ||
      '').toLowerCase();

  return [propertyId, source, start, end, guest].join('|');
}

/**
 * Compare deux listes de réservations et renvoie :
 *  - created : présentes dans newList mais pas dans oldList
 *  - deleted : présentes dans oldList mais pas dans newList
 */
function diffReservations(oldList, newList) {
  const oldMap = new Map();
  const newMap = new Map();

  (oldList || []).forEach((r) => {
    const key = getReservationKey(r);
    if (key) oldMap.set(key, r);
  });

  (newList || []).forEach((r) => {
    const key = getReservationKey(r);
    if (key) newMap.set(key, r);
  });

  const created = [];
  const deleted = [];

  // Nouvelles : dans newMap mais pas dans oldMap
  for (const [key, res] of newMap.entries()) {
    if (!oldMap.has(key)) {
      created.push(res);
    }
  }

  // Annulées : dans oldMap mais pas dans newMap
  for (const [key, res] of oldMap.entries()) {
    if (!newMap.has(key)) {
      deleted.push(res);
    }
  }

  return { created, deleted };
}

module.exports = {
  diffReservations,
  getReservationKey,
};
