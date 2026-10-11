import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import { CommercialAccessError, resolveCommercialActionAccess } from "./commercial-access.service.js";
import { commercialActionsFromPermissions, commercialRoleEligible, isCommercialAction, moduleForCommercialAction, COMMERCIAL_GRANT_MODULES } from "./commercial-policy.js";

export type CommercialGrantChange = {
  actorUserId: string; businessId: string; targetUserId: string;
  actions: string[]; modules: string[]; reason: string;
};
/** No bootstrap/repair/global-role authority. Audit failure rolls back the change.
 * Caller transactions must roll back errors, never catch and commit them.
 */
export async function setCommercialPermissions(input: CommercialGrantChange, transaction?: Prisma.TransactionClient) {
  if (![input.actorUserId,input.businessId,input.targetUserId].every(id=>typeof id === "string" && id.length > 0 && id === id.trim()) ||
      typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000 ||
      !Array.isArray(input.actions) || input.actions.some(action=>!isCommercialAction(action)) ||
      !Array.isArray(input.modules) || input.modules.some(module=>!(COMMERCIAL_GRANT_MODULES as readonly string[]).includes(module))) {
    throw new CommercialAccessError("Valid target, registered grants/modules and audit reason required");
  }
  const execute = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRawUnsafe('SELECT "id" FROM "Business" WHERE "id"=$1 FOR SHARE',input.businessId);
    await tx.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" IN ($1,$2) ORDER BY "id" FOR SHARE',input.actorUserId,input.targetUserId);
    await tx.$queryRawUnsafe('SELECT "id" FROM "BusinessMember" WHERE "businessId"=$1 AND "userId" IN ($2,$3) ORDER BY "userId" FOR UPDATE',input.businessId,input.actorUserId,input.targetUserId);
    const actor = await resolveCommercialActionAccess(input.actorUserId,input.businessId,"quotations","commercial.permissions.manage",tx);
    const target = await tx.businessMember.findUnique({where:{businessId_userId:{businessId:input.businessId,userId:input.targetUserId}},include:{user:{select:{isDisabled:true}}}});
    if (!target) throw new CommercialAccessError("Target must be an exact workspace member");
    const current = target.permissions;
    if (current != null && (typeof current !== "object" || Array.isArray(current))) throw new CommercialAccessError("Invalid target permissions");
    const policy = (current ?? {}) as Prisma.JsonObject;
    const oldActions = policy.commercialActions === undefined ? [] : commercialActionsFromPermissions(policy);
    const oldModules = policy.modules === undefined ? [] : policy.modules;
    if (!Array.isArray(oldModules) || oldModules.some(module=>typeof module !== "string")) throw new CommercialAccessError("Invalid target modules");
    const actions = [...new Set(input.actions)]; const modules = [...new Set(input.modules)];
    const addedActions = actions.filter(action=>!oldActions.includes(action as typeof oldActions[number]));
    const changedActions = [...new Set([...addedActions,...oldActions.filter(action=>!actions.includes(action))])];
    const addedModules = modules.filter(module=>!oldModules.includes(module));
    const changedModules = [...new Set([...addedModules,...oldModules.filter(module=>(COMMERCIAL_GRANT_MODULES as readonly unknown[]).includes(module) && !modules.includes(module as string))])];
    const actorActions = commercialActionsFromPermissions(actor.permissions);
    const actorModules = (actor.permissions as {modules:string[]}).modules;
    if (changedActions.some(action=>!actorActions.includes(action as typeof actorActions[number])) || changedModules.some(module=>!actorModules.includes(module as string))) {
      throw new CommercialAccessError("Cannot delegate or revoke beyond explicit authority");
    }
    if (input.actorUserId === input.targetUserId && (addedActions.length || addedModules.length)) throw new CommercialAccessError("Self-escalation forbidden");
    if (target.user.isDisabled && (addedActions.length || addedModules.length)) throw new CommercialAccessError("Cannot grant to disabled target");
    if ((modules.includes("finance") && !commercialRoleEligible(target.role.trim().toLowerCase(),"invoice.read")) ||
        actions.some(action=>!commercialRoleEligible(target.role.trim().toLowerCase(),action as typeof actorActions[number]) || !modules.includes(moduleForCommercialAction(action as typeof actorActions[number])))) {
      throw new CommercialAccessError("Target role/action or module not eligible");
    }
    const settings = await tx.business.findUnique({where:{id:input.businessId},select:{settings:true}});
    const cap = (settings?.settings as {moduleAccess?:{customized?:unknown;enabled?:unknown}} | null)?.moduleAccess;
    if (cap && (typeof cap !== "object" || Array.isArray(cap) ||
        (cap.customized !== undefined && typeof cap.customized !== "boolean") || !Array.isArray(cap.enabled) || cap.enabled.some(value=>typeof value !== "string"))) {
      throw new CommercialAccessError("Invalid business module cap");
    }
    if (cap?.customized && modules.some(module=>!(cap.enabled as string[]).includes(module))) throw new CommercialAccessError("Business module cap denied");
    const preservedModules = oldModules.filter(module=>!(COMMERCIAL_GRANT_MODULES as readonly unknown[]).includes(module));
    const permissions = {...policy,modules:[...new Set([...preservedModules,...modules])],commercialActions:actions};
    const updated = await tx.businessMember.update({where:{id:target.id,businessId:input.businessId,updatedAt:target.updatedAt},data:{permissions}});
    await tx.auditLog.create({data:{businessId:input.businessId,actorUserId:input.actorUserId,action:"permission_change",entityType:"business_member",entityId:target.id,
      metadata:{targetUserId:input.targetUserId,before:{modules:oldModules,commercialActions:oldActions},after:{modules:permissions.modules,commercialActions:actions},reason:input.reason.trim()}}});
    return {businessId:input.businessId,targetUserId:input.targetUserId,permissions:updated.permissions};
  };
  return transaction ? execute(transaction) : prisma.$transaction(execute);
}
