"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/user-messages";
import { useAiQuotaModalOptional } from "@/lib/ai-quota-modal-context";

type Choice = { id: string; label: string; sublabel?: string; field?: string };
type CardAction = { label: string; href?: string; command?: string; confirmToken?: string };
type ResultCard = {
  title: string;
  subtitle?: string;
  fields?: Array<{ label: string; value: string }>;
  actions?: CardAction[];
};

type CommandData = {
  status: string;
  summary: string;
  steps?: unknown[];
  cards?: ResultCard[];
  confirmToken?: string;
  choices?: Choice[];
  missingFields?: string[];
  sessionId: string;
};

const QUICK_COMMANDS = [
  "What needs attention today?",
  "Show priority leads",
  "Show overdue invoices",
  "Show low-stock products",
  "Create a follow-up for my newest lead tomorrow at 10 AM",
];

export function AiCommandCenter() {
  const { token } = useAuth();
  const quotaModal = useAiQuotaModalOptional();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [result, setResult] = useState<CommandData | null>(null);

  const run = useCallback(
    async (text: string, choices?: Record<string, string>) => {
      if (!token) return;
      const trimmed = text.trim();
      if (!trimmed && !choices) return;
      setBusy(true);
      try {
        const res = await api.runAiCommand(
          { message: trimmed || "(selection)", sessionId, choices },
          token
        );
        if (!res.success || !res.data) {
          if (quotaModal?.handleAiQuotaResponse(res)) {
            setResult({
              status: "failed",
              summary: typeof res.error === "string" ? res.error : "Massive Mentor AI usage limit reached",
              sessionId: sessionId || "",
            });
            setBusy(false);
            return;
          }
          const errMsg = friendlyError(
            typeof res.error === "string" ? res.error : undefined,
            "Massive Mentor AI could not complete that command. Please try again."
          );
          toast.error(errMsg);
          setResult({
            status: "failed",
            summary: errMsg,
            sessionId: sessionId || "",
          });
          setBusy(false);
          return;
        }
        const data = res.data as CommandData;
        const summary = friendlyError(data.summary, data.summary);
        const normalized = { ...data, summary };
        setResult(normalized);
        if (data.sessionId) setSessionId(data.sessionId);
        if (data.status === "completed") toast.success(summary);
        else if (data.status === "partial") toast.message(summary);
        else if (data.status === "failed" || data.status === "unsupported") {
          toast.error(summary);
        }
      } catch (e) {
        toast.error(
          friendlyError(e instanceof Error ? e.message : undefined, "Massive Mentor AI could not complete that command.")
        );
      }
      setBusy(false);
    },
    [token, sessionId, quotaModal]
  );

  const confirm = useCallback(
    async (confirmToken: string) => {
      if (!token || !confirmToken) return;
      setBusy(true);
      try {
        const res = await api.confirmAiCommand({ confirmToken, sessionId }, token);
        if (!res.success || !res.data) {
          toast.error(friendlyError(res.error, "Confirmation failed."));
        } else {
          const data = res.data as CommandData;
          setResult(data);
          toast.success(data.summary);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Confirmation failed");
      }
      setBusy(false);
    },
    [token, sessionId]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(message);
    setMessage("");
  };

  return (
    <section
      aria-labelledby="mm-ai-command-heading"
      className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-6 shadow-sm"
    >
      <div className="flex items-start gap-3 mb-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 border border-primary/30 text-primary"
          aria-hidden
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="mm-ai-command-heading" className="text-lg sm:text-xl font-semibold tracking-tight">
            MASSIVE MENTOR AI
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            What do you want to accomplish? Ask, search, or command your CRM &amp; ERP.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2">
        <label className="sr-only" htmlFor="mm-ai-command-input">
          Command Massive Mentor
        </label>
        <input
          id="mm-ai-command-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="🔎 Ask, search or command Massive Mentor..."
          disabled={busy}
          className="flex-1 min-h-12 rounded-xl border border-border bg-background px-4 text-base sm:text-sm focus-ring"
        />
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="min-h-12 px-5 rounded-xl bg-primary text-primary-foreground font-medium disabled:opacity-50 touch-manipulation"
        >
          {busy ? "Working…" : "Run"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_COMMANDS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => void run(q)}
            className="text-xs px-3 py-1.5 rounded-full border border-border bg-background/80 hover:bg-white/10 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              result.status === "completed"
                ? "border-emerald-500/30 bg-emerald-500/10"
                : result.status === "partial" || result.status === "needs_confirmation"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : result.status === "failed" || result.status === "unsupported"
                    ? "border-red-500/30 bg-red-500/10"
                    : "border-border bg-background/60"
            }`}
          >
            <div className="font-medium whitespace-pre-line">{result.summary}</div>
            {result.missingFields?.length ? (
              <p className="text-xs text-muted-foreground mt-1">
                Still needed: {result.missingFields.join(", ")}
              </p>
            ) : null}
          </div>

          {result.status === "needs_choice" && result.choices?.length ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Select one:</p>
              {result.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void run("(selection)", { [c.field || "contact"]: c.id })}
                  className="w-full text-left rounded-xl border border-border bg-card px-3 py-2.5 hover:bg-white/10"
                >
                  <div className="text-sm font-medium">{c.label}</div>
                  {c.sublabel ? (
                    <div className="text-[11px] text-muted-foreground">{c.sublabel}</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {result.status === "needs_confirmation" && result.confirmToken ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setResult(null)}
                className="min-h-10 px-4 rounded-xl bg-white/10 border border-border"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirm(result.confirmToken!)}
                className="min-h-10 px-4 rounded-xl bg-red-600/90 text-white font-medium"
              >
                Confirm
              </button>
            </div>
          ) : null}

          {(result.cards || []).map((card, idx) => (
            <div key={idx} className="rounded-xl border border-border bg-card/80 p-4">
              <div className="font-semibold text-sm">{card.title}</div>
              {card.subtitle ? (
                <p className="text-xs text-muted-foreground mt-0.5">{card.subtitle}</p>
              ) : null}
              {card.fields?.length ? (
                <dl className="mt-2 grid gap-1 text-xs">
                  {card.fields.map((f, i) => (
                    <div key={i} className="flex gap-2">
                      <dt className="text-muted-foreground shrink-0">{f.label}:</dt>
                      <dd className="text-foreground break-words">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {card.actions?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {card.actions.map((a, i) =>
                    a.href ? (
                      <Link
                        key={i}
                        href={a.href}
                        className="text-xs px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/25"
                      >
                        {a.label}
                      </Link>
                    ) : a.confirmToken ? (
                      <button
                        key={i}
                        type="button"
                        disabled={busy}
                        onClick={() => void confirm(a.confirmToken!)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30"
                      >
                        {a.label}
                      </button>
                    ) : a.command ? (
                      <button
                        key={i}
                        type="button"
                        disabled={busy}
                        onClick={() => void run(a.command!)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/10 border border-border"
                      >
                        {a.label}
                      </button>
                    ) : null
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
