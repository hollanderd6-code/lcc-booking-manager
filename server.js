require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const icalService = require('./services/icalService');
const notificationService = require('./services/notificationService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Store for reservations
let reservationsStore = {
  properties: {},
  lastSync: null,
  syncStatus: 'idle'
};

// Configuration des logements
const PROPERTIES = [
  {
    id: 'saint-gratien',
    name: 'Saint-Gratien',
    color: '#E67E50',
    icalUrls: [
      process.env.SAINT_GRATIEN_ICAL_URL,
      process.env.SAINT_GRATIEN_BOOKING_URL
    ].filter(Boolean)
  },
  {
    id: 'montmorency',
    name: 'Montmorency',
    color: '#B87A5C',
    icalUrls: [
      process.env.MONTMORENCY_ICAL_URL,
      process.env.MONTMORENCY_BOOKING_URL
    ].filter(Boolean)
  },
  {
    id: 'bessancourt',
    name: 'Bessancourt',
    color: '#8B7355',
    icalUrls: [
      process.env.BESSANCOURT_ICAL_URL,
      process.env.BESSANCOURT_BOOKING_URL
    ].filter(Boolean)
  },
  {
    id: 'frepillon',
    name: 'Frépillon',
    color: '#A0826D',
    icalUrls: [
      process.env.FREPILLON_ICAL_URL,
      process.env.FREPILLON_BOOKING_URL
    ].filter(Boolean)
  }
];

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
// ROUTES API
// ============================================

// GET - Récupérer toutes les réservations
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

// GET - Réservations par logement
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

// POST - Forcer la synchronisation
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

// GET - Statistiques
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
    
    // Stats par mois
    reservations.forEach(r => {
      const month = new Date(r.start).toISOString().slice(0, 7);
      stats.byMonth[month] = (stats.byMonth[month] || 0) + 1;
    });
  });
  
  res.json(stats);
});

// GET - Disponibilités
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
  
  // Vérifier les chevauchements
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
// DÉMARRAGE
// ============================================

app.listen(PORT, async () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🏠 LCC Booking Manager - Système de Réservations    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log('📅 Interface web disponible');
  console.log('');
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
