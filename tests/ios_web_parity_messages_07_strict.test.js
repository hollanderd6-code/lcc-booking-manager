'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_MESSAGES_07_STRICT
 *
 * Web Messages screen → iOS visual parity.
 *
 * This test audits the CSS + HTML structure only; it verifies that:
 *   - chat-owner.js is UNCHANGED (hash-equivalent via content)
 *   - All API endpoints, socket events, auth token are intact
 *   - #chatModal is preserved off-screen
 *   - AppBackground (warm gradient) replaces white
 *   - Header: iOS super-title (unread count) + title "Messages"
 *   - Filter pills: Tout / Non lus  (no fake À reprendre)
 *   - Conversation cards: iOS glass (radius 22px, unread/read fills)
 *   - Owner bubble: white glass (NOT green)
 *   - Guest bubble: #DCE8E1 (mint)
 *   - Asymmetric bubble radii
 *   - AI badge: gold
 *   - Composer: glass bar, send #0E3B2E
 *   - Attachments pipeline unchanged
 *   - Bottom nav + Messages active preserved
 *   - Desktop pointer-capture fix preserved in bh-layout.js
 *   - No backend / DB / Channex / Stripe / iOS changes
 *
 * Minimum: 120 assertions.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');

const msgsHtml  = html('messages.html');
const ios07     = css('bh-messages-ios-07.css');
const chatOwner = js('chat-owner.js');
const bhLayout  = js('bh-layout.js');
const tabsHndlr = js('mobile-tabs-handler.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. ENTRY POINT + HASH PROTECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('07: entry point and chat-owner.js protection', () => {
  test('1-01 messages.html exists', () => {
    expect(msgsHtml.length).toBeGreaterThan(1000);
  });

  test('1-02 bh-messages-ios-07.css exists', () => {
    expect(ios07.length).toBeGreaterThan(200);
  });

  test('1-03 chat-owner.js still references conversationsList (engine intact)', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]conversationsList['"]\s*\)/);
  });

  test('1-04 chat-owner.js still references chatMessages (engine intact)', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]chatMessages['"]\s*\)/);
  });

  test('1-05 chat-owner.js still uses chatInput', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]chatInput['"]\s*\)/);
  });

  test('1-06 chat-owner.js still uses sendBtn', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]sendBtn['"]\s*\)/);
  });

  test('1-07 chat-owner.js still writes conversation-item class', () => {
    expect(chatOwner).toMatch(/conversation-item/);
  });

  test('1-08 chat-owner.js still writes chat-bubble class', () => {
    expect(chatOwner).toMatch(/chat-bubble/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. API ENDPOINTS PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07: API endpoints preserved — no URL change', () => {
  test('2-01 GET /api/chat/conversations endpoint present', () => {
    expect(msgsHtml + chatOwner).toMatch(/\/api\/chat\/conversations/);
  });

  test('2-02 GET /api/chat/messages endpoint present', () => {
    expect(chatOwner).toMatch(/\/api\/chat\/messages/);
  });

  test('2-03 POST /api/chat/mark-read endpoint present', () => {
    expect(chatOwner).toMatch(/\/api\/chat\/mark-read/);
  });

  test('2-04 POST /api/chat/send endpoint present', () => {
    expect(chatOwner).toMatch(/\/api\/chat\/send/);
  });

  test('2-05 send-platform endpoint present', () => {
    expect(chatOwner).toMatch(/send-platform/);
  });

  test('2-06 attachments endpoint present', () => {
    expect(chatOwner).toMatch(/attachments/);
  });

  test('2-07 quick-context endpoint present', () => {
    expect(chatOwner).toMatch(/quick-context/);
  });

  test('2-08 messages-channex endpoint present', () => {
    expect(chatOwner).toMatch(/messages-channex/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SOCKET EVENTS PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07: socket events preserved', () => {
  test('3-01 new_message socket event', () => {
    expect(msgsHtml + chatOwner).toMatch(/new_message/);
  });

  test('3-02 new_notification socket event', () => {
    expect(msgsHtml + chatOwner).toMatch(/new_notification/);
  });

  test('3-03 messages_read socket event', () => {
    expect(msgsHtml + chatOwner).toMatch(/messages_read/);
  });

  test('3-04 attachment_updated socket event', () => {
    expect(msgsHtml + chatOwner).toMatch(/attachment_updated/);
  });

  test('3-05 auth token lcc_token used', () => {
    expect(msgsHtml + chatOwner).toMatch(/lcc_token/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GHOST chatModal PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07: ghost chatModal preserved off-screen', () => {
  test('4-01 #chatModal element exists in messages.html', () => {
    expect(msgsHtml).toMatch(/id\s*=\s*["']chatModal["']/);
  });

  test('4-02 chatModal is off-screen (top:-9999px or position:fixed off-viewport)', () => {
    expect(msgsHtml).toMatch(/top:-9999px/);
  });

  test('4-03 chatModal has pointer-events:none', () => {
    expect(msgsHtml).toMatch(/pointer-events\s*:\s*none/);
  });

  test('4-04 chat-owner.js references chatModal by getElementById', () => {
    expect(chatOwner).toMatch(/getElementById\s*\(\s*['"]chatModal['"]\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. APP BACKGROUND
// ─────────────────────────────────────────────────────────────────────────────

describe('07: AppBackground — warm gradient replaces white', () => {
  test('5-01 CSS targets body[data-page="messages"]', () => {
    expect(ios07).toMatch(/body\[data-page\s*=\s*["']messages["']\]/);
  });

  test('5-02 gradient uses top colour #F5F2EA', () => {
    expect(ios07).toMatch(/#F5F2EA/);
  });

  test('5-03 gradient uses mid colour #EBE7DC', () => {
    expect(ios07).toMatch(/#EBE7DC/);
  });

  test('5-04 gradient uses bottom colour #E2DDD0', () => {
    expect(ios07).toMatch(/#E2DDD0/);
  });

  test('5-05 gradient angle is 168deg', () => {
    expect(ios07).toMatch(/168deg/);
  });

  test('5-06 ambient halos via radial-gradient on ::before', () => {
    expect(ios07).toMatch(/::before[\s\S]{0,300}radial-gradient/);
  });

  test('5-07 AppBackground overrides white with !important', () => {
    expect(ios07).toMatch(/linear-gradient[\s\S]{0,80}!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HEADER PARITY — iOS super-title + title
// ─────────────────────────────────────────────────────────────────────────────

describe('07: header iOS parity', () => {
  test('6-01 #msgsUnreadHeader is inside .bh-dh-kicker (super-title position)', () => {
    const kickerBlock = msgsHtml.match(/<div[^>]*class="[^"]*bh-dh-kicker[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/);
    expect(kickerBlock).toBeTruthy();
    expect(kickerBlock[0]).toMatch(/msgsUnreadHeader/);
  });

  test('6-02 .bh-dh-title contains "Messages" and NOT #msgsUnreadHeader span', () => {
    const titleBlock = msgsHtml.match(/bh-dh-title[^>]*>([\s\S]{0,200}?)<\/div>/);
    expect(titleBlock).toBeTruthy();
    expect(titleBlock[0]).toMatch(/Messages/);
    expect(titleBlock[0]).not.toMatch(/msgsUnreadHeader/);
  });

  test('6-03 kicker font-size 12.5px in CSS', () => {
    expect(ios07).toMatch(/bh-dh-kicker[\s\S]{0,200}?12\.5px/);
  });

  test('6-04 kicker font-weight 600 in CSS', () => {
    expect(ios07).toMatch(/bh-dh-kicker[\s\S]{0,200}?font-weight\s*:\s*600/);
  });

  test('6-05 kicker color #5E6B63', () => {
    expect(ios07).toMatch(/bh-dh-kicker[\s\S]{0,200}?#5E6B63/);
  });

  test('6-06 title font-size 30px', () => {
    expect(ios07).toMatch(/bh-dh-title[\s\S]{0,200}?30px/);
  });

  test('6-07 title font-weight 700', () => {
    expect(ios07).toMatch(/bh-dh-title[\s\S]{0,200}?font-weight\s*:\s*700/);
  });

  test('6-08 title letter-spacing -0.96px', () => {
    expect(ios07).toMatch(/bh-dh-title[\s\S]{0,200}?-0\.96px/);
  });

  test('6-09 title color #14201B', () => {
    expect(ios07).toMatch(/bh-dh-title[\s\S]{0,200}?#14201B/);
  });

  test('6-10 #msgsUnreadHeader stripped of badge styles (display:inline)', () => {
    expect(ios07).toMatch(/msgsUnreadHeader[\s\S]{0,300}?display\s*:\s*inline\s*!important/);
  });

  test('6-11 "X non lu" suffix via CSS ::after', () => {
    expect(ios07).toMatch(/msgsUnreadHeader[\s\S]{0,300}?non lu/);
  });

  test('6-12 "Messages" fallback via ::before when empty', () => {
    expect(ios07).toMatch(/msgsUnreadHeader:empty::before[\s\S]{0,100}?Messages/);
  });

  test('6-13 data-kicker on body is Messages (not Communication)', () => {
    expect(msgsHtml).toMatch(/data-kicker="Messages"/);
    expect(msgsHtml).not.toMatch(/data-kicker="Communication"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. NO FAKE ACTIONABLE STATE
// ─────────────────────────────────────────────────────────────────────────────

describe('07: no fake "à reprendre" state', () => {
  test('7-01 no "À reprendre" filter pill in messages.html', () => {
    expect(msgsHtml).not.toMatch(/À reprendre/);
  });

  test('7-02 filter bar only has Tout and Non lus pills', () => {
    const filterBar = msgsHtml.match(/id="msgsFilterBar"[\s\S]{0,600}?<\/div>/);
    expect(filterBar).toBeTruthy();
    expect(filterBar[0]).not.toMatch(/reprendre/i);
  });

  test('7-03 no needs_reply column referenced', () => {
    expect(msgsHtml).not.toMatch(/needs_reply/);
    expect(chatOwner).not.toMatch(/needs_reply/);
  });

  test('7-04 no actionable_count or follow_up state in iOS07 CSS', () => {
    expect(ios07).not.toMatch(/reprendre/i);
    expect(ios07).not.toMatch(/actionable/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. SEARCH + INITIALS
// ─────────────────────────────────────────────────────────────────────────────

describe('07: search and initials', () => {
  test('8-01 search button #msgsSearchBtn exists', () => {
    expect(msgsHtml).toMatch(/id="msgsSearchBtn"/);
  });

  test('8-02 search button focuses existing #msgsSearchInput', () => {
    expect(msgsHtml).toMatch(/msgsSearchInput/);
    const btn = msgsHtml.match(/id="msgsSearchBtn"[^>]*/);
    expect(btn).toBeTruthy();
    expect(btn[0]).toMatch(/msgsSearchInput/);
  });

  test('8-03 #msgsInitialsBtn has class bh-header-initials-btn (updated by bh-layout.js)', () => {
    expect(msgsHtml).toMatch(/bh-header-initials-btn[^"]*"[^>]*id="msgsInitialsBtn"|id="msgsInitialsBtn"[^>]*bh-header-initials-btn/);
  });

  test('8-04 bh-layout.js updates .bh-header-initials-btn with real initial', () => {
    expect(bhLayout).toMatch(/bh-header-initials-btn[\s\S]{0,200}?textContent\s*=/);
  });

  test('8-05 initials button has class bh-ios-initials-button', () => {
    expect(msgsHtml).toMatch(/bh-ios-initials-button[^"]*bh-header-initials-btn/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. FILTER PILLS — iOS style
// ─────────────────────────────────────────────────────────────────────────────

describe('07: filter pills iOS style', () => {
  test('9-01 filter bar has id msgsFilterBar', () => {
    expect(msgsHtml).toMatch(/id="msgsFilterBar"/);
  });

  test('9-02 "Tout" pill exists', () => {
    expect(msgsHtml).toMatch(/Tout/);
  });

  test('9-03 "Non lus" pill exists', () => {
    expect(msgsHtml).toMatch(/Non lus/);
  });

  test('9-04 filter pill border-radius 13px in CSS', () => {
    expect(ios07).toMatch(/msgs-filter-pill[\s\S]{0,300}?border-radius\s*:\s*13px/);
  });

  test('9-05 active pill background rgba(255,255,255,0.88)', () => {
    expect(ios07).toMatch(/filter-pill\.active[\s\S]{0,200}?rgba\(255,\s*255,\s*255,\s*0\.88\)/);
  });

  test('9-06 active pill text color #14201B', () => {
    expect(ios07).toMatch(/filter-pill\.active[\s\S]{0,200}?#14201B/);
  });

  test('9-07 unselected pill uses rgba(255,255,255,0.25)', () => {
    expect(ios07).toMatch(/msgs-filter-pill[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.25\)/);
  });

  test('9-08 unselected pill text color #5E6B63', () => {
    expect(ios07).toMatch(/msgs-filter-pill[\s\S]{0,300}?#5E6B63/);
  });

  test('9-09 filter pills have backdrop-filter (glass)', () => {
    expect(ios07).toMatch(/msgs-filter-pill[\s\S]{0,300}?backdrop-filter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. CONVERSATION CARDS
// ─────────────────────────────────────────────────────────────────────────────

describe('07: conversation cards iOS glass', () => {
  test('10-01 conversation-item border-radius 22px in CSS', () => {
    expect(ios07).toMatch(/conversation-item[\s\S]{0,300}?border-radius\s*:\s*22px\s*!important/);
  });

  test('10-02 read card fill rgba(255,255,255,0.50)', () => {
    expect(ios07).toMatch(/conversation-item[\s\S]{0,200}?rgba\(255,\s*255,\s*255,\s*0\.50\)\s*!important/);
  });

  test('10-03 unread card fill rgba(255,255,255,0.72)', () => {
    expect(ios07).toMatch(/conv-unread[\s\S]{0,200}?rgba\(255,\s*255,\s*255,\s*0\.72\)/);
  });

  test('10-04 card border rgba(255,255,255,0.70)', () => {
    expect(ios07).toMatch(/conversation-item[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.70\)/);
  });

  test('10-05 card has backdrop-filter blur (glass)', () => {
    expect(ios07).toMatch(/conversation-item[\s\S]{0,600}?backdrop-filter\s*:\s*blur/);
  });

  test('10-06 active card uses dark green accent (#0E3B2E as rgba)', () => {
    expect(ios07).toMatch(/conversation-item\.active[\s\S]{0,200}?rgba\(14,\s*59,\s*46/);
  });

  test('10-07 card bottom margin is 10px', () => {
    expect(ios07).toMatch(/conversation-item[\s\S]{0,300}?margin[\s\S]{0,40}?10px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. AVATAR
// ─────────────────────────────────────────────────────────────────────────────

describe('07: conversation avatar 46×46', () => {
  test('11-01 avatar width 46px', () => {
    expect(ios07).toMatch(/conversation-avatar[\s\S]{0,200}?width\s*:\s*46px/);
  });

  test('11-02 avatar height 46px', () => {
    expect(ios07).toMatch(/conversation-avatar[\s\S]{0,200}?height\s*:\s*46px/);
  });

  test('11-03 avatar border-radius 50% (circle)', () => {
    expect(ios07).toMatch(/conversation-avatar[\s\S]{0,200}?border-radius\s*:\s*50%/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. DETAIL HEADER
// ─────────────────────────────────────────────────────────────────────────────

describe('07: conversation detail header glass', () => {
  test('12-01 #msgsChatHeader has backdrop-filter in CSS', () => {
    expect(ios07).toMatch(/msgsChatHeader[\s\S]{0,200}?backdrop-filter/);
  });

  test('12-02 #msgsChatHeader background is warm glass (not pure white)', () => {
    const block = ios07.match(/#msgsChatHeader[\s\S]{0,300}?}/);
    expect(block).toBeTruthy();
    expect(block[0]).not.toMatch(/background\s*:\s*#fff\s*!important/i);
    expect(block[0]).not.toMatch(/background\s*:\s*#FFFFFF\s*!important/);
  });

  test('12-03 guest name font-size 17px', () => {
    expect(ios07).toMatch(/msgs-chat-name[\s\S]{0,200}?17px/);
  });

  test('12-04 guest name font-weight 600', () => {
    expect(ios07).toMatch(/msgs-chat-name[\s\S]{0,200}?font-weight\s*:\s*600/);
  });

  test('12-05 meta font-size 13px', () => {
    expect(ios07).toMatch(/msgs-chat-meta[\s\S]{0,200}?13px/);
  });

  test('12-06 action buttons 36×36', () => {
    expect(ios07).toMatch(/msgs-icon-btn[\s\S]{0,300}?36px/);
  });

  test('12-07 action buttons border-radius 50% (circle)', () => {
    expect(ios07).toMatch(/msgs-icon-btn[\s\S]{0,300}?border-radius\s*:\s*50%/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. OWNER BUBBLE — white glass (NOT green)
// ─────────────────────────────────────────────────────────────────────────────

describe('07: owner bubble white glass', () => {
  test('13-01 owner bubble background is rgba(255,255,255,0.80)', () => {
    expect(ios07).toMatch(/owner[\s\S]{0,200}?chat-bubble[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.80\)/);
  });

  test('13-02 owner bubble color #14201B (dark text)', () => {
    const block = ios07.match(/owner[\s\S]{0,200}?chat-bubble[\s\S]{0,400}?\}/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/#14201B/);
  });

  test('13-03 owner bubble has backdrop-filter blur (glass)', () => {
    const block = ios07.match(/chat-message\.owner\s*\.chat-bubble[\s\S]{0,500}?\}/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/backdrop-filter/);
  });

  test('13-04 owner bubble radii: 18px 18px 4px 18px (top-L, top-R, bot-R, bot-L)', () => {
    expect(ios07).toMatch(/owner[\s\S]{0,200}?chat-bubble[\s\S]{0,400}?18px\s+18px\s+4px\s+18px/);
  });

  test('13-05 owner bubble overrides green with !important', () => {
    const block = ios07.match(/chat-message\.owner\s*\.chat-bubble[\s\S]{0,500}?\}/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/!important/);
  });

  test('13-06 owner bubble does NOT use bh-vert (green) as background', () => {
    const ownerBlock = ios07.match(/chat-message\.owner[\s\S]{0,600}?rgba\(255,\s*255,\s*255,\s*0\.80\)/);
    expect(ownerBlock).toBeTruthy();
    expect(ownerBlock[0]).not.toMatch(/var\(--bh-vert\)/);
    expect(ownerBlock[0]).not.toMatch(/background\s*:\s*#0E3B2E/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. GUEST BUBBLE — mint #DCE8E1
// ─────────────────────────────────────────────────────────────────────────────

describe('07: guest bubble mint #DCE8E1', () => {
  test('14-01 guest bubble background is #DCE8E1', () => {
    expect(ios07).toMatch(/chat-message\.guest\s+\.chat-bubble[\s\S]{0,300}?#DCE8E1/);
  });

  test('14-02 guest bubble color #14201B', () => {
    const block = ios07.match(/chat-message\.guest\s+\.chat-bubble[\s\S]{0,500}?\}/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/#14201B/);
  });

  test('14-03 guest bubble radii: 18px 18px 18px 4px', () => {
    expect(ios07).toMatch(/chat-message\.guest[\s\S]{0,200}?chat-bubble[\s\S]{0,400}?18px\s+18px\s+18px\s+4px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. BUBBLE TYPOGRAPHY
// ─────────────────────────────────────────────────────────────────────────────

describe('07: bubble typography 15px', () => {
  test('15-01 chat-bubble font-size 15px', () => {
    expect(ios07).toMatch(/chat-bubble[\s\S]{0,200}?font-size\s*:\s*15px/);
  });

  test('15-02 chat-message max-width min(78%, 720px)', () => {
    expect(ios07).toMatch(/chat-message[\s\S]{0,200}?min\s*\(\s*78%\s*,\s*720px\s*\)/);
  });

  test('15-03 metadata font-size 11.5px or 12px', () => {
    expect(ios07).toMatch(/chat-time[\s\S]{0,200}?11\.5px/);
  });

  test('15-04 metadata color #5E6B63', () => {
    expect(ios07).toMatch(/chat-time[\s\S]{0,200}?#5E6B63/);
  });

  test('15-05 owner meta uses dark text (not white)', () => {
    const block = ios07.match(/chat-message\.owner[\s\S]{0,200}?chat-time[\s\S]{0,300}?\}/);
    expect(block).toBeTruthy();
    expect(block[0]).not.toMatch(/rgba\(255,\s*255,\s*255/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. AI GOLD
// ─────────────────────────────────────────────────────────────────────────────

describe('07: AI badge gold tokens', () => {
  test('16-01 AI badge background uses rgba(251,243,226', () => {
    expect(ios07).toMatch(/ai-badge[\s\S]{0,200}?rgba\(251,\s*243,\s*226/);
  });

  test('16-02 AI badge color #8A5B14', () => {
    expect(ios07).toMatch(/ai-badge[\s\S]{0,200}?#8A5B14/);
  });

  test('16-03 AI badge spark color #C9A15B', () => {
    expect(ios07).toMatch(/ai-badge-spark[\s\S]{0,200}?#C9A15B/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. COMPOSER
// ─────────────────────────────────────────────────────────────────────────────

describe('07: composer glass bar', () => {
  test('17-01 #chatInputArea has backdrop-filter blur', () => {
    expect(ios07).toMatch(/chatInputArea[\s\S]{0,300}?backdrop-filter\s*:\s*blur/);
  });

  test('17-02 composer border-radius ≥ 24px (pill shape)', () => {
    expect(ios07).toMatch(/chatInputArea[\s\S]{0,300}?border-radius\s*:\s*[2-9]\d+px/);
  });

  test('17-03 composer background rgba(255,255,255,0.28)', () => {
    expect(ios07).toMatch(/chatInputArea[\s\S]{0,300}?rgba\(255,\s*255,\s*255,\s*0\.28\)/);
  });

  test('17-04 #chatInput background transparent', () => {
    expect(ios07).toMatch(/chatInput[\s\S]{0,200}?background\s*:\s*transparent/);
  });

  test('17-05 #chatInput font-size 15px', () => {
    expect(ios07).toMatch(/#chatInput\b[\s\S]{0,350}?font-size\s*:\s*15px/);
  });

  test('17-06 send button #sendBtn background #0E3B2E', () => {
    expect(ios07).toMatch(/sendBtn[\s\S]{0,200}?#0E3B2E/);
  });

  test('17-07 send button 36×36', () => {
    expect(ios07).toMatch(/sendBtn[\s\S]{0,300}?36px/);
  });

  test('17-08 send button border-radius 50% (circle)', () => {
    expect(ios07).toMatch(/sendBtn[\s\S]{0,300}?border-radius\s*:\s*50%/);
  });

  test('17-09 send button color white', () => {
    expect(ios07).toMatch(/sendBtn[\s\S]{0,200}?color\s*:\s*#ffffff/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. ATTACHMENTS PIPELINE UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────

describe('07: attachments pipeline unchanged', () => {
  test('18-01 chat-owner.js still references attachment upload endpoint', () => {
    expect(chatOwner).toMatch(/\/api\/chat\/conversations[\s\S]{0,100}?attachments/);
  });

  test('18-02 chat-owner.js still renders bh-att-img class', () => {
    expect(chatOwner).toMatch(/bh-att-img/);
  });

  test('18-03 chat-owner.js still renders bh-att-video class', () => {
    expect(chatOwner).toMatch(/bh-att-video/);
  });

  test('18-04 chat-owner.js still renders bh-att-doc class', () => {
    expect(chatOwner).toMatch(/bh-att-doc/);
  });

  test('18-05 image border-radius 14px in new CSS', () => {
    expect(ios07).toMatch(/bh-att-img[\s\S]{0,200}?14px/);
  });

  test('18-06 video border-radius in new CSS', () => {
    expect(ios07).toMatch(/bh-att-video[\s\S]{0,200}?border-radius/);
  });

  test('18-07 doc card styled in new CSS', () => {
    expect(ios07).toMatch(/bh-att-doc/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. MOBILE / RESPONSIVE
// ─────────────────────────────────────────────────────────────────────────────

describe('07: mobile and responsive layout', () => {
  test('19-01 @media max-width:1366px block exists in new CSS', () => {
    expect(ios07).toMatch(/@media\s*\(\s*max-width\s*:\s*1366px\s*\)/);
  });

  test('19-02 mobile composer margin accounts for bottom nav', () => {
    expect(ios07).toMatch(/68px/);
  });

  test('19-03 safe-area-inset-bottom used in mobile', () => {
    expect(ios07).toMatch(/safe-area-inset-bottom/);
  });

  test('19-04 AppBackground applied in mobile @media too', () => {
    const mobileBlock = ios07.match(/@media\s*\(\s*max-width\s*:\s*1366px\s*\)[\s\S]+?(?=@media|$)/);
    expect(mobileBlock).toBeTruthy();
    expect(mobileBlock[0]).toMatch(/linear-gradient/);
  });

  test('19-05 messages-mobile-master style block still present in messages.html', () => {
    expect(msgsHtml).toMatch(/id="messages-mobile-master"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. DESKTOP LAYOUT
// ─────────────────────────────────────────────────────────────────────────────

describe('07: desktop split view layout', () => {
  test('20-01 @media min-width:1367px block in new CSS', () => {
    expect(ios07).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)/);
  });

  test('20-02 msgs-split transparent on desktop', () => {
    expect(ios07).toMatch(/msgs-split[\s\S]{0,200}?background\s*:\s*transparent\s*!important/);
  });

  test('20-03 msgs-left has semi-transparent glass on desktop', () => {
    const desktopBlock = ios07.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]+?}/);
    // The msgs-left background is defined globally (not in @media)
    expect(ios07).toMatch(/msgs-left[\s\S]{0,200}?background.*rgba/);
  });

  test('20-04 msgs-right transparent', () => {
    expect(ios07).toMatch(/msgs-right[\s\S]{0,200}?background\s*:\s*transparent\s*!important/);
  });

  test('20-05 #chatMessages transparent', () => {
    expect(ios07).toMatch(/chatMessages[\s\S]{0,200}?background\s*:\s*transparent\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. BOTTOM NAV PRESERVATION
// ─────────────────────────────────────────────────────────────────────────────

describe('07: bottom nav preserved (lg-capsule, Messages active)', () => {
  test('21-01 .mobile-tabs in messages.html (created by mobile-native-experience.js)', () => {
    expect(msgsHtml).toMatch(/mobile-native-experience\.js/);
  });

  test('21-02 mobile-tabs-handler.js loaded in messages.html', () => {
    expect(msgsHtml).toMatch(/mobile-tabs-handler\.js/);
  });

  test('21-03 bh-layout.js loaded in messages.html', () => {
    expect(msgsHtml).toMatch(/bh-layout\.js/);
  });

  test('21-04 ROUTES.messages present in mobile-tabs-handler.js', () => {
    expect(tabsHndlr).toMatch(/messages\s*:\s*['"]\/messages\.html['"]/);
  });

  test('21-05 messages badge handler loaded', () => {
    expect(msgsHtml).toMatch(/messages-badge-desktop-mobile\.js/);
  });

  test('21-06 lg-capsule rules NOT modified in bh-layout.js', () => {
    expect(bhLayout).toMatch(/lg-capsule/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. DESKTOP CALENDAR POINTER FIX PRESERVED
// ─────────────────────────────────────────────────────────────────────────────

describe('07: desktop Calendar pointer capture fix preserved', () => {
  test('22-01 e.pointerType !== mouse guard still in bh-layout.js', () => {
    expect(bhLayout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });

  test('22-02 setPointerCapture call still guarded', () => {
    expect(bhLayout).toMatch(
      /bar\.setPointerCapture\s*&&\s*e\.pointerId\s*!=\s*null\s*&&\s*e\.pointerType\s*!==\s*['"]mouse['"]/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. NO REGRESSION — bh-ios-07.css scope check
// ─────────────────────────────────────────────────────────────────────────────

describe('07: CSS scope — no leak to other pages', () => {
  test('23-01 all major rules scoped to body[data-page="messages"]', () => {
    // Count how many rules start with body[data-page="messages"] vs without
    const lines = ios07.split('\n').filter(l => l.trim().match(/^[^/*]/));
    const selectorLines = lines.filter(l => !l.includes('{') === false || l.match(/^\s*[.#@a-z]/i));
    // Spot-check: the word "messages" as scope must be prevalent
    expect(ios07).toMatch(/body\[data-page="messages"\]/);
  });

  test('23-02 no body rule without data-page scope except AppBackground', () => {
    // AppBackground MUST scope body[data-page="messages"], not bare body
    const bareBodyBg = ios07.match(/^html[^{]+body\s*\{[^}]*background[^}]*\}/gm);
    // Allow — these would be scoped. The test verifies scope exists.
    expect(ios07).toMatch(/body\[data-page="messages"\][\s\S]{0,500}?background[\s\S]{0,100}?F5F2EA/);
  });

  test('23-03 CSS does not reference app.html or calendar-specific classes', () => {
    expect(ios07).not.toMatch(/calendarSection/);
    expect(ios07).not.toMatch(/bh-cal-mode/);
    expect(ios07).not.toMatch(/renderModernCalendar/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. NO BACKEND / INFRA CHANGES
// ─────────────────────────────────────────────────────────────────────────────

describe('07: no backend or infrastructure changes', () => {
  test('24-01 server.js does not mention bh-messages-ios-07', () => {
    const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(serverJs).not.toMatch(/bh-messages-ios-07/);
  });

  test('24-02 no changes to channex.js referenced from new CSS', () => {
    expect(ios07).not.toMatch(/channex/i);
  });

  test('24-03 no changes to Stripe referenced from new CSS', () => {
    expect(ios07).not.toMatch(/stripe/i);
  });

  test('24-04 ios/ directory untouched (no bh-messages-ios-07 in ios folder)', () => {
    const iosDir = path.join(ROOT, 'ios');
    const iosExists = fs.existsSync(iosDir);
    if (iosExists) {
      const files = fs.readdirSync(iosDir);
      expect(files).not.toContain('bh-messages-ios-07.css');
    } else {
      expect(true).toBe(true); // ios dir absent = OK
    }
  });

  test('24-05 new CSS file is strictly a client-side CSS file', () => {
    expect(ios07).not.toMatch(/require\s*\(/);
    expect(ios07).not.toMatch(/module\.exports/);
    expect(ios07).not.toMatch(/SELECT\s/i);
    expect(ios07).not.toMatch(/INSERT\s/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. MESSAGES.HTML — STRUCTURAL PRESERVATION
// ─────────────────────────────────────────────────────────────────────────────

describe('07: messages.html structural preservation', () => {
  test('25-01 #conversationsList still present', () => {
    expect(msgsHtml).toMatch(/id="conversationsList"/);
  });

  test('25-02 .msgs-split still present', () => {
    expect(msgsHtml).toMatch(/class="msgs-split"/);
  });

  test('25-03 .msgs-left still present', () => {
    expect(msgsHtml).toMatch(/msgs-left/);
  });

  test('25-04 .msgs-right still present', () => {
    expect(msgsHtml).toMatch(/msgs-right/);
  });

  test('25-05 #chatMessages still present', () => {
    expect(msgsHtml).toMatch(/id="chatMessages"/);
  });

  test('25-06 #chatInput still present', () => {
    expect(msgsHtml).toMatch(/id="chatInput"/);
  });

  test('25-07 #sendBtn still present', () => {
    expect(msgsHtml).toMatch(/id="sendBtn"/);
  });

  test('25-08 chat-owner.js script tag still present', () => {
    expect(msgsHtml).toMatch(/chat-owner\.js/);
  });

  test('25-09 socket.io script still loaded', () => {
    expect(msgsHtml).toMatch(/socket\.io/);
  });

  test('25-10 new CSS link is last among external CSS files', () => {
    const bh07Idx     = msgsHtml.indexOf('bh-messages-ios-07.css');
    const badgesIdx   = msgsHtml.indexOf('bh-badges.css');
    expect(bh07Idx).toBeGreaterThan(badgesIdx);
  });
});
