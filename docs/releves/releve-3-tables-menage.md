# Relevé 3 — Tables du ménage

Schéma de `cleaning_assignments`, `cleaners`, `property_default_cleaners` et `cleaning_checklists`. Construction de `reservation_key` et analyse des deux formats incompatibles.

---

## Table `cleaners`

**Fichier :** `server.js` **Ligne :** 2010

```sql
CREATE TABLE IF NOT EXISTS cleaners (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  pin_code    TEXT UNIQUE,   -- ajouté via DO block (l.2067)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Colonnes ajoutées par migration :**

| Colonne | Type | Valeur défaut | Ligne |
|---|---|---|---|
| `sub_account_id` | INTEGER → FK `sub_accounts(id) ON DELETE SET NULL` | NULL | 2735 |
| `sms_recap_enabled` | BOOLEAN NOT NULL | FALSE | 2742 |
| `access_token` | TEXT UNIQUE | NULL (backfillé à la migration) | 2753 |
| `access_token_created_at` | TIMESTAMPTZ | NULL | 2754 |

`access_token` est l'alternative longue et révocable au PIN 4 chiffres. Un token est généré automatiquement pour chaque fiche existante lors de la migration.

---

## Table `cleaning_assignments`

**Fichier :** `server.js` **Ligne :** 2029

```sql
CREATE TABLE IF NOT EXISTS cleaning_assignments (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  cleaner_id  TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, property_id)
);
```

**Colonne `reservation_key` :** utilisée dans tous les INSERT, DELETE et SELECT sur cette table (l.13447, 13412, 13707…) mais **absente du CREATE TABLE ci-dessus**. Elle a donc été ajoutée via `ALTER TABLE` hors du bloc `initDb()` courant — cette migration n'est pas visible dans `server.js`. La clé primaire `(user_id, property_id)` est également incompatible avec plusieurs assignations par propriété (une par réservation) : elle a probablement été modifiée ou remplacée en base lors de l'introduction de `reservation_key`.

---

## Table `property_default_cleaners`

**Fichier :** `server.js` **Ligne :** 2199

```sql
CREATE TABLE IF NOT EXISTS property_default_cleaners (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  cleaner_id  TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, property_id)
);
```

Un seul cleaner par défaut par logement (PK composite). Cette table est consultée pour générer des assignations virtuelles (`is_default: true`) dans GET /api/cleaning/assignments et GET /api/cleaning/tasks/:pinCode.

---

## Table `cleaning_checklists`

**Fichier :** `server.js` **Ligne :** 2038

```sql
CREATE TABLE IF NOT EXISTS cleaning_checklists (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id     TEXT NOT NULL,
  reservation_key TEXT NOT NULL UNIQUE,   -- clé de liaison réservation
  cleaner_id      TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  guest_name      TEXT,
  checkout_date   DATE NOT NULL,
  tasks           JSONB NOT NULL DEFAULT '[]',
  photos          JSONB NOT NULL DEFAULT '[]',
  notes           TEXT,
  completed_at    TIMESTAMPTZ,
  sent_to_owner   BOOLEAN NOT NULL DEFAULT FALSE,
  sent_to_guest   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Colonnes ajoutées par migration :**

| Colonne | Type | Défaut | Ligne |
|---|---|---|---|
| `duration_seconds` | INTEGER | NULL | 2164 |
| `started_at` | TIMESTAMPTZ | NULL | 2170 |
| `owner_status` | TEXT NOT NULL | `'pending'` | 2176 |
| `owner_validated_at` | TIMESTAMPTZ | NULL | 2182 |
| `owner_notes` | TEXT | NULL | 2188 |
| `is_validated` | BOOLEAN NOT NULL | FALSE | 2194 |
| `signature_data` | TEXT | NULL | 14274 |
| `signature_ip` | VARCHAR(64) | NULL | 14275 |
| `certified_at` | TIMESTAMPTZ | NULL | 14276 |
| `cleaner_certified` | BOOLEAN | false | 14277 |

`owner_status` peut valoir `'pending'`, `'rejected'` (les checklists rejetées restent visibles même après la date).

---

## Construction de `reservation_key` — deux formats

### Format 1 — Assignations réelles (POST /api/cleaning/assignments)

```
<property_id>_<YYYY-MM-DD>_<YYYY-MM-DD>
```

Exemple : `"charles-studio_2026-05-22_2026-05-24"`

Généré dans les deux déclarations de POST /api/cleaning/assignments (l.13447 et l.13565) : le client envoie `reservationKey` dans le body, et c'est cette valeur qui est insérée en base. La clé est elle-même construite côté client (ou par le GET /api/cleaning/assignments) à partir des dates ISO de la réservation.

Généré aussi par le GET (voir ci-dessous) quand des lignes real assignations ont ce format :
```js
// l.13776 / 13800
const rKey = propId + '_' + rStart + '_' + rEnd;
// rStart, rEnd : TO_CHAR(start_date, 'YYYY-MM-DD') → 'YYYY-MM-DD'
```

**Ce format est filtrable par date** : les deux derniers segments après split(`'_'`) sont des dates ISO.

---

### Format 2 — Assignations virtuelles `is_default: true` (GET /api/cleaning/assignments)

**Fichier :** `server.js` **Lignes :** 14800–14820

```js
const startStr = String(resa.start_date).slice(0, 10);
const endStr   = String(resa.end_date).slice(0, 10);
const key = `${resa.property_id}_${startStr}_${endStr}`;
```

Le driver PostgreSQL (`pg`) retourne les colonnes `TIMESTAMPTZ` comme des objets JavaScript `Date`. `String(new Date(...))` produit une représentation dépendante de la locale et du fuseau :

```
"Mon Apr 20 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"
```

`.slice(0, 10)` donne donc **`"Mon Apr 20"`** — soit le jour de la semaine, le mois abrégé et le jour du mois, **sans l'année**.

Exemple complet : `"charles-studio_Mon Apr 20_Tue Apr 21"`

**Ce format n'est PAS filtrable par date :**
- Pas d'année → impossible de filtrer `endDate >= todayStr` (comparaison de chaînes invalide)
- Pas de séparateurs ISO → le parsing `parts[parts.length - 1]` (l.13848) extrait `"Tue Apr 21"` et le compare à `todayStr` (`"2026-09-01"`) : la comparaison lexicographique est fausse
- Ce format ne correspondra jamais à une `reservation_key` stockée en base (qui utilise le format 1)

**Origine du bug :** la query SQL de GET /api/cleaning/assignments (l.14800) sélectionne `start_date` et `end_date` sans TO_CHAR, contrairement à la query de GET /api/cleaning/tasks/:pinCode (l.13760) qui utilise bien `TO_CHAR(start_date, 'YYYY-MM-DD')`.

**Conséquence opérationnelle :**
- Les assignations `is_default: true` retournées par GET /api/cleaning/assignments ont une `reservation_key` inutilisable pour un POST ultérieur (ce POST échouerait à retrouver la réservation dans cleaning_checklists)
- Elles ne peuvent pas être dédupliquées contre les assignations réelles en base

---

## Route GET /api/cleaning/assignments

**Fichier :** `server.js` **Ligne :** 14734

**Verbe et chemin :** `GET /api/cleaning/assignments`

**Middlewares (dans l'ordre) :**
1. `authenticateAny`
2. `requirePermission(pool, 'can_view_calendar')`
3. `loadSubAccountData(pool)`

**Query params :** aucun (filtre interne sur `user_id`).

**Réponse :**
```json
{
  "success": true,
  "assignments": [
    {
      /* colonnes cleaning_assignments */,
      "cleaner_name": "...",
      "cleaner_phone": "...",
      "cleaner_email": "...",
      "property_name": "...",
      "property_color": "...",
      "is_default": true   /* uniquement pour les virtuelles */
    }
  ]
}
```
Enveloppé, clé `assignments`. Les entrées `is_default: true` sont des assignations virtuelles générées à la volée — non persistées en base.

**`getAgencyUserIds` :** OUI.

---

## Route POST /api/cleaning/assignments — doublon confirmé

| Déclaration | Ligne | Auth | Accessible par Express |
|---|---|---|---|
| Première | 13395 | aucune (getUserFromRequest sans middleware) | **OUI** |
| Seconde | 13498 | `authenticateAny`, `requirePermission('can_assign_cleaning')`, `loadSubAccountData` | **NON (code mort)** |

**La première déclaration (l.13395) n'a pas de middleware d'authentification.** Elle appelle `getUserFromRequest(req)` manuellement mais sans vérification préalable du token. En pratique toute requête non authentifiée retourne 401 (getUserFromRequest retourne null) mais les permissions `can_assign_cleaning` ne sont jamais vérifiées.

**Body attendu (les deux routes) :**

| Champ | Clé | Type | Obligatoire |
|---|---|---|---|
| Clé de réservation | `reservationKey` | string | **oui** |
| ID logement | `propertyId` | string | **oui** |
| ID agent de ménage | `cleanerId` | string | non (null → supprime l'assignation) |

**Réponse (succès) :**
```json
{ "message": "Assignation ménage enregistrée", "assignment": { "reservationKey": "...", "propertyId": "...", "cleanerId": "..." } }
```
Non enveloppé.
