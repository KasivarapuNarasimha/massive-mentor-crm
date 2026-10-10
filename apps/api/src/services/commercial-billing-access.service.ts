import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { LeadWriteContext } from "./tenant-scope.service.js";
import { getStrictRequestContext } from "./strict-request-context.service.js";
import { CommercialAccessError } from "./commercial-access.service.js";

export type CommercialBillingAccess = {allowed:boolean; businessId:string; reason?:string};
/** SELECT-only. Ambiguous legacy/demo/grace policy is denied, not repaired. */
export async function evaluateCommercialBillingAccess(context: Readonly<LeadWriteContext>, transaction?: Prisma.TransactionClient, now = new Date()): Promise<CommercialBillingAccess> {
  const pinned = getStrictRequestContext(context.userId);
  if (!context.userId || !context.businessId || (pinned && pinned.businessId !== context.businessId)) throw new CommercialAccessError("Validated workspace required");
  const db = transaction ?? prisma;
  const member = await db.businessMember.findUnique({where:{businessId_userId:{businessId:context.businessId,userId:context.userId}},include:{user:{select:{isDisabled:true}},business:{select:{status:true}}}});
  if (!member || member.user.isDisabled || member.business.status !== "active") throw new CommercialAccessError("Active exact membership required");
  const biz = await db.business.findUnique({where:{id:context.businessId},select:{status:true,isDemo:true,portalKind:true,isLocked:true,isTrial:true,plan:true,planStatus:true,licenseStatus:true,trialStartDate:true,trialEndsAt:true,subscriptionEndsAt:true}});
  const deny = (reason:string):CommercialBillingAccess => ({allowed:false,businessId:context.businessId,reason});
  if (!biz || biz.status !== "active" || biz.isLocked) return deny("BUSINESS_UNAVAILABLE");
  if (!Number.isFinite(now.getTime()) || biz.isDemo || biz.portalKind !== "customer") return deny("BILLING_POLICY_UNRESOLVED");
  if (["cancelled","expired","suspended","locked"].includes(biz.planStatus)) return deny("BILLING_DENIED");
  const millis = (value:Date|null) => value?.getTime() ?? NaN;
  if (biz.isTrial === true && biz.planStatus === "trial" && biz.plan === "trial" && biz.licenseStatus === "trial") {
    const start = millis(biz.trialStartDate), end = millis(biz.trialEndsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > now.getTime() || end <= start) return deny("BILLING_POLICY_UNRESOLVED");
    return end > now.getTime() ? {allowed:true,businessId:context.businessId} : deny("TRIAL_EXPIRED");
  }
  if (biz.isTrial === false && biz.planStatus === "active" && biz.licenseStatus === "active" && ["basic","starter","professional","enterprise"].includes(biz.plan)) {
    const end = millis(biz.subscriptionEndsAt);
    if (!Number.isFinite(end)) return deny("BILLING_POLICY_UNRESOLVED");
    return end > now.getTime() ? {allowed:true,businessId:context.businessId} : deny("SUBSCRIPTION_EXPIRED");
  }
  return deny("BILLING_POLICY_UNRESOLVED");
}
