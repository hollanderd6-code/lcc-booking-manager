// ============================================
// 🤖 CONFIGURATION RÉPONSES AUTOMATIQUES MULTILINGUES
// ============================================

/**
 * Mots-clés multilingues
 */
const KEYWORDS_BY_LANGUAGE = {
  fr: {
    access: ['code', 'accès', 'entrer', 'clé', 'clef', 'arriver', 'check-in', 'checkin'],
    wifi: ['wifi', 'wi-fi', 'internet', 'connexion', 'mot de passe wifi', 'mdp wifi'],
    checkout: ['check-out', 'checkout', 'départ', 'partir', 'quitter', 'fin'],
    parking: ['parking', 'voiture', 'garer', 'stationner'],
    restaurants: ['restaurant', 'courses', 'supermarché', 'commerce', 'manger'],
    issue: ['ne marche pas', 'panne', 'cassé', 'problème', 'bug'],
    housekeeping: ['serviettes', 'draps', 'linge', 'ménage'],
    temperature: ['chauffage', 'clim', 'climatisation', 'chaud', 'froid'],
    thanks: ['merci', 'super', 'génial', 'parfait', 'excellent']
  },
  en: {
    access: ['code', 'access', 'enter', 'key', 'arrive', 'check-in', 'checkin'],
    wifi: ['wifi', 'wi-fi', 'internet', 'connection', 'password'],
    checkout: ['check-out', 'checkout', 'leave', 'leaving', 'departure'],
    parking: ['parking', 'car', 'park'],
    restaurants: ['restaurant', 'grocery', 'supermarket', 'shop', 'eat'],
    issue: ['not working', 'broken', 'problem', 'issue', 'bug'],
    housekeeping: ['towels', 'sheets', 'linen', 'cleaning'],
    temperature: ['heating', 'ac', 'air conditioning', 'hot', 'cold'],
    thanks: ['thank', 'thanks', 'great', 'perfect', 'excellent']
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
 */
const RESPONSES = {
  fr: {
    access: (property) => `Bonjour ! 👋\n\nVous trouverez toutes les informations d'accès (code, instructions détaillées) dans votre livret d'accueil :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}\n\nBon séjour ! ✨`,
    wifi: (property) => property.wifi_name && property.wifi_password 
      ? `📶 Informations WiFi :\n\nRéseau : ${property.wifi_name}\nMot de passe : ${property.wifi_password}\n\nVous retrouverez ces infos dans le livret : ${property.welcome_book_url || ''}`
      : `Vous trouverez les informations WiFi dans votre livret d'accueil :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}`,
    checkout: (property) => `L'heure de départ est à ${property.departure_time || '11h00'}.\n\nVous trouverez la procédure complète de départ dans votre livret :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}\n\nMerci pour votre séjour ! 😊`,
    parking: (property) => `🚗 Informations parking :\n\nVous trouverez toutes les infos (emplacement, accès) dans votre livret d'accueil :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}`,
    restaurants: (property) => `🍽️ Nos recommandations (restaurants, commerces) se trouvent dans le livret :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}\n\nBon appétit ! 😋`,
    issue: () => `Nous sommes vraiment désolés pour ce désagrément ! 😔\n\nVotre message a été transmis au propriétaire qui vous répondra dans les plus brefs délais.\n\nMerci de votre patience ! 🙏`,
    housekeeping: (property) => `🛏️ Draps et serviettes sont fournis.\n\nVous trouverez tous les détails dans votre livret :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}`,
    temperature: (property) => `🌡️ Instructions pour le chauffage/climatisation :\n\nConsultez la section "Équipements" de votre livret :\n\n${property.welcome_book_url || '(Le livret sera bientôt disponible)'}`,
    thanks: () => `Merci beaucoup ! 😊\n\nN'hésitez pas si vous avez d'autres questions !`
  },
  en: {
    access: (property) => `Hello! 👋\n\nYou'll find all access information (code, detailed instructions) in your welcome booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}\n\nEnjoy your stay! ✨`,
    wifi: (property) => property.wifi_name && property.wifi_password
      ? `📶 WiFi Information:\n\nNetwork: ${property.wifi_name}\nPassword: ${property.wifi_password}\n\nYou'll find this info in the booklet: ${property.welcome_book_url || ''}`
      : `You'll find WiFi information in your welcome booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}`,
    checkout: (property) => `Check-out time is ${property.departure_time || '11:00 AM'}.\n\nYou'll find the complete departure procedure in your booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}\n\nThank you for your stay! 😊`,
    parking: (property) => `🚗 Parking information:\n\nYou'll find all details (location, access) in your welcome booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}`,
    restaurants: (property) => `🍽️ Our recommendations (restaurants, shops) are in the booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}\n\nEnjoy! 😋`,
    issue: () => `We're truly sorry for the inconvenience! 😔\n\nYour message has been forwarded to the owner who will respond as soon as possible.\n\nThank you for your patience! 🙏`,
    housekeeping: (property) => `🛏️ Sheets and towels are provided.\n\nYou'll find all details in your booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}`,
    temperature: (property) => `🌡️ Heating/AC instructions:\n\nCheck the "Equipment" section of your booklet:\n\n${property.welcome_book_url || '(Booklet will be available soon)'}`,
    thanks: () => `Thank you very much! 😊\n\nFeel free to ask if you have other questions!`
  }
  // Vous pouvez ajouter ES, DE, IT si nécessaire, sinon Groq AI prendra le relais
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
  
  if (category === 'issue' || category === 'thanks') {
    return responseFunc();
  }
  
  return responseFunc(property);
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
