import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import * as finance from "../services/finance.service.js";

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

/**
 * Explicit Client → Finance: only when user selects Revenue Received.
 * Uses existing Finance role gate (BA / CEO / finance / admin).
 */
export async function recordClientRevenue(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await finance.assertFinanceAccessForCrm(req.user.id);

    const contactId = String(
      req.body?.contactId || (req.params.id ? paramId(req) : "") || ""
    ).trim();
    if (!contactId) {
      return res.status(400).json({ success: false, error: "contactId is required" });
    }
    const amount = Number(req.body?.amount);
    const financialStatus = String(req.body?.financialStatus || "received").toLowerCase();
    const dealId = req.body?.dealId ? String(req.body.dealId) : null;
    const revenueDate = req.body?.revenueDate ? String(req.body.revenueDate) : null;
    const description = req.body?.description ? String(req.body.description) : null;

    const { prisma } = await import("../lib/prisma.js");
    const { getUserBusinessId } = await import("../services/field-engine.service.js");
    const businessId = await getUserBusinessId(req.user.id);
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        deletedAt: null,
        ...(businessId
          ? { OR: [{ businessId }, { userId: req.user.id }] }
          : { userId: req.user.id }),
      },
    });
    if (!contact) {
      return res.status(404).json({ success: false, error: "Client not found" });
    }

    // Persist financial status on contact (does not change CRM value meaning)
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        financialStatus:
          financialStatus === "expected" || financialStatus === "received"
            ? financialStatus
            : "not_revenue",
      },
    });

    if (financialStatus !== "received") {
      // Expected / not revenue: do not create payment; optionally void prior client-source revenue
      if (financialStatus === "not_revenue") {
        const { voidCrmRevenue } = await import("../services/finance-crm-sync.service.js");
        await voidCrmRevenue({
          actorUserId: req.user.id,
          businessId: contact.businessId,
          sourceType: "client",
          sourceId: contact.id,
        });
      }
      return res.json({
        success: true,
        data: {
          recorded: false,
          financialStatus:
            financialStatus === "expected" ? "expected" : "not_revenue",
          message:
            financialStatus === "expected"
              ? "Marked as expected revenue (not counted in Finance yet)"
              : "Not recorded as revenue",
        },
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Amount must be greater than zero for Revenue Received",
      });
    }

    const { upsertCrmRevenue } = await import("../services/finance-crm-sync.service.js");
    const result = await upsertCrmRevenue({
      actorUserId: req.user.id,
      businessId: contact.businessId,
      sourceType: "client",
      sourceId: contact.id,
      amount,
      contactId: contact.id,
      clientName: contact.company || contact.name,
      description:
        description ||
        `Client revenue: ${contact.company || contact.name}`,
      revenueDate,
      dealId,
    });

    res.json({
      success: true,
      data: {
        recorded: true,
        financialStatus: "received",
        sourceType: result.sourceType,
        sourceId: result.sourceId,
        amount: result.amount,
        invoiceId: result.invoice?.id,
        invoiceNumber: result.invoice?.number,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg.includes("restricted") ? 403 : 400).json({ success: false, error: msg });
  }
}
