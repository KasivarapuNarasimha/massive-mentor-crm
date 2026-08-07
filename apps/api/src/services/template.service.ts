import { prisma } from "../lib/prisma.js";
import { getAllSeedManifests, getSeedManifestBySlug } from "../templates/seed-catalog.js";
import {
  industryTemplateManifestSchema,
  type IndustryTemplateManifest,
} from "../types/template-manifest.js";
import { recordAudit } from "./audit.service.js";
import { createHash } from "crypto";

export type TemplateListItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  version: number;
  isPublished: boolean;
  isSystem: boolean;
  isMarketplace: boolean;
};

function packageHash(manifest: IndustryTemplateManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 32);
}

/**
 * Upsert system seed templates into DB (idempotent).
 * Call on API boot and before listing if empty.
 */
/** Process-level cache — boot seeds once; avoid re-upserting 21 templates on every dashboard hit. */
let seedIndustryTemplatesPromise: Promise<{ upserted: number }> | null = null;
let seedIndustryTemplatesAt = 0;
const SEED_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export async function seedIndustryTemplates(opts?: {
  force?: boolean;
}): Promise<{ upserted: number }> {
  const force = !!opts?.force;
  if (
    !force &&
    seedIndustryTemplatesPromise &&
    Date.now() - seedIndustryTemplatesAt < SEED_TTL_MS
  ) {
    return seedIndustryTemplatesPromise;
  }

  seedIndustryTemplatesAt = Date.now();
  seedIndustryTemplatesPromise = (async () => {
    const seeds = getAllSeedManifests();
    let upserted = 0;

    for (const manifest of seeds) {
      const parsed = industryTemplateManifestSchema.safeParse(manifest);
      if (!parsed.success) {
        console.error(`[templates] invalid seed ${manifest.slug}:`, parsed.error.flatten());
        continue;
      }
      const m = parsed.data;
      await prisma.industryTemplate.upsert({
        where: { slug: m.slug },
        create: {
          slug: m.slug,
          name: m.name,
          description: m.description || null,
          category: (getSeedCategory(m.slug) as string) || null,
          version: 1,
          schemaVersion: m.schemaVersion,
          isPublished: true,
          isSystem: true,
          isMarketplace: true,
          authorName: "Massive Mentor",
          manifest: m as object,
          packageHash: packageHash(m),
        },
        update: {
          name: m.name,
          description: m.description || null,
          category: getSeedCategory(m.slug) || null,
          schemaVersion: m.schemaVersion,
          isPublished: true,
          isSystem: true,
          isMarketplace: true,
          manifest: m as object,
          packageHash: packageHash(m),
          // bump version only when hash changes — handled below
        },
      });
      upserted++;
    }

    console.log(`[templates] seeded/updated ${upserted} industry templates`);
    return { upserted };
  })().catch((err) => {
    seedIndustryTemplatesPromise = null;
    seedIndustryTemplatesAt = 0;
    throw err;
  });

  return seedIndustryTemplatesPromise;
}

function getSeedCategory(slug: string): string | null {
  const hit = getAllSeedManifests().find((m) => m.slug === slug);
  // category is on seed meta, not always on manifest — map known slugs from name of seed catalog via re-export
  const categories: Record<string, string> = {
    generic: "general",
    coaching_institute: "education",
    real_estate: "real_estate",
    hospital: "healthcare",
    digital_marketing: "marketing",
    restaurant: "hospitality",
    gym: "fitness",
    salon: "beauty",
    insurance: "finance",
    retail: "retail",
    finance: "finance",
    manufacturing: "manufacturing",
    construction: "construction",
    education: "education",
    software_company: "technology",
    travel: "travel",
  };
  return categories[slug] || hit?.name || null;
}

export async function listPublishedTemplates(): Promise<TemplateListItem[]> {
  const count = await prisma.industryTemplate.count();
  if (count === 0) {
    await seedIndustryTemplates();
  }

  const rows = await prisma.industryTemplate.findMany({
    where: { isPublished: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      category: true,
      version: true,
      isPublished: true,
      isSystem: true,
      isMarketplace: true,
    },
  });
  return rows;
}

export async function getTemplateByIdOrSlug(idOrSlug: string) {
  const byId = await prisma.industryTemplate.findUnique({ where: { id: idOrSlug } });
  if (byId) return byId;
  return prisma.industryTemplate.findUnique({ where: { slug: idOrSlug } });
}

export type ProvisionSource = "seed" | "onboarding" | "marketplace" | "import" | "ensure_default";

/**
 * Clone template manifest → BusinessConfig and link Business.templateId.
 * Marketplace-ready: same function for seed, onboarding, install.
 */
export async function provisionTemplateToBusiness(opts: {
  businessId: string;
  templateIdOrSlug: string;
  installedByUserId?: string | null;
  source?: ProvisionSource;
  replaceExisting?: boolean;
}): Promise<{
  businessId: string;
  templateId: string;
  templateSlug: string;
  configVersion: number;
  fieldCount: number;
  moduleCount: number;
}> {
  const template = await getTemplateByIdOrSlug(opts.templateIdOrSlug);
  if (!template || !template.isPublished) {
    throw new Error("Industry template not found or not published");
  }

  const parsed = industryTemplateManifestSchema.safeParse(template.manifest);
  if (!parsed.success) {
    throw new Error(`Template manifest invalid: ${parsed.error.errors[0]?.message || "schema error"}`);
  }
  const manifest = parsed.data;

  const existingConfig = await prisma.businessConfig.findUnique({
    where: { businessId: opts.businessId },
  });

  if (existingConfig && !opts.replaceExisting) {
    // Already provisioned — return as-is
    return {
      businessId: opts.businessId,
      templateId: template.id,
      templateSlug: template.slug,
      configVersion: existingConfig.version,
      fieldCount: Array.isArray(existingConfig.fields) ? (existingConfig.fields as unknown[]).length : 0,
      moduleCount: Array.isArray(existingConfig.modules) ? (existingConfig.modules as unknown[]).length : 0,
    };
  }

  const configData = {
    schemaVersion: manifest.schemaVersion,
    version: existingConfig ? existingConfig.version + 1 : 1,
    modules: manifest.modules as object,
    fields: manifest.fields as object,
    pipelines: manifest.pipelines as object,
    dashboards: manifest.dashboards as object,
    reports: manifest.reports as object,
    automations: manifest.automations as object,
    notifications: manifest.notifications as object,
    aiPromptPack: manifest.aiPromptPack as object,
    roles: manifest.roles as object,
    importMappings: manifest.importMappings as object,
    portals: (manifest.portals || []) as object,
    feedback: (manifest.feedback as object) ?? undefined,
    plugins: (manifest.plugins as object) ?? undefined,
    whiteLabelDefaults: (manifest.whiteLabelDefaults as object) ?? undefined,
  };

  if (existingConfig) {
    await prisma.businessConfig.update({
      where: { businessId: opts.businessId },
      data: configData,
    });
  } else {
    await prisma.businessConfig.create({
      data: {
        businessId: opts.businessId,
        ...configData,
      },
    });
  }

  await prisma.business.update({
    where: { id: opts.businessId },
    data: {
      templateId: template.id,
      templateSlug: template.slug,
      templateVersion: template.version,
    },
  });

  await prisma.templateInstall.create({
    data: {
      businessId: opts.businessId,
      templateId: template.id,
      templateVersion: template.version,
      source: opts.source || "onboarding",
      installedByUserId: opts.installedByUserId || null,
    },
  });

  await recordAudit({
    businessId: opts.businessId,
    actorUserId: opts.installedByUserId,
    action: "template_install",
    entityType: "industry_template",
    entityId: template.id,
    metadata: {
      slug: template.slug,
      version: template.version,
      source: opts.source || "onboarding",
      fieldCount: manifest.fields.length,
    },
  });

  return {
    businessId: opts.businessId,
    templateId: template.id,
    templateSlug: template.slug,
    configVersion: configData.version,
    fieldCount: manifest.fields.length,
    moduleCount: manifest.modules.length,
  };
}

/**
 * Refresh portals, roles, and dashboards from the latest seed template
 * without wiping CRM fields/pipelines (production role-shell updates).
 * Only writes when shell content actually changed.
 */
export async function syncRoleShellFromTemplate(businessId: string): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { templateSlug: true },
  });
  const config = await prisma.businessConfig.findUnique({ where: { businessId } });
  if (!config) return;

  const slug =
    business?.templateSlug && getSeedManifestBySlug(business.templateSlug)
      ? business.templateSlug
      : "generic";
  const seed = getSeedManifestBySlug(slug) || getSeedManifestBySlug("generic");
  if (!seed) return;

  const parsed = industryTemplateManifestSchema.safeParse(seed);
  if (!parsed.success) return;
  const m = parsed.data;

  const nextPortals = m.portals || [];
  const nextRoles = m.roles;
  const nextDashboards = m.dashboards;
  const same =
    JSON.stringify(config.portals) === JSON.stringify(nextPortals) &&
    JSON.stringify(config.roles) === JSON.stringify(nextRoles) &&
    JSON.stringify(config.dashboards) === JSON.stringify(nextDashboards);
  if (same) return;

  await prisma.businessConfig.update({
    where: { businessId },
    data: {
      portals: nextPortals as object,
      roles: nextRoles as object,
      dashboards: nextDashboards as object,
      version: { increment: 1 },
    },
  });
}

/**
 * Ensure business has BusinessConfig. Defaults to generic template.
 * Existing configs get portals/roles/dashboards synced to production role shell.
 */
export async function ensureBusinessConfig(
  businessId: string,
  userId?: string | null,
  preferredSlug?: string | null
) {
  const existing = await prisma.businessConfig.findUnique({ where: { businessId } });
  if (existing) {
    // Config already present — do not re-seed industry templates or rewrite portals
    // on every dashboard request (was adding ~1s per hit).
    return existing;
  }

  // First-time provision only
  await seedIndustryTemplates();

  const slug = preferredSlug && getSeedManifestBySlug(preferredSlug) ? preferredSlug : "generic";
  await provisionTemplateToBusiness({
    businessId,
    templateIdOrSlug: slug,
    installedByUserId: userId,
    source: "ensure_default",
  });

  return prisma.businessConfig.findUniqueOrThrow({ where: { businessId } });
}

export async function getBusinessConfig(businessId: string) {
  return prisma.businessConfig.findUnique({ where: { businessId } });
}

export async function getBusinessConfigOrEnsure(businessId: string, userId?: string) {
  await ensureBusinessConfig(businessId, userId);
  const config = await prisma.businessConfig.findUnique({ where: { businessId } });
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      templateId: true,
      templateSlug: true,
      templateVersion: true,
    },
  });
  return { business, config };
}
