'use strict';
/**
 * TODAY_05_STRICT — iOS TodayView.swift parity
 * Minimum 90 assertions.
 *
 * Guards:
 *  - Root cause: bh-theme-v3.css page-title uses Instrument Serif / 24px / 400
 *  - Fix: bh-today-ios-05.css overrides to DM Sans / 30px / 700 / -0.96px
 *  - Header kicker: 12.5px / 600 / #5E6B63
 *  - Desktop layout: percentage-based 3fr/1fr ≈ 75%/25%
 *  - Section order iOS-strict: setupCard → countersStrip → calendarStrip
 *    → trialBanner → urgentArrivals → normalArrivals → departures → cleaning
 *  - SetupCard and TrialBanner present in app.html
 *  - Counters, calendar strip, section labels, cards all preserved
 *  - Platform badge colors correct
 *  - Mobile 18px horizontal padding
 *  - Protected files unchanged
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Root cause: bh-theme-v3.css uses Instrument Serif on page-title', () => {
  const v3 = css('bh-theme-v3.css');

  test('bh-theme-v3.css sets Instrument Serif on h1.page-title', () => {
    expect(v3).toMatch(/h1\.page-title[\s\S]{0,100}Instrument Serif/);
  });

  test('bh-theme-v3.css sets font-size: 24px on page-title', () => {
    expect(v3).toMatch(/h1\.page-title[\s\S]{0,200}font-size:\s*24px/);
  });

  test('bh-theme-v3.css sets font-weight: 400 on page-title', () => {
    expect(v3).toMatch(/h1\.page-title[\s\S]{0,200}font-weight:\s*400/);
  });

  test('bh-theme-v3.css sets page-kicker font-size: 11px', () => {
    expect(v3).toMatch(/page-kicker[\s\S]{0,100}font-size:\s*11px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Fix: bh-today-ios-05.css overrides header to DM Sans', () => {
  const s = css('bh-today-ios-05.css');

  test('bh-today-ios-05.css exists and is non-empty', () => {
    expect(s.length).toBeGreaterThan(500);
  });

  test('file is scoped to body[data-page="app"]', () => {
    expect(s).toMatch(/body\[data-page="app"\]/);
  });

  test('page-title font-family overridden to DM Sans', () => {
    expect(s).toMatch(/page-title[\s\S]{0,200}font-family:\s*'DM Sans'[\s\S]{0,30}!important/);
  });

  test('page-title font-size overridden to 30px', () => {
    expect(s).toMatch(/page-title[\s\S]{0,200}font-size:\s*30px\s*!important/);
  });

  test('page-title font-weight overridden to 700', () => {
    expect(s).toMatch(/page-title[\s\S]{0,200}font-weight:\s*700\s*!important/);
  });

  test('page-title letter-spacing is -0.96px', () => {
    expect(s).toMatch(/page-title[\s\S]{0,200}letter-spacing:\s*-0\.96px\s*!important/);
  });

  test('page-title color is #14201B', () => {
    expect(s).toMatch(/page-title[\s\S]{0,200}color:\s*#14201B\s*!important/);
  });

  test('Instrument Serif does not appear as a font in bh-today-ios-05.css', () => {
    // The fix must not reintroduce Instrument Serif
    expect(s).not.toMatch(/font-family:\s*['"]Instrument Serif/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Header kicker (super-title) 12.5px / 600 / #5E6B63', () => {
  const s = css('bh-today-ios-05.css');

  test('page-kicker font-size overridden to 12.5px', () => {
    expect(s).toMatch(/page-kicker[\s\S]{0,200}font-size:\s*12\.5px\s*!important/);
  });

  test('page-kicker font-weight 600', () => {
    expect(s).toMatch(/page-kicker[\s\S]{0,200}font-weight:\s*600\s*!important/);
  });

  test('page-kicker color #5E6B63', () => {
    expect(s).toMatch(/page-kicker[\s\S]{0,200}color:\s*#5E6B63\s*!important/);
  });

  test('page-kicker override is scoped to body[data-page="app"]', () => {
    expect(s).toMatch(/body\[data-page="app"\][\s\S]{0,200}page-kicker/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — CSS link order in app.html', () => {
  const h = html('app.html');

  test('app.html links bh-today-v3.css', () => {
    expect(h).toMatch(/bh-today-v3\.css/);
  });

  test('app.html links bh-today-ios-05.css', () => {
    expect(h).toMatch(/bh-today-ios-05\.css/);
  });

  test('bh-today-ios-05.css link comes after bh-today-v3.css link', () => {
    const posV3  = h.indexOf('bh-today-v3.css');
    const pos05  = h.indexOf('bh-today-ios-05.css');
    expect(pos05).toBeGreaterThan(posV3);
  });

  test('bh-today-ios-05.css link comes before bh-calendar-v3.css link', () => {
    const pos05  = h.indexOf('bh-today-ios-05.css');
    const posCal = h.indexOf('bh-calendar-v3.css');
    expect(posCal).toBeGreaterThan(pos05);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Section order iOS-strict: setupCard first', () => {
  const h = html('app.html');

  test('#bhTv3SetupCard exists in app.html', () => {
    expect(h).toMatch(/id="bhTv3SetupCard"/);
  });

  test('#bhTv3SetupCard has class bh-tv3-setup-card', () => {
    expect(h).toMatch(/id="bhTv3SetupCard"[\s\S]{0,100}bh-tv3-setup-card|bh-tv3-setup-card[\s\S]{0,100}id="bhTv3SetupCard"/);
  });

  test('#bhTv3SetupCard appears before #bhTv3Counters', () => {
    const posSetup    = h.indexOf('bhTv3SetupCard');
    const posCounters = h.indexOf('bhTv3Counters');
    expect(posSetup).toBeLessThan(posCounters);
  });

  test('#bhTv3SetupCard appears before #bhTv3WeekCard', () => {
    const posSetup = h.indexOf('bhTv3SetupCard');
    const posWeek  = h.indexOf('bhTv3WeekCard');
    expect(posSetup).toBeLessThan(posWeek);
  });

  test('#bhTv3SetupCard has progress bar element', () => {
    expect(h).toMatch(/id="bhTv3SetupProgressBar"/);
  });

  test('#bhTv3SetupCard has bh-tv3-setup-title', () => {
    expect(h).toMatch(/bh-tv3-setup-title/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Section order iOS-strict: trialBanner after calendarStrip', () => {
  const h = html('app.html');

  test('#bhTv3TrialBanner exists in app.html', () => {
    expect(h).toMatch(/id="bhTv3TrialBanner"/);
  });

  test('#bhTv3TrialBanner has class bh-tv3-trial-banner', () => {
    expect(h).toMatch(/id="bhTv3TrialBanner"[\s\S]{0,100}bh-tv3-trial-banner|bh-tv3-trial-banner[\s\S]{0,100}id="bhTv3TrialBanner"/);
  });

  test('#bhTv3TrialBanner appears after #bhTv3WeekCard', () => {
    const posWeek  = h.indexOf('bhTv3WeekCard');
    const posTrial = h.indexOf('bhTv3TrialBanner');
    expect(posTrial).toBeGreaterThan(posWeek);
  });

  test('#bhTv3TrialBanner appears before #bhTv3UrgentSection', () => {
    const posTrial  = h.indexOf('bhTv3TrialBanner');
    const posUrgent = h.indexOf('bhTv3UrgentSection');
    expect(posTrial).toBeLessThan(posUrgent);
  });

  test('#bhTv3TrialBanner has bh-tv3-trial-cta button', () => {
    expect(h).toMatch(/bh-tv3-trial-cta/);
  });

  test('#bhTv3TrialBanner has bh-tv3-trial-title element', () => {
    expect(h).toMatch(/id="bhTv3TrialTitle"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Full section order within #bh-tv3-primary', () => {
  const h = html('app.html');

  test('Full order: setupCard < counters < weekCard < trialBanner < urgent < arrivals', () => {
    const pos = (id) => h.indexOf(id);
    expect(pos('bhTv3SetupCard')).toBeLessThan(pos('bhTv3Counters'));
    expect(pos('bhTv3Counters')).toBeLessThan(pos('bhTv3WeekCard'));
    expect(pos('bhTv3WeekCard')).toBeLessThan(pos('bhTv3TrialBanner'));
    expect(pos('bhTv3TrialBanner')).toBeLessThan(pos('bhTv3UrgentSection'));
    expect(pos('bhTv3UrgentSection')).toBeLessThan(pos('bhTv3ArrivalsSection'));
  });

  test('Full order: arrivals < departures < cleaning', () => {
    const pos = (id) => h.indexOf(id);
    expect(pos('bhTv3ArrivalsSection')).toBeLessThan(pos('bhTv3DeparturesSection'));
    expect(pos('bhTv3DeparturesSection')).toBeLessThan(pos('bhTv3CleaningSection'));
  });

  test('All 8 iOS sections present', () => {
    const ids = [
      'bhTv3SetupCard', 'bhTv3Counters', 'bhTv3WeekCard', 'bhTv3TrialBanner',
      'bhTv3UrgentSection', 'bhTv3ArrivalsSection', 'bhTv3DeparturesSection', 'bhTv3CleaningSection'
    ];
    ids.forEach(id => expect(h).toMatch(new RegExp(id)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Setup card styles in bh-today-ios-05.css', () => {
  const s = css('bh-today-ios-05.css');

  test('.bh-tv3-setup-card has border-radius: 22px', () => {
    expect(s).toMatch(/\.bh-tv3-setup-card[\s\S]{0,200}border-radius:\s*22px/);
  });

  test('.bh-tv3-setup-card has glass background rgba(255,255,255,0.62)', () => {
    expect(s).toMatch(/\.bh-tv3-setup-card[\s\S]{0,200}background:\s*rgba\(255,\s*255,\s*255,\s*0\.62\)/);
  });

  test('.bh-tv3-setup-card has backdrop-filter: blur', () => {
    expect(s).toMatch(/\.bh-tv3-setup-card[\s\S]{0,300}backdrop-filter:\s*blur/);
  });

  test('.bh-tv3-setup-progress-bar background is #0E3B2E', () => {
    expect(s).toMatch(/\.bh-tv3-setup-progress-bar[\s\S]{0,200}background:\s*#0E3B2E/);
  });

  test('.bh-tv3-setup-title font-weight 700', () => {
    expect(s).toMatch(/\.bh-tv3-setup-title[\s\S]{0,200}font-weight:\s*700/);
  });

  test('.bh-tv3-setup-title color #14201B', () => {
    expect(s).toMatch(/\.bh-tv3-setup-title[\s\S]{0,200}color:\s*#14201B/);
  });

  test('.bh-tv3-setup-subtitle color #5E6B63', () => {
    expect(s).toMatch(/\.bh-tv3-setup-subtitle[\s\S]{0,200}color:\s*#5E6B63/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Trial banner styles in bh-today-ios-05.css', () => {
  const s = css('bh-today-ios-05.css');

  test('.bh-tv3-trial-banner has terracotta background rgba(253,240,236)', () => {
    expect(s).toMatch(/\.bh-tv3-trial-banner[\s\S]{0,200}background:\s*rgba\(253,\s*240,\s*236/);
  });

  test('.bh-tv3-trial-banner border uses rgba(255,222,210)', () => {
    expect(s).toMatch(/\.bh-tv3-trial-banner[\s\S]{0,200}border:[\s\S]{0,60}rgba\(255,\s*222,\s*210/);
  });

  test('.bh-tv3-trial-banner border-radius: 20px', () => {
    expect(s).toMatch(/\.bh-tv3-trial-banner[\s\S]{0,200}border-radius:\s*20px/);
  });

  test('.bh-tv3-trial-title color #A8452A', () => {
    expect(s).toMatch(/\.bh-tv3-trial-title[\s\S]{0,200}color:\s*#A8452A/);
  });

  test('.bh-tv3-trial-title font-weight 700', () => {
    expect(s).toMatch(/\.bh-tv3-trial-title[\s\S]{0,200}font-weight:\s*700/);
  });

  test('.bh-tv3-trial-cta background #C4552F', () => {
    expect(s).toMatch(/\.bh-tv3-trial-cta[\s\S]{0,200}background:\s*#C4552F/);
  });

  test('.bh-tv3-trial-cta border-radius: 12px', () => {
    expect(s).toMatch(/\.bh-tv3-trial-cta[\s\S]{0,200}border-radius:\s*12px/);
  });

  test('.bh-tv3-trial-cta color: #fff', () => {
    expect(s).toMatch(/\.bh-tv3-trial-cta[\s\S]{0,200}color:\s*#fff/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Desktop layout: percentage-based 3fr/1fr', () => {
  const s = css('bh-today-ios-05.css');
  const v3 = css('bh-today-v3.css');

  test('bh-today-v3.css uses fixed-px secondary column (pre-05 baseline)', () => {
    expect(v3).toMatch(/\.bh-tv3-layout[\s\S]{0,100}grid-template-columns:[\s\S]{0,50}300px/);
  });

  test('bh-today-ios-05.css overrides grid-template-columns to 3fr / 1fr', () => {
    expect(s).toMatch(/\.bh-tv3-layout[\s\S]{0,300}grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(0,\s*1fr\)\s*!important/);
  });

  test('override is scoped to body[data-page="app"]', () => {
    expect(s).toMatch(/body\[data-page="app"\][\s\S]{0,200}\.bh-tv3-layout/);
  });

  test('3fr/1fr ratio is 75% / 25% — inside spec 72-76% / 24-28% range', () => {
    // Verify the fractions are exactly 3fr and 1fr (3/(3+1)=0.75)
    const match = s.match(/minmax\(0,\s*([\d.]+)fr\)\s*minmax\(0,\s*([\d.]+)fr\)/);
    expect(match).not.toBeNull();
    if (match) {
      const a = parseFloat(match[1]);
      const b = parseFloat(match[2]);
      const ratio = a / (a + b);
      expect(ratio).toBeGreaterThanOrEqual(0.72);
      expect(ratio).toBeLessThanOrEqual(0.76);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Mobile: 18px horizontal padding', () => {
  const s = css('bh-today-ios-05.css');

  test('bh-today-ios-05.css has max-width: 1023px breakpoint', () => {
    expect(s).toMatch(/@media\s*\(max-width:\s*1023px\)/);
  });

  test('.bh-tv3-primary padding-left: 18px on mobile', () => {
    expect(s).toMatch(/bh-tv3-primary[\s\S]{0,200}padding-left:\s*18px\s*!important/);
  });

  test('.bh-tv3-primary padding-right: 18px on mobile', () => {
    expect(s).toMatch(/bh-tv3-primary[\s\S]{0,200}padding-right:\s*18px\s*!important/);
  });

  test('mobile breakpoint resets grid to single column', () => {
    expect(s).toMatch(/@media\s*\(max-width:\s*1023px\)[\s\S]{0,500}grid-template-columns:\s*1fr\s*!important/);
  });

  test('18px padding also applied at max-width: 767px breakpoint', () => {
    expect(s).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]{0,300}padding-left:\s*18px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.css preserved: counters strip', () => {
  const v3 = css('bh-today-v3.css');

  test('.bh-tv3-counter-card border-radius: 20px', () => {
    expect(v3).toMatch(/\.bh-tv3-counter-card[\s\S]{0,200}border-radius:\s*20px/);
  });

  test('.bh-tv3-counter-card background rgba(255,255,255,0.30)', () => {
    expect(v3).toMatch(/\.bh-tv3-counter-card[\s\S]{0,200}background:\s*rgba\(255,\s*255,\s*255,\s*0\.30\)/);
  });

  test('.bh-tv3-counter-card border rgba(255,255,255,0.50)', () => {
    expect(v3).toMatch(/\.bh-tv3-counter-card[\s\S]{0,200}border:[\s\S]{0,60}rgba\(255,\s*255,\s*255,\s*0\.50\)/);
  });

  test('.bh-tv3-counter-num font-size: 26px', () => {
    expect(v3).toMatch(/\.bh-tv3-counter-num[\s\S]{0,100}font-size:\s*26px/);
  });

  test('.bh-tv3-counter-num font-weight: 700', () => {
    expect(v3).toMatch(/\.bh-tv3-counter-num[\s\S]{0,100}font-weight:\s*700/);
  });

  test('.bh-tv3-counters has 3-column grid', () => {
    expect(v3).toMatch(/\.bh-tv3-counters[\s\S]{0,200}grid-template-columns:\s*repeat\(3,\s*1fr\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.css preserved: calendar strip', () => {
  const v3 = css('bh-today-v3.css');

  test('.bh-tv3-week-card border-radius: 24px', () => {
    expect(v3).toMatch(/\.bh-tv3-week-card[\s\S]{0,200}border-radius:\s*24px/);
  });

  test('.bh-tv3-day-cell.today background: #0E3B2E', () => {
    expect(v3).toMatch(/\.bh-tv3-day-cell\.today[\s\S]{0,100}background:\s*#0E3B2E/);
  });

  test('.bh-tv3-week-month label 11.5px/700/uppercase', () => {
    expect(v3).toMatch(/\.bh-tv3-week-month[\s\S]{0,200}font-size:\s*11\.5px/);
    expect(v3).toMatch(/\.bh-tv3-week-month[\s\S]{0,200}font-weight:\s*700/);
    expect(v3).toMatch(/\.bh-tv3-week-month[\s\S]{0,200}text-transform:\s*uppercase/);
  });

  test('calendar active day number is white (#ffffff)', () => {
    expect(v3).toMatch(/\.bh-tv3-day-cell\.today[\s\S]{0,200}color:\s*#ffffff/);
  });

  test('.bh-tv3-week-card has backdrop-filter', () => {
    expect(v3).toMatch(/\.bh-tv3-week-card[\s\S]{0,300}backdrop-filter:\s*blur/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.css preserved: section labels', () => {
  const v3 = css('bh-today-v3.css');

  test('.bh-tv3-section-label font-size: 11.5px', () => {
    expect(v3).toMatch(/\.bh-tv3-section-label[\s\S]{0,200}font-size:\s*11\.5px/);
  });

  test('.bh-tv3-section-label font-weight: 700', () => {
    expect(v3).toMatch(/\.bh-tv3-section-label[\s\S]{0,200}font-weight:\s*700/);
  });

  test('.bh-tv3-section-label text-transform: uppercase', () => {
    expect(v3).toMatch(/\.bh-tv3-section-label[\s\S]{0,200}text-transform:\s*uppercase/);
  });

  test('.bh-tv3-section-label letter-spacing: 0.13em', () => {
    expect(v3).toMatch(/\.bh-tv3-section-label[\s\S]{0,200}letter-spacing:\s*0\.13em/);
  });

  test('.bh-tv3-section-label color: #5E6B63', () => {
    expect(v3).toMatch(/\.bh-tv3-section-label[\s\S]{0,200}color:\s*#5E6B63/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.css preserved: arrival/departure cards', () => {
  const v3 = css('bh-today-v3.css');

  test('.bh-tv3-arrival-card border-radius: 22px', () => {
    // selector is combined with .bh-tv3-departure-card — need wider range
    expect(v3).toMatch(/\.bh-tv3-arrival-card[\s\S]{0,300}border-radius:\s*22px/);
  });

  test('.bh-tv3-departure-card border-radius: 22px', () => {
    expect(v3).toMatch(/\.bh-tv3-departure-card[\s\S]{0,200}border-radius:\s*22px/);
  });

  test('.bh-tv3-arrival-card padding: 14px 16px', () => {
    expect(v3).toMatch(/\.bh-tv3-arrival-card[\s\S]{0,600}padding:\s*14px\s*16px/);
  });

  test('.bh-tv3-card-name font-size: 17px (guest name)', () => {
    expect(v3).toMatch(/\.bh-tv3-card-name[\s\S]{0,100}font-size:\s*17px/);
  });

  test('.bh-tv3-card-name font-weight: 600 (guest name)', () => {
    expect(v3).toMatch(/\.bh-tv3-card-name[\s\S]{0,100}font-weight:\s*600/);
  });

  test('.bh-tv3-card-name color: #14201B', () => {
    expect(v3).toMatch(/\.bh-tv3-card-name[\s\S]{0,100}color:\s*#14201B/);
  });

  test('.bh-tv3-card-meta font-size: 13px', () => {
    expect(v3).toMatch(/\.bh-tv3-card-meta[\s\S]{0,100}font-size:\s*13px/);
  });

  test('.bh-tv3-card-meta color: #5E6B63', () => {
    expect(v3).toMatch(/\.bh-tv3-card-meta[\s\S]{0,100}color:\s*#5E6B63/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.css preserved: urgent card', () => {
  const v3 = css('bh-today-v3.css');

  test('.bh-tv3-urgent-card border uses rgba(255,222,210)', () => {
    expect(v3).toMatch(/\.bh-tv3-urgent-card[\s\S]{0,200}border:[\s\S]{0,60}rgba\(255,\s*222,\s*210/);
  });

  test('.bh-tv3-urgent-bar has terracotta gradient #C4552F to #A8452A', () => {
    expect(v3).toMatch(/\.bh-tv3-urgent-bar[\s\S]{0,200}#C4552F[\s\S]{0,50}#A8452A/);
  });

  test('.bh-tv3-urgent-bar width: 4px', () => {
    expect(v3).toMatch(/\.bh-tv3-urgent-bar[\s\S]{0,100}width:\s*4px/);
  });

  test('.bh-tv3-urgent-card border-radius: 22px', () => {
    expect(v3).toMatch(/\.bh-tv3-urgent-card[\s\S]{0,100}border-radius:\s*22px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.js preserved: platform badge colors', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'bh-today-v3.js'), 'utf8');

  test('Airbnb badge color #FF5A5F', () => {
    expect(js).toMatch(/airbnb[\s\S]{0,30}'#FF5A5F'|airbnb[\s\S]{0,30}"#FF5A5F"/);
  });

  test('Booking badge color #003580', () => {
    expect(js).toMatch(/booking[\s\S]{0,30}'#003580'|booking[\s\S]{0,30}"#003580"/);
  });

  test('Expedia badge color #FFC72C', () => {
    expect(js).toMatch(/expedia[\s\S]{0,30}'#FFC72C'|expedia[\s\S]{0,30}"#FFC72C"/);
  });

  test('Vrbo badge color #1A5276', () => {
    expect(js).toMatch(/vrbo[\s\S]{0,30}'#1A5276'|vrbo[\s\S]{0,30}"#1A5276"/);
  });

  test('Direct badge color #0E3B2E', () => {
    expect(js).toMatch(/direct[\s\S]{0,30}'#0E3B2E'|direct[\s\S]{0,30}"#0E3B2E"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — bh-today-v3.css preserved: cleaning row', () => {
  const v3 = css('bh-today-v3.css');

  test('.bh-tv3-cleaning-row border-radius: 16px', () => {
    expect(v3).toMatch(/\.bh-tv3-cleaning-row[\s\S]{0,200}border-radius:\s*16px/);
  });

  test('.bh-tv3-cleaning-row padding: 12px 16px', () => {
    expect(v3).toMatch(/\.bh-tv3-cleaning-row[\s\S]{0,200}padding:\s*12px\s*16px/);
  });

  test('.bh-tv3-cleaning-name font-size: 15px', () => {
    expect(v3).toMatch(/\.bh-tv3-cleaning-name[\s\S]{0,100}font-size:\s*15px/);
  });

  test('.bh-tv3-cleaning-name font-weight: 600', () => {
    expect(v3).toMatch(/\.bh-tv3-cleaning-name[\s\S]{0,100}font-weight:\s*600/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — app.html structure preserved', () => {
  const h = html('app.html');

  test('#bhTv3Content layout wrapper present', () => {
    expect(h).toMatch(/id="bhTv3Content"/);
  });

  test('.bh-tv3-layout present', () => {
    expect(h).toMatch(/class="bh-tv3-layout"/);
  });

  test('.bh-tv3-primary present', () => {
    expect(h).toMatch(/class="bh-tv3-primary"/);
  });

  test('.bh-tv3-secondary (KPI column) present', () => {
    expect(h).toMatch(/class="bh-tv3-secondary"/);
  });

  test('KPI CA card preserved', () => {
    expect(h).toMatch(/id="kpiCaCard"/);
  });

  test('KPI Occupancy card preserved', () => {
    expect(h).toMatch(/id="kpiOccupancyCard"/);
  });

  test('#bhTv3UrgentSection preserved', () => {
    expect(h).toMatch(/id="bhTv3UrgentSection"/);
  });

  test('#bhTv3ArrivalsSection preserved', () => {
    expect(h).toMatch(/id="bhTv3ArrivalsSection"/);
  });

  test('#bhTv3DeparturesSection preserved', () => {
    expect(h).toMatch(/id="bhTv3DeparturesSection"/);
  });

  test('#bhTv3CleaningSection preserved', () => {
    expect(h).toMatch(/id="bhTv3CleaningSection"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TODAY_05 — Protected files unchanged', () => {
  test('chat-owner.js SHA-1 unchanged', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'js', 'chat-owner.js'));
    const raw = crypto.createHash('sha1').update(buf).digest('hex');
    expect(raw).toBe('2a9717b64e4f7059a164175177f976025ff47142');
  });

  test('calendar-modern.js size > 1 KB', () => {
    const p = path.join(ROOT, 'public', 'js', 'calendar-modern.js');
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-calendar-v3.js size > 1 KB', () => {
    const p = path.join(ROOT, 'public', 'js', 'bh-calendar-v3.js');
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-shell-04.css still has Section 7 ::before suppressor', () => {
    expect(css('bh-shell-04.css')).toMatch(/\.tab-btn::before[\s\S]{0,100}content:\s*none\s*!important/);
  });

  test('bh-bottom-bar.css still has legacy ::before dot (suppressed externally)', () => {
    expect(css('bh-bottom-bar.css')).toMatch(/\.tab-btn\.active::before/);
  });

  test('server.js exists (no backend change)', () => {
    expect(fs.existsSync(path.join(ROOT, 'server.js'))).toBe(true);
  });
});
