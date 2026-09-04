import { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import * as svc from "../services/custom-fields.service.js";

function statusOf(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 400;
}

export async function listCustomFields(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
    const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
    const fields = await svc.listCustomFieldDefs(req.user.id, entity, { includeInactive });
    return res.json({ success: true, data: { fields } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to list custom fields",
    });
  }
}

export async function createCustomField(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const field = await svc.createCustomField(req.user.id, req.body);
    return res.status(201).json({ success: true, data: { field } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to create custom field",
    });
  }
}

export async function updateCustomField(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const key = String(req.params.key || "");
    const field = await svc.updateCustomField(req.user.id, key, req.body);
    return res.json({ success: true, data: { field } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to update custom field",
    });
  }
}

export async function deactivateCustomField(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const key = String(req.params.key || "");
    const field = await svc.deactivateCustomField(req.user.id, key);
    return res.json({ success: true, data: { field } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to deactivate custom field",
    });
  }
}

export async function setCustomFieldOptions(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const key = String(req.params.key || "");
    const options = req.body?.options ?? req.body;
    const field = await svc.setCustomFieldOptions(req.user.id, key, options);
    return res.json({ success: true, data: { field } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to update options",
    });
  }
}

export async function updateStandardField(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const key = String(req.params.key || "");
    const field = await svc.updateStandardField(req.user.id, key, req.body);
    return res.json({ success: true, data: { field } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to update standard field",
    });
  }
}

export async function listLeadPipelineStatuses(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const includeInactive =
      req.query.includeInactive === "1" || req.query.includeInactive === "true";
    const data = await svc.listLeadPipelineStatuses(req.user.id, { includeInactive });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to list lead statuses",
    });
  }
}

export async function addLeadPipelineStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const status = await svc.addLeadPipelineStatus(req.user.id, req.body);
    return res.status(201).json({ success: true, data: { status } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to add lead status",
    });
  }
}

export async function updateLeadPipelineStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const statusKey = String(req.params.statusKey || "");
    const status = await svc.updateLeadPipelineStatus(req.user.id, statusKey, req.body);
    return res.json({ success: true, data: { status } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to update lead status",
    });
  }
}

export async function archiveLeadPipelineStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const statusKey = String(req.params.statusKey || "");
    const status = await svc.archiveLeadPipelineStatus(req.user.id, statusKey);
    return res.json({ success: true, data: { status } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to archive lead status",
    });
  }
}

export async function reorderLeadPipelineStatuses(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const statuses = await svc.reorderLeadPipelineStatuses(req.user.id, req.body);
    return res.json({ success: true, data: { statuses } });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to reorder lead statuses",
    });
  }
}

export async function setLeadPipelineDefaultStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await svc.setLeadPipelineDefaultStatus(req.user.id, req.body);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(statusOf(e)).json({
      success: false,
      error: e instanceof Error ? e.message : "Failed to set default lead status",
    });
  }
}
