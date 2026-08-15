/**
 * Smoke test premium email templates (no SMTP send).
 * Usage: node --import tsx src/scripts/smoke-email-templates.ts
 */
import {
  buildWelcomeAccountEmail,
  buildPasswordResetEmail,
  buildTrialExpiryReminderEmail,
  buildSubscriptionActivatedEmail,
  buildPaymentSuccessEmail,
  buildInvoiceGeneratedEmail,
  buildInvitationEmail,
  getAppUrl,
} from "../services/email/templates.js";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  OK  ${msg}`);
}

const app = getAppUrl();
console.log("APP_URL / base:", app);

const welcome = buildWelcomeAccountEmail({
  companyName: "Acme Corp",
  ownerName: "Te",
  email: "te@example.com",
  temporaryPassword: "Mm@TempPass1!",
  trialEndDate: new Date("2026-07-22"),
});
assert(welcome.html.includes("Massive Mentor"), "logo/brand in HTML");
assert(welcome.html.includes("Login to CRM"), "Login to CRM CTA");
assert(welcome.html.includes("Company Name"), "company field");
assert(welcome.html.includes("Temporary Password"), "temp password field");
assert(welcome.html.includes("Trial End Date"), "trial end field");
assert(welcome.html.includes("change your password"), "security notice");
assert(welcome.html.includes("Support Email"), "support section");
assert(welcome.html.includes("2026 Massive Mentor CRM"), "footer year");
assert(welcome.html.includes("inline") || welcome.html.includes("style="), "inline styles");
assert(!!welcome.text && welcome.text.includes("Temporary Password"), "plain text fallback");
// Password must appear without surrounding HTML whitespace that copy-paste would include
assert(
  welcome.html.includes(`>Mm@TempPass1!<`) || welcome.html.includes(`>Mm@TempPass1!</code>`),
  "password has no leading/trailing space inside HTML value cell"
);
assert(!welcome.html.includes(` Mm@TempPass1!`), "no space before password in HTML");
assert(!welcome.html.includes(`Mm@TempPass1! `), "no space after password in HTML");
assert(welcome.text.includes("\nMm@TempPass1!\n"), "plain text password alone on its line");

const reset = buildPasswordResetEmail({
  name: "Te",
  resetUrl: `${app}/reset-password?token=test`,
  portalLabel: "Customer",
  ttlMinutes: 30,
});
assert(reset.html.includes("Choose new password"), "reset CTA");

const trial = buildTrialExpiryReminderEmail({
  companyName: "Acme Corp",
  daysLeft: 2,
  trialEndDate: new Date("2026-07-21"),
});
assert(trial.html.includes("Trial"), "trial reminder");

const sub = buildSubscriptionActivatedEmail({
  companyName: "Acme Corp",
  planName: "Professional",
  validUntil: new Date("2027-07-19"),
});
assert(sub.html.includes("Subscription activated"), "subscription");

const pay = buildPaymentSuccessEmail({
  companyName: "Acme Corp",
  planName: "Professional",
  amount: 6999,
  invoiceNumber: "INV-1",
});
assert(pay.html.includes("Payment successful"), "payment");

const inv = buildInvoiceGeneratedEmail({
  companyName: "Acme Corp",
  invoiceNumber: "INV-1",
  amount: 6999,
  planName: "Professional",
});
assert(inv.html.includes("Invoice generated"), "invoice");

const invite = buildInvitationEmail({
  inviteeEmail: "new@example.com",
  companyName: "Acme Corp",
  inviterName: "Boss",
  temporaryPassword: "Mm@Invite1!",
  roleLabel: "Sales Executive",
});
assert(invite.html.includes("invited") || invite.subject.includes("invited"), "invitation");

console.log("\nAll email template smoke checks passed.");
console.log(`Sample welcome HTML length: ${welcome.html.length} chars`);
