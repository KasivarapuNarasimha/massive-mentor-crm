import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import {
  detectDefaultCurrency,
  isCurrencyCode,
  SUPPORTED_CURRENCY_CODES,
} from "../lib/currency.js";

export const profileSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  industry: z.string().min(1, "Industry is required"),
  description: z.string().max(2000).optional(),
  employeeCount: z.number().int().min(1).optional().nullable(),
  currency: z
    .string()
    .optional()
    .nullable()
    .refine((v) => v == null || v === "" || isCurrencyCode(v), {
      message: `currency must be one of: ${SUPPORTED_CURRENCY_CODES.join(", ")}`,
    }),
  annualRevenue: z.string().optional().nullable(),
  stage: z.enum(["idea", "mvp", "early_revenue", "growth", "scaling"]).optional().nullable(),
  targetMarket: z.string().optional().nullable(),
  mainProduct: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export async function getProfile(userId: string) {
  const profile = await prisma.businessProfile.findUnique({
    where: { userId },
  });

  // Tenant currency from Business.settings (provisioned by Super Admin) wins over
  // per-user profile / location guesses — fixes SE users with no profile showing USD.
  let businessCurrency: string | null = null;
  try {
    const { getUserBusinessId } = await import("./field-engine.service.js");
    const { resolveBusinessCurrency } = await import("./template.service.js");
    const businessId = await getUserBusinessId(userId);
    if (businessId) {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { settings: true, country: true },
      });
      businessCurrency = resolveBusinessCurrency(biz);
    }
  } catch {
    /* ignore */
  }

  if (!profile) {
    return businessCurrency
      ? {
          businessName: "",
          industry: "",
          description: "",
          currency: businessCurrency,
        }
      : null;
  }

  const currency =
    businessCurrency ||
    (profile as { currency?: string | null }).currency ||
    detectDefaultCurrency(profile.location);

  return { ...profile, currency };
}

export async function upsertProfile(userId: string, input: ProfileInput) {
  const currency =
    (input.currency && isCurrencyCode(input.currency) && input.currency) ||
    detectDefaultCurrency(input.location);

  const profile = await prisma.businessProfile.upsert({
    where: { userId },
    create: {
      userId,
      businessName: input.businessName,
      industry: input.industry,
      description: input.description || "",
      employeeCount: input.employeeCount ?? null,
      currency,
      annualRevenue: input.annualRevenue ?? null,
      stage: input.stage ?? null,
      targetMarket: input.targetMarket ?? null,
      mainProduct: input.mainProduct ?? null,
      location: input.location ?? null,
    },
    update: {
      businessName: input.businessName,
      industry: input.industry,
      description: input.description || "",
      employeeCount: input.employeeCount ?? null,
      currency,
      annualRevenue: input.annualRevenue ?? null,
      stage: input.stage ?? null,
      targetMarket: input.targetMarket ?? null,
      mainProduct: input.mainProduct ?? null,
      location: input.location ?? null,
    },
  });

  return profile;
}
