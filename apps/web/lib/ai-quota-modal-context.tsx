"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AiQuotaUpgradeModal } from "@/components/ai/AiQuotaUpgradeModal";
import {
  isAiQuotaExceededResponse,
  parseAiQuotaExhaustion,
  type AiQuotaExhaustionInfo,
} from "@/lib/ai-quota-ui";
import type { ApiResponse } from "@/types/api";

type AiQuotaModalContextValue = {
  openAiQuotaUpgrade: (info: { planLabel: string; dailyLimit: number }) => void;
  closeAiQuotaUpgrade: () => void;
  /** Opens modal only when response is CRM AI quota exhaustion. Returns true if handled. */
  handleAiQuotaResponse: (res: ApiResponse) => boolean;
};

const AiQuotaModalContext = createContext<AiQuotaModalContextValue | null>(null);

export function AiQuotaModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<AiQuotaExhaustionInfo | null>(null);

  const closeAiQuotaUpgrade = useCallback(() => {
    setOpen(false);
  }, []);

  const openAiQuotaUpgrade = useCallback((next: { planLabel: string; dailyLimit: number }) => {
    setInfo({
      planLabel: next.planLabel,
      dailyLimit: next.dailyLimit,
      message: "Massive Mentor AI usage limit reached",
    });
    setOpen(true);
  }, []);

  const handleAiQuotaResponse = useCallback(
    (res: ApiResponse) => {
      if (!isAiQuotaExceededResponse(res)) return false;
      const parsed = parseAiQuotaExhaustion(res);
      if (!parsed) return false;
      openAiQuotaUpgrade({ planLabel: parsed.planLabel, dailyLimit: parsed.dailyLimit });
      return true;
    },
    [openAiQuotaUpgrade]
  );

  const value = useMemo(
    () => ({ openAiQuotaUpgrade, closeAiQuotaUpgrade, handleAiQuotaResponse }),
    [openAiQuotaUpgrade, closeAiQuotaUpgrade, handleAiQuotaResponse]
  );

  return (
    <AiQuotaModalContext.Provider value={value}>
      {children}
      <AiQuotaUpgradeModal
        open={open}
        planLabel={info?.planLabel || "Starter"}
        dailyLimit={info?.dailyLimit || 50}
        onClose={closeAiQuotaUpgrade}
      />
    </AiQuotaModalContext.Provider>
  );
}

export function useAiQuotaModal() {
  const ctx = useContext(AiQuotaModalContext);
  if (!ctx) {
    throw new Error("useAiQuotaModal must be used within AiQuotaModalProvider");
  }
  return ctx;
}

/** Safe optional hook — returns null outside provider (should not happen in dashboard). */
export function useAiQuotaModalOptional() {
  return useContext(AiQuotaModalContext);
}
