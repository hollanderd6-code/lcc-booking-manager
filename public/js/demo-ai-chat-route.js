/**
 * Endpoint de démo publique pour la page /ia.html
 *
 * À ajouter dans server.js (ou dans un module séparé routes/demo.js).
 * Appelle Groq avec un contexte de logement fictif pour illustrer l'IA.
 *
 * Rate limit : 10 messages par IP par heure (mémoire seulement, OK pour démo)
 */

// ── Rate limiter simple (in-memory) ─────────────────────────
const demoRateLimit = new Map(); // ip → { count, resetAt }
const DEMO_LIMIT_PER_HOUR = 10;
const DEMO_WINDOW_MS = 60 * 60 * 1000;

function checkDemoRateLimit(ip) {
  const now = Date.now();
  const entry = demoRateLimit.get(ip);

  if (!entry || entry.resetAt < now) {
    demoRateLimit.set(ip, { count: 1, resetAt: now + DEMO_WINDOW_MS });
    return { allowed: true, remaining: DEMO_LIMIT_PER_HOUR - 1 };
  }

  if (entry.count >= DEMO_LIMIT_PER_HOUR) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: DEMO_LIMIT_PER_HOUR - entry.count };
}

// Nettoyage périodique de la map (évite la fuite mémoire)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of demoRateLimit.entries()) {
    if (entry.resetAt < now) demoRateLimit.delete(ip);
  }
}, 10 * 60 * 1000);

// ── Contexte fictif du logement démo ────────────────────────
const DEMO_PROPERTY_CONTEXT = `
Tu es l'assistant IA de Boostinghost. Tu réponds à un voyageur pour le compte de l'hôte.

INFORMATIONS SUR LE LOGEMENT DE DÉMONSTRATION :
- Nom : Studio cosy près de la gare, Paris
- Capacité : 2 voyageurs maximum
- Adresse : 12 rue de la Paix, 75001 Paris
- Check-in : à partir de 16h00
- Check-out : avant 11h00
- Code d'accès : 4821 (clavier à côté de la porte d'entrée)
- WiFi : réseau "Studio-Guest", mot de passe "WelcomeToParis2026"
- Parking : parking public payant "Parking Vendôme" à 200m (environ 25€/jour)
- Chauffage : thermostat dans le salon, réglé à 20°C par défaut
- Poubelles : locaux à droite du hall, collecte les lundis et jeudis
- Animaux : non autorisés
- Fumeurs : non autorisés dans le logement (balcon OK)
- Restaurant recommandé : "Le Comptoir du Coin", à 5 minutes à pied, cuisine française traditionnelle
- Bar à cocktails recommandé : "Bar Hemingway" au Ritz, 10 minutes à pied
- Métro le plus proche : Opéra (ligne 3, 7, 8), 3 minutes à pied
- Supermarché : Carrefour City à 150m, ouvert jusqu'à 22h

RÈGLES DE RÉPONSE :
1. Réponds toujours dans la langue du voyageur (détecte-la automatiquement).
2. Sois chaleureux, concis, professionnel.
3. Utilise UNIQUEMENT les infos ci-dessus. Si l'info n'est pas dedans, dis que tu vas transférer à l'hôte.
4. Signe parfois avec un emoji léger (🏡 🗝️ 🥐 etc.) mais pas systématiquement.
5. Maximum 4 phrases.
`.trim();

// ── Appel Groq ──────────────────────────────────────────────
async function callGroqDemo(userMessage) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',  // rapide + bonne qualité
      messages: [
        { role: 'system', content: DEMO_PROPERTY_CONTEXT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.6,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ── Route Express ───────────────────────────────────────────
// À ajouter dans server.js :
//
// app.post('/api/demo/ai-chat', require('./demo-ai-chat-route'));
//
// Ou inline, copie directement le handler ci-dessous.

module.exports = async function demoAiChat(req, res) {
  try {
    // IP pour rate limiting
    const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown')
      .toString().split(',')[0].trim();

    const limit = checkDemoRateLimit(ip);
    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Trop de messages. Réessayez dans une heure ou créez un compte pour accès illimité.',
        resetAt: limit.resetAt,
      });
    }

    const { message } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    if (message.length > 500) {
      return res.status(400).json({ error: 'Message trop long (max 500 caractères)' });
    }

    // Anti-abus basique : filtrer les tentatives de prompt injection évidentes
    const lower = message.toLowerCase();
    if (lower.includes('ignore previous') || lower.includes('system prompt') || lower.includes('reveal') && lower.includes('instruction')) {
      return res.json({
        reply: "Je suis l'assistant virtuel du logement. Je peux vous aider pour les horaires, l'accès, le WiFi, les recommandations locales. Que souhaitez-vous savoir ? 🏡",
        remaining: limit.remaining,
      });
    }

    const reply = await callGroqDemo(message);

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from AI' });
    }

    res.json({ reply, remaining: limit.remaining });

  } catch (err) {
    console.error('❌ [DEMO AI]', err.message);
    res.status(500).json({
      error: 'Demo temporairement indisponible',
      reply: "Oups, la démo est momentanément indisponible. Essayez dans quelques secondes ou créez votre compte pour tester l'IA sur vos propres logements !",
    });
  }
};
