"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchFeatures, type FeatureCatalogEntry } from "@/lib/feature-catalog";

type FeatureSearchProps = {
  /** Path-level access (RBAC / portal). Query params stripped by caller helpers. */
  canAccess: (href: string) => boolean;
  /** Portal module keys — soft filter inside catalog when provided */
  modules?: string[] | null;
  /** Called after a result is chosen (e.g. close mobile sidebar) */
  onNavigate?: () => void;
  /** Compact mode for collapsed sidebar — icon only until opened */
  compact?: boolean;
  /** Larger Dashboard hero search */
  size?: "default" | "lg";
  placeholder?: string;
  className?: string;
};

export function FeatureSearch({
  canAccess,
  modules = null,
  onNavigate,
  compact = false,
  size = "default",
  placeholder = "Search features…",
  className = "",
}: FeatureSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () =>
      searchFeatures(query, {
        modules,
        canAccess: (href) => canAccess(href),
      }),
    [query, modules, canAccess]
  );

  const go = useCallback(
    (entry: FeatureCatalogEntry) => {
      router.push(entry.href);
      setQuery("");
      setOpen(false);
      setActiveIdx(0);
      onNavigate?.();
    },
    [router, onNavigate]
  );

  // Ctrl/Cmd+K opens search; focus is handled by the open-state effect below
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus after open so compact mode has mounted the input first
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const showPanel = open && query.trim().length > 0;

  if (compact && !open) {
    return (
      <div className={className} ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hidden lg:inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted focus-ring"
          aria-label="Search features (Ctrl+K)"
          title="Search features (Ctrl+K)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <label className="sr-only" htmlFor="mm-feature-search">
        Search features
      </label>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          id="mm-feature-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              setOpen(false);
              inputRef.current?.blur();
              return;
            }
            if (!results.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = results[activeIdx];
              if (hit) go(hit);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full pl-8 pr-12 rounded-md bg-white dark:bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus-ring ${
            size === "lg"
              ? "h-11 sm:h-12 text-sm sm:text-[0.9375rem]"
              : "h-9 text-xs"
          }`}
          aria-autocomplete="list"
          aria-controls="mm-feature-search-results"
          aria-expanded={showPanel}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground font-medium">
          ⌘K
        </kbd>
      </div>

      {showPanel && (
        <div
          id="mm-feature-search-results"
          role="listbox"
          className={`absolute z-50 left-0 right-0 mt-1 overflow-y-auto rounded-md border border-border bg-card shadow-md py-1 ${
            size === "lg" ? "max-h-80" : "max-h-72"
          }`}
        >
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">No matching features</div>
          ) : (
            results.map((r, idx) => (
              <button
                key={`${r.id}:${r.href}`}
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => go(r)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  idx === activeIdx ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70"
                }`}
              >
                <div className="text-xs font-medium text-foreground truncate">{r.label}</div>
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {r.mainLabel} → {r.subModuleLabel}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
