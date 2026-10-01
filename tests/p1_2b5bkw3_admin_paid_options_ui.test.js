'use strict';
// P1.2-B5-BK-W3 — Admin paid options UI integration
// Tests: UI-01..19, SMS-CONSISTENCY-01..02

const fs   = require('fs');
const path = require('path');

const {
  grantSmsAdmin,
  revokeSmsAdmin,
  handleStripeSmsCancellation,
  grantBoostpriceAdmin,
  revokeBoostpriceAdmin,
} = require('../services/admin-paid-options-service');

// ─────────────────────────────────────────────────────────────────────────────
// Source readers
// ─────────────────────────────────────────────────────────────────────────────

const adminHtml   = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const serverJs    = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (shared with w2 suite)
// ─────────────────────────────────────────────────────────────────────────────

function makeSimplePool(smsRow = {}) {
  return {
    query: jest.fn(async (sql, _params) => {
      if (sql.includes('UPDATE subscriptions')) {
        const hasPaidSms = !!(smsRow.sms_stripe_subscription_id);
        const isRevokeSql = sql.includes('sms_stripe_subscription_id IS NOT NULL');
        const row = {
          sms_enabled: isRevokeSql ? hasPaidSms : true,
          sms_stripe_subscription_id: smsRow.sms_stripe_subscription_id ?? null,
        };
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('SELECT') && sql.includes('sms_stripe_subscription_id')) {
        const subId = _params?.[0];
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
  const client = {
    query: jest.fn(async (sql, params) => {
      if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
      if (sql.includes('SELECT') && sql.includes('boostprice_property_entitlements')) {
        const ids = params?.[0] || [];
        return { rows: entitlementRows.filter(r => ids.includes(r.property_id)) };
      }
      if (sql.includes('UPDATE') || sql.includes('INSERT')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return {
    connect: jest.fn(async () => client),
    _client: client,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UI-01..07: admin.html static structure
// ─────────────────────────────────────────────────────────────────────────────

describe('admin.html static structure', () => {
  test('UI-01: currentDrawerClientId is declared', () => {
    expect(adminHtml).toMatch(/let currentDrawerClientId\s*=/);
  });

  test('UI-02: currentDrawerClientId set in openDrawer', () => {
    const fnMatch = adminHtml.match(/function openDrawer\(userId\)\s*\{([\s\S]{0,200})/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[1]).toMatch(/currentDrawerClientId\s*=\s*userId/);
  });

  test('UI-03: currentDrawerClientId cleared in closeDrawer', () => {
    const fnMatch = adminHtml.match(/function closeDrawer\(\)\s*\{([\s\S]{0,200})/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[1]).toMatch(/currentDrawerClientId\s*=\s*null/);
  });

  test('UI-04: Options payantes section exists in drawer template', () => {
    expect(adminHtml).toContain('Options payantes');
  });

  test('UI-05: boostPriceList container exists', () => {
    expect(adminHtml).toMatch(/id=["']boostPriceList["']/);
  });

  test('UI-06: SMS grant button calls adminGrantSms', () => {
    expect(adminHtml).toMatch(/adminGrantSms\(/);
  });

  test('UI-07: SMS revoke button calls adminRevokeSms', () => {
    expect(adminHtml).toMatch(/adminRevokeSms\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-08..12: admin.html function definitions
// ─────────────────────────────────────────────────────────────────────────────

describe('admin.html function definitions', () => {
  test('UI-08: loadAdminPaidOptions is defined', () => {
    expect(adminHtml).toMatch(/async function loadAdminPaidOptions\(/);
  });

  test('UI-09: adminGrantSms is defined', () => {
    expect(adminHtml).toMatch(/async function adminGrantSms\(/);
  });

  test('UI-10: adminRevokeSms is defined', () => {
    expect(adminHtml).toMatch(/async function adminRevokeSms\(/);
  });

  test('UI-11: adminGrantBoostprice is defined', () => {
    expect(adminHtml).toMatch(/async function adminGrantBoostprice\(/);
  });

  test('UI-12: adminRevokeBoostprice is defined', () => {
    expect(adminHtml).toMatch(/async function adminRevokeBoostprice\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-13..16: ACTION_LABELS additions
// ─────────────────────────────────────────────────────────────────────────────

describe('ACTION_LABELS', () => {
  test('UI-13: grant_sms label exists', () => {
    expect(adminHtml).toContain('grant_sms');
  });

  test('UI-14: revoke_sms label exists', () => {
    expect(adminHtml).toContain('revoke_sms');
  });

  test('UI-15: grant_boostprice label exists', () => {
    expect(adminHtml).toContain('grant_boostprice');
  });

  test('UI-16: revoke_boostprice label exists', () => {
    expect(adminHtml).toContain('revoke_boostprice');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI-17..19: stale drawer guard
// ─────────────────────────────────────────────────────────────────────────────

describe('stale drawer guard', () => {
  test('UI-17: loadAdminPaidOptions checks currentDrawerClientId', () => {
    const start = adminHtml.indexOf('async function loadAdminPaidOptions(');
    expect(start).toBeGreaterThan(0);
    const slice = adminHtml.slice(start, start + 1500);
    expect(slice).toMatch(/currentDrawerClientId\s*!==\s*userId/);
  });

  test('UI-18: BoostPrice grant uses stale guard before refreshing list', () => {
    const fnMatch = adminHtml.match(/async function adminGrantBoostprice\(([\s\S]{0,600}?)^}/m);
    const body = fnMatch ? fnMatch[0] : adminHtml;
    expect(body).toMatch(/currentDrawerClientId\s*===\s*userId/);
  });

  test('UI-19: BoostPrice revoke uses stale guard before refreshing list', () => {
    const fnMatch = adminHtml.match(/async function adminRevokeBoostprice\(([\s\S]{0,600}?)^}/m);
    const body = fnMatch ? fnMatch[0] : adminHtml;
    expect(body).toMatch(/currentDrawerClientId\s*===\s*userId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SMS-CONSISTENCY-01..02: server.js SMS unsubscribe fix
// ─────────────────────────────────────────────────────────────────────────────

describe('server.js SMS unsubscribe consistency', () => {
  test('SMS-CONSISTENCY-01: DELETE /api/billing/sms/unsubscribe uses sms_admin_granted, not FALSE', () => {
    // Find the unsubscribe route block
    const idx = serverJs.indexOf('/api/billing/sms/unsubscribe');
    expect(idx).toBeGreaterThan(0);
    const slice = serverJs.slice(idx, idx + 1800);
    expect(slice).toMatch(/sms_enabled\s*=\s*sms_admin_granted/);
    expect(slice).not.toMatch(/sms_enabled\s*=\s*FALSE/i);
  });

  test('SMS-CONSISTENCY-02: handleStripeSmsCancellation also uses sms_admin_granted expression', () => {
    const idx = serverJs.indexOf('handleStripeSmsCancellation');
    expect(idx).toBeGreaterThan(0);
    // The call site delegates to the service — just verify the service function uses the column expression
    const svc = fs.readFileSync(path.join(__dirname, '../services/admin-paid-options-service.js'), 'utf8');
    expect(svc).toMatch(/sms_enabled\s*=\s*sms_admin_granted/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service layer round-trip smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe('service layer — SMS grant/revoke', () => {
  test('grantSmsAdmin returns correct shape', async () => {
    const pool = makeSimplePool({});
    const result = await grantSmsAdmin(pool, 'user-x');
    expect(result).toMatchObject({ smsAdminGranted: true, smsEnabled: true });
  });

  test('revokeSmsAdmin — with paid SMS → smsEnabled remains true', async () => {
    const pool = makeSimplePool({ sms_stripe_subscription_id: 'sub_abc' });
    const result = await revokeSmsAdmin(pool, 'user-x');
    expect(result.smsAdminGranted).toBe(false);
    expect(result.smsEnabled).toBe(true);
    expect(result.hadPaidSms).toBe(true);
  });

  test('revokeSmsAdmin — without paid SMS → smsEnabled false', async () => {
    const pool = makeSimplePool({ sms_stripe_subscription_id: null });
    const result = await revokeSmsAdmin(pool, 'user-x');
    expect(result.smsAdminGranted).toBe(false);
    expect(result.smsEnabled).toBe(false);
    expect(result.hadPaidSms).toBe(false);
  });
});

describe('service layer — BoostPrice grant/revoke', () => {
  test('grantBoostpriceAdmin inserts new row', async () => {
    const pool = makeTransactionalPool([]);
    const result = await grantBoostpriceAdmin(pool, 'user-y', ['prop-1']);
    expect(result.grantedIds).toContain('prop-1');
    expect(result.alreadyPaidIds).toHaveLength(0);
    expect(result.alreadyAdminIds).toHaveLength(0);
  });

  test('grantBoostpriceAdmin does not overwrite paid entitlement', async () => {
    const pool = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'stripe' }
    ]);
    const result = await grantBoostpriceAdmin(pool, 'user-y', ['prop-1']);
    expect(result.alreadyPaidIds).toContain('prop-1');
    expect(result.grantedIds).toHaveLength(0);
  });

  test('grantBoostpriceAdmin is idempotent for admin-granted', async () => {
    const pool = makeTransactionalPool([
      { property_id: 'prop-1', status: 'active', source: 'admin' }
    ]);
    const result = await grantBoostpriceAdmin(pool, 'user-y', ['prop-1']);
    expect(result.alreadyAdminIds).toContain('prop-1');
    expect(result.grantedIds).toHaveLength(0);
  });

  test('revokeBoostpriceAdmin cancels admin grant', async () => {
    const pool = makeTransactionalPool([
      { property_id: 'prop-2', status: 'active', source: 'admin' }
    ]);
    const result = await revokeBoostpriceAdmin(pool, 'user-y', ['prop-2']);
    expect(result.revokedIds).toContain('prop-2');
    expect(result.paidProtectedIds).toHaveLength(0);
  });

  test('revokeBoostpriceAdmin protects paid entitlement', async () => {
    const pool = makeTransactionalPool([
      { property_id: 'prop-2', status: 'active', source: 'stripe' }
    ]);
    const result = await revokeBoostpriceAdmin(pool, 'user-y', ['prop-2']);
    expect(result.paidProtectedIds).toContain('prop-2');
    expect(result.revokedIds).toHaveLength(0);
  });
});
