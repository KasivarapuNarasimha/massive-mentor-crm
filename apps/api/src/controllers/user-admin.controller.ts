import { Response } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../middleware/auth.js";
import {
  createBusinessUser,
  listBusinessUsers,
  updateBusinessUser,
  updateBusinessUserRole,
  setBusinessUserDisabled,
  deleteBusinessUser,
  ASSIGNABLE_ROLES,
} from "../services/user-admin.service.js";
import { getBusinessConfig } from "../services/template.service.js";
import { ensureDefaultBusiness } from "../services/business.service.js";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(120).optional(),
  role: z.string().min(1),
});

const updateUserSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  email: z.string().email().optional(),
  role: z.string().min(1).optional(),
  password: z.string().min(8).optional(),
});

function adminStatus(message: string) {
  if (message.includes("Only Business Admin") || message.includes("Only CEO")) return 403;
  if (message.includes("already")) return 409;
  if (message.includes("not a member") || message.includes("not found")) return 404;
  return 400;
}

export async function createUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }
    const result = await createBusinessUser({
      actorUserId: req.user.id,
      ...parsed.data,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create user";
    res.status(adminStatus(message)).json({ success: false, error: message });
  }
}

export async function listUsers(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await listBusinessUsers(req.user.id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list users";
    res.status(adminStatus(message) === 400 ? 500 : adminStatus(message)).json({
      success: false,
      error: message,
    });
  }
}

export async function updateUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const userId = String(req.params.userId || "");
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }
    const result = await updateBusinessUser({
      actorUserId: req.user.id,
      userId,
      ...parsed.data,
    });
    res.json({ success: true, data: { user: result } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update user";
    res.status(adminStatus(message)).json({ success: false, error: message });
  }
}

export async function updateUserRole(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const userId = String(req.params.userId || "");
    const role = String(req.body?.role || "");
    if (!userId || !role) {
      return res.status(400).json({ success: false, error: "userId and role required" });
    }
    const result = await updateBusinessUserRole({
      actorUserId: req.user.id,
      userId,
      role,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update role";
    res.status(adminStatus(message)).json({ success: false, error: message });
  }
}

export async function disableUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const userId = String(req.params.userId || "");
    const disabled = req.body?.disabled !== false && req.body?.disabled !== "false";
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    const result = await setBusinessUserDisabled({
      actorUserId: req.user.id,
      userId,
      disabled: !!disabled,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update status";
    res.status(adminStatus(message)).json({ success: false, error: message });
  }
}

export async function removeUser(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const userId = String(req.params.userId || "");
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    const result = await deleteBusinessUser({
      actorUserId: req.user.id,
      userId,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete user";
    res.status(adminStatus(message)).json({ success: false, error: message });
  }
}

/** Roles available to assign (from business config when present) */
export async function listAssignableRoles(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const biz = await ensureDefaultBusiness(req.user.id);
    const config = await getBusinessConfig(biz.id);
    const fromConfig = Array.isArray(config?.roles)
      ? (config!.roles as Array<{ key: string; label: string }>).map((r) => ({
          key: r.key,
          label: r.label || r.key,
        }))
      : [];
    const roles =
      fromConfig.length > 0
        ? fromConfig.filter((r) => r.key !== "super_admin")
        : ASSIGNABLE_ROLES.map((key) => ({ key, label: key }));
    res.json({ success: true, data: { roles } });
  } catch {
    res.status(500).json({ success: false, error: "Failed to list roles" });
  }
}
