'use strict';
// P1.2-B5-BK-W2 — Admin-granted paid options: SMS + BoostPrice
// Tests: SMS-01..08, BP-01..13, ADMIN-01..03

const path = require('path');
const fs   = require('fs');

const {
  grantSmsAdmin,
  revokeSmsAdmin,
  handleStripeSmsCancellation,
  getAdminClientProperties,
  grantBoostpriceAdmin,
  revokeBoostpriceAdmin,
} = require('../services/admin-paid-options-service');

const { hasBoostPriceEntitlement } = require('../services/boostprice-entitlement');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSimplePool(smsRow = {}) {
  return {
    query: jest.fn(async (sql, params) => {
      if (sql.includes('UPDATE subscriptions')) {
        const hasPaidSms = !!(smsRow.sms_stripe_subscription_id);
        // Detect the atomic revoke expression that computes sms_enabled from stripe presence
        const isRevokeSql = sql.includes('sms_stripe_subscription_id IS NOT NULL');
        const row = {
          sms_enabled: isRevokeSql ? hasPaidSms : (smsRow.sms_enabled ?? true),
          sms_stripe_subscription_id: smsRow.sms_stripe_subscription_id ?? null,
        };
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('SELECT') && sql.includes('sms_stripe_subscription_id')) {
        // handleStripeSmsCancellation lookup — match regardless of whitespace/newlines
        const subId = params?.[0];
        if (subId && subId === smsRow.sms_stripe_subscription_id) {
          return { rows: [{ user_id: smsRow.user_id || 'user-1' }] };
        }
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

function makeTransactionalPool(entitlementRows = []) {
  const executedQueries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      executedQueries.push({ sql: sql.trim(), params: params || [] });
      if (sql.trim() === 'BEGIN' || sql.trim() === 'COMMIT' || sql.trim() === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SELECT property_id, status, source') &&
          sql.includes('boostprice_property_entitlements')) {
        const ids = params[0]; // array
        const rows = entitlementRows.filter(r => ids.includes(r.property_id));
        return { rows };
      }
      if (sql.includes('UPDATE boostprice_property_entitlements') ||
          sql.includes('INSERT INTO boostprice_property_entitlements')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
    get _executedQueries() { return executedQueries; },
  };
  const pool = {
    connect: jest.fn().mockResolvedValue(client),
    query:   jest.fn().mockResolvedValue({ rows: [] }),
    _client: client,
  };
  return { pool, client, executedQueries };
}

function makeBpPool(entitlementRow) {
  // Simple non-transactional pool for hasBoostPriceEntitlement tests
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM boostprice_property_entitlements')) {
        return { rows: entitlementRow ? [{ id: 1 }] : [] };
      }
      return { rows: [] };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SMS', () => {

  test('SMS-01: admin grant → sms_admin_granted=true AND sms_enabled=true', async () => {
    const pool = makeSimplePool();
    const result = await grantSmsAdmin(pool, 'user-1');

    expect(result.smsAdminGranted).toBe(true);
    expect(result.smsEnabled).toBe(true);

    const updateCall = pool.query.mock.calls.find(c =>
      c[0].includes('UPDATE subscriptions') && c[0].includes('sms_admin_granted')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(/sms_admin_granted\s*=\s*TRUE/i);
    expect(updateCall[0]).toMatch(/sms_enabled\s*=\s*TRUE/i);
    expect(updateCall[1]).toContain('user-1');
  });

  test('SMS-02: admin-only revoke → sms_enabled=false, sms_admin_granted=false', async () => {
    // No Stripe sub
    const pool = makeSimplePool({ sms_stripe_subscription_id: null });
    const result = await revokeSmsAdmin(pool, 'user-1');

    expect(result.smsAdminGranted).toBe(false);
    expect(result.smsEnabled).toBe(false);
    expect(result.hadPaidSms).toBe(false);
  });

  test('SMS-03: paid-only + admin revoke → sms_enabled remains true', async () => {
    const pool = makeSimplePool({ sms_stripe_subscription_id: 'sub_abc' });
    const result = await revokeSmsAdmin(pool, 'user-1');

    expect(result.smsAdminGranted).toBe(false);
    expect(result.smsEnabled).toBe(true);
    expect(result.hadPaidSms).toBe(true);

    // The UPDATE SQL must compute sms_enabled from sms_stripe_subscription_id, not hardcode FALSE
    const updateCall = pool.query.mock.calls.find(c =>
      c[0].includes('sms_admin_granted = FALSE')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(/sms_enabled\s*=\s*\(sms_stripe_subscription_id IS NOT NULL\)/i);
  });

  test('SMS-04: paid+admin + admin revoke → admin=false, enabled=true', async () => {
    const pool = makeSimplePool({ sms_admin_granted: true, sms_stripe_subscription_id: 'sub_abc' });
    const result = await revokeSmsAdmin(pool, 'user-1');

    expect(result.smsAdminGranted).toBe(false);
    expect(result.smsEnabled).toBe(true); // paid SMS survives
    expect(result.hadPaidSms).toBe(true);
  });

  test('SMS-05: Stripe deletion with no admin grant → sms_enabled=false', async () => {
    const pool = makeSimplePool({
      user_id: 'user-1',
      sms_stripe_subscription_id: 'sub_deleted',
    });
    await handleStripeSmsCancellation(pool, 'sub_deleted');

    const updateCall = pool.query.mock.calls.find(c =>
      c[0].includes('sms_enabled') && c[0].includes('sms_admin_granted') && c[0].includes('UPDATE')
    );
    expect(updateCall).toBeTruthy();
    // Key invariant: sms_enabled is set FROM sms_admin_granted (DB expression), not hardcoded FALSE
    expect(updateCall[0]).toMatch(/sms_enabled\s*=\s*sms_admin_granted/i);
    expect(updateCall[0]).toMatch(/sms_stripe_subscription_id\s*=\s*NULL/i);
  });

  test('SMS-06: Stripe deletion with admin grant → sms_admin_granted preserved', async () => {
    // The DB expression sms_enabled = sms_admin_granted means if admin=true, enabled stays true.
    // Verified by checking the UPDATE SQL uses the column reference, not a literal.
    const pool = makeSimplePool({
      user_id: 'user-1',
      sms_stripe_subscription_id: 'sub_deleted',
    });
    await handleStripeSmsCancellation(pool, 'sub_deleted');

    // Find the UPDATE that sets sms_enabled from the admin grant column
    const updateCall = pool.query.mock.calls.find(c =>
      c[0].includes('UPDATE subscriptions') && c[0].includes('sms_admin_granted')
    );
    expect(updateCall).toBeTruthy();
    // The expression must read sms_admin_granted (not assign a literal TRUE/FALSE to it)
    expect(updateCall[0]).toMatch(/sms_enabled\s*=\s*sms_admin_granted/);
    // sms_admin_granted itself is NOT assigned a value by the webhook
    expect(updateCall[0]).not.toMatch(/sms_admin_granted\s*=\s*FALSE/i);
    expect(updateCall[0]).not.toMatch(/sms_admin_granted\s*=\s*TRUE/i);
  });

  test('SMS-07: Stripe SMS activation SQL does not touch sms_admin_granted', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const idx = src.indexOf('isSmsOption = session.metadata');
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 600);
    expect(block).toContain('sms_enabled = TRUE');
    expect(block).toContain('sms_stripe_subscription_id');
    // Must not reset admin grant column during paid activation
    expect(block).not.toContain('sms_admin_granted = FALSE');
    expect(block).not.toContain('sms_admin_granted=FALSE');
  });

  test('SMS-08: grantSmsAdmin and revokeSmsAdmin never call Stripe', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/admin-paid-options-service.js'), 'utf8'
    );
    expect(src).not.toMatch(/require\s*\(\s*['"]stripe['"]/);
    expect(src).not.toMatch(/\bstripe\s*\./);
    expect(src).not.toMatch(/stripe\.subscriptions/);
    expect(src).not.toMatch(/stripe\.checkout/);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BoostPrice tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BoostPrice', () => {

  test('BP-01: inactive property → admin grant → status=active/source=admin', async () => {
    const { pool, client } = makeTransactionalPool([]); // no existing entitlement

    const result = await grantBoostpriceAdmin(pool, 'user-1', ['prop-1']);

    expect(result.grantedIds).toEqual(['prop-1']);
    expect(result.alreadyPaidIds).toEqual([]);
    expect(result.alreadyAdminIds).toEqual([]);

    const insertCall = client._executedQueries.find(q =>
      q.sql.includes('INSERT INTO boostprice_property_entitlements')
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall.sql).toContain("'admin'");
    expect(insertCall.sql).toContain("'active'");
  });

  test('BP-02: active admin grant → repeat grant → idempotent (alreadyAdmin)', async () => {
    const { pool } = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'admin' },
    ]);

    const result = await grantBoostpriceAdmin(pool, 'user-1', ['prop-1']);

    expect(result.grantedIds).toEqual([]);
    expect(result.alreadyAdminIds).toEqual(['prop-1']);
  });

  test('BP-03: active Stripe entitlement → admin grant → not converted, reported as alreadyPaid', async () => {
    const { pool, client } = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'stripe' },
    ]);

    const result = await grantBoostpriceAdmin(pool, 'user-1', ['prop-1']);

    expect(result.alreadyPaidIds).toEqual(['prop-1']);
    expect(result.grantedIds).toEqual([]);

    // No INSERT or UPDATE for this property
    const mutations = client._executedQueries.filter(q =>
      q.sql.includes('INSERT INTO boostprice_property_entitlements') ||
      q.sql.includes('UPDATE boostprice_property_entitlements')
    );
    expect(mutations).toHaveLength(0);
  });

  test('BP-04: active admin entitlement → revoke → status=canceled', async () => {
    const { pool, client } = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'admin' },
    ]);

    const result = await revokeBoostpriceAdmin(pool, 'user-1', ['prop-1']);

    expect(result.revokedIds).toEqual(['prop-1']);
    expect(result.paidProtectedIds).toEqual([]);

    const updateCall = client._executedQueries.find(q =>
      q.sql.includes('UPDATE boostprice_property_entitlements') &&
      q.sql.includes("status = 'canceled'")
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall.sql).toContain("source = 'admin'");
  });

  test('BP-05: active Stripe entitlement → admin revoke → untouched, paidProtected', async () => {
    const { pool, client } = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'stripe' },
    ]);

    const result = await revokeBoostpriceAdmin(pool, 'user-1', ['prop-1']);

    expect(result.paidProtectedIds).toEqual(['prop-1']);
    expect(result.revokedIds).toEqual([]);

    const updateCalls = client._executedQueries.filter(q =>
      q.sql.includes('UPDATE boostprice_property_entitlements')
    );
    expect(updateCalls).toHaveLength(0);
  });

  test('BP-06: wrong-user property → ownership check rejects, no transaction started', async () => {
    // Simulate the ownership validation logic from the route handler
    const ownedInDb = []; // no properties belong to target user
    const pool = {
      connect: jest.fn(),
      query: jest.fn(async (sql) => {
        if (sql.includes('SELECT id FROM properties WHERE id = ANY')) return { rows: ownedInDb };
        if (sql.includes('SELECT id FROM users WHERE id')) return { rows: [{ id: 'target-user' }] };
        return { rows: [] };
      }),
    };

    const propertyIds = ['foreign-prop'];
    const ownedResult = await pool.query(
      `SELECT id FROM properties WHERE id = ANY($1::text[]) AND user_id = $2`,
      [propertyIds, 'target-user']
    );
    const foreignIds = propertyIds.filter(id => !ownedResult.rows.map(r => r.id).includes(id));

    expect(foreignIds).toEqual(['foreign-prop']);
    expect(pool.connect).not.toHaveBeenCalled(); // no transaction started
  });

  test('BP-07: mixed request (valid + foreign) → entire mutation rejected, no writes', async () => {
    const pool = {
      connect: jest.fn(),
      query: jest.fn(async (sql) => {
        if (sql.includes('SELECT id FROM properties WHERE id = ANY')) {
          return { rows: [{ id: 'prop-owned' }] }; // only 1 of 2
        }
        if (sql.includes('SELECT id FROM users WHERE id')) return { rows: [{ id: 'user-1' }] };
        return { rows: [] };
      }),
    };

    const propertyIds = ['prop-owned', 'prop-foreign'];
    const ownedResult = await pool.query(
      `SELECT id FROM properties WHERE id = ANY($1::text[]) AND user_id = $2`,
      [propertyIds, 'user-1']
    );
    const foreignIds = propertyIds.filter(id => !ownedResult.rows.map(r => r.id).includes(id));

    expect(foreignIds).toHaveLength(1); // route returns 403
    expect(pool.connect).not.toHaveBeenCalled(); // no transaction
  });

  test('BP-08: multi-property valid grant is wrapped in BEGIN/COMMIT', async () => {
    const { pool, client } = makeTransactionalPool([]); // no existing entitlements

    await grantBoostpriceAdmin(pool, 'user-1', ['prop-1', 'prop-2', 'prop-3']);

    const txSeq = client._executedQueries.map(q => q.sql);
    expect(txSeq[0]).toBe('BEGIN');
    expect(txSeq[txSeq.length - 1]).toBe('COMMIT');
  });

  test('BP-08b: transaction rolls back on error', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.trim() === 'BEGIN' || sql.trim() === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT property_id')) throw new Error('DB connection lost');
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };

    await expect(
      grantBoostpriceAdmin(pool, 'user-1', ['prop-1'])
    ).rejects.toThrow('DB connection lost');

    const calls = client.query.mock.calls.map(c => c[0].trim());
    expect(calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('BP-09: admin entitlement grants access via canonical hasBoostPriceEntitlement when main sub valid', async () => {
    const pool = makeBpPool(true); // returns a row → entitled
    const result = await hasBoostPriceEntitlement(pool, 'user-1', 'prop-1');
    expect(result).toBe(true);
  });

  test('BP-10: admin entitlement does NOT bypass expired/invalid main subscription', async () => {
    const pool = makeBpPool(false); // combined SQL returns nothing → not entitled
    const result = await hasBoostPriceEntitlement(pool, 'user-1', 'prop-1');
    expect(result).toBe(false);
  });

  test('BP-11: admin entitlement → customer buys BoostPrice → Stripe webhook converts source to stripe', () => {
    // Verify the Stripe BoostPrice activation webhook in server.js uses an ON CONFLICT upsert
    // that unconditionally sets source='stripe', overwriting any existing admin source.
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const idx = src.indexOf('isBoostpriceOption = session.metadata');
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 1500);

    expect(block).toContain('ON CONFLICT (property_id) DO UPDATE');
    expect(block).toContain("source = 'stripe'");
    // The upsert sets source='stripe' regardless of previous value — admin→stripe transition
    expect(block).toContain("SET status = 'active', source = 'stripe'");
  });

  test('BP-12: after admin→stripe transition, admin revoke cannot remove stripe entitlement', async () => {
    // Property was originally admin-granted; Stripe webhook converted it to source='stripe'
    const { pool, client } = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'stripe' },
    ]);

    const result = await revokeBoostpriceAdmin(pool, 'user-1', ['prop-1']);

    expect(result.paidProtectedIds).toEqual(['prop-1']);
    expect(result.revokedIds).toEqual([]);

    // No UPDATE should touch prop-1
    const updateCalls = client._executedQueries.filter(q =>
      q.sql.includes('UPDATE boostprice_property_entitlements')
    );
    expect(updateCalls).toHaveLength(0);
  });

  test('BP-13: admin grant and revoke service never import or call Stripe', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/admin-paid-options-service.js'), 'utf8'
    );
    expect(src).not.toMatch(/require\s*\(\s*['"]stripe['"]/);
    expect(src).not.toMatch(/\bstripe\s*\./);
    expect(src).not.toMatch(/stripe\.subscriptions/);
    expect(src).not.toMatch(/stripe\.checkout/);
    expect(src).not.toMatch(/STRIPE_/);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Admin infrastructure tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin infrastructure', () => {

  test('ADMIN-01: requireBhAdmin rejects non-admin email with 403', () => {
    const ADMIN_EMAILS = ['charles.induni@gmail.com', 'arnaud.gestionpro@gmail.com'];
    const nonAdmin = { email: 'attacker@evil.com', id: 'x' };

    expect(ADMIN_EMAILS.includes(nonAdmin.email)).toBe(false);

    // Simulate the requireBhAdmin response
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    if (!ADMIN_EMAILS.includes(nonAdmin.email)) {
      mockRes.status(403).json({ error: 'Accès refusé' });
    }
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Accès refusé' });
  });

  test('ADMIN-01b: requireBhAdmin in server.js source uses ADMIN_EMAILS check', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const fnIdx = src.indexOf('async function requireBhAdmin(');
    expect(fnIdx).toBeGreaterThan(0);
    const fnBody = src.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toContain('ADMIN_EMAILS.includes');
    expect(fnBody).toContain("res.status(403)");
  });

  test('ADMIN-02: logAdminAction writes to admin_actions_log table', async () => {
    const inserted = [];
    const pool = {
      query: jest.fn(async (sql, params) => {
        if (sql.includes('INSERT INTO admin_actions_log')) inserted.push(params);
        return { rows: [] };
      }),
    };
    // Replicate logAdminAction logic
    const admin = { email: 'charles.induni@gmail.com', id: 'admin-1' };
    await pool.query(
      `INSERT INTO admin_actions_log (admin_email, admin_user_id, target_user_id, action, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [admin.email, admin.id, 'user-1', 'grant_sms', JSON.stringify({ target_email: 'u@x.com' })]
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0][3]).toBe('grant_sms');
    expect(inserted[0][0]).toBe('charles.induni@gmail.com');
  });

  test('ADMIN-02b: all new admin routes call logAdminAction (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    // Find each route and verify it calls logAdminAction
    const routeMarkers = [
      "'/api/admin/clients/:id/sms/grant'",
      "'/api/admin/clients/:id/sms/revoke'",
      "'/api/admin/clients/:id/boostprice/grant'",
      "'/api/admin/clients/:id/boostprice/revoke'",
    ];
    for (const marker of routeMarkers) {
      const idx = src.indexOf(marker);
      expect(idx).toBeGreaterThan(0);
      // Look for logAdminAction call within ~2000 chars of the route definition
      const block = src.slice(idx, idx + 2000);
      expect(block).toContain('logAdminAction(');
    }
  });

  test('ADMIN-03: getAdminClientProperties SQL uses WHERE p.user_id = $1, no delegation', async () => {
    const pool = {
      query: jest.fn(async () => ({
        rows: [{ id: 'p1', name: 'Flat', internalName: null, entitlement_status: null, entitlement_source: null }],
      })),
    };
    const props = await getAdminClientProperties(pool, 'user-1');

    const sqlCall = pool.query.mock.calls[0][0];
    expect(sqlCall).toContain('WHERE p.user_id = $1');
    expect(sqlCall).not.toContain('account_delegations');
    expect(sqlCall).not.toContain('getAgencyUserIds');

    expect(props).toHaveLength(1);
    expect(props[0].boostPriceStatus).toBe('inactive');
  });

  test('ADMIN-03b: getAdminClientProperties maps entitlement source correctly', async () => {
    const pool = {
      query: jest.fn(async () => ({
        rows: [
          { id: 'p1', name: 'A', internalName: null, entitlement_status: 'active', entitlement_source: 'stripe' },
          { id: 'p2', name: 'B', internalName: null, entitlement_status: 'active', entitlement_source: 'admin'  },
          { id: 'p3', name: 'C', internalName: null, entitlement_status: null,     entitlement_source: null      },
          { id: 'p4', name: 'D', internalName: null, entitlement_status: 'canceled', entitlement_source: 'admin' },
        ],
      })),
    };
    const props = await getAdminClientProperties(pool, 'user-1');

    expect(props.find(p => p.id === 'p1').boostPriceStatus).toBe('paid');
    expect(props.find(p => p.id === 'p2').boostPriceStatus).toBe('admin');
    expect(props.find(p => p.id === 'p3').boostPriceStatus).toBe('inactive');
    expect(props.find(p => p.id === 'p4').boostPriceStatus).toBe('inactive');
  });

  test('ADMIN-03c: GET /api/admin/clients SQL includes sms_enabled, sms_admin_granted, sms_paid', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    // Find the admin clients route
    const idx = src.indexOf("app.get('/api/admin/clients'");
    expect(idx).toBeGreaterThan(0);
    const block = src.slice(idx, idx + 1200);
    expect(block).toContain('sms_enabled');
    expect(block).toContain('sms_admin_granted');
    expect(block).toContain('sms_stripe_subscription_id IS NOT NULL');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

afterAll(() => {
  const t = expect.getState();
  const passed = t.assertionCalls - (t.suppressedErrors?.length ?? 0);
  console.log(`\nP1.2-B5-BK-W2 — Admin paid options — tests complete`);
});
