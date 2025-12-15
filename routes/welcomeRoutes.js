const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Configuration Multer pour l'upload d'images
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'welcome-books');
    
    // Créer le dossier s'il n'existe pas
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (err) {
      console.error('Error creating upload directory:', err);
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Générer un nom unique pour chaque fichier
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtre pour accepter uniquement les images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Seules les images sont acceptées (JPEG, PNG, GIF, WebP)'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Limite de 5MB par fichier
  },
  fileFilter: fileFilter
});
// Middleware d'authentification
function authenticateUser(req, res, next) {
  console.log('🔍 Cookies reçus:', req.cookies);  // DEBUG
  console.log('🔍 Headers:', req.headers.cookie);  // DEBUG
  
const authHeader = req.headers.authorization || '';
const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
const token = req.cookies?.token || bearerToken;

  if (!token) {
    console.log('❌ Pas de token trouvé dans les cookies');
    return res.status(401).json({ error: 'Non authentifié' });
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    console.log('✅ Utilisateur authentifié:', req.userId);
    next();
  } catch (error) {
    console.log('❌ Erreur validation token:', error.message);
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Créer les tables si elles n'existent pas (VERSION SIMPLIFIÉE SANS CONTRAINTES)
const initWelcomeBookTables = async (pool) => {
  const createWelcomeBooksTable = `
    CREATE TABLE IF NOT EXISTS welcome_books (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      unique_id VARCHAR(50) UNIQUE NOT NULL,
      property_name VARCHAR(255) NOT NULL,
      cover_photo VARCHAR(500),
      welcome_description TEXT,
      contact_phone VARCHAR(50),
      address TEXT,
      postal_code VARCHAR(20),
      city VARCHAR(100),
      keybox_code VARCHAR(50),
      access_instructions TEXT,
      parking_info TEXT,
      wifi_ssid VARCHAR(100),
      wifi_password VARCHAR(100),
      checkout_time VARCHAR(20),
      checkout_instructions TEXT,
      equipment_list TEXT,
      important_rules TEXT,
      transport_info TEXT,
      shops_list TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createWelcomeBookRoomsTable = `
    CREATE TABLE IF NOT EXISTS welcome_book_rooms (
      id SERIAL PRIMARY KEY,
      welcome_book_id INTEGER NOT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createWelcomeBookPhotosTable = `
    CREATE TABLE IF NOT EXISTS welcome_book_photos (
      id SERIAL PRIMARY KEY,
      welcome_book_id INTEGER NOT NULL,
      room_id INTEGER,
      photo_type VARCHAR(50) NOT NULL,
      photo_url VARCHAR(500) NOT NULL,
      caption TEXT,
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createWelcomeBookRestaurantsTable = `
    CREATE TABLE IF NOT EXISTS welcome_book_restaurants (
      id SERIAL PRIMARY KEY,
      welcome_book_id INTEGER NOT NULL,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50),
      address VARCHAR(300),
      description TEXT,
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createWelcomeBookPlacesTable = `
    CREATE TABLE IF NOT EXISTS welcome_book_places (
      id SERIAL PRIMARY KEY,
      welcome_book_id INTEGER NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      photo_url VARCHAR(500),
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(createWelcomeBooksTable);
    await pool.query(createWelcomeBookRoomsTable);
    await pool.query(createWelcomeBookPhotosTable);
    await pool.query(createWelcomeBookRestaurantsTable);
    await pool.query(createWelcomeBookPlacesTable);
    console.log('✅ Tables welcome_books créées avec succès');
  } catch (error) {
    console.error('❌ Erreur lors de la création des tables welcome_books:', error);
    throw error;
  }
};

// Route pour créer un nouveau livret d'accueil
router.post('/create', authenticateUser, upload.fields([
  { name: 'coverPhoto', maxCount: 1 },
  { name: 'entrancePhotos', maxCount: 10 },
  { name: 'parkingPhotos', maxCount: 5 },
  { name: 'roomPhotos', maxCount: 50 },
  { name: 'placePhotos', maxCount: 20 }
]), async (req, res) => {
  const client = await req.app.locals.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      propertyName,
      welcomeDescription,
      contactPhone,
      address,
      postalCode,
      city,
      keyboxCode,
      accessInstructions,
      parkingInfo,
      wifiSSID,
      wifiPassword,
      checkoutTime,
      checkoutInstructions,
      equipmentList,
      importantRules,
      transportInfo,
      shopsList,
      rooms,
      restaurants,
      places
    } = req.body;

    // Générer un ID unique pour le livret
    const uniqueId = crypto.randomBytes(16).toString('hex');

    // Insérer le livret principal
    const insertWelcomeBookQuery = `
      INSERT INTO welcome_books (
        user_id, unique_id, property_name, welcome_description, contact_phone,
        address, postal_code, city, keybox_code, access_instructions,
        parking_info, wifi_ssid, wifi_password, checkout_time,
        checkout_instructions, equipment_list, important_rules,
        transport_info, shops_list
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id
    `;

    const welcomeBookResult = await client.query(insertWelcomeBookQuery, [
      req.userId,
      uniqueId,
      propertyName,
      welcomeDescription,
      contactPhone,
      address,
      postalCode,
      city,
      keyboxCode,
      accessInstructions,
      parkingInfo,
      wifiSSID,
      wifiPassword,
      checkoutTime,
      checkoutInstructions,
      equipmentList,
      importantRules,
      transportInfo,
      shopsList
    ]);

    const welcomeBookId = welcomeBookResult.rows[0].id;

    // Traiter les photos
    const files = req.files;

    // Photo de couverture
    if (files.coverPhoto && files.coverPhoto[0]) {
      const photoUrl = `/uploads/welcome-books/${files.coverPhoto[0].filename}`;
      await client.query(
        'INSERT INTO welcome_book_photos (welcome_book_id, photo_type, photo_url) VALUES ($1, $2, $3)',
        [welcomeBookId, 'cover', photoUrl]
      );
      
      // Mettre à jour le livret avec la photo de couverture
      await client.query(
        'UPDATE welcome_books SET cover_photo = $1 WHERE id = $2',
        [photoUrl, welcomeBookId]
      );
    }

    // Photos d'entrée
    if (files.entrancePhotos) {
      for (let i = 0; i < files.entrancePhotos.length; i++) {
        const photoUrl = `/uploads/welcome-books/${files.entrancePhotos[i].filename}`;
        await client.query(
          'INSERT INTO welcome_book_photos (welcome_book_id, photo_type, photo_url, display_order) VALUES ($1, $2, $3, $4)',
          [welcomeBookId, 'entrance', photoUrl, i]
        );
      }
    }

    // Photos de parking
    if (files.parkingPhotos) {
      for (let i = 0; i < files.parkingPhotos.length; i++) {
        const photoUrl = `/uploads/welcome-books/${files.parkingPhotos[i].filename}`;
        await client.query(
          'INSERT INTO welcome_book_photos (welcome_book_id, photo_type, photo_url, display_order) VALUES ($1, $2, $3, $4)',
          [welcomeBookId, 'parking', photoUrl, i]
        );
      }
    }

    // Traiter les pièces
    if (rooms) {
      const roomsArray = typeof rooms === 'string' ? JSON.parse(rooms) : (Array.isArray(rooms) ? rooms : [rooms]);
      
      for (let i = 0; i < roomsArray.length; i++) {
        const room = typeof roomsArray[i] === 'string' ? JSON.parse(roomsArray[i]) : roomsArray[i];
        
        const roomResult = await client.query(
          'INSERT INTO welcome_book_rooms (welcome_book_id, name, description, display_order) VALUES ($1, $2, $3, $4) RETURNING id',
          [welcomeBookId, room.name, room.description, i]
        );
      }
    }

    // Traiter les restaurants
    if (restaurants) {
      const restaurantsArray = typeof restaurants === 'string' ? JSON.parse(restaurants) : (Array.isArray(restaurants) ? restaurants : [restaurants]);
      
      for (let i = 0; i < restaurantsArray.length; i++) {
        const restaurant = typeof restaurantsArray[i] === 'string' ? JSON.parse(restaurantsArray[i]) : restaurantsArray[i];
        
        await client.query(
          'INSERT INTO welcome_book_restaurants (welcome_book_id, name, phone, address, description, display_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [welcomeBookId, restaurant.name, restaurant.phone, restaurant.address, restaurant.description, i]
        );
      }
    }

    // Traiter les lieux à visiter
    if (places) {
      const placesArray = typeof places === 'string' ? JSON.parse(places) : (Array.isArray(places) ? places : [places]);
      
      for (let i = 0; i < placesArray.length; i++) {
        const place = typeof placesArray[i] === 'string' ? JSON.parse(placesArray[i]) : placesArray[i];
        
        let photoUrl = null;
        if (files.placePhotos) {
          const placePhoto = files.placePhotos.find(file => 
            file.fieldname.includes(`place-${i + 1}`)
          );
          if (placePhoto) {
            photoUrl = `/uploads/welcome-books/${placePhoto.filename}`;
          }
        }
        
        await client.query(
          'INSERT INTO welcome_book_places (welcome_book_id, name, description, photo_url, display_order) VALUES ($1, $2, $3, $4, $5)',
          [welcomeBookId, place.name, place.description, photoUrl, i]
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Livret d\'accueil créé avec succès',
      welcomeBookId,
      uniqueId,
      url: `${req.protocol}://${req.get('host')}/api/welcome-books/public/${uniqueId}`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur lors de la création du livret:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la création du livret d\'accueil'
    });
  } finally {
    client.release();
  }
});

// Route pour récupérer tous les livrets d'un utilisateur
router.get('/user/list', authenticateUser, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        unique_id,
        property_name,
        cover_photo,
        created_at,
        updated_at
      FROM welcome_books 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    
    const result = await req.app.locals.pool.query(query, [req.userId]);
    
    res.json({
      success: true,
      welcomeBooks: result.rows
    });
    
  } catch (error) {
    console.error('Erreur lors de la récupération des livrets:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des livrets'
    });
  }
});

// Route pour supprimer un livret
router.delete('/:id', authenticateUser, async (req, res) => {
  const client = await req.app.locals.pool.connect();
  
  try {
    const { id } = req.params;
    
    // Vérifier que le livret appartient à l'utilisateur
    const checkQuery = 'SELECT id FROM welcome_books WHERE id = $1 AND user_id = $2';
    const checkResult = await client.query(checkQuery, [id, req.userId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Livret non trouvé ou accès non autorisé' });
    }
    
    await client.query('BEGIN');
    
    // Supprimer les données liées
    await client.query('DELETE FROM welcome_book_photos WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_book_rooms WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_book_restaurants WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_book_places WHERE welcome_book_id = $1', [id]);
    
    // Supprimer le livret
    await client.query('DELETE FROM welcome_books WHERE id = $1', [id]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Livret d\'accueil supprimé avec succès'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur lors de la suppression du livret:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression du livret'
    });
  } finally {
    client.release();
  }
  // ✅ Route PUBLIQUE : récupérer un livret par uniqueId
router.get('/public/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    const bookRes = await req.app.locals.pool.query(
      'SELECT * FROM welcome_books WHERE unique_id = $1',
      [uniqueId]
    );
    if (bookRes.rows.length === 0) return res.status(404).json({ error: 'Livret introuvable' });

    const book = bookRes.rows[0];

    const photosRes = await req.app.locals.pool.query(
      'SELECT * FROM welcome_book_photos WHERE welcome_book_id = $1 ORDER BY display_order ASC',
      [book.id]
    );
    const roomsRes = await req.app.locals.pool.query(
      'SELECT * FROM welcome_book_rooms WHERE welcome_book_id = $1 ORDER BY display_order ASC',
      [book.id]
    );
    const restaurantsRes = await req.app.locals.pool.query(
      'SELECT * FROM welcome_book_restaurants WHERE welcome_book_id = $1 ORDER BY display_order ASC',
      [book.id]
    );
    const placesRes = await req.app.locals.pool.query(
      'SELECT * FROM welcome_book_places WHERE welcome_book_id = $1 ORDER BY display_order ASC',
      [book.id]
    );

    res.json({
      success: true,
      book,
      photos: photosRes.rows,
      rooms: roomsRes.rows,
      restaurants: restaurantsRes.rows,
      places: placesRes.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

});

module.exports = { router, initWelcomeBookTables };
