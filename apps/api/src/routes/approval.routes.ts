import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/approval.controller.js";

const router: Router = Router();

router.get("/workflows", requireAuth, ctrl.listWorkflows);
router.put("/workflows", requireAuth, ctrl.upsertWorkflow);
router.get("/stats", requireAuth, ctrl.stats);
router.get("/requests", requireAuth, ctrl.listRequests);
router.post("/requests", requireAuth, ctrl.submitRequest);
router.get("/requests/:id", requireAuth, ctrl.getRequest);
router.post("/requests/:id/act", requireAuth, ctrl.actOnRequest);

export default router;
