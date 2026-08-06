"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  assetCount: number;
};

type Asset = {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  folderId: string | null;
  captionDefault: string | null;
  previewUrl: string;
};

type Kit = {
  id: string;
  name: string;
  description: string | null;
  captionTemplate: string | null;
  items: Array<{ assetId: string; asset: Asset }>;
};

type Activity = {
  id: string;
  assetName: string;
  sentByName: string | null;
  contactName: string | null;
  toPhone: string | null;
  status: string;
  createdAt: string;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaLibraryPage() {
  const { token, role } = useAuth();
  const canManage = ["ceo", "owner", "business_admin", "admin", "super_admin"].includes(
    (role || "").toLowerCase()
  );

  const [folders, setFolders] = useState<Folder[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kits, setKits] = useState<Kit[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [folderId, setFolderId] = useState<string | "">("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kitName, setKitName] = useState("");
  const [tab, setTab] = useState<"files" | "kits" | "activity">("files");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [f, a, k, act] = await Promise.all([
      api.listMediaFolders(token),
      api.listMediaAssets(token, {
        folderId: folderId || undefined,
        search: search.trim() || undefined,
      }),
      api.listMediaKits(token),
      api.listMediaActivity(token, { pageSize: 40 }),
    ]);
    if (f.success && f.data?.folders) setFolders(f.data.folders as Folder[]);
    if (a.success && a.data?.assets) setAssets(a.data.assets as Asset[]);
    if (k.success && k.data?.kits) setKits(k.data.kits as Kit[]);
    if (act.success && act.data?.items) setActivity(act.data.items as Activity[]);
    setLoading(false);
  }, [token, folderId, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const authPreviewUrl = useCallback(
    (assetId: string) => {
      // Browser <img>/<iframe> cannot set Authorization — use fetch blob later for preview modal
      return `${API_BASE_URL}/media/assets/${assetId}/file`;
    },
    []
  );

  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview || !token) {
      setPreviewBlobUrl(null);
      return;
    }
    let revoked: string | null = null;
    (async () => {
      try {
        const res = await fetch(authPreviewUrl(preview.id), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revoked = url;
        setPreviewBlobUrl(url);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [preview, token, authPreviewUrl]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    const res = await api.uploadMediaAsset(
      file,
      { folderId: folderId || undefined, name: file.name },
      token
    );
    setUploading(false);
    e.target.value = "";
    if (res.success) {
      toast.success("Uploaded");
      await load();
    } else toast.error(res.error || "Upload failed");
  };

  const createFolder = async () => {
    if (!token || !newFolder.trim()) return;
    const res = await api.createMediaFolder({ name: newFolder.trim() }, token);
    if (res.success) {
      toast.success("Folder created");
      setNewFolder("");
      await load();
    } else toast.error(res.error || "Failed");
  };

  const removeAsset = async (id: string) => {
    if (!token || !confirm("Delete this file from the library?")) return;
    const res = await api.deleteMediaAsset(id, token);
    if (res.success) {
      toast.success("Deleted");
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      await load();
    } else toast.error(res.error || "Delete failed");
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const saveKit = async () => {
    if (!token || !kitName.trim() || selected.size === 0) {
      toast.error("Name the kit and select files");
      return;
    }
    const res = await api.createMediaKit(
      {
        name: kitName.trim(),
        assetIds: [...selected],
        captionTemplate:
          "Hello {{CustomerName}},\n\nThank you for your interest. Please find our materials attached.\n\nRegards,\n{{SalesExecutive}}",
      },
      token
    );
    if (res.success) {
      toast.success("Kit saved");
      setKitName("");
      setSelected(new Set());
      setTab("kits");
      await load();
    } else toast.error(res.error || "Failed");
  };

  const folderName = useMemo(
    () => folders.find((f) => f.id === folderId)?.name || "All files",
    [folders, folderId]
  );

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Media Library</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Brochures, catalogs, images & videos — send to leads via WhatsApp.
          </p>
        </div>
        {canManage && (
          <label className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium cursor-pointer">
            {uploading ? "Uploading…" : "Upload file"}
            <input
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"
              disabled={uploading}
              onChange={onUpload}
            />
          </label>
        )}
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        {(["files", "kits", "activity"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-lg capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-white/5 border border-border"
            }`}
          >
            {t === "activity" ? "Media activity" : t}
          </button>
        ))}
      </div>

      {tab === "files" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <aside className="lg:col-span-1 space-y-2">
            <button
              type="button"
              onClick={() => setFolderId("")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm border ${
                !folderId ? "border-primary bg-primary/10" : "border-border hover:bg-white/5"
              }`}
            >
              All files
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFolderId(f.id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm border ${
                  folderId === f.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-white/5"
                }`}
              >
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{f.assetCount}</span>
              </button>
            ))}
            {canManage && (
              <div className="pt-2 flex gap-1">
                <input
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  placeholder="New folder"
                  className="mm-input flex-1 text-xs min-h-9"
                />
                <button
                  type="button"
                  onClick={() => void createFolder()}
                  className="px-2 rounded-lg bg-white/10 border border-border text-xs"
                >
                  Add
                </button>
              </div>
            )}
          </aside>

          <div className="lg:col-span-3 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files…"
                className="mm-input max-w-xs text-sm min-h-9"
              />
              <span className="text-xs text-muted-foreground">{folderName}</span>
              {selected.size > 0 && canManage && (
                <div className="flex gap-2 items-center ml-auto">
                  <input
                    value={kitName}
                    onChange={(e) => setKitName(e.target.value)}
                    placeholder="Kit name…"
                    className="mm-input text-sm min-h-9 w-40"
                  />
                  <button
                    type="button"
                    onClick={() => void saveKit()}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white"
                  >
                    Save kit ({selected.size})
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <p className="text-muted-foreground text-sm py-10 text-center">Loading…</p>
            ) : assets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/30 py-14 px-6 text-center">
                <div className="text-4xl mb-3" aria-hidden>
                  📁
                </div>
                <p className="text-base font-medium text-foreground">No media uploaded yet.</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                  {canManage
                    ? "Upload brochures, PDFs, images, price lists, and videos for your sales team to share on WhatsApp."
                    : "Ask a Business Admin to upload company brochures and catalogs. You can send them to leads once files are available."}
                </p>
                {canManage && (
                  <label className="inline-flex items-center justify-center mt-5 min-h-11 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:opacity-90">
                    {uploading ? "Uploading…" : "Upload Files"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"
                      disabled={uploading}
                      onChange={onUpload}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {assets.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-xl border p-3 bg-card/40 ${
                      selected.has(a.id) ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        className="mt-1"
                      />
                      <button
                        type="button"
                        className="flex-1 text-left min-w-0"
                        onClick={() => setPreview(a)}
                      >
                        <div className="text-2xl mb-1">
                          {a.kind === "image" ? "🖼️" : a.kind === "video" ? "🎬" : a.kind === "pdf" ? "📄" : "📎"}
                        </div>
                        <div className="text-sm font-medium truncate" title={a.name}>
                          {a.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {a.kind} · {formatBytes(a.sizeBytes)}
                        </div>
                      </button>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => void removeAsset(a.id)}
                        className="mt-2 text-[11px] text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "kits" && (
        <div className="space-y-3">
          {kits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No kits yet. Select files on the Files tab and save as a kit.
            </p>
          ) : (
            kits.map((k) => (
              <div key={k.id} className="rounded-xl border border-border p-4 bg-card/40">
                <div className="font-semibold">{k.name}</div>
                {k.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{k.description}</p>
                )}
                <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5">
                  {(k.items || []).map((i) => (
                    <li key={i.assetId}>{i.asset?.name || i.assetId}</li>
                  ))}
                </ul>
                {canManage && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-red-400"
                    onClick={async () => {
                      if (!token) return;
                      const res = await api.deleteMediaKit(k.id, token);
                      if (res.success) {
                        toast.success("Kit deleted");
                        await load();
                      } else toast.error(res.error || "Failed");
                    }}
                  >
                    Delete kit
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="px-3 py-2">Sent By</th>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {activity.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No media sends yet
                  </td>
                </tr>
              ) : (
                activity.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="px-3 py-2">{row.sentByName || "—"}</td>
                    <td className="px-3 py-2 font-medium">{row.assetName}</td>
                    <td className="px-3 py-2">
                      {row.contactName || "—"}
                      <span className="block text-[11px] text-muted-foreground">
                        {row.toPhone}
                      </span>
                    </td>
                    <td className="px-3 py-2 capitalize">
                      <span
                        className={
                          row.status === "failed"
                            ? "text-red-400"
                            : row.status === "read" || row.status === "delivered"
                              ? "text-emerald-400"
                              : "text-sky-300"
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90dvh] overflow-y-auto p-4">
            <div className="flex justify-between items-start gap-2 mb-3">
              <div>
                <h3 className="font-semibold">{preview.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {preview.mimeType} · {formatBytes(preview.sizeBytes)}
                </p>
              </div>
              <button type="button" className="text-sm" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            {!previewBlobUrl ? (
              <p className="text-sm text-muted-foreground py-12 text-center">Loading preview…</p>
            ) : preview.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewBlobUrl} alt={preview.name} className="max-w-full rounded-lg mx-auto" />
            ) : preview.kind === "video" ? (
              <video src={previewBlobUrl} controls className="w-full rounded-lg" />
            ) : preview.kind === "pdf" ? (
              <iframe src={previewBlobUrl} className="w-full h-[70vh] rounded-lg bg-white" title={preview.name} />
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Preview not available for this type. Download via API or open after download.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
