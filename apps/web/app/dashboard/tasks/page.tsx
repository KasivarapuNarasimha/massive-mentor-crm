"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { toIsoDateTime, toDateInputValue } from "@/lib/date-input";

interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: string;
  priority?: string;
  contactId?: string;
  dealId?: string;
  createdAt: string;
  updatedAt?: string;
}

export default function TasksPage() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formData, setFormData] = useState({ title: "", description: "", status: "todo", priority: "medium", dueDate: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = async () => {
    if (!token) return;
    setIsLoading(true);
    const res = await api.getCrmTasks("", token);
    const data = res.data as { tasks?: Task[] } | undefined;
    if (res.success && data?.tasks) setTasks(data.tasks);
    setIsLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const filtered = tasks.filter(t =>
    (!search || t.title.toLowerCase().includes(search.toLowerCase()))
  );

  const openCreate = () => {
    setEditingTask(null);
    setFormData({ title: "", description: "", status: "todo", priority: "medium", dueDate: "" });
    setShowModal(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority || "medium",
      dueDate: toDateInputValue(task.dueDate),
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !formData.title.trim()) {
      toast.error("Title is required");
      return;
    }

    let dueDateIso: string | null = null;
    if (formData.dueDate?.trim()) {
      dueDateIso = toIsoDateTime(formData.dueDate.trim());
      if (!dueDateIso) {
        toast.error("Invalid due date — use a valid date");
        return;
      }
    }

    setIsSubmitting(true);
    const payload: Record<string, unknown> = {
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      status: formData.status,
      priority: formData.priority || null,
      // Always ISO-8601 for API (never raw dd-mm-yyyy / bare yyyy-mm-dd)
      dueDate: dueDateIso,
    };
    let res;
    if (editingTask) {
      res = await api.updateCrmTask(editingTask.id, payload, token);
    } else {
      res = await api.createCrmTask(payload, token);
    }
    if (res.success) {
      toast.success(editingTask ? "Task updated" : "Task created");
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "task", action: editingTask ? "update" : "create" });
      emitDataChanged({ module: "notification", action: "create" });
      load();
    } else toast.error(res.error || "Failed");
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!token) return;
    if (!confirm(`Delete task "${title}"?`)) return;
    const res = await api.deleteCrmTask(id, token);
    if (res.success) {
      toast.success("Task deleted");
      load();
    } else toast.error(res.error || "Failed to delete");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold">Tasks</h1>
          <p className="text-muted-foreground text-sm sm:text-base mt-1">Track follow-ups and action items.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="w-full sm:w-auto min-h-11 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium touch-manipulation"
        >
          + New Task
        </button>
      </div>

      <ExportFiltersBar module="tasks" token={token} search={search} onSearchChange={setSearch} className="mb-4" />
      <input
        type="search"
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full bg-background border border-border rounded-xl px-4 py-3 sm:py-2.5 text-base sm:text-sm min-h-11"
      />

      {isLoading ? (
        <div className="h-40 bg-card rounded-2xl animate-pulse" />
      ) : filtered.length === 0 ? (
        <div className="text-center p-10 bg-card border border-border rounded-2xl">No tasks</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <div
              key={task.id}
              className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center"
            >
              <div className="min-w-0">
                <div className="font-medium text-foreground">{task.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {task.priority && `${task.priority}`}
                  {task.dueDate && ` · Due ${task.dueDate.split("T")[0]}`}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-3 py-1.5 bg-white/5 rounded-full">{task.status}</span>
                <button
                  type="button"
                  onClick={() => openEdit(task)}
                  className="min-h-10 px-3 py-2 text-xs bg-white/10 hover:bg-white/20 rounded-xl touch-manipulation"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(task.id, task.title)}
                  className="min-h-10 px-3 py-2 text-xs text-red-400 hover:bg-red-950/50 rounded-xl touch-manipulation"
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
          <div className="bg-card border border-border p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92dvh] overflow-y-auto safe-bottom">
            <h3 className="font-semibold mb-4 text-lg">{editingTask ? "Edit Task" : "New Task"}</h3>
            <form onSubmit={handleSubmit} className="space-y-4 adaptive-form">
              <input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Task title *"
                className="w-full bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
                required
              />
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Description"
                className="w-full bg-background border border-border rounded-xl p-3 h-24 text-base sm:text-sm"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs text-muted-foreground">
                  Due date
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    className="mt-1 w-full bg-background border border-border rounded-xl p-3 text-foreground text-base sm:text-sm min-h-11"
                  />
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
                >
                  <option value="todo">todo</option>
                  <option value="in_progress">in_progress</option>
                  <option value="done">done</option>
                </select>
              </div>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="w-full bg-background border border-border rounded-xl p-3 text-base sm:text-sm min-h-11"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
              <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 min-h-11 py-2.5 bg-white/10 rounded-xl touch-manipulation">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-11 py-2.5 bg-primary text-primary-foreground rounded-xl touch-manipulation"
                >
                  {isSubmitting ? "Saving..." : editingTask ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
