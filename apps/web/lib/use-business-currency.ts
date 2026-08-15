"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import {
  getAppCurrency,
  isCurrencyCode,
  onCurrencyChange,
  setAppCurrency,
  type CurrencyCode,
  formatCurrency,
  currencySymbol,
} from "@/lib/currency";

/**
 * Reactive business currency from Business Profile (localStorage + live profile fetch).
 * Finance and money UIs should use this instead of reading localStorage once.
 */
export function useBusinessCurrency(override?: string | null) {
  const { token } = useAuth();
  const [currency, setCurrency] = useState<CurrencyCode>(() => {
    if (override && isCurrencyCode(override)) return override;
    return getAppCurrency();
  });

  useEffect(() => {
    if (override && isCurrencyCode(override)) {
      setCurrency(override);
      setAppCurrency(override);
    }
  }, [override]);

  useEffect(() => {
    return onCurrencyChange((code) => setCurrency(code));
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        // 1) Business tenant currency (Super Admin provision → Business.settings)
        const cfg = await api.getBusinessConfig(token);
        if (!cancelled && cfg.success && cfg.data?.business) {
          const b = cfg.data.business as { currency?: string };
          if (b.currency && isCurrencyCode(b.currency)) {
            setAppCurrency(b.currency);
            setCurrency(b.currency);
            return;
          }
        }
        // 2) Profile (resolves business currency on API)
        const res = await api.getProfile(token);
        if (cancelled || !res.success || !res.data?.profile) return;
        const p = res.data.profile as { currency?: string };
        if (p.currency && isCurrencyCode(p.currency)) {
          setAppCurrency(p.currency);
          setCurrency(p.currency);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const applyCurrency = useCallback((code: CurrencyCode) => {
    setAppCurrency(code);
    setCurrency(code);
  }, []);

  const money = useCallback(
    (amount: number | string | null | undefined) => formatCurrency(amount, currency),
    [currency]
  );

  return {
    currency,
    setCurrency: applyCurrency,
    money,
    symbol: currencySymbol(currency),
  };
}
