/**
 * Shared ERP tenant + role gate.
 * All ERP writes require a non-null businessId.
 */
import { getUserBusinessId } from "./field-engine.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";

const ERP_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "finance",
  "super_admin",
]);

export async function assertErpAccess(userId: string): Promise<{
  businessId: string;
  role: string;
}> {
  const role = await resolveActorRole(userId);
  if (!ERP_ROLES.has(role)) {
    throw new Error(
      "ERP module is restricted to Finance, CEO, and Admin roles"
    );
  }
  const businessId = await getUserBusinessId(userId);
  if (!businessId) {
    throw new Error("Business workspace is required for ERP operations");
  }
  return { businessId, role };
}

export function requireNonNullBusinessId(
  businessId: string | null | undefined,
  label = "ERP record"
): string {
  if (!businessId) {
    throw new Error(`Business workspace is required to create ${label}`);
  }
  return businessId;
}
