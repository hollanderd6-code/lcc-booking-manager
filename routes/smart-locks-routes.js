const express = require('express');
const router = express.Router();
const { getAdapter, getBrandConfig, BRANDS, SUPPORTED_BRANDS } = require('./adapters');

module.exports = function createSmartLocksRoutes(pool) {

  // ── Helper : récupérer le userId (gestion sous-comptes) ──
  function getUserId(req) {
    return req.user?.parentUserId || req.user?.id;
  }

  // ── Helper : auto-générer les codes pour toutes les réservations futures d'un logement (ou de tous) ──
  async function autoGenerateCodesForProperty(pool, userId, propertyId) {
    const propertyFilter = propertyId
      ? 'AND r.property_id = $2'
      : '';
    const params = propertyId ? [userId, propertyId] : [userId];

    const reservations = await pool.query(`
      SELECT r.uid, r.property_id, r.start_date, r.end_date, r.guest_name,
             sla.lock_id, sl.lock_name, sl.brand, sl.connection_id
      FROM reservations r
      JOIN smart_lock_assignments sla ON sla.property_id = r.property_id AND sla.user_id = $1
      JOIN smart_locks sl ON sl.id = sla.lock_id
      JOIN smart_lock_connections slc ON slc.id = sl.connection_id AND slc.is_active = TRUE
      WHERE r.user_id = $1
        AND r.start_date >= NOW() - INTERVAL '1 day'
        AND r.start_date <= NOW() + INTERVAL '30 days'
        AND r.status NOT IN ('cancelled')
        ${propertyFilter}
        AND NOT EXISTS (
          SELECT 1 FROM smart_lock_codes c
          WHERE c.reservation_uid = r.uid AND c.status = 'active'
        )`, params);

    let generated = 0;
    for (const resa of reservations.rows) {
      try {
        const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [resa.connection_id]);
        if (!connResult.rows[0]) continue;
        const adapter = getAdapter(connResult.rows[0], pool);
        const lockRow = await pool.query('SELECT * FROM smart_locks WHERE id = $1', [resa.lock_id]);
        if (!lockRow.rows[0]) continue;

        const result = await adapter.generateCode(lockRow.rows[0], {
          startDate: resa.start_date,
          endDate: resa.end_date,
          guestName: resa.guest_name,
        });

        await pool.query(
          `INSERT INTO smart_lock_codes
            (user_id, lock_id, property_id, reservation_uid, brand, external_code_id, code, code_type, guest_name, valid_from, valid_until, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'temporary',$8,$9,$10,'active')`,
          [userId, resa.lock_id, resa.property_id, resa.uid, resa.brand,
           result.externalCodeId, result.code, resa.guest_name, result.validFrom, result.validUntil]);

        console.log(`🔑 [AUTO] Code ${result.code} → ${resa.guest_name} (${resa.lock_name})`);
        generated++;
      } catch (genErr) {
        console.error(`[SMART-LOCKS] Auto-gen failed for ${resa.uid}:`, genErr.message);
      }
    }
    return generated;
  }

  // ══════════════════════════════════════════════
  // CONFIG & CONNEXIONS
  // ══════════════════════════════════════════════

  /** GET / — Liste des serrures de l'utilisateur */
  router.get('/', async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await pool.query(
        `SELECT sl.*, sla.property_id, p.name AS property_name
         FROM smart_locks sl
         LEFT JOIN smart_lock_assignments sla ON sla.lock_id = sl.id
         LEFT JOIN properties p ON p.id = sla.property_id
         WHERE sl.user_id = $1
         ORDER BY sl.lock_name`,
        [userId]
      );

      const locks = result.rows.map(r => ({
        id: r.id,
        brand: r.brand,
        device_id: r.device_id,
        lock_name: r.lock_name,
        lock_type: r.lock_type,
        model: r.model,
        serial_number: r.serial_number,
        battery_level: r.battery_level,
        is_online: r.is_online,
        metadata: r.metadata,
        assignment: r.property_id ? { property_id: r.property_id, property_name: r.property_name } : null,
      }));

      res.json({ locks });
    } catch (e) {
      console.error('[SMART-LOCKS] GET /:', e.message);
      res.status(500).json({ error: 'Erreur chargement serrures' });
    }
  });

  /** GET /brands — Marques supportées avec config de connexion */
  router.get('/brands', (req, res) => {
    const brands = Object.entries(BRANDS).map(([key, cfg]) => ({
      key,
      label: cfg.label,
      icon: cfg.icon,
      connectFields: cfg.connectFields,
      helpUrl: cfg.helpUrl,
      helpText: cfg.helpText,
    }));
    res.json({ brands });
  });

  /** GET /status — Statut de toutes les connexions */
  router.get('/status', async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await pool.query(
        `SELECT id, brand, is_active, last_sync_at, created_at FROM smart_lock_connections WHERE user_id = $1`,
        [userId]
      );

      const connections = result.rows.map(r => ({
        id: r.id,
        brand: r.brand,
        label: BRANDS[r.brand]?.label || r.brand,
        icon: BRANDS[r.brand]?.icon || '🔒',
        connected: r.is_active,
        lastSync: r.last_sync_at,
        createdAt: r.created_at,
      }));

      // Stats
      const lockCount = await pool.query(
        'SELECT COUNT(*) FROM smart_locks WHERE user_id = $1', [userId]
      );
      const codeCount = await pool.query(
        `SELECT COUNT(*) FROM smart_lock_codes WHERE user_id = $1 AND status = 'active'`, [userId]
      );

      res.json({
        connections,
        connected: connections.some(c => c.connected),
        stats: {
          totalLocks: parseInt(lockCount.rows[0].count),
          activeCodes: parseInt(codeCount.rows[0].count),
          connectedBrands: connections.filter(c => c.connected).length,
        },
      });
    } catch (e) {
      console.error('[SMART-LOCKS] GET /status:', e.message);
      res.status(500).json({ error: 'Erreur statut' });
    }
  });

  /** POST /connect — Connecter une marque */
  router.post('/connect', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { brand, credentials } = req.body;

      if (!brand || !SUPPORTED_BRANDS.includes(brand)) {
        return res.status(400).json({ error: `Marque non supportée. Disponibles: ${SUPPORTED_BRANDS.join(', ')}` });
      }
      if (!credentials || typeof credentials !== 'object') {
        return res.status(400).json({ error: 'Credentials requis' });
      }

      // Vérifier les champs requis
      const config = getBrandConfig(brand);
      for (const field of config.connectFields) {
        if (!credentials[field.key] && !field.default) {
          return res.status(400).json({ error: `Champ requis: ${field.label}` });
        }
        if (!credentials[field.key] && field.default) {
          credentials[field.key] = field.default;
        }
      }

      // Upsert connexion
      const result = await pool.query(
        `INSERT INTO smart_lock_connections (user_id, brand, credentials, is_active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (user_id, brand) DO UPDATE SET
           credentials = $3, is_active = TRUE, updated_at = NOW()
         RETURNING id`,
        [userId, brand, JSON.stringify(credentials)]
      );
      const connectionId = result.rows[0].id;

      // Tester la connexion
      const connRow = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [connectionId]);
      const adapter = getAdapter(connRow.rows[0], pool);
      await adapter.authenticate();

      res.json({ success: true, connectionId, message: `${config.label} connecté !` });
    } catch (e) {
      console.error('[SMART-LOCKS] POST /connect:', e.message);
      res.status(400).json({ error: `Connexion échouée: ${e.message}` });
    }
  });

  /** POST /disconnect — Déconnecter une marque */
  router.post('/disconnect', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { brand } = req.body;

      await pool.query(
        `UPDATE smart_lock_connections SET is_active = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND brand = $2`,
        [userId, brand]
      );

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Erreur déconnexion' });
    }
  });

  // ══════════════════════════════════════════════
  // SYNCHRONISATION
  // ══════════════════════════════════════════════

  /** POST /sync — Synchroniser les serrures d'une marque (ou toutes) */
  router.post('/sync', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { brand } = req.body; // optionnel — sync une seule marque

      const query = brand
        ? 'SELECT * FROM smart_lock_connections WHERE user_id = $1 AND brand = $2 AND is_active = TRUE'
        : 'SELECT * FROM smart_lock_connections WHERE user_id = $1 AND is_active = TRUE';
      const params = brand ? [userId, brand] : [userId];

      const connections = await pool.query(query, params);
      if (connections.rows.length === 0) {
        return res.status(400).json({ error: 'Aucune connexion active' });
      }

      let totalAdded = 0, totalUpdated = 0;
      const errors = [];

      for (const conn of connections.rows) {
        try {
          const adapter = getAdapter(conn, pool);
          const remoteLocks = await adapter.listLocks();

          for (const rl of remoteLocks) {
            const existing = await pool.query(
              'SELECT id FROM smart_locks WHERE user_id = $1 AND device_id = $2 AND brand = $3',
              [userId, rl.deviceId, conn.brand]
            );

            if (existing.rows[0]) {
              await pool.query(
                `UPDATE smart_locks SET
                  lock_name = $1, lock_type = $2, model = $3, serial_number = $4,
                  battery_level = $5, is_online = $6, metadata = $7, updated_at = NOW()
                 WHERE id = $8`,
                [rl.name, rl.type, rl.model, rl.serialNumber,
                 rl.battery, rl.isOnline, JSON.stringify(rl.metadata || {}),
                 existing.rows[0].id]
              );
              totalUpdated++;
            } else {
              await pool.query(
                `INSERT INTO smart_locks (user_id, connection_id, brand, device_id, lock_name, lock_type, model, serial_number, battery_level, is_online, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [userId, conn.id, conn.brand, rl.deviceId, rl.name, rl.type, rl.model, rl.serialNumber,
                 rl.battery, rl.isOnline, JSON.stringify(rl.metadata || {})]
              );
              totalAdded++;
            }
          }

          // Marquer le dernier sync
          await pool.query(
            'UPDATE smart_lock_connections SET last_sync_at = NOW() WHERE id = $1',
            [conn.id]
          );
        } catch (brandErr) {
          console.error(`[SMART-LOCKS] Sync ${conn.brand} failed:`, brandErr.message);
          errors.push({ brand: conn.brand, error: brandErr.message });
        }
      }

      res.json({ success: true, added: totalAdded, updated: totalUpdated, errors });
    } catch (e) {
      console.error('[SMART-LOCKS] POST /sync:', e.message);
      res.status(500).json({ error: 'Erreur synchronisation' });
    }
  });

  // ══════════════════════════════════════════════
  // ASSOCIATION SERRURE ↔ LOGEMENT
  // ══════════════════════════════════════════════

  /** POST /assign — Associer une serrure à un logement */
  router.post('/assign', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { lockId, propertyId } = req.body;

      if (!lockId || !propertyId) return res.status(400).json({ error: 'lockId et propertyId requis' });

      // Vérifier que la serrure appartient à l'utilisateur
      const lock = await pool.query('SELECT id FROM smart_locks WHERE id = $1 AND user_id = $2', [lockId, userId]);
      if (!lock.rows[0]) return res.status(404).json({ error: 'Serrure introuvable' });

      await pool.query(
        `INSERT INTO smart_lock_assignments (lock_id, property_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (lock_id) DO UPDATE SET property_id = $2`,
        [lockId, propertyId, userId]
      );

      // Auto-générer les codes pour les réservations futures de ce logement
      try {
        const generated = await autoGenerateCodesForProperty(pool, userId, propertyId);
        console.log(`🔑 [ASSIGN] ${generated} code(s) auto-générés pour property ${propertyId}`);
        res.json({ success: true, codesGenerated: generated });
      } catch (autoErr) {
        console.error('[ASSIGN] Auto-gen codes failed:', autoErr.message);
        res.json({ success: true, codesGenerated: 0 });
      }
    } catch (e) {
      res.status(500).json({ error: 'Erreur association' });
    }
  });

  /** POST /unassign — Désassocier une serrure */
  router.post('/unassign', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { lockId } = req.body;
      await pool.query('DELETE FROM smart_lock_assignments WHERE lock_id = $1 AND user_id = $2', [lockId, userId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Erreur désassociation' });
    }
  });

  // ══════════════════════════════════════════════
  // CODES D'ACCÈS
  // ══════════════════════════════════════════════

  /** POST /codes/generate — Générer un code pour une réservation ou manuellement */
  router.post('/codes/generate', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { propertyId, reservationUid, startDate, endDate, guestName } = req.body;

      if (!propertyId || !startDate || !endDate) {
        return res.status(400).json({ error: 'propertyId, startDate et endDate requis' });
      }

      // Trouver la serrure assignée au logement
      const lockResult = await pool.query(
        `SELECT sl.*, sla.property_id, slc.brand AS conn_brand
         FROM smart_lock_assignments sla
         JOIN smart_locks sl ON sl.id = sla.lock_id
         JOIN smart_lock_connections slc ON slc.id = sl.connection_id AND slc.is_active = TRUE
         WHERE sla.property_id = $1 AND sla.user_id = $2`,
        [propertyId, userId]
      );

      if (!lockResult.rows[0]) {
        return res.status(404).json({ error: 'Aucune serrure connectée pour ce logement' });
      }

      const lock = lockResult.rows[0];

      // Vérifier s'il n'y a pas déjà un code actif pour cette réservation
      if (reservationUid) {
        const existing = await pool.query(
          `SELECT id, code FROM smart_lock_codes
           WHERE reservation_uid = $1 AND lock_id = $2 AND status = 'active'`,
          [reservationUid, lock.id]
        );
        if (existing.rows[0]) {
          return res.json({
            success: true,
            code: existing.rows[0].code,
            codeId: existing.rows[0].id,
            alreadyExists: true,
          });
        }
      }

      // Récupérer la connexion pour créer l'adapter
      const connResult = await pool.query(
        'SELECT * FROM smart_lock_connections WHERE id = $1',
        [lock.connection_id]
      );
      const adapter = getAdapter(connResult.rows[0], pool);

      // Générer le code
      const result = await adapter.generateCode(lock, { startDate, endDate, guestName });

      // Sauvegarder en DB
      const saved = await pool.query(
        `INSERT INTO smart_lock_codes
          (user_id, lock_id, property_id, reservation_uid, brand, external_code_id, code, code_type, guest_name, valid_from, valid_until, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'temporary', $8, $9, $10, 'active')
         RETURNING id`,
        [userId, lock.id, propertyId, reservationUid || null, lock.brand,
         result.externalCodeId, result.code, guestName || null,
         result.validFrom, result.validUntil]
      );

      console.log(`🔑 [SMART-LOCK] Code généré: ${result.code} (${lock.brand}) pour ${guestName || 'guest'} — ${lock.lock_name}`);

      res.json({
        success: true,
        codeId: saved.rows[0].id,
        code: result.code,
        brand: lock.brand,
        lockName: lock.lock_name,
        validFrom: result.validFrom,
        validUntil: result.validUntil,
      });
    } catch (e) {
      console.error('[SMART-LOCKS] POST /codes/generate:', e.message);
      res.status(500).json({ error: `Erreur génération code: ${e.message}` });
    }
  });

  /** POST /codes/revoke — Révoquer un code */
  router.post('/codes/revoke', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { codeId } = req.body;

      const codeRow = await pool.query(
        `SELECT slc.*, sl.device_id, sl.connection_id, sl.brand AS lock_brand
         FROM smart_lock_codes slc
         JOIN smart_locks sl ON sl.id = slc.lock_id
         WHERE slc.id = $1 AND slc.user_id = $2 AND slc.status = 'active'`,
        [codeId, userId]
      );

      if (!codeRow.rows[0]) return res.status(404).json({ error: 'Code introuvable ou déjà révoqué' });
      const code = codeRow.rows[0];

      // Révoquer via l'API de la marque
      const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [code.connection_id]);
      if (connResult.rows[0]) {
        const adapter = getAdapter(connResult.rows[0], pool);
        const lock = { device_id: code.device_id };
        await adapter.revokeCode(lock, code.external_code_id);
      }

      // Marquer comme révoqué en DB
      await pool.query(
        `UPDATE smart_lock_codes SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [codeId]
      );

      res.json({ success: true });
    } catch (e) {
      console.error('[SMART-LOCKS] POST /codes/revoke:', e.message);
      res.status(500).json({ error: 'Erreur révocation' });
    }
  });

  /** GET /codes — Liste des codes (avec filtres) */
  router.get('/codes', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { status, propertyId, reservationUid } = req.query;

      let query = `
        SELECT slc.*, sl.lock_name, sl.brand AS lock_brand, p.name AS property_name
        FROM smart_lock_codes slc
        JOIN smart_locks sl ON sl.id = slc.lock_id
        LEFT JOIN properties p ON p.id = slc.property_id
        WHERE slc.user_id = $1
      `;
      const params = [userId];
      let idx = 2;

      if (status) { query += ` AND slc.status = $${idx++}`; params.push(status); }
      if (propertyId) { query += ` AND slc.property_id = $${idx++}`; params.push(propertyId); }
      if (reservationUid) { query += ` AND slc.reservation_uid = $${idx++}`; params.push(reservationUid); }

      query += ' ORDER BY slc.created_at DESC LIMIT 100';

      const result = await pool.query(query, params);
      res.json({ codes: result.rows });
    } catch (e) {
      res.status(500).json({ error: 'Erreur chargement codes' });
    }
  });

  /** GET /codes/for-reservation/:uid — Code actif pour une réservation (utilisé par les templates) */
  router.get('/codes/for-reservation/:uid', async (req, res) => {
    try {
      const userId = getUserId(req);
      const result = await pool.query(
        `SELECT code, valid_from, valid_until, sl.lock_name, slc.brand
         FROM smart_lock_codes slc
         JOIN smart_locks sl ON sl.id = slc.lock_id
         WHERE slc.reservation_uid = $1 AND slc.user_id = $2 AND slc.status = 'active'
         ORDER BY slc.created_at DESC LIMIT 1`,
        [req.params.uid, userId]
      );

      if (!result.rows[0]) return res.json({ code: null });
      res.json({ code: result.rows[0].code, lock: result.rows[0].lock_name, brand: result.rows[0].brand });
    } catch (e) {
      res.status(500).json({ error: 'Erreur' });
    }
  });

  // ══════════════════════════════════════════════
  // GÉNÉRATION AUTOMATIQUE (appelé par le cron/webhook)
  // ══════════════════════════════════════════════

  /** POST /codes/auto-generate — Générer automatiquement les codes pour les réservations futures (30j) */
  router.post('/codes/auto-generate', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { propertyId } = req.body || {};
      const generated = await autoGenerateCodesForProperty(pool, userId, propertyId || null);
      res.json({ success: true, generated });
    } catch (e) {
      console.error('[SMART-LOCKS] POST /codes/auto-generate:', e.message);
      res.status(500).json({ error: 'Erreur auto-génération' });
    }
  });

  // ══════════════════════════════════════════════
  // CRON : EXPIRATION DES CODES
  // ══════════════════════════════════════════════

  /** POST /codes/expire — Marquer les codes expirés (appelé par cron) */
  router.post('/codes/expire', async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE smart_lock_codes
         SET status = 'expired', updated_at = NOW()
         WHERE status = 'active' AND valid_until < NOW()
         RETURNING id, reservation_uid, brand`
      );

      console.log(`🕐 [SMART-LOCKS] ${result.rowCount} code(s) expirés`);
      res.json({ expired: result.rowCount });
    } catch (e) {
      res.status(500).json({ error: 'Erreur expiration' });
    }
  });

  // ══════════════════════════════════════════════
  // STATUT SERRURE
  // ══════════════════════════════════════════════

  /** GET /lock/:id/status — Statut d'une serrure */
  router.get('/lock/:id/status', async (req, res) => {
    try {
      const userId = getUserId(req);
      const lock = await pool.query(
        `SELECT sl.*, slc.id AS connection_id_full
         FROM smart_locks sl
         JOIN smart_lock_connections slc ON slc.id = sl.connection_id
         WHERE sl.id = $1 AND sl.user_id = $2`,
        [req.params.id, userId]
      );

      if (!lock.rows[0]) return res.status(404).json({ error: 'Serrure introuvable' });

      const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [lock.rows[0].connection_id]);
      const adapter = getAdapter(connResult.rows[0], pool);
      const status = await adapter.getLockStatus(lock.rows[0]);

      // Mettre à jour en DB
      await pool.query(
        `UPDATE smart_locks SET battery_level = $1, is_online = $2, firmware_version = $3, updated_at = NOW() WHERE id = $4`,
        [status.battery, status.isOnline, status.firmwareVersion, req.params.id]
      );

      res.json({ ...status, lockName: lock.rows[0].lock_name });
    } catch (e) {
      res.status(500).json({ error: 'Erreur statut serrure' });
    }
  });

  // ══════════════════════════════════════════════
  // COMMANDES À DISTANCE (bridge)
  // ══════════════════════════════════════════════

  /** POST /lock/:id/unlock — Déverrouiller à distance */
  router.post('/lock/:id/unlock', async (req, res) => {
    try {
      const userId = getUserId(req);
      const lock = await pool.query('SELECT * FROM smart_locks WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
      if (!lock.rows[0]) return res.status(404).json({ error: 'Serrure introuvable' });

      const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [lock.rows[0].connection_id]);
      const adapter = getAdapter(connResult.rows[0], pool);

      if (typeof adapter.unlock !== 'function') return res.status(400).json({ error: 'Déverrouillage non supporté pour cette marque' });

      const result = await adapter.unlock(lock.rows[0]);
      res.json(result);
    } catch (e) {
      console.error('[SMART-LOCKS] unlock:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /** POST /lock/:id/lock — Verrouiller à distance */
  router.post('/lock/:id/lock', async (req, res) => {
    try {
      const userId = getUserId(req);
      const lock = await pool.query('SELECT * FROM smart_locks WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
      if (!lock.rows[0]) return res.status(404).json({ error: 'Serrure introuvable' });

      const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [lock.rows[0].connection_id]);
      const adapter = getAdapter(connResult.rows[0], pool);

      if (typeof adapter.lockDevice !== 'function') return res.status(400).json({ error: 'Verrouillage non supporté pour cette marque' });

      const result = await adapter.lockDevice(lock.rows[0]);
      res.json(result);
    } catch (e) {
      console.error('[SMART-LOCKS] lock:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /** POST /lock/:id/custom-pin — Créer un PIN custom via bridge */
  router.post('/lock/:id/custom-pin', async (req, res) => {
    try {
      const userId = getUserId(req);
      const { code, name, startDate, endDate } = req.body;
      const lock = await pool.query('SELECT * FROM smart_locks WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
      if (!lock.rows[0]) return res.status(404).json({ error: 'Serrure introuvable' });

      const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [lock.rows[0].connection_id]);
      const adapter = getAdapter(connResult.rows[0], pool);

      if (typeof adapter.createCustomPin !== 'function') return res.status(400).json({ error: 'PIN custom non supporté pour cette marque' });

      const result = await adapter.createCustomPin(lock.rows[0], { code, name, startDate, endDate });
      res.json(result);
    } catch (e) {
      console.error('[SMART-LOCKS] custom-pin:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /lock/:id/activity — Logs d'activité */
  router.get('/lock/:id/activity', async (req, res) => {
    try {
      const userId = getUserId(req);
      const lock = await pool.query('SELECT * FROM smart_locks WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
      if (!lock.rows[0]) return res.status(404).json({ error: 'Serrure introuvable' });

      const connResult = await pool.query('SELECT * FROM smart_lock_connections WHERE id = $1', [lock.rows[0].connection_id]);
      const adapter = getAdapter(connResult.rows[0], pool);

      if (typeof adapter.getActivityLogs !== 'function') return res.status(400).json({ error: 'Logs non supportés pour cette marque' });

      const logs = await adapter.getActivityLogs(lock.rows[0]);
      res.json({ logs });
    } catch (e) {
      console.error('[SMART-LOCKS] activity:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
