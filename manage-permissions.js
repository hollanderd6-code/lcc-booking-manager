// ============================================
// 🎯 SCRIPT : GÉRER TOUTES LES PERMISSIONS
// Usage: node manage-permissions.js <sub_account_id> [options]
// ============================================

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================
// TEMPLATES DE PERMISSIONS
// ============================================

const PERMISSION_TEMPLATES = {
  all: {
    name: 'Accès complet',
    permissions: {
      can_view_messages: true,
      can_send_messages: true,
      can_delete_messages: true,
      can_view_cleaning: true,
      can_assign_cleaning: true,
      can_view_properties: true,
      can_edit_properties: true,
      can_delete_properties: true,
      can_view_deposits: true,
      can_manage_deposits: true,
      can_view_smart_locks: true,
      can_manage_smart_locks: true
    }
  },
  
  cleaner: {
    name: 'Femme de ménage',
    permissions: {
      can_view_messages: true,
      can_send_messages: false,
      can_delete_messages: false,
      can_view_cleaning: true,
      can_assign_cleaning: false,
      can_view_properties: true,
      can_edit_properties: false,
      can_delete_properties: false,
      can_view_deposits: false,
      can_manage_deposits: false,
      can_view_smart_locks: true,
      can_manage_smart_locks: false
    }
  },
  
  manager: {
    name: 'Gestionnaire',
    permissions: {
      can_view_messages: true,
      can_send_messages: true,
      can_delete_messages: false,
      can_view_cleaning: true,
      can_assign_cleaning: true,
      can_view_properties: true,
      can_edit_properties: true,
      can_delete_properties: false,
      can_view_deposits: true,
      can_manage_deposits: false,
      can_view_smart_locks: true,
      can_manage_smart_locks: true
    }
  },
  
  readonly: {
    name: 'Lecture seule',
    permissions: {
      can_view_messages: true,
      can_send_messages: false,
      can_delete_messages: false,
      can_view_cleaning: true,
      can_assign_cleaning: false,
      can_view_properties: true,
      can_edit_properties: false,
      can_delete_properties: false,
      can_view_deposits: true,
      can_manage_deposits: false,
      can_view_smart_locks: true,
      can_manage_smart_locks: false
    }
  },
  
  none: {
    name: 'Aucune permission',
    permissions: {
      can_view_messages: false,
      can_send_messages: false,
      can_delete_messages: false,
      can_view_cleaning: false,
      can_assign_cleaning: false,
      can_view_properties: false,
      can_edit_properties: false,
      can_delete_properties: false,
      can_view_deposits: false,
      can_manage_deposits: false,
      can_view_smart_locks: false,
      can_manage_smart_locks: false
    }
  }
};

// ============================================
// FONCTIONS
// ============================================

async function getSubAccount(subAccountId) {
  const { rows } = await pool.query(
    'SELECT * FROM sub_accounts WHERE id = $1',
    [subAccountId]
  );
  return rows[0];
}

async function getCurrentPermissions(subAccountId) {
  const { rows } = await pool.query(
    'SELECT * FROM sub_account_permissions WHERE sub_account_id = $1',
    [subAccountId]
  );
  return rows[0];
}

async function applyPermissions(subAccountId, permissions) {
  const fields = Object.keys(permissions);
  const values = Object.values(permissions);
  
  const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  
  await pool.query(
    `UPDATE sub_account_permissions SET ${setClause} WHERE sub_account_id = $1`,
    [subAccountId, ...values]
  );
}

function displayPermissions(permissions) {
  console.log('\n📋 Permissions actuelles:\n');
  
  console.log('💬 Messages:');
  console.log(`  - Voir: ${permissions.can_view_messages ? '✅' : '❌'}`);
  console.log(`  - Envoyer: ${permissions.can_send_messages ? '✅' : '❌'}`);
  console.log(`  - Supprimer: ${permissions.can_delete_messages ? '✅' : '❌'}`);
  
  console.log('\n🧹 Ménages:');
  console.log(`  - Voir: ${permissions.can_view_cleaning ? '✅' : '❌'}`);
  console.log(`  - Assigner: ${permissions.can_assign_cleaning ? '✅' : '❌'}`);
  
  console.log('\n🏠 Logements:');
  console.log(`  - Voir: ${permissions.can_view_properties ? '✅' : '❌'}`);
  console.log(`  - Modifier: ${permissions.can_edit_properties ? '✅' : '❌'}`);
  console.log(`  - Supprimer: ${permissions.can_delete_properties ? '✅' : '❌'}`);
  
  console.log('\n🛡️ Cautions:');
  console.log(`  - Voir: ${permissions.can_view_deposits ? '✅' : '❌'}`);
  console.log(`  - Gérer: ${permissions.can_manage_deposits ? '✅' : '❌'}`);
  
  console.log('\n🔒 Serrures:');
  console.log(`  - Voir: ${permissions.can_view_smart_locks ? '✅' : '❌'}`);
  console.log(`  - Gérer: ${permissions.can_manage_smart_locks ? '✅' : '❌'}`);
}

// ============================================
// COMMANDES
// ============================================

async function showPermissions(subAccountId) {
  const subAccount = await getSubAccount(subAccountId);
  if (!subAccount) {
    console.error('❌ Sous-compte introuvable:', subAccountId);
    process.exit(1);
  }
  
  console.log('✅ Sous-compte:', subAccount.email);
  
  const permissions = await getCurrentPermissions(subAccountId);
  if (!permissions) {
    console.error('❌ Permissions introuvables');
    process.exit(1);
  }
  
  displayPermissions(permissions);
}

async function applyTemplate(subAccountId, templateName) {
  const template = PERMISSION_TEMPLATES[templateName];
  if (!template) {
    console.error('❌ Template invalide. Options:', Object.keys(PERMISSION_TEMPLATES).join(', '));
    process.exit(1);
  }
  
  const subAccount = await getSubAccount(subAccountId);
  if (!subAccount) {
    console.error('❌ Sous-compte introuvable:', subAccountId);
    process.exit(1);
  }
  
  console.log('📝 Application du template:', template.name);
  console.log('👤 Pour:', subAccount.email);
  
  await applyPermissions(subAccountId, template.permissions);
  
  console.log('✅ Permissions appliquées avec succès !');
  
  const newPermissions = await getCurrentPermissions(subAccountId);
  displayPermissions(newPermissions);
}

async function listTemplates() {
  console.log('📚 Templates de permissions disponibles:\n');
  
  for (const [key, template] of Object.entries(PERMISSION_TEMPLATES)) {
    console.log(`🔹 ${key}: ${template.name}`);
    
    const enabledCount = Object.values(template.permissions).filter(v => v).length;
    const totalCount = Object.keys(template.permissions).length;
    console.log(`   ${enabledCount}/${totalCount} permissions actives`);
    console.log('');
  }
  
  console.log('Usage: node manage-permissions.js <sub_account_id> --template <nom>');
}

async function listSubAccounts() {
  const { rows } = await pool.query(`
    SELECT 
      sa.id,
      sa.email,
      sa.first_name,
      sa.last_name,
      sa.is_active,
      sp.can_view_messages,
      sp.can_view_cleaning,
      sp.can_view_properties,
      sp.can_view_deposits,
      sp.can_view_smart_locks
    FROM sub_accounts sa
    LEFT JOIN sub_account_permissions sp ON sa.id = sp.sub_account_id
    ORDER BY sa.created_at DESC
  `);
  
  if (rows.length === 0) {
    console.log('ℹ️  Aucun sous-compte trouvé');
    return;
  }
  
  console.log(`\n📊 ${rows.length} sous-compte(s):\n`);
  
  rows.forEach((sa, index) => {
    console.log(`${index + 1}. ${sa.first_name} ${sa.last_name} (${sa.email})`);
    console.log(`   ID: ${sa.id}`);
    console.log(`   Statut: ${sa.is_active ? '✅ Actif' : '❌ Inactif'}`);
    
    const permissions = [
      sa.can_view_messages && '💬',
      sa.can_view_cleaning && '🧹',
      sa.can_view_properties && '🏠',
      sa.can_view_deposits && '🛡️',
      sa.can_view_smart_locks && '🔒'
    ].filter(Boolean);
    
    console.log(`   Accès: ${permissions.join(' ') || '❌ Aucun'}`);
    console.log('');
  });
}

// ============================================
// MAIN
// ============================================

async function main() {
  const args = process.argv.slice(2);
  
  // Liste des templates
  if (args[0] === '--list-templates') {
    await listTemplates();
    process.exit(0);
  }
  
  // Liste des sous-comptes
  if (args[0] === '--list') {
    await listSubAccounts();
    process.exit(0);
  }
  
  // Help
  if (args[0] === '--help' || args.length === 0) {
    console.log(`
🎯 GESTION DES PERMISSIONS SOUS-COMPTES

Usage:
  node manage-permissions.js <sub_account_id> [options]

Options:
  --show                    Afficher les permissions actuelles
  --template <nom>          Appliquer un template de permissions
  --list                    Lister tous les sous-comptes
  --list-templates          Lister les templates disponibles

Templates disponibles:
  all        Accès complet (toutes les permissions)
  manager    Gestionnaire (presque tout sauf suppression)
  cleaner    Femme de ménage (ménages + lecture)
  readonly   Lecture seule (voir uniquement)
  none       Aucune permission

Exemples:
  # Voir les permissions
  node manage-permissions.js abc-123 --show

  # Appliquer le template "manager"
  node manage-permissions.js abc-123 --template manager

  # Lister tous les sous-comptes
  node manage-permissions.js --list

  # Lister les templates
  node manage-permissions.js --list-templates
    `);
    process.exit(0);
  }
  
  const subAccountId = args[0];
  const command = args[1];
  
  try {
    if (command === '--show' || !command) {
      await showPermissions(subAccountId);
    } else if (command === '--template') {
      const templateName = args[2];
      if (!templateName) {
        console.error('❌ Spécifiez un template. Usage: --template <nom>');
        process.exit(1);
      }
      await applyTemplate(subAccountId, templateName);
    } else {
      console.error('❌ Commande invalide. Utilisez --help pour voir les options');
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

main();
