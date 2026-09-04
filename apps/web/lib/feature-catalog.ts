/**
 * Global Feature Search catalog — existing routes only + search aliases.
 */
import { NAV_HIERARCHY, type NavMainKey } from "./nav-hierarchy";
import { moduleKeyForPath } from "./module-permissions";

export type FeatureCatalogEntry = {
  id: string;
  label: string;
  href: string;
  main: NavMainKey;
  mainLabel: string;
  subModuleId: string;
  subModuleLabel: string;
  /** Extra search terms */
  aliases: string[];
  moduleKey: string | null;
  /**
   * When true, only Business Admin / CEO (Team Activity viewers) see this hit.
   * Enforced in searchFeatures via opts.canViewTeamActivity.
   */
  requiresTeamActivityViewer?: boolean;
};

function buildCatalog(): FeatureCatalogEntry[] {
  const entries: FeatureCatalogEntry[] = [];

  for (const main of NAV_HIERARCHY) {
    for (const sub of main.subModules) {
      for (const f of sub.features) {
        const basePath = f.href.split("?")[0];
        entries.push({
          id: f.id,
          label: f.label,
          href: f.href,
          main: main.id,
          mainLabel: main.label,
          subModuleId: sub.id,
          subModuleLabel: sub.label,
          aliases: [],
          moduleKey: moduleKeyForPath(basePath),
        });
      }
    }
  }

  // Embedded / alias entries → existing parent routes (no new pages)
  const extras: Array<Omit<FeatureCatalogEntry, "moduleKey"> & { moduleKey?: string | null }> = [
    {
      id: "alias-follow-ups",
      label: "Follow-ups",
      href: "/dashboard/tasks",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-productivity",
      subModuleLabel: "Productivity",
      aliases: ["follow up", "followup", "follow-up", "nba", "next best action"],
    },
    {
      id: "alias-conversations",
      label: "Conversations",
      href: "/dashboard/whatsapp",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-communication",
      subModuleLabel: "Communication",
      aliases: ["chat", "inbox", "wa chat"],
    },
    {
      id: "alias-broadcasts",
      label: "Broadcasts",
      href: "/dashboard/whatsapp",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-communication",
      subModuleLabel: "Communication",
      aliases: ["broadcast", "bulk whatsapp"],
    },
    {
      id: "alias-ai-lead-score",
      label: "AI Lead Analysis",
      href: "/dashboard/leads",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-ai",
      subModuleLabel: "AI",
      aliases: ["lead score", "ai score", "scoring"],
    },
    {
      id: "alias-ai-followup",
      label: "AI Follow-up Suggestions",
      href: "/dashboard/ai-sales",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-ai",
      subModuleLabel: "AI",
      aliases: ["follow-up suggestions", "ai follow up"],
    },
    {
      id: "alias-ai-proposal",
      label: "AI Proposal Generator",
      href: "/dashboard/ai-sales",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-ai",
      subModuleLabel: "AI",
      aliases: ["proposal", "ai proposal"],
    },
    {
      id: "alias-finance-invoices",
      label: "Invoices",
      href: "/dashboard/finance?tab=invoices",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-finance",
      subModuleLabel: "Finance",
      aliases: ["invoice", "bill"],
    },
    {
      id: "alias-finance-expenses",
      label: "Expenses",
      href: "/dashboard/finance?tab=expenses",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-finance",
      subModuleLabel: "Finance",
      aliases: ["expense", "cost"],
    },
    {
      id: "alias-finance-payments",
      label: "Payments",
      href: "/dashboard/finance?tab=payments",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-finance",
      subModuleLabel: "Finance",
      aliases: ["payment", "receipt"],
    },
    {
      id: "alias-finance-overview",
      label: "Income / Overview",
      href: "/dashboard/finance?tab=overview",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-finance",
      subModuleLabel: "Finance",
      aliases: ["income", "revenue", "p&l", "pnl", "profit", "loss", "tax", "gst"],
    },
    {
      id: "alias-categories",
      label: "Product Categories",
      href: "/dashboard/erp/products",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-inventory",
      subModuleLabel: "Inventory",
      aliases: ["category", "categories", "sku category"],
    },
    {
      id: "alias-stock",
      label: "Stock",
      href: "/dashboard/erp/inventory",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-inventory",
      subModuleLabel: "Inventory",
      aliases: ["stock", "on hand", "low stock"],
    },
    {
      id: "alias-stock-movements",
      label: "Stock Movements",
      href: "/dashboard/erp/inventory",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-inventory",
      subModuleLabel: "Inventory",
      aliases: ["stock movement", "adjustment", "opening stock"],
    },
    {
      id: "alias-po",
      label: "Purchase Orders",
      href: "/dashboard/erp/purchases",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-procurement",
      subModuleLabel: "Procurement",
      aliases: ["po", "purchase order", "purchase orders"],
    },
    {
      id: "alias-grn",
      label: "Goods Receipts",
      href: "/dashboard/erp/purchases",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-procurement",
      subModuleLabel: "Procurement",
      aliases: ["grn", "goods receipt", "goods received"],
    },
    {
      id: "alias-pr",
      label: "Purchase Returns",
      href: "/dashboard/erp/purchases",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-procurement",
      subModuleLabel: "Procurement",
      aliases: ["purchase return", "returns"],
    },
    {
      id: "alias-so",
      label: "Sales Orders",
      href: "/dashboard/erp/sales-orders",
      main: "erp",
      mainLabel: "ERP",
      subModuleId: "erp-sales-ops",
      subModuleLabel: "Sales Operations",
      aliases: ["so", "sales order", "stock out", "fulfillment"],
    },
    {
      id: "alias-wa",
      label: "WhatsApp",
      href: "/dashboard/whatsapp",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-communication",
      subModuleLabel: "Communication",
      aliases: ["wa", "whats app"],
    },
    // Dashboard-linked / team activity (Member Activity lives on Dashboard)
    {
      id: "alias-team-activity",
      label: "Team Activity",
      href: "/dashboard#member-activity-heading",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-dashboard",
      subModuleLabel: "Dashboard",
      aliases: ["team activity", "activity toast", "live activity", "team"],
      requiresTeamActivityViewer: true,
    },
    {
      id: "alias-member-activity",
      label: "Member Activity",
      href: "/dashboard#member-activity-heading",
      main: "crm",
      mainLabel: "CRM",
      subModuleId: "crm-dashboard",
      subModuleLabel: "Dashboard",
      aliases: ["member activity", "team member", "team members", "team"],
      requiresTeamActivityViewer: true,
    },
    {
      id: "alias-lead-status",
      label: "Lead Status",
      href: "/dashboard/settings/custom-fields",
      main: "settings",
      mainLabel: "Settings",
      subModuleId: "settings-account",
      subModuleLabel: "Account",
      aliases: ["status", "pipeline status", "lead statuses", "configure status"],
    },
    {
      id: "alias-deal-status",
      label: "Deal Status / Stage",
      href: "/dashboard/settings/custom-fields",
      main: "settings",
      mainLabel: "Settings",
      subModuleId: "settings-account",
      subModuleLabel: "Account",
      aliases: ["deal status", "deal stage", "kanban status", "stage"],
    },
  ];

  for (const e of extras) {
    const basePath = e.href.split("?")[0].split("#")[0];
    entries.push({
      ...e,
      moduleKey: e.moduleKey ?? moduleKeyForPath(basePath),
    });
  }

  // Built-in aliases for primary labels
  const boost: Record<string, string[]> = {
    "crm-dashboard": ["home", "overview", "dash"],
    "crm-leads": ["lead", "prospect"],
    "crm-deals": ["pipeline", "opportunity", "deal"],
    "crm-clients": ["contact", "contacts", "customer"],
    "crm-activity": ["audit", "activity log", "activity"],
    "crm-tasks": ["task", "follow up", "follow-ups"],
    "crm-team": ["team", "roles", "employees"],
    "settings-team": ["team", "roles", "employees", "attendance", "payroll"],
    "crm-whatsapp": ["whatsapp", "wa"],
    "crm-ai-sales": ["ai sales", "intelligence"],
    "crm-mentor": ["mentor", "assistant", "chat"],
    "erp-finance-hub": ["finance", "books", "accounting", "invoice", "invoices"],
    "erp-products": ["product", "sku", "catalog"],
    "erp-purchases": ["purchases", "procurement"],
    "erp-sales-orders": ["sales order", "so"],
    "settings-custom-fields": ["custom fields", "standard fields", "lead status", "field config"],
    "settings-billing": ["subscription", "plan", "razorpay"],
  };
  for (const e of entries) {
    const extra = boost[e.id];
    if (extra) e.aliases = [...e.aliases, ...extra];
  }

  return entries;
}

export const FEATURE_CATALOG: FeatureCatalogEntry[] = buildCatalog();

export function searchFeatures(
  query: string,
  opts?: {
    modules?: string[] | null;
    canAccess?: (href: string) => boolean;
    /** When false, hide Team Activity / Member Activity aliases */
    canViewTeamActivity?: boolean;
  }
): FeatureCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: Array<{ e: FeatureCatalogEntry; score: number }> = [];
  for (const e of FEATURE_CATALOG) {
    // Default-deny: Team Activity aliases only when caller explicitly allows
    if (e.requiresTeamActivityViewer && !opts?.canViewTeamActivity) continue;
    if (opts?.canAccess && !opts.canAccess(e.href.split("?")[0].split("#")[0])) continue;
    if (opts?.modules && e.moduleKey) {
      // Soft: if modules loaded and key known, require grant OR erp/finance umbrella for erp_*
      const mods = opts.modules;
      const key = e.moduleKey;
      const ok =
        mods.includes(key) ||
        key === "profile" ||
        key === "appearance" ||
        (key.startsWith("erp_") && (mods.includes("erp") || mods.includes("finance"))) ||
        (key === "erp" && (mods.includes("erp") || mods.includes("finance") || mods.includes("approvals")));
      // Also allow via canAccess if provided — already applied above for path
      if (!ok && opts.canAccess) {
        // path gate already ran
      } else if (!ok && !opts.canAccess) {
        continue;
      }
    }

    const hay = [e.label, e.subModuleLabel, e.mainLabel, ...e.aliases].join(" ").toLowerCase();
    let score = 0;
    if (e.label.toLowerCase() === q) score = 100;
    else if (e.label.toLowerCase().startsWith(q)) score = 80;
    else if (e.aliases.some((a) => a.toLowerCase() === q)) score = 90;
    else if (e.aliases.some((a) => a.toLowerCase().startsWith(q))) score = 70;
    else if (hay.includes(q)) score = 40;
    else continue;
    scored.push({ e, score });
  }

  scored.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label));
  // Dedupe by href+label
  const seen = new Set<string>();
  const out: FeatureCatalogEntry[] = [];
  for (const { e } of scored) {
    const k = `${e.href}|${e.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= 12) break;
  }
  return out;
}
