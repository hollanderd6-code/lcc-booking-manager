# Relevé 2 — Flux checkin.html

États du parcours d'arrivée invité, côté serveur et côté `public/checkin.html`. Focus sur la pastille « Fiche police non signée ».

---

## Vue d'ensemble du flux

```
Hôte → envoie lien /checkin.html?token=<unique_token>
                         ↓
                GET /api/checkin/:token
                         ↓
         ┌───────────────┴────────────────┐
         │ ok: false (token inconnu)      │ ok: true
         ↓                               │
    [errorState]        ┌────────────────┴───────────────┐
                        │ alreadySubmitted: true         │ alreadySubmitted: false
                        ↓                               ↓
                   [doneState]                      [form]
                                                        │
                                                   Voyageur remplit et signe
                                                        │
                                              POST /api/checkin/:token
                                                        │
                                            ┌───────────┴──────────┐
                                            │ erreur               │ ok: true
                                            ↓                      ↓
                                         toast                [successState]
```

---

## Table `police_records` — schéma complet

**Fichier :** `server.js` **Ligne :** 2340

```sql
CREATE TABLE IF NOT EXISTS police_records (
  id                SERIAL PRIMARY KEY,
  user_id           TEXT NOT NULL,          -- hôte propriétaire
  property_id       TEXT,
  conversation_id   INTEGER,                -- FK conversations.id
  reservation_uid   TEXT,                   -- UID de la réservation Channex
  guest_nom         TEXT,
  guest_prenoms     TEXT,
  guest_naissance_date DATE,
  guest_naissance_lieu TEXT,
  guest_nationalite TEXT,
  guest_domicile    TEXT,
  guest_tel         TEXT,
  guest_email       TEXT,
  date_arrivee      DATE,
  date_depart       DATE,
  enfants_moins_15  TEXT,
  signature_data    TEXT,                   -- base64 de la signature canvas
  id_document_url   TEXT,                   -- URL Cloudinary (accès restreint, TTL 14j)
  id_doc_expires_at TIMESTAMPTZ,
  signer_ip         TEXT,
  signed_at         TIMESTAMPTZ DEFAULT NOW(),
  status            TEXT DEFAULT 'signed',  -- seule valeur insérée : 'signed'
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '6 months')
);
```

**Index :** sur `user_id`, `conversation_id`, `reservation_uid`.

**Purge automatique** (cron, l.31769) : `DELETE FROM police_records WHERE expires_at < NOW()` — les fiches expirent 6 mois après leur création.

---

## Ce qui détermine la pastille « Fiche police non signée »

Il n'existe **aucune colonne booléenne** dans `conversations` ni dans `reservations` pour indiquer si la fiche de police a été signée. Le statut est dérivé à la demande en interrogeant `police_records`.

### Côté serveur (templates/cron — l.30135, l.31660)

La condition `police_complete` vérifie :
```sql
EXISTS (
  SELECT 1 FROM police_records pr
  WHERE status = 'signed'
    AND (pr.conversation_id = $1 OR (reservation_uid IS NOT NULL AND reservation_uid = $2))
) AS done
```
Si `done = false` ET que le voyageur est **étranger** (`guest_country ≠ ''` et `guest_country ≠ 'FR'`) → le template `on_arrival` est bloqué.

### Côté web hôte (reservations.html — l.1232)

La section police est chargée **à la demande** quand l'hôte ouvre le détail d'une réservation. La pastille (lien "Fiche de police") n'est pas visible sur la carte de réservation dans la liste — elle apparaît uniquement dans le panneau détail.

L'appel est : `GET /api/police-records?uid=<reservation_uid>` (ou `?propertyId=...&start=<YYYY-MM-DD>`).

La réponse contient le tableau `records`. Si vide → aucune fiche signée. Si non-vide → la fiche est affichée avec date de signature et IP.

---

## Routes publiques (aucune authentification)

### `GET /api/checkin/:token`
**Fichier :** `server.js` **Ligne :** 15829

**Paramètre URL :** `token` = valeur de `conversations.unique_token`

**Réponse :**
```jsonc
{
  "ok": true,
  "alreadySubmitted": false,   // true si une ligne police_records existe déjà
  "submittedAt": null,         // signed_at si alreadySubmitted
  "propertyName": "Studio Marais",
  "guestName": "Max Dupont",
  "guestEmail": "...",
  "guestPhone": "+33...",
  "guestCountry": "DE",
  "dateArrivee": "2026-09-05",
  "dateDepart": "2026-09-08",
  "hasDeposit": true           // false si Airbnb ou caution = 0
}
```
— Non enveloppé.

Critère `alreadySubmitted` : `SELECT id FROM police_records WHERE conversation_id = $1 OR (reservation_uid IS NOT NULL AND reservation_uid = $2) ORDER BY created_at DESC LIMIT 1`.

### `POST /api/checkin/:token`
**Fichier :** `server.js` **Ligne :** 15882

**Body attendu (JSON) :**

| Champ | Clé | Type | Obligatoire |
|---|---|---|---|
| Nom de famille | `nom` | string | **oui** |
| Prénom(s) | `prenoms` | string | **oui** |
| Date de naissance | `naissanceDate` | date string | **oui** |
| Lieu de naissance | `naissanceLieu` | string | **oui** |
| Nationalité | `nationalite` | string | **oui** |
| Domicile habituel | `domicile` | string | **oui** |
| Signature | `signature` | base64 PNG | **oui** |
| Téléphone | `tel` | string | non |
| Email | `email` | string | non |
| Enfants < 15 ans | `enfants` | string | non |
| Pièce d'identité | `idDocument` | base64 data-URL | non (upload Cloudinary, purge 14j) |

**Action :** `INSERT INTO police_records` avec `status = 'signed'`.

**Effets de bord :**
1. Notification FCM push à l'hôte (`type: 'police_checkin'`).
2. `setTimeout(() => runTemplatesCron(['on_arrival']), 3000)` — relance l'évaluation des templates d'arrivée bloqués par `police_complete`.

**Réponse :** `{ "ok": true }` — non enveloppé.

---

## Route hôte authentifiée

### `GET /api/police-records`
**Fichier :** `server.js` **Ligne :** 15986

**Middlewares :** `authenticateAny`

**Query params :**

| Param | Obligatoire |
|---|---|
| `uid` | l'un des deux groupes est requis |
| `propertyId` + `start` (YYYY-MM-DD) | l'autre groupe |

**Réponse :**
```json
{ "ok": true, "records": [ { /* colonnes police_records */ } ] }
```
Enveloppé, clé `records`.

**`getAgencyUserIds` :** OUI.

### `GET /api/police-records/:id/pdf`
**Fichier :** `server.js` **Ligne :** 16013

Retourne un PDF de la fiche. Middleware `authenticateAny`. `getAgencyUserIds` OUI.

---

## États de `public/checkin.html`

| Id HTML | Déclencheur | Description |
|---|---|---|
| `loading` | initial | Spinner pendant l'appel GET |
| `errorState` | `ok: false` ou réseau KO | Lien invalide / expiré |
| `doneState` | `alreadySubmitted: true` | Fiche déjà enregistrée |
| `form` | `alreadySubmitted: false` | Formulaire à compléter |
| `successState` | POST réussi | Confirmation envoi |

Passage entre états par la fonction `show(id)` (l.225) qui masque tous les états sauf le cible.

---

## Colonne `unique_token` (conversations)

Le lien d'accès au check-in est construit côté serveur comme :
```
https://<APP_URL>/checkin.html?token=<conversations.unique_token>
```
`unique_token` est généré à la création de la conversation (UUID ou token aléatoire). C'est le même token utilisé pour le chat guest (`/chat/<unique_token>`).

Le modèle de message utilise le placeholder `{checkin_link}` (l.30564) qui est remplacé par l'URL ci-dessus lors de l'envoi du template.
