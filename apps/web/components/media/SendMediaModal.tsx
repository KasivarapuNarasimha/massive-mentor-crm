"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Asset = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
};

type Kit = {
  id: string;
  name: string;
  captionTemplate: string | null;
  items: Array<{ assetId: string }>;
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
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kits, setKits] = useState<Kit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kitId, setKitId] = useState("");
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, k] = await Promise.all([
      api.listMediaAssets(token, { pageSize: 100 }),
      api.listMediaKits(token),
    ]);
    if (a.success && a.data?.assets) setAssets(a.data.assets as Asset[]);
    if (k.success && k.data?.kits) setKits(k.data.kits as Kit[]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (open) {
      void load();
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

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
          <label className="text-[10px] uppercase text-muted-foreground">Files</label>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading library…</p>
          ) : assets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No files in Media Library. Ask an admin to upload brochures.
            </p>
          ) : (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border">
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
            Caption (supports {"{{CustomerName}}"}, {"{{SalesExecutive}}"})
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            className="mm-input w-full text-sm mt-1 resize-y"
          />
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
