"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/user-messages";
import type { NoteEntityType } from "@/components/crm/EntitySearchSelect";

type Note = {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  createdAt: string;
};

type Props = {
  entityType: NoteEntityType;
  entityId: string;
  /** Compact styling for embedding inside edit modals */
  compact?: boolean;
  className?: string;
  title?: string;
};

export function NotesPanel({
  entityType,
  entityId,
  compact = false,
  className = "",
  title = "Notes",
}: Props) {
  const { token } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token || !entityId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getCrmNotes(
        `?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        token
      );
      const data = res.data as { notes?: Note[] } | undefined;
      if (res.success && Array.isArray(data?.notes)) {
        setNotes(data.notes);
      } else if (!res.success) {
        setNotes([]);
        toast.error(friendlyError(res.error, "Could not load notes."));
      }
    } catch {
      setNotes([]);
    }
    setLoading(false);
  }, [token, entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!token || !entityId) return;
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error("Please enter a note");
      return;
    }
    setSubmitting(true);
    try {
      let res;
      if (editingId) {
        res = await api.updateCrmNote(
          editingId,
          { entityType, entityId, content: trimmed },
          token
        );
      } else {
        res = await api.createCrmNote(
          { entityType, entityId, content: trimmed },
          token
        );
      }
      if (res.success) {
        toast.success(editingId ? "Note updated" : "Note added");
        setContent("");
        setEditingId(null);
        await load();
      } else {
        toast.error(friendlyError(res.error, "Could not save note. Please try again."));
      }
    } catch {
      toast.error("Could not save note. Please try again.");
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    if (!confirm("Delete this note?")) return;
    const res = await api.deleteCrmNote(id, token);
    if (res.success) {
      toast.success("Note deleted");
      if (editingId === id) {
        setEditingId(null);
        setContent("");
      }
      await load();
    } else {
      toast.error(friendlyError(res.error, "Could not delete note."));
    }
  };

  if (!entityId) return null;

  return (
    <div
      className={`rounded-xl border border-border bg-background/40 ${compact ? "p-3" : "p-4"} ${className}`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className={`font-medium ${compact ? "text-sm" : "text-base"}`}>{title}</h4>
        {loading ? (
          <span className="text-[11px] text-muted-foreground">Loading…</span>
        ) : (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {notes.length} note{notes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"} mb-3`}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a note..."
          rows={compact ? 2 : 3}
          className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm min-h-[2.75rem] focus-ring"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={submitting || !content.trim()}
            className="min-h-10 px-4 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 touch-manipulation"
          >
            {submitting ? "Saving…" : editingId ? "Update Note" : "Add Note"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setContent("");
              }}
              className="min-h-10 px-3 bg-white/10 rounded-xl text-sm touch-manipulation"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {notes.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground py-2">No notes attached yet.</p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-sm"
            >
              <div className="whitespace-pre-wrap break-words text-foreground">{n.content}</div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {n.createdAt
                    ? new Date(n.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : ""}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="text-[11px] px-2 py-1 rounded-md bg-white/10 hover:bg-white/20"
                    onClick={() => {
                      setEditingId(n.id);
                      setContent(n.content);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-[11px] px-2 py-1 rounded-md text-red-400 border border-red-900/40"
                    onClick={() => void handleDelete(n.id)}
                  >
                    Del
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
