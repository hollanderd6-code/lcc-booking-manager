'use strict';
/**
 * Canonical PostgreSQL pool factory for outils and service scripts.
 *
 * Matches the ssl configuration in server.js:
 *   production  → ssl: { rejectUnauthorized: false }
 *   otherwise   → ssl: false
 *
 * Render/Supabase serve PostgreSQL with a self-signed certificate in the
 * certificate chain. Node.js rejects it by default. rejectUnauthorized: false
 * is the established approach for this infrastructure — every production
 * outils in this repo uses the same policy. This is not a global TLS bypass;
 * it applies only to the single pg Pool created here.
 *
 * DO NOT print DATABASE_URL or connection secrets.
 * DO NOT set NODE_TLS_REJECT_UNAUTHORIZED.
 * DO NOT hardcode certificates.
 */

const { Pool } = require('pg');

/**
 * Create a pg Pool using the canonical SSL configuration.
 *
 * @returns {import('pg').Pool}
 */
function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });
}

module.exports = { createPool };
