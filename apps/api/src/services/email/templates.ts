/**
 * Premium transactional email templates for Massive Mentor CRM.
 * All return { subject, text, html } for sendEmail().
 */
import {
  escapeHtml,
  formatDateLong,
  formatMoneyInr,
  getAppUrl,
  getLoginUrl,
  getSupportEmail,
  getSupportWebsite,
  getSupportWhatsApp,
} from "@/services/email/brand";
import {
  ctaButton,
  detailCard,
  heading,
  pText,
  paragraph,
  renderEmailLayout,
  securityNotice,
} from "@/services/email/layout";

export type BuiltEmail = {
  subject: string;
  text: string;
  html: string;
};

function footerText(): string {
  return [
    ``,
    `—`,
    `Support: ${getSupportEmail()}`,
    `WhatsApp: ${getSupportWhatsApp()}`,
    `Website: ${getSupportWebsite()}`,
    ``,
    `© 2026 Massive Mentor CRM. All rights reserved.`,
  ].join("\n");
}

/* ═══════════════════════════════════════════════════════════
   1. Welcome Account
   ═══════════════════════════════════════════════════════════ */

export function buildWelcomeAccountEmail(opts: {
  companyName: string;
  ownerName?: string | null;
  email: string;
  temporaryPassword: string;
  trialEndDate?: Date | string | null;
  loginUrl?: string;
}): BuiltEmail {
  const loginUrl = opts.loginUrl || getLoginUrl("/login");
  const who = opts.ownerName?.trim() || "there";
  const trialEnd = formatDateLong(opts.trialEndDate);
  const subject = "Welcome to Massive Mentor CRM";

  const text = [
    `Welcome to Massive Mentor CRM`,
    ``,
    `Hi ${who},`,
    ``,
    `Your CRM workspace is ready.`,
    ``,
    `Company Name: ${opts.companyName}`,
    `Username (Email): ${opts.email}`,
    `Temporary Password: ${opts.temporaryPassword}`,
    `Trial End Date: ${trialEnd}`,
    ``,
    `Login: ${loginUrl}`,
    ``,
    `For your security, please change your password after your first login.`,
    footerText(),
  ].join("\n");

  const bodyHtml = `
    ${heading("Welcome to Massive Mentor CRM")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `Your workspace for <strong>${escapeHtml(opts.companyName)}</strong> is ready. Sign in with the credentials below to start managing leads, deals, and your sales pipeline.`
    )}
    ${detailCard([
      { label: "Company Name", value: opts.companyName },
      { label: "Username (Email)", value: opts.email, mono: true },
      { label: "Temporary Password", value: opts.temporaryPassword, mono: true, emphasize: true },
      { label: "Trial End Date", value: trialEnd },
    ])}
    ${ctaButton("Login to CRM", loginUrl)}
    ${securityNotice(
      "For your security, please change your password after your first login."
    )}
    ${pText("If you did not expect this email, contact our support team immediately.", {
      muted: true,
    })}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `Your ${opts.companyName} CRM account is ready — login credentials inside`,
      eyebrow: "Account welcome",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   2. Password Reset
   ═══════════════════════════════════════════════════════════ */

export function buildPasswordResetEmail(opts: {
  name?: string | null;
  resetUrl: string;
  portalLabel: string;
  ttlMinutes: number;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const subject = `Reset your ${opts.portalLabel} password`;
  const loginUrl = getLoginUrl("/login");

  const text = [
    `Hi ${who},`,
    ``,
    `We received a request to reset your Massive Mentor ${opts.portalLabel} password.`,
    ``,
    `Open this link to choose a new password (expires in ${opts.ttlMinutes} minutes):`,
    opts.resetUrl,
    ``,
    `If you did not request this, you can ignore this email. Your password will not change.`,
    ``,
    `Login to CRM: ${loginUrl}`,
    footerText(),
  ].join("\n");

  const bodyHtml = `
    ${heading("Reset your password")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `We received a request to reset your <strong>Massive Mentor ${escapeHtml(opts.portalLabel)}</strong> password.`
    )}
    ${ctaButton("Choose new password", opts.resetUrl)}
    ${paragraph(
      `This link expires in <strong>${opts.ttlMinutes} minutes</strong> and can be used only once.`,
      { muted: true }
    )}
    ${securityNotice(
      "If you did not request a password reset, you can safely ignore this email. Your password will not change."
    )}
    ${paragraph(
      `Prefer to sign in instead? <a href="${escapeHtml(loginUrl)}" style="color:#7c3aed;text-decoration:none;font-weight:600;">Login to CRM</a>`,
      { muted: true }
    )}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `Password reset link — expires in ${opts.ttlMinutes} minutes`,
      eyebrow: "Security",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   3. Trial Expiry Reminder
   ═══════════════════════════════════════════════════════════ */

export function buildTrialExpiryReminderEmail(opts: {
  name?: string | null;
  companyName: string;
  daysLeft: number;
  trialEndDate?: Date | string | null;
  billingUrl?: string;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const billingUrl = opts.billingUrl || getLoginUrl("/dashboard/billing");
  const loginUrl = getLoginUrl("/login");
  const trialEnd = formatDateLong(opts.trialEndDate);

  const msg =
    opts.daysLeft <= 0
      ? "Today is your last trial day."
      : opts.daysLeft === 1
        ? "Only 1 day remaining on your free trial."
        : `Your free trial expires in ${opts.daysLeft} days.`;

  const subject =
    opts.daysLeft <= 0
      ? "Your Massive Mentor CRM trial ends today"
      : `Trial reminder — ${msg}`;

  const text = [
    `Hi ${who},`,
    ``,
    msg,
    ``,
    `Company: ${opts.companyName}`,
    `Trial End Date: ${trialEnd}`,
    ``,
    `Subscribe in Billing to keep full access to your CRM.`,
    `Billing: ${billingUrl}`,
    `Login: ${loginUrl}`,
    footerText(),
  ].join("\n");

  const bodyHtml = `
    ${heading(opts.daysLeft <= 0 ? "Your trial ends today" : "Trial expiry reminder")}
    ${pText(`Hi ${who},`)}
    ${paragraph(`<strong>${escapeHtml(msg)}</strong>`)}
    ${paragraph(
      `Your free trial for <strong>${escapeHtml(opts.companyName)}</strong> is coming to a close. Subscribe now to keep leads, deals, finance, and AI tools online without interruption.`
    )}
    ${detailCard([
      { label: "Company Name", value: opts.companyName },
      { label: "Trial End Date", value: trialEnd },
      {
        label: "Days remaining",
        value: opts.daysLeft <= 0 ? "Ends today" : String(opts.daysLeft),
        emphasize: true,
      },
    ])}
    ${ctaButton("Upgrade & keep access", billingUrl)}
    ${paragraph(
      `<a href="${escapeHtml(loginUrl)}" style="color:#7c3aed;text-decoration:none;font-weight:600;">Login to CRM</a> anytime to review your workspace.`,
      { muted: true }
    )}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: msg,
      eyebrow: "Billing",
      bodyHtml,
    }),
  };
}

/** Trial fully expired / account locked */
export function buildTrialExpiredEmail(opts: {
  name?: string | null;
  companyName: string;
  loginUrl?: string;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const loginUrl = opts.loginUrl || getLoginUrl("/login");
  const billingUrl = getLoginUrl("/dashboard/billing");
  const subject = "Your Massive Mentor CRM free trial has expired";

  const text = [
    `Hi ${who},`,
    ``,
    `Your free trial for ${opts.companyName} has ended.`,
    `Subscribe to continue using Massive Mentor CRM.`,
    ``,
    `Login: ${loginUrl}`,
    `Billing: ${billingUrl}`,
    footerText(),
  ].join("\n");

  const bodyHtml = `
    ${heading("Your free trial has ended")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `The free trial for <strong>${escapeHtml(opts.companyName)}</strong> has expired and CRM access is locked until you subscribe.`
    )}
    ${detailCard([
      { label: "Company Name", value: opts.companyName },
      { label: "Status", value: "Trial expired", emphasize: true },
    ])}
    ${ctaButton("Subscribe now", billingUrl)}
    ${paragraph(
      `Already paid? <a href="${escapeHtml(loginUrl)}" style="color:#7c3aed;text-decoration:none;font-weight:600;">Login to CRM</a> to continue.`,
      { muted: true }
    )}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `Trial ended for ${opts.companyName} — subscribe to restore access`,
      eyebrow: "Billing",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   4. Subscription Activated
   ═══════════════════════════════════════════════════════════ */

export function buildSubscriptionActivatedEmail(opts: {
  name?: string | null;
  companyName: string;
  planName: string;
  validUntil?: Date | string | null;
  loginUrl?: string;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const loginUrl = opts.loginUrl || getLoginUrl("/login");
  const until = formatDateLong(opts.validUntil);
  const subject = `Subscription activated — ${opts.planName} | Massive Mentor CRM`;

  const text = [
    `Hi ${who},`,
    ``,
    `Your ${opts.planName} subscription is active for ${opts.companyName}.`,
    `Valid until: ${until}`,
    ``,
    `Your CRM is fully unlocked.`,
    `Login: ${loginUrl}`,
    footerText(),
  ].join("\n");

  const bodyHtml = `
    ${heading("Subscription activated")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `Great news — <strong>${escapeHtml(opts.planName)}</strong> is now active for <strong>${escapeHtml(opts.companyName)}</strong>. Your CRM is unlocked and ready for your team.`
    )}
    ${detailCard([
      { label: "Company Name", value: opts.companyName },
      { label: "Plan", value: opts.planName, emphasize: true },
      { label: "Valid until", value: until },
    ])}
    ${ctaButton("Login to CRM", loginUrl)}
    ${pText("Thank you for choosing Massive Mentor.", { muted: true })}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `${opts.planName} is live for ${opts.companyName}`,
      eyebrow: "Subscription",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   5. Payment Success
   ═══════════════════════════════════════════════════════════ */

export function buildPaymentSuccessEmail(opts: {
  name?: string | null;
  companyName: string;
  planName: string;
  amount: number | string;
  invoiceNumber?: string | null;
  paymentId?: string | null;
  validUntil?: Date | string | null;
  currencyLabel?: string;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const loginUrl = getLoginUrl("/login");
  const amountStr =
    typeof opts.amount === "number" || /^\d+(\.\d+)?$/.test(String(opts.amount))
      ? formatMoneyInr(opts.amount)
      : String(opts.amount);
  const until = formatDateLong(opts.validUntil);
  const subject = `Payment successful — ${opts.planName} | Massive Mentor CRM`;

  const text = [
    `Hi ${who},`,
    ``,
    `Thank you for your payment.`,
    ``,
    `Company: ${opts.companyName}`,
    `Plan: ${opts.planName}`,
    `Amount: ${amountStr}`,
    opts.invoiceNumber ? `Invoice: ${opts.invoiceNumber}` : "",
    until !== "—" ? `Valid until: ${until}` : "",
    opts.paymentId ? `Payment ID: ${opts.paymentId}` : "",
    ``,
    `Your CRM is unlocked.`,
    `Login: ${loginUrl}`,
    footerText(),
  ]
    .filter(Boolean)
    .join("\n");

  const rows: Array<{ label: string; value: string; mono?: boolean; emphasize?: boolean }> = [
    { label: "Company Name", value: opts.companyName },
    { label: "Plan", value: opts.planName },
    { label: "Amount", value: amountStr, emphasize: true },
  ];
  if (opts.invoiceNumber) rows.push({ label: "Invoice", value: opts.invoiceNumber, mono: true });
  if (until !== "—") rows.push({ label: "Valid until", value: until });
  if (opts.paymentId) rows.push({ label: "Payment ID", value: opts.paymentId, mono: true });

  const bodyHtml = `
    ${heading("Payment successful")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `We've received your payment. Thank you for subscribing to Massive Mentor CRM.`
    )}
    ${detailCard(rows)}
    ${ctaButton("Login to CRM", loginUrl)}
    ${pText("A receipt is available in Billing inside your workspace.", { muted: true })}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `Payment received for ${opts.planName} — ${amountStr}`,
      eyebrow: "Payment",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   6. Invoice Generated
   ═══════════════════════════════════════════════════════════ */

export function buildInvoiceGeneratedEmail(opts: {
  name?: string | null;
  companyName: string;
  invoiceNumber: string;
  amount: number | string;
  planName?: string | null;
  dueDate?: Date | string | null;
  periodLabel?: string | null;
  invoiceUrl?: string | null;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const loginUrl = getLoginUrl("/dashboard/billing");
  const amountStr =
    typeof opts.amount === "number" || /^\d+(\.\d+)?$/.test(String(opts.amount))
      ? formatMoneyInr(opts.amount)
      : String(opts.amount);
  const subject = `Invoice ${opts.invoiceNumber} — Massive Mentor CRM`;

  const text = [
    `Hi ${who},`,
    ``,
    `A new invoice has been generated for ${opts.companyName}.`,
    ``,
    `Invoice: ${opts.invoiceNumber}`,
    opts.planName ? `Plan: ${opts.planName}` : "",
    `Amount: ${amountStr}`,
    opts.dueDate ? `Due: ${formatDateLong(opts.dueDate)}` : "",
    opts.periodLabel ? `Period: ${opts.periodLabel}` : "",
    ``,
    `View billing: ${opts.invoiceUrl || loginUrl}`,
    footerText(),
  ]
    .filter(Boolean)
    .join("\n");

  const rows: Array<{ label: string; value: string; mono?: boolean; emphasize?: boolean }> = [
    { label: "Company Name", value: opts.companyName },
    { label: "Invoice #", value: opts.invoiceNumber, mono: true, emphasize: true },
    { label: "Amount", value: amountStr, emphasize: true },
  ];
  if (opts.planName) rows.push({ label: "Plan", value: opts.planName });
  if (opts.periodLabel) rows.push({ label: "Period", value: opts.periodLabel });
  if (opts.dueDate) rows.push({ label: "Due date", value: formatDateLong(opts.dueDate) });

  const bodyHtml = `
    ${heading("Invoice generated")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `Your invoice for <strong>${escapeHtml(opts.companyName)}</strong> is ready.`
    )}
    ${detailCard(rows)}
    ${ctaButton("View invoice in CRM", opts.invoiceUrl || loginUrl)}
    ${pText("Questions about this invoice? Reach us via the support contacts below.", {
      muted: true,
    })}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `Invoice ${opts.invoiceNumber} for ${amountStr}`,
      eyebrow: "Invoice",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   7. Invitation Email
   ═══════════════════════════════════════════════════════════ */

export function buildInvitationEmail(opts: {
  inviteeName?: string | null;
  inviteeEmail: string;
  inviterName?: string | null;
  companyName: string;
  roleLabel?: string | null;
  temporaryPassword?: string | null;
  loginUrl?: string;
  acceptUrl?: string | null;
}): BuiltEmail {
  const who = opts.inviteeName?.trim() || "there";
  const inviter = opts.inviterName?.trim() || "A teammate";
  const loginUrl = opts.loginUrl || opts.acceptUrl || getLoginUrl("/login");
  const role = opts.roleLabel?.trim() || "Team member";
  const subject = `You're invited to ${opts.companyName} on Massive Mentor CRM`;

  const textLines = [
    `Hi ${who},`,
    ``,
    `${inviter} invited you to join ${opts.companyName} on Massive Mentor CRM.`,
    ``,
    `Company Name: ${opts.companyName}`,
    `Username (Email): ${opts.inviteeEmail}`,
    `Role: ${role}`,
  ];
  if (opts.temporaryPassword) {
    textLines.push(`Temporary Password: ${opts.temporaryPassword}`);
  }
  textLines.push(
    ``,
    `Login: ${loginUrl}`,
    ``,
    opts.temporaryPassword
      ? `For your security, please change your password after your first login.`
      : `Sign in with the link above to accept your invitation.`,
    footerText()
  );
  const text = textLines.join("\n");

  const rows: Array<{ label: string; value: string; mono?: boolean; emphasize?: boolean }> = [
    { label: "Company Name", value: opts.companyName },
    { label: "Username (Email)", value: opts.inviteeEmail, mono: true },
    { label: "Role", value: role },
  ];
  if (opts.temporaryPassword) {
    rows.push({
      label: "Temporary Password",
      value: opts.temporaryPassword,
      mono: true,
      emphasize: true,
    });
  }

  const bodyHtml = `
    ${heading("You're invited")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `<strong>${escapeHtml(inviter)}</strong> invited you to collaborate on <strong>${escapeHtml(opts.companyName)}</strong> in Massive Mentor CRM.`
    )}
    ${detailCard(rows)}
    ${ctaButton("Login to CRM", loginUrl)}
    ${
      opts.temporaryPassword
        ? securityNotice(
            "For your security, please change your password after your first login."
          )
        : pText("Use the button above to open your workspace.", { muted: true })
    }
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `${inviter} invited you to ${opts.companyName}`,
      eyebrow: "Team invitation",
      bodyHtml,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════
   Renewal reminder (paid)
   ═══════════════════════════════════════════════════════════ */

export function buildRenewalReminderEmail(opts: {
  name?: string | null;
  companyName: string;
  daysLeft: number;
  endsAt?: Date | string | null;
}): BuiltEmail {
  const who = opts.name?.trim() || "there";
  const billingUrl = getLoginUrl("/dashboard/billing");
  const loginUrl = getLoginUrl("/login");
  const ends = formatDateLong(opts.endsAt);
  const subject = `Renewal reminder — ${opts.daysLeft} day(s) left | Massive Mentor CRM`;

  const text = [
    `Hi ${who},`,
    ``,
    `Your ${opts.companyName} subscription renews/expires in ${opts.daysLeft} day(s).`,
    ends !== "—" ? `End date: ${ends}` : "",
    ``,
    `Renew at: ${billingUrl}`,
    `Login: ${loginUrl}`,
    footerText(),
  ]
    .filter(Boolean)
    .join("\n");

  const bodyHtml = `
    ${heading("Subscription renewal reminder")}
    ${pText(`Hi ${who},`)}
    ${paragraph(
      `Your subscription for <strong>${escapeHtml(opts.companyName)}</strong> renews or expires in <strong>${opts.daysLeft} day(s)</strong>.`
    )}
    ${detailCard([
      { label: "Company Name", value: opts.companyName },
      { label: "Days remaining", value: String(opts.daysLeft), emphasize: true },
      { label: "End date", value: ends },
    ])}
    ${ctaButton("Renew in Billing", billingUrl)}
    ${paragraph(
      `<a href="${escapeHtml(loginUrl)}" style="color:#7c3aed;text-decoration:none;font-weight:600;">Login to CRM</a>`,
      { muted: true }
    )}
  `;

  return {
    subject,
    text,
    html: renderEmailLayout({
      preheader: `Renewal in ${opts.daysLeft} day(s) for ${opts.companyName}`,
      eyebrow: "Billing",
      bodyHtml,
    }),
  };
}

/** Export app URL helper for callers that still need it */
export { getAppUrl, getLoginUrl };
