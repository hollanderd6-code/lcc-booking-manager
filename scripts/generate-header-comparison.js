'use strict';

// Preview-only script — NO production changes.
// Generates header A vs B comparison for visual decision.

const fs   = require('fs');
const path = require('path');

process.env.APP_URL        = 'http://localhost:3000';
process.env.EMAIL_LOGO_URL = '';

const T              = require('../services/email/emailTokens');
const { emailButton } = require('../services/email/emailComponents');
const bhEmailTemplate = require('../services/email/emailLayout');

const OUT_DIR = path.join(__dirname, '..', 'tmp', 'email-previews');
fs.mkdirSync(OUT_DIR, { recursive: true });

const logoUrl    = `${process.env.APP_URL}/img/brand/android/icon-192.png`;
const downloadUrl = 'http://localhost:3000/download/abc123';
const year        = new Date().getFullYear();

// ── Body : STRICTEMENT identique entre A et B ────────────────────────────────
const sharedBodyHtml = `
  <p style="margin:0 0 14px;font-size:15px;color:#20221F;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">Bonjour <strong>Thomas &amp; Claire Renard</strong>,</p>
  <p style="margin:0 0 14px;font-size:15px;color:#20221F;line-height:1.75;font-family:Arial,Helvetica,sans-serif;">Votre facture pour votre séjour à <strong>Appartement Marais</strong> est disponible en téléchargement&nbsp;:</p>
  ${emailButton(downloadUrl, '📥 Télécharger ma facture')}
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;">Lien valable 1 an</p>
  <p style="font-size:14px;color:#666;margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;">Cordialement, <strong>Dupont &amp; Associés SARL</strong></p>
`;

// ── Wrapper commun (outer table + footer) — identique entre A et B ────────────
function wrapEmail(headerHtml) {
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
    @media only screen and (max-width:620px){
      .email-inner{padding:0 8px !important;}
      .email-card{padding:20px 16px !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${T.fondCreme};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${T.fondCreme};">
  <tr>
    <td align="center" class="email-inner" style="padding:28px 16px;">
      <!--[if mso]><table width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

        ${headerHtml}

        <!-- BODY — identique A/B -->
        <tr>
          <td class="email-card" style="background-color:#FFFFFF;padding:28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${T.encre};line-height:1.6;">
            ${sharedBodyHtml}
          </td>
        </tr>

        <!-- FOOTER — identique A/B -->
        <tr>
          <td style="background-color:${T.footerBg};border-radius:0 0 12px 12px;padding:20px 28px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${T.footerText};line-height:1.5;">
              &copy; ${year} Boostinghost &mdash; Plateforme de gestion locative.
            </p>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── VERSION A — header vert actuel ────────────────────────────────────────────
const headerA = `
<tr>
  <td align="left" style="background-color:${T.vert900};border-radius:12px 12px 0 0;padding:20px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:middle;">
          <img src="${logoUrl}" alt="Boostinghost" width="44" height="44"
               style="display:block;border:0;border-radius:8px;width:44px;height:44px;">
        </td>
        <td style="vertical-align:middle;padding-left:12px;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.7);">Boostinghost</span>
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;">
      <tr>
        <td>
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.55);">📄 Votre facture</span><br>
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#FFFFFF;line-height:1.25;display:block;margin-top:6px;">Votre facture est disponible</span>
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${T.footerText};line-height:1.4;display:block;margin-top:4px;">Appartement Marais</span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

// ── VERSION B — header clair premium ─────────────────────────────────────────
const headerB = `
<tr>
  <td align="left" style="background-color:${T.ivoire};border-radius:12px 12px 0 0;padding:24px 28px 20px 28px;border-bottom:1px solid ${T.ligne};">
    <!-- Logo + wordmark -->
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:middle;">
          <img src="${logoUrl}" alt="Boostinghost" width="44" height="44"
               style="display:block;border:0;border-radius:10px;width:44px;height:44px;">
        </td>
        <td style="vertical-align:middle;padding-left:11px;">
          <span style="font-family:Georgia,serif;font-size:17px;font-weight:bold;color:${T.vert800};letter-spacing:0.3px;">Boostinghost</span>
        </td>
      </tr>
    </table>
    <!-- Eyebrow + titre + sous-titre -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:22px;">
      <tr>
        <td>
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:${T.vert600};">Votre facture</span>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:800;color:${T.encre};line-height:1.2;margin-top:6px;letter-spacing:-0.3px;">Votre facture est disponible</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${T.t2};line-height:1.5;margin-top:6px;">Retrouvez les détails de votre séjour.</div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

const htmlA = wrapEmail(headerA);
const htmlB = wrapEmail(headerB);

fs.writeFileSync(path.join(OUT_DIR, 'invoice-header-A.html'), htmlA, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'invoice-header-B.html'), htmlB, 'utf8');

console.log('✅  invoice-header-A.html');
console.log('✅  invoice-header-B.html');
