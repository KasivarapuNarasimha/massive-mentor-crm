"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { api } from "@/lib/api";
import { User } from "@/types/api";
import { isCurrencyCode, setAppCurrency } from "@/lib/currency";

export type LoginResult =
  | { success: true }
  | {
      success: false;
      error?: string;
      code?: string;
      sessionLimit?: {
        maxSessions: number;
        activeSessions: Array<{
          id: string;
          deviceName?: string | null;
          browser?: string | null;
          os?: string | null;
          ipAddress?: string | null;
          locationLabel?: string | null;
          loginTime?: string;
          lastActivity?: string;
        }>;
      };
    };

interface AuthContextType {
  user: User | null;
  token: string | null;
  role: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (
    email: string,
    password: string,
    opts?: { forceNewSession?: boolean }
  ) => Promise<LoginResult>;
  register: (
    email: string,
    password: string,
    name?: string,
    opts?: { businessName?: string; templateSlug?: string; industryLabel?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  logout: (opts?: { redirect?: boolean }) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const TOKEN_KEY = "massive_mentor_token";
export const USER_KEY = "massive_mentor_user";
const LOGOUT_BROADCAST_KEY = "massive_mentor_logout_at";

/** Session / portal cache keys cleared on logout */
const SESSION_KEYS = [
  TOKEN_KEY,
  USER_KEY,
  "massive_mentor_viewing_as",
  "massive_mentor_workspace_role",
  "massive_mentor_portal_home",
  "massive_mentor_dashboard_key",
  "massive_mentor_portal_key",
];

function clearSessionStorage() {
  try {
    for (const k of SESSION_KEYS) localStorage.removeItem(k);
    localStorage.removeItem("massive_mentor_demo_mode");
    localStorage.removeItem("massive_mentor_demo_token");
    localStorage.removeItem("massive_mentor_demo_user");
  } catch {
    /* ignore */
  }
}

function base64UrlToJson(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const payload = base64UrlToJson(parts[1]);
    if (!payload || typeof payload.exp !== "number") return false;
    // 30s clock skew
    return (payload.exp as number) * 1000 < Date.now() - 30_000;
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string>("sales_executive");
  // Start false on first paint after client mount path — avoid permanent SSR Loading hang.
  // We still show a short bootstrap loading only while reading localStorage once.
  const [isLoading, setIsLoading] = useState(true);
  const bootstrapped = useRef(false);

  const isAuthenticated = !!user && !!token;

  const logout = useCallback((opts?: { redirect?: boolean }) => {
    // Best-effort: revoke enterprise session + location event
    const t = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (t) {
      void (async () => {
        try {
          await api.logout(t);
        } catch {
          /* ignore */
        }
        try {
          const { captureGps, toLocationBody } = await import("@/lib/location-client");
          const loc = await captureGps({ timeoutMs: 4000 });
          await api.post("/location/events", { eventType: "logout", ...toLocationBody(loc) }, t);
        } catch {
          /* ignore */
        }
      })();
    }
    clearSessionStorage();
    try {
      localStorage.setItem(LOGOUT_BROADCAST_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    setRole("sales_executive");
    setIsLoading(false);
    if (opts?.redirect !== false && typeof window !== "undefined") {
      window.location.replace("/login");
    }
  }, []);

  /**
   * Always finishes bootstrap: never leave isLoading true forever.
   * /auth/me is best-effort refresh — does not block UI exit.
   */
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    let cancelled = false;
    const safety = window.setTimeout(() => {
      // Absolute fail-safe: never hang on Loading > 4s
      if (!cancelled) setIsLoading(false);
    }, 4000);

    const bootstrap = async () => {
      try {
        try {
          localStorage.removeItem("massive_mentor_viewing_as");
        } catch {
          /* ignore */
        }

        const storedToken = localStorage.getItem(TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);

        if (!storedToken || !storedUser) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        if (isJwtExpired(storedToken)) {
          clearSessionStorage();
          if (!cancelled) {
            setToken(null);
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        let parsedUser: User | null = null;
        try {
          parsedUser = JSON.parse(storedUser) as User;
        } catch {
          clearSessionStorage();
          if (!cancelled) setIsLoading(false);
          return;
        }

        // Restore session immediately so UI can leave Loading
        if (!cancelled) {
          setToken(storedToken);
          setUser(parsedUser);
          if (parsedUser.role) setRole(parsedUser.role);
          setIsLoading(false);
        }

        // Background validation — only clear session on definitive auth failure (401).
        // 429 / 5xx / network errors must NOT log the user out.
        try {
          const response = await api.getCurrentUser(storedToken);
          if (cancelled) return;
          if (response.success && response.data?.user) {
            setUser(response.data.user);
            localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
            if (response.data.user.role) setRole(response.data.user.role);
            // Tenant currency from Business.settings (Super Admin provision)
            const biz = (response.data as { business?: { currency?: string } }).business;
            if (biz?.currency && isCurrencyCode(biz.currency)) {
              setAppCurrency(biz.currency);
            }
            return;
          }
          const httpStatus = response.status;
          const err = String(response.error || "");
          const isUnauthorized =
            httpStatus === 401 ||
            /session expired|not authenticated|unauthorized|invalid token|invalid or expired/i.test(
              err
            );
          // Rate limit / temporary server errors: keep local session
          if (
            httpStatus === 429 ||
            (typeof httpStatus === "number" && httpStatus >= 500) ||
            /too many requests|slow down|network|timeout|unreachable|failed to fetch/i.test(err)
          ) {
            return;
          }
          if (isUnauthorized) {
            clearSessionStorage();
            setToken(null);
            setUser(null);
          }
          // Other non-success without clear 401: keep session (safer for production)
        } catch {
          // Network blip: keep local session, user can retry
        }

        // Non-blocking role hint
        try {
          const r = await api.get("/teams/role", storedToken);
          if (!cancelled && r.success && (r.data as { role?: string })?.role) {
            setRole((r.data as { role: string }).role);
          }
        } catch {
          /* ignore */
        }
      } finally {
        window.clearTimeout(safety);
        if (!cancelled) setIsLoading(false);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };
  }, []);

  // Multi-tab logout + periodic JWT expiry check
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOGOUT_BROADCAST_KEY && e.newValue) {
        setToken(null);
        setUser(null);
        setRole("sales_executive");
        setIsLoading(false);
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.replace("/login");
        }
      }
      if (e.key === TOKEN_KEY && !e.newValue) {
        setToken(null);
        setUser(null);
        setIsLoading(false);
      }
    };
    window.addEventListener("storage", onStorage);

    const tick = window.setInterval(() => {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t && isJwtExpired(t)) {
        logout({ redirect: true });
      }
    }, 60_000);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(tick);
    };
  }, [logout]);

  const login = async (
    email: string,
    password: string,
    opts?: { forceNewSession?: boolean }
  ): Promise<LoginResult> => {
    setIsLoading(true);
    try {
      // Outer trim only — matches API normalizeLoginPassword (email copy/paste whitespace)
      const response = await api.login(email.trim(), password.replace(/^\s+|\s+$/g, ""), {
        forceNewSession: opts?.forceNewSession,
      });

      if (response.success && response.data) {
        const { user: loggedInUser, token: authToken } = response.data;

        localStorage.setItem(TOKEN_KEY, authToken);
        localStorage.setItem(USER_KEY, JSON.stringify(loggedInUser));

        setToken(authToken);
        setUser(loggedInUser);
        if (loggedInUser.role) setRole(loggedInUser.role);

        // Resolve tenant currency ASAP (Business.settings via /me)
        void api.getCurrentUser(authToken).then((me) => {
          const biz = (me.data as { business?: { currency?: string } } | undefined)?.business;
          if (biz?.currency && isCurrencyCode(biz.currency)) {
            setAppCurrency(biz.currency);
          }
        });

        api.get("/teams/role", authToken).then((r) => {
          if (r.success && (r.data as { role?: string })?.role) {
            setRole((r.data as { role: string }).role);
          }
        });

        // Login tracking only (does NOT start field work).
        void (async () => {
          try {
            const { captureGps, toLocationBody } = await import("@/lib/location-client");
            const loc = await captureGps({ timeoutMs: 15000 });
            await api.post(
              "/location/events",
              { eventType: "login", ...toLocationBody(loc) },
              authToken
            );
          } catch {
            /* non-blocking */
          }
        })();

        return { success: true };
      }

      if (response.code === "SESSION_LIMIT" && response.data) {
        const d = response.data as {
          maxSessions?: number;
          activeSessions?: Array<{
            id: string;
            deviceName?: string | null;
            browser?: string | null;
            os?: string | null;
            ipAddress?: string | null;
            locationLabel?: string | null;
            loginTime?: string;
            lastActivity?: string;
          }>;
        };
        return {
          success: false,
          error: response.error || "This account is already active on another device.",
          code: "SESSION_LIMIT",
          sessionLimit: {
            maxSessions: d.maxSessions ?? 1,
            activeSessions: d.activeSessions || [],
          },
        };
      }

      return {
        success: false,
        error: response.error || "Login failed",
        code: response.code,
      };
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (
    email: string,
    password: string,
    name?: string,
    opts?: { businessName?: string; templateSlug?: string; industryLabel?: string }
  ) => {
    setIsLoading(true);
    try {
      const response = await api.register(email, password, name, opts);

      if (response.success && response.data) {
        const { user: newUser, token: authToken } = response.data;

        localStorage.setItem(TOKEN_KEY, authToken);
        localStorage.setItem(USER_KEY, JSON.stringify(newUser));

        setToken(authToken);
        setUser(newUser);
        if (newUser.role) setRole(newUser.role);

        api.getCurrentPortal(authToken).then((p) => {
          if (p.success && p.data?.role) setRole(p.data.role);
        });

        return { success: true };
      }

      return {
        success: false,
        error: response.error || "Registration failed",
      };
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    if (isJwtExpired(token)) {
      logout({ redirect: true });
      return;
    }

    const response = await api.getCurrentUser(token);
    if (response.success && response.data?.user) {
      setUser(response.data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
    } else if (!response.success) {
      logout({ redirect: true });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        role,
        isLoading,
        isAuthenticated,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export type { AuthContextType };
