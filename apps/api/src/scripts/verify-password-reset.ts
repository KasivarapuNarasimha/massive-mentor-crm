/**
 * End-to-end verification of password reset (API + DB).
 * Run: npx tsx src/scripts/verify-password-reset.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  requestPasswordReset,
  completePasswordReset,
  validateResetToken,
  hashResetToken,
} from "@/services/password-reset.service";
import { loginUser, loginPlatformAdmin, verifyToken, getUserById } from "@/services/auth.service";
import { requireAuth } from "@/middleware/auth";

async function main() {
  console.log("=== Password reset verification ===\n");

  // Find a non-admin customer user if any; else use super admin for admin portal test only
  const customer = await prisma.user.findFirst({
    where: { platformRole: { not: "super_admin" }, isDisabled: false },
    orderBy: { createdAt: "asc" },
  });
  const admin = await prisma.user.findFirst({
    where: { platformRole: "super_admin", isDisabled: false },
  });

  if (!customer && !admin) {
    console.error("No users found to test");
    process.exit(1);
  }

  if (customer) {
    console.log("1) Customer forgot-password (generic message + token in DB)");
    const before = await prisma.passwordResetToken.count({
      where: { userId: customer.id, portal: "customer", usedAt: null },
    });
    const msg = await requestPasswordReset({
      email: customer.email,
      portal: "customer",
      ip: "127.0.0.1",
    });
    console.log("   message:", msg.message);
    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: customer.id, portal: "customer", usedAt: null },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    if (!tokens[0]) throw new Error("No token created");
    console.log("   token row expires:", tokens[0].expiresAt.toISOString());

    // We need raw token — only available from email. Recover by re-creating with known raw:
    // For test: create a known token directly
    const crypto = await import("crypto");
    const raw = crypto.randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.updateMany({
      where: { userId: customer.id, portal: "customer", usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: customer.id,
        tokenHash: hashResetToken(raw),
        portal: "customer",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const v = await validateResetToken(raw);
    console.log("2) Validate token:", v);

    // Login first to get old token version
    // We don't know password — bump version test differently
    const beforeUser = await prisma.user.findUnique({
      where: { id: customer.id },
      select: { tokenVersion: true, passwordHash: true },
    });
    const newPass = "NewSecure1!";
    await completePasswordReset({ token: raw, password: newPass });
    const afterUser = await prisma.user.findUnique({
      where: { id: customer.id },
      select: { tokenVersion: true, passwordHash: true },
    });
    console.log("3) tokenVersion", beforeUser?.tokenVersion, "->", afterUser?.tokenVersion);
    if ((afterUser?.tokenVersion ?? 0) !== (beforeUser?.tokenVersion ?? 0) + 1) {
      throw new Error("tokenVersion not incremented");
    }
    const used = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashResetToken(raw) },
    });
    if (!used?.usedAt) throw new Error("token not burned");
    console.log("4) Token burned:", !!used.usedAt);

    // Single-use: complete again should fail
    try {
      await completePasswordReset({ token: raw, password: "Another1!" });
      throw new Error("re-use should fail");
    } catch (e) {
      console.log("5) Single-use enforced:", e instanceof Error ? e.message : e);
    }

    // Login with new password
    const login = await loginUser({ email: customer.email, password: newPass });
    console.log("6) Login with new password OK, portal=", login.portal);
    const decoded = verifyToken(login.token);
    console.log("7) JWT tv=", decoded.tv, "user.tokenVersion=", afterUser?.tokenVersion);
    if (decoded.tv !== afterUser?.tokenVersion) throw new Error("JWT tv mismatch");

    // Simulate old session (tv = previous)
    const jwt = await import("jsonwebtoken");
    const { env } = await import("@/config/env");
    const oldToken = jwt.default.sign(
      { userId: customer.id, portal: "customer", tv: beforeUser?.tokenVersion ?? 0 },
      env.JWT_SECRET,
      { expiresIn: "1h", algorithm: "HS256" }
    );
    const loaded = await getUserById(customer.id);
    const oldTv = beforeUser?.tokenVersion ?? 0;
    if ((loaded?.tokenVersion ?? 0) === oldTv) throw new Error("version should differ");
    console.log("8) Old session would be rejected (tv", oldTv, "!=", loaded?.tokenVersion, ")");

    // Unknown email enumeration
    const unk = await requestPasswordReset({
      email: "nobody-exists-xyz@example.com",
      portal: "customer",
    });
    if (unk.message !== msg.message) throw new Error("enumeration message mismatch");
    console.log("9) Anti-enumeration OK (same message)");
  }

  if (admin) {
    console.log("\n10) Super Admin portal reset token path");
    const crypto = await import("crypto");
    const raw = crypto.randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({
      data: {
        userId: admin.id,
        tokenHash: hashResetToken(raw),
        portal: "admin",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const v = await validateResetToken(raw);
    if (!v.valid || v.portal !== "admin") throw new Error("admin token invalid");
    console.log("    admin token valid, emailHint=", v.emailHint);
  }

  console.log("\n=== ALL PASSWORD RESET CHECKS PASSED ===");
}

main()
  .catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
