/* ============================================================
   BH-MESSAGES-IOS-07C — Actionable enrichment layer
   ============================================================
   Responsibilities (read-only, non-destructive):
   - Add CSS classes to conversation items based on window.allConversations
   - Inject "IA en pause" and "✨ Brouillon prêt" badges
   - Never modifies chat-owner.js or its data

   Classes added to .conversation-item elements:
     conv-escalated    : conv.escalated === true
     conv-ai-paused    : conv.ai_disabled === true
     conv-has-suggestion : conv.has_suggestion === true

   Badges injected into .conversation-content:
     .bh-conv-badge--ai-paused   when ai_disabled
     .bh-conv-badge--suggestion  when has_suggestion

   Filter hiding is CSS-only — see bh-messages-ios-07c.css.
   ============================================================ */

(function () {
  'use strict';

  if (window.__bhMessages07c) return;
  window.__bhMessages07c = true;

  function enrichItems(list) {
    var convs = window.allConversations;
    if (!convs || !convs.length) return;

    list.querySelectorAll('.conversation-item[data-conversation-id]').forEach(function (el) {
      var id  = String(el.getAttribute('data-conversation-id'));
      var conv = convs.find(function (c) { return String(c.id) === id; });
      if (!conv) return;

      // ── Structural classes ─────────────────────────────────
      el.classList.toggle('conv-escalated',     conv.escalated     === true);
      el.classList.toggle('conv-ai-paused',     conv.ai_disabled   === true);
      el.classList.toggle('conv-has-suggestion', conv.has_suggestion === true);

      // ── Badges ────────────────────────────────────────────
      injectBadges(el, conv);
    });
  }

  function injectBadges(el, conv) {
    // Remove stale badges from previous render
    el.querySelectorAll('.bh-conv-badges-row').forEach(function (b) { b.remove(); });

    var badges = [];
    if (conv.ai_disabled   === true) badges.push('<span class="bh-conv-badge bh-conv-badge--ai-paused">IA en pause</span>');
    if (conv.has_suggestion === true) badges.push('<span class="bh-conv-badge bh-conv-badge--suggestion">✨ Brouillon prêt</span>');
    if (!badges.length) return;

    var content = el.querySelector('.conversation-content');
    if (!content) return;

    var row = document.createElement('div');
    row.className = 'bh-conv-badges-row';
    row.innerHTML = badges.join('');

    // Insert before the first hidden element so badges appear before the display:none block
    var firstHidden = content.querySelector('.conversation-actions, .status-badge, .meta');
    if (firstHidden) {
      content.insertBefore(row, firstHidden);
    } else {
      content.appendChild(row);
    }
  }

  // ── Wire observer ──────────────────────────────────────────────
  function attachObserver() {
    var list = document.getElementById('conversationsList');
    if (!list) return;
    new MutationObserver(function () {
      enrichItems(list);
    }).observe(list, { childList: true, subtree: false });
  }

  // ── Initial enrichment after allConversations is available ─────
  var _waitTicks = 0;
  function waitAndEnrich() {
    var list = document.getElementById('conversationsList');
    if (list && window.allConversations && window.allConversations.length > 0) {
      enrichItems(list);
      return;
    }
    if (_waitTicks++ < 60) setTimeout(waitAndEnrich, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      attachObserver();
      waitAndEnrich();
    });
  } else {
    attachObserver();
    waitAndEnrich();
  }
})();
