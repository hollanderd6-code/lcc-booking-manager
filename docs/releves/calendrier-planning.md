# Relevé de contrat d'API — Vue Planning (Calendrier)

> Lecture seule — `server.js` (46 160 lignes), `public/app.html`, `public/reservations.html`, `public/js/calendar-modern.js`.
> Aucun champ n'a été inventé ; tout ce qui n'a pas été lu est signalé « non prouvé ».

---

## 1. `GET /api/reservations`

### Localisation
`server.js` ligne 9326.

### Middlewares
```
authenticateToken  (via authenticateAny)
checkSubscription
```
`authenticateAny` accepte les comptes principaux ET les sous-comptes (JWT contenant `subAccountId`).

### Paramètres de requête
| Param | Obligatoire | Effet |
|-------|-------------|-------|
| `agency=all` | non | Active `getAgencyUserIds()` → étend la liste des `user_id` aux comptes délégués (`account_delegations`) |

Il n'existe **pas** de paramètre `from` / `to`, ni `property_id` en query string sur cette route. Le filtrage se fait côté serveur selon les propriétés appartenant à l'utilisateur (ou à son ensemble agence). Aucun paramètre de plage de dates n'est accepté : la route retourne **toutes** les réservations non annulées du compte.

### Filtrage agence
```js
// server.js l.6304-6312
async function getAgencyUserIds(req, userId) {
  if (req.query.agency !== 'all') return [userId];
  // ... SELECT delegator_user_id FROM account_delegations WHERE delegate_user_id = $1
  return [userId, ...delegations];
}
```
La route `GET /api/reservations` appelle `getAgencyUserIds` (l.9364) ; le mode agence est donc supporté à condition que le client envoie `?agency=all`.

### Requête SQL principale (l.9415–9464)
```sql
SELECT
  r.uid,
  r.property_id,
  r.guest_name,
  r.guest_first_name,
  r.guest_last_name,
  COALESCE(NULLIF(r.guest_email,''), c.guest_email) as guest_email,
  COALESCE(NULLIF(r.guest_phone,''), c.guest_phone) as guest_phone,
  r.guest_country,
  r.guest_language,
  r.guest_city,
  r.guest_address,
  r.guest_zip,
  r.occupancy_adults,
  r.occupancy_children,
  r.amount_total,
  r.amount_rooms,
  r.amount_taxes,
  r.amount_cleaning,
  r.ota_commission,
  r.host_payout,
  r.days_breakdown,
  r.currency,
  r.channex_booking_id,
  r.source,
  r.start_date,
  r.end_date,
  r.ota_name,
  r.notes,
  r.created_at,
  c.onboarding_completed,
  c.id as conversation_id,
  (SELECT json_agg(...) FROM payments p WHERE p.reservation_uid = r.uid) as payments
FROM reservations r
LEFT JOIN conversations c ON ...
WHERE r.user_id = ANY($1::text[])
  AND r.status != 'cancelled'
```

### Forme de la réponse
Objet enveloppé :
```json
{
  "reservations": [...],
  "lastSync":     "2026-09-03T10:00:00.000Z",
  "syncStatus":   "ok",
  "properties": [
    {
      "id":              "prop-uuid",
      "name":            "Mon Appartement",
      "internalName":    "App 1",
      "internal_name":   "App 1",
      "color":           "#3B82F6",
      "count":           12,
      "basePrice":       95,
      "weekendPrice":    120,
      "cleaningFee":     50,
      "touristTaxPerNight": 2,
      "conciergePct":    null,
      "channexEnabled":  true,
      "channexPropertyId": "chx-uuid",
      "arrivalTime":     "16:00",
      "departureTime":   "11:00",
      "depositAmount":   300,
      "depositReleaseDays": 7,
      "address":         "12 rue de la Paix, Paris"
    }
  ]
}
```

### Champs de chaque élément de `reservations`
La réponse mêle des objets provenant du store iCal (enrichis) et des objets purement DB (résas manuelles/Channex).  
Les champs ci-dessous sont ceux effectivement construits dans le code (l.9537–9688) :

| Champ | Type JS | Notes |
|-------|---------|-------|
| `id` | string | = `uid` |
| `uid` | string | Identifiant primaire (iCal uid, `block_<ts>`, ou UUID pour Channex) |
| `propertyId` | string | ID du logement |
| `propertyName` | string | Nom affiché (`internal_name` ou `name`) |
| `startDate` | Date object (objet Date Postgres) | Voir §dates |
| `endDate` | Date object \| null | Voir §dates |
| `start` | same as `startDate` | Alias du store iCal |
| `end` | same as `endDate` | Alias du store iCal |
| `guestName` | string | Nom complet brut du guest |
| `platform` | string | Normalisé : `'airbnb'`, `'booking'`, `'expedia'`, `'vrbo'`, `'channex'`, `'direct'`, `'BLOCK'` |
| `source` | string | Valeur brute DB : `'channex'`, `'AIRBNB'`, `'BLOCK'`, `'MANUEL'`, `'DIRECT'`, `'bhguest_hold'` |
| `type` | string | `'manual'`, `'block'`, `'hold'` ou absent |
| `isManual` | boolean | Présent uniquement sur les résas manuelles/directes |
| `price` | number \| null | `parseFloat(amount_total)` |
| `property` | object | `{ id, name, color, internalName, internal_name }` |
| `guest_first_name` | string \| null | |
| `guest_last_name` | string \| null | |
| `guest_phone` | string \| null | COALESCE résa + conversation |
| `guest_email` | string \| null | COALESCE résa + conversation |
| `guest_country` | string \| null | |
| `guest_language` | string \| null | |
| `guest_city` | string \| null | |
| `guest_address` | string \| null | |
| `guest_zip` | string \| null | |
| `guest_display_name` | string \| null | Calculé : `first_name + ' ' + last_name` ou `guest_name` |
| `guest_initial` | string \| null | Première lettre de `guest_first_name` |
| `occupancy_adults` | number \| null | Peut valoir `null` si absent en DB |
| `occupancy_children` | number | Défaut `0` |
| `onboarding_completed` | boolean | Défaut `false` |
| `amount_total` | number \| null | `parseFloat` — jamais en chaîne dans la réponse |
| `amount_rooms` | number \| null | `parseFloat` |
| `amount_taxes` | number \| null | `parseFloat` |
| `amount_cleaning` | number \| null | `parseFloat` |
| `ota_commission` | number \| null | `parseFloat` |
| `host_payout` | number \| null | `parseFloat` — uniquement sur les résas Channex |
| `days_breakdown` | object \| null | JSON JSONB Postgres — détail par nuit |
| `currency` | string | Défaut `'EUR'` |
| `ota_name` | string \| null | Uniquement sur les résas Channex (ex. `'abb'`, `'bdc'`) |
| `notes` | string \| null | Filtré par `isRealNote()` |
| `createdAt` | string ISO 8601 \| null | `new Date(created_at).toISOString()` |
| `payments` | array | `[{ id, status, amount_cents, created_at }]` |
| `channex_booking_id` | string \| null | ID interne Channex |
| `status` | string | Pour les holds : `'hold'` |
| `expires_at` | string \| null | Pour les holds BHGuest uniquement |
| `holdToken` | string \| null | Pour les holds BHGuest uniquement |
| `fixedPrice` | number \| null | Pour les holds BHGuest uniquement |
| `guestEmail` | string \| null | camelCase — uniquement sur les holds |
| `guestPhone` | string \| null | camelCase — uniquement sur les holds |

### Dates : format et fuseau
- **Type DB** : `start_date DATE`, `end_date DATE` (PostgreSQL `DATE`, sans timezone).
- **Dans la réponse** : le driver `pg` renvoie les colonnes `DATE` sous forme d'objets `Date` JavaScript (minuit UTC). Le code lit `r.start_date` et `r.end_date` directement sans `TO_CHAR` dans cette route ; la sérialisation JSON les convertit en string ISO 8601 (`"2026-08-15T00:00:00.000Z"`).
- **Doublon snake_case / camelCase** : `startDate` + `start`, `endDate` + `end` coexistent sur chaque objet. Les résas manuelles/Channex posent `startDate: dbData.start_date` et `start: dbData.start_date` (l.9598–9599). Le frontend lit indifféremment l'un ou l'autre (`r.start || r.startDate`).
- **Fuseau** : pas de conversion `AT TIME ZONE` dans ce SELECT → les dates sont stockées et retournées en UTC-naïf (i.e. la date locale entrée par l'utilisateur).

### `reservation_key`
N'est **pas** exposé dans `GET /api/reservations`. Il n'est présent que dans le store mémoire iCal (`reservationsStore`) comme clé d'index interne (`property_id + '_' + start_date + '_' + end_date`). Il n'apparaît pas dans le JSON renvoyé au client.

### Champs numériques — risque de chaîne
Tous les montants (`amount_total`, `amount_rooms`, etc.) passent par `parseFloat()` avant insertion dans la réponse (l.9560–9565) → **toujours `number` côté client**. Exception : si `dbData.amount_total` est `null`, le champ vaut `null` (pas `0`).

---

## 2. Blocages : `POST /api/blocks` et `DELETE /api/blocks/:id`

### Pas de `GET /api/blocks`
Il n'existe **pas** de route dédiée `GET /api/blocks`. Les blocages sont retournés dans `GET /api/reservations` : ils apparaissent dans le tableau `reservations` avec les marqueurs `source: 'BLOCK'`, `platform: 'BLOCK'`, `type: 'block'`.

### `POST /api/blocks`
`server.js` ligne 10106.

**Middlewares** : aucun middleware déclaré dans la signature — l'auth est vérifiée manuellement via `getUserFromRequest(req)` (l.10108). Le mode agence est supporté (`getAgencyUserIds`, l.10117).

**Corps JSON requis** :
```json
{
  "propertyId": "prop-uuid",
  "start":      "2026-09-10",
  "end":        "2026-09-15",
  "reason":     "Travaux"
}
```
`reason` est facultatif. `start` et `end` sont des chaînes `YYYY-MM-DD`.

**Ce qui est inséré en DB** :
```sql
INSERT INTO reservations (
  uid, property_id, user_id,
  start_date, end_date,
  guest_name, source, platform, reservation_type,
  status, notes
) VALUES (
  'block_<timestamp>',  -- uid généré
  propertyId,
  ownerId,
  start, end,
  reason || 'Blocage calendrier',  -- guest_name
  'BLOCK', 'BLOCK', 'block',
  'confirmed',
  reason || ''
)
```

**Réponse 201** :
```json
{
  "message": "Blocage créé",
  "block": {
    "uid":       "block_1725350400000",
    "propertyId": "prop-uuid",
    "start":     "2026-09-10",
    "end":       "2026-09-15",
    "source":    "BLOCK",
    "platform":  "BLOCK",
    "type":      "block",
    "guestName": "Travaux",
    "notes":     "Travaux",
    "createdAt": "2026-09-03T10:00:00.000Z"
  }
}
```

**Effets secondaires** : ajout dans `MANUAL_RESERVATIONS[]`, `reservationsStore.properties[]`, émission Socket.IO `calendar:block_added`, puis sync Channex.

### `DELETE /api/blocks/:id`
`server.js` ligne 17558.

**Middlewares** : `authenticateAny`. Mode agence supporté.

`:id` accepte un **id numérique** (colonne `id SERIAL`) **ou** un **uid** (ex. `block_1725350400000`) — les deux sont testés dans le DELETE WHERE.

**Réponse 200** :
```json
{ "success": true, "deleted": 42 }
```
(valeur numérique = `id` de la ligne supprimée)

### `POST /api/blocks/batch`
`server.js` ligne 17623. Corps :
```json
{
  "property_ids": ["prop-1", "prop-2"],
  "date_from":   "2026-10-01",
  "date_to":     "2026-10-08",
  "action":      "block",
  "reason":      "Entretien",
  "weekdays":    [0, 6]
}
```
`action` = `'block'` ou `'unblock'`. `weekdays` filtre les jours de semaine (0=dim).

### Distinguer un blocage d'une réservation
Un blocage est identifiable par **trois conditions redondantes** (toutes THREE peuvent être vraies simultanément) :
- `source === 'BLOCK'`
- `platform === 'BLOCK'`
- `type === 'block'` (dans le store JS) / `reservation_type === 'block'` (en DB)

Le frontend teste les trois (l.9707 `server.js`, l.8069 `app.html`).

---

## 3. Prix par case : routes de lecture et d'écriture

### Route de lecture principale : `GET /api/host/pricing/calendar/:propertyId`
`server.js` ligne 21504.

**Middlewares** : `authenticateToken` uniquement (pas de support agence — `assertHostOwnsProperty` vérifie que `req.user.id` possède le logement). **Pas de support sous-compte ni mode agence.**

**Paramètre** : `?months=6` (optionnel, max 18, défaut 6).

**Réponse** :
```json
{
  "basePrice":    95,
  "weekendPrice": 120,
  "prices": {
    "2026-09-03": 95,
    "2026-09-04": 120,
    "2026-09-05": 80
  },
  "booked": [
    { "start": "2026-09-10", "end": "2026-09-15", "guest": "Jean Dupont" }
  ],
  "blocked": [
    { "start": "2026-09-20", "end": "2026-09-22", "guest": null }
  ]
}
```
`prices` est un dictionnaire `{ "YYYY-MM-DD": number }` produit par `getCalendarPricesForRange()` (l.327).

### Logique de priorité du prix (fonction `getCalendarPricesForRange`, l.327–398)
1. **Override manuel** (`pricing_overrides` WHERE date exacte) → prioritaire absolu.
2. **Règle de période** (`pricing_rules` WHERE `rule_type = 'period'` et date dans l'intervalle), triée par `priority DESC` → premier match gagne.
3. **Règle jour de semaine** (`pricing_rules` WHERE `rule_type = 'weekday'` et `days_of_week` contient le dow), triée par `priority DESC`.
4. **Prix de base** : `weekendPrice` si vendredi (dow=5) ou samedi (dow=6), sinon `basePrice` (colonnes `properties.weekend_price` et `properties.base_price`).

### Route de lecture alternative : `GET /api/pricing/overrides`
`server.js` ligne 17397.

**Middlewares** : `authenticateAny`, `requirePermission(pool, 'can_view_pricing')`. Mode agence supporté.

**Paramètres** : `?property_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD` (tous facultatifs).

**Réponse** :
```json
{
  "overrides": [
    { "property_id": "prop-uuid", "date": "2026-09-15", "price": 110 }
  ]
}
```
`date` est formaté `TO_CHAR(date, 'YYYY-MM-DD')` → toujours une **chaîne** (jamais un objet Date). `price` est `NUMERIC(10,2)` retourné par `pg` comme **chaîne** (comportement par défaut du driver pour `NUMERIC`) — l'objet `{ date, price }` brut du SELECT n'applique pas `parseFloat`.

### Route d'écriture : `POST /api/pricing/overrides`
`server.js` ligne 17436.

**Middlewares** : `authenticateAny`, `requirePermission(pool, 'can_manage_pricing')`. Mode agence supporté.

**Corps JSON** :
```json
{
  "property_id": "prop-uuid",
  "date":        "2026-09-15",
  "price":       110
}
```
`price` = `null` / `""` / absent → supprime l'override. Sinon `parseFloat(price)` est appliqué.

**Réponse 200** :
```json
{ "success": true, "property_id": "prop-uuid", "date": "2026-09-15", "price": 110 }
```

**Ce qui rend ce prix prioritaire** : la colonne `pricing_overrides(user_id, property_id, date)` a une contrainte `UNIQUE` et `getCalendarPricesForRange` consulte cette table en premier (l.371) avant toute règle.

### Route d'écriture bulk : `POST /api/pricing/overrides/batch`
`server.js` ligne 17486. Corps :
```json
{
  "property_ids": ["prop-1"],
  "date_from":    "2026-10-01",
  "date_to":      "2026-10-08",
  "price":        90,
  "weekdays":     [1, 2, 3, 4, 5]
}
```
Sémantique : `date_to` est le checkout — non inclus (l.9510). `weekdays` est facultatif (0=dim).

**Réponse** :
```json
{ "success": true, "count": 5, "properties": 1, "dates": 5 }
```

### Route d'écriture alternative : `POST /api/host/pricing/override`
`server.js` ligne 21549. Réservée aux BHGuest hosts (pas de sous-compte, pas d'agence).

Corps :
```json
{
  "propertyId": "prop-uuid",
  "dates":      ["2026-09-15", "2026-09-16"],
  "price":      110
}
```

---

## 4. Calcul de l'occupation journalière (vue « tous les logements »)

### Affichage dans le planning grille (`app.html`)
La grille mois est rendue par `renderMonth()` (`app.html` l.7823). Pour chaque cellule, le prix affiché est lu depuis `prop.basePrice` ou `prop.weekendPrice` (l.7989) — **le prix de la cellule dans la grille vient des propriétés en cache, pas d'un appel à `/api/pricing/overrides`** ; les overrides ne sont donc pas reflétés dans la grille principale (ils le sont uniquement via `/api/host/pricing/calendar/:propertyId`).

### KPI global taux d'occupation (dashboard, `app.html`)
Fonction `computeKpis()`, l.6111–6179.

**Source des données** : `window.LCC_RESERVATIONS` (alias `allReservations`) — tableau brut de `GET /api/reservations`.

**Algorithme** :
1. Itère sur toutes les réservations du mois en cours.
2. **Exclusions** : `r.type === 'block' || r.source === 'BLOCK'` (l.6140) — les blocages ne comptent pas dans les nuits réservées.
3. **Annulées** : déjà exclues côté serveur (`status != 'cancelled'` dans le SELECT).
4. Par logement, accumule les intervalles `[start_clamped, end_clamped]` limités au mois.
5. Fusionne les intervalles (union) pour éviter le double-comptage iCal.
6. `nightsBooked` = somme des durées en jours.
7. `totalNightsPossible = properties.length * daysInMonth` (l.6124).
8. `occupancy = round(nightsBooked / totalNightsPossible * 100)`.

**Affichage** : `nb / tp` nuits (ex. « 18 / 26 »), l.6245–6246.

### Modal détail par logement (`app.html` l.11207–11327)
Même algorithme, par logement individuel, dénominateur = `daysInMonth` seul.

---

## 5. Filtrage agence — bilan par route

| Route | `getAgencyUserIds` / agence | Commentaire |
|-------|-----------------------------|-------------|
| `GET /api/reservations` | ✅ supporté (`?agency=all`) | l.9364 |
| `POST /api/blocks` | ✅ supporté | l.10117 |
| `DELETE /api/blocks/:id` | ✅ supporté | l.17565 |
| `POST /api/blocks/batch` | ✅ supporté | l.17636 |
| `GET /api/pricing/overrides` | ✅ supporté | l.17404 |
| `POST /api/pricing/overrides` | ✅ supporté | l.17448 |
| `POST /api/pricing/overrides/batch` | ✅ supporté | l.17498 |
| `DELETE /api/pricing/overrides/:property_id/:date` | ✅ supporté | l.17746 |
| `GET /api/host/pricing/calendar/:propertyId` | ❌ non supporté | `authenticateToken` + `assertHostOwnsProperty` — user_id scalaire uniquement |
| `POST /api/host/pricing/override` | ❌ non supporté | idem |
| `DELETE /api/host/pricing/override` | ❌ non supporté | idem |
| `POST /api/host/pricing/block` | ❌ non supporté | idem |

---

## 6. Champs numériques — risques de chaîne vs nombre

| Champ | Type en réponse | Risque chaîne |
|-------|-----------------|---------------|
| `amount_total`, `amount_rooms`, `amount_taxes`, `amount_cleaning`, `ota_commission`, `host_payout` | `number` (parseFloat appliqué) | Non |
| `price` (résas store iCal) | `number` (parseFloat) | Non |
| `occupancy_adults` | `number \| null` | Non (`INTEGER` Postgres) |
| `occupancy_children` | `number` | Non |
| `overrides[].price` (route `GET /api/pricing/overrides`) | **chaîne** (`NUMERIC` pg non parsé) | **OUI** — `TO_CHAR` n'est pas appliqué sur `price`, `pg` retourne `NUMERIC` comme string |
| `prices.YYYY-MM-DD` (`GET /api/host/pricing/calendar`) | `number` (parseFloat dans `getCalendarPricesForRange`) | Non |
| `basePrice`, `weekendPrice` (envelope `properties[]`) | `number \| null` (parseFloat) | Non |

**Doublon camelCase / snake_case confirmés** :
- `startDate` et `start` coexistent sur chaque objet réservation.
- `endDate` et `end` coexistent.
- `propertyId` (camelCase) et `property_id` (snake_case) peuvent coexister selon l'origine de l'objet (store iCal vs DB).
- `internalName` et `internal_name` coexistent dans l'objet `property` imbriqué et dans l'enveloppe `properties[]`.
- `guestName` (camelCase, store iCal) vs `guest_name` (snake_case, DB).

---

## À TRANCHER (non prouvé par lecture seule)

1. **Valeur réelle de `start_date` / `end_date` renvoyée par `pg`** : le driver `pg` convertit les colonnes `DATE` en objets `Date` JS (minuit UTC) par défaut, mais ce comportement peut être surchargé via `pg.types.setTypeParser`. Aucune surcharge n'a été trouvée dans le code lu, mais l'existence d'un module externe configurant `pg` n'a pas été exclue.

2. **`price` dans `GET /api/pricing/overrides`** : le relevé indique que `pg` retourne `NUMERIC` comme chaîne, mais si le driver est configuré avec `pg.types.setTypeParser(1700, parseFloat)`, `price` serait un `number`. Non prouvé dans le code lu.

3. **Existence d'un GET `/api/blocks` distinct** : aucune route `app.get('/api/blocks'...)` n'a été trouvée. Cela a été confirmé par grep. Les blocages sont uniquement dans `GET /api/reservations`. À valider côté iOS que ce endpoint n'est pas appelé séparément.

4. **Affichage des prix overrides dans la grille** : la grille `renderMonth()` affiche `prop.basePrice` / `prop.weekendPrice` (issus de `properties[]` retournés par `GET /api/reservations`). Les overrides de `pricing_overrides` ne sont **pas** fusionnés dans cet affichage. Un appel séparé à `GET /api/pricing/overrides` ou `GET /api/host/pricing/calendar/:propertyId` est nécessaire pour afficher les prix réels par case. Non confirmé que le client iOS fait cet appel supplémentaire.

5. **`ota_name` — valeurs exactes** : le code normalise vers `'airbnb'`, `'booking'`, `'expedia'`, `'vrbo'`, `'channex'` mais les valeurs brutes en DB (`r.ota_name`) ne sont pas documentées dans le code lu (elles viennent de Channex). Les chaînes `'abb'`, `'bdc'`, `'exp'` ont été vues dans les commentaires de normalisation mais non confirmées comme valeurs exhaustives.

6. **`reservation_key` dans `cleaning_checklists`** : le format vu est `property_id + '_' + start_date + '_' + end_date` (l.902). Non prouvé que toutes les checklists utilisent ce format (certaines lignes utilisent des UIDs directs).

7. **Pagination** : `GET /api/reservations` ne pagine pas. Sur un compte avec des centaines de résas, la réponse est retournée en un seul tableau. Aucune option `limit`/`offset` n'a été trouvée.
