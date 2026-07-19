import { Response } from "express";
import { AuthenticatedRequest } from "@/middleware/auth";
import {
  createTeam,
  addTeamMember,
  getTeamMembers,
  updateUserRole,
  getUserRole,
  ROLES,
  getUserTeams,
} from "@/services/team.service";

export async function getCurrentUserRole(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const role = await getUserRole(req.user.id);
    res.json({ success: true, data: { role } });
  } catch {
    res.status(500).json({ success: false, error: "Failed" });
  }
}

export async function updateRole(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const currentRole = req.user.role || (await getUserRole(req.user.id));
    if (currentRole !== "admin" && currentRole !== "business_admin") {
      return res.status(403).json({ success: false, error: "Permission denied" });
    }
    const { userId, role } = req.body;
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ success: false, error: "userId required" });
    }
    if (!ROLES.includes(role)) return res.status(400).json({ success: false, error: "Invalid role" });
    await updateUserRole(req.user.id, userId, role);
    res.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    const status = msg.includes("Permission") || msg.includes("outside") ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
}

export async function createNewTeam(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { name } = req.body;
    const team = await createTeam(req.user.id, name);
    res.status(201).json({ success: true, data: { team } });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create team",
    });
  }
}

export async function addMember(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { teamId, userId, role } = req.body;
    if (!teamId || !userId) {
      return res.status(400).json({ success: false, error: "teamId and userId required" });
    }
    const member = await addTeamMember(req.user.id, teamId, userId, role);
    res.json({ success: true, data: { member } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    const status = msg.includes("Permission") ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
}

export async function listTeamMembers(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const teamId = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
    if (!teamId) return res.status(400).json({ success: false, error: "teamId required" });
    const members = await getTeamMembers(req.user.id, teamId);
    res.json({ success: true, data: { members } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    const status = msg.includes("Permission") ? 403 : 400;
    res.status(status).json({ success: false, error: msg });
  }
}

export async function listMyTeams(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const teams = await getUserTeams(req.user.id);
    res.json({ success: true, data: { teams } });
  } catch {
    res.status(500).json({ success: false, error: "Failed" });
  }
}
