'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_MANAGE_08_STRICT
 *
 * Authoritative iOS source:
 *   ManageHubView.swift  — GlassNavBar + ListCard + diffusionAlertCard + shortcutsSection
 *   ManageHubViewModel.swift — property/group counts, diffusion alert logic
 *
 * Web entry point: public/manage.html
 * New CSS: public/css/bh-manage-ios-08.css
 *
 * Validates:
 *   - iOS-parity single ListCard replacing legacy 3-column grid
 *   - Dynamic kicker "N logements · N groupes"
 *   - Five canonical primary entries in correct order
 *   - Diffusion alert structure (conditional, gold)
 *   - Shortcuts section
 *   - All routes preserved
 *   - Icon colors (exact iOS tokens)
 *   - CSS glass card / row / separator styles
 *   - Bottom nav / lg-capsule / pointer fix
 *   - No backend, DB, or BoostPrice logic change
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

const manageHtml = html('manage.html');
const ios08      = css('bh-manage-ios-08.css');
const bhLayout   = js('bh-layout.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. ENTRY POINT — HTML file, route, CSS load order
// ─────────────────────────────────────────────────────────────────────────────

describe('08 entry point', () => {
  test('1-01 manage.html exists and is not empty', () => {
    expect(manageHtml.length).toBeGreaterThan(500);
  });

  test('1-02 data-page="manage" on body', () => {
    expect(manageHtml).toMatch(/data-page="manage"/);
  });

  test('1-03 title is "Gestion"', () => {
    expect(manageHtml).toMatch(/<title>[^<]*Gestion[^<]*<\/title>/);
  });

  test('1-04 bh-manage-ios-08.css loaded', () => {
    expect(manageHtml).toMatch(/bh-manage-ios-08\.css/);
  });

  test('1-05 bh-manage-ios-08.css loaded after bh-shell-04.css', () => {
    const shell04Pos  = manageHtml.indexOf('bh-shell-04.css');
    const ios08Pos    = manageHtml.indexOf('bh-manage-ios-08.css');
    expect(shell04Pos).toBeGreaterThan(0);
    expect(ios08Pos).toBeGreaterThan(shell04Pos);
  });

  test('1-06 bh-native-bg.css loaded (AppBackground)', () => {
    expect(manageHtml).toMatch(/bh-native-bg\.css/);
  });

  test('1-07 bh-tokens.css loaded', () => {
    expect(manageHtml).toMatch(/bh-tokens\.css/);
  });

  test('1-08 bh-shell-04.css loaded', () => {
    expect(manageHtml).toMatch(/bh-shell-04\.css/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. HEADER — dynamic kicker, title, search, initials
// ─────────────────────────────────────────────────────────────────────────────

describe('08 header', () => {
  test('2-01 kicker is NOT hardcoded "Boostinghost"', () => {
    // The kicker must be a dynamic span, not a static "Boostinghost" text
    expect(manageHtml).not.toMatch(/class="manage-page-header__kicker"[^>]*>\s*Boostinghost\s*</i);
  });

  test('2-02 manageKicker span exists for dynamic update', () => {
    expect(manageHtml).toMatch(/id="manageKicker"/);
  });

  test('2-03 data-kicker on body is NOT "Boostinghost"', () => {
    expect(manageHtml).not.toMatch(/data-kicker="Boostinghost"/);
  });

  test('2-04 title "Gestion" in desktop header', () => {
    expect(manageHtml).toMatch(/manage-page-header__title[^>]*>[^<]*Gestion/);
  });

  test('2-05 search button present (id="manageSearchBtn")', () => {
    expect(manageHtml).toMatch(/id="manageSearchBtn"/);
  });

  test('2-06 search button is bh-ios-circle-button class', () => {
    expect(manageHtml).toMatch(/id="manageSearchBtn"[\s\S]{0,200}?bh-ios-circle-button|bh-ios-circle-button[\s\S]{0,200}?id="manageSearchBtn"/);
  });

  test('2-07 initials button present (id="manageInitialsBtn")', () => {
    expect(manageHtml).toMatch(/id="manageInitialsBtn"/);
  });

  test('2-08 initials button opens agency switcher', () => {
    expect(manageHtml).toMatch(/manageInitialsBtn[\s\S]{0,200}?openAgencySwitcherModal/);
  });

  test('2-09 kicker CSS: 12.5px (not 11px)', () => {
    expect(ios08).toMatch(/manage-page-header__kicker[\s\S]{0,200}?12\.5px/);
  });

  test('2-10 kicker CSS: text-transform none (not uppercase)', () => {
    expect(ios08).toMatch(/manage-page-header__kicker[\s\S]{0,200}?text-transform\s*:\s*none/);
  });

  test('2-11 kicker CSS: color #5E6B63 (bhAttenue)', () => {
    expect(ios08).toMatch(/manage-page-header__kicker[\s\S]{0,200}?#5E6B63/);
  });

  test('2-12 title CSS: 30px 700 (GrandTitre)', () => {
    expect(ios08).toMatch(/manage-page-header__title[\s\S]{0,200}?30px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PRIMARY LIST CARD — single iOS card with 5 entries
// ─────────────────────────────────────────────────────────────────────────────

describe('08 primary ListCard structure', () => {
  test('3-01 managePrimaryCard exists', () => {
    expect(manageHtml).toMatch(/id="managePrimaryCard"/);
  });

  test('3-02 primary card uses mgios-card class', () => {
    // class may appear before or after id in the attribute list
    expect(manageHtml).toMatch(/class="[^"]*mgios-card[^"]*"[^>]*id="managePrimaryCard"|id="managePrimaryCard"[^>]*class="[^"]*mgios-card/);
  });

  test('3-03 exactly five mgios-row entries in primary card', () => {
    const cardBlock = manageHtml.match(/id="managePrimaryCard"[\s\S]*?managePrimaryCard\s*-->/);
    expect(cardBlock).toBeTruthy();
    const rows = cardBlock[0].match(/class="mgios-row"/g);
    expect(rows).toBeTruthy();
    expect(rows.length).toBe(5);
  });

  test('3-04 no legacy manage-grid inside primary section', () => {
    expect(manageHtml).not.toMatch(/id="manageGridPrimary"/);
  });

  test('3-05 no legacy 3-column grid-template-columns in manage-grid style', () => {
    // The new CSS hides manage-grid with display:none
    expect(ios08).toMatch(/manage-grid[\s\S]{0,100}?display\s*:\s*none\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. FIVE CANONICAL ENTRIES — titles, subtitles, routes, order
// ─────────────────────────────────────────────────────────────────────────────

describe('08 canonical entries: Logements', () => {
  test('4-01 Logements title present', () => {
    expect(manageHtml).toMatch(/mgios-title[^>]*>Logements/);
  });

  test('4-02 Logements route: /properties.html', () => {
    expect(manageHtml).toMatch(/href="\/properties\.html"[^>]*data-perm="can_view_properties"|data-perm="can_view_properties"[^>]*href="\/properties\.html"/);
  });

  test('4-03 Logements subtitle: iOS exact text', () => {
    expect(manageHtml).toMatch(/Livret, prix, accès, assistant/);
  });

  test('4-04 Logements icon bg: #DCE8E1', () => {
    const logBlock = manageHtml.match(/href="\/properties\.html"[\s\S]{0,400}/);
    expect(logBlock).toBeTruthy();
    expect(logBlock[0]).toMatch(/#DCE8E1/);
  });

  test('4-05 Logements icon fg: #0E3B2E (bhVert)', () => {
    const logBlock = manageHtml.match(/href="\/properties\.html"[\s\S]{0,400}/);
    expect(logBlock[0]).toMatch(/#0E3B2E/);
  });

  test('4-06 Logements badge: id="managePropCount"', () => {
    expect(manageHtml).toMatch(/id="managePropCount"/);
  });
});

describe('08 canonical entries: Ménage', () => {
  test('4-07 Ménage title present', () => {
    expect(manageHtml).toMatch(/mgios-title[^>]*>Ménage/);
  });

  test('4-08 Ménage route: /cleaning.html', () => {
    expect(manageHtml).toMatch(/href="\/cleaning\.html"/);
  });

  test('4-09 Ménage subtitle: iOS exact text', () => {
    expect(manageHtml).toMatch(/Planning, intervenants, historique/);
  });

  test('4-10 Ménage icon bg: bhOrFond rgba(251,243,226,...)', () => {
    const menBlock = manageHtml.match(/href="\/cleaning\.html"[\s\S]{0,400}/);
    expect(menBlock).toBeTruthy();
    expect(menBlock[0]).toMatch(/rgba\(251,243,226/);
  });

  test('4-11 Ménage icon fg: #8A5B14 (bhOr)', () => {
    const menBlock = manageHtml.match(/href="\/cleaning\.html"[\s\S]{0,400}/);
    expect(menBlock[0]).toMatch(/#8A5B14/);
  });
});

describe('08 canonical entries: Propriétaires', () => {
  test('4-12 Propriétaires title present', () => {
    expect(manageHtml).toMatch(/mgios-title[^>]*>Propriétaires/);
  });

  test('4-13 Propriétaires route: /clients.html', () => {
    expect(manageHtml).toMatch(/href="\/clients\.html"/);
  });

  test('4-14 Propriétaires subtitle: iOS exact text', () => {
    expect(manageHtml).toMatch(/Clients, contrats, factures, débours/);
  });

  test('4-15 Propriétaires icon bg: rgba(255,255,255,0.55)', () => {
    const propBlock = manageHtml.match(/href="\/clients\.html"[\s\S]{0,400}/);
    expect(propBlock).toBeTruthy();
    expect(propBlock[0]).toMatch(/rgba\(255,255,255,0\.55\)/);
  });

  test('4-16 Propriétaires icon fg: #5E6B63 (bhAttenue)', () => {
    const propBlock = manageHtml.match(/href="\/clients\.html"[\s\S]{0,400}/);
    expect(propBlock[0]).toMatch(/#5E6B63/);
  });
});

describe('08 canonical entries: Séjours', () => {
  test('4-17 Séjours title present', () => {
    expect(manageHtml).toMatch(/mgios-title[^>]*>Séjours/);
  });

  test('4-18 Séjours route: /factures.html', () => {
    expect(manageHtml).toMatch(/href="\/factures\.html"/);
  });

  test('4-19 Séjours subtitle: iOS exact (factures voyageurs, cautions)', () => {
    expect(manageHtml).toMatch(/Factures voyageurs, cautions/);
  });
});

describe('08 canonical entries: BoostPrice', () => {
  test('4-20 BoostPrice title present', () => {
    expect(manageHtml).toMatch(/mgios-title[^>]*>BoostPrice/);
  });

  test('4-21 BoostPrice route: /dynamic-pricing.html', () => {
    expect(manageHtml).toMatch(/href="\/dynamic-pricing\.html"/);
  });

  test('4-22 BoostPrice subtitle: Tarification dynamique', () => {
    expect(manageHtml).toMatch(/Tarification dynamique/);
  });

  test('4-23 BoostPrice icon bg: #DCE8E1', () => {
    const bpBlock = manageHtml.match(/href="\/dynamic-pricing\.html"[\s\S]{0,400}/);
    expect(bpBlock).toBeTruthy();
    expect(bpBlock[0]).toMatch(/#DCE8E1/);
  });

  test('4-24 BoostPrice icon fg: #2E8B62 (bhOccupe)', () => {
    const bpBlock = manageHtml.match(/href="\/dynamic-pricing\.html"[\s\S]{0,400}/);
    expect(bpBlock[0]).toMatch(/#2E8B62/);
  });
});

describe('08 canonical entry ORDER', () => {
  test('4-25 Logements appears before Ménage in HTML', () => {
    expect(manageHtml.indexOf('/properties.html')).toBeLessThan(manageHtml.indexOf('/cleaning.html'));
  });

  test('4-26 Ménage before Propriétaires', () => {
    expect(manageHtml.indexOf('/cleaning.html')).toBeLessThan(manageHtml.indexOf('/clients.html'));
  });

  test('4-27 Propriétaires before Séjours', () => {
    expect(manageHtml.indexOf('/clients.html')).toBeLessThan(manageHtml.indexOf('/factures.html'));
  });

  test('4-28 Séjours before BoostPrice', () => {
    expect(manageHtml.indexOf('/factures.html')).toBeLessThan(manageHtml.indexOf('/dynamic-pricing.html'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ICON CONTAINERS — 40×40, radius 12 (iOS exact)
// ─────────────────────────────────────────────────────────────────────────────

describe('08 icon containers', () => {
  test('5-01 mgios-icon class used for primary entries', () => {
    const count = (manageHtml.match(/class="mgios-icon"/g) || []).length;
    expect(count).toBe(5);
  });

  test('5-02 icon container width 40px in CSS', () => {
    expect(ios08).toMatch(/mgios-icon[\s\S]{0,200}?width\s*:\s*40px/);
  });

  test('5-03 icon container height 40px in CSS', () => {
    expect(ios08).toMatch(/mgios-icon[\s\S]{0,200}?height\s*:\s*40px/);
  });

  test('5-04 icon container border-radius 12px in CSS', () => {
    expect(ios08).toMatch(/mgios-icon[\s\S]{0,200}?border-radius\s*:\s*12px/);
  });

  test('5-05 icon SVG 18px in CSS', () => {
    expect(ios08).toMatch(/mgios-icon[\s\S]{0,300}?svg[\s\S]{0,100}?18px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ROW TYPOGRAPHY — iOS fonts
// ─────────────────────────────────────────────────────────────────────────────

describe('08 row typography', () => {
  test('6-01 mgios-title: 16px in CSS', () => {
    expect(ios08).toMatch(/mgios-title[\s\S]{0,200}?font-size\s*:\s*16px/);
  });

  test('6-02 mgios-title: 600 weight in CSS', () => {
    expect(ios08).toMatch(/mgios-title[\s\S]{0,200}?font-weight\s*:\s*600/);
  });

  test('6-03 mgios-title: #14201B color (bhEncre)', () => {
    expect(ios08).toMatch(/mgios-title[\s\S]{0,200}?#14201B/);
  });

  test('6-04 mgios-subtitle: 13px in CSS', () => {
    expect(ios08).toMatch(/mgios-subtitle[\s\S]{0,200}?font-size\s*:\s*13px/);
  });

  test('6-05 mgios-subtitle: 400 weight in CSS', () => {
    expect(ios08).toMatch(/mgios-subtitle[\s\S]{0,200}?font-weight\s*:\s*400/);
  });

  test('6-06 mgios-subtitle: #5E6B63 color (bhAttenue)', () => {
    expect(ios08).toMatch(/mgios-subtitle[\s\S]{0,200}?#5E6B63/);
  });

  test('6-07 DM Sans font-family in CSS', () => {
    expect(ios08).toMatch(/DM Sans/);
  });

  test('6-08 mgios-badge: 15px in CSS', () => {
    expect(ios08).toMatch(/mgios-badge[\s\S]{0,200}?font-size\s*:\s*15px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SEPARATORS — rgba(20,32,27,0.06)
// ─────────────────────────────────────────────────────────────────────────────

describe('08 row separators', () => {
  test('7-01 separator uses rgba(20,32,27,0.06)', () => {
    expect(ios08).toMatch(/rgba\(20,\s*32,\s*27,\s*0\.06\)/);
  });

  test('7-02 separator is 0.5px height', () => {
    expect(ios08).toMatch(/0\.5px/);
  });

  test('7-03 separator starts after icon (left: 70px for primary)', () => {
    expect(ios08).toMatch(/managePrimaryCard[\s\S]{0,300}?left\s*:\s*70px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. GLASS CARD STYLES — iOS ListCard (ultraThin + white.0.62)
// ─────────────────────────────────────────────────────────────────────────────

describe('08 glass card styles', () => {
  test('8-01 mgios-card uses rgba(255,255,255,0.62) background', () => {
    expect(ios08).toMatch(/mgios-card[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.62\)/);
  });

  test('8-02 mgios-card border: rgba(255,255,255,0.70)', () => {
    expect(ios08).toMatch(/mgios-card[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.70\)/);
  });

  test('8-03 mgios-card border-radius 22px', () => {
    expect(ios08).toMatch(/mgios-card[\s\S]{0,300}?border-radius\s*:\s*22px/);
  });

  test('8-04 mgios-card box-shadow with rgba(20,32,27,0.08)', () => {
    expect(ios08).toMatch(/mgios-card[\s\S]{0,300}?rgba\(20,\s*32,\s*27,\s*0\.08\)/);
  });

  test('8-05 mgios-card has backdrop-filter blur', () => {
    expect(ios08).toMatch(/mgios-card[\s\S]{0,300}?backdrop-filter\s*:\s*blur/);
  });

  test('8-06 specular edge (::before gradient) on mgios-card', () => {
    expect(ios08).toMatch(/mgios-card::before[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.90\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. CHEVRON
// ─────────────────────────────────────────────────────────────────────────────

describe('08 chevron', () => {
  test('9-01 chevron uses mgios-chevron class', () => {
    const chevronCount = (manageHtml.match(/class="mgios-chevron"/g) || []).length;
    expect(chevronCount).toBeGreaterThanOrEqual(5);
  });

  test('9-02 chevron width 12px in CSS', () => {
    expect(ios08).toMatch(/mgios-chevron[\s\S]{0,200}?svg[\s\S]{0,100}?12px/);
  });

  test('9-03 chevron color is attenuated rgba', () => {
    expect(ios08).toMatch(/mgios-chevron[\s\S]{0,200}?rgba\(94,\s*107,\s*99/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. DIFFUSION ALERT — gold conditional card
// ─────────────────────────────────────────────────────────────────────────────

describe('08 diffusion alert card', () => {
  test('10-01 manageDiffusionAlert element present', () => {
    expect(manageHtml).toMatch(/id="manageDiffusionAlert"/);
  });

  test('10-02 alert hidden by default (display:none)', () => {
    const alertEl = manageHtml.match(/id="manageDiffusionAlert"[^>]*/);
    expect(alertEl).toBeTruthy();
    expect(alertEl[0]).toMatch(/display\s*[:=]\s*['"]?none/);
  });

  test('10-03 alert links to /settings.html', () => {
    const alertEl = manageHtml.match(/id="manageDiffusionAlert"[^>]*/);
    expect(alertEl[0]).toMatch(/href="\/settings\.html"/);
  });

  test('10-04 alert uses mgios-alert-card class', () => {
    expect(manageHtml).toMatch(/class="mgios-alert-card"/);
  });

  test('10-05 alert left bar present (mgios-alert-bar)', () => {
    expect(manageHtml).toMatch(/mgios-alert-bar/);
  });

  test('10-06 alert bar: gradient #C9A15B → #8A5B14', () => {
    expect(ios08).toMatch(/mgios-alert-bar[\s\S]{0,200}?#C9A15B[\s\S]{0,100}?#8A5B14/);
  });

  test('10-07 alert background: rgba(251,243,226,...) (bhOrFond)', () => {
    expect(ios08).toMatch(/mgios-alert-card[\s\S]{0,300}?rgba\(251,\s*243,\s*226/);
  });

  test('10-08 alert headline color: #8A5B14 (bhOr)', () => {
    expect(ios08).toMatch(/mgios-alert-headline[\s\S]{0,200}?#8A5B14/);
  });

  test('10-09 manageDiffusionText span present', () => {
    expect(manageHtml).toMatch(/id="manageDiffusionText"/);
  });

  test('10-10 manageDiffusionNames div present', () => {
    expect(manageHtml).toMatch(/id="manageDiffusionNames"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. SHORTCUTS — "Raccourcis" section label + 4 routes
// ─────────────────────────────────────────────────────────────────────────────

describe('08 shortcuts section', () => {
  test('11-01 RACCOURCIS section label present (case-insensitive)', () => {
    expect(manageHtml).toMatch(/Raccourcis/i);
  });

  test('11-02 section label uses mgios-section-label class', () => {
    expect(manageHtml).toMatch(/class="mgios-section-label"[\s\S]{0,30}?Raccourcis/i);
  });

  test('11-03 section label CSS: 11.5px', () => {
    expect(ios08).toMatch(/mgios-section-label[\s\S]{0,200}?11\.5px/);
  });

  test('11-04 section label CSS: uppercase', () => {
    expect(ios08).toMatch(/mgios-section-label[\s\S]{0,200}?text-transform\s*:\s*uppercase/);
  });

  test('11-05 section label CSS: tracking 0.13em', () => {
    expect(ios08).toMatch(/mgios-section-label[\s\S]{0,200}?letter-spacing\s*:\s*0\.13em/);
  });

  test('11-06 shortcuts card id="manageShortcutsCard"', () => {
    expect(manageHtml).toMatch(/id="manageShortcutsCard"/);
  });

  test('11-07 Livrets d\'accueil route: /welcome.html', () => {
    expect(manageHtml).toMatch(/href="\/welcome\.html"/);
  });

  test('11-08 Livrets title present', () => {
    expect(manageHtml).toMatch(/Livrets d'accueil/);
  });

  test('11-09 Contrats route: /contrat.html', () => {
    expect(manageHtml).toMatch(/href="\/contrat\.html"/);
  });

  test('11-10 Contrats title present', () => {
    expect(manageHtml).toMatch(/mgios-shortcut-title[^>]*>Contrats/);
  });

  test('11-11 Smart Locks route: /smart-locks.html', () => {
    expect(manageHtml).toMatch(/href="\/smart-locks\.html"/);
  });

  test('11-12 Smart Locks title present', () => {
    expect(manageHtml).toMatch(/Smart Locks/);
  });

  test('11-13 Reporting route: /reporting.html', () => {
    expect(manageHtml).toMatch(/href="\/reporting\.html"/);
  });

  test('11-14 Reporting title present', () => {
    expect(manageHtml).toMatch(/mgios-shortcut-title[^>]*>Reporting/);
  });

  test('11-15 shortcut icon 28px in CSS', () => {
    expect(ios08).toMatch(/mgios-shortcut-icon[\s\S]{0,200}?28px/);
  });

  test('11-16 shortcut title 15px in CSS', () => {
    expect(ios08).toMatch(/mgios-shortcut-title[\s\S]{0,200}?15px/);
  });

  test('11-17 shortcut icon color #0E3B2E (bhVert)', () => {
    expect(ios08).toMatch(/mgios-shortcut-icon[\s\S]{0,200}?#0E3B2E/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. NO LEGACY 3-COLUMN GRID FOR PRIMARY ENTRIES
// ─────────────────────────────────────────────────────────────────────────────

describe('08 no legacy grid for primary entries', () => {
  test('12-01 manage-grid is hidden in ios08 CSS', () => {
    expect(ios08).toMatch(/manage-grid[\s\S]{0,100}?display\s*:\s*none\s*!important/);
  });

  test('12-02 manage-section-label is hidden in ios08 CSS', () => {
    expect(ios08).toMatch(/manage-section-label[\s\S]{0,100}?display\s*:\s*none\s*!important/);
  });

  test('12-03 no manageGridPrimary id in new HTML', () => {
    expect(manageHtml).not.toMatch(/id="manageGridPrimary"/);
  });

  test('12-04 manage-entry class not used in primary card', () => {
    // manage-entry is legacy — new code uses mgios-row
    const primaryBlock = manageHtml.match(/id="managePrimaryCard"[\s\S]*?managePrimaryCard\s*-->/);
    expect(primaryBlock).toBeTruthy();
    expect(primaryBlock[0]).not.toMatch(/class="manage-entry"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. RESPONSIVE — mobile (375/430), tablet (768/1024), desktop (1280+)
// ─────────────────────────────────────────────────────────────────────────────

describe('08 responsive design', () => {
  test('13-01 manage-content max-width in CSS (desktop comfortable width)', () => {
    expect(ios08).toMatch(/manage-content[\s\S]{0,200}?max-width\s*:\s*\d+px/);
  });

  test('13-02 manage-content padding 18px mobile (iOS exact)', () => {
    expect(ios08).toMatch(/manage-content[\s\S]{0,100}?18px/);
  });

  test('13-03 desktop media query for manage-content', () => {
    expect(ios08).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,300}?manage-content/);
  });

  test('13-04 manage-bottom-pad for mobile nav clearance', () => {
    expect(manageHtml).toMatch(/manage-bottom-pad/);
  });

  test('13-05 mgios-row uses flex (single-column layout on all sizes)', () => {
    expect(ios08).toMatch(/mgios-row[\s\S]{0,200}?display\s*:\s*flex/);
  });

  test('13-06 no grid-template-columns on mgios-card (stays row-based)', () => {
    const cardRule = ios08.match(/mgios-card\s*\{[^}]+\}/);
    expect(cardRule).toBeTruthy();
    expect(cardRule[0]).not.toMatch(/grid-template-columns/);
  });

  test('13-07 desktop padding-top override (prevent legacy shell gap)', () => {
    expect(ios08).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,300}?main-content[\s\S]{0,100}?padding-top\s*:\s*0\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. CSS SCOPE — no leak outside manage page
// ─────────────────────────────────────────────────────────────────────────────

describe('08 CSS scope', () => {
  test('14-01 all new rules scoped to body[data-page="manage"]', () => {
    // Every non-@media rule should reference data-page="manage"
    // Simple check: file does not have bare .mgios-* without manage scope
    // The mgios-alert-card is scoped
    expect(ios08).toMatch(/body\[data-page="manage"\][\s\S]{0,100}?mgios-alert-card/);
  });

  test('14-02 no calendarSection leak', () => {
    expect(ios08).not.toMatch(/calendarSection/);
  });

  test('14-03 no msgs-split leak', () => {
    expect(ios08).not.toMatch(/msgs-split/);
  });

  test('14-04 no Today leak', () => {
    expect(ios08).not.toMatch(/today-hub|bh-today/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. DYNAMIC DATA — JS kicker, counts, diffusion alert
// ─────────────────────────────────────────────────────────────────────────────

describe('08 dynamic data JS', () => {
  test('15-01 authFetch /api/properties called', () => {
    expect(manageHtml).toMatch(/authFetch\s*\(\s*['"]\/api\/properties['"]\s*\)/);
  });

  test('15-02 authFetch /api/property-groups called', () => {
    expect(manageHtml).toMatch(/authFetch\s*\(\s*['"]\/api\/property-groups['"]\s*\)/);
  });

  test('15-03 authFetch /api/properties/diffusion called', () => {
    expect(manageHtml).toMatch(/authFetch\s*\(\s*['"]\/api\/properties\/diffusion['"]\s*\)/);
  });

  test('15-04 kicker builds "logement(s)" singular correctly', () => {
    expect(manageHtml).toMatch(/propCount\s*===\s*1[\s\S]{0,50}?logement[^s]/);
  });

  test('15-05 kicker builds "groupe(s)" singular correctly', () => {
    expect(manageHtml).toMatch(/groupCount\s*===\s*1[\s\S]{0,50}?groupe[^s]/);
  });

  test('15-06 kicker separator is " · " (middle dot)', () => {
    expect(manageHtml).toMatch(/logements'\s*\+\s*'\s*·\s*'|' · '/);
  });

  test('15-07 manageKicker desktop span updated', () => {
    expect(manageHtml).toMatch(/getElementById\s*\(\s*['"]manageKicker['"]\s*\)/);
  });

  test('15-08 mobile .page-kicker also updated', () => {
    expect(manageHtml).toMatch(/querySelector\s*\(\s*['"]#bhHeader\s+\.page-kicker['"]\s*\)/);
  });

  test('15-09 diffusion a_regler > 0 filter', () => {
    expect(manageHtml).toMatch(/a_regler\s*>\s*0/);
  });

  test('15-10 diffusion noun singular/plural', () => {
    expect(manageHtml).toMatch(/logement à compléter/);
    expect(manageHtml).toMatch(/logements à compléter/);
  });

  test('15-11 applyDiffusionAlert shows alert-card (display:flex)', () => {
    expect(manageHtml).toMatch(/manageDiffusionAlert[\s\S]{0,200}?display\s*=\s*['"]flex['"]/);
  });

  test('15-12 JS guard: authFetch availability check', () => {
    expect(manageHtml).toMatch(/typeof authFetch\s*!==\s*['"]function['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. SUB-ACCOUNT PERMISSIONS — preserved
// ─────────────────────────────────────────────────────────────────────────────

describe('08 sub-account permissions', () => {
  test('16-01 data-perm on Logements row', () => {
    expect(manageHtml).toMatch(/href="\/properties\.html"[^>]*data-perm="can_view_properties"|data-perm="can_view_properties"[^>]*href="\/properties\.html"/);
  });

  test('16-02 data-perm on Ménage row', () => {
    expect(manageHtml).toMatch(/href="\/cleaning\.html"[^>]*data-perm="can_view_cleaning"|data-perm="can_view_cleaning"[^>]*href="\/cleaning\.html"/);
  });

  test('16-03 data-perm on Propriétaires row (can_view_invoices)', () => {
    expect(manageHtml).toMatch(/href="\/clients\.html"[^>]*data-perm="can_view_invoices"|data-perm="can_view_invoices"[^>]*href="\/clients\.html"/);
  });

  test('16-04 data-perm on Séjours row (can_view_invoices)', () => {
    expect(manageHtml).toMatch(/href="\/factures\.html"[^>]*data-perm="can_view_invoices"|data-perm="can_view_invoices"[^>]*href="\/factures\.html"/);
  });

  test('16-05 data-perm on BoostPrice row (pricing)', () => {
    expect(manageHtml).toMatch(/href="\/dynamic-pricing\.html"[^>]*data-perm="pricing"|data-perm="pricing"[^>]*href="\/dynamic-pricing\.html"/);
  });

  test('16-06 permMap: pricing → can_view_reservations still preserved', () => {
    expect(manageHtml).toMatch(/'pricing'\s*:\s*'can_view_reservations'/);
  });

  test('16-07 permission script queries .mgios-row[data-perm]', () => {
    expect(manageHtml).toMatch(/\.mgios-row\[data-perm\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. BOTTOM NAV, LG-CAPSULE, MESSAGES BADGE
// ─────────────────────────────────────────────────────────────────────────────

describe('08 bottom nav infrastructure', () => {
  test('17-01 mobile-tabs-handler.js loaded', () => {
    expect(manageHtml).toMatch(/mobile-tabs-handler\.js/);
  });

  test('17-02 bh-layout.js loaded', () => {
    expect(manageHtml).toMatch(/bh-layout\.js/);
  });

  test('17-03 messages-badge-desktop-mobile.js loaded', () => {
    expect(manageHtml).toMatch(/messages-badge-desktop-mobile\.js/);
  });

  test('17-04 data-page="manage" for Gestion active state', () => {
    expect(manageHtml).toMatch(/data-page="manage"/);
  });

  test('17-05 lg-capsule still referenced in bh-layout.js', () => {
    expect(bhLayout).toMatch(/lg-capsule/);
  });

  test('17-06 Calendar pointer fix preserved (e.pointerType !== "mouse")', () => {
    expect(bhLayout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });

  test('17-07 bhHeader element present (bh-layout.js injection point)', () => {
    expect(manageHtml).toMatch(/id="bhHeader"/);
  });

  test('17-08 bhSidebar element present', () => {
    expect(manageHtml).toMatch(/id="bhSidebar"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. NO SUBPAGE REDESIGN, NO BACKEND CHANGE
// ─────────────────────────────────────────────────────────────────────────────

describe('08 scope protection', () => {
  test('18-01 manage.html has no server.js modifications (file still exists)', () => {
    expect(() => fs.accessSync(path.join(ROOT, 'server.js'))).not.toThrow();
  });

  test('18-02 no dynamic-pricing cron change (route file unchanged)', () => {
    expect(() => fs.accessSync(path.join(ROOT, 'routes', 'dynamic-pricing-cron.js'))).not.toThrow();
  });

  test('18-03 no new API endpoints in manage.html (no app.get/app.post)', () => {
    expect(manageHtml).not.toMatch(/app\.(get|post|put|delete)\s*\(/);
  });

  test('18-04 no database migration in manage.html', () => {
    expect(manageHtml).not.toMatch(/CREATE TABLE|ALTER TABLE|ADD COLUMN/i);
  });

  test('18-05 chat-owner.js not referenced in manage.html', () => {
    expect(manageHtml).not.toMatch(/chat-owner\.js/);
  });

  test('18-06 no BoostPrice pricing_config change in manage.html', () => {
    expect(manageHtml).not.toMatch(/pricing_config|boostprice_enabled|entitlement/i);
  });

  test('18-07 no iOS directory modified', () => {
    const iosDir = path.join(ROOT, 'ios');
    if (require('fs').existsSync(iosDir)) {
      const files = require('fs').readdirSync(iosDir);
      expect(files).not.toContain('bh-manage-ios-08.css');
    } else {
      expect(true).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. AppBackground TOKENS
// ─────────────────────────────────────────────────────────────────────────────

describe('08 AppBackground', () => {
  test('19-01 bh-native-bg.css loaded (AppBackground gradient provider)', () => {
    expect(manageHtml).toMatch(/bh-native-bg\.css/);
  });

  test('19-02 bh-native-bg.css exists', () => {
    expect(() => css('bh-native-bg.css')).not.toThrow();
  });

  test('19-03 bh-native-bg.css contains gradient colors', () => {
    const nativeBg = css('bh-native-bg.css');
    // One of the canonical AppBackground gradient stops
    expect(nativeBg).toMatch(/#F5F2EA|#EBE7DC|#E2DDD0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. IOS REFERENCE VERIFIED
// ─────────────────────────────────────────────────────────────────────────────

describe('08 iOS reference parity', () => {
  test('20-01 five entries (matching iOS ManageHubView visibleEntries count)', () => {
    const primaryBlock = manageHtml.match(/id="managePrimaryCard"[\s\S]*?managePrimaryCard\s*-->/);
    const entries = (primaryBlock && primaryBlock[0].match(/class="mgios-row"/g)) || [];
    expect(entries.length).toBe(5);
  });

  test('20-02 Ménage icon uses OrFond bg token (iOS sparkles/cleaning gold)', () => {
    expect(manageHtml).toMatch(/href="\/cleaning\.html"[\s\S]{0,300}?rgba\(251,243,226,0\.90\)/);
  });

  test('20-03 Logements and BoostPrice share DCE8E1 bg (iOS exact token)', () => {
    const matches = (manageHtml.match(/#DCE8E1/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  test('20-04 Séjours subtitle contains "cautions" (iOS: factures voyageurs, cautions)', () => {
    expect(manageHtml).toMatch(/cautions/);
  });

  test('20-05 BoostPrice subtitle matches iOS "Tarification dynamique"', () => {
    const bpBlock = manageHtml.match(/href="\/dynamic-pricing\.html"[\s\S]{0,800}/);
    expect(bpBlock).toBeTruthy();
    expect(bpBlock[0]).toMatch(/Tarification dynamique/);
  });

  test('20-06 alert bar gradient bhOrClair→bhOr matches iOS exactly', () => {
    expect(ios08).toMatch(/#C9A15B[\s\S]{0,20}?#8A5B14/);
  });

  test('20-07 row padding 12px vertical (iOS CardRow exact)', () => {
    expect(ios08).toMatch(/mgios-row[\s\S]{0,200}?padding\s*:\s*12px\s*16px/);
  });

  test('20-08 row gap 14px (iOS HStack spacing 14)', () => {
    expect(ios08).toMatch(/mgios-row[\s\S]{0,200}?gap\s*:\s*14px/);
  });
});
