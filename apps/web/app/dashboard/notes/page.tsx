"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLoading } from "@/components/ui/PageLoading";
import { friendlyError } from "@/lib/user-messages";
import {
  EntitySearchSelect,
  type NoteEntityType,
} from "@/components/crm/EntitySearchSelect";

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
  const [isLoading, setIsLoading] = useState(false);
  const [entityType, setEntityType] = useState<NoteEntityType>("contact");
  const [entityId, setEntityId] = useState("");
  const [entityLabel, setEntityLabel] = useState("");
  const [content, setContent] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token || !entityId) {
      setNotes([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.getCrmNotes(
        `?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        token
      );
      const data = res.data as { notes?: Note[] } | undefined;
      if (res.success && Array.isArray(data?.notes)) {
        setNotes(data.notes);
      } else {
        setNotes([]);
        if (!res.success) {
          toast.error(friendlyError(res.error, "Could not load notes."));
        }
      }
    } catch {
      setNotes([]);
      toast.error("Could not load notes. Please try again.");
    }
    setIsLoading(false);
  }, [token, entityId, entityType]);

  useEffect(() => {
    if (entityId) void load();
    else {
      setNotes([]);
      setIsLoading(false);
    }
  }, [load, entityId]);

  const handleEntityTypeChange = (next: NoteEntityType) => {
    setEntityType(next);
    setEntityId("");
    setEntityLabel("");
    setNotes([]);
    setEditingNoteId(null);
    setContent("");
  };

  const handleCreate = async () => {
    if (!token) return;
    if (!entityId) {
      toast.error("Please select a contact, deal, or meeting");
      return;
    }
    if (!content.trim()) {
      toast.error("Please enter a note");
      return;
    }
    setIsSubmitting(true);
    try {
      let res;
      if (editingNoteId) {
        res = await api.updateCrmNote(
          editingNoteId,
          { entityType, entityId, content: content.trim() },
          token
        );
      } else {
        res = await api.createCrmNote(
          { entityType, entityId, content: content.trim() },
          token
        );
      }
      if (res.success) {
        toast.success(editingNoteId ? "Note updated" : "Note added");
        setContent("");
        setEditingNoteId(null);
        await load();
      } else {
        toast.error(friendlyError(res.error, "Could not save note. Please try again."));
      }
    } catch {
      toast.error("Could not save note. Please try again.");
    }
    setIsSubmitting(false);
  };

  const startEdit = (note: Note) => {
    setEditingNoteId(note.id);
    setEntityType(
      note.entityType === "deal" || note.entityType === "meeting"
        ? note.entityType
        : "contact"
    );
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
      await load();
    } else {
      toast.error(friendlyError(res.error, "Could not delete note."));
    }
  };

  const typeLabel =
    entityType === "contact" ? "Contact" : entityType === "deal" ? "Deal" : "Meeting";

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold mb-1">Notes</h1>
      <p className="text-muted-foreground mb-6 text-sm sm:text-base">
        Attach notes to contacts, deals, or meetings. Search by name — no internal IDs.
      </p>

      <div className="space-y-3 mb-6">
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Attach Note To</label>
          <select
            value={entityType}
            onChange={(e) => handleEntityTypeChange(e.target.value as NoteEntityType)}
            className="w-full sm:w-auto min-w-[180px] bg-background border border-border rounded-xl px-3 py-3 sm:py-2 text-base sm:text-sm min-h-11"
            aria-label="Attach note to entity type"
          >
            <option value="contact">Contact</option>
            <option value="deal">Deal</option>
            <option value="meeting">Meeting</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">
            Select {typeLabel}
          </label>
          <EntitySearchSelect
            entityType={entityType}
            value={entityId}
            selectedLabel={entityLabel}
            onChange={(id, opt) => {
              setEntityId(id);
              setEntityLabel(opt?.label || "");
              setEditingNoteId(null);
              setContent("");
            }}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a note..."
          rows={3}
          className="flex-1 bg-background border border-border rounded-xl px-4 py-3 text-base sm:text-sm min-h-11 focus-ring"
        />
        <div className="flex gap-2 sm:flex-col">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={isSubmitting || !content.trim() || !entityId}
            className="flex-1 sm:flex-none min-h-11 px-6 bg-primary text-primary-foreground rounded-xl touch-manipulation disabled:opacity-50 font-medium"
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

      {!entityId ? (
        <EmptyState
          title="Select an entity"
          description={`Choose a ${typeLabel.toLowerCase()} above to view and add notes.`}
        />
      ) : isLoading ? (
        <PageLoading variant="cards" rows={3} label="Loading notes" />
      ) : notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          description={`No notes attached to this ${typeLabel.toLowerCase()}. Add one above.`}
        />
      ) : (
        <div className="space-y-3">
          {entityLabel ? (
            <p className="text-xs text-muted-foreground">
              Showing notes for <span className="text-foreground font-medium">{entityLabel}</span>
            </p>
          ) : null}
          {notes.map((n) => (
            <div
              key={n.id}
              className="bg-card border border-border rounded-2xl p-4 text-sm whitespace-pre-wrap flex flex-col gap-3 sm:flex-row sm:justify-between"
            >
              <div className="min-w-0 break-words">
                <div>{n.content}</div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  {n.createdAt
                    ? new Date(n.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : ""}
                </div>
              </div>
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
                  onClick={() => void handleDeleteNote(n.id)}
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
