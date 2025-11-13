# 🏠 LCC Booking Manager

Système professionnel de gestion de réservations pour locations courte durée avec synchronisation iCal automatique.

## ✨ Fonctionnalités

### 🔄 Synchronisation iCal
- ✅ Support multi-plateformes (Airbnb, Booking.com, VRBO, Abritel, etc.)
- ✅ Synchronisation automatique toutes les 15 minutes (configurable)
- ✅ Détection automatique des nouvelles réservations
- ✅ Support de plusieurs liens iCal par logement

### 📅 Calendrier Interactif
- ✅ Vue mensuelle, hebdomadaire et liste
- ✅ Calendrier moderne et élégant avec FullCalendar
- ✅ Filtrage par logement avec compteurs en temps réel
- ✅ Codes couleur personnalisés par propriété
- ✅ Détails complets au clic sur chaque réservation

### 📧 Notifications Intelligentes
- ✅ Email automatique pour chaque nouvelle réservation
- ✅ Support Slack et Discord (webhooks)
- ✅ Templates HTML élégants et professionnels
- ✅ Notifications multi-destinataires

### 📊 Statistiques & Analytics
- ✅ Tableau de bord avec métriques clés
- ✅ Statistiques par logement
- ✅ Tendances mensuelles
- ✅ Réservations à venir et en cours

### 🎨 Interface Utilisateur
- ✅ Design moderne et épuré
- ✅ Palette de couleurs premium (cuivre/bronze)
- ✅ Responsive (mobile, tablette, desktop)
- ✅ Animations fluides et élégantes
- ✅ Toasts de notification
- ✅ Raccourcis clavier

## 🚀 Installation

### Prérequis

- Node.js 16+ et npm
- Accès aux URLs iCal de vos plateformes de réservation
- (Optionnel) Compte Gmail pour les notifications email

### Étapes d'installation

1. **Copier les fichiers dans votre projet**
   ```bash
   # Le dossier lcc-booking-manager contient tout le nécessaire
   cd lcc-booking-manager
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configurer les variables d'environnement**
   ```bash
   # Copier le fichier d'exemple
   cp .env.example .env
   
   # Éditer .env avec vos informations
   nano .env
   ```

4. **Configuration minimale (.env)**
   ```env
   PORT=3000
   
   # URLs iCal de vos logements
   SAINT_GRATIEN_ICAL_URL=https://www.airbnb.fr/calendar/ical/xxxxx.ics
   MONTMORENCY_ICAL_URL=https://www.airbnb.fr/calendar/ical/xxxxx.ics
   
   # Configuration email (pour notifications)
   EMAIL_SERVICE=gmail
   EMAIL_USER=votre.email@gmail.com
   EMAIL_PASSWORD=votre_mot_de_passe_app
   NOTIFICATION_EMAIL=votre.email@gmail.com
   
   # Intervalle de synchronisation (en minutes)
   SYNC_INTERVAL=15
   ```

5. **Lancer le serveur**
   ```bash
   npm start
   ```

6. **Ouvrir l'interface**
   ```
   Ouvrez votre navigateur: http://localhost:3000
   ```

## 📝 Configuration Détaillée

### Obtenir les URLs iCal

#### Airbnb
1. Connectez-vous à votre compte Airbnb
2. Accédez à votre calendrier
3. Cliquez sur "Disponibilité" → "Synchroniser le calendrier"
4. Copiez le lien "Exporter le calendrier"

#### Booking.com
1. Connectez-vous à l'extranet Booking.com
2. Allez dans "Calendrier" → "Synchronisation"
3. Copiez l'URL du calendrier iCal

### Configuration Email (Gmail)

1. **Activer l'authentification à deux facteurs**
   - Allez dans les paramètres de sécurité Google
   - Activez la validation en deux étapes

2. **Générer un mot de passe d'application**
   - Accédez à https://myaccount.google.com/apppasswords
   - Créez un nouveau mot de passe pour "Autre (nom personnalisé)"
   - Utilisez ce mot de passe dans `EMAIL_PASSWORD`

### Webhooks (Optionnel)

#### Slack
```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX
```

#### Discord
```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/abcdefghijklmnop
```

## 🎯 Utilisation

### Interface Web

1. **Calendrier Principal**
   - Visualisez toutes vos réservations
   - Basculez entre vue mois/semaine/liste
   - Filtrez par logement
   - Cliquez sur une réservation pour voir les détails

2. **Synchronisation**
   - Cliquez sur l'icône de synchronisation (↻) en haut à droite
   - La synchronisation automatique s'exécute toutes les 15 minutes

3. **Statistiques**
   - Cliquez sur l'icône graphique (📊)
   - Consultez les métriques par logement et par mois

4. **Filtres**
   - Cliquez sur les badges de logements pour filtrer
   - Les compteurs se mettent à jour automatiquement

### API REST

Le système expose également une API REST pour intégration :

#### GET /api/reservations
Récupère toutes les réservations
```bash
curl http://localhost:3000/api/reservations
```

#### GET /api/reservations/:propertyId
Réservations d'un logement spécifique
```bash
curl http://localhost:3000/api/reservations/saint-gratien
```

#### POST /api/sync
Force la synchronisation
```bash
curl -X POST http://localhost:3000/api/sync
```

#### GET /api/stats
Récupère les statistiques
```bash
curl http://localhost:3000/api/stats
```

#### GET /api/availability/:propertyId
Vérifie la disponibilité
```bash
curl "http://localhost:3000/api/availability/saint-gratien?startDate=2024-12-01&endDate=2024-12-07"
```

## 🎨 Personnalisation

### Couleurs des Logements

Modifiez dans `server.js` :
```javascript
const PROPERTIES = [
  {
    id: 'saint-gratien',
    name: 'Saint-Gratien',
    color: '#E67E50', // Changez cette couleur
    // ...
  }
];
```

### Intervalle de Synchronisation

Dans `.env` :
```env
SYNC_INTERVAL=15  # En minutes
```

### Ajouter un Nouveau Logement

1. Dans `.env`, ajoutez :
   ```env
   NOUVEAU_LOGEMENT_ICAL_URL=https://...
   ```

2. Dans `server.js`, ajoutez dans PROPERTIES :
   ```javascript
   {
     id: 'nouveau-logement',
     name: 'Nouveau Logement',
     color: '#9B59B6',
     icalUrls: [
       process.env.NOUVEAU_LOGEMENT_ICAL_URL
     ].filter(Boolean)
   }
   ```

## 🔧 Maintenance

### Logs

Les logs s'affichent dans la console du serveur :
```bash
npm start

# Vous verrez :
🚀 Serveur démarré sur http://localhost:3000
🔄 Démarrage de la synchronisation iCal...
✅ Saint-Gratien: 12 réservations synchronisées
✅ Montmorency: 8 réservations synchronisées
```

### Résolution de Problèmes

#### Erreur "Unable to fetch iCal"
- Vérifiez que les URLs iCal sont correctes et accessibles
- Testez les URLs directement dans votre navigateur

#### Emails non reçus
- Vérifiez votre configuration Gmail (mot de passe d'application)
- Vérifiez les spam/courrier indésirable
- Testez avec : `POST /api/test-notification`

#### Synchronisation ne fonctionne pas
- Vérifiez que `SYNC_INTERVAL` est défini
- Redémarrez le serveur
- Forcez une synchronisation manuelle via l'interface

## 📦 Structure du Projet

```
lcc-booking-manager/
├── server.js                 # Serveur Express principal
├── services/
│   ├── icalService.js       # Gestion des calendriers iCal
│   └── notificationService.js # Système de notifications
├── public/
│   ├── index.html           # Interface utilisateur
│   ├── css/
│   │   └── style.css        # Styles personnalisés
│   └── js/
│       └── app.js           # Logique frontend
├── package.json
├── .env.example
└── README.md
```

## 🌟 Fonctionnalités Avancées

### Extraction Intelligente de Données
- Nom du voyageur
- Email et téléphone (si disponibles)
- ID de réservation
- Plateforme source
- Nombre de nuits

### Détection de Doublons
- Utilise les UID uniques pour éviter les doublons
- Fusionne les réservations de plusieurs sources

### Gestion du Fuseau Horaire
- Support complet des fuseaux horaires
- Configuration via `TIMEZONE` dans .env

## 🚀 Déploiement en Production

### Avec PM2 (recommandé)

1. Installer PM2
   ```bash
   npm install -g pm2
   ```

2. Lancer l'application
   ```bash
   pm2 start server.js --name lcc-booking-manager
   pm2 save
   pm2 startup
   ```

### Avec Docker (optionnel)

Créez un `Dockerfile` :
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## 📞 Support

Pour toute question ou problème :
- Consultez les logs serveur
- Vérifiez votre configuration .env
- Testez les URLs iCal manuellement

## 📄 Licence

MIT - La Conciergerie de Charles

## 🎉 Fonctionnalités à Venir

- [ ] Export PDF des réservations
- [ ] Envoi automatique des instructions d'arrivée
- [ ] Intégration calendrier Google
- [ ] Dashboard analytics avancé
- [ ] Application mobile
- [ ] Multi-utilisateurs avec rôles

---

**Développé avec ❤️ pour La Conciergerie de Charles**
