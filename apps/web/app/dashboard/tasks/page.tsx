"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { toIsoDateTime, toDateInputValue } from "@/lib/date-input";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageLoading } from "@/components/ui/PageLoading";
import { PaginationBar } from "@/components/ui/PaginationBar";
import { friendlyError, SuccessMsg } from "@/lib/user-messages";
import { useDataVersion } from "@/lib/data-events";

interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: string;
  priority?: string;
  contactId?: string | null;
  dealId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export default function TasksPage() {
  const { token } = useAuth();
  const dataVersion = useDataVersion("task");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!token) return;
      if (!opts?.silent) setIsLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        params.set("sortBy", "createdAt");
        params.set("sortDir", "desc");
        if (search.trim()) params.set("search", search.trim());
        const res = await api.getCrmTasks(`?${params.toString()}`, token);
        const data = res.data as
          | {
              tasks?: Task[];
              total?: number;
              page?: number;
              pageSize?: number;
              totalPages?: number;
            }
          | undefined;
        if (res.success && data) {
          setTasks(Array.isArray(data.tasks) ? data.tasks : []);
          setTotal(typeof data.total === "number" ? data.total : data.tasks?.length || 0);
          setTotalPages(
            typeof data.totalPages === "number"
              ? Math.max(1, data.totalPages)
              : 1
          );
        } else {
          setTasks([]);
          setTotal(0);
          setTotalPages(1);
          if (!opts?.silent) {
            toast.error(friendlyError(res.error, "Could not load tasks. Please try again."));
          }
        }
      } catch {
        setTasks([]);
        setTotal(0);
        if (!opts?.silent) toast.error("Could not load tasks. Please try again.");
      }
      if (!opts?.silent) setIsLoading(false);
    },
    [token, page, pageSize, search]
  );

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

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
      dueDate: dueDateIso,
    };
    let res;
    if (editingTask) {
      res = await api.updateCrmTask(editingTask.id, payload, token);
    } else {
      res = await api.createCrmTask(payload, token);
    }
    if (res.success) {
      toast.success(editingTask ? SuccessMsg.taskUpdated : SuccessMsg.taskCreated);
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "task", action: editingTask ? "update" : "create" });
      emitDataChanged({ module: "notification", action: "create" });
      await load({ silent: true });
    } else toast.error(friendlyError(res.error, "Could not save task. Please try again."));
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!token) return;
    if (!confirm(`Delete task "${title}"?`)) return;
    const res = await api.deleteCrmTask(id, token);
    if (res.success) {
      toast.success(SuccessMsg.taskDeleted);
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "task", action: "delete" });
      await load({ silent: true });
    } else toast.error(friendlyError(res.error, "Could not delete task. Please try again."));
  };

  const statusBadgeClass = (status: string) => {
    if (status === "done") return "mm-badge mm-badge-success capitalize";
    if (status === "in_progress") return "mm-badge mm-badge-warning capitalize";
    return "mm-badge capitalize";
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="mm-page-title">Tasks</h1>
          <p className="mm-secondary mt-1">
            Track follow-ups and action items. Newest first.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="mm-btn mm-btn-primary w-full sm:w-auto focus-ring"
        >
          + New Task
        </button>
      </div>

      <ExportFiltersBar module="tasks" token={token} search={search} onSearchChange={setSearch} className="mb-3" />
      <label className="sr-only" htmlFor="task-search">
        Search tasks
      </label>
      <input
        id="task-search"
        type="search"
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mm-input mb-3 focus-ring"
      />

      {isLoading ? (
        <PageLoading variant="cards" rows={5} label="Loading tasks" />
      ) : tasks.length === 0 ? (
        <EmptyState
          title={search.trim() ? "No matching tasks" : "No tasks yet"}
          description={
            search.trim()
              ? "Try adjusting your search."
              : "Create a task or schedule a follow-up from Leads — they will appear here."
          }
          action={
            !search.trim() ? (
              <button
                type="button"
                onClick={openCreate}
                className="mm-btn mm-btn-primary focus-ring"
              >
                Create Task
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="mm-card p-3.5 sm:p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground">{task.title}</div>
                  <div className="mm-secondary mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    {task.priority && <span className="capitalize">{task.priority}</span>}
                    {task.dueDate && (
                      <span>· Due {String(task.dueDate).split("T")[0]}</span>
                    )}
                    {task.contactId && (
                      <span>· Linked to lead/contact</span>
                    )}
                    {task.dealId && (
                      <span>· Linked to deal</span>
                    )}
                  </div>
                  {task.description ? (
                    <p className="mm-secondary mt-1 line-clamp-2">
                      {task.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={statusBadgeClass(task.status)}>
                    {task.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEdit(task)}
                    className="mm-btn mm-btn-secondary h-9 px-3 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(task.id, task.title)}
                    className="mm-btn mm-btn-danger h-9 px-3 text-xs"
                  >
                    Del
                  </button>
                </div>
              </div>
            ))}
          </div>
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border p-4 sm:p-5 rounded-t-xl sm:rounded-lg w-full sm:max-w-md max-h-[92dvh] overflow-y-auto safe-bottom shadow-lg">
            <h3 className="font-semibold mb-4 text-base tracking-tight">
              {editingTask ? "Edit Task" : "New Task"}
            </h3>
            {editingTask && (editingTask.contactId || editingTask.dealId) ? (
              <p className="mm-secondary mb-3">
                {editingTask.contactId ? "Linked to a lead/contact. " : ""}
                {editingTask.dealId ? "Linked to a deal." : ""}
              </p>
            ) : null}
            <form onSubmit={handleSubmit} className="space-y-3 adaptive-form">
              <label className="mm-label">
                <span className="mm-required">Title</span>
                <input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. Call client about proposal"
                  className="mt-1 mm-input focus-ring"
                  required
                  autoFocus
                />
              </label>
              <label className="mm-label">
                Description
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional notes"
                  className="mt-1 mm-input focus-ring min-h-24"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="mm-label">
                  Due date
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    className="mt-1 mm-input focus-ring"
                  />
                </label>
                <label className="mm-label">
                  Status
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    aria-label="Task status"
                    className="mt-1 mm-input"
                  >
                    <option value="todo">todo</option>
                    <option value="in_progress">in_progress</option>
                    <option value="done">done</option>
                  </select>
                </label>
              </div>
              <label className="mm-label">
                Priority
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="mt-1 mm-input"
                  aria-label="Priority"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="mm-btn mm-btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`mm-btn mm-btn-primary flex-1 focus-ring ${isSubmitting ? "mm-btn-loading" : ""}`}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? "Saving…" : editingTask ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
