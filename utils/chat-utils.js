'use strict';

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

module.exports = { deescalateConversation };
