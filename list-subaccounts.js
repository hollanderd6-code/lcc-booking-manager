// ============================================
// 📋 SCRIPT : LISTER SOUS-COMPTES ET PERMISSIONS
// Usage: node list-subaccounts.js
// ============================================

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function listSubAccounts() {
  try {
    console.log('🔍 Recherche des sous-comptes...\n');
    
    const { rows } = await pool.query(`
      SELECT 
        sa.id,
        sa.email,
        sa.first_name,
        sa.last_name,
        sa.is_active,
        sa.created_at,
        sp.can_view_calendar,
        sp.can_assign_cleaning,
        sp.can_view_messages,
        sp.can_send_messages,
        sp.can_delete_messages,
        u.email as parent_email
      FROM sub_accounts sa
      LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
      LEFT JOIN users u ON sa.parent_user_id = u.id
      ORDER BY sa.created_at DESC
    `);
    
    if (rows.length === 0) {
      console.log('ℹ️  Aucun sous-compte trouvé');
      process.exit(0);
    }
    
    console.log(`📊 ${rows.length} sous-compte(s) trouvé(s):\n`);
    
    rows.forEach((sa, index) => {
      console.log(`${index + 1}. ${sa.first_name} ${sa.last_name} (${sa.email})`);
      console.log(`   ID: ${sa.id}`);
      console.log(`   Parent: ${sa.parent_email}`);
      console.log(`   Statut: ${sa.is_active ? '✅ Actif' : '❌ Inactif'}`);
      console.log(`   Créé le: ${new Date(sa.created_at).toLocaleDateString('fr-FR')}`);
      console.log(`   Permissions:`);
      console.log(`     - Voir calendrier: ${sa.can_view_calendar ? '✅' : '❌'}`);
      console.log(`     - Assigner ménages: ${sa.can_assign_cleaning ? '✅' : '❌'}`);
      console.log(`     - Voir messages: ${sa.can_view_messages ? '✅' : '❌'}`);
      console.log(`     - Envoyer messages: ${sa.can_send_messages ? '✅' : '❌'}`);
      console.log(`     - Supprimer messages: ${sa.can_delete_messages ? '✅' : '❌'}`);
      console.log('');
    });
    
    // Statistiques
    const activeCount = rows.filter(r => r.is_active).length;
    const withMessagesCount = rows.filter(r => r.can_view_messages).length;
    
    console.log('📈 Statistiques:');
    console.log(`   - Sous-comptes actifs: ${activeCount}/${rows.length}`);
    console.log(`   - Avec accès messages: ${withMessagesCount}/${rows.length}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

listSubAccounts();
