'use strict';
/**
 * CALENDAR_06_STRICT — iOS CalendarView.swift parity for web Calendar
 * Minimum 120 assertions.
 *
 * Guards:
 *  - Root cause: bh-calendar-v3.css wrong row height, Instrument Serif, 135deg hatch
 *  - Fix: bh-calendar-ios-06.css overrides + app.html JS rowH 56→64
 *  - NavBar: DM Sans 30px/700/−0.96px title, 12.5px/600/#5E6B63 super-title
 *  - Glass buttons: circular 38×38, border-radius:50%
 *  - Block hatch: 45deg/#9CA3AF
 *  - BoostPrice: effective=#1F6B4C, pending=#C9A15B
 *  - Day chips: 44×58px, radius 13px
 *  - Week/Month row 64px, bar 44px, bar-radius 11px
 *  - Revenus: DM Sans 34px/600/−1.19px hero
 *  - CSS link order: 06 after bh-calendar-v3.css in app.html
 *  - JS change: rowH = 64 in app.html renderMonth()
 *  - Protected files unchanged
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Root cause: bh-calendar-v3.css wrong values', () => {
  const v3 = css('bh-calendar-v3.css');

  test('bh-calendar-v3.css defines --cal-row-h: 56px (to be overridden)', () => {
    expect(v3).toMatch(/--cal-row-h:\s*56px/);
  });

  test('bh-calendar-v3.css defines --cal-row-height: 56px (to be overridden)', () => {
    expect(v3).toMatch(/--cal-row-height:\s*56px/);
  });

  test('bh-calendar-v3.css uses Instrument Serif on .cal-month-title (to be overridden)', () => {
    expect(v3).toMatch(/\.cal-month-title[\s\S]{0,200}Instrument Serif/);
  });

  test('bh-calendar-v3.css uses 135deg hatch on .cal-bar-block (to be overridden)', () => {
    expect(v3).toMatch(/\.cal-bar-block[\s\S]{0,300}135deg/);
  });

  test('bh-calendar-v3.css BoostPrice effective uses --bh-vert not #1F6B4C (to be overridden)', () => {
    expect(v3).toMatch(/\.cal-bp-badge\.effective[\s\S]{0,100}--bh-vert/);
  });

  test('bh-calendar-v3.css forces background:#FFFFFF in bh-cal-mode (to be overridden)', () => {
    expect(v3).toMatch(/bh-cal-mode[\s\S]{0,200}background:#FFFFFF\s*!important|bh-cal-mode[\s\S]{0,200}background:\s*#FFFFFF\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Fix: bh-calendar-ios-06.css file structure', () => {
  const s = css('bh-calendar-ios-06.css');

  test('bh-calendar-ios-06.css exists and is non-empty', () => {
    expect(s.length).toBeGreaterThan(500);
  });

  test('file has section 0 — token alignment', () => {
    expect(s).toMatch(/0\. Token alignment/);
  });

  test('file has section 1 — AppBackground override', () => {
    expect(s).toMatch(/1\. AppBackground/);
  });

  test('file has section 2 — #bhCalRoot glass container', () => {
    expect(s).toMatch(/2\. #bhCalRoot/);
  });

  test('file has section 11 — block hatch 45deg', () => {
    expect(s).toMatch(/11\. Block bars/);
  });

  test('file has section 20 — Revenus view', () => {
    expect(s).toMatch(/20\. Revenus view/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Token alignment: row height 64px', () => {
  const s = css('bh-calendar-ios-06.css');

  test('--cal-row-h reassigned to 64px token reference', () => {
    expect(s).toMatch(/--cal-row-h:\s*var\(--bh-cal-ref-row-height,\s*64px\)/);
  });

  test('--cal-row-height reassigned to 64px token reference', () => {
    expect(s).toMatch(/--cal-row-height:\s*var\(--bh-cal-ref-row-height,\s*64px\)/);
  });

  test('--cal-property-width is set (desktop adaptation)', () => {
    expect(s).toMatch(/--cal-property-width:\s*110px/);
  });

  test('mobile --cal-property-width falls back to token 76px', () => {
    expect(s).toMatch(/@media[\s\S]{0,50}max-width:\s*767px[\s\S]{0,200}--cal-property-width:\s*var\(--bh-cal-ref-property-width,\s*76px\)/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — AppBackground: white override removed', () => {
  const s = css('bh-calendar-ios-06.css');

  test('body.bh-cal-mode #calendarSection background: transparent !important', () => {
    expect(s).toMatch(/body\.bh-cal-mode\s*#calendarSection[\s\S]{0,100}background:\s*transparent\s*!important/);
  });

  test('body.bh-cal-mode main.main-content background: transparent !important', () => {
    expect(s).toMatch(/body\.bh-cal-mode\s*main\.main-content[\s\S]{0,100}background:\s*transparent\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — #bhCalRoot glass container', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalRoot has glass background rgba(255,255,255,0.62)', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}rgba\(255,\s*255,\s*255,\s*0\.62\)/);
  });

  test('#bhCalRoot has backdrop-filter: blur(20px)', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}backdrop-filter:\s*blur\(20px\)/);
  });

  test('#bhCalRoot has border-radius: 24px !important', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}border-radius:\s*24px\s*!important/);
  });

  test('#bhCalRoot has border: 1px solid rgba(255,255,255,0.72)', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}1px solid rgba\(255,\s*255,\s*255,\s*0\.72\)/);
  });

  test('#bhCalRoot has box-shadow', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}box-shadow:/);
  });

  test('#bhCalRoot overrides inline style (requires !important on background)', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}background:[\s\S]{0,60}!important/);
  });

  test('#bhCalRoot uses DM Sans font-family', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,300}font-family:\s*'DM Sans'/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — NavBar header — glass', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalRoot .bh-cal-header has glass background rgba(255,255,255,0.82)', () => {
    expect(s).toMatch(/\.bh-cal-header[\s\S]{0,300}rgba\(255,\s*255,\s*255,\s*0\.82\)/);
  });

  test('#bhCalRoot .bh-cal-header has backdrop-filter', () => {
    expect(s).toMatch(/\.bh-cal-header[\s\S]{0,300}backdrop-filter:/);
  });

  test('#bhCalRoot .bh-cal-header has border-radius 24px 24px 0 0', () => {
    expect(s).toMatch(/\.bh-cal-header[\s\S]{0,300}border-radius:\s*24px 24px 0 0\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Month title: DM Sans 30px / 700 / −0.96px', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalMonthTitle font-size: 30px !important', () => {
    expect(s).toMatch(/#bhCalMonthTitle[\s\S]{0,200}font-size:\s*30px\s*!important/);
  });

  test('#bhCalMonthTitle font-weight: 700 !important', () => {
    expect(s).toMatch(/#bhCalMonthTitle[\s\S]{0,200}font-weight:\s*700\s*!important/);
  });

  test('#bhCalMonthTitle letter-spacing: -0.96px !important', () => {
    expect(s).toMatch(/#bhCalMonthTitle[\s\S]{0,200}letter-spacing:\s*-0\.96px\s*!important/);
  });

  test('#bhCalMonthTitle font-family: DM Sans', () => {
    expect(s).toMatch(/#bhCalMonthTitle[\s\S]{0,200}font-family:\s*'DM Sans'/);
  });

  test('.cal-month-title also overridden with DM Sans 30px', () => {
    expect(s).toMatch(/\.cal-month-title[\s\S]{0,200}font-family:\s*'DM Sans'[\s\S]{0,200}font-size:\s*30px|\.cal-month-title[\s\S]{0,200}font-size:\s*30px/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Super-title: 12.5px / 600 / #5E6B63 / no uppercase', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalSuperLabel font-size: 12.5px !important', () => {
    expect(s).toMatch(/#bhCalSuperLabel[\s\S]{0,200}font-size:\s*12\.5px\s*!important/);
  });

  test('#bhCalSuperLabel color: #5E6B63 !important', () => {
    expect(s).toMatch(/#bhCalSuperLabel[\s\S]{0,200}color:\s*#5E6B63\s*!important/);
  });

  test('#bhCalSuperLabel font-weight: 600 !important', () => {
    expect(s).toMatch(/#bhCalSuperLabel[\s\S]{0,200}font-weight:\s*600\s*!important/);
  });

  test('#bhCalSuperLabel text-transform: none !important (removes uppercase)', () => {
    expect(s).toMatch(/#bhCalSuperLabel[\s\S]{0,200}text-transform:\s*none\s*!important/);
  });

  test('.cal-supertitle also overridden with 12.5px #5E6B63', () => {
    expect(s).toMatch(/\.cal-supertitle[\s\S]{0,200}font-size:\s*12\.5px\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Glass buttons: circular 38×38 / border-radius:50%', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalActionsBtn border-radius: 50% !important', () => {
    expect(s).toMatch(/#bhCalActionsBtn[\s\S]{0,100}border-radius:\s*50%\s*!important|#bhCalActionsBtn,\s*#bhCalPrevBtn[\s\S]{0,200}border-radius:\s*50%\s*!important/);
  });

  test('#bhCalPrevBtn and #bhCalNextBtn listed in the rule', () => {
    expect(s).toMatch(/#bhCalPrevBtn/);
    expect(s).toMatch(/#bhCalNextBtn/);
  });

  test('buttons have width: 38px !important', () => {
    expect(s).toMatch(/#bhCalActionsBtn[\s\S]{0,300}width:\s*38px\s*!important/);
  });

  test('buttons have height: 38px !important', () => {
    expect(s).toMatch(/#bhCalActionsBtn[\s\S]{0,300}height:\s*38px\s*!important/);
  });

  test('buttons have backdrop-filter: blur(14px)', () => {
    expect(s).toMatch(/#bhCalActionsBtn[\s\S]{0,300}backdrop-filter:\s*blur\(14px\)/);
  });

  test('.cal-glass-btn border-radius: 50% !important', () => {
    expect(s).toMatch(/\.cal-glass-btn[\s\S]{0,100}border-radius:\s*50%\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Block hatch: 45deg / #9CA3AF', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-bar-block uses 45deg hatch (not 135deg)', () => {
    expect(s).toMatch(/\.cal-bar-block[\s\S]{0,300}45deg/);
  });

  test('.cal-bar-block does NOT use 135deg', () => {
    const blockSection = s.match(/\.cal-bar-block[\s\S]{0,600}/);
    if (blockSection) {
      expect(blockSection[0]).not.toMatch(/135deg/);
    }
  });

  test('.cal-bar-block uses rgba(156,163,175,…) — #9CA3AF', () => {
    expect(s).toMatch(/\.cal-bar-block[\s\S]{0,300}rgba\(156,\s*163,\s*175,/);
  });

  test('.cal-bar-block has !important on background', () => {
    expect(s).toMatch(/\.cal-bar-block[\s\S]{0,400}background:[\s\S]{0,300}!important/);
  });

  test('.cal-bar-block has a border using rgba(156,163,175,…)', () => {
    expect(s).toMatch(/\.cal-bar-block[\s\S]{0,500}border:[\s\S]{0,100}rgba\(156,\s*163,\s*175,/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — BoostPrice badge: effective #1F6B4C / pending #C9A15B', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-bp-badge.effective color: #1F6B4C !important', () => {
    expect(s).toMatch(/\.cal-bp-badge\.effective[\s\S]{0,100}color:\s*#1F6B4C\s*!important/);
  });

  test('.cal-bp-badge.pending color: #C9A15B !important', () => {
    expect(s).toMatch(/\.cal-bp-badge\.pending[\s\S]{0,100}color:\s*#C9A15B\s*!important/);
  });

  test('bh-calendar-ios-06.css does NOT set effective to --bh-vert', () => {
    const effSection = s.match(/\.cal-bp-badge\.effective[\s\S]{0,100}/);
    if (effSection) {
      expect(effSection[0]).not.toMatch(/--bh-vert/);
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Day chips: 44×58px / radius 13px', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-jour-chip width: 44px !important', () => {
    expect(s).toMatch(/\.cal-jour-chip[\s\S]{0,200}width:\s*44px\s*!important/);
  });

  test('.cal-jour-chip height: 58px !important', () => {
    expect(s).toMatch(/\.cal-jour-chip[\s\S]{0,200}height:\s*58px\s*!important/);
  });

  test('.cal-jour-chip border-radius: 13px !important', () => {
    expect(s).toMatch(/\.cal-jour-chip[\s\S]{0,200}border-radius:\s*13px\s*!important/);
  });

  test('.cal-jour-chip.selected background: var(--bh-vert,#0E3B2E)', () => {
    expect(s).toMatch(/\.cal-jour-chip\.selected[\s\S]{0,200}background:[\s\S]{0,100}0E3B2E/);
  });

  test('.cal-jour-chip.selected .cal-jc-num font-weight: 700', () => {
    expect(s).toMatch(/\.cal-jour-chip\.selected[\s\S]{0,300}cal-jc-num[\s\S]{0,100}font-weight:\s*700/);
  });

  test('.cal-jc-num font-size: 16px !important', () => {
    expect(s).toMatch(/\.cal-jc-num[\s\S]{0,200}font-size:\s*16px\s*!important/);
  });

  test('.cal-jc-letter font-size: 10px !important', () => {
    expect(s).toMatch(/\.cal-jc-letter[\s\S]{0,200}font-size:\s*10px\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Day view cards: glass + DM Sans', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-jour-card has glass background rgba(255,255,255,0.62)', () => {
    expect(s).toMatch(/\.cal-jour-card[\s\S]{0,300}rgba\(255,\s*255,\s*255,\s*0\.62\)/);
  });

  test('.cal-jour-card border-radius: 22px !important', () => {
    expect(s).toMatch(/\.cal-jour-card[\s\S]{0,300}border-radius:\s*22px\s*!important/);
  });

  test('.cal-jour-card-guest font-size: 17px !important', () => {
    expect(s).toMatch(/\.cal-jour-card-guest[\s\S]{0,200}font-size:\s*17px\s*!important/);
  });

  test('.cal-jour-card-guest font-weight: 600 !important', () => {
    expect(s).toMatch(/\.cal-jour-card-guest[\s\S]{0,200}font-weight:\s*600\s*!important/);
  });

  test('.cal-jour-card-guest font-family: DM Sans', () => {
    expect(s).toMatch(/\.cal-jour-card-guest[\s\S]{0,200}font-family:\s*'DM Sans'/);
  });

  test('.cal-jour-section-title font-size: 11.5px / uppercase', () => {
    expect(s).toMatch(/\.cal-jour-section-title[\s\S]{0,300}font-size:\s*11\.5px\s*!important/);
    expect(s).toMatch(/\.cal-jour-section-title[\s\S]{0,300}text-transform:\s*uppercase\s*!important/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Week view: property column + separators', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-sem-label-col width: var(--cal-property-width) !important', () => {
    expect(s).toMatch(/\.cal-sem-label-col[\s\S]{0,200}width:\s*var\(--cal-property-width\)\s*!important/);
  });

  test('.cal-sem-prop-label height: 64px token reference', () => {
    expect(s).toMatch(/\.cal-sem-prop-label[\s\S]{0,200}height:\s*var\(--bh-cal-ref-row-height,\s*64px\)/);
  });

  test('.cal-sem-row height: 64px token reference', () => {
    expect(s).toMatch(/\.cal-sem-row[\s\S]{0,200}height:\s*var\(--bh-cal-ref-row-height,\s*64px\)/);
  });

  test('.cal-sem-row border-bottom uses row separator token', () => {
    expect(s).toMatch(/\.cal-sem-row[\s\S]{0,300}border-bottom:[\s\S]{0,100}--bh-cal-ref-row-separator/);
  });

  test('.cal-sem-cell border-right uses col separator token', () => {
    expect(s).toMatch(/\.cal-sem-cell[\s\S]{0,200}border-right:[\s\S]{0,100}--bh-cal-ref-col-separator/);
  });

  test('.cal-sem-cell.weekend uses --bh-cal-ref-weekend token', () => {
    expect(s).toMatch(/\.cal-sem-cell\.weekend[\s\S]{0,200}background:\s*var\(--bh-cal-ref-weekend/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Week view bars: 44px / radius 11px', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-sem-bar height: 44px token reference', () => {
    expect(s).toMatch(/\.cal-sem-bar[\s\S]{0,200}height:\s*var\(--bh-cal-ref-bar-height,\s*44px\)/);
  });

  test('.cal-sem-bar border-radius: 11px token reference', () => {
    expect(s).toMatch(/\.cal-sem-bar[\s\S]{0,200}border-radius:\s*var\(--bh-cal-ref-bar-radius,\s*11px\)/);
  });

  test('.cal-sem-bar top is centered (calc expression using tokens)', () => {
    expect(s).toMatch(/\.cal-sem-bar[\s\S]{0,200}top:\s*calc\([\s\S]{0,100}--bh-cal-ref-row-height[\s\S]{0,100}--bh-cal-ref-bar-height/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Month timeline: rows 64px / bars 44px / radius 11px', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-tl-row height: 64px token reference', () => {
    expect(s).toMatch(/\.cal-tl-row[\s\S]{0,200}height:\s*var\(--bh-cal-ref-row-height,\s*64px\)/);
  });

  test('.cal-bar height: 44px token reference', () => {
    expect(s).toMatch(/\.cal-bar[\s\S]{0,200}height:\s*var\(--bh-cal-ref-bar-height,\s*44px\)/);
  });

  test('.cal-bar border-radius: 11px token reference', () => {
    expect(s).toMatch(/\.cal-bar[\s\S]{0,200}border-radius:\s*var\(--bh-cal-ref-bar-radius,\s*11px\)/);
  });

  test('.cal-prop-label height: 64px token reference', () => {
    expect(s).toMatch(/\.cal-prop-label[\s\S]{0,200}height:\s*var\(--bh-cal-ref-row-height,\s*64px\)/);
  });

  test('.cal-label-col width: var(--cal-property-width)', () => {
    expect(s).toMatch(/\.cal-label-col[\s\S]{0,200}width:\s*var\(--cal-property-width\)/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Revenus view: DM Sans / 34px hero', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-rev-kpi-value font-size: 34px !important', () => {
    expect(s).toMatch(/\.cal-rev-kpi-value[\s\S]{0,200}font-size:\s*34px\s*!important/);
  });

  test('.cal-rev-kpi-value font-weight: 600 !important', () => {
    expect(s).toMatch(/\.cal-rev-kpi-value[\s\S]{0,200}font-weight:\s*600\s*!important/);
  });

  test('.cal-rev-kpi-value letter-spacing: -1.19px !important', () => {
    expect(s).toMatch(/\.cal-rev-kpi-value[\s\S]{0,200}letter-spacing:\s*-1\.19px\s*!important/);
  });

  test('.cal-rev-kpi-value font-family: DM Sans !important', () => {
    expect(s).toMatch(/\.cal-rev-kpi-value[\s\S]{0,200}font-family:\s*'DM Sans'[\s\S]{0,100}!important/);
  });

  test('.cal-rev-header font-size: 30px !important', () => {
    expect(s).toMatch(/\.cal-rev-header[\s\S]{0,200}font-size:\s*30px\s*!important/);
  });

  test('.cal-rev-header font-family: DM Sans (not Instrument Serif)', () => {
    expect(s).toMatch(/\.cal-rev-header[\s\S]{0,200}font-family:\s*'DM Sans'/);
  });

  test('.cal-rev-kpi has glass background', () => {
    expect(s).toMatch(/\.cal-rev-kpi[\s\S]{0,200}rgba\(255,\s*255,\s*255,\s*0\.62\)/);
  });

  test('.cal-rev-kpi border-radius: 22px', () => {
    expect(s).toMatch(/\.cal-rev-kpi[\s\S]{0,200}border-radius:\s*22px/);
  });

  test('.cal-rev-kpi-label font-size: 11.5px uppercase', () => {
    expect(s).toMatch(/\.cal-rev-kpi-label[\s\S]{0,200}font-size:\s*11\.5px/);
    expect(s).toMatch(/\.cal-rev-kpi-label[\s\S]{0,200}text-transform:\s*uppercase/);
  });

  test('.cal-rev-td-money color: var(--bh-vert)', () => {
    expect(s).toMatch(/\.cal-rev-td-money[\s\S]{0,200}color:\s*var\(--bh-vert/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Week day header strip', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-sem-hdr-row has glass background', () => {
    expect(s).toMatch(/\.cal-sem-hdr-row[\s\S]{0,200}rgba\(255,\s*255,\s*255,\s*0\.28\)/);
  });

  test('.cal-sem-day-hdr .cal-day-hdr-letter font-size: 9px', () => {
    expect(s).toMatch(/\.cal-day-hdr-letter[\s\S]{0,200}font-size:\s*9px/);
  });

  test('.cal-sem-day-hdr.today color: #0E3B2E', () => {
    expect(s).toMatch(/\.cal-sem-day-hdr\.today[\s\S]{0,200}#0E3B2E/);
  });

  test('.cal-sem-day-hdr.today::after background: #0E3B2E', () => {
    expect(s).toMatch(/\.cal-sem-day-hdr\.today::after[\s\S]{0,100}background:\s*#0E3B2E/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Bottom nav clearance', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalRoot .bh-cal-body has padding-bottom for nav clearance', () => {
    expect(s).toMatch(/#bhCalRoot\s*\.bh-cal-body[\s\S]{0,200}padding-bottom:\s*calc\(/);
  });

  test('clearance includes 62px nav height', () => {
    expect(s).toMatch(/padding-bottom:\s*calc\([\s\S]{0,100}62px/);
  });

  test('mobile clearance uses env(safe-area-inset-bottom)', () => {
    expect(s).toMatch(/env\(safe-area-inset-bottom/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Responsive: mobile layout', () => {
  const s = css('bh-calendar-ios-06.css');

  test('@media (max-width: 767px) #bhCalRoot border-radius: 0', () => {
    expect(s).toMatch(/@media[\s\S]{0,50}max-width:\s*767px[\s\S]{0,200}#bhCalRoot[\s\S]{0,100}border-radius:\s*0/);
  });

  test('mobile #bhCalMonthTitle font-size: 24px', () => {
    expect(s).toMatch(/@media[\s\S]{0,50}max-width:\s*767px[\s\S]{0,300}#bhCalMonthTitle[\s\S]{0,100}font-size:\s*24px/);
  });

  test('@media (max-width: 430px) seg button font-size smaller', () => {
    expect(s).toMatch(/@media[\s\S]{0,50}max-width:\s*430px[\s\S]{0,300}font-size:\s*11px/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Global DM Sans suppression of Instrument Serif', () => {
  const s = css('bh-calendar-ios-06.css');

  test('#bhCalRoot font-family: DM Sans (root override)', () => {
    expect(s).toMatch(/#bhCalRoot[\s\S]{0,100}font-family:\s*'DM Sans'/);
  });

  test('.cal-rev-wrap font-family: DM Sans', () => {
    expect(s).toMatch(/\.cal-rev-wrap[\s\S]{0,100}font-family:\s*'DM Sans'/);
  });

  test('section 25 targets multiple selectors for DM Sans', () => {
    expect(s).toMatch(/25\. Typography/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Property dropdown: glass', () => {
  const s = css('bh-calendar-ios-06.css');

  test('.cal-prop-dropdown has glass background', () => {
    expect(s).toMatch(/\.cal-prop-dropdown[\s\S]{0,200}backdrop-filter:\s*blur/);
  });

  test('#bhCalPropDropdown has backdrop-filter', () => {
    expect(s).toMatch(/#bhCalPropDropdown[\s\S]{0,200}backdrop-filter:\s*blur/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — app.html: CSS link order', () => {
  const h = html('app.html');

  test('app.html links bh-calendar-v3.css', () => {
    expect(h).toMatch(/bh-calendar-v3\.css/);
  });

  test('app.html links bh-calendar-ios-06.css', () => {
    expect(h).toMatch(/bh-calendar-ios-06\.css/);
  });

  test('bh-calendar-ios-06.css comes AFTER bh-calendar-v3.css in app.html', () => {
    const v3Pos  = h.indexOf('bh-calendar-v3.css');
    const i06Pos = h.indexOf('bh-calendar-ios-06.css');
    expect(v3Pos).toBeGreaterThan(-1);
    expect(i06Pos).toBeGreaterThan(v3Pos);
  });

  test('bh-calendar-ios-06.css is before the closing </head>', () => {
    const i06Pos   = h.indexOf('bh-calendar-ios-06.css');
    const headClose = h.indexOf('</head>');
    expect(i06Pos).toBeLessThan(headClose);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — app.html: JS rowH 56→64', () => {
  const h = html('app.html');

  test('renderMonth rowH uses 64 in non-compact mode', () => {
    expect(h).toMatch(/var rowH\s*=\s*compactMode\s*\?\s*34\s*:\s*64/);
  });

  test('renderWeek row min-height:64px (was 56)', () => {
    const weekSection = h.match(/grid-template-columns:'\+propW\+'px repeat\(7,1fr\)[\s\S]{0,100}min-height:64px/);
    // Look for the week property row which now has min-height:64px
    expect(h).toMatch(/display:grid;grid-template-columns:'\+propW\+\'px repeat\(7,1fr\);border-bottom:1px solid #F5F2EC;min-height:64px/);
  });

  test('renderWeek cell min-height:64px (was 56)', () => {
    expect(h).toMatch(/border-right:1px solid #F5F2EC;position:relative;min-height:64px;/);
  });

  test('app.html does NOT have rowH = 56 anymore', () => {
    // Ensure old value is gone
    expect(h).not.toMatch(/var rowH\s*=\s*compactMode\s*\?\s*34\s*:\s*56/);
  });

  test('app.html does NOT have min-height:56px in week property row', () => {
    // The specific old pattern should not exist
    expect(h).not.toMatch(/display:grid;grid-template-columns:'\+propW\+\'px repeat\(7,1fr\);border-bottom:1px solid #F5F2EC;min-height:56px/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Platform colors canonical (no changes, verify unmodified)', () => {
  const h = html('app.html');

  test('Airbnb color #FF5A5F present in app.html', () => {
    expect(h).toMatch(/#FF5A5F/i);
  });

  test('Booking.com color #003580 present in app.html', () => {
    expect(h).toMatch(/#003580/i);
  });

  test('Direct/BHGuest color #0E3B2E present in app.html', () => {
    expect(h).toMatch(/#0E3B2E/i);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
describe('CALENDAR_06 — Protected files unchanged', () => {
  test('chat-owner.js SHA-1 unchanged', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'js', 'chat-owner.js'));
    const raw = crypto.createHash('sha1').update(buf).digest('hex');
    expect(raw).toBe('2a9717b64e4f7059a164175177f976025ff47142');
  });

  test('bh-calendar-v3.js size > 1 KB', () => {
    const p = path.join(ROOT, 'public', 'js', 'bh-calendar-v3.js');
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('calendar-modern.js size > 1 KB', () => {
    const p = path.join(ROOT, 'public', 'js', 'calendar-modern.js');
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-calendar-v3.css not modified — 135deg block hatch still present (suppressed by 06)', () => {
    expect(css('bh-calendar-v3.css')).toMatch(/135deg/);
  });

  test('bh-calendar-v3.css not modified — --cal-row-h:56px still present (overridden by 06)', () => {
    expect(css('bh-calendar-v3.css')).toMatch(/--cal-row-h:\s*56px/);
  });

  test('server.js exists (no backend change)', () => {
    expect(fs.existsSync(path.join(ROOT, 'server.js'))).toBe(true);
  });
});
