"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";
import {
  cacheMediaOffline,
  fetchAndCacheMedia,
  listOfflineMedia,
} from "@/lib/media-offline-cache";
import {
  AVAILABLE_TEMPLATE_VARIABLES,
  findUnknownVariables,
  loadSavedCaptionTemplate,
  renderTemplate,
  saveCaptionTemplate,
  varsFromContact,
  type TemplateVars,
} from "@/lib/template-vars";
import { useAuth } from "@/lib/auth-context";

type Asset = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  isShareable?: boolean;
  approvalStatus?: string;
};

type Kit = {
  id: string;
  name: string;
  captionTemplate: string | null;
  items: Array<{ assetId: string }>;
};

type Suggestion = Asset & {
  score?: number;
  reasons?: string[];
};

const DEFAULT_CAPTION = `Hello {{CustomerName}},

Thank you for your interest.
Please find our materials attached.

Regards,
{{SalesExecutive}}`;

const CAPTION_MAX = 4096;
const EMOJIS = [
  "😊",
  "😂",
  "👍",
  "🙏",
  "📄",
  "📞",
  "📍",
  "🎉",
  "❤️",
  "✅",
  "🔥",
  "💼",
  "📈",
  "🤝",
  "✨",
  "👋",
];

type CaptionTemplate = {
  id: string;
  name: string;
  body: string;
  category: string;
  isGlobal?: boolean;
  isPersonal?: boolean;
  useCount?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  contactId: string;
  contactName: string;
  contactPhone?: string | null;
  /** Pre-select assets when opening from library quick actions */
  preselectedAssetIds?: string[];
};

type BasicPhaseState = {
  waUrl: string;
  phone: string;
  logIds: string[];
  contactId: string | null;
  files: Array<{ assetId: string; name: string; downloadPath: string }>;
};

export function SendMediaModal({
  open,
  onClose,
  token,
  contactId,
  contactName,
  contactPhone,
  preselectedAssetIds,
}: Props) {
  const { user } = useAuth();
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kits, setKits] = useState<Kit[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kitId, setKitId] = useState("");
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offlineHint, setOfflineHint] = useState(false);
  const [serviceHints, setServiceHints] = useState<string[]>([]);
  const [templateVars, setTemplateVars] = useState<TemplateVars>({
    CustomerName: contactName,
    Phone: contactPhone || "",
  });
  const [captionTemplates, setCaptionTemplates] = useState<CaptionTemplate[]>([]);
  const [templateCategories, setTemplateCategories] = useState<string[]>([]);
  const [recentTemplates, setRecentTemplates] = useState<CaptionTemplate[]>([]);
  const [templateCategory, setTemplateCategory] = useState("");
  /** basic | enterprise — Basic is default when Cloud API not connected */
  const [waMode, setWaMode] = useState<"basic" | "enterprise">("basic");
  const [waModeLabel, setWaModeLabel] = useState("Basic Mode");
  const [waModeDesc, setWaModeDesc] = useState(
    "No setup required. Messages will open in WhatsApp."
  );
  /** After Basic open: show download list + "Did you send?" */
  const [basicPhase, setBasicPhase] = useState<BasicPhaseState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [templateScope, setTemplateScope] = useState<"all" | "global" | "personal">(
    "all"
  );
  const [language, setLanguage] = useState<"en" | "te" | "hi">("en");
  const [aiBusy, setAiBusy] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState("");
  const [saveTplGlobal, setSaveTplGlobal] = useState(false);
  const [saveTplCategory, setSaveTplCategory] = useState("General");
  const [messaging, setMessaging] = useState<{
    signature: string;
    signatureEnabled: boolean;
    autoSignatureEnabled: boolean;
    canManageAutoSignature: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setOfflineHint(false);
    setBasicPhase(null);
    try {
      const [a, k, rec, contactRes, tplRes, recentRes, msgRes, modeRes] =
        await Promise.all([
          api.listMediaAssets(token, { pageSize: 100, shareableOnly: true }),
          api.listMediaKits(token),
          api.recommendMediaForContact(contactId, token),
          api.getCrmContact(contactId, token),
          api.listCaptionTemplates(token),
          api.recentCaptionTemplates(token),
          api.getMessagingSettings(token),
          api.getWhatsAppMode(token),
        ]);

      if (modeRes.success && modeRes.data) {
        setWaMode(modeRes.data.mode === "enterprise" ? "enterprise" : "basic");
        setWaModeLabel(modeRes.data.label || "Basic Mode");
        setWaModeDesc(
          modeRes.data.description ||
            "No setup required. Messages will open in WhatsApp."
        );
      }

      if (tplRes.success && tplRes.data) {
        setCaptionTemplates((tplRes.data.templates || []) as CaptionTemplate[]);
        setTemplateCategories(tplRes.data.categories || []);
      }
      if (recentRes.success && recentRes.data?.templates) {
        setRecentTemplates(recentRes.data.templates as CaptionTemplate[]);
      }
      if (msgRes.success && msgRes.data) {
        setMessaging({
          signature: msgRes.data.signature || "",
          signatureEnabled: !!msgRes.data.signatureEnabled,
          autoSignatureEnabled: !!msgRes.data.autoSignatureEnabled,
          canManageAutoSignature: !!msgRes.data.canManageAutoSignature,
        });
      }

      // Build merge vars from full contact + current user as fallback sales exec
      let contact: Record<string, unknown> = {
        name: contactName,
        phone: contactPhone,
      };
      if (contactRes.success && contactRes.data) {
        const raw = contactRes.data as Record<string, unknown>;
        // API may return contact at root or under .contact
        contact =
          (raw.contact as Record<string, unknown>) ||
          (raw as Record<string, unknown>);
      }

      const assignedTo = contact.assignedTo as string | undefined;
      let assignedToName: string | null = null;
      // Prefer assignee name if embedded; otherwise current actor name
      if (contact.assignedToName && typeof contact.assignedToName === "string") {
        assignedToName = contact.assignedToName;
      }

      const actorName =
        (user as { name?: string | null } | null)?.name ||
        (user as { email?: string | null } | null)?.email ||
        "Sales";

      const vars = varsFromContact(
        {
          name: String(contact.name || contactName || ""),
          company: contact.company as string | null,
          phone: (contact.phone as string) || contactPhone || null,
          whatsapp: contact.whatsapp as string | null,
          email: contact.email as string | null,
          industry: contact.industry as string | null,
          status: contact.status as string | null,
          source: contact.source as string | null,
          value: contact.value as number | null,
          customFields: (contact.customFields || {}) as Record<string, unknown>,
          assignedToName,
        },
        {
          salesExecutive: assignedToName || actorName,
          businessName: undefined,
        }
      );
      setTemplateVars(vars);
      void assignedTo;

      if (a.success && a.data) {
        const list = (a.data.assets || a.data.items || []) as Asset[];
        setAssets(list);
      } else if (!a.success) {
        const err = (a as { error?: string }).error || "Could not load media library";
        if (/permission|forbidden|MODULE/i.test(err)) {
          toast.error("Media access denied — contact your admin to enable Media Library");
        }
        setAssets([]);
      }
      if (k.success && k.data?.kits) setKits(k.data.kits as Kit[]);
      if (rec.success && rec.data) {
        const sug = (rec.data.suggestions || []) as Suggestion[];
        setSuggestions(sug);
        setServiceHints(rec.data.serviceHints || []);
        if (!preselectedAssetIds?.length && sug.length) {
          setSelected(new Set(sug.slice(0, 4).map((s) => s.id)));
        }
        for (const s of sug.slice(0, 6)) {
          void fetchAndCacheMedia(API_BASE_URL, token, {
            id: s.id,
            name: s.name,
            originalName: s.name,
            mimeType: "application/octet-stream",
            kind: s.kind,
            sizeBytes: s.sizeBytes || 0,
          });
        }
      }
    } catch {
      const cached = await listOfflineMedia();
      if (cached.length) {
        setAssets(
          cached.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            sizeBytes: c.sizeBytes,
          }))
        );
        setOfflineHint(true);
        toast.message("Showing offline-cached files", {
          description: "Sends will queue when connectivity is restored.",
        });
      }
    }
    setLoading(false);
  }, [token, contactId, contactName, contactPhone, preselectedAssetIds, user]);

  useEffect(() => {
    if (open) {
      void load();
      setCaption(loadSavedCaptionTemplate(DEFAULT_CAPTION));
      if (preselectedAssetIds?.length) {
        setSelected(new Set(preselectedAssetIds));
      }
    }
  }, [open, load, preselectedAssetIds]);

  useEffect(() => {
    if (!kitId) return;
    const kit = kits.find((k) => k.id === kitId);
    if (!kit) return;
    setSelected(new Set(kit.items.map((i) => i.assetId)));
    if (kit.captionTemplate) setCaption(kit.captionTemplate);
  }, [kitId, kits]);

  /** Live personalized preview — updates instantly on every keystroke */
  const renderedCaption = useMemo(
    () => renderTemplate(caption, templateVars),
    [caption, templateVars]
  );

  const unknownVars = useMemo(() => findUnknownVariables(caption), [caption]);

  const insertAtCursor = useCallback((token: string) => {
    const el = captionRef.current;
    if (!el) {
      setCaption((prev) => (prev + token).slice(0, CAPTION_MAX));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const prev = el.value;
    const next = (prev.slice(0, start) + token + prev.slice(end)).slice(0, CAPTION_MAX);
    setCaption(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = Math.min(start + token.length, CAPTION_MAX);
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const insertVariable = useCallback(
    (varName: string) => insertAtCursor(`{{${varName}}}`),
    [insertAtCursor]
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      insertAtCursor(emoji);
      setShowEmoji(false);
    },
    [insertAtCursor]
  );

  const copyPreview = async () => {
    try {
      await navigator.clipboard.writeText(renderedCaption);
      toast.success("Preview copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const saveAsTemplateLocal = () => {
    saveCaptionTemplate(caption);
    toast.success("Default caption saved on this device");
  };

  const resetTemplate = () => {
    setCaption(DEFAULT_CAPTION);
    toast.message("Template reset to default");
  };

  const applyCaptionTemplate = async (t: CaptionTemplate) => {
    setCaption(t.body.slice(0, CAPTION_MAX));
    void api.useCaptionTemplate(t.id, token).then((res) => {
      if (res.success) {
        void api.recentCaptionTemplates(token).then((r) => {
          if (r.success && r.data?.templates) {
            setRecentTemplates(r.data.templates as CaptionTemplate[]);
          }
        });
      }
    });
    toast.success(`Loaded: ${t.name}`);
  };

  const runImproveAi = async () => {
    if (!caption.trim()) {
      toast.error("Write a caption first");
      return;
    }
    setAiBusy(true);
    try {
      const res = await api.improveCaption(caption, token);
      if (res.success && res.data?.text) {
        setCaption(res.data.text.slice(0, CAPTION_MAX));
        toast.success("Caption improved");
      } else toast.error(res.error || "AI improve failed");
    } finally {
      setAiBusy(false);
    }
  };

  const runTranslate = async (lang: "en" | "te" | "hi") => {
    setLanguage(lang);
    if (!caption.trim()) return;
    setAiBusy(true);
    try {
      const res = await api.translateCaption(caption, lang, token);
      if (res.success && res.data?.text) {
        setCaption(res.data.text.slice(0, CAPTION_MAX));
        toast.success(
          lang === "te" ? "Translated to Telugu" : lang === "hi" ? "Translated to Hindi" : "Translated to English"
        );
      } else toast.error(res.error || "Translation failed");
    } finally {
      setAiBusy(false);
    }
  };

  const savePersonalOrGlobalTemplate = async () => {
    if (!saveTplName.trim()) {
      toast.error("Enter a template name");
      return;
    }
    const res = await api.createCaptionTemplate(
      {
        name: saveTplName.trim(),
        body: caption,
        category: saveTplCategory,
        isGlobal: saveTplGlobal,
      },
      token
    );
    if (res.success) {
      toast.success(saveTplGlobal ? "Global template saved" : "Personal template saved");
      setSaveTplOpen(false);
      setSaveTplName("");
      const tplRes = await api.listCaptionTemplates(token);
      if (tplRes.success && tplRes.data) {
        setCaptionTemplates((tplRes.data.templates || []) as CaptionTemplate[]);
      }
    } else toast.error(res.error || "Save failed");
  };

  const filteredTemplates = useMemo(() => {
    return captionTemplates.filter((t) => {
      if (templateCategory && t.category !== templateCategory) return false;
      if (templateScope === "global" && !t.isGlobal) return false;
      if (templateScope === "personal" && !t.isPersonal) return false;
      return true;
    });
  }, [captionTemplates, templateCategory, templateScope]);

  const charCount = caption.length;
  const charWarn = charCount > CAPTION_MAX * 0.85;
  const charOver = charCount > CAPTION_MAX;

  /** Preview with signature when auto-append is on */
  const previewWithSignature = useMemo(() => {
    if (
      !messaging?.autoSignatureEnabled ||
      !messaging.signatureEnabled ||
      !messaging.signature?.trim()
    ) {
      return renderedCaption;
    }
    const sig = messaging.signature.trim();
    if (!renderedCaption) return sig;
    if (renderedCaption.endsWith(sig)) return renderedCaption;
    return `${renderedCaption}\n\n${sig}`;
  }, [renderedCaption, messaging]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAllSuggestions = () => {
    setSelected(new Set(suggestions.map((s) => s.id)));
  };

  const downloadSelectedFiles = (files: Array<{ assetId: string; name: string }>) => {
    for (const f of files) {
      const url = api.mediaFileUrl(f.assetId);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name || "file";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      // Auth via query is not used; open with fetch+blob when token present
      void (async () => {
        try {
          const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error("download failed");
          const blob = await res.blob();
          const obj = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = obj;
          link.download = f.name || "file";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(obj);
        } catch {
          // Fallback: open file URL in new tab
          window.open(url, "_blank", "noopener,noreferrer");
        }
      })();
    }
    toast.message("Download started — attach files in WhatsApp after saving.");
  };

  const confirmBasicSend = async (sent: boolean, phase: BasicPhaseState) => {
    setConfirming(true);
    try {
      await api.confirmBasicWhatsAppSend(
        {
          sent,
          contactId: phase.contactId || contactId,
          logIds: phase.logIds,
          phone: phase.phone,
        },
        token
      );
      if (sent) {
        toast.success("WhatsApp Sent (Manual)", {
          description: "Message marked as manually sent.",
        });
      } else {
        toast.message("Marked as not sent");
      }
      setBasicPhase(null);
      onClose();
    } finally {
      setConfirming(false);
    }
  };

  /** Client-side wa.me builder (mirrors API Basic Mode) when server omits waUrl. */
  const buildClientWaUrl = (phone: string, message: string): string | null => {
    let digits = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) return null;
    if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
    if (digits.length < 11 || digits.length > 15) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(message || "Hello")}`;
  };

  const enterBasicHandoff = (opts: {
    waUrl?: string;
    phone?: string;
    logIds?: string[];
    contactId?: string | null;
    files?: Array<{ assetId: string; name: string; downloadPath: string }>;
  }) => {
    const files =
      opts.files && opts.files.length
        ? opts.files
        : [...selected].map((id) => {
            const a =
              assets.find((x) => x.id === id) || suggestions.find((x) => x.id === id);
            return {
              assetId: id,
              name: a?.name || id,
              downloadPath: `/media/assets/${id}/file`,
            };
          });
    const msg =
      (typeof caption === "string" && caption.trim()) ||
      previewWithSignature ||
      "Hello";
    const phoneDigits =
      opts.phone ||
      String(contactPhone || "")
        .replace(/\D/g, "")
        .replace(/^0+/, "");
    const waUrl =
      opts.waUrl ||
      buildClientWaUrl(contactPhone || phoneDigits, msg) ||
      "";
    if (waUrl) {
      window.open(waUrl, "_blank", "noopener,noreferrer");
    }
    toast.message("WhatsApp opened", {
      description:
        "Your personalized message is ready. Attach the downloaded file and press Send in WhatsApp.",
    });
    setBasicPhase({
      waUrl,
      phone: phoneDigits,
      logIds: opts.logIds || [],
      contactId: opts.contactId ?? contactId,
      files,
    });
    for (const id of selected) {
      const a = assets.find((x) => x.id === id) || suggestions.find((x) => x.id === id);
      if (a) {
        void cacheMediaOffline({
          id: a.id,
          name: a.name,
          originalName: a.name,
          mimeType: "application/octet-stream",
          kind: a.kind,
          sizeBytes: a.sizeBytes || 0,
        });
      }
    }
  };

  const send = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one file");
      return;
    }
    const phoneCheck = buildClientWaUrl(contactPhone || "", "x");
    if (!contactPhone || !phoneCheck) {
      toast.error("This lead does not have a valid WhatsApp number.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("You are offline. Files will be sendable once connectivity is restored.");
      return;
    }
    // Always send the template form — server re-renders with full context (assignee, deal, etc.)
    setSending(true);
    try {
      const res = kitId
        ? await api.sendMediaKitWhatsApp(
            kitId,
            { contactId, caption },
            token
          )
        : await api.sendMediaWhatsApp(
            {
              contactId,
              assetIds: [...selected],
              caption,
            },
            token
          );
      if (res.success && res.data) {
        const d = res.data as {
          mode?: "basic" | "enterprise";
          sent?: number;
          failed?: number;
          uiHint?: string;
          results?: Array<{ ok?: boolean; status?: string; error?: string }>;
          basic?: {
            waUrl?: string;
            phone?: string;
            logIds?: string[];
            contactId?: string | null;
            files?: Array<{ assetId: string; name: string; downloadPath: string }>;
          };
        };

        const sentCount = Number(d.sent ?? 0);
        const failedCount = Number(d.failed ?? 0);
        const results = d.results || [];
        const allFailed =
          results.length > 0
            ? results.every((r) => r.ok === false || r.status === "failed")
            : failedCount > 0 && sentCount === 0;
        const pendingManual =
          results.some((r) => r.status === "pending_customer_send") ||
          d.uiHint === "Opening WhatsApp...";

        // Basic Mode / failed Cloud handoff — never show "Sent 0 / 1 failed"
        if (
          d.mode === "basic" ||
          d.basic?.waUrl ||
          pendingManual ||
          (sentCount === 0 && (failedCount > 0 || allFailed))
        ) {
          enterBasicHandoff({
            waUrl: d.basic?.waUrl,
            phone: d.basic?.phone,
            logIds: d.basic?.logIds,
            contactId: d.basic?.contactId ?? contactId,
            files: d.basic?.files,
          });
          return;
        }

        // Enterprise automatic success
        toast.success(
          `Sent ${sentCount || selected.size} file(s) via WhatsApp`,
          { description: contactName }
        );
        for (const id of selected) {
          const a =
            assets.find((x) => x.id === id) || suggestions.find((x) => x.id === id);
          if (a) {
            void cacheMediaOffline({
              id: a.id,
              name: a.name,
              originalName: a.name,
              mimeType: "application/octet-stream",
              kind: a.kind,
              sizeBytes: a.sizeBytes || 0,
            });
          }
        }
        onClose();
      } else {
        const err = (res as { error?: string }).error || "";
        if (
          /not configured|access token|phone number id|cloud api|inactive|invalid.?token/i.test(
            err
          )
        ) {
          // Cloud missing — still open Basic Mode client-side
          enterBasicHandoff({});
          return;
        }
        if (/valid WhatsApp number|no valid phone|phone number/i.test(err)) {
          toast.error("This lead does not have a valid WhatsApp number.");
          return;
        }
        toast.error(err || "Could not open WhatsApp");
      }
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  // ── Basic Mode post-open: media list + confirm manual send ──────────────
  if (basicPhase) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 dark:bg-black/60 flex items-end sm:items-center justify-center sm:p-4">
        <div className="bg-card border border-border rounded-t-xl sm:rounded-lg w-full sm:max-w-md max-h-[92dvh] overflow-y-auto p-4 sm:p-5 space-y-4 shadow-lg">
          <div className="flex justify-between items-start gap-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Opening WhatsApp...</h3>
              <p className="mm-secondary mt-0.5">
                To {contactName}
                {basicPhase.phone ? ` · ${basicPhase.phone}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="mm-btn mm-btn-ghost h-8 min-h-8 px-2 text-sm"
              onClick={() => {
                setBasicPhase(null);
                onClose();
              }}
            >
              Close
            </button>
          </div>

          <div className="mm-card px-3 py-2.5 text-sm border-emerald-200 bg-emerald-50 text-emerald-800">
            🟢 Basic Mode — message opened in WhatsApp Web/App. Click Send there when ready.
          </div>

          {basicPhase.files.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Selected Files</h4>
              <ul className="space-y-1.5">
                {basicPhase.files.map((f) => (
                  <li
                    key={f.assetId}
                    className="flex items-center gap-2 mm-card px-3 py-2 text-sm"
                  >
                    <span className="text-base">📄</span>
                    <span className="truncate flex-1">{f.name}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => downloadSelectedFiles(basicPhase.files)}
                className="mm-btn mm-btn-primary w-full"
              >
                Download Selected Files
              </button>
              <p className="mm-secondary">
                Download these files and attach them manually in WhatsApp.
              </p>
            </div>
          )}

          <div className="mm-card p-4 space-y-3">
            <p className="text-sm font-medium">Did you send the message?</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={confirming}
                onClick={() => void confirmBasicSend(true, basicPhase)}
                className="mm-btn mm-btn-primary flex-1"
              >
                Yes
              </button>
              <button
                type="button"
                disabled={confirming}
                onClick={() => void confirmBasicSend(false, basicPhase)}
                className="mm-btn mm-btn-secondary flex-1"
              >
                No
              </button>
            </div>
            {basicPhase.waUrl ? (
              <button
                type="button"
                onClick={() =>
                  window.open(basicPhase.waUrl, "_blank", "noopener,noreferrer")
                }
                className="w-full text-xs text-primary hover:underline"
              >
                Re-open WhatsApp
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 dark:bg-black/60 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-card border border-border rounded-t-xl sm:rounded-lg w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto p-4 sm:p-5 shadow-lg">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Send Media</h3>
            <p className="mm-secondary mt-0.5">
              To {contactName}
              {contactPhone ? ` · ${contactPhone}` : " · no phone"}
            </p>
          </div>
          <button type="button" className="mm-btn mm-btn-ghost h-8 min-h-8 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {/* WhatsApp Mode badge — Basic is default when Cloud API not configured */}
        <div
          className={`mt-3 mm-card px-3 py-2.5 text-sm ${
            waMode === "enterprise"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-sky-200 bg-sky-50 text-sky-800"
          }`}
        >
          <div className="font-semibold">
            WhatsApp Mode · 🟢 {waModeLabel}
          </div>
          <p className="mm-secondary mt-0.5 !text-inherit opacity-90">{waModeDesc}</p>
        </div>

        {offlineHint && (
          <div className="mt-3 mm-card px-3 py-2 text-xs border-amber-200 bg-amber-50 text-amber-800">
            Offline mode — using locally cached files. Sending requires internet.
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="mt-4 mm-card p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                  AI Suggested Files
                </div>
                {serviceHints.length > 0 && (
                  <p className="mm-secondary mt-0.5">
                    Based on: {serviceHints.slice(0, 4).join(", ")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={selectAllSuggestions}
                className="mm-btn mm-btn-primary h-8 min-h-8 px-2 text-[11px]"
              >
                Send All
              </button>
            </div>
            <ul className="space-y-1">
              {suggestions.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted rounded-lg">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="text-emerald-700 text-xs">✓</span>
                    <span className="truncate flex-1 font-medium">{s.name}</span>
                    <span className="mm-badge">{s.kind}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {kits.length > 0 && (
          <div className="mt-4">
            <label className="mm-label">Template kit</label>
            <select
              value={kitId}
              onChange={(e) => setKitId(e.target.value)}
              className="mm-input w-full min-h-9 text-sm mt-1"
            >
              <option value="">— Select files manually —</option>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4">
          <label className="mm-label">
            All approved files
          </label>
          {loading ? (
            <p className="mm-secondary py-4">Loading library…</p>
          ) : assets.length === 0 ? (
            <p className="mm-secondary py-4">
              No approved files available. Ask an admin to upload and approve materials.
            </p>
          ) : (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {assets.map((a) => (
                <li key={a.id}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="mm-badge">{a.kind}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Messaging experience (templates, AI, emoji, languages) ── */}
        <div className="mt-4 space-y-3">
          {/* Recently used templates */}
          {recentTemplates.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Recently Used
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentTemplates.slice(0, 6).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void applyCaptionTemplate(t)}
                    className="mm-badge hover:border-primary hover:bg-primary/10 cursor-pointer"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Template library */}
          <div className="mm-card p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Message Templates
              </span>
              <div className="flex flex-wrap gap-1.5">
                <select
                  value={templateScope}
                  onChange={(e) =>
                    setTemplateScope(e.target.value as "all" | "global" | "personal")
                  }
                  className="mm-input text-[11px] min-h-8 py-0 w-auto"
                >
                  <option value="all">All</option>
                  <option value="global">Company</option>
                  <option value="personal">My Templates</option>
                </select>
                <select
                  value={templateCategory}
                  onChange={(e) => setTemplateCategory(e.target.value)}
                  className="mm-input text-[11px] min-h-8 py-0 w-auto"
                >
                  <option value="">All categories</option>
                  {(templateCategories.length
                    ? templateCategories
                    : ["Sales", "Support", "Marketing", "Follow-up", "Payment", "General"]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {filteredTemplates.length === 0 ? (
                <p className="mm-secondary py-1">No templates in this filter.</p>
              ) : (
                filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void applyCaptionTemplate(t)}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-border bg-muted hover:bg-muted/80 text-left"
                    title={t.category}
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-[9px] text-muted-foreground ml-1">
                      {t.isPersonal ? "· mine" : t.isGlobal ? "· company" : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Caption
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void copyPreview()}
                className="mm-btn mm-btn-secondary h-8 min-h-8 px-2 text-[11px]"
              >
                Copy Preview
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaveTplOpen(true);
                  setSaveTplName("");
                  setSaveTplGlobal(false);
                }}
                className="mm-btn mm-btn-secondary h-8 min-h-8 px-2 text-[11px]"
              >
                Save as Template
              </button>
              <button
                type="button"
                onClick={saveAsTemplateLocal}
                className="mm-btn mm-btn-ghost h-8 min-h-8 px-2 text-[11px]"
              >
                Save as Default
              </button>
              <button
                type="button"
                onClick={resetTemplate}
                className="mm-btn mm-btn-ghost h-8 min-h-8 px-2 text-[11px]"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Toolbar: emoji, AI, language */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-sm"
                title="Emoji"
              >
                😊 Emoji
              </button>
              {showEmoji && (
                <div className="absolute left-0 top-full mt-1 z-20 p-2 rounded-lg border border-border bg-card shadow-md grid grid-cols-8 gap-1 w-56">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="text-lg p-1 hover:bg-muted rounded-md"
                      onClick={() => insertEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={aiBusy || !caption.trim()}
              onClick={() => void runImproveAi()}
              className={`mm-btn mm-btn-primary h-8 min-h-8 px-2.5 text-[11px] ${
                aiBusy ? "mm-btn-loading" : ""
              }`}
            >
              {aiBusy ? "Working…" : "✨ Improve with AI"}
            </button>
            <select
              value={language}
              disabled={aiBusy}
              onChange={(e) => void runTranslate(e.target.value as "en" | "te" | "hi")}
              className="mm-input text-[11px] min-h-8 py-0 w-auto"
              title="Translate caption (keeps variables)"
            >
              <option value="en">English</option>
              <option value="te">Telugu</option>
              <option value="hi">Hindi</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="mm-card p-3 flex flex-col min-h-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Template
              </div>
              <textarea
                ref={captionRef}
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
                rows={8}
                className="mm-input w-full flex-1 text-sm resize-y font-mono min-h-[140px]"
                placeholder={"Hello {{CustomerName}},\n\n…\n\nRegards,\n{{SalesExecutive}}"}
                spellCheck={false}
              />
              <div
                className={`text-[11px] mt-1.5 tabular-nums ${
                  charOver
                    ? "text-destructive font-semibold"
                    : charWarn
                      ? "text-amber-700"
                      : "text-muted-foreground"
                }`}
              >
                Characters: {charCount.toLocaleString("en-IN")} / {CAPTION_MAX.toLocaleString("en-IN")}
                {charWarn && !charOver ? " · Approaching limit" : ""}
                {charOver ? " · Over limit" : ""}
              </div>
            </div>

            <div className="mm-card p-3 flex flex-col min-h-0 border-emerald-200 bg-emerald-50/40">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                  Live Preview
                </div>
                <span className="mm-secondary">
                  As {contactName || "customer"} will see
                </span>
              </div>
              {previewWithSignature ? (
                <pre className="text-sm whitespace-pre-wrap font-sans text-foreground leading-relaxed flex-1">
                  {previewWithSignature}
                </pre>
              ) : (
                <p className="mm-secondary">Caption is empty.</p>
              )}
              {messaging?.autoSignatureEnabled && messaging.signatureEnabled && (
                <p className="mm-secondary mt-2 border-t border-border pt-2">
                  Signature will be appended automatically on send.
                </p>
              )}
            </div>
          </div>

          <div className="mm-card p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Available Variables
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="text-[11px] font-mono px-2 py-1 rounded-lg border border-border bg-muted hover:border-primary hover:bg-primary/10 transition-colors"
                  title={`Insert {{${v}}}`}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {unknownVars.length > 0 && (
            <div className="mm-card px-3 py-2.5 space-y-1.5 border-amber-200 bg-amber-50">
              <div className="text-xs font-semibold text-amber-800">
                Unknown variable{unknownVars.length > 1 ? "s" : ""}
              </div>
              {unknownVars.map((u) => (
                <div key={u.raw} className="text-xs text-amber-900">
                  <span className="font-mono text-amber-800">{u.raw}</span>
                  {u.suggestion ? (
                    <>
                      {" "}
                      — Did you mean{" "}
                      <button
                        type="button"
                        className="font-mono text-primary underline underline-offset-2"
                        onClick={() => {
                          setCaption((prev) =>
                            prev.replace(
                              new RegExp(
                                `\\{\\{\\s*${u.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`,
                                "g"
                              ),
                              `{{${u.suggestion}}}`
                            )
                          );
                        }}
                      >
                        {`{{${u.suggestion}}}`}
                      </button>
                      ?
                    </>
                  ) : (
                    <span className="text-muted-foreground"> — will be removed when sent</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Signature quick toggle */}
          {messaging && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={messaging.signatureEnabled}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setMessaging({ ...messaging, signatureEnabled: enabled });
                    await api.updateMessagingSettings({ signatureEnabled: enabled }, token);
                  }}
                />
                Append my signature
              </label>
              {messaging.canManageAutoSignature && (
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={messaging.autoSignatureEnabled}
                    onChange={async (e) => {
                      const enabled = e.target.checked;
                      setMessaging({ ...messaging, autoSignatureEnabled: enabled });
                      await api.updateMessagingSettings(
                        { autoSignatureEnabled: enabled },
                        token
                      );
                    }}
                  />
                  Workspace auto-signature (Admin)
                </label>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={sending || selected.size === 0 || charOver}
          onClick={() => void send()}
          className={`mt-4 w-full mm-btn mm-btn-primary ${sending ? "mm-btn-loading" : ""}`}
        >
          {sending
            ? waMode === "basic"
              ? "Opening WhatsApp..."
              : "Sending…"
            : waMode === "basic"
              ? `Send via WhatsApp (${selected.size || 0} file${selected.size === 1 ? "" : "s"})`
              : `Send ${selected.size || ""} file(s) via WhatsApp`}
        </button>

        {/* Save template modal */}
        {saveTplOpen && (
          <div className="fixed inset-0 z-[70] bg-black/50 dark:bg-black/60 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-lg w-full max-w-sm p-5 space-y-3 shadow-lg">
              <h4 className="font-semibold text-base tracking-tight">Save as Template</h4>
              <input
                value={saveTplName}
                onChange={(e) => setSaveTplName(e.target.value)}
                placeholder="Template name"
                className="mm-input w-full text-sm"
              />
              <select
                value={saveTplCategory}
                onChange={(e) => setSaveTplCategory(e.target.value)}
                className="mm-input w-full text-sm"
              >
                {(templateCategories.length
                  ? templateCategories
                  : ["Sales", "Support", "Marketing", "Follow-up", "Payment", "General"]
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {messaging?.canManageAutoSignature && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={saveTplGlobal}
                    onChange={(e) => setSaveTplGlobal(e.target.checked)}
                  />
                  Company-wide (Business Admin)
                </label>
              )}
              <p className="mm-secondary">
                {saveTplGlobal
                  ? "Visible to all sales users in this workspace."
                  : "Saved under My Templates — only you can see it."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="mm-btn mm-btn-secondary flex-1"
                  onClick={() => setSaveTplOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="mm-btn mm-btn-primary flex-1"
                  onClick={() => void savePersonalOrGlobalTemplate()}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
