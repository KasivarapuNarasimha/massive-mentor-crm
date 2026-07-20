/**
 * Verify: create business → soft-delete → create again with same owner email succeeds.
 * Run: node --import tsx src/scripts/verify-email-reuse-after-delete.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import * as platform from "../services/platform.service.js";

async function main() {
  const stamp = Date.now();
  const email = `reuse.test.${stamp}@example.com`;
  const password = "TestPass123!";

  // Super admin actor
  const admin = await prisma.user.findFirst({
    where: { platformRole: "super_admin" },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("No super_admin user — seed portals first");

  console.log("1) Create business A with", email);
  const a = await platform.createCustomerBusiness({
    actorUserId: admin.id,
    businessName: `Reuse Biz A ${stamp}`,
    ownerEmail: email,
    ownerName: "Reuse Owner",
    templateSlug: "generic",
      ownerPassword: password,
    plan: "trial",
  });
  const bizAId = (a as { id?: string }).id || (a as { business?: { id: string } }).business?.id;
  // getBusinessDetail shape
  const idA =
    (a as { id?: string }).id ||
    (typeof a === "object" && a && "id" in a ? String((a as { id: string }).id) : null);
  console.log("   created", idA || JSON.stringify(a).slice(0, 200));

  // Resolve id from DB if needed
  const bizA = await prisma.business.findFirst({
    where: { owner: { email }, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!bizA) throw new Error("Business A not found");
  console.log("   bizA", bizA.id, bizA.status);

  console.log("2) Soft-delete business A");
  const del = await platform.softDeleteBusiness(admin.id, bizA.id);
  console.log("   ", del);

  const afterDel = await prisma.business.findUnique({ where: { id: bizA.id } });
  const userAfter = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isDisabled: true },
  });
  console.log("   business status:", afterDel?.status);
  console.log("   user still exists:", !!userAfter, "isDisabled:", userAfter?.isDisabled);

  console.log("3) Create business B with SAME email");
  const b = await platform.createCustomerBusiness({
    actorUserId: admin.id,
    businessName: `Reuse Biz B ${stamp}`,
    ownerEmail: email,
    ownerName: "Reuse Owner 2",
    templateSlug: "generic",
      ownerPassword: password,
    plan: "trial",
  });
  const bizB = await prisma.business.findFirst({
    where: { owner: { email }, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!bizB || bizB.id === bizA.id) {
    throw new Error("Business B was not created as a new active workspace");
  }
  console.log("   bizB", bizB.id, bizB.status, bizB.name);

  console.log("4) Active email still cannot double-register");
  let blocked = false;
  try {
    await platform.createCustomerBusiness({
      actorUserId: admin.id,
      businessName: `Should Fail ${stamp}`,
      ownerEmail: email,
      templateSlug: "generic",
      ownerPassword: password,
      plan: "trial",
    });
  } catch (e) {
    blocked = true;
    console.log("   blocked as expected:", e instanceof Error ? e.message : e);
  }
  if (!blocked) throw new Error("Expected uniqueness block for active email");

  // Cleanup test data
  await platform.softDeleteBusiness(admin.id, bizB.id);
  console.log("\nOK — email reuse after soft-delete works.");
}

main()
  .catch((e) => {
    console.error("FAIL", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
