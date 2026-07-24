"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PasswordInput } from "@/components/ui/PasswordInput";

type IntegrationRow = {
  provider: string;
  isActive: boolean;
  configured: boolean;
  status: string;
  lastValidatedAt?: string | null;
  lastError?: string | null;
  mvp?: boolean;
  configPreview?: {
    hasAccessToken?: boolean;
    accessTokenPreview?: string | null;
    phoneNumberId?: string | null;
    hasVerifyToken?: boolean;
    apiVersion?: string;
    displayName?: string;
  };
};

type HistoryItem = {
  id: string;
  to: string;
  body: string;
  status: string;
  createdAt: string;
  error?: string | null;
};

const inputClass =
  "w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-600";

export default function IntegrationsPage() {
  const { token } = useAuth();
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // WhatsApp config form
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [apiVersion, setApiVersion] = useState("v19.0");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);

  // Test send
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("Hello from Massive Mentor — test message.");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const wa = integrations.find((i) => i.provider === "whatsapp");

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    const res = await api.get<{ integrations: IntegrationRow[] }>("/integrations", token);
    if (res.success && res.data?.integrations) {
      setIntegrations(res.data.integrations);
      const w = res.data.integrations.find((i) => i.provider === "whatsapp");
      if (w?.configPreview?.phoneNumberId) {
        setPhoneNumberId(w.configPreview.phoneNumberId);
      }
      if (w?.configPreview?.apiVersion) {
        setApiVersion(w.configPreview.apiVersion);
      }
    }
    setIsLoading(false);
  }, [token]);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    const res = await api.get<{ items?: HistoryItem[] }>("/integrations/whatsapp/history?pageSize=20", token);
    if (res.success && res.data) {
      const items = (res.data as { items?: HistoryItem[] }).items || [];
      setHistory(items);
    }
  }, [token]);

  useEffect(() => {
    load();
    loadHistory();
  }, [load, loadHistory]);

  const validateOnly = async () => {
    if (!token) return;
    if (!accessToken.trim() || !phoneNumberId.trim()) {
      toast.error("Access Token and Phone Number ID are required to validate");
      return;
    }
    setValidating(true);
    const res = await api.post(
      "/integrations/whatsapp/validate",
      {
        // Strip accidental "Bearer " prefix / whitespace before send
        accessToken: accessToken.trim().replace(/^Bearer\s+/i, "").trim(),
        phoneNumberId: phoneNumberId.trim(),
        apiVersion,
      },
      token
    );
    setValidating(false);
    if (res.success) {
      const name = (res.data as { displayName?: string })?.displayName;
      toast.success(name ? `Valid — ${name}` : "Credentials are valid");
    } else {
      toast.error(res.error || "Validation failed");
    }
  };

  const saveWhatsApp = async () => {
    if (!token) return;
    if (!phoneNumberId.trim()) {
      toast.error("Phone Number ID is required");
      return;
    }
    // Allow save without re-entering token if already configured
    if (!accessToken.trim() && !wa?.configPreview?.hasAccessToken) {
      toast.error("Access Token is required");
      return;
    }
    setSaving(true);
    const config: Record<string, string> = {
      phoneNumberId: phoneNumberId.trim(),
      apiVersion: apiVersion || "v19.0",
    };
    if (accessToken.trim()) {
      config.accessToken = accessToken.trim().replace(/^Bearer\s+/i, "").trim();
    }
    if (verifyToken.trim()) config.verifyToken = verifyToken.trim();

    const res = await api.post("/integrations/configure", { provider: "whatsapp", config }, token);
    setSaving(false);
    if (res.success) {
      toast.success("WhatsApp connected and validated");
      setAccessToken(""); // clear secret from form
      await load();
    } else {
      toast.error(res.error || "Failed to save — credentials not valid");
    }
  };

  const sendTest = async () => {
    if (!token) return;
    if (!testTo.trim() || !testMsg.trim()) {
      toast.error("Phone and message are required");
      return;
    }
    setSending(true);
    const res = await api.post(
      "/integrations/whatsapp/send",
      { to: testTo.trim(), message: testMsg.trim() },
      token
    );
    setSending(false);
    if (res.success) {
      const st = (res.data as { status?: string; messageId?: string })?.status || "sent";
      toast.success(`WhatsApp message ${st}`);
      await loadHistory();
    } else {
      toast.error(res.error || "Send failed");
    }
  };

  const statusBadge = (status: string) => {
    const s = (status || "not_connected").toLowerCase();
    if (s === "connected")
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          Connected
        </span>
      );
    if (s === "error")
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs bg-red-500/15 text-red-400 border border-red-500/30">
          Error
        </span>
      );
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400 border border-zinc-700">
        Not Connected
      </span>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">Integrations</h1>
      <p className="text-zinc-400 mb-8 text-sm sm:text-base">
        Connect WhatsApp Cloud API (Meta). Gmail and Google Calendar are planned for a later release.
      </p>

      {isLoading ? (
        <div className="h-48 bg-zinc-900 border border-zinc-800 rounded-2xl animate-pulse" />
      ) : (
        <div className="space-y-6">
          {/* WhatsApp card */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
              <div>
                <h2 className="text-lg font-semibold">WhatsApp Cloud API</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Meta Graph API — configure as Business Admin
                </p>
              </div>
              {statusBadge(wa?.status || "not_connected")}
            </div>

            <div className="mb-4 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 space-y-1">
              <div className="font-medium text-zinc-300">Meta webhook Callback URL</div>
              <code className="block break-all text-emerald-400/90">
                https://api.massivementor.in/api/integrations/whatsapp/webhook
              </code>
              <p className="text-zinc-500">
                In Meta Developers → WhatsApp → Configuration: paste this URL, set Verify Token to
                match the field below (or server env <code className="text-zinc-400">WHATSAPP_VERIFY_TOKEN</code>
                ), subscribe to <strong className="text-zinc-400">messages</strong>.
              </p>
              <p className="text-zinc-500">
                Access Token must be a permanent <strong className="text-zinc-400">System User</strong>{" "}
                token (starts with <code className="text-zinc-400">EAA</code>). Paste the raw token only —
                do not include the word <code className="text-zinc-400">Bearer</code>.
              </p>
            </div>

            {wa?.lastError && (
              <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-sm text-red-300">
                {wa.lastError}
              </div>
            )}

            {wa?.configured && wa.configPreview && (
              <div className="mb-4 grid sm:grid-cols-2 gap-2 text-xs text-zinc-400">
                <div>
                  Token:{" "}
                  <span className="text-zinc-200">
                    {wa.configPreview.accessTokenPreview || "saved"}
                  </span>
                </div>
                <div>
                  Phone Number ID:{" "}
                  <span className="text-zinc-200">{wa.configPreview.phoneNumberId || "—"}</span>
                </div>
                {wa.lastValidatedAt && (
                  <div className="sm:col-span-2">
                    Last validated: {new Date(wa.lastValidatedAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  Access Token {wa?.configPreview?.hasAccessToken ? "(leave blank to keep current)" : "*"}
                </label>
                <PasswordInput
                  autoComplete="off"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="EAAxxxx…"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Phone Number ID *</label>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="From Meta Developer Console"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  Verify Token (webhooks, optional)
                </label>
                <input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="Your webhook verify token"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">API Version</label>
                <input
                  value={apiVersion}
                  onChange={(e) => setApiVersion(e.target.value)}
                  placeholder="v19.0"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  disabled={validating}
                  onClick={validateOnly}
                  className="px-4 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50"
                >
                  {validating ? "Validating…" : "Validate credentials"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveWhatsApp}
                  className="px-4 py-2 rounded-xl text-sm bg-white text-zinc-950 font-medium hover:bg-zinc-200 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save & connect"}
                </button>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800">
              <h3 className="font-medium mb-3">Test message</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Sends a real message via Meta Cloud API. Use full international number (e.g. 9198xxxxxxxx).
              </p>
              <div className="space-y-2">
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="Recipient phone"
                  className={inputClass}
                />
                <textarea
                  value={testMsg}
                  onChange={(e) => setTestMsg(e.target.value)}
                  className={`${inputClass} h-20`}
                />
                <button
                  type="button"
                  disabled={sending || wa?.status !== "connected"}
                  onClick={sendTest}
                  className="px-4 py-2 rounded-xl text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  {sending ? "Sending…" : "Send test WhatsApp"}
                </button>
                {wa?.status !== "connected" && (
                  <p className="text-xs text-amber-400/90">Connect WhatsApp before sending.</p>
                )}
              </div>
            </div>

            {history.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium mb-2">Recent messages</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="text-xs p-2 rounded-lg bg-zinc-950 border border-zinc-800 flex justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-zinc-300 truncate">
                          → {h.to}: {h.body}
                        </div>
                        {h.error && <div className="text-red-400 mt-0.5">{h.error}</div>}
                      </div>
                      <div className="shrink-0 text-zinc-500 text-right">
                        <div>{h.status}</div>
                        <div>{new Date(h.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Gmail / Calendar — hidden from MVP as not implemented */}
          <section className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 opacity-80">
            <h2 className="text-lg font-semibold text-zinc-300">Gmail & Google Calendar</h2>
            <p className="text-sm text-zinc-500 mt-2">
              Not included in this release. These will ship with full Google OAuth (send/receive + calendar
              sync) in a future update. They are intentionally disabled so nothing appears as a working stub.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-500 border border-zinc-700">
                Gmail — Coming soon
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-500 border border-zinc-700">
                Calendar — Coming soon
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
