/**
 * Diagnose Super Admin forgot-password email delivery on localhost.
 * Usage: npx tsx src/scripts/diagnose-password-reset-email.ts [email]
 */
import "dotenv/config";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { requestPasswordReset } from "../services/password-reset.service.js";
import { testSmtpConnection } from "../services/email.service.js";

async function main() {
  const emailArg = process.argv[2];

  console.log("\n=== Password Reset Email Diagnosis ===\n");
  console.log("NODE_ENV:", env.NODE_ENV);
  console.log("CUSTOMER_APP_URL:", env.CUSTOMER_APP_URL);
  console.log("ADMIN_APP_URL:", env.ADMIN_APP_URL);
  console.log("PASSWORD_RESET_TTL_MINUTES:", env.PASSWORD_RESET_TTL_MINUTES);
  console.log("SMTP_HOST:", env.SMTP_HOST || "(empty)");
  console.log("SMTP_PORT:", env.SMTP_PORT);
  console.log("SMTP_SECURE:", env.SMTP_SECURE);
  console.log("SMTP_USER:", env.SMTP_USER ? `${env.SMTP_USER.slice(0, 2)}***` : "(empty)");
  console.log("SMTP_PASS:", env.SMTP_PASS ? "(set)" : "(empty)");
  console.log("SMTP_FROM:", env.SMTP_FROM || "(empty)");

  const smtpOn = !!(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS?.trim());
  console.log("\nSMTP enabled?", smtpOn ? "YES" : "NO");

  if (!smtpOn) {
    console.log(`
ROOT CAUSE (localhost right now):
  SMTP is NOT configured in apps/api/.env (variables are commented out / empty).

WHAT HAPPENS:
  1. UI always shows the generic success message (anti-enumeration) — that is correct.
  2. A PasswordResetToken row is created in the database.
  3. The reset LINK is printed only in the API process terminal (the window running "pnpm dev:api").
  4. No message is sent to Hostinger because SMTP is off.

WHERE TO LOOK:
  - Terminal running the API on port 4000
  - Banner:  PASSWORD RESET / EMAIL (DEVELOPMENT — API CONSOLE)

TO SEND REAL EMAIL TO HOSTINGER, add to apps/api/.env:
  SMTP_HOST=smtp.hostinger.com
  SMTP_PORT=465
  SMTP_SECURE=true
  SMTP_USER=your-full-mailbox@yourdomain.com
  SMTP_PASS=your-mailbox-password
  SMTP_FROM=Massive Mentor <your-full-mailbox@yourdomain.com>
  ADMIN_APP_URL=http://localhost:3000

Then restart the API and re-test.
`);
  } else {
    console.log("\nTesting SMTP connection…");
    const t = await testSmtpConnection();
    console.log("SMTP test:", t);
  }

  const admin =
    (emailArg &&
      (await prisma.user.findUnique({
        where: { email: emailArg.toLowerCase() },
      }))) ||
    (await prisma.user.findFirst({
      where: { platformRole: "super_admin", isDisabled: false },
    }));

  if (!admin) {
    console.log("No Super Admin user found in DB.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nUsing Super Admin:", admin.email, "platformRole=", admin.platformRole);

  console.log("\nCalling requestPasswordReset(portal=admin)…\n");
  const result = await requestPasswordReset({
    email: admin.email,
    portal: "admin",
    ip: "127.0.0.1",
  });
  console.log("API response message:", result.message);

  const tokens = await prisma.passwordResetToken.findMany({
    where: { userId: admin.id, portal: "admin" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  console.log(
    "\nLatest DB tokens (hash only, not raw):",
    tokens.map((t) => ({
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      usedAt: t.usedAt,
      tokenHashPrefix: t.tokenHash.slice(0, 12) + "…",
    }))
  );

  if (!smtpOn) {
    console.log(
      "\n>>> If you did not see a boxed PASSWORD RESET banner above, the API server you use in the browser may be an old process. Restart: stop PID on :4000 and run pnpm dev:api again."
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
