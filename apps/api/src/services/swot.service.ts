import { prisma } from "../lib/prisma.js";
import { getAIService } from "./ai.service.js";
import { BusinessProfile } from "@prisma/client";
import { sanitizePromptInput } from "../utils/sanitize.js";

interface SWOTResult {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  summary: string;
}

export async function generateAndSaveSWOT(userId: string) {
  const profile = await prisma.businessProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw new Error("Business profile not found. Please complete your profile before generating a SWOT analysis.");
  }

  const ai = await getAIService();

  const response = await ai.generateFromTemplate<SWOTResult>("swotAnalysis", {
    businessName: sanitizePromptInput(profile.businessName),
    industry: sanitizePromptInput(profile.industry),
    description: sanitizePromptInput(profile.description),
    stage: sanitizePromptInput(profile.stage),
    employeeCount: profile.employeeCount,
    annualRevenue: sanitizePromptInput(profile.annualRevenue),
    mainProduct: sanitizePromptInput(profile.mainProduct),
    targetMarket: sanitizePromptInput(profile.targetMarket),
    location: sanitizePromptInput(profile.location),
  });

  const swotData = response.data;

  // Save to database
  const savedSWOT = await prisma.sWOTAnalysis.create({
    data: {
      userId,
      strengths: swotData.strengths,
      weaknesses: swotData.weaknesses,
      opportunities: swotData.opportunities,
      threats: swotData.threats,
      summary: swotData.summary,
      aiModel: response.usage?.model || "gpt-4o-mini",
    },
  });

  return savedSWOT;
}

export async function getLatestSWOT(userId: string) {
  return prisma.sWOTAnalysis.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
