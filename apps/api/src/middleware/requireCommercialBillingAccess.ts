import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { CommercialAccessError, resolveCommercialActionAccess, type CommercialModule } from "../services/commercial-access.service.js";
import { evaluateCommercialBillingAccess } from "../services/commercial-billing-access.service.js";
import { getStrictRequestContext } from "../services/strict-request-context.service.js";
import { isCommercialAction, moduleForCommercialAction } from "../services/commercial-policy.js";

/** Unmounted. Must run inside the preceding strict commercial guard's pin. */
export function requireCommercialBillingAccess(module:CommercialModule, action:string) {
  if (!isCommercialAction(action) || moduleForCommercialAction(action) !== module) throw new Error("Registered module/action required");
  return async (req:AuthenticatedRequest,res:Response,next:NextFunction) => {
    try {
      const context = req.strictBusinessContext;
      const pinned = req.user?.id ? getStrictRequestContext(req.user.id) : undefined;
      if (!context || !req.user || !pinned || context.userId !== req.user.id || pinned.businessId !== context.businessId || req.headers["x-business-id"] !== context.businessId ||
          (req.tenant && (req.tenant.userId !== context.userId || req.tenant.businessId !== context.businessId))) {
        throw new CommercialAccessError("Pinned commercial workspace required");
      }
      await resolveCommercialActionAccess(context.userId,context.businessId,module,action);
      const access = await evaluateCommercialBillingAccess(context);
      if (!access.allowed) return res.status(402).json({success:false,code:"COMMERCIAL_BILLING_DENIED",reason:access.reason});
    } catch(error) {
      return res.status(error instanceof CommercialAccessError ? 403 : 500).json({success:false,code:"COMMERCIAL_BILLING_AUTHORIZATION_FAILED"});
    }
    return next();
  };
}
