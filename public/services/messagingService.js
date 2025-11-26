// services/messagingService.js

// ==============================
// TEMPLATES DE MESSAGES
// ==============================

const MESSAGE_TEMPLATES = {
  'welcome': {
    label: 'Bienvenue (J-7)',
    subject: 'Votre séjour approche à [PROPERTY_NAME] ✨',
    body: `Bonjour [GUEST_FIRST_NAME],

Nous avons hâte de vous accueillir à [PROPERTY_NAME] du [CHECKIN_DATE] au [CHECKOUT_DATE] ([NIGHTS] nuit(s)).

Pour préparer au mieux votre arrivée, merci de compléter votre check-in en ligne ici :
[CHECKIN_URL]

À très vite,
[HOST_SIGNATURE]`
  },

  'checkin-instructions': {
    label: 'Instructions (J-2)',
    subject: 'Infos pratiques pour votre arrivée à [PROPERTY_NAME]',
    body: `Bonjour [GUEST_FIRST_NAME],

Votre arrivée à [PROPERTY_NAME] approche 👋

Si ce n'est pas déjà fait, merci de compléter votre check-in en ligne ici :
[CHECKIN_URL]

Vous y trouverez également les infos importantes pour votre arrivée (heure, accès, etc.).

À bientôt,
[HOST_SIGNATURE]`
  },

  'reminder-checkin': {
    label: 'Rappel check-in (J-1)',
    subject: 'Petit rappel avant votre arrivée à [PROPERTY_NAME]',
    body: `Bonjour [GUEST_FIRST_NAME],

Nous vous attendons demain à [PROPERTY_NAME] 🎉

Pensez à compléter votre check-in en ligne si ce n'est pas encore fait :
[CHECKIN_URL]

Bonne soirée et à demain,
[HOST_SIGNATURE]`
  },

  'during-stay': {
    label: 'Pendant le séjour',
    subject: 'Tout se passe bien à [PROPERTY_NAME] ?',
    body: `Bonjour [GUEST_FIRST_NAME],

Nous espérons que votre séjour à [PROPERTY_NAME] se passe bien.

N'hésitez pas à nous écrire si vous avez la moindre question ou besoin de quelque chose.

Belle journée,
[HOST_SIGNATURE]`
  },

  'checkout-reminder': {
    label: 'Départ (Jour J)',
    subject: 'Votre départ de [PROPERTY_NAME]',
    body: `Bonjour [GUEST_FIRST_NAME],

Nous espérons que vous avez passé un agréable séjour à [PROPERTY_NAME] 💛

Pour votre départ aujourd'hui :
- merci de respecter l'heure de check-out prévue,
- de laisser le logement dans un état correct,
- et de déposer les clés selon les instructions indiquées.

Bon retour,
[HOST_SIGNATURE]`
  },

  'post-stay': {
    label: 'Après le séjour',
    subject: 'Merci pour votre séjour à [PROPERTY_NAME] 🙏',
    body: `Bonjour [GUEST_FIRST_NAME],

Un grand merci d'avoir séjourné à [PROPERTY_NAME].

Si tout s'est bien passé, un petit commentaire nous aide énormément pour continuer à accueillir de futurs voyageurs 🤍

Au plaisir de vous recevoir à nouveau,
[HOST_SIGNATURE]`
  }
};

// ==============================
// FONCTIONS UTILITAIRES
// ==============================

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });
}

function normalizeDay(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

// ==============================
// GÉNÉRATION D'UN MESSAGE
// ==============================

function generateQuickMessage(reservation, templateKey, customData = {}) {
  const template = MESSAGE_TEMPLATES[templateKey];
  if (!template) {
    return null;
  }

  const guestName =
    reservation.guestName ||
    reservation.guest_name ||
    reservation.name ||
    'votre voyageur';

  const firstName = guestName.split(' ')[0];

  const checkinRaw =
    reservation.start ||
    reservation.startDate ||
    reservation.checkIn ||
    reservation.checkin;

  const checkoutRaw = reservation.end;

  const checkinDate = formatDate(checkinRaw);
  const checkoutDate = formatDate(checkoutRaw);

  const nights =
    reservation.nights ||
    reservation.nightCount ||
    reservation.nbNights ||
    '';

  const propertyName =
    (reservation.property && reservation.property.name) ||
    reservation.propertyName ||
    reservation.property_name ||
    customData.propertyName ||
    'votre logement';

  const checkinUrl = customData.checkinUrl || '';
  const hostSignature =
    customData.hostSignature ||
    'L’équipe Boostinghost';

  const replacements = {
    '[GUEST_NAME]': guestName,
    '[GUEST_FIRST_NAME]': firstName,
    '[PROPERTY_NAME]': propertyName,
    '[CHECKIN_DATE]': checkinDate,
    '[CHECKOUT_DATE]': checkoutDate,
    '[NIGHTS]': nights ? String(nights) : '',
    '[CHECKIN_URL]': checkinUrl,
    '[HOST_SIGNATURE]': hostSignature
  };

  let subject = template.subject || '';
  let body = template.body || template.text || '';

  Object.entries(replacements).forEach(([token, value]) => {
    const safeValue = value || '';
    const regex = new RegExp(token, 'g');
    subject = subject.replace(regex, safeValue);
    body = body.replace(regex, safeValue);
  });

  subject = subject.replace(/\s+/g, ' ').trim();
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  return {
    subject,
    message: body
  };
}

// ==============================
// LISTES DE RÉSERVATIONS
// (utilisées par /api/messages/upcoming)
// ==============================

function getUpcomingCheckIns(reservations, offsetDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(today);
  target.setDate(target.getDate() + (offsetDays || 0));

  return reservations
    .filter(r => {
      if (!r.start) return false;
      const start = normalizeDay(r.start);
      if (!start) return false;
      return start.getTime() === target.getTime();
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function getCurrentStays(reservations) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return reservations
    .filter(r => {
      if (!r.start || !r.end) return false;
      const start = normalizeDay(r.start);
      const end = normalizeDay(r.end);
      if (!start || !end) return false;
      return start.getTime() <= today.getTime() && today.getTime() < end.getTime();
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function getUpcomingCheckOuts(reservations, offsetDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(today);
  target.setDate(target.getDate() + (offsetDays || 0));

  return reservations
    .filter(r => {
      if (!r.end) return false;
      const end = normalizeDay(r.end);
      if (!end) return false;
      return end.getTime() === target.getTime();
    })
    .sort((a, b) => new Date(a.end) - new Date(b.end));
}

module.exports = {
  MESSAGE_TEMPLATES,
  generateQuickMessage,
  getUpcomingCheckIns,
  getCurrentStays,
  getUpcomingCheckOuts
};
