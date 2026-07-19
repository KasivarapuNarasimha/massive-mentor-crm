import { Response } from "express";
import type { AuthenticatedRequest } from "@/middleware/auth";
import * as approval from "@/services/approval.service";

export async function listWorkflows(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const workflows = await approval.listWorkflows(req.user.id);
    res.json({ success: true, data: { workflows } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function upsertWorkflow(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const workflow = await approval.upsertWorkflow(req.user.id, req.body);
    res.json({ success: true, data: { workflow } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function listRequests(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const result = await approval.listRequests(req.user.id, {
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
      mine: req.query.mine === "1" || req.query.mine === "true",
      pendingForMe: req.query.pendingForMe === "1" || req.query.pendingForMe === "true",
      page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
      pageSize: req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined,
    });
    res.json({
      success: true,
      data: {
        requests: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function getRequest(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const request = await approval.getRequest(req.user.id, String(req.params.id));
    res.json({ success: true, data: { request } });
  } catch (e) {
    res.status(404).json({ success: false, error: e instanceof Error ? e.message : "Not found" });
  }
}

export async function submitRequest(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const body = req.body || {};
    if (!body.type || !body.title) {
      return res.status(400).json({ success: false, error: "type and title are required" });
    }
    const request = await approval.submitRequest(req.user.id, {
      type: String(body.type),
      title: String(body.title),
      description: body.description ? String(body.description) : undefined,
      amount: body.amount != null ? Number(body.amount) : null,
      currency: body.currency ? String(body.currency) : "INR",
      entityType: body.entityType ? String(body.entityType) : null,
      entityId: body.entityId ? String(body.entityId) : null,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : null,
      workflowId: body.workflowId ? String(body.workflowId) : null,
    });
    res.status(201).json({ success: true, data: { request } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function actOnRequest(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const action = String(req.body?.action || "");
    if (!["approve", "reject", "cancel"].includes(action)) {
      return res.status(400).json({ success: false, error: "action must be approve|reject|cancel" });
    }
    const request = await approval.actOnRequest(
      req.user.id,
      String(req.params.id),
      action as "approve" | "reject" | "cancel",
      typeof req.body?.comment === "string" ? req.body.comment : undefined
    );
    res.json({ success: true, data: { request } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function stats(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await approval.getApprovalStats(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}
