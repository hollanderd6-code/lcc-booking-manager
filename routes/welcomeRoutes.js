const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ===========================
// Multer (upload images)
// ===========================
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'welcome-books');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (err) {
      console.error('Error creating upload directory:', err);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = allowed.test((file.mimetype || '').toLowerCase());
  if (mimeOk && extOk) return cb(null, true);
  cb(new Error('Seules les images sont acceptées (JPEG, PNG, GIF, WebP)'));
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

// ===========================
// Auth middleware
// Cookie token OU Bearer token
// ===========================
function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = (req.cookies && req.cookies.token) ? req.cookies.token : bearerToken;

  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// ===========================
// DB init
// ===========================
const initWelcomeBookTables = async (pool) => {
  const queries = [
    `
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
    `,
    `
    CREATE TABLE IF NOT EXISTS welcome_book_rooms (
      id SERIAL PRIMARY KEY,
      welcome_book_id INTEGER NOT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `,
    `
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
    `,
    `
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
    `,
    `
    CREATE TABLE IF NOT EXISTS welcome_book_places (
      id SERIAL PRIMARY KEY,
      welcome_book_id INTEGER NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      photo_url VARCHAR(500),
      display_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `
  ];

  for (const q of queries) {
    await pool.query(q);
  }
};

// ===========================
// POST /create (private)
// ===========================
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
      propertyName, welcomeDescription, contactPhone,
      address, postalCode, city, keyboxCode,
      accessInstructions, parkingInfo,
      wifiSSID, wifiPassword,
      checkoutTime, checkoutInstructions,
      equipmentList, importantRules,
      transportInfo, shopsList,
      rooms, restaurants, places
    } = req.body;

    const uniqueId = crypto.randomBytes(16).toString('hex');

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
      req.userId, uniqueId, propertyName, welcomeDescription, contactPhone,
      address, postalCode, city, keyboxCode, accessInstructions,
      parkingInfo, wifiSSID, wifiPassword, checkoutTime,
      checkoutInstructions, equipmentList, importantRules,
      transportInfo, shopsList
    ]);

    const welcomeBookId = welcomeBookResult.rows[0].id;
    const files = req.files || {};

    // Cover
    if (files.coverPhoto && files.coverPhoto[0]) {
      const photoUrl = `/uploads/welcome-books/${files.coverPhoto[0].filename}`;
      await client.query(
        'INSERT INTO welcome_book_photos (welcome_book_id, photo_type, photo_url) VALUES ($1, $2, $3)',
        [welcomeBookId, 'cover', photoUrl]
      );
      await client.query('UPDATE welcome_books SET cover_photo = $1 WHERE id = $2', [photoUrl, welcomeBookId]);
    }

    // Entrance
    if (files.entrancePhotos) {
      for (let i = 0; i < files.entrancePhotos.length; i++) {
        const photoUrl = `/uploads/welcome-books/${files.entrancePhotos[i].filename}`;
        await client.query(
          'INSERT INTO welcome_book_photos (welcome_book_id, photo_type, photo_url, display_order) VALUES ($1, $2, $3, $4)',
          [welcomeBookId, 'entrance', photoUrl, i]
        );
      }
    }

    // Parking
    if (files.parkingPhotos) {
      for (let i = 0; i < files.parkingPhotos.length; i++) {
        const photoUrl = `/uploads/welcome-books/${files.parkingPhotos[i].filename}`;
        await client.query(
          'INSERT INTO welcome_book_photos (welcome_book_id, photo_type, photo_url, display_order) VALUES ($1, $2, $3, $4)',
          [welcomeBookId, 'parking', photoUrl, i]
        );
      }
    }

    // Rooms
    if (rooms) {
      const roomsArray = typeof rooms === 'string' ? JSON.parse(rooms) : (Array.isArray(rooms) ? rooms : [rooms]);
      for (let i = 0; i < roomsArray.length; i++) {
        const room = typeof roomsArray[i] === 'string' ? JSON.parse(roomsArray[i]) : roomsArray[i];
        const roomRes = await client.query(
          'INSERT INTO welcome_book_rooms (welcome_book_id, name, description, display_order) VALUES ($1, $2, $3, $4) RETURNING id',
          [welcomeBookId, room.name || '', room.description || '', i]
        );
        const roomId = roomRes.rows[0]?.id;

        // Associate room photos (we can't reliably map which photo belongs to which room with current frontend payload)
        // So we store them as generic "room" photos without room_id for now.
        // If you later send room-specific fieldnames, we can attach them.
        if (files.roomPhotos) {
          // only once (avoid duplicates)
          // We'll add all room photos as type 'room' (room_id null)
          // and delete from files.roomPhotos after first loop
          for (let j = 0; j < files.roomPhotos.length; j++) {
            const photoUrl = `/uploads/welcome-books/${files.roomPhotos[j].filename}`;
            await client.query(
              'INSERT INTO welcome_book_photos (welcome_book_id, room_id, photo_type, photo_url, display_order) VALUES ($1, $2, $3, $4, $5)',
              [welcomeBookId, null, 'room', photoUrl, j]
            );
          }
          delete files.roomPhotos;
        }
      }
    }

    // Restaurants
    if (restaurants) {
      const restaurantsArray = typeof restaurants === 'string' ? JSON.parse(restaurants) : (Array.isArray(restaurants) ? restaurants : [restaurants]);
      for (let i = 0; i < restaurantsArray.length; i++) {
        const r = typeof restaurantsArray[i] === 'string' ? JSON.parse(restaurantsArray[i]) : restaurantsArray[i];
        await client.query(
          'INSERT INTO welcome_book_restaurants (welcome_book_id, name, phone, address, description, display_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [welcomeBookId, r.name || '', r.phone || '', r.address || '', r.description || '', i]
        );
      }
    }

    // Places
    if (places) {
      const placesArray = typeof places === 'string' ? JSON.parse(places) : (Array.isArray(places) ? places : [places]);
      for (let i = 0; i < placesArray.length; i++) {
        const p = typeof placesArray[i] === 'string' ? JSON.parse(placesArray[i]) : placesArray[i];
        await client.query(
          'INSERT INTO welcome_book_places (welcome_book_id, name, description, photo_url, display_order) VALUES ($1, $2, $3, $4, $5)',
          [welcomeBookId, p.name || '', p.description || '', null, i]
        );
      }
    }

    await client.query('COMMIT');

    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      message: "Livret d'accueil créé avec succès",
      welcomeBookId,
      uniqueId,
      url: `${base}/welcome/${uniqueId}`, // ✅ HTML route (déjà présente dans server.js)
      apiUrl: `${base}/api/welcome-books/public/${uniqueId}` // ✅ JSON public
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur lors de la création du livret:', err);
    res.status(500).json({ success: false, error: "Erreur lors de la création du livret d'accueil" });
  } finally {
    client.release();
  }
});

// ===========================
// GET /user/list (private)
// ===========================
router.get('/user/list', authenticateUser, async (req, res) => {
  try {
    const q = `
      SELECT id, unique_id, property_name, cover_photo, created_at, updated_at
      FROM welcome_books
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const result = await req.app.locals.pool.query(q, [req.userId]);
    res.json({ success: true, welcomeBooks: result.rows });
  } catch (err) {
    console.error('Erreur récupération livrets:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération des livrets' });
  }
});

// ===========================
// DELETE /:id (private)
// ===========================
router.delete('/:id', authenticateUser, async (req, res) => {
  const client = await req.app.locals.pool.connect();
  try {
    const { id } = req.params;

    const check = await client.query('SELECT id FROM welcome_books WHERE id = $1 AND user_id = $2', [id, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Livret non trouvé ou accès non autorisé' });

    await client.query('BEGIN');
    await client.query('DELETE FROM welcome_book_photos WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_book_rooms WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_book_restaurants WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_book_places WHERE welcome_book_id = $1', [id]);
    await client.query('DELETE FROM welcome_books WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({ success: true, message: "Livret d'accueil supprimé avec succès" });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur suppression livret:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la suppression du livret' });
  } finally {
    client.release();
  }
});

// ===========================
// GET /public/:uniqueId (public JSON)
// ===========================
router.get('/public/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    const bookRes = await req.app.locals.pool.query('SELECT * FROM welcome_books WHERE unique_id = $1', [uniqueId]);
    if (bookRes.rows.length === 0) return res.status(404).json({ error: 'Livret introuvable' });

    const book = bookRes.rows[0];

    const [photosRes, roomsRes, restaurantsRes, placesRes] = await Promise.all([
      req.app.locals.pool.query('SELECT * FROM welcome_book_photos WHERE welcome_book_id = $1 ORDER BY photo_type, display_order', [book.id]),
      req.app.locals.pool.query('SELECT * FROM welcome_book_rooms WHERE welcome_book_id = $1 ORDER BY display_order', [book.id]),
      req.app.locals.pool.query('SELECT * FROM welcome_book_restaurants WHERE welcome_book_id = $1 ORDER BY display_order', [book.id]),
      req.app.locals.pool.query('SELECT * FROM welcome_book_places WHERE welcome_book_id = $1 ORDER BY display_order', [book.id])
    ]);

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

module.exports = { router, initWelcomeBookTables };
