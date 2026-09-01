# Relevé 4 — Impersonation et mode agence

Comment le front web bascule sur un compte délégant précis, par opposition à la vue globale `?agency=all`. Routes `/api/agency/*`, table `account_delegations`, clé localStorage `bh_agency_view`, et protocole pour l'app iOS.

---

## Deux mécanismes distincts sous le mot « agence »

| Mécanisme | Table | Token | Qui l'utilise |
|---|---|---|---|
| **Délégation agence** (Changer de compte) | `account_delegations` | JWT `type: 'agency_access'` | Gestionnaire → accède au compte d'un client délégant |
| **Impersonation admin** | `impersonation_requests` | JWT standard | Équipe BH → accède au compte d'un client pour support |

Ce relevé couvre exclusivement la **délégation agence**. L'impersonation admin (routes `/api/admin/clients/:id/request-impersonation`, `/api/impersonation/pending`, `/api/impersonation/:id/respond`) est réservée aux emails listés dans `ADMIN_EMAILS`.

---

## Table `account_delegations`

**Fichier :** `server.js` **Ligne :** 42483

```sql
CREATE TABLE IF NOT EXISTS account_delegations (
  id                 SERIAL PRIMARY KEY,
  delegator_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,  -- null si invité sans compte
  delegate_email     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | revoked
  permissions        JSONB DEFAULT '{
    "can_view_calendar": true,
    "can_view_messages": true,
    "can_view_cleaning": true,
    "can_view_reporting": false,
    "can_view_finances": false
  }',
  invitation_token   TEXT UNIQUE,   -- utilisé dans l'URL d'invitation
  invited_at         TIMESTAMPTZ DEFAULT NOW(),
  accepted_at        TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
```

**Colonne ajoutée par migration (l.42500) :**
- `billing_override JSONB DEFAULT '{}'` — données de facturation personnalisées pour l'émission de factures propriétaires depuis le compte agence

**Lecture :** le délégant est le propriétaire (`delegator_user_id`). Le gestionnaire est le delegate (`delegate_user_id`). Quand `delegate_user_id IS NULL`, le gestionnaire n'a pas encore de compte BH (invitation en attente).

---

## Routes `/api/agency/*`

### `POST /api/agency/invite` (l.42515)
**Auth :** `authenticateAny` (compte principal uniquement — sous-compte refusé)

**Body :**
```json
{ "email": "gestionnaire@exemple.com", "permissions": { "can_view_calendar": true, ... } }
```

**Action :** crée une ligne dans `account_delegations` (status `'pending'` ou `'accepted'` si le gestionnaire a déjà un compte). Envoie un email d'invitation avec l'URL `/app.html?agency_token=<invitation_token>`.

**Réponse :**
```json
{ "success": true, "status": "pending"|"accepted", "token": "<invitation_token>" }
```

---

### `POST /api/agency/accept` (l.42623)
**Auth :** `authenticateAny` (compte principal)

**Body :**
```json
{ "token": "<invitation_token>" }
```

**Action :** valide que l'email du token correspond au compte connecté, passe `status → 'accepted'`, remplit `delegate_user_id`.

**Réponse :**
```json
{ "success": true, "delegatorUserId": "<id>" }
```

---

### `POST /api/agency/revoke` (l.42658)
**Auth :** `authenticateAny`

**Body :**
```json
{ "delegationId": 42 }
```

**Action :** `UPDATE account_delegations SET status = 'revoked'` — fonctionne si l'appelant est le délégant ou le gestionnaire.

**Réponse :** `{ "success": true }`

---

### `GET /api/agency/delegations` (l.42676)
**Auth :** `authenticateAny` (compte principal)

**Query params :** aucun.

**Réponse :**
```json
{
  "canActAsAgent": true,   // plan Agence ou trial actif
  "iManage": [             // comptes que JE gère (je suis le delegate)
    {
      "id": 7,
      "userId": "<delegator_user_id>",
      "name": "Dupont SCI",
      "email": "...",
      "propertyCount": 3,
      "permissions": { ... },
      "acceptedAt": "..."
    }
  ],
  "myDelegates": [         // gestionnaires ayant accès à MON compte (je suis le delegator)
    {
      "id": 7,
      "email": "...",
      "name": "...",
      "status": "accepted",
      "permissions": { ... },
      "invitedAt": "...",
      "acceptedAt": "..."
    }
  ]
}
```
`canActAsAgent` contrôle si le bouton « Changer de compte » est affiché. Non enveloppé.

---

### `POST /api/agency/switch` (l.42742) ← **Route centrale du "Changer de compte"**
**Auth :** `authenticateAny` (compte principal — sous-compte refusé)

**Prérequis :** plan Agence ou trial actif (sinon 403 `featureBlocked: true`).

**Body :**
```json
{ "targetUserId": "<delegator_user_id>" }
```

**Vérification :** `SELECT * FROM account_delegations WHERE delegate_user_id = $1 AND delegator_user_id = $2 AND status = 'accepted'`

**Action :** génère un JWT signé (valide 24 h) :
```json
{
  "id": "<targetUserId>",      // l'app se comporte comme ce user
  "type": "agency_access",
  "agentId": "<userId>",       // qui gère réellement
  "delegationId": 7,
  "permissions": { ... }
}
```

**Réponse :**
```json
{
  "success": true,
  "token": "<agencyToken>",
  "permissions": { "can_view_calendar": true, ... },
  "managedUser": { "id": "...", "name": "Dupont SCI", "email": "..." }
}
```
Non enveloppé.

---

### `POST /api/agency/refresh` (l.42800)
**Auth :** `authenticateAny` (doit être en mode agency_access)

**Body :** aucun.

**Action :** renouvelle le token agence pour 24 h supplémentaires. Vérifie que la délégation est toujours `'accepted'`.

**Réponse :** `{ "success": true, "token": "<newToken>", "permissions": { ... } }`

---

### `GET /api/agency/managed-properties` (l.23527)
**Auth :** `authenticateAny`

Retourne tous les logements de tous les comptes délégués acceptés (utile pour la facturation agence).

**Réponse :** `{ "properties": [ { ...property, "_isManaged": true, "_managedAccount": { "userId": "...", "name": "..." } } ] }`

---

### `GET /api/agency/properties/:delegatorUserId` (l.23565)
**Auth :** `authenticateAny`

Logements d'un compte délégué précis. Vérifie que la délégation est acceptée.

**Réponse :** `{ "properties": [ { "id", "name", "owner_id" } ] }`

---

### `PATCH /api/agency/billing-override/:delegatorUserId` (l.23591)
**Auth :** `authenticateAny`, `requireProPlan`

**Body :** `{ company_name, siret, phone, address, city, postal_code, email, selected_property_ids }`

Met à jour `account_delegations.billing_override` pour la facturation propriétaires depuis le compte agence.

---

## Clé localStorage `bh_agency_view` et vue globale `?agency=all`

**Fichier principal :** `public/js/bh-layout.js` (l.1–30), repris dans la plupart des pages HTML.

### Deux modes distincts et mutuellement exclusifs

| Mode | Clé localStorage | Effet |
|---|---|---|
| **Vue globale** (`?agency=all`) | `bh_agency_view = "all"` | Ajoute `?agency=all` à tous les appels API — le serveur renvoie les données agrégées de TOUS les comptes délégués |
| **Compte géré** (un seul compte) | `lcc_managed_user` présent | Le token courant (`lcc_token`) est le JWT `agency_access` — le serveur se comporte comme si l'agent était ce client |

**Incompatibilité confirmée (l.28–33 de `app.html`) :**
```js
if (localStorage.getItem('lcc_agency_token') && localStorage.getItem('bh_agency_view') === 'all') {
  localStorage.removeItem('bh_agency_view');
}
```
Quand `lcc_managed_user` est actif, `bh_agency_view` est supprimé.

### Comment `bh_agency_view = "all"` modifie les appels API

Dans chaque page, le `fetch` est wrappé :
```js
if (localStorage.getItem('bh_agency_view') === 'all' && url.includes('/api/') && !url.includes('agency=')) {
  url += (url.includes('?') ? '&' : '?') + 'agency=all';
}
```

Côté serveur, `getAgencyUserIds(req, userId)` (l.6292) :
```js
async function getAgencyUserIds(req, userId) {
  if (req.query.agency !== 'all') return [userId];
  const delegations = await pool.query(
    `SELECT delegator_user_id FROM account_delegations WHERE delegate_user_id = $1 AND status = 'accepted'`,
    [userId]
  );
  return [userId, ...delegations.rows.map(d => d.delegator_user_id)];
}
```

### Stockage complet lors d'un switch (l.287–312, `app.html`)

```js
// Sauvegarder le token de l'agent
localStorage.setItem('lcc_agency_token', monPropioToken);
// Remplacer le token courant par le JWT agency_access
localStorage.setItem('lcc_token', agencyToken);
// Infos du compte géré (affiché dans le header)
localStorage.setItem('lcc_managed_user', JSON.stringify(managedUser));
// Permissions (pour conditionner l'UI)
localStorage.setItem('lcc_agency_permissions', JSON.stringify(permissions));
// Nettoyage
localStorage.removeItem('bh_agency_view');
localStorage.removeItem('lcc_settings_profile');
localStorage.removeItem('lcc_properties_cache');
window.location.reload();
```

### Retour à son propre compte

```js
// Restaurer le token de l'agent
localStorage.setItem('lcc_token', localStorage.getItem('lcc_agency_token'));
// Supprimer le contexte géré
localStorage.removeItem('lcc_managed_user');
localStorage.removeItem('lcc_agency_token');
localStorage.removeItem('lcc_agency_permissions');
window.location.reload();
```

---

## Protocole iOS — reproduire la modale « Changer de compte »

### Étape 1 — Charger la liste des comptes disponibles

```
GET /api/agency/delegations
Authorization: Bearer <token_de_l_agent>
```

Lire `data.iManage` (comptes que l'agent gère) et `data.canActAsAgent` (booléen — plan Agence requis).

Si `canActAsAgent` est `false` : ne pas afficher la modale ou afficher un écran de mise à niveau.

### Étape 2 — Option A : Vue globale (tous les comptes agrégés)

Ajouter `?agency=all` à tous les appels API. Ne pas faire de switch.

```
GET /api/properties?agency=all
GET /api/reservations?agency=all
...
```

Stocker la préférence localement (équivalent de `bh_agency_view = "all"`).

### Étape 3 — Option B : Basculer sur UN compte précis

```
POST /api/agency/switch
Authorization: Bearer <token_de_l_agent>
Content-Type: application/json

{ "targetUserId": "<iManage[n].userId>" }
```

Réponse :
```json
{ "success": true, "token": "<agencyToken>", "permissions": { ... }, "managedUser": { "id": "...", "name": "..." } }
```

L'app doit alors :
1. Conserver le token agent (`<token_de_l_agent>`) dans un stockage séparé
2. Utiliser `agencyToken` comme token pour tous les appels API suivants
3. Afficher `managedUser.name` dans le header à la place du nom de l'agent
4. Respecter `permissions` pour conditionner l'affichage (ex: `can_view_finances`)

### Étape 4 — Rafraîchir le token agence (durée 24 h)

```
POST /api/agency/refresh
Authorization: Bearer <agencyToken>
```

À déclencher avant expiration (toutes les ~6 h comme le web, ou au prochain lancement).

### Étape 5 — Revenir à son compte

Réutiliser le token agent stocké à l'étape 3 pour tous les appels API. Effacer le contexte `managedUser`.

---

## Récapitulatif des clés localStorage

| Clé | Type | Valeur | Signification |
|---|---|---|---|
| `lcc_token` | string | JWT | Token courant (peut être agency_access) |
| `lcc_agency_token` | string | JWT | Token original de l'agent (sauvegardé lors d'un switch) |
| `lcc_managed_user` | JSON string | `{ id, name, email }` | Compte géré actif (absent = mode propre compte) |
| `lcc_agency_permissions` | JSON string | objet permissions | Permissions du compte géré |
| `bh_agency_view` | string | `"all"` ou absent | Vue agrégée active (incompatible avec lcc_managed_user) |
| `lcc_settings_profile` | JSON string | — | Cache profil utilisateur (supprimé lors d'un switch) |
| `lcc_properties_cache` | JSON string | — | Cache logements (supprimé lors d'un switch) |
