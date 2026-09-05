# Création de sous-comptes et d'intervenants en mode agence

_Commits couverts : `fb6adaba`, `45268de3`, `7b0c6d5a`_

---

## Contexte

Avant ce correctif, les routes de création (`POST /api/sub-accounts/create` et
`POST /api/cleaners`) inséraient systématiquement sous `req.user.id` — c'est-à-dire
sous le compte de l'appelant. En mode agence, cela rattachait la fiche au compte
**agence** et non au compte **propriétaire**, rendant la ressource invisible depuis
ce dernier.

Le correctif introduit un middleware (`agency-target.js`) qui intercepte le champ
`targetUserId` dans le corps de la requête, vérifie la délégation, puis force
`req.user.id` sur le compte cible avant que la route ne s'exécute. Les routes
existantes n'ont pas eu à être réécrites.

---

## 1. Routes concernées et corps de requête

### A. `POST /api/sub-accounts/create` — `sub-accounts-routes.js:127`

Champs du corps (inchangés depuis la route elle-même) :

| Champ | Type | Obligatoire |
|---|---|---|
| `email` | string | oui |
| `password` | string | oui |
| `firstName` | string | oui |
| `lastName` | string | oui |
| `role` | string | non — défaut `'custom'` |
| `permissions` | object | non |
| `propertyIds` | array | non |
| `notifications` | object | non |

**Champ nouveau intercpeté par le middleware :**

| Champ | Type | Obligatoire |
|---|---|---|
| `targetUserId` | string (id utilisateur) | non |

Alias accepté également : `target_user_id` (snake_case) — voir `agency-target.js:88`.

Le champ **n'est pas** dans le `req.body` destructuré de la route elle-même ; le
middleware l'a déjà consommé pour réécrire `req.user.id` avant que la route ne
soit exécutée.

```js
// agency-target.js:87-91
const target =
  (req.body && (req.body.targetUserId || req.body.target_user_id)) ||
  req.query.target_user_id ||
  null;
if (!target) return next(); // comportement inchangé sans cible explicite
```

```js
// sub-accounts-routes.js:156-166
const result = await pool.query(`
  INSERT INTO sub_accounts (
    parent_user_id, email, password_hash, first_name, last_name, role
  ) VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id, email, first_name, last_name, role
`, [req.user.id, email, passwordHash, firstName, lastName, role || 'custom']);
```

`req.user.id` vaut le `targetUserId` si le middleware a été activé, sinon l'id
de l'appelant.

---

### B. `POST /api/cleaners` — `server.js:13232`

Champs du corps (inchangés depuis la route elle-même) :

| Champ | Type | Obligatoire |
|---|---|---|
| `name` | string | oui |
| `phone` | string | non |
| `email` | string | non |
| `notes` | string | non |
| `isActive` | boolean | non — défaut `true` |
| `subAccountId` | string | non |

**Champ nouveau intercepté par le middleware :**

| Champ | Type | Obligatoire |
|---|---|---|
| `targetUserId` | string (id utilisateur) | non |

Même mécanique que pour les sous-comptes. La route lit désormais `req.bhAgencyTarget`
en priorité :

```js
// server.js:13234-13236
const userId = req.bhAgencyTarget || (req.user.isSubAccount
  ? (await getRealUserId(pool, req))
  : (await getUserFromRequest(req))?.id);
```

`req.bhAgencyTarget` est positionné par le middleware sur le `targetUserId` validé
(`agency-target.js:110`).

---

## 2. Comportement si `targetUserId` est absent

- Le middleware passe directement à `next()` sans rien modifier (`agency-target.js:91`).
- La création se fait sous `req.user.id` comme avant — comportement identique à
  l'ancienne version.
- **Aucune erreur**, aucune valeur par défaut spéciale.

---

## 3. Liste des comptes propriétaires sélectionnables

**Route :** `GET /api/agency/target-accounts` — `agency-target.js:122`

Pas de middleware d'authentification Express standard : le token JWT est décodé
manuellement par `callerIdFromRequest()` (`agency-target.js:35-46`). Envoyer le
token en header `Authorization: Bearer <token>` comme pour toute autre route.

**Réponse :**

```json
{
  "success": true,
  "accounts": [
    {
      "userId": "42",
      "name": "Mon agence (mon compte)",
      "email": "agence@example.com",
      "isSelf": true
    },
    {
      "userId": "7",
      "name": "Dupont Gestion",
      "email": "dupont@example.com",
      "isSelf": false
    }
  ]
}
```

| Champ | Description |
|---|---|
| `userId` | Identifiant à passer comme `targetUserId` lors de la création |
| `name` | `company` du compte, sinon `prénom + nom`, sinon `email` |
| `email` | Email du compte |
| `isSelf` | `true` uniquement pour le compte de l'appelant lui-même |

**Oui**, la liste est construite à partir des délégations acceptées (`status = 'accepted'`
dans `account_delegations`) plus le propre compte de l'appelant :

```sql
-- agency-target.js:145-152
SELECT u.id, u.email, u.company, u.first_name, u.last_name
FROM account_delegations d
JOIN users u ON u.id = d.delegator_user_id
WHERE d.delegate_user_id = $1 AND d.status = 'accepted'
ORDER BY COALESCE(u.company, u.last_name, u.email)
```

Un propriétaire non délégué ne verra que son propre compte (`isSelf: true`).

---

## 4. Champ en lecture — `/api/sub-accounts/list` et `/api/cleaners`

### `GET /api/sub-accounts/list` — `sub-accounts-routes.js:858`

Le `SELECT` ne retourne **pas** `parent_user_id`. La colonne est uniquement
utilisée dans la clause `WHERE` pour filtrer les sous-comptes visibles par
l'appelant (agence ou proprio) :

```sql
-- sub-accounts-routes.js:923-927
FROM sub_accounts sa
LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
WHERE sa.parent_user_id = ANY($1::text[])
ORDER BY sa.created_at DESC
```

Le compte de rattachement **n'apparaît pas** dans la réponse.

### `GET /api/cleaners` — `server.js:13214`

Même situation : `user_id` (clé étrangère vers le compte propriétaire) n'est
**pas** dans le `SELECT` :

```sql
-- server.js:13215
SELECT id, name, phone, email, notes, pin_code, is_active,
       sub_account_id, sms_recap_enabled, access_token, created_at
FROM cleaners
WHERE user_id = ANY($1::text[])
ORDER BY name ASC
```

Le compte de rattachement **n'apparaît pas** dans la réponse.

---

## 5. Modifiable après création ?

**Non**, dans aucun des deux cas.

### Sous-comptes — `PUT /api/sub-accounts/:id` (`sub-accounts-routes.js:531`)

Le corps accepté est `{ firstName, lastName, role, propertyIds, permissions,
notifications }`. La colonne `parent_user_id` n'est **pas** touchée par l'`UPDATE` :

```sql
-- sub-accounts-routes.js:552-557
UPDATE sub_accounts
SET first_name = $1, last_name = $2, role = $3, updated_at = NOW()
WHERE id = $4
```

Même si l'appelant envoie `targetUserId` dans le corps d'un PUT, le middleware
le lirait (il s'applique aux POST **et** PUT — `agency-target.js:85`) mais cela
n'aurait aucun effet : l'UPDATE ne modifie pas `parent_user_id`.

### Intervenants de ménage — `PUT /api/cleaners/:id` (`server.js:13326`)

Même logique : `user_id` n'est **pas** dans les colonnes mises à jour :

```sql
-- server.js:13351-13363
UPDATE cleaners
SET
  name          = COALESCE($3, name),
  phone         = COALESCE($4, phone),
  email         = COALESCE($5, email),
  notes         = COALESCE($6, notes),
  is_active     = COALESCE($7, is_active),
  sub_account_id = $8
WHERE id = $1 AND user_id = ANY($2::text[])
```

Le rattachement à un compte propriétaire est donc **immuable après création**.
