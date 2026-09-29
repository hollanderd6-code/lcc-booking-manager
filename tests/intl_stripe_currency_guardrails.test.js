'use strict';
/**
 * PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1D/1E
 *
 * Guardrail tests for scripts/test-stripe-currencies.js
 *
 * Vérifie que le script refuse de s'exécuter dans tout contexte non-TEST,
 * sans jamais effectuer d'appel Stripe réel ni utiliser de clé réelle.
 *
 * Suites 1D (plate-forme) :
 *   A — Refus sans clé
 *   B — Refus clé sk_live_ (avant tout appel réseau)
 *   C — Refus clé invalide
 *   D — Aucun secret affiché
 *   E — Aucune DB importée (analyse statique)
 *   F — Aucune route applicative importée (analyse statique)
 *   G — Aucune session créée quand le garde-fou échoue
 *
 * Suites 1E (Connect) :
 *   H — Connect account ID invalide → bloqué
 *   I — Aucun acct_ hardcodé dans le script
 *   J — Mode Connect utilise stripeAccount (analyse statique)
 *   K — Expiration utilise le même contexte Connect (analyse statique)
 *   L — Pas de retry EUR dans les catch (fail-closed, analyse statique)
 *   M — Mode platform reste fonctionnel sans CONNECT_ACCOUNT_ID (analyse statique)
 */

const path = require('path');
const cp   = require('child_process');
const fs   = require('fs');

const SCRIPT    = path.join(__dirname, '../scripts/test-stripe-currencies.js');
const scriptSrc = fs.readFileSync(SCRIPT, 'utf8');

// Lance le script avec exactement les variables fournies (rien hérité)
function run(extraEnv = {}) {
  return cp.spawnSync(process.execPath, [SCRIPT], {
    env: { ...extraEnv },
    encoding: 'utf8',
    timeout: 5000,
  });
}

// Clés/IDs factices — clairement pas des valeurs réelles
const FAKE_LIVE_KEY      = 'sk_live_' + 'X'.repeat(24);
const FAKE_INVALID_KEY   = 'not_a_stripe_key_at_all';
const FAKE_TEST_KEY      = 'sk_test_' + 'X'.repeat(24);
const FAKE_ACCT_INVALID  = 'not_an_acct_id';
const FAKE_ACCT_VALID    = 'acct_' + 'X'.repeat(16);

// ── A — Refus sans clé ────────────────────────────────────────────────────

describe('A — Refus sans clé STRIPE_SECRET_KEY', () => {
  test('A-01 exit code non-zero quand STRIPE_SECRET_KEY est absente', () => {
    const r = run({});
    expect(r.status).not.toBe(0);
  });

  test('A-02 stderr contient BLOCKED quand clé absente', () => {
    const r = run({});
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/BLOCKED/);
  });

  test('A-03 aucune mention de "PASS" ou "REJECTED" quand clé absente', () => {
    expect(run({}).stdout || '').not.toMatch(/PASS|REJECTED/);
  });
});

// ── B — Refus clé sk_live_ ────────────────────────────────────────────────

describe('B — Refus clé sk_live_ AVANT appel réseau', () => {
  test('B-01 exit code non-zero pour sk_live_', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY }).status).not.toBe(0);
  });

  test('B-02 stderr contient BLOCKED pour sk_live_', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY });
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/BLOCKED/);
  });

  test('B-03 le message mentionne que ce n\'est pas une clé TEST', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY }).stderr || '').toMatch(/not a Stripe TEST key/i);
  });

  test('B-04 aucun résultat de devise affiché pour sk_live_', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY }).stdout || '').not.toMatch(/EUR|ILS|USD|CHF/);
  });

  test('B-05 le script se termine avant d\'instancier Stripe (< 500ms)', () => {
    const start = Date.now();
    run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY });
    expect(Date.now() - start).toBeLessThan(500);
  });
});

// ── C — Refus clé invalide ────────────────────────────────────────────────

describe('C — Refus clé invalide (ni sk_test_ ni sk_live_)', () => {
  test('C-01 exit code non-zero pour clé invalide', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_INVALID_KEY }).status).not.toBe(0);
  });

  test('C-02 stderr contient BLOCKED pour clé invalide', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_INVALID_KEY });
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/BLOCKED/);
  });

  test('C-03 aucun résultat de devise pour clé invalide', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_INVALID_KEY }).stdout || '').not.toMatch(/EUR|ILS|USD|CHF/);
  });
});

// ── D — Aucun secret affiché ──────────────────────────────────────────────

describe('D — Aucun secret affiché dans stdout/stderr', () => {
  test('D-01 la valeur de la fake live key n\'apparaît pas dans stdout', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY }).stdout || '').not.toContain(FAKE_LIVE_KEY);
  });

  test('D-02 la valeur de la fake live key n\'apparaît pas dans stderr', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY }).stderr || '').not.toContain(FAKE_LIVE_KEY);
  });

  test('D-03 la valeur de la clé invalide n\'apparaît pas dans stdout', () => {
    expect(run({ STRIPE_SECRET_KEY: FAKE_INVALID_KEY }).stdout || '').not.toContain(FAKE_INVALID_KEY);
  });

  test('D-04 le code source ne log jamais rawKey directement', () => {
    expect(scriptSrc).not.toMatch(/console\.(log|error|warn)\s*\([^)]*rawKey/);
  });
});

// ── E — Aucune DB importée ────────────────────────────────────────────────

describe('E — Aucune DB importée (analyse statique)', () => {
  test('E-01 pas de require("pg") ni require("postgres")', () => {
    expect(scriptSrc).not.toMatch(/require\s*\(\s*['"]pg['"]\s*\)/);
    expect(scriptSrc).not.toMatch(/require\s*\(\s*['"]postgres['"]\s*\)/);
  });

  test('E-02 pas de Pool ni de pool.query', () => {
    expect(scriptSrc).not.toMatch(/new Pool|pool\.query/);
  });

  test('E-03 pas de DATABASE_URL utilisée', () => {
    expect(scriptSrc).not.toMatch(/DATABASE_URL/);
  });
});

// ── F — Aucune route applicative importée ─────────────────────────────────

describe('F — Aucune route/module applicatif importé', () => {
  test('F-01 pas de require de server.js', () => {
    expect(scriptSrc).not.toMatch(/require\s*\(\s*['"][./]*server['"]\s*\)/);
  });

  test('F-02 pas de require("express")', () => {
    expect(scriptSrc).not.toMatch(/require\s*\(\s*['"]express['"]\s*\)/);
  });

  test('F-03 pas de require des routes métier', () => {
    expect(scriptSrc).not.toMatch(/require\s*\(\s*['"][./]*routes/);
  });

  test('F-04 pas de require de integrated-chat-handler', () => {
    expect(scriptSrc).not.toMatch(/integrated-chat-handler/);
  });

  test('F-05 seul require autorisé est stripe', () => {
    const requires = [...scriptSrc.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map(m => m[1]);
    const external = requires.filter(r => !r.startsWith('.') && !r.startsWith('/'));
    expect(external).toEqual(['stripe']);
  });
});

// ── G — Aucune session créée quand le garde-fou clé échoue ───────────────

describe('G — Aucune session créée quand le garde-fou clé échoue', () => {
  test('G-01 le garde-fou clé est AVANT checkout.sessions.create (ordre statique)', () => {
    const guardIdx  = scriptSrc.indexOf("startsWith('sk_test_')");
    const createIdx = scriptSrc.indexOf('checkout.sessions.create');
    expect(guardIdx).not.toBe(-1);
    expect(createIdx).not.toBe(-1);
    expect(guardIdx).toBeLessThan(createIdx);
  });

  test('G-02 process.exit(2) suit immédiatement le refus de clé non-TEST', () => {
    const refusalIdx = scriptSrc.indexOf('BLOCKED: STRIPE_SECRET_KEY is not a Stripe TEST key');
    expect(refusalIdx).not.toBe(-1);
    const nearby = scriptSrc.slice(refusalIdx, refusalIdx + 100);
    expect(nearby).toMatch(/process\.exit\(\d+\)/);
  });

  test('G-03 main() ne s\'exécute jamais pour sk_live_ (banner absent)', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY });
    expect(r.stdout || '').not.toMatch(/PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1[DE]/);
  });

  test('G-04 main() ne s\'exécute jamais sans clé (banner absent)', () => {
    const r = run({});
    expect(r.stdout || '').not.toMatch(/PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1[DE]/);
  });
});

// ── H — Connect account ID invalide → bloqué ──────────────────────────────

describe('H — Connect account ID invalide → bloqué avant appel réseau', () => {
  test('H-01 exit code non-zero pour CONNECT_ACCOUNT_ID sans préfixe acct_', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_TEST_KEY, STRIPE_CONNECT_ACCOUNT_ID: FAKE_ACCT_INVALID });
    expect(r.status).not.toBe(0);
  });

  test('H-02 stderr contient BLOCKED pour CONNECT_ACCOUNT_ID invalide', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_TEST_KEY, STRIPE_CONNECT_ACCOUNT_ID: FAKE_ACCT_INVALID });
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/BLOCKED/);
  });

  test('H-03 le message précise que acct_ est requis', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_TEST_KEY, STRIPE_CONNECT_ACCOUNT_ID: FAKE_ACCT_INVALID });
    expect(r.stderr || '').toMatch(/acct_/);
  });

  test('H-04 aucune session créée pour CONNECT_ACCOUNT_ID invalide', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_TEST_KEY, STRIPE_CONNECT_ACCOUNT_ID: FAKE_ACCT_INVALID });
    expect(r.stdout || '').not.toMatch(/EUR|ILS|USD|CHF|PASS|REJECTED/);
  });

  test('H-05 le garde-fou Connect est AVANT checkout.sessions.create (ordre statique)', () => {
    const guardIdx  = scriptSrc.indexOf("startsWith('acct_')");
    const createIdx = scriptSrc.indexOf('checkout.sessions.create');
    expect(guardIdx).not.toBe(-1);
    expect(createIdx).not.toBe(-1);
    expect(guardIdx).toBeLessThan(createIdx);
  });

  test('H-06 process.exit(2) suit le refus du format acct_', () => {
    const refusalIdx = scriptSrc.indexOf('BLOCKED: STRIPE_CONNECT_ACCOUNT_ID must start with acct_');
    expect(refusalIdx).not.toBe(-1);
    const nearby = scriptSrc.slice(refusalIdx, refusalIdx + 100);
    expect(nearby).toMatch(/process\.exit\(\d+\)/);
  });

  test('H-07 main() ne s\'exécute jamais pour CONNECT_ACCOUNT_ID invalide (banner absent)', () => {
    const r = run({ STRIPE_SECRET_KEY: FAKE_TEST_KEY, STRIPE_CONNECT_ACCOUNT_ID: FAKE_ACCT_INVALID });
    expect(r.stdout || '').not.toMatch(/PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1[DE]/);
  });
});

// ── I — Aucun acct_ hardcodé dans le script ──────────────────────────────

describe('I — Aucun compte Connect hardcodé dans le script', () => {
  test('I-01 pas de valeur acct_ littérale dans le code source', () => {
    // Vérifie qu'aucun acct_ suivi de chiffres/lettres n'est codé en dur
    // La variable rawConnectId est lue depuis l'environnement, jamais assignée à un littéral acct_
    expect(scriptSrc).not.toMatch(/['"]\s*acct_[A-Za-z0-9]/);
  });

  test('I-02 STRIPE_CONNECT_ACCOUNT_ID est lue exclusivement depuis process.env', () => {
    expect(scriptSrc).toMatch(/process\.env\.STRIPE_CONNECT_ACCOUNT_ID/);
  });

  test('I-03 rawConnectId n\'est jamais assigné à une valeur acct_ littérale', () => {
    const assignIdx = scriptSrc.indexOf('rawConnectId');
    expect(assignIdx).not.toBe(-1);
    // La valeur doit venir de process.env, pas d'un literal
    const assignBlock = scriptSrc.slice(assignIdx, assignIdx + 80);
    expect(assignBlock).not.toMatch(/['"]acct_/);
  });
});

// ── J — Mode Connect utilise stripeAccount ────────────────────────────────

describe('J — Mode Connect utilise stripeAccount dans les options (analyse statique)', () => {
  test('J-01 sessionOptions est défini avec stripeAccount quand connectAccountId est truthy', () => {
    expect(scriptSrc).toMatch(/sessionOptions\s*=\s*connectAccountId\s*\?\s*\{[^}]*stripeAccount\s*:\s*connectAccountId/);
  });

  test('J-02 sessionOptions est vide ({}) en mode plateforme', () => {
    expect(scriptSrc).toMatch(/\?\s*\{[^}]*stripeAccount[^}]*\}\s*:\s*\{\}/);
  });

  test('J-03 checkout.sessions.create reçoit sessionOptions comme second argument', () => {
    const createIdx = scriptSrc.indexOf('checkout.sessions.create(');
    expect(createIdx).not.toBe(-1);
    // La session params est multi-lignes ~350 chars ; lire 500 pour atteindre }, sessionOptions)
    const createBlock = scriptSrc.slice(createIdx, createIdx + 500);
    expect(createBlock).toMatch(/sessionOptions/);
  });

  test('J-04 stripe.accounts.retrieve est appelé pour vérifier le compte Connect', () => {
    expect(scriptSrc).toMatch(/stripe\.accounts\.retrieve\s*\(\s*connectAccountId\s*\)/);
  });
});

// ── K — Expiration utilise le même contexte Connect ──────────────────────

describe('K — Expiration utilise le même contexte Connect que la création', () => {
  test('K-01 expireSession() est défini comme helper dédié', () => {
    expect(scriptSrc).toMatch(/function expireSession/);
  });

  test('K-02 expireSession passe { stripeAccount: connectAccountId } en mode Connect', () => {
    const fnIdx = scriptSrc.indexOf('function expireSession');
    expect(fnIdx).not.toBe(-1);
    const fnBlock = scriptSrc.slice(fnIdx, fnIdx + 250);
    expect(fnBlock).toMatch(/stripeAccount\s*:\s*connectAccountId/);
  });

  test('K-03 expireSession est appelé (pas stripe.checkout.sessions.expire directement)', () => {
    // Dans la boucle principale, on appelle expireSession(), pas stripe.checkout.sessions.expire()
    // directement — ceci garantit que le contexte Connect est toujours appliqué
    const loopIdx = scriptSrc.indexOf('for (const { code, amount } of CURRENCIES)');
    expect(loopIdx).not.toBe(-1);
    // La boucle contient le bloc create (~350 chars) + livemode check + expire : lire 1100
    const loopBlock = scriptSrc.slice(loopIdx, loopIdx + 1100);
    expect(loopBlock).toMatch(/expireSession\(session\.id\)/);
    // Aucun appel direct à stripe.checkout.sessions.expire dans la boucle principale
    expect(loopBlock).not.toMatch(/stripe\.checkout\.sessions\.expire/);
  });

  test('K-04 expireSession est aussi appelé dans la branche livemode (abort path)', () => {
    const abortIdx = scriptSrc.indexOf('livemode === true');
    expect(abortIdx).not.toBe(-1);
    // console.error line is ~100 chars, then try { await expireSession — lire 250
    const abortBlock = scriptSrc.slice(abortIdx, abortIdx + 250);
    expect(abortBlock).toMatch(/expireSession/);
  });
});

// ── L — Pas de retry EUR dans les catch (fail-closed) ────────────────────

describe('L — Pas de retry EUR ni conversion FX dans les catch (fail-closed)', () => {
  test('L-01 aucun bloc catch ne contient d\'assignation de devise EUR', () => {
    // Localise tous les blocs catch et vérifie qu'aucun ne change la devise
    const catchMatches = [...scriptSrc.matchAll(/catch\s*\([^)]+\)\s*\{([^}]*)\}/gs)];
    for (const m of catchMatches) {
      const body = m[1] || '';
      expect(body).not.toMatch(/currency\s*=\s*['"]eur['"]/i);
    }
  });

  test('L-02 aucun retry de session dans les blocs catch', () => {
    const catchMatches = [...scriptSrc.matchAll(/catch\s*\([^)]+\)\s*\{([^}]*)\}/gs)];
    for (const m of catchMatches) {
      const body = m[1] || '';
      expect(body).not.toMatch(/checkout\.sessions\.create/);
    }
  });

  test('L-03 commentaire fail-closed présent dans le code source', () => {
    expect(scriptSrc).toMatch(/[Ff]ail-closed|fail.closed|aucun retry EUR/i);
  });

  test('L-04 pas de exchangeRate ni fxRate dans le script', () => {
    expect(scriptSrc).not.toMatch(/exchangeRate|fxRate|convertCurrency/i);
  });
});

// ── M — Mode platform reste fonctionnel sans CONNECT_ACCOUNT_ID ──────────

describe('M — Mode platform reste fonctionnel sans CONNECT_ACCOUNT_ID (analyse statique)', () => {
  test('M-01 connectAccountId vaut null quand STRIPE_CONNECT_ACCOUNT_ID est absent', () => {
    // rawConnectId || null → connectAccountId = null si variable absente
    expect(scriptSrc).toMatch(/rawConnectId\s*\|\|\s*null/);
  });

  test('M-02 sessionOptions est {} quand connectAccountId est null', () => {
    expect(scriptSrc).toMatch(/connectAccountId\s*\?\s*\{[^}]*stripeAccount[^}]*\}\s*:\s*\{\}/);
  });

  test('M-03 MODE vaut "PLATFORM" quand connectAccountId est falsy', () => {
    expect(scriptSrc).toMatch(/MODE\s*=\s*connectAccountId\s*\?\s*['"]CONNECT['"]\s*:\s*['"]PLATFORM['"]/);
  });

  test('M-04 la vérification accounts.retrieve est conditionnelle à connectAccountId', () => {
    // Le bloc de vérification Connect est dans un if(connectAccountId) — pas exécuté en mode platform
    expect(scriptSrc).toMatch(/if\s*\(\s*connectAccountId\s*\)[^{]*\{[^}]*accounts\.retrieve/s);
  });
});
