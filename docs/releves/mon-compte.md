# Relevé API — Écran « Mon compte » (iOS)

> Relevé en lecture seule. Sources : `server.js` (46 192 lignes), `sub-accounts-routes.js`,
> `support-chat-routes.js`, `public/settings-account.html`, `public/help.html`.  
> Date : 2026-09-03.

---

## 1. Profil et entreprise

### GET `/api/user/profile`

**Auth :** `getUserFromRequest(req)` — résout le token JWT manuellement (pas de middleware
`authenticateToken` dans la déclaration, ligne 10527). La route est donc techniquement
accessible sans middleware Express formel — voir § **À TRANCHER**.

**?agency=all :** absent.  
**Réponse :** objet plat (pas d'enveloppe).

```json
{
  "id": "u_abc123",
  "email": "host@example.com",
  "firstName": "Marie",
  "lastName": "Dupont",
  "company": "Location Paris",
  "accountType": "business",
  "address": "12 rue de la Paix",
  "postalCode": "75001",
  "city": "Paris",
  "siret": "12345678901234",
  "logoUrl": "https://res.cloudinary.com/...",
  "use_bh_stripe": false,
  "phone": "+33612345678",
  "invoiceEmail": "factures@example.com",
  "website": "https://example.com",
  "vatRegime": "normal",
  "vatNumber": "FR12345678901",
  "legalForm": "SARL",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Doublons camelCase/snake_case :** `use_bh_stripe` reste en snake_case alors que tous les
autres champs sont en camelCase. À noter.

**Champs numériques susceptibles d'arriver en chaîne :** aucun dans cette réponse (siret est
`TEXT` en base, arrivera toujours comme string).

---

### PUT `/api/user/profile` — mise à jour complète

**Auth :** `getUserFromRequest(req)` (même pattern que le GET, ligne 10617).  
**Content-Type :** `multipart/form-data` (via `upload.single('logo')` — multer + Cloudinary).  
**?agency=all :** absent.  
**Réponse :** enveloppée dans `{ success, message, profile: { ... } }`.

Corps attendu (champs du formulaire multipart) :

| Clé | Type | Notes |
|-----|------|-------|
| `firstName` | string | |
| `lastName` | string | |
| `company` | string | |
| `accountType` | `"individual"` \| `"business"` | Défaut `"individual"` |
| `address` | string | nullable |
| `postalCode` | string | nullable |
| `city` | string | nullable |
| `siret` | string | 14 chiffres si `accountType=business` |
| `phone` | string | nullable |
| `invoiceEmail` | string | nullable |
| `website` | string | nullable |
| `vatRegime` | string | nullable |
| `vatNumber` | string | nullable |
| `legalForm` | string | nullable |
| `logo` | file | optionnel — upload Cloudinary |

La réponse `profile` contient les mêmes champs camelCase que le GET, **sans** `use_bh_stripe`
ni `id` ni `email` ni `createdAt`.

---

### PATCH `/api/user/profile` — toggle `use_bh_stripe`

**Auth :** `authenticateAny` (ligne 10594).  
**Content-Type :** `application/json`.  
**Corps :** `{ "use_bh_stripe": true }` (booléen obligatoire — 400 si autre type).  
**Réponse :** `{ "success": true, "use_bh_stripe": true }`.

---

## 2. Abonnement

### GET `/api/subscription/status`

**Auth :** `authenticateAny` (ligne 11219). Ne supporte pas les sous-comptes (utilise
`req.user.id` directement sans redirection `parentUserId`).  
**?agency=all :** utilisé en interne pour le quota de logements (`getAgencyUserIds`).  
**Réponse :** objet plat.

```json
{
  "status": "active",
  "planType": "pro_monthly",
  "planAmount": 49,
  "trialEndDate": null,
  "currentPeriodEnd": "2026-10-03T00:00:00.000Z",
  "daysRemaining": null,
  "displayMessage": "Abonnement Pro",
  "showAlert": false,
  "smsEnabled": true,
  "smsIncluded": true,
  "propertiesUsed": 3,
  "propertiesLimit": 4
}
```

**Valeurs de `status` :** `"trial"`, `"trialing"`, `"active"`, `"expired"`, `"canceled"`.  
**`daysRemaining` :** calculé uniquement quand `status === "trial"`.  
**`showAlert` :** `true` si `status === "trial"` ET `daysRemaining <= 3`.  
**Champs numériques :** `planAmount`, `propertiesUsed`, `propertiesLimit` — arriveront comme
nombres JS (parseInt / valeur directe). `daysRemaining` peut être `null`.

**Plans de base (`getBasePlanName`) :**

| `plan_type` DB contient | `basePlan` | Prix mensuel | Logements inclus |
|-------------------------|-----------|-------------|------------------|
| `agence` / `business` | `"agence"` | 299 € | 51 (max 9999) |
| `pro` / `standard` | `"pro"` | 49 € | 4 (max 50) |
| `starter` / `solo` | `"starter"` | 15 € | 1 (max 3) |

**Distinguer plan Agence :** `getBasePlanName(planType) === 'agence'`. La route expose
`planType` brut (ex. `"agence_monthly"`, `"agence_annual"`) — ne pas tester l'égalité exacte,
appliquer la même logique de normalisation.

---

### GET `/api/subscription/features`

**Auth :** `authenticateAny` (ligne 11186). Supporte les sous-comptes (`parentUserId`).  
**Réponse :** objet plat.

```json
{
  "plan": "pro",
  "planType": "pro_monthly",
  "status": "active",
  "isTrial": false,
  "features": {
    "calendar": true,
    "channex_sync": true,
    "ical": true,
    "stripe_payments": true,
    "cautions": true,
    "messaging_ai": true,
    "cleaning_basic": true,
    "welcome_book": true,
    "app_mobile": true,
    "bhguest": true,
    "pricing_rules_basic": true,
    "reports_basic": true,
    "contracts_rental": true,
    "push_notifications": true,
    "cautions_no_commission": true,
    "facturation_proprietaires": true,
    "invoices_clients": true,
    "attestation_conciergerie": true,
    "cleaning_advanced": true,
    "sous_comptes": true,
    "reports_advanced": true,
    "pricing_rules_advanced": true,
    "sms": true,
    "droits_par_profil": true,
    "mode_agence": false,
    "multi_comptes_clients": false,
    "support_prioritaire": false
  }
}
```

Pas de route côté API pour changer de formule directement — le changement passe par Stripe
Billing Portal (`POST /api/billing/create-portal-session`, `authenticateToken`).

---

## 3. Équipe et accès (sous-comptes)

Toutes ces routes passent par le middleware :

```
app.use('/api/sub-accounts', authenticateAny + requireFeature('sous_comptes'))
// SAUF /api/sub-accounts/login (exempt de l'auth)
app.use('/api/team', authenticateAny + requireFeature('sous_comptes'))
```

`sous_comptes` est accessible aux plans `pro` et `agence` (+ trial actif).

---

### GET `/api/sub-accounts/list`

**Auth :** `authenticateToken` (hérité du `use` ci-dessus, mais re-déclaré dans le handler).  
**?agency=all :** supporté — remonte les sous-comptes des comptes délégués.  
**Réponse :** `{ success: true, subAccounts: [...] }`.

Chaque élément :

```json
{
  "id": 42,
  "email": "cleaner@example.com",
  "first_name": "Jean",
  "last_name": "Dupont",
  "role": "cleaner",
  "is_active": true,
  "created_at": "2025-03-01T12:00:00.000Z",
  "last_login": "2025-09-02T08:00:00.000Z",
  "can_view_calendar": true,
  "can_edit_reservations": false,
  "can_create_reservations": false,
  "can_delete_reservations": false,
  "can_view_messages": false,
  "can_send_messages": false,
  "can_view_cleaning": true,
  "can_assign_cleaning": false,
  "can_manage_cleaning_staff": false,
  "can_view_finances": false,
  "can_edit_finances": false,
  "can_view_properties": false,
  "can_edit_properties": false,
  "can_access_settings": false,
  "can_manage_team": false,
  "can_view_deposits": false,
  "can_manage_deposits": false,
  "can_view_smart_locks": false,
  "can_manage_smart_locks": false,
  "can_view_invoices": false,
  "can_manage_invoices": false,
  "can_view_payments": false,
  "can_manage_payments": false,
  "can_view_contracts": false,
  "notif_sub_new_reservation": false,
  "notif_sub_reservation_cancelled": false,
  "notif_sub_cleaning_assigned": false,
  "notif_sub_cleaning_completed": false,
  "notif_sub_deposit_paid": false,
  "notif_sub_payment_received": false,
  "notif_sub_new_message": false,
  "notif_sub_daily_summary": false,
  "visible_kpis": {},
  "accessible_properties": ["prop_abc", "prop_xyz"],
  "can_view_reservations": true,
  "can_manage_cleaning": false
}
```

**Doublon :** la réponse ajoute des alias `can_view_reservations` (= `can_view_calendar`) et
`can_manage_cleaning` (= `can_assign_cleaning`). Les deux versions existent simultanément dans
le JSON.

---

### POST `/api/sub-accounts/create`

**Auth :** `authenticateToken`.  
**Content-Type :** `application/json`.  
**?agency=all :** absent (créé sous `req.user.id`).

Corps :

```json
{
  "email": "member@example.com",
  "password": "motdepasse",
  "firstName": "Jean",
  "lastName": "Dupont",
  "role": "custom",
  "permissions": {
    "can_view_reservations": true,
    "can_edit_reservations": false,
    "can_create_reservations": false,
    "can_view_messages": true,
    "can_send_messages": false,
    "can_view_cleaning": true,
    "can_manage_cleaning": false,
    "can_view_finances": false,
    "can_view_properties": true,
    "can_edit_properties": false,
    "can_view_deposits": false,
    "can_manage_deposits": false,
    "can_view_smart_locks": false,
    "can_manage_smart_locks": false,
    "can_view_invoices": false,
    "can_manage_invoices": false,
    "can_view_contracts": false,
    "visible_kpis": {}
  },
  "propertyIds": ["prop_abc"],
  "notifications": {
    "notif_sub_new_reservation": true,
    "notif_sub_reservation_cancelled": false,
    "notif_sub_cleaning_assigned": true,
    "notif_sub_cleaning_completed": true,
    "notif_sub_deposit_paid": false,
    "notif_sub_payment_received": false,
    "notif_sub_new_message": false,
    "notif_sub_daily_summary": false
  }
}
```

**Rôles prédéfinis :** `"owner"`, `"manager"`, `"cleaner"`, `"accountant"`. Pour ces rôles,
les `permissions` du corps sont ignorées (les droits sont fixés par le code).

**Réponse :** `{ success: true, subAccount: { id, email, firstName, lastName, role } }`.

#### Colonnes de permissions écrites en base (`sub_account_permissions`)

Colonnes DB (noms exacts, tous boolean) :

```
can_view_calendar          can_edit_reservations      can_create_reservations
can_delete_reservations    can_view_messages          can_send_messages
can_view_cleaning          can_assign_cleaning        can_manage_cleaning_staff
can_view_finances          can_edit_finances          can_view_properties
can_edit_properties        can_access_settings        can_manage_team
can_view_deposits          can_manage_deposits        can_view_smart_locks
can_manage_smart_locks     can_view_invoices          can_manage_invoices
can_view_payments          can_manage_payments        can_view_contracts
can_view_pricing           can_manage_pricing         can_view_reporting
can_view_debours           can_manage_debours         can_view_welcome_book
can_view_templates         can_manage_templates
```

Colonnes notifications (boolean) :

```
notif_sub_new_reservation  notif_sub_reservation_cancelled  notif_sub_cleaning_assigned
notif_sub_cleaning_completed  notif_sub_deposit_paid        notif_sub_payment_received
notif_sub_new_message      notif_sub_daily_summary
```

Colonne JSON : `visible_kpis` (jsonb).

**`can_view_owners` :** **ABSENT** de la table et de tout le code relevé. La spec T4 devra
l'introduire via migration.

---

### PUT `/api/sub-accounts/:id`

**Auth :** `authenticateToken`.  
**?agency=all :** supporté (vérifie la propriété via `agencyIdsFor`).  
**Corps :** mêmes champs que POST sauf `email`/`password` (non modifiables).  
**Réponse :** `{ success: true, message: "Sous-compte modifié avec succès" }`.

---

### DELETE `/api/sub-accounts/:id`

**Auth :** `authenticateToken`.  
**?agency=all :** supporté.  
**Réponse :** `{ success: true }`.

---

### PUT `/api/sub-accounts/:id/toggle`

Active ou désactive un sous-compte (bascule `is_active`).  
**Auth :** `authenticateToken`.  
**?agency=all :** supporté.  
**Réponse :** `{ success: true, isActive: true }`.

---

## 4. Comptes gérés / délégations

### GET `/api/agency/delegations`

**Auth :** `authenticateAny`, compte principal uniquement (retourne 403 si sous-compte).  
**?agency=all :** absent.  
**Réponse :** enveloppée.

```json
{
  "canActAsAgent": true,
  "iManage": [
    {
      "id": "deleg_abc",
      "userId": "u_xyz",
      "name": "Gestion Côte d'Azur",
      "email": "owner@example.com",
      "propertyCount": 5,
      "permissions": { "can_view_calendar": true, "can_view_messages": true },
      "acceptedAt": "2025-08-01T10:00:00.000Z"
    }
  ],
  "myDelegates": [
    {
      "id": "deleg_def",
      "email": "agent@agency.com",
      "name": "Agence Pro",
      "status": "pending",
      "permissions": {},
      "invitedAt": "2025-09-01T09:00:00.000Z",
      "acceptedAt": null
    }
  ]
}
```

**Valeurs de `status` (dans `myDelegates`) :** `"pending"`, `"accepted"`, `"revoked"`.  
La requête filtre `status != 'revoked'` pour `myDelegates` : les invitations révoquées
disparaissent. Pour `iManage` : filtré sur `status = 'accepted'` uniquement.  
**`canActAsAgent` :** `true` si plan `agence` ou trial valide.

---

### POST `/api/agency/invite`

**Auth :** `authenticateAny`, compte principal.  
**Corps :** `{ "email": "agent@example.com", "permissions": { ... } }`.  
**Réponse :** `{ success: true, status: "pending" | "accepted", token: "..." }`.

Si l'invité a déjà un compte BH, `status` est immédiatement `"accepted"` et la délégation est
active sans attente.

---

### POST `/api/agency/accept`

Accepte une invitation via token URL.  
**Auth :** `authenticateAny`, compte principal.  
**Corps :** `{ "token": "hexstring64chars" }`.  
**Réponse :** `{ success: true, delegatorUserId: "u_xyz" }`.

---

### POST `/api/agency/revoke`

Révoque un accès (peut être utilisé par le délégateur OU le délégué).  
**Auth :** `authenticateAny`, compte principal.  
**Corps :** `{ "delegationId": "deleg_abc" }`.  
**Réponse :** `{ success: true }`.

---

### POST `/api/agency/switch`

Génère un token JWT `agency_access` pour travailler dans le compte d'un client géré.  
**Auth :** `authenticateAny` + plan `agence` vérifié.  
**Corps :** `{ "targetUserId": "u_xyz" }`.  
**Réponse :**

```json
{
  "success": true,
  "token": "eyJ...",
  "permissions": { "can_view_calendar": true, ... },
  "managedUser": { "id": "u_xyz", "name": "Gestion Sud", "email": "owner@example.com" }
}
```

---

## 5. Plateformes connectées

Il n'existe pas de route `/api/platforms` dédiée. « 2 actives » dans l'UI est calculé
localement à partir de `GET /api/properties` (décrit ci-dessous).

### GET `/api/properties`

**Auth :** `authenticateAny, checkSubscription, requirePermission(pool, 'can_view_properties')`.  
**?agency=all :** supporté via `getAgencyUserIds`.  
**Réponse :** `{ properties: [...] }`.

Champs pertinents pour les plateformes, par logement :

```json
{
  "id": "prop_abc",
  "channexEnabled": true,
  "channexPropertyId": "chx_123",
  "icalUrls": [
    { "url": "https://airbnb.com/calendar/ical/...", "platform": "iCal" }
  ]
}
```

**Comment distinguer l'état d'une plateforme :**

| État | Condition |
|------|-----------|
| Connectée (Channex) | `channexEnabled === true && channexPropertyId !== null` |
| Connectée (iCal) | `icalUrls.length > 0` |
| Jamais essayée | `channexEnabled === false && icalUrls.length === 0` |
| En échec (Channex) | Via `GET /api/properties/:id/sante` — champ `points[].ok === false` |

La route `/api/properties/:property_id/sante` (auth `authenticateAny`, ?agency=all supporté)
retourne un diagnostic par logement :

```json
{
  "property_id": "prop_abc",
  "nom": "Appartement Paris",
  "relie": true,
  "vendable": false,
  "a_regler": 2,
  "points": [
    { "cle": "relie", "ok": true, "titre": "L'annonce est reliée" },
    { "cle": "calendrier", "ok": false, "titre": "Calendrier jamais envoyé",
      "quand": null, "details": "...", "action": "envoyer" },
    { "cle": "tarifs", "ok": false, "titre": "Aucun prix de base",
      "quand": null, "details": "...", "action": "prix" }
  ]
}
```

**Doublon route `/api/properties` :** trois déclarations trouvées (lignes 1923, 1928, 16856).
Les deux premières (1923–1930) sont dans un bloc commentaire/pseudo-code explicatif, pas du code
actif. La route active est ligne 16856. Pas de vrai doublon fonctionnel, mais le code mérite
nettoyage.

---

### GET `/api/integrations/channex-key`

Renvoie la clé API Channex partagée (lue depuis `process.env`).  
**Auth :** `authenticateToken`.  
**Réponse :** `{ "key": "..." }`.

---

### GET `/api/hosterzz/status`

Statut de liaison Hosterzz (prestataire ménage externe).  
**Auth :** `authenticateToken`.  
**Réponse :** `{ "linked": true, "hz_name": "Hosterzz Pro", "since": "2025-01-01T..." }`.

---

## 6. Ménage et prestataires

### GET `/api/cleaners`

**Auth :** `authenticateAny, checkSubscription, requirePermission(pool, 'can_view_cleaning')`.  
**?agency=all :** supporté.  
**Réponse :** `{ cleaners: [...] }`.

```json
{
  "cleaners": [
    {
      "id": "c_m3x7k",
      "name": "Sophie Ménage",
      "phone": "+33611111111",
      "email": "sophie@example.com",
      "notes": "Clé sous le paillasson",
      "pin_code": "4821",
      "is_active": true,
      "sub_account_id": null,
      "sms_recap_enabled": false,
      "access_token": "abc123...",
      "created_at": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

**Champs numériques :** `pin_code` est stocké `TEXT` en base et arrivera comme string.

---

### POST `/api/cleaners`

**Auth :** `authenticateAny, requirePermission(pool, 'can_manage_cleaning')`.  
**Content-Type :** `application/json`.  
**Corps :** `{ name, phone, email, notes, isActive, subAccountId }`.  
**Réponse :** `{ message: "Membre du ménage créé", cleaner: { id, name, phone, email, notes, pin_code, is_active, sub_account_id, access_token, created_at } }`.

`pin_code` est généré automatiquement (4 chiffres, unicité vérifiée en base).  
`access_token` est généré automatiquement (32 bytes base64url).

---

### PUT `/api/cleaners/:id`

**Auth :** `authenticateAny, requirePermission(pool, 'can_manage_cleaning')`.  
**Corps :** `{ name, phone, email, notes, isActive, subAccountId }`.  
**Réponse :** `{ message, cleaner: { id, name, phone, email, notes, is_active, sub_account_id, created_at } }`.

---

### PUT `/api/cleaners/:id/sms-toggle`

Active/désactive le récap SMS pour un prestataire.  
**Auth :** `authenticateAny, requirePermission(pool, 'can_manage_cleaning')`.  
**Plan requis :** `pro` ou `agence`, ou `sms_enabled = true` en DB.  
**Corps :** `{ "enabled": true }`.  
**Réponse :** `{ success: true, cleaner: { id, name, sms_recap_enabled } }`.  
**Erreur plan :** `403 { error: "option_required", message: "Option SMS requise pour ce plan" }`.

---

### POST `/api/cleaners/:id/regenerate-link`

Révoque l'`access_token` existant et en génère un nouveau.  
**Auth :** `authenticateAny, requirePermission(pool, 'can_manage_cleaning')`.  
**Corps :** vide.  
**Réponse :** `{ success: true, cleaner: { id, name, access_token } }`.

---

### DELETE `/api/cleaners/:id`

**Auth :** `authenticateAny, requirePermission(pool, 'can_manage_cleaning')`.  
**Réponse :** `{ message: "Membre du ménage supprimé" }`.

---

## 7. Messages automatiques (modèles)

### GET `/api/message-templates`

**Auth :** `authenticateToken` (sous-comptes exclus — seulement comptes principaux).  
**?agency=all :** supporté.  
**Query params :** `?property_id=prop_abc` (filtre optionnel).  
**Réponse :** `{ templates: [...] }` avec champs supplémentaires calculés.

```json
{
  "templates": [
    {
      "id": 12,
      "user_id": "u_abc",
      "property_id": null,
      "property_ids": ["prop_abc", "prop_xyz"],
      "title": "Message arrivée",
      "message": "Bonjour {prenom}, bienvenue à {logement}...",
      "trigger_type": "before_arrival",
      "trigger_offset_hours": 0,
      "trigger_offset_days": 1,
      "send_condition": "always",
      "active": true,
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-09-01T00:00:00.000Z",
      "logements_couverts": 2,
      "logements_cibles": 2,
      "portee": "ciblee"
    }
  ]
}
```

**`trigger_type` valeurs :** `before_arrival`, `on_arrival`, `after_arrival`, `before_departure`,
`on_departure`, `after_departure`, `on_booking`.

**`send_condition` valeurs :** `"always"` (seule valeur observée dans le code).

**Variables dans `message` :** `{prenom}`, `{nom}`, `{logement}`, `{arrivee}`, `{depart}`,
`{adresse}`, `{heure_arrivee}`, `{heure_depart}`, `{code_acces}`, `{wifi_nom}`, `{wifi_mdp}`,
`{instructions}`, `{livret}`, `{code_serrure}`, `{caution_url}`.

---

### POST `/api/message-templates`

**Auth :** `authenticateToken`.  
**Corps :**

```json
{
  "title": "Rappel départ",
  "message": "Bonjour {prenom}, rappel : départ prévu le {depart}.",
  "trigger_type": "before_departure",
  "trigger_offset_days": 1,
  "trigger_offset_hours": 0,
  "send_condition": "always",
  "property_ids": ["prop_abc"],
  "property_id": null
}
```

**Réponse :** `{ success: true, template: { ... } }` (objet complet RETURNING *).

---

### PUT `/api/message-templates/:id`

**Auth :** `authenticateToken`.  
**?agency=all :** supporté.  
**Corps :** même structure que POST (tous les champs éditables + `active: boolean`).  
**Réponse :** `{ success: true, template: { ... } }`.

---

### DELETE `/api/message-templates/:id`

**Auth :** `authenticateToken`.  
**?agency=all :** supporté.  
**Réponse :** `{ success: true }`.

---

### GET `/api/message-template-scheduled`

Planning des envois prévus dans les J+7.  
**Auth :** `authenticateToken`. **?agency=all :** supporté.  
**Réponse :** `{ scheduled: [...] }`.

```json
{
  "scheduled": [
    {
      "template_id": 12,
      "template_title": "Message arrivée",
      "trigger_label": "J-1 avant arrivée",
      "send_date": "2026-09-04",
      "conversation_id": "conv_abc",
      "guest_name": "Pierre Martin",
      "property_name": "Appartement Paris",
      "platform": "Airbnb",
      "is_blocked": false
    }
  ]
}
```

---

### GET `/api/message-template-logs`

Historique des envois effectués.  
**Auth :** `authenticateToken`. **?agency=all :** supporté. **Query :** `?limit=100`.  
**Réponse :** `{ logs: [...], total: 42 }`.

---

### POST / DELETE `/api/message-template-blocks`

Bloquer / débloquer un envoi sur une conversation précise.  
**Auth :** `authenticateToken` (aucun support agency).  
**Corps :** `{ "template_id": 12, "conversation_id": "conv_abc" }`.  
**Réponse :** `{ success: true }`.

---

## 8. Notifications

### GET `/api/settings/notifications`

Préférences de notifications de l'utilisateur principal.  
**Auth :** `getUserFromRequest(req)` (pas de middleware formel, ligne 12114) — voir § **À TRANCHER**.  
**?agency=all :** absent.  
**Réponse :** objet plat (valeurs depuis `user_settings.notifications` JSON).

```json
{
  "newReservation": true,
  "reminder": false,
  "whatsappEnabled": false,
  "whatsappNumber": "",
  "notif_new_reservation": true,
  "notif_reservation_cancelled": true,
  "notif_daily_summary": true,
  "notif_reminder_j1": true,
  "notif_cleaning_reminder": true,
  "notif_cleaning_completed": true,
  "notif_checklist_done": true,
  "notif_deposit_request": true,
  "notif_new_message": true,
  "notif_new_invoice": true,
  "notif_cleaning_alert": true,
  "notif_template_failed": true
}
```

**Doublon :** `newReservation` (ancien) et `notif_new_reservation` (nouveau) coexistent.
`reminder` (ancien) n'a pas d'équivalent direct dans les nouveaux champs.

---

### POST `/api/settings/notifications`

**Auth :** `getUserFromRequest(req)` (idem, pas de middleware formel).  
**Content-Type :** `application/json`.  
**Corps :** seuls `newReservation`, `reminder`, `whatsappEnabled`, `whatsappNumber` sont lus
par la route. Les champs `notif_*` granulaires **ne sont PAS sauvegardés** par cette route —
voir § **À TRANCHER**.  
**Réponse :** `{ message: "Préférences de notifications mises à jour", settings: { ... } }`.

---

### GET `/api/notifications/history`

Historique des notifications push reçues.  
**Auth :** `authenticateToken`.  
**Query :** `?limit=50` (max 100).  
**Réponse :**

```json
{
  "notifications": [
    {
      "id": 101,
      "title": "Nouvelle réservation",
      "body": "Pierre Martin arrive le 5 sept.",
      "type": "push",
      "data": null,
      "is_read": false,
      "created_at": "2026-09-03T14:00:00.000Z"
    }
  ],
  "unreadCount": 3
}
```

---

### PATCH `/api/notifications/history/read`

Marque toutes les notifications comme lues.  
**Auth :** `authenticateToken`.  
**Corps :** vide.  
**Réponse :** `{ success: true }`.

---

### DELETE `/api/notifications/history`

Vide l'historique.  
**Auth :** `authenticateToken`.  
**Réponse :** `{ success: true }`.

---

### POST `/api/notifications/history/push`

Enregistre une notification reçue côté client (appelé par `push-notifications-handler.js`).  
**Auth :** `authenticateToken`.  
**Corps :** `{ title, body, type, data }`.  
**Réponse :** `{ success: true }`.

---

## 9. Support — « Nous écrire »

Toutes les routes support utilisent `authenticateToken` (sous-comptes exclus).

### GET `/api/support/conversation`

Récupère ou crée la conversation de support active (status `open` ou `waiting`).  
Si aucune n'existe, en crée une et insère un message de bienvenue côté admin.  
**Réponse :** `{ conversation: { id, user_id, subject, status, last_message_at, created_at, updated_at } }`.

**`status` valeurs :** `"open"`, `"closed"`, `"waiting"`.

---

### GET `/api/support/conversations`

Liste toutes les conversations support de l'utilisateur (incluant les fermées).  
**Réponse :** `{ conversations: [...] }` avec `last_message` et `unread_count` par entrée.

---

### POST `/api/support/conversation/new`

Crée une nouvelle conversation (même si une active existe).  
**Corps :** vide.  
**Réponse :** `{ conversation: { ... } }`.

---

### GET `/api/support/messages/:conversationId`

Récupère les messages d'une conversation (vérification propriété utilisateur).  
Marque les messages admin comme lus automatiquement.  
**Réponse :** `{ messages: [...] }`.

```json
{
  "messages": [
    {
      "id": 1,
      "conversation_id": "sup_abc123",
      "sender_type": "admin",
      "sender_id": null,
      "sender_name": "Support Boostinghost",
      "message": "👋 Bonjour ! Comment pouvons-nous vous aider ?...",
      "image_url": null,
      "is_read": true,
      "created_at": "2026-09-03T14:00:00.000Z"
    }
  ]
}
```

**`sender_type` valeurs :** `"user"`, `"admin"`.

---

### POST `/api/support/messages`

Envoie un message texte.  
**Corps :** `{ "conversationId": "sup_abc", "message": "Bonjour..." }`.  
**Réponse :** objet message (RETURNING *).  
Émet Socket.io sur `support_${conversationId}` et `support_admin`.  
Envoie une notification push aux admins (tokens Firebase dédiés + comptes admin par email).

---

### POST `/api/support/upload`

Envoie une image (multipart, max 10 MB, formats JPG/PNG/WEBP/GIF).  
Upload vers Cloudinary dans le dossier `support-images`.  
**Corps :** `FormData { image: File, conversationId: string }`.  
**Réponse :** objet message avec `image_url` renseigné et `message = "📷 Image"`.

---

## Signalement — routes non protégées

| Route | Ligne | Problème |
|-------|-------|---------|
| `GET /api/user/profile` | 10527 | Pas de middleware Express — l'auth est faite manuellement dans le handler mais aucun middleware ne bloque en amont |
| `PUT /api/user/profile` | 10617 | Même problème |
| `GET /api/settings/notifications` | 12114 | Idem |
| `POST /api/settings/notifications` | 12129 | Idem |
| `GET /api/notifications/history` → via `authenticateToken` | — | Protégé, OK |
| `GET /api/test-notification` | 32776 | Route debug sans auth — à vérifier |

---

## Signalement — doublons de routes

| Route | Lignes | Note |
|-------|--------|------|
| `GET /api/properties` | 1923, 1928, 16856 | Les déclarations 1923–1930 sont dans un bloc de pseudo-code commenté/guide. Seule la ligne 16856 est active. Nettoyer pour éviter la confusion. |
| `GET /api/subscription/status` | Mentionnée ligne 1943 comme exemple, définie ligne 11219 et re-mentionnée ligne 27394 comme commentaire | Pas de vrai doublon fonctionnel. |

---

## À TRANCHER

1. **Auth de `GET /api/user/profile` et `PUT /api/user/profile` :** La route n'utilise pas de
   middleware Express (`authenticateToken` / `authenticateAny`) mais `getUserFromRequest` à
   l'intérieur. Un token absent retourne bien 401, mais un token invalide lève une exception
   non interceptée par Express. Comportement exact sur token expiré à vérifier en test.

2. **`POST /api/settings/notifications` ne sauvegarde que 4 champs :** Les clés `notif_*`
   granulaires (12 champs) sont lues par `getNotificationSettings` et affichées dans le GET,
   mais `saveNotificationSettings` les inclut également (lignes 3454–3465). En revanche, la
   **route POST** (ligne 12136) ne les extrait pas du body — seuls `newReservation`, `reminder`,
   `whatsappEnabled`, `whatsappNumber` sont transmis à `saveNotificationSettings`. Les 12 clés
   granulaires affichées dans le GET ne peuvent donc pas être modifiées via cette route.
   À trancher : bug ? route incomplète ? autre endpoint prévu ?

3. **`can_view_owners` :** absent de toute la base de code. La spec T4 suppose cette colonne —
   une migration sera nécessaire avant implémentation côté iOS.

4. **Plateformes connectées — nombre « actives » :** aucune route ne renvoie ce compteur prêt à
   l'emploi. L'iOS devra le calculer depuis `GET /api/properties` en comptant les logements
   avec `channexEnabled === true` OU `icalUrls.length > 0`. Ou bien implémenter une route dédiée.

5. **`GET /api/subscription/status` et sous-comptes :** utilise `req.user.id` brut (ligne 11221)
   sans redirection vers `parentUserId`. Un sous-compte appelant cette route retournera 500
   (son `id` est `null`). À corriger avant exposition iOS si les sous-comptes doivent voir
   le statut d'abonnement.

6. **`visible_kpis` :** peut arriver comme string JSON ou comme objet selon le chemin de lecture
   (le code fait un try/parse dans plusieurs endroits). L'iOS doit accepter les deux formes.

7. **`propertyCount` dans `iManage` :** arrivera comme string (résultat de `COUNT(*)` PostgreSQL
   non casté). Le code fait `parseInt(r.property_count)` avant de l'envoyer — à vérifier en test
   réel car la valeur est dans un `.map()` inline.

8. **Route `GET /api/test-notification` (ligne 32776) :** route debug sans authentification
   apparente. À vérifier et sécuriser si exposée en production.
