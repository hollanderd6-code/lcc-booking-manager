// ============================================
// API ADMIN - Gestion de la base de données
// À ajouter dans routes/admin.js ou server.js
// ============================================

const express = require('express');
const router = express.Router();

// Middleware de protection (assurez-vous que l'utilisateur est connecté)
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

// ============================================
// ROUTE 1 : Afficher la page admin
// GET /admin/database
// ============================================

router.get('/admin/database', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-database.html'));
});

// ============================================
// ROUTE 2 : Vérifier l'état de la DB
// GET /api/admin/check-database
// ============================================

router.get('/api/admin/check-database', requireAuth, async (req, res) => {
  try {
    // Liste des colonnes requises
    const requiredColumns = [
      'guest_nationality',
      'guest_birth_date',
      'id_document_path',
      'checkin_completed',
      'checkin_date',
      'checkin_link_sent',
      'checkin_link_sent_at',
      'proxy_email'
    ];

    // Récupérer les colonnes existantes de la table reservations
    const [columns] = await db.sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'reservations'
    `);

    const existingColumns = columns.map(col => col.column_name);

    // Trouver les colonnes manquantes
    const missingColumns = requiredColumns.filter(
      col => !existingColumns.includes(col)
    );

    const allColumnsExist = missingColumns.length === 0;

    res.json({
      allColumnsExist,
      existingColumns: requiredColumns.filter(col => existingColumns.includes(col)),
      missingColumns,
      totalRequired: requiredColumns.length
    });

  } catch (error) {
    console.error('Erreur vérification DB:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification',
      message: error.message 
    });
  }
});

// ============================================
// ROUTE 3 : Installer les colonnes manquantes
// POST /api/admin/install-columns
// ============================================

router.post('/api/admin/install-columns', requireAuth, async (req, res) => {
  try {
    // Vérifier quelles colonnes manquent
    const requiredColumns = [
      { name: 'guest_nationality', type: 'VARCHAR(10)' },
      { name: 'guest_birth_date', type: 'DATE' },
      { name: 'id_document_path', type: 'VARCHAR(255)' },
      { name: 'checkin_completed', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'checkin_date', type: 'TIMESTAMP' },
      { name: 'checkin_link_sent', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'checkin_link_sent_at', type: 'TIMESTAMP' },
      { name: 'proxy_email', type: 'VARCHAR(255)' }
    ];

    // Récupérer les colonnes existantes
    const [existingCols] = await db.sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'reservations'
    `);

    const existingColumnNames = existingCols.map(col => col.column_name);

    // Filtrer les colonnes manquantes
    const columnsToAdd = requiredColumns.filter(
      col => !existingColumnNames.includes(col.name)
    );

    if (columnsToAdd.length === 0) {
      return res.json({
        success: true,
        message: 'Toutes les colonnes existent déjà',
        installed: 0
      });
    }

    // Ajouter chaque colonne manquante
    for (const column of columnsToAdd) {
      try {
        await db.sequelize.query(`
          ALTER TABLE reservations 
          ADD COLUMN ${column.name} ${column.type}
        `);
        
        console.log(`✅ Colonne ajoutée: ${column.name}`);
        
      } catch (error) {
        // Si la colonne existe déjà, continuer
        if (error.message.includes('already exists')) {
          console.log(`⚠️ Colonne déjà existante: ${column.name}`);
          continue;
        }
        throw error;
      }
    }

    res.json({
      success: true,
      message: 'Colonnes installées avec succès',
      installed: columnsToAdd.length
    });

  } catch (error) {
    console.error('Erreur installation colonnes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'installation',
      message: error.message
    });
  }
});

module.exports = router;
