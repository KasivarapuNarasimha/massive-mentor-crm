/**
 * Multi-tenant request context (PROJECT_RULES §13).
 * Resolved from membership; never trust client-supplied businessId alone.
 */
export type PlatformRole = "user" | "super_admin";

export type TenantContext = {
  userId: string;
  businessId: string;
  businessRole: string;
  permissions: string[];
  platformRole: PlatformRole;
  businessName: string;
};
