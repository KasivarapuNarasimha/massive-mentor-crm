/**
 * SaaS subscription plan catalog (Starter / Professional / Enterprise × Monthly / Annual).
 * `price` on these rows is the frozen pre-2026 flat amount. New checkouts use
 * saas-pricing.ts. Existing rows are never updated, so current subscriptions
 * keep the plan id, price, and seat cap they already point at.
 */
import { prisma } from "../lib/prisma.js";

export const DEFAULT_PLANS = [
  {
    code: "starter_monthly",
    name: "Starter Monthly",
    description: "Frozen legacy flat price. New subscriptions are ₹300 per user / month.",
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
    description: "Frozen legacy annual price. New subscriptions are ₹3,600 per user / year.",
    billingCycle: "annual",
    // Frozen: 1499 × 12 = 17,988 with 10% off. Do not reprice existing rows.
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
    ],
    displayOrder: 11,
  },
  {
    code: "professional_monthly",
    name: "Professional Monthly",
    description: "Frozen legacy flat price. New subscriptions are ₹600 per user / month.",
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
    description: "Frozen legacy annual price. New subscriptions are ₹7,200 per user / year.",
    billingCycle: "annual",
    // Frozen: 6999 × 12 = 83,988 with 10% off. Do not reprice existing rows.
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

/**
 * Create missing catalog rows only. Never update price, seat cap, name, or
 * features on a row that already exists — live subscriptions point at these rows.
 */
export async function ensureSubscriptionPlans() {
  for (const p of DEFAULT_PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { code: p.code } });
    if (existing) continue;
    await prisma.subscriptionPlan.create({
      data: {
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
