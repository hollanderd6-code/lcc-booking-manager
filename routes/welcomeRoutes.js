const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;

/**
 * CLOUDINARY CONFIGURATION
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---------- Multer (memory storage for Cloudinary) ----------
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(file.originalname.toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Seules les images sont acceptées (JPEG, PNG, GIF, WebP)'));
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

// Helper: Upload to Cloudinary
async function uploadToCloudinary(fileBuffer, folder = 'welcome-books') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    uploadStream.end(fileBuffer);
  });
}
// ---------- Auth (Cookie token OR Bearer token) ----------
function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = (req.cookies && req.cookies.token) ? req.cookies.token : null;
  const token = cookieToken || bearerToken;

  if (!token) return res.status(401).json({ error: 'Non authentifiÃ©' });

  try {
    // IMPORTANT : On ajoute le fallback pour correspondre Ã  server-22.js
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const decoded = jwt.verify(token, secret);
    
    // IMPORTANT : On utilise 'id' et pas 'userId' car c'est le nom dans le token
    req.userId = String(decoded.id); 
    next();
  } catch (error) {
    console.error("Erreur Auth:", error.message);
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// ---------- Optional: keep initializer (does nothing for jsonb schema) ----------
const initWelcomeBookTables = async (_pool) => {
  // You can keep this for backward compatibility. Your current schema is jsonb-based.
  return;
};

// ---------- Helpers ----------
function safeJsonParse(val, fallback) {
  try {
    if (typeof val === 'string') return JSON.parse(val);
    if (val === undefined || val === null) return fallback;
    return val;
  } catch {
    return fallback;
  }
}

// Helper: Upload single file to Cloudinary
async function uploadFile(file) {
  if (!file || !file.buffer) return null;
  try {
    return await uploadToCloudinary(file.buffer);
  } catch (error) {
    console.error('Error uploading file:', error);
    return null;
  }
}

// Helper: Upload multiple files to Cloudinary
async function uploadFiles(files) {
  if (!files || files.length === 0) return [];
  const uploadPromises = files.map(file => uploadFile(file));
  const results = await Promise.all(uploadPromises);
  return results.filter(Boolean);
}
// ---------- RÃ©cupÃ©rer mon livret (pour modification) ----------
router.get('/my-book', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    
    // On cherche le livret de l'utilisateur connectÃ©
    const result = await pool.query(
      `SELECT data FROM welcome_books_v2 WHERE user_id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      // Pas encore de livret, on renvoie vide mais succÃ¨s
      return res.json({ success: true, exists: false });
    }

    // On renvoie les donnÃ©es JSON stockÃ©es
    res.json({ 
      success: true, 
      exists: true, 
      data: result.rows[0].data 
    });

  } catch (error) {
    console.error('Erreur rÃ©cupÃ©ration livret:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});
// ---------- CREATE OR UPDATE (CORRIGÃ‰) ----------
router.post('/create', authenticateUser, upload.fields([
  { name: 'coverPhoto', maxCount: 1 },
  { name: 'entrancePhotos', maxCount: 10 },
  { name: 'parkingPhotos', maxCount: 5 },
  { name: 'roomPhotos', maxCount: 50 },
  { name: 'placePhotos', maxCount: 20 }
]), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    console.log("ðŸ“¥ Tentative de sauvegarde reÃ§ue..."); // Log de debug

    // 1. RÃ©cupÃ©ration de l'ID existant
    const existingCheck = await pool.query(
      'SELECT unique_id, data FROM public.welcome_books_v2 WHERE user_id = $1 LIMIT 1',
      [req.userId]
    );

    let uniqueId;
    let oldPhotos = {};

    if (existingCheck.rows.length > 0) {
      const row = existingCheck.rows[0] || {};
      const oldData = row.data || {};
      uniqueId = row.unique_id || oldData.uniqueId;
      oldPhotos = oldData.photos || {};

      // Si, pour une raison quelconque, l'ID n'est pas récupéré, on en génère un nouveau
      if (!uniqueId) uniqueId = crypto.randomBytes(16).toString('hex');

      console.log(`♻️ Mise à jour du livret existant : ${uniqueId}`);
    } else {
      uniqueId = crypto.randomBytes(16).toString('hex');
      console.log(`✨ Création nouveau livret : ${uniqueId}`);
    }
      console.log(`â™»ï¸ Mise Ã  jour du livret existant : ${uniqueId}`);
    } else {
      uniqueId = crypto.randomBytes(16).toString('hex');
      console.log(`âœ¨ CrÃ©ation nouveau livret : ${uniqueId}`);
    }

    const body = req.body || {};
    const files = req.files || {};

    // --- CORRECTION CRITIQUE ICI : Parsing manuel et sÃ©curisÃ© ---
    const parseJSON = (input) => {
      if (!input) return [];
      try {
        return typeof input === 'string' ? JSON.parse(input) : input;
      } catch (e) {
        console.error("Erreur parsing JSON:", e.message);
        return [];
      }
    };

    const rooms = parseJSON(body.rooms);
    const restaurants = parseJSON(body.restaurants);
    const places = parseJSON(body.places);
    // ------------------------------------------------------------

    // Gestion des photos (Upload vers Cloudinary)
    const photos = {
      cover: (files.coverPhoto && files.coverPhoto[0]) 
        ? await uploadFile(files.coverPhoto[0]) || oldPhotos.cover 
        : oldPhotos.cover,
      entrance: (files.entrancePhotos && files.entrancePhotos.length > 0) 
        ? await uploadFiles(files.entrancePhotos) 
        : (oldPhotos.entrance || []),
      parking: (files.parkingPhotos && files.parkingPhotos.length > 0) 
        ? await uploadFiles(files.parkingPhotos) 
        : (oldPhotos.parking || []),
      roomPhotos: (files.roomPhotos && files.roomPhotos.length > 0) 
        ? await uploadFiles(files.roomPhotos) 
        : (oldPhotos.roomPhotos || []),
      placePhotos: (files.placePhotos && files.placePhotos.length > 0) 
        ? await uploadFiles(files.placePhotos) 
        : (oldPhotos.placePhotos || []),
    };

    // Construction des donnÃ©es
    // On force la lecture du titre (parfois nommÃ© 'propertyName', parfois 'title')
    const propertyName = body.propertyName || body.title || "Mon Logement";

    const data = {
      uniqueId,
      propertyName, // Le titre corrigÃ©
      welcomeDescription: body.welcomeDescription || '',
      contactPhone: body.contactPhone || '',
      address: body.address || '',
      postalCode: body.postalCode || '',
      city: body.city || '',
      keyboxCode: body.keyboxCode || '',
      accessInstructions: body.accessInstructions || '',
      parkingInfo: body.parkingInfo || '',
      wifiSSID: body.wifiSSID || '',
      wifiPassword: body.wifiPassword || '',
      checkoutTime: body.checkoutTime || '',
      checkoutInstructions: body.checkoutInstructions || '',
      importantRules: body.importantRules || '',
      equipmentList: body.equipmentList || '',
      transportInfo: body.transportInfo || '',
      shopsList: body.shopsList || '',
      
      rooms,
      restaurants,
      places,
      photos,
      
      updatedAt: new Date().toISOString()
    };

    // Insert OU Mise Ã  jour si Ã§a existe dÃ©jÃ 
    await pool.query(
      `INSERT INTO public.welcome_books_v2 (user_id, unique_id, property_name, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
       ON CONFLICT (unique_id) DO UPDATE 
       SET data = EXCLUDED.data,
           property_name = EXCLUDED.property_name,
           updated_at = NOW()`,
      [req.userId, uniqueId, propertyName, JSON.stringify(data)]
    );

    console.log("âœ… Sauvegarde rÃ©ussie en base de donnÃ©es !");

    const host = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    
    // Retourne la bonne URL HTML
    res.json({
      success: true,
      message: "Livret sauvegardÃ© !",
      uniqueId,
      url: `${host}/welcome/${uniqueId}`
    });

  } catch (error) {
    console.error('âŒ CRASH lors de la sauvegarde:', error);
    res.status(500).json({ success: false, error: "Erreur serveur lors de la sauvegarde" });
  }
});

// ---------- LIST (user) ----------
router.get('/user/list', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant (app.locals.pool)' });

    const result = await pool.query(
      `SELECT unique_id, property_name, data->>'coverPhoto' as cover_photo, updated_at
       FROM public.welcome_books_v2
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );

    // Return a compact list for UI
    const welcomeBooks = result.rows.map(r => {
      return {
        uniqueId: r.unique_id,
        propertyName: r.property_name || '',
        coverPhoto: r.cover_photo || null,
        updatedAt: r.updated_at,
      };
    });

    res.json({ success: true, welcomeBooks });
  } catch (error) {
    console.error('Erreur lors de la rÃ©cupÃ©ration des livrets:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la rÃ©cupÃ©ration des livrets' });
  }
});

// ---------- DELETE (by uniqueId, scoped to user) ----------
router.delete('/by-unique/:uniqueId', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant (app.locals.pool)' });

    const { uniqueId } = req.params;

    const del = await pool.query(
      `DELETE FROM public.welcome_books_v2
       WHERE user_id = $1 AND unique_id = $2
       RETURNING 1`,
      [req.userId, uniqueId]
    );

    if (del.rowCount === 0) return res.status(404).json({ success: false, error: 'Livret introuvable ou non autorisÃ©' });

    res.json({ success: true, message: "Livret d'accueil supprimÃ© avec succÃ¨s" });
  } catch (error) {
    console.error('Erreur lors de la suppression du livret:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la suppression du livret' });
  }
});

// ---------- PUBLIC GET (no auth) ----------
router.get('/public/:uniqueId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ error: 'Pool DB manquant (app.locals.pool)' });

    const { uniqueId } = req.params;

    const bookRes = await pool.query(
      `SELECT user_id, data, updated_at
       FROM public.welcome_books_v2
       WHERE unique_id = $1
       LIMIT 1`,
      [uniqueId]
    );

    if (bookRes.rows.length === 0) return res.status(404).json({ error: 'Livret introuvable' });

    res.json({ success: true, book: bookRes.rows[0].data, updatedAt: bookRes.rows[0].updated_at });
  } catch (e) {
    console.error('PUBLIC welcome error:', e);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

module.exports = { router, initWelcomeBookTables };
