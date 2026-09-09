# Relevé 5 — Champ `escalated` des conversations

## Ce que fait ce champ

`escalated BOOLEAN DEFAULT FALSE` (+ `escalated_at TIMESTAMPTZ`) sur la table
`conversations`. Quand `escalated = TRUE`, le bot devient silencieux sur cette
conversation — il ne répond plus aux messages voyageur, mais l'IA **n'est pas
désactivée** (`ai_disabled` reste inchangé). Ce sont deux flags indépendants.

Conséquence directe : la vue "Aujourd'hui" (`/api/aujourdhui`) place la carte
dans `blocking = ['ia_a_passe_la_main']`, ce qui la fait apparaître en "À
traiter".

---

## Les trois déclencheurs (escalated → TRUE)

Tous dans `integrated-chat-handler.js` (fichier racine) :

1. **Urgence détectée** (ligne ~512) — `requiresHumanIntervention(message)`
   retourne vrai sur le message entrant du voyageur. Le bot envoie un message
   d'alerte au voyageur, puis lève l'escalade immédiatement.

2. **Hand-off IA** (ligne ~1768) — L'IA épuise sa capacité à répondre et décide
   de passer la main à l'hôte. Émet aussi l'événement Socket.IO
   `conversation_escalated` et une push notification FCM de type `'escalation'`.

3. **Question hôte en attente** (ligne ~1884) — L'IA génère une
   `ai_host_question` (demande de confirmation à l'hôte sur un fait inconnu).
   Réutilise `escalated` comme verrou : le bot reste silencieux jusqu'à la
   réponse de l'hôte.

---

## Les quatre chemins de reset (escalated → FALSE)

| Fichier | Condition | Délai |
|---------|-----------|-------|
| `server.js:33059` — route `/api/chat/send` | L'hôte envoie un message (`sender_type = 'owner'` ou `'property'`) alors que la conv est escaladée | **1 heure** après envoi (setTimeout) |
| `integrated-chat-handler.js:129` — debounce | Nouveau message voyageur reçu et `escalated_at` date de **> 4h** | Immédiat à la réception |
| `integrated-chat-handler.js:455` — handler | Même vérification 4h dans le handler principal | Immédiat à la réception |
| `integrated-chat-handler.js:2022` — réponse question | L'hôte répond à une `ai_host_question` via l'UI | Immédiat |
| `chat_routes.js:1254` — toggle-ai | L'hôte réactive l'IA via le toggle → reset escalade en même temps | Immédiat, mais touche aussi `ai_disabled` |
| `routes/chat_routes.js` — `POST /api/chat/deescalate/:id` | Appelé explicitement (ex : après envoi d'un message hôte) | Immédiat, ne touche **pas** `ai_disabled` |

---

## Interface web

**Aucun bouton ne permet de lever l'escalade manuellement.** Il n'existe aucune
référence au champ `escalated` dans `public/` (HTML, JS, CSS). L'escalade n'est
visible que via la vue "Aujourd'hui" (flag `ia_a_passe_la_main` dans `blocking`).

---

## Route dédiée ajoutée

`POST /api/chat/deescalate/:conversationId`  
Middleware : `authenticateAny` + scope via `getAgencyUserIds` (supporte
`?agency=all`).  
Idempotente : si la conversation n'est pas escaladée, répond 200 sans erreur.  
Usage prévu : appelée automatiquement côté app après qu'un hôte a envoyé un
message dans une conversation escaladée — sans attendre l'heure de délai du
setTimeout dans `/api/chat/send`.
