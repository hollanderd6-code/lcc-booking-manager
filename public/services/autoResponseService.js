// ============================================
// SERVICE DE RÉPONSES AUTOMATIQUES
// Analyse les messages et génère des réponses basées sur les données de la propriété
// ============================================

/**
 * Catégories de questions et leurs mots-clés
 */
const QUESTION_PATTERNS = {
  // HORAIRES
  checkin: {
    keywords: ['arriver', 'arrivée', 'check-in', 'checkin', 'heure arrivée', 'quelle heure arriver', 'arrive'],
    priority: 1
  },
  checkout: {
    keywords: ['partir', 'départ', 'check-out', 'checkout', 'heure départ', 'quelle heure partir', 'libérer', 'quitter'],
    priority: 1
  },
  
  // ÉQUIPEMENTS
  draps: {
    keywords: ['draps', 'drap', 'linge de lit', 'literie'],
    priority: 2
  },
  serviettes: {
    keywords: ['serviettes', 'serviette', 'linge de toilette', 'bain'],
    priority: 2
  },
  cuisine: {
    keywords: ['cuisine', 'cuisiner', 'équipée', 'ustensiles', 'vaisselle'],
    priority: 2
  },
  lave_linge: {
    keywords: ['lave-linge', 'machine à laver', 'laver linge', 'lessive'],
    priority: 2
  },
  lave_vaisselle: {
    keywords: ['lave-vaisselle', 'lave vaisselle'],
    priority: 2
  },
  television: {
    keywords: ['télévision', 'télé', 'tv', 'netflix'],
    priority: 2
  },
  parking: {
    keywords: ['parking', 'garer', 'stationnement', 'voiture', 'se garer'],
    priority: 2
  },
  climatisation: {
    keywords: ['climatisation', 'clim', 'climatiseur', 'climatisé', 'air conditionné'],
    priority: 2
  },
  wifi: {
    keywords: ['wifi', 'wi-fi', 'internet', 'réseau', 'connexion', 'mot de passe wifi', 'code wifi'],
    priority: 1
  },
  
  // ACCÈS
  acces_code: {
    keywords: ['code', 'clé', 'clef', 'accès', 'entrer', 'porte', 'digicode', 'badge'],
    priority: 1
  },
  acces_instructions: {
    keywords: ['comment entrer', 'accéder', 'arriver au logement', 'trouver', 'adresse'],
    priority: 1
  },
  
  // RÈGLES
  animaux: {
    keywords: ['animaux', 'animal', 'chien', 'chat', 'accepté'],
    priority: 2
  },
  fumeurs: {
    keywords: ['fumer', 'fumeur', 'cigarette', 'tabac'],
    priority: 2
  },
  fetes: {
    keywords: ['fête', 'soirée', 'bruit', 'inviter', 'anniversaire'],
    priority: 2
  },
  
  // INFOS PRATIQUES
  poubelles: {
    keywords: ['poubelles', 'poubelle', 'déchets', 'ordures', 'tri'],
    priority: 3
  },
  commerces: {
    keywords: ['courses', 'supermarché', 'magasin', 'boulangerie', 'commerce', 'acheter'],
    priority: 3
  },
  transports: {
    keywords: ['métro', 'bus', 'transport', 'gare', 'station', 'tramway'],
    priority: 3
  }
};

/**
 * Nettoie et normalise un texte pour le matching
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Enlever les accents
    .replace(/[^\w\s-]/g, ' ') // Garder que lettres, chiffres, espaces et tirets
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Détecte les catégories de questions dans un message
 */
function detectQuestions(message) {
  const normalized = normalizeText(message);
  const detected = [];
  
  for (const [category, config] of Object.entries(QUESTION_PATTERNS)) {
    for (const keyword of config.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalized.includes(normalizedKeyword)) {
        detected.push({
          category,
          priority: config.priority,
          keyword
        });
        break; // Une fois trouvé, passer à la catégorie suivante
      }
    }
  }
  
  // Trier par priorité (1 = plus important)
  return detected.sort((a, b) => a.priority - b.priority);
}

/**
 * Génère une réponse basée sur les données de la propriété
 */
function generateResponse(property, detectedQuestions) {
  if (!property || detectedQuestions.length === 0) {
    return null;
  }
  
  // Parser les données JSON si nécessaire
  const amenities = parseJSON(property.amenities) || {};
  const houseRules = parseJSON(property.house_rules) || {};
  const practicalInfo = parseJSON(property.practical_info) || {};
  
  const responses = [];
  
  for (const question of detectedQuestions) {
    const response = generateResponseForCategory(
      question.category, 
      property, 
      amenities, 
      houseRules, 
      practicalInfo
    );
    
    if (response) {
      responses.push(response);
    }
  }
  
  if (responses.length === 0) {
    return null;
  }
  
  // Joindre les réponses avec des sauts de ligne
  return responses.join('\n\n');
}

/**
 * Génère une réponse pour une catégorie spécifique
 */
function generateResponseForCategory(category, property, amenities, houseRules, practicalInfo) {
  switch (category) {
    // HORAIRES
    case 'checkin':
      if (property.arrival_time) {
        return `L'arrivée est possible à partir de ${property.arrival_time}.`;
      }
      return null;
      
    case 'checkout':
      if (property.departure_time) {
        return `Le départ doit se faire avant ${property.departure_time}.`;
      }
      return null;
    
    // ÉQUIPEMENTS
    case 'draps':
      return amenities.draps 
        ? 'Oui, les draps sont fournis.' 
        : 'Non, les draps ne sont pas fournis, merci de prévoir les vôtres.';
    
    case 'serviettes':
      return amenities.serviettes 
        ? 'Oui, les serviettes sont fournies.' 
        : 'Non, les serviettes ne sont pas fournies, merci de prévoir les vôtres.';
    
    case 'cuisine':
      return amenities.cuisine_equipee 
        ? 'Oui, la cuisine est équipée avec tout le nécessaire pour cuisiner.' 
        : 'La cuisine dispose d\'équipements de base.';
    
    case 'lave_linge':
      return amenities.lave_linge 
        ? 'Oui, un lave-linge est disponible.' 
        : 'Non, il n\'y a pas de lave-linge dans le logement.';
    
    case 'lave_vaisselle':
      return amenities.lave_vaisselle 
        ? 'Oui, un lave-vaisselle est disponible.' 
        : 'Non, il n\'y a pas de lave-vaisselle.';
    
    case 'television':
      return amenities.television 
        ? 'Oui, une télévision est disponible.' 
        : 'Non, il n\'y a pas de télévision.';
    
    case 'parking':
      if (amenities.parking && practicalInfo.parking_details) {
        return `Oui, voici les informations parking : ${practicalInfo.parking_details}`;
      } else if (amenities.parking) {
        return 'Oui, un parking est disponible.';
      } else if (practicalInfo.parking_details) {
        return `Informations parking : ${practicalInfo.parking_details}`;
      }
      return 'Il n\'y a pas de parking privé associé au logement.';
    
    case 'climatisation':
      return amenities.climatisation 
        ? 'Oui, le logement dispose de la climatisation.' 
        : 'Non, il n\'y a pas de climatisation.';
    
    case 'wifi':
      if (property.wifi_name && property.wifi_password) {
        return `Réseau WiFi : "${property.wifi_name}"\nMot de passe : "${property.wifi_password}"`;
      } else if (property.wifi_name) {
        return `Le réseau WiFi est "${property.wifi_name}". Le mot de passe vous sera communiqué.`;
      }
      return 'Les informations WiFi vous seront communiquées.';
    
    // ACCÈS
    case 'acces_code':
      if (property.access_code) {
        return `Le code d'accès est : ${property.access_code}`;
      }
      return null;
    
    case 'acces_instructions':
      if (property.access_instructions) {
        return `Voici comment accéder au logement :\n${property.access_instructions}`;
      } else if (property.address) {
        return `L'adresse du logement est : ${property.address}`;
      }
      return null;
    
    // RÈGLES
    case 'animaux':
      return houseRules.animaux 
        ? 'Oui, les animaux sont acceptés.' 
        : 'Non, les animaux ne sont pas acceptés.';
    
    case 'fumeurs':
      return houseRules.fumeurs 
        ? 'Il est possible de fumer dans le logement.' 
        : 'Il est interdit de fumer à l\'intérieur du logement.';
    
    case 'fetes':
      return houseRules.fetes 
        ? 'Les fêtes sont autorisées dans le respect du voisinage.' 
        : 'Les fêtes et soirées bruyantes ne sont pas autorisées.';
    
    // INFOS PRATIQUES
    case 'poubelles':
      if (practicalInfo.trash_day) {
        return `Informations poubelles : ${practicalInfo.trash_day}`;
      }
      return null;
    
    case 'commerces':
      if (practicalInfo.nearby_shops) {
        return `Commerces à proximité : ${practicalInfo.nearby_shops}`;
      }
      return null;
    
    case 'transports':
      if (practicalInfo.public_transport) {
        return `Transports en commun : ${practicalInfo.public_transport}`;
      }
      return null;
    
    default:
      return null;
  }
}

/**
 * Parser JSON sécurisé
 */
function parseJSON(data) {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

/**
 * Point d'entrée principal : analyser un message et générer une réponse
 */
function analyzeAndRespond(message, property) {
  // Vérifier si les réponses auto sont activées pour cette propriété
  if (property.auto_responses_enabled === false) {
    return null;
  }
  
  // Détecter les questions
  const detectedQuestions = detectQuestions(message);
  
  if (detectedQuestions.length === 0) {
    return null; // Aucune question détectée
  }
  
  // Générer la réponse
  const response = generateResponse(property, detectedQuestions);
  
  if (!response) {
    return null; // Pas de réponse trouvée
  }
  
  return {
    canRespond: true,
    response: response,
    detectedCategories: detectedQuestions.map(q => q.category)
  };
}

module.exports = {
  analyzeAndRespond,
  detectQuestions,
  generateResponse,
  QUESTION_PATTERNS
};
