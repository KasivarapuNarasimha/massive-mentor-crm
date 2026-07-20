/**
 * Shared customer owner (User) provisioning for:
 * - Public self-registration
 * - Super Admin "Create Business"
 *
 * Soft-deleted businesses leave the User row (email UNIQUE). Both flows must
 * reuse that user when they have no active customer workspace.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

/** True when user has at least one non-deleted customer business (member or owner). */
export async function userHasActiveCustomerBusiness(userId: string): Promise<boolean> {
  const activeMember = await prisma.businessMember.findFirst({
    where: {
      userId,
      business: {
        isDemo: false,
        portalKind: "customer",
        status: { not: "deleted" },
      },
    },
    select: { id: true },
  });
  if (activeMember) return true;

  const owned = await prisma.business.findFirst({
    where: {
      ownerUserId: userId,
      isDemo: false,
      portalKind: "customer",
      status: { not: "deleted" },
    },
    select: { id: true },
  });
  return !!owned;
}

export type ResolveCustomerOwnerInput = {
  email: string;
  password: string;
  name?: string | null;
  businessName: string;
  industryLabel?: string;
};

export type ResolveCustomerOwnerResult = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  platformRole: string;
  reusedUser: boolean;
};

/**
 * Create a new owner user OR reuse an existing one that only has soft-deleted
 * (or no) customer workspaces. Never creates a second User for the same email.
 */
export async function resolveOrCreateCustomerOwner(
  input: ResolveCustomerOwnerInput
): Promise<ResolveCustomerOwnerResult> {
  const email = input.email.toLowerCase().trim();
  if (!email) throw new Error("Email is required");

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing?.platformRole === "super_admin") {
    throw new Error("This email is reserved for Super Admin and cannot own a customer business");
  }

  if (existing && (await userHasActiveCustomerBusiness(existing.id))) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const businessName = input.businessName.trim() || "My Business";
  const industry = (input.industryLabel || "Other").trim() || "Other";
  const name = input.name?.trim() || null;

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: name || existing.name,
        role: "business_admin",
        platformRole: "user",
        isDisabled: false,
        // Invalidate old sessions from the deleted workspace
        tokenVersion: { increment: 1 },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
      },
    });

    await prisma.businessProfile
      .upsert({
        where: { userId: existing.id },
        create: {
          userId: existing.id,
          businessName,
          industry,
          description: "",
        },
        update: {
          businessName,
          industry,
        },
      })
      .catch(() => null);

    return {
      userId: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      platformRole: updated.platformRole,
      reusedUser: true,
    };
  }

  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: "business_admin",
      platformRole: "user",
      isDisabled: false,
      profile: {
        create: {
          businessName,
          industry,
          description: "",
        },
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      platformRole: true,
    },
  });

  return {
    userId: created.id,
    email: created.email,
    name: created.name,
    role: created.role,
    platformRole: created.platformRole,
    reusedUser: false,
  };
}
