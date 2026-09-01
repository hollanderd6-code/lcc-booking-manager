// ============================================================
// ☀️ GET /api/aujourdhui/etats — vue unifiée du jour
// Fichier : routes/aujourdhui-routes.js
// Dépôt   : hollanderd6-code/lcc-booking-manager
//
// Branchement dans server.js, à côté des autres setup* :
//   require('./routes/aujourdhui-routes')(app, pool, authenticateAny, checkSubscription);
//
// Pourquoi cette route existe : le dashboard comptait quatre arrivées
// là où il y en avait sept, et n'affichait aucune heure de départ.
// Les deux causes sont traitées ici, en commentaire à chaque endroit.
// ============================================================

module.exports = function setupAujourdhuiRoutes(app, pool, authenticateAny, checkSubscription) {
  const {
    requirePermission,
    loadSubAccountData,
    filterByAccessibleProperties,
    getRealUserId
  } = require('../sub-accounts-middleware');

  // Même helper que chat_routes.js et smart-locks-routes.js — mode agence
  async function getAgencyUserIds(req, userId) {
    if (req.query.agency !== 'all') return [userId];
    try {
      const { rows } = await pool.query(
        `SELECT delegator_user_id FROM account_delegations
          WHERE delegate_user_id = $1 AND status = 'accepted'`,
        [userId]
      );
      return [userId, ...rows.map(d => d.delegator_user_id)];
    } catch (e) {
      return [userId];
    }
  }

  app.get('/api/aujourdhui/etats',
    authenticateAny,
    checkSubscription,
    requirePermission(pool, 'can_view_reservations'),
    loadSubAccountData(pool),
    async (req, res) => {
      try {
        const userId    = await getRealUserId(pool, req);
        const agencyIds = await getAgencyUserIds(req, userId);

        // Date demandée, ou aujourd'hui à Paris (et non en UTC : à 23 h
        // heure française, new Date().toISOString() donne déjà demain).
        const jour = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
          ? req.query.date
          : new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());

        // ── CAUSE N°1 DU BUG DES SEPT ARRIVÉES ──────────────────
        // L'ancien calcul partait des conversations et joignait les
        // réservations sur channex_booking_id. Toute réservation sans
        // identifiant Channex — les directes, les manuelles — tombait.
        // Ici c'est reservations qui mène, et conversations qui suit en
        // LEFT JOIN. Une réservation sans conversation reste comptée.
        //
        // ── CAUSE N°2 ───────────────────────────────────────────
        // Comparer des dates avec DATE(...) sur une colonne timestamptz
        // décale le jour de plusieurs heures. TO_CHAR est insensible au
        // fuseau et fonctionne que la colonne soit date ou timestamp.
        //
        // DISTINCT ON (r.uid) : deux conversations peuvent correspondre au
        // même séjour (ancienne et nouvelle). Sans lui, la réservation est
        // comptée deux fois.
        const { rows } = await pool.query(`
          SELECT DISTINCT ON (r.uid)
            r.uid,
            r.property_id,
            r.guest_name,
            r.guest_phone,
            r.guest_email,
            LOWER(COALESCE(NULLIF(r.platform,''), NULLIF(r.source,''), 'direct')) AS platform,
            TO_CHAR(r.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(r.end_date,   'YYYY-MM-DD') AS end_date,
            GREATEST((r.end_date::date - r.start_date::date), 0) AS nights,
            r.amount_total,
            r.host_payout,
            r.occupancy_adults,
            r.occupancy_children,
            r.status,
            p.name                                        AS property_name,
            COALESCE(NULLIF(p.internal_name,''), p.name)  AS property_label,
            p.address                                     AS property_address,
            p.access_code,
            -- Les heures viennent du LOGEMENT, jamais d'un défaut codé en dur.
            -- C'est ce qui manquait aux départs.
            p.arrival_time   AS arrival_time,
            p.departure_time AS departure_time,
            c.id        AS conversation_id,
            c.escalated,
            c.ai_disabled,
            COALESCE((
              SELECT COUNT(*) FROM messages m
              WHERE m.conversation_id = c.id
                AND m.is_read = FALSE
                AND m.sender_type = 'guest'
            ), 0)::int AS unread_count
          FROM reservations r
          JOIN properties p
            ON p.id = r.property_id
          LEFT JOIN conversations c
            ON c.property_id = r.property_id
           AND TO_CHAR(c.reservation_start_date, 'YYYY-MM-DD') = TO_CHAR(r.start_date, 'YYYY-MM-DD')
          WHERE r.user_id = ANY($1::text[])
            AND LOWER(COALESCE(r.status, '')) NOT IN ('cancelled', 'canceled', 'annulee')
            AND LOWER(COALESCE(r.source, '')) NOT IN ('block', 'blocked', 'bloque')
            AND (
              TO_CHAR(r.start_date, 'YYYY-MM-DD') = $2
              OR TO_CHAR(r.end_date, 'YYYY-MM-DD') = $2
            )
          ORDER BY r.uid, c.last_message_at DESC NULLS LAST
        `, [agencyIds, jour]);

        // Filtrage sous-compte : ne renvoyer que les logements accessibles
        const visibles = filterByAccessibleProperties(rows, req);

        // Un séjour d'une nuit arrive et part le même jour : il doit
        // apparaître dans les deux listes, pas dans une seule.
        const arrivees = [];
        const departs  = [];

        for (const r of visibles) {
          const base = {
            reservation_uid:   r.uid,
            conversation_id:   r.conversation_id || null,
            property_id:       r.property_id,
            property_name:     r.property_label,
            property_address:  r.property_address,
            guest_name:        r.guest_name || 'Voyageur',
            guest_phone:       r.guest_phone || null,
            platform:          r.platform,
            status:            r.status || null,
            nights:            r.nights,
            guests:            (r.occupancy_adults || 0) + (r.occupancy_children || 0) || null,
            amount_total:      r.amount_total != null ? parseFloat(r.amount_total) : null,
            unread_count:      r.unread_count,
            escalated:         r.escalated === true,
            ai_disabled:       r.ai_disabled === true
          };

          // Ce qui bloque réellement, et rien d'inventé : on ne signale
          // que ce dont on a la preuve en base.
          const blocking = [];
          if (!r.conversation_id)   blocking.push('pas_de_conversation');
          if (r.escalated === true) blocking.push('ia_a_passe_la_main');
          if (r.unread_count > 0)   blocking.push('message_non_lu');
          if (!r.access_code)       blocking.push('code_acces_manquant');
          if (['hold', 'pending_approval'].includes(r.status)) blocking.push('reservation_non_confirmee');

          if (r.start_date === jour) {
            arrivees.push({ ...base, arrival_time: r.arrival_time || null, blocking });
          }
          if (r.end_date === jour) {
            departs.push({ ...base, departure_time: r.departure_time || null });
          }
        }

        // Tri par heure, les heures absentes en fin de liste plutôt qu'en tête
        const parHeure = (k) => (a, b) => (a[k] || '99:99').localeCompare(b[k] || '99:99');
        arrivees.sort(parHeure('arrival_time'));
        departs.sort(parHeure('departure_time'));

        res.json({
          date: jour,
          compteurs: {
            arrivees:   arrivees.filter(a => a.status === 'confirmed').length,
            en_attente: arrivees.filter(a => ['hold', 'pending_approval'].includes(a.status)).length,
            departs:    departs.length,
            a_traiter:  arrivees.filter(a => a.blocking.length > 0).length
          },
          arrivees,
          departs
        });

      } catch (e) {
        console.error('❌ [AUJOURDHUI] /api/aujourdhui/etats:', e);
        res.status(500).json({ error: 'Erreur serveur' });
      }
    }
  );

  console.log('☀️  Route /api/aujourdhui/etats montée');
};
