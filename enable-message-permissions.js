// ============================================
// 🔧 SCRIPT : ACTIVER PERMISSIONS MESSAGES
// Usage: node enable-message-permissions.js <sub_account_id>
// ============================================

const { Pool } = require('pg');
require('dotenv').config();

// Configuration de la connexion
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function enableMessagePermissions(subAccountId) {
  try {
    console.log('🔍 Recherche du sous-compte:', subAccountId);
    
    // Vérifier que le sous-compte existe
    const { rows: subAccounts } = await pool.query(
      'SELECT * FROM sub_accounts WHERE id = $1',
      [subAccountId]
    );
    
    if (subAccounts.length === 0) {
      console.error('❌ Sous-compte introuvable:', subAccountId);
      process.exit(1);
    }
    
    const subAccount = subAccounts[0];
    console.log('✅ Sous-compte trouvé:', subAccount.email);
    
    // Mettre à jour les permissions
    await pool.query(`
      UPDATE sub_account_permissions
      SET 
        can_view_messages = TRUE,
        can_send_messages = TRUE,
        can_delete_messages = TRUE
      WHERE sub_account_id = $1
    `, [subAccountId]);
    
    console.log('✅ Permissions messages activées !');
    
    // Afficher toutes les permissions
    const { rows: permissions } = await pool.query(
      'SELECT * FROM sub_account_permissions WHERE sub_account_id = $1',
      [subAccountId]
    );
    
    if (permissions.length > 0) {
      console.log('\n📋 Permissions actuelles:');
      console.log('  - Voir calendrier:', permissions[0].can_view_calendar ? '✅' : '❌');
      console.log('  - Assigner ménages:', permissions[0].can_assign_cleaning ? '✅' : '❌');
      console.log('  - Voir messages:', permissions[0].can_view_messages ? '✅' : '❌');
      console.log('  - Envoyer messages:', permissions[0].can_send_messages ? '✅' : '❌');
      console.log('  - Supprimer messages:', permissions[0].can_delete_messages ? '✅' : '❌');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

// Récupérer l'ID depuis les arguments
const subAccountId = process.argv[2];

if (!subAccountId) {
  console.error('❌ Usage: node enable-message-permissions.js <sub_account_id>');
  console.error('Exemple: node enable-message-permissions.js 123e4567-e89b-12d3-a456-426614174000');
  process.exit(1);
}

enableMessagePermissions(subAccountId);
