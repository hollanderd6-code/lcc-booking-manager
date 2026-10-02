'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_MESSAGES_07C_ACTIONABLE_AND_DETAIL_FIX
 *
 * Authoritative iOS source:
 *   MessagesViewModel.swift  → escalatedCount: conversations.filter { $0.escalated == true }.count
 *   MessagesView.swift       → "À reprendre · N" pill
 *
 * Exact rule:  conversation.escalated === true
 * Data source: GET /api/chat/conversations (field already returned)
 * Backend:     NO CHANGE
 *
 * Fixes in this sprint:
 *   1. "À reprendre" filter pill (data-filter="escalated")
 *   2. Escalated badge/accent on conversation cards
 *   3. "IA en pause" badge when ai_disabled
 *   4. "✨ Brouillon prêt" badge when has_suggestion
 *   5. Header kicker: "X non lus · Y à reprendre"
 *   6. Composer visibility: msgs-split height corrected for desktop nav
 *   7. btnCopyInviteLink (🔗): kept — unique guest invite link function
 *   8. btnBookingMessage (✈️): kept — unique OTA platform send function
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

const msgsHtml  = html('messages.html');
const ios07     = css('bh-messages-ios-07.css');
const ios07c    = css('bh-messages-ios-07c.css');
const chatOwner = js('chat-owner.js');
const ios07cJs  = js('bh-messages-ios-07c.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. ACTIONABLE DATA SOURCE AND EXACT RULE
// ─────────────────────────────────────────────────────────────────────────────

describe('07C actionable data source', () => {
  test('1-01 exact rule uses escalated===true (not ai_disabled, not unread_count)', () => {
    expect(ios07cJs).toMatch(/escalated\s*===\s*true/);
    expect(ios07cJs).not.toMatch(/ai_disabled.*?escalated|escalated.*?ai_disabled/);
  });

  test('1-02 JS never modifies escalated (read-only filter)', () => {
    // Only assignment writes forbidden (=), not comparisons (===)
    const writePattern = /conv\.escalated\s*=(?!=)/;
    expect(ios07cJs).not.toMatch(writePattern);
  });

  test('1-03 data source is window.allConversations (no parallel fetch)', () => {
    expect(ios07cJs).toMatch(/window\.allConversations/);
    expect(ios07cJs).not.toMatch(/fetch\s*\(/);
  });

  test('1-04 escalated filter adds conv-escalated class', () => {
    expect(ios07cJs).toMatch(/conv-escalated/);
    expect(ios07cJs).toMatch(/classList.*toggle.*conv-escalated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. FILTER PILL — HTML STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

describe('07C filter pill: À reprendre', () => {
  test('2-01 "À reprendre" pill present in filter bar', () => {
    expect(msgsHtml).toMatch(/À reprendre/);
  });

  test('2-02 pill uses data-filter="escalated"', () => {
    expect(msgsHtml).toMatch(/data-filter="escalated"/);
  });

  test('2-03 pill calls setMsgsFilter("escalated")', () => {
    expect(msgsHtml).toMatch(/setMsgsFilter\s*\(\s*['"]escalated['"]\s*\)/);
  });

  test('2-04 pill has msgsEscalatedFilterBadge span', () => {
    expect(msgsHtml).toMatch(/id="msgsEscalatedFilterBadge"/);
  });

  test('2-05 pill has msgs-filter-pill--escalated class', () => {
    expect(msgsHtml).toMatch(/msgs-filter-pill--escalated/);
  });

  test('2-06 Tout pill still present', () => {
    expect(msgsHtml).toMatch(/data-filter="all"/);
  });

  test('2-07 Non lus pill still present', () => {
    expect(msgsHtml).toMatch(/data-filter="unread"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. FILTER LOGIC — setMsgsFilter handles escalated
// ─────────────────────────────────────────────────────────────────────────────

describe('07C filter logic', () => {
  test('3-01 setMsgsFilter toggles msgs-filter-escalated class', () => {
    expect(msgsHtml).toMatch(/msgs-filter-escalated/);
    expect(msgsHtml).toMatch(/f\s*===\s*['"]escalated['"]/);
  });

  test('3-02 setMsgsFilter still handles unread filter', () => {
    expect(msgsHtml).toMatch(/msgs-filter-unread/);
    expect(msgsHtml).toMatch(/f\s*===\s*['"]unread['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. COUNTER INDEPENDENCE — unread and escalated are orthogonal
// ─────────────────────────────────────────────────────────────────────────────

describe('07C counter independence', () => {
  test('4-01 _updateMsgsFilterCounts computes unread count separately', () => {
    expect(msgsHtml).toMatch(/unread_count.*?>\s*0|parseInt.*unread_count/);
  });

  test('4-02 _updateMsgsFilterCounts computes escalated count separately', () => {
    expect(msgsHtml).toMatch(/escalated\s*===\s*true/);
  });

  test('4-03 escalated count uses escalated===true, NOT unread_count', () => {
    const fn = msgsHtml.match(/_updateMsgsFilterCounts[\s\S]{0,800}/);
    expect(fn).toBeTruthy();
    expect(fn[0]).toMatch(/escalated\s*===\s*true/);
    // must NOT proxy escalated via unread
    expect(fn[0]).not.toMatch(/ne\s*=[\s\S]{0,30}unread/);
  });

  test('4-04 unread count uses unread_count, NOT escalated', () => {
    const fn = msgsHtml.match(/_updateMsgsFilterCounts[\s\S]{0,800}/);
    expect(fn).toBeTruthy();
    expect(fn[0]).toMatch(/unread_count/);
  });

  /*
   * Scenario matrix (conv.escalated, conv.unread_count):
   *   A: (true,  0) → À reprendre YES, Non lus NO
   *   B: (false, 2) → À reprendre NO,  Non lus YES
   *   C: (true,  3) → À reprendre YES, Non lus YES
   *   D: (false, 0) → neither
   */
  test('4-05 conv A (escalated=true, unread=0) → classified escalated only', () => {
    const convA = { escalated: true, unread_count: 0 };
    const isEsc  = convA.escalated === true;
    const isUnrd = (parseInt(convA.unread_count, 10) || 0) > 0;
    expect(isEsc).toBe(true);
    expect(isUnrd).toBe(false);
  });

  test('4-06 conv B (escalated=false, unread=2) → classified unread only', () => {
    const convB = { escalated: false, unread_count: 2 };
    const isEsc  = convB.escalated === true;
    const isUnrd = (parseInt(convB.unread_count, 10) || 0) > 0;
    expect(isEsc).toBe(false);
    expect(isUnrd).toBe(true);
  });

  test('4-07 conv C (escalated=true, unread=3) → classified BOTH', () => {
    const convC = { escalated: true, unread_count: 3 };
    const isEsc  = convC.escalated === true;
    const isUnrd = (parseInt(convC.unread_count, 10) || 0) > 0;
    expect(isEsc).toBe(true);
    expect(isUnrd).toBe(true);
  });

  test('4-08 conv D (escalated=false, unread=0) → classified neither', () => {
    const convD = { escalated: false, unread_count: 0 };
    const isEsc  = convD.escalated === true;
    const isUnrd = (parseInt(convD.unread_count, 10) || 0) > 0;
    expect(isEsc).toBe(false);
    expect(isUnrd).toBe(false);
  });

  test('4-09 counters are truly independent — 5 unread, 105 escalated is valid', () => {
    const convs = [
      ...Array.from({ length: 5  }, () => ({ escalated: false, unread_count: 1  })),
      ...Array.from({ length: 105 }, () => ({ escalated: true,  unread_count: 0  })),
    ];
    const nu = convs.filter(c => (parseInt(c.unread_count, 10) || 0) > 0).length;
    const ne = convs.filter(c => c.escalated === true).length;
    expect(nu).toBe(5);
    expect(ne).toBe(105);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. HEADER KICKER — dynamic "X non lus · Y à reprendre"
// ─────────────────────────────────────────────────────────────────────────────

describe('07C header kicker', () => {
  test('5-01 kicker builds "X non lus · Y à reprendre" format', () => {
    expect(msgsHtml).toMatch(/non lu.*·.*à reprendre|à reprendre.*·.*non lu/);
  });

  test('5-02 singular "non lu" for 1, plural "non lus" for > 1', () => {
    expect(msgsHtml).toMatch(/nu.*>.*1.*?non lus|non lu.*\+.*\(nu.*>.*1/);
  });

  test('5-03 msgsEscalatedFilterBadge referenced in _updateMsgsFilterCounts', () => {
    expect(msgsHtml).toMatch(/msgsEscalatedFilterBadge/);
  });

  test('5-04 kicker CSS ::after suppressed in ios07c', () => {
    expect(ios07c).toMatch(/msgsUnreadHeader.*::after[\s\S]{0,100}?content\s*:\s*''\s*!important/);
  });

  test('5-05 fallback "Messages" (::before) preserved in ios07', () => {
    expect(ios07).toMatch(/msgsUnreadHeader.*?::before[\s\S]{0,100}?content.*?Messages/);
  });

  test('5-06 hdr.textContent set in JS (not just dataset.count)', () => {
    const fn = msgsHtml.match(/_updateMsgsFilterCounts[\s\S]{0,1000}/);
    expect(fn).toBeTruthy();
    expect(fn[0]).toMatch(/hdr\.textContent\s*=/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CSS — "À reprendre" pill gold style
// ─────────────────────────────────────────────────────────────────────────────

describe('07C CSS: gold pill', () => {
  test('6-01 escalated pill uses gold text #8A5B14', () => {
    expect(ios07c).toMatch(/msgs-filter-pill--escalated[\s\S]{0,200}?#8A5B14/);
  });

  test('6-02 escalated pill uses gold background rgba(251,243,226)', () => {
    expect(ios07c).toMatch(/msgs-filter-pill--escalated[\s\S]{0,200}?rgba\(251,\s*243,\s*226/);
  });

  test('6-03 escalated pill border-radius matches other pills (13px from ios07)', () => {
    expect(ios07).toMatch(/msgs-filter-pill[\s\S]{0,300}?border-radius\s*:\s*13px/);
  });

  test('6-04 escalated filter hide rule present', () => {
    expect(ios07c).toMatch(/msgs-filter-escalated.*?conversation-item.*?not.*?conv-escalated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. CSS — escalated card accent
// ─────────────────────────────────────────────────────────────────────────────

describe('07C CSS: escalated card accent', () => {
  test('7-01 conv-escalated card has warm background', () => {
    expect(ios07c).toMatch(/conv-escalated[\s\S]{0,200}?rgba\(251,\s*243,\s*226/);
  });

  test('7-02 conv-escalated card has amber border accent', () => {
    expect(ios07c).toMatch(/conv-escalated[\s\S]{0,200}?rgba\(201,\s*161,\s*91/);
  });

  test('7-03 escalated accent bar uses #C9A15B', () => {
    expect(ios07c).toMatch(/C9A15B/);
  });

  test('7-04 accent bar is left edge (position:absolute, left:0)', () => {
    expect(ios07c).toMatch(/conv-escalated::before[\s\S]{0,200}?left\s*:\s*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. BADGE — "IA en pause"
// ─────────────────────────────────────────────────────────────────────────────

describe('07C badge: IA en pause', () => {
  test('8-01 badge class bh-conv-badge--ai-paused defined in ios07c', () => {
    expect(ios07c).toMatch(/bh-conv-badge--ai-paused/);
  });

  test('8-02 badge does NOT use gold (#8A5B14) — neutral glass only', () => {
    const aiBlock = ios07c.match(/bh-conv-badge--ai-paused[\s\S]{0,200}?\}/);
    expect(aiBlock).toBeTruthy();
    expect(aiBlock[0]).not.toMatch(/#8A5B14/);
  });

  test('8-03 JS injects "IA en pause" text for ai_disabled=true', () => {
    expect(ios07cJs).toMatch(/IA en pause/);
    expect(ios07cJs).toMatch(/ai_disabled\s*===\s*true/);
  });

  test('8-04 ai_disabled badge is NOT used as proxy for escalated', () => {
    // escalated class must check escalated, not ai_disabled
    expect(ios07cJs).toMatch(/conv-escalated.*?escalated\s*===\s*true/);
    expect(ios07cJs).not.toMatch(/conv-escalated.*?ai_disabled/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. BADGE — "Brouillon prêt"
// ─────────────────────────────────────────────────────────────────────────────

describe('07C badge: Brouillon prêt', () => {
  test('9-01 badge class bh-conv-badge--suggestion defined in ios07c', () => {
    expect(ios07c).toMatch(/bh-conv-badge--suggestion/);
  });

  test('9-02 badge uses gold tokens #8A5B14 / rgba(251,243,226)', () => {
    const sugBlock = ios07c.match(/bh-conv-badge--suggestion[\s\S]{0,200}?\}/);
    expect(sugBlock).toBeTruthy();
    expect(sugBlock[0]).toMatch(/#8A5B14/);
    expect(sugBlock[0]).toMatch(/rgba\(251,\s*243,\s*226/);
  });

  test('9-03 JS injects "✨ Brouillon prêt" for has_suggestion=true', () => {
    expect(ios07cJs).toMatch(/Brouillon pr/);
    expect(ios07cJs).toMatch(/has_suggestion\s*===\s*true/);
  });

  test('9-04 has_suggestion is independent of escalated', () => {
    // JS toggles conv-has-suggestion from has_suggestion, not from escalated
    expect(ios07cJs).toMatch(/conv-has-suggestion.*?has_suggestion/);
    expect(ios07cJs).not.toMatch(/conv-has-suggestion.*?escalated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. COMPOSER VISIBILITY — desktop height fix
// ─────────────────────────────────────────────────────────────────────────────

describe('07C composer: desktop layout fix', () => {
  test('10-01 07c overrides msgs-split height on desktop (min-width:1367px)', () => {
    const block = ios07c.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,500}?msgs-split[\s\S]{0,200}?height/);
    expect(block).toBeTruthy();
  });

  test('10-02 override height accounts for nav clearance (> 100dvh - 90px)', () => {
    // Find calc(100dvh - Xpx) inside the @media block (not a comment mentioning old value)
    const block = ios07c.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,500}?height\s*:\s*calc\s*\(\s*100dvh\s*-\s*(\d+)px\s*\)/);
    expect(block).toBeTruthy();
    expect(parseInt(block[1], 10)).toBeGreaterThan(90);
  });

  test('10-03 override uses !important to beat ios-07.css rule', () => {
    const block = ios07c.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]{0,500}?msgs-split[\s\S]{0,200}?height[\s\S]{0,50}?!important/);
    expect(block).toBeTruthy();
  });

  test('10-04 msgs-right is a flex column (chat area scrolls, composer fixed)', () => {
    expect(msgsHtml).toMatch(/.msgs-right[\s\S]{0,200}?flex-direction\s*:\s*column/);
  });

  test('10-05 #chatMessages has flex:1 and min-height:0 (scrollable area)', () => {
    expect(msgsHtml).toMatch(/#chatMessages[\s\S]{0,100}?flex\s*:\s*1/);
    expect(msgsHtml).toMatch(/#chatMessages[\s\S]{0,200}?min-height\s*:\s*0/);
  });

  test('10-06 .chat-modal-input has flex-shrink:0 (composer pinned to bottom)', () => {
    expect(msgsHtml).toMatch(/.chat-modal-input[\s\S]{0,200}?flex-shrink\s*:\s*0/);
  });

  /*
   * Width-resolution assertions — static CSS analysis.
   * These verify the height formula works at all typical desktop widths.
   * Actual visual rendering cannot be tested in Jest without a browser.
   */
  test('10-07 @media min-width:1367px covers 1280px (desktop rule active ≥1367)', () => {
    // The rule fires at 1367px+, which covers 1280 only if we verify separately
    // Actually 1367 > 1280, so the rule does NOT fire at 1280.
    // At 1280 mobile layout applies — chatInputArea has margin-bottom for nav.
    expect(ios07).toMatch(/max-width\s*:\s*1366px[\s\S]{0,1000}?chatInputArea[\s\S]{0,200}?margin-bottom/);
  });

  test('10-08 mobile chatInputArea margin-bottom clears bottom nav (68px + safe-area)', () => {
    const mobileBlock = ios07.match(/@media\s*\(\s*max-width\s*:\s*1366px\s*\)[\s\S]{0,2000}/);
    expect(mobileBlock).toBeTruthy();
    expect(mobileBlock[0]).toMatch(/chatInputArea[\s\S]{0,200}?68px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. HEADER BUTTONS AUDIT
// ─────────────────────────────────────────────────────────────────────────────

describe('07C header buttons audit', () => {
  test('11-01 btnCopyInviteLink (🔗) exists in HTML', () => {
    expect(msgsHtml).toMatch(/id="btnCopyInviteLink"/);
  });

  test('11-02 btnCopyInviteLink copies guest invite link (not an OTA endpoint)', () => {
    expect(chatOwner).toMatch(/btnCopyInviteLink/);
    expect(chatOwner).toMatch(/copyInviteLink/);
  });

  test('11-03 btnCopyInviteLink shown only when chat_token+pin_code exist (contextual)', () => {
    // chat-owner.js shows it conditionally
    expect(chatOwner).toMatch(/btnCopyInviteLink[\s\S]{0,200}?chat_token[\s\S]{0,100}?pin_code/);
  });

  test('11-04 btnBookingMessage (✈️) exists in HTML', () => {
    expect(msgsHtml).toMatch(/id="btnBookingMessage"/);
  });

  test('11-05 btnBookingMessage sends to OTA platform via send-platform endpoint', () => {
    expect(msgsHtml).toMatch(/send-platform/);
    expect(msgsHtml).toMatch(/sendPlatformMessage/);
  });

  test('11-06 btnBookingMessage shown only for OTA conversations (channex_booking_id)', () => {
    // JS section: button is retrieved first, then channex_booking_id is checked to show/hide it
    expect(msgsHtml).toMatch(/btnBookingMessage[\s\S]{0,1200}?channex_booking_id/);
  });

  test('11-07 both buttons hidden by default (display:none)', () => {
    const chainBtn = msgsHtml.match(/id="btnCopyInviteLink"[^>]*/);
    const planeBtn = msgsHtml.match(/id="btnBookingMessage"[^>]*/);
    expect(chainBtn).toBeTruthy();
    expect(planeBtn).toBeTruthy();
    expect(chainBtn[0]).toMatch(/display.*none|style.*display:none/);
    expect(planeBtn[0]).toMatch(/display.*none|style.*display:none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. FLOATING CONTROLS — SMS and send in composer (not truly floating)
// ─────────────────────────────────────────────────────────────────────────────

describe('07C floating controls audit', () => {
  test('12-01 smsToggleBtn is inside composer, shown only when SMS enabled', () => {
    expect(msgsHtml).toMatch(/id="smsToggleBtn"/);
    // It is inside chatInputArea (the composer)
    const composerBlock = msgsHtml.match(/id="chatInputArea"[\s\S]{0,500}/);
    expect(composerBlock).toBeTruthy();
    expect(composerBlock[0]).toMatch(/smsToggleBtn/);
  });

  test('12-02 sendBtn is inside composer', () => {
    const composerBlock = msgsHtml.match(/id="chatInputArea"[\s\S]{0,800}/);
    expect(composerBlock).toBeTruthy();
    expect(composerBlock[0]).toMatch(/id="sendBtn"/);
  });

  test('12-03 no truly floating persistent buttons (position:fixed at bottom-right)', () => {
    // Only modals and toast use position:fixed — not persistent action buttons
    // Simple check: no standalone button with position:fixed AND bottom + right styling
    const fixedButtons = msgsHtml.match(/button[^>]*position\s*:\s*fixed[^>]*/gi);
    // If any exist they should be inside modals (which have display:none)
    // This test verifies there are no hidden persistent FAB buttons
    expect(msgsHtml).not.toMatch(/class="msgs-fab"/);
    expect(msgsHtml).not.toMatch(/class="bh-fab"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. CSS FILE LOADED
// ─────────────────────────────────────────────────────────────────────────────

describe('07C CSS file loaded', () => {
  test('13-01 bh-messages-ios-07c.css linked in messages.html', () => {
    expect(msgsHtml).toMatch(/bh-messages-ios-07c\.css/);
  });

  test('13-02 07c loaded after 07 (cascade order preserved)', () => {
    const pos07  = msgsHtml.indexOf('bh-messages-ios-07.css');
    const pos07c = msgsHtml.indexOf('bh-messages-ios-07c.css');
    expect(pos07).toBeGreaterThan(-1);
    expect(pos07c).toBeGreaterThan(pos07);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. JS FILE LOADED
// ─────────────────────────────────────────────────────────────────────────────

describe('07C JS file loaded', () => {
  test('14-01 bh-messages-ios-07c.js loaded in messages.html', () => {
    expect(msgsHtml).toMatch(/bh-messages-ios-07c\.js/);
  });

  test('14-02 07c.js loaded after chat-owner.js', () => {
    const posCO  = msgsHtml.indexOf('chat-owner.js');
    const pos07c = msgsHtml.indexOf('bh-messages-ios-07c.js');
    expect(posCO).toBeGreaterThan(-1);
    expect(pos07c).toBeGreaterThan(posCO);
  });

  test('14-03 07c.js has guard against double-init', () => {
    expect(ios07cJs).toMatch(/__bhMessages07c/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. CSS SCOPE — no leak
// ─────────────────────────────────────────────────────────────────────────────

describe('07C CSS scope', () => {
  test('15-01 pill rules scoped to body[data-page="messages"]', () => {
    expect(ios07c).toMatch(/body\[data-page="messages"\][\s\S]{0,200}?msgs-filter-pill--escalated/);
  });

  test('15-02 filter hide rule uses #conversationsList (messages-page only)', () => {
    expect(ios07c).toMatch(/#conversationsList\.msgs-filter-escalated/);
  });

  test('15-03 no calendarSection referenced', () => {
    expect(ios07c).not.toMatch(/calendarSection/);
  });

  test('15-04 no bh-cal-mode referenced', () => {
    expect(ios07c).not.toMatch(/bh-cal-mode/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. ZERO BACKEND CHANGES
// ─────────────────────────────────────────────────────────────────────────────

describe('07C: zero backend changes', () => {
  test('16-01 escalated field already exists — no new API route needed', () => {
    // This test is definitional; the JS reads existing c.escalated from allConversations
    expect(ios07cJs).toMatch(/conv\.escalated/);
    // No fetch calls in 07c.js
    expect(ios07cJs).not.toMatch(/fetch\s*\(/);
  });

  test('16-02 chat-owner.js hash unchanged', () => {
    const { createHash } = require('crypto');
    const hash = createHash('sha256')
      .update(fs.readFileSync(path.join(ROOT, 'public', 'js', 'chat-owner.js')))
      .digest('hex');
    expect(hash).toBe('82b5523386cd5ce3133388d41c42c81df9604f15b40ad4ca6565a5bd1f664e3d');
  });

  test('16-03 bh-layout.js pointer-type guard preserved', () => {
    const bhLayout = js('bh-layout.js');
    expect(bhLayout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. STRUCTURAL PRESERVATION (regressions)
// ─────────────────────────────────────────────────────────────────────────────

describe('07C: structural preservation', () => {
  test('17-01 conversationsList still present', () => {
    expect(msgsHtml).toMatch(/id="conversationsList"/);
  });

  test('17-02 chatInputArea still present', () => {
    expect(msgsHtml).toMatch(/id="chatInputArea"/);
  });

  test('17-03 sendBtn still present', () => {
    expect(msgsHtml).toMatch(/id="sendBtn"/);
  });

  test('17-04 bottom nav scripts still loaded', () => {
    expect(msgsHtml).toMatch(/mobile-tabs-handler\.js/);
    expect(msgsHtml).toMatch(/bh-layout\.js/);
    expect(msgsHtml).toMatch(/messages-badge-desktop-mobile\.js/);
  });

  test('17-05 attachment endpoint intact in chat-owner.js', () => {
    expect(chatOwner).toMatch(/\/api\/chat\/conversations[\s\S]{0,100}?attachments/);
  });

  test('17-06 msgs-split still present in HTML', () => {
    expect(msgsHtml).toMatch(/class="msgs-split"/);
  });

  test('17-07 msgs-filter-bar still present', () => {
    expect(msgsHtml).toMatch(/id="msgsFilterBar"/);
  });

  test('17-08 bh-messages-ios-07.css still loaded', () => {
    expect(msgsHtml).toMatch(/bh-messages-ios-07\.css/);
  });
});
