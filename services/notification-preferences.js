// services/notification-preferences.js
// ============================================================
// server.js filtre déjà ses envois via shouldSendNotification(userId, clé).
// Les TROIS AUTRES émetteurs ne filtrent rien :
//   - services/notifications-service.js
//   - services/pushNotificationService.js
//   - integrated-chat-handler.js  (+ les crons cautions)
// Ce module leur donne l'équivalent, avec la même liste de clés que
// DEFAULT_NOTIFICATION_SETTINGS (server.js:3503) et BOOL_KEYS (server.js:12571).
// N'inventer aucune clé ici : POST /api/settings/notifications ignore
// silencieusement tout ce qui n'est pas dans sa liste blanche.
//
// Règles :
//   - préférence absente en base            → autorisé (défaut serveur = true)
//   - type inconnu de la table              → autorisé (jamais bloquer par accident)
//   - erreur SQL                            → autorisé (une panne de lecture ne
//                                             doit pas faire taire les notifications)
//   - types de `ALWAYS`                     → partent quoi qu'il arrive
// ============================================================

'use strict';

// type de push → clé de préférence réellement acceptée par le serveur
const TYPE_TO_PREF = {
  // Réservations
  new_reservation:            'notif_new_reservation',
  new_booking:                'notif_new_reservation',
  new_booking_guest:          'notif_new_reservation',
  new_booking_channex:        'notif_new_reservation',
  cancelled_reservation:      'notif_reservation_cancelled',
  reservation_cancelled:      'notif_reservation_cancelled',
  cancelled_booking_channex:  'notif_reservation_cancelled',
  daily_summary:              'notif_daily_summary',
  monthly_summary:            'notif_daily_summary',
  daily_arrivals:             'notif_daily_summary',
  arrivals:                   'notif_daily_summary',
  departures:                 'notif_daily_summary',
  check_in:                   'notif_daily_summary',
  reminder_j1:                'notif_reminder_j1',

  // Messagerie
  // Le niveau fin (chaque message / IA silencieuse / escalades) vit dans
  // notif_message_level, géré par server.js : ici on ne teste que
  // l'interrupteur maître.
  new_message:                'notif_new_message',
  new_chat_message:           'notif_new_message',
  new_guest_message:          'notif_new_message',
  chat_sms:                   'notif_new_message',
  sms_reply:                  'notif_new_message',
  template_failed:            'notif_template_failed',
  template_delivery_unknown:  'notif_template_failed',

  // Ménage
  cleaning_reminder:          'notif_cleaning_reminder',
  cleaning_alert:             'notif_cleaning_alert',
  cleaning_lastminute:        'notif_cleaning_alert',
  cleaning_completed:         'notif_cleaning_completed',
  cleaning_recap:             'notif_cleaning_completed',
  cleaning_validated:         'notif_checklist_done',
  checklist_done:             'notif_checklist_done',

  // Argent
  new_invoice:                'notif_new_invoice',
  deposit_request:            'notif_deposit_request',
  deposit_paid:               'notif_deposit_request',
  deposit_captured:           'notif_deposit_request',
};

// Types que l'utilisateur ne peut pas couper : destinés à un prestataire (qui
// n'a pas accès à cet écran — la route renvoie 401 pour un sous-compte), ou
// trop critiques pour être silencieux, ou explicitement demandés.
const ALWAYS = new Set([
  'new_cleaning', 'cleaning_assigned', 'cleaning_complement',
  'consumable_restock', 'restock_assigned',
  'escalation', 'escalade', 'escalade_message', 'escalade_reminder',
  'negative_sentiment', 'host_question', 'upsell_paid',
  'deposit_expiry_alert', 'deposit_reminder', 'deposit_auto_released',
  'contract_signed', 'smart_lock_battery', 'support', 'test',
]);

// Cache court : un cron qui envoie 200 pushes ne doit pas faire 200 SELECT.
const CACHE_TTL_MS = 60_000;
const cache = new Map(); // userId -> { at, prefs }

function prefKeyFor(type) {
  return TYPE_TO_PREF[String(type || '')] || null;
}

async function readPrefs(pool, userId) {
  const hit = cache.get(String(userId));
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.prefs;

  let prefs = {};
  try {
    const { rows } = await pool.query(
      'SELECT notifications FROM user_settings WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    const raw = rows[0] && rows[0].notifications;
    prefs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  } catch (e) {
    console.warn('[NOTIF-PREF] Lecture impossible pour', userId, '—', e.message);
    prefs = {}; // tout autorisé
  }
  cache.set(String(userId), { at: Date.now(), prefs });
  return prefs;
}

/** À appeler après une écriture de préférences (POST /api/settings/notifications). */
function invalidate(userId) {
  cache.delete(String(userId));
}

// Cache token FCM → user_id. Un token ne change pas de propriétaire sans
// repasser par /api/save-token, qui supprime l'ancienne ligne.
const TOKEN_TTL_MS = 10 * 60_000;
const tokenCache = new Map(); // fcm_token -> { at, userId }

async function userIdForToken(pool, fcmToken) {
  if (!pool || !fcmToken) return null;
  const hit = tokenCache.get(fcmToken);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.userId;
  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM user_fcm_tokens WHERE fcm_token = $1 LIMIT 1',
      [fcmToken]
    );
    const userId = rows[0] ? rows[0].user_id : null;
    tokenCache.set(fcmToken, { at: Date.now(), userId });
    return userId;
  } catch (e) {
    return null; // inconnu = on laisse passer
  }
}

/**
 * Variante par token, pour les émetteurs qui n'ont qu'un token FCM sous la main
 * (c'est le cas de sendNotification, et donc de TOUS ses appelants :
 * integrated-chat-handler, crons cautions, upsell…).
 */
async function allowsForToken(pool, fcmToken, type) {
  if (!type) return true;
  if (ALWAYS.has(String(type))) return true;
  if (!prefKeyFor(type)) return true;
  const userId = await userIdForToken(pool, fcmToken);
  if (!userId) return true;
  return allows(pool, userId, type);
}

/**
 * Ce type de notification a-t-il le droit de partir pour cet utilisateur ?
 */
async function allows(pool, userId, type) {
  if (!userId || !type) return true;
  if (ALWAYS.has(String(type))) return true;

  const key = prefKeyFor(type);
  if (!key) return true;                  // type non couvert : on n'invente pas

  const prefs = await readPrefs(pool, userId);
  const v = prefs[key];
  if (v === undefined || v === null) return true;      // jamais réglé = activé
  return !(v === false || v === 0 || v === '0' || v === 'false');
}

/**
 * Tokens FCM d'un utilisateur pour un type donné. Renvoie [] si la préférence
 * est coupée — l'appelant n'a rien d'autre à tester.
 *
 * @param {object}  pool
 * @param {number}  userId
 * @param {string}  type
 * @param {object}  [opts]
 * @param {boolean} [opts.mainDeviceOnly] true = exclut les sous-comptes
 *                  (sub_account_id IS NULL), comme le fait déjà
 *                  integrated-chat-handler pour les messages voyageurs.
 */
async function tokensFor(pool, userId, type, opts = {}) {
  if (!(await allows(pool, userId, type))) {
    console.log(`🔕 [NOTIF-PREF] ${type} coupé par l'utilisateur ${userId}`);
    return [];
  }
  const sql = opts.mainDeviceOnly
    ? 'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL AND sub_account_id IS NULL'
    : 'SELECT fcm_token FROM user_fcm_tokens WHERE user_id = $1 AND fcm_token IS NOT NULL';
  try {
    const { rows } = await pool.query(sql, [userId]);
    return rows.map((r) => r.fcm_token).filter(Boolean);
  } catch (e) {
    console.error('[NOTIF-PREF] Lecture tokens:', e.message);
    return [];
  }
}

module.exports = { allows, allowsForToken, tokensFor, invalidate, prefKeyFor, TYPE_TO_PREF, ALWAYS };
