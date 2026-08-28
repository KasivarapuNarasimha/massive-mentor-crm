"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export type PortalMenu = {
  key: string;
  label: string;
  route: string;
  order: number;
  enabled: boolean;
};

export type PortalAction = {
  key: string;
  label: string;
  type: string;
  route?: string;
  featureKey?: string;
};

export type WorkspaceRoleOption = { key: string; label: string };

export type PortalState = {
  portalKey: string;
  portalLabel: string;
  role: string;
  actualRole: string;
  platformRole: string;
  permissions: string[];
  /** CRM module keys granted by Super Admin (sidebar + route gate) */
  modules: string[];
  businessId: string;
  businessName: string;
  homeRoute: string;
  defaultDashboardKey: string;
  menus: PortalMenu[];
  actions: PortalAction[];
  dashboardKeys: string[];
  aiFeatures: Array<{ key: string; label: string }>;
  canSwitchWorkspace: boolean;
  isWorkspacePreview: boolean;
  workspaceRoles: WorkspaceRoleOption[];
};

type PortalContextType = {
  portal: PortalState | null;
  isLoading: boolean;
  /** Active workspace role (admin may change for preview) */
  workspaceRole: string | null;
  setWorkspaceRole: (role: string) => void;
  refreshPortal: () => Promise<void>;
};

const PortalContext = createContext<PortalContextType | undefined>(undefined);

const WORKSPACE_ROLE_KEY = "massive_mentor_workspace_role";

export function PortalProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const [portal, setPortal] = useState<PortalState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [workspaceRole, setWorkspaceRoleState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(WORKSPACE_ROLE_KEY);
    } catch {
      return null;
    }
  });

  const setWorkspaceRole = useCallback((role: string) => {
    setWorkspaceRoleState(role);
    try {
      localStorage.setItem(WORKSPACE_ROLE_KEY, role);
    } catch {
      /* ignore */
    }
    // Navigate home so the role's default dashboard + menus apply immediately
    if (typeof window !== "undefined") {
      try {
        // Soft signal: consumers re-fetch on workspaceRole change
        window.dispatchEvent(new CustomEvent("mm-workspace-role", { detail: { role } }));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const seededRoleRef = useRef(false);
  /** Skip one workspaceRole→refresh cycle after internal seed/clear. */
  const skipRoleRefreshRef = useRef(false);

  const refreshPortal = useCallback(async () => {
    if (!token) {
      setPortal(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // Only Business Admin may pass a preview role; API enforces this
      const preview =
        workspaceRole && workspaceRole.length > 0 ? workspaceRole : undefined;
      const res = await api.getCurrentPortal(token, preview);
      if (res.success && res.data) {
        const data = res.data as PortalState;
        // If user cannot switch workspace, clear any stale preview role
        if (!data.canSwitchWorkspace) {
          try {
            localStorage.removeItem(WORKSPACE_ROLE_KEY);
          } catch {
            /* ignore */
          }
          if (workspaceRole && workspaceRole !== data.actualRole) {
            seededRoleRef.current = true;
            skipRoleRefreshRef.current = true;
            setWorkspaceRoleState(data.actualRole);
          }
        } else if (!workspaceRole && !seededRoleRef.current) {
          // Seed once without causing a second /portal/current fetch
          seededRoleRef.current = true;
          skipRoleRefreshRef.current = true;
          setWorkspaceRoleState(data.actualRole || data.role);
        }
        setPortal(data);
        try {
          localStorage.setItem("massive_mentor_portal_home", data.homeRoute || "/dashboard");
          localStorage.setItem("massive_mentor_portal_key", data.portalKey || "");
          localStorage.setItem(
            "massive_mentor_dashboard_key",
            data.defaultDashboardKey || "main"
          );
        } catch {
          /* ignore */
        }
      } else if (res.error?.includes("Only Business Admin") && workspaceRole) {
        try {
          localStorage.removeItem(WORKSPACE_ROLE_KEY);
        } catch {
          /* ignore */
        }
        seededRoleRef.current = true;
        skipRoleRefreshRef.current = true;
        setWorkspaceRoleState(null);
        const fallback = await api.getCurrentPortal(token);
        if (fallback.success && fallback.data) {
          setPortal(fallback.data as PortalState);
        }
      }
      // On 429/network failure: keep last-known portal (do not clear modules).
    } finally {
      setIsLoading(false);
    }
  }, [token, workspaceRole]);

  useEffect(() => {
    if (isAuthenticated && token) {
      void refreshPortal();
    } else {
      setPortal(null);
      setIsLoading(false);
      seededRoleRef.current = false;
      skipRoleRefreshRef.current = false;
    }
    // Intentionally omit workspaceRole from deps — see role effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed must not double-fetch
  }, [isAuthenticated, token]);

  // User-driven preview-role changes only (skip internal seed writes)
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    if (!seededRoleRef.current) return;
    if (skipRoleRefreshRef.current) {
      skipRoleRefreshRef.current = false;
      return;
    }
    void refreshPortal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRole]);

  return (
    <PortalContext.Provider
      value={{
        portal,
        isLoading,
        workspaceRole: workspaceRole || portal?.role || null,
        setWorkspaceRole,
        refreshPortal,
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used within PortalProvider");
  return ctx;
}
