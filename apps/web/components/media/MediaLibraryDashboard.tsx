"use client";

/**
 * Enterprise Media Library UI — folders, search, favorites, recent, analytics,
 * quick actions, file details.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";
import { emitDataChanged, useDataVersion } from "@/lib/data-events";
import { SendMediaModal } from "@/components/media/SendMediaModal";

export type MediaAsset = {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  folderId: string | null;
  folderName?: string | null;
  captionDefault: string | null;
  tags?: string[];
  downloadCount?: number;
  whatsappSendCount?: number;
  emailSendCount?: number;
  createdByUserId: string;
  uploadedByName?: string | null;
  isFavorite?: boolean;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
};

type Folder = { id: string; name: string; assetCount: number };
type Stats = {
  totalFiles: number;
  storageBytes: number;
  storageUsedLabel: string;
  byKind: {
    brochures: number;
    images: number;
    videos: number;
    pdfs: number;
    documents: number;
  };
  recent: Array<{ id: string; name: string; kind: string; createdAt: string; sizeBytes: number }>;
  mostDownloaded: { id: string; name: string; count: number } | null;
  mostShared: { id: string; name: string; whatsapp: number; email: number } | null;
  totalWhatsAppShares: number;
  totalEmailShares: number;
};

const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const MEDIA_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.pdf,.mp4,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

function kindIcon(kind: string) {
  if (kind === "image") return "🖼️";
  if (kind === "video") return "🎬";
  if (kind === "pdf") return "📄";
  return "📎";
}

export function MediaLibraryDashboard() {
  const { token, role } = useAuth();
  const dataVersion = useDataVersion();
  const canManage = ["ceo", "owner", "business_admin", "admin", "super_admin"].includes(
    (role || "").toLowerCase()
  );

  const [folders, setFolders] = useState<Folder[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [folderId, setFolderId] = useState<string | "">("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [tab, setTab] = useState<"library" | "analytics" | "activity">("library");
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([]);
  const [sendContact, setSendContact] = useState<{
    id: string;
    name: string;
    phone?: string;
  } | null>(null);
  const [pickLeadOpen, setPickLeadOpen] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [leads, setLeads] = useState<Array<{ id: string; name: string; phone?: string }>>([]);
  const [pendingSendAssetIds, setPendingSendAssetIds] = useState<string[]>([]);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"detail" | "preview">("detail");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [f, a, s, act] = await Promise.all([
      api.listMediaFolders(token),
      api.listMediaAssets(token, {
        folderId: folderId || undefined,
        search: search.trim() || undefined,
        kind: kind || undefined,
        favorites: favoritesOnly || undefined,
        page,
        pageSize: 48,
      }),
      api.getMediaStats(token),
      api.listMediaActivity(token, { pageSize: 40 }),
    ]);
    if (f.success && f.data?.folders) setFolders(f.data.folders as Folder[]);
    if (a.success && a.data) {
      setAssets((a.data.assets || a.data.items || []) as MediaAsset[]);
      setTotal(a.data.total ?? 0);
      setTotalPages(a.data.totalPages ?? 1);
    }
    if (s.success && s.data) setStats(s.data as Stats);
    if (act.success && act.data?.items) setActivity(act.data.items);
    setLoading(false);
  }, [token, folderId, search, kind, favoritesOnly, page]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  useEffect(() => {
    setPage(1);
  }, [folderId, search, kind, favoritesOnly]);

  // Preview blob when detail + preview mode
  useEffect(() => {
    if (!detail || !token || previewMode !== "preview") {
      setPreviewBlobUrl(null);
      return;
    }
    let revoked: string | null = null;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/media/assets/${detail.id}/file`, {
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
  }, [detail, token, previewMode]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = "";
    if (file.size > MEDIA_MAX_BYTES) {
      toast.error("File size exceeds the 25 MB limit. Please upload a smaller file.");
      return;
    }
    setUploading(true);
    const res = await api.uploadMediaAsset(
      file,
      { folderId: folderId || undefined, name: file.name },
      token
    );
    setUploading(false);
    if (res.success) {
      toast.success("Uploaded");
      emitDataChanged({ module: "all", action: "create" });
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

  const openDetail = async (id: string, mode: "detail" | "preview" = "detail") => {
    if (!token) return;
    const res = await api.getMediaAsset(id, token);
    if (res.success && res.data?.asset) {
      setDetail(res.data.asset as MediaAsset);
      setPreviewMode(mode);
      setMenuId(null);
    } else {
      const local = assets.find((a) => a.id === id) || stats?.recent.find((r) => r.id === id);
      if (local) {
        setDetail(local as MediaAsset);
        setPreviewMode(mode);
      }
    }
  };

  const toggleFav = async (id: string) => {
    if (!token) return;
    const res = await api.toggleMediaFavorite(id, token);
    if (res.success) {
      toast.success(res.data?.favorited ? "Added to favorites" : "Removed from favorites");
      await load();
      if (detail?.id === id) {
        setDetail({ ...detail, isFavorite: !!res.data?.favorited });
      }
    } else toast.error(res.error || "Failed");
  };

  const removeAsset = async (id: string) => {
    if (!token || !confirm("Delete this file?")) return;
    const res = await api.deleteMediaAsset(id, token);
    if (res.success) {
      toast.success("Deleted");
      setDetail(null);
      emitDataChanged({ module: "all", action: "delete" });
      await load();
    } else toast.error(res.error || "Delete failed");
  };

  const renameAsset = async (id: string) => {
    if (!token) return;
    const current = assets.find((a) => a.id === id)?.name || detail?.name || "";
    const name = window.prompt("Rename file", current);
    if (!name?.trim()) return;
    const res = await api.renameMediaAsset(id, name.trim(), token);
    if (res.success) {
      toast.success("Renamed");
      await load();
      if (detail?.id === id) setDetail({ ...detail, name: name.trim() });
    } else toast.error(res.error || "Failed");
  };

  const moveAsset = async (id: string) => {
    if (!token) return;
    const target = moveFolderId || null;
    const res = await api.moveMediaAsset(id, target === "" ? null : target, token);
    if (res.success) {
      toast.success("Moved");
      setMoveFolderId("");
      await load();
    } else toast.error(res.error || "Failed");
  };

  const downloadAsset = async (a: MediaAsset) => {
    if (!token) return;
    try {
      await api.recordMediaDownload(a.id, token);
      const res = await fetch(
        `${API_BASE_URL}/media/assets/${a.id}/file?download=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.originalName || a.name;
      link.click();
      URL.revokeObjectURL(url);
      await load();
    } catch {
      toast.error("Download failed");
    }
  };

  const startWhatsAppSend = (ids: string[]) => {
    setPendingSendAssetIds(ids);
    setPickLeadOpen(true);
    setLeadSearch("");
  };

  const searchLeads = async () => {
    if (!token) return;
    const q = leadSearch.trim();
    const res = await api.getCrmContacts(
      `?type=lead&page=1&pageSize=20${q ? `&search=${encodeURIComponent(q)}` : ""}`,
      token
    );
    if (res.success) {
      const raw = res.data as { items?: Array<{ id: string; name: string; phone?: string }> };
      const items = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.items)
          ? raw.items
          : [];
      setLeads(
        items.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
        }))
      );
    }
  };

  useEffect(() => {
    if (pickLeadOpen) void searchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickLeadOpen]);

  const folderName = useMemo(
    () => folders.find((f) => f.id === folderId)?.name || "All files",
    [folders, folderId]
  );

  return (
    <div className="space-y-5">
      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: "Total files", value: stats.totalFiles.toLocaleString() },
            { label: "Storage", value: stats.storageUsedLabel },
            { label: "Images", value: String(stats.byKind.images) },
            { label: "PDFs", value: String(stats.byKind.pdfs) },
            { label: "Videos", value: String(stats.byKind.videos) },
            { label: "WhatsApp sends", value: stats.totalWhatsAppShares.toLocaleString() },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-border bg-card/50 px-3 py-2.5"
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {k.label}
              </div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-b border-border pb-2 flex-wrap">
        {(
          [
            ["library", "Library"],
            ["analytics", "Analytics"],
            ["activity", "Activity"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              tab === k ? "bg-primary text-primary-foreground" : "bg-white/5 border border-border"
            }`}
          >
            {label}
          </button>
        ))}
        {canManage && tab === "library" && (
          <label className="ml-auto inline-flex items-center justify-center min-h-9 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-medium cursor-pointer">
            {uploading ? "Uploading…" : "Upload file"}
            <input
              type="file"
              className="hidden"
              accept={MEDIA_ACCEPT}
              disabled={uploading}
              onChange={onUpload}
            />
          </label>
        )}
      </div>

      {tab === "library" && (
        <>
          {/* Recently uploaded */}
          {stats?.recent && stats.recent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2">Recently uploaded</h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {stats.recent.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void openDetail(r.id, "preview")}
                    className="shrink-0 w-44 rounded-xl border border-border bg-card/40 p-3 text-left hover:border-primary/50 transition-colors"
                  >
                    <div className="text-xl mb-1">{kindIcon(r.kind)}</div>
                    <div className="text-xs font-medium truncate" title={r.name}>
                      {r.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {relativeTime(r.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <aside className="lg:col-span-1 space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  setFolderId("");
                  setFavoritesOnly(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm border ${
                  !folderId && !favoritesOnly
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-white/5"
                }`}
              >
                All files
                {stats ? (
                  <span className="text-xs text-muted-foreground ml-1">({stats.totalFiles})</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFavoritesOnly(true);
                  setFolderId("");
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm border ${
                  favoritesOnly
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "border-border hover:bg-white/5"
                }`}
              >
                ⭐ Favorites
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFolderId(f.id);
                    setFavoritesOnly(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm border ${
                    folderId === f.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-white/5"
                  }`}
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">({f.assetCount})</span>
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
                  placeholder="Search name, folder, tags, uploader…"
                  className="mm-input max-w-sm text-sm min-h-9 flex-1"
                />
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="mm-input text-sm min-h-9 w-32"
                >
                  <option value="">All types</option>
                  <option value="image">Images</option>
                  <option value="pdf">PDF</option>
                  <option value="video">Videos</option>
                  <option value="document">Documents</option>
                </select>
                <span className="text-xs text-muted-foreground">
                  {favoritesOnly ? "Favorites" : folderName}
                  {total ? ` · ${total}` : ""}
                </span>
              </div>
              {canManage && (
                <p className="text-[11px] text-muted-foreground">
                  Supported: JPG, PNG, WebP, PDF, MP4, DOCX, PPTX, XLSX · Max 25 MB
                </p>
              )}

              {loading ? (
                <p className="text-muted-foreground text-sm py-10 text-center">Loading…</p>
              ) : assets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/30 py-14 px-6 text-center">
                  <div className="text-4xl mb-3">📁</div>
                  <p className="text-base font-medium">No files uploaded yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {favoritesOnly
                      ? "Star files to see them here."
                      : canManage
                        ? "Upload brochures, catalogs, and videos for your team."
                        : "Ask a Business Admin to upload company materials."}
                  </p>
                  {canManage && !favoritesOnly && (
                    <label className="inline-flex mt-5 min-h-11 px-5 items-center rounded-xl bg-primary text-primary-foreground text-sm font-semibold cursor-pointer">
                      {uploading ? "Uploading…" : "Upload Files"}
                      <input
                        type="file"
                        className="hidden"
                        accept={MEDIA_ACCEPT}
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
                      className="group relative rounded-xl border border-border bg-card/40 p-3 hover:border-primary/40 transition-colors"
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => void openDetail(a.id, "detail")}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-2xl">{kindIcon(a.kind)}</span>
                          {a.isFavorite && <span className="text-amber-400 text-sm">⭐</span>}
                        </div>
                        <div className="text-sm font-medium truncate mt-1" title={a.name}>
                          {a.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatBytes(a.sizeBytes)}
                          {a.folderName ? ` · ${a.folderName}` : ""}
                        </div>
                      </button>
                      {/* Quick actions */}
                      <div className="absolute top-2 right-2">
                        <button
                          type="button"
                          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded-lg bg-black/40 border border-white/10 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuId(menuId === a.id ? null : a.id);
                          }}
                          aria-label="Actions"
                        >
                          ⋮
                        </button>
                        {menuId === a.id && (
                          <div className="absolute right-0 top-7 z-20 w-48 rounded-xl border border-border bg-card shadow-xl py-1 text-xs">
                            <ActionItem
                              label="👁 Preview"
                              onClick={() => void openDetail(a.id, "preview")}
                            />
                            <ActionItem
                              label="📤 Send via WhatsApp"
                              onClick={() => startWhatsAppSend([a.id])}
                            />
                            <ActionItem
                              label="📧 Send via Email"
                              onClick={() =>
                                toast.message("Email send uses the same library — coming next", {
                                  description: "Use WhatsApp send or compose email from Leads for now.",
                                })
                              }
                            />
                            <ActionItem label="⬇ Download" onClick={() => void downloadAsset(a)} />
                            <ActionItem
                              label={a.isFavorite ? "⭐ Unfavorite" : "⭐ Add to Favorites"}
                              onClick={() => void toggleFav(a.id)}
                            />
                            {canManage && (
                              <>
                                <ActionItem label="✏ Rename" onClick={() => void renameAsset(a.id)} />
                                <div className="px-2 py-1 border-t border-border mt-1">
                                  <select
                                    className="mm-input w-full text-[11px] min-h-8"
                                    value={moveFolderId}
                                    onChange={(e) => setMoveFolderId(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value="">Move to…</option>
                                    <option value="">(Root)</option>
                                    {folders.map((f) => (
                                      <option key={f.id} value={f.id}>
                                        {f.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="mt-1 w-full text-left px-1 py-1 hover:bg-white/5 rounded"
                                    onClick={() => void moveAsset(a.id)}
                                  >
                                    📂 Move to Folder
                                  </button>
                                </div>
                                <ActionItem
                                  label="🗑 Delete"
                                  danger
                                  onClick={() => void removeAsset(a.id)}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex justify-between items-center text-sm pt-2">
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1 rounded-lg border border-border disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1 rounded-lg border border-border disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "analytics" && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border p-5 bg-card/40 space-y-3">
            <h3 className="font-semibold">Library overview</h3>
            <Row label="Total files" value={stats.totalFiles.toLocaleString()} />
            <Row label="Storage used" value={stats.storageUsedLabel} />
            <Row label="Images" value={String(stats.byKind.images)} />
            <Row label="PDFs / brochures" value={String(stats.byKind.pdfs)} />
            <Row label="Videos" value={String(stats.byKind.videos)} />
            <Row label="Documents" value={String(stats.byKind.documents)} />
          </div>
          <div className="rounded-2xl border border-border p-5 bg-card/40 space-y-3">
            <h3 className="font-semibold">Sharing & engagement</h3>
            <Row label="WhatsApp shares" value={stats.totalWhatsAppShares.toLocaleString()} />
            <Row label="Email shares" value={stats.totalEmailShares.toLocaleString()} />
            <Row
              label="Most downloaded"
              value={
                stats.mostDownloaded
                  ? `${stats.mostDownloaded.name} (${stats.mostDownloaded.count})`
                  : "—"
              }
            />
            <Row
              label="Most shared (WhatsApp)"
              value={
                stats.mostShared
                  ? `${stats.mostShared.name} (${stats.mostShared.whatsapp})`
                  : "—"
              }
            />
          </div>
          <div className="md:col-span-2 rounded-2xl border border-border p-5 bg-card/40">
            <h3 className="font-semibold mb-3">Recently uploaded</h3>
            <ul className="divide-y divide-border">
              {stats.recent.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full flex justify-between py-2 text-sm text-left hover:bg-white/5 px-1 rounded"
                    onClick={() => void openDetail(r.id, "preview")}
                  >
                    <span>
                      {kindIcon(r.kind)} {r.name}
                    </span>
                    <span className="text-muted-foreground text-xs">{relativeTime(r.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
                  <tr key={String(row.id)} className="border-b border-border/50">
                    <td className="px-3 py-2">{String(row.sentByName || "—")}</td>
                    <td className="px-3 py-2 font-medium">{String(row.assetName)}</td>
                    <td className="px-3 py-2">
                      {String(row.contactName || "—")}
                      <span className="block text-[11px] text-muted-foreground">
                        {String(row.toPhone || "")}
                      </span>
                    </td>
                    <td className="px-3 py-2 capitalize">{String(row.status)}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {row.createdAt
                        ? new Date(String(row.createdAt)).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* File details / preview panel */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto p-5">
            <div className="flex justify-between gap-2 mb-3">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">{detail.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {detail.mimeType} · {formatBytes(detail.sizeBytes)}
                </p>
              </div>
              <button type="button" className="text-sm shrink-0" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>

            <div className="flex gap-2 mb-4 flex-wrap">
              <button
                type="button"
                className={`px-2.5 py-1 text-xs rounded-lg border ${
                  previewMode === "detail" ? "border-primary bg-primary/10" : "border-border"
                }`}
                onClick={() => setPreviewMode("detail")}
              >
                Details
              </button>
              <button
                type="button"
                className={`px-2.5 py-1 text-xs rounded-lg border ${
                  previewMode === "preview" ? "border-primary bg-primary/10" : "border-border"
                }`}
                onClick={() => setPreviewMode("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                className="px-2.5 py-1 text-xs rounded-lg border border-border"
                onClick={() => void toggleFav(detail.id)}
              >
                {detail.isFavorite ? "⭐ Unfavorite" : "⭐ Favorite"}
              </button>
              <button
                type="button"
                className="px-2.5 py-1 text-xs rounded-lg border border-emerald-500/40 text-emerald-300"
                onClick={() => startWhatsAppSend([detail.id])}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className="px-2.5 py-1 text-xs rounded-lg border border-border"
                onClick={() => void downloadAsset(detail)}
              >
                Download
              </button>
            </div>

            {previewMode === "preview" ? (
              !previewBlobUrl ? (
                <p className="text-sm text-muted-foreground py-12 text-center">Loading preview…</p>
              ) : detail.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewBlobUrl}
                  alt={detail.name}
                  className="max-w-full rounded-lg mx-auto"
                />
              ) : detail.kind === "video" ? (
                <video src={previewBlobUrl} controls className="w-full rounded-lg" />
              ) : detail.kind === "pdf" ? (
                <iframe
                  src={previewBlobUrl}
                  className="w-full h-[65vh] rounded-lg bg-white"
                  title={detail.name}
                />
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Preview not available — use Download.
                </p>
              )
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label="File name" value={detail.name} />
                <Field label="File type" value={detail.kind} />
                <Field label="File size" value={formatBytes(detail.sizeBytes)} />
                <Field label="Folder" value={detail.folderName || "—"} />
                <Field label="Uploaded by" value={detail.uploadedByName || "—"} />
                <Field
                  label="Upload date"
                  value={new Date(detail.createdAt).toLocaleString()}
                />
                <Field
                  label="Last modified"
                  value={new Date(detail.updatedAt).toLocaleString()}
                />
                <Field label="Downloads" value={String(detail.downloadCount ?? 0)} />
                <Field label="WhatsApp sends" value={String(detail.whatsappSendCount ?? 0)} />
                <Field label="Email sends" value={String(detail.emailSendCount ?? 0)} />
                <Field
                  label="Tags"
                  value={(detail.tags || []).join(", ") || "—"}
                />
              </dl>
            )}
          </div>
        </div>
      )}

      {/* Pick lead for WhatsApp */}
      {pickLeadOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5">
            <h3 className="font-semibold mb-2">Send via WhatsApp</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Choose a lead/client with a phone number.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void searchLeads()}
                placeholder="Search leads…"
                className="mm-input flex-1 text-sm min-h-9"
              />
              <button
                type="button"
                onClick={() => void searchLeads()}
                className="px-3 rounded-lg border border-border text-sm"
              >
                Search
              </button>
            </div>
            <ul className="max-h-56 overflow-y-auto divide-y divide-border border border-border rounded-xl">
              {leads.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No leads found
                </li>
              ) : (
                leads.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                      onClick={() => {
                        setSendContact(l);
                        setPickLeadOpen(false);
                      }}
                    >
                      <span className="font-medium">{l.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {l.phone || "No phone"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              className="mt-3 w-full text-sm py-2 border border-border rounded-xl"
              onClick={() => setPickLeadOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {token && sendContact && (
        <SendMediaModal
          open={!!sendContact}
          onClose={() => {
            setSendContact(null);
            setPendingSendAssetIds([]);
          }}
          token={token}
          contactId={sendContact.id}
          contactName={sendContact.name}
          contactPhone={sendContact.phone}
          preselectedAssetIds={pendingSendAssetIds}
        />
      )}
    </div>
  );
}

function ActionItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`w-full text-left px-3 py-1.5 hover:bg-white/5 ${
        danger ? "text-red-400" : ""
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right truncate max-w-[60%]" title={value}>
        {value}
      </span>
    </div>
  );
}
