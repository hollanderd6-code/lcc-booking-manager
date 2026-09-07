# Relevé 1 — Fiche logement, routes d'écriture

Toutes les routes qui créent ou modifient un logement (`properties`) et ses champs associés.

---

## Doublons détectés

En plus du doublon déjà signalé (`POST /api/cleaning/assignments`), **une seconde route est déclarée deux fois** :

| Route | Ligne | Auth | Statut |
|---|---|---|---|
| `POST /api/bookings` | 9772 | `authenticateAny, checkSubscription` | **Atteinte par Express** |
| `POST /api/bookings` | 11375 | aucune | **Code mort** |

La première déclaration (l.9772) prend tout le trafic. La seconde (l.11375, sans auth) n'est jamais exécutée.

Les lignes 1923 et 1928 contiennent aussi `app.get('/api/properties', …)` mais elles sont à l'intérieur d'un bloc de texte commenté — elles ne constituent pas des routes vivantes.

---

## Routes d'écriture sur `properties`

### 1. `POST /api/properties` — Création d'un logement
**Fichier :** `server.js` **Ligne :** 17051

**Middlewares (dans l'ordre) :**
1. `authenticateAny`
2. `checkSubscription`
3. `requirePermission(pool, 'can_edit_properties')`
4. `upload.single('photo')` (multer — champ `photo`, envoi multipart/form-data)

**Body attendu** (via `parsePropertyBody` l.10441 — multipart ou JSON, champs JSON stringuifiés acceptés) :

| Champ | Clé body | Type DB | Obligatoire |
|---|---|---|---|
| Nom | `name` | TEXT | **oui** (400 si absent) |
| Couleur | `color` | TEXT | **oui** (400 si absent) |
| URLs iCal | `icalUrls` | JSONB (Array) | non |
| Adresse | `address` | TEXT | non |
| Heure d'arrivée | `arrivalTime` | TEXT | non |
| Heure de départ | `departureTime` | TEXT | non |
| Caution (€) | `depositAmount` | NUMERIC | non |
| URL photo existante | `photoUrl` | TEXT | non (supplanté par `req.file`) |
| URL livret | `welcomeBookUrl` | TEXT | non |
| Code d'accès | `accessCode` | TEXT | non |
| Nom Wi-Fi | `wifiName` | TEXT | non |
| Mot de passe Wi-Fi | `wifiPassword` | TEXT | non |
| Instructions d'accès | `accessInstructions` | TEXT | non |
| Message d'arrivée | `arrivalMessage` | TEXT | non |
| PIN chat | `chatPin` | TEXT | non (généré aléatoirement si absent) |
| Prix de base | `basePrice` | NUMERIC | non |
| Prix week-end | `weekendPrice` | NUMERIC | non |
| Frais de ménage | `cleaningFee` | NUMERIC | non |
| Taxe de séjour / nuit | `touristTaxPerNight` | NUMERIC | non |
| % conciergerie | `conciergePct` | NUMERIC | non |
| Capacité max | `maxGuests` | INTEGER | non |
| Chambres | `bedrooms` | INTEGER | non |
| Lits | `beds` | INTEGER | non |
| Salles de bain | `bathrooms` | INTEGER | non |
| Nom interne | `internal_name` ou `internalName` | TEXT | non |
| Équipements | `amenities` (JSON string → Object) | JSONB | non |
| Règlement | `houseRules` / `house_rules` (JSON string → Object) | JSONB | non |
| Infos pratiques | `practicalInfo` / `practical_info` (JSON string → Object) | JSONB | non |
| IA auto-réponses activée | `auto_responses_enabled` | BOOLEAN | non (défaut `true`) |
| Réponses auto personnalisées | `customAutoResponses` (JSON string → Array) | JSONB | non |
| Propriétaire (owner_id) | `ownerId` | TEXT | non |
| Commission Airbnb % | `airbnbCommissionPct` | NUMERIC | non (défaut 3) |
| Commission Booking % | `bookingCommissionPct` | NUMERIC | non (défaut 15) |
| Photo | `photo` (fichier multipart) | TEXT (URL Cloudinary) | non |

**Colonnes réellement insérées en base :**
`id`, `user_id`, `name`, `color`, `ical_urls`, `address`, `arrival_time`, `departure_time`, `deposit_amount`, `photo_url`, `welcome_book_url`, `access_code`, `wifi_name`, `wifi_password`, `access_instructions`, `owner_id`, `chat_pin`, `display_order`, `created_at`, `amenities`, `house_rules`, `practical_info`, `auto_responses_enabled`, `arrival_message`, `base_price`, `weekend_price`, `cleaning_fee`, `tourist_tax_per_night`, `concierge_pct`, `max_guests`, `bedrooms`, `beds`, `bathrooms`, `internal_name`, `airbnb_commission_pct`, `booking_commission_pct`

**Génération de l'id :** `<userId>-<slug(name)>`. Une collision d'id retourne 409. Un dépassement de quota de plan retourne 403 (code `PLAN_LIMIT_STARTER`) ou 402 (erreur Stripe).

**Réponse (succès 200) :**
```json
{ "success": true, "message": "Propriété créée avec succès", "property": { "id": "<id>" } }
```
Enveloppé. Clé `property` ne contient que l'`id`.

**`getAgencyUserIds` :** NON utilisé. L'appartenance est basée sur le `userId` du token.

---

### 2. `PUT /api/properties/:propertyId` — Mise à jour complète
**Fichier :** `server.js` **Ligne :** 18978

**Middlewares (dans l'ordre) :**
1. `authenticateAny`
2. `requirePermission(pool, 'can_edit_properties')`
3. `loadSubAccountData(pool)`
4. `upload.single('photo')`

**Body attendu :** mêmes champs que le POST, plus :

| Champ | Clé body | Type DB |
|---|---|---|
| ID logement Booking.com | `booking_id` | TEXT |
| ID logement Abritel/VRBO | `abritel_id` | TEXT |
| ID logement Expedia | `expedia_id` | TEXT |
| ID propriété Channex | `channex_property_id` | TEXT (→ colonne `channex_property_id_ext`) |
| Pricing externe (Pricelabs…) | `externalPricing` | BOOLEAN |
| Délai libération caution (jours) | `depositReleaseDays` | INTEGER |

Tous les champs sont optionnels en PUT : la valeur actuelle est conservée si le champ est absent.

**Colonnes modifiées :**
`name`, `color`, `ical_urls`, `address`, `arrival_time`, `departure_time`, `deposit_amount`, `photo_url`, `welcome_book_url`, `access_code`, `wifi_name`, `wifi_password`, `access_instructions`, `owner_id`, `chat_pin`, `amenities`, `house_rules`, `practical_info`, `auto_responses_enabled`, `arrival_message`, `quick_replies`, `internal_name`, `base_price`, `weekend_price`, `cleaning_fee`, `tourist_tax_per_night`, `concierge_pct`, `max_guests`, `bedrooms`, `beds`, `bathrooms`, `custom_auto_responses`, `booking_id`, `abritel_id`, `expedia_id`, `channex_property_id_ext`, `airbnb_commission_pct`, `booking_commission_pct`, `deposit_release_days`, `external_pricing`, `updated_at`

**Réponse (succès 200) :**
```json
{ "message": "Logement modifié avec succès", "property": { /* row DB complète + airbnbCommissionPct + bookingCommissionPct */ } }
```
Enveloppé. Clé `property` = ligne complète relue depuis la DB après update.

**`getAgencyUserIds` :** OUI — la clause `WHERE id = $22 AND user_id = ANY($23::text[])` utilise `agencyIds`.

**Effet de bord :** `setImmediate(() => triggerChannexRatesSync(propertyId, userId))` pour pousser les tarifs vers Channex.

---

### 3. `PATCH /api/properties/:propertyId` — Modification du propriétaire uniquement
**Fichier :** `server.js` **Ligne :** 18950

**Middlewares (dans l'ordre) :**
1. `authenticateAny` — aucun `requirePermission`, aucun `loadSubAccountData`

**Body attendu :**

| Champ | Clé body | Type DB | Obligatoire |
|---|---|---|---|
| ID propriétaire | `ownerId` | TEXT | non (null si absent) |

**Colonne modifiée :** `owner_id` uniquement.

**Réponse (succès 200) :**
```json
{ "success": true, "propertyId": "...", "ownerId": "..." }
```
Non enveloppé.

**`getAgencyUserIds` :** OUI (pour vérifier l'appartenance).

---

### 4. `DELETE /api/properties/:propertyId` — Suppression
**Fichier :** `server.js` **Ligne :** 19429

**Middlewares (dans l'ordre) :**
1. `authenticateAny`
2. `requirePermission(pool, 'can_delete_properties')`
3. `loadSubAccountData(pool)`

**Pas de body.**

**Cascade de suppression (dans l'ordre) :**
1. `DELETE FROM reservations WHERE property_id = $1`
2. `DELETE FROM conversations WHERE property_id = $1`
3. `DELETE FROM chat_messages WHERE property_id = $1` (tentative, non bloquante)
4. `DELETE FROM invoices WHERE property_id = $1` (tentative, non bloquante)
5. `DELETE FROM properties WHERE id = $1 AND user_id = $2`

**Réponse (succès 200) :**
```json
{ "message": "Logement supprimé avec succès", "property": { /* objet PROPERTIES en mémoire */ } }
```
Enveloppé.

**`getAgencyUserIds` :** OUI.

---

### 5. `PUT /api/properties/:id/upsell` — Options upsell
**Fichier :** `server.js` **Ligne :** 39704

**Middlewares :** `authenticateAny`

**Body attendu :**

| Champ | Clé body | Colonne | Type DB |
|---|---|---|---|
| Late checkout activé | `late_checkout_enabled` | `late_checkout_enabled` | BOOLEAN |
| Tolérance late checkout (min) | `late_checkout_tolerance_minutes` | `late_checkout_tolerance_minutes` | INTEGER |
| Prix late checkout / heure | `late_checkout_price_per_hour` | `late_checkout_price_per_hour` | NUMERIC |
| Durée max late checkout (min) | `late_checkout_max_minutes` | `late_checkout_max_minutes` | INTEGER |
| Early check-in activé | `early_checkin_enabled` | `early_checkin_enabled` | BOOLEAN |
| Tolérance early check-in (min) | `early_checkin_tolerance_minutes` | `early_checkin_tolerance_minutes` | INTEGER |
| Prix early check-in / heure | `early_checkin_price_per_hour` | `early_checkin_price_per_hour` | NUMERIC |
| Durée max early check-in (min) | `early_checkin_max_minutes` | `early_checkin_max_minutes` | INTEGER |
| Panier de bienvenue activé | `welcome_basket_enabled` | `welcome_basket_enabled` | BOOLEAN |
| Prix panier | `welcome_basket_price` | `welcome_basket_price` | NUMERIC |
| Description panier | `welcome_basket_description` | `welcome_basket_description` | TEXT |

Les champs `_tolerance_minutes` utilisent `COALESCE($n, valeur_actuelle)` : envoyer `null` ne les écrase pas.

**Réponse :** `{ "success": true }` — non enveloppé.

**`getAgencyUserIds` :** OUI.

---

### 6. `PUT /api/properties/:propertyId/quick-replies` — Réponses rapides
**Fichier :** `server.js` **Ligne :** 28044

**Middlewares :** `authenticateAny`

**Body attendu :**

| Champ | Clé body | Type | Obligatoire |
|---|---|---|---|
| Réponses rapides | `quickReplies` | Array (obligatoire) | **oui** (400 si non-Array) |

Chaque élément : `{ title: string, text: string }` ou string simple (rétro-compat). Maximum 5 éléments (tronqué).

**Colonne modifiée :** `quick_replies` (JSONB, format `[{title, text}]`).

**Réponse :** `{ "success": true, "quickReplies": [...] }` — non enveloppé.

**`getAgencyUserIds` :** OUI.

---

### 7. `PUT /api/properties-order/bulk` — Réordonnancement en masse
**Fichier :** `server.js` **Ligne :** 19541

**Middlewares :** `authenticateAny`

**Body attendu :**

| Champ | Clé body | Type | Obligatoire |
|---|---|---|---|
| Ordre des IDs | `order` | Array de propertyId strings | **oui** |

**Colonne modifiée :** `display_order` (INTEGER) sur chaque propriété listée. Mise à jour transactionnelle en 2 passes pour éviter les collisions de contrainte unique.

**Réponse :** `{ "success": true }` — non enveloppé.

**`getAgencyUserIds` :** OUI.

---

### 8. `PUT /api/properties/:propertyId/reorder` — Déplacement unitaire haut/bas
**Fichier :** `server.js` **Ligne :** 19591

**Middlewares :** `authenticateAny` (sans `getAgencyUserIds` — filtre sur `user_id = $2` direct)

**Body attendu :**

| Champ | Clé body | Valeurs | Obligatoire |
|---|---|---|---|
| Direction | `direction` | `'up'` ou `'down'` | **oui** (400 sinon) |

**Colonne modifiée :** `display_order` (échange avec le voisin).

**`getAgencyUserIds` :** NON.

---

## Assistant IA — structures de données

### `customAutoResponses` — Q&R personnalisées

**Colonne DB :** `custom_auto_responses` — JSONB, DEFAULT `'[]'::jsonb` (migration `server.js` l.2664).

**Exposée dans** `GET /api/properties` et `PUT /api/properties/:id` sous les deux clés `customAutoResponses` et `custom_auto_responses` (doublon volontaire pour rétrocompat).

**Structure d'un élément :**
```json
{ "keywords": "piscine, pool, nager", "response": "Oui, le logement dispose d'une piscine privée chauffée !" }
```

| Champ | Type | Rôle |
|---|---|---|
| `keywords` | string | Mots-clés déclencheurs, séparés par des virgules. L'IA cherche un mot-clé dans la question du voyageur avant d'utiliser cette réponse. |
| `response` | string | Texte de la réponse automatique envoyée au voyageur. |

Construit dans `renderCustomQR()` / `addCustomQR()` (`public/js/settings.js` l.3091–3132). Sauvegardé via `PUT /api/properties/:propertyId` (champ `customAutoResponses`, JSON stringifié dans le multipart).

---

### Faits mémorisés — table `property_facts`

Les « faits mémorisés » ne sont **pas** une colonne JSONB sur `properties` : ils vivent dans une **table dédiée** `property_facts` (`server.js` l.36194).

**Schéma :**
```sql
CREATE TABLE IF NOT EXISTS property_facts (
  id          BIGSERIAL PRIMARY KEY,
  property_id TEXT NOT NULL,
  question    TEXT NOT NULL,
  answer      BOOLEAN,          -- vrai/faux (ex: "Y a-t-il une piscine ?")
  detail      TEXT,             -- précision libre, nullable
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, question)
);
```

**Routes CRUD (toutes `authenticateToken`) :**

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/api/properties/:id/facts` | `{ facts: [{ id, question, answer, detail, updated_at }] }` |
| POST | `/api/properties/:id/facts` | `{ success: true, fact: { id, question, answer, detail, updated_at } }` |
| DELETE | `/api/properties/:id/facts/:factId` | `{ success: true }` |

**Body POST :**
```json
{ "question": "Y a-t-il une piscine ?", "answer": true, "detail": "Piscine chauffée, disponible d'avril à octobre." }
```
`question` (string) et `answer` (booléen strict) sont obligatoires. `detail` est optionnel.

Un `POST` sur une question déjà existante fait un `ON CONFLICT ... DO UPDATE` (upsert).

Ces faits ne sont **pas** inclus dans la réponse de `GET /api/properties`. L'app mobile doit appeler `GET /api/properties/:id/facts` séparément.

---

### `quickReplies` — Raccourcis de messages

**Colonne DB :** `quick_replies` — JSONB, DEFAULT `'[]'::jsonb` (migration `server.js` l.2546).

**Exposée dans** `GET /api/properties` sous la clé `quick_replies` (et aussi `quickReplies` dans certains payloads agence `l.16996`).

**Structure d'un élément :**
```json
{ "title": "Code WiFi", "text": "Le code WiFi est ABC123. Le réseau s'appelle Appartement-Paris." }
```

| Champ | Type | Contrainte | Rôle |
|---|---|---|---|
| `title` | string | max 50 chars | Libellé du bouton affiché dans l'interface de messagerie. |
| `text` | string | max 200 chars | Message réellement envoyé au voyageur. |

Maximum **5 éléments** (tronqué côté backend, `l.28255`). Rétrocompat : un élément string simple est accepté (`title` = `text.slice(0, 30)`).

Route d'écriture dédiée : `PUT /api/properties/:id/quick-replies` (§6 ci-dessus). Les raccourcis sont aussi accessibles par `GET /api/properties/:id/quick-context` (avec `depositUrl`) pour l'interface de chat.

---

## Majorations par plateforme

**Colonne DB :** `platform_markups` — JSONB, DEFAULT `'{}'::jsonb` (+ `channex_markup_rate_plans` JSONB pour les plans Channex associés). Migration dans `routes/markup-routes.js` l.41.

### Lecture — `GET /api/properties/:id/markups`

**Fichier :** `routes/markup-routes.js` **Ligne :** 81

**Middleware :** `authenticateAny` (via `proprietaireDuLogement` dans `acces-logement.js` — fonctionne pour compte principal, sous-compte et délégation agence).

Les majorations **ne sont pas** incluses dans la réponse de `GET /api/properties`. Il faut un appel séparé à cette route.

**Réponse :**
```json
{
  "markups": { "ABB": 5, "BDC": 10.5 },
  "codes":   { "ABB": "Airbnb", "BDC": "Booking.com", "EXP": "Expedia", "VRB": "Abritel / VRBO" }
}
```

`markups` est un objet dont les clés sont les codes plateforme présents **et non nuls**. Une clé absente signifie « pas de majoration » (les valeurs 0 sont supprimées à l'écriture). La valeur est un `numeric` PostgreSQL (pourcentage, ex: `5` = +5 %).

`codes` liste tous les codes connus avec leur libellé affichable — utile pour rendre les champs sans les coder en dur côté client.

### Écriture — `PATCH /api/properties/:id/markups`

**Fichier :** `routes/markup-routes.js` **Ligne :** 103

**Body :**
```json
{ "code": "ABB", "pct": 5 }
```

Un seul PATCH par plateforme (pas de remplacement total). Envoyer `pct: 0` ou `pct: ""` supprime la clé. **Réponse :**
```json
{
  "markups": { "ABB": 5 },
  "applique_au_prochain_push": true,
  "plan_cree": true,
  "remappe": false,
  "action_utilisateur": [],
  "coherence": { ... }
}
```
`markups` reflète l'état complet de `platform_markups` après modification.
