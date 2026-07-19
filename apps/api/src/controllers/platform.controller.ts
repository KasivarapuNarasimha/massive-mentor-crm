import { Response } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "@/middleware/auth";
import * as platform from "@/services/platform.service";
import { loginPlatformAdmin, issueSupportCustomerToken } from "@/services/auth.service";
import { loginSchema } from "@/services/auth.service";

export async function platformLogin(req: AuthenticatedRequest, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const result = await loginPlatformAdmin(parsed.data);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Login failed",
    });
  }
}

export async function platformMe(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
  res.json({
    success: true,
    data: {
      user: req.user,
      portal: "admin",
    },
  });
}

export async function listBusinesses(req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.listBusinesses({
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      plan: typeof req.query.plan === "string" ? req.query.plan : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 25,
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function getBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.getBusinessDetail(String(req.params.id));
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(404).json({ success: false, error: error instanceof Error ? error.message : "Not found" });
  }
}

export async function createBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    // Full sales-led provision (preferred)
    const full = z.object({
      companyName: z.string().min(1).max(120).optional(),
      businessName: z.string().min(1).max(120).optional(),
      ownerEmail: z.string().email(),
      ownerName: z.string().min(1).max(120),
      ownerMobile: z.string().max(30).optional(),
      businessAddress: z.string().max(500).optional(),
      gstNumber: z.string().max(40).optional(),
      country: z.string().max(80).optional(),
      timezone: z.string().max(80).optional(),
      currency: z.string().max(8).optional(),
      maxUsers: z.number().int().min(1).max(5000).optional(),
      planCode: z.string().optional(),
      notes: z.string().max(2000).optional(),
      templateSlug: z.string().optional(),
      trialDays: z.number().int().min(1).max(90).optional(),
      // Legacy fields
      ownerPassword: z.string().min(8).optional(),
      plan: z.string().optional(),
    });
    const parsed = full.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const body = parsed.data;
    const companyName = (body.companyName || body.businessName || "").trim();
    if (!companyName) {
      return res.status(400).json({ success: false, error: "Company name is required" });
    }

    // New provision path (auto password + trial + emails)
    if (!body.ownerPassword) {
      const { provisionCustomer } = await import("@/services/customer-provision.service");
      const data = await provisionCustomer({
        actorUserId: req.user.id,
        companyName,
        ownerName: body.ownerName,
        ownerEmail: body.ownerEmail,
        ownerMobile: body.ownerMobile,
        businessAddress: body.businessAddress,
        gstNumber: body.gstNumber,
        country: body.country,
        timezone: body.timezone,
        currency: body.currency,
        maxUsers: body.maxUsers,
        planCode: body.planCode || body.plan,
        notes: body.notes,
        templateSlug: body.templateSlug,
        trialDays: body.trialDays,
      });
      return res.status(201).json({ success: true, data });
    }

    // Legacy create with explicit password
    const data = await platform.createCustomerBusiness({
      actorUserId: req.user.id,
      businessName: companyName,
      ownerEmail: body.ownerEmail,
      ownerName: body.ownerName,
      ownerPassword: body.ownerPassword,
      templateSlug: body.templateSlug,
      plan: body.plan || "trial",
    });
    res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    res.status(msg.includes("already") ? 409 : 400).json({ success: false, error: msg });
  }
}

export async function extendTrial(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const days = Number(req.body?.days || 3);
    const { adminExtendTrial } = await import("@/services/saas-billing.service");
    const data = await adminExtendTrial(req.user.id, String(req.params.id), days);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function resetTrial(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { adminResetTrial } = await import("@/services/saas-billing.service");
    const data = await adminResetTrial(req.user.id, String(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function revenueDashboard(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { getSaaSRevenueDashboard } = await import("@/services/billing-revenue.service");
    const data = await getSaaSRevenueDashboard();
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function suspendBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await platform.setBusinessStatus(
      req.user.id,
      String(req.params.id),
      "suspended",
      typeof req.body?.reason === "string" ? req.body.reason : undefined
    );
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function activateBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await platform.setBusinessStatus(req.user.id, String(req.params.id), "active");
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function deleteBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await platform.softDeleteBusiness(req.user.id, String(req.params.id));
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function restoreBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await platform.restoreBusiness(req.user.id, String(req.params.id));
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function changePlan(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const schema = z.object({
      action: z.enum(["activate", "upgrade", "downgrade", "renew"]),
      plan: z.string(),
      days: z.number().int().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const data = await platform.changePlan(
      req.user.id,
      String(req.params.id),
      parsed.data.action,
      parsed.data.plan,
      parsed.data.days
    );
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function updateWhiteLabel(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await platform.updateWhiteLabel(
      req.user.id,
      String(req.params.id),
      (req.body?.whiteLabel || req.body || {}) as Record<string, unknown>
    );
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function createInvoice(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const schema = z.object({
      businessId: z.string().min(1),
      kind: z.enum(["setup", "subscription", "renewal", "adjustment"]),
      amount: z.number().positive(),
      plan: z.string().optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const data = await platform.createPlatformInvoice({ actorUserId: req.user.id, ...parsed.data });
    res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function markInvoicePaid(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await platform.markInvoicePaid(req.user.id, String(req.params.id));
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function listInvoices(req: AuthenticatedRequest, res: Response) {
  try {
    const businessId = typeof req.query.businessId === "string" ? req.query.businessId : undefined;
    const data = await platform.listInvoices(businessId);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function listLicenses(req: AuthenticatedRequest, res: Response) {
  try {
    const filter =
      req.query.filter === "active" || req.query.filter === "expired" || req.query.filter === "trial"
        ? req.query.filter
        : undefined;
    const data = await platform.listLicenses(filter);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function usage(req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.refreshUsageSnapshot(String(req.params.id));
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function analytics(_req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.platformAnalytics();
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function listTickets(req: AuthenticatedRequest, res: Response) {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const data = await platform.listSupportTickets(status);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function createTicket(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const schema = z.object({
      businessId: z.string().optional(),
      subject: z.string().min(1),
      body: z.string().min(1),
      priority: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const data = await platform.createSupportTicket({ actorUserId: req.user.id, ...parsed.data });
    res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function updateTicket(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const status = String(req.body?.status || "");
    if (!status) return res.status(400).json({ success: false, error: "status required" });
    const data = await platform.updateTicketStatus(req.user.id, String(req.params.id), status);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function supportLoginAs(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const schema = z.object({
      businessId: z.string().min(1),
      reason: z.string().min(5, "Reason required for audit log (min 5 chars)"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const meta = await platform.supportImpersonate({
      actorUserId: req.user.id,
      businessId: parsed.data.businessId,
      reason: parsed.data.reason,
    });
    const token = await issueSupportCustomerToken({
      targetUserId: meta.targetUserId,
      supportActorId: req.user.id,
      businessId: meta.businessId,
    });
    res.json({
      success: true,
      data: {
        ...meta,
        token,
        portal: "customer",
        expiresIn: "1h",
        warning: "Support mode is fully audited. Use only for legitimate customer support.",
      },
    });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function health(_req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.systemHealth();
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function auditLog(req: AuthenticatedRequest, res: Response) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await platform.recentPlatformAudit(limit);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function systemEvents(req: AuthenticatedRequest, res: Response) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 40;
    const data = await platform.recentSystemEvents(limit);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function usageDashboard(_req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.platformUsageDashboard();
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function bulkAction(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const schema = z.object({
      businessIds: z.array(z.string()).min(1),
      action: z.enum([
        "suspend",
        "activate",
        "delete",
        "change_plan",
        "assign_license",
        "send_email",
        "send_notification",
      ]),
      plan: z.string().optional(),
      reason: z.string().optional(),
      licenseStatus: z.string().optional(),
      emailSubject: z.string().optional(),
      emailBody: z.string().optional(),
      notificationMessage: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const data = await platform.bulkBusinessAction({
      actorUserId: req.user.id,
      ...parsed.data,
    });
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function addUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
      role: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || "Invalid input" });
    }
    const data = await platform.addBusinessUser({
      actorUserId: req.user.id,
      businessId: String(req.params.id),
      ...parsed.data,
    });
    res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function disableUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const disabled = req.body?.disabled !== false;
    const data = await platform.setBusinessUserDisabled(
      req.user.id,
      String(req.params.id),
      String(req.params.userId),
      disabled
    );
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function resetPassword(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const password = String(req.body?.password || "");
    const data = await platform.resetBusinessUserPassword(
      req.user.id,
      String(req.params.id),
      String(req.params.userId),
      password
    );
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function exportBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    const data = await platform.exportBusinessData(String(req.params.id));
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}
