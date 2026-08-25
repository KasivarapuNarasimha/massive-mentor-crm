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
  preferredMode?: "basic" | "enterprise";
  effectiveMode?: "basic" | "enterprise";
  modeLabel?: string;
  modeDescription?: string;
  enterpriseConnected?: boolean;
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
    preferredMode?: "basic" | "enterprise";
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
      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
        done
          ? "border-border bg-muted/40"
          : active
            ? "border-primary/40 bg-muted/30"
            : "border-border bg-card"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done
            ? "bg-emerald-600 text-white"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? "✓" : "·"}
      </span>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${done ? "text-foreground" : "text-foreground"}`}>
          {label}
        </div>
        {detail ? <p className="mm-secondary mt-0.5">{detail}</p> : null}
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
  const [savingMode, setSavingMode] = useState(false);

  const wa = integrations.find((i) => i.provider === "whatsapp");
  const preferredMode: "basic" | "enterprise" =
    wa?.preferredMode ||
    wa?.configPreview?.preferredMode ||
    "basic";
  const effectiveMode: "basic" | "enterprise" = wa?.effectiveMode || "basic";
  const enterpriseConnected = !!wa?.enterpriseConnected;

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

  const setPreferredMode = async (mode: "basic" | "enterprise") => {
    if (!token) return;
    if (mode === "enterprise" && !enterpriseConnected && !wa?.configured) {
      toast.message("Enterprise Mode needs Cloud API credentials below. You can still use Basic Mode now.");
    }
    setSavingMode(true);
    const res = await api.setWhatsAppPreferredMode(mode, token);
    setSavingMode(false);
    if (res.success && res.data) {
      toast.success(
        res.data.mode === "enterprise"
          ? "Enterprise Mode — automatic WhatsApp delivery"
          : "Basic Mode — messages open in WhatsApp (no setup required)"
      );
      await load();
    } else {
      toast.error(res.error || "Could not update preferred mode");
    }
  };

  const sendTest = async () => {
    if (!token) return;
    if (!testTo.trim() || !testMsg.trim()) {
      toast.error("Phone and message are required");
      return;
    }
    setSending(true);
    const res = await api.sendWhatsAppMessage(
      { to: testTo.trim(), message: testMsg.trim() },
      token
    );
    setSending(false);
    if (res.success && res.data) {
      const d = res.data as {
        mode?: string;
        status?: string;
        uiHint?: string;
        basic?: { waUrl?: string };
      };
      if (d.mode === "basic" || d.basic?.waUrl) {
        if (d.basic?.waUrl) {
          window.open(d.basic.waUrl, "_blank", "noopener,noreferrer");
        }
        toast.message(d.uiHint || "Opening WhatsApp...");
        return;
      }
      const st = d.status || "sent";
      toast.success(`Test WhatsApp message ${st}`);
      await loadHistory();
    } else {
      const err = res.error || "";
      if (/not configured|access token|phone number id|cloud api/i.test(err)) {
        toast.message("Opening WhatsApp...");
      } else {
        toast.error(err || "Could not send");
      }
    }
  };

  const statusBadge = (status: string) => {
    const s = (status || "not_connected").toLowerCase();
    if (s === "connected")
      return <span className="mm-badge mm-badge-success">Connected</span>;
    if (s === "verification_pending")
      return <span className="mm-badge mm-badge-warning">Verification Pending</span>;
    if (s === "invalid_token" || s === "error")
      return <span className="mm-badge mm-badge-danger">Invalid Token</span>;
    return <span className="mm-badge">Not Connected</span>;
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="mm-page-title">Integrations</h1>
      <p className="mm-secondary mt-1 mb-6">
        Start with <strong className="text-foreground font-medium">Basic WhatsApp</strong> (no Meta
        setup). Optionally connect your own Cloud API later for automatic delivery.
      </p>

      {isLoading ? (
        <div className="h-40 mm-card animate-pulse" />
      ) : (
        <div className="space-y-4">
          {/* Preferred Mode — Basic is default onboarding */}
          <section className="mm-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-base font-semibold">WhatsApp</h2>
                <p className="mm-secondary mt-1">
                  Preferred Mode · effective now:{" "}
                  <span className="font-medium text-foreground">
                    {effectiveMode === "enterprise" ? "Enterprise Mode" : "Basic Mode"}
                  </span>
                </p>
              </div>
              {effectiveMode === "enterprise" ? (
                <span className="mm-badge mm-badge-success">Automatic delivery</span>
              ) : (
                <span className="mm-badge mm-badge-primary">No setup required</span>
              )}
            </div>

            <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              {effectiveMode === "enterprise" ? (
                <>
                  <div className="text-sm font-semibold">Enterprise Mode</div>
                  <p className="mm-secondary mt-0.5">
                    Automatic WhatsApp delivery enabled. Conversations, delivery & read status
                    available.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold">Basic Mode</div>
                  <p className="mm-secondary mt-0.5">
                    No setup required. Messages will open in WhatsApp Web/App with a pre-filled
                    message.
                    {preferredMode === "enterprise" && !enterpriseConnected
                      ? " (Enterprise preferred, but Cloud API is not connected — using Basic.)"
                      : ""}
                  </p>
                </>
              )}
            </div>

            <h3 className="text-sm font-semibold mb-2">Preferred Mode</h3>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  preferredMode === "basic"
                    ? "border-primary/50 bg-muted/40"
                    : "border-border bg-card hover:bg-muted/20"
                }`}
              >
                <input
                  type="radio"
                  name="wa-preferred-mode"
                  className="mt-1"
                  checked={preferredMode === "basic"}
                  disabled={savingMode}
                  onChange={() => void setPreferredMode("basic")}
                />
                <div>
                  <div className="text-sm font-medium">Basic WhatsApp (Default)</div>
                  <p className="mm-secondary mt-0.5">
                    Opens WhatsApp with a pre-filled message. Works in under 30 seconds — no Meta
                    Developer account.
                  </p>
                </div>
              </label>
              <label
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  preferredMode === "enterprise"
                    ? "border-primary/50 bg-muted/40"
                    : "border-border bg-card hover:bg-muted/20"
                }`}
              >
                <input
                  type="radio"
                  name="wa-preferred-mode"
                  className="mt-1"
                  checked={preferredMode === "enterprise"}
                  disabled={savingMode}
                  onChange={() => void setPreferredMode("enterprise")}
                />
                <div>
                  <div className="text-sm font-medium">Enterprise Cloud API</div>
                  <p className="mm-secondary mt-0.5">
                    Automatic send, delivery & read receipts, Conversation Center. Requires valid
                    Access Token + Phone Number ID below.
                  </p>
                </div>
              </label>
            </div>
          </section>

          <section className="mm-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold">Enterprise Cloud API (Optional)</h2>
                <p className="mm-secondary mt-1">
                  Meta WhatsApp Cloud API — only needed for automatic delivery
                </p>
              </div>
              {statusBadge(connectionStatus)}
            </div>

            {/* Setup wizard progress */}
            <div className="mb-4 space-y-2">
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
            <div className="mb-4 grid sm:grid-cols-3 gap-2">
              <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                <div className="mm-secondary uppercase tracking-wide mb-1">Webhook status</div>
                <div className="text-sm font-semibold">
                  {webhookVerified || lastWebhookAt ? (
                    <span className="mm-badge mm-badge-success">Verified</span>
                  ) : (
                    <span className="mm-badge mm-badge-warning">Not Verified</span>
                  )}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/30 border border-border sm:col-span-2">
                <div className="mm-secondary uppercase tracking-wide mb-1">
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
            <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border space-y-3">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="mm-secondary font-medium">Callback URL</span>
                  <button
                    type="button"
                    onClick={() => copyText("Callback URL", CALLBACK_URL)}
                    className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs"
                  >
                    Copy Callback URL
                  </button>
                </div>
                <code className="block break-all text-sm text-foreground">{CALLBACK_URL}</code>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="mm-secondary font-medium">Verify Token</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVerifyToken(randomVerifyToken())}
                      className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs"
                    >
                      Generate
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText("Verify Token", displayVerifyToken)}
                      className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs"
                    >
                      Copy Verify Token
                    </button>
                  </div>
                </div>
                <code className="block break-all text-sm text-foreground">
                  {displayVerifyToken || "Generate or enter a verify token, then Save"}
                </code>
              </div>
            </div>

            {/* Detected profile */}
            {(wa?.configPreview?.displayName ||
              wa?.configPreview?.phoneDisplay ||
              wa?.configPreview?.wabaName) && (
              <div className="mb-4 p-3 rounded-lg border border-border bg-muted/30">
                <h3 className="text-sm font-semibold mb-2">Detected from Meta</h3>
                <div className="grid sm:grid-cols-2 gap-2 mm-secondary">
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

            <div className="mb-4 p-3 rounded-lg border border-border bg-muted/30 text-sm">
              <h3 className="font-semibold mb-2">Meta setup</h3>
              <ol className="list-decimal list-inside space-y-1.5 mm-secondary">
                <li>Meta Developers → your app → WhatsApp → Configuration</li>
                <li>Paste Callback URL + Verify Token → Verify and save</li>
                <li>
                  Subscribe to the <strong className="text-foreground font-medium">messages</strong>{" "}
                  field
                </li>
                <li>
                  Permanent System User token (EAA…) + Phone Number ID → form below → Test Connection
                  → Save
                </li>
              </ol>
            </div>

            {wa?.lastError && (
              <div className="mb-3 p-2.5 rounded-lg border border-border bg-muted/30 text-sm text-destructive">
                {wa.lastError}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <label className="block mm-secondary mb-1">
                  Access Token {wa?.configPreview?.hasAccessToken ? "(leave blank to keep current)" : "*"}
                </label>
                <PasswordInput
                  autoComplete="off"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="EAA… (raw System User token)"
                  className="mm-input"
                />
              </div>
              <div>
                <label className="block mm-secondary mb-1">Phone Number ID *</label>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="From Meta WhatsApp → API Setup"
                  className="mm-input"
                />
              </div>
              <div>
                <label className="block mm-secondary mb-1">Verify Token *</label>
                <input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="Must match Meta webhook verify token"
                  className="mm-input"
                />
              </div>
              <div>
                <label className="block mm-secondary mb-1">
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
                  className="mm-input"
                />
                <p className="mm-secondary mt-1">
                  Used to verify <code className="text-foreground">X-Hub-Signature-256</code> on
                  incoming webhooks. Never shared between workspaces.
                </p>
              </div>
              <div>
                <label className="block mm-secondary mb-1">API Version</label>
                <input
                  value={apiVersion}
                  onChange={(e) => setApiVersion(e.target.value)}
                  placeholder="v19.0"
                  className="mm-input"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={testingConn || validating}
                  onClick={testConnection}
                  className="mm-btn mm-btn-secondary disabled:opacity-50"
                >
                  {testingConn || validating ? "Testing…" : "Test Connection"}
                </button>
                {testConnResult === "Connected" && (
                  <span className="mm-badge mm-badge-success">Connected</span>
                )}
                {testConnResult === "Failed" && (
                  <span className="mm-badge mm-badge-danger">Failed</span>
                )}
                <button
                  type="button"
                  disabled={validating}
                  onClick={validateOnly}
                  className="mm-btn mm-btn-secondary disabled:opacity-50"
                >
                  {validating ? "Validating…" : "Validate (form values)"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveWhatsApp}
                  className="mm-btn mm-btn-primary disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save & connect"}
                </button>
              </div>
            </div>

            {/* Send test WhatsApp — works in Basic Mode without Cloud API */}
            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="text-sm font-medium mb-1">Send Test WhatsApp Message</h3>
              <p className="mm-secondary mb-2.5">
                {effectiveMode === "enterprise"
                  ? "Sends via Cloud API when connected. Use international format (e.g. 9198xxxxxxxx)."
                  : "Opens WhatsApp with a pre-filled message (Basic Mode). Use international format (e.g. 9198xxxxxxxx)."}
              </p>
              <div className="space-y-2">
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="Recipient phone (international)"
                  className="mm-input"
                />
                <textarea
                  value={testMsg}
                  onChange={(e) => setTestMsg(e.target.value)}
                  className="mm-input h-20"
                />
                <button
                  type="button"
                  disabled={sending}
                  onClick={sendTest}
                  className="mm-btn mm-btn-primary disabled:opacity-40"
                >
                  {sending
                    ? effectiveMode === "basic"
                      ? "Opening WhatsApp..."
                      : "Sending…"
                    : "Send Test WhatsApp Message"}
                </button>
              </div>
            </div>

            {history.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-2">Recent messages</h3>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="text-xs p-2 rounded-lg bg-muted/30 border border-border flex justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-muted-foreground truncate">
                          → {h.to}: {h.body}
                        </div>
                        {h.error && <div className="text-destructive mt-0.5">{h.error}</div>}
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
