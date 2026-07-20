/**
 * Super Admin: create customer business after sales close.
 * Full provision: user, business, trial, emails, audit.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { recordAudit } from "./audit.service.js";
import {
  sendEmail,
  buildWelcomeAccountEmail,
  getLoginUrl,
} from "./email.service.js";
import { createBusinessWithTemplate } from "./business.service.js";
import { resolveOrCreateCustomerOwner } from "./customer-owner.service.js";
import { startTrialForBusiness, trialDaysDefault } from "./saas-billing.service.js";
import { ensureSubscriptionPlans } from "./subscription-plan.service.js";

function generateTempPassword(): string {
  // Readable + strong enough (12 chars)
  const raw = crypto.randomBytes(9).toString("base64url");
  return `Mm@${raw.slice(0, 9)}!`;
}

export type CreateCustomerInput = {
  actorUserId: string;
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  ownerMobile?: string;
  businessAddress?: string;
  gstNumber?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  maxUsers?: number;
  planCode?: string; // optional paid plan code; default trial
  notes?: string;
  templateSlug?: string;
  trialDays?: number;
};

export async function provisionCustomer(input: CreateCustomerInput) {
  const email = input.ownerEmail.toLowerCase().trim();
  const company = input.companyName.trim();
  if (!company) throw new Error("Company name is required");
  if (!email) throw new Error("Owner email is required");

  await ensureSubscriptionPlans();

  const tempPassword = generateTempPassword();
  const trialDays = input.trialDays ?? trialDaysDefault();

  const owner = await resolveOrCreateCustomerOwner({
    email,
    password: tempPassword,
    name: input.ownerName.trim() || email.split("@")[0],
    businessName: company,
    industryLabel: "Other",
  });

  // Force password to temp on provision (even if user reused)
  const hash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.update({
    where: { id: owner.userId },
    data: {
      passwordHash: hash,
      name: input.ownerName.trim() || undefined,
      isDisabled: false,
      tokenVersion: { increment: 1 },
    },
  });

  const business = await createBusinessWithTemplate({
    ownerUserId: owner.userId,
    businessName: company,
    templateSlug: input.templateSlug || "generic",
    memberRole: "business_admin",
  });

  // Owner membership role: business_admin = CRM owner
  await prisma.businessMember.updateMany({
    where: { businessId: business.id, userId: owner.userId },
    data: { role: "business_admin" },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: {
      portalKind: "customer",
      isDemo: false,
      billingEmail: email,
      ownerPhone: input.ownerMobile?.trim() || null,
      address: input.businessAddress?.trim() || null,
      gstNumber: input.gstNumber?.trim() || null,
      country: input.country?.trim() || "IN",
      timezone: input.timezone?.trim() || "Asia/Kolkata",
      maxUsers: input.maxUsers && input.maxUsers > 0 ? input.maxUsers : 5,
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
      licenseKey: `MM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
      settings: {
        provisionNotes: input.notes || null,
        currency: input.currency || "INR",
        provisionedBy: input.actorUserId,
        provisionedAt: new Date().toISOString(),
      },
    },
  });

  // Profile currency for CRM formatting
  await prisma.businessProfile.upsert({
    where: { userId: owner.userId },
    create: {
      userId: owner.userId,
      businessName: company,
      industry: "Other",
      description: "",
      currency: input.currency || "INR",
      location: input.businessAddress || input.country || null,
    },
    update: {
      businessName: company,
      currency: input.currency || "INR",
      location: input.businessAddress || input.country || null,
    },
  });

  const trial = await startTrialForBusiness({
    businessId: business.id,
    actorUserId: input.actorUserId,
    trialDays,
  });

  // Billing record (open platform invoice for trial tracking)
  await prisma.platformInvoice.create({
    data: {
      businessId: business.id,
      number: `MM-TRIAL-${Date.now().toString(36).toUpperCase()}`,
      kind: "subscription",
      amount: 0,
      currency: input.currency || "INR",
      status: "open",
      plan: "trial",
      periodStart: trial.trialStartDate || new Date(),
      periodEnd: trial.trialEndDate || undefined,
      notes: "Free trial period",
    },
  });

  await recordAudit({
    businessId: business.id,
    actorUserId: input.actorUserId,
    action: "platform_provision_customer",
    entityType: "business",
    entityId: business.id,
    metadata: {
      ownerEmail: email,
      trialDays,
      reusedUser: owner.reusedUser,
    },
  });

  const loginUrl = getLoginUrl("/login");
  const welcome = buildWelcomeAccountEmail({
    companyName: company,
    ownerName: input.ownerName,
    email,
    temporaryPassword: tempPassword,
    trialEndDate: trial.trialEndDate,
    loginUrl,
  });

  void sendEmail({
    to: email,
    subject: welcome.subject,
    text: welcome.text,
    html: welcome.html,
    sensitive: true,
  }).catch((err) => console.error("[provision] welcome email failed", err));

  // Second delivery with credentials-focused subject (same premium template)
  void sendEmail({
    to: email,
    subject: "Your Massive Mentor CRM login credentials",
    text: welcome.text,
    html: welcome.html,
    sensitive: true,
  }).catch(() => undefined);

  try {
    const { notifySuperAdmins } = await import("./billing-notify.service.js");
    await notifySuperAdmins({
      title: "New customer created",
      message: `${company} · ${email} · ${trialDays}-day trial`,
      entityType: "business",
      entityId: business.id,
    });
  } catch {
    /* non-fatal */
  }

  const detail = await prisma.business.findUnique({
    where: { id: business.id },
    include: {
      owner: { select: { id: true, email: true, name: true } },
    },
  });

  return {
    business: detail,
    owner: {
      id: owner.userId,
      email,
      name: input.ownerName,
      temporaryPassword: tempPassword,
    },
    trial: {
      days: trialDays,
      startDate: trial.trialStartDate,
      endDate: trial.trialEndDate,
    },
    loginUrl,
    emailsQueued: true,
  };
}
