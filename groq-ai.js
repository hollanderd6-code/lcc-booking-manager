// ============================================
// 🚀 GROQ API - Intelligence Artificielle
// ============================================

const fetch = require('node-fetch');

const GROQ_API_KEY = process.env.GROQ_API_KEY || null;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

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
    const languageNames = {
      fr: 'français',
      en: 'English',
      es: 'español',
      de: 'Deutsch',
      it: 'italiano'
    };

    const systemPrompt = `You are a virtual assistant for a short-term rental.

Property information:
- Name: ${conversationContext.propertyName || 'Rental'}
- Welcome booklet: ${conversationContext.welcomeBookUrl || 'Not available'}
- WiFi: ${conversationContext.wifiName || 'See booklet'}
- Check-in time: ${conversationContext.arrivalTime || '3pm'}
- Check-out time: ${conversationContext.departureTime || '11am'}

Instructions:
- Respond in ${languageNames[language]} (IMPORTANT: entire response must be in this language)
- Be friendly and professional
- If the question concerns access info (code, wifi, etc.), refer to the booklet
- Be concise (max 3-4 sentences)
- Use appropriate emojis
- If it's a technical/urgent problem, say the owner will be notified`;

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',  // Nouveau modèle recommandé (Jan 2025)
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 300,
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
 * Détecter si un message nécessite une intervention humaine
 */
function requiresHumanIntervention(message) {
  const urgentKeywords = [
    'urgent', 'urgence', 'immédiat', 'tout de suite',
    'problème grave', 'danger', 'fuite', 'incendie',
    'cambriolage', 'police', 'secours'
  ];

  const lowerMessage = message.toLowerCase();
  return urgentKeywords.some(keyword => lowerMessage.includes(keyword));
}

module.exports = {
  getGroqResponse,
  requiresHumanIntervention
};
