"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PasswordInput } from "@/components/ui/PasswordInput";

type IntegrationRow = {
  provider: string;
  isActive: boolean;
  configured: boolean;
  status: string;
  connectionStatus?: string;
  lastValidatedAt?: string | null;
  lastError?: string | null;
  businessId?: string | null;
  webhook?: {
    callbackUrl?: string;
    verifyToken?: string | null;
    hasVerifyToken?: boolean;
    webhookVerifiedAt?: string | null;
    lastWebhookReceivedAt?: string | null;
    status?: string;
  } | null;
  configPreview?: {
    hasAccessToken?: boolean;
    accessTokenPreview?: string | null;
    phoneNumberId?: string | null;
    hasVerifyToken?: boolean;
    hasAppSecret?: boolean;
    verifyToken?: string | null;
    apiVersion?: string;
    displayName?: string | null;
    phoneDisplay?: string | null;
    wabaName?: string | null;
    wabaId?: string | null;
    qualityRating?: string | null;
    webhookVerifiedAt?: string | null;
    lastWebhookReceivedAt?: string | null;
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

const CALLBACK_URL =
  process.env.NEXT_PUBLIC_WHATSAPP_WEBHOOK_URL ||
  "https://api.massivementor.in/api/integrations/whatsapp/webhook";

const inputClass =
  "w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-border";

function randomVerifyToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `mm_wa_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function copyText(label: string, text: string) {
  if (!text) {
    toast.error(`Nothing to copy for ${label}`);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy — select and copy manually");
  }
}

function StepRow({
  done,
  active,
  label,
  detail,
}: {
  done: boolean;
  active?: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
        done
          ? "border-emerald-500/30 bg-emerald-500/5"
          : active
            ? "border-violet-500/40 bg-violet-500/10"
            : "border-border bg-background/60"
      }`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-violet-500 text-white"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? "✓" : "·"}
      </span>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${done ? "text-emerald-300" : "text-foreground"}`}>
          {label}
        </div>
        {detail ? <p className="text-xs text-muted-foreground mt-0.5">{detail}</p> : null}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const { token } = useAuth();
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [apiVersion, setApiVersion] = useState("v19.0");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testConnResult, setTestConnResult] = useState<"Connected" | "Failed" | null>(null);

  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("Hello from Massive Mentor CRM — connection test.");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const wa = integrations.find((i) => i.provider === "whatsapp");

  const connectionStatus = useMemo(
    () => (wa?.connectionStatus || wa?.status || "not_connected").toLowerCase(),
    [wa]
  );

  const displayVerifyToken =
    verifyToken.trim() ||
    wa?.webhook?.verifyToken ||
    wa?.configPreview?.verifyToken ||
    "";

  const webhookVerified = !!(
    wa?.webhook?.webhookVerifiedAt ||
    wa?.configPreview?.webhookVerifiedAt
  );
  const lastWebhookAt =
    wa?.webhook?.lastWebhookReceivedAt || wa?.configPreview?.lastWebhookReceivedAt || null;

  const step1Done = webhookVerified || !!lastWebhookAt;
  const step2Done = !!(
    wa?.configured &&
    wa?.lastValidatedAt &&
    connectionStatus !== "invalid_token" &&
    connectionStatus !== "not_connected"
  );
  const step3Done = connectionStatus === "connected";

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    const res = await api.get<{ integrations: IntegrationRow[] }>("/integrations", token);
    if (res.success && res.data?.integrations) {
      setIntegrations(res.data.integrations);
      const w = res.data.integrations.find((i) => i.provider === "whatsapp");
      if (w?.configPreview?.phoneNumberId) setPhoneNumberId(w.configPreview.phoneNumberId);
      if (w?.configPreview?.apiVersion) setApiVersion(w.configPreview.apiVersion);
      const vt = w?.webhook?.verifyToken || w?.configPreview?.verifyToken;
      if (vt) setVerifyToken((prev) => prev || vt);
    }
    setIsLoading(false);
  }, [token]);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    const res = await api.get<{ items?: HistoryItem[] }>(
      "/integrations/whatsapp/history?pageSize=20",
      token
    );
    if (res.success && res.data) {
      setHistory((res.data as { items?: HistoryItem[] }).items || []);
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
    setTestConnResult(null);
    const res = await api.post(
      "/integrations/whatsapp/validate",
      {
        accessToken: accessToken.trim().replace(/^Bearer\s+/i, "").trim(),
        phoneNumberId: phoneNumberId.trim(),
        apiVersion,
      },
      token
    );
    setValidating(false);
    if (res.success && res.data) {
      const d = res.data as {
        displayName?: string;
        phoneDisplay?: string;
        wabaName?: string;
      };
      setTestConnResult("Connected");
      toast.success(
        [
          d.displayName ? `Number: ${d.displayName}` : "Credentials valid",
          d.phoneDisplay ? `Phone: ${d.phoneDisplay}` : null,
          d.wabaName ? `WABA: ${d.wabaName}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
    } else {
      setTestConnResult("Failed");
      toast.error(res.error || "Validation failed");
    }
  };

  const testConnection = async () => {
    if (!token) return;
    // Prefer live body tokens if user is typing; else saved credentials
    if (accessToken.trim() && phoneNumberId.trim()) {
      await validateOnly();
      return;
    }
    setTestingConn(true);
    setTestConnResult(null);
    const res = await api.post("/integrations/whatsapp/test-connection", {}, token);
    setTestingConn(false);
    if (res.success && res.data) {
      const d = res.data as {
        status?: string;
        displayName?: string;
        phoneDisplay?: string;
        wabaName?: string;
      };
      setTestConnResult("Connected");
      toast.success(
        [
          d.status || "Connected",
          d.displayName ? `· ${d.displayName}` : null,
          d.wabaName ? `· ${d.wabaName}` : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
      await load();
    } else {
      setTestConnResult("Failed");
      toast.error(res.error || "Connection failed");
      await load();
    }
  };

  const saveWhatsApp = async () => {
    if (!token) return;
    if (!phoneNumberId.trim()) {
      toast.error("Phone Number ID is required");
      return;
    }
    if (!accessToken.trim() && !wa?.configPreview?.hasAccessToken) {
      toast.error("Access Token is required");
      return;
    }
    const vt = verifyToken.trim() || randomVerifyToken();
    if (!verifyToken.trim()) setVerifyToken(vt);

    setSaving(true);
    const config: Record<string, string> = {
      phoneNumberId: phoneNumberId.trim(),
      apiVersion: apiVersion || "v19.0",
      verifyToken: vt,
    };
    if (accessToken.trim()) {
      config.accessToken = accessToken.trim().replace(/^Bearer\s+/i, "").trim();
    }
    if (appSecret.trim()) {
      config.appSecret = appSecret.trim();
    }

    const res = await api.post("/integrations/configure", { provider: "whatsapp", config }, token);
    setSaving(false);
    if (res.success) {
      const data = res.data as {
        integration?: {
          status?: string;
          displayName?: string;
          phoneDisplay?: string;
          wabaName?: string;
          webhook?: { verifyToken?: string };
        };
      };
      const ig = data?.integration;
      if (ig?.webhook?.verifyToken) setVerifyToken(ig.webhook.verifyToken);
      toast.success(
        ig?.status === "verification_pending"
          ? "Credentials saved — complete webhook setup (Step 1)"
          : "WhatsApp connected"
      );
      if (ig?.displayName || ig?.wabaName) {
        toast.message(
          [ig.displayName && `Display: ${ig.displayName}`, ig.wabaName && `WABA: ${ig.wabaName}`]
            .filter(Boolean)
            .join(" · ")
        );
      }
      setAccessToken("");
      setAppSecret("");
      setTestConnResult("Connected");
      await load();
    } else {
      setTestConnResult("Failed");
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
      const st = (res.data as { status?: string })?.status || "sent";
      toast.success(`Test WhatsApp message ${st}`);
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
    if (s === "verification_pending")
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30">
          Verification Pending
        </span>
      );
    if (s === "invalid_token" || s === "error")
      return (
        <span className="px-2.5 py-0.5 rounded-full text-xs bg-red-500/15 text-red-400 border border-red-500/30">
          Invalid Token
        </span>
      );
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs bg-muted text-muted-foreground border border-border">
        Not Connected
      </span>
    );
  };

  const canSend =
    connectionStatus === "connected" || connectionStatus === "verification_pending";

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">Integrations</h1>
      <p className="text-muted-foreground mb-8 text-sm sm:text-base">
        Connect <strong className="text-muted-foreground">your own</strong> Meta WhatsApp Cloud API. Each
        workspace keeps separate credentials.
      </p>

      {isLoading ? (
        <div className="h-48 bg-card border border-border rounded-2xl animate-pulse" />
      ) : (
        <div className="space-y-6">
          <section className="bg-card border border-border rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
              <div>
                <h2 className="text-lg font-semibold">WhatsApp Cloud API</h2>
                <p className="text-xs text-muted-foreground mt-1">Self-service multi-tenant setup</p>
              </div>
              {statusBadge(connectionStatus)}
            </div>

            {/* Setup wizard progress */}
            <div className="mb-6 space-y-2">
              <h3 className="text-sm font-semibold text-foreground mb-2">Setup Wizard</h3>
              <StepRow
                done={step1Done}
                active={!step1Done}
                label="Step 1: Verify Webhook"
                detail={
                  step1Done
                    ? "Meta verified your Callback URL"
                    : "Copy Callback URL + Verify Token into Meta Developers"
                }
              />
              <StepRow
                done={step2Done}
                active={step1Done && !step2Done}
                label="Step 2: Validate Credentials"
                detail={
                  step2Done
                    ? "Graph API accepted Access Token + Phone Number ID"
                    : "Enter token + Phone Number ID → Validate / Test Connection"
                }
              />
              <StepRow
                done={step3Done}
                active={step2Done && !step3Done}
                label="Step 3: Connected"
                detail={
                  step3Done
                    ? "Ready to send and receive WhatsApp messages"
                    : "Complete webhook verification and save valid credentials"
                }
              />
            </div>

            {/* Webhook status panel */}
            <div className="mb-6 grid sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-background border border-border">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Webhook status
                </div>
                <div
                  className={`text-sm font-semibold ${
                    webhookVerified || lastWebhookAt
                      ? "text-emerald-400"
                      : "text-amber-300"
                  }`}
                >
                  {webhookVerified || lastWebhookAt ? "Verified" : "Not Verified"}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-background border border-border sm:col-span-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Last webhook received
                </div>
                <div className="text-sm text-foreground">
                  {lastWebhookAt
                    ? new Date(lastWebhookAt).toLocaleString()
                    : "No events yet — send a message or wait for delivery status"}
                </div>
              </div>
            </div>

            {/* Callback + Verify Token */}
            <div className="mb-6 p-4 rounded-xl bg-background border border-border space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">Callback URL</span>
                  <button
                    type="button"
                    onClick={() => copyText("Callback URL", CALLBACK_URL)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                  >
                    Copy Callback URL
                  </button>
                </div>
                <code className="block break-all text-sm text-emerald-400/90">{CALLBACK_URL}</code>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">Verify Token</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVerifyToken(randomVerifyToken())}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                    >
                      Generate
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText("Verify Token", displayVerifyToken)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                    >
                      Copy Verify Token
                    </button>
                  </div>
                </div>
                <code className="block break-all text-sm text-sky-300/90">
                  {displayVerifyToken || "Generate or enter a verify token, then Save"}
                </code>
              </div>
            </div>

            {/* Detected profile */}
            {(wa?.configPreview?.displayName ||
              wa?.configPreview?.phoneDisplay ||
              wa?.configPreview?.wabaName) && (
              <div className="mb-6 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <h3 className="text-sm font-semibold text-emerald-200 mb-2">Detected from Meta</h3>
                <div className="grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {wa.configPreview?.displayName && (
                    <div>
                      Display name:{" "}
                      <span className="text-foreground">{wa.configPreview.displayName}</span>
                    </div>
                  )}
                  {wa.configPreview?.phoneDisplay && (
                    <div>
                      Phone:{" "}
                      <span className="text-foreground">{wa.configPreview.phoneDisplay}</span>
                    </div>
                  )}
                  {wa.configPreview?.wabaName && (
                    <div>
                      WhatsApp Business Account:{" "}
                      <span className="text-foreground">{wa.configPreview.wabaName}</span>
                    </div>
                  )}
                  {wa.configPreview?.qualityRating && (
                    <div>
                      Quality:{" "}
                      <span className="text-foreground">{wa.configPreview.qualityRating}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mb-6 p-4 rounded-xl border border-violet-500/20 bg-violet-500/5 text-sm text-muted-foreground">
              <h3 className="font-semibold text-violet-200 mb-2">Meta setup</h3>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
                <li>
                  Meta Developers → your app → WhatsApp → Configuration
                </li>
                <li>Paste Callback URL + Verify Token → Verify and save</li>
                <li>Subscribe to the <strong className="text-muted-foreground">messages</strong> field</li>
                <li>
                  Permanent System User token (EAA…) + Phone Number ID → form below → Test Connection
                  → Save
                </li>
              </ol>
            </div>

            {wa?.lastError && (
              <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-sm text-red-300">
                {wa.lastError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Access Token {wa?.configPreview?.hasAccessToken ? "(leave blank to keep current)" : "*"}
                </label>
                <PasswordInput
                  autoComplete="off"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="EAA… (raw System User token)"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Phone Number ID *</label>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="From Meta WhatsApp → API Setup"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Verify Token *</label>
                <input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="Must match Meta webhook verify token"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Meta App Secret{" "}
                  {wa?.configPreview?.hasAppSecret
                    ? "(leave blank to keep current)"
                    : "* required for webhook signature"}
                </label>
                <PasswordInput
                  autoComplete="off"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="From Meta App → Settings → Basic → App Secret"
                  className={inputClass}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Used to verify <code className="text-muted-foreground">X-Hub-Signature-256</code> on
                  incoming webhooks. Never shared between workspaces.
                </p>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">API Version</label>
                <input
                  value={apiVersion}
                  onChange={(e) => setApiVersion(e.target.value)}
                  placeholder="v19.0"
                  className={inputClass}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={testingConn || validating}
                  onClick={testConnection}
                  className="px-4 py-2 rounded-xl text-sm bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 disabled:opacity-50"
                >
                  {testingConn || validating ? "Testing…" : "Test Connection"}
                </button>
                {testConnResult === "Connected" && (
                  <span className="text-xs font-semibold text-emerald-400">Connected</span>
                )}
                {testConnResult === "Failed" && (
                  <span className="text-xs font-semibold text-red-400">Failed</span>
                )}
                <button
                  type="button"
                  disabled={validating}
                  onClick={validateOnly}
                  className="px-4 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50"
                >
                  {validating ? "Validating…" : "Validate (form values)"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveWhatsApp}
                  className="px-4 py-2 rounded-xl text-sm bg-primary text-primary-foreground font-medium hover:bg-primary-hover disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save & connect"}
                </button>
              </div>
            </div>

            {/* Send test WhatsApp */}
            <div className="mt-8 pt-6 border-t border-border">
              <h3 className="font-medium mb-1">Send Test WhatsApp Message</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Sends a sample message using this workspace&apos;s credentials. Use international
                format (e.g. 9198xxxxxxxx). Default destination can be your own WhatsApp number.
              </p>
              <div className="space-y-2">
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="Recipient phone (international)"
                  className={inputClass}
                />
                <textarea
                  value={testMsg}
                  onChange={(e) => setTestMsg(e.target.value)}
                  className={`${inputClass} h-20`}
                />
                <button
                  type="button"
                  disabled={sending || !canSend}
                  onClick={sendTest}
                  className="px-4 py-2 rounded-xl text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  {sending ? "Sending…" : "Send Test WhatsApp Message"}
                </button>
                {!canSend && (
                  <p className="text-xs text-amber-400/90">
                    Save valid credentials before sending a test message.
                  </p>
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
                      className="text-xs p-2 rounded-lg bg-background border border-border flex justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-muted-foreground truncate">
                          → {h.to}: {h.body}
                        </div>
                        {h.error && <div className="text-red-400 mt-0.5">{h.error}</div>}
                      </div>
                      <div className="shrink-0 text-muted-foreground text-right">
                        <div>{h.status}</div>
                        <div>{new Date(h.createdAt).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
