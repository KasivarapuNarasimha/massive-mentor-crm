import { Router } from "express";
import {
  getCurrentUserRole,
  updateRole,
  createNewTeam,
  addMember,
  listTeamMembers,
  listMyTeams,
} from "../controllers/team.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router: Router = Router();

// Mounted at /api/teams — paths are relative to that prefix
router.get("/role", requireAuth, getCurrentUserRole);
router.post("/role", requireAuth, requireRole(["admin"]), updateRole);
// Canonical list/create (preferred)
router.get("/", requireAuth, listMyTeams);
router.post("/", requireAuth, requireRole(["manager", "admin"]), createNewTeam);
router.post("/members", requireAuth, requireRole(["manager", "admin"]), addMember);
router.get("/:teamId/members", requireAuth, listTeamMembers);
// Legacy aliases (double "teams" paths used by older clients)
router.post("/teams", requireAuth, requireRole(["manager", "admin"]), createNewTeam);
router.post("/teams/members", requireAuth, requireRole(["manager", "admin"]), addMember);
router.get("/teams/:teamId/members", requireAuth, listTeamMembers);
router.get("/teams", requireAuth, listMyTeams);

export default router;