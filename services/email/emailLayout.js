'use strict';

const T = require('./emailTokens');

// Logo: EMAIL_LOGO_URL > APP_URL/img/brand/email/logo-email.png > text fallback
// Dedicated email asset — decoupled from app icon lifecycle (android/ios untouched).
function logoHtml() {
  const src = process.env.EMAIL_LOGO_URL ||
    (process.env.APP_URL ? `${process.env.APP_URL}/img/brand/email/logo-email.png` : null);
  if (src) {
    return `<img src="${src}" alt="Boostinghost" width="48" height="48" style="display:block;border:0;border-radius:10px;width:48px;height:48px;">`;
  }
  // Text fallback: styled monogram
  return `<span style="display:inline-block;width:48px;height:48px;line-height:48px;text-align:center;background-color:${T.vert800};border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:${T.ivoire};">B</span>`;
}

/**
 * Drop-in replacement for bhEmailTemplate().
 * `icon` parameter is accepted but not rendered (backward-compat).
 *
 * @param {object} params
 * @param {string} [params.icon]         — ignored (kept for backward compat)
 * @param {string} params.title
 * @param {string} [params.subtitle]
 * @param {string} [params.tag]
 * @param {string} params.bodyHtml
 * @param {string} [params.footerNote]
 * @param {string} [params.accentColor]  — ignored (design system uses tokens)
 * @param {string} [params.preheader]
 */
function bhEmailTemplate({ icon, title, subtitle, tag, bodyHtml, footerNote, accentColor, preheader } = {}) {
  const year     = new Date().getFullYear();
  const tagLabel = tag || subtitle || '';
  const preText  = preheader || (tagLabel ? `${title} — ${tagLabel}` : title) || '';

  // Progressive-enhancement styles (stripped by Gmail but harmless):
  const styleBlock = `<style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
    a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
    @media only screen and (max-width:620px){
      .email-inner{padding:0 8px !important;}
      .email-card{padding:20px !important;}
    }
  </style>`;

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  ${styleBlock}
</head>
<body style="margin:0;padding:0;background-color:${T.fondCreme};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<!-- Preheader (invisible) -->
<div style="display:none;font-size:1px;color:${T.fondCreme};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preText}&nbsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;</div>

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${T.fondCreme};">
  <tr>
    <td align="center" class="email-inner" style="padding:28px 16px;">

      <!--[if mso]><table width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

        <!-- HEADER — fond crème, logo 48px, wordmark, eyebrow, titre -->
        <tr>
          <td style="background-color:${T.ivoire};border-radius:12px 12px 0 0;padding:24px 28px 20px;border-bottom:1px solid ${T.ligne};">

            <!-- Logo + wordmark -->
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">${logoHtml()}</td>
                <td style="vertical-align:middle;padding-left:10px;">
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${T.vert800};letter-spacing:0.1px;line-height:1;">Boostinghost</span>
                </td>
              </tr>
            </table>

            <!-- Eyebrow + titre -->
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;">
              <tr>
                <td style="word-break:break-word;overflow-wrap:break-word;">
                  ${tagLabel ? `<span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:${T.vert600};">${tagLabel}</span><br>` : ''}
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:${T.encre};line-height:1.25;display:block;margin-top:${tagLabel ? '6px' : '0'};">${title || ''}</span>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td class="email-card" style="background-color:#FFFFFF;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${T.encre};line-height:1.6;word-break:break-word;overflow-wrap:break-word;">
            ${bodyHtml || ''}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:${T.footerBg};border-radius:0 0 12px 12px;padding:20px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${T.footerText};line-height:1.5;word-break:break-word;overflow-wrap:break-word;">
                  ${footerNote ? `<p style="margin:0 0 5px 0;font-size:11px;opacity:0.75;">${footerNote}</p>` : ''}
                  <p style="margin:0;">&copy; ${year} Boostinghost &mdash; La gestion de vos locations, simplement.</p>
                </td>
              </tr>
            </table>
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

module.exports = bhEmailTemplate;
