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
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <h1 className="mm-page-title mb-1">Notes</h1>
      <p className="mm-secondary mb-4">
        Attach notes to contacts, deals, or meetings. Search by name — no internal IDs.
      </p>

      <div className="mm-filter-bar mb-4 flex-col sm:flex-row !items-stretch sm:!items-end gap-2.5">
        <div className="w-full sm:w-auto">
          <label className="mm-label">Attach Note To</label>
          <select
            value={entityType}
            onChange={(e) => handleEntityTypeChange(e.target.value as NoteEntityType)}
            className="mm-input w-full sm:w-auto min-w-[180px]"
            aria-label="Attach note to entity type"
          >
            <option value="contact">Contact</option>
            <option value="deal">Deal</option>
            <option value="meeting">Meeting</option>
          </select>
        </div>

        <div className="w-full flex-1 min-w-0">
          <label className="mm-label">
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

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a note..."
          rows={3}
          className="mm-input flex-1 focus-ring"
        />
        <div className="flex gap-2 sm:flex-col">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={isSubmitting || !content.trim() || !entityId}
            className={`mm-btn mm-btn-primary flex-1 sm:flex-none h-9 touch-manipulation ${isSubmitting ? "mm-btn-loading" : ""}`}
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
              className="mm-btn mm-btn-secondary h-9 touch-manipulation"
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
        <div className="space-y-2">
          {entityLabel ? (
            <p className="mm-secondary">
              Showing notes for <span className="text-foreground font-medium">{entityLabel}</span>
            </p>
          ) : null}
          {notes.map((n) => (
            <div
              key={n.id}
              className="mm-card p-3.5 text-[13px] whitespace-pre-wrap flex flex-col gap-2.5 sm:flex-row sm:justify-between"
            >
              <div className="min-w-0 break-words">
                <div>{n.content}</div>
                <div className="mm-secondary mt-1.5">
                  {n.createdAt
                    ? new Date(n.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : ""}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => startEdit(n)}
                  className="mm-btn mm-btn-secondary h-9 px-3 text-xs touch-manipulation"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteNote(n.id)}
                  className="mm-btn mm-btn-danger h-9 px-3 text-xs touch-manipulation"
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
