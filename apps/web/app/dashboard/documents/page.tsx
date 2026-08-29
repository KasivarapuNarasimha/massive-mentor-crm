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
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="mm-page-title">Documents</h1>
          <p className="mm-secondary mt-1">Attach files and links to entities.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="mm-btn mm-btn-primary w-full sm:w-auto h-9 touch-manipulation focus-ring"
        >
          + Add Document
        </button>
      </div>

      <ExportFiltersBar module="documents" token={token} className="mb-3" />

      {isLoading ? (
        <div className="h-40 mm-card animate-pulse" />
      ) : docs.length === 0 ? (
        <div className="mm-card mm-empty text-muted-foreground text-sm">No documents yet.</div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="mm-card p-3.5 sm:p-4 flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:items-start"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">{d.title}</div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-primary break-all">
                    {d.url}
                  </a>
                )}
                {d.entityType && (
                  <div className="mm-secondary mt-1">
                    <span className="mm-badge">{d.entityType}</span>
                    {d.entityId ? ` ${d.entityId}` : ""}
                  </div>
                )}
              </div>
              <div className="flex sm:flex-col items-center sm:items-end gap-2">
                <div className="mm-secondary">{new Date(d.createdAt).toLocaleDateString()}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(d)}
                    className="mm-btn mm-btn-secondary h-9 px-3 text-xs touch-manipulation"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(d.id, d.title)}
                    className="mm-btn mm-btn-danger h-9 px-3 text-xs touch-manipulation"
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
        <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="relative w-full bg-card border border-border shadow-lg rounded-t-xl sm:rounded-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden sm:max-w-3xl safe-bottom">
            <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-border">
              <h3 className="font-semibold text-base tracking-tight">
                {editingDoc ? "Edit Document" : "Add Document"}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">
              <form id="document-form" onSubmit={handleSubmit} className="adaptive-form">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div className="md:col-span-2">
                    <input
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="Document title *"
                      className="mm-input"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <input
                      value={formData.url}
                      onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                      placeholder="URL or link"
                      className="mm-input"
                    />
                  </div>
                  <select
                    value={formData.entityType}
                    onChange={(e) => setFormData({ ...formData, entityType: e.target.value })}
                    className="mm-input"
                  >
                    <option value="contact">contact</option>
                    <option value="deal">deal</option>
                    <option value="meeting">meeting</option>
                  </select>
                  <input
                    value={formData.entityId}
                    onChange={(e) => setFormData({ ...formData, entityId: e.target.value })}
                    placeholder="Entity ID"
                    className="mm-input"
                  />
                </div>
              </form>
            </div>
            <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 safe-bottom bg-background-secondary/60 flex gap-2">
              <button type="button" onClick={closeModal} className="mm-btn mm-btn-secondary flex-1 touch-manipulation">
                Cancel
              </button>
              <button
                type="submit"
                form="document-form"
                disabled={isSubmitting}
                className={`mm-btn mm-btn-primary flex-1 touch-manipulation focus-ring ${isSubmitting ? "mm-btn-loading" : ""}`}
              >
                {isSubmitting ? "Saving..." : editingDoc ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
