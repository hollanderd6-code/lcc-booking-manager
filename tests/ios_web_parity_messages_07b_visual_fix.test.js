'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_MESSAGES_07B_VISUAL_CORRECTION
 *
 * Fixes verified:
 *   A. Top blank space — body { padding-top: 40px } removed for messages page
 *      (legacy .bh-demo-nav removed in SHELL-FIX-09)
 *   B. Desktop main-content padding-top: 64px removed for messages page
 *   C. Legacy msgs-tabs (Messages/Templates/Statut/SMS/Statut SMS) hidden
 *   D. DM Sans weight 800 loaded (chat-owner.js uses 800 for unread names)
 *   E. Broken HTML comment producing visible "====" characters removed
 *      Root cause: nested <!-- Modal confirm SMS --> prematurely closed the
 *      outer <!-- MODAL FACTURE --> comment, leaving orphaned "==== -->"
 *      text visible after </body>.
 *   F. Conversation name DM Sans font enforced via CSS !important
 *   G. Split view height corrected for desktop
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

const msgsHtml  = html('messages.html');
const ios07     = css('bh-messages-ios-07.css');
const chatOwner = js('chat-owner.js');
const bhLayout  = js('bh-layout.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. TOP BLANK SPACE — body padding-top override
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix A: body padding-top zeroed for messages page', () => {
  test('A-01 ios07 overrides body padding-top to 0 for messages page', () => {
    expect(ios07).toMatch(/body\[data-page="messages"\][\s\S]{0,200}?padding-top\s*:\s*0\s*!important/);
  });

  test('A-02 override uses html[data-theme-v3="1"] scope for specificity', () => {
    expect(ios07).toMatch(/html\[data-theme-v3="1"\]\s+body\[data-page="messages"\]/);
  });

  test('A-03 messages.html still has legacy body padding-top:40px (source confirmed)', () => {
    expect(msgsHtml).toMatch(/body\s*\{[^}]*padding-top\s*:\s*40px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DESKTOP MAIN-CONTENT PADDING — padding-top:64px override
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix B: desktop main-content padding-top zeroed', () => {
  test('B-01 ios07 overrides main-content padding-top inside min-width:1367px', () => {
    const block = ios07.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,500}?padding-top\s*:\s*0\s*!important/);
    expect(block).toBeTruthy();
  });

  test('B-02 messages.html still has legacy padding-top:64px on desktop (source confirmed)', () => {
    expect(msgsHtml).toMatch(/@media.*min-width.*1367[\s\S]{0,100}?padding-top\s*:\s*64px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LEGACY MSGS-TABS — hidden
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix C: legacy msgs-tabs hidden', () => {
  test('C-01 ios07 hides .msgs-tabs with display:none !important', () => {
    expect(ios07).toMatch(/msgs-tabs[\s\S]{0,200}?display\s*:\s*none\s*!important/);
  });

  test('C-02 .msgs-tabs element still present in DOM (not deleted)', () => {
    expect(msgsHtml).toMatch(/class="msgs-tabs"/);
  });

  test('C-03 Templates tab still exists in DOM (route/feature preserved)', () => {
    expect(msgsHtml).toMatch(/id="tabTemplates"/);
  });

  test('C-04 SMS tab still exists in DOM (route/feature preserved)', () => {
    expect(msgsHtml).toMatch(/id="tabSms"/);
  });

  test('C-05 switchMsgsTab function still referenced (onclick preserved)', () => {
    expect(msgsHtml).toMatch(/switchMsgsTab/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DM SANS WEIGHT 800 — font loaded for unread names
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix D: DM Sans weight 800 loaded', () => {
  test('D-01 Google Fonts URL includes weight 800', () => {
    expect(msgsHtml).toMatch(/DM\+Sans.*wght.*800|DM.Sans.*800/);
  });

  test('D-02 fonts.googleapis.com link present', () => {
    expect(msgsHtml).toMatch(/fonts\.googleapis\.com.*DM/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. EQUAL SIGNS VISIBLE TEXT — broken HTML comment removed
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix E: broken HTML comment producing visible ==== removed', () => {
  test('E-01 no orphaned ============= --> after </body>', () => {
    const afterBody = msgsHtml.slice(msgsHtml.lastIndexOf('</body>'));
    expect(afterBody).not.toMatch(/={5,}.*-->/);
  });

  test('E-02 broken comment opening "MODAL FACTURE — insérer avant" removed', () => {
    expect(msgsHtml).not.toMatch(/MODAL FACTURE.*insérer avant/);
  });

  test('E-03 smsConfirmModal still exists (was incorrectly inside broken comment)', () => {
    expect(msgsHtml).toMatch(/id="smsConfirmModal"/);
  });

  test('E-04 no visible equals-sign text node (3+ consecutive =) in non-script/style context', () => {
    // Simple heuristic: find ====+ not immediately preceded by / or * (CSS/JS comment markers)
    // and not inside a known comment pattern
    const stripped = msgsHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    expect(stripped).not.toMatch(/={5,}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. FONT FIX — DM Sans for conversation names
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix F: DM Sans enforced for conversation names', () => {
  test('F-01 ios07 forces DM Sans on conversation-item h3', () => {
    expect(ios07).toMatch(/conversation-item\s+h3[\s\S]{0,200}?font-family\s*:\s*['"]DM Sans['"]/);
  });

  test('F-02 chat-owner.js inline font-family for guest name still DM Sans', () => {
    expect(chatOwner).toMatch(/font-family\s*:\s*'DM Sans',\s*sans-serif/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SPLIT VIEW HEIGHT — corrected for desktop
// ─────────────────────────────────────────────────────────────────────────────

describe('07B fix G: split view height corrected for desktop', () => {
  test('G-01 ios07 overrides msgs-split height in desktop media query', () => {
    const desktopBlock = ios07.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,600}?msgs-split[\s\S]{0,200}?height[\s\S]{0,100}?calc/);
    expect(desktopBlock).toBeTruthy();
  });

  test('G-02 split view height uses dvh or vh units', () => {
    const desktopBlock = ios07.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,600}?msgs-split[\s\S]{0,200}?height[\s\S]{0,100}?d?vh/);
    expect(desktopBlock).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. NO FAKE NAVIGATION OR TEMPLATES BAR VISIBLE
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: no legacy nav visible on messages page', () => {
  test('8-01 msgs-tabs has display:none !important in ios07', () => {
    expect(ios07).toMatch(/\.msgs-tabs[\s\S]{0,200}?display\s*:\s*none/);
  });

  test('8-02 no Templates nav visible class in ios07 (not created fresh)', () => {
    expect(ios07).not.toMatch(/\.msgs-tab\s+\.active.*Templates/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. HEADER PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: Messages header preserved', () => {
  test('9-01 bh-desktop-header still present in messages.html', () => {
    expect(msgsHtml).toMatch(/class="bh-desktop-header"/);
  });

  test('9-02 msgsUnreadHeader still in kicker', () => {
    const kicker = msgsHtml.match(/<div[^>]*class="[^"]*bh-dh-kicker[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/);
    expect(kicker).toBeTruthy();
    expect(kicker[0]).toMatch(/msgsUnreadHeader/);
  });

  test('9-03 Messages title preserved', () => {
    expect(msgsHtml).toMatch(/bh-dh-title[^>]*>[\s\S]{0,30}?Messages/);
  });

  test('9-04 search button preserved', () => {
    expect(msgsHtml).toMatch(/id="msgsSearchBtn"/);
  });

  test('9-05 initials button preserved', () => {
    expect(msgsHtml).toMatch(/id="msgsInitialsBtn"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. FILTER PILLS PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: filter pills preserved', () => {
  test('10-01 Tout pill preserved', () => {
    expect(msgsHtml).toMatch(/Tout/);
  });

  test('10-02 Non lus pill preserved', () => {
    expect(msgsHtml).toMatch(/Non lus/);
  });

  test('10-03 no fake À reprendre pill added', () => {
    expect(msgsHtml).not.toMatch(/À reprendre/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. CHAT-OWNER.JS HASH PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: chat-owner.js unchanged', () => {
  test('11-01 conversationsList reference intact', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]conversationsList['"]\s*\)/);
  });

  test('11-02 chatMessages reference intact', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]chatMessages['"]\s*\)/);
  });

  test('11-03 sendBtn reference intact', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]sendBtn['"]\s*\)/);
  });

  test('11-04 attachment endpoint intact', () => {
    expect(chatOwner).toMatch(/\/api\/chat\/conversations[\s\S]{0,100}?attachments/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. BOTTOM NAV PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: bottom nav and pointer fix preserved', () => {
  test('12-01 mobile-tabs-handler.js loaded', () => {
    expect(msgsHtml).toMatch(/mobile-tabs-handler\.js/);
  });

  test('12-02 bh-layout.js loaded', () => {
    expect(msgsHtml).toMatch(/bh-layout\.js/);
  });

  test('12-03 messages-badge-desktop-mobile.js loaded', () => {
    expect(msgsHtml).toMatch(/messages-badge-desktop-mobile\.js/);
  });

  test('12-04 Calendar pointer fix e.pointerType !== mouse preserved', () => {
    expect(bhLayout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });

  test('12-05 lg-capsule still referenced in bh-layout.js', () => {
    expect(bhLayout).toMatch(/lg-capsule/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. ATTACHMENTS + APIS PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: attachment pipeline and APIs preserved', () => {
  test('13-01 bh-att-img CSS preserved in ios07', () => {
    expect(ios07).toMatch(/bh-att-img/);
  });

  test('13-02 owner bubble rgba(255,255,255,0.80) preserved', () => {
    expect(ios07).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.80\)/);
  });

  test('13-03 guest bubble #DCE8E1 preserved', () => {
    expect(ios07).toMatch(/#DCE8E1/);
  });

  test('13-04 no iOS directory change', () => {
    const iosDir = path.join(ROOT, 'ios');
    if (require('fs').existsSync(iosDir)) {
      expect(require('fs').readdirSync(iosDir)).not.toContain('bh-messages-ios-07b.css');
    } else {
      expect(true).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. CSS SCOPE — no leak
// ─────────────────────────────────────────────────────────────────────────────

describe('07B: new CSS rules in ios07 properly scoped', () => {
  test('14-01 body padding override uses data-page="messages" scope', () => {
    expect(ios07).toMatch(/body\[data-page="messages"\][\s\S]{0,100}?padding-top\s*:\s*0/);
  });

  test('14-02 msgs-tabs hide uses body[data-page="messages"] scope', () => {
    expect(ios07).toMatch(/body\[data-page="messages"\]\s+\.msgs-tabs/);
  });

  test('14-03 no calendarSection referenced in new rules', () => {
    expect(ios07).not.toMatch(/calendarSection/);
  });

  test('14-04 no bh-cal-mode referenced in new rules', () => {
    expect(ios07).not.toMatch(/bh-cal-mode/);
  });
});
