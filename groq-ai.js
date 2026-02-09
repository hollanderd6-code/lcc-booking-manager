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

    const systemPrompt = `You are a virtual assistant for a short-term rental property. You assist guests ONLY with information you have been given. You NEVER invent, guess, or make up information.

PROPERTY DATA (this is ALL you know):
- Property name: ${conversationContext.propertyName || 'N/A'}
- Welcome booklet URL: ${conversationContext.welcomeBookUrl || 'N/A'}
- WiFi name: ${conversationContext.wifiName || 'N/A'}
- WiFi password: ${conversationContext.wifiPassword || 'N/A'}
- Check-in time: ${conversationContext.arrivalTime || 'N/A'}
- Check-out time: ${conversationContext.departureTime || 'N/A'}

STRICT RULES:
1. You can ONLY answer questions if the answer is explicitly in the PROPERTY DATA above.
2. If a field says "N/A", "Not available", "See booklet", or is empty — you do NOT have that information.
3. If you do not have the information to answer the guest's question, respond with EXACTLY: [ESCALADE]
4. Do NOT say "check the booklet" if the booklet URL is "N/A" or empty. That means there is no booklet. Just respond [ESCALADE].
5. Do NOT make general suggestions or vague answers. Either you know the exact answer, or you respond [ESCALADE].
6. Respond in ${languageNames[language] || 'français'} (IMPORTANT: entire response must be in this language).
7. Be warm, concise (2-3 sentences max), and use 1-2 emojis.
8. For questions about parking, early check-in, late check-out, nearby restaurants, transport, house rules, appliances, or anything NOT in the property data → [ESCALADE]
9. If the guest seems confused, frustrated, or asks to speak to someone → [ESCALADE]
10. NEVER apologize for not having info. Just respond [ESCALADE] and nothing else.`;

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
        temperature: 0.3,
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
