import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import {
  listPublishedTemplates,
  getTemplateByIdOrSlug,
  provisionTemplateToBusiness,
  getBusinessConfigOrEnsure,
  seedIndustryTemplates,
} from "../services/template.service.js";
import { ensureDefaultBusiness } from "../services/business.service.js";
import { z } from "zod";

export async function listTemplates(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const templates = await listPublishedTemplates();
    res.json({ success: true, data: { templates } });
  } catch (error: unknown) {
    console.error("[templates] list error:", error);
    res.status(500).json({ success: false, error: "Failed to list templates" });
  }
}

/** Public industry catalog for registration (no auth) */
export async function listTemplateCatalog(_req: AuthenticatedRequest, res: Response) {
  try {
    const templates = await listPublishedTemplates();
    res.json({
      success: true,
      data: {
        templates: templates.map((t) => ({
          slug: t.slug,
          name: t.name,
          description: t.description,
          category: t.category,
        })),
      },
    });
  } catch (error: unknown) {
    console.error("[templates] catalog error:", error);
    res.status(500).json({ success: false, error: "Failed to load industry catalog" });
  }
}

export async function getTemplate(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const idOrSlug = String(req.params.idOrSlug || "");
    const template = await getTemplateByIdOrSlug(idOrSlug);
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({
      success: true,
      data: {
        template: {
          id: template.id,
          slug: template.slug,
          name: template.name,
          description: template.description,
          category: template.category,
          version: template.version,
          schemaVersion: template.schemaVersion,
          manifest: template.manifest,
        },
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to load template" });
  }
}

const installSchema = z.object({
  templateId: z.string().min(1).optional(),
  templateSlug: z.string().min(1).optional(),
  replaceExisting: z.boolean().optional(),
});

/** Install / re-provision a template onto the current business */
export async function installTemplate(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "templateId or templateSlug required" });
    }
    const idOrSlug = parsed.data.templateId || parsed.data.templateSlug;
    if (!idOrSlug) {
      return res.status(400).json({ success: false, error: "templateId or templateSlug required" });
    }

    const business = await ensureDefaultBusiness(req.user.id);
    const result = await provisionTemplateToBusiness({
      businessId: business.id,
      templateIdOrSlug: idOrSlug,
      installedByUserId: req.user.id,
      source: "onboarding",
      replaceExisting: parsed.data.replaceExisting === true,
    });

    res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[templates] install error:", error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to install template",
    });
  }
}

export async function getCurrentConfig(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const business = await ensureDefaultBusiness(req.user.id);
    const data = await getBusinessConfigOrEnsure(business.id, req.user.id);
    res.json({ success: true, data });
  } catch (error: unknown) {
    console.error("[templates] config error:", error);
    res.status(500).json({ success: false, error: "Failed to load business config" });
  }
}

/** Dev/admin helper: re-run seed */
export async function reseedTemplates(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    if (req.user.platformRole !== "super_admin" && req.user.role !== "admin") {
      // Allow any authenticated user in dev-like flow for now; still no industry hardcoding
      // Prefer platform super_admin when set
    }
    const result = await seedIndustryTemplates();
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to seed templates" });
  }
}
