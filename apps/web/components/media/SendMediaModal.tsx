"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";
import {
  cacheMediaOffline,
  fetchAndCacheMedia,
  listOfflineMedia,
} from "@/lib/media-offline-cache";
import {
  hasUnresolvedPlaceholders,
  renderTemplate,
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

  const load = useCallback(async () => {
    setLoading(true);
    setOfflineHint(false);
    try {
      const [a, k, rec, contactRes] = await Promise.all([
        api.listMediaAssets(token, { pageSize: 100, shareableOnly: true }),
        api.listMediaKits(token),
        api.recommendMediaForContact(contactId, token),
        api.getCrmContact(contactId, token),
      ]);

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
      setCaption(DEFAULT_CAPTION);
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

  const renderedCaption = useMemo(
    () => renderTemplate(caption, templateVars),
    [caption, templateVars]
  );

  if (!open) return null;

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

  const send = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one file");
      return;
    }
    if (!contactPhone || contactPhone.replace(/\D/g, "").length < 10) {
      toast.error("Lead has no valid phone for WhatsApp");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("You are offline. Files will be sendable once connectivity is restored.");
      return;
    }
    // Always send the template form — server re-renders with full context (assignee, deal, etc.)
    // Also send if user edited already-rendered text
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
        const d = res.data as { sent?: number; failed?: number };
        toast.success(`Sent ${d.sent ?? selected.size} file(s) via WhatsApp`, {
          description: d.failed ? `${d.failed} failed` : contactName,
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
        onClose();
      } else {
        toast.error((res as { error?: string }).error || "Send failed");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-5">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h3 className="text-lg font-semibold">Send Media</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              To {contactName}
              {contactPhone ? ` · ${contactPhone}` : " · no phone"}
            </p>
          </div>
          <button type="button" className="text-sm text-muted-foreground" onClick={onClose}>
            Close
          </button>
        </div>

        {offlineHint && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Offline mode — using locally cached files. Sending requires internet.
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                  AI Suggested Files
                </div>
                {serviceHints.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Based on: {serviceHints.slice(0, 4).join(", ")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={selectAllSuggestions}
                className="text-[11px] font-medium px-2 py-1 rounded-lg bg-primary text-primary-foreground"
              >
                Send All
              </button>
            </div>
            <ul className="space-y-1">
              {suggestions.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-white/5 rounded-lg">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="text-emerald-400 text-xs">✓</span>
                    <span className="truncate flex-1 font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{s.kind}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {kits.length > 0 && (
          <div className="mt-4">
            <label className="text-[10px] uppercase text-muted-foreground">Template kit</label>
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
          <label className="text-[10px] uppercase text-muted-foreground">
            All approved files
          </label>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading library…</p>
          ) : assets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No approved files available. Ask an admin to upload and approve materials.
            </p>
          ) : (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
              {assets.map((a) => (
                <li key={a.id}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground uppercase">{a.kind}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <label className="text-[10px] uppercase text-muted-foreground">
            Caption template
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            className="mm-input w-full text-sm mt-1 resize-y font-mono"
            placeholder="Hello {{CustomerName}}, …"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Variables: {"{{CustomerName}}"}, {"{{SalesExecutive}}"}, {"{{Company}}"},{" "}
            {"{{Phone}}"}, {"{{Email}}"}, {"{{Service}}"}, {"{{DealValue}}"},{" "}
            {"{{BusinessName}}"}
          </p>
        </div>

        {/* Final WhatsApp preview — fully rendered, no placeholders */}
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300 mb-2">
            Message preview (as customer will see)
          </div>
          {renderedCaption ? (
            <pre className="text-sm whitespace-pre-wrap font-sans text-foreground leading-relaxed">
              {renderedCaption}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">Caption is empty.</p>
          )}
          {hasUnresolvedPlaceholders(renderedCaption) && (
            <p className="text-[11px] text-amber-300 mt-2">
              Some variables could not be filled — they will be removed on send.
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={sending || selected.size === 0}
          onClick={() => void send()}
          className="mt-4 w-full min-h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          {sending
            ? "Sending…"
            : `Send ${selected.size || ""} file(s) via WhatsApp`}
        </button>
      </div>
    </div>
  );
}
