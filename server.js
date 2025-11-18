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
const Stripe = require('stripe');
const { Pool } = require('pg');

// Pool de connexion PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }  
    : false
});

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

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

// Paths de configuration
const CONFIG_FILE = path.join(__dirname, 'properties-config.json');
const USERS_FILE = path.join(__dirname, 'users-config.json');
const WELCOME_FILE = path.join(__dirname, 'welcome-config.json');
const MANUAL_RES_FILE = path.join(__dirname, 'manual-reservations.json');

// 🔐 Nouveau : fichier de cautions
const DEPOSITS_FILE = path.join(__dirname, 'deposits-config.json');

// Data en mémoire
let USERS = [];
let WELCOME_DATA = [];           // { userId, data: {...} }
let MANUAL_RESERVATIONS = {};    // { [propertyId]: [reservations] }
let DEPOSITS = [];               // { id, reservationUid, amountCents, currency, status, stripeSessionId, checkoutUrl, createdAt }

// ============================================
// FONCTIONS UTILITAIRES FICHIERS
// ============================================

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

async function loadManualReservations() {
  try {
    const data = await fs.readFile(MANUAL_RES_FILE, 'utf8');
    MANUAL_RESERVATIONS = JSON.parse(data);
    console.log('✅ Réservations manuelles chargées depuis manual-reservations.json');
  } catch (error) {
    MANUAL_RESERVATIONS = {};
    console.log('⚠️  Aucun fichier manual-reservations.json, démarrage sans réservations manuelles');
  }
}

async function saveManualReservations() {
  try {
    await fs.writeFile(MANUAL_RES_FILE, JSON.stringify(MANUAL_RESERVATIONS, null, 2));
    console.log('✅ Réservations manuelles sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des réservations manuelles:', error.message);
  }
}

async function loadDeposits() {
  try {
    const data = await fs.readFile(DEPOSITS_FILE, 'utf8');
    DEPOSITS = JSON.parse(data);
    console.log('✅ Cautions chargées depuis deposits-config.json');
  } catch (error) {
    DEPOSITS = [];
    console.log('⚠️  Aucun fichier deposits-config.json, démarrage sans cautions');
  }
}

async function saveDeposits() {
  try {
    await fs.writeFile(DEPOSITS_FILE, JSON.stringify(DEPOSITS, null, 2));
    console.log('✅ Cautions sauvegardées');
  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde des cautions:', error.message);
  }
}

// ============================================
// JWT & UTILISATEURS
// ============================================

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
// PROPERTIES (logements)
// ============================================

let PROPERTIES = [];

async function loadProperties() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    PROPERTIES = JSON.parse(data);
    console.log('✅ Configuration chargée depuis properties-config.json');
  } catch (error) {
    // Configuration par défaut depuis .env
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

// ============================================
// SYNCHRO ICAL
// ============================================

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

      // Base = iCal
      reservationsStore.properties[property.id] = reservations;

      // Ajouter les réservations manuelles
      const manualForProperty = MANUAL_RESERVATIONS[property.id] || [];
      if (manualForProperty.length > 0) {
        reservationsStore.properties[property.id] = [
          ...reservationsStore.properties[property.id],
          ...manualForProperty
        ];
      }

      console.log(
        `✅ ${property.name}: ${reservationsStore.properties[property.id].length} ` +
        `réservations (iCal + manuelles)`
      );
    } catch (error) {
      console.error(`❌ Erreur lors de la synchronisation de ${property.name}:`, error.message);
    }
  }

  reservationsStore.lastSync = new Date();
  reservationsStore.syncStatus = 'idle';

  // Notifications nouvelles résas
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

// GET - Toutes les réservations
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

// POST - Créer une réservation manuelle
app.post('/api/reservations/manual', async (req, res) => {
  try {
    const { propertyId, start, end, guestName, notes } = req.body;

    if (!propertyId || !start || !end) {
      return res.status(400).json({ error: 'propertyId, start et end sont requis' });
    }

    const property = PROPERTIES.find(p => p.id === propertyId);
    if (!property) {
      return res.status(404).json({ error: 'Logement non trouvé' });
    }

    const reservation = {
      uid: 'manual_' + Date.now(),
      start,
      end,
      source: 'MANUEL',
      platform: 'MANUEL',
      guestName: guestName || 'Réservation manuelle',
      notes: notes || '',
      createdAt: new Date().toISOString()
    };

    if (!MANUAL_RESERVATIONS[propertyId]) {
      MANUAL_RESERVATIONS[propertyId] = [];
    }
    MANUAL_RESERVATIONS[propertyId].push(reservation);
    await saveManualReservations();

    if (!reservationsStore.properties[propertyId]) {
      reservationsStore.properties[propertyId] = [];
    }
    reservationsStore.properties[propertyId].push(reservation);

    res.status(201).json({
      message: 'Réservation manuelle créée',
      reservation
    });
  } catch (err) {
    console.error('Erreur création réservation manuelle:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET - Réservations d’un logement
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

// POST - Forcer une synchronisation
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
  // GET - Réservations avec infos de caution
app.get('/api/reservations-with-deposits', (req, res) => {
  const result = [];

  PROPERTIES.forEach(property => {
    const reservations = reservationsStore.properties[property.id] || [];

    reservations.forEach(r => {
      const deposit = DEPOSITS.find(d => d.reservationUid === r.uid) || null;

      result.push({
        reservationUid: r.uid,
        propertyId: property.id,
        propertyName: property.name,
        startDate: r.start,
        endDate: r.end,
        guestName: r.guestName || '',
        deposit: deposit
          ? {
              id: deposit.id,
              amountCents: deposit.amountCents,
              status: deposit.status,
              checkoutUrl: deposit.checkoutUrl
            }
          : null
      });
    });
  });

  res.json(result);
});
});

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
    restaurants: [],
    shops: [],
    photos: []
  };
}

// GET - Livret de l'utilisateur courant
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

// POST - Sauvegarder le livret
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

// ============================================
// ROUTES API - GESTION DES LOGEMENTS
// ============================================

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

// ============================================
// ROUTES API - NOTIFICATIONS TEST
// ============================================

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

// ============================================
// ROUTES API - CONFIG
// ============================================

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
    timezone: process.env.TIMEZONE || 'Europe/Paris',
    stripeConfigured: !!STRIPE_SECRET_KEY
  });
});

// ============================================
// ROUTES API - AUTH
// ============================================

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
      createdAt: new Date().toISOString(),
      stripeAccountId: null
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
// ROUTES API - MESSAGES
// ============================================

app.get('/api/messages/templates', (req, res) => {
  res.json({
    templates: messagingService.MESSAGE_TEMPLATES
  });
});

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

// ============================================
// 🚀 ROUTES API - CAUTIONS (Stripe)
// ============================================

// Helper pour retrouver une réservation par UID
function findReservationByUid(reservationUid) {
  for (const propertyId in reservationsStore.properties) {
    const found = reservationsStore.properties[propertyId].find(r => r.uid === reservationUid);
    if (found) {
      const property = PROPERTIES.find(p => p.id === propertyId);
      return {
        reservation: found,
        property
      };
    }
  }
  return null;
}

// GET - Récupérer la caution liée à une réservation (si existe)
app.get('/api/deposits/:reservationUid', (req, res) => {
  const { reservationUid } = req.params;
  const deposit = DEPOSITS.find(d => d.reservationUid === reservationUid) || null;
  res.json({ deposit });
});

// POST - Créer une caution Stripe pour une réservation
app.post('/api/deposits', async (req, res) => {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe non configuré (clé secrète manquante)' });
    }

    const { reservationUid, amount } = req.body;

    if (!reservationUid || !amount || amount <= 0) {
      return res.status(400).json({ error: 'reservationUid et montant (>0) sont requis' });
    }

    const result = findReservationByUid(reservationUid);
    if (!result) {
      return res.status(404).json({ error: 'Réservation non trouvée' });
    }

    const { reservation, property } = result;
    const amountCents = Math.round(amount * 100);

    // Créer un enregistrement de caution en mémoire + fichier
    const depositId = 'dep_' + Date.now().toString(36);
    const deposit = {
      id: depositId,
      reservationUid,
      amountCents,
      currency: 'eur',
      status: 'pending',
      stripeSessionId: null,
      checkoutUrl: null,
      createdAt: new Date().toISOString()
    };
    DEPOSITS.push(deposit);

    // Création session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Caution séjour – ${property ? property.name : 'Logement'}`,
            description: `Du ${reservation.start} au ${reservation.end}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      metadata: {
        deposit_id: deposit.id,
        reservation_uid: reservationUid,
        user_id: user.id
      },
      success_url: `${process.env.APP_URL || ''}/caution-success.html?depositId=${deposit.id}`,
      cancel_url: `${process.env.APP_URL || ''}/caution-cancel.html?depositId=${deposit.id}`
    });

    // Mise à jour de la caution avec les infos Stripe
    deposit.stripeSessionId = session.id;
    deposit.checkoutUrl = session.url;
    await saveDeposits();

    res.json({
      deposit,
      checkoutUrl: session.url
    });
  } catch (err) {
    console.error('Erreur création caution:', err);
    res.status(500).json({ error: 'Erreur lors de la création de la caution' });
  }
});

// ============================================
// DÉMARRAGE
// ============================================

app.listen(PORT, async () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🏠 LCC Booking Manager - Système de Réservations    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log('');

  await loadProperties();
  await loadUsers();
  await loadWelcomeData();
  await loadManualReservations();
  await loadDeposits();

  console.log('Logements configurés:');
  PROPERTIES.forEach(p => {
    const status = p.icalUrls.length > 0 ? '✅' : '⚠️';
    console.log(`  ${status} ${p.name} (${p.icalUrls.length} source${p.icalUrls.length > 1 ? 's' : ''})`);
  });
  console.log('');

  console.log('🔄 Synchronisation initiale...');
  await syncAllCalendars();

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
  console.log('💳 Stripe configuré :', STRIPE_SECRET_KEY ? '✅ OUI' : '⚠️  NON (pas de création de cautions possible)');
  console.log('');
});
