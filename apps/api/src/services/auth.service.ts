import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { env } from "../config/env.js";
import { ensureDefaultBusiness, createBusinessWithTemplate } from "./business.service.js";
import { recordAudit } from "./audit.service.js";
import { resolveOrCreateCustomerOwner } from "./customer-owner.service.js";
import type { PortalAudience } from "../types/portal.js";

export type { PortalAudience };

const JWT_SECRET = env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d";
const SUPPORT_JWT_EXPIRES_IN = "1h";

export const registerSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  /** Display business name */
  businessName: z.string().min(1, "Business name is required").max(120).optional(),
  /** Industry template slug (from catalog) — required for new business OS flow */
  templateSlug: z.string().min(1, "Please select a business type").optional(),
  /** Human label for industry (stored on profile) */
  industryLabel: z.string().max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role?: string;
  platformRole?: string;
  businessId?: string;
  /** light | dark | system */
  themePreference?: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  portal: PortalAudience;
}

export type JwtPayload = {
  userId: string;
  portal: PortalAudience;
  /** Must match User.tokenVersion — password reset increments version and kills sessions */
  tv?: number;
  /** UserSession.id — enterprise session binding */
  sid?: string;
  supportMode?: boolean;
  supportActorId?: string;
  supportBusinessId?: string;
  /** Future: MFA step-up completed for this session */
  mfa?: boolean;
};

function generateToken(
  userId: string,
  portal: PortalAudience,
  extra?: Partial<JwtPayload>,
  expiresIn: jwt.SignOptions["expiresIn"] = JWT_EXPIRES_IN
): string {
  const payload: JwtPayload = {
    userId,
    portal,
    tv: extra?.tv ?? 0,
    ...extra,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

async function issueAuthToken(
  userId: string,
  portal: PortalAudience,
  extra?: Partial<JwtPayload>,
  expiresIn?: jwt.SignOptions["expiresIn"]
): Promise<string> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  return generateToken(
    userId,
    portal,
    { ...extra, tv: row?.tokenVersion ?? 0 },
    expiresIn
  );
}

export type LoginDeviceMeta = {
  userAgent?: string | null;
  ipAddress?: string | null;
  countryCode?: string | null;
  locationLabel?: string | null;
  /** When true, revoke previous sessions to free a concurrent seat */
  forceNewSession?: boolean;
};

export type AuthResponseWithSession = AuthResponse & {
  sessionId?: string;
  /** Always false until MFA is enabled — architecture hook */
  mfaRequired?: boolean;
};

export async function registerUser(input: RegisterInput): Promise<AuthResponse> {
  // Defense in depth: public self-serve signup is disabled for sales-led SaaS
  if (process.env.ALLOW_PUBLIC_REGISTER !== "true") {
    throw new Error(
      "Public registration is disabled. Contact Massive Mentor sales to start your CRM trial."
    );
  }
  const businessName = (input.businessName || input.name || "My Business").trim();
  const { resolveIndustryTemplate } = await import("./industry-template-resolve.service.js");
  const resolved = await resolveIndustryTemplate({
    templateSlug: input.templateSlug,
    industryLabel: input.industryLabel,
  });
  const templateSlug = resolved.templateSlug;
  const industryLabel = resolved.industryLabel;

  // Shared with Super Admin create-business: reuse soft-deleted owners (email UNIQUE)
  const owner = await resolveOrCreateCustomerOwner({
    email: input.email,
    password: input.password,
    name: input.name,
    businessName,
    industryLabel,
  });

  // Create business + apply full industry template (fields, pipeline, dashboards, menus, AI pack, etc.)
  const business = await createBusinessWithTemplate({
    ownerUserId: owner.userId,
    businessName,
    templateSlug,
    memberRole: "business_admin",
  });

  await recordAudit({
    businessId: business.id,
    actorUserId: owner.userId,
    action: "register",
    entityType: "user",
    entityId: owner.userId,
    metadata: {
      email: owner.email,
      templateSlug,
      industryLabel,
      businessName,
      reusedUser: owner.reusedUser,
    },
  });

  const token = await issueAuthToken(owner.userId, "customer");

  return {
    user: {
      id: owner.userId,
      email: owner.email,
      name: owner.name,
      role: owner.role,
      platformRole: owner.platformRole,
      businessId: business.id,
    },
    token,
    portal: "customer",
  };
}

/**
 * Customer portal login only (crm.massivementor.in).
 * Rejects Super Admin staff and pure demo accounts.
 * Enterprise: binds JWT to UserSession (sid) + concurrent session limits.
 */
export async function loginUser(
  input: LoginInput,
  device?: LoginDeviceMeta
): Promise<AuthResponseWithSession> {
  const {
    createUserSession,
    recordLoginEvent,
    SessionLimitError,
  } = await import("./session.service.js");

  const email = input.email.toLowerCase().trim();
  const { normalizeLoginPassword } = await import("../lib/password-policy.js");
  // Strip accidental outer whitespace from email copy/paste — never log the secret
  const password = normalizeLoginPassword(input.password);
  const deviceMeta = {
    userAgent: device?.userAgent,
    ipAddress: device?.ipAddress,
    countryCode: device?.countryCode,
    locationLabel: device?.locationLabel,
  };

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    await recordLoginEvent({
      eventType: "failed_login",
      success: false,
      device: deviceMeta,
      metadata: { email, reason: "unknown_user" },
    });
    throw new Error("Invalid email or password");
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);

  if (!isValidPassword) {
    await recordLoginEvent({
      userId: user.id,
      eventType: "failed_login",
      success: false,
      device: deviceMeta,
      metadata: { email, reason: "bad_password" },
    });
    throw new Error("Invalid email or password");
  }

  if ((user as { isDisabled?: boolean }).isDisabled) {
    await recordLoginEvent({
      userId: user.id,
      eventType: "failed_login",
      success: false,
      device: deviceMeta,
      metadata: { email, reason: "disabled" },
    });
    throw new Error("This account has been disabled. Contact your administrator.");
  }

  if (user.platformRole === "super_admin") {
    throw new Error(
      "Super Admin accounts must sign in at the Super Admin portal (admin.massivementor.in)."
    );
  }

  // Block demo-only users from production CRM
  const demoOnly = await prisma.businessMember.findFirst({
    where: {
      userId: user.id,
      business: { isDemo: true, portalKind: "demo" },
    },
    include: { business: true },
  });
  // Include null portalKind + owner path — same rules as ensureDefaultBusiness
  const { resolveExistingCustomerBusiness } = await import("./business.service.js");
  const customerWorkspace = await resolveExistingCustomerBusiness(user.id);
  if (demoOnly && !customerWorkspace) {
    throw new Error("Demo accounts must sign in at the Demo portal (demo.massivementor.in).");
  }

  // Ensure tenant + backfill CRM businessId (idempotent — must NOT spawn new Trial for existing owners)
  const business = await ensureDefaultBusiness(user.id);

  // Never attach a demo business as customer tenant
  const bizRow = await prisma.business.findUnique({ where: { id: business.id } });
  if (bizRow?.isDemo || bizRow?.portalKind === "demo") {
    throw new Error("This account is not allowed on the Customer portal.");
  }
  if (bizRow?.status === "suspended") {
    throw new Error("This business is suspended. Contact support.");
  }
  if (bizRow?.status === "deleted") {
    throw new Error("This business is no longer active.");
  }

  let sessionId: string;
  try {
    const created = await createUserSession({
      userId: user.id,
      businessId: business.id,
      portal: "customer",
      device: deviceMeta,
      forceNewSession: !!device?.forceNewSession,
    });
    sessionId = created.sessionId;
  } catch (err) {
    if (err instanceof SessionLimitError) {
      throw err;
    }
    throw err;
  }

  await recordAudit({
    businessId: business.id,
    actorUserId: user.id,
    action: "login",
    entityType: "user",
    entityId: user.id,
    metadata: {
      email: user.email,
      portal: "customer",
      sessionId,
      ip: device?.ipAddress,
    },
    ip: device?.ipAddress || undefined,
    userAgent: device?.userAgent || undefined,
  });

  const token = await issueAuthToken(user.id, "customer", { sid: sessionId });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformRole: user.platformRole,
      businessId: business.id,
      themePreference: normalizeThemePreference(
        (user as { themePreference?: string }).themePreference
      ),
    },
    token,
    portal: "customer",
    sessionId,
    // MFA architecture hook — always false until 2FA is enrolled
    mfaRequired: false,
  };
}

/** Super Admin portal login — Massive Mentor staff only */
export async function loginPlatformAdmin(input: LoginInput): Promise<AuthResponse> {
  const { normalizeLoginPassword } = await import("../lib/password-policy.js");
  const email = input.email.toLowerCase().trim();
  const password = normalizeLoginPassword(input.password);
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) throw new Error("Invalid email or password");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("Invalid email or password");
  if (user.isDisabled) throw new Error("This account has been disabled.");

  // Reject demo accounts explicitly
  const isDemoUser = await prisma.businessMember.findFirst({
    where: {
      userId: user.id,
      business: { isDemo: true, portalKind: "demo" },
    },
  });
  if (isDemoUser && user.platformRole !== "super_admin") {
    throw new Error(
      "Demo accounts cannot access Super Admin. Use the Demo portal at /demo/login."
    );
  }

  if (user.platformRole !== "super_admin") {
    throw new Error(
      "Customer accounts cannot access Super Admin. Use the Customer portal at /login."
    );
  }

  const { createUserSession } = await import("./session.service.js");
  // Super Admin: allow multiple ops sessions (enterprise unlimited)
  const created = await createUserSession({
    userId: user.id,
    businessId: null,
    portal: "admin",
    device: {},
    forceNewSession: true,
  });

  await recordAudit({
    actorUserId: user.id,
    action: "platform_login",
    entityType: "user",
    entityId: user.id,
    metadata: { email: user.email, portal: "admin", sessionId: created.sessionId },
  });

  const token = await issueAuthToken(user.id, "admin", { sid: created.sessionId });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformRole: user.platformRole,
      themePreference: normalizeThemePreference(
        (user as { themePreference?: string }).themePreference
      ),
    },
    token,
    portal: "admin",
  };
}

/** Demo portal login — sample workspace only */
export async function loginDemoUser(input: LoginInput): Promise<AuthResponse> {
  const { ensureDemoWorkspace, DEMO_EMAIL } = await import("./demo.service.js");
  await ensureDemoWorkspace();
  const { normalizeLoginPassword } = await import("../lib/password-policy.js");
  const email = input.email.toLowerCase().trim();
  const password = normalizeLoginPassword(input.password);

  const user = await prisma.user.findUnique({
    where: { email },
  });
  if (!user) throw new Error("Invalid email or password");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("Invalid email or password");
  if (user.isDisabled) throw new Error("This account has been disabled.");

  // Super Admin never uses demo portal
  if (user.platformRole === "super_admin") {
    throw new Error(
      "Super Admin accounts cannot access the Demo portal. Use /admin/login."
    );
  }

  const demoMember = await prisma.businessMember.findFirst({
    where: {
      userId: user.id,
      business: { isDemo: true, portalKind: "demo" },
    },
    include: { business: true },
  });
  if (!demoMember) {
    throw new Error(
      "Customer accounts cannot access the Demo portal. Use the Customer portal at /login, or sign in with the demo account."
    );
  }

  return issueDemoAuthResponse({
    user,
    businessId: demoMember.businessId,
    demoEmailHint: DEMO_EMAIL,
  });
}

/**
 * One-click demo entry — server uses configured DEMO_EMAIL / DEMO_PASSWORD.
 * Never requires the client to know or display the password.
 */
export async function enterDemoSession(): Promise<AuthResponse> {
  const { ensureDemoWorkspace, DEMO_EMAIL, DEMO_PASSWORD } = await import(
    "./demo.service.js"
  );
  await ensureDemoWorkspace();
  return loginDemoUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
}

async function issueDemoAuthResponse(opts: {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string | null;
    platformRole: string | null;
  };
  businessId: string;
  demoEmailHint: string;
}): Promise<AuthResponse> {
  const { createUserSession } = await import("./session.service.js");
  const created = await createUserSession({
    userId: opts.user.id,
    businessId: opts.businessId,
    portal: "demo",
    device: {},
    forceNewSession: true,
  });

  await recordAudit({
    businessId: opts.businessId,
    actorUserId: opts.user.id,
    action: "demo_login",
    entityType: "user",
    entityId: opts.user.id,
    metadata: {
      email: opts.user.email,
      portal: "demo",
      demoEmailHint: opts.demoEmailHint,
      sessionId: created.sessionId,
    },
  });

  const token = await issueAuthToken(opts.user.id, "demo", { sid: created.sessionId });

  return {
    user: {
      id: opts.user.id,
      email: opts.user.email,
      name: opts.user.name,
      role: opts.user.role || undefined,
      platformRole: opts.user.platformRole || undefined,
      businessId: opts.businessId,
    },
    token,
    portal: "demo",
  };
}

/** Short-lived customer token for Super Admin support mode (audited separately) */
export async function issueSupportCustomerToken(opts: {
  targetUserId: string;
  supportActorId: string;
  businessId: string;
}): Promise<string> {
  const { createUserSession } = await import("./session.service.js");
  const created = await createUserSession({
    userId: opts.targetUserId,
    businessId: opts.businessId,
    portal: "customer",
    device: {},
    forceNewSession: true,
    supportMode: true,
    ttlDays: 1,
  });
  return issueAuthToken(
    opts.targetUserId,
    "customer",
    {
      supportMode: true,
      supportActorId: opts.supportActorId,
      supportBusinessId: opts.businessId,
      sid: created.sessionId,
    },
    SUPPORT_JWT_EXPIRES_IN
  );
}

export type AuthUserFull = AuthUser & {
  isDisabled?: boolean;
  tokenVersion?: number;
};

const THEME_PREFS = new Set(["light", "dark", "system"]);

export function normalizeThemePreference(value: unknown): "light" | "dark" | "system" {
  if (typeof value === "string" && THEME_PREFS.has(value)) {
    return value as "light" | "dark" | "system";
  }
  return "system";
}

export async function updateUserThemePreference(
  userId: string,
  theme: string
): Promise<"light" | "dark" | "system"> {
  const themePreference = normalizeThemePreference(theme);
  await prisma.user.update({
    where: { id: userId },
    data: { themePreference },
  });
  return themePreference;
}

export async function getUserById(userId: string): Promise<AuthUserFull | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      platformRole: true,
      isDisabled: true,
      tokenVersion: true,
      themePreference: true,
    },
  });

  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    platformRole: user.platformRole,
    isDisabled: user.isDisabled,
    tokenVersion: user.tokenVersion ?? 0,
    themePreference: normalizeThemePreference(user.themePreference),
  };
}

export function verifyToken(
  token: string,
  expectedPortal?: PortalAudience
): JwtPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as JwtPayload & { userId: string };
    // Legacy tokens (no portal claim) → customer only
    const portal: PortalAudience = decoded.portal || "customer";
    if (expectedPortal && portal !== expectedPortal) {
      throw new Error(`Token is not valid for the ${expectedPortal} portal`);
    }
    return {
      userId: decoded.userId,
      portal,
      tv: typeof decoded.tv === "number" ? decoded.tv : 0,
      supportMode: decoded.supportMode,
      supportActorId: decoded.supportActorId,
      supportBusinessId: decoded.supportBusinessId,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("not valid for")) throw error;
    throw new Error("Invalid or expired token");
  }
}
