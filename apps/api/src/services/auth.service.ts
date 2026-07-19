import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { env } from "@/config/env";
import { ensureDefaultBusiness, createBusinessWithTemplate } from "@/services/business.service";
import { recordAudit } from "@/services/audit.service";
import { seedIndustryTemplates, getTemplateByIdOrSlug } from "@/services/template.service";
import { resolveOrCreateCustomerOwner } from "@/services/customer-owner.service";
import type { PortalAudience } from "@/types/portal";

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
  await seedIndustryTemplates();

  // Resolve industry template (metadata-driven catalog)
  let templateSlug = (input.templateSlug || "generic").trim().toLowerCase().replace(/\s+/g, "_");
  // Map common UI labels / aliases
  const aliases: Record<string, string> = {
    other: "generic",
    "digital_marketing_agency": "digital_marketing",
    digitalmarketing: "digital_marketing",
    "software": "software_company",
    "real-estate": "real_estate",
    realestate: "real_estate",
    coaching: "coaching_institute",
  };
  if (aliases[templateSlug]) templateSlug = aliases[templateSlug];

  const template = await getTemplateByIdOrSlug(templateSlug);
  if (!template && templateSlug !== "generic") {
    // Try match by name
    const byName = await prisma.industryTemplate.findFirst({
      where: {
        OR: [
          { name: { equals: input.industryLabel || input.templateSlug || "", mode: "insensitive" } },
          { slug: templateSlug },
        ],
        isPublished: true,
      },
    });
    if (byName) templateSlug = byName.slug;
    else templateSlug = "generic";
  } else if (template) {
    templateSlug = template.slug;
  }

  const businessName = (input.businessName || input.name || "My Business").trim();
  const industryLabel = input.industryLabel || template?.name || "Other";

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
 * Customer portal login only (app.massivementor.in).
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
  } = await import("@/services/session.service");

  const email = input.email.toLowerCase().trim();
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

  const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);

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
  const customerMember = await prisma.businessMember.findFirst({
    where: {
      userId: user.id,
      business: { isDemo: false, portalKind: "customer", status: { not: "deleted" } },
    },
  });
  if (demoOnly && !customerMember) {
    throw new Error("Demo accounts must sign in at the Demo portal (demo.massivementor.in).");
  }

  // Ensure tenant + backfill CRM businessId (idempotent)
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
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (!user) throw new Error("Invalid email or password");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
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

  const { createUserSession } = await import("@/services/session.service");
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
    },
    token,
    portal: "admin",
  };
}

/** Demo portal login — sample workspace only */
export async function loginDemoUser(input: LoginInput): Promise<AuthResponse> {
  const { ensureDemoWorkspace, DEMO_EMAIL } = await import("@/services/demo.service");
  await ensureDemoWorkspace();

  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  if (!user) throw new Error("Invalid email or password");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
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

  const { createUserSession } = await import("@/services/session.service");
  const created = await createUserSession({
    userId: user.id,
    businessId: demoMember.businessId,
    portal: "demo",
    device: {},
    forceNewSession: true,
  });

  // Demo-only: user must not be treated as a normal multi-tenant customer session here
  await recordAudit({
    businessId: demoMember.businessId,
    actorUserId: user.id,
    action: "demo_login",
    entityType: "user",
    entityId: user.id,
    metadata: {
      email: user.email,
      portal: "demo",
      demoEmailHint: DEMO_EMAIL,
      sessionId: created.sessionId,
    },
  });

  const token = await issueAuthToken(user.id, "demo", { sid: created.sessionId });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformRole: user.platformRole,
      businessId: demoMember.businessId,
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
  const { createUserSession } = await import("@/services/session.service");
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
