/**
 * Premium transactional email layout (table-based, inline CSS).
 * Compatible with Gmail, Outlook, Apple Mail, mobile clients.
 */
import {
  EMAIL_BRAND as B,
  escapeHtml,
  getEmailLogoUrl,
  getSupportEmail,
  getSupportWebsite,
  getSupportWhatsApp,
} from "./brand.js";

export type EmailLayoutOpts = {
  /** Preheader text (inbox preview) */
  preheader?: string;
  /** Main body HTML (already escaped where needed) */
  bodyHtml: string;
  /** Optional eyebrow under logo */
  eyebrow?: string;
};

function logoBlock(): string {
  const logoUrl = getEmailLogoUrl();
  if (logoUrl) {
    return `
      <a href="${escapeHtml(getSupportWebsite())}" style="text-decoration:none;">
        <img src="${escapeHtml(logoUrl)}" width="160" height="40" alt="Massive Mentor"
          style="display:block;border:0;outline:none;height:40px;width:auto;max-width:180px;" />
      </a>`;
  }
  // Fallback: branded wordmark (no external image required)
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="vertical-align:middle;padding-right:12px;">
          <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,${B.violet} 0%,${B.sky} 100%);background-color:${B.violet};text-align:center;line-height:40px;color:${B.white};font-weight:700;font-size:18px;font-family:${B.font};">
            M
          </div>
        </td>
        <td style="vertical-align:middle;">
          <div style="font-family:${B.font};font-size:18px;font-weight:700;color:${B.white};letter-spacing:-0.02em;line-height:1.2;">
            Massive Mentor
          </div>
          <div style="font-family:${B.font};font-size:11px;font-weight:600;color:#a1a1aa;letter-spacing:0.12em;text-transform:uppercase;margin-top:2px;">
            CRM
          </div>
        </td>
      </tr>
    </table>`;
}

/**
 * Wrap content in the Massive Mentor branded shell.
 */
export function renderEmailLayout(opts: EmailLayoutOpts): string {
  const preheader = opts.preheader
    ? escapeHtml(opts.preheader)
    : "Message from Massive Mentor CRM";
  const supportEmail = escapeHtml(getSupportEmail());
  const supportWa = escapeHtml(getSupportWhatsApp());
  const website = escapeHtml(getSupportWebsite());
  const waDigits = getSupportWhatsApp().replace(/[^\d]/g, "");
  const waLink = `https://wa.me/${waDigits}`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
  <title>Massive Mentor CRM</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style>table,td{font-family:Arial,Helvetica,sans-serif !important;}</style>
  <![endif]-->
  <style type="text/css">
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
    img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
    body{margin:0 !important;padding:0 !important;width:100% !important;}
    a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
    @media only screen and (max-width:620px){
      .mm-container{width:100% !important;max-width:100% !important;}
      .mm-pad{padding-left:20px !important;padding-right:20px !important;}
      .mm-btn{display:block !important;width:100% !important;}
      .mm-stack{display:block !important;width:100% !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${B.pageBg};font-family:${B.font};">
  <!-- Preheader (hidden inbox preview) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${preheader}
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${B.pageBg};">
    <tr>
      <td align="center" style="padding:28px 12px 40px 12px;">

        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="mm-container" style="width:600px;max-width:600px;background-color:${B.cardBg};border-radius:16px;overflow:hidden;border:1px solid ${B.cardBorder};box-shadow:0 8px 30px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color:${B.headerBg};background:linear-gradient(135deg,#0a0a0b 0%,#1a1030 55%,#0c1929 100%);padding:28px 32px;" class="mm-pad">
              ${logoBlock()}
              ${
                opts.eyebrow
                  ? `<div style="margin-top:14px;font-family:${B.font};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#c4b5fd;">${escapeHtml(opts.eyebrow)}</div>`
                  : ""
              }
            </td>
          </tr>

          <!-- Accent bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${B.violet} 0%,${B.sky} 100%);background-color:${B.violet};font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="mm-pad" style="padding:32px 32px 8px 32px;font-family:${B.font};color:${B.text};font-size:15px;line-height:1.6;">
              ${opts.bodyHtml}
            </td>
          </tr>

          <!-- Support -->
          <tr>
            <td class="mm-pad" style="padding:8px 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fafafa;border:1px solid ${B.cardBorder};border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px;font-family:${B.font};">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${B.textSubtle};margin-bottom:10px;">
                      Need help?
                    </div>
                    <div style="font-size:13px;color:${B.textMuted};line-height:1.7;">
                      <strong style="color:${B.text};">Support Email:</strong>
                      <a href="mailto:${supportEmail}" style="color:${B.violet};text-decoration:none;">${supportEmail}</a><br/>
                      <strong style="color:${B.text};">WhatsApp:</strong>
                      <a href="${escapeHtml(waLink)}" style="color:${B.violet};text-decoration:none;">${supportWa}</a><br/>
                      <strong style="color:${B.text};">Website:</strong>
                      <a href="${website}" style="color:${B.violet};text-decoration:none;">${website}</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="mm-pad" style="padding:20px 32px 28px 32px;background-color:${B.footerBg};border-top:1px solid ${B.cardBorder};">
              <div style="font-family:${B.font};font-size:12px;color:${B.textSubtle};line-height:1.6;text-align:center;">
                &copy; ${B.year} Massive Mentor CRM. All rights reserved.<br/>
                <span style="color:#a1a1aa;">Enterprise CRM for modern sales teams</span>
              </div>
            </td>
          </tr>

        </table>
        <!-- /Card -->

        <div style="font-family:${B.font};font-size:11px;color:#a1a1aa;text-align:center;padding:16px 12px 0 12px;line-height:1.5;">
          You received this email because of activity on your Massive Mentor account.
        </div>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Primary CTA button (bulletproof for Outlook via VML-ish padding). */
export function ctaButton(label: string, href: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px 0;">
      <tr>
        <td align="center" bgcolor="${B.violet}" style="border-radius:10px;background-color:${B.violet};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeHref}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="${B.violet}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${safeLabel}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a class="mm-btn" href="${safeHref}"
             style="display:inline-block;background-color:${B.violet};color:${B.white} !important;font-family:${B.font};font-size:15px;font-weight:600;line-height:48px;text-align:center;text-decoration:none;padding:0 28px;border-radius:10px;mso-hide:all;">
            ${safeLabel}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>`;
}

/** Key-value detail card (credentials, invoice lines, etc.) */
export function detailCard(
  rows: Array<{ label: string; value: string; mono?: boolean; emphasize?: boolean }>
): string {
  const cells = rows
    .map((r, i) => {
      const border =
        i < rows.length - 1 ? `border-bottom:1px solid ${B.cardBorder};` : "";
      const valueStyle = r.mono
        ? `font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;letter-spacing:0.02em;white-space:nowrap;`
        : `font-family:${B.font};font-size:14px;`;
      const weight = r.emphasize ? "700" : "600";
      // CRITICAL: mono credential values must have ZERO whitespace around the text node
      // (newlines/indentation inside <td> become leading/trailing spaces on copy-paste in Gmail/Outlook).
      const valueHtml = r.mono
        ? `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;font-weight:${weight};letter-spacing:0.02em;color:${B.text};background:transparent;border:0;padding:0;margin:0;white-space:nowrap;">${escapeHtml(r.value)}</code>`
        : escapeHtml(r.value);
      return (
        `<tr>` +
        `<td style="padding:12px 0;${border}vertical-align:top;width:38%;font-family:${B.font};font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${B.textSubtle};">${escapeHtml(r.label)}</td>` +
        // No newline/space between > and value — copy selects clean password/email only
        `<td style="padding:12px 0;${border}vertical-align:top;${valueStyle}font-weight:${weight};color:${B.text};word-break:break-word;">${valueHtml}</td>` +
        `</tr>`
      );
    })
    .join("");

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
      style="background-color:#fafafa;border:1px solid ${B.cardBorder};border-radius:12px;margin:20px 0;">
      <tr>
        <td style="padding:4px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${cells}
          </table>
        </td>
      </tr>
    </table>`;
}

export function securityNotice(text: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 8px 0;">
      <tr>
        <td style="padding:14px 16px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-family:${B.font};font-size:13px;line-height:1.55;color:#92400e;">
          <strong style="color:#b45309;">Security notice:</strong> ${escapeHtml(text)}
        </td>
      </tr>
    </table>`;
}

export function heading(title: string): string {
  return `<h1 style="margin:0 0 12px 0;font-family:${B.font};font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${B.text};line-height:1.3;">${escapeHtml(title)}</h1>`;
}

export function paragraph(text: string, opts?: { muted?: boolean }): string {
  const color = opts?.muted ? B.textMuted : B.text;
  return `<p style="margin:0 0 14px 0;font-family:${B.font};font-size:15px;line-height:1.65;color:${color};">${text}</p>`;
}

/** Safe paragraph with auto-escaped plain text */
export function pText(text: string, opts?: { muted?: boolean }): string {
  return paragraph(escapeHtml(text), opts);
}
