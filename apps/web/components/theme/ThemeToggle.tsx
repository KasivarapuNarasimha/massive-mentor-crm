"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { THEME_STORAGE_KEY, normalizeTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    value: "light",
    label: "Light",
    description: "Clean light interface",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    description: "Easy on the eyes",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
    value: "system",
    label: "System",
    description: "Match your OS",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
];

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    );
  }
  if (preference === "system") {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  );
}

function persistTheme(pref: ThemePreference, token: string | null) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  if (!token) return;
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
}

/**
 * Header theme control — uses next-themes directly so it always works
 * even if ThemeSync context is missing. Persists to API when logged in.
 */
export function ThemeToggle({
  className = "",
  showLabel = true,
}: {
  className?: string;
  /** Show "Theme" text next to icon on sm+ screens */
  showLabel?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const { token } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const preference = normalizeTheme(theme);

  const apply = (next: ThemePreference) => {
    setTheme(next);
    persistTheme(next, token);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={ref} data-testid="theme-toggle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 min-h-11 px-2 sm:px-2.5 rounded-xl border border-border bg-card text-foreground hover:bg-muted focus-ring transition-colors touch-manipulation"
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme — Light, Dark, or System"
        data-testid="theme-toggle-button"
      >
        {mounted ? <ThemeIcon preference={preference} /> : <ThemeIcon preference="system" />}
        {showLabel && (
          <span className="hidden sm:inline text-xs font-medium">Theme</span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card shadow-xl z-[70] py-1 text-sm overflow-hidden"
          role="menu"
          aria-label="Theme"
          data-testid="theme-toggle-menu"
        >
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Theme
            </span>
          </div>
          {OPTIONS.map((opt) => {
            const active = mounted && preference === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => apply(opt.value)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`theme-option-${opt.value}`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                    active
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{opt.description}</span>
                </span>
                {active && (
                  <svg
                    className="w-4 h-4 text-primary ml-auto shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Full Appearance settings radio group */
export function ThemePreferencePicker({
  className = "",
  showDescriptions = true,
}: {
  className?: string;
  showDescriptions?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const { token } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const preference = mounted ? normalizeTheme(theme) : "system";

  const apply = (next: ThemePreference) => {
    setTheme(next);
    persistTheme(next, token);
  };

  return (
    <fieldset className={className} data-testid="theme-preference-picker">
      <legend className="text-sm font-medium text-foreground mb-3">Theme</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const active = preference === opt.value;
          return (
            <label
              key={opt.value}
              className={`relative flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="theme-preference"
                value={opt.value}
                checked={active}
                onChange={() => apply(opt.value)}
                className="sr-only"
              />
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    active
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="font-medium text-foreground text-sm">{opt.label}</span>
                {opt.value === "system" && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Default
                  </span>
                )}
              </div>
              {showDescriptions && (
                <p className="text-xs text-muted-foreground leading-relaxed pl-0.5">
                  {opt.description}
                </p>
              )}
              {active && (
                <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" aria-hidden />
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
