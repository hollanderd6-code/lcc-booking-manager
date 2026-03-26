// ============================================
// 🤖 CONFIGURATION RÉPONSES AUTOMATIQUES MULTILINGUES
// ============================================

/**
 * Mots-clés multilingues
 */
const KEYWORDS_BY_LANGUAGE = {
  fr: {
    access: ['code', 'accès', 'entrer', 'clé', 'clef', 'arriver', 'arrive', 'heure d\'arrivée', 'check-in', 'checkin', 'quelle heure', 'à partir de', 'accueil'],
    wifi: ['wifi', 'wi-fi', 'internet', 'connexion', 'mot de passe', 'mdp', 'réseau'],
    checkout: ['check-out', 'checkout', 'départ', 'partir', 'quitter', 'fin de séjour', 'heure de départ'],
    parking: ['parking', 'voiture', 'garer', 'stationner'],
    restaurants: ['restaurant', 'courses', 'supermarché', 'commerce', 'manger', 'boire'],
    issue: ['ne marche pas', 'panne', 'cassé', 'problème', 'bug', 'fuite', 'bloqué', 'coincé'],
    housekeeping: ['serviettes', 'draps', 'linge', 'ménage', 'propre', 'nettoyage'],
    capacity: ['combien de personnes', 'capacité', 'chambres', 'lits', 'salle de bain', 'dormeurs'],
    temperature: ['chauffage', 'clim', 'climatisation', 'chaud', 'froid', 'thermostat'],
    thanks: ['merci', 'super', 'génial', 'parfait', 'excellent', 'top', 'nickel']
  },
  en: {
    access: ['code', 'access', 'enter', 'key', 'arrive', 'arrival', 'check-in', 'checkin', 'what time', 'when can'],
    wifi: ['wifi', 'wi-fi', 'internet', 'connection', 'password', 'network'],
    checkout: ['check-out', 'checkout', 'leave', 'leaving', 'departure', 'check out time'],
    parking: ['parking', 'car', 'park'],
    restaurants: ['restaurant', 'grocery', 'supermarket', 'shop', 'eat'],
    issue: ['not working', 'broken', 'problem', 'issue', 'bug', 'leak', 'stuck'],
    housekeeping: ['towels', 'sheets', 'linen', 'cleaning'],
    capacity: ['how many people', 'capacity', 'bedrooms', 'beds', 'bathroom'],
    temperature: ['heating', 'ac', 'air conditioning', 'hot', 'cold', 'thermostat'],
    thanks: ['thank', 'thanks', 'great', 'perfect', 'excellent', 'amazing']
  },
  es: {
    access: ['código', 'acceso', 'entrar', 'llave', 'llegar', 'check-in'],
    wifi: ['wifi', 'internet', 'conexión', 'contraseña'],
    checkout: ['salida', 'partir', 'dejar'],
    parking: ['parking', 'coche', 'aparcar'],
    restaurants: ['restaurante', 'compras', 'supermercado', 'tienda', 'comer'],
    issue: ['no funciona', 'roto', 'problema', 'avería'],
    housekeeping: ['toallas', 'sábanas', 'ropa', 'limpieza'],
    temperature: ['calefacción', 'aire acondicionado', 'calor', 'frío'],
    thanks: ['gracias', 'genial', 'perfecto', 'excelente']
  },
  de: {
    access: ['code', 'zugang', 'eintreten', 'schlüssel', 'ankommen', 'check-in'],
    wifi: ['wifi', 'internet', 'verbindung', 'passwort'],
    checkout: ['auschecken', 'abreise', 'verlassen'],
    parking: ['parkplatz', 'auto', 'parken'],
    restaurants: ['restaurant', 'einkaufen', 'supermarkt', 'geschäft', 'essen'],
    issue: ['funktioniert nicht', 'kaputt', 'problem'],
    housekeeping: ['handtücher', 'bettwäsche', 'wäsche', 'reinigung'],
    temperature: ['heizung', 'klimaanlage', 'warm', 'kalt'],
    thanks: ['danke', 'toll', 'perfekt', 'ausgezeichnet']
  },
  it: {
    access: ['codice', 'accesso', 'entrare', 'chiave', 'arrivare', 'check-in'],
    wifi: ['wifi', 'internet', 'connessione', 'password'],
    checkout: ['checkout', 'partenza', 'lasciare'],
    parking: ['parcheggio', 'auto', 'parcheggiare'],
    restaurants: ['ristorante', 'spesa', 'supermercato', 'negozio', 'mangiare'],
    issue: ['non funziona', 'rotto', 'problema'],
    housekeeping: ['asciugamani', 'lenzuola', 'biancheria', 'pulizia'],
    temperature: ['riscaldamento', 'aria condizionata', 'caldo', 'freddo'],
    thanks: ['grazie', 'fantastico', 'perfetto', 'eccellente']
  }
};

/**
 * Réponses par catégorie et par langue
 * Logique : répondre directement depuis les données du logement
 * JAMAIS donner le code d'accès avant le jour J
 */
const RESPONSES = {
  fr: {
    // Heure d'arrivée → donnée directement
    access: (property) => {
      const lines = ['Bonjour ! 👋'];
      if (property.arrival_time) {
        lines.push(`\n🕐 L'heure d'arrivée est à partir de **${property.arrival_time}**.`);
      }
      if (property.departure_time) {
        lines.push(`🕐 L'heure de départ est avant **${property.departure_time}**.`);
      }
      if (property.access_instructions) {
        lines.push(`\nℹ️ ${property.access_instructions}`);
      }
      // Code d'accès : jamais avant le jour J
      lines.push("\n🔑 Le code d'accès vous sera communiqué le jour de votre arrivée.");
      lines.push("\nN'hésitez pas si vous avez d'autres questions ! 😊");
      return lines.join('\n');
    },

    // WiFi → donné directement
    wifi: (property) => {
      if (property.wifi_name && property.wifi_password) {
        return `📶 Voici vos informations WiFi :\n\nRéseau : **${property.wifi_name}**\nMot de passe : **${property.wifi_password}**\n\nBonne connexion ! 😊`;
      }
      if (property.wifi_name) {
        return `📶 Le réseau WiFi est **${property.wifi_name}**.\nLe mot de passe vous sera communiqué à votre arrivée.`;
      }
      return null; // Pas d'info → escalade vers Groq
    },

    // Heure de départ → donnée directement
    checkout: (property) => {
      const heure = property.departure_time || '11h00';
      return `🕐 L'heure de départ est avant **${heure}**.\n\nMerci de laisser le logement propre et de déposer les clés selon les instructions reçues.\n\nMerci pour votre séjour ! 😊`;
    },

    // Draps/serviettes → depuis amenities ou réponse directe
    housekeeping: (property) => {
      const lines = [];
      try {
        const amenities = typeof property.amenities === 'string'
          ? JSON.parse(property.amenities) : (property.amenities || {});
        const provided = [];
        if (amenities.linens || amenities.sheets) provided.push('draps');
        if (amenities.towels) provided.push('serviettes');
        if (provided.length > 0) {
          lines.push(`🛏️ Les **${provided.join(' et ')}** sont fournis.`);
        } else {
          lines.push('🛏️ Le linge de lit et les serviettes sont fournis pour votre séjour.');
        }
      } catch(e) {
        lines.push('🛏️ Le linge de lit et les serviettes sont fournis pour votre séjour.');
      }
      lines.push("\nN'hésitez pas si vous avez d'autres questions ! 😊");
      return lines.join('\n');
    },

    // Capacité / infos logement
    capacity: (property) => {
      const lines = [];
      if (property.max_guests) lines.push(`👥 Le logement accueille jusqu'à **${property.max_guests} personnes**.`);
      if (property.bedrooms) lines.push(`🛏️ **${property.bedrooms} chambre${property.bedrooms > 1 ? 's' : ''}**`);
      if (property.beds) lines.push(`🛌 **${property.beds} lit${property.beds > 1 ? 's' : ''}**`);
      if (property.bathrooms) lines.push(`🚿 **${property.bathrooms} salle${property.bathrooms > 1 ? 's' : ''} de bain**`);
      if (lines.length === 0) return null;
      return lines.join('\n') + "\n\nN'hésitez pas si vous avez d'autres questions ! 😊";
    },

    // Problème → escalade directe
    issue: () => `Nous sommes vraiment désolés pour ce désagrément ! 😔\n\nVotre message a été transmis au responsable qui vous répondra dans les plus brefs délais.\n\nMerci de votre patience ! 🙏`,

    // Remerciements
    thanks: () => `Merci beaucoup ! 😊\n\nNous sommes ravis que vous appréciez votre séjour. N'hésitez pas si vous avez d'autres questions !`,

    // Parking → escalade si pas d'info
    parking: (property) => null,

    // Restaurants → escalade
    restaurants: (property) => null,

    // Température → escalade si pas d'instructions
    temperature: (property) => {
      if (property.access_instructions && property.access_instructions.toLowerCase().includes('chauffage')) {
        return `🌡️ ${property.access_instructions}`;
      }
      return null;
    }
  },

  en: {
    access: (property) => {
      const lines = ['Hello! 👋'];
      if (property.arrival_time) lines.push(`\n🕐 Check-in is from **${property.arrival_time}**.`);
      if (property.departure_time) lines.push(`🕐 Check-out is before **${property.departure_time}**.`);
      if (property.access_instructions) lines.push(`\nℹ️ ${property.access_instructions}`);
      lines.push('\n🔑 The access code will be sent to you on the day of your arrival.');
      lines.push("\nFeel free to ask if you have any other questions! 😊");
      return lines.join('\n');
    },
    wifi: (property) => {
      if (property.wifi_name && property.wifi_password) {
        return `📶 WiFi details:\n\nNetwork: **${property.wifi_name}**\nPassword: **${property.wifi_password}**\n\nEnjoy! 😊`;
      }
      return null;
    },
    checkout: (property) => `🕐 Check-out time is before **${property.departure_time || '11:00 AM'}**.\n\nThank you for your stay! 😊`,
    housekeeping: (property) => `🛏️ Bed linen and towels are provided.\n\nFeel free to ask if you need anything! 😊`,
    capacity: (property) => {
      const lines = [];
      if (property.max_guests) lines.push(`👥 The property accommodates up to **${property.max_guests} guests**.`);
      if (property.bedrooms) lines.push(`🛏️ **${property.bedrooms} bedroom${property.bedrooms > 1 ? 's' : ''}**`);
      if (lines.length === 0) return null;
      return lines.join('\n') + '\n\nFeel free to ask if you have other questions! 😊';
    },
    issue: () => `We're truly sorry for the inconvenience! 😔\n\nYour message has been forwarded to the owner who will respond as soon as possible.\n\nThank you for your patience! 🙏`,
    thanks: () => `Thank you very much! 😊\n\nWe're glad you're enjoying your stay!`,
    parking: (property) => null,
    restaurants: (property) => null,
    temperature: (property) => null
  }
};

/**
 * Détecter une catégorie depuis le message
 */
function detectCategory(message, language = 'fr') {
  const keywords = KEYWORDS_BY_LANGUAGE[language] || KEYWORDS_BY_LANGUAGE.fr;
  const lowerMessage = message.toLowerCase();

  for (const [category, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (lowerMessage.includes(word.toLowerCase())) {
        return { category, language };
      }
    }
  }

  return null;
}

/**
 * Obtenir une réponse automatique
 */
function getAutoResponse(category, language, property) {
  const responses = RESPONSES[language] || RESPONSES.fr;
  const responseFunc = responses[category];
  
  if (!responseFunc) return null;
  
  // Catégories sans données logement
  if (category === 'issue' || category === 'thanks') {
    return responseFunc();
  }
  
  const result = responseFunc(property);
  // Si null → pas assez d'infos → escalade vers Groq
  return result || null;
}

/**
 * Détecter si notification propriétaire nécessaire
 */
function needsOwnerNotification(category) {
  return category === 'issue';
}

module.exports = {
  detectCategory,
  getAutoResponse,
  needsOwnerNotification
};
