import { z } from "zod";
import {
  createContact,
  updateContact,
  deleteContact,
  getContactById,
  getContacts,
  createDeal,
  updateDeal,
  deleteDeal,
  createTask,
  updateTask,
  deleteTask,
  getTasks,
  createMeeting,
  createNote,
  generateWhatsAppMessage,
} from "../crm.service.js";
import {
  createInvoice,
  listInvoices,
  createPayment,
  createExpense,
} from "../finance.service.js";
import {
  createProduct,
  listProducts,
  listWarehouses,
} from "../erp-catalog.service.js";
import { applyStockMovement } from "../erp-stock.service.js";
import { listInventory } from "../erp-purchase.service.js";
import { parseMoneyToNumber, resolveDueDate, normalizeStatus } from "./i18n-normalize.js";
import {
  resolveContactRef,
  resolveMemberRef,
  resolveDealRef,
  resolveInvoiceRef,
  resolveProductRef,
} from "./entity-resolver.js";
import type { ActionDef } from "./types.js";

const softRefSchema = z.any().optional().nullable();

function money(v: unknown): number {
  const n = parseMoneyToNumber(v);
  if (n == null) throw new Error("Valid amount is required");
  return n;
}

export const ACTION_REGISTRY: Record<string, ActionDef<any>> = {
  search_contacts: {
    name: "search_contacts",
    description: "Search leads/clients by name, company, phone",
    category: "crm",
    risk: "low",
    modules: ["leads", "clients"],
    argsSchema: z.object({
      query: z.string().optional(),
      type: z.enum(["lead", "client"]).optional(),
      status: z.string().optional(),
    }),
    execute: async (ctx, args) => {
      const res = await getContacts(ctx.userId, {
        search: args.query,
        type: args.type,
        status: args.status,
        page: 1,
        pageSize: 20,
      });
      return {
        message: `Found ${res.total} contact(s)`,
        data: { total: res.total, items: res.items.slice(0, 10) },
        fields: res.items.slice(0, 5).map((c: any) => ({
          label: c.name || c.company || c.id,
          value: [c.type, c.status, c.phone].filter(Boolean).join(" · "),
        })),
        actions: [{ label: "Open Leads", href: "/dashboard/leads" }],
      };
    },
  },

  create_lead: {
    name: "create_lead",
    description: "Create a new lead with optional phone, status, company, assignee",
    category: "crm",
    risk: "low",
    modules: ["leads"],
    argsSchema: z.object({
      name: z.any().optional().nullable(),
      company: z.any().optional().nullable(),
      phone: z.any().optional().nullable(),
      email: z.any().optional().nullable(),
      status: z.any().optional().nullable(),
      assignee: softRefSchema,
      assignedTo: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      const asStr = (v: unknown) => {
        if (v == null) return "";
        if (typeof v === "string") return v.trim();
        if (typeof v === "object" && v && "query" in (v as object)) {
          return String((v as { query?: string }).query || "").trim();
        }
        return String(v).trim();
      };
      args = {
        ...args,
        name: asStr(args.name) || null,
        company: asStr(args.company) || null,
        phone: asStr(args.phone) || null,
        email: asStr(args.email) || null,
        status: asStr(args.status) || null,
      };
      const name = (args.name || args.company || "").trim();
      if (!name) {
        return {
          ok: false,
          status: "needs_input",
          message: "Lead name or company is required.",
          missingFields: ["name"],
        };
      }
      let assignedTo = args.assignedTo || null;
      if (args.assignee) {
        const m = await resolveMemberRef(ctx, args.assignee);
        if (!m.ok) {
          if (m.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: m.message, choices: m.choices };
          }
          return { ok: false, status: "needs_input", message: m.message, missingFields: ["assignee"] };
        }
        assignedTo = m.id;
      }
      return {
        ok: true,
        args: {
          ...args,
          name: args.name || args.company || name,
          company: args.company || args.name || null,
          status: normalizeStatus(args.status) || "new",
          assignedTo,
        },
      };
    },
    execute: async (ctx, args) => {
      const contact = await createContact(ctx.userId, {
        type: "lead",
        name: args.name,
        company: args.company,
        phone: args.phone,
        email: args.email,
        status: args.status || "new",
        assignedTo: args.assignedTo,
      });
      return {
        message: "Lead created successfully",
        entityType: "contact",
        entityId: contact.id,
        label: contact.name || contact.company || contact.id,
        href: "/dashboard/leads",
        fields: [
          { label: "Name", value: String(contact.name || "") },
          { label: "Company", value: String(contact.company || "") },
          { label: "Phone", value: String(contact.phone || "") },
          { label: "Status", value: String(contact.status || "") },
        ],
        actions: [
          { label: "Open Lead", href: "/dashboard/leads" },
          { label: "Create Follow-up", command: `Create a follow-up for ${contact.name || contact.company} tomorrow at 10 AM` },
        ],
        data: { contact },
      };
    },
    verify: async (ctx, args, result) => {
      if (!result.entityId) return { ok: false, message: "Missing lead id" };
      const c = await getContactById(ctx.userId, result.entityId);
      if (!c) return { ok: false, message: "Lead not found after create" };
      if (args.phone && c.phone && String(c.phone) !== String(args.phone)) {
        return { ok: false, message: "Phone mismatch after create" };
      }
      return { ok: true };
    },
  },

  create_client: {
    name: "create_client",
    description: "Create a client contact",
    category: "crm",
    risk: "low",
    modules: ["clients"],
    argsSchema: z.object({
      name: z.string().optional().nullable(),
      company: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
    }),
    resolveArgs: async (_ctx, args) => {
      if (!(args.name || args.company)) {
        return { ok: false, status: "needs_input", message: "Client name/company required", missingFields: ["name"] };
      }
      return {
        ok: true,
        args: { ...args, name: args.name || args.company, company: args.company || args.name },
      };
    },
    execute: async (ctx, args) => {
      const contact = await createContact(ctx.userId, {
        type: "client",
        name: args.name,
        company: args.company,
        phone: args.phone,
        email: args.email,
        status: "active",
      });
      return {
        message: "Client created successfully",
        entityType: "contact",
        entityId: contact.id,
        label: contact.name || contact.company || contact.id,
        href: "/dashboard/clients",
        actions: [{ label: "Open Clients", href: "/dashboard/clients" }],
      };
    },
  },

  update_contact: {
    name: "update_contact",
    description: "Update lead/client status, phone, assignment, etc.",
    category: "crm",
    risk: "low",
    modules: ["leads", "clients"],
    argsSchema: z.object({
      contact: softRefSchema,
      status: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
      name: z.string().optional().nullable(),
      company: z.string().optional().nullable(),
      assignee: softRefSchema,
      assignedTo: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      const c = await resolveContactRef(ctx, args.contact);
      if (!c.ok) {
        if (c.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
        }
        return { ok: false, status: "not_found", message: c.message };
      }
      let assignedTo = args.assignedTo;
      if (args.assignee) {
        const m = await resolveMemberRef(ctx, args.assignee);
        if (!m.ok) {
          if (m.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: m.message, choices: m.choices };
          }
          return { ok: false, status: "not_found", message: m.message };
        }
        assignedTo = m.id;
      }
      return {
        ok: true,
        args: {
          ...args,
          contact: { id: c.id },
          status: args.status != null ? normalizeStatus(args.status) : undefined,
          assignedTo,
          _label: c.label,
        },
      };
    },
    execute: async (ctx, args) => {
      const id = (args.contact as { id: string }).id;
      const { contact } = await updateContact(ctx.userId, id, {
        status: args.status || undefined,
        phone: args.phone || undefined,
        email: args.email || undefined,
        name: args.name || undefined,
        company: args.company || undefined,
        assignedTo: args.assignedTo !== undefined ? args.assignedTo : undefined,
      });
      return {
        message: "Contact updated",
        entityType: "contact",
        entityId: contact.id,
        label: contact.name || contact.company || contact.id,
        href: "/dashboard/leads",
        fields: [
          { label: "Status", value: String(contact.status || "") },
          { label: "Phone", value: String(contact.phone || "") },
        ],
        actions: [{ label: "Open Lead", href: "/dashboard/leads" }],
      };
    },
  },

  assign_contact: {
    name: "assign_contact",
    description: "Assign a lead/client to a team member",
    category: "crm",
    risk: "low",
    modules: ["leads", "clients"],
    argsSchema: z.object({ contact: softRefSchema, assignee: softRefSchema }),
    resolveArgs: async (ctx, args) => {
      const c = await resolveContactRef(ctx, args.contact);
      if (!c.ok) {
        if (c.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
        }
        return { ok: false, status: "not_found", message: c.message };
      }
      const m = await resolveMemberRef(ctx, args.assignee);
      if (!m.ok) {
        if (m.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: m.message, choices: m.choices };
        }
        return { ok: false, status: "not_found", message: m.message };
      }
      return { ok: true, args: { contact: { id: c.id }, assignee: { id: m.id }, _labels: { c: c.label, m: m.label } } };
    },
    execute: async (ctx, args) => {
      const id = (args.contact as { id: string }).id;
      const assigneeId = (args.assignee as { id: string }).id;
      const { contact } = await updateContact(ctx.userId, id, { assignedTo: assigneeId });
      return {
        message: `Assigned to ${(args as any)._labels?.m || "member"}`,
        entityType: "contact",
        entityId: contact.id,
        label: contact.name || contact.company || contact.id,
        href: "/dashboard/leads",
      };
    },
  },

  delete_contact: {
    name: "delete_contact",
    description: "Delete a lead/client (requires confirmation)",
    category: "crm",
    risk: "destructive",
    modules: ["leads", "clients"],
    roles: ["manager", "admin", "business_admin", "ceo", "owner", "sales_manager"],
    argsSchema: z.object({ contact: softRefSchema }),
    resolveArgs: async (ctx, args) => {
      const c = await resolveContactRef(ctx, args.contact);
      if (!c.ok) {
        if (c.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
        }
        return { ok: false, status: "not_found", message: c.message };
      }
      return { ok: true, args: { contact: { id: c.id }, _label: c.label } };
    },
    execute: async (ctx, args) => {
      const id = (args.contact as { id: string }).id;
      await deleteContact(ctx.userId, id);
      return {
        message: `Deleted ${(args as any)._label || "contact"}`,
        entityType: "contact",
        entityId: id,
      };
    },
  },

  create_deal: {
    name: "create_deal",
    description: "Create a deal linked to a contact with value and stage",
    category: "crm",
    risk: "low",
    modules: ["deals"],
    argsSchema: z.object({
      title: z.string().optional().nullable(),
      value: z.any().optional().nullable(),
      stage: z.string().optional().nullable(),
      contact: softRefSchema,
      expectedClose: softRefSchema,
    }),
    resolveArgs: async (ctx, args) => {
      let contactId: string | null = null;
      let contactLabel = "";
      if (args.contact) {
        const c = await resolveContactRef(ctx, args.contact);
        if (!c.ok) {
          if (c.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
          }
          return { ok: false, status: "not_found", message: c.message };
        }
        contactId = c.id;
        contactLabel = c.label;
      }
      const value = args.value != null && args.value !== "" ? money(args.value) : null;
      const title = (args.title || (contactLabel ? `${contactLabel} deal` : "")).trim();
      if (!title) {
        return { ok: false, status: "needs_input", message: "Deal title is required", missingFields: ["title"] };
      }
      return {
        ok: true,
        args: {
          ...args,
          title,
          value,
          stage: normalizeStatus(args.stage) || "qualification",
          contact: contactId ? { id: contactId } : null,
          expectedClose: resolveDueDate(args.expectedClose),
        },
      };
    },
    execute: async (ctx, args) => {
      const deal = await createDeal(ctx.userId, {
        title: args.title,
        value: args.value,
        stage: args.stage || "qualification",
        contactId: args.contact ? (args.contact as { id: string }).id : null,
        expectedClose: args.expectedClose,
      });
      return {
        message: "Deal created successfully",
        entityType: "deal",
        entityId: deal.id,
        label: deal.title,
        href: "/dashboard/deals",
        fields: [
          { label: "Title", value: deal.title },
          { label: "Value", value: deal.value != null ? String(deal.value) : "—" },
          { label: "Stage", value: String(deal.stage || "") },
        ],
        actions: [{ label: "Open Deal", href: "/dashboard/deals" }],
      };
    },
  },

  update_deal: {
    name: "update_deal",
    description: "Update deal value, stage, title",
    category: "crm",
    risk: "low",
    modules: ["deals"],
    argsSchema: z.object({
      deal: softRefSchema,
      title: z.string().optional().nullable(),
      value: z.any().optional().nullable(),
      stage: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      const d = await resolveDealRef(ctx, args.deal);
      if (!d.ok) {
        if (d.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: d.message, choices: d.choices };
        }
        return { ok: false, status: "not_found", message: d.message };
      }
      return {
        ok: true,
        args: {
          ...args,
          deal: { id: d.id },
          value: args.value != null && args.value !== "" ? money(args.value) : undefined,
          stage: args.stage != null ? normalizeStatus(args.stage) : undefined,
          _label: d.label,
        },
      };
    },
    execute: async (ctx, args) => {
      const id = (args.deal as { id: string }).id;
      const updated = (await updateDeal(ctx.userId, id, {
        title: args.title || undefined,
        value: args.value,
        stage: args.stage || undefined,
      })) as any;
      const deal = updated.deal || updated;
      return {
        message: "Deal updated",
        entityType: "deal",
        entityId: deal.id,
        label: deal.title,
        href: "/dashboard/deals",
        fields: [
          { label: "Value", value: deal.value != null ? String(deal.value) : "—" },
          { label: "Stage", value: String(deal.stage || "") },
        ],
        actions: [{ label: "Open Deal", href: "/dashboard/deals" }],
      };
    },
  },

  change_deal_stage: {
    name: "change_deal_stage",
    description: "Move a deal to a pipeline stage",
    category: "crm",
    risk: "low",
    modules: ["deals"],
    argsSchema: z.object({ deal: softRefSchema, stage: z.string() }),
    resolveArgs: async (ctx, args) => {
      const d = await resolveDealRef(ctx, args.deal);
      if (!d.ok) {
        if (d.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: d.message, choices: d.choices };
        }
        return { ok: false, status: "not_found", message: d.message };
      }
      const stage = normalizeStatus(args.stage);
      if (!stage) {
        return { ok: false, status: "needs_input", message: "Stage is required", missingFields: ["stage"] };
      }
      return { ok: true, args: { deal: { id: d.id }, stage, _label: d.label } };
    },
    execute: async (ctx, args) => {
      const updated = (await updateDeal(ctx.userId, (args.deal as { id: string }).id, {
        stage: args.stage,
      })) as any;
      const deal = updated.deal || updated;
      return {
        message: `Deal moved to ${args.stage}`,
        entityType: "deal",
        entityId: deal.id,
        label: deal.title,
        href: "/dashboard/deals",
        actions: [{ label: "Open Deal", href: "/dashboard/deals" }],
      };
    },
  },

  delete_deal: {
    name: "delete_deal",
    description: "Delete a deal (confirmation required)",
    category: "crm",
    risk: "destructive",
    modules: ["deals"],
    roles: ["manager", "admin", "business_admin", "ceo", "owner", "sales_manager"],
    argsSchema: z.object({ deal: softRefSchema }),
    resolveArgs: async (ctx, args) => {
      const d = await resolveDealRef(ctx, args.deal);
      if (!d.ok) {
        if (d.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: d.message, choices: d.choices };
        }
        return { ok: false, status: "not_found", message: d.message };
      }
      return { ok: true, args: { deal: { id: d.id }, _label: d.label } };
    },
    execute: async (ctx, args) => {
      await deleteDeal(ctx.userId, (args.deal as { id: string }).id);
      return { message: `Deleted deal ${(args as any)._label || ""}`, entityType: "deal", entityId: (args.deal as { id: string }).id };
    },
  },

  create_task: {
    name: "create_task",
    description: "Create a follow-up/task with due date linked to contact/deal",
    category: "crm",
    risk: "low",
    modules: ["tasks", "leads"],
    argsSchema: z.object({
      title: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
      due: z.any().optional().nullable(),
      dueDate: z.string().optional().nullable(),
      priority: z.string().optional().nullable(),
      contact: softRefSchema,
      deal: softRefSchema,
      status: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      let contactId: string | null = null;
      let contactLabel = "";
      if (args.contact) {
        const c = await resolveContactRef(ctx, args.contact);
        if (!c.ok) {
          if (c.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
          }
          return { ok: false, status: "not_found", message: c.message };
        }
        contactId = c.id;
        contactLabel = c.label;
      }
      let dealId: string | null = null;
      if (args.deal) {
        const d = await resolveDealRef(ctx, args.deal);
        if (!d.ok) {
          if (d.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: d.message, choices: d.choices };
          }
          return { ok: false, status: "not_found", message: d.message };
        }
        dealId = d.id;
      }
      const dueDate = resolveDueDate(args.due || args.dueDate) || args.dueDate || null;
      const title =
        (args.title || "").trim() ||
        (contactLabel ? `Follow up: ${contactLabel}` : "");
      if (!title) {
        return { ok: false, status: "needs_input", message: "Task title is required", missingFields: ["title"] };
      }
      return {
        ok: true,
        args: {
          ...args,
          title,
          dueDate,
          contact: contactId ? { id: contactId } : null,
          deal: dealId ? { id: dealId } : null,
          priority: args.priority || "medium",
          status: args.status || "todo",
        },
      };
    },
    execute: async (ctx, args) => {
      const task = await createTask(ctx.userId, {
        title: args.title,
        description: args.description,
        dueDate: args.dueDate,
        status: (args.status as "todo" | "in_progress" | "done") || "todo",
        priority: (args.priority as "low" | "medium" | "high") || "medium",
        contactId: args.contact ? (args.contact as { id: string }).id : null,
        dealId: args.deal ? (args.deal as { id: string }).id : null,
      });
      return {
        message: "Follow-up task created",
        entityType: "task",
        entityId: task.id,
        label: task.title,
        href: "/dashboard/tasks",
        fields: [
          { label: "Title", value: task.title },
          { label: "Due", value: task.dueDate ? new Date(task.dueDate).toLocaleString() : "—" },
          { label: "Status", value: task.status },
        ],
        actions: [{ label: "Open Task", href: "/dashboard/tasks" }],
      };
    },
    verify: async (ctx, _args, result) => {
      if (!result.entityId) return { ok: false, message: "Missing task id" };
      const listed = await getTasks(ctx.userId, { page: 1, pageSize: 50, sortBy: "createdAt", sortDir: "desc" });
      const found = listed.items.some((t) => t.id === result.entityId);
      return found ? { ok: true } : { ok: false, message: "Task not visible in list after create" };
    },
  },

  complete_task: {
    name: "complete_task",
    description: "Mark a task as done",
    category: "crm",
    risk: "low",
    modules: ["tasks"],
    argsSchema: z.object({ titleQuery: z.string().optional(), taskId: z.string().optional(), contact: softRefSchema }),
    resolveArgs: async (ctx, args) => {
      if (args.taskId) return { ok: true, args };
      const listed = await getTasks(ctx.userId, {
        search: args.titleQuery,
        page: 1,
        pageSize: 20,
        sortBy: "createdAt",
        sortDir: "desc",
      });
      let items = listed.items;
      if (args.contact) {
        const c = await resolveContactRef(ctx, args.contact);
        if (c.ok) items = items.filter((t) => t.contactId === c.id);
      }
      const open = items.filter((t) => t.status !== "done");
      if (open.length === 0) return { ok: false, status: "not_found", message: "No matching open task." };
      if (open.length > 1) {
        return {
          ok: false,
          status: "needs_choice",
          message: `I found ${open.length} tasks. Which one?`,
          choices: open.slice(0, 8).map((t) => ({
            id: t.id,
            label: t.title,
            sublabel: t.dueDate ? new Date(t.dueDate).toLocaleString() : t.status,
            field: "taskId",
          })),
        };
      }
      return { ok: true, args: { ...args, taskId: open[0].id } };
    },
    execute: async (ctx, args) => {
      const task = await updateTask(ctx.userId, args.taskId!, { status: "done" });
      return {
        message: "Task marked completed",
        entityType: "task",
        entityId: task.id,
        label: task.title,
        href: "/dashboard/tasks",
      };
    },
  },

  update_task: {
    name: "update_task",
    description: "Update task fields",
    category: "crm",
    risk: "low",
    modules: ["tasks"],
    argsSchema: z.object({
      taskId: z.string().optional(),
      titleQuery: z.string().optional(),
      title: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      due: z.any().optional(),
    }),
    resolveArgs: async (ctx, args) => {
      if (!args.taskId && args.titleQuery) {
        const listed = await getTasks(ctx.userId, { search: args.titleQuery, page: 1, pageSize: 10 });
        if (listed.items.length === 1) args = { ...args, taskId: listed.items[0].id };
        else if (listed.items.length > 1) {
          return {
            ok: false,
            status: "needs_choice",
            message: "Multiple tasks matched",
            choices: listed.items.map((t) => ({ id: t.id, label: t.title, field: "taskId" })),
          };
        } else return { ok: false, status: "not_found", message: "Task not found" };
      }
      if (!args.taskId) {
        return { ok: false, status: "needs_input", message: "Which task?", missingFields: ["taskId"] };
      }
      return {
        ok: true,
        args: { ...args, dueDate: resolveDueDate(args.due) || undefined },
      };
    },
    execute: async (ctx, args) => {
      const task = await updateTask(ctx.userId, args.taskId!, {
        title: args.title,
        status: args.status as any,
        priority: args.priority as any,
        dueDate: (args as any).dueDate,
      });
      return { message: "Task updated", entityType: "task", entityId: task.id, label: task.title, href: "/dashboard/tasks" };
    },
  },

  delete_task: {
    name: "delete_task",
    description: "Delete a task (confirmation required)",
    category: "crm",
    risk: "destructive",
    modules: ["tasks"],
    roles: ["manager", "admin", "business_admin", "ceo", "owner", "sales_manager", "sales_executive"],
    argsSchema: z.object({ taskId: z.string(), title: z.string().optional() }),
    execute: async (ctx, args) => {
      await deleteTask(ctx.userId, args.taskId);
      return { message: "Task deleted", entityType: "task", entityId: args.taskId };
    },
  },

  create_meeting: {
    name: "create_meeting",
    description: "Schedule a meeting with optional contact",
    category: "crm",
    risk: "low",
    modules: ["meetings", "leads"],
    argsSchema: z.object({
      title: z.string().optional().nullable(),
      when: z.any().optional(),
      scheduledAt: z.string().optional().nullable(),
      contact: softRefSchema,
      durationMin: z.number().optional().nullable(),
      notes: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      let contactId: string | null = null;
      let label = "";
      if (args.contact) {
        const c = await resolveContactRef(ctx, args.contact);
        if (!c.ok) {
          if (c.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
          }
          return { ok: false, status: "not_found", message: c.message };
        }
        contactId = c.id;
        label = c.label;
      }
      const scheduledAt = resolveDueDate(args.when || args.scheduledAt);
      if (!scheduledAt) {
        return { ok: false, status: "needs_input", message: "When should the meeting be?", missingFields: ["when"] };
      }
      const title = (args.title || (label ? `Meeting: ${label}` : "")).trim();
      if (!title) {
        return { ok: false, status: "needs_input", message: "Meeting title required", missingFields: ["title"] };
      }
      return {
        ok: true,
        args: { ...args, title, scheduledAt, contact: contactId ? { id: contactId } : null },
      };
    },
    execute: async (ctx, args) => {
      const meeting = await createMeeting(ctx.userId, {
        title: args.title,
        scheduledAt: args.scheduledAt!,
        contactId: args.contact ? (args.contact as { id: string }).id : null,
        durationMin: args.durationMin || 30,
        notes: args.notes,
      });
      return {
        message: "Meeting scheduled",
        entityType: "meeting",
        entityId: meeting.id,
        label: meeting.title,
        href: "/dashboard/meetings",
        actions: [{ label: "Open Meetings", href: "/dashboard/meetings" }],
      };
    },
  },

  create_note: {
    name: "create_note",
    description: "Add a note to a contact, deal, or meeting by name (never ask for Entity ID)",
    category: "crm",
    risk: "low",
    modules: ["notes", "leads", "clients", "deals", "meetings"],
    argsSchema: z.object({
      content: z.string().min(1),
      entityType: z.enum(["contact", "deal", "meeting"]).optional(),
      contact: softRefSchema,
      deal: softRefSchema,
      meeting: softRefSchema,
    }),
    resolveArgs: async (ctx, args) => {
      if (!args.content?.trim()) {
        return { ok: false, status: "needs_input", message: "Note content is required", missingFields: ["content"] };
      }
      let entityType = args.entityType || "contact";
      let entityId = "";
      let label = "";
      if (args.deal || entityType === "deal") {
        const d = await resolveDealRef(ctx, args.deal || args.contact);
        if (!d.ok) {
          if (d.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: d.message, choices: d.choices };
          }
          return { ok: false, status: "not_found", message: d.message };
        }
        entityType = "deal";
        entityId = d.id;
        label = d.label;
      } else {
        const c = await resolveContactRef(ctx, args.contact || args.deal);
        if (!c.ok) {
          if (c.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
          }
          return { ok: false, status: "not_found", message: c.message };
        }
        entityType = "contact";
        entityId = c.id;
        label = c.label;
      }
      return { ok: true, args: { ...args, entityType, entityId, _label: label } as any };
    },
    execute: async (ctx, args: any) => {
      const note = await createNote(ctx.userId, {
        entityType: args.entityType,
        entityId: args.entityId,
        content: args.content,
      });
      return {
        message: `Note added to ${args._label}`,
        entityType: "note",
        entityId: note.id,
        href: "/dashboard/notes",
        actions: [{ label: "Open Notes", href: "/dashboard/notes" }],
      };
    },
  },

  // —— Finance ——
  create_invoice: {
    name: "create_invoice",
    description: "Create an invoice for a client/contact with amount, description, GST taxRate, due date",
    category: "finance",
    risk: "low",
    modules: ["finance"],
    argsSchema: z.object({
      contact: softRefSchema,
      clientName: z.any().optional().nullable(),
      amount: z.any(),
      description: z.any().optional().nullable(),
      taxRate: z.any().optional().nullable(),
      gst: z.any().optional().nullable(),
      due: z.any().optional().nullable(),
      dueDate: z.any().optional().nullable(),
      dueInDays: z.any().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      const asStr = (v: unknown) => {
        if (v == null) return "";
        if (typeof v === "string") return v.trim();
        if (typeof v === "object" && v && "query" in (v as object)) {
          return String((v as { query?: string }).query || "").trim();
        }
        return String(v).trim();
      };
      const description = asStr(args.description);
      const clientNameRaw = asStr(args.clientName);
      const dueInDays =
        args.dueInDays != null && args.dueInDays !== ""
          ? Number(args.dueInDays)
          : null;
      const missing: string[] = [];
      if (args.amount == null || args.amount === "") missing.push("amount");
      if (!description) missing.push("description");
      if (!args.due && !args.dueDate && (dueInDays == null || Number.isNaN(dueInDays))) {
        missing.push("dueDate");
      }
      let contactId: string | null = null;
      let clientName = clientNameRaw || null;
      if (args.contact) {
        const c = await resolveContactRef(ctx, args.contact);
        if (!c.ok) {
          if (c.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
          }
          return { ok: false, status: "not_found", message: c.message };
        }
        contactId = c.id;
        clientName = clientName || c.label;
      }
      if (!contactId && !clientName) missing.push("client");
      if (missing.length) {
        return {
          ok: false,
          status: "needs_input",
          message: `To create the invoice I need: ${missing.join(", ")}`,
          missingFields: missing,
        };
      }
      const amount = money(args.amount);
      const taxRate =
        args.taxRate != null && args.taxRate !== ""
          ? Number(args.taxRate)
          : args.gst != null && args.gst !== ""
            ? Number(args.gst)
            : 0;
      let dueDate = resolveDueDate(args.due || args.dueDate);
      if (!dueDate && dueInDays != null && !Number.isNaN(dueInDays)) {
        dueDate = resolveDueDate({ days: dueInDays, time: "18:00" });
      }
      return {
        ok: true,
        args: {
          ...args,
          description,
          amount,
          taxRate: Number.isFinite(taxRate) ? taxRate : 0,
          dueDate,
          contactId,
          clientName,
        },
      };
    },
    execute: async (ctx, args: any) => {
      const invoice = await createInvoice(ctx.userId, {
        contactId: args.contactId,
        clientName: args.clientName,
        amount: args.amount,
        description: args.description,
        taxRate: args.taxRate || 0,
        dueDate: args.dueDate,
        status: "draft",
      });
      return {
        message: "Invoice created successfully",
        entityType: "invoice",
        entityId: invoice.id,
        label: invoice.number,
        href: "/dashboard/finance",
        fields: [
          { label: "Invoice", value: invoice.number },
          { label: "Client", value: String(invoice.clientName || "") },
          { label: "Amount", value: String(invoice.amount) },
          { label: "GST %", value: String(invoice.taxRate) },
          { label: "Total", value: String(invoice.total) },
          { label: "Due", value: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—" },
        ],
        actions: [{ label: "Open Invoice", href: "/dashboard/finance" }],
      };
    },
  },

  list_overdue_invoices: {
    name: "list_overdue_invoices",
    description: "List overdue invoices optionally filtered by minimum total amount",
    category: "finance",
    risk: "low",
    modules: ["finance"],
    argsSchema: z.object({ minTotal: z.any().optional().nullable() }),
    execute: async (ctx, args) => {
      const listed = await listInvoices(ctx.userId, { page: 1, pageSize: 100 });
      const now = Date.now();
      const minTotal = args.minTotal != null && args.minTotal !== "" ? money(args.minTotal) : 0;
      const overdue = listed.items.filter((inv: any) => {
        const due = inv.dueDate ? new Date(inv.dueDate).getTime() : 0;
        const status = String(inv.status || "");
        const total = Number(inv.total || 0);
        return due && due < now && status !== "paid" && status !== "cancelled" && total >= minTotal;
      });
      return {
        message: `Found ${overdue.length} overdue invoice(s)`,
        data: { items: overdue.slice(0, 20) },
        fields: overdue.slice(0, 8).map((inv: any) => ({
          label: inv.number,
          value: `${inv.clientName || ""} · ${inv.total} · due ${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : ""}`,
        })),
        actions: [{ label: "Open Finance", href: "/dashboard/finance" }],
      };
    },
  },

  record_payment: {
    name: "record_payment",
    description: "Record a payment from a client / against invoice",
    category: "finance",
    risk: "low",
    modules: ["finance"],
    argsSchema: z.object({
      amount: z.any(),
      contact: softRefSchema,
      invoice: softRefSchema,
      method: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      if (args.amount == null || args.amount === "") {
        return { ok: false, status: "needs_input", message: "Payment amount required", missingFields: ["amount"] };
      }
      let invoiceId: string | null = null;
      let contactId: string | null = null;
      if (args.invoice) {
        const inv = await resolveInvoiceRef(ctx, args.invoice);
        if (!inv.ok) {
          if (inv.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: inv.message, choices: inv.choices };
          }
          return { ok: false, status: "not_found", message: inv.message };
        }
        invoiceId = inv.id;
      }
      if (args.contact) {
        const c = await resolveContactRef(ctx, args.contact);
        if (!c.ok) {
          if (c.status === "needs_choice") {
            return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
          }
          return { ok: false, status: "not_found", message: c.message };
        }
        contactId = c.id;
      }
      return { ok: true, args: { ...args, amount: money(args.amount), invoiceId, contactId } };
    },
    execute: async (ctx, args: any) => {
      const payment = await createPayment(ctx.userId, {
        amount: args.amount,
        invoiceId: args.invoiceId || undefined,
        method: args.method || "other",
        notes: args.notes || (args.contactId ? `contact:${args.contactId}` : undefined),
      });
      return {
        message: "Payment recorded",
        entityType: "payment",
        entityId: payment.id,
        href: "/dashboard/finance",
        fields: [{ label: "Amount", value: String(payment.amount ?? args.amount) }],
        actions: [{ label: "Open Finance", href: "/dashboard/finance" }],
      };
    },
  },

  create_expense: {
    name: "create_expense",
    description: "Create an expense with amount and category/description",
    category: "finance",
    risk: "low",
    modules: ["finance"],
    argsSchema: z.object({
      amount: z.any(),
      category: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
    }),
    resolveArgs: async (_ctx, args) => {
      if (args.amount == null || args.amount === "") {
        return { ok: false, status: "needs_input", message: "Expense amount required", missingFields: ["amount"] };
      }
      return {
        ok: true,
        args: {
          ...args,
          amount: money(args.amount),
          description: args.description || args.category || "Expense",
          category: args.category || "general",
        },
      };
    },
    execute: async (ctx, args: any) => {
      const expense = await createExpense(ctx.userId, {
        title: String(args.description || args.category || "Expense"),
        amount: args.amount,
        category: args.category,
        notes: args.description,
      });
      return {
        message: "Expense created",
        entityType: "expense",
        entityId: expense.id,
        href: "/dashboard/finance",
        actions: [{ label: "Open Finance", href: "/dashboard/finance" }],
      };
    },
  },

  // —— ERP ——
  create_product: {
    name: "create_product",
    description: "Create a product with name, price, optional stock/sku",
    category: "erp",
    risk: "low",
    modules: ["erp", "erp_products"],
    argsSchema: z.object({
      name: z.string(),
      sku: z.string().optional().nullable(),
      sellingPrice: z.any().optional().nullable(),
      price: z.any().optional().nullable(),
      stock: z.any().optional().nullable(),
      reorderLevel: z.any().optional().nullable(),
    }),
    resolveArgs: async (_ctx, args) => {
      if (!args.name?.trim()) {
        return { ok: false, status: "needs_input", message: "Product name required", missingFields: ["name"] };
      }
      const sku =
        (args.sku || "").trim() ||
        `SKU-${args.name.replace(/\s+/g, "-").slice(0, 12).toUpperCase()}-${Date.now().toString(36).slice(-4)}`;
      const sellingPrice =
        args.sellingPrice != null
          ? money(args.sellingPrice)
          : args.price != null
            ? money(args.price)
            : undefined;
      return { ok: true, args: { ...args, sku, sellingPrice } };
    },
    execute: async (ctx, args: any) => {
      const created = (await createProduct(ctx.userId, {
        name: args.name,
        sku: args.sku,
        sellingPrice: args.sellingPrice,
        reorderLevel: args.reorderLevel != null ? Number(args.reorderLevel) : undefined,
        trackInventory: true,
      })) as any;
      const product = created.product || created;
      // optional opening stock
      if (args.stock != null && ctx.businessId) {
        const wh = await listWarehouses(ctx.userId);
        const warehouses = (wh as { warehouses?: Array<{ id: string }> }).warehouses || (Array.isArray(wh) ? wh : []);
        const first = warehouses[0] as { id: string } | undefined;
        if (first) {
          await applyStockMovement({
            businessId: ctx.businessId,
            productId: product.id,
            warehouseId: first.id,
            type: "opening",
            qty: Number(args.stock),
            createdByUserId: ctx.userId,
          });
        }
      }
      return {
        message: "Product created",
        entityType: "product",
        entityId: product.id,
        label: product.name,
        href: "/dashboard/erp/products",
        actions: [{ label: "Open Products", href: "/dashboard/erp/products" }],
      };
    },
  },

  adjust_stock: {
    name: "adjust_stock",
    description: "Increase or decrease product stock quantity",
    category: "erp",
    risk: "high",
    modules: ["erp", "erp_inventory"],
    argsSchema: z.object({
      product: softRefSchema,
      qty: z.any(),
      note: z.string().optional().nullable(),
    }),
    resolveArgs: async (ctx, args) => {
      const p = await resolveProductRef(ctx, args.product);
      if (!p.ok) {
        if (p.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: p.message, choices: p.choices };
        }
        return { ok: false, status: "not_found", message: p.message };
      }
      if (args.qty == null || args.qty === "") {
        return { ok: false, status: "needs_input", message: "Quantity required", missingFields: ["qty"] };
      }
      return { ok: true, args: { ...args, productId: p.id, qty: Number(args.qty), _label: p.label } };
    },
    execute: async (ctx, args: any) => {
      if (!ctx.businessId) throw new Error("Workspace required");
      const wh = await listWarehouses(ctx.userId);
      const warehouses = (wh as { warehouses?: Array<{ id: string }> }).warehouses || (Array.isArray(wh) ? wh : []);
      const first = warehouses[0] as { id: string } | undefined;
      if (!first) throw new Error("No warehouse available — create a warehouse first");
      await applyStockMovement({
        businessId: ctx.businessId,
        productId: args.productId,
        warehouseId: first.id,
        type: "adjustment",
        qty: args.qty,
        notes: args.note || null,
        createdByUserId: ctx.userId,
      });
      return {
        message: `Stock adjusted for ${args._label} by ${args.qty}`,
        entityType: "product",
        entityId: args.productId,
        href: "/dashboard/erp/inventory",
        actions: [{ label: "Open Inventory", href: "/dashboard/erp/inventory" }],
      };
    },
  },

  list_low_stock: {
    name: "list_low_stock",
    description: "Show products at or below reorder level",
    category: "erp",
    risk: "low",
    modules: ["erp", "erp_inventory"],
    argsSchema: z.object({}),
    execute: async (ctx) => {
      const inv = await listInventory(ctx.userId, { lowStockOnly: true });
      const items = (inv as { balances?: unknown[] }).balances || (inv as { items?: unknown[] }).items || [];
      const rows = items as Array<{ product?: { name?: string; sku?: string }; qtyOnHand?: unknown; productId?: string }>;
      return {
        message: `Found ${rows.length} low-stock item(s)`,
        fields: rows.slice(0, 10).map((r) => ({
          label: r.product?.name || r.productId || "Product",
          value: `On hand: ${r.qtyOnHand}`,
        })),
        actions: [{ label: "Open Inventory", href: "/dashboard/erp/inventory" }],
      };
    },
  },

  search_products: {
    name: "search_products",
    description: "Search products by name or SKU",
    category: "erp",
    risk: "low",
    modules: ["erp", "erp_products"],
    argsSchema: z.object({ query: z.string().optional() }),
    execute: async (ctx, args) => {
      const res = await listProducts(ctx.userId, { search: args.query });
      const products = res.products || [];
      return {
        message: `Found ${products.length} product(s)`,
        fields: products.slice(0, 10).map((p: any) => ({
          label: p.name,
          value: [p.sku, p.sellingPrice != null ? String(p.sellingPrice) : ""].filter(Boolean).join(" · "),
        })),
        actions: [{ label: "Open Products", href: "/dashboard/erp/products" }],
      };
    },
  },

  draft_whatsapp: {
    name: "draft_whatsapp",
    description: "Draft a WhatsApp message for a contact using AI",
    category: "comms",
    risk: "low",
    modules: ["whatsapp", "leads", "ai_sales"],
    argsSchema: z.object({ contact: softRefSchema, topic: z.string().optional().nullable() }),
    resolveArgs: async (ctx, args) => {
      const c = await resolveContactRef(ctx, args.contact);
      if (!c.ok) {
        if (c.status === "needs_choice") {
          return { ok: false, status: "needs_choice", message: c.message, choices: c.choices };
        }
        return { ok: false, status: "not_found", message: c.message };
      }
      return { ok: true, args: { ...args, contactId: c.id, _label: c.label } };
    },
    execute: async (ctx, args: any) => {
      let message = "";
      try {
        const out = await generateWhatsAppMessage(ctx.userId, args.contactId, "Professional", "auto");
        message = out?.message || "";
      } catch {
        message = `Hi, this is a follow-up regarding ${args._label}. ${args.topic || "Looking forward to connecting."}`;
      }
      return {
        message: "WhatsApp draft ready",
        fields: [{ label: "To", value: args._label }, { label: "Draft", value: String(message).slice(0, 400) }],
        actions: [
          { label: "Open WhatsApp AI", href: "/dashboard/ai-sales" },
          { label: "Open WhatsApp Inbox", href: "/dashboard/whatsapp" },
        ],
        data: { draft: message },
      };
    },
  },

  priority_focus_today: {
    name: "priority_focus_today",
    description: "Analyze CRM+ERP data and list priority actions for today",
    category: "insights",
    risk: "low",
    modules: ["dashboard", "leads", "finance", "erp"],
    argsSchema: z.object({}),
    execute: async (ctx) => {
      const { buildPriorityFocus } = await import("./insights.js");
      return buildPriorityFocus(ctx);
    },
  },
};

export function listActionCatalog(): Array<{ name: string; description: string; category: string }> {
  return Object.values(ACTION_REGISTRY).map((a) => ({
    name: a.name,
    description: a.description,
    category: a.category,
  }));
}
