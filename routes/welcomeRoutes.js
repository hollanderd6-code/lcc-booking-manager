const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * IMPORTANT
 * Your DB table public.welcome_books currently has only:
 * - user_id (text)
 * - data (jsonb)
 * - updated_at (timestamptz)
 *
 * So we store the whole welcome book in data (jsonb), keyed by data.uniqueId.
 */

// ---------- Multer (uploads to /public/uploads/welcome-books) ----------
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'welcome-books');
    try { await fs.mkdir(uploadDir, { recursive: true }); } catch (err) { console.error('Error creating upload directory:', err); }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Seules les images sont acceptées (JPEG, PNG, GIF, WebP)'));
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});
// ---------- Auth (Cookie token OR Bearer token) ----------
function authenticateUser(req, res, next) {
  // On récupère le header d'autorisation (gère minuscules/majuscules)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  
  // On extrait le token s'il commence par "Bearer "
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  
  // On regarde aussi dans les cookies au cas où
  const cookieToken = (req.cookies && req.cookies.token) ? req.cookies.token : null;
  
  // On prend celui qu'on trouve
  const token = cookieToken || bearerToken;

  if (!token) {
    console.log('❌ Auth Welcome: Aucun token trouvé');
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    // CORRECTION 1 : On ajoute le MEME fallback que dans server-22.js
    // Sinon, si JWT_SECRET n'est pas dans le .env, la vérification échoue.
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    
    const decoded = jwt.verify(token, secret);
    
    // CORRECTION 2 : Dans server-22.js, le token est signé avec { id: ... }
    // On doit donc lire decoded.id et non decoded.userId
    req.userId = String(decoded.id);
    
    next();
  } catch (error) {
    console.error('❌ Auth Welcome Error:', error.message);
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

function fileUrl(file) {
  return file ? `/uploads/welcome-books/${file.filename}` : null;
}

function filesUrls(files) {
  return (files || []).map(f => fileUrl(f)).filter(Boolean);
}
// ---------- Récupérer mon livret (pour modification) ----------
router.get('/my-book', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    
    // On cherche le livret de l'utilisateur connecté
    const result = await pool.query(
      `SELECT data FROM welcome_books WHERE user_id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      // Pas encore de livret, on renvoie vide mais succès
      return res.json({ success: true, exists: false });
    }

    // On renvoie les données JSON stockées
    res.json({ 
      success: true, 
      exists: true, 
      data: result.rows[0].data 
    });

  } catch (error) {
    console.error('Erreur récupération livret:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});
// ---------- CREATE OR UPDATE ----------
router.post('/create', authenticateUser, upload.fields([
  { name: 'coverPhoto', maxCount: 1 },
  { name: 'entrancePhotos', maxCount: 10 },
  { name: 'parkingPhotos', maxCount: 5 },
  { name: 'roomPhotos', maxCount: 50 },
  { name: 'placePhotos', maxCount: 20 }
]), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant' });

    // 1. Vérifier si un livret existe déjà pour récupérer son uniqueId
    const existingCheck = await pool.query(
      'SELECT data FROM public.welcome_books WHERE user_id = $1',
      [req.userId]
    );

    let uniqueId;
    let oldPhotos = {};

    if (existingCheck.rows.length > 0) {
      // Le livret existe déjà : On garde le MEME ID
      const oldData = existingCheck.rows[0].data || {};
      uniqueId = oldData.uniqueId; 
      oldPhotos = oldData.photos || {}; // On garde aussi les anciennes photos pour ne pas les perdre si on n'en renvoie pas
      console.log(`Mise à jour du livret existant : ${uniqueId}`);
    } else {
      // Nouveau livret : On génère un nouvel ID
      uniqueId = crypto.randomBytes(16).toString('hex');
      console.log(`Création d'un nouveau livret : ${uniqueId}`);
    }

    const body = req.body || {};
    const files = req.files || {};

    const rooms = safeJsonParse(body.rooms, []);
    const restaurants = safeJsonParse(body.restaurants, []);
    const places = safeJsonParse(body.places, []);

    // Gestion des photos : Si une nouvelle photo est envoyée, on la prend. Sinon on garde l'ancienne.
    const photos = {
      cover: (files.coverPhoto && files.coverPhoto[0]) ? fileUrl(files.coverPhoto[0]) : oldPhotos.cover,
      entrance: (files.entrancePhotos && files.entrancePhotos.length > 0) ? filesUrls(files.entrancePhotos) : (oldPhotos.entrance || []),
      parking: (files.parkingPhotos && files.parkingPhotos.length > 0) ? filesUrls(files.parkingPhotos) : (oldPhotos.parking || []),
      // Pour les pièces et lieux, on remplace souvent tout ou on ajoute, ici on simplifie en prenant les nouvelles si dispos
      roomPhotos: (files.roomPhotos && files.roomPhotos.length > 0) ? filesUrls(files.roomPhotos) : (oldPhotos.roomPhotos || []),
      placePhotos: (files.placePhotos && files.placePhotos.length > 0) ? filesUrls(files.placePhotos) : (oldPhotos.placePhotos || []),
    };

    // Construction de l'objet de données
    const data = {
      uniqueId, // On utilise l'ID stable
      propertyName: body.propertyName || '',
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
      equipmentList: body.equipmentList || '',
      importantRules: body.importantRules || '',
      transportInfo: body.transportInfo || '',
      shopsList: body.shopsList || '',

      rooms,
      restaurants,
      places,
      photos, // Les photos mixées (anciennes/nouvelles)

      createdAt: existingCheck.rows.length > 0 ? (existingCheck.rows[0].data.createdAt) : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Sauvegarde en base (UPSERT)
    await pool.query(
      `INSERT INTO public.welcome_books (user_id, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET data = EXCLUDED.data,
           updated_at = NOW()`,
      [req.userId, JSON.stringify(data)]
    );

    const host = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    
    // IMPORTANT : On renvoie la bonne URL HTML (pas l'API)
    res.json({
      success: true,
      message: "Livret d'accueil sauvegardé avec succès",
      uniqueId,
      url: `${host}/welcome/${uniqueId}` 
    });

  } catch (error) {
    console.error('Erreur lors de la sauvegarde du livret:', error);
    res.status(500).json({ success: false, error: "Erreur serveur lors de la sauvegarde" });
  }
});

// ---------- LIST (user) ----------
router.get('/user/list', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant (app.locals.pool)' });

    const result = await pool.query(
      `SELECT user_id, data, updated_at
       FROM public.welcome_books
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );

    // Return a compact list for UI
    const welcomeBooks = result.rows.map(r => {
      const d = r.data || {};
      return {
        uniqueId: d.uniqueId,
        propertyName: d.propertyName || '',
        coverPhoto: d.photos && d.photos.cover ? d.photos.cover : null,
        updatedAt: r.updated_at,
      };
    });

    res.json({ success: true, welcomeBooks });
  } catch (error) {
    console.error('Erreur lors de la récupération des livrets:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération des livrets' });
  }
});

// ---------- DELETE (by uniqueId, scoped to user) ----------
router.delete('/by-unique/:uniqueId', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant (app.locals.pool)' });

    const { uniqueId } = req.params;

    const del = await pool.query(
      `DELETE FROM public.welcome_books
       WHERE user_id = $1 AND data->>'uniqueId' = $2
       RETURNING 1`,
      [req.userId, uniqueId]
    );

    if (del.rowCount === 0) return res.status(404).json({ success: false, error: 'Livret introuvable ou non autorisé' });

    res.json({ success: true, message: "Livret d'accueil supprimé avec succès" });
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
       FROM public.welcome_books
       WHERE data->>'uniqueId' = $1
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
