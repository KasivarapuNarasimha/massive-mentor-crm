import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createUser,
  listUsers,
  updateUser,
  updateUserRole,
  disableUser,
  removeUser,
  listAssignableRoles,
} from "../controllers/user-admin.controller.js";

const router: Router = Router();

router.get("/roles", requireAuth, listAssignableRoles);
router.get("/", requireAuth, listUsers);
router.post("/", requireAuth, createUser);
router.put("/:userId", requireAuth, updateUser);
router.put("/:userId/role", requireAuth, updateUserRole);
router.post("/:userId/disable", requireAuth, disableUser);
router.delete("/:userId", requireAuth, removeUser);

export default router;
