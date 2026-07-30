"use client";

import { API_BASE_URL } from "@/lib/api";

export type BillingStreamEvent = {
  type?: string;
  businessId?: string;
  at?: string;
  plan?: string | null;
  planStatus?: string | null;
  isTrial?: boolean;
  licenseStatus?: string | null;
  isLocked?: boolean;
  subscriptionEndsAt?: string | null;
  trialEndsAt?: string | null;
  trialDaysRemaining?: number | null;
  action?: string;
  source?: string;
};

/**
 * Subscribe to GET /api/billing/stream (SSE via fetch + Authorization).
 * Calls onEvent for subscription_changed / snapshot; reconnects with backoff.
 * Returns an abort function.
 */
export function connectBillingStream(
  token: string,
  onEvent: (payload: BillingStreamEvent) => void,
  opts?: { onStatus?: (status: "connecting" | "open" | "closed" | "error") => void }
): () => void {
  const ac = new AbortController();
  let closed = false;
  let attempt = 0;

  const run = async () => {
    while (!closed && !ac.signal.aborted) {
      opts?.onStatus?.("connecting");
      try {
        const url = `${API_BASE_URL}/billing/stream`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal: ac.signal,
          cache: "no-store",
        });

        if (!res.ok || !res.body) {
          throw new Error(`stream HTTP ${res.status}`);
        }

        opts?.onStatus?.("open");
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames separated by blank line
          const parts = buffer.split(/\n\n/);
          buffer = parts.pop() || "";

          for (const frame of parts) {
            const lines = frame.split(/\n/);
            let eventName = "message";
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              }
              // ignore comments (: heartbeat)
            }
            if (!dataLines.length) continue;
            if (eventName !== "subscription" && eventName !== "connected") continue;
            try {
              const payload = JSON.parse(dataLines.join("\n")) as BillingStreamEvent;
              if (eventName === "subscription") {
                onEvent(payload);
              }
            } catch {
              /* ignore bad frames */
            }
          }
        }
      } catch (err) {
        if (ac.signal.aborted || closed) break;
        opts?.onStatus?.("error");
        // Exponential backoff, cap 30s
        attempt += 1;
        const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt, 4)));
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (closed || ac.signal.aborted) break;
      opts?.onStatus?.("closed");
      // Brief pause before reconnect after clean close
      await new Promise((r) => setTimeout(r, 1500));
    }
  };

  void run();

  return () => {
    closed = true;
    ac.abort();
    opts?.onStatus?.("closed");
  };
}
