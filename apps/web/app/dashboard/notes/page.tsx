"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Note {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  createdAt: string;
}

export default function NotesPage() {
  const { token } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [entityType, setEntityType] = useState("contact");
  const [entityId, setEntityId] = useState("");
  const [content, setContent] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token || !entityId) {
      setNotes([]);
      return;
    }
    setIsLoading(true);
    const res = await api.getCrmNotes(`?entityType=${entityType}&entityId=${entityId}`, token);
    const data = res.data as { notes?: Note[] } | undefined;
    if (res.success && data?.notes) setNotes(data.notes);
    setIsLoading(false);
  }, [token, entityId, entityType]);

  useEffect(() => { if (entityId) load(); }, [load]);

  const handleCreate = async () => {
    if (!token || !content.trim() || !entityId) return;
    setIsSubmitting(true);
    let res;
    if (editingNoteId) {
      res = await api.updateCrmNote(editingNoteId, { entityType, entityId, content }, token);
    } else {
      res = await api.createCrmNote({ entityType, entityId, content }, token);
    }
    if (res.success) {
      toast.success(editingNoteId ? "Note updated" : "Note added");
      setContent("");
      setEditingNoteId(null);
      load();
    } else toast.error("Failed");
    setIsSubmitting(false);
  };

  const startEdit = (note: Note) => {
    setEditingNoteId(note.id);
    setEntityType(note.entityType);
    setEntityId(note.entityId);
    setContent(note.content);
  };

  const handleDeleteNote = async (id: string) => {
    if (!token) return;
    if (!confirm("Delete this note?")) return;
    const res = await api.deleteCrmNote(id, token);
    if (res.success) {
      toast.success("Note deleted");
      if (editingNoteId === id) {
        setEditingNoteId(null);
        setContent("");
      }
      load();
    } else toast.error("Failed");
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold mb-1">Notes</h1>
      <p className="text-muted-foreground mb-6 text-sm sm:text-base">Attach rich notes to contacts, deals, meetings.</p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="bg-background border border-border rounded-xl px-3 py-3 sm:py-2 text-base sm:text-sm min-h-11"
        >
          <option value="contact">Contact</option>
          <option value="deal">Deal</option>
          <option value="meeting">Meeting</option>
        </select>
        <input
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          placeholder="Entity ID"
          className="flex-1 bg-background border border-border rounded-xl px-4 py-3 sm:py-2 text-base sm:text-sm min-h-11"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a note..."
          className="flex-1 bg-background border border-border rounded-xl px-4 py-3 sm:py-2 text-base sm:text-sm min-h-11"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCreate}
            disabled={isSubmitting || !content.trim()}
            className="flex-1 sm:flex-none min-h-11 px-6 bg-primary text-primary-foreground rounded-xl touch-manipulation"
          >
            {editingNoteId ? "Update" : "Add"} Note
          </button>
          {editingNoteId && (
            <button
              type="button"
              onClick={() => {
                setEditingNoteId(null);
                setContent("");
              }}
              className="min-h-11 px-4 bg-white/10 rounded-xl touch-manipulation"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-20 bg-card rounded" />
      ) : notes.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">No notes for this entity.</div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div
              key={n.id}
              className="bg-card border border-border rounded-2xl p-4 text-sm whitespace-pre-wrap flex flex-col gap-3 sm:flex-row sm:justify-between"
            >
              <div className="min-w-0 break-words">{n.content}</div>
              <div className="flex gap-2 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => startEdit(n)}
                  className="min-h-10 px-3 py-2 bg-white/10 rounded-xl touch-manipulation"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(n.id)}
                  className="min-h-10 px-3 py-2 text-red-400 border border-red-900/40 rounded-xl touch-manipulation"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
