import { Response } from "express";
import {
  getContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  getDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getNotes,
  createNote,
  updateNote,
  deleteNote,
  getDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  contactSchema,
  dealSchema,
  taskSchema,
  meetingSchema,
  noteSchema,
  documentSchema,
} from "../services/crm.service.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

// Safe query param extractor (handles string | string[] | ParsedQs)
function getQueryParam(req: AuthenticatedRequest, key: string): string | undefined {
  const val = req.query[key];
  if (val == null) return undefined;
  if (Array.isArray(val)) return val[0] ? String(val[0]) : undefined;
  if (typeof val === 'object') return undefined; // ParsedQs case
  return String(val);
}

// =====================
// Contacts (Leads + Clients)
// =====================

export async function listContacts(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const type = getQueryParam(req, "type") as "lead" | "client" | undefined;
    const status = getQueryParam(req, "status");
    const search = getQueryParam(req, "search");
    const limitRaw = getQueryParam(req, "limit");
    const pageRaw = getQueryParam(req, "page");
    const pageSizeRaw = getQueryParam(req, "pageSize");
    const sortBy = getQueryParam(req, "sortBy");
    const sortDir = getQueryParam(req, "sortDir") as "asc" | "desc" | undefined;
    const limit = limitRaw && /^\d+$/.test(limitRaw) ? parseInt(limitRaw, 10) : undefined;
    const page = pageRaw && /^\d+$/.test(pageRaw) ? parseInt(pageRaw, 10) : undefined;
    const pageSize = pageSizeRaw && /^\d+$/.test(pageSizeRaw) ? parseInt(pageSizeRaw, 10) : undefined;

    const result = await getContacts(req.user.id, {
      type,
      status,
      search,
      limit,
      page,
      pageSize,
      sortBy,
      sortDir,
    });

    // Backward-compatible shape: contacts array + pagination meta
    res.json({
      success: true,
      data: {
        contacts: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    console.error("List contacts error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch contacts" });
  }
}

export async function getContact(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const contact = await getContactById(req.user.id, id);

    if (!contact) {
      return res.status(404).json({ success: false, error: "Contact not found" });
    }

    res.json({ success: true, data: { contact } });
  } catch (error: unknown) {
    console.error("Get contact error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch contact" });
  }
}

export async function createContactHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    // Pass full body so template field keys reach FieldEngine (config-driven)
    const contact = await createContact(req.user.id, {
      ...(req.body as Record<string, unknown>),
      ...parsed.data,
    });
    res.status(201).json({ success: true, data: { contact } });
  } catch (error: unknown) {
    console.error("Create contact error:", error);
    const message = error instanceof Error ? error.message : "Failed to create contact";
    const status = message.includes("required") || message.includes("must be") ? 400 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

export async function updateContactHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = contactSchema.partial().safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const result = await updateContact(req.user.id, id, {
      ...(req.body as Record<string, unknown>),
      ...parsed.data,
    });
    res.json({
      success: true,
      data: {
        contact: result.contact,
        pipelineSync: result.pipelineSync ?? null,
      },
    });
  } catch (error: unknown) {
    console.error("Update contact error:", error);
    const message = error instanceof Error ? error.message : "Failed to update contact";
    const status = message.includes("not found")
      ? 404
      : message.includes("required") || message.includes("must be")
        ? 400
        : 500;
    res.status(status).json({ success: false, error: message });
  }
}

export async function deleteContactHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteContact(req.user.id, id);
    res.json({ success: true, data: { message: "Contact moved to trash" } });
  } catch (error: unknown) {
    console.error("Delete contact error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete contact";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

export async function bulkEditLeadsHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    const patch = (req.body?.patch || req.body?.fields || {}) as Record<string, unknown>;
    const {
      bulkEditLeads,
    } = await import("../services/crm.service.js");
    const data = await bulkEditLeads(req.user.id, ids, {
      status: typeof patch.status === "string" ? patch.status : undefined,
      assignedTo:
        patch.assignedTo === null
          ? null
          : typeof patch.assignedTo === "string"
            ? patch.assignedTo
            : undefined,
      source:
        patch.source === null ? null : typeof patch.source === "string" ? patch.source : undefined,
      priority:
        patch.priority === null
          ? null
          : typeof patch.priority === "string"
            ? patch.priority
            : undefined,
      company:
        patch.company === null
          ? null
          : typeof patch.company === "string"
            ? patch.company
            : undefined,
      tags: Array.isArray(patch.tags)
        ? (patch.tags as string[])
        : typeof patch.tags === "string"
          ? String(patch.tags)
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
      customFields:
        patch.customFields && typeof patch.customFields === "object"
          ? (patch.customFields as Record<string, unknown>)
          : undefined,
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bulk edit failed";
    const status = message.includes("permission") ? 403 : message.includes("Select") ? 400 : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** Allow large bulk ops (50k @ 1k batches) without socket idle timeout */
function extendBulkRequestTimeout(req: AuthenticatedRequest, res: Response, ms = 10 * 60 * 1000) {
  try {
    req.setTimeout(ms);
  } catch {
    /* ignore */
  }
  try {
    res.setTimeout(ms);
  } catch {
    /* ignore */
  }
}

export async function bulkDeleteLeadsHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    extendBulkRequestTimeout(req, res);
    const permanent = !!req.body?.permanent;
    const scope =
      req.body?.scope === "all_filtered" || req.body?.mode === "all_filtered"
        ? "all_filtered"
        : "ids";
    const { bulkSoftDeleteLeads, bulkSoftDeleteLeadsByFilter } = await import(
      "../services/crm.service.js"
    );

    if (scope === "all_filtered") {
      const data = await bulkSoftDeleteLeadsByFilter(
        req.user.id,
        {
          search: typeof req.body?.search === "string" ? req.body.search : undefined,
          status: typeof req.body?.status === "string" ? req.body.status : undefined,
        },
        { permanent }
      );
      return res.json({ success: true, data });
    }

    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    const data = await bulkSoftDeleteLeads(req.user.id, ids, { permanent });
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bulk delete failed";
    const status = message.includes("permission") ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** POST /api/leads/bulk-assign — single | all_members + selected | first_n | all_filtered */
export async function bulkAssignLeadsHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    extendBulkRequestTimeout(req, res);
    const rawScope = String(req.body?.scope || "ids").toLowerCase();
    const scope =
      rawScope === "first_n" || rawScope === "firstn" || rawScope === "first"
        ? "first_n"
        : rawScope === "all_filtered" || rawScope === "all"
          ? "all_filtered"
          : rawScope === "reassign"
            ? "reassign"
            : "ids";
    const rawMode = String(req.body?.assignMode || req.body?.mode || "single").toLowerCase();
    const mode =
      rawMode === "all_members" || rawMode === "all" || rawMode === "everyone"
        ? "all_members"
        : "single";
    const assignedTo = String(req.body?.assignedTo || req.body?.userId || "").trim();
    const limitRaw = req.body?.limit ?? req.body?.count ?? req.body?.firstN;
    const limit =
      limitRaw === undefined || limitRaw === null || limitRaw === ""
        ? undefined
        : Number(limitRaw);
    const dryRun = req.body?.dryRun === true || req.body?.preview === true;

    const { smartBulkAssignLeads } = await import("../services/lead-assignment.service.js");
    const data = await smartBulkAssignLeads(req.user.id, {
      mode,
      assignedTo: mode === "single" ? assignedTo : undefined,
      scope,
      ids: Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : undefined,
      limit,
      search: typeof req.body?.search === "string" ? req.body.search : undefined,
      status: typeof req.body?.status === "string" ? req.body.status : undefined,
      notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
      dryRun,
    });

    // Backward-compatible fields for older clients
    const primary = data.distribution[0];
    res.json({
      success: true,
      data: {
        ...data,
        assignedTo: primary?.userId || assignedTo || null,
        assigneeName:
          mode === "all_members"
            ? `All members (${data.distribution.length})`
            : primary?.name || primary?.email || null,
        ids: [],
        limit: scope === "first_n" ? data.requested : null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Bulk assign failed";
    const status = message.includes("permission") ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** GET /api/leads/assignable-members — active members for Assign To search */
export async function listAssignableMembersHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { listAssignableMembers } = await import("../services/lead-assignment.service.js");
    const members = await listAssignableMembers(req.user.id);
    res.json({ success: true, data: { members } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list members";
    const status = message.includes("permission") ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** GET /api/leads/assignments — history (admin) */
export async function listLeadAssignmentsHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 25;
    const { listAssignmentHistory } = await import("../services/lead-assignment.service.js");
    const data = await listAssignmentHistory(req.user.id, { page, pageSize });
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load history";
    const status = message.includes("Only") || message.includes("permission") ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** GET /api/leads/assignments/:id */
export async function getLeadAssignmentHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { getAssignmentDetail } = await import("../services/lead-assignment.service.js");
    const data = await getAssignmentDetail(req.user.id, id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load assignment";
    const status = message.includes("not found")
      ? 404
      : message.includes("Only") || message.includes("permission")
        ? 403
        : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** POST /api/leads/assignments/:id/move — edit assignment (move N leads A→B) */
export async function moveLeadAssignmentHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    extendBulkRequestTimeout(req, res);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { moveAssignmentLeads } = await import("../services/lead-assignment.service.js");
    const data = await moveAssignmentLeads(req.user.id, {
      batchId: id,
      fromUserId: String(req.body?.fromUserId || ""),
      toUserId: String(req.body?.toUserId || ""),
      count: Number(req.body?.count),
      notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Move failed";
    const status = message.includes("Only") || message.includes("permission") ? 403 : 400;
    res.status(status).json({ success: false, error: message });
  }
}

/** POST /api/crm/leads/send-email — compose & send via SMTP */
export async function sendLeadEmailHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const contactIds = Array.isArray(req.body?.contactIds)
      ? (req.body.contactIds as string[])
      : req.body?.contactId
        ? [String(req.body.contactId)]
        : [];
    const { sendLeadEmails } = await import("../services/crm.service.js");
    const data = await sendLeadEmails(req.user.id, {
      contactIds,
      to: typeof req.body?.to === "string" ? req.body.to : undefined,
      subject: String(req.body?.subject || ""),
      body: String(req.body?.body || req.body?.text || ""),
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    console.error("[crm] sendLeadEmail:", message);
    const status =
      /permission|not authenticated/i.test(message)
        ? 403
        : /SMTP|not configured|delivery/i.test(message)
          ? 503
          : 400;
    res.status(status).json({ success: false, error: message });
  }
}

export async function bulkRestoreLeadsHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    const { bulkRestoreLeads } = await import("../services/crm.service.js");
    const data = await bulkRestoreLeads(req.user.id, ids);
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Restore failed";
    res.status(message.includes("permission") ? 403 : 400).json({ success: false, error: message });
  }
}

// =====================
// Deals (Pipeline)
// =====================

export async function listDeals(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const result = await getDeals(req.user.id, {
      contactId: getQueryParam(req, "contactId"),
      stage: getQueryParam(req, "stage"),
      search: getQueryParam(req, "search"),
      page: getQueryParam(req, "page") ? parseInt(getQueryParam(req, "page")!, 10) : undefined,
      pageSize: getQueryParam(req, "pageSize")
        ? parseInt(getQueryParam(req, "pageSize")!, 10)
        : undefined,
      sortBy: getQueryParam(req, "sortBy"),
      sortDir: getQueryParam(req, "sortDir") as "asc" | "desc" | undefined,
    });

    res.json({
      success: true,
      data: {
        deals: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    console.error("List deals error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch deals" });
  }
}

export async function createDealHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = dealSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const deal = await createDeal(req.user.id, parsed.data);
    res.status(201).json({ success: true, data: { deal } });
  } catch (error: unknown) {
    console.error("Create deal error:", error);
    res.status(500).json({ success: false, error: "Failed to create deal" });
  }
}

export async function updateDealHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = dealSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const result = await updateDeal(req.user.id, id, parsed.data);
    res.json({
      success: true,
      data: {
        deal: result.deal,
        pipelineSync: result.pipelineSync ?? null,
      },
    });
  } catch (error: unknown) {
    console.error("Update deal error:", error);
    const message = error instanceof Error ? error.message : "Failed to update deal";
    res.status(500).json({ success: false, error: message });
  }
}

export async function deleteDealHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteDeal(req.user.id, id);
    res.json({ success: true, data: { message: "Deal deleted" } });
  } catch (error: unknown) {
    console.error("Delete deal error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete deal";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

// =====================
// Tasks
// =====================

export async function listTasks(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const result = await getTasks(req.user.id, {
      contactId: getQueryParam(req, "contactId"),
      dealId: getQueryParam(req, "dealId"),
      status: getQueryParam(req, "status"),
      search: getQueryParam(req, "search"),
      page: getQueryParam(req, "page") ? parseInt(getQueryParam(req, "page")!, 10) : undefined,
      pageSize: getQueryParam(req, "pageSize")
        ? parseInt(getQueryParam(req, "pageSize")!, 10)
        : undefined,
      sortBy: getQueryParam(req, "sortBy"),
      sortDir: getQueryParam(req, "sortDir") as "asc" | "desc" | undefined,
    });

    res.json({
      success: true,
      data: {
        tasks: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    console.error("List tasks error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch tasks" });
  }
}

export async function createTaskHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const task = await createTask(req.user.id, parsed.data);
    res.status(201).json({ success: true, data: { task } });
  } catch (error: unknown) {
    console.error("Create task error:", error);
    res.status(500).json({ success: false, error: "Failed to create task" });
  }
}

export async function updateTaskHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = taskSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const task = await updateTask(req.user.id, id, parsed.data);
    res.json({ success: true, data: { task } });
  } catch (error: unknown) {
    console.error("Update task error:", error);
    const message = error instanceof Error ? error.message : "Failed to update task";
    res.status(500).json({ success: false, error: message });
  }
}

export async function deleteTaskHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteTask(req.user.id, id);
    res.json({ success: true, data: { message: "Task deleted" } });
  } catch (error: unknown) {
    console.error("Delete task error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete task";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

// =====================
// Meetings
// =====================

export async function listMeetings(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const result = await getMeetings(req.user.id, {
      contactId: getQueryParam(req, "contactId"),
      dealId: getQueryParam(req, "dealId"),
      search: getQueryParam(req, "search"),
      page: getQueryParam(req, "page") ? parseInt(getQueryParam(req, "page")!, 10) : undefined,
      pageSize: getQueryParam(req, "pageSize")
        ? parseInt(getQueryParam(req, "pageSize")!, 10)
        : undefined,
      sortBy: getQueryParam(req, "sortBy"),
      sortDir: getQueryParam(req, "sortDir") as "asc" | "desc" | undefined,
    });

    res.json({
      success: true,
      data: {
        meetings: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    console.error("List meetings error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch meetings" });
  }
}

export async function createMeetingHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = meetingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const meeting = await createMeeting(req.user.id, parsed.data);
    res.status(201).json({ success: true, data: { meeting } });
  } catch (error: unknown) {
    console.error("Create meeting error:", error);
    res.status(500).json({ success: false, error: "Failed to create meeting" });
  }
}

export async function updateMeetingHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = meetingSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const meeting = await updateMeeting(req.user.id, id, parsed.data);
    res.json({ success: true, data: { meeting } });
  } catch (error: unknown) {
    console.error("Update meeting error:", error);
    const message = error instanceof Error ? error.message : "Failed to update meeting";
    res.status(500).json({ success: false, error: message });
  }
}

export async function deleteMeetingHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteMeeting(req.user.id, id);
    res.json({ success: true, data: { message: "Meeting deleted" } });
  } catch (error: unknown) {
    console.error("Delete meeting error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete meeting";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

// =====================
// Notes (polymorphic)
// =====================

export async function listNotes(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const entityType = getQueryParam(req, 'entityType');
    const entityId = getQueryParam(req, 'entityId');
    if (!entityType || !entityId) {
      return res.status(400).json({ success: false, error: "entityType and entityId are required" });
    }

    const notes = await getNotes(req.user.id, entityType, entityId);
    res.json({ success: true, data: { notes } });
  } catch (error: unknown) {
    console.error("List notes error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch notes" });
  }
}

export async function createNoteHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const note = await createNote(req.user.id, parsed.data);
    res.status(201).json({ success: true, data: { note } });
  } catch (error: unknown) {
    console.error("Create note error:", error);
    res.status(500).json({ success: false, error: "Failed to create note" });
  }
}

export async function updateNoteHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = noteSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const note = await updateNote(req.user.id, id, parsed.data);
    res.json({ success: true, data: { note } });
  } catch (error: unknown) {
    console.error("Update note error:", error);
    const message = error instanceof Error ? error.message : "Failed to update note";
    res.status(500).json({ success: false, error: message });
  }
}

export async function deleteNoteHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteNote(req.user.id, id);
    res.json({ success: true, data: { message: "Note deleted" } });
  } catch (error: unknown) {
    console.error("Delete note error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete note";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

// =====================
// Documents
// =====================

export async function listDocuments(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const result = await getDocuments(req.user.id, {
      entityType: getQueryParam(req, "entityType"),
      entityId: getQueryParam(req, "entityId"),
      search: getQueryParam(req, "search"),
      page: getQueryParam(req, "page") ? parseInt(getQueryParam(req, "page")!, 10) : undefined,
      pageSize: getQueryParam(req, "pageSize")
        ? parseInt(getQueryParam(req, "pageSize")!, 10)
        : undefined,
      sortBy: getQueryParam(req, "sortBy"),
      sortDir: getQueryParam(req, "sortDir") as "asc" | "desc" | undefined,
    });

    res.json({
      success: true,
      data: {
        documents: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    console.error("List documents error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch documents" });
  }
}

export async function createDocumentHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = documentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const document = await createDocument(req.user.id, parsed.data);
    res.status(201).json({ success: true, data: { document } });
  } catch (error: unknown) {
    console.error("Create document error:", error);
    res.status(500).json({ success: false, error: "Failed to create document" });
  }
}

export async function updateDocumentHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = documentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const document = await updateDocument(req.user.id, id, parsed.data);
    res.json({ success: true, data: { document } });
  } catch (error: unknown) {
    console.error("Update document error:", error);
    const message = error instanceof Error ? error.message : "Failed to update document";
    res.status(500).json({ success: false, error: message });
  }
}

export async function deleteDocumentHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteDocument(req.user.id, id);
    res.json({ success: true, data: { message: "Document deleted" } });
  } catch (error: unknown) {
    console.error("Delete document error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete document";
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, error: message });
  }
}

// =====================================================
// AI CRM & Sales Handlers (Batch 4)
// =====================================================

export async function aiLeadScore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ success: false, error: "contactId required" });

    const result = await (await import("../services/crm.service.js")).generateLeadScore(req.user.id, contactId);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    res.status(500).json({ success: false, error: msg });
  }
}

export async function aiFollowUpSuggestions(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ success: false, error: "contactId required" });

    const result = await (await import("../services/crm.service.js")).generateFollowUpSuggestions(req.user.id, contactId);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to generate suggestions" });
  }
}

export async function aiWhatsApp(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { contactId, tone, language } = req.body;
    if (!contactId) return res.status(400).json({ success: false, error: "contactId required" });

    const { generateWhatsAppMessage, logAiGeneration } = await import("../services/crm.service.js");

    const result = await generateWhatsAppMessage(
      req.user.id,
      contactId,
      tone || "Professional",
      language || "auto"
    );

    // Persist generation history
    if (result?.message) {
      await logAiGeneration(req.user.id, {
        contactId,
        feature: "whatsapp",
        tone: tone || "Professional",
        language: language || "auto",
        content: result.message,
      }).catch(() => {}); // non-blocking
    }

    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    res.status(500).json({ success: false, error: msg });
  }
}

export async function aiEmail(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { contactId, goal } = req.body;
    if (!contactId) return res.status(400).json({ success: false, error: "contactId required" });

    const result = await (await import("../services/crm.service.js")).generateEmail(req.user.id, contactId, goal);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed" });
  }
}

export async function aiProposal(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { dealId } = req.body;
    if (!dealId) return res.status(400).json({ success: false, error: "dealId required" });

    const result = await (await import("../services/crm.service.js")).generateProposal(req.user.id, dealId);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to generate proposal" });
  }
}

export async function aiSalesForecast(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const result = await (await import("../services/crm.service.js")).generateSalesForecast(req.user.id);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to forecast" });
  }
}

export async function aiNextBestAction(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { entityType, entityId } = req.body;
    if (!entityType || !entityId) return res.status(400).json({ success: false, error: "entityType and entityId required" });

    const result = await (await import("../services/crm.service.js")).generateNextBestAction(req.user.id, entityType, entityId);
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    res.status(500).json({ success: false, error: msg });
  }
}

export async function aiMeetingSummary(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { meetingId } = req.body;
    if (!meetingId || typeof meetingId !== "string") {
      return res.status(400).json({ success: false, error: "Select a meeting to summarize" });
    }

    const result = await (await import("../services/crm.service.js")).generateMeetingSummary(
      req.user.id,
      meetingId.trim()
    );
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[aiMeetingSummary]", error);
    const raw = error instanceof Error ? error.message : String(error);
    let userMsg = "Failed to generate meeting summary";
    let status = 500;

    if (/not found/i.test(raw)) {
      userMsg = "Meeting not found or you do not have access to it";
      status = 404;
    } else if (/not properly configured|API key|AI_PROVIDER|not-configured/i.test(raw)) {
      userMsg = "AI provider not configured — set a valid GROQ_API_KEY (or OpenAI key) in apps/api/.env and restart the API";
      status = 503;
    } else if (/rate limit|429/i.test(raw)) {
      userMsg = "AI rate limit reached — wait a moment and try again";
      status = 429;
    } else if (/timed out|timeout|ETIMEDOUT|ECONNRESET/i.test(raw)) {
      userMsg = "AI request timed out — try again";
      status = 504;
    } else if (/parse JSON|Invalid AI|json_object|must contain the word 'json'|invalid_request/i.test(raw)) {
      userMsg = "Invalid AI response format — please retry";
      status = 502;
    } else if (/Empty response/i.test(raw)) {
      userMsg = "AI returned an empty response — please retry";
      status = 502;
    } else if (process.env.NODE_ENV !== "production" && raw && raw.length < 280) {
      // Surface provider detail in development
      userMsg = raw.replace(/^400\s*/, "").replace(/^AIError:\s*/i, "") || userMsg;
    }

    res.status(status).json({ success: false, error: userMsg });
  }
}

export async function aiReminders(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const contactId =
      typeof req.body?.contactId === "string" && req.body.contactId.trim()
        ? req.body.contactId.trim()
        : undefined;
    const dealId =
      typeof req.body?.dealId === "string" && req.body.dealId.trim()
        ? req.body.dealId.trim()
        : undefined;
    const meetingId =
      typeof req.body?.meetingId === "string" && req.body.meetingId.trim()
        ? req.body.meetingId.trim()
        : undefined;

    if (!contactId && !dealId && !meetingId) {
      return res.status(400).json({
        success: false,
        error: "Select a contact, deal, or meeting to generate reminders",
      });
    }

    const result = await (await import("../services/crm.service.js")).generateReminders(req.user.id, {
      contactId,
      dealId,
      meetingId,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[aiReminders]", error);
    const raw = error instanceof Error ? error.message : String(error);
    let userMsg = "Failed to generate reminders";
    let status = 500;
    if (/not found/i.test(raw)) {
      userMsg = raw;
      status = 404;
    } else if (/Select a contact/i.test(raw)) {
      userMsg = raw;
      status = 400;
    } else if (/not properly configured|API key|AI_PROVIDER/i.test(raw)) {
      userMsg =
        "AI provider not configured — set a valid GROQ_API_KEY in apps/api/.env and restart the API";
      status = 503;
    } else if (/rate limit|429/i.test(raw)) {
      userMsg = "AI rate limit reached — wait a moment and try again";
      status = 429;
    } else if (/json|Invalid AI|parse/i.test(raw)) {
      userMsg = "Invalid AI response — please retry";
      status = 502;
    } else if (process.env.NODE_ENV !== "production" && raw.length < 280) {
      userMsg = raw;
    }
    res.status(status).json({ success: false, error: userMsg });
  }
}

export async function aiWhatsappHistory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const contactId = (req.query.contactId as string) || undefined;

    const { getAiGenerations } = await import("../services/crm.service.js");
    const history = await getAiGenerations(req.user.id, {
      contactId,
      feature: "whatsapp",
      limit: 30,
    });

    res.json({ success: true, data: history });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to load history" });
  }
}

// =====================
// AI Follow-up Engine
// =====================

export async function aiFollowupEngineList(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const force = String(req.query.force || "") === "1" || String(req.query.force || "") === "true";
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 40;
    const contactId = req.query.contactId ? String(req.query.contactId) : undefined;
    const { listFollowupRecommendations } = await import("../services/followup-engine.service.js");
    const items = await listFollowupRecommendations(req.user.id, {
      limit: Number.isFinite(limit) ? limit : 40,
      contactId,
      forceRefresh: force,
    });
    res.json({ success: true, data: { items, count: items.length } });
  } catch (error: unknown) {
    console.error("[aiFollowupEngineList]", error);
    const msg = error instanceof Error ? error.message : "Failed to load AI follow-ups";
    res.status(500).json({ success: false, error: msg });
  }
}

export async function aiFollowupEngineSummary(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { getTodayAiActionsSummary } = await import("../services/followup-engine.service.js");
    const data = await getTodayAiActionsSummary(req.user.id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    console.error("[aiFollowupEngineSummary]", error);
    res.status(500).json({ success: false, error: "Failed to load AI actions summary" });
  }
}

export async function aiFollowupEngineContact(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const contactId = String(req.params.id || "");
    if (!contactId) return res.status(400).json({ success: false, error: "contact id required" });
    const force = String(req.query.force || "") === "1";
    const { getContactFollowupRecommendation } = await import("../services/followup-engine.service.js");
    const data = await getContactFollowupRecommendation(req.user.id, contactId, {
      forceRefresh: force,
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    console.error("[aiFollowupEngineContact]", error);
    res.status(500).json({ success: false, error: "Failed to load recommendation" });
  }
}

export async function aiFollowupEngineRefresh(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { refreshFollowupEngine } = await import("../services/followup-engine.service.js");
    const result = await refreshFollowupEngine(req.user.id, { force: true });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[aiFollowupEngineRefresh]", error);
    res.status(500).json({ success: false, error: "Failed to refresh engine" });
  }
}

export async function aiFollowupEngineAct(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = String(req.params.id || "");
    const { actionTaken, notes } = req.body as { actionTaken?: string; notes?: string };
    if (!id || !actionTaken) {
      return res.status(400).json({ success: false, error: "id and actionTaken required" });
    }
    const { completeRecommendation } = await import("../services/followup-engine.service.js");
    const result = await completeRecommendation(req.user.id, id, actionTaken, notes);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    res.status(msg.includes("not found") ? 404 : 500).json({ success: false, error: msg });
  }
}

export async function aiFollowupEngineMap(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ids = (req.body?.contactIds || []) as string[];
    if (!Array.isArray(ids)) {
      return res.status(400).json({ success: false, error: "contactIds array required" });
    }
    const { mapRecommendationsForContacts } = await import("../services/followup-engine.service.js");
    const map = await mapRecommendationsForContacts(req.user.id, ids.slice(0, 200));
    res.json({ success: true, data: map });
  } catch (error: unknown) {
    console.error("[aiFollowupEngineMap]", error);
    res.status(500).json({ success: false, error: "Failed to map recommendations" });
  }
}