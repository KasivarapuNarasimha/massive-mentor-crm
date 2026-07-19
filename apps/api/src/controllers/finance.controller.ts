import { Response } from "express";
import { AuthenticatedRequest } from "@/middleware/auth";
import * as finance from "@/services/finance.service";

function q(req: AuthenticatedRequest, key: string) {
  const v = req.query[key];
  if (v == null) return undefined;
  return Array.isArray(v) ? String(v[0]) : String(v);
}

function paramId(req: AuthenticatedRequest): string {
  const id = req.params.id;
  return Array.isArray(id) ? String(id[0]) : String(id);
}

export async function dashboard(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await finance.getFinanceDashboard(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg.includes("restricted") ? 403 : 500).json({ success: false, error: msg });
  }
}

export async function listInvoices(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const result = await finance.listInvoices(req.user.id, {
      page: q(req, "page") ? parseInt(q(req, "page")!, 10) : undefined,
      pageSize: q(req, "pageSize") ? parseInt(q(req, "pageSize")!, 10) : undefined,
      search: q(req, "search"),
      status: q(req, "status"),
    });
    res.json({
      success: true,
      data: {
        invoices: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg.includes("restricted") ? 403 : 500).json({ success: false, error: msg });
  }
}

export async function createInvoice(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const invoice = await finance.createInvoice(req.user.id, req.body);
    res.status(201).json({ success: true, data: { invoice } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function updateInvoice(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const invoice = await finance.updateInvoice(req.user.id, paramId(req), req.body);
    res.json({ success: true, data: { invoice } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function deleteInvoice(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await finance.deleteInvoice(req.user.id, paramId(req));
    res.json({ success: true, data: { ok: true } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function listExpenses(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const result = await finance.listExpenses(req.user.id, {
      page: q(req, "page") ? parseInt(q(req, "page")!, 10) : undefined,
      pageSize: q(req, "pageSize") ? parseInt(q(req, "pageSize")!, 10) : undefined,
      search: q(req, "search"),
      category: q(req, "category"),
    });
    res.json({
      success: true,
      data: {
        expenses: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg.includes("restricted") ? 403 : 500).json({ success: false, error: msg });
  }
}

export async function createExpense(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const expense = await finance.createExpense(req.user.id, req.body);
    res.status(201).json({ success: true, data: { expense } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function updateExpense(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const expense = await finance.updateExpense(req.user.id, paramId(req), req.body);
    res.json({ success: true, data: { expense } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function deleteExpense(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await finance.deleteExpense(req.user.id, paramId(req));
    res.json({ success: true, data: { ok: true } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function listPayments(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const result = await finance.listPayments(req.user.id, {
      page: q(req, "page") ? parseInt(q(req, "page")!, 10) : undefined,
      pageSize: q(req, "pageSize") ? parseInt(q(req, "pageSize")!, 10) : undefined,
      invoiceId: q(req, "invoiceId"),
    });
    res.json({
      success: true,
      data: {
        payments: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg.includes("restricted") ? 403 : 500).json({ success: false, error: msg });
  }
}

export async function createPayment(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const payment = await finance.createPayment(req.user.id, req.body);
    res.status(201).json({ success: true, data: { payment } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}

export async function deletePayment(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await finance.deletePayment(req.user.id, paramId(req));
    res.json({ success: true, data: { ok: true } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ success: false, error: msg });
  }
}
