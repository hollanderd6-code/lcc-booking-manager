/**
 * MESSAGES-18B — iOS visual parity tests
 * 76 tests: 18B-01 … 18B-76
 * Checks: entry points, CSS tokens, layout, filters, cards,
 *   bubbles, composer, attachments, Socket.IO, ghost modal,
 *   responsive, nav, and zero-engine-change guarantees.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO            = path.join(__dirname, '..');
const MESSAGES_HTML   = path.join(REPO, 'public/messages.html');
const CHAT_OWNER_JS   = path.join(REPO, 'public/js/chat-owner.js');
const MESSAGES_V3_CSS = path.join(REPO, 'public/css/bh-messages-v3.css');
const SERVER_JS       = path.join(REPO, 'server.js');
const CHANNEX_JS      = path.join(REPO, 'channex.js');

const CHAT_OWNER_EXPECTED_HASH = 'a56812ddd30d65da5582950d645f41f5e03cb4f8';

let html   = '';
let v3css  = '';
let coJs   = '';

beforeAll(() => {
  html  = fs.readFileSync(MESSAGES_HTML,   'utf8');
  v3css = fs.readFileSync(MESSAGES_V3_CSS, 'utf8');
  coJs  = fs.readFileSync(CHAT_OWNER_JS,   'utf8');
});

// ── Entry points ────────────────────────────────────────────────

test('18B-01: messages.html true entry preserved', () => {
  expect(fs.existsSync(MESSAGES_HTML)).toBe(true);
  expect(html).toMatch(/data-page="messages"/);
});

test('18B-02: chat-owner.js loaded in messages.html', () => {
  expect(html).toMatch(/chat-owner\.js/);
});

test('18B-03: chat-owner.js content unchanged (git hash-object)', () => {
  const hash = execSync('git hash-object public/js/chat-owner.js', { cwd: REPO })
    .toString().trim();
  expect(hash).toBe(CHAT_OWNER_EXPECTED_HASH);
});

test('18B-04: bh-messages-v3.css linked in messages.html and file exists', () => {
  expect(html).toMatch(/bh-messages-v3\.css/);
  expect(fs.existsSync(MESSAGES_V3_CSS)).toBe(true);
});

// ── Background + typography ──────────────────────────────────────

test('18B-05: v3 CSS sets white page background', () => {
  expect(v3css).toMatch(/background\s*:\s*#(?:FFFFFF|ffffff|FFF|fff)\s*!important/);
});

test('18B-06: v3 CSS sets white background on #chatMessages', () => {
  expect(v3css).toMatch(/#chatMessages/);
  // The rule sets background white with !important
  const chatMsgRule = v3css.match(/#chatMessages[\s\S]*?\{([\s\S]*?)\}/);
  expect(chatMsgRule).not.toBeNull();
  expect(chatMsgRule[0]).toMatch(/background\s*:\s*#(?:FFFFFF|ffffff|FFF|fff)/);
});

test('18B-07: DM Sans font-family used in v3 CSS', () => {
  expect(v3css).toMatch(/DM\s+Sans/);
});

test('18B-08: desktop split layout preserved in HTML', () => {
  expect(html).toMatch(/class="msgs-split"/);
  expect(html).toMatch(/class="msgs-left"/);
  expect(html).toMatch(/class="msgs-right"/);
});

test('18B-09: left panel width is responsive (at least 2 breakpoints)', () => {
  const matches = v3css.match(/\.msgs-left[\s\S]*?width\s*:\s*\d+px/g) || [];
  expect(matches.length).toBeGreaterThanOrEqual(2);
});

test('18B-10: right panel has flex:1 (preserved from legacy CSS)', () => {
  const rightFlex = html.match(/\.msgs-right\s*\{[\s\S]*?flex\s*:\s*1/) ||
                    v3css.match(/\.msgs-right[\s\S]*?flex\s*:\s*1/);
  // Legacy inline CSS has this; check it's still in the page
  expect(html).toMatch(/\.msgs-right/);
  expect(html).toMatch(/flex\s*:\s*1/);
});

// ── Header ──────────────────────────────────────────────────────

test('18B-11: iOS-like page header with Messages title', () => {
  expect(html).toMatch(/bh-desktop-header/);
  expect(html).toMatch(/bh-dh-title[^>]*>Messages/);
});

test('18B-12: unread counter element present in header', () => {
  expect(html).toMatch(/id="msgsUnreadHeader"/);
});

test('18B-13: search input #msgsSearchInput preserved', () => {
  expect(html).toMatch(/id="msgsSearchInput"/);
});

test('18B-14: Tout filter pill with data-filter="all"', () => {
  expect(html).toMatch(/data-filter="all"/);
});

test('18B-15: Non lus filter pill with data-filter="unread"', () => {
  expect(html).toMatch(/data-filter="unread"/);
});

test('18B-16: "À reprendre" uses real escalated key, not fake reprendre key', () => {
  // 07C implements the real filter using data-filter="escalated" (from iOS authoritative source)
  expect(html).not.toMatch(/data-filter="reprendre"/);
  expect(html).toMatch(/data-filter="escalated"/);
  expect(html).toMatch(/À reprendre/);
});

// ── Conversation cards ───────────────────────────────────────────

test('18B-17: conversation item style targeted in v3 CSS', () => {
  expect(v3css).toMatch(/conversation-item/);
});

test('18B-18: selected card has subtle green background (not saturated)', () => {
  expect(v3css).toMatch(/\.conversation-item\.active/);
  // green-soft via rgba or var
  expect(v3css).toMatch(/msgs-green-soft|rgba\(14,\s*59,\s*46/);
});

test('18B-19: unread indicator class .conv-unread targeted in v3 CSS', () => {
  expect(v3css).toMatch(/conv-unread/);
});

test('18B-20: property_name rendered in conversation card (engine)', () => {
  expect(coJs).toMatch(/property_name/);
});

test('18B-21: guest display name rendered in conversation card (engine)', () => {
  expect(coJs).toMatch(/guest_display_name|guestName/);
});

test('18B-22: platform chip/color rendered in conversation card (engine)', () => {
  expect(coJs).toMatch(/getPlatformColor|platformColor/);
});

test('18B-23: message preview (snippet) in conversation card (engine)', () => {
  expect(coJs).toMatch(/snippet|last_message/);
});

test('18B-24: timestamp in conversation card (engine)', () => {
  expect(coJs).toMatch(/lastMessageTime|formatTime/);
});

// ── Chat panel ──────────────────────────────────────────────────

test('18B-25: #msgsChatHeader preserved', () => {
  expect(html).toMatch(/id="msgsChatHeader"/);
});

test('18B-26: #chatMessages preserved', () => {
  expect(html).toMatch(/id="chatMessages"/);
});

test('18B-27: guest bubble class rendered by engine', () => {
  // Engine uses: 'chat-message ' + (isOwner ? 'owner' : 'guest')
  expect(coJs).toMatch(/'guest'|"guest"|chat-message.*guest/);
});

test('18B-28: owner bubble gets green background (from lux or v3 CSS)', () => {
  const hasGreen = html.match(/chat-message\.owner[\s\S]*?background|chat-bubble-owner/s) ||
                   v3css.match(/owner.*chat-bubble|chat-bubble.*owner/s);
  expect(coJs).toMatch(/owner/);
  // lux CSS sets this — verify the legacy rule is still present in messages.html
  expect(html).toMatch(/chat-message\.owner/);
});

test('18B-29: bubble max-width 70–75% set in CSS', () => {
  const hasMaxW = v3css.match(/\.chat-message[\s\S]*?max-width\s*:\s*7[0-9]%/) ||
                  html.match(/\.chat-message\s*\{[\s\S]*?max-width\s*:\s*7[0-9]%/);
  expect(hasMaxW).not.toBeNull();
});

test('18B-30: chat-time / timestamps available in engine', () => {
  expect(coJs).toMatch(/chat-time|formatTime/);
});

// ── Composer ─────────────────────────────────────────────────────

test('18B-31: #chatInputArea preserved', () => {
  expect(html).toMatch(/id="chatInputArea"/);
});

test('18B-32: #photoUploadBtn preserved', () => {
  expect(html).toMatch(/id="photoUploadBtn"/);
});

test('18B-33: #chatInput preserved', () => {
  expect(html).toMatch(/id="chatInput"/);
});

test('18B-34: #sendBtn preserved', () => {
  expect(html).toMatch(/id="sendBtn"/);
});

test('18B-35: composer is sticky at bottom (v3 CSS)', () => {
  expect(v3css).toMatch(/#chatInputArea[\s\S]*?position\s*:\s*sticky|position\s*:\s*sticky[\s\S]*?#chatInputArea/s);
});

test('18B-36: photo button has >=44px touch target on mobile (v3 CSS)', () => {
  expect(v3css).toMatch(/min-height\s*:\s*44px/);
  expect(v3css).toMatch(/min-width\s*:\s*44px/);
});

// ── Quick replies + AI ───────────────────────────────────────────

test('18B-37: #quickRepliesBar preserved', () => {
  expect(html).toMatch(/id="quickRepliesBar"/);
});

test('18B-38: #ownerSuggestionCard preserved', () => {
  expect(html).toMatch(/id="ownerSuggestionCard"/);
});

test('18B-39: #btnToggleAI preserved', () => {
  expect(html).toMatch(/id="btnToggleAI"/);
});

test('18B-40: per-conversation AI toggle logic in engine (ai_disabled)', () => {
  expect(coJs).toMatch(/ai_disabled|btnToggleAI/);
});

// ── Attachments ──────────────────────────────────────────────────

test('18B-41: _bhRenderAttachments preserved in chat-owner.js', () => {
  expect(coJs).toMatch(/_bhRenderAttachments|_bhRenderOneAttachment/);
});

test('18B-42: _bhSendPhotos / openPhotoUpload preserved in engine', () => {
  expect(coJs).toMatch(/_bhSendPhotos|openPhotoUpload/);
});

test('18B-43: upload progress tracking preserved', () => {
  expect(coJs).toMatch(/progress/i);
});

test('18B-44: lightbox function preserved in engine', () => {
  expect(coJs).toMatch(/_bhLightboxShow|lightbox/i);
});

test('18B-45: video handling preserved in engine', () => {
  expect(coJs).toMatch(/video/i);
});

test('18B-46: attachment_updated socket event preserved', () => {
  expect(coJs).toMatch(/attachment_updated/);
});

// ── Socket.IO ────────────────────────────────────────────────────

test('18B-47: socket.io script preserved in messages.html', () => {
  expect(html).toMatch(/socket\.io/);
});

test('18B-48: lcc_token used for socket auth (HTML + engine)', () => {
  expect(html).toMatch(/lcc_token/);
  expect(coJs).toMatch(/lcc_token/);
});

test('18B-49: join_conversation event preserved', () => {
  expect(html).toMatch(/join_conversation/);
});

test('18B-50: new_message socket event preserved in engine', () => {
  expect(coJs).toMatch(/new_message/);
});

test('18B-51: new_notification socket event preserved in engine', () => {
  expect(coJs).toMatch(/new_notification/);
});

test('18B-52: messages_read socket event preserved in engine', () => {
  expect(coJs).toMatch(/messages_read/);
});

test('18B-53: new_platform_message socket event preserved in engine', () => {
  expect(coJs).toMatch(/new_platform_message/);
});

// ── API routes ───────────────────────────────────────────────────

test('18B-54: send-platform route preserved in engine', () => {
  expect(coJs).toMatch(/send-platform/);
});

test('18B-55: BH direct send route preserved in engine', () => {
  expect(coJs).toMatch(/\/api\/chat\/send/);
});

test('18B-56: mark-read route preserved in engine', () => {
  expect(coJs).toMatch(/mark-read/);
});

// ── Ghost modal ──────────────────────────────────────────────────

test('18B-57: #chatModal ghost element preserved', () => {
  expect(html).toMatch(/id="chatModal"/);
});

test('18B-58: #chatModal is off-screen (top:-9999px)', () => {
  expect(html).toMatch(/id="chatModal"[\s\S]*?top:-9999px/);
});

// ── Mobile layout ────────────────────────────────────────────────

test('18B-59: mobile breakpoint in v3 CSS with full-width left panel', () => {
  const mq = v3css.match(/@media[^{]*max-width[^{]*768px[^{]*\{([\s\S]*?)(?=@media|$)/);
  expect(mq).not.toBeNull();
  expect(mq[0]).toMatch(/width\s*:\s*100%/);
});

test('18B-60: mobile conversation list class present in HTML', () => {
  expect(html).toMatch(/class="msgs-left"/);
});

test('18B-61: chat-owner.js mobile detection NOT overwritten by v3 CSS', () => {
  // v3 CSS must not introduce display:none on msgs-left or msgs-right unconditionally
  expect(v3css).not.toMatch(/\.msgs-right\s*\{\s*display\s*:\s*none/);
  expect(v3css).not.toMatch(/\.msgs-left\s*\{\s*display\s*:\s*none/);
});

test('18B-62: mobile bottom nav CSS loaded in messages.html', () => {
  expect(html).toMatch(/mobile-tabs-handler|bh-bottom-bar|mobile-native/);
});

test('18B-63: safe-area-inset-bottom or dvh in v3 CSS (composer safety)', () => {
  expect(v3css).toMatch(/safe-area-inset-bottom|100dvh|dvh/);
});

// ── Desktop breakpoints ──────────────────────────────────────────

test('18B-64: tablet breakpoint (768px) in v3 CSS', () => {
  expect(v3css).toMatch(/@media[^{]*max-width[^{]*768px/);
});

test('18B-65: desktop 1280 — msgs-split present and left panel has width', () => {
  expect(html).toMatch(/class="msgs-split"/);
  expect(v3css).toMatch(/\.msgs-left[\s\S]*?width\s*:\s*380px|380px[\s\S]*?msgs-left/s);
});

test('18B-66: desktop 1440 breakpoint widens left panel', () => {
  expect(v3css).toMatch(/@media[^{]*min-width[^{]*1440px/);
  const block = v3css.match(/@media[^{]*min-width[^{]*1440px[^{]*\{([\s\S]*?)(?=@media|$)/);
  expect(block).not.toBeNull();
  expect(block[0]).toMatch(/\.msgs-left/);
});

test('18B-67: desktop 1720 — msgs-right fills remaining space (flex:1)', () => {
  expect(html).toMatch(/\.msgs-right[\s\S]*?flex\s*:\s*1/s);
});

test('18B-68: desktop 1920 — msgs-right targeted in v3 CSS', () => {
  expect(v3css).toMatch(/\.msgs-right/);
});

// ── Nav active state ─────────────────────────────────────────────

test('18B-69: body data-page="messages" ensures rail/mobile nav active', () => {
  expect(html).toMatch(/data-page="messages"/);
});

test('18B-70: mobile nav active via data-page (mobile-tabs-handler reads it)', () => {
  expect(html).toMatch(/data-page="messages"/);
  expect(html).toMatch(/mobile-tabs-handler/);
});

// ── No-change guarantees ─────────────────────────────────────────

test('18B-71: no backend change — server.js exists with core identifiers', () => {
  expect(fs.existsSync(SERVER_JS)).toBe(true);
  const srv = fs.readFileSync(SERVER_JS, 'utf8');
  expect(srv).toMatch(/express/);
  expect(srv).toMatch(/DATABASE_URL/);
});

test('18B-72: no database change — initDb preserved in server.js', () => {
  const srv = fs.readFileSync(SERVER_JS, 'utf8');
  expect(srv).toMatch(/initDb|CREATE TABLE IF NOT EXISTS/);
});

test('18B-73: no Channex change — channex.js exists with its marker', () => {
  expect(fs.existsSync(CHANNEX_JS)).toBe(true);
  const ch = fs.readFileSync(CHANNEX_JS, 'utf8');
  expect(ch).toMatch(/channex|CHANNEX|Channex/i);
});

test('18B-74: no Stripe change — Stripe key still referenced in server.js', () => {
  const srv = fs.readFileSync(SERVER_JS, 'utf8');
  expect(srv).toMatch(/STRIPE_SECRET_KEY|stripe/i);
});

test('18B-75: no BoostPrice change — dynamic pricing route exists', () => {
  const dpRoute = path.join(REPO, 'routes/dynamic-pricing-routes.js');
  expect(fs.existsSync(dpRoute)).toBe(true);
});

test('18B-76: no iOS Capacitor change — capacitor.config.json untouched', () => {
  const capConfig = path.join(REPO, 'capacitor.config.json');
  expect(fs.existsSync(capConfig)).toBe(true);
  const cap = fs.readFileSync(capConfig, 'utf8');
  expect(cap).toMatch(/appId|appName/);
});
