import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { CommercialAccessError, resolveCommercialActionAccess, type CommercialModule } from "../services/commercial-access.service.js";
import { isCommercialAction, moduleForCommercialAction } from "../services/commercial-policy.js";
import { getStrictRequestContext, runWithStrictBusinessContext } from "../services/strict-request-context.service.js";

/** Unmounted prerequisite. Use after requireAuth, outside legacy billing/module gates.
 * x-business-id is an untrusted selector. No default action/module grants.
 * Future routers require a separate read-only billing gate before handlers.
 */
export function requireCommercialAccess(module: CommercialModule, action: string) {
  if (!isCommercialAction(action) || moduleForCommercialAction(action) !== module) {
    throw new Error("Explicit commercial module/action required");
  }
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) return res.status(401).json({ success: false, code: "UNAUTHENTICATED" });
    try {
      const businessId = req.headers["x-business-id"];
      if (typeof businessId !== "string" || businessId.includes(",")) {
        throw new CommercialAccessError("Single explicit workspace required");
      }
      if (req.rawHeaders.filter((_, index) => index % 2 === 0 &&
          req.rawHeaders[index].toLowerCase() === "x-business-id").length > 1) {
        throw new CommercialAccessError("Ambiguous workspace selector");
      }
      const contexts = [req.strictBusinessContext, req.tenant, getStrictRequestContext(req.user.id)];
      if (contexts.some(context => context &&
          (context.userId !== req.user!.id || context.businessId !== businessId))) {
        throw new CommercialAccessError("Request workspace mismatch");
      }
      const context = await resolveCommercialActionAccess(req.user.id, businessId, module, action);
      req.strictBusinessContext = Object.freeze({ ...context });
    } catch (error) {
      return res.status(error instanceof CommercialAccessError ? 403 : 500).json({
        success: false, code: error instanceof CommercialAccessError ? "COMMERCIAL_ACCESS_DENIED" : "COMMERCIAL_AUTHORIZATION_FAILED",
        error: "Commercial authorization failed",
      });
    }
    // Downstream errors belong to Express, not the authorization catch above.
    return runWithStrictBusinessContext(req.strictBusinessContext!, next);
  };
}
