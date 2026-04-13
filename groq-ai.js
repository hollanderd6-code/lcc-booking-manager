// ============================================
// 🚀 GROQ API - Intelligence Artificielle
// ============================================

const fetch = require('node-fetch');

const GROQ_API_KEY = process.env.GROQ_API_KEY || null;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Formater les restaurants pour le prompt
 */
function formatRestaurants(restaurants) {
  if (!restaurants || !Array.isArray(restaurants) || restaurants.length === 0) return null;
  return restaurants
    .filter(r => r.name)
    .map(r => {
      let line = `• ${r.name}`;
      if (r.address) line += ` — ${r.address}`;
      if (r.phone) line += ` (${r.phone})`;
      if (r.description) line += ` : ${r.description}`;
      return line;
    })
    .join('\n');
}

/**
 * Formater les lieux à visiter pour le prompt
 */
function formatPlaces(places) {
  if (!places || !Array.isArray(places) || places.length === 0) return null;
  return places
    .filter(p => p.name)
    .map(p => {
      let line = `• ${p.name}`;
      if (p.description) line += ` : ${p.description}`;
      return line;
    })
    .join('\n');
}

/**
 * Formater les pièces pour le prompt
 */
function formatRooms(rooms) {
  if (!rooms || !Array.isArray(rooms) || rooms.length === 0) return null;
  return rooms
    .filter(r => r.name)
    .map(r => {
      let line = `• ${r.name}`;
      if (r.description) line += ` : ${r.description}`;
      return line;
    })
    .join('\n');
}

/**
 * Appeler Groq AI pour générer une réponse intelligente
 */
async function getGroqResponse(userMessage, conversationContext = {}) {
  if (!GROQ_API_KEY) {
    console.warn('⚠️ GROQ_API_KEY non configurée');
    return null;
  }

  try {
    const language = conversationContext.language || 'fr';

    // Construire les sections du prompt dynamiquement selon les infos disponibles
    const sections = [];

    // Infos de base
    const basicInfo = [];
    if (conversationContext.propertyName) basicInfo.push(`- Nom du logement : ${conversationContext.propertyName}`);
    if (conversationContext.address) basicInfo.push(`- Adresse : ${conversationContext.address}`);
    if (conversationContext.welcomeDescription) basicInfo.push(`- Présentation : ${conversationContext.welcomeDescription}`);
    if (conversationContext.contactPhone) basicInfo.push(`- Téléphone de contact : ${conversationContext.contactPhone}`);
    if (basicInfo.length > 0) sections.push(`INFOS GÉNÉRALES :\n${basicInfo.join('\n')}`);

    // Accès
    const accessInfo = [];
    if (conversationContext.accessCode) accessInfo.push(`- Code d'accès / boîte à clés : ${conversationContext.accessCode}`);
    if (conversationContext.accessInstructions) accessInfo.push(`- Instructions d'accès : ${conversationContext.accessInstructions}`);
    if (conversationContext.parkingInfo) accessInfo.push(`- Parking : ${conversationContext.parkingInfo}`);
    if (conversationContext.extraNotesAccess) accessInfo.push(`- Notes accès : ${conversationContext.extraNotesAccess}`);
    if (accessInfo.length > 0) sections.push(`ACCÈS :\n${accessInfo.join('\n')}`);

    // Séjour
    const stayInfo = [];
    if (conversationContext.arrivalTime) stayInfo.push(`- Heure d'arrivée (check-in) : ${conversationContext.arrivalTime}`);
    if (conversationContext.departureTime) stayInfo.push(`- Heure de départ (check-out) : ${conversationContext.departureTime}`);
    if (conversationContext.checkoutInstructions) stayInfo.push(`- Instructions de départ : ${conversationContext.checkoutInstructions}`);
    if (conversationContext.wifiName) stayInfo.push(`- Nom WiFi : ${conversationContext.wifiName}`);
    if (conversationContext.wifiPassword) stayInfo.push(`- Mot de passe WiFi : ${conversationContext.wifiPassword}`);
    if (stayInfo.length > 0) sections.push(`SÉJOUR :\n${stayInfo.join('\n')}`);

    // Logement
    const homeInfo = [];
    const roomsFormatted = formatRooms(conversationContext.rooms);
    if (roomsFormatted) homeInfo.push(`- Pièces :\n${roomsFormatted}`);
    if (conversationContext.equipmentList) homeInfo.push(`- Équipements disponibles : ${conversationContext.equipmentList}`);
    if (conversationContext.importantRules) homeInfo.push(`- Règles importantes : ${conversationContext.importantRules}`);
    if (conversationContext.extraNotesLogement) homeInfo.push(`- Notes logement : ${conversationContext.extraNotesLogement}`);
    if (conversationContext.practicalInfo) homeInfo.push(`- Informations pratiques : ${conversationContext.practicalInfo}`);
    if (homeInfo.length > 0) sections.push(`LOGEMENT :\n${homeInfo.join('\n')}`);

    // Transport & pratique
    const practicalInfo = [];
    if (conversationContext.transportInfo) practicalInfo.push(`- Transports : ${conversationContext.transportInfo}`);
    if (conversationContext.extraNotesPractical) practicalInfo.push(`- Autres infos pratiques : ${conversationContext.extraNotesPractical}`);
    if (practicalInfo.length > 0) sections.push(`TRANSPORT & PRATIQUE :\n${practicalInfo.join('\n')}`);

    // Autour du logement
    const aroundInfo = [];
    const restaurantsFormatted = formatRestaurants(conversationContext.restaurants);
    if (restaurantsFormatted) aroundInfo.push(`- Restaurants recommandés :\n${restaurantsFormatted}`);
    const placesFormatted = formatPlaces(conversationContext.places);
    if (placesFormatted) aroundInfo.push(`- Lieux à visiter :\n${placesFormatted}`);
    if (conversationContext.shopsList) aroundInfo.push(`- Commerces / courses : ${conversationContext.shopsList}`);
    if (conversationContext.extraNotesAround) aroundInfo.push(`- Notes autour : ${conversationContext.extraNotesAround}`);
    if (aroundInfo.length > 0) sections.push(`AUTOUR DU LOGEMENT :\n${aroundInfo.join('\n')}`);

    // Q/R personnalisées comme référence supplémentaire
    if (conversationContext.customQRSummary) {
      sections.push(`QUESTIONS FRÉQUENTES CONFIGURÉES PAR L'HÔTE :\n${conversationContext.customQRSummary}`);
    }

    const propertyDataBlock = sections.length > 0
      ? sections.join('\n\n')
      : 'Aucune information disponible sur ce logement.';

    const systemPrompt = `Tu es un(e) assistant(e) de conciergerie chaleureux(se) et professionnel(le) pour un logement en location courte durée. Tu aides les voyageurs avec naturel et bienveillance, comme si tu étais un(e) vrai(e) concierge humain(e).

INFORMATIONS DU LOGEMENT (tout ce que tu sais) :
${propertyDataBlock}

RÈGLES IMPORTANTES :
1. Tu réponds UNIQUEMENT avec les informations présentes ci-dessus. Tu n'inventes jamais, tu ne supposes jamais.
2. Si une information est disponible ci-dessus, utilise-la pour répondre complètement et avec précision.
3. Si tu n'as pas l'information nécessaire pour répondre, réponds EXACTEMENT : [ESCALADE]
4. N'essaie pas de répondre partiellement si tu n'as pas l'info — mieux vaut escalader.
5. Réponds TOUJOURS dans la même langue que le message du voyageur, quelle que soit la langue utilisée. Détecte automatiquement la langue et réponds dans cette langue.
6. Ton style : chaleureux, naturel, concis (2-4 phrases max). Utilise 1-2 emojis de façon naturelle. Tutoie si l'échange est déjà informel, vouvoie sinon.
7. Si le voyageur semble frustré, insiste pour parler à quelqu'un, ou pose une question hors logement → [ESCALADE]
8. Ne t'excuse jamais de ne pas avoir une info. Escalade directement sans explication.
9. Pour les urgences (fuite, incendie, danger) → [ESCALADE] immédiatement.`;

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.5,
        max_tokens: 350,
        top_p: 1,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erreur Groq API:', error);
      return null;
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content;

    console.log('✅ Réponse Groq générée:', aiResponse?.substring(0, 100) + '...');
    return aiResponse;

  } catch (error) {
    console.error('❌ Erreur appel Groq:', error);
    return null;
  }
}

/**
 * Détecter si un message nécessite une intervention humaine urgente
 */
function requiresHumanIntervention(message) {
  const urgentKeywords = [
    'urgent', 'urgence', 'immédiat', 'tout de suite',
    'problème grave', 'danger', 'fuite', 'incendie',
    'cambriolage', 'police', 'secours',
  ];

  const lowerMessage = message.toLowerCase();
  return urgentKeywords.some(keyword => lowerMessage.includes(keyword));
}

module.exports = {
  getGroqResponse,
  requiresHumanIntervention
};
