"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLoading } from "@/components/ui/PageLoading";
import { friendlyError, SuccessMsg } from "@/lib/user-messages";
import { NotesPanel } from "@/components/crm/NotesPanel";
import {
  CustomFieldsFormSection,
  customFieldsFromRecord,
} from "@/components/custom-fields/CustomFieldsFormSection";

interface Meeting {
  id: string;
  title: string;
  scheduledAt: string;
  durationMin?: number;
  notes?: string;
  outcome?: string;
  customFields?: Record<string, unknown> | null;
}

export default function MeetingsPage() {
  const { token } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [formData, setFormData] = useState({ title: "", scheduledAt: "", durationMin: "", notes: "", outcome: "" });
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    const res = await api.getCrmMeetings("", token);
    const data = res.data as { meetings?: Meeting[] } | undefined;
    if (res.success && data?.meetings) setMeetings(data.meetings);
    setIsLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const toLocalDateTimeValue = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openCreate = () => {
    setEditingMeeting(null);
    // Default schedule: tomorrow 10:00 local (datetime-local format)
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const defaultWhen = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setFormData({ title: "", scheduledAt: defaultWhen, durationMin: "30", notes: "", outcome: "" });
    setCustomFields({});
    setShowModal(true);
  };

  const openEdit = (meeting: Meeting) => {
    setEditingMeeting(meeting);
    setFormData({
      title: meeting.title,
      scheduledAt: toLocalDateTimeValue(meeting.scheduledAt),
      durationMin: meeting.durationMin ? String(meeting.durationMin) : "",
      notes: meeting.notes || "",
      outcome: meeting.outcome || "",
    });
    setCustomFields(customFieldsFromRecord(meeting));
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingMeeting(null);
    setCustomFields({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !formData.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!formData.scheduledAt) {
      toast.error("Scheduled date is required");
      return;
    }
    setIsSubmitting(true);
    const when = new Date(formData.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      toast.error("Invalid scheduled date/time");
      setIsSubmitting(false);
      return;
    }
    const payload: Record<string, unknown> = {
      title: formData.title.trim(),
      scheduledAt: when.toISOString(),
      notes: formData.notes.trim() || null,
      outcome: formData.outcome.trim() || null,
      customFields,
    };
    if (formData.durationMin) payload.durationMin = parseInt(formData.durationMin);
    let res;
    if (editingMeeting) {
      res = await api.updateCrmMeeting(editingMeeting.id, payload, token);
    } else {
      res = await api.createCrmMeeting(payload, token);
    }
    if (res.success) {
      toast.success(editingMeeting ? SuccessMsg.meetingUpdated : SuccessMsg.meetingCreated);
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "meeting", action: editingMeeting ? "update" : "create" });
      emitDataChanged({ module: "notification", action: "create" });
      load();
    } else toast.error(friendlyError(res.error, "Could not save meeting. Please try again."));
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!token) return;
    if (!confirm(`Delete meeting "${title}"?`)) return;
    const res = await api.deleteCrmMeeting(id, token);
    if (res.success) {
      toast.success(SuccessMsg.meetingDeleted);
      load();
    } else toast.error(friendlyError(res.error, "Could not delete meeting. Please try again."));
  };

  const meetingCheck = async (meetingId: string, action: "check-in" | "check-out") => {
    if (!token) return;
    try {
      const { captureGps, toLocationBody } = await import("@/lib/location-client");
      const loc = await captureGps({ timeoutMs: 12000, force: true });
      if (loc.gpsDenied) toast.message("GPS denied — check-in uses city-level IP only");
      const res = await api.post(
        `/location/meetings/${meetingId}/${action}`,
        toLocationBody(loc),
        token
      );
      if (res.success) toast.success(action === "check-in" ? "Checked in" : "Checked out");
      else toast.error(res.error || "Failed");
    } catch {
      toast.error("Location check failed");
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="mm-page-title">Meetings</h1>
          <p className="mm-secondary mt-1">Schedule and log meetings with contacts.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="mm-btn mm-btn-primary w-full sm:w-auto focus-ring"
        >
          + Schedule Meeting
        </button>
      </div>

      <ExportFiltersBar module="meetings" token={token} className="mb-3" />

      {isLoading ? (
        <PageLoading variant="cards" rows={4} label="Loading meetings" />
      ) : meetings.length === 0 ? (
        <EmptyState
          title="No meetings scheduled"
          description="Schedule your first meeting with a lead or client."
          action={
            <button
              type="button"
              onClick={openCreate}
              className="mm-btn mm-btn-primary focus-ring"
            >
              Schedule Meeting
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => (
            <div
              key={m.id}
              className="mm-card p-3.5 sm:p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">{m.title}</div>
                <div className="mm-secondary mt-0.5">
                  {new Date(m.scheduledAt).toLocaleString()}
                  {m.durationMin ? ` (${m.durationMin}m)` : ""}
                </div>
                {m.outcome && (
                  <div className="mt-1">
                    <span className="mm-badge mm-badge-success">Outcome: {m.outcome}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-xs w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => meetingCheck(m.id, "check-in")}
                  className="mm-btn h-9 px-3 text-xs border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
                >
                  Check In
                </button>
                <button
                  type="button"
                  onClick={() => meetingCheck(m.id, "check-out")}
                  className="mm-btn h-9 px-3 text-xs border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60"
                >
                  Check Out
                </button>
                <a
                  href={`/dashboard/ai-sales?meetingId=${encodeURIComponent(m.id)}`}
                  className="mm-btn mm-btn-secondary h-9 px-3 text-xs inline-flex items-center justify-center text-center"
                >
                  AI Summary
                </a>
                <button
                  type="button"
                  onClick={() => openEdit(m)}
                  className="mm-btn mm-btn-secondary h-9 px-3 text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(m.id, m.title)}
                  className="mm-btn mm-btn-danger h-9 px-3 text-xs"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 dark:bg-black/60">
          <div className="relative w-full bg-card border border-border shadow-lg rounded-t-xl sm:rounded-lg max-h-[min(92dvh,100dvh)] sm:max-h-[85vh] flex flex-col overflow-hidden sm:max-w-3xl">
            <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-border">
              <h3 className="font-semibold text-base tracking-tight">
                {editingMeeting ? "Edit Meeting" : "Schedule Meeting"}
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">
              <form id="meeting-form" onSubmit={handleSubmit} className="adaptive-form space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div className="md:col-span-2">
                    <input
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="Meeting title *"
                      className="mm-input"
                      required
                    />
                  </div>
                  <label className="mm-label">
                    Date & time *
                    <input
                      type="datetime-local"
                      value={formData.scheduledAt}
                      onChange={(e) => setFormData({ ...formData, scheduledAt: e.target.value })}
                      className="mt-1 mm-input"
                      required
                    />
                  </label>
                  <label className="mm-label">
                    Duration (min)
                    <input
                      value={formData.durationMin}
                      onChange={(e) => setFormData({ ...formData, durationMin: e.target.value })}
                      placeholder="Duration min"
                      type="number"
                      className="mt-1 mm-input"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Notes"
                      className="mm-input min-h-20"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <input
                      value={formData.outcome}
                      onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
                      placeholder="Outcome"
                      className="mm-input"
                    />
                  </div>
                </div>
                <CustomFieldsFormSection
                  entity="meeting"
                  values={customFields}
                  onChange={setCustomFields}
                  disabled={isSubmitting}
                />
              </form>
              {editingMeeting?.id ? (
                <div className="mt-4 pt-4 border-t border-border">
                  <NotesPanel
                    entityType="meeting"
                    entityId={editingMeeting.id}
                    compact
                    title="Attached notes"
                  />
                </div>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-border px-4 sm:px-5 pt-3 modal-footer-safe bg-background-secondary/60 flex gap-2 relative z-10">
              <button type="button" onClick={closeModal} className="mm-btn mm-btn-secondary flex-1 touch-manipulation min-h-11">
                Cancel
              </button>
              <button
                type="submit"
                form="meeting-form"
                disabled={isSubmitting}
                className={`mm-btn mm-btn-primary flex-1 focus-ring touch-manipulation min-h-11 ${isSubmitting ? "mm-btn-loading" : ""}`}
              >
                {isSubmitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
