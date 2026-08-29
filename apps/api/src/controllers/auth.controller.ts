import { Request, Response } from "express";
import {
  loginUser,
  getUserById,
  loginSchema,
  updateUserThemePreference,
  normalizeThemePreference,
} from "../services/auth.service.js";
// registerUser intentionally not imported — public signup is permanently disabled
import { AuthenticatedRequest } from "../middleware/auth.js";
import { ensureDefaultBusiness } from "../services/business.service.js";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  requestPasswordReset,
  validateResetToken,
  completePasswordReset,
  PasswordResetEmailError,
  type ResetPortal,
} from "../services/password-reset.service.js";
import { SessionLimitError } from "../services/session.service.js";

/**
 * Public self-registration is disabled for production SaaS sales model.
 * Customer workspaces are provisioned only by Super Admin after deal close.
 */
export async function register(_req: Request, res: Response) {
  return res.status(403).json({
    success: false,
    error:
      "Public registration is disabled. Contact Massive Mentor sales to start your CRM trial.",
    code: "REGISTRATION_DISABLED",
  });
}

export async function login(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const meta = clientMeta(req);
    const forceNewSession =
      req.body?.forceNewSession === true ||
      req.body?.forceNewSession === "true" ||
      req.body?.continueAndLogoutPrevious === true;

    const result = await loginUser(parsed.data, {
      ...meta,
      countryCode:
        typeof req.headers["cf-ipcountry"] === "string"
          ? req.headers["cf-ipcountry"]
          : typeof req.headers["x-vercel-ip-country"] === "string"
            ? req.headers["x-vercel-ip-country"]
            : null,
      forceNewSession,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    if (error instanceof SessionLimitError) {
      return res.status(409).json({
        success: false,
        error: error.message,
        code: "SESSION_LIMIT",
        data: {
          maxSessions: error.maxSessions,
          activeSessions: error.sessions.map((s) => ({
            id: s.id,
            deviceName: s.deviceName,
            browser: s.browser,
            os: s.os,
            ipAddress: s.ipAddress,
            locationLabel: s.locationLabel,
            loginTime: s.loginTime,
            lastActivity: s.lastActivity,
          })),
          actions: [
            { key: "continue", label: "Continue and log out previous session" },
            { key: "cancel", label: "Cancel" },
          ],
        },
      });
    }
    const errorMessage = error instanceof Error ? error.message : "Login failed";
    res.status(401).json({
      success: false,
      error: errorMessage,
    });
  }
}

/** POST /api/auth/logout — revoke current session */
export async function logout(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const { revokeSession } = await import("../services/session.service.js");
    if (req.sessionId) {
      await revokeSession(req.sessionId, "logout", req.user.id);
    }
    res.json({ success: true, data: { message: "Signed out" } });
  } catch (error) {
    console.error("[auth] logout:", error);
    res.json({ success: true, data: { message: "Signed out" } });
  }
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    // Fetch fresh user data
    const user = await getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Demo portal JWT must bind to the demo workspace — never ensureDefaultBusiness
    // (that creates/selects a customer shell and hides sample demo CRM data).
    let business: {
      id: string;
      name: string;
      role: string;
      status?: string | null;
      templateSlug?: string | null;
      templateId?: string | null;
    };
    if (req.portal === "demo") {
      const { ensureDemoWorkspace } = await import("../services/demo.service.js");
      const demo = await ensureDemoWorkspace();
      business = {
        id: demo.business.id,
        name: demo.business.name,
        role: "business_admin",
        status: demo.business.status,
        templateSlug: demo.business.templateSlug,
        templateId: demo.business.templateId,
      };
    } else {
      // Phase 1: ensure tenant on every /me (idempotent backfill)
      business = await ensureDefaultBusiness(req.user.id);
    }

    // Currency: Business.settings (Super Admin provision) — not browser locale
    let currency = "INR";
    let country: string | null = null;
    try {
      const { prisma } = await import("../lib/prisma.js");
      const { resolveBusinessCurrency } = await import("../services/template.service.js");
      const full = await prisma.business.findUnique({
        where: { id: business.id },
        select: { settings: true, country: true },
      });
      country = full?.country ?? null;
      currency = resolveBusinessCurrency(full);
    } catch {
      /* keep INR */
    }

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          businessId: business.id,
          role: user.role,
          themePreference: normalizeThemePreference(user.themePreference),
        },
        business: {
          id: business.id,
          name: business.name,
          role: business.role,
          status: business.status,
          templateSlug: business.templateSlug,
          templateId: business.templateId,
          currency,
          country,
        },
      },
    });
  } catch (error) {
    console.error("[auth] getCurrentUser error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user",
    });
  }
}

/** PATCH /api/auth/theme — persist appearance preference (light | dark | system) */
export async function updateThemePreference(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const themePreference = await updateUserThemePreference(
      req.user.id,
      req.body?.theme ?? req.body?.themePreference
    );
    res.json({
      success: true,
      data: { themePreference },
    });
  } catch (error) {
    console.error("[auth] updateThemePreference:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save theme preference",
    });
  }
}

function clientMeta(req: Request) {
  const ip =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
      : null) ||
    req.ip ||
    null;
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
  return { ip, userAgent };
}

/** POST /api/auth/forgot-password — Customer portal */
export async function forgotPasswordCustomer(req: Request, res: Response) {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid email",
      });
    }
    const meta = clientMeta(req);
    const data = await requestPasswordReset({
      email: parsed.data.email,
      portal: "customer" satisfies ResetPortal,
      ...meta,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof PasswordResetEmailError) {
      console.error(
        `[auth] forgotPasswordCustomer delivery error code=${error.code}:`,
        error.message
      );
      return res.status(503).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    console.error("[auth] forgotPasswordCustomer unexpected:", error);
    return res.status(500).json({
      success: false,
      error: "Could not process password reset. Please try again later.",
    });
  }
}

/** POST /api/platform/auth/forgot-password — Super Admin portal */
export async function forgotPasswordAdmin(req: Request, res: Response) {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid email",
      });
    }
    const meta = clientMeta(req);
    const data = await requestPasswordReset({
      email: parsed.data.email,
      portal: "admin",
      ...meta,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof PasswordResetEmailError) {
      console.error(
        `[auth] forgotPasswordAdmin delivery error code=${error.code}:`,
        error.message
      );
      return res.status(503).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }
    console.error("[auth] forgotPasswordAdmin unexpected:", error);
    return res.status(500).json({
      success: false,
      error: "Could not process password reset. Please try again later.",
    });
  }
}

/** GET /api/auth/reset-password/validate?token= */
export async function validatePasswordResetToken(req: Request, res: Response) {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const data = await validateResetToken(token);
    if (!data.valid) {
      return res.status(400).json({ success: false, error: data.error || "Invalid token" });
    }
    res.json({ success: true, data });
  } catch {
    res.status(400).json({ success: false, error: "Invalid or expired reset link" });
  }
}

/** POST /api/auth/reset-password */
export async function resetPasswordWithToken(req: Request, res: Response) {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }
    const meta = clientMeta(req);
    await completePasswordReset({
      token: parsed.data.token,
      password: parsed.data.password,
      ...meta,
    });
    res.json({
      success: true,
      data: {
        message: "Password updated. Please sign in with your new password.",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Password reset failed";
    res.status(400).json({ success: false, error: message });
  }
}
