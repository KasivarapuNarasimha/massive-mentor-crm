import { getMemberModuleKeys } from "../permissions.service.js";
import { resolveActorRole } from "../tenant-scope.service.js";
import { getUserBusinessId } from "../field-engine.service.js";
import type { ActionContext, ActionDef } from "./types.js";

export async function buildActionContext(userId: string, locale?: string): Promise<ActionContext> {
  const businessId = await getUserBusinessId(userId);
  const [moduleKeys, role] = await Promise.all([
    getMemberModuleKeys(userId, businessId),
    resolveActorRole(userId),
  ]);
  return {
    userId,
    businessId,
    role,
    moduleKeys,
    locale,
    now: new Date(),
    bindings: {},
  };
}

export function assertActionAllowed(
  ctx: ActionContext,
  action: ActionDef
): { ok: true } | { ok: false; error: string } {
  if (ctx.moduleKeys.includes("dashboard") === false && action.modules.length === 0) {
    /* ok */
  }
  const allowed = action.modules.some(
    (m) =>
      ctx.moduleKeys.includes(m) ||
      (m === "leads" && ctx.moduleKeys.includes("clients")) ||
      (m === "clients" && ctx.moduleKeys.includes("leads")) ||
      (m === "erp" &&
        (ctx.moduleKeys.includes("erp_products") ||
          ctx.moduleKeys.includes("erp_inventory") ||
          ctx.moduleKeys.includes("finance")))
  );
  // insights / dashboard: allow if any CRM or finance or erp
  if (action.category === "insights") {
    if (
      ctx.moduleKeys.includes("dashboard") ||
      ctx.moduleKeys.includes("leads") ||
      ctx.moduleKeys.includes("finance") ||
      ctx.moduleKeys.includes("erp")
    ) {
      /* allow */
    } else if (!allowed) {
      return { ok: false, error: "You don't have permission to view business insights." };
    }
  } else if (!allowed && action.modules.length > 0) {
    return {
      ok: false,
      error: `You don't have permission to run "${action.name}". Required: ${action.modules.join(" or ")}.`,
    };
  }
  if (action.roles?.length) {
    const roleOk =
      action.roles.includes(ctx.role) ||
      ["owner", "admin", "business_admin", "ceo", "super_admin"].includes(ctx.role);
    if (!roleOk) {
      return { ok: false, error: `Your role (${ctx.role}) cannot perform "${action.name}".` };
    }
  }
  return { ok: true };
}
