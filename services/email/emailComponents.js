'use strict';

const T = require('./emailTokens');

// ── Security ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Button / CTA ────────────────────────────────────────────────────────────

/**
 * Full-width CTA button (table-based for Outlook).
 * max-width:100% + box-sizing:border-box prevent horizontal overflow at any viewport.
 *
 * @param {string} href  — URL (already sanitized by caller)
 * @param {string} label — visible text (will be escaped)
 * @param {object} opts  — { color, textColor, icon }
 */
function emailButton(href, label, opts = {}) {
  const bg   = opts.color     || T.vert800;
  const fg   = opts.textColor || T.ctaText;
  const icon = opts.icon ? `${escapeHtml(opts.icon)} ` : '';
  const safe = escapeHtml(label);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
  <tr>
    <td align="center">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" fillcolor="${bg}" stroke="f"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${icon}${safe}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" target="_blank" style="display:inline-block;max-width:100%;box-sizing:border-box;background-color:${bg};color:${fg} !important;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.3;padding:14px 24px;border-radius:8px;word-break:break-word;mso-hide:all;">${icon}${safe}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`.trim();
}

// ── CTA Block (button + framed background) ──────────────────────────────────

/**
 * Framed block (card bg, border) containing optional title/text and a button.
 */
function emailCTABlock(href, buttonLabel, opts = {}) {
  const title = opts.title
    ? `<p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:${T.encre};">${escapeHtml(opts.title)}</p>`
    : '';
  const text = opts.text
    ? `<p style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${T.t2};line-height:1.5;">${escapeHtml(opts.text)}</p>`
    : '';
  const btn = emailButton(href, buttonLabel, opts.buttonOpts || {});
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="background-color:${T.card};border:1px solid ${T.cardBorder};border-radius:12px;padding:20px;word-break:break-word;overflow-wrap:break-word;">
      ${title}${text}${btn}
    </td>
  </tr>
</table>`.trim();
}

// ── Info / Success / Danger Cards ────────────────────────────────────────────

const CARD_STYLES = {
  info: {
    bg:     T.card,
    border: `4px solid ${T.vert800}`,
    color:  T.encre,
  },
  success: {
    bg:     T.successBg,
    border: `4px solid ${T.vert600}`,
    color:  T.encre,
  },
  danger: {
    bg:     T.terraDoux,
    border: `4px solid ${T.terra}`,
    color:  T.terra,
  },
  warning: {
    bg:     '#FFFBEB',
    border: `4px solid #D97706`,
    color:  T.encre,
  },
  neutral: {
    bg:     T.card,
    border: `1px solid ${T.ligne}`,
    color:  T.encre,
  },
};

/**
 * Bordered info/success/danger card with left accent.
 * word-break + overflow-wrap prevent horizontal overflow at any viewport.
 *
 * @param {'info'|'success'|'danger'|'warning'|'neutral'} kind
 * @param {string} innerHtml — pre-built HTML (escape user data before passing)
 */
function emailCard(kind, innerHtml) {
  const s = CARD_STYLES[kind] || CARD_STYLES.info;
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="background-color:${s.bg};border-left:${s.border};border-radius:4px;padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${s.color};line-height:1.6;word-break:break-word;overflow-wrap:break-word;">
      ${innerHtml}
    </td>
  </tr>
</table>`.trim();
}

// ── Divider ──────────────────────────────────────────────────────────────────

function emailDivider() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-top:1px solid ${T.ligne};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

// ── Booking summary table ────────────────────────────────────────────────────

/**
 * Two-column key/value table for booking details.
 * @param {Array<{label:string, value:string}>} rows — both label and value escaped internally
 */
function emailBookingSummary(rows) {
  const cells = rows.map(r => `
    <tr>
      <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${T.t2};width:40%;word-break:break-word;">${escapeHtml(r.label)}</td>
      <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${T.encre};font-weight:bold;word-break:break-word;">${escapeHtml(r.value)}</td>
    </tr>`).join('');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;">
  ${cells}
</table>`.trim();
}

module.exports = {
  escapeHtml,
  emailButton,
  emailCTABlock,
  emailCard,
  emailDivider,
  emailBookingSummary,
};
