'use strict';

const crypto = require('crypto');

/**
 * Reset escalation on a conversation when the host sends a message.
 * No-op if not currently escalated. Never throws — errors are logged and swallowed.
 */
async function deescalateConversation(pool, conversationId, source) {
  try {
    const result = await pool.query(
      'SELECT escalated FROM conversations WHERE id = $1',
      [conversationId]
    );
    if (result.rows[0]?.escalated) {
      await pool.query(
        'UPDATE conversations SET escalated = FALSE, escalated_at = NULL, updated_at = NOW() WHERE id = $1',
        [conversationId]
      );
      console.log(`✅ [DESESCALADE] Conv ${conversationId} — ${source}`);
    }
  } catch (e) {
    console.error('❌ [DESESCALADE] Erreur:', e.message);
  }
}

/**
 * Validate a guest token against a conversation.
 * Fetches the stored hash from DB then compares with timing-safe equality.
 * Returns true if valid, false otherwise. Never throws.
 */
async function guestAuth(pool, rawToken, conversationId) {
  if (!rawToken || !conversationId) return false;
  try {
    const r = await pool.query(
      'SELECT guest_token_hash FROM conversations WHERE id = $1',
      [String(conversationId)]
    );
    const storedHash = r.rows[0]?.guest_token_hash;
    if (!storedHash) return false;
    const computedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const a = Buffer.from(computedHash, 'utf8');
    const b = Buffer.from(storedHash, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/**
 * Generate a new guest token for a conversation.
 * Stores the SHA-256 hash in DB, returns the raw token for the client.
 */
async function issueGuestToken(pool, conversationId) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await pool.query(
    'UPDATE conversations SET guest_token_hash = $1, guest_token_issued_at = NOW() WHERE id = $2',
    [hash, String(conversationId)]
  );
  return rawToken;
}

/**
 * Determine host access for a conversation.
 * Pure function — caller is responsible for fetching comptes and accessibleIds from DB.
 *
 * Rules:
 *   - Not in comptesAutorises → always 403 (no sub-account bypass)
 *   - In comptesAutorises, isSubAccount, accessibleIds non-empty → property must be included
 */
function resolveHostAccess({ comptes, convUserId, convPropertyId, isSubAccount, accessibleIds = [] }) {
  if (!comptes.includes(convUserId)) {
    return { ok: false, reason: 'Accès refusé' };
  }
  if (isSubAccount && accessibleIds.length > 0 && !accessibleIds.includes(convPropertyId)) {
    return { ok: false, reason: 'Accès refusé à cette propriété' };
  }
  return { ok: true };
}

/**
 * Resolve the effective sender_type for a chat message.
 * Without authentication every message is forced to 'guest'.
 */
function resolveEffectiveSenderType(rawType, hasAuth) {
  return hasAuth ? rawType : 'guest';
}

/**
 * Factory for the PIN rate limiter used by POST /api/chat/verify-by-property.
 * Returns a check(key, max, windowMs) → retryAfter seconds | null function.
 * Each call to createPinRateLimiter() produces an independent Map so tests
 * stay isolated.
 */
function createPinRateLimiter() {
  const _attempts = new Map();
  return function check(key, max, windowMs) {
    const now = Date.now();
    const e = _attempts.get(key);
    if (!e || now >= e.resetAt) {
      _attempts.set(key, { count: 1, resetAt: now + windowMs });
      return null;
    }
    e.count++;
    return e.count > max ? Math.ceil((e.resetAt - now) / 1000) : null;
  };
}

/**
 * Decide whether a socket client may join a conversation room.
 * Returns:
 *   { ok: true }                          — guest token valid, join allowed
 *   { ok: false, reason }                 — denied
 *   { ok: null, reason: 'verify-host-jwt', token } — host JWT path; caller must
 *                                           verify the JWT and check ownership
 */
async function resolveSocketAccess(pool, { guestToken, hostToken, conversationId }) {
  if (!conversationId) return { ok: false, reason: 'conversationId manquant' };
  if (guestToken) {
    const ok = await guestAuth(pool, guestToken, conversationId);
    return ok ? { ok: true } : { ok: false, reason: 'Token voyageur invalide' };
  }
  if (hostToken) {
    return { ok: null, reason: 'verify-host-jwt', token: hostToken };
  }
  return { ok: false, reason: 'Authentification requise pour rejoindre cette room' };
}

module.exports = {
  deescalateConversation,
  guestAuth,
  issueGuestToken,
  resolveHostAccess,
  resolveEffectiveSenderType,
  createPinRateLimiter,
  resolveSocketAccess,
};
