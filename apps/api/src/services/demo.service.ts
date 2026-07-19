import { prisma } from "@/lib/prisma";
import { createBusinessWithTemplate } from "@/services/business.service";
import { recordAudit } from "@/services/audit.service";
import bcrypt from "bcryptjs";

/** Demo portal credentials (product demo only — never production customers) */
export const DEMO_EMAIL = (process.env.DEMO_EMAIL || "demo@massivementor.in").toLowerCase().trim();
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "123456789";
export const DEMO_BUSINESS_NAME = "Massive Mentor Demo Co";

/**
 * Ensure a dedicated demo tenant exists with sample CRM data.
 * Completely isolated: isDemo=true, portalKind=demo.
 * Customer auth tokens can never resolve this workspace via customer login.
 * Idempotent: re-syncs password to DEMO_PASSWORD / env on every boot.
 */
export async function ensureDemoWorkspace() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        passwordHash,
        name: "Demo User",
        role: "business_admin",
        platformRole: "user",
        profile: {
          create: {
            businessName: DEMO_BUSINESS_NAME,
            industry: "Software / SaaS",
            description: "Product demonstration workspace — sample data only",
          },
        },
      },
    });
    console.log(`[demo] Created demo user: ${DEMO_EMAIL}`);
  } else {
    // Keep password in sync with configured DEMO_PASSWORD (dev + ops convenience)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        platformRole: "user", // never elevate demo to super_admin
        isDisabled: false,
      },
    });
  }

  let business = await prisma.business.findFirst({
    where: { isDemo: true, portalKind: "demo" },
  });

  if (!business) {
    const created = await createBusinessWithTemplate({
      ownerUserId: user.id,
      businessName: DEMO_BUSINESS_NAME,
      templateSlug: "software_company",
      memberRole: "business_admin",
    });
    business = await prisma.business.update({
      where: { id: created.id },
      data: {
        isDemo: true,
        portalKind: "demo",
        plan: "professional",
        planStatus: "active",
        licenseStatus: "active",
        status: "active",
      },
    });
  } else {
    await prisma.businessMember.upsert({
      where: {
        businessId_userId: { businessId: business.id, userId: user.id },
      },
      create: { businessId: business.id, userId: user.id, role: "business_admin" },
      update: { role: "business_admin" },
    });
    // Ensure flags stay correct
    if (!business.isDemo || business.portalKind !== "demo") {
      business = await prisma.business.update({
        where: { id: business.id },
        data: { isDemo: true, portalKind: "demo", status: "active" },
      });
    }
  }

  const contactCount = await prisma.contact.count({ where: { businessId: business.id } });
  if (contactCount === 0) {
    await seedDemoData(user.id, business.id);
  }

  return { user, business };
}

async function seedDemoData(userId: string, businessId: string) {
  const leads = [
    { name: "Asha Reddy", email: "asha@example.com", phone: "9000000001", company: "Sunrise Realty", status: "new", value: 45000 },
    { name: "Rahul Mehta", email: "rahul@example.com", phone: "9000000002", company: "Mehta Foods", status: "contacted", value: 22000 },
    { name: "Priya Nair", email: "priya@example.com", phone: "9000000003", company: "Nair Clinics", status: "qualified", value: 78000 },
    { name: "Vikram Shah", email: "vikram@example.com", phone: "9000000004", company: "Shah Logistics", status: "proposal", value: 120000 },
    { name: "Neha Kapoor", email: "neha@example.com", phone: "9000000005", company: "Kapoor Academy", status: "negotiation", value: 35000 },
  ];

  for (const l of leads) {
    await prisma.contact.create({
      data: {
        userId,
        businessId,
        type: "lead",
        name: l.name,
        email: l.email,
        phone: l.phone,
        company: l.company,
        status: l.status,
        value: l.value,
        source: "demo",
        description: "Demo sample lead — resets periodically",
      },
    });
  }

  await prisma.contact.create({
    data: {
      userId,
      businessId,
      type: "client",
      name: "Acme Retail Pvt Ltd",
      email: "accounts@acmeretail.demo",
      phone: "9000000099",
      company: "Acme Retail",
      status: "active",
      value: 250000,
      source: "demo",
      description: "Demo active client",
    },
  });

  const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won"] as const;
  for (let i = 0; i < stages.length; i++) {
    await prisma.deal.create({
      data: {
        userId,
        businessId,
        title: `Demo Deal ${i + 1}`,
        stage: stages[i],
        value: 15000 * (i + 1),
        probability: 20 * (i + 1),
        notes: "Sample pipeline deal for product demos",
      },
    });
  }

  await prisma.task.create({
    data: {
      userId,
      businessId,
      title: "Call Asha Reddy — discovery",
      status: "todo",
      priority: "high",
      description: "Demo follow-up task",
      dueDate: new Date(Date.now() + 86400000),
    },
  });
  await prisma.task.create({
    data: {
      userId,
      businessId,
      title: "Send proposal to Vikram Shah",
      status: "in_progress",
      priority: "medium",
      description: "Demo task",
      dueDate: new Date(Date.now() + 2 * 86400000),
    },
  });

  await prisma.meeting.create({
    data: {
      userId,
      businessId,
      title: "Demo product walkthrough",
      scheduledAt: new Date(Date.now() + 3 * 86400000),
      durationMin: 45,
      notes: "Show CRM + AI Follow-up + Field Sales",
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "demo_seed",
    entityType: "business",
    entityId: businessId,
    metadata: { sample: true },
  });
}

/** Wipe demo CRM rows and re-seed sample data. Never touches customer businesses. */
export async function resetDemoData(actorUserId?: string) {
  const business = await prisma.business.findFirst({
    where: { isDemo: true, portalKind: "demo" },
  });
  if (!business) {
    return ensureDemoWorkspace();
  }

  const bid = business.id;

  await prisma.task.deleteMany({ where: { businessId: bid } });
  await prisma.meeting.deleteMany({ where: { businessId: bid } });
  await prisma.deal.deleteMany({ where: { businessId: bid } });
  await prisma.contact.deleteMany({ where: { businessId: bid } });

  const ownerId = business.ownerUserId;
  await seedDemoData(ownerId, bid);

  await prisma.business.update({
    where: { id: bid },
    data: { lastDemoResetAt: new Date() },
  });

  await recordAudit({
    businessId: bid,
    actorUserId: actorUserId || ownerId,
    action: "demo_reset",
    entityType: "business",
    entityId: bid,
    metadata: { at: new Date().toISOString() },
  });

  return { businessId: bid, resetAt: new Date().toISOString() };
}

export async function getDemoBusinessId(): Promise<string | null> {
  const b = await prisma.business.findFirst({
    where: { isDemo: true, portalKind: "demo" },
    select: { id: true },
  });
  return b?.id ?? null;
}
