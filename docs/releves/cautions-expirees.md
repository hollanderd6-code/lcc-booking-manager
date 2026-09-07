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
