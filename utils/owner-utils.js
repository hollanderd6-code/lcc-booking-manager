'use strict';

/**
 * Strip the 'agency_client_' prefix that the owner-clients list endpoint
 * adds to virtual IDs to avoid collisions with real owner_clients rows.
 * Returns null if the input is empty after stripping.
 */
function resolveOwnerClientId(ownerId) {
  if (!ownerId) return null;
  const s = String(ownerId);
  const id = s.startsWith('agency_client_') ? s.slice('agency_client_'.length) : s;
  return id || null;
}

module.exports = { resolveOwnerClientId };
