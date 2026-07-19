import { Router } from "express";
import {
  register,
  login,
  logout,
  getCurrentUser,
  forgotPasswordCustomer,
  validatePasswordResetToken,
  resetPasswordWithToken,
} from "@/controllers/auth.controller";
import { requireAuth } from "@/middleware/auth";
import { loginLimiter, registerLimiter, passwordResetLimiter } from "@/middleware/rateLimiter";

const router: Router = Router();

// Public register disabled (sales-led SaaS). Endpoint kept for clear 403 message.
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, getCurrentUser);

// Forgot / reset password (Customer Portal)
router.post("/forgot-password", passwordResetLimiter, forgotPasswordCustomer);
router.get("/reset-password/validate", passwordResetLimiter, validatePasswordResetToken);
router.post("/reset-password", passwordResetLimiter, resetPasswordWithToken);

export default router;
