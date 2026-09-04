# Relevé — Messages automatiques (templates)

> Lecture seule. Source : `server.js` + `public/messages.html`.  
> Complète la section 7 de `mon-compte.md`.

---

## Schéma de la table `message_templates`

```sql
CREATE TABLE IF NOT EXISTS message_templates (
  id                   SERIAL PRIMARY KEY,
  user_id              TEXT NOT NULL,
  property_id          TEXT,                          -- legacy (1 logement)
  title                TEXT NOT NULL,
  message              TEXT NOT NULL,
  trigger_type         TEXT NOT NULL DEFAULT 'on_booking',
  trigger_offset_hours INTEGER DEFAULT 0,            -- legacy / recalculé
  trigger_offset_days  INTEGER DEFAULT 0,            -- champ principal (migration ALTER)
  send_condition       TEXT DEFAULT 'always',
  active               BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  property_ids         JSONB DEFAULT '[]'            -- multi-logements (migration ALTER)
);
```

`trigger_offset_days` et `property_ids` ont été ajoutés par migrations `ALTER TABLE … ADD COLUMN IF NOT EXISTS` après la création initiale.

---

## 1. Déclencheur

### Champ

`trigger_type` TEXT — valeur unique parmi 7 littéraux stricts.

### Valeurs exhaustives

| Valeur | Label UI web | Heure d'envoi cron |
|---|---|---|
| `on_booking` | À la réservation (immédiat) | Webhook de réservation — immédiat, pas de cron |
| `before_arrival` | Avant l'arrivée | 7h00 Europe/Paris |
| `on_arrival` | Jour d'arrivée à 7h | 7h00 + filet 9h/11h/13h/15h/17h/19h/21h |
| `after_arrival` | Après l'arrivée | 10h00 Europe/Paris |
| `before_departure` | Avant le départ | 7h00 Europe/Paris |
| `on_departure` | Jour du départ à 15h | 15h00 Europe/Paris |
| `after_departure` | Après le départ | 15h00 Europe/Paris |

### Délai N — stockage

Le délai N est stocké dans **deux champs distincts**, tous les deux INTEGER :

- **`trigger_offset_days`** (champ principal, lu par le cron et la vue planning)
- **`trigger_offset_hours`** (champ legacy, recalculé par le frontend à la sauvegarde)

Le frontend calcule `trigger_offset_hours` à partir de `trigger_offset_days` au moment du `saveTemplate()` :

```js
trigger_offset_days: offsetDays,              // ex : 2
trigger_offset_hours: isAfter ? offsetDays * 24 : -(offsetDays * 24)
// before_arrival, before_departure → négatif : -48
// after_arrival, after_departure   → positif : +48
```

Le cron lit en priorité `trigger_offset_days`, et calcule un fallback depuis `trigger_offset_hours` si `trigger_offset_days` vaut 0 :

```js
const offsetDays = tmpl.trigger_offset_days
  || Math.round(Math.abs(tmpl.trigger_offset_hours || 0) / 24) || 0;
```

Les déclencheurs `on_booking`, `on_arrival`, `on_departure` n'ont pas d'offset (`trigger_offset_days = 0`).  
Le champ offset n'est visible dans l'UI que pour `before_arrival`, `after_arrival`, `before_departure`, `after_departure` (JS `updateTriggerOffsetVisibility()`).

```html
<!-- input affiché uniquement si before/after -->
<input id="tplOffsetDays" type="number" min="1" max="30" value="2">
<input type="hidden" id="tplOffset" value="0">  <!-- trigger_offset_hours -->
```

---

## 2. Conditions d'envoi

### Champ

`send_condition` TEXT DEFAULT `'always'`.

Peut contenir **une ou plusieurs valeurs séparées par virgule** (ex. `'deposit_active,police_complete'`). Le moteur les découpe sur `,` et les traite indépendamment.

### Tokens conditions (logique ET — toutes doivent être satisfaites)

| Valeur en base | Label UI | Sémantique |
|---|---|---|
| `always` | *(aucune coche)* | Toujours envoyer — valeur si la liste est vide |
| `deposit_active` | Caution validée | `deposits.status IN ('captured','authorized')` |
| `deposit_captured` | *(alias)* | Identique à `deposit_active` — le frontend le remplace à l'affichage |
| `deposit_pending` | Caution non encore payée | Status ni `captured` ni `authorized` — pour relances |
| `police_complete` | Fiche de police signée | `police_records` avec `status = 'signed'` — voyageurs étrangers seulement |
| `checkin_complete` | *(alias legacy)* | Décomposé en `deposit_active + police_complete` à l'exécution |

### Tokens filtre plateforme (logique OU — au moins une doit correspondre)

| Valeur en base | Label UI | Plateforme matchée |
|---|---|---|
| `platform_booking` | Booking.com | `isBooking` (`includes('booking')` ou `=== 'bdc'`) |
| `platform_airbnb` | Airbnb | `isAirbnb` (`includes('airbnb')` ou `=== 'abb'`) |
| `platform_direct` | Direct / BHGuest | `isDirect` (`=== 'direct'` ou `=== ''`) ou `isBHGuest` |

Les tokens `platform_*` sont séparés des tokens conditions dans le helper `shouldSkipForDepositCondition()` :

```js
const platTokens = tokens.filter(t => t.startsWith('platform_'));
const reqTokens  = tokens.filter(t => !t.startsWith('platform_'));
```

### Règle « aucune coche = toujours »

Quand toutes les cases sont décochées, le frontend envoie `send_condition: 'always'` :

```js
send_condition: (function(){
  const sel = Array.from(document.querySelectorAll('.tplCond:checked')).map(cb => cb.value);
  return sel.length ? sel.join(',') : 'always';
})(),
```

En base, `send_condition = 'always'` (ou `NULL` interprété comme `'always'`).  
Le helper court-circuite immédiatement si `sendCond === 'always'` :

```js
if (!sendCond || sendCond === 'always') return { skip: false };
```

### Exemptions automatiques (indépendantes du réglage)

- **Airbnb** : toujours exempt de la vérification `deposit_active`/`deposit_pending` (Airbnb gère la caution lui-même).
- **BHGuest** : toujours exempt de la vérification caution (paiement Stripe intégré).
- **Condition `police_complete`** : ignorée pour les voyageurs français (`guest_country IN ('FR','FRA','FRANCE')`) ou de nationalité inconnue — la fiche ne concerne que les étrangers.
- **Logement sans caution configurée** (`deposit_amount IS NULL OR = 0`) : les conditions `deposit_*` sont ignorées (le logement n'a pas de caution à vérifier).

### Comportement spécial `on_arrival`

Le cron `on_arrival` applique en plus deux vérifications hardcodées (indépendamment de `send_condition`) :

1. **Caution non validée** → skip si `deposit_amount > 0` et status deposit ni `captured` ni `authorized`.
2. **Fiche de police non complétée** → skip si voyageur étranger sans `police_records` signée.

Ces vérifications n'existent pas pour les autres triggers.

---

## 3. Filtre plateforme

Voir section 2 ci-dessus : les tokens `platform_booking`, `platform_airbnb`, `platform_direct` sont stockés **dans le même champ `send_condition`**, séparés par virgule avec les conditions d'envoi.

**Aucune coche** (aucun token `platform_*`) = pas de filtre = envoyé à toutes les plateformes.  
**Une ou plusieurs coches** = filtre OR (au moins une des plateformes cochées doit correspondre).

Il n'y a pas de champ `platform_filter` séparé.

Exemple en base avec conditions + filtre :
```
send_condition = "deposit_active,platform_booking,platform_direct"
```
Signifie : caution validée ET (Booking.com OU Direct).

---

## 4. Logements concernés

### Champs

| Champ | Type | Rôle |
|---|---|---|
| `property_ids` | JSONB (tableau de strings) | Multi-sélection — champ principal |
| `property_id` | TEXT | Sélection legacy mono-logement — rétrocompatibilité |

### Valeur « tous les logements »

`property_ids = '[]'` (tableau vide) **ET** `property_id = NULL`.

Logique de priorité dans le serveur :

```js
const cibles = (() => {
  try {
    const l = Array.isArray(t.property_ids)
      ? t.property_ids
      : JSON.parse(t.property_ids || '[]');
    if (l.length) return l;              // property_ids fait foi si non vide
  } catch (e) {}
  return t.property_id ? [t.property_id] : [];  // fallback legacy
  // [] final → template global
})();
```

### Champs calculés renvoyés par le GET

Le serveur enrichit chaque template avec trois champs JS (non stockés en base) :

| Champ | Type | Signification |
|---|---|---|
| `logements_couverts` | INTEGER | Nombre de logements du parc atteignables (intersection cibles ∩ parc) |
| `logements_cibles` | INTEGER \| null | Nombre de logements explicitement ciblés (`null` si global) |
| `portee` | `'ciblee'` \| `'globale'` | Type de portée |

### Affichage web (carte de liste)

```js
if (ids.length === 0) {
  // "Tous les logements — 26 logements" (si logements_couverts = 26)
  return ' · Tous les logements' + porteeTexte(t);
} else {
  // "Villa Rose, Apt Mer"  (liste des noms)
  return ` · ${names}`;
}
```

`porteeTexte(t)` ajoute `" — N logement(s)"` si `logements_couverts` est disponible, ou `" — aucun logement"` en rouge si 0.

**Distinction "tous" vs "26 explicitement cochés"** : un template avec `property_ids = ['id1',...,'id26']` affiche les noms des 26 logements, jamais "Tous les logements". Seul `property_ids = []` produit "Tous les logements". Il n'y a aucune ambiguïté en base.

### Sauvegarde

```js
// Tous cochés → tplPropAll.checked = true → getTplSelectedPropertyIds() retourne []
// Sélection → retourne l'array des IDs cochés
property_ids: getTplSelectedPropertyIds(),
property_id:  document.getElementById('tplProperty').value || null,
```

---

## 5. Variables insérables

Définies dans deux endroits du code qui se synchronisent :
- `sendTemplateMessage()` — ligne ~30606 (cron + envoi automatique)  
- Route `POST /api/message-templates/:id/send` — ligne ~31282 (envoi manuel)

### Variables universelles (tous déclencheurs)

| Jeton | Source DB | Valeur |
|---|---|---|
| `{prenom}` | `conversations.guest_first_name` ou premier mot de `guest_name` | Prénom du voyageur |
| `{nom}` | `conversations.guest_name` | Nom complet |
| `{logement}` | `conversations.property_name` | Nom du logement |
| `{arrivee}` | `conversations.reservation_start_date` | Date formatée `fr-FR` |
| `{depart}` | `conversations.reservation_end_date` | Date formatée `fr-FR` |
| `{adresse}` | `properties.address` | Adresse du logement |
| `{heure_arrivee}` | `properties.arrival_time` | Heure d'arrivée (texte libre) |
| `{heure_depart}` | `properties.departure_time` | Heure de départ (texte libre) |
| `{arrivalTime}` | `properties.arrival_time` | Alias de `{heure_arrivee}` (même regex insensible à la casse) |
| `{departureTime}` | `properties.departure_time` | Alias de `{heure_depart}` |
| `{code_acces}` | `properties.access_code` | Code d'accès |
| `{wifi_nom}` | `properties.wifi_name` | Nom du réseau WiFi |
| `{wifi_mdp}` | `properties.wifi_password` | Mot de passe WiFi |
| `{instructions}` | `properties.practical_info` | Infos pratiques |
| `{livret}` | `properties.welcome_book_url` | URL du livret d'accueil |

### Variables spéciales (contraintes)

#### `{code_serrure}` / `{lock_code}`

Code de serrure connectée Igloohome, généré à la volée via `resolveOrGenerateLockCode()`. Les deux jetons sont synonymes (même regex). Requiert Igloohome configuré sur le logement — sinon remplacé par chaîne vide.

#### `{caution_url}`

Lien court vers la page de paiement Stripe de la caution.

Comportement selon la plateforme :
- **Airbnb** : `{caution_url}` est supprimé du message (remplacé par `''`), message envoyé quand même.
- **Autres, deposit existant** (`status IN ('pending','authorized')`) : remplacé par l'URL raccourcie.
- **Autres, pas de deposit** : créé à la volée si `deposit_amount > 0` et compte Stripe valide.
- **Autres, impossible à résoudre** : **message non envoyé** (retour `{ skipped: true }`).

Pas de déclencheur exclusif — utilisable sur tous les triggers, mais typiquement `before_arrival`.

#### `{checkin_link}`

Lien vers la fiche de police / check-in en ligne (`/checkin.html?token=…`).

**Garde-fous stricts** (définis dans `sendTemplateMessage()`) :
- Voyageur **français** (`guest_country = 'FR'/'FRA'/'FRANCE'`) → message **non envoyé**.
- Nationalité **inconnue/absente** → message **non envoyé** (fail-closed).
- Voyageur **étranger** clairement identifié → message envoyé.

Pas de déclencheur exclusif — utilisable sur n'importe quel trigger, mais typiquement `before_arrival` ou `on_booking`.

---

## 6. État actif / en pause

### Champ

`active` BOOLEAN DEFAULT `TRUE`.

| Valeur | Badge UI | Icône bouton |
|---|---|---|
| `true` | "Actif" (fond vert pâle) | `fa-pause` rouge |
| `false` | "Inactif" (fond gris) | `fa-play` vert |

### Route de basculement

**Pas de route dédiée.** Le basculement passe par le PUT standard :

```
PUT /api/message-templates/:id
Body: { "active": false }
```

Le frontend utilise `toggleTemplate(id, !t.active)` qui appelle :

```js
fetch(`/api/message-templates/${id}`, {
  method: 'PUT',
  body: JSON.stringify({ active })   // seul champ envoyé
});
```

Le PUT utilise `COALESCE($5, active)` donc les autres champs non fournis sont inchangés.

---

## 7. Traduction automatique

**Pas de champ par template** — la traduction est **toujours active** pour tous les templates envoyés via `sendTemplateMessage()`.

### Mécanisme

- Via **DeepL Free API** (`DEEPL_API_KEY`).
- La langue cible est déduite de `reservations.guest_country` et `reservations.guest_language` par `getDeepLTarget(guestCountry, guestLanguage)`.
- Si DeepL échoue (timeout, quota, erreur), le message est envoyé en français — **fail-open**.
- Les URLs dans le message sont protégées via balises XML `<x>…</x>` avant l'appel DeepL pour éviter la localisation de la ponctuation.

### Quand elle ne s'applique pas

- Route `POST /api/message-templates/:id/send` (envoi manuel depuis l'UI) : **la traduction DeepL n'est PAS appliquée** dans ce chemin de code. `sendTemplateMessage()` n'est pas appelé ici — la substitution de variables et la traduction sont partiellement réimplémentées en inline, sans DeepL.
- Voyageur français → pas de traduction (DeepL ne traduit pas vers le français).

Le label "Traduction automatique activée" est affiché dans l'éditeur web sous le textarea comme mention informative — c'est un comportement global, non configurable par modèle.

---

## Routes — tableau récapitulatif

| Méthode + URL | Auth | `?agency=all` | Réponse |
|---|---|---|---|
| `GET /api/message-templates` | `authenticateToken` | ✅ | `{ templates: [...] }` enveloppé |
| `POST /api/message-templates` | `authenticateToken` | N/A (write) | `{ success: true, template: {...} }` |
| `GET /api/message-templates/diagnostic` | `authenticateToken` | ✅ | `{ total, a_corriger, templates, aide }` |
| `POST /api/message-templates/reattribuer` | `authenticateToken` | ✅ | `{ corriges, ignores, detail }` |
| `PUT /api/message-templates/:id` | `authenticateToken` | ✅ | `{ success: true, template: {...} }` |
| `DELETE /api/message-templates/:id` | `authenticateToken` | ✅ | `{ success: true }` |
| `POST /api/message-templates/:id/send` | `authenticateToken` | ✅ | `{ success: true, message: {...} }` |
| `GET /api/message-template-scheduled` | `authenticateToken` | ✅ | `{ scheduled: [...] }` |
| `POST /api/message-template-blocks` | `authenticateToken` | — | `{ success: true }` |
| `DELETE /api/message-template-blocks` | `authenticateToken` | — | `{ success: true }` |
| `GET /api/message-template-logs` | `authenticateToken` | ✅ | `{ logs: [...], total: INTEGER }` |

Toutes les routes utilisent `authenticateToken` (sous-comptes exclus — pas de `authenticateAny`).

### Réponse GET — structure d'un template

```json
{
  "id": 42,
  "user_id": "user_abc",
  "property_id": null,
  "title": "Bienvenue",
  "message": "Bonjour {prenom}, votre arrivée est prévue le {arrivee}...",
  "trigger_type": "before_arrival",
  "trigger_offset_hours": -48,
  "trigger_offset_days": 2,
  "send_condition": "deposit_active,platform_booking",
  "active": true,
  "created_at": "2025-01-10T09:00:00.000Z",
  "updated_at": "2025-01-10T09:00:00.000Z",
  "property_ids": [],
  "logements_couverts": 26,
  "logements_cibles": null,
  "portee": "globale"
}
```

### Corps POST/PUT — exemple complet

```json
{
  "title": "Code d'accès J-2",
  "message": "Bonjour {prenom}, voici votre lien de caution : {caution_url}",
  "trigger_type": "before_arrival",
  "trigger_offset_days": 2,
  "trigger_offset_hours": -48,
  "send_condition": "deposit_pending,platform_booking,platform_direct",
  "active": true,
  "property_id": null,
  "property_ids": ["12", "15", "23"]
}
```

---

## Points d'attention / doublons

### Duplication `trigger_offset_hours` / `trigger_offset_days`

Les deux champs coexistent. `trigger_offset_days` fait foi. `trigger_offset_hours` est envoyé par le frontend pour rétrocompatibilité mais le cron ne l'utilise que comme fallback si `trigger_offset_days = 0`.

**À trancher iOS** : n'envoyer que `trigger_offset_days`. Calculer `trigger_offset_hours` côté client si besoin de rétrocompatibilité ou l'ignorer.

### Duplication `property_id` / `property_ids`

Même logique : `property_ids` fait foi si non vide ; `property_id` = fallback legacy. Le frontend envoie les deux en parallèle (`property_id` = premier ID coché, ou null).

**À trancher iOS** : n'utiliser que `property_ids`. Envoyer `property_id = null` systématiquement, ou ne pas l'envoyer (le PUT le positionne à `$6 = property_id || null`).

### Pas de `send_condition` séparé pour plateforme

Les filtres plateformes (`platform_*`) vivent dans le même champ `send_condition` que les conditions de pré-envoi. L'UI les présente dans deux sections distinctes mais tout est joint en une chaîne.

### `total` dans `GET /api/message-template-logs`

`total` est déjà casté en `INTEGER` par `parseInt(total.rows[0].count)` côté serveur — pas de string numérique.

### `on_booking` — hors cron

Les templates `on_booking` s'exécutent sur webhook de nouvelle réservation, pas via le cron horaire. Ils sont **exclus** de la vue planning (`GET /api/message-template-scheduled`) :

```js
AND trigger_type NOT IN ('on_booking')
```

### `{checkin_link}` vs `{caution_url}` — comportements asymétriques

- `{caution_url}` non résolu sur non-Airbnb → **message non envoyé**.
- `{caution_url}` sur Airbnb → **message envoyé** (variable effacée).
- `{checkin_link}` voyageur français → **message non envoyé**.
- `{checkin_link}` nationalité inconnue → **message non envoyé** (fail-closed).

### SMS automatique

`sendTemplateMessage()` tente en plus un envoi SMS via Android Gateway pour :
- `before_arrival` uniquement si le message contient `{caution_url}` ou une URL `http`.
- `on_arrival` (toujours, si numéro dispo).
- Jamais sur Airbnb.  
Ce comportement n'est pas configurable par template.

---

## À TRANCHER

1. **`trigger_offset_hours` à l'écriture** : envoyer ou non en iOS ? Le cron ignore `trigger_offset_hours` si `trigger_offset_days` est présent. Mais certains anciens templates ont `trigger_offset_days = 0` et reposent sur `trigger_offset_hours`. Décider si on continue à calculer les deux ou si on pose `trigger_offset_hours = 0` systématiquement.

2. **`property_id` à l'écriture** : le PUT écrase toujours `property_id` (pas de COALESCE, `$6 = property_id || null`). Un iOS qui n'envoie pas `property_id` dans le body l'effacera — vérifier si c'est souhaitable.

3. **Sous-comptes** : toutes les routes utilisent `authenticateToken` (comptes principaux uniquement). Les sous-comptes (cleaners, staff) ne peuvent pas lire ni modifier les templates — confirmer que c'est intentionnel pour l'app iOS.

4. **Envoi manuel (`POST /:id/send`) sans DeepL** : ce chemin ne traduit pas le message contrairement au cron. Si l'app iOS expose un bouton "Envoyer maintenant", le comportement diffère de l'envoi automatique — à documenter dans l'UI ou à corriger côté serveur.

5. **`send_condition` avec alias `checkin_complete`** : le frontend le décompose à l'affichage (`deposit_active + police_complete`), mais ne le réécrit pas en base. Si un ancien template a `send_condition = 'checkin_complete'` en base, il fonctionne correctement — mais l'UI l'affiche comme deux cases cochées. L'iOS devra appliquer la même décomposition à l'affichage.

6. **`portee` / `logements_couverts` / `logements_cibles`** : champs calculés renvoyés par le GET mais absents du PUT. L'iOS ne les reçoit qu'en lecture.
