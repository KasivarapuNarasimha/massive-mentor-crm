/**
 * Approved Stage 2 navigation hierarchy.
 * MAIN MODULE → SUB-MODULE → FEATURE (existing routes only).
 * ABSENT product ideas are intentionally omitted.
 */

export type NavMainKey = "crm" | "erp" | "settings";

export type NavFeatureDef = {
  id: string;
  label: string;
  /** Existing app route — never invent */
  href: string;
};

export type NavSubModuleDef = {
  id: string;
  label: string;
  features: NavFeatureDef[];
};

export type NavMainModuleDef = {
  id: NavMainKey;
  label: string;
  subModules: NavSubModuleDef[];
};

export const NAV_HIERARCHY: NavMainModuleDef[] = [
  {
    id: "crm",
    label: "CRM",
    subModules: [
      {
        id: "crm-overview",
        label: "Overview",
        features: [{ id: "crm-dashboard", label: "Dashboard", href: "/dashboard" }],
      },
      {
        id: "crm-sales",
        label: "Sales & Pipeline",
        features: [
          { id: "crm-leads", label: "Leads", href: "/dashboard/leads" },
          { id: "crm-assignments", label: "Assignments", href: "/dashboard/assignments" },
          { id: "crm-deals", label: "Deals", href: "/dashboard/deals" },
          { id: "crm-clients", label: "Clients", href: "/dashboard/clients" },
          { id: "crm-field-sales", label: "Field Sales", href: "/dashboard/field-sales" },
        ],
      },
      {
        id: "crm-productivity",
        label: "Productivity",
        features: [
          { id: "crm-tasks", label: "Tasks", href: "/dashboard/tasks" },
          { id: "crm-meetings", label: "Meetings", href: "/dashboard/meetings" },
          { id: "crm-notes", label: "Notes", href: "/dashboard/notes" },
          { id: "crm-documents", label: "Documents", href: "/dashboard/documents" },
          { id: "crm-activity", label: "Activity", href: "/dashboard/activity" },
        ],
      },
      {
        id: "crm-communication",
        label: "Communication",
        features: [
          { id: "crm-whatsapp", label: "WhatsApp", href: "/dashboard/whatsapp" },
          { id: "crm-media", label: "Media Library", href: "/dashboard/media" },
        ],
      },
      {
        id: "crm-ai",
        label: "AI",
        features: [
          { id: "crm-ai-sales", label: "AI Sales", href: "/dashboard/ai-sales" },
          { id: "crm-mentor", label: "AI Mentor", href: "/dashboard/mentor" },
        ],
      },
      {
        id: "crm-marketing",
        label: "Marketing",
        features: [
          { id: "crm-marketing-ai", label: "Marketing AI", href: "/dashboard/marketing" },
        ],
      },
      {
        id: "crm-insights",
        label: "Insights",
        features: [
          { id: "crm-reports", label: "Reports", href: "/dashboard/reports" },
          { id: "crm-swot", label: "SWOT", href: "/dashboard/swot" },
          { id: "crm-roadmap", label: "Growth Roadmap", href: "/dashboard/roadmap" },
          { id: "crm-health", label: "Health Score", href: "/dashboard/health" },
        ],
      },
    ],
  },
  {
    id: "erp",
    label: "ERP",
    subModules: [
      {
        id: "erp-overview",
        label: "Overview",
        features: [{ id: "erp-dashboard", label: "ERP Dashboard", href: "/dashboard/erp" }],
      },
      {
        id: "erp-finance",
        label: "Finance",
        features: [
          { id: "erp-finance-hub", label: "Finance Hub", href: "/dashboard/finance" },
          { id: "erp-approvals", label: "Approvals", href: "/dashboard/approvals" },
        ],
      },
      {
        id: "erp-sales-ops",
        label: "Sales Operations",
        features: [
          { id: "erp-sales-orders", label: "Sales Orders", href: "/dashboard/erp/sales-orders" },
        ],
      },
      {
        id: "erp-inventory",
        label: "Inventory",
        features: [
          { id: "erp-products", label: "Products", href: "/dashboard/erp/products" },
          { id: "erp-warehouses", label: "Warehouses", href: "/dashboard/erp/warehouses" },
          { id: "erp-stock", label: "Stock & Movements", href: "/dashboard/erp/inventory" },
        ],
      },
      {
        id: "erp-procurement",
        label: "Procurement",
        features: [
          { id: "erp-vendors", label: "Vendors", href: "/dashboard/erp/vendors" },
          { id: "erp-purchases", label: "Purchases", href: "/dashboard/erp/purchases" },
        ],
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    subModules: [
      {
        id: "settings-account",
        label: "Account",
        features: [
          { id: "settings-profile", label: "Business Profile", href: "/dashboard/profile" },
          { id: "settings-appearance", label: "Appearance", href: "/dashboard/settings/appearance" },
        ],
      },
      {
        id: "settings-security",
        label: "Security",
        features: [{ id: "settings-security-page", label: "Security", href: "/dashboard/security" }],
      },
      {
        id: "settings-org",
        label: "Organization",
        features: [{ id: "settings-team", label: "Team & Roles", href: "/dashboard/team" }],
      },
      {
        id: "settings-commercial",
        label: "Commercial",
        features: [{ id: "settings-billing", label: "Billing", href: "/dashboard/billing" }],
      },
      {
        id: "settings-platform",
        label: "Platform",
        features: [
          { id: "settings-integrations", label: "Integrations", href: "/dashboard/integrations" },
          { id: "settings-backups", label: "Backups", href: "/dashboard/backups" },
        ],
      },
    ],
  },
];

/** Find which sub-module contains the active pathname (longest href match). */
export function findActiveSubModuleId(pathname: string): string | null {
  const path = (pathname || "").split("?")[0] || "";
  let best: { id: string; len: number } | null = null;
  for (const main of NAV_HIERARCHY) {
    for (const sub of main.subModules) {
      for (const f of sub.features) {
        const href = f.href.split("?")[0];
        if (path === href || (href !== "/dashboard" && path.startsWith(href + "/"))) {
          if (!best || href.length > best.len) best = { id: sub.id, len: href.length };
        }
        // Exact /dashboard only for overview
        if (href === "/dashboard" && (path === "/dashboard" || path === "/dashboard/")) {
          if (!best || href.length >= (best?.len || 0)) best = { id: sub.id, len: href.length };
        }
      }
    }
  }
  return best?.id || null;
}

export function flattenHierarchyHrefs(): string[] {
  const out: string[] = [];
  for (const main of NAV_HIERARCHY) {
    for (const sub of main.subModules) {
      for (const f of sub.features) out.push(f.href.split("?")[0]);
    }
  }
  return out;
}
