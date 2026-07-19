"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";

interface Meeting {
  id: string;
  title: string;
  scheduledAt: string;
  durationMin?: number;
  notes?: string;
  outcome?: string;
}

export default function MeetingsPage() {
  const { token } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [formData, setFormData] = useState({ title: "", scheduledAt: "", durationMin: "", notes: "", outcome: "" });
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
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingMeeting(null);
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
    };
    if (formData.durationMin) payload.durationMin = parseInt(formData.durationMin);
    let res;
    if (editingMeeting) {
      res = await api.updateCrmMeeting(editingMeeting.id, payload, token);
    } else {
      res = await api.createCrmMeeting(payload, token);
    }
    if (res.success) {
      toast.success(editingMeeting ? "Meeting updated" : "Meeting scheduled");
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "meeting", action: editingMeeting ? "update" : "create" });
      emitDataChanged({ module: "notification", action: "create" });
      load();
    } else toast.error(res.error || "Failed");
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!token) return;
    if (!confirm(`Delete meeting "${title}"?`)) return;
    const res = await api.deleteCrmMeeting(id, token);
    if (res.success) {
      toast.success("Meeting deleted");
      load();
    } else toast.error(res.error || "Failed");
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
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold">Meetings</h1>
          <p className="text-zinc-400 text-sm sm:text-base mt-1">Schedule and log meetings with contacts.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="w-full sm:w-auto min-h-11 px-5 py-2.5 bg-white text-zinc-950 rounded-xl font-medium touch-manipulation"
        >
          + Schedule Meeting
        </button>
      </div>

      <ExportFiltersBar module="meetings" token={token} className="mb-4" />

      {isLoading ? (
        <div className="h-40 bg-zinc-900 rounded-2xl animate-pulse" />
      ) : meetings.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">No meetings scheduled yet.</div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => (
            <div
              key={m.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start"
            >
              <div className="min-w-0">
                <div className="font-medium text-white">{m.title}</div>
                <div className="text-sm text-zinc-400 mt-0.5">
                  {new Date(m.scheduledAt).toLocaleString()}
                  {m.durationMin ? ` (${m.durationMin}m)` : ""}
                </div>
                {m.outcome && <div className="text-xs mt-1 text-emerald-400">Outcome: {m.outcome}</div>}
              </div>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-xs w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => meetingCheck(m.id, "check-in")}
                  className="min-h-10 px-3 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-xl touch-manipulation"
                >
                  Check In
                </button>
                <button
                  type="button"
                  onClick={() => meetingCheck(m.id, "check-out")}
                  className="min-h-10 px-3 py-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-xl touch-manipulation"
                >
                  Check Out
                </button>
                <a
                  href={`/dashboard/ai-sales?meetingId=${encodeURIComponent(m.id)}`}
                  className="min-h-10 px-3 py-2 bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded-xl touch-manipulation inline-flex items-center justify-center text-center"
                >
                  AI Summary
                </a>
                <button
                  type="button"
                  onClick={() => openEdit(m)}
                  className="min-h-10 px-3 py-2 bg-white/10 rounded-xl touch-manipulation"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(m.id, m.title)}
                  className="min-h-10 px-3 py-2 text-red-400 border border-red-900/40 rounded-xl touch-manipulation"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92dvh] overflow-y-auto safe-bottom">
            <h3 className="font-semibold mb-4 text-lg">{editingMeeting ? "Edit Meeting" : "Schedule Meeting"}</h3>
            <form onSubmit={handleSubmit} className="space-y-4 adaptive-form">
              <input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Meeting title *"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-base sm:text-sm min-h-11"
                required
              />
              <label className="block text-xs text-zinc-500">
                Date & time *
                <input
                  type="datetime-local"
                  value={formData.scheduledAt}
                  onChange={(e) => setFormData({ ...formData, scheduledAt: e.target.value })}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-white text-base sm:text-sm min-h-11"
                  required
                />
              </label>
              <input
                value={formData.durationMin}
                onChange={(e) => setFormData({ ...formData, durationMin: e.target.value })}
                placeholder="Duration min"
                type="number"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-base sm:text-sm min-h-11"
              />
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notes"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 h-20 text-base sm:text-sm"
              />
              <input
                value={formData.outcome}
                onChange={(e) => setFormData({ ...formData, outcome: e.target.value })}
                placeholder="Outcome"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-base sm:text-sm min-h-11"
              />
              <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 min-h-11 py-2.5 bg-white/10 rounded-xl touch-manipulation">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-11 py-2.5 bg-white text-zinc-950 rounded-xl touch-manipulation"
                >
                  {isSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
