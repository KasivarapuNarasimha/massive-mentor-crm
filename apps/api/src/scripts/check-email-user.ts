import "dotenv/config";
import { prisma } from "../lib/prisma.js";

const email = (process.argv[2] || "").toLowerCase().trim();
if (!email) {
  console.error("Usage: check-email-user.ts <email>");
  process.exit(1);
}

const u = await prisma.user.findUnique({
  where: { email },
  select: { id: true, email: true, isDisabled: true, platformRole: true, role: true },
});
console.log("USER", u);
if (u) {
  const owned = await prisma.business.findMany({
    where: { ownerUserId: u.id },
    select: { id: true, name: true, status: true, portalKind: true, isDemo: true },
  });
  const members = await prisma.businessMember.findMany({
    where: { userId: u.id },
    include: { business: { select: { id: true, name: true, status: true } } },
  });
  console.log("OWNED", owned);
  console.log(
    "MEMBERS",
    members.map((m) => ({ role: m.role, business: m.business }))
  );
}
await prisma.$disconnect();
