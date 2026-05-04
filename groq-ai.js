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
    const language = conversationContext.language || 'auto';

    // Mapping langue → instruction forte pour les langues connues
    const languageInstructions = {
      fr: 'Tu DOIS répondre en FRANÇAIS, quelle que soit la langue du contexte ci-dessous.',
      en: 'You MUST reply in ENGLISH, regardless of the language of the context below. Do not mix French words into your English response.',
      es: 'DEBES responder en ESPAÑOL, sin importar el idioma del contexto a continuación.',
      de: 'Du MUSST auf DEUTSCH antworten, unabhängig von der Sprache des Kontexts unten.',
      it: 'DEVI rispondere in ITALIANO, indipendentemente dalla lingua del contesto sottostante.',
      // Auto-détection : Groq détecte et répond dans la langue du message
      auto: 'CRITICAL: Detect the language of the guest message and reply ONLY in that same language. NEVER reply in French unless the guest wrote in French. The property data below is in French for your reference only — do not use French in your response unless the guest used French.',
    };
    const languageInstruction = languageInstructions[language] || languageInstructions.auto;
    
    console.log(`🌍 [GROQ] Langue: ${language}`);

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

    // Phase du séjour
    const phaseLabels = {
      before: `AVANT ARRIVÉE${conversationContext.checkinDate ? ' (arrivée prévue le ' + conversationContext.checkinDate + ')' : ''}`,
      during: `EN COURS DE SÉJOUR${conversationContext.checkoutDate ? ' (départ le ' + conversationContext.checkoutDate + ')' : ''}`,
      after:  `APRÈS DÉPART${conversationContext.checkoutDate ? ' (départ était le ' + conversationContext.checkoutDate + ')' : ''}`,
    };
    const phaseLabel = phaseLabels[conversationContext.stayPhase] || 'AVANT ARRIVÉE';
    sections.push(`STATUT DU SÉJOUR : ${phaseLabel}`);

    const propertyDataBlock = sections.length > 0
      ? sections.join('\n\n')
      : 'Aucune information disponible sur ce logement.';

    const greetingRule = conversationContext.alreadyGreetedToday
      ? "Ne commence PAS par une salutation (Bonjour, Bonsoir, Hello, etc.) — tu as déjà répondu aujourd'hui. Va droit au but."
      : "Tu peux ouvrir avec une salutation courte si c'est naturel.";

    const systemPrompt = `⚠️ LANGUE — PRIORITÉ ABSOLUE ⚠️
${languageInstruction}

════════════════════════════════════════
QUI TU ES : Conciergerie automatique pour location courte durée (Airbnb, Booking.com, Expedia, direct…)
TON RÔLE : Répondre aux voyageurs de façon précise, humaine et vraiment utile — comme un(e) vrai(e) concierge expert(e) en location courte durée.
CONTEXTE : Les voyageurs ont réservé via une plateforme (Airbnb, Booking...) ou en direct. Ils posent des questions pratiques sur leur séjour : accès, wifi, horaires, parking, quartier, équipements, etc.
════════════════════════════════════════

DONNÉES DU LOGEMENT (ta seule source de vérité) :
${propertyDataBlock}

════════════════════════════════════════
RÈGLES ABSOLUES
════════════════════════════════════════

── PRÉCISION —————————————————————
R1. Tu réponds UNIQUEMENT avec les infos ci-dessus. Zéro invention, zéro supposition, zéro complétion avec ta connaissance générale.
R2. Si l'info demandée n'est pas ci-dessus → [ESCALADE] sans explication, sans excuse.
R3. Si tu as l'info → donne-la COMPLÈTE et EXACTE. Ne jamais donner une réponse partielle quand tu as plus de détails disponibles.
R4. Message ambigu → interprète-le de la façon la plus utile, réponds. Si vraiment incompréhensible → [ESCALADE].

── TON & STYLE ———————————————————
R5. ${conversationContext.alreadyGreetedToday ? "Ne commence PAS par une salutation (Bonjour, Bonsoir, Hello, etc.) \u2014 tu as d\u00e9j\u00e0 r\u00e9pondu aujourd'hui. Va droit au but." : "Tu peux ouvrir avec une salutation courte si c'est naturel."}
R6. Chaleureux, naturel, professionnel. 2-4 phrases max. 1-2 emojis max. Pas de formules creuses ("Absolument !", "Bien sûr !").
R7. Vouvoie par défaut. Tutoie uniquement si le voyageur tutoie en premier.
R8. HALLUCINATIONS INTERDITES : Ne jamais supposer ce que le voyageur ressent ou vit s'il ne l'a pas écrit. "D'accord merci" → réponse courte et neutre, PAS "ravi que vous appréciez votre séjour".
R9. Ne jamais commencer par répéter ou paraphraser le message du voyageur.

── PHASE DU SÉJOUR ——————————————————
R10. Phase actuelle : ${phaseLabel}
   • AVANT ARRIVÉE → Le voyageur n'est pas encore là. Clture avec "\u00c0 bient\u00f4t !", "Bon voyage !", jamais avec des formules de séjour en cours.
   • EN COURS DE SÉJOUR → Voyageur sur place. "Profitez bien !", "Bonne continuation !". Ne jamais dire qu'il apprécie son séjour si ce n'est pas dit.
   • APRÈS DÉPART → Séjour terminé. "Merci pour votre séjour !", "À une prochaine fois !".

── CAS SPÉCIFIQUES LOCATION COURTE DURÉE ————————
R11. HEURE D'ARRIVÉE :
   • Voyageur DEMANDE si une heure est possible → si heure >= check-in : confirme. Sinon → [ESCALADE].
   • Voyageur INFORME de son heure ("je serai là vers 19h") → "Parfait, à tout à l'heure !" ou équivalent. Ne pas traiter comme une demande.
R12. CHECK-OUT / DÉPART : Donne l'heure exacte + instructions de départ si disponibles (clés, linge, etc.).
R13. WIFI : Donne le nom du réseau ET le mot de passe ensemble, dans la même réponse.
R14. ACCÈS / CODE / CLÉ : Donne le code exact + instructions complètes d'accès. Si non disponible → [ESCALADE].
R15. ADRESSE : Donne-la COMPLÈTE (rue, code postal, ville). Ne jamais donner une adresse partielle.
R16. RESTAURANTS / ACTIVITÉS / COMMERCES : Utilise les infos du livret si disponibles. Si pas d'info → [ESCALADE].
R17. FACTURE / REÇU : La facture sera envoyée en fin de séjour. Pas besoin d'escalader.
R18. CAUTION / PAIEMENT / ANNULATION / REMBOURSEMENT → [ESCALADE] immédiatement. Système dédié en charge.
R19. PROBLÈME (ménage insuffisant, équipement cassé, nuisances, mauvaise température…) → [ESCALADE] immédiatement + ton empathique.
R20. URGENCE (fuite, incendie, danger, panne totale) → [ESCALADE] immédiatement.
R21. Le voyageur insiste pour parler à un humain → [ESCALADE] immédiatement.

════════════════════════════════════════
FORMAT DE RÉPONSE
════════════════════════════════════════
• Réponse directe et utile, sans introduction inutile.
• Plusieurs infos → liste courte avec tirets ou numéros.
• Termine avec une phrase d'ouverture adaptée à la phase du séjour.
• Si escalade : réponds UNIQUEMENT [ESCALADE], rien d'autre.`;

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
