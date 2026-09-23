'use strict';
/**
 * Pricing Publish Lock — P0-C4.9-C
 *
 * PostgreSQL session-level advisory lock for per-property pricing serialization.
 *
 * Namespace: 1002 (distinct from billing namespace 1001).
 * Key:       pg_try_advisory_lock(1002, hashtext(propertyId))
 *
 * Strategy: pg_try_advisory_lock + deadline loop.
 *   • No session-level state (SET statement_timeout) is modified.
 *   • Retries every RETRY_INTERVAL_MS until ACQUIRE_TIMEOUT_MS elapses.
 *   • On timeout: throws Error with code='PRICING_PUBLISH_LOCK_TIMEOUT'.
 *   • No busy-loop: each retry sleeps RETRY_INTERVAL_MS ms.
 *
 * Release: pg_advisory_unlock must be called in a finally block before
 * client.release(). Session-level locks survive COMMIT/ROLLBACK but are
 * automatically released if the PostgreSQL connection is closed.
 */

const LOCK_NAMESPACE    = 1002;
const ACQUIRE_TIMEOUT_MS = 15000; // 15 s
const RETRY_INTERVAL_MS  = 100;   // 100 ms between retries → max 150 attempts

/**
 * Acquire the advisory lock for propertyId on the given dedicated client.
 * Blocks (via retries) until the lock is acquired or the deadline expires.
 *
 * @param {object} client  - pg PoolClient (or compatible mock with .query())
 * @param {string} propertyId
 * @throws {Error} code='PRICING_PUBLISH_LOCK_TIMEOUT' if deadline exceeded
 */
async function acquirePropertyLock(client, propertyId) {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    const { rows } = await client.query(
      'SELECT pg_try_advisory_lock($1::int4, hashtext($2)::int4) AS acquired',
      [LOCK_NAMESPACE, String(propertyId)]
    );
    if (rows[0].acquired) return;
    if (Date.now() >= deadline) {
      const err = new Error(
        `PRICING_PUBLISH_LOCK_TIMEOUT: could not acquire lock for property ${propertyId}` +
        ` within ${ACQUIRE_TIMEOUT_MS}ms`
      );
      err.code = 'PRICING_PUBLISH_LOCK_TIMEOUT';
      throw err;
    }
    await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
  }
}

/**
 * Release the advisory lock for propertyId on the given dedicated client.
 * Must be called in a finally block before client.release().
 *
 * @param {object} client  - same pg PoolClient that acquired the lock
 * @param {string} propertyId
 */
async function releasePropertyLock(client, propertyId) {
  await client.query(
    'SELECT pg_advisory_unlock($1::int4, hashtext($2)::int4)',
    [LOCK_NAMESPACE, String(propertyId)]
  );
}

module.exports = {
  acquirePropertyLock,
  releasePropertyLock,
  LOCK_NAMESPACE,
  ACQUIRE_TIMEOUT_MS,
  RETRY_INTERVAL_MS,
};
