/**
 * Resolve business type (industry template slug) from admin/registration input.
 * Single source of truth shared by register, Super Admin provision, and settings.
 * Unknown types fall back to Generic CRM (`generic`).
 */
import { prisma } from "../lib/prisma.js";
import { seedIndustryTemplates, getTemplateByIdOrSlug } from "./template.service.js";

const ALIASES: Record<string, string> = {
  other: "generic",
  generic_crm: "generic",
  "digital_marketing_agency": "digital_marketing",
  digitalmarketing: "digital_marketing",
  software: "software_company",
  "real-estate": "real_estate",
  realestate: "real_estate",
  coaching: "coaching_institute",
};

export type ResolvedIndustryTemplate = {
  templateSlug: string;
  templateName: string;
  industryLabel: string;
  templateId: string | null;
};

/**
 * Normalize + resolve a template slug / label to a published IndustryTemplate.
 * Falls back to `generic` when no specialized template exists.
 */
export async function resolveIndustryTemplate(input: {
  templateSlug?: string | null;
  industryLabel?: string | null;
}): Promise<ResolvedIndustryTemplate> {
  await seedIndustryTemplates();

  let templateSlug = (input.templateSlug || "generic")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (ALIASES[templateSlug]) templateSlug = ALIASES[templateSlug];

  let template = await getTemplateByIdOrSlug(templateSlug);

  if (!template && templateSlug !== "generic") {
    const byName = await prisma.industryTemplate.findFirst({
      where: {
        isPublished: true,
        OR: [
          { name: { equals: input.industryLabel || input.templateSlug || "", mode: "insensitive" } },
          { slug: templateSlug },
        ],
      },
    });
    if (byName) {
      template = byName;
      templateSlug = byName.slug;
    } else {
      templateSlug = "generic";
      template = await getTemplateByIdOrSlug("generic");
    }
  } else if (template) {
    templateSlug = template.slug;
  }

  if (!template && templateSlug === "generic") {
    template = await getTemplateByIdOrSlug("generic");
  }

  const templateName = template?.name || "Other / Generic";
  const industryLabel = (input.industryLabel || "").trim() || templateName;

  return {
    templateSlug: template?.slug || "generic",
    templateName,
    industryLabel,
    templateId: template?.id || null,
  };
}
