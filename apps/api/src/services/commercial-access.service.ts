import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { LeadWriteContext } from "./tenant-scope.service.js";
import { getStrictRequestContext } from "./strict-request-context.service.js";
import { modulesForTemplate, parseBusinessModuleAccess, parseMemberPermissions } from "./permissions.service.js";

import { isCommercialAction, commercialRoleEligible, moduleForCommercialAction, commercialActionsFromPermissions, type CommercialAction, type CommercialModule } from "./commercial-policy.js";
export type { CommercialModule } from "./commercial-policy.js";
const WRITE_ROLES = new Set(["ceo", "owner", "business_admin", "admin", "finance", "super_admin"]);

export class CommercialAccessError extends Error {
  readonly code = "COMMERCIAL_ACCESS_DENIED";
  constructor(message: string) { super(message); this.name = "CommercialAccessError"; }
}

function requireId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new CommercialAccessError(`${label} required`);
  }
}

/** Validate an explicit workspace, with no legacy resolver or heuristic selection. */
export async function resolveCommercialAccess(
  userId: string, businessId: string, module: CommercialModule = "finance", transaction?: Prisma.TransactionClient
): Promise<Readonly<LeadWriteContext>> {
  return resolveAccess(userId, businessId, module, transaction);
}

async function resolveAccess(
  userId: string, businessId: string, module: CommercialModule,
  transaction?: Prisma.TransactionClient, action?: CommercialAction
): Promise<Readonly<LeadWriteContext>> {
  requireId(userId, "Actor"); requireId(businessId, "Workspace");
  if (module !== "finance" && module !== "erp_sales" && module !== "quotations") throw new CommercialAccessError("Unknown module");
  const pinned = getStrictRequestContext(userId);
  if (pinned && pinned.businessId !== businessId) throw new CommercialAccessError("Pinned workspace mismatch");
  const db = transaction ?? prisma;
  const member = await db.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId } },
    include: {
      user: { select: { isDisabled: true } },
      business: { select: { status: true, settings: true } },
    },
  });
  if (!member || member.user.isDisabled || member.business.status !== "active") {
    throw new CommercialAccessError("Active exact workspace membership required");
  }
  const role = member.role.trim().toLowerCase();
  if (action ? !commercialRoleEligible(role, action) : !WRITE_ROLES.has(role)) {
    throw new CommercialAccessError("Commercial role/action not eligible");
  }
  if (member.permissions != null &&
      (typeof member.permissions !== "object" || Array.isArray(member.permissions))) {
    throw new CommercialAccessError("Invalid membership policy");
  }
  const permissions = parseMemberPermissions(member.permissions);
  if ((permissions.customized !== undefined && typeof permissions.customized !== "boolean") ||
      (permissions.modules !== undefined && (!Array.isArray(permissions.modules) ||
        permissions.modules.some(key => typeof key !== "string")))) {
    throw new CommercialAccessError("Invalid membership policy");
  }
  // Empty/malformed customized policy must not grant the owner role template.
  const modules = permissions.customized
    ? (Array.isArray(permissions.modules) ? permissions.modules : [])
    : permissions.modules?.length ? permissions.modules : modulesForTemplate(
        role === "owner" || role === "admin" ? "business_admin" : role
      );
  const settings = member.business.settings;
  if (settings != null && (typeof settings !== "object" || Array.isArray(settings))) {
    throw new CommercialAccessError("Invalid workspace module policy");
  }
  const rawPolicy = (settings as { moduleAccess?: unknown } | null)?.moduleAccess;
  if (rawPolicy != null) {
    const policy = rawPolicy as { customized?: unknown; enabled?: unknown };
    if (typeof rawPolicy !== "object" || Array.isArray(rawPolicy) ||
        (policy.customized !== undefined && typeof policy.customized !== "boolean") ||
        !Array.isArray(policy.enabled) || policy.enabled.some(key => typeof key !== "string")) {
      throw new CommercialAccessError("Invalid workspace module policy");
    }
  }
  const businessPolicy = parseBusinessModuleAccess(settings);
  const enabled = (rawPolicy as { enabled?: string[] } | null)?.enabled;
  // quotations is intentionally outside the legacy catalog/default templates.
  const capped = module === "quotations"
    ? (rawPolicy as { customized?: boolean } | null)?.customized && !enabled?.includes(module)
    : businessPolicy?.customized && !businessPolicy.enabled.includes(module);
  if (!modules.includes(module) || capped) {
    throw new CommercialAccessError("Commercial module not enabled for this membership/workspace");
  }
  return Object.freeze({ userId, businessId, role, permissions: member.permissions });
}

/** Pass the caller transaction for write-time checks; root reads are preflight only.
 * Transaction-bound reads still need scoped writes and an isolation/locking policy. */
export async function assertCommercialReferences(
  userId: string, businessId: string, input: { contactId: string; dealId?: string | null },
  module: CommercialModule = "finance", transaction?: Prisma.TransactionClient, action?: CommercialAction
) {
  const context = action
    ? await resolveCommercialActionAccess(userId, businessId, module, action, transaction)
    : await resolveCommercialAccess(userId, businessId, module, transaction);
  const db = transaction ?? prisma;
  requireId(input.contactId, "Customer");
  const scope = action ? await buildCommercialReferenceScope(context, transaction) : undefined;
  const contact = await db.contact.findFirst({
    where: { id: input.contactId, businessId: context.businessId, deletedAt: null, ...(scope?.contactWhere ?? {}) }, select: { id: true },
  });
  if (!contact) throw new CommercialAccessError("Customer unavailable in this workspace");
  let deal: { id: string; contactId: string | null } | null = null;
  if (input.dealId != null) {
    requireId(input.dealId, "Deal");
    deal = await db.deal.findFirst({
      where: { id: input.dealId, businessId: context.businessId, ...(scope?.dealWhere ?? {}) }, select: { id: true, contactId: true },
    });
    if (!deal || deal.contactId !== contact.id) {
      throw new CommercialAccessError("Deal/customer relationship unavailable in this workspace");
    }
  }
  return { context, contactId: contact.id, dealId: deal?.id ?? null };
}

/** Opt-in action gate: explicit modules and action strings, never role defaults.
 * Use the actual transaction client again at write time; the HTTP pin is preflight.
 * No permission records are created or repaired by this function.
 */
export async function resolveCommercialActionAccess(
  userId: string, businessId: string, module: CommercialModule, action: string,
  transaction?: Prisma.TransactionClient
): Promise<Readonly<LeadWriteContext>> {
  if (!isCommercialAction(action) || moduleForCommercialAction(action) !== module) {
    throw new CommercialAccessError("Registered action and matching commercial module required");
  }
  const context = await resolveAccess(userId, businessId, module, transaction, action);
  const policy = context.permissions as { modules?: unknown } | null;
  let actions: CommercialAction[];
  try { actions = commercialActionsFromPermissions(context.permissions); }
  catch { throw new CommercialAccessError("Invalid commercial action policy"); }
  if (!Array.isArray(policy?.modules) || !policy.modules.includes(module) || !actions.includes(action)) {
    throw new CommercialAccessError("Explicit commercial module/action grant required");
  }
  return context;
}

/** Existing assigned/team ownership semantics, with exact business-member filtering.
 * Team has no businessId; never infer tenant authority from Team membership alone.
 */
export async function buildCommercialReferenceScope(context: Readonly<LeadWriteContext>, transaction?: Prisma.TransactionClient) {
  const db = transaction ?? prisma;
  if (context.role === "sales_executive") {
    return { contactWhere: { assignedTo: context.userId }, dealWhere: { userId: context.userId } };
  }
  if (context.role === "sales_manager") {
    const managed = await db.teamMember.findMany({where:{userId:context.userId,role:{in:["admin","manager"]}},select:{teamId:true}});
    const owned = await db.team.findMany({where:{ownerId:context.userId},select:{id:true}});
    const teamIds = [...new Set([...managed.map(row=>row.teamId),...owned.map(row=>row.id)])];
    const peers = teamIds.length ? await db.teamMember.findMany({where:{teamId:{in:teamIds}},select:{userId:true}}) : [];
    const active = await db.businessMember.findMany({where:{businessId:context.businessId,userId:{in:[context.userId,...peers.map(row=>row.userId)]},user:{isDisabled:false}},select:{userId:true}});
    const ids = [...new Set([context.userId,...active.map(row=>row.userId)])];
    return {contactWhere:{OR:[{userId:{in:ids}},{assignedTo:{in:ids}}]},dealWhere:{userId:{in:ids}}};
  }
  return {contactWhere:{},dealWhere:{}};
}
