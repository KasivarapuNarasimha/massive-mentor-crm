"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "massive_mentor_theme";

const VALID: ThemePreference[] = ["light", "dark", "system"];

export function normalizeTheme(value: unknown): ThemePreference {
  if (typeof value === "string" && VALID.includes(value as ThemePreference)) {
    return value as ThemePreference;
  }
  return "system";
}

type ThemeCtx = {
  preference: ThemePreference;
  resolvedTheme: "light" | "dark" | undefined;
  setPreference: (theme: ThemePreference) => void;
  mounted: boolean;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

/**
 * Must render under both NextThemesProvider and AuthProvider.
 * Priority: user DB preference → localStorage (next-themes) → system.
 */
export function ThemeSync({ children }: { children: React.ReactNode }) {
  const { theme, setTheme, resolvedTheme, systemTheme } = useNextTheme();
  const { user, token } = useAuth();
  const [mounted, setMounted] = useState(false);
  const appliedFromDb = React.useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply theme from cached CRM user (login payload / localStorage user)
  useEffect(() => {
    if (!mounted || !user) return;
    const pref = normalizeTheme(
      (user as { themePreference?: string }).themePreference
    );
    const key = `${user.id}:${pref}`;
    if (appliedFromDb.current === key) return;
    appliedFromDb.current = key;
    if (pref !== theme) {
      setTheme(pref);
    }
  }, [mounted, user, theme, setTheme]);

  // Super Admin portal: apply theme from platform user store + /platform/auth/me
  useEffect(() => {
    if (!mounted || user) return; // CRM session owns theme when customer auth is active
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const adminToken = localStorage.getItem(PORTAL_TOKENS.admin);
        if (!adminToken) return;

        // 1) Cached login payload
        try {
          const raw = localStorage.getItem(PORTAL_USER_KEYS.admin);
          if (raw) {
            const parsed = JSON.parse(raw) as {
              id?: string;
              themePreference?: string;
            };
            const pref = normalizeTheme(parsed.themePreference);
            const key = `admin:${parsed.id || "x"}:${pref}`;
            if (appliedFromDb.current !== key) {
              appliedFromDb.current = key;
              setTheme(pref);
            }
          }
        } catch {
          /* ignore */
        }

        // 2) Refresh from platform /me (DB wins)
        const res = await api.platformMe(adminToken);
        if (cancelled || !res.success || !res.data?.user) return;
        const pref = normalizeTheme(
          (res.data.user as { themePreference?: string }).themePreference
        );
        const uid = (res.data.user as { id?: string }).id || "admin";
        const key = `admin:${uid}:${pref}`;
        if (appliedFromDb.current === key) return;
        appliedFromDb.current = key;
        setTheme(pref);
        try {
          const stored = localStorage.getItem(PORTAL_USER_KEYS.admin);
          if (stored) {
            const parsed = JSON.parse(stored) as Record<string, unknown>;
            parsed.themePreference = pref;
            localStorage.setItem(PORTAL_USER_KEYS.admin, JSON.stringify(parsed));
          }
          localStorage.setItem(THEME_STORAGE_KEY, pref);
        } catch {
          /* ignore */
        }
      } catch {
        /* offline / not on admin */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, user]);

  // Refresh from CRM /me so DB always wins after login
  useEffect(() => {
    if (!mounted || !token || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getCurrentUser(token);
        if (cancelled || !res.success || !res.data?.user) return;
        const pref = normalizeTheme(
          (res.data.user as { themePreference?: string }).themePreference
        );
        const key = `${user.id}:${pref}`;
        if (appliedFromDb.current === key) return;
        appliedFromDb.current = key;
        setTheme(pref);
        try {
          const stored = localStorage.getItem("massive_mentor_user");
          if (stored) {
            const parsed = JSON.parse(stored) as Record<string, unknown>;
            parsed.themePreference = pref;
            localStorage.setItem("massive_mentor_user", JSON.stringify(parsed));
          }
        } catch {
          /* ignore */
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, token, user?.id]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      const pref = normalizeTheme(next);
      setTheme(pref);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, pref);
      } catch {
        /* ignore */
      }
      // CRM customer session
      if (token) {
        void api
          .patchThemePreference(pref, token)
          .then((res) => {
            if (!res.success) return;
            try {
              const stored = localStorage.getItem("massive_mentor_user");
              if (stored) {
                const parsed = JSON.parse(stored) as Record<string, unknown>;
                parsed.themePreference = pref;
                localStorage.setItem("massive_mentor_user", JSON.stringify(parsed));
              }
            } catch {
              /* ignore */
            }
          })
          .catch(() => {
            /* keep local */
          });
        return;
      }
      // Super Admin platform session
      try {
        const adminToken = localStorage.getItem(PORTAL_TOKENS.admin);
        if (adminToken) {
          void api
            .platformPatchThemePreference(pref, adminToken)
            .then((res) => {
              if (!res.success) return;
              try {
                const stored = localStorage.getItem(PORTAL_USER_KEYS.admin);
                if (stored) {
                  const parsed = JSON.parse(stored) as Record<string, unknown>;
                  parsed.themePreference = pref;
                  localStorage.setItem(
                    PORTAL_USER_KEYS.admin,
                    JSON.stringify(parsed)
                  );
                }
              } catch {
                /* ignore */
              }
            })
            .catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    },
    [setTheme, token]
  );

  const preference = normalizeTheme(theme);
  const resolved: "light" | "dark" | undefined =
    resolvedTheme === "light" || resolvedTheme === "dark"
      ? resolvedTheme
      : systemTheme === "light" || systemTheme === "dark"
        ? systemTheme
        : undefined;

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme: resolved,
      setPreference,
      mounted,
    }),
    [preference, resolved, setPreference, mounted]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Outer provider — only next-themes (no auth dependency). */
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

export function useAppTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      preference: "system",
      resolvedTheme: undefined,
      setPreference: () => {},
      mounted: false,
    };
  }
  return ctx;
}
