'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(file.originalname.toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Seules les images sont acceptees (JPEG, PNG, GIF, WebP)'));
};

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE_BYTES }, fileFilter });

function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'file_too_large',
        message: `Fichier trop lourd. Taille maximale : ${MAX_FILE_SIZE_MB} Mo par image.`,
        maxSize: MAX_FILE_SIZE_BYTES, maxSizeMB: MAX_FILE_SIZE_MB,
      });
    }
    return res.status(400).json({ error: 'upload_error', message: err.message, code: err.code });
  }
  if (err && err.message && err.message.includes('images sont acceptees')) {
    return res.status(400).json({ error: 'invalid_file_type', message: err.message });
  }
  if (err) return next(err);
  next();
}

async function uploadToCloudinary(fileBuffer, folder = 'welcome-books') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error, result) => { if (error) reject(error); else resolve(result.secure_url); }
    );
    uploadStream.end(fileBuffer);
  });
}

function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = (req.cookies && req.cookies.token) ? req.cookies.token : null;
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ error: 'Non authentifie' });
  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const decoded = jwt.verify(token, secret);
    req.userId = String(decoded.id);
    next();
  } catch (error) {
    console.error('Erreur Auth:', error.message);
    return res.status(401).json({ error: 'Token invalide' });
  }
}

const initWelcomeBookTables = async (_pool) => {};

async function getAgencyUserIds(req, userId) {
  if (req.query.agency !== 'all') return [userId];
  try {
    const pool = req.app.locals.pool;
    const delegations = await pool.query(
      `SELECT delegator_user_id FROM account_delegations WHERE delegate_user_id = $1 AND status = 'accepted'`,
      [userId]
    );
    return [userId, ...delegations.rows.map(d => d.delegator_user_id)];
  } catch(e) { return [userId]; }
}

function safeJsonParse(val, fallback) {
  try {
    if (typeof val === 'string') return JSON.parse(val);
    if (val === undefined || val === null) return fallback;
    return val;
  } catch { return fallback; }
}

async function uploadFile(file) {
  if (!file || !file.buffer) return null;
  try { return await uploadToCloudinary(file.buffer); }
  catch (error) { console.error('Error uploading file:', error); return null; }
}

async function uploadFiles(files) {
  if (!files || files.length === 0) return [];
  const results = await Promise.all(files.map(f => uploadFile(f)));
  return results.filter(Boolean);
}

function getBaseUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

// ── Helpers pour la valeur non-vide ──────────────────────────────────────────
function nonEmpty(s) {
  return (s !== null && s !== undefined && String(s).trim() !== '');
}

// ---------- GET /my-book ----------
router.get('/my-book', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const agencyIds = await getAgencyUserIds(req, req.userId);
    const result = await pool.query(
      `SELECT unique_id, data
       FROM welcome_books_v2
       WHERE user_id = ANY($1::text[])
       ORDER BY (data->>'sortOrder')::int ASC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [agencyIds]
    );
    if (result.rows.length === 0) return res.json({ success: true, exists: false });
    res.json({ success: true, exists: true,
      data: { ...(result.rows[0].data || {}), uniqueId: result.rows[0].unique_id } });
  } catch (error) {
    console.error('Erreur recuperation livret:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ---------- GET /by-property/:propertyId ----------
router.get('/by-property/:propertyId', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { propertyId } = req.params;
    const agencyIds = await getAgencyUserIds(req, req.userId);

    // Vérifier l'accès au logement
    const propCheck = await pool.query(
      'SELECT id, welcome_book_url FROM properties WHERE id = $1 AND user_id = ANY($2::text[]) LIMIT 1',
      [propertyId, agencyIds]
    );
    if (propCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Acces refuse a ce logement' });
    }

    const baseUrl = getBaseUrl(req);

    // 1. Chercher par property_id direct
    const byProp = await pool.query(
      `SELECT wb.unique_id, wb.data, wb.updated_at, wb.user_id
       FROM welcome_books_v2 wb
       WHERE wb.property_id = $1 LIMIT 1`,
      [propertyId]
    );
    if (byProp.rows.length > 0) {
      const row = byProp.rows[0];
      return res.json({
        success: true, exists: true,
        uniqueId: row.unique_id,
        propertyId,
        publicUrl: `${baseUrl}/welcome/${row.unique_id}`,
        data: row.data,
        updatedAt: row.updated_at,
      });
    }

    // 2. Fallback legacy via welcome_book_url
    const wbUrl = propCheck.rows[0].welcome_book_url;
    if (wbUrl) {
      const m = String(wbUrl).match(/\/welcome\/([a-zA-Z0-9_-]+)/);
      if (m) {
        const legacyUniqueId = m[1];
        const legacyBook = await pool.query(
          `SELECT wb.unique_id, wb.data, wb.updated_at, wb.user_id, wb.property_id
           FROM welcome_books_v2 wb
           WHERE wb.unique_id = $1 LIMIT 1`,
          [legacyUniqueId]
        );
        if (legacyBook.rows.length > 0) {
          const row = legacyBook.rows[0];
          // Vérifier ownership
          if (!agencyIds.includes(String(row.user_id))) {
            return res.status(403).json({ success: false, error: 'Acces refuse' });
          }
          // Rattachement opportuniste si pas encore lié
          if (!row.property_id) {
            try {
              await pool.query(
                `UPDATE welcome_books_v2 SET property_id = $1 WHERE unique_id = $2 AND property_id IS NULL`,
                [propertyId, legacyUniqueId]
              );
            } catch(_) {}
          }
          return res.json({
            success: true, exists: true,
            uniqueId: row.unique_id,
            propertyId,
            publicUrl: `${baseUrl}/welcome/${row.unique_id}`,
            data: row.data,
            updatedAt: row.updated_at,
            legacyLink: true,
          });
        }
      }
    }

    // 3. Aucun livret
    return res.json({ success: true, exists: false, propertyId });

  } catch (error) {
    console.error('Erreur by-property:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ---------- CREATE OR UPDATE (property-aware) ----------
router.post(
  '/create',
  authenticateUser,
  (req, res, next) => upload.any()(req, res, (err) => err ? handleUploadErrors(err, req, res, next) : next()),
  async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    console.log('Tentative de sauvegarde recue...');

    const clientUniqueId = req.body?.uniqueId || req.body?.unique_id || null;
    const propertyId     = req.body?.propertyId || req.body?.property_id || null;

    let uniqueId;
    let oldPhotos  = {};
    let resolvedPropertyId = null;

    const agencyIds = await getAgencyUserIds(req, req.userId);

    if (propertyId) {
      // ── Mode property-aware ──────────────────────────────────────────────
      const propCheck = await pool.query(
        'SELECT id, welcome_book_url FROM properties WHERE id = $1 AND user_id = ANY($2::text[]) LIMIT 1',
        [propertyId, agencyIds]
      );
      if (propCheck.rows.length === 0) {
        return res.status(403).json({ success: false, error: 'Acces refuse a ce logement' });
      }

      // Anti-IDOR : si le client envoie aussi un uniqueId, vérifier cohérence
      if (clientUniqueId) {
        const uidCheck = await pool.query(
          'SELECT unique_id, property_id FROM welcome_books_v2 WHERE unique_id = $1 AND user_id = ANY($2::text[]) LIMIT 1',
          [clientUniqueId, agencyIds]
        );
        if (uidCheck.rows.length === 0) {
          return res.status(403).json({ success: false, error: 'Livret introuvable ou acces refuse' });
        }
        const linked = uidCheck.rows[0].property_id;
        if (linked && linked !== propertyId) {
          return res.status(400).json({ success: false, error: 'Ce livret appartient a un autre logement' });
        }
      }

      // Chercher un livret déjà lié à ce logement
      const existingByProp = await pool.query(
        'SELECT unique_id, data FROM welcome_books_v2 WHERE property_id = $1 LIMIT 1',
        [propertyId]
      );
      if (existingByProp.rows.length > 0) {
        uniqueId   = existingByProp.rows[0].unique_id;
        oldPhotos  = existingByProp.rows[0].data?.photos || {};
        resolvedPropertyId = propertyId;
        console.log(`Livret existant pour property ${propertyId} : ${uniqueId}`);
      } else if (clientUniqueId) {
        uniqueId   = clientUniqueId;
        const oldRes = await pool.query('SELECT data FROM welcome_books_v2 WHERE unique_id = $1', [uniqueId]);
        if (oldRes.rows.length > 0) oldPhotos = oldRes.rows[0].data?.photos || {};
        resolvedPropertyId = propertyId;
      } else {
        uniqueId = crypto.randomBytes(16).toString('hex');
        resolvedPropertyId = propertyId;
        console.log(`Nouveau livret pour property ${propertyId} : ${uniqueId}`);
      }

    } else if (clientUniqueId) {
      // ── Mode edition legacy ───────────────────────────────────────────────
      const existingCheck = await pool.query(
        'SELECT id, unique_id, data, property_id FROM public.welcome_books_v2 WHERE user_id = ANY($1::text[]) AND unique_id = $2 LIMIT 1',
        [agencyIds, clientUniqueId]
      );
      uniqueId = clientUniqueId;
      if (existingCheck.rows.length > 0) {
        oldPhotos = existingCheck.rows[0].data?.photos || {};
        resolvedPropertyId = existingCheck.rows[0].property_id || null;
        console.log(`Mise a jour du livret existant : ${uniqueId}`);
      }
    } else {
      // ── Mode creation simple ─────────────────────────────────────────────
      uniqueId = crypto.randomBytes(16).toString('hex');
      console.log(`Creation nouveau livret : ${uniqueId}`);
    }

    const body = req.body || {};
    const filesRaw = req.files || [];
    const files = {};
    filesRaw.forEach(f => { if (!files[f.fieldname]) files[f.fieldname] = []; files[f.fieldname].push(f); });

    const parseJSON = (input) => {
      if (!input) return [];
      try { return typeof input === 'string' ? JSON.parse(input) : input; }
      catch (e) { console.error('Erreur parsing JSON:', e.message); return []; }
    };

    const rooms       = parseJSON(body.rooms);
    const restaurants = parseJSON(body.restaurants);
    const places      = parseJSON(body.places);

    const roomPhotosPerRoom = {};
    for (const [fieldname, fieldFiles] of Object.entries(files)) {
      if (fieldname.startsWith('roomPhotos_')) {
        const idx = fieldname.replace('roomPhotos_', '');
        roomPhotosPerRoom[idx] = await uploadFiles(fieldFiles);
      }
    }

    const transportPhotos      = files.transportPhotos      ? await uploadFiles(files.transportPhotos)      : (oldPhotos.transportPhotos      || []);
    const extraPhotosAccess    = files.extraPhotosAccess    ? await uploadFiles(files.extraPhotosAccess)    : (oldPhotos.extraPhotosAccess    || []);
    const extraPhotosLogement  = files.extraPhotosLogement  ? await uploadFiles(files.extraPhotosLogement)  : (oldPhotos.extraPhotosLogement  || []);
    const extraPhotosPractical = files.extraPhotosPractical ? await uploadFiles(files.extraPhotosPractical) : (oldPhotos.extraPhotosPractical || []);
    const extraPhotosAround    = files.extraPhotosAround    ? await uploadFiles(files.extraPhotosAround)    : (oldPhotos.extraPhotosAround    || []);

    const photos = {
      cover:    (files.coverPhoto && files.coverPhoto[0]) ? await uploadFile(files.coverPhoto[0]) || oldPhotos.cover : oldPhotos.cover,
      entrance: (files.entrancePhotos && files.entrancePhotos.length > 0) ? await uploadFiles(files.entrancePhotos) : (oldPhotos.entrance || []),
      parking:  (files.parkingPhotos  && files.parkingPhotos.length  > 0) ? await uploadFiles(files.parkingPhotos)  : (oldPhotos.parking  || []),
      roomPhotos: (files.roomPhotos && files.roomPhotos.length > 0) ? await uploadFiles(files.roomPhotos) : (oldPhotos.roomPhotos || []),
      roomPhotosPerRoom: { ...(oldPhotos.roomPhotosPerRoom || {}), ...roomPhotosPerRoom },
      placePhotos: (files.placePhotos && files.placePhotos.length > 0) ? await uploadFiles(files.placePhotos) : (oldPhotos.placePhotos || []),
      transportPhotos, extraPhotosAccess, extraPhotosLogement, extraPhotosPractical, extraPhotosAround,
    };

    const propertyName = body.propertyName || body.title || "Mon Logement";

    const data = {
      uniqueId,
      propertyName,
      isDraft:              body.isDraft === 'true',
      lastSection:          parseInt(body.lastSection) || 0,
      welcomeDescription:   body.welcomeDescription   || '',
      contactPhone:         body.contactPhone          || '',
      address:              body.address               || '',
      postalCode:           body.postalCode            || '',
      city:                 body.city                  || '',
      keyboxCode:           body.keyboxCode            || '',
      accessInstructions:   body.accessInstructions    || '',
      parkingInfo:          body.parkingInfo           || '',
      wifiSSID:             body.wifiSSID              || '',
      wifiPassword:         body.wifiPassword          || '',
      checkinTime:          body.checkinTime           || '',
      checkoutTime:         body.checkoutTime          || '',
      checkoutInstructions: body.checkoutInstructions  || '',
      importantRules:       body.importantRules        || '',
      equipmentList:        body.equipmentList         || '',
      transportInfo:        body.transportInfo         || '',
      shopsList:            body.shopsList             || '',
      rooms, restaurants, places, photos,
      extraNotesAccess:     body.extraNotesAccess      || '',
      extraNotesLogement:   body.extraNotesLogement    || '',
      extraNotesPractical:  body.extraNotesPractical   || '',
      extraNotesAround:     body.extraNotesAround      || '',
      updatedAt: new Date().toISOString()
    };

    if (!uniqueId) throw new Error('uniqueId manquant : sauvegarde impossible');

    // Upsert : ON CONFLICT(unique_id) couvre les ré-essais sur le même uniqueId.
    // Le catch 23505 couvre la race condition propertyId : si deux requêtes
    // concurrentes passent toutes les deux le SELECT vide et génèrent des
    // uniqueIds différents, la première INSERT pose idx_wb_v2_property_id_unique,
    // la seconde lève 23505 — on récupère alors l'uniqueId du gagnant.
    let finalUniqueId = uniqueId;
    try {
      await pool.query(
        `INSERT INTO public.welcome_books_v2 (user_id, unique_id, property_name, property_id, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
         ON CONFLICT (unique_id) DO UPDATE
         SET data = EXCLUDED.data,
             property_name = EXCLUDED.property_name,
             property_id = COALESCE(welcome_books_v2.property_id, EXCLUDED.property_id),
             updated_at = NOW()`,
        [req.userId, uniqueId, propertyName, resolvedPropertyId, JSON.stringify(data)]
      );
    } catch (insertErr) {
      if (insertErr.code === '23505' && insertErr.constraint === 'idx_wb_v2_property_id_unique' && resolvedPropertyId) {
        // Race condition : une requête concurrente a inséré en premier.
        // On récupère son uniqueId et on met à jour sa ligne avec nos données.
        const winner = await pool.query(
          'SELECT unique_id FROM welcome_books_v2 WHERE property_id = $1 AND user_id = ANY($2::text[]) LIMIT 1',
          [resolvedPropertyId, agencyIds]
        );
        if (!winner.rows.length) throw insertErr;
        finalUniqueId = winner.rows[0].unique_id;
        const mergedData = { ...data, uniqueId: finalUniqueId };
        await pool.query(
          `UPDATE welcome_books_v2 SET data = $1::jsonb, property_name = $2, updated_at = NOW()
           WHERE unique_id = $3`,
          [JSON.stringify(mergedData), propertyName, finalUniqueId]
        );
        console.log(`Race condition résolue pour property ${resolvedPropertyId} → livret ${finalUniqueId}`);
      } else {
        throw insertErr;
      }
    }
    uniqueId = finalUniqueId;
    console.log('Sauvegarde reussie en base de donnees !');

    const baseUrl = getBaseUrl(req);
    const publicUrl = `${baseUrl}/welcome/${uniqueId}`;

    // Auto-link welcome_book_url sur le logement si vide
    let urlConflict = false;
    if (resolvedPropertyId) {
      try {
        const propRow = await pool.query(
          'SELECT welcome_book_url FROM properties WHERE id = $1 LIMIT 1',
          [resolvedPropertyId]
        );
        if (propRow.rows.length > 0) {
          const existingUrl = propRow.rows[0].welcome_book_url;
          if (!nonEmpty(existingUrl)) {
            await pool.query(
              'UPDATE properties SET welcome_book_url = $1 WHERE id = $2',
              [publicUrl, resolvedPropertyId]
            );
          } else {
            // Vérifier si l'URL existante contient le même uniqueId
            const m = String(existingUrl).match(/\/welcome\/([a-zA-Z0-9_-]+)/);
            const existingUniqueId = m ? m[1] : null;
            if (existingUniqueId && existingUniqueId === uniqueId) {
              // Même livret – normaliser l'URL si nécessaire
              if (existingUrl !== publicUrl) {
                await pool.query('UPDATE properties SET welcome_book_url = $1 WHERE id = $2', [publicUrl, resolvedPropertyId]);
              }
            } else {
              // URL différente / custom → ne pas écraser
              urlConflict = true;
            }
          }
        }
      } catch(e) { console.error('Erreur auto-link welcome_book_url:', e.message); }
    }

    res.json({
      success: true,
      message: 'Livret sauvegarde !',
      uniqueId,
      propertyId: resolvedPropertyId,
      url: publicUrl,
      publicUrl,
      urlConflict,
    });

  } catch (error) {
    console.error('CRASH lors de la sauvegarde:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur lors de la sauvegarde' });
  }
});

// ---------- PATCH /by-unique/:uniqueId/extras (iOS safe partial update) ----------
router.patch('/by-unique/:uniqueId/extras', authenticateUser, express.json(), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { uniqueId } = req.params;
    const agencyIds = await getAgencyUserIds(req, req.userId);

    // Vérifier ownership
    const existing = await pool.query(
      'SELECT id FROM welcome_books_v2 WHERE unique_id = $1 AND user_id = ANY($2::text[]) LIMIT 1',
      [uniqueId, agencyIds]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Livret introuvable ou acces refuse' });
    }

    // Seuls les champs texte du livret sont modifiables via ce endpoint
    // Photos, rooms, restaurants, places, etc. ne sont JAMAIS touches
    const allowed = ['welcomeDescription', 'checkoutInstructions'];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = String(req.body[key]);
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: 'Aucun champ modifiable fourni' });
    }
    patch.updatedAt = new Date().toISOString();

    await pool.query(
      `UPDATE welcome_books_v2
       SET data = data || $1::jsonb, updated_at = NOW()
       WHERE unique_id = $2 AND user_id = ANY($3::text[])`,
      [JSON.stringify(patch), uniqueId, agencyIds]
    );

    res.json({ success: true, uniqueId });
  } catch (error) {
    console.error('Erreur PATCH extras:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ---------- LIST (user) ----------
router.get('/user/list', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant' });

    const agencyIds = await getAgencyUserIds(req, req.userId);
    const result = await pool.query(
      `SELECT unique_id, property_name, data->'photos'->>'cover' as cover_photo,
              (data->>'isDraft')::boolean as is_draft,
              (data->>'lastSection')::int as last_section,
              updated_at
       FROM public.welcome_books_v2
       WHERE user_id = ANY($1::text[])
       ORDER BY (data->>'sortOrder')::int ASC NULLS LAST, updated_at DESC`,
      [agencyIds]
    );

    const welcomeBooks = result.rows.map(r => ({
      uniqueId:      r.unique_id,
      propertyName:  r.property_name || '',
      coverPhoto:    r.cover_photo || null,
      isDraft:       r.is_draft === true,
      lastSection:   r.last_section || 0,
      updatedAt:     r.updated_at,
    }));

    res.json({ success: true, welcomeBooks });
  } catch (error) {
    console.error('Erreur recuperation livrets:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ---------- DELETE ----------
router.delete('/by-unique/:uniqueId', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant' });
    const { uniqueId } = req.params;
    const agencyIds = await getAgencyUserIds(req, req.userId);
    const del = await pool.query(
      'DELETE FROM public.welcome_books_v2 WHERE user_id = ANY($1::text[]) AND unique_id = $2 RETURNING 1',
      [agencyIds, uniqueId]
    );
    if (del.rowCount === 0) return res.status(404).json({ success: false, error: 'Livret introuvable' });
    res.json({ success: true, message: "Livret supprime" });
  } catch (error) {
    console.error('Erreur suppression livret:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ---------- PUBLIC GET (no auth) ----------
router.get('/public/:uniqueId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ error: 'Pool DB manquant' });
    const { uniqueId } = req.params;
    const bookRes = await pool.query(
      'SELECT user_id, data, updated_at FROM public.welcome_books_v2 WHERE unique_id = $1 LIMIT 1',
      [uniqueId]
    );
    if (bookRes.rows.length === 0) return res.status(404).json({ error: 'Livret introuvable' });
    res.json({ success: true, book: { ...(bookRes.rows[0].data || {}), uniqueId }, updatedAt: bookRes.rows[0].updated_at });
  } catch (e) {
    console.error('PUBLIC welcome error:', e);
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// ---------- DUPLICATE ----------
router.post('/duplicate/:uniqueId', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { uniqueId } = req.params;
    const { newName } = req.body;
    const agencyIds = await getAgencyUserIds(req, req.userId);
    const sourceRes = await pool.query(
      'SELECT unique_id, property_name, data FROM public.welcome_books_v2 WHERE unique_id = $1 AND user_id = ANY($2::text[]) LIMIT 1',
      [uniqueId, agencyIds]
    );
    if (sourceRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Livret source introuvable' });
    }
    const sourceData = sourceRes.rows[0].data || {};
    const sourceName = sourceRes.rows[0].property_name || 'Livret';
    const newUniqueId    = crypto.randomBytes(16).toString('hex');
    const duplicatedName = newName || `${sourceName} (copie)`;
    const duplicatedData = { ...sourceData, uniqueId: newUniqueId, propertyName: duplicatedName, isDraft: false, lastSection: 0, updatedAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO public.welcome_books_v2 (user_id, unique_id, property_name, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
      [req.userId, newUniqueId, duplicatedName, JSON.stringify(duplicatedData)]
    );
    const baseUrl = getBaseUrl(req);
    res.json({ success: true, uniqueId: newUniqueId, propertyName: duplicatedName, url: `${baseUrl}/welcome/${newUniqueId}` });
  } catch (error) {
    console.error('Erreur duplication livret:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ---------- REORDER ----------
router.post('/reorder', authenticateUser, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) return res.status(500).json({ success: false, error: 'Pool DB manquant' });
    const { order } = req.body;
    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json({ success: false, error: 'order manquant' });
    }
    const agencyIds = await getAgencyUserIds(req, req.userId);
    const updates = order.map((uid, idx) =>
      pool.query(
        `UPDATE public.welcome_books_v2
         SET data = jsonb_set(data, '{sortOrder}', $1::jsonb)
         WHERE unique_id = $2 AND user_id = ANY($3::text[])`,
        [String(idx), uid, agencyIds]
      )
    );
    await Promise.all(updates);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur reorder livrets:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = { router, initWelcomeBookTables, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES };
