import { Router } from "express";
import { requirePlatformAdmin } from "@/middleware/auth";
import * as ctrl from "@/controllers/platform.controller";
import * as backupCtrl from "@/controllers/backup.controller";
import {
  forgotPasswordAdmin,
  validatePasswordResetToken,
  resetPasswordWithToken,
} from "@/controllers/auth.controller";
import { passwordResetLimiter, loginLimiter } from "@/middleware/rateLimiter";

const router: Router = Router();

// Separate Super Admin authentication (not customer login) — rate-limited against brute force
router.post("/auth/login", loginLimiter, ctrl.platformLogin);

// Super Admin forgot password (same secure token flow as customer; portal=admin)
router.post("/auth/forgot-password", passwordResetLimiter, forgotPasswordAdmin);
router.get("/auth/reset-password/validate", passwordResetLimiter, validatePasswordResetToken);
router.post("/auth/reset-password", passwordResetLimiter, resetPasswordWithToken);

// All management routes require Super Admin JWT (portal=admin)
router.get("/auth/me", requirePlatformAdmin, ctrl.platformMe);

router.get("/analytics", requirePlatformAdmin, ctrl.analytics);
router.get("/revenue", requirePlatformAdmin, ctrl.revenueDashboard);
router.get("/usage-dashboard", requirePlatformAdmin, ctrl.usageDashboard);
router.get("/health", requirePlatformAdmin, ctrl.health);
router.get("/audit", requirePlatformAdmin, ctrl.auditLog);
router.get("/events", requirePlatformAdmin, ctrl.systemEvents);

router.get("/businesses", requirePlatformAdmin, ctrl.listBusinesses);
router.post("/businesses", requirePlatformAdmin, ctrl.createBusiness);
router.post("/businesses/bulk", requirePlatformAdmin, ctrl.bulkAction);
router.get("/businesses/:id", requirePlatformAdmin, ctrl.getBusiness);
router.post("/businesses/:id/suspend", requirePlatformAdmin, ctrl.suspendBusiness);
router.post("/businesses/:id/activate", requirePlatformAdmin, ctrl.activateBusiness);
router.post("/businesses/:id/extend-trial", requirePlatformAdmin, ctrl.extendTrial);
router.post("/businesses/:id/reset-trial", requirePlatformAdmin, ctrl.resetTrial);
router.delete("/businesses/:id", requirePlatformAdmin, ctrl.deleteBusiness);
router.post("/businesses/:id/restore", requirePlatformAdmin, ctrl.restoreBusiness);
router.post("/businesses/:id/plan", requirePlatformAdmin, ctrl.changePlan);
router.put("/businesses/:id/white-label", requirePlatformAdmin, ctrl.updateWhiteLabel);
router.get("/businesses/:id/usage", requirePlatformAdmin, ctrl.usage);
router.get("/businesses/:id/export", requirePlatformAdmin, ctrl.exportBusiness);
router.post("/businesses/:id/users", requirePlatformAdmin, ctrl.addUser);
router.post("/businesses/:id/users/:userId/disable", requirePlatformAdmin, ctrl.disableUser);
router.post("/businesses/:id/users/:userId/reset-password", requirePlatformAdmin, ctrl.resetPassword);

router.get("/invoices", requirePlatformAdmin, ctrl.listInvoices);
router.post("/invoices", requirePlatformAdmin, ctrl.createInvoice);
router.post("/invoices/:id/paid", requirePlatformAdmin, ctrl.markInvoicePaid);

router.get("/licenses", requirePlatformAdmin, ctrl.listLicenses);

router.get("/tickets", requirePlatformAdmin, ctrl.listTickets);
router.post("/tickets", requirePlatformAdmin, ctrl.createTicket);
router.patch("/tickets/:id", requirePlatformAdmin, ctrl.updateTicket);

// Support mode — audited login-as-customer
router.post("/support/login-as", requirePlatformAdmin, ctrl.supportLoginAs);

// —— Enterprise Backup & Restore (Super Admin) ——
router.get("/backups", requirePlatformAdmin, backupCtrl.platformListBackups);
router.post("/backups", requirePlatformAdmin, backupCtrl.platformCreateBackup);
router.get("/backups/:id", requirePlatformAdmin, backupCtrl.platformGetBackup);
router.post("/backups/:id/verify", requirePlatformAdmin, backupCtrl.platformVerifyBackup);
router.get("/backups/:id/download", requirePlatformAdmin, backupCtrl.platformDownloadBackup);
router.delete("/backups/:id", requirePlatformAdmin, backupCtrl.platformDeleteBackup);
router.post("/backups/:id/restore", requirePlatformAdmin, backupCtrl.platformRequestRestore);
router.get("/restores", requirePlatformAdmin, backupCtrl.platformListRestores);
router.post("/restores/:restoreId/confirm", requirePlatformAdmin, backupCtrl.platformConfirmRestore);
router.get("/backup-schedules", requirePlatformAdmin, backupCtrl.platformListSchedules);
router.put("/backup-schedules", requirePlatformAdmin, backupCtrl.platformUpsertSchedule);

export default router;
