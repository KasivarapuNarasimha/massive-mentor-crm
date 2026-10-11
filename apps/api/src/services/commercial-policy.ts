/** Eligibility is a ceiling, never a grant. No templates or seeds use this catalog. */
export const COMMERCIAL_ACTIONS = [
  "quotation.read", "quotation.create", "quotation.update", "quotation.send",
  "quotation.approve", "quotation.acceptance.record", "invoice.read", "invoice.issue",
  "payment.read", "payment.record", "payment.reverse",
  "commercial.permissions.manage", "commercial.policy.manage",
] as const;
export type CommercialAction = typeof COMMERCIAL_ACTIONS[number];
export type CommercialModule = "quotations" | "finance" | "erp_sales";
export const COMMERCIAL_GRANT_MODULES = ["quotations", "finance"] as const;
const admins = ["owner", "admin", "business_admin", "ceo"];
export function isCommercialAction(action: unknown): action is CommercialAction {
  return typeof action === "string" && (COMMERCIAL_ACTIONS as readonly string[]).includes(action);
}
export function moduleForCommercialAction(action: CommercialAction): "quotations" | "finance" {
  return action.startsWith("invoice.") || action.startsWith("payment.") ? "finance" : "quotations";
}
export function commercialRoleEligible(role: string, action: CommercialAction): boolean {
  // Acceptance recorder/evidence policy is not approved: explicitly deny for now.
  if (action === "quotation.acceptance.record") return false;
  if (action.startsWith("commercial.")) return admins.includes(role);
  if (action === "quotation.approve") return [...admins, "sales_manager"].includes(role);
  if (action === "quotation.read") return [...admins, "sales_manager", "sales_executive", "finance"].includes(role);
  if (action.startsWith("quotation.")) return [...admins, "sales_manager", "sales_executive"].includes(role);
  return [...admins, "finance"].includes(role);
}
export function commercialActionsFromPermissions(permissions: unknown): CommercialAction[] {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) throw new Error("Invalid commercial permissions");
  const values = (permissions as { commercialActions?: unknown }).commercialActions;
  if (!Array.isArray(values) || values.some(value => !isCommercialAction(value))) throw new Error("Registered commercial grants required");
  return [...new Set(values)] as CommercialAction[];
}
