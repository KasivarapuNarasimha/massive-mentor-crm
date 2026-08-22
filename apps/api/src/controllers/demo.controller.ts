import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { loginDemoUser, loginSchema } from "../services/auth.service.js";
import {
  ensureDemoWorkspace,
  resetDemoData,
  DEMO_EMAIL,
} from "../services/demo.service.js";

export async function demoLogin(req: AuthenticatedRequest, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message || "Invalid input";
      // Empty password must never create a session.
      if (/password/i.test(msg)) {
        return res.status(401).json({ success: false, error: "Invalid demo password." });
      }
      return res.status(400).json({ success: false, error: msg });
    }
    const result = await loginDemoUser(parsed.data);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Login failed",
    });
  }
}

/** Public demo portal info — email only (never expose DEMO_PASSWORD to the browser). */
export async function demoInfo(_req: AuthenticatedRequest, res: Response) {
  try {
    await ensureDemoWorkspace();
    res.json({
      success: true,
      data: {
        portal: "demo",
        message: "Product demonstration environment — sample data only. Never production customer data.",
        loginHint: {
          email: DEMO_EMAIL,
        },
        features: [
          "Leads",
          "Clients",
          "Deals",
          "Tasks",
          "Meetings",
          "AI Follow-up",
          "AI Sales Intelligence",
          "Reports",
          "Finance",
          "Field Sales",
        ],
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}

export async function demoMe(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
  const { business } = await ensureDemoWorkspace();
  res.json({
    success: true,
    data: {
      user: req.user,
      portal: "demo",
      business: {
        id: business.id,
        name: business.name,
        isDemo: true,
        lastDemoResetAt: business.lastDemoResetAt,
      },
    },
  });
}

export async function demoReset(req: AuthenticatedRequest, res: Response) {
  try {
    const data = await resetDemoData(req.user?.id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
  }
}
