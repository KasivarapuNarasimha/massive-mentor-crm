/**
 * Regression: password reset must NOT create a new Trial workspace.
 *
 * Existing user → reset password → login → SAME userId + businessId + plan.
 *
 * Run from apps/api:
 *   npx tsx src/scripts/verify-password-reset-workspace.ts
 */
import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import {
  completePasswordReset,
  hashResetToken,
} from "../services/password-reset.service.js";
import { loginUser } from "../services/auth.service.js";
import {
  ensureDefaultBusiness,
  resolveExistingCustomerBusiness,
} from "../services/business.service.js";
import { getUserBusinessId } from "../services/field-engine.service.js";

async function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const stamp = Date.now();
  const email = `reset-ws-test-${stamp}@example.com`;
  const oldPass = "OldSecure1!";
  const newPass = "NewSecure1!";

  console.log("=== Password reset workspace identity regression ===\n");

  const passwordHash = await bcrypt.hash(oldPass, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: "Reset Workspace Test",
      role: "business_admin",
      platformRole: "user",
      profile: {
        create: {
          businessName: "Original Paid Co",
          industry: "Real Estate",
          description: "must not become Acme",
        },
      },
    },
  });

  const business = await prisma.business.create({
    data: {
      name: "Original Paid Co",
      ownerUserId: user.id,
      status: "active",
      portalKind: "customer",
      isDemo: false,
      plan: "professional",
      planStatus: "active",
      isTrial: false,
      licenseStatus: "active",
      templateSlug: "real_estate",
      members: {
        create: {
          userId: user.id,
          role: "business_admin",
        },
      },
    },
  });

  await prisma.contact.create({
    data: {
      userId: user.id,
      businessId: business.id,
      type: "lead",
      status: "new",
      name: "Existing Lead Keep Me",
      phone: "9999999999",
    },
  });

  const beforeBizCount = await prisma.business.count({
    where: { ownerUserId: user.id },
  });
  console.log("1) Seeded user", user.id, "business", business.id, "plan=professional");

  // Password reset tied to original userId
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(raw),
      portal: "customer",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  await completePasswordReset({ token: raw, password: newPass });
  console.log("2) Password reset completed for same userId");

  const login = await loginUser({ email, password: newPass });
  await assert(login.user.id === user.id, "login userId must match original");
  await assert(
    login.user.businessId === business.id,
    `login businessId must match original (got ${login.user.businessId})`
  );
  console.log("3) Login OK — same userId + businessId");

  const ensured = await ensureDefaultBusiness(user.id);
  await assert(ensured.id === business.id, "ensureDefaultBusiness must return original");
  await assert(ensured.name === "Original Paid Co", "business name must not become default");
  console.log("4) ensureDefaultBusiness →", ensured.id, ensured.name);

  const viaGet = await getUserBusinessId(user.id);
  await assert(viaGet === business.id, "getUserBusinessId must return original");

  const afterBizCount = await prisma.business.count({
    where: { ownerUserId: user.id },
  });
  await assert(
    afterBizCount === beforeBizCount,
    `must not create new business (before=${beforeBizCount} after=${afterBizCount})`
  );

  const refreshed = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  await assert(refreshed.plan === "professional", "plan must remain professional");
  await assert(refreshed.isTrial === false, "isTrial must remain false");
  await assert(refreshed.planStatus === "active", "planStatus must remain active");

  const leadCount = await prisma.contact.count({
    where: { businessId: business.id, deletedAt: null },
  });
  await assert(leadCount === 1, "existing CRM lead must still exist");
  console.log("5) Plan still professional/active; lead count=", leadCount);

  // Membership deleted but ownership remains — must repair, not create Trial
  await prisma.businessMember.deleteMany({
    where: { userId: user.id, businessId: business.id },
  });
  const repaired = await resolveExistingCustomerBusiness(user.id);
  await assert(repaired?.businessId === business.id, "owner fallback must find original");
  const afterRepair = await ensureDefaultBusiness(user.id);
  await assert(afterRepair.id === business.id, "repair path must not create new business");
  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: business.id, userId: user.id } },
  });
  await assert(!!membership, "membership must be recreated");
  console.log("6) Owner-without-membership repair OK");

  // Empty accidental trial sibling must not win when original has data
  const emptyTrial = await prisma.business.create({
    data: {
      name: "Accidental Trial",
      ownerUserId: user.id,
      status: "active",
      portalKind: "customer",
      isDemo: false,
      plan: "trial",
      planStatus: "trial",
      isTrial: true,
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  const preferred = await ensureDefaultBusiness(user.id);
  await assert(
    preferred.id === business.id,
    `must prefer data-rich paid workspace over empty trial (got ${preferred.id})`
  );
  console.log("7) Prefer original over empty trial OK");

  // Cleanup (test only)
  await prisma.contact.deleteMany({ where: { userId: user.id } });
  await prisma.businessMember.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.business.deleteMany({ where: { id: { in: [business.id, emptyTrial.id] } } });
  await prisma.businessProfile.deleteMany({ where: { userId: user.id } }).catch(() => null);
  await prisma.user.delete({ where: { id: user.id } });

  console.log("\n=== ALL WORKSPACE IDENTITY CHECKS PASSED ===");
}

main()
  .catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
