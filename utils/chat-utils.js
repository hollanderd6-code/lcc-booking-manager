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

module.exports = { deescalateConversation, guestAuth, issueGuestToken };
