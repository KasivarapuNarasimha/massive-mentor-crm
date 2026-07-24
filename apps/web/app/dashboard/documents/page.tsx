"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";

interface Document {
  id: string;
  title: string;
  url?: string;
  entityType?: string;
  entityId?: string;
  createdAt: string;
}

export default function DocumentsPage() {
  const { token } = useAuth();
  const [docs, setDocs] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [formData, setFormData] = useState({ title: "", url: "", entityType: "contact", entityId: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = async () => {
    if (!token) return;
    setIsLoading(true);
    const res = await api.getCrmDocuments("", token);
    const data = res.data as { documents?: Document[] } | undefined;
    if (res.success && data?.documents) setDocs(data.documents);
    setIsLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const openCreate = () => {
    setEditingDoc(null);
    setFormData({ title: "", url: "", entityType: "contact", entityId: "" });
    setShowModal(true);
  };

  const openEdit = (doc: Document) => {
    setEditingDoc(doc);
    setFormData({ title: doc.title, url: doc.url || "", entityType: doc.entityType || "contact", entityId: doc.entityId || "" });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingDoc(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !formData.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setIsSubmitting(true);
    const payload = { ...formData, url: formData.url || null, entityType: formData.entityType || null, entityId: formData.entityId || null };
    let res;
    if (editingDoc) {
      res = await api.updateCrmDocument(editingDoc.id, payload, token);
    } else {
      res = await api.createCrmDocument(payload, token);
    }
    if (res.success) {
      toast.success(editingDoc ? "Document updated" : "Document added");
      closeModal();
      load();
    } else toast.error("Failed");
    setIsSubmitting(false);
  };

  const handleDeleteDoc = async (id: string, title: string) => {
    if (!token) return;
    if (!confirm(`Delete document "${title}"?`)) return;
    const res = await api.deleteCrmDocument(id, token);
    if (res.success) {
      toast.success("Document deleted");
      load();
    } else toast.error("Failed");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold">Documents</h1>
          <p className="text-muted-foreground text-sm sm:text-base mt-1">Attach files and links to entities.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="w-full sm:w-auto min-h-11 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium touch-manipulation"
        >
          + Add Document
        </button>
      </div>

      <ExportFiltersBar module="documents" token={token} className="mb-4" />

      {isLoading ? (
        <div className="h-40 bg-card rounded-2xl animate-pulse" />
      ) : docs.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">No documents yet.</div>
      ) : (
        <div className="grid gap-3">
          {docs.map((d) => (
            <div
              key={d.id}
              className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start"
            >
              <div className="min-w-0">
                <div className="font-medium text-foreground">{d.title}</div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 break-all">
                    {d.url}
                  </a>
                )}
                {d.entityType && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {d.entityType}: {d.entityId}
                  </div>
                )}
              </div>
              <div className="flex sm:flex-col items-center sm:items-end gap-2 text-xs">
                <div className="text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(d)}
                    className="min-h-10 px-3 py-2 bg-white/10 rounded-xl touch-manipulation"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(d.id, d.title)}
                    className="min-h-10 px-3 py-2 text-red-400 border border-red-900/40 rounded-xl touch-manipulation"
                  >
                    Del
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92dvh] overflow-y-auto safe-bottom">
            <h3 className="font-semibold mb-4 text-lg">{editingDoc ? "Edit Document" : "Add Document"}</h3>
            <form onSubmit={handleSubmit} className="space-y-4 adaptive-form">
              <input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Document title *"
                className="w-full bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
                required
              />
              <input
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="URL or link"
                className="w-full bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={formData.entityType}
                  onChange={(e) => setFormData({ ...formData, entityType: e.target.value })}
                  className="bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
                >
                  <option value="contact">contact</option>
                  <option value="deal">deal</option>
                  <option value="meeting">meeting</option>
                </select>
                <input
                  value={formData.entityId}
                  onChange={(e) => setFormData({ ...formData, entityId: e.target.value })}
                  placeholder="Entity ID"
                  className="bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 min-h-11 py-2.5 bg-white/10 rounded-xl touch-manipulation">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-11 py-2.5 bg-primary text-primary-foreground rounded-xl touch-manipulation"
                >
                  {isSubmitting ? "Saving..." : editingDoc ? "Update" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
