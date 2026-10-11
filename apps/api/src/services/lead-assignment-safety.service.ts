import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type MembershipClient = Pick<Prisma.TransactionClient, "businessMember">;

/** Validate by IDs only; no platform-user or legacy workspace fallback. */
export async function requireActiveBusinessAssignee(
  businessId: string,
  userId: string,
  db: MembershipClient = prisma
) {
  if (!businessId || !userId || userId !== userId.trim()) {
    throw new Error("An active workspace member user ID is required");
  }
  const member = await db.businessMember.findFirst({
    where: { businessId, userId },
    include: {
      user: { select: { id: true, name: true, email: true, isDisabled: true } },
      business: { select: { status: true } },
    },
  });
  if (!member || member.user.isDisabled || member.business.status !== "active") {
    throw new Error("Assignee is not an active member of this workspace");
  }
  return member.user;
}
