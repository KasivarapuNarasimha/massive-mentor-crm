/**
 * Public email package surface (templates + brand helpers).
 * Transport remains in email.service.ts to avoid circular imports.
 */
export {
  buildWelcomeAccountEmail,
  buildPasswordResetEmail,
  buildTrialExpiryReminderEmail,
  buildTrialExpiredEmail,
  buildSubscriptionActivatedEmail,
  buildPaymentSuccessEmail,
  buildInvoiceGeneratedEmail,
  buildInvitationEmail,
  buildRenewalReminderEmail,
  getAppUrl,
  getLoginUrl,
  type BuiltEmail,
} from "./templates.js";
export {
  getSupportEmail,
  getSupportWhatsApp,
  getSupportWebsite,
  formatDateLong,
  formatMoneyInr,
  escapeHtml,
  EMAIL_BRAND,
} from "./brand.js";
