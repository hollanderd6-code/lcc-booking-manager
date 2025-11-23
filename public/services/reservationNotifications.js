// services/reservationNotifications.js
const { diffReservations } = require('./reservationDiff');
const { sendEmail } = require('./email');

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function buildNewReservationEmail(reservation, { ownerName } = {}) {
  const propertyName =
    (reservation.property && reservation.property.name) ||
    reservation.propertyName ||
    'Votre logement';
  const source = reservation.source || 'une plateforme';
  const guest =
    reservation.guestName ||
    reservation.guest ||
    reservation.name ||
    'Un voyageur';
  const start =
    reservation.start ||
    reservation.startDate ||
    reservation.checkIn ||
    reservation.checkin;
  const end =
    reservation.end ||
    reservation.endDate ||
    reservation.checkOut ||
    reservation.checkout;

  const checkin = formatDate(start);
  const checkout = formatDate(end);

  const subject = `🛎️ Nouvelle réservation – ${propertyName}`;
  const hello = ownerName ? `Bonjour ${ownerName},` : 'Bonjour,';

  const text = `${hello}

Une nouvelle réservation vient d'être enregistrée sur ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
Séjour  : du ${checkin} au ${checkout}

Vous pouvez retrouver tous les détails dans votre tableau de bord Boostinghost.`;

  const html = `
    <p>${hello}</p>
    <p>Une nouvelle réservation vient d'être enregistrée sur <strong>${source}</strong>.</p>
    <ul>
      <li><strong>Logement :</strong> ${propertyName}</li>
      <li><strong>Voyageur :</strong> ${guest}</li>
      <li><strong>Séjour :</strong> du ${checkin} au ${checkout}</li>
    </ul>
    <p>Vous pouvez retrouver tous les détails dans votre tableau de bord Boostinghost.</p>
  `;

  return { subject, text, html };
}

function buildCancelledReservationEmail(reservation, { ownerName } = {}) {
  const propertyName =
    (reservation.property && reservation.property.name) ||
    reservation.propertyName ||
    'Votre logement';
  const source = reservation.source || 'une plateforme';
  const guest =
    reservation.guestName ||
    reservation.guest ||
    reservation.name ||
    'Un voyageur';
  const start =
    reservation.start ||
    reservation.startDate ||
    reservation.checkIn ||
    reservation.checkin;
  const end =
    reservation.end ||
    reservation.endDate ||
    reservation.checkOut ||
    reservation.checkout;

  const checkin = formatDate(start);
  const checkout = formatDate(end);

  const subject = `⚠️ Réservation annulée – ${propertyName}`;
  const hello = ownerName ? `Bonjour ${ownerName},` : 'Bonjour,';

  const text = `${hello}

Une réservation vient d'être annulée sur ${source}.

Logement : ${propertyName}
Voyageur : ${guest}
Séjour initial : du ${checkin} au ${checkout}

Pensez à vérifier votre calendrier et vos blocages si nécessaire.`;

  const html = `
    <p>${hello}</p>
    <p>Une réservation vient d'être <strong>annulée</strong> sur <strong>${source}</strong>.</p>
    <ul>
      <li><strong>Logement :</strong> ${propertyName}</li>
      <li><strong>Voyageur :</strong> ${guest}</li>
      <li><strong>Séjour initial :</strong> du ${checkin} au ${checkout}</li>
    </ul>
    <p>Pensez à vérifier votre calendrier et vos blocages si nécessaire.</p>
  `;

  return { subject, text, html };
}

/**
 * Fonction principale appelée après la synchro :
 *  - compare old/new,
 *  - envoie les mails au propriétaire.
 *
 * @param {Object} params
 * @param {Array} params.oldReservations
 * @param {Array} params.newReservations
 * @param {string} params.ownerEmail
 * @param {string} [params.ownerName]
 * @param {Object} [params.notificationSettings]
 * @param {boolean} [params.notificationSettings.newReservation] default: true
 * @param {boolean} [params.notificationSettings.cancelledReservation] default: true
 */
async function handleReservationNotifications({
  oldReservations,
  newReservations,
  ownerEmail,
  ownerName,
  notificationSettings = {},
}) {
  if (!ownerEmail) {
    console.warn(
      '[notifications] Aucune adresse e-mail propriétaire fournie, notifications ignorées.'
    );
    return;
  }

  const { created, deleted } = diffReservations(
    oldReservations || [],
    newReservations || []
  );

  const doNew =
    notificationSettings.newReservation !== false; // par défaut true
  const doCancelled =
    notificationSettings.cancelledReservation !== false; // par défaut true

  const promises = [];

  if (doNew && created.length) {
    for (const res of created) {
      const { subject, text, html } = buildNewReservationEmail(res, {
        ownerName,
      });
      promises.push(
        sendEmail({
          to: ownerEmail,
          subject,
          text,
          html,
        }).catch((err) => {
          console.error(
            '[notifications] Erreur envoi e-mail nouvelle réservation :',
            err
          );
        })
      );
    }
  }

  if (doCancelled && deleted.length) {
    for (const res of deleted) {
      const { subject, text, html } = buildCancelledReservationEmail(res, {
        ownerName,
      });
      promises.push(
        sendEmail({
          to: ownerEmail,
          subject,
          text,
          html,
        }).catch((err) => {
          console.error(
            '[notifications] Erreur e-mail annulation réservation :',
            err
          );
        })
      );
    }
  }

  await Promise.all(promises);
}

module.exports = {
  handleReservationNotifications,
};
