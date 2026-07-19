import { Router } from 'express';
import { testAI } from '@/controllers/ai.controller';
import { requireAuth } from '@/middleware/auth';

const router: Router = Router();

// Test endpoint for Milestone 4
router.post('/test', requireAuth, testAI);

export default router;
