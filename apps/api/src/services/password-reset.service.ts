import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { recordAudit } from "./audit.service.js";
import { buildPasswordResetEmail, sendEmail } from "./email.service.js";
import { getAdminAppUrl, getAppUrl } from "./email/brand.js";

export type ResetPortal = "customer" | "admin";

const GENERIC_OK =
  "If an account exists with this email, a password reset link has been sent.";

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, "Invalid or missing reset token"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/[a-z]/, "Password must include a lowercase letter")
      .regex(/[0-9]/, "Password must include a number")
      .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function appBaseForPortal(portal: ResetPortal): string {
  // Email brand helpers: production never emits localhost / legacy app.* hosts
  if (portal === "admin") return getAdminAppUrl();
  return getAppUrl();
}

function resetPath(portal: ResetPortal): string {
  return portal === "admin" ? "/admin/reset-password" : "/reset-password";
}

function portalLabel(portal: ResetPortal): string {
  return portal === "admin" ? "Super Admin" : "Customer";
}

export class PasswordResetEmailError extends Error {
  constructor(
    message: string,
    public readonly code: "SMTP_NOT_CONFIGURED" | "SMTP_SEND_FAILED" | "TOKEN_CREATE_FAILED"
  ) {
    super(message);
    this.name = "PasswordResetEmailError";
  }
}

function maskEmailAddr(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const l = local || "";
  return `${l.length <= 2 ? "**" : `${l.slice(0, 2)}***`}@${domain}`;
}

/**
 * Request password reset.
 * - Unknown / ineligible emails: generic success (anti-enumeration).
 * - Eligible account + email failure: throws PasswordResetEmailError so UI can show a real error.
 */
export async function requestPasswordReset(opts: {
  email: string;
  portal: ResetPortal;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ message: string; delivered?: boolean; mode?: string }> {
  const email = opts.email.toLowerCase().trim();
  const ttl = env.PASSWORD_RESET_TTL_MINUTES || 30;

  console.log(
    `[password-reset] request portal=${opts.portal} email=${maskEmailAddr(email)} ip=${opts.ip || "n/a"}`
  );

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      platformRole: true,
      isDisabled: true,
    },
  });

  if (!user || user.isDisabled) {
    console.log(
      `[password-reset] no eligible user for ${maskEmailAddr(email)} (generic OK response)`
    );
    return { message: GENERIC_OK };
  }

  const isSuperAdmin = user.platformRole === "super_admin";
  const eligible =
    (opts.portal === "admin" && isSuperAdmin) ||
    (opts.portal === "customer" && !isSuperAdmin);

  // Super Admin cannot reset via customer portal and vice versa
  if (!eligible) {
    console.log(
      `[password-reset] user found but not eligible for portal=${opts.portal} (generic OK)`
    );
    return { message: GENERIC_OK };
  }

  // Invalidate previous unused tokens for this user+portal
  await prisma.passwordResetToken.updateMany({
    where: {
      userId: user.id,
      portal: opts.portal,
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  const raw = generateRawToken();
  const tokenHash = hashResetToken(raw);
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

  try {
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        portal: opts.portal,
        expiresAt,
        requestIp: opts.ip || null,
        userAgent: opts.userAgent || null,
      },
    });
    console.log(
      `[password-reset] token created userId=${user.id} portal=${opts.portal} expiresAt=${expiresAt.toISOString()}`
    );
  } catch (err) {
    console.error(
      "[password-reset] token create FAILED:",
      err instanceof Error ? err.message : err
    );
    throw new PasswordResetEmailError(
      "Could not create a reset link. Please try again in a moment.",
      "TOKEN_CREATE_FAILED"
    );
  }

  const resetUrl = `${appBaseForPortal(opts.portal)}${resetPath(opts.portal)}?token=${encodeURIComponent(raw)}`;
  const mail = buildPasswordResetEmail({
    name: user.name,
    resetUrl,
    portalLabel: portalLabel(opts.portal),
    ttlMinutes: ttl,
  });

  let delivery: { delivered: boolean; mode: string };
  try {
    delivery = await sendEmail({
      to: user.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      sensitive: true,
    });
    console.log(
      `[password-reset] email ok to=${maskEmailAddr(user.email)} mode=${delivery.mode} delivered=${delivery.delivered}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[password-reset] EMAIL DELIVERY FAILED to=${maskEmailAddr(user.email)}:`,
      msg
    );
    // Invalidate the unused token so a broken send doesn't leave a valid link hanging only in DB
    await prisma.passwordResetToken
      .updateMany({
        where: { tokenHash, usedAt: null },
        data: { usedAt: new Date() },
      })
      .catch(() => undefined);

    const isConfig = /not configured|SMTP_HOST|SMTP_USER|SMTP_PASS/i.test(msg);
    throw new PasswordResetEmailError(
      isConfig
        ? "Email is not configured on the server. Please contact support or your administrator."
        : "We could not send the reset email. Please try again in a few minutes or contact support.",
      isConfig ? "SMTP_NOT_CONFIGURED" : "SMTP_SEND_FAILED"
    );
  }

  await recordAudit({
    actorUserId: user.id,
    action: "password_reset_requested",
    entityType: "user",
    entityId: user.id,
    metadata: {
      portal: opts.portal,
      email: user.email,
      expiresAt: expiresAt.toISOString(),
      emailMode: delivery.mode,
      delivered: delivery.delivered,
    },
    ip: opts.ip,
    userAgent: opts.userAgent,
  });

  // Console-only mode (dev without SMTP) still returns success so QA can use API logs
  if (!delivery.delivered && delivery.mode === "console") {
    console.warn(
      "[password-reset] SMTP not configured — link was printed to API console only (development)."
    );
  }

  return {
    message: GENERIC_OK,
    delivered: delivery.delivered,
    mode: delivery.mode,
  };
}

/**
 * Validate token without consuming it (for UI pre-check).
 */
export async function validateResetToken(rawToken: string): Promise<{
  valid: boolean;
  portal?: ResetPortal;
  emailHint?: string;
  error?: string;
}> {
  if (!rawToken || rawToken.length < 20) {
    return { valid: false, error: "Invalid or expired reset link" };
  }
  const tokenHash = hashResetToken(rawToken);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { email: true, isDisabled: true } } },
  });
  if (!row || row.usedAt) {
    return { valid: false, error: "Invalid or expired reset link" };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { valid: false, error: "This reset link has expired. Request a new one." };
  }
  if (row.user.isDisabled) {
    return { valid: false, error: "This account is disabled" };
  }
  const email = row.user.email;
  const hint =
    email.length > 4
      ? `${email.slice(0, 2)}•••@${email.split("@")[1] || ""}`
      : "•••";
  return {
    valid: true,
    portal: row.portal as ResetPortal,
    emailHint: hint,
  };
}

/**
 * Complete password reset: hash password, burn token, bump tokenVersion (revoke sessions).
 */
export async function completePasswordReset(opts: {
  token: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ success: true }> {
  const tokenHash = hashResetToken(opts.token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!row || row.usedAt) {
    throw new Error("Invalid or expired reset link");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new Error("This reset link has expired. Request a new one.");
  }
  if (row.user.isDisabled) {
    throw new Error("This account is disabled");
  }

  const passwordHash = await bcrypt.hash(opts.password, 12);

  // Atomic-ish: update user, burn this token, burn other unused tokens, bump version
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        passwordChangedAt: new Date(),
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: row.userId,
        usedAt: null,
        id: { not: row.id },
      },
      data: { usedAt: new Date() },
    }),
  ]);

  try {
    const { revokeAllUserSessions, recordLoginEvent } = await import(
      "./session.service.js"
    );
    await revokeAllUserSessions(row.userId, "password_change");
    await recordLoginEvent({
      userId: row.userId,
      eventType: "password_changed",
      success: true,
      device: { userAgent: opts.userAgent, ipAddress: opts.ip },
      metadata: { via: "password_reset", portal: row.portal },
    });
  } catch {
    /* non-fatal */
  }

  await recordAudit({
    actorUserId: row.userId,
    action: "password_reset_completed",
    entityType: "user",
    entityId: row.userId,
    metadata: {
      portal: row.portal,
      email: row.user.email,
      sessionsRevoked: true,
    },
    ip: opts.ip,
    userAgent: opts.userAgent,
  });

  return { success: true };
}

export { GENERIC_OK };
