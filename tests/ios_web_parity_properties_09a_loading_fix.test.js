'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_PROPERTIES_09A_LOADING_FIX
 *
 * Verifies the root-cause fix: authFetch was never defined; page used
 * window.fetch (patched by auth-fetch.js) directly instead.
 *
 * Also verifies: error state, retry, graceful degradation, API contracts,
 * agency=all, rendering, navigation, and no backend changes.
 */

const fs   = require('fs');
const path = require('path');

const htmlPath    = path.join(__dirname, '..', 'public', 'properties.html');
const cssPath     = path.join(__dirname, '..', 'public', 'css', 'bh-properties-ios-09.css');
const authFetchPath = path.join(__dirname, '..', 'public', 'js', 'auth-fetch.js');
const serverPath  = path.join(__dirname, '..', 'server.js');
const chatPath    = path.join(__dirname, '..', 'routes', 'chat_routes.js');
const channexPath = path.join(__dirname, '..', 'channex.js');
const layoutPath  = path.join(__dirname, '..', 'public', 'js', 'bh-layout.js');

let html      = '';
let css       = '';
let authFetch = '';

beforeAll(() => {
  html      = fs.readFileSync(htmlPath,      'utf8');
  css       = fs.readFileSync(cssPath,       'utf8');
  authFetch = fs.readFileSync(authFetchPath, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. ROOT CAUSE — authFetch was never defined
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-1: Root-cause audit', () => {
  test('09A-1-01: authFetch is NOT defined in auth-fetch.js', () => {
    // auth-fetch.js patches window.fetch; it never creates a global authFetch
    expect(authFetch).not.toMatch(/window\.authFetch\s*=/);
    expect(authFetch).not.toMatch(/var authFetch\s*=/);
    expect(authFetch).not.toMatch(/const authFetch\s*=/);
    expect(authFetch).not.toMatch(/function authFetch\s*\(/);
  });

  test('09A-1-02: auth-fetch.js patches window.fetch (not authFetch)', () => {
    expect(authFetch).toMatch(/window\.fetch/);
  });

  test('09A-1-03: properties.html no longer calls authFetch()', () => {
    // After fix: authFetch() calls replaced with fetch()
    expect(html).not.toMatch(/authFetch\s*\(\s*['"]\/api\//);
  });

  test('09A-1-04: properties.html no longer has typeof authFetch guard', () => {
    expect(html).not.toMatch(/typeof authFetch\s*!==\s*['"]function['"]/);
  });

  test('09A-1-05: properties.html uses fetch() for /api/properties', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\/properties['"]\s*\)/);
  });

  test('09A-1-06: properties.html uses fetch() for /api/property-groups', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\/property-groups['"]\s*\)/);
  });

  test('09A-1-07: properties.html uses fetch() for /api/properties/diffusion', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\/properties\/diffusion['"]\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LOADING STATE — cannot remain forever
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-2: Loading state cannot persist indefinitely', () => {
  test('09A-2-01: propLoading is explicitly hidden in the success path', () => {
    expect(html).toMatch(/propLoading[\s\S]{0,100}?display.*none/);
  });

  test('09A-2-02: propLoading is explicitly hidden in the error path', () => {
    // showError() hides propLoading
    expect(html).toMatch(/showError|propLoading[\s\S]{0,200}?catch/);
  });

  test('09A-2-03: catch block calls showError (or hides loading directly)', () => {
    // Promise.all catch must either hide propLoading or call showError
    const hasCatchShowError = /\.catch\s*\(\s*function\s*\(\s*\)\s*\{\s*showError\s*\(\)/.test(html);
    const hasCatchHidesLoading = /\.catch\s*\(\s*function\s*\(\s*\)\s*\{[\s\S]{0,200}?propLoading/.test(html);
    expect(hasCatchShowError || hasCatchHidesLoading).toBe(true);
  });

  test('09A-2-04: loadAll resets loading state on each retry call', () => {
    expect(html).toMatch(/propLoading[\s\S]{0,100}?style\.display\s*=\s*['"]{2}|propLoading[\s\S]{0,100}?style\.display\s*=\s*['"]block['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ERROR STATE AND RETRY
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-3: Error state and retry', () => {
  test('09A-3-01: showError function defined', () => {
    expect(html).toMatch(/function\s+showError\s*\(/);
  });

  test('09A-3-02: propError element present in HTML', () => {
    expect(html).toMatch(/id="propError"/);
  });

  test('09A-3-03: retry button rendered in error state', () => {
    expect(html).toMatch(/prop-retry-btn/);
  });

  test('09A-3-04: retry button labelled "Réessayer"', () => {
    expect(html).toMatch(/R.essayer/);
  });

  test('09A-3-05: retry triggers loadAll (via _propRetry or onclick)', () => {
    expect(html).toMatch(/_propRetry|onclick.*_propRetry|onclick.*loadAll/);
  });

  test('09A-3-06: _propRetry is assigned to loadAll', () => {
    expect(html).toMatch(/window\._propRetry\s*=\s*loadAll/);
  });

  test('09A-3-07: CSS .prop-retry-btn rule exists', () => {
    expect(css).toMatch(/\.prop-retry-btn\s*\{/);
  });

  test('09A-3-08: .prop-retry-btn has background color', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-retry-btn\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/background/);
  });

  test('09A-3-09: .prop-retry-btn has border-radius (iOS pill)', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-retry-btn\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. API CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-4: API contract — /api/properties', () => {
  test('09A-4-01: response.properties consumed', () => {
    expect(html).toMatch(/propsData\.properties\s*\|\|/);
  });

  test('09A-4-02: individual fetch has .catch returning {} (graceful degradation)', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\/properties['"]\s*\)[\s\S]{0,200}?\.catch\s*\(function\(\)\s*\{\s*return\s*\{\}/);
  });

  test('09A-4-03: empty array fallback when properties missing', () => {
    expect(html).toMatch(/propsData\.properties\s*\|\|\s*\[\]/);
  });
});

describe('09A-5: API contract — /api/property-groups', () => {
  test('09A-5-01: response.groups consumed', () => {
    expect(html).toMatch(/groupsData\.groups\s*\|\|/);
  });

  test('09A-5-02: groups fetch has .catch returning {} (graceful degradation)', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\/property-groups['"]\s*\)[\s\S]{0,200}?\.catch\s*\(function\(\)\s*\{\s*return\s*\{\}/);
  });

  test('09A-5-03: groups failure does not block property list', () => {
    // groups filtered against allProperties — empty groups = no pills except Tous
    expect(html).toMatch(/groupsData\.groups\s*\|\|\s*\[\]/);
  });
});

describe('09A-6: API contract — /api/properties/diffusion', () => {
  test('09A-6-01: response.logements consumed', () => {
    expect(html).toMatch(/diffData\.logements\s*\|\|/);
  });

  test('09A-6-02: diffusion fetch has .catch returning {} (graceful degradation)', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\/properties\/diffusion['"]\s*\)[\s\S]{0,200}?\.catch\s*\(function\(\)\s*\{\s*return\s*\{\}/);
  });

  test('09A-6-03: diffusion failure = empty diffusionMap (no problem cards)', () => {
    // diffData.logements || [] → empty forEach = diffusionMap stays {}
    expect(html).toMatch(/diffData\.logements\s*\|\|\s*\[\]/);
  });

  test('09A-6-04: diffusionMap keyed by property_id', () => {
    expect(html).toMatch(/diffusionMap\[l\.property_id\]\s*=/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. AGENCY = ALL
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-7: agency=all handling', () => {
  test('09A-7-01: auth-fetch.js adds agency=all automatically when bh_agency_view=all', () => {
    expect(authFetch).toMatch(/bh_agency_view.*all|agency=all/);
  });

  test('09A-7-02: auth-fetch.js appends agency=all if not already in URL', () => {
    expect(authFetch).toMatch(/!urlStr\.includes\s*\(\s*['"]agency=/);
  });

  test('09A-7-03: properties.html does NOT manually append agency=all (delegated to interceptor)', () => {
    expect(html).not.toMatch(/agency=all/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. RENDERING AFTER SUCCESS
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-8: Rendering after load success', () => {
  test('09A-8-01: render() called after data loaded', () => {
    const successBlock = html.match(/\.then\s*\(function\s*\(results\)([\s\S]+?)\.catch/);
    expect(successBlock).not.toBeNull();
    expect(successBlock[1]).toMatch(/render\s*\(\)/);
  });

  test('09A-8-02: propItems visible after successful render (non-empty)', () => {
    expect(html).toMatch(/itemsEl\.style\.display\s*=\s*['"]{2}/);
  });

  test('09A-8-03: propLoading hidden after successful render', () => {
    const successBlock = html.match(/\.then\s*\(function\s*\(results\)([\s\S]+?)\.catch/);
    expect(successBlock).not.toBeNull();
    expect(successBlock[1]).toMatch(/propLoading[\s\S]{0,100}?display.*none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. KICKER DYNAMIC
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-9: Dynamic kicker', () => {
  test('09A-9-01: updateKicker called with property count', () => {
    expect(html).toMatch(/updateKicker\s*\(\s*allProperties\.length\s*\)/);
  });

  test('09A-9-02: singular "1 logement"', () => {
    expect(html).toMatch(/1\s+logement[^s]/);
  });

  test('09A-9-03: plural "N logements"', () => {
    expect(html).toMatch(/logements/);
  });

  test('09A-9-04: data-kicker attribute updated', () => {
    expect(html).toMatch(/setAttribute\s*\(\s*['"]data-kicker['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. FILTER PILLS
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-10: Filter pills rendered', () => {
  test('09A-10-01: buildFilterPills called after load', () => {
    expect(html).toMatch(/buildFilterPills\s*\(\s*allGroups\s*\)/);
  });

  test('09A-10-02: "Tous" pill always rendered', () => {
    expect(html).toMatch(/'Tous'|"Tous"/);
  });

  test('09A-10-03: "Non groupés" pill added for ungrouped properties', () => {
    expect(html).toMatch(/Non\s+group/);
  });

  test('09A-10-04: pill click updates activeFilter and re-renders', () => {
    expect(html).toMatch(/activeFilter.*null|null.*activeFilter/);
    expect(html).toMatch(/render\s*\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. NORMAL PROPERTY CARDS
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-11: Normal property cards', () => {
  test('09A-11-01: renderNormalRow function defined', () => {
    expect(html).toMatch(/function\s+renderNormalRow\s*\(/);
  });

  test('09A-11-02: normal rows wrapped in prop-list-card', () => {
    expect(html).toMatch(/prop-list-card/);
  });

  test('09A-11-03: prop-dot colored from property.color', () => {
    expect(html).toMatch(/prop-dot.*color|color.*prop-dot/);
  });

  test('09A-11-04: prop-name uses displayName()', () => {
    expect(html).toMatch(/escHtml\s*\(\s*displayName\s*\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. PROBLEM CARDS
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-12: Problem cards', () => {
  test('09A-12-01: renderProblemRow function defined', () => {
    expect(html).toMatch(/function\s+renderProblemRow\s*\(/);
  });

  test('09A-12-02: problem cards use prop-problem-card class', () => {
    expect(html).toMatch(/prop-problem-card/);
  });

  test('09A-12-03: problem cards have gold rail', () => {
    expect(html).toMatch(/prop-problem-rail/);
  });

  test('09A-12-04: isProblem uses !d.vendable || !d.diffuse', () => {
    expect(html).toMatch(/!d\.vendable\s*\|\|\s*!d\.diffuse|!d\.diffuse\s*\|\|\s*!d\.vendable/);
  });

  test('09A-12-05: no diffusion entry = isProblem returns false', () => {
    expect(html).toMatch(/function\s+isProblem[\s\S]{0,100}?if\s*\(!d\)\s*return\s*false/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. CONNECTION BADGES
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-13: Connection badges', () => {
  test('09A-13-01: connectionBadge function defined', () => {
    expect(html).toMatch(/function\s+connectionBadge\s*\(/);
  });

  test('09A-13-02: OTA badge class is prop-badge--ota', () => {
    expect(html).toMatch(/prop-badge--ota/);
  });

  test('09A-13-03: iCal badge class is prop-badge--ical', () => {
    expect(html).toMatch(/prop-badge--ical/);
  });

  test('09A-13-04: "Non relié" badge class is prop-badge--none', () => {
    expect(html).toMatch(/prop-badge--none/);
  });

  test('09A-13-05: OTA+iCal combined badge "OTA · iCal"', () => {
    expect(html).toMatch(/OTA\s*·\s*iCal/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. NO BACKEND MODIFIED
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-14: No backend files modified', () => {
  test('09A-14-01: server.js git status is clean', () => {
    const { execSync } = require('child_process');
    const status = execSync('git status --short -- server.js', { cwd: path.join(__dirname, '..') }).toString().trim();
    expect(status).toBe('');
  });

  test('09A-14-02: routes/chat_routes.js git status is clean', () => {
    const { execSync } = require('child_process');
    const status = execSync('git status --short -- routes/chat_routes.js', { cwd: path.join(__dirname, '..') }).toString().trim();
    expect(status).toBe('');
  });

  test('09A-14-03: channex.js git status is clean', () => {
    const { execSync } = require('child_process');
    const status = execSync('git status --short -- channex.js', { cwd: path.join(__dirname, '..') }).toString().trim();
    expect(status).toBe('');
  });

  test('09A-14-04: integrated-chat-handler.js git status is clean', () => {
    const { execSync } = require('child_process');
    const status = execSync('git status --short -- integrated-chat-handler.js', { cwd: path.join(__dirname, '..') }).toString().trim();
    expect(status).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. NAVIGATION PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-15: Navigation preserved', () => {
  test('09A-15-01: back to /manage.html preserved', () => {
    expect(html).toMatch(/data-back-href="\/manage\.html"/);
  });

  test('09A-15-02: add button links to /settings.html', () => {
    expect(html).toMatch(/href="\/settings\.html"/);
  });

  test('09A-15-03: property click navigates to /property.html', () => {
    expect(html).toMatch(/window\.location\.href\s*=\s*'\/property\.html\?id=/);
  });

  test('09A-15-04: data-page="properties" preserved', () => {
    expect(html).toMatch(/<body[^>]*data-page="properties"/);
  });

  test('09A-15-05: bh-layout.js loaded', () => {
    expect(html).toMatch(/src="[^"]*bh-layout\.js/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. POINTER FIX PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('09A-16: e.pointerType !== \'mouse\' preserved in bh-layout.js', () => {
  test('09A-16-01: pointer fix still present in bh-layout.js', () => {
    const layoutSrc = fs.readFileSync(layoutPath, 'utf8');
    expect(layoutSrc).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });
});
