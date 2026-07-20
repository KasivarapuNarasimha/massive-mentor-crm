/**
 * Register → soft-delete → register again (same email) must reuse User, not fail.
 * Run: node --import tsx src/scripts/verify-register-email-reuse.ts
 */
import { prisma } from "../lib/prisma.js";
import { registerUser } from "../services/auth.service.js";
import * as platform from "../services/platform.service.js";

async function main() {
  const stamp = Date.now();
  const email = `reg.reuse.${stamp}@example.com`;
  const password = "TestPass123!";

  console.log("1) Public register", email);
  const a = await registerUser({
    email,
    password,
    name: "Reuse Owner",
    businessName: `Reg Biz A ${stamp}`,
    templateSlug: "generic",
  });
  console.log("   user", a.user.id, "biz", a.user.businessId);

  const userCount1 = await prisma.user.count({ where: { email } });
  if (userCount1 !== 1) throw new Error(`Expected 1 user, got ${userCount1}`);

  const admin = await prisma.user.findFirst({ where: { platformRole: "super_admin" } });
  if (!admin) throw new Error("no super_admin");

  console.log("2) Soft-delete business");
  await platform.softDeleteBusiness(admin.id, a.user.businessId!);
  const uDisabled = await prisma.user.findUnique({
    where: { email },
    select: { isDisabled: true, id: true },
  });
  console.log("   isDisabled", uDisabled?.isDisabled);

  console.log("3) Register again same email");
  const b = await registerUser({
    email,
    password: "NewPass456!",
    name: "Reuse Owner 2",
    businessName: `Reg Biz B ${stamp}`,
    templateSlug: "generic",
  });
  console.log("   user", b.user.id, "biz", b.user.businessId);

  if (b.user.id !== a.user.id) {
    throw new Error("Expected same userId (reuse), got a new user");
  }
  if (b.user.businessId === a.user.businessId) {
    throw new Error("Expected a new business id");
  }

  const userCount2 = await prisma.user.count({ where: { email } });
  if (userCount2 !== 1) throw new Error(`Expected still 1 user, got ${userCount2}`);

  const uEnabled = await prisma.user.findUnique({
    where: { email },
    select: { isDisabled: true },
  });
  if (uEnabled?.isDisabled) throw new Error("User should be re-enabled");

  console.log("4) Login with new password");
  const { loginUser } = await import("../services/auth.service.js");
  const login = await loginUser({ email, password: "NewPass456!" });
  console.log("   login ok", login.user.id);

  console.log("5) Active email still blocked");
  let blocked = false;
  try {
    await registerUser({
      email,
      password: "Another999!",
      businessName: "Should fail",
      templateSlug: "generic",
    });
  } catch (e) {
    blocked = true;
    console.log("   ", e instanceof Error ? e.message : e);
  }
  if (!blocked) throw new Error("Expected block for active email");

  await platform.softDeleteBusiness(admin.id, b.user.businessId!);
  console.log("\nOK — public registration reuses soft-deleted owner email");
}

main()
  .catch((e) => {
    console.error("FAIL", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
