# Relevé — Cautions expirées (`authorized` fantômes)

Date du relevé : 2026-09-07  
Base : production (`agwgfnduxpclhnadegip`)

---

## 1. Inventaire réel (SQL lecture seule)

### Par ancienneté de l'autorisation

| Tranche | Nb cautions | Total (€) | Capturables ? |
|---------|-------------|-----------|---------------|
| < 7 jours (avec PI Stripe) | 6 | 1 650 € | Oui — PI encore valide |
| 7 à 30 jours (avec PI Stripe) | 10 | 3 000 € | Non — PI expiré côté Stripe |
| > 30 jours (avec PI Stripe) | 127 | 38 700 € | Non — PI définitivement annulé |
| > 30 jours (sans PI Stripe — manuelles) | 23 | 10 600 € | Non — jamais liées à Stripe |
| **Total** | **166** | **53 950 €** | |

> Les 144 signalés initialement correspondent aux 127 + 10 + 7 qui avaient déjà dépassé 7 jours au moment du constat. Le chiffre exact au 2026-09-07 est **166** `authorized`, dont **160 non capturables**.

### Cautions avec séjour terminé depuis > 30 jours

146 cautions, 47 500 €, checkout le plus récent : 2026-08-07.  
Autorisation la plus ancienne : 2026-05-07 (> 4 mois).

---

## 2. Comportement de `POST /api/deposits/:id/capture` sur une autorisation expirée

`captureDeposit()` (`server.js:7871`) :

```js
// server.js:7894-7898
const pi = await stripe.paymentIntents.retrieve(depositData.stripe_payment_intent_id, stripeOpts);
console.log(`PI Stripe status avant capture: ${pi.status} …`);

if (pi.status !== 'requires_capture') {
  throw new Error(`Impossible de débiter : la caution est dans l'état "${pi.status}" côté Stripe (expiré ou déjà traité)`);
}
```

Quand le PI est expiré, Stripe le renvoie avec `status: "canceled"`. La condition
`pi.status !== 'requires_capture'` est vraie → **erreur explicite levée**.

La route (`server.js:23199-23201`) attrape l'erreur et retourne HTTP 500 :
```js
res.status(500).json({ error: err.message || 'Erreur serveur' });
```

**Le statut local `deposits.status` n'est pas mis à jour.** La caution reste
`authorized` en base après l'appel échoué.

---

## 3. Le statut local `authorized` est-il jamais rafraîchi depuis Stripe ?

**Non, il n'existe aucun mécanisme actif de synchronisation.**

### Seul chemin théorique : le webhook `payment_intent.canceled`

`server.js:5663` gère l'événement Stripe `payment_intent.canceled` :

```js
// server.js:5676-5686
const isRelease = ['authorized', 'captured', 'released'].includes(prevStatus);
if (isRelease) {
  await pool.query(
    `UPDATE deposits SET status = 'released', released_at = NOW() … WHERE id = $1`,
    [depositId]
  );
}
```

Quand Stripe expire un PI `requires_capture` après 7 jours, il envoie
`payment_intent.canceled`. Ce handler mettrait bien le statut à `released`.

### Pourquoi ça n'a pas fonctionné pour 127 cautions

Il y a 127 cautions **avec** `stripe_payment_intent_id` encore `authorized`
après plus de 7 jours. Cela signifie que le webhook n'a pas mis à jour leur
statut. Causes possibles (non vérifiées ici) :

- Le webhook `payment_intent.canceled` n'était pas inscrit dans le dashboard Stripe
  à l'époque où ces cautions ont expiré.
- Des livraisons de webhook ont échoué (endpoint down, timeout) sans rejouer.
- Certains PI ont été créés sur un compte Connect sans webhook configuré
  sur ce compte.

### Cautions manuelles (sans PI Stripe)

23 cautions n'ont aucun `stripe_payment_intent_id`. Elles ne peuvent jamais
être rafraîchies automatiquement — leur statut `authorized` est purement local
et n'a aucune réalité côté Stripe.

### Aucun cron de réconciliation

Aucun `cron.schedule` dans `server.js`, `deposit-messages-cron.js` ou
`deposit-messages-scheduler.js` ne scrape les PI Stripe pour vérifier leur
état réel. `deposit-messages-cron.js` est d'ailleurs entièrement désactivé
(commentaire ligne 17 : *«  Cron J-2 désactivé — remplacé par le système de
templates »*).

---

## 4. Mécanisme de renouvellement d'autorisation avant expiration

**Il n'en existe aucun.**

- Pas d'appel à `stripe.paymentIntents.incrementAuthorization()` ou
  équivalent dans tout le code.
- Pas de cron qui détecte les PI approchant de l'expiration (J-1, J-6…) pour
  les recréer ou les prolonger.
- Le frontend (`public/`) ne propose pas d'action "renouveler".
- L'API Stripe propose `increment_authorization` pour prolonger de 7 jours,
  mais elle n'est pas utilisée ici.

---

## Synthèse des problèmes

| Problème | Impact |
|----------|--------|
| 160 cautions affichées `authorized` alors qu'elles ne le sont plus | Tableau de bord trompeur ; hôtes croient pouvoir débiter |
| Capture échoue silencieusement côté UI (HTTP 500 non traduit) | L'hôte voit une erreur sans savoir que la caution est perdue |
| Statut local jamais mis à jour après échec de capture | La caution reste `authorized` indéfiniment |
| Webhook `payment_intent.canceled` non fiable historiquement | 127 expirations non détectées |
| 23 cautions manuelles sans mécanisme d'expiration | Fantômes permanents |
| Aucun renouvellement avant J+7 | Toute caution > 7 jours non capturée est perdue sans alerte |

---

## 5. Relevé des routes — écran Séjours iOS

### 5.1 `GET /api/reservations-with-deposits` (source : `server.js:11609`)

#### Forme exacte de la réponse

Tableau JSON **nu** (pas d'enveloppe), chaque élément :

```jsonc
{
  "reservationUid":    string,          // uid de la réservation
  "propertyId":        string,
  "propertyName":      string,          // internal_name ?? name
  "startDate":         string|null,     // ISO 8601 via toISOString()
  "endDate":           string|null,     // ISO 8601
  "guestName":         string,          // = guestDisplayName (alias)
  "guestFirstName":    string,
  "guestLastName":     string,
  "guestDisplayName":  string,
  "guestPhone":        string,
  "guestEmail":        string,
  "guestCountry":      string|null,
  "occupancyAdults":   number|null,
  "occupancyChildren": number,          // 0 si absent
  "amountTotal":       number|null,     // parseFloat — jamais string
  "amountRooms":       number|null,
  "amountTaxes":       number|null,
  "amountCleaning":    number|null,
  "otaCommission":     number|null,
  // host_payout est SELECTé en SQL mais pas mappé → absent de la réponse
  "currency":          string,          // "EUR" par défaut
  "source":            string,          // ota_name ?? platform ?? source ?? "direct"
  "deposit": {
    "id":           string,
    "amountCents":  number,             // entier brut (ex: 20000 = 200 €)
    "status":       string,             // voir statuts ci-dessous
    "checkoutUrl":  string|null,
    "createdAt":    string              // ISO 8601 (sérialisé par JSON.stringify)
    // stripeSessionId : présent dans depositsMap interne, ABSENT de la réponse
  } | null
}
```

Pas de doublon camelCase/snake_case — tout est camelCase.  
Les montants numériques ne sont jamais renvoyés en string.

#### Statuts possibles de `deposit.status`

`pending` · `processing` · `authorized` · `captured` · `paid` · `released` · `cancelled` · **`auth_expired`**

Priorité de sélection quand plusieurs deposits existent pour la même résa
(`server.js:11658`) :

| Statut | Rang |
|--------|------|
| `captured` / `paid` | 5 |
| `authorized` | 4 |
| `processing` | 2 |
| `pending` | 1 |
| **`auth_expired`** *(non listé)* | **0** |

`auth_expired` a rang 0 — le plus bas. Il sera écrasé par n'importe quel autre
deposit de la même réservation, même `pending`.

#### La date d'autorisation Stripe est-elle dans la réponse ?

**Non.** Le SELECT deposits (`server.js:11641`) est :

```sql
SELECT id, reservation_uid, amount_cents, status, checkout_url,
       stripe_session_id, created_at
FROM deposits WHERE property_id = ANY($1::text[])
```

`authorized_at` est **absent** du SELECT et donc **absent de la réponse**.  
C'est la colonne clé pour savoir quand l'autorisation Stripe expire (J+7).

La colonne existe bien en base (mise à jour ligne `5215` via webhook
`payment_intent.amount_capturable_updated`). Elle peut être NULL si
l'autorisation a été créée avant l'ajout du webhook ou si celui-ci n'a pas
été livré.

**Pour détecter les cautions qui expirent dans < 48 h côté client**, il faudra
ajouter `authorized_at` au SELECT et au sous-objet `deposit` retourné. En
l'absence de `authorized_at`, `created_at` peut servir de proxy (la caution
est créée au moment de l'autorisation), mais avec un décalage possible si la
session Stripe a mis du temps à être honorée.

#### `auth_expired` remonte-t-il dans la route ?

**Partiellement.**

- Réservations **non annulées** : oui, le deposit `auth_expired` est inclus
  (rang 0 mais inclus si c'est le seul deposit de la résa).
- Réservations **annulées** : non. La route n'inclut les résas annulées que si
  elles ont un deposit `authorized` ou `captured` (`server.js:11684-11688`).
  Une résa annulée dont le seul deposit est passé à `auth_expired` disparaît
  de la liste.

#### `?agency=all` supporté ?

**Oui.** La route appelle `getAgencyUserIds(req, userId)` (`server.js:11622`),
qui retourne `[userId]` seul sauf si `req.query.agency === 'all'`, auquel cas
les comptes délégués (table `account_delegations`) sont ajoutés.

---

### 5.2 `GET /api/reservations-with-payments` (source : `server.js:11788`)

Structure quasi identique à la route deposits. Différences notables :

| Point | Valeur |
|-------|--------|
| Garde-fou auth | `requirePermission(pool, 'can_view_payments')` en plus |
| Source des réservations | `reservationsStore` en mémoire (iCal/Channex) enrichi par la DB — pas de lecture DB directe pour toutes les résas |
| Résas annulées | Non incluses (pas de clause équivalente à `cancelledWithDepCondition`) |
| Sous-objet `payment` | `{ id, amountCents, status, checkoutUrl, description, createdAt }` |
| Champs extra (path Channex seul) | `guestAddress`, `guestZip` présents pour les résas Channex absentes du store |
| Tri final | Paiements existants en premier, puis par `startDate` croissant |
| `?agency=all` | Oui, même mécanique |

**L'écran Séjours iOS a-t-il besoin de cette route ?** Probablement non si
les cautions suffisent. Cette route sert l'onglet *Paiements*, pas *Cautions*.

---

### 5.3 `GET /api/payments` (source : `server.js:11638`)

| Point | Valeur |
|-------|--------|
| Réponse | **Enveloppée** : `{ "payments": [...] }` |
| Colonnes | `SELECT *` → noms snake_case bruts depuis pg (`amount_cents`, `created_at`, `stripe_session_id`, …) |
| Filtres query | `?status=` et `?propertyId=` |
| `?agency=all` | Oui |
| Utilité pour l'écran Séjours | Non — liste plate de paiements sans lien réservation enrichi |

---

### 5.4 Ce qu'il faut ajouter pour les alertes < 48 h côté iOS

Pour que l'app puisse afficher "expire bientôt" sans requête supplémentaire,
il suffit d'ajouter deux colonnes au SELECT deposits de
`/api/reservations-with-deposits` (`server.js:11641`) :

```sql
SELECT id, reservation_uid, amount_cents, status, checkout_url,
       stripe_session_id, created_at,
       authorized_at,           -- ← date réelle d'autorisation Stripe
       stripe_session_expires_at -- ← date d'expiration de la session Checkout (pas du PI)
FROM deposits WHERE property_id = ANY($1::text[])
```

Et les exposer dans le sous-objet `deposit` retourné (`server.js:11760`) :

```js
deposit: deposit ? {
  id:                    deposit.id,
  amountCents:           deposit.amountCents,
  status:                deposit.status,
  checkoutUrl:           deposit.checkoutUrl,
  createdAt:             deposit.createdAt,
  authorizedAt:          deposit.authorizedAt,          // ← à ajouter
} : null
```

L'app calcule alors `authorizedAt + 7 jours` pour la deadline de capture, et
affiche un badge d'alerte si `deadline - now < 48 h` et `status === 'authorized'`.
