import { Request, Response } from 'express';
import { getAIService } from '@/services/ai.service';
import { PromptTemplates } from '@/services/ai/prompt-templates';
import { AuthenticatedRequest } from '@/middleware/auth';

export async function testAI(req: AuthenticatedRequest, res: Response) {
  try {
    const ai = await getAIService();

    // Use sample data or data from request body
    const profile = req.body?.profile || {
      businessName: 'Acme Analytics',
      industry: 'SaaS',
      description: 'We help small e-commerce brands understand their customers through simple analytics dashboards.',
      stage: 'early_revenue',
      mainProduct: 'Customer Insights Dashboard',
      targetMarket: 'Early-stage DTC e-commerce brands with $50k-$300k revenue',
      employeeCount: 4,
      annualRevenue: '$50K - $200K',
    };

    const response = await ai.generateFromTemplate('testStrengths', profile);

    res.json({
      success: true,
      data: {
        provider: ai.getProvider(),
        result: response.data,
        usage: response.usage,
      },
    });
  } catch (error: unknown) {
    console.error('AI Test Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'AI service error';
    const errorCode = (error as { code?: string }).code || 'AI_ERROR';
    res.status(500).json({
      success: false,
      error: errorMessage,
      code: errorCode,
    });
  }
}
