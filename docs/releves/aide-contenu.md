# Relevé — Contenu de `public/help.html`

> Lecture seule, septembre 2026.  
> Objectif : porter le contenu aide dans l'app iOS en le rendant lisible sur mobile.

---

## 1. Structure de la page

La page comporte **six sections** dans l'ordre d'affichage :

| # | Section | ID HTML | Source du contenu |
|---|---------|---------|-------------------|
| 1 | Questions fréquentes (FAQ) | `#faqList` | **En dur dans le HTML** |
| 2 | Vidéos tutoriels | `#tutorialGrid` | **En dur dans le HTML** (7 vidéos YouTube) |
| 3 | Guides interactifs | `#guidesGrid` | **En dur dans le HTML** (liens vers 4 pages annotées) |
| 4 | Roadmap & suggestions | `#roadmapSection` | **Dynamique** — API `/api/roadmap` |
| 5 | Démarrage accompagné | `#rdvSection` | **Embed externe** — iframe Calendly |
| 6 | Contacter le support | `#supportSection` | **Dynamique** — API `/api/support/…` + Socket.IO |

---

## 2. Contenu section par section

### 2.1 FAQ — Questions fréquentes

Dix questions accordéon, **toutes codées en dur dans le HTML** (aucune base, aucun fichier externe). Recherche plein texte en JS côté client. Voici les dix questions avec leur réponse complète :

---

**Q1 — Comment synchroniser mon calendrier Airbnb / Booking ?**  
La synchronisation se fait via **Channex**, notre gestionnaire de channels intégré. Depuis la page **Logements**, cliquez sur **« Connecter Airbnb · Booking · Expedia »** sur le logement concerné. Une fenêtre s'ouvre pour connecter vos comptes OTA directement — les réservations et disponibilités se synchronisent alors en temps réel.

---

**Q2 — Comment créer un contrat de séjour et l'envoyer à mon voyageur ?**  
Depuis le menu **Contrats**, cliquez sur « Nouveau contrat », remplissez les informations du séjour, puis envoyez le lien de signature par e-mail au voyageur. Il peut signer directement depuis son téléphone.

---

**Q3 — Comment envoyer un livret d'accueil à mon voyageur ?**  
Dans **Livrets d'accueil**, sélectionnez votre logement, personnalisez votre livret, puis copiez le lien public ou envoyez-le directement par e-mail depuis l'application.

---

**Q4 — Comment ajouter une personne de ménage et lui assigner des tâches ?**  
Dans la section **Ménages**, ajoutez votre cleaner avec son nom et son numéro. Vous pouvez ensuite lui assigner automatiquement les départs de chaque réservation. Si elle a un compte dans l'app, liez-le pour qu'elle reçoive des notifications push.

---

**Q5 — Comment créer un sous-compte pour mon équipe ?**  
Dans **Paramètres du compte**, section « Sous-comptes », invitez un membre de votre équipe par e-mail. Vous pouvez définir précisément ses permissions (voir les réservations, gérer les ménages, accéder aux finances…).

---

**Q6 — Comment encaisser une caution et la restituer ?**  
Dans la section **Finances**, créez une demande de caution pour votre voyageur. Il règle en ligne par carte bancaire. Après le séjour, restituez la caution en un clic ou retenez le montant souhaité si nécessaire.

---

**Q7 — Comment générer une facture pour un propriétaire ?**  
Dans **Factures propriétaires**, sélectionnez le logement et la période, puis générez la facture en un clic. Elle est envoyée automatiquement par e-mail au propriétaire au format PDF.

---

**Q8 — L'application mobile est-elle disponible sur iOS et Android ?**  
Oui, Boostinghost est disponible sur **iOS** (App Store) et **Android** (Play Store). Votre équipe peut aussi utiliser l'app dédiée aux prestataires pour recevoir les notifications de ménage en temps réel.

---

**Q9 — Mon abonnement est-il sans engagement ?**  
Oui, tous les abonnements Boostinghost sont **sans engagement**. Vous pouvez résilier à tout moment depuis les paramètres de votre compte, sans frais.

---

**Q10 — Je n'arrive pas à me connecter, que faire ?**  
Vérifiez que vous utilisez bien l'adresse e-mail avec laquelle vous avez créé votre compte. Si vous avez oublié votre mot de passe, utilisez le lien **« Mot de passe oublié »** sur la page de connexion. Si le problème persiste, contactez le support via le chat ci-dessous.

---

### 2.2 Vidéos tutoriels

Sept vidéos YouTube codées en dur (vignettes `img.youtube.com`, lecture dans une modale iframe). Chaque carte : miniature 16/9, titre, bouton play.

| # | ID YouTube | Titre affiché |
|---|-----------|---------------|
| 1 | `073xIs5qnV4` | Boostinghost : créer votre compte en 2 minutes — Tutoriel complet |
| 2 | `HWUy3iOA81Y` | Tutoriel complet : Calendrier, Réservations & KPI |
| 3 | `L_A5YDiUlWI` | Créez un livret d'accueil professionnel en 5 minutes |
| 4 | `CKKQihkb0E8` | Contrat de location avec signature électronique |
| 5 | `4FFeBhJTUjY` | Messages automatiques & SMS par logement |
| 6 | `JsihaZJTI1o` | Comment ajouter vos logements sur Boostinghost |
| 7 | `uSAUyaousDY` | Comment envoyer un lien BHGuest à vos voyageurs ? (et bloquer les dates automatiquement) |

### 2.3 Guides interactifs

Quatre guides illustrés (pages annotées séparées, toutes existantes dans `public/`).

| Guide | Fichier cible | Durée / étapes | Thème |
|-------|--------------|----------------|-------|
| Calendrier des réservations | `tuto-calendrier-annotator.html` | 5 min · 10 étapes | 4 vues, recherche, actions rapides, édition groupée, taux d'occupation |
| Messages automatiques | `tuto-messages-annotator.html` | 5 min | Templates, conditions d'envoi, messagerie voyageurs (Airbnb · Booking · Direct) |
| Connecter Airbnb | `tuto-connecter-airbnb-annotator.html` | 3 min · 9 étapes | Synchronisation canal, mapping annonces |
| BHGuest — Réservations directes | `tuto-bhguest-annotator.html` | 4 min | Liens de réservation, holds, paiements directs |

### 2.4 Roadmap & suggestions

Contenu **entièrement dynamique** (`GET /api/roadmap`, authentifié). Les items affichent :
- Statut (En réflexion · En cours · Disponible) avec filtres
- Votes pouce haut/bas par utilisateur (`POST /api/roadmap/:id/vote`)
- Formulaire de suggestion (`POST /api/roadmap/suggest`)

Rien à porter statiquement — cette section nécessite un appel API authentifié.

### 2.5 Démarrage accompagné

Iframe Calendly pleine largeur (600 px de haut) :  
`https://calendly.com/boostinghost/demarrage-accompagne`

Session 45 min, gratuite, incluse dans tous les plans. Problématique sur mobile natif : les iframes Calendly ne fonctionnent pas dans WKWebView iOS sans autorisation explicite et se comportent mal si la vue est contrainte en hauteur.

### 2.6 Chat support

Entièrement dynamique. Fonctionnement :
- Chargement de l'historique des conversations (`GET /api/support/conversations`)
- Ouverture ou création d'une conversation (`POST /api/support/conversation/new`)
- Messages en temps réel via Socket.IO (`join_support`, event `support_message`)
- Upload d'images (`POST /api/support/upload`)
- Statut du support affiché dynamiquement selon l'heure de Paris :
  - Lun–Ven 9h–18h → « En ligne »
  - Sam 10h–12h → « En ligne »
  - Dim 14h–16h → « En ligne »
  - Reste du temps → « Hors ligne »

---

## 3. Source du contenu — synthèse

| Contenu | Source | Implication pour l'app iOS |
|---------|--------|---------------------------|
| FAQ (10 Q/R) | En dur HTML | À dupliquer — décider où il vivra (JSON, Markdown, ou en dur dans le code natif) |
| Vidéos YouTube (7) | En dur HTML (IDs) | Peut pointer vers YouTube directement ; la modale iframe est à remplacer par `SFSafariViewController` ou `WKWebView` |
| Guides interactifs (4) | Liens vers des pages HTML annotées | Ces pages sont des WebViews — les charger dans une `WKWebView` ou les réécrire en natif |
| Roadmap | API REST | Appels API identiques à la WebApp — fonctionne nativement |
| Calendly | Iframe externe | `SFSafariViewController` recommandé ; l'iframe inline ne marche pas bien dans WKWebView |
| Chat support | API REST + Socket.IO | Socket.IO fonctionne via WebSocket dans iOS — à tester sur réseau cellulaire |

---

## 4. Médias externes et dépendances

- **YouTube** — 7 vidéos ; miniatures servies par `img.youtube.com` ; lecture via `https://www.youtube.com/embed/<id>?autoplay=1`
- **Calendly** — embed `https://calendly.com/boostinghost/demarrage-accompagne`
- **Google Fonts** — DM Sans + Instrument Serif (chargés depuis `fonts.googleapis.com`)
- **Font Awesome 6.5.1** — CDN `cdnjs.cloudflare.com`
- **Socket.IO 4.7.2** — CDN `cdn.socket.io`
- Aucune capture d'écran statique dans la page aide elle-même (les captures sont dans les pages `tuto-*-annotator.html`)

---

## 5. Contenu potentiellement périmé ou trompeur

### ⚠️ Q5 — « section Sous-comptes »
La FAQ dit *« section « Sous-comptes » »*. Dans `settings-account.html` la section s'appelle **« Équipe & Accès »** (libellé `line 1321`). Terme incorrect dans la FAQ — risque de dérouter l'utilisateur.

### ⚠️ Q6 — « Dans la section Finances »
La page cautions s'appelle **« Cautions & Paiements »** (`deposits.html`, `data-title="Cautions & Paiements"`). La FAQ dit « Finances » — rubrique qui n'existe pas sous ce nom dans la navigation.

### ⚠️ Q7 — Factures propriétaires
La FAQ décrit un flux simplifié en « un clic » avec envoi PDF automatique. Les commits récents (`b605e308`, `31af9fb5`, `2a72ec38`, `a77bf81`) montrent que le module facturation a considérablement évolué : numérotation verrouillée en concurrence, route `send-to-conversation`, stockage `conversationId+reservationUid`, scoping par propriétaire de logement. La réponse FAQ est fonctionnellement vraie dans les grandes lignes mais passe sous silence plusieurs étapes (finalisation, envoi vers conversation, avoirs). **Pas fausse, mais simplifiée à l'excès.**

### ✅ Q1 — Channex / synchronisation OTA
Toujours d'actualité ; les routes Channex sont actives.

### ✅ Q2 — Contrats / signature électronique
Vidéo tutorielle existante (`CKKQihkb0E8`) — fonctionnalité confirmée présente.

### ✅ Q8 — App iOS / Android
Exact — projet Capacitor confirmé (`capacitor.config.json`).

---

## 6. Recommandations pour le portage iOS

1. **FAQ** : extraire les 10 Q/R dans un fichier JSON ou un tableau Swift — contenu court, pas de rendu HTML complexe. Corriger les libellés périmés (Q5 → « Équipe & Accès », Q6 → « Cautions & Paiements ») au passage.
2. **Vidéos** : afficher les miniatures YouTube en natif (requête HTTP simple) ; ouvrir la lecture dans `SFSafariViewController` — évite les problèmes d'autoplay dans WKWebView.
3. **Guides interactifs** : les pages `tuto-*-annotator.html` sont des WebViews statiques — les servir directement dans `WKWebView` est la voie la plus rapide. Vérifier qu'elles ont un CSS responsive correct.
4. **Roadmap** : même API que la WebApp — aucune adaptation nécessaire hormis l'UI.
5. **Calendly** : remplacer l'iframe par un bouton « Prendre RDV » ouvrant `SFSafariViewController` avec l'URL Calendly.
6. **Chat support** : Socket.IO fonctionne dans WKWebView et en natif via URLSession/WebSocket. L'upload image est à adapter (`UIImagePickerController` → `multipart/form-data`).
