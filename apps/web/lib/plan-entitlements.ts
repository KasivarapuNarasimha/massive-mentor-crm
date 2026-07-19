/**
 * Plan tiers, feature catalogs, and client-side entitlement checks.
 * Mirrors product packaging — does not change Razorpay / subscription backend.
 */

export type PlanTier = "trial" | "starter" | "professional" | "enterprise";

export type FeatureKey =
  | "leads"
  | "clients"
  | "deals"
  | "tasks"
  | "meetings"
  | "dashboard"
  | "reports"
  | "notes"
  | "documents"
  | "team"
  | "profile"
  | "billing"
  | "mentor"
  | "ai_sales"
  | "swot"
  | "marketing"
  | "finance"
  | "integrations"
  | "field_sales"
  | "approvals"
  | "roadmap"
  | "health"
  | "activity"
  | "backups"
  | "white_label"
  | "automation"
  | "security";

export type BillingCycleFilter = "monthly" | "annual";

/** Marketing feature lists for pricing cards */
export const PLAN_FEATURE_LISTS: Record<
  "starter" | "professional" | "enterprise",
  { label: string; included: boolean }[]
> = {
  starter: [
    { label: "Lead Management", included: true },
    { label: "Client Management", included: true },
    { label: "Deal Pipeline", included: true },
    { label: "Tasks", included: true },
    { label: "Meetings", included: true },
    { label: "Dashboard", included: true },
    { label: "Reports", included: true },
    { label: "Email Support", included: true },
  ],
  professional: [
    { label: "Everything in Starter", included: true },
    { label: "AI Proposal Generator", included: true },
    { label: "SWOT Analysis", included: true },
    { label: "AI Sales Forecast", included: true },
    { label: "AI Next Best Action", included: true },
    { label: "Marketing AI", included: true },
    { label: "Finance Module", included: true },
    { label: "Advanced Reports", included: true },
    { label: "WhatsApp Integration", included: true },
    { label: "Email Automation", included: true },
    { label: "Priority Support", included: true },
  ],
  enterprise: [
    { label: "Everything in Professional", included: true },
    { label: "White Label CRM", included: true },
    { label: "Custom Branding", included: true },
    { label: "API Access", included: true },
    { label: "Custom Integrations", included: true },
    { label: "AI Telecalling Integration", included: true },
    { label: "Dedicated Account Manager", included: true },
    { label: "Premium Support", included: true },
    { label: "Advanced Security", included: true },
  ],
};

/** Display-only packaging meta (users, add-on seats, annual list price). */
export type PlanPricingMeta = {
  includedUsers: number;
  additionalUserMonthly: number | null;
  additionalUserAnnual: number | null;
  /** Full year list price before 10% discount (annual cards only) */
  annualListPrice: number | null;
  badge: string;
};

export const PLAN_PRICING_META: Record<"starter" | "professional" | "enterprise", PlanPricingMeta> =
  {
    starter: {
      includedUsers: 3,
      additionalUserMonthly: 300,
      additionalUserAnnual: 3240,
      annualListPrice: 17988, // ₹1,499 × 12
      badge: "Best for Small Teams",
    },
    professional: {
      includedUsers: 10,
      additionalUserMonthly: 600,
      additionalUserAnnual: 6480,
      annualListPrice: 83988, // ₹6,999 × 12
      badge: "⭐ Most Popular",
    },
    enterprise: {
      includedUsers: 0,
      additionalUserMonthly: null,
      additionalUserAnnual: null,
      annualListPrice: null,
      badge: "Best for Large Organizations",
    },
  };

export const ANNUAL_DISCOUNT_PCT = 10;

const STARTER_FEATURES: FeatureKey[] = [
  "leads",
  "clients",
  "deals",
  "tasks",
  "meetings",
  "dashboard",
  "reports",
  "notes",
  "documents",
  "team",
  "security",
  "profile",
  "billing",
  "health",
  "activity",
];

const PROFESSIONAL_FEATURES: FeatureKey[] = [
  ...STARTER_FEATURES,
  "mentor",
  "ai_sales",
  "swot",
  "marketing",
  "finance",
  "integrations",
  "field_sales",
  "approvals",
  "roadmap",
  "automation",
];

const ENTERPRISE_FEATURES: FeatureKey[] = [
  ...PROFESSIONAL_FEATURES,
  "backups",
  "white_label",
];

/** Trial evaluates Professional-tier product capabilities */
const TIER_FEATURES: Record<PlanTier, FeatureKey[]> = {
  trial: PROFESSIONAL_FEATURES,
  starter: STARTER_FEATURES,
  professional: PROFESSIONAL_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
};

/** Human labels for lock modal */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  leads: "Lead Management",
  clients: "Client Management",
  deals: "Deal Pipeline",
  tasks: "Tasks",
  meetings: "Meetings",
  dashboard: "Dashboard",
  reports: "Reports",
  notes: "Notes",
  documents: "Documents",
  team: "Team",
  security: "Security & Sessions",
  profile: "Business Profile",
  billing: "Billing",
  mentor: "AI Mentor",
  ai_sales: "AI Sales Intelligence",
  swot: "SWOT Analysis",
  marketing: "Marketing AI",
  finance: "Finance Module",
  integrations: "Integrations (WhatsApp)",
  field_sales: "Field Sales",
  approvals: "Approvals",
  roadmap: "Growth Roadmap",
  health: "Health Score",
  activity: "Activity",
  backups: "Backups & Restore",
  white_label: "White Label CRM",
  automation: "Email Automation",
};

/** Minimum tier required for a feature */
export const FEATURE_MIN_TIER: Partial<Record<FeatureKey, PlanTier>> = {
  mentor: "professional",
  ai_sales: "professional",
  swot: "professional",
  marketing: "professional",
  finance: "professional",
  integrations: "professional",
  field_sales: "professional",
  approvals: "professional",
  roadmap: "professional",
  automation: "professional",
  backups: "enterprise",
  white_label: "enterprise",
};

/** Route → feature key for nav / page guards */
export const ROUTE_FEATURE: Record<string, FeatureKey> = {
  "/dashboard": "dashboard",
  "/dashboard/leads": "leads",
  "/dashboard/clients": "clients",
  "/dashboard/deals": "deals",
  "/dashboard/tasks": "tasks",
  "/dashboard/meetings": "meetings",
  "/dashboard/notes": "notes",
  "/dashboard/documents": "documents",
  "/dashboard/reports": "reports",
  "/dashboard/team": "team",
  "/dashboard/security": "security",
  "/dashboard/profile": "profile",
  "/dashboard/billing": "billing",
  "/dashboard/health": "health",
  "/dashboard/activity": "activity",
  "/dashboard/mentor": "mentor",
  "/dashboard/ai-sales": "ai_sales",
  "/dashboard/swot": "swot",
  "/dashboard/marketing": "marketing",
  "/dashboard/finance": "finance",
  "/dashboard/integrations": "integrations",
  "/dashboard/field-sales": "field_sales",
  "/dashboard/approvals": "approvals",
  "/dashboard/roadmap": "roadmap",
  "/dashboard/backups": "backups",
};

const TIER_RANK: Record<PlanTier, number> = {
  trial: 2, // same rank as professional for entitlement
  starter: 1,
  professional: 2,
  enterprise: 3,
};

export function resolvePlanTier(
  plan: string | null | undefined,
  isTrial?: boolean
): PlanTier {
  if (isTrial || !plan || plan === "trial") return "trial";
  const p = plan.toLowerCase();
  if (p.includes("enterprise")) return "enterprise";
  if (p.includes("professional") || p.includes("pro_")) return "professional";
  if (p.includes("starter")) return "starter";
  return "starter";
}

export function tierMeetsMinimum(current: PlanTier, minimum: PlanTier): boolean {
  // trial ranks as professional for access
  const cur = current === "trial" ? "professional" : current;
  const min = minimum === "trial" ? "professional" : minimum;
  return TIER_RANK[cur] >= TIER_RANK[min];
}

export function canAccessFeature(tier: PlanTier, feature: FeatureKey): boolean {
  const allowed = TIER_FEATURES[tier] || STARTER_FEATURES;
  return allowed.includes(feature);
}

export function minTierForFeature(feature: FeatureKey): PlanTier {
  return FEATURE_MIN_TIER[feature] || "starter";
}

export function requiredPlanName(feature: FeatureKey): string {
  const min = minTierForFeature(feature);
  if (min === "enterprise") return "Enterprise";
  if (min === "professional") return "Professional";
  return "Starter";
}

/** Package family from plan code/name for card matching */
export function planFamily(
  plan: string | null | undefined
): "starter" | "professional" | "enterprise" | "trial" | "unknown" {
  if (!plan) return "unknown";
  const p = plan.toLowerCase();
  if (p === "trial") return "trial";
  if (p.includes("enterprise")) return "enterprise";
  if (p.includes("professional")) return "professional";
  if (p.includes("starter")) return "starter";
  return "unknown";
}

export function planCycle(
  plan: string | null | undefined,
  billingCycle?: string | null
): BillingCycleFilter | null {
  if (billingCycle === "monthly" || billingCycle === "annual") return billingCycle;
  if (!plan) return null;
  const p = plan.toLowerCase();
  if (p.includes("annual") || p.includes("yearly")) return "annual";
  if (p.includes("monthly")) return "monthly";
  return null;
}

export function sortPlanFamilies<T extends { code: string; name: string }>(
  plans: T[]
): T[] {
  const rank = (code: string, name: string) => {
    const s = `${code} ${name}`.toLowerCase();
    if (s.includes("starter")) return 1;
    if (s.includes("professional")) return 2;
    if (s.includes("enterprise")) return 3;
    return 9;
  };
  return [...plans].sort(
    (a, b) => rank(a.code, a.name) - rank(b.code, b.name) || a.code.localeCompare(b.code)
  );
}

export function displayPlanName(code: string, name: string): string {
  const s = `${code} ${name}`.toLowerCase();
  if (s.includes("enterprise")) return "Enterprise";
  if (s.includes("professional")) return "Professional";
  if (s.includes("starter")) return "Starter";
  return name.replace(/\s*(Monthly|Annual|Yearly)\s*/gi, " ").trim() || name;
}

export function isEnterprisePlan(code: string, name: string): boolean {
  return `${code} ${name}`.toLowerCase().includes("enterprise");
}

export function isProfessionalPlan(code: string, name: string): boolean {
  return `${code} ${name}`.toLowerCase().includes("professional");
}

export function isStarterPlan(code: string, name: string): boolean {
  return `${code} ${name}`.toLowerCase().includes("starter");
}

export const SALES_EMAIL = "team@massivementor.in";
export const SALES_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
  "Enterprise CRM inquiry"
)}`;
export const DEMO_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
  "Schedule Enterprise Demo — Massive Mentor CRM"
)}&body=${encodeURIComponent(
  "Hi Massive Mentor team,\n\nI'd like to schedule a demo for the Enterprise plan.\n\nCompany:\nUsers needed:\nWhite label: Yes/No\nCustom AI needs:\n\nThanks"
)}`;

/** Feature comparison matrix for pricing table */
export const COMPARISON_ROWS: {
  label: string;
  starter: boolean;
  professional: boolean;
  enterprise: boolean;
}[] = [
  { label: "Leads", starter: true, professional: true, enterprise: true },
  { label: "Clients", starter: true, professional: true, enterprise: true },
  { label: "Deals", starter: true, professional: true, enterprise: true },
  { label: "Tasks", starter: true, professional: true, enterprise: true },
  { label: "Meetings", starter: true, professional: true, enterprise: true },
  { label: "Reports", starter: true, professional: true, enterprise: true },
  { label: "AI Features", starter: false, professional: true, enterprise: true },
  { label: "Finance", starter: false, professional: true, enterprise: true },
  { label: "Marketing AI", starter: false, professional: true, enterprise: true },
  { label: "WhatsApp", starter: false, professional: true, enterprise: true },
  { label: "API Access", starter: false, professional: false, enterprise: true },
  { label: "White Label", starter: false, professional: false, enterprise: true },
  { label: "Priority Support", starter: false, professional: true, enterprise: true },
];
