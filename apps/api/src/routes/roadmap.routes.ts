import { Router } from "express";
import { generateRoadmap, getCurrentRoadmap } from "@/controllers/roadmap.controller";
import { requireAuth } from "@/middleware/auth";

const router: Router = Router();

router.post("/generate", requireAuth, generateRoadmap);
router.get("/", requireAuth, getCurrentRoadmap);

export default router;
