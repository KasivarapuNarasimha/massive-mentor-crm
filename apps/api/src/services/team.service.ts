import { prisma } from "@/lib/prisma";

export const ROLES = ["admin", "manager", "sales_executive"] as const;
export type Role = (typeof ROLES)[number];

export async function getUserRole(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role || "sales_executive";
}

export async function updateUserRole(actorId: string, targetUserId: string, role: Role) {
  if (!ROLES.includes(role)) throw new Error("Invalid role");
  // IDOR fix: actor must share a team with target (or be same user only for self-demotion blocked)
  if (actorId === targetUserId) {
    throw new Error("Cannot change your own role via this endpoint");
  }
  const shared = await prisma.teamMember.findFirst({
    where: {
      userId: targetUserId,
      team: { members: { some: { userId: actorId, role: { in: ["admin", "manager"] } } } },
    },
  });
  // Also allow same-business admin via BusinessMember
  const actorBiz = await prisma.businessMember.findMany({
    where: { userId: actorId, role: { in: ["business_admin", "admin", "owner"] } },
    select: { businessId: true },
  });
  const bizIds = actorBiz.map((b) => b.businessId);
  const sameBiz = bizIds.length
    ? await prisma.businessMember.findFirst({
        where: { userId: targetUserId, businessId: { in: bizIds } },
      })
    : null;

  if (!shared && !sameBiz) {
    throw new Error("Permission denied: target user is outside your team/business");
  }

  return prisma.user.update({
    where: { id: targetUserId },
    data: { role },
  });
}

export async function createTeam(ownerId: string, name: string) {
  const clean = String(name || "").trim().slice(0, 120);
  if (!clean) throw new Error("Team name required");
  return prisma.team.create({
    data: {
      name: clean,
      ownerId,
      members: {
        create: {
          userId: ownerId,
          role: "admin",
        },
      },
    },
    include: { members: true },
  });
}

/** IDOR-safe: only team admin/manager (or owner) can add members */
export async function addTeamMember(actorId: string, teamId: string, userId: string, role: Role) {
  if (!ROLES.includes(role)) throw new Error("Invalid role");
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: actorId },
  });
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("Team not found");
  const isOwner = team.ownerId === actorId;
  const canManage =
    isOwner || (membership && ["admin", "manager"].includes(membership.role));
  if (!canManage) {
    throw new Error("Permission denied: you cannot manage this team");
  }
  // Target user must exist
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw new Error("User not found");

  return prisma.teamMember.create({
    data: { teamId, userId, role },
  });
}

/** IDOR-safe: only members of the team can list */
export async function getTeamMembers(actorId: string, teamId: string) {
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: actorId },
  });
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("Team not found");
  if (!membership && team.ownerId !== actorId) {
    throw new Error("Permission denied: not a member of this team");
  }
  return prisma.teamMember.findMany({
    where: { teamId },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
}

export async function getUserTeams(userId: string) {
  return prisma.teamMember.findMany({
    where: { userId },
    include: { team: true },
  });
}

export async function hasPermission(userId: string, requiredRole: Role) {
  const role = await getUserRole(userId);
  const hierarchy: Record<Role, number> = { sales_executive: 1, manager: 2, admin: 3 };
  return hierarchy[role as Role] >= hierarchy[requiredRole];
}
