/**
 * SaaS subscription plan catalog (Starter / Professional / Enterprise × Monthly / Annual).
 * Pricing display + seed only — checkout still uses plan.price from DB.
 */
import { prisma } from "@/lib/prisma";

export const DEFAULT_PLANS = [
  {
    code: "starter_monthly",
    name: "Starter Monthly",
    description: "Core CRM for small teams — up to 3 users included",
    billingCycle: "monthly",
    price: 1499,
    maxUsers: 3,
    storageGb: 5,
    features: [
      "Lead Management",
      "Client Management",
      "Deal Pipeline",
      "Tasks",
      "Meetings",
      "Dashboard",
      "Reports",
      "Email Support",
    ],
    displayOrder: 10,
  },
  {
    code: "starter_annual",
    name: "Starter Annual",
    description: "Core CRM for small teams — billed annually (save 10%)",
    billingCycle: "annual",
    // 1499 × 12 = 17,988 → 10% off = 16,189
    price: 16189,
    maxUsers: 3,
    storageGb: 5,
    features: [
      "Lead Management",
      "Client Management",
      "Deal Pipeline",
      "Tasks",
      "Meetings",
      "Dashboard",
      "Reports",
      "Email Support",
      "Save 10% vs monthly",
    ],
    displayOrder: 11,
  },
  {
    code: "professional_monthly",
    name: "Professional Monthly",
    description: "Full CRM + AI + Marketing + Finance — up to 10 users",
    billingCycle: "monthly",
    price: 6999,
    maxUsers: 10,
    storageGb: 50,
    features: [
      "Everything in Starter",
      "AI Proposal Generator",
      "SWOT Analysis",
      "AI Sales Forecast",
      "AI Next Best Action",
      "Marketing AI",
      "Finance Module",
      "Advanced Reports",
      "WhatsApp Integration",
      "Email Automation",
      "Priority Support",
    ],
    displayOrder: 20,
  },
  {
    code: "professional_annual",
    name: "Professional Annual",
    description: "Full CRM + AI + Marketing + Finance — annual (save 10%)",
    billingCycle: "annual",
    // 6999 × 12 = 83,988 → 10% off = 75,589
    price: 75589,
    maxUsers: 10,
    storageGb: 50,
    features: [
      "Everything in Starter",
      "AI Proposal Generator",
      "SWOT Analysis",
      "AI Sales Forecast",
      "AI Next Best Action",
      "Marketing AI",
      "Finance Module",
      "Advanced Reports",
      "WhatsApp Integration",
      "Email Automation",
      "Priority Support",
      "Save 10% vs monthly",
    ],
    displayOrder: 21,
  },
  {
    code: "enterprise_monthly",
    name: "Enterprise Monthly",
    description: "Custom pricing for large teams, white-label, and dedicated support",
    billingCycle: "monthly",
    // Not shown in UI — Contact Sales / Schedule Demo
    price: 0,
    maxUsers: 500,
    storageGb: 500,
    features: [
      "Everything in Professional",
      "White Label CRM",
      "Custom Branding",
      "API Access",
      "Custom Integrations",
      "AI Telecalling Integration",
      "Dedicated Account Manager",
      "Premium Support",
      "Advanced Security",
    ],
    displayOrder: 30,
  },
  {
    code: "enterprise_annual",
    name: "Enterprise Annual",
    description: "Custom annual pricing for large organizations",
    billingCycle: "annual",
    price: 0,
    maxUsers: 500,
    storageGb: 500,
    features: [
      "Everything in Professional",
      "White Label CRM",
      "Custom Branding",
      "API Access",
      "Custom Integrations",
      "AI Telecalling Integration",
      "Dedicated Account Manager",
      "Premium Support",
      "Advanced Security",
    ],
    displayOrder: 31,
  },
] as const;

/** Idempotent seed of catalog plans */
export async function ensureSubscriptionPlans() {
  for (const p of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        description: p.description,
        billingCycle: p.billingCycle,
        price: p.price,
        currency: "INR",
        maxUsers: p.maxUsers,
        storageGb: p.storageGb,
        features: [...p.features],
        displayOrder: p.displayOrder,
        status: "active",
      },
      update: {
        name: p.name,
        description: p.description,
        price: p.price,
        maxUsers: p.maxUsers,
        storageGb: p.storageGb,
        features: [...p.features],
        displayOrder: p.displayOrder,
        status: "active",
      },
    });
  }
  return prisma.subscriptionPlan.findMany({
    where: { status: "active" },
    orderBy: { displayOrder: "asc" },
  });
}

export async function listActivePlans() {
  await ensureSubscriptionPlans();
  return prisma.subscriptionPlan.findMany({
    where: { status: "active" },
    orderBy: { displayOrder: "asc" },
  });
}

export async function getPlanByCode(code: string) {
  await ensureSubscriptionPlans();
  return prisma.subscriptionPlan.findUnique({ where: { code } });
}

export async function getPlanById(id: string) {
  return prisma.subscriptionPlan.findUnique({ where: { id } });
}
