# PoC Pricing Dynamique — Boostinghost

Script de validation pour la faisabilité du scraping Airbnb via Apify.

## 🎯 Ce que fait ce PoC

1. Prend **un** de tes logements (configuré en dur dans le script)
2. Géocode l'adresse via OpenStreetMap (gratuit)
3. Lance un scraping Apify sur Airbnb — rayon 1.5 km, 90 prochains jours, prix uniquement
4. Filtre les comparables pertinents (mêmes caractéristiques que ton logement)
5. Calcule médiane, P25/P75 du marché local
6. Propose un prix recommandé contraint dans ta fourchette min/max
7. Donne un verdict **GO / À DISCUTER** sur la viabilité

## 📦 Installation (5 minutes)

```bash
# 1. Crée un dossier dédié au PoC
mkdir boostinghost-poc && cd boostinghost-poc

# 2. Place les 3 fichiers dans ce dossier :
#    - poc-apify.js
#    - .env.example
#    - README.md

# 3. Installe les deps
npm init -y
npm install dotenv
# Si Node < 18 : npm install node-fetch@2

# 4. Copie .env.example en .env et ajoute ton token Apify
cp .env.example .env
# puis édite .env et remplace APIFY_API_TOKEN=apify_api_XXXXX
```

## 🔑 Obtenir un token Apify

1. Inscription gratuite : https://apify.com/sign-up
2. Settings → Integrations → API tokens → Create token
3. Nom : `boostinghost-poc`
4. Copie le token (`apify_api_...`) dans `.env`

Le plan Free t'offre **5$ de crédit** — largement assez pour plusieurs dizaines de tests.

## 🏠 Configurer le logement à tester

Ouvre `poc-apify.js`, en tête du fichier tu trouves :

```js
const CONFIG = {
  property: {
    name: 'Studio Gare RDC',
    address: 'Cergy, France',       // ← adresse de ton logement
    type: 'studio',                  // studio / apartment / house
    bedrooms: 0,                     // 0 pour studio
    maxGuests: 2,
    currentPrice: 65,                // € par nuit actuel
    priceMin: 60,
    priceMax: 150,
  },
  ...
};
```

**Pour le premier test** : choisis un logement en **zone dense** (Paris, centre-ville),
ce sera le cas optimal. Ensuite tu testeras des zones plus difficiles pour voir les limites.

## 🚀 Lancer le PoC

```bash
node poc-apify.js
```

Attente : 30-90 secondes. Tu verras un rapport console avec :
- Nombre de comparables trouvés
- Coût réel du run
- Prix médian / P25 / P75 du marché
- Prix recommandé avec delta vs ton prix actuel
- Verdict GO / À DISCUTER

Un fichier `poc-result.json` est aussi généré pour inspection.

## 📊 Ce qu'on veut valider avec le PoC

| Critère | Seuil GO | Seuil à discuter |
|---|---|---|
| Comparables retenus | ≥ 20 | < 20 |
| Coût par run | < 0.10$ | ≥ 0.10$ |
| Durée | < 120s | ≥ 120s |
| Qualité données | Prix numériques exploitables | Prix manquants ou erratiques |

## 🔒 RGPD / données

Ce script stocke **uniquement des données anonymes et agrégées** :
prix, nb chambres, type, rating. **Aucune donnée personnelle** (nom d'hôte,
photo, URL, adresse précise) n'est persistée.

## ➡️ Après le PoC

Une fois le verdict GO validé, on enchaîne sur **Phase 2** :
- Création de la table `market_data` dans Supabase
- Cron quotidien qui scrape pour chaque logement
- Dashboard dans l'app Boostinghost
