require('dotenv').config();
const { Pool } = require('pg');
const notificationService = require('./services/notifications-service');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

notificationService.setPool(pool);

async function test() {
  console.log('🧪 Test envoi notification...');
  
  const result = await notificationService.sendNotificationByUserId(
    'u_mjcpmi2k',
    '🎉 Test de notification',
    'Si vous voyez ce message, ça marche !',
    { type: 'test' }
  );
  
  console.log('📊 Résultat:', result);
  process.exit(0);
}

test();
