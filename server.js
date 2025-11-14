require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs').promises;
const icalService = require('./services/icalService');
const notificationService = require('./services/notificationService');
const messagingService = require('./services/messagingService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));


// Store for reservations
let reservationsStore = {
  properties: {},
  lastSync: null,
  syncStatus: 'idle'
};

// Configuration file path
const CONFIG_FILE = path.join(__dirname, 'properties-config.json');
// Users file path
// Users file path
const USERS_FILE = path.join(__dirname, 'users-config.json');
let USERS = [];

// Welcome data file path
const WELCOME_FILE = path.join(__dirname, 'welcome-config.json');
let WELCOME_DATA = []; // { userId, data: {...} } par utilisateur

async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    USERS = JSON.parse(data);
    console.log('✅ Utilisateurs chargés depuis users-config.json');
  } catch (error) {
    USERS = [];
    console.log('⚠️  Aucun fichier users-config.json, démarrage avec 0 utilisateur');
  }
}

async function saveUsers() {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(USERS, null, 2));
    console.log('✅ Utilisateurs sauvegardés');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des utilisateurs:', error.message);
  }
}

async function loadWelcomeData() {
  try {
    const data = await fs.readFile(WELCOME_FILE, 'utf8');
    WELCOME_DATA = JSON.parse(data);
    console.log('✅ Données livret chargées depuis welcome-config.json');
  } catch (error) {
    WELCOME_DATA = [];
    console.log('⚠️  Aucun fichier welcome-config.json, démarrage sans livret');
  }
}

async function saveWelcomeData() {
  try {
    await fs.writeFile(WELCOME_FILE, JSON.stringify(WELCOME_DATA, null, 2));
    console.log('✅ Données livret sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde du livret:', error.message);
  }
}

function generateToken(user) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return jwt.sign(
    { id: user.id, email: user.email },
    secret,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

// Load properties from config file or use defaults
let PROPERTIES = [];


// Load properties from config file or use defaults
let PROPERTIES = [];

async function loadProperties() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    PROPERTIES = JSON.parse(data);
    console.log('✅ Configuration chargée depuis properties-config.json');
  } catch (error) {
    // Si le fichier n'existe pas, utiliser la config par défaut depuis .env
    PROPERTIES = [
      {
        id: 'saint-gratien-1',
        name: 'Saint-Gratien - Logement RDC',
        color: '#E67E50',
        icalUrls: [
          process.env.SAINT_GRATIEN_1_AIRBNB_URL,
          process.env.SAINT_GRATIEN_1_BOOKING_URL
        ].filter(Boolean)
      },
      {
        id: 'saint-gratien-2',
        name: 'Saint-Gratien - Logement ETG',
        color: '#D4754A',
        icalUrls: [
          process.env.SAINT_GRATIEN_2_AIRBNB_URL,
          process.env.SAINT_GRATIEN_2_BOOKING_URL
        ].filter(Boolean)
      },
      {
        id: 'montmorency',
        name: 'Montmorency',
        color: '#B87A5C',
        icalUrls: [
          process.env.MONTMORENCY_AIRBNB_URL,
          process.env.MONTMORENCY_BOOKING_URL
        ].filter(Boolean)
      },
      {
        id: 'bessancourt',
        name: 'Bessancourt',
        color: '#8B7355',
        icalUrls: [
          process.env.BESSANCOURT_AIRBNB_URL,
          process.env.BESSANCOURT_BOOKING_URL
        ].filter(Boolean)
      },
      {
        id: 'frepillon',
        name: 'Frépillon',
        color: '#A0826D',
        icalUrls: [
          process.env.FREPILLON_AIRBNB_URL,
          process.env.FREPILLON_BOOKING_URL
        ].filter(Boolean)
      }
    ];
    console.log('⚠️  Utilisation de la configuration par défaut (.env)');
  }
}

async function saveProperties() {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(PROPERTIES, null, 2));
    console.log('✅ Configuration sauvegardée dans properties-config.json');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde:', error.message);
  }
}

// Fonction de synchronisation
async function syncAllCalendars() {
  console.log('🔄 Démarrage de la synchronisation iCal...');
  reservationsStore.syncStatus = 'syncing';
  
  const newReservations = [];
  
  for (const property of PROPERTIES) {
    if (property.icalUrls.length === 0) {
      console.log(`⚠️  Aucune URL iCal configurée pour ${property.name}`);
      continue;
    }
    
    try {
      const reservations = await icalService.fetchReservations(property);
      
      // Détecter les nouvelles réservations
      const oldReservations = reservationsStore.properties[property.id] || [];
      const oldIds = new Set(oldReservations.map(r => r.uid));
      
      const trulyNewReservations = reservations.filter(r => !oldIds.has(r.uid));
      
      if (trulyNewReservations.length > 0) {
        newReservations.push(...trulyNewReservations.map(r => ({
          ...r,
          propertyName: property.name,
          propertyColor: property.color
        })));
      }
      
      reservationsStore.properties[property.id] = reservations;
      console.log(`✅ ${property.name}: ${reservations.length} réservations synchronisées`);
      
    } catch (error) {
      console.error(`❌ Erreur lors de la synchronisation de ${property.name}:`, error.message);
    }
  }
  
  reservationsStore.lastSync = new Date();
  reservationsStore.syncStatus = 'idle';
  
  // Envoyer notifications pour nouvelles réservations
  if (newReservations.length > 0) {
    console.log(`📧 ${newReservations.length} nouvelle(s) réservation(s) détectée(s)`);
    await notificationService.sendNewBookingNotifications(newReservations);
  }
  
  console.log('✅ Synchronisation terminée');
  return reservationsStore;
}

// ============================================
// ROUTES API - RESERVATIONS
// ============================================

app.get('/api/reservations', (req, res) => {
  const allReservations = [];
  
  PROPERTIES.forEach(property => {
    const propertyReservations = reservationsStore.properties[property.id] || [];
    propertyReservations.forEach(reservation => {
      allReservations.push({
        ...reservation,
        property: {
          id: property.id,
          name: property.name,
          color: property.color
        }
      });
    });
  });
  
  res.json({
    reservations: allReservations,
    lastSync: reservationsStore.lastSync,
    syncStatus: reservationsStore.syncStatus,
    properties: PROPERTIES.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      count: (reservationsStore.properties[p.id] || []).length
    }))
  });
});

app.get('/api/reservations/:propertyId', (req, res) => {
  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId);
  
  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }
  
  const reservations = reservationsStore.properties[propertyId] || [];
  
  res.json({
    property: {
      id: property.id,
      name: property.name,
      color: property.color
    },
    reservations,
    count: reservations.length
  });
});

app.post('/api/sync', async (req, res) => {
  if (reservationsStore.syncStatus === 'syncing') {
    return res.status(409).json({ 
      error: 'Synchronisation déjà en cours',
      status: 'syncing'
    });
  }
  
  try {
    const result = await syncAllCalendars();
    res.json({
      message: 'Synchronisation réussie',
      lastSync: result.lastSync,
      properties: PROPERTIES.map(p => ({
        id: p.id,
        name: p.name,
        count: (result.properties[p.id] || []).length
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Erreur lors de la synchronisation',
      details: error.message 
    });
  }
});

app.get('/api/stats', (req, res) => {
  const stats = {
    totalReservations: 0,
    upcomingReservations: 0,
    currentReservations: 0,
    byProperty: {},
    byMonth: {}
  };
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  PROPERTIES.forEach(property => {
    const reservations = reservationsStore.properties[property.id] || [];
    stats.totalReservations += reservations.length;
    
    const upcoming = reservations.filter(r => new Date(r.start) > now).length;
    const current = reservations.filter(r => 
      new Date(r.start) <= now && new Date(r.end) >= now
    ).length;
    
    stats.upcomingReservations += upcoming;
    stats.currentReservations += current;
    
    stats.byProperty[property.id] = {
      name: property.name,
      total: reservations.length,
      upcoming,
      current
    };
    
    reservations.forEach(r => {
      const month = new Date(r.start).toISOString().slice(0, 7);
      stats.byMonth[month] = (stats.byMonth[month] || 0) + 1;
    });
  });
  
  res.json(stats);
});

app.get('/api/availability/:propertyId', (req, res) => {
  const { propertyId } = req.params;
  const { startDate, endDate } = req.query;
  
  const property = PROPERTIES.find(p => p.id === propertyId);
  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }
  
  const reservations = reservationsStore.properties[propertyId] || [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const overlappingReservations = reservations.filter(r => {
    const rStart = new Date(r.start);
    const rEnd = new Date(r.end);
    return (rStart <= end && rEnd >= start);
  });
  
  res.json({
    property: {
      id: property.id,
      name: property.name
    },
    period: { start: startDate, end: endDate },
    available: overlappingReservations.length === 0,
    overlappingReservations
  });
});

// ============================================
// ROUTES API - GESTION DES LOGEMENTS
// ============================================
function getUserFromRequest(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const payload = jwt.verify(token, secret);
    const user = USERS.find(u => u.id === payload.id);
    return user || null;
  } catch (err) {
    return null;
  }
}
// ============================================
// ROUTES API - LIVRET D'ACCUEIL
// ============================================

function defaultWelcomeData(user) {
  return {
    propertyName: '',
    address: '',
    accessCode: '',
    accessInstructions: '',
    emergencyPhone: '',
    wifiName: '',
    wifiPassword: '',
    wifiNote: '',
    generalNotes: '',
    restaurants: [], // { name, type, address, notes }
    shops: [],       // { name, type, address, notes }
    photos: []       // { id, label, dataUrl }
  };
}

// GET - Récupérer les infos de livret pour l'utilisateur courant
app.get('/api/welcome', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  let entry = WELCOME_DATA.find(w => w.userId === user.id);
  if (!entry) {
    entry = { userId: user.id, data: defaultWelcomeData(user) };
    WELCOME_DATA.push(entry);
  }

  res.json(entry.data);
});

// POST - Sauvegarder les infos de livret
app.post('/api/welcome', async (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const payload = req.body || {};

  let entry = WELCOME_DATA.find(w => w.userId === user.id);
  if (!entry) {
    entry = { userId: user.id, data: defaultWelcomeData(user) };
    WELCOME_DATA.push(entry);
  }

  entry.data = {
    ...defaultWelcomeData(user),
    ...payload
  };

  await saveWelcomeData();

  res.json({
    message: 'Livret sauvegardé',
    data: entry.data
  });
});

// GET - Liste des logements
app.get('/api/properties', (req, res) => {
  res.json({
    properties: PROPERTIES.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      icalUrls: p.icalUrls.map(url => ({
        url,
        source: icalService.extractSource ? icalService.extractSource(url) : 'Inconnu'
      })),
      reservationCount: (reservationsStore.properties[p.id] || []).length
    }))
  });
});

// GET - Détails d'un logement
app.get('/api/properties/:propertyId', (req, res) => {
  const { propertyId } = req.params;
  const property = PROPERTIES.find(p => p.id === propertyId);
  
  if (!property) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }
  
  res.json({
    id: property.id,
    name: property.name,
    color: property.color,
    icalUrls: property.icalUrls,
    reservationCount: (reservationsStore.properties[property.id] || []).length
  });
});

// POST - Créer un nouveau logement
app.post('/api/properties', async (req, res) => {
  const { name, color, icalUrls } = req.body;
  
  if (!name || !color) {
    return res.status(400).json({ error: 'Nom et couleur requis' });
  }
  
  const id = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  if (PROPERTIES.find(p => p.id === id)) {
    return res.status(409).json({ error: 'Un logement avec cet identifiant existe déjà' });
  }
  
  const newProperty = {
    id,
    name,
    color,
    icalUrls: icalUrls || []
  };
  
  PROPERTIES.push(newProperty);
  await saveProperties();
  
  res.status(201).json({
    message: 'Logement créé avec succès',
    property: newProperty
  });
});

// PUT - Modifier un logement
app.put('/api/properties/:propertyId', async (req, res) => {
  const { propertyId } = req.params;
  const { name, color, icalUrls } = req.body;
  
  const propertyIndex = PROPERTIES.findIndex(p => p.id === propertyId);
  
  if (propertyIndex === -1) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }
  
  if (name) PROPERTIES[propertyIndex].name = name;
  if (color) PROPERTIES[propertyIndex].color = color;
  if (icalUrls !== undefined) PROPERTIES[propertyIndex].icalUrls = icalUrls;
  
  await saveProperties();
  
  res.json({
    message: 'Logement modifié avec succès',
    property: PROPERTIES[propertyIndex]
  });
});

// DELETE - Supprimer un logement
app.delete('/api/properties/:propertyId', async (req, res) => {
  const { propertyId } = req.params;
  
  const propertyIndex = PROPERTIES.findIndex(p => p.id === propertyId);
  
  if (propertyIndex === -1) {
    return res.status(404).json({ error: 'Logement non trouvé' });
  }
  
  const deletedProperty = PROPERTIES.splice(propertyIndex, 1)[0];
  delete reservationsStore.properties[propertyId];
  
  await saveProperties();
  
  res.json({
    message: 'Logement supprimé avec succès',
    property: deletedProperty
  });
});

// POST - Tester une URL iCal
app.post('/api/properties/test-ical', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL requise' });
  }
  
  try {
    const testProperty = {
      id: 'test',
      name: 'Test',
      color: '#000000',
      icalUrls: [url]
    };
    
    const reservations = await icalService.fetchReservations(testProperty);
    
    res.json({
      success: true,
      message: 'URL iCal valide',
      reservationCount: reservations.length,
      sampleReservation: reservations[0] || null
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'URL iCal invalide ou inaccessible',
      details: error.message
    });
  }
});

// POST - Test notification
app.post('/api/test-notification', async (req, res) => {
  try {
    await notificationService.sendTestNotification();
    res.json({ message: 'Notification de test envoyée' });
  } catch (error) {
    res.status(500).json({ 
      error: 'Erreur lors de l\'envoi de la notification',
      details: error.message 
    });
  }
});

// GET - Configuration
app.get('/api/config', (req, res) => {
  res.json({
    properties: PROPERTIES.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      hasIcalUrls: p.icalUrls.length > 0
    })),
    syncInterval: process.env.SYNC_INTERVAL || 15,
    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD),
    timezone: process.env.TIMEZONE || 'Europe/Paris'
  });
});
// ============================================
// ROUTES API - AUTH
// ============================================

// Création de compte
app.post('/api/auth/register', async (req, res) => {
  try {
    const { company, firstName, lastName, email, password } = req.body;

    if (!company || !firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    const existing = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = `u_${Date.now().toString(36)}`;

    const user = {
      id,
      company,
      firstName,
      lastName,
      email,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    USERS.push(user);
    await saveUsers();

    const token = generateToken(user);

    res.json({
      user: publicUser(user),
      token
    });
  } catch (err) {
    console.error('Erreur register:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const user = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = generateToken(user);

    res.json({
      user: publicUser(user),
      token
    });
  } catch (err) {
    console.error('Erreur login:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Récupérer l’utilisateur courant depuis un token
app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const payload = jwt.verify(token, secret);
    const user = USERS.find(u => u.id === payload.id);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    res.json({ user: publicUser(user) });
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
});

// ============================================
// DÉMARRAGE
// ============================================
// ============================================
// ROUTES API - MESSAGES
// ============================================

// GET - Templates de messages
app.get('/api/messages/templates', (req, res) => {
  res.json({
    templates: messagingService.MESSAGE_TEMPLATES
  });
});

// POST - Générer un message
app.post('/api/messages/generate', (req, res) => {
  const { reservationUid, templateKey } = req.body;
  
  if (!reservationUid || !templateKey) {
    return res.status(400).json({ error: 'reservationUid et templateKey requis' });
  }
  
  // Trouver la réservation
  let reservation = null;
  for (const propertyId in reservationsStore.properties) {
    const found = reservationsStore.properties[propertyId].find(r => r.uid === reservationUid);
    if (found) {
      reservation = found;
      break;
    }
  }
  
  if (!reservation) {
    return res.status(404).json({ error: 'Réservation non trouvée' });
  }
  
  // Données personnalisées par logement (à adapter)
  const customData = {
    propertyAddress: 'Adresse du logement à définir',
    accessCode: 'Code à définir'
  };
  
  const message = messagingService.generateQuickMessage(reservation, templateKey, customData);
  
  if (!message) {
    return res.status(404).json({ error: 'Template non trouvé' });
  }
  
  res.json(message);
});

// GET - Arrivées/Départs à venir
app.get('/api/messages/upcoming', (req, res) => {
  const allReservations = [];
  
  PROPERTIES.forEach(property => {
    const propertyReservations = reservationsStore.properties[property.id] || [];
    propertyReservations.forEach(reservation => {
      allReservations.push({
        ...reservation,
        property: {
          id: property.id,
          name: property.name,
          color: property.color
        }
      });
    });
  });
  
  res.json({
    checkinsToday: messagingService.getUpcomingCheckIns(allReservations, 0),
    checkinsTomorrow: messagingService.getUpcomingCheckIns(allReservations, 1),
    checkinsIn3Days: messagingService.getUpcomingCheckIns(allReservations, 3),
    checkinsIn7Days: messagingService.getUpcomingCheckIns(allReservations, 7),
    currentStays: messagingService.getCurrentStays(allReservations),
    checkoutsToday: messagingService.getUpcomingCheckOuts(allReservations, 0)
  });
});
app.listen(PORT, async () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🏠 LCC Booking Manager - Système de Réservations    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log('📅 Interface web disponible');
  console.log('');
  
    // Charger la configuration
  await loadProperties();
  await loadUsers();
  await loadWelcomeData();
  
  console.log('Logements configurés:');
  PROPERTIES.forEach(p => {
    const status = p.icalUrls.length > 0 ? '✅' : '⚠️';
    console.log(`  ${status} ${p.name} (${p.icalUrls.length} source${p.icalUrls.length > 1 ? 's' : ''})`);
  });
  console.log('');
  
  // Synchronisation initiale
  console.log('🔄 Synchronisation initiale...');
  await syncAllCalendars();
  
  // Programmer les synchronisations automatiques
  const syncInterval = parseInt(process.env.SYNC_INTERVAL) || 15;
  cron.schedule(`*/${syncInterval} * * * *`, async () => {
    console.log('');
    console.log('⏰ Synchronisation automatique programmée');
    await syncAllCalendars();
  });
  
  console.log('');
  console.log(`⏰ Synchronisation automatique: toutes les ${syncInterval} minutes`);
  console.log('');
  console.log('📧 Notifications configurées:', process.env.EMAIL_USER ? '✅ OUI' : '⚠️  NON');
  console.log('');
});
