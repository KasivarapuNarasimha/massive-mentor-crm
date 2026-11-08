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
  | "media"
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
  | "security"
  | "dialer"
  | "team_chat"
  | "whatsapp"
  | "erp";

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

/**
 * Display rate card for new subscriptions. Annual is 12 × monthly with no
 * extra discount. Must stay aligned with apps/api/src/services/saas-pricing.ts.
 * Existing subscriptions are not repriced here.
 */
export const GST_RATE = 0.18;
export const SETUP_FEE_INR = 30000;
export const ANNUAL_MONTHS = 12;
export const PER_USER_MONTHLY_INR = { starter: 300, professional: 600 } as const;

export type PlanPricingMeta = {
  defaultUsers: number;
  includedUsers?: number;
  annualListPrice?: number;
  additionalUserMonthly?: number;
  perUserMonthly: number | null;
  badge: string;
};

export const PLAN_PRICING_META: Record<"starter" | "professional" | "enterprise", PlanPricingMeta> =
  {
    starter: {
      defaultUsers: 3,
      perUserMonthly: PER_USER_MONTHLY_INR.starter,
      badge: "Best for Small Teams",
    },
    professional: {
      defaultUsers: 10,
      perUserMonthly: PER_USER_MONTHLY_INR.professional,
      badge: "⭐ Most Popular",
    },
    enterprise: {
      defaultUsers: 0,
      perUserMonthly: null,
      badge: "Best for Large Organizations",
    },
  };

export function perUserUnit(
  tier: "starter" | "professional",
  cycle: "monthly" | "annual"
): number {
  const monthly = PER_USER_MONTHLY_INR[tier];
  return cycle === "annual" ? monthly * ANNUAL_MONTHS : monthly;
}

/** Pre-tax quote for a new subscription. Renewal is priced on the server. */
export function quotePlanDisplay(input: {
  tier: "starter" | "professional";
  cycle: "monthly" | "annual";
  userCount: number;
  setupFeePaid: boolean;
  purpose: string;
}): {
  unitPrice: number;
  subscriptionBase: number;
  setupFee: number;
  taxable: number;
  gst: number;
  total: number;
} {
  const users = Math.max(1, Math.floor(input.userCount));
  const unitPrice = perUserUnit(input.tier, input.cycle);
  const subscriptionBase = Math.round(users * unitPrice * 100) / 100;
  const setupFee = input.purpose !== "renewal" && !input.setupFeePaid ? SETUP_FEE_INR : 0;
  const taxable = Math.round((subscriptionBase + setupFee) * 100) / 100;
  const gst = Math.round(taxable * GST_RATE * 100) / 100;
  const total = Math.round((taxable + gst) * 100) / 100;
  return { unitPrice, subscriptionBase, setupFee, taxable, gst, total };
}

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
  "media",
  "team",
  "security",
  "profile",
  "billing",
  "health",
  "activity",
  "dialer",
  "team_chat",
  "whatsapp",
  "erp",
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
  media: "Media Library",
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
  dialer: "Cloud Telephony Dialer",
  team_chat: "Team Chat",
  whatsapp: "WhatsApp Conversation Center",
  erp: "ERP System",
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
  "/dashboard/assignments": "leads",
  "/dashboard/media": "media",
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
  "/dashboard/dialer": "dialer",
  "/dashboard/team-chat": "team_chat",
  "/dashboard/whatsapp": "whatsapp",
  "/dashboard/erp": "erp",
  "/dashboard/erp/products": "erp",
  "/dashboard/erp/inventory": "erp",
  "/dashboard/erp/warehouses": "erp",
  "/dashboard/erp/vendors": "erp",
  "/dashboard/erp/purchases": "erp",
  "/dashboard/erp/sales-orders": "erp",
  "/dashboard/settings/appearance": "profile",
  "/dashboard/settings/custom-fields": "security",
  "/dashboard/settings/telephony/browser-dialer-poc": "dialer",
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
