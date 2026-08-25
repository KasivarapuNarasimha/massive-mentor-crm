"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { usePortal } from "@/lib/portal-context";
import { subscribeDataChanged } from "@/lib/data-events";
import { formatNotificationMessage, formatNotificationTitle } from "@/lib/format-activity";
import { FieldStatusBar } from "@/components/field/FieldStatusBar";
import { ApiConnectivityBanner } from "@/components/dashboard/ApiConnectivityBanner";
import { SystemStatusIndicator } from "@/components/dashboard/SystemStatusIndicator";
import { TrialBanner } from "@/components/dashboard/TrialBanner";
import { setAppCurrency, isCurrencyCode, detectDefaultCurrency } from "@/lib/currency";
import { usePlan } from "@/lib/plan-context";
import {
  FEATURE_MIN_TIER,
  ROUTE_FEATURE,
  type FeatureKey,
} from "@/lib/plan-entitlements";
import { FeatureGate } from "@/components/billing/FeatureGate";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { canAccessPath, filterNavByModules } from "@/lib/module-permissions";
import { NAV_HIERARCHY, findActiveSubModuleId, type NavMainKey } from "@/lib/nav-hierarchy";
import { FeatureSearch } from "@/components/dashboard/FeatureSearch";

/** Layout chrome heights — enterprise density (header ~56px) */
const NAV_H = "3.5rem"; // 56px
const FIELD_BAR_H = "2.75rem"; // 44px — slightly denser strip
const DEMO_BANNER_H = "2rem";

interface NavItem {
  /** Stable unique React key (menu key preferred over href) */
  key?: string;
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Optional count badge (e.g. media file total) */
  badge?: number | string | null;
}

const navItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1v-5m-6 0a1 1 0 001-1v-3" />
      </svg>
    ),
  },
  {
    href: "/dashboard/profile",
    label: "Business Profile",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 01-2-2H7a2 2 0 01-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    href: "/dashboard/billing",
    label: "Billing",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/health",
    label: "Health Score",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 01-2-2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/swot",
    label: "SWOT Analysis",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/mentor",
    label: "AI Mentor",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/marketing",
    label: "Marketing AI",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/roadmap",
    label: "Growth Roadmap",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
];

// CRM section items (added for Phase 3 without modifying existing)
const crmNavItems: NavItem[] = [
  {
    href: "/dashboard/leads",
    label: "Leads",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/assignments",
    label: "Assignments",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/dashboard/media",
    label: "Media Library",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/whatsapp",
    label: "WhatsApp",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/clients",
    label: "Clients",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 01-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/deals",
    label: "Deals",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 01-2-2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/tasks",
    label: "Tasks",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2m2-2a2 2 0 012-2M9 5a2 2 0 012-2m0 0V3a2 2 0 012-2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/meetings",
    label: "Meetings",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/notes",
    label: "Notes",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/documents",
    label: "Documents",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/ai-sales",
    label: "AI Sales Intelligence",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17.687a3 3 0 01-3.663-3.663V6a3 3 0 013.663-3.663 3 3 0 013.663 3.663v8.024a3 3 0 01-3.663 3.663zM12 21v-4M4 21v-4M20 21v-4" />
      </svg>
    ),
  },
  // Batch 5 additions (modular, additive)
  {
    href: "/dashboard/field-sales",
    label: "Field Sales",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/integrations",
    label: "Integrations",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/team",
    label: "Team & Roles",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 01-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/security",
    label: "Security",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/approvals",
    label: "Approvals",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/finance",
    label: "Finance",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/reports",
    label: "Reports & Analytics",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/backups",
    label: "Backups",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M8 12h8" />
      </svg>
    ),
  },
  {
    href: "/dashboard/activity",
    label: "Activity Timeline",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

type ModuleDef = { key: string; label: string; enabled: boolean; route?: string; order?: number };

const DEFAULT_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

/** Always available — never gated by plan, portal seed lag, or role */
const SETTINGS_NAV: NavItem[] = [
  {
    key: "settings:appearance",
    href: "/dashboard/settings/appearance",
    label: "Appearance",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    ),
  },
  {
    key: "settings:custom-fields",
    href: "/dashboard/settings/custom-fields",
    label: "Custom Fields",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6h16M4 10h10M4 14h16M4 18h8"
        />
      </svg>
    ),
  },
  {
    key: "settings:security",
    href: "/dashboard/security",
    label: "Security",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    ),
  },
];

const APPEARANCE_HREF = "/dashboard/settings/appearance";
const CUSTOM_FIELDS_HREF = "/dashboard/settings/custom-fields";

/** ERP section routes — Finance is existing; do not duplicate modules */
const ERP_HREFS = new Set([
  "/dashboard/erp",
  "/dashboard/finance",
  "/dashboard/approvals",
  "/dashboard/erp/products",
  "/dashboard/erp/inventory",
  "/dashboard/erp/warehouses",
  "/dashboard/erp/vendors",
  "/dashboard/erp/purchases",
  "/dashboard/erp/sales-orders",
]);

const ERP_NAV_ORDER = [
  "/dashboard/erp",
  "/dashboard/finance",
  "/dashboard/approvals",
  "/dashboard/erp/products",
  "/dashboard/erp/inventory",
  "/dashboard/erp/warehouses",
  "/dashboard/erp/vendors",
  "/dashboard/erp/sales-orders",
  "/dashboard/erp/purchases",
];

/** Settings / platform (not CRM sales, not ERP ops) */
const SETTINGS_HREFS = new Set([
  "/dashboard/profile",
  "/dashboard/billing",
  "/dashboard/team",
  "/dashboard/security",
  "/dashboard/backups",
  "/dashboard/integrations",
  "/dashboard/settings/appearance",
  APPEARANCE_HREF,
  CUSTOM_FIELDS_HREF,
]);

function navSectionFor(href: string): "crm" | "erp" | "settings" {
  if (ERP_HREFS.has(href) || href.startsWith("/dashboard/erp/")) return "erp";
  if (SETTINGS_HREFS.has(href) || href.startsWith("/dashboard/settings/")) return "settings";
  return "crm";
}

const ERP_DASHBOARD_ITEM: NavItem = {
  key: "erp:dashboard",
  href: "/dashboard/erp",
  label: "ERP Dashboard",
  icon: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM11 13a1 1 0 011-1h7a1 1 0 011 1v6a1 1 0 01-1 1h-7a1 1 0 01-1-1v-6z"
      />
    </svg>
  ),
};

const ERP_PHASE2_ITEMS: Array<NavItem & { moduleKey: string }> = [
  {
    key: "erp:products",
    href: "/dashboard/erp/products",
    label: "Products",
    moduleKey: "erp_products",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      </svg>
    ),
  },
  {
    key: "erp:inventory",
    href: "/dashboard/erp/inventory",
    label: "Inventory",
    moduleKey: "erp_inventory",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 7h16M4 12h16M4 17h16"
        />
      </svg>
    ),
  },
  {
    key: "erp:warehouses",
    href: "/dashboard/erp/warehouses",
    label: "Warehouses",
    moduleKey: "erp_inventory",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"
        />
      </svg>
    ),
  },
  {
    key: "erp:vendors",
    href: "/dashboard/erp/vendors",
    label: "Vendors",
    moduleKey: "erp_vendors",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 17a4 4 0 118 0M5 21h14M9 7h6m-7 4h8M7 3h10l1 8H6L7 3z"
        />
      </svg>
    ),
  },
  {
    key: "erp:sales-orders",
    href: "/dashboard/erp/sales-orders",
    label: "Sales Orders",
    moduleKey: "erp_sales",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
        />
      </svg>
    ),
  },
  {
    key: "erp:purchases",
    href: "/dashboard/erp/purchases",
    label: "Purchases",
    moduleKey: "erp_purchases",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
        />
      </svg>
    ),
  },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, logout, token } = useAuth();
  const { portal, workspaceRole, setWorkspaceRole, isLoading: portalLoading } = usePortal();
  const { can, requireFeature, plan, isTrial, planStatus, licenseStatus } = usePlan();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Desktop collapse — icons-only rail */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{
      id: string;
      title: string;
      message: string;
      isRead: boolean;
      type?: string;
      createdAt?: string;
      entityType?: string;
    }>
  >([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [configModules, setConfigModules] = useState<ModuleDef[] | null>(null);
  /** Total media files for sidebar badge */
  const [mediaFileCount, setMediaFileCount] = useState<number | null>(null);
  /** Manual sub-module expand overrides; cleared on route change (active-only default) */
  const [manualExpandedSubs, setManualExpandedSubs] = useState<Record<string, boolean>>({});
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Reset manual expands when navigating so only the active sub-module stays open
  useEffect(() => {
    setManualExpandedSubs({});
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === "/dashboard" || href === "/dashboard/erp") return pathname === href;
    return pathname.startsWith(href);
  };

  const featureForRoute = (href: string): FeatureKey | null => {
    if (ROUTE_FEATURE[href]) return ROUTE_FEATURE[href];
    // Prefix match for nested routes
    const hit = Object.keys(ROUTE_FEATURE)
      .filter((r) => r !== "/dashboard" && href.startsWith(r))
      .sort((a, b) => b.length - a.length)[0];
    return hit ? ROUTE_FEATURE[hit] : null;
  };

  const isRouteLocked = (href: string) => {
    const f = featureForRoute(href);
    return f ? !can(f) : false;
  };

  const onNavClick = (e: React.MouseEvent, href: string) => {
    const f = featureForRoute(href);
    if (f && !requireFeature(f)) {
      e.preventDefault();
      setSidebarOpen(false);
    }
  };

  const routeFeature = featureForRoute(pathname || "/dashboard");

  // Close user menu on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [userMenuOpen]);

  const loadNotifs = useCallback((opts?: { showLoading?: boolean }) => {
    if (!token) return;
    // Only show full-panel loading on first empty load — never for poll/refresh
    if (opts?.showLoading) setNotifLoading(true);
    api
      .get<{
        notifications?: Array<{
          id: string;
          title: string;
          message: string;
          isRead: boolean;
          type?: string;
          createdAt?: string;
          entityType?: string;
        }>;
        unreadCount?: number;
      }>("/automations/notifications?pageSize=30", token)
      .then((res) => {
        if (res.success && res.data) {
          const d = res.data;
          // Support both { notifications } and accidental nested shapes
          const raw = d as Record<string, unknown>;
          type Notif = {
            id: string;
            title: string;
            message: string;
            isRead: boolean;
            type?: string;
            createdAt?: string;
            entityType?: string;
          };
          const list: Notif[] = Array.isArray(d.notifications)
            ? d.notifications
            : Array.isArray(raw.items)
              ? (raw.items as Notif[])
              : [];
          setNotifications(list);
          setUnreadCount(
            typeof d.unreadCount === "number"
              ? d.unreadCount
              : list.filter((n) => !n.isRead).length
          );
          setNotifError(null);
        } else {
          setNotifError(res.error || "Failed to load notifications");
        }
      })
      .catch((err) => {
        setNotifError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => setNotifLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;

    loadNotifs({ showLoading: true });
    // Poll + refresh when CRM data changes (create lead/deal/task/meeting)
    const pollId = setInterval(() => loadNotifs(), 8000);
    const unsub = subscribeDataChanged(() => {
      // Small delay so server has committed the Notification row after create
      setTimeout(() => loadNotifs(), 150);
      // Refresh media count on library mutations
      setTimeout(() => {
        api.getMediaCount(token).then((r) => {
          if (r.success && r.data && typeof r.data.total === "number") {
            setMediaFileCount(r.data.total);
          }
        });
      }, 200);
    });

    api.getMediaCount(token).then((r) => {
      if (r.success && r.data && typeof r.data.total === "number") {
        setMediaFileCount(r.data.total);
      }
    });

    api.getBusinessConfig(token).then((res) => {
      if (res.success && res.data?.config) {
        const mods = (res.data.config as { modules?: ModuleDef[] }).modules;
        if (Array.isArray(mods) && mods.length) setConfigModules(mods);
      }
    }).catch(() => {});

    return () => {
      clearInterval(pollId);
      unsub();
    };
  }, [token, loadNotifs]);

  // Close notification panel on outside click; refresh list when opened
  useEffect(() => {
    if (!notifOpen) return;
    loadNotifs({ showLoading: notifications.length === 0 });
    const onDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when panel opens
  }, [notifOpen, loadNotifs]);

  const markOneRead = async (id: string) => {
    if (!token) return;
    // Optimistic UI
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    const res = await api.post(`/automations/notifications/${id}/read`, {}, token);
    if (!res.success) {
      loadNotifs();
      return;
    }
    loadNotifs();
  };

  const markAllRead = async () => {
    if (!token) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    const res = await api.post("/automations/notifications/read-all", {}, token);
    if (!res.success) {
      loadNotifs();
      return;
    }
    loadNotifs();
  };

  /** Merge static nav with BusinessConfig modules (enabled + labels). Never industry-specific. */
  const resolveNav = (items: NavItem[]): NavItem[] => {
    if (!configModules) return items;
    return items
      .map((item) => {
        const mod = configModules.find(
          (m) => m.route === item.href || item.href.endsWith(`/${m.key}`) || m.key === "overview" && item.href === "/dashboard"
        );
        if (mod && mod.enabled === false) return null;
        if (mod?.label) return { ...item, label: mod.label };
        return item;
      })
      .filter(Boolean) as NavItem[];
  };

  // Prefer portal menus from DB config; one entry per route, unique React keys
  const portalNav: NavItem[] | null = (() => {
    if (!portal?.menus || portal.menus.length === 0) return null;
    const seenRoutes = new Set<string>();
    const items: NavItem[] = [];
    const rolePrefix = portal.role || portal.portalKey || "portal";
    for (const m of portal.menus) {
      if (!m.route || seenRoutes.has(m.route)) continue;
      seenRoutes.add(m.route);
      const known =
        [...navItems, ...crmNavItems].find((n) => n.href === m.route) || null;
      items.push({
        key: `${rolePrefix}:${m.key || m.route}`,
        href: m.route,
        label: m.label,
        icon: known?.icon || DEFAULT_ICON,
      });
    }
    // Always surface Field Sales for sales/admin roles (portal seed lag safety net)
    const role = (portal.role || "").toLowerCase();
    const fieldRoles = [
      "ceo",
      "owner",
      "business_admin",
      "admin",
      "sales_manager",
      "manager",
      "sales_executive",
      "super_admin",
    ];
    if (fieldRoles.includes(role) && !seenRoutes.has("/dashboard/field-sales")) {
      const known = crmNavItems.find((n) => n.href === "/dashboard/field-sales");
      items.push({
        key: `${rolePrefix}:field_sales`,
        href: "/dashboard/field-sales",
        label:
          role === "sales_executive"
            ? "My Field Work"
            : role === "sales_manager" || role === "manager"
              ? "Team Locations"
              : "Field Sales Map",
        icon: known?.icon || DEFAULT_ICON,
      });
      seenRoutes.add("/dashboard/field-sales");
    }

    // Always surface Media Library for core CRM roles (portal seed lag safety net)
    const mediaRoles = [
      "ceo",
      "owner",
      "business_admin",
      "admin",
      "sales_manager",
      "manager",
      "sales_executive",
      "marketing",
      "super_admin",
    ];
    if (mediaRoles.includes(role) && !seenRoutes.has("/dashboard/media")) {
      const known = crmNavItems.find((n) => n.href === "/dashboard/media");
      const mediaItem: NavItem = {
        key: `${rolePrefix}:media`,
        href: "/dashboard/media",
        label: "Media Library",
        icon: known?.icon || DEFAULT_ICON,
      };
      // Insert after AI Sales / AI Assistant when present; otherwise after Deals/Reports; else append
      const afterCandidates = [
        "/dashboard/mentor",
        "/dashboard/ai-sales",
        "/dashboard/reports",
        "/dashboard/deals",
        "/dashboard/clients",
        "/dashboard/leads",
      ];
      let insertAt = -1;
      for (const href of afterCandidates) {
        const idx = items.findIndex((n) => n.href === href);
        if (idx >= 0) {
          insertAt = idx + 1;
          break;
        }
      }
      if (insertAt >= 0) items.splice(insertAt, 0, mediaItem);
      else items.push(mediaItem);
      seenRoutes.add("/dashboard/media");
    }

    /**
     * Business Admin / Owner / CEO: restore any implemented module that the member
     * is granted but missing from a stale portal seed (e.g. Health, SWOT, Finance).
     * Does NOT expand access for Sales Manager / SE / Marketing / etc.
     * Appearance + Security stay under Settings (no duplicates).
     */
    const fullBusinessRoles = [
      "ceo",
      "owner",
      "business_admin",
      "admin",
      "super_admin",
    ];
    if (fullBusinessRoles.includes(role)) {
      const granted = portal.modules || [];
      const catalog = [...navItems, ...crmNavItems];
      for (const known of catalog) {
        if (seenRoutes.has(known.href)) continue;
        if (known.href === APPEARANCE_HREF) continue;
        if (known.href === "/dashboard/security") continue;
        if (!canAccessPath(known.href, granted, { loaded: true })) continue;
        items.push({
          key: `${rolePrefix}:mod:${known.href}`,
          href: known.href,
          label: known.label,
          icon: known.icon || DEFAULT_ICON,
        });
        seenRoutes.add(known.href);
      }
    }

    // Do not inject Appearance into primary portal menus — it lives under Settings below.
    return items;
  })();

  // null until portal loads; then use explicit array (may be empty) for fail-closed nav
  const moduleKeys = portal ? portal.modules || [] : null;

  const withMediaBadge = (items: NavItem[]): NavItem[] =>
    items.map((item) =>
      item.href === "/dashboard/media" && mediaFileCount != null && mediaFileCount > 0
        ? { ...item, badge: mediaFileCount }
        : item
    );

  const primaryNav = withMediaBadge(
    filterNavByModules(
      (portalNav || resolveNav(navItems)).filter((item) => item.href !== APPEARANCE_HREF),
      moduleKeys
    )
  );
  // When portal menus replace CRM nav, keep Security out of the flat CRM list if present —
  // Settings section owns Appearance (+ Security for discovery).
  const crmNav = withMediaBadge(
    filterNavByModules(
      (portalNav ? [] : resolveNav(crmNavItems)).filter(
        (item) => item.href !== APPEARANCE_HREF && item.href !== "/dashboard/security"
      ),
      moduleKeys
    )
  );

  const settingsNavFiltered = filterNavByModules(SETTINGS_NAV, moduleKeys);

  /** Flat list then split into CRM | ERP | Settings for sidebar clarity */
  const allSidebarItems = (() => {
    const merged = [...primaryNav, ...crmNav];
    const seen = new Set(merged.map((i) => i.href));
    const canErpDash =
      !moduleKeys ||
      moduleKeys.includes("erp") ||
      moduleKeys.includes("finance") ||
      moduleKeys.includes("approvals");
    if (canErpDash && !seen.has("/dashboard/erp")) {
      merged.push(ERP_DASHBOARD_ITEM);
      seen.add("/dashboard/erp");
    }
    const canAllErpOps =
      !moduleKeys || moduleKeys.includes("erp") || moduleKeys.includes("finance");
    for (const item of ERP_PHASE2_ITEMS) {
      if (seen.has(item.href)) continue;
      const allowed =
        canAllErpOps || (!!moduleKeys && moduleKeys.includes(item.moduleKey));
      if (!allowed) continue;
      merged.push({
        key: item.key,
        href: item.href,
        label: item.label,
        icon: item.icon,
      });
      seen.add(item.href);
    }
    return merged;
  })();

  const crmSectionNav = allSidebarItems.filter((i) => navSectionFor(i.href) === "crm");
  const erpSectionNav = allSidebarItems
    .filter((i) => navSectionFor(i.href) === "erp")
    .sort((a, b) => {
      const ia = ERP_NAV_ORDER.indexOf(a.href);
      const ib = ERP_NAV_ORDER.indexOf(b.href);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  const settingsSectionNav = (() => {
    const fromMain = allSidebarItems.filter((i) => navSectionFor(i.href) === "settings");
    const extras = settingsNavFiltered.filter(
      (s) => !fromMain.some((m) => m.href === s.href)
    );
    return [...fromMain, ...extras];
  })();

  const renderNavLink = (item: NavItem) => {
    const locked = isRouteLocked(item.href);
    return (
      <Link
        key={item.key || item.href}
        href={item.href}
        title={item.label}
        onClick={(e) => {
          onNavClick(e, item.href);
          if (!locked) setSidebarOpen(false);
        }}
        aria-current={isActive(item.href) ? "page" : undefined}
        className={`mm-nav-link focus-ring ${locked ? "opacity-60" : ""} ${
          sidebarCollapsed ? "lg:justify-center lg:px-2" : ""
        }`}
      >
        <span className="mm-nav-icon" aria-hidden>
          {item.icon}
        </span>
        <span className={`flex-1 truncate ${sidebarCollapsed ? "lg:hidden" : ""}`}>
          {item.label}
        </span>
        {item.badge != null && item.badge !== "" && !sidebarCollapsed && (
          <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 border border-border">
            {item.badge}
          </span>
        )}
        {locked && (
          <svg
            className={`w-3.5 h-3.5 text-muted-foreground shrink-0 ${
              sidebarCollapsed ? "lg:hidden" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-label="Locked"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        )}
      </Link>
    );
  };

  /** Permissioned href → NavItem (icons, portal labels, badges) */
  const allowedNavByHref = (() => {
    const map = new Map<string, NavItem>();
    for (const item of [...allSidebarItems, ...settingsSectionNav]) {
      if (!map.has(item.href)) map.set(item.href, item);
    }
    return map;
  })();

  const activeSubModuleId = findActiveSubModuleId(pathname || "");

  const isSubExpanded = (subId: string) => {
    if (Object.prototype.hasOwnProperty.call(manualExpandedSubs, subId)) {
      return !!manualExpandedSubs[subId];
    }
    return subId === activeSubModuleId;
  };

  const toggleSubModule = (subId: string) => {
    setManualExpandedSubs((prev) => {
      const currently = Object.prototype.hasOwnProperty.call(prev, subId)
        ? !!prev[subId]
        : subId === activeSubModuleId;
      return { ...prev, [subId]: !currently };
    });
  };

  /** RBAC/portal path gate for Feature Search (plan locks still apply via FeatureGate on navigate). */
  const featureSearchCanAccess = useCallback(
    (href: string) => canAccessPath(href, moduleKeys, { loaded: true }),
    [moduleKeys]
  );

  /** Hierarchical CRM → Sub → Feature (and ERP / Settings). Only existing permissioned routes. */
  const renderHierarchicalNav = (mainKey: NavMainKey) => {
    const main = NAV_HIERARCHY.find((m) => m.id === mainKey);
    if (!main) return null;

    const visibleSubs = main.subModules
      .map((sub) => {
        const features = sub.features
          .map((f) => {
            const base = f.href.split("?")[0];
            const allowed = allowedNavByHref.get(base);
            if (!allowed) return null;
            return {
              ...allowed,
              // Prefer live portal/config label; keep hierarchy href
              href: allowed.href,
              label: allowed.label || f.label,
              key: allowed.key || f.id,
            } as NavItem;
          })
          .filter(Boolean) as NavItem[];
        if (!features.length) return null;
        return { sub, features };
      })
      .filter(Boolean) as Array<{
      sub: (typeof main.subModules)[number];
      features: NavItem[];
    }>;

    if (!visibleSubs.length) return null;

    return (
      <div className="mb-3">
        {!sidebarCollapsed && (
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-1.5 px-1">
            {main.label}
          </div>
        )}
        {sidebarCollapsed && (
          <div
            className="hidden lg:block mx-auto mb-1.5 h-px w-5 bg-border"
            aria-hidden
            title={main.label}
          />
        )}
        <div className="space-y-0.5">
          {visibleSubs.map(({ sub, features }) => {
            const expanded = isSubExpanded(sub.id);
            // Collapsed rail: show feature icons flat (no accordion chrome)
            if (sidebarCollapsed) {
              return (
                <div key={sub.id} className="space-y-0.5">
                  {features.map(renderNavLink)}
                </div>
              );
            }
            return (
              <div key={sub.id} className="rounded-md">
                <button
                  type="button"
                  onClick={() => toggleSubModule(sub.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-semibold tracking-wide transition-colors focus-ring ${
                    expanded || features.some((f) => isActive(f.href))
                      ? "text-foreground bg-muted"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
                  }`}
                  aria-expanded={expanded}
                >
                  <svg
                    className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  <span className="flex-1 text-left truncate">{sub.label}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {features.length}
                  </span>
                </button>
                {expanded && (
                  <div className="mt-0.5 ml-1 pl-2 border-l border-border space-y-0.5">
                    {features.map(renderNavLink)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Body scroll lock when mobile sidebar is open (prevents background scroll)
  useEffect(() => {
    if (sidebarOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [sidebarOpen]);

  /** Primary destinations for mobile bottom nav (auto from portal, not a second app mode) */
  const mobileTabs: NavItem[] = (() => {
    const all = [...crmSectionNav, ...erpSectionNav];
    const preferred = [
      "/dashboard",
      "/dashboard/leads",
      "/dashboard/deals",
      "/dashboard/tasks",
      "/dashboard/erp",
      "/dashboard/field-sales",
      "/dashboard/meetings",
    ];
    const picked: NavItem[] = [];
    for (const href of preferred) {
      const hit = all.find((n) => n.href === href);
      if (hit && !picked.some((p) => p.href === hit.href)) picked.push(hit);
      if (picked.length >= 4) break;
    }
    while (picked.length < 4 && all[picked.length]) {
      const n = all[picked.length];
      if (!picked.some((p) => p.href === n.href)) picked.push(n);
      else break;
    }
    return picked.slice(0, 4);
  })();

  const [isDemoMode, setIsDemoMode] = useState(false);
  useEffect(() => {
    try {
      setIsDemoMode(localStorage.getItem("massive_mentor_demo_mode") === "1");
      setSidebarCollapsed(localStorage.getItem("mm_sidebar_collapsed") === "1");
    } catch {
      setIsDemoMode(false);
    }
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("mm_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Hydrate app currency from business profile (for formatCurrency across CRM)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getProfile(token);
        if (cancelled || !res.success || !res.data?.profile) return;
        const p = res.data.profile as { currency?: string; location?: string };
        const code = isCurrencyCode(p.currency || "")
          ? p.currency!
          : detectDefaultCurrency({ location: p.location });
        setAppCurrency(code);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Fixed chrome stack: [demo banner?] + navbar + location strip
  const navTop = isDemoMode ? DEMO_BANNER_H : "0px";
  const fieldTop = isDemoMode
    ? `calc(${DEMO_BANNER_H} + ${NAV_H})`
    : NAV_H;
  const contentOffset = isDemoMode
    ? `calc(${DEMO_BANNER_H} + ${NAV_H} + ${FIELD_BAR_H})`
    : `calc(${NAV_H} + ${FIELD_BAR_H})`;

  return (
    <div
      className="min-h-screen min-h-dvh bg-background text-foreground overflow-x-hidden safe-top"
      style={
        {
          ["--mm-chrome-h" as string]: contentOffset,
          ["--mm-nav-h" as string]: NAV_H,
          ["--mm-field-h" as string]: FIELD_BAR_H,
        } as React.CSSProperties
      }
    >
      {isDemoMode && (
        <div
          className="fixed top-0 left-0 right-0 z-[60] bg-sky-600 text-white text-center text-xs sm:text-sm font-semibold px-3 flex items-center justify-center"
          style={{ height: DEMO_BANNER_H }}
        >
          DEMO MODE — Sample data only — Not a production customer workspace
        </div>
      )}
      {/* Non-blocking connectivity alert when backend is down */}
      <div className="fixed left-0 right-0 z-[55]" style={{ top: isDemoMode ? DEMO_BANNER_H : 0 }}>
        <ApiConnectivityBanner />
        {/* Trial / Upgrade Plan is for real customers only — never in Demo Mode */}
        {!isDemoMode ? <TrialBanner /> : null}
      </div>
      {/* Top Navigation — z-50 above location strip */}
      <nav
        className="fixed left-0 right-0 z-50 border-b border-border bg-white dark:bg-card safe-x"
        style={{ top: navTop, height: NAV_H }}
        aria-label="Top navigation"
      >
        <div className="max-w-[1600px] mx-auto px-3 sm:px-5 h-full flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 -ml-1 text-muted-foreground hover:text-foreground focus-ring rounded-md touch-manipulation min-h-9 min-w-9 inline-flex items-center justify-center"
              aria-label="Open menu"
              aria-expanded={sidebarOpen}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link
              href={portal?.homeRoute || "/dashboard"}
              className="inline-flex items-center gap-2 font-semibold tracking-tight text-[15px] truncate focus-ring rounded-md text-foreground"
            >
              <span
                className="hidden sm:inline-flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground text-[11px] font-bold shrink-0"
                aria-hidden
              >
                M
              </span>
              <span className="sm:hidden text-primary font-bold">MM</span>
              <span className="hidden sm:inline">Massive Mentor</span>
            </Link>
            {portal?.portalLabel ? (
              <div className="hidden sm:block text-[10px] px-2 py-0.5 rounded border border-border bg-muted text-muted-foreground tracking-wide shrink-0 max-w-[160px] truncate font-medium">
                {portal.portalLabel}
              </div>
            ) : (
              <div className="hidden sm:block text-[10px] px-2 py-0.5 rounded border border-border bg-muted text-muted-foreground tracking-wide shrink-0 font-medium">
                CRM
              </div>
            )}
            {/* Live plan / license badge — real customers only (hidden in Demo Mode) */}
            {!isDemoMode ? (
              <div
                className={`hidden md:inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border tracking-wide shrink-0 font-semibold capitalize ${
                  isTrial
                    ? "mm-badge-primary"
                    : planStatus === "suspended" || licenseStatus === "expired"
                      ? "mm-badge-danger"
                      : "mm-badge-primary"
                }`}
                data-testid="plan-badge"
                title={`Plan: ${plan || "—"} · Status: ${planStatus || "—"} · License: ${licenseStatus || "—"}`}
              >
                <span>{isTrial ? "Trial" : plan || "Plan"}</span>
                {licenseStatus ? (
                  <span className="opacity-70 font-normal normal-case">· {licenseStatus}</span>
                ) : null}
              </div>
            ) : (
              <div
                className="hidden md:inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border tracking-wide shrink-0 font-semibold mm-badge-primary"
                data-testid="demo-mode-badge"
              >
                Demo
              </div>
            )}
          </div>

          <div className="relative flex items-center gap-1.5 sm:gap-2" ref={userMenuRef}>
            {/* System status — reuses cached health probe (no extra requests) */}
            <SystemStatusIndicator />

            {/* Business Admin: Role workspace switcher — entire portal (menu, KPIs, AI, permissions) */}
            {portal?.canSwitchWorkspace && (
              <div className="hidden md:flex items-center gap-1.5">
                <label
                  htmlFor="workspace-role"
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hidden lg:block"
                >
                  Role
                </label>
                <select
                  id="workspace-role"
                  value={workspaceRole || portal.role}
                  disabled={portalLoading}
                  onChange={(e) => setWorkspaceRole(e.target.value)}
                  className="bg-card border border-border rounded-md px-2 py-1.5 text-xs font-medium text-foreground max-w-[140px] lg:max-w-[200px] focus:outline-none focus:border-primary min-h-8"
                  title="Switch entire portal workspace by role"
                  aria-label="Select role"
                >
                  {(portal.workspaceRoles?.length
                    ? portal.workspaceRoles
                    : [
                        { key: "ceo", label: "CEO" },
                        { key: "business_admin", label: "Business Admin" },
                        { key: "sales_manager", label: "Sales Manager" },
                        { key: "sales_executive", label: "Sales Executive" },
                        { key: "marketing", label: "Marketing" },
                        { key: "support", label: "Support" },
                        { key: "hr", label: "HR" },
                        { key: "finance", label: "Finance" },
                      ]
                  ).map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {portal.isWorkspacePreview && (
                  <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
                    Preview
                  </span>
                )}
              </div>
            )}

            {/* Notification Center */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted relative min-h-9 min-w-9 inline-flex items-center justify-center rounded-md"
                aria-label="Notifications"
                aria-expanded={notifOpen}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold bg-red-500 text-white rounded-full">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50 text-sm max-h-96 flex flex-col">
                  <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
                    <span className="text-xs text-muted-foreground font-medium">
                      Notifications{unreadCount > 0 ? ` (${unreadCount} unread)` : ""}
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-[11px] text-primary hover:text-primary-hover"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="overflow-y-auto flex-1 p-1">
                    {notifError ? (
                      <div className="p-4 text-center text-destructive text-xs space-y-2">
                        <div>Could not load notifications.</div>
                        <div className="text-muted-foreground">{notifError}</div>
                        <button
                          type="button"
                          onClick={() => loadNotifs()}
                          className="text-primary hover:text-primary-hover underline"
                        >
                          Retry
                        </button>
                      </div>
                    ) : notifLoading && notifications.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground text-xs">Loading…</div>
                    ) : notifications.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground text-xs">
                        No notifications yet. Create a lead, deal, task, or meeting to see one here.
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const title = formatNotificationTitle(n.title);
                        const message = formatNotificationMessage(n.message, title);
                        return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (!n.isRead) markOneRead(n.id);
                          }}
                          className={`w-full text-left p-2.5 rounded-md mb-0.5 transition-colors ${
                            n.isRead
                              ? "text-muted-foreground hover:bg-muted"
                              : "bg-accent text-foreground hover:bg-accent/80"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium text-xs">{title}</span>
                            {!n.isRead && (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1" />
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{message}</div>
                          {n.createdAt && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {new Date(n.createdAt).toLocaleString()}
                            </div>
                          )}
                        </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Theme: between Notifications and Profile — always mounted, all roles */}
            <ThemeToggle />

            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 rounded-md focus-ring min-h-9 px-1 hover:bg-muted"
              aria-haspopup="true"
              aria-expanded={userMenuOpen}
              aria-label="User menu"
              data-testid="user-menu"
            >
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-foreground ring-1 ring-border">
                {(user?.name || user?.email || "U")[0].toUpperCase()}
              </div>
              <div className="hidden md:block text-[13px] text-muted-foreground max-w-[120px] truncate">
                {user?.name || user?.email}
              </div>
            </button>

            {userMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-56 bg-card border border-border rounded-lg shadow-lg py-1 z-[70] text-sm"
                role="menu"
                aria-label="User menu"
                data-testid="user-menu-dropdown"
              >
                <div className="px-4 py-2.5 border-b border-border">
                  <div className="font-medium text-foreground truncate">{user?.name || "User"}</div>
                  <div className="text-muted-foreground text-xs truncate mt-0.5">{user?.email}</div>
                </div>

                <Link
                  href="/dashboard/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-ring transition-colors"
                  role="menuitem"
                >
                  Profile
                </Link>

                <Link
                  href={APPEARANCE_HREF}
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-ring transition-colors"
                  role="menuitem"
                  data-testid="user-menu-appearance"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                    />
                  </svg>
                  Appearance
                </Link>

                <Link
                  href="/dashboard/security"
                  onClick={() => setUserMenuOpen(false)}
                  className="block px-4 py-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-ring transition-colors"
                  role="menuitem"
                >
                  Security
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout({ redirect: true });
                  }}
                  className="w-full text-left px-4 py-2.5 text-destructive hover:bg-muted focus-visible:bg-muted focus-ring transition-colors"
                  role="menuitem"
                  data-testid="sign-out"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/*
        Location / GPS status — dedicated fixed strip BELOW navbar (never overlaps titles/KPIs).
        z-40 < navbar z-50. Fixed height 48px reserved even while loading.
      */}
      <div
        className="fixed left-0 right-0 z-40 w-full"
        style={{ top: fieldTop, height: FIELD_BAR_H }}
        data-testid="field-status-strip"
      >
        <FieldStatusBar />
      </div>

      {/* Spacer so document flow starts below fixed chrome (nav + location strip [+ demo]) */}
      <div
        aria-hidden
        className="shrink-0 w-full pointer-events-none"
        style={{ height: contentOffset }}
      />

      <div
        className="flex items-start overflow-x-hidden bg-background w-full min-w-0"
        style={{ minHeight: `calc(100dvh - ${contentOffset})` }}
      >
        {/*
          Sidebar behaviour:
          - Mobile (<lg): off-canvas drawer via hamburger
          - Desktop (≥lg): FIXED under header (does not scroll away with main content)
          - Nav list scrolls inside the sidebar if taller than the viewport
        */}
        {/* Desktop width reserve so fixed sidebar does not cover main content */}
        <div
          className={`hidden lg:block shrink-0 transition-[width] duration-200 ${
            sidebarCollapsed ? "w-[3.5rem]" : "w-[14.5rem]"
          }`}
          aria-hidden
        />
        <aside
          className={`fixed left-0 z-30 border-r border-border bg-white dark:bg-sidebar transform transition-all duration-200 ease-out lg:translate-x-0 overflow-hidden flex flex-col ${
            sidebarOpen ? "translate-x-0 shadow-md" : "-translate-x-full"
          } w-[min(100vw-3rem,14.5rem)] ${
            sidebarCollapsed ? "lg:w-[3.5rem]" : "md:w-[14.5rem] lg:w-[14.5rem]"
          }`}
          style={{
            top: contentOffset,
            height: `calc(100dvh - ${contentOffset})`,
          }}
          aria-label="Sidebar"
        >
          <div className="h-full min-h-0 flex flex-col p-2.5 sm:p-3">
            <div className={`pt-0.5 pb-3 shrink-0 ${sidebarCollapsed ? "lg:px-0" : "px-0.5"}`}>
              <div className={`flex items-center justify-between gap-2 mb-2 ${sidebarCollapsed ? "lg:justify-center" : ""}`}>
                <div
                  className={`text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold ${
                    sidebarCollapsed ? "lg:hidden" : ""
                  }`}
                >
                  {portal?.portalLabel ? "Portal" : "Menu"}
                </div>
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className="hidden lg:inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted focus-ring"
                  aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={sidebarCollapsed ? "Expand" : "Collapse"}
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
              </div>
              {portal && !sidebarCollapsed && (
                <div className="mb-2.5 px-2.5 py-2 rounded-md bg-background-secondary border border-border text-[11px] text-muted-foreground">
                  <div className="text-foreground font-medium truncate">{portal.businessName || portal.portalLabel}</div>
                  <div className="mt-0.5 truncate text-muted-foreground capitalize">
                    {portal.role?.replace(/_/g, " ")}
                  </div>
                  {portal.canSwitchWorkspace && (
                    <select
                      value={workspaceRole || portal.role}
                      disabled={portalLoading}
                      onChange={(e) => setWorkspaceRole(e.target.value)}
                      className="md:hidden mt-2 w-full bg-card border border-border rounded-md px-2 py-2 text-xs text-foreground min-h-9"
                      aria-label="Select role workspace"
                    >
                      {(portal.workspaceRoles?.length
                        ? portal.workspaceRoles
                        : [{ key: portal.role, label: portal.role }]
                      ).map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {!sidebarCollapsed && (
                <FeatureSearch
                  className="mb-3"
                  canAccess={featureSearchCanAccess}
                  modules={moduleKeys}
                  onNavigate={() => setSidebarOpen(false)}
                />
              )}
              {sidebarCollapsed && (
                <FeatureSearch
                  className="mb-3 flex justify-center"
                  compact
                  canAccess={featureSearchCanAccess}
                  modules={moduleKeys}
                  onNavigate={() => setSidebarOpen(false)}
                />
              )}
            </div>

            {/* Scrollable nav region — sidebar shell stays fixed while this scrolls */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5">
              <nav className="space-y-1" aria-label="Main navigation">
                {renderHierarchicalNav("crm")}
                {renderHierarchicalNav("erp")}
                {renderHierarchicalNav("settings")}
              </nav>

              {portal?.actions && portal.actions.length > 0 && !sidebarCollapsed && (
                <>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-1.5 mt-4">
                    Actions
                  </div>
                  <div className="space-y-0.5 px-0.5">
                    {(() => {
                      const seen = new Set<string>();
                      return portal.actions
                        .filter((a) => {
                          const route = a.route || "/dashboard";
                          if (seen.has(route)) return false;
                          seen.add(route);
                          return true;
                        })
                        .map((a) => (
                          <Link
                            key={`action:${portal.role || "r"}:${a.key}`}
                            href={a.route || "/dashboard"}
                            onClick={() => setSidebarOpen(false)}
                            className="block px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-accent-foreground border border-border hover:bg-accent/80 transition-colors focus-ring"
                          >
                            {a.label}
                          </Link>
                        ));
                    })()}
                  </div>
                </>
              )}
            </div>

            <div
              className={`shrink-0 text-[10px] text-muted-foreground border-t border-border pt-2.5 ${
                sidebarCollapsed ? "lg:text-center lg:px-0" : "px-1.5"
              }`}
            >
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>Massive Mentor</span>
              <span className="hidden lg:inline" aria-hidden>
                {sidebarCollapsed ? "MM" : ""}
              </span>
            </div>
          </div>
        </aside>

        {/* Main content — starts below fixed chrome; pages use PageShell for title/KPI spacing */}
        <main className="flex-1 min-w-0 w-full max-w-[1600px] mx-auto bg-background overflow-x-hidden lg:pl-0 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4 mb-[4rem] md:mb-0">
          {routeFeature && FEATURE_MIN_TIER[routeFeature] ? (
            <FeatureGate feature={routeFeature}>{children}</FeatureGate>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Mobile sidebar overlay — below nav/location chrome */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          style={{ top: contentOffset }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/*
        Mobile bottom navigation — dedicated mobile UX, not a scaled desktop sidebar.
        Hidden on tablet+ (md) where drawer/sidebar is preferred.
      */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card safe-bottom safe-x"
        aria-label="Mobile primary navigation"
      >
        <div className="grid grid-cols-5 gap-0.5 px-1 pt-0.5 pb-0.5">
          {mobileTabs.map((item) => (
            <Link
              key={`tab:${item.href}`}
              href={item.href}
              onClick={(e) => onNavClick(e, item.href)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-md text-[10px] min-h-12 touch-manipulation ${
                isActive(item.href)
                  ? "text-primary bg-accent font-semibold"
                  : isRouteLocked(item.href)
                    ? "text-muted-foreground opacity-60"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <span>{item.icon}</span>
              <span className="truncate max-w-full px-0.5">
                {item.label.split(" ")[0]}
              </span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-md text-[10px] min-h-12 text-muted-foreground hover:text-foreground hover:bg-muted touch-manipulation"
            aria-label="More menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
