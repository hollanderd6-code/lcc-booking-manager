// ============================================
// 🏢 MODE AGENCE — Rattachement des créations au bon compte client
//
// Problème corrigé :
//   Les routes de LECTURE (GET /api/sub-accounts/list, GET /api/cleaners, …)
//   gèrent le mode agence via getAgencyUserIds() / agencyIdsFor() : un délégué
//   voit les données des comptes qu'il gère.
//   Les routes de CRÉATION, elles, insèrent en dur sous req.user.id :
//     - POST /api/sub-accounts/create  → parent_user_id = req.user.id
//     - POST /api/cleaners             → user_id       = req.user.id
//   Résultat : depuis une conciergerie, le sous-compte ou le membre de ménage
//   était bien créé, mais rattaché au compte AGENCE. Il n'apparaissait jamais
//   dans le compte du propriétaire — d'où l'obligation de tout créer depuis le
//   compte proprio.
//
// Correctif : ce middleware lit un `targetUserId` (corps de requête ou
//   ?target_user_id=), vérifie dans account_delegations que l'appelant a bien
//   une délégation ACCEPTÉE sur ce compte, puis force req.user.id sur le compte
//   cible pour la durée de la requête. Les routes existantes n'ont pas à être
//   réécrites : elles créent au bon endroit sans le savoir.
//
// Montage (server.js) — après bodyParser, AVANT toute déclaration de route :
//   const { setupAgencyTarget } = require('./agency-target');
//   setupAgencyTarget(app, pool);
// ============================================

const jwt = require('jsonwebtoken');
const { authenticateAny } = require('./sub-accounts-middleware');

function setupAgencyTarget(app, pool) {
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

  // Le middleware tourne AVANT l'authentification de la route (il doit être
  // monté en premier pour pouvoir agir), donc req.user n'existe pas encore :
  // on décode le token nous-mêmes, uniquement pour identifier l'appelant.
  function callerIdFromRequest(req) {
    const header = req.headers['authorization'];
    const token = header && header.split(' ')[1];
    if (!token) return null;
    try {
      const decoded = jwt.verify(token, SECRET);
      if (decoded.type === 'sub_account') return null; // un sous-compte ne délègue rien
      return decoded.id || null;
    } catch (e) {
      return null; // token invalide : on laisse la route répondre 401 elle-même
    }
  }

  async function hasDelegation(callerId, targetId) {
    if (!callerId || !targetId) return false;
    if (String(callerId) === String(targetId)) return true; // son propre compte
    const r = await pool.query(
      `SELECT 1 FROM account_delegations
       WHERE delegate_user_id = $1 AND delegator_user_id = $2 AND status = 'accepted'
       LIMIT 1`,
      [callerId, targetId]
    );
    return r.rows.length > 0;
  }

  /* req.user est assigné plus tard par authenticateToken / authenticateAny.
     Plutôt que de deviner quand, on installe un accesseur : au moment où
     l'authentification écrit req.user, l'id est réécrit sur le compte cible.
     Tous les autres champs du token (email, etc.) sont préservés. */
  function forceUserId(req, targetId) {
    let stored = req.user;
    if (stored && typeof stored === 'object') {
      stored.id = targetId;
      stored.bhAgencyTarget = targetId;
    }
    Object.defineProperty(req, 'user', {
      configurable: true,
      enumerable: true,
      get() { return stored; },
      set(value) {
        stored = value;
        if (value && typeof value === 'object' && !value.isSubAccount) {
          value.id = targetId;
          value.bhAgencyTarget = targetId;
        }
      }
    });
  }

  async function redirectWrites(req, res, next) {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();

    const target =
      (req.body && (req.body.targetUserId || req.body.target_user_id)) ||
      req.query.target_user_id ||
      null;
    if (!target) return next(); // comportement inchangé sans cible explicite

    const callerId = callerIdFromRequest(req);
    if (!callerId) return next();

    try {
      if (!(await hasDelegation(callerId, target))) {
        console.warn(`⛔ [AGENCE] ${callerId} a tenté d'écrire sur ${target} sans délégation acceptée`);
        return res.status(403).json({
          success: false,
          error: "Vous n'avez pas d'accès délégué à ce compte client"
        });
      }
    } catch (e) {
      console.error('❌ [AGENCE] vérification délégation:', e.message);
      return next(); // en cas de panne DB, on ne change rien : création sous son propre compte
    }

    forceUserId(req, target);
    req.bhAgencyTarget = target;
    console.log(`🏢 [AGENCE] ${req.method} ${req.originalUrl} — création rattachée au compte ${target}`);
    next();
  }

  // ⚠️ Ordre important : ces app.use doivent être enregistrés avant les
  // déclarations de routes correspondantes pour s'exécuter en amont.
  app.use('/api/cleaners', redirectWrites);
  app.use('/api/sub-accounts', redirectWrites);

  // ── Liste des comptes sur lesquels l'utilisateur peut créer ──────────────
  // Alimente le sélecteur « Pour quel compte ? » des deux formulaires.
  // Seuls les comptes principaux (agences) appellent cette route.
  app.get('/api/agency/target-accounts', authenticateAny, async (req, res) => {
    if (req.user.isSubAccount) {
      return res.status(403).json({ success: false, error: 'Accès réservé aux comptes principaux' });
    }
    const callerId = req.user.id;
    try {
      const me = await pool.query(
        'SELECT id, email, company, first_name, last_name FROM users WHERE id = $1',
        [callerId]
      );
      const label = (u) =>
        u.company || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

      const accounts = [];
      if (me.rows[0]) {
        accounts.push({
          userId: me.rows[0].id,
          name: label(me.rows[0]) + ' (mon compte)',
          email: me.rows[0].email,
          isSelf: true
        });
      }

      const managed = await pool.query(
        `SELECT u.id, u.email, u.company, u.first_name, u.last_name
         FROM account_delegations d
         JOIN users u ON u.id = d.delegator_user_id
         WHERE d.delegate_user_id = $1 AND d.status = 'accepted'
         ORDER BY COALESCE(u.company, u.last_name, u.email)`,
        [callerId]
      );
      managed.rows.forEach((u) => {
        accounts.push({ userId: u.id, name: label(u), email: u.email, isSelf: false });
      });

      res.json({ success: true, accounts });
    } catch (e) {
      console.error('❌ [AGENCE] target-accounts:', e.message);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  });

  console.log('✅ Mode agence : rattachement des créations activé (/api/cleaners, /api/sub-accounts)');
}

module.exports = { setupAgencyTarget };
