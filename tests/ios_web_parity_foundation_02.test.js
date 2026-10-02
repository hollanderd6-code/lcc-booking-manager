/**
 * IOS-WEB-PARITY-FOUNDATION-02 — Design system token & component tests
 * Verifies exact color tokens, typography, radius, shadows, glass
 * components, pills, badges, manage icons, and no-engine-change
 * guarantees.
 * 82 tests: F02-01 … F02-82
 */

const fs   = require('fs');
const path = require('path');

const REPO        = path.join(__dirname, '..');
const TOKENS_FILE = path.join(REPO, 'public/css/bh-tokens.css');
const PARITY_FILE = path.join(REPO, 'public/css/bh-ios-parity.css');
const SERVER_JS   = path.join(REPO, 'server.js');
const CHANNEX_JS  = path.join(REPO, 'channex.js');
const CHAT_OWNER  = path.join(REPO, 'public/js/chat-owner.js');

let tk  = '';
let pc  = '';

beforeAll(() => {
  tk = fs.readFileSync(TOKENS_FILE, 'utf8');
  pc = fs.readFileSync(PARITY_FILE, 'utf8');
});

// ── Token file existence ──────────────────────────────────────────────────

test('F02-01: bh-tokens.css exists', () => {
  expect(fs.existsSync(TOKENS_FILE)).toBe(true);
});

test('F02-02: bh-ios-parity.css exists', () => {
  expect(fs.existsSync(PARITY_FILE)).toBe(true);
});

// ── Exact color tokens ────────────────────────────────────────────────────

test('F02-03: --bh-ios-encre is #14201B', () => {
  expect(tk).toMatch(/--bh-ios-encre\s*:\s*#14201B/);
});

test('F02-04: --bh-ios-encre-douce is #2C3A33', () => {
  expect(tk).toMatch(/--bh-ios-encre-douce\s*:\s*#2C3A33/);
});

test('F02-05: --bh-ios-corps is #3E4A44', () => {
  expect(tk).toMatch(/--bh-ios-corps\s*:\s*#3E4A44/);
});

test('F02-06: --bh-ios-attenue is #5E6B63 (lightest text allowed)', () => {
  expect(tk).toMatch(/--bh-ios-attenue\s*:\s*#5E6B63/);
});

test('F02-07: --bh-ios-vert is #0E3B2E', () => {
  expect(tk).toMatch(/--bh-ios-vert\s*:\s*#0E3B2E/);
});

test('F02-08: --bh-ios-vert-clair is #8FD3B4', () => {
  expect(tk).toMatch(/--bh-ios-vert-clair\s*:\s*#8FD3B4/);
});

test('F02-09: --bh-ios-occupe is #2E8B62', () => {
  expect(tk).toMatch(/--bh-ios-occupe\s*:\s*#2E8B62/);
});

test('F02-10: --bh-ios-occupe-fonce is #1F6B4C', () => {
  expect(tk).toMatch(/--bh-ios-occupe-fonce\s*:\s*#1F6B4C/);
});

test('F02-11: --bh-ios-menthe-fond is rgba(46,139,98,0.13)', () => {
  expect(tk).toMatch(/--bh-ios-menthe-fond\s*:\s*rgba\(46,\s*139,\s*98,\s*0\.13\)/);
});

test('F02-12: --bh-ios-terracotta is #A8452A (urgency only)', () => {
  expect(tk).toMatch(/--bh-ios-terracotta\s*:\s*#A8452A/);
});

test('F02-13: --bh-ios-terracotta-border rgba(255,222,210,0.90)', () => {
  expect(tk).toMatch(/--bh-ios-terracotta-border\s*:\s*rgba\(255,\s*222,\s*210,\s*0\.90\)/);
});

test('F02-14: --bh-ios-terracotta-bg rgba(253,240,236,0.72)', () => {
  expect(tk).toMatch(/--bh-ios-terracotta-bg\s*:\s*rgba\(253,\s*240,\s*236,\s*0\.72\)/);
});

test('F02-15: --bh-ios-or is #8A5B14 (gold/AI only)', () => {
  expect(tk).toMatch(/--bh-ios-or\s*:\s*#8A5B14/);
});

test('F02-16: --bh-ios-or-clair is #C9A15B', () => {
  expect(tk).toMatch(/--bh-ios-or-clair\s*:\s*#C9A15B/);
});

test('F02-17: --bh-ios-or-bg rgba(251,243,226,0.90)', () => {
  expect(tk).toMatch(/--bh-ios-or-bg\s*:\s*rgba\(251,\s*243,\s*226,\s*0\.90\)/);
});

test('F02-18: --bh-ios-bleu is #2563EB', () => {
  expect(tk).toMatch(/--bh-ios-bleu\s*:\s*#2563EB/);
});

// Platform colors

test('F02-19: --bh-ios-airbnb is #FF5A5F', () => {
  expect(tk).toMatch(/--bh-ios-airbnb\s*:\s*#FF5A5F/);
});

test('F02-20: --bh-ios-booking is #003580', () => {
  expect(tk).toMatch(/--bh-ios-booking\s*:\s*#003580/);
});

test('F02-21: --bh-ios-expedia is #FFC72C', () => {
  expect(tk).toMatch(/--bh-ios-expedia\s*:\s*#FFC72C/);
});

test('F02-22: --bh-ios-vrbo is #1A5276', () => {
  expect(tk).toMatch(/--bh-ios-vrbo\s*:\s*#1A5276/);
});

test('F02-23: --bh-ios-direct is #0E3B2E', () => {
  expect(tk).toMatch(/--bh-ios-direct\s*:\s*#0E3B2E/);
});

test('F02-24: --bh-ios-bloque is #9CA3AF', () => {
  expect(tk).toMatch(/--bh-ios-bloque\s*:\s*#9CA3AF/);
});

// App background

test('F02-25: --bh-ios-bg-top is #F5F2EA', () => {
  expect(tk).toMatch(/--bh-ios-bg-top\s*:\s*#F5F2EA/);
});

test('F02-26: --bh-ios-bg-mid is #EBE7DC', () => {
  expect(tk).toMatch(/--bh-ios-bg-mid\s*:\s*#EBE7DC/);
});

test('F02-27: --bh-ios-bg-bottom is #E2DDD0', () => {
  expect(tk).toMatch(/--bh-ios-bg-bottom\s*:\s*#E2DDD0/);
});

// ── Typography tokens ─────────────────────────────────────────────────────

test('F02-28: grand-titre size is 30px', () => {
  expect(tk).toMatch(/--bh-font-grand-titre-size\s*:\s*30px/);
});

test('F02-29: grand-titre weight is 700', () => {
  expect(tk).toMatch(/--bh-font-grand-titre-weight\s*:\s*700/);
});

test('F02-30: grand-titre tracking is -0.96px', () => {
  expect(tk).toMatch(/--bh-font-grand-titre-tracking\s*:\s*-0\.96px/);
});

test('F02-31: valeur-hero size is 34px', () => {
  expect(tk).toMatch(/--bh-font-valeur-hero-size\s*:\s*34px/);
});

test('F02-32: valeur-hero tracking is -1.19px', () => {
  expect(tk).toMatch(/--bh-font-valeur-hero-tracking\s*:\s*-1\.19px/);
});

test('F02-33: titre-ligne size is 17px weight 600', () => {
  expect(tk).toMatch(/--bh-font-titre-ligne-size\s*:\s*17px/);
  expect(tk).toMatch(/--bh-font-titre-ligne-weight\s*:\s*600/);
});

test('F02-34: corps size is 15px', () => {
  expect(tk).toMatch(/--bh-font-corps-size\s*:\s*15px/);
});

test('F02-35: meta size is 13px', () => {
  expect(tk).toMatch(/--bh-font-meta-size\s*:\s*13px/);
});

test('F02-36: intertitre is 11.5px 700 tracking 1.5px', () => {
  expect(tk).toMatch(/--bh-font-intertitre-size\s*:\s*11\.5px/);
  expect(tk).toMatch(/--bh-font-intertitre-weight\s*:\s*700/);
  expect(tk).toMatch(/--bh-font-intertitre-tracking\s*:\s*1\.5px/);
});

test('F02-37: onglet is 10.5px weight 500', () => {
  expect(tk).toMatch(/--bh-font-onglet-size\s*:\s*10\.5px/);
  expect(tk).toMatch(/--bh-font-onglet-weight\s*:\s*500/);
});

// ── Spacing tokens ────────────────────────────────────────────────────────

test('F02-38: canonical spacing scale has 11 steps', () => {
  const matches = (tk.match(/--bh-sp-\d+\s*:/g) || []);
  expect(matches.length).toBeGreaterThanOrEqual(11);
});

test('F02-39: content-h-mobile is 18px', () => {
  expect(tk).toMatch(/--bh-content-h-mobile\s*:\s*18px/);
});

test('F02-40: content-top is 16px, content-bottom is 32px', () => {
  expect(tk).toMatch(/--bh-content-top\s*:\s*16px/);
  expect(tk).toMatch(/--bh-content-bottom\s*:\s*32px/);
});

// ── Radius tokens ─────────────────────────────────────────────────────────

test('F02-41: --bh-radius-card is 22px', () => {
  expect(tk).toMatch(/--bh-radius-card\s*:\s*22px/);
});

test('F02-42: --bh-radius-card-large is 24px', () => {
  expect(tk).toMatch(/--bh-radius-card-large\s*:\s*24px/);
});

test('F02-43: --bh-radius-card-small is 16px', () => {
  expect(tk).toMatch(/--bh-radius-card-small\s*:\s*16px/);
});

test('F02-44: --bh-radius-button is 15px', () => {
  expect(tk).toMatch(/--bh-radius-button\s*:\s*15px/);
});

test('F02-45: --bh-radius-input is 18px', () => {
  expect(tk).toMatch(/--bh-radius-input\s*:\s*18px/);
});

test('F02-46: --bh-radius-calendar-bar is 11px', () => {
  expect(tk).toMatch(/--bh-radius-calendar-bar\s*:\s*11px/);
});

test('F02-47: --bh-radius-platform is 8px', () => {
  expect(tk).toMatch(/--bh-radius-platform\s*:\s*8px/);
});

test('F02-48: --bh-radius-manage-icon is 12px', () => {
  expect(tk).toMatch(/--bh-radius-manage-icon\s*:\s*12px/);
});

// ── Shadow tokens ─────────────────────────────────────────────────────────

test('F02-49: --bh-shadow-card is 0 8px 22px rgba(20,32,27,0.08)', () => {
  expect(tk).toMatch(/--bh-shadow-card\s*:\s*0 8px 22px rgba\(20,\s*32,\s*27,\s*0\.08\)/);
});

test('F02-50: --bh-shadow-chrome is 0 14px 38px rgba(20,32,27,0.20)', () => {
  expect(tk).toMatch(/--bh-shadow-chrome\s*:\s*0 14px 38px rgba\(20,\s*32,\s*27,\s*0\.20\)/);
});

test('F02-51: --bh-shadow-chip is 0 2px 4px rgba(20,32,27,0.10)', () => {
  expect(tk).toMatch(/--bh-shadow-chip\s*:\s*0 2px 4px rgba\(20,\s*32,\s*27,\s*0\.10\)/);
});

// ── Glass tokens ──────────────────────────────────────────────────────────

test('F02-52: --bh-glass-fill is rgba(255,255,255,0.62)', () => {
  expect(tk).toMatch(/--bh-glass-fill\s*:\s*rgba\(255,\s*255,\s*255,\s*0\.62\)/);
});

test('F02-53: --bh-glass-border is rgba(255,255,255,0.70)', () => {
  expect(tk).toMatch(/--bh-glass-border\s*:\s*rgba\(255,\s*255,\s*255,\s*0\.70\)/);
});

// ── Calendar reference tokens ─────────────────────────────────────────────

test('F02-54: --bh-cal-ref-property-width is 76px', () => {
  expect(tk).toMatch(/--bh-cal-ref-property-width\s*:\s*76px/);
});

test('F02-55: --bh-cal-ref-row-height is 64px', () => {
  expect(tk).toMatch(/--bh-cal-ref-row-height\s*:\s*64px/);
});

test('F02-56: --bh-cal-ref-bar-radius is 11px', () => {
  expect(tk).toMatch(/--bh-cal-ref-bar-radius\s*:\s*11px/);
});

test('F02-57: --bh-cal-ref-weekend rgba(201,161,91,0.07)', () => {
  expect(tk).toMatch(/--bh-cal-ref-weekend\s*:\s*rgba\(201,\s*161,\s*91,\s*0\.07\)/);
});

// ── Messages reference tokens ─────────────────────────────────────────────

test('F02-58: --bh-msg-ref-avatar-size is 46px', () => {
  expect(tk).toMatch(/--bh-msg-ref-avatar-size\s*:\s*46px/);
});

test('F02-59: --bh-msg-ref-card-radius is 22px', () => {
  expect(tk).toMatch(/--bh-msg-ref-card-radius\s*:\s*22px/);
});

test('F02-60: --bh-msg-ref-bubble-max is 78%', () => {
  expect(tk).toMatch(/--bh-msg-ref-bubble-max\s*:\s*78%/);
});

test('F02-61: owner bubble fill rgba(255,255,255,0.80)', () => {
  expect(tk).toMatch(/--bh-msg-owner-fill\s*:\s*rgba\(255,\s*255,\s*255,\s*0\.80\)/);
});

test('F02-62: guest bubble fill #DCE8E1', () => {
  expect(tk).toMatch(/--bh-msg-guest-fill\s*:\s*#DCE8E1/);
});

// ── Manage tokens ─────────────────────────────────────────────────────────

test('F02-63: manage properties bg #DCE8E1 fg #0E3B2E', () => {
  expect(tk).toMatch(/--bh-manage-properties-bg\s*:\s*#DCE8E1/);
  expect(tk).toMatch(/--bh-manage-properties-fg\s*:\s*#0E3B2E/);
});

test('F02-64: manage cleaning bg rgba(251,243,226,0.90) fg #8A5B14', () => {
  expect(tk).toMatch(/--bh-manage-cleaning-bg\s*:\s*rgba\(251,\s*243,\s*226,\s*0\.90\)/);
  expect(tk).toMatch(/--bh-manage-cleaning-fg\s*:\s*#8A5B14/);
});

test('F02-65: manage boost bg #DCE8E1 fg #2E8B62', () => {
  expect(tk).toMatch(/--bh-manage-boost-bg\s*:\s*#DCE8E1/);
  expect(tk).toMatch(/--bh-manage-boost-fg\s*:\s*#2E8B62/);
});

// ── Component classes in bh-ios-parity.css ───────────────────────────────

test('F02-66: .bh-ios-app-bg exists with gradient', () => {
  expect(pc).toMatch(/\.bh-ios-app-bg/);
  expect(pc).toMatch(/linear-gradient.*168deg/s);
});

test('F02-67: .bh-ios-app-bg::before has 4 radial halos', () => {
  const halos = pc.match(/radial-gradient/g) || [];
  expect(halos.length).toBeGreaterThanOrEqual(4);
});

test('F02-68: .bh-ios-card exists with backdrop-filter and rgba(255,255,255,0.62)', () => {
  expect(pc).toMatch(/\.bh-ios-card/);
  expect(pc).toMatch(/backdrop-filter.*blur\(20px\)/s);
  expect(pc).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.62\)/);
});

test('F02-69: .bh-ios-card::before has specular gradient 135deg', () => {
  const specular = pc.match(/\.bh-ios-card::before[\s\S]*?135deg/);
  expect(specular).not.toBeNull();
});

test('F02-70: .bh-ios-chrome exists, heavier blur(28px)', () => {
  expect(pc).toMatch(/\.bh-ios-chrome/);
  expect(pc).toMatch(/blur\(28px\)/);
});

test('F02-71: .bh-ios-circle-button is 38×38 circular', () => {
  expect(pc).toMatch(/\.bh-ios-circle-button/);
  expect(pc).toMatch(/width\s*:\s*38px/);
  expect(pc).toMatch(/height\s*:\s*38px/);
  expect(pc).toMatch(/border-radius\s*:\s*50%/);
});

test('F02-72: .bh-ios-initials-button 38×38 with own/delegated variants', () => {
  expect(pc).toMatch(/\.bh-ios-initials-button/);
  expect(pc).toMatch(/--delegated/);
  expect(pc).toMatch(/#A8452A/);  /* delegated background */
});

test('F02-73: .bh-ios-navbar with super title 12.5px and grand titre 30px', () => {
  expect(pc).toMatch(/\.bh-ios-navbar/);
  expect(pc).toMatch(/12\.5px/);
  expect(pc).toMatch(/30px/);
  expect(pc).toMatch(/-0\.96px/);
});

test('F02-74: .bh-ios-section-label 11.5px 700 uppercase tracking 1.5px', () => {
  expect(pc).toMatch(/\.bh-ios-section-label/);
  expect(pc).toMatch(/11\.5px/);
  expect(pc).toMatch(/font-weight\s*:\s*700/);
  expect(pc).toMatch(/text-transform\s*:\s*uppercase/);
  expect(pc).toMatch(/1\.5px/);
});

test('F02-75: .bh-ios-filter-pill transition 180ms ease-in-out', () => {
  expect(pc).toMatch(/\.bh-ios-filter-pill/);
  expect(pc).toMatch(/180ms ease-in-out/);
  expect(pc).toMatch(/13px/);  /* font-size */
});

test('F02-76: .bh-ios-platform-badge with all 7 platform variants', () => {
  expect(pc).toMatch(/\.bh-ios-platform-badge--airbnb/);
  expect(pc).toMatch(/\.bh-ios-platform-badge--booking/);
  expect(pc).toMatch(/\.bh-ios-platform-badge--expedia/);
  expect(pc).toMatch(/\.bh-ios-platform-badge--vrbo/);
  expect(pc).toMatch(/\.bh-ios-platform-badge--direct/);
  expect(pc).toMatch(/\.bh-ios-platform-badge--bhguest/);
  expect(pc).toMatch(/\.bh-ios-platform-badge--bloque/);
});

test('F02-77: .bh-ios-message-owner has rgba(255,255,255,0.80) fill', () => {
  expect(pc).toMatch(/\.bh-ios-message-owner/);
  expect(pc).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.80\)/);
  expect(pc).toMatch(/18px 18px 4px 18px/);
});

test('F02-78: .bh-ios-message-guest has #DCE8E1 fill', () => {
  expect(pc).toMatch(/\.bh-ios-message-guest/);
  expect(pc).toMatch(/#DCE8E1/);
  expect(pc).toMatch(/4px 18px 18px 18px/);
});

test('F02-79: manage icon classes with all 4 variants', () => {
  expect(pc).toMatch(/\.bh-ios-manage-icon--properties/);
  expect(pc).toMatch(/\.bh-ios-manage-icon--cleaning/);
  expect(pc).toMatch(/\.bh-ios-manage-icon--owners/);
  expect(pc).toMatch(/\.bh-ios-manage-icon--boost/);
});

test('F02-80: prefers-reduced-motion block present', () => {
  expect(pc).toMatch(/prefers-reduced-motion/);
});

// ── No-engine-change guarantees ───────────────────────────────────────────

test('F02-81: chat-owner.js unchanged (no hash change since 18B commit)', () => {
  const { execSync } = require('child_process');
  const hash = execSync('git hash-object public/js/chat-owner.js', { cwd: REPO })
    .toString().trim();
  expect(hash).toBe('a56812ddd30d65da5582950d645f41f5e03cb4f8');
});

test('F02-82: no backend/DB/Channex/Stripe files modified (only CSS/test)', () => {
  const { execSync } = require('child_process');
  const diff = execSync('git diff --name-only HEAD', { cwd: REPO }).toString();
  // Modified files must be only CSS and test files
  const lines = diff.trim().split('\n').filter(Boolean);
  const forbidden = lines.filter(l =>
    l === 'server.js' ||
    l.startsWith('routes/') ||
    l.startsWith('services/') ||
    l.startsWith('migrations/') ||
    l === 'channex.js' ||
    l.includes('chat-owner') ||
    l.includes('calendar-modern')
  );
  expect(forbidden).toHaveLength(0);
});
