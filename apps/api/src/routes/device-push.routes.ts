import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  registerPushToken,
  refreshPushToken,
  revokePushToken,
} from "../controllers/device-push.controller.js";

const router: Router = Router();

router.use(requireAuth);

/** Register or upsert device push token (login / token rotation) */
router.post("/push-token", registerPushToken);
/** Explicit refresh */
router.put("/push-token", refreshPushToken);
/** Revoke current install (logout) or allDevices when explicitly requested */
router.delete("/push-token", revokePushToken);

export default router;
