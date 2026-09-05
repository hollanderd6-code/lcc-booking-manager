# Relevé technique — Checklists de ménage

Périmètre : `GET /api/cleaning/checklists`, `GET /api/cleaning/checklists/:id`,
`PUT /api/cleaning/checklists/:id/validate`, `PUT /api/cleaning/checklists/:id/reject`,
plus `cleaning-tasks.html` (vue intervenante) et `historique-menage.html` (note séparée en bas).

---

## 1. Forme exacte de la réponse de `GET /api/cleaning/checklists/:id`

### Auth

`getUserFromRequest` — JWT Bearer dans l'en-tête `Authorization`.
**Pas de `authenticateAny`** : les sous-comptes ne peuvent pas appeler cette route directement
(le web utilise toujours le token du compte principal pour ouvrir le détail).
`?agency=all` est supporté : `getAgencyUserIds` élargit le filtre `user_id = ANY(...)`.

### Réponse enveloppée

```json
{
  "checklist": { /* objet complet */ }
}
```

### Tous les champs (snake_case, colonnes Postgres + alias JOIN)

| Champ                | Type PG         | Type JSON        | Remarques                                      |
|----------------------|-----------------|------------------|------------------------------------------------|
| `id`                 | SERIAL          | **number**       | ⚠️ entier côté JSON, mais `String(id)` dans les push FCM et Socket.IO |
| `user_id`            | TEXT            | string           | ID du compte propriétaire                      |
| `property_id`        | TEXT            | string           |                                                |
| `reservation_key`    | TEXT UNIQUE     | string           | Format `{propertyId}_{start}_{end}` ou `CHX_…` |
| `cleaner_id`         | TEXT            | string           |                                                |
| `guest_name`         | TEXT            | string \| null   |                                                |
| `checkout_date`      | DATE            | string           | Ex : `"2025-06-15"` (ISO sans heure)           |
| `tasks`              | JSONB           | array d'objets   | Voir §6                                        |
| `photos`             | JSONB           | array de strings | **base64 JPEG** (voir §2)                      |
| `notes`              | TEXT            | string \| null   | Note libre du cleaner                          |
| `completed_at`       | TIMESTAMPTZ     | string \| null   | ISO 8601 avec timezone                         |
| `sent_to_owner`      | BOOLEAN         | boolean          |                                                |
| `sent_to_guest`      | BOOLEAN         | boolean          |                                                |
| `created_at`         | TIMESTAMPTZ     | string           |                                                |
| `updated_at`         | TIMESTAMPTZ     | string           |                                                |
| `duration_seconds`   | INTEGER         | number \| null   | Durée du ménage (timer côté client)            |
| `started_at`         | TIMESTAMPTZ     | string \| null   |                                                |
| `owner_status`       | TEXT            | string           | `'pending'` \| `'validated'` \| `'rejected'`  |
| `owner_validated_at` | TIMESTAMPTZ     | string \| null   | Renseigné par PUT /validate                    |
| `owner_notes`        | TEXT            | string \| null   | Message de rejet du propriétaire               |
| `is_validated`       | BOOLEAN         | boolean          | Miroir de `owner_status = 'validated'`         |
| `signature_data`     | TEXT            | string \| null   | `data:image/png;base64,…` — signature du cleaner |
| `signature_ip`       | VARCHAR(64)     | string \| null   | IP d'où la checklist a été soumise             |
| `certified_at`       | TIMESTAMPTZ     | string \| null   |                                                |
| `cleaner_certified`  | BOOLEAN         | boolean          | `true` si signature_data fournie               |
| `cleaner_name`       | alias JOIN      | string \| null   |                                                |
| `cleaner_email`      | alias JOIN      | string \| null   |                                                |
| `cleaner_phone`      | alias JOIN      | string \| null   |                                                |

**Ce qui arrive en chaîne alors qu'on attend un nombre :**
`id` est un `number` en JSON, mais dans toutes les payloads FCM et Socket.IO il est
converti en string (`String(id)`, `String(checklistId)`). L'iOS doit donc se préparer
à recevoir `"42"` dans les push et `42` en REST.

**Ce qui est absent du détail :**
`photo_count` (alias calculé, présent seulement dans la liste).

---

## 2. Photos

### Stockage

Les photos de checklist sont des **data URIs base64 JPEG** compressées côté client
(max 800 px de large, qualité 0,6) et stockées telles quelles dans la colonne `photos`
(JSONB, tableau de strings).

```json
[
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ…",
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ…"
]
```

Il n'y a **pas de route séparée** et **pas d'URL Cloudinary** pour les photos de checklist.
L'upload Cloudinary (`POST /api/cleaning/photo-upload`) n'est utilisé que pour les photos
de dégradation (état du logement, `kind: 'arrival_state'`), qui aboutissent dans les
`maintenance_tickets.photos` (URLs `https://res.cloudinary.com/…`).

### Règles

- Minimum **5 photos** obligatoires pour pouvoir soumettre (vérifié côté client ET côté serveur : HTTP 400 si `photos.length < 5`).
- Pas de maximum explicite côté serveur.
- Payload POST typique : 5 × ~80 Ko base64 ≈ 400 Ko minimum dans le corps JSON.

### Accès depuis l'hôte

- **Liste** (`GET /api/cleaning/checklists`) : les photos sont **exclues** ; seul `photo_count`
  (integer) est retourné (alias `COALESCE(jsonb_array_length(cc.photos), 0)`).
- **Détail** (`GET /api/cleaning/checklists/:id`) : `cc.*` inclut le tableau complet.

### Taille par checklist

Variable. Chaque image est compressée à max 800 × ≈(hauteur proportionnelle) en JPEG 60 %.
Aucune garantie de taille : des photos iPhone de grande résolution peuvent dépasser 100 Ko
après compression. En base64 le surcoût est ~33 %.

---

## 3. Incidents (tickets de maintenance)

### Route de création (côté cleaner)

```
POST /api/cleaning/maintenance/:pinCode
```

Auth : PIN 4 chiffres (ou jeton `?t=`) — pas de JWT.

**Body :**

```json
{
  "propertyId": "prop_xyz",
  "title": "Fuite sous l'évier",
  "description": "L'eau coule en permanence.",
  "priority": "urgent",
  "photos": ["https://res.cloudinary.com/…/cleaning/photo1.jpg"],
  "reservationKey": "prop_xyz_2025-06-14_2025-06-15",
  "kind": "maintenance"
}
```

`kind` : `'maintenance'` (défaut) ou `'damage'` (dégradation constatée à l'arrivée).
`priority` : `'low'` | `'normal'` | `'high'` | `'urgent'` (valeur inconnue → `'normal'`).
`photos` : tableau d'**URLs Cloudinary** (pré-uploadées via `/api/cleaning/photo-upload`), max 10.

**Réponse :**

```json
{ "success": true, "ticketId": 42, "kind": "maintenance" }
```

### Table `maintenance_tickets`

```sql
CREATE TABLE maintenance_tickets (
  id             SERIAL PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  property_id    TEXT NOT NULL,
  title          TEXT NOT NULL,                      -- max 140 chars
  description    TEXT DEFAULT NULL,                  -- max 2000 chars
  priority       TEXT NOT NULL DEFAULT 'normal',
  status         TEXT NOT NULL DEFAULT 'open',
  artisan_id     INTEGER DEFAULT NULL,
  photos         JSONB DEFAULT '[]'::jsonb,           -- URLs Cloudinary
  created_by     TEXT DEFAULT 'host',                -- 'cleaner' ou 'host'
  created_by_name TEXT DEFAULT NULL,
  reservation_key TEXT DEFAULT NULL,
  kind           TEXT NOT NULL DEFAULT 'maintenance', -- ajouté par migration
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ DEFAULT NULL
);
```

### Rattachement à une checklist

**Implicite** — aucune FK, aucun champ `checklist_id`. Le seul lien est le champ
`reservation_key` (TEXT nullable), identique dans `cleaning_checklists` et
`maintenance_tickets`. Le web (`cleaning.html`) récupère les tickets d'un logement
séparément, sans jointure sur la checklist.

---

## 4. État « complément demandé » vs « rejeté »

Il n'existe **pas d'état distinct** : le rejet ET la demande de complément sont tous deux
stockés comme `owner_status = 'rejected'`. La colonne ne connaît que trois valeurs (§5).

Le libellé "Complément" dans l'interface masque le mot "rejet" à l'intervenante.

### Ce que voit l'intervenante après un rejet

Sur `GET /api/cleaning/tasks/:pinCode` (vue intervenante) :

```js
task.ownerStatus = cl?.owner_status   // → 'rejected'
task.ownerNotes  = cl?.owner_notes    // → message du propriétaire
```

Dans `cleaning-tasks.html` :
- La tâche apparaît dans la section **"Complément demandé"**
  (`tasks.filter(t => t.completed && t.ownerStatus === 'rejected')`)
- Un banner orange affiche : `task.ownerNotes`
- Le bouton est **"Corriger"** (`openChecklist(reservationKey)`)
- Les checklists rejetées restent visibles même si la date de départ est passée (requête supplémentaire sur `owner_status = 'rejected'` ignorant le filtre date)

### Re-soumission (après correction)

L'intervenante re-ouvre et re-soumet la checklist. Le `POST /api/cleaning/checklist`
fait un `ON CONFLICT (reservation_key) DO UPDATE` avec :

```sql
owner_status = CASE
  WHEN cleaning_checklists.owner_status = 'validated' THEN 'validated'
  ELSE 'pending'
END
```

→ Si l'état était `rejected`, il revient à **`pending`** ; si déjà `validated`, il reste `validated`.
`owner_notes` est remis à NULL (sauf si déjà validé).

---

## 5. États possibles d'une checklist

Colonne `owner_status TEXT NOT NULL DEFAULT 'pending'`.

| Valeur        | Signification                              | Ce qui le provoque                                      |
|---------------|--------------------------------------------|---------------------------------------------------------|
| `'pending'`   | Soumise, en attente de décision            | Création via POST ; re-soumission après rejet           |
| `'validated'` | Validée par le propriétaire                | `PUT /:id/validate` (+ `is_validated = TRUE`)           |
| `'rejected'`  | Complément demandé par le propriétaire     | `PUT /:id/reject` (+ `owner_notes` renseigné)           |

**Transitions :**

```
[non existante]
     │ POST /api/cleaning/checklist
     ▼
  pending  ←────────────────── re-soumission
     │ PUT /validate    │ PUT /reject
     ▼                  ▼
 validated           rejected
                         │ re-soumission
                         ▼
                      pending
```

`validated` est terminal (la re-soumission ne peut pas écraser une validation).

---

## 6. Structure des tâches cochées

### Format d'un élément

```json
{
  "id":      "k1",
  "name":    "Nettoyer le plan de travail",
  "room":    "kitchen",
  "checked": true
}
```

| Champ     | Type    | Valeurs possibles                                                   |
|-----------|---------|---------------------------------------------------------------------|
| `id`      | string  | Clé fixe (`k1`…`g5`) si tâches par défaut ; `task_0`, `task_1`… si template |
| `name`    | string  | Libellé affiché                                                     |
| `room`    | string  | `'kitchen'` \| `'bathroom'` \| `'bedroom'` \| `'living'` \| `'terrace'` \| `'general'` |
| `checked` | boolean | `true` si cochée (toutes doivent être `true` pour soumettre)        |

### Source des tâches

1. **Template personnalisé** (`GET /api/cleaning/template/:propertyId?pin=<pin>`) :
   tâches définies par le propriétaire dans `cleaning_templates`, retournées sous la forme
   `{ tasks: [{ id, name, room }] }`.
2. **Tâches par défaut** (`getDefaultTasks()` côté client) : 29 tâches fixes réparties en
   5 pièces (cuisine, salle de bain, chambre, salon, général).

### Affichage côté web (`cleaning.html`)

```js
tasks.map(t =>
  '<div class="task-row-display">'
  + '<div class="task-check-icon ' + (t.checked ? 'checked' : 'unchecked') + '">'
  + (t.name || t.title || 'Tâche')
  + '</div>'
)
```

Le web accepte `t.name` ou `t.title` (tolérance pour les anciens templates qui utilisaient `title`).

---

## 7. Routes — récapitulatif middlewares, enveloppe, ?agency

### `GET /api/cleaning/checklists`

| Élément          | Valeur                                                        |
|------------------|---------------------------------------------------------------|
| Middlewares      | `authenticateAny`, `requirePermission(pool,'can_view_cleaning')`, `loadSubAccountData` |
| Sous-comptes     | Oui — filtre sur `accessible_property_ids` après la requête   |
| `?agency=all`    | Oui — élargit `user_id = ANY(agencyIds)`                      |
| Enveloppe        | `{ checklists: [...] }`                                       |
| Limite           | 100 lignes (LIMIT fixe dans la requête)                       |
| Tri              | pending+complétés en premier, puis `checkout_date DESC`       |
| Champs exclus    | `photos`, `signature_data`, `owner_notes`, `owner_validated_at`, `is_validated`, `notes` |
| Champs inclus    | `tasks` (complet JSONB), `photo_count` (alias calculé)        |

### `GET /api/cleaning/checklists/:id`

| Élément          | Valeur                                                        |
|------------------|---------------------------------------------------------------|
| Middlewares      | aucun middleware Express — `getUserFromRequest` manuel (JWT Bearer seulement) |
| Sous-comptes     | **Non** (pas d'`authenticateAny`)                             |
| `?agency=all`    | Oui                                                           |
| Enveloppe        | `{ checklist: {...} }`                                        |
| Champs inclus    | `cc.*` complet + `cleaner_name`, `cleaner_email`, `cleaner_phone` |

### `PUT /api/cleaning/checklists/:id/validate`

| Élément          | Valeur                                                              |
|------------------|---------------------------------------------------------------------|
| Middlewares      | `authenticateAny`, `requirePermission(pool,'can_manage_cleaning')`, `loadSubAccountData` |
| Body             | aucun (vide)                                                        |
| `?agency=all`    | Oui                                                                 |
| Enveloppe        | `{ success: true, checklist: {...} }` (RETURNING * complet)         |
| Effets de bord   | Socket.IO `cleaning:validated` sur `user_{userId}` ; push FCM cleaner + sous-comptes |

### `PUT /api/cleaning/checklists/:id/reject`

| Élément          | Valeur                                                              |
|------------------|---------------------------------------------------------------------|
| Middlewares      | `authenticateAny`, `requirePermission(pool,'can_manage_cleaning')`, `loadSubAccountData` |
| Body             | `{ "notes": "string optionnelle" }` — défaut : `'Merci de compléter le ménage'` |
| `?agency=all`    | Oui                                                                 |
| Enveloppe        | `{ success: true, checklist: {...} }` (RETURNING * complet)         |
| Effets de bord   | Push FCM cleaner (pas de Socket.IO) ; email cleaner via Brevo/SMTP  |
| Socket.IO        | **Aucun** — contrairement à validate                                |

### Doublons camelCase / snake_case

| Route                             | Casse des clés JSON                   |
|-----------------------------------|---------------------------------------|
| `GET /api/cleaning/checklists`    | snake_case (colonnes PG) + quelques aliases `cleaner_name`, `photo_count` + camelCase enrichissement : `guest_first_name`, `guest_last_name`, `guest_phone`, `guest_display_name`, `guest_initial`, `platform` |
| `GET /api/cleaning/checklists/:id`| snake_case pur + `cleaner_name/email/phone` |
| `PUT /validate` et `/reject`      | snake_case pur (RETURNING *)          |
| `GET /api/cleaning/tasks/:pin`    | **camelCase** : `reservationKey`, `checkoutDate`, `propertyId`, `propertyName`, `guestName`, `ownerStatus`, `ownerNotes`, `completed` |
| Push FCM data                     | camelCase : `checklistId` (string !), `propertyId`, `type` |

---

## Note sur `historique-menage.html`

Cette page **n'appelle aucune route** `cleaning_checklists`. Elle lit uniquement la clé
`LCC_CLEANING_PLANS` du `localStorage` du navigateur — un ancien système de plannings
stockés localement dans le navigateur. Elle affiche date / nb tâches / nb tâches terminées
et propose un bouton "Détail" qui affiche seulement une `alert()`. Elle est **sans lien**
avec la base de données ni avec l'historique réel des checklists.

---

## 8. Modèles de checklist (`cleaning_templates`)

### Table `cleaning_templates`

```sql
CREATE TABLE IF NOT EXISTS cleaning_templates (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT,                              -- NULL = modèle global
  name        TEXT NOT NULL DEFAULT 'Template ménage',
  tasks       JSONB NOT NULL DEFAULT '[]',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Pas de table de liaison. L'association logement ↔ modèle se fait uniquement via la colonne `property_id` (nullable).

---

### `GET /api/cleaning/templates`

#### Middlewares

`authenticateAny`, `requirePermission(pool, 'can_view_cleaning')`, `loadSubAccountData`

#### Paramètre de filtre optionnel

`?propertyId=<id>` — si présent, la requête retourne les modèles correspondant à ce logement **et** les modèles globaux (`property_id IS NULL`) :

```sql
WHERE user_id = ANY($1::text[])
  AND (property_id = $2 OR property_id IS NULL)
ORDER BY is_default DESC, updated_at DESC
```

Sans `?propertyId`, tous les modèles de l'utilisateur (ou de l'agence) sont retournés.

#### `?agency=all`

Supporté — `getAgencyUserIds` élargi le filtre `user_id = ANY(...)` de la même façon que sur les autres routes cleaning.

#### Réponse enveloppée

```json
{ "success": true, "templates": [ /* tableau de lignes PG brutes */ ] }
```

#### Tous les champs d'un élément `templates[]`

| Champ         | Type PG     | Type JSON       | Remarques                                  |
|---------------|-------------|-----------------|---------------------------------------------|
| `id`          | SERIAL      | **number**      |                                             |
| `user_id`     | TEXT        | string          |                                             |
| `property_id` | TEXT        | string \| null  | `null` = modèle global                      |
| `name`        | TEXT        | string          | Ex : `"Template ménage"` (valeur par défaut)|
| `tasks`       | JSONB       | array d'objets  | Voir structure ci-dessous                   |
| `is_default`  | BOOLEAN     | boolean         | Un seul `true` par compte (enforced à la création)|
| `created_at`  | TIMESTAMPTZ | string          |                                             |
| `updated_at`  | TIMESTAMPTZ | string          |                                             |

#### Structure d'une tâche dans `tasks`

```json
{ "id": "task_0", "name": "Nettoyer la cuisine", "room": "kitchen" }
```

| Champ  | Type   | Valeurs possibles                                                        |
|--------|--------|--------------------------------------------------------------------------|
| `id`   | string | `task_0`, `task_1`… (généré à la sauvegarde : `t.id \|\| \`task_\${i}\`` ) |
| `name` | string | Libellé affiché                                                          |
| `room` | string | `'kitchen'` \| `'bathroom'` \| `'bedroom'` \| `'living'` \| `'terrace'` \| `'general'` |

Pas de champ `checked` dans le modèle — il est ajouté (`checked: false`) par le frontend au moment de l'ouverture de la checklist.

---

### Association modèle ↔ logement

Il n'y a **pas de colonne `template_id`** dans `cleaning_checklists` et **pas de table de liaison**. L'association se résout à chaque ouverture de checklist via `GET /api/cleaning/template/:propertyId` (route cleaner — auth PIN) selon trois niveaux de priorité décroissante :

| Priorité | Condition SQL                                          | Signification              |
|----------|--------------------------------------------------------|----------------------------|
| 1        | `property_id = :propertyId`                            | Modèle spécifique au logement |
| 2        | `is_default = TRUE`                                    | Modèle par défaut du compte   |
| 3        | `property_id IS NULL`                                  | N'importe quel modèle global  |

Dans tous les cas : `user_id = ANY([compte_fiche, propriétaire_logement])` (mode agence : les deux peuvent différer).

**Si aucun modèle n'est trouvé :** HTTP 404. Le frontend (`cleaning-tasks.html`) intercepte silencieusement l'erreur et bascule sur `getDefaultTasks()` — 29 tâches fixes codées en dur réparties en 5 pièces (cuisine × 8, salle de bain × 7, chambre × 5, salon × 5, général × 5). L'intervenante ne voit aucune différence.

---

### Comment le modèle devient la checklist

C'est une **copie ponctuelle au moment de l'ouverture**, pas une référence persistante.

1. L'intervenante ouvre une fiche (`openChecklist(reservationKey)` dans `cleaning-tasks.html`).
2. Le frontend appelle `GET /api/cleaning/template/:propertyId?pin=<pin>`.
3. Le serveur retourne `{ templateId, name, propertyId, tasks: [{id, name, room}] }`.
4. Le frontend mappe chaque tâche → `{ id, name, room, checked: false }` et stocke le tableau en mémoire (`checklistTasks`).
5. L'intervenante coche chaque tâche ; à la soumission, `POST /api/cleaning/checklist` envoie `tasks: [{id, name, room, checked: true}, …]`.
6. Le serveur insère ce tableau tel quel dans `cleaning_checklists.tasks` (JSONB). **Aucun `template_id` n'est stocké.**

Conséquences :
- Modifier ou supprimer un modèle après la soumission d'une checklist n'a aucun effet sur les checklists existantes.
- Il est impossible de retrouver quel modèle a été utilisé pour une checklist donnée (aucune traçabilité).
- La route `GET /api/cleaning/template/:propertyId` est appelée **par le cleaner** (PIN), pas par le propriétaire.

---

### Routes modèles — récapitulatif middlewares, enveloppe, `?agency`, casse

#### `GET /api/cleaning/templates` (propriétaire)

| Élément       | Valeur                                                                   |
|---------------|--------------------------------------------------------------------------|
| Middlewares   | `authenticateAny`, `requirePermission(pool,'can_view_cleaning')`, `loadSubAccountData` |
| `?agency=all` | Oui                                                                      |
| `?propertyId` | Oui (filtre optionnel : logement + globaux)                              |
| Enveloppe     | `{ success: true, templates: [...] }`                                    |
| Casse         | **snake_case** pur (colonnes PG brutes : `property_id`, `is_default`, `user_id`, …) |

#### `POST /api/cleaning/templates` (créer ou modifier)

| Élément       | Valeur                                                                                |
|---------------|---------------------------------------------------------------------------------------|
| Middlewares   | `authenticateAny`, `requirePermission(pool,'can_manage_cleaning')`, `loadSubAccountData` |
| `?agency=all` | Oui (agencyIds utilisé pour UPDATE ; INSERT utilise `userId` principal)               |
| Body          | `{ propertyId?, name?, tasks, isDefault?, templateId? }` — `templateId` présent → UPDATE, absent → INSERT |
| Enveloppe     | `{ success: true, template: { /* RETURNING * */ } }`                                 |
| Invariant `is_default` | Si `isDefault: true` à la création, tous les autres modèles du compte passent à `is_default = FALSE` avant l'insert |

#### `DELETE /api/cleaning/templates/:id`

| Élément       | Valeur                                                                                |
|---------------|---------------------------------------------------------------------------------------|
| Middlewares   | `authenticateAny`, `requirePermission(pool,'can_manage_cleaning')`, `loadSubAccountData` |
| `?agency=all` | **Non** — filtre `user_id = $2` (userId principal uniquement, pas `ANY(agencyIds)`). ⚠️ En mode agence, un sous-compte ne peut supprimer que les modèles du compte principal, pas ceux des membres de l'agence. |
| Enveloppe     | `{ success: true, deleted: <id> }`                                                   |

#### `GET /api/cleaning/template/:propertyId` (cleaner — PIN)

| Élément       | Valeur                                                                   |
|---------------|--------------------------------------------------------------------------|
| Middlewares   | **Aucun middleware Express** — auth PIN via `resoudreAgentMenage`         |
| `?agency=all` | Non applicable                                                            |
| `?pin`        | Obligatoire (HTTP 400 si absent)                                          |
| Enveloppe     | **Nue** — pas de clé `success` : `{ templateId, name, propertyId, tasks }` |
| Casse         | **camelCase** : `templateId`, `propertyId` — ⚠️ contraire à toutes les autres routes modèles (snake_case) |

---

## À TRANCHER

| Sujet | Ambiguïté |
|-------|-----------|
| **Photos iOS** | L'iOS doit-il s'attendre à des data URIs base64 dans `photos` (cas actuel) ou faut-il migrer vers un pré-upload Cloudinary similaire aux photos de dégradation ? Les data URIs JPEG 800px/60% peuvent peser 50–150 Ko chacune ; × 5 = 250–750 Ko rien que pour les photos dans la réponse JSON. |
| **Limite du tableau `photos`** | Aucune borne max côté serveur. Un cleaner zélé qui envoie 30 photos peut créer une colonne JSONB de plusieurs Mo. Faut-il placer un cap ? |
| **Sous-comptes et `/:id`** | `GET /api/cleaning/checklists/:id` ne passe pas par `authenticateAny` : un sous-compte ne peut pas l'appeler avec son propre token. L'iOS doit-il toujours utiliser le token du compte principal pour cette route, ou faut-il migrer vers `authenticateAny` ? |
| **`ticketId` dans la réponse maintenance** | `ticketId` est retourné comme `number` (integer PG). Confirmer que l'iOS doit bien traiter c'est un number et non une string. |
| **Absence de socket.io sur le rejet** | Le validate émet `cleaning:validated` ; le reject n'émet rien. Est-ce intentionnel ? L'iOS doit-il surveiller un event `cleaning:rejected` à créer ? |
| **Relation checklist ↔ ticket** | Il n'y a pas de FK. Si l'iOS veut afficher les incidents liés à une checklist, il devra filtrer `maintenance_tickets` par `reservation_key`. Confirmer que c'est le bon identifiant à utiliser. |
| **`photo_count` dans la liste vs photos dans le détail** | La liste retourne `photo_count: number` mais pas le tableau. Si l'iOS affiche une vignette en liste, il doit ouvrir le détail pour avoir les images. Confirmer que c'est le flux attendu. |
| **`historique-menage.html`** | La page est morte (localStorage uniquement). Faut-il la supprimer ou la relier à `GET /api/cleaning/checklists` ? |
